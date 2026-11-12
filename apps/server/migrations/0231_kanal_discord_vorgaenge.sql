-- 0231: Vorgänge aus Discord im Betreiber-Kanal (WI-0255 Paket 2; Vali 2026-10-26: `/bug`, `/idee` und `/frage` landen als Vorgang im Kanal,
-- keine zweite Fallverwaltung, und „Erst sichten“). Handover `project-control/handovers/2026-10-26-discord-befehle-paket-2-an-claudia.md`.
--
-- Ein Discord-Vorgang hat keine Person aus `avesmaps_auth.person`, sondern einen Melder aus der Interaktion:
--   quelle          `app` (alles bisher) oder `discord`
--   melder_name     der Anzeigename, den Discord nennt (Spitzname im Server, sonst globaler Name, sonst Benutzername); bereinigt, höchstens 80 Zeichen
--   melder_kennung  die Discord-Kennung der Person (Snowflake), NUR intern: Zuordnung und Missbrauch. Sie verlässt die Datenbank nie über die
--                   Leitung der Oberfläche, nie in `kanal_lesen` und nie in einem Text, der zurück nach Discord geht.
-- Beides geht mit dem Ablauf der Meldung weg (`_auf_rest`), wie Titel, Text und Kontext.
--
-- 🔴 „Erst sichten“: Ein Discord-Vorgang kommt im Status `zu_sichten` an, zuständig ist der Betreiber. Die Kanal-Routine ändert Code und lässt
-- Tests laufen; Discord ist öffentlich, sein Text nicht vertrauenswürdig. Bis ein Betreiber ihn freigibt (`kanal_sichten`):
--   - holt `kanal_abholen` ihn nicht ab (auch nicht mit `p_alle`);
--   - zeigt `kanal_lesen` den Agenten weder Titel noch Text, Schritte, Kontext oder Melder;
--   - weist die Datenbank jeden Eintrag und Nachweis eines Agenten an ihm ab, jede Lease und jeden Statuswechsel außer `neu` (Freigabe) und
--     `abgenommen` (der Betreiber schließt ab, `kanal_abschliessen`). Das hält auch einen künftigen Schreibweg, der die Funktionen umgeht.
--
-- 🔴 ERWEITERND: neue Spalten mit Vorgabe oder NULL, CHECKs nur geweitet (`vorgang_status` um `zu_sichten`, `vorgang_rest` um den Melder aus
-- Discord), zwei neue Funktionen, drei bestehende mit derselben Signatur und Rückgabe neu geschrieben. Das vorige Release schreibt keinen der
-- neuen Werte. EXECUTE auf die neuen Funktionen vergibt `kanal-grants.psql` an die App-Rolle.

ALTER TABLE avesmaps_kanal.vorgang
    ADD COLUMN IF NOT EXISTS quelle TEXT NOT NULL DEFAULT 'app'
        CONSTRAINT vorgang_quelle CHECK (quelle IN ('app', 'discord')),
    ADD COLUMN IF NOT EXISTS melder_name TEXT
        CONSTRAINT vorgang_melder_name CHECK (melder_name IS NULL OR char_length(melder_name) BETWEEN 1 AND 80),
    ADD COLUMN IF NOT EXISTS melder_kennung TEXT
        CONSTRAINT vorgang_melder_kennung CHECK (melder_kennung IS NULL OR melder_kennung ~ '^[0-9]{17,20}$');

-- Melder aus Discord gibt es nur an Vorgängen aus Discord; `zu_sichten` nur an Vorgängen, die nicht ein Betreiber selbst meldete.
ALTER TABLE avesmaps_kanal.vorgang DROP CONSTRAINT IF EXISTS vorgang_melder_quelle;
ALTER TABLE avesmaps_kanal.vorgang ADD CONSTRAINT vorgang_melder_quelle
    CHECK (quelle = 'discord' OR (melder_name IS NULL AND melder_kennung IS NULL));
ALTER TABLE avesmaps_kanal.vorgang DROP CONSTRAINT IF EXISTS vorgang_zu_sichten_quelle;
ALTER TABLE avesmaps_kanal.vorgang ADD CONSTRAINT vorgang_zu_sichten_quelle CHECK (status <> 'zu_sichten' OR quelle <> 'app');

ALTER TABLE avesmaps_kanal.vorgang DROP CONSTRAINT IF EXISTS vorgang_status;
ALTER TABLE avesmaps_kanal.vorgang ADD CONSTRAINT vorgang_status CHECK (status IN (
    'zu_sichten', 'neu', 'angenommen', 'in_arbeit', 'bei_claudia', 'auf_stage', 'beantwortet', 'abgelehnt', 'zur_abnahme', 'abgenommen'
));

