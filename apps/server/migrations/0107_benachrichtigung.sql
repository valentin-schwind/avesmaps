-- Benachrichtigungen in der Leiste (WI-0136, Bauplan project-control/planning/NACHRICHT-0001-benachrichtigungen-bauplan.md §3 und §4):
-- eine Tafel je empfangender Person, EINE Erzeugerfunktion `benachrichtige`, und der Betreiber-Kanal als erster Absender (N3, gleich
-- KANAL-0001 K6) über Auslöser an seinen Tafeln, also in derselben Transaktion wie die Handlung im Kanal, ohne zweiten Weg.
--
-- - Tafel im Schema public: Die Default-Privilegien geben der App-Rolle SELECT, INSERT, UPDATE, DELETE; `system-grants.psql` nimmt ihr
--   INSERT, DELETE und TRUNCATE wieder weg. Die App liest die eigenen Zeilen und setzt „gelesen“ und die Antwort; anlegen geht nur über
--   `benachrichtige`, löschen nur über die Aufbewahrung und die Kontoauflösung (beide `SECURITY DEFINER`).
-- - Der Satz entsteht in der Oberfläche aus `art`, Absender und OPS-ID (zweisprachig); `text` trägt höchstens einen Zusatz ohne
--   Meldungstext, etwa den Kurztitel eines Vorgangs, den der zuständige Agent gesetzt hat (NACHRICHT-0001 §4).
-- - Idempotenz: `quelle` je Person. Dieselbe Ursache (ein Eintrag im Verlauf, ein Wiederherstellungsantrag) erzeugt nie zweimal dieselbe
--   Nachricht.
-- - Aufbewahrung (§3.1): 90 Tage nach dem Lesen bzw. Beantworten, höchstens 180 Tage; gerufen vom Job `kanal_aufbewahrung`.
--
-- 🔴 REIN ADDITIV: eine neue Tafel, neue Funktionen, neue Auslöser an den Tafeln des Kanals. Das vorige Release kennt nichts davon; seine
-- Handlungen im Kanal erzeugen ab jetzt Benachrichtigungen, ohne dass sich an ihnen etwas ändert.

CREATE TABLE IF NOT EXISTS public.benachrichtigung (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    environment TEXT NOT NULL,
    an_person UUID NOT NULL REFERENCES avesmaps_auth.person (id) ON DELETE CASCADE,
    von_art TEXT NOT NULL,
    -- Nur die Kennung: Nach einer Kontoauflösung steht der Platzhalter da (keine Fremdschlüsselbindung an eine aufgelöste Person).
    von_person UUID,
    art TEXT NOT NULL,
    bezug_ops BIGINT,
    text TEXT,
    frage_geloest BOOLEAN NOT NULL DEFAULT false,
    erstellt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    gelesen_at TIMESTAMPTZ,
    beantwortet_at TIMESTAMPTZ,
    antwort TEXT,
    quelle TEXT NOT NULL,
    CONSTRAINT benachrichtigung_environment CHECK (environment IN ('development', 'staging', 'production', 'test')),
    CONSTRAINT benachrichtigung_von_art CHECK (von_art IN ('claudia', 'claudio', 'person', 'system')),
    CONSTRAINT benachrichtigung_von CHECK ((von_art = 'person') = (von_person IS NOT NULL)),
    CONSTRAINT benachrichtigung_art CHECK (art IN (
        'kanal_antwort', 'kanal_rueckfrage', 'kanal_zur_abnahme', 'kanal_fix_live', 'kanal_wiederherstellung', 'kanal_uebernommen'
    )),
    CONSTRAINT benachrichtigung_text CHECK (text IS NULL OR char_length(text) BETWEEN 1 AND 300),
    CONSTRAINT benachrichtigung_antwort CHECK (antwort IS NULL OR antwort IN ('geloest', 'nicht_geloest')),
    CONSTRAINT benachrichtigung_beantwortet CHECK ((antwort IS NULL) = (beantwortet_at IS NULL)),
    CONSTRAINT benachrichtigung_nur_mit_frage CHECK (antwort IS NULL OR frage_geloest),
    CONSTRAINT benachrichtigung_quelle CHECK (char_length(quelle) BETWEEN 1 AND 200),
    CONSTRAINT benachrichtigung_einmal UNIQUE (an_person, quelle)
);
CREATE INDEX IF NOT EXISTS benachrichtigung_person ON public.benachrichtigung (an_person, environment, id DESC);
COMMENT ON TABLE public.benachrichtigung IS 'Benachrichtigungen in der Leiste je Person (WI-0136, NACHRICHT-0001 §3); anlegen nur über benachrichtige().';