-- Titel, Nachricht und Meldende fehlen nur nach dem Ablauf; die Meldende ist eine Person ODER, aus Discord, ein Anzeigename.
ALTER TABLE avesmaps_kanal.vorgang DROP CONSTRAINT IF EXISTS vorgang_rest;
ALTER TABLE avesmaps_kanal.vorgang ADD CONSTRAINT vorgang_rest CHECK (
    abgelaufen_at IS NOT NULL
    OR (titel IS NOT NULL AND nachricht IS NOT NULL
        AND (gemeldet_von IS NOT NULL OR (quelle = 'discord' AND melder_name IS NOT NULL)))
);

COMMENT ON COLUMN avesmaps_kanal.vorgang.quelle IS 'Woher der Vorgang kam: app (ein Betreiber meldete) oder discord (WI-0255 Paket 2, erst sichten).';
COMMENT ON COLUMN avesmaps_kanal.vorgang.melder_name IS 'Discord-Anzeigename der meldenden Person (WI-0255); geht mit dem Ablauf.';
COMMENT ON COLUMN avesmaps_kanal.vorgang.melder_kennung IS
    'Discord-Kennung der meldenden Person, nur intern (Zuordnung, Missbrauch); nie über die Leitung, nie zurück nach Discord; geht mit dem Ablauf.';
CREATE INDEX IF NOT EXISTS vorgang_melder_kennung ON avesmaps_kanal.vorgang (melder_kennung, gemeldet_at) WHERE melder_kennung IS NOT NULL;

-- Der Rest einer Meldung (§3.1) verliert auch den Melder aus Discord. Sonst wie 0106.
CREATE OR REPLACE FUNCTION avesmaps_kanal._auf_rest(p_vorgang BIGINT, p_von_hand BOOLEAN) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    UPDATE avesmaps_kanal.bild SET entfernen_ab = COALESCE(entfernen_ab, now()) WHERE vorgang_id = p_vorgang AND geloescht_at IS NULL;
    DELETE FROM avesmaps_kanal.eintrag WHERE vorgang_id = p_vorgang;
    UPDATE avesmaps_kanal.nachweis SET von_person = NULL WHERE vorgang_id = p_vorgang;
    UPDATE avesmaps_kanal.vorgang SET
        titel = NULL, nachricht = NULL, schritte = NULL, kontext = '{}'::jsonb, gemeldet_von = NULL, abgenommen_von = NULL,
        melder_name = NULL, melder_kennung = NULL,
        abgelaufen_at = now(), von_hand_geloescht = p_von_hand, lease_agent = NULL, lease_bis = NULL, revision = revision + 1
     WHERE id = p_vorgang;
END;
$$;