-- Die eine Erzeugerfunktion (§3.1). `an`: {"person": "<uuid>"} oder {"rolle": "operator"} (aufgefächert in eine Zeile je aktiver Person der
-- Umgebung mit dieser Rolle), dazu optional "ausser": "<uuid>". Gibt die Zahl der neuen Zeilen zurück; schon vorhandene (gleiche Quelle)
-- zählen nicht.
CREATE OR REPLACE FUNCTION public.benachrichtige(
    p_environment TEXT, p_an JSONB, p_von_art TEXT, p_von_person UUID, p_art TEXT, p_bezug_ops BIGINT, p_text TEXT, p_quelle TEXT,
    p_frage_geloest BOOLEAN DEFAULT false
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_anzahl INTEGER;
    v_ausser UUID := NULLIF(p_an->>'ausser', '')::uuid;
BEGIN
    IF p_an ? 'person' THEN
        INSERT INTO public.benachrichtigung (environment, an_person, von_art, von_person, art, bezug_ops, text, frage_geloest, quelle)
        SELECT p_environment, p.id, p_von_art, p_von_person, p_art, p_bezug_ops, NULLIF(btrim(p_text), ''), p_frage_geloest, p_quelle
          FROM avesmaps_auth.person p
         WHERE p.id = (p_an->>'person')::uuid AND p.status = 'active' AND p.id IS DISTINCT FROM v_ausser
        ON CONFLICT (an_person, quelle) DO NOTHING;
    ELSIF p_an ? 'rolle' THEN
        INSERT INTO public.benachrichtigung (environment, an_person, von_art, von_person, art, bezug_ops, text, frage_geloest, quelle)
        SELECT p_environment, p.id, p_von_art, p_von_person, p_art, p_bezug_ops, NULLIF(btrim(p_text), ''), p_frage_geloest, p_quelle
          FROM avesmaps_auth.person p
          JOIN avesmaps_auth.person_access a ON a.person_id = p.id
         WHERE a.environment = p_environment AND a.role = p_an->>'rolle' AND a.status = 'active' AND p.status = 'active'
           AND p.id IS DISTINCT FROM v_ausser
        ON CONFLICT (an_person, quelle) DO NOTHING;
    ELSE
        RAISE EXCEPTION 'benachrichtige: an braucht "person" oder "rolle"' USING ERRCODE = '22023';
    END IF;
    GET DIAGNOSTICS v_anzahl = ROW_COUNT;
    RETURN v_anzahl;
END;
$$;

-- Aufbewahrung (§3.1): 90 Tage nach dem Lesen bzw. Beantworten, höchstens 180 Tage. Gerufen vom Job `kanal_aufbewahrung`.
CREATE OR REPLACE FUNCTION public.benachrichtigung_purge_expired() RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_anzahl INTEGER;
BEGIN
    DELETE FROM public.benachrichtigung
     WHERE COALESCE(beantwortet_at, gelesen_at) < now() - interval '90 days'
        OR erstellt_at < now() - interval '180 days';
    GET DIAGNOSTICS v_anzahl = ROW_COUNT;
    RETURN v_anzahl;
END;
$$;

-- Kontoauflösung (§3.1): Die Zeilen an die Person verschwinden; als Absenderin bleibt nur die Kennung (Platzhalter in der Oberfläche).
CREATE OR REPLACE FUNCTION public.redact_person_benachrichtigung(p_person UUID) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_anzahl INTEGER;
BEGIN
    DELETE FROM public.benachrichtigung WHERE an_person = p_person;
    GET DIAGNOSTICS v_anzahl = ROW_COUNT;
    RETURN v_anzahl;
END;
$$;

-- N3: der Kanal als Absender (§4). Ein Eintrag im Verlauf löst höchstens eine Ursache aus (Quelle `kanal:eintrag:<vorgang>:<seq>`):
-- - Rückfrage oder Antwort eines Agenten → an die meldende Person;
-- - Status „an Claudia“ → „übernommen“ an die meldende Person;
-- - Status „zur Abnahme“ mit der Station „auf Stage“ in der laufenden Runde → „Fix ist live“: an die meldende Person mit der Frage
--   „Gelöst?“, an alle übrigen Betreiber zur Info; ohne diese Station (beantwortet, abgelehnt) → „zur Abnahme“ an alle Betreiber.
-- Der Zusatz ist höchstens der Kurztitel, nie Titel oder Nachricht der Meldung.
CREATE OR REPLACE FUNCTION avesmaps_kanal._benachrichtige_eintrag() RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_kanal.vorgang;
    v_quelle TEXT := format('kanal:eintrag:%s:%s', NEW.vorgang_id, NEW.seq);
    v_von TEXT := COALESCE(NEW.von_agent, 'system');
    v_fix BOOLEAN;
BEGIN
    SELECT * INTO v FROM avesmaps_kanal.vorgang WHERE id = NEW.vorgang_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF NEW.von_agent IS NOT NULL AND NEW.art IN ('rueckfrage', 'antwort') AND v.gemeldet_von IS NOT NULL THEN
        PERFORM public.benachrichtige(
            v.environment, jsonb_build_object('person', v.gemeldet_von), NEW.von_agent, NULL,
            CASE NEW.art WHEN 'rueckfrage' THEN 'kanal_rueckfrage' ELSE 'kanal_antwort' END, v.id, NULL, v_quelle
        );
    ELSIF NEW.art = 'status' AND NEW.status_nach = 'bei_claudia' AND v.gemeldet_von IS NOT NULL THEN
        PERFORM public.benachrichtige(
            v.environment, jsonb_build_object('person', v.gemeldet_von), v_von, NULL, 'kanal_uebernommen', v.id, NULL, v_quelle
        );
    ELSIF NEW.art = 'status' AND NEW.status_nach = 'zur_abnahme' THEN
        v_fix := EXISTS (
            SELECT 1 FROM avesmaps_kanal.nachweis n WHERE n.vorgang_id = v.id AND n.runde = v.runde AND n.station = 'auf_stage'
        );
        IF v_fix THEN
            IF v.gemeldet_von IS NOT NULL THEN
                PERFORM public.benachrichtige(
                    v.environment, jsonb_build_object('person', v.gemeldet_von), v_von, NULL, 'kanal_fix_live', v.id, v.kurztitel,
                    v_quelle, true
                );
            END IF;
            PERFORM public.benachrichtige(
                v.environment, jsonb_build_object('rolle', 'operator', 'ausser', v.gemeldet_von), v_von, NULL, 'kanal_fix_live', v.id,
                v.kurztitel, v_quelle
            );
        ELSE
            PERFORM public.benachrichtige(
                v.environment, jsonb_build_object('rolle', 'operator'), v_von, NULL, 'kanal_zur_abnahme', v.id, v.kurztitel, v_quelle
            );
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

-- Ein Wiederherstellungsantrag (W10, K5) geht an alle Betreiber, auch an die beantragende Person, wenn sie Betreiber ist.
CREATE OR REPLACE FUNCTION avesmaps_kanal._benachrichtige_vorgang() RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.art = 'wiederherstellung' THEN
        PERFORM public.benachrichtige(
            NEW.environment, jsonb_build_object('rolle', 'operator'),
            CASE WHEN NEW.gemeldet_von IS NULL THEN 'system' ELSE 'person' END, NEW.gemeldet_von, 'kanal_wiederherstellung', NEW.id,
            NULL, format('kanal:vorgang:%s', NEW.id)
        );
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS benachrichtige ON avesmaps_kanal.eintrag;
CREATE TRIGGER benachrichtige AFTER INSERT ON avesmaps_kanal.eintrag
    FOR EACH ROW EXECUTE FUNCTION avesmaps_kanal._benachrichtige_eintrag();
DROP TRIGGER IF EXISTS benachrichtige ON avesmaps_kanal.vorgang;
CREATE TRIGGER benachrichtige AFTER INSERT ON avesmaps_kanal.vorgang
    FOR EACH ROW EXECUTE FUNCTION avesmaps_kanal._benachrichtige_vorgang();

-- Niemand ruft die Funktionen ohne ausdrückliches Recht (`system-grants.psql`: die App `benachrichtige` und die Kontoauflösung, die
-- Jobs-Rolle die Aufbewahrung). Die Auslöser laufen als Besitzer.
REVOKE ALL ON FUNCTION public.benachrichtige(TEXT, JSONB, TEXT, UUID, TEXT, BIGINT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.benachrichtigung_purge_expired() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redact_person_benachrichtigung(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION avesmaps_kanal._benachrichtige_eintrag() FROM PUBLIC;
REVOKE ALL ON FUNCTION avesmaps_kanal._benachrichtige_vorgang() FROM PUBLIC;