-- Ein Vorgang aus Discord (die App hat die Signatur von Discord geprüft und den Text bereinigt). Dieselbe Operation zweimal (Discord stellt
-- eine Interaktion höchstens einmal zu, die App leitet die Operation aus ihrer Kennung ab) gibt denselben Vorgang zurück.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_discord_melden(
    p_operation UUID, p_environment TEXT, p_kategorie TEXT, p_titel TEXT, p_nachricht TEXT, p_melder_name TEXT, p_melder_kennung TEXT,
    p_kontext JSONB
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    SELECT id INTO v_id FROM avesmaps_kanal.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF p_kategorie NOT IN ('bug', 'idee', 'nutzerfrage') THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: aus Discord kommen nur Bug, Idee und Frage');
    END IF;
    INSERT INTO avesmaps_kanal.vorgang (
        environment, art, kategorie, prioritaet, status, titel, nachricht, kontext, zustaendig, quelle, melder_name, melder_kennung,
        operation_id
    ) VALUES (
        p_environment, 'meldung', p_kategorie, 'normal', 'zu_sichten', btrim(p_titel), btrim(p_nachricht), COALESCE(p_kontext, '{}'::jsonb),
        'betreiber', 'discord', btrim(p_melder_name), p_melder_kennung, p_operation
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- Ein Betreiber gibt einen Vorgang frei (die App hat Person und Recht geprüft): `zu_sichten` → `neu`, an Claudio oder Claudia. Ohne `p_an`
-- die Regel aus `kanal_melden` (Umbau und Karteninhalt Claudia, alles andere Claudio).
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_sichten(
    p_operation UUID, p_vorgang BIGINT, p_person UUID, p_revision INTEGER, p_an TEXT DEFAULT NULL
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_kanal.vorgang;
BEGIN
    IF avesmaps_kanal._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
    END IF;
    IF p_person IS NULL THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: freigeben braucht die Person');
    END IF;
    IF p_an IS NOT NULL AND p_an NOT IN ('claudio', 'claudia') THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: freigegeben wird an claudio oder claudia');
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.revision <> p_revision THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_conflict: der Vorgang hat sich inzwischen geändert');
    END IF;
    IF v.status <> 'zu_sichten' THEN
        PERFORM avesmaps_kanal._fehler('KA409', format('kanal_transition: freigeben geht nur aus „zu sichten“, nicht aus %s', v.status));
    END IF;
    UPDATE avesmaps_kanal.vorgang SET status = 'neu',
        zustaendig = COALESCE(p_an, CASE WHEN v.kategorie IN ('umbau', 'karteninhalt') THEN 'claudia' ELSE 'claudio' END)
     WHERE id = p_vorgang;
    PERFORM avesmaps_kanal._eintrag(p_vorgang, 'status', p_person, NULL, NULL, 'zu_sichten', 'neu', NULL, p_operation);
    RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
END;
$$;

-- Die Sperre in der Datenbank: Was zu sichten ist, fasst kein Agent an, auf welchem Weg auch immer.
CREATE OR REPLACE FUNCTION avesmaps_kanal._zu_sichten_vorgang() RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.status = 'zu_sichten' AND NEW.status NOT IN ('zu_sichten', 'neu', 'abgenommen') THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang ist noch zu sichten');
    END IF;
    IF NEW.status = 'zu_sichten' AND NEW.lease_agent IS NOT NULL THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang ist noch zu sichten');
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_kanal._zu_sichten_agent() RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.von_agent IS NOT NULL
       AND EXISTS (SELECT 1 FROM avesmaps_kanal.vorgang v WHERE v.id = NEW.vorgang_id AND v.status = 'zu_sichten') THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang ist noch zu sichten');
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zu_sichten ON avesmaps_kanal.vorgang;
CREATE TRIGGER zu_sichten BEFORE UPDATE ON avesmaps_kanal.vorgang
    FOR EACH ROW EXECUTE FUNCTION avesmaps_kanal._zu_sichten_vorgang();
DROP TRIGGER IF EXISTS zu_sichten ON avesmaps_kanal.eintrag;
CREATE TRIGGER zu_sichten BEFORE INSERT ON avesmaps_kanal.eintrag
    FOR EACH ROW EXECUTE FUNCTION avesmaps_kanal._zu_sichten_agent();
DROP TRIGGER IF EXISTS zu_sichten ON avesmaps_kanal.nachweis;
CREATE TRIGGER zu_sichten BEFORE INSERT ON avesmaps_kanal.nachweis
    FOR EACH ROW EXECUTE FUNCTION avesmaps_kanal._zu_sichten_agent();

-- Abholen wie 0123, dazu: Was zu sichten ist, holt keine Routine ab.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_abholen(p_limit INTEGER, p_alle BOOLEAN DEFAULT false, p_als TEXT DEFAULT NULL)
    RETURNS TABLE (
        id BIGINT, art TEXT, kategorie TEXT, prioritaet TEXT, status TEXT, zustaendig TEXT, titel TEXT, gemeldet_at TIMESTAMPTZ,
        neues_vom_betreiber BOOLEAN
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
    v_ids BIGINT[];
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: höchstens 50 auf einmal');
    END IF;
    UPDATE avesmaps_kanal.agent SET zuletzt_abgeholt = now() WHERE name = v_agent;
    SELECT array_agg(x.id) INTO v_ids FROM (
        SELECT v.id
          FROM avesmaps_kanal.vorgang v
         WHERE v.status NOT IN ('zur_abnahme', 'abgenommen', 'zu_sichten')
           -- 🔴 Eine Freigabe holt der Abholer selbst (FREIGABE-0001): Eine Lease von 45 min der Kanal-Routine hielte ihn
           --    von seinem eigenen Auftrag fern.
           AND v.art <> 'freigabe'
           -- Eine laufende Lease (auch die eigene) hält den Vorgang aus der nächsten Runde heraus: zwei Routinen nehmen nie denselben.
           AND (v.lease_bis IS NULL OR v.lease_bis < now())
           AND (v.zustaendig = v_agent OR (v_agent = 'claudia' AND (v.status = 'bei_claudia' OR p_alle)))
           AND NOT (v_agent = 'claudio' AND v.status = 'bei_claudia')
         ORDER BY (v.kategorie IN ('stoerung', 'wiederherstellung')) DESC,
                  array_position(ARRAY['dringend', 'hoch', 'normal', 'niedrig'], v.prioritaet),
                  v.gemeldet_at, v.id
         LIMIT p_limit
           FOR UPDATE OF v SKIP LOCKED
    ) x;
    UPDATE avesmaps_kanal.vorgang v SET lease_agent = v_agent, lease_bis = now() + interval '45 minutes' WHERE v.id = ANY (v_ids);
    RETURN QUERY
    SELECT v.id, v.art, v.kategorie, v.prioritaet, v.status, v.zustaendig, v.titel, v.gemeldet_at,
           COALESCE((
               SELECT e.von_person IS NOT NULL FROM avesmaps_kanal.eintrag e WHERE e.vorgang_id = v.id ORDER BY e.seq DESC LIMIT 1
           ), true)
      FROM avesmaps_kanal.vorgang v
     WHERE v.id = ANY (v_ids)
     ORDER BY (v.kategorie IN ('stoerung', 'wiederherstellung')) DESC,
              array_position(ARRAY['dringend', 'hoch', 'normal', 'niedrig'], v.prioritaet), v.gemeldet_at, v.id;
END;
$$;

-- Lesen wie 0106, dazu: der Melder aus Discord als „Discord · <Name>“, nie seine Kennung; was zu sichten ist, ohne jeden Text.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_lesen(p_vorgang BIGINT, p_als TEXT DEFAULT NULL) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
    v avesmaps_kanal.vorgang;
    v_kopf JSONB;
BEGIN
    SELECT * INTO v FROM avesmaps_kanal.vorgang WHERE id = p_vorgang;
    IF NOT FOUND THEN
        PERFORM avesmaps_kanal._fehler('KA404', format('kanal_not_found: OPS-%s', lpad(p_vorgang::text, 6, '0')));
    END IF;
    v_kopf := to_jsonb(v) - 'operation_id' - 'gemeldet_von' - 'abgenommen_von' - 'melder_name' - 'melder_kennung';
    IF v.status = 'zu_sichten' THEN
        -- 🔴 Nicht vertrauenswürdig, bis ein Betreiber freigibt: kein Satz davon in den Prompt einer Routine.
        RETURN jsonb_build_object(
            'agent', v_agent,
            'zuSichten', true,
            'vorgang', v_kopf || jsonb_build_object('titel', NULL, 'nachricht', NULL, 'schritte', NULL, 'kontext', '{}'::jsonb),
            'gemeldetVon', 'Discord',
            'eintraege', '[]'::jsonb, 'nachweise', '[]'::jsonb, 'aenderungen', '[]'::jsonb, 'bilder', '[]'::jsonb
        );
    END IF;
    RETURN jsonb_build_object(
        'agent', v_agent,
        'vorgang', v_kopf,
        'gemeldetVon', CASE
            WHEN v.quelle = 'discord' THEN 'Discord · ' || COALESCE(v.melder_name, '—')
            ELSE (SELECT p.display_name FROM avesmaps_auth.person p WHERE p.id = v.gemeldet_von)
        END,
        'eintraege', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'seq', e.seq, 'art', e.art, 'von', COALESCE(e.von_agent, (SELECT p.display_name FROM avesmaps_auth.person p WHERE p.id = e.von_person)),
                'text', e.text, 'statusVon', e.status_von, 'statusNach', e.status_nach, 'bild', e.bild_id, 'at', e.at
            ) ORDER BY e.seq) FROM avesmaps_kanal.eintrag e WHERE e.vorgang_id = v.id), '[]'::jsonb),
        'nachweise', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'runde', n.runde, 'station', n.station, 'commit', n.commit_sha, 'release', n.release, 'notiz', n.notiz, 'at', n.at
            ) ORDER BY n.id) FROM avesmaps_kanal.nachweis n WHERE n.vorgang_id = v.id), '[]'::jsonb),
        'aenderungen', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', a.id, 'runde', a.runde, 'agent', a.agent, 'klasse', a.klasse, 'art', a.art, 'was', a.was, 'commit', a.commit_sha,
                'release', a.release, 'nachpruefung', a.nachpruefung
            ) ORDER BY a.id) FROM avesmaps_kanal.aenderung a WHERE a.vorgang_id = v.id), '[]'::jsonb),
        'bilder', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', b.id, 'zustand', b.zustand, 'format', b.format, 'breite', b.breite, 'hoehe', b.hoehe)
                   ORDER BY b.at)
              FROM avesmaps_kanal.bild b WHERE b.vorgang_id = v.id AND b.entfernen_ab IS NULL), '[]'::jsonb)
    );
END;
$$;

-- Niemand ruft die neuen Funktionen ohne ausdrückliches Recht; wer was darf, steht in `kanal-grants.psql`.
REVOKE ALL ON FUNCTION avesmaps_kanal.kanal_discord_melden(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION avesmaps_kanal.kanal_sichten(UUID, BIGINT, UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION avesmaps_kanal._zu_sichten_vorgang() FROM PUBLIC;
REVOKE ALL ON FUNCTION avesmaps_kanal._zu_sichten_agent() FROM PUBLIC;

COMMENT ON TABLE avesmaps_kanal.vorgang IS
    'Vorgänge des Betreiber-Kanals (WI-0124); seit 0122 auch die Production-Freigaben (art = freigabe, FREIGABE-0001 §8), seit 0231 Meldungen '
    'aus Discord (quelle = discord, erst sichten, WI-0255).';
