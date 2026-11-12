-- Community-Modul, Schritt C4: Kontaktformular und Reiter Mails (WI-0268; Fachkonzept project-control/planning/community-fachkonzept.md §3.1, §3.3, §3.4, §4.1, §5, §9,
-- Bedienkonzept §3). Eine Anfrage ist ein Vorgang mit `art = 'anfrage'` (0265); sie kommt aus dem Kontaktformular, die Redaktion antwortet über die Statusseite, legt sie ins
-- Archiv und holt sie zurück, oder führt sie als Meldung weiter. Echte Mails (Abruf, Versand, HTML, Anhänge) kommen mit dem Mailweg (C6), nicht hier.
--
-- 🔴 REIN ADDITIV: NUR neue Funktionen im Schema `avesmaps_community`, keine Tafel- und keine Constraint-Änderung. Die Zustände, Ergebnisse und Ereignisarten sind die vorhandenen:
-- - „wartet auf Antwort“ ist der Zustand `rueckfrage`, „Ins Archiv“ ist der Abschluss (`abgeschlossen` mit Ergebnis `beantwortet`, wenn eine Antwort ausging, sonst `erledigt`, dazu
--   `archiviert_at`), „Zurück in den Eingang“ ist das Wiedereröffnen ohne Grund (Fachkonzept §4.1: „Mails kennen nur Eingang und Archiv“).
-- - Wer Anfragen lesen und beantworten darf (`read_mailbox`, `answer_community`), prüft die App an der Route, nicht die Datenbank (wie `moderate_community`).
--
-- Fehler wie in 0265: KC404 nicht gefunden, KC409 Übergang oder Revision (`community_conflict:` bei veralteter Revision), KC422 ungültige Angabe. Wiederholung derselben Kennung ist
-- kein Fehler, sondern nichts (`_schon`). Die Rechte stehen in `apps/server/src/db/community-grants.psql`.

-- --- Hilfen (nur intern; kein EXECUTE für irgendeine Rolle) ---------------------------------------------------------------------------

-- Eine Anfrage beenden: „Ins Archiv“. Ist sie offen, wird sie abgeschlossen (`p_ergebnis`, sonst `beantwortet`, wenn eine Nachricht nach außen ausging, sonst `erledigt`) und kommt ins
-- Archiv; ist sie abgeschlossen, kommt sie nur ins Archiv (liegt sie dort schon, bleibt alles, wie es ist). Der Vorgang ist vom Aufrufer gesperrt und geprüft; `p_text` steht am Ereignis, das
-- sie abschließt (oder, bei einer schon abgeschlossenen, am Archivieren). Gibt die neue Revision zurück; `p_operation` trägt das letzte Ereignis,
-- daran erkennt `_schon` die Wiederholung.
CREATE OR REPLACE FUNCTION avesmaps_community._anfrage_beenden(
    p_id BIGINT, p_person UUID, p_ergebnis TEXT, p_text TEXT, p_operation UUID
) RETURNS INTEGER
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
    v_ergebnis TEXT;
BEGIN
    SELECT * INTO v FROM avesmaps_community.vorgang WHERE id = p_id;
    IF v.zustand <> 'abgeschlossen' THEN
        v_ergebnis := COALESCE(
            p_ergebnis,
            CASE WHEN EXISTS (SELECT 1 FROM avesmaps_community.nachricht WHERE vorgang_id = p_id AND richtung = 'aus')
                 THEN 'beantwortet' ELSE 'erledigt' END
        );
        UPDATE avesmaps_community.vorgang
           SET zustand = 'abgeschlossen', ergebnis = v_ergebnis, abgeschlossen_at = now(), rueckfrage_at = NULL, archiviert_at = now()
         WHERE id = p_id;
        PERFORM avesmaps_community._ereignis(p_id, 'abgeschlossen', p_person, false, v.zustand, v_ergebnis, p_text, NULL);
        RETURN avesmaps_community._ereignis(p_id, 'archiviert', p_person, false, NULL, NULL, NULL, p_operation);
    END IF;
    -- Schon abgeschlossen: nur ins Archiv, und nur, wenn es nicht schon dort liegt; `p_text` steht dann am Ereignis des Archivierens.
    IF v.archiviert_at IS NOT NULL THEN
        RETURN v.revision;
    END IF;
    UPDATE avesmaps_community.vorgang SET archiviert_at = now() WHERE id = p_id;
    RETURN avesmaps_community._ereignis(p_id, 'archiviert', p_person, false, NULL, NULL, p_text, p_operation);
END;
$$;

-- Eine Anfrage, sonst KC409: Diese Wege gelten nur für Anfragen (Meldungen schließen mit Begründung ab, 0265).
CREATE OR REPLACE FUNCTION avesmaps_community._nur_anfrage(p_art TEXT) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF p_art <> 'anfrage' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: das gilt nur für Anfragen');
    END IF;
END;
$$;

-- --- Öffentlich (die App hat Grenze, Honigtopf und Zeitfalle geprüft; der Absender ist niemand Angemeldetes) ------------------------------

-- Das Kontaktformular der Hinweise (Bedienkonzept §3.1). Name und Adresse sind freiwillig; ohne Adresse gibt es die Antwort nur auf der Statusseite. Priorität hoch bei `rechte` und
-- `datenschutz` (Fachkonzept §3.2). Textgrenzen wie `community_melden`.
CREATE OR REPLACE FUNCTION avesmaps_community.community_anfragen(
    p_operation UUID, p_kategorie TEXT, p_text TEXT, p_name TEXT, p_mail TEXT, p_schluessel_hash BYTEA
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_name TEXT := NULLIF(btrim(p_name), '');
    v_mail TEXT := NULLIF(btrim(p_mail), '');
BEGIN
    SELECT id INTO v_id FROM avesmaps_community.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF char_length(btrim(COALESCE(p_text, ''))) NOT BETWEEN 10 AND 2000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Nachricht braucht 10 bis 2000 Zeichen');
    END IF;
    IF p_schluessel_hash IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Schlüssel ist Pflicht');
    END IF;
    IF p_kategorie IS NULL OR p_kategorie NOT IN ('frage', 'hinweis', 'mitmachen', 'rechte', 'datenschutz', 'sonstiges') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: unbekannte Kategorie');
    END IF;
    IF v_name IS NOT NULL AND char_length(v_name) > 80 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Name darf höchstens 80 Zeichen lang sein');
    END IF;
    IF v_mail IS NOT NULL AND (char_length(v_mail) NOT BETWEEN 3 AND 254 OR v_mail !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Adresse stimmt nicht');
    END IF;
    INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, prioritaet, operation_id)
    VALUES ('anfrage', p_kategorie, 'kontakt', CASE WHEN p_kategorie IN ('rechte', 'datenschutz') THEN 'hoch' ELSE 'normal' END, p_operation)
    RETURNING id INTO v_id;
    INSERT INTO avesmaps_community.melder (vorgang_id, name, mail, schluessel_hash)
    VALUES (v_id, v_name, v_mail, p_schluessel_hash);
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, operation_id)
    VALUES (v_id, 'ein', 'formular', btrim(p_text), gen_random_uuid());
    PERFORM avesmaps_community._ereignis(v_id, 'eingang', NULL, true, NULL, 'neu', NULL, NULL);
    RETURN v_id;
END;
$$;

-- --- Redaktion (die App hat die Person angemeldet und ihr Recht geprüft) ----------------------------------------------------------------

-- Antworten (Bedienkonzept §3.3): eine Nachricht nach außen, vor dem Mailweg auf die Statusseite; Zustand „wartet auf Antwort“ (`rueckfrage`). Mit `p_archivieren` geht die Anfrage gleich ins
-- Archiv, Ergebnis `beantwortet`. Nur eine offene Anfrage, nicht im Papierkorb. `answer_community` prüft die Route.
CREATE OR REPLACE FUNCTION avesmaps_community.community_anfrage_antworten(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_text TEXT, p_archivieren BOOLEAN
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    PERFORM avesmaps_community._nur_anfrage(v.art);
    IF v.papierkorb_at IS NOT NULL OR v.zustand = 'abgeschlossen' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: zum Antworten erst zurück in den Eingang holen');
    END IF;
    IF char_length(btrim(COALESCE(p_text, ''))) NOT BETWEEN 1 AND 4000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Antwort braucht 1 bis 4000 Zeichen');
    END IF;
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, von_person, operation_id)
    VALUES (p_id, 'aus', 'statusseite', btrim(p_text), p_person, gen_random_uuid());
    IF COALESCE(p_archivieren, false) THEN
        RETURN avesmaps_community._anfrage_beenden(p_id, p_person, 'beantwortet', NULL, p_operation);
    END IF;
    -- Wer antwortet, ist dran: Ohne Zuständigkeit übernimmt die antwortende Person (sichtbar im Verlauf). Die Erinnerung nach 30 Tagen ohne Antwort (Glocke, Jobs-Rolle) geht dann an sie
    -- und nicht an alle, die Meldungen bearbeiten, denn die dürfen Anfragen nicht lesen.
    IF v.zustaendig IS NULL THEN
        UPDATE avesmaps_community.vorgang SET zustaendig = p_person WHERE id = p_id;
        PERFORM avesmaps_community._ereignis(p_id, 'uebernommen', p_person, false, NULL, p_person::text, NULL, NULL);
    END IF;
    UPDATE avesmaps_community.vorgang SET zustand = 'rueckfrage', rueckfrage_at = now() WHERE id = p_id;
    RETURN avesmaps_community._ereignis(p_id, 'rueckfrage', p_person, false, v.zustand, 'rueckfrage', NULL, p_operation);
END;
$$;

-- Ins Archiv (Bedienkonzept §3.4): ein Klick ohne Begründung. Ergebnis `beantwortet`, wenn eine Nachricht nach außen ausging, sonst `erledigt`.
CREATE OR REPLACE FUNCTION avesmaps_community.community_anfrage_archivieren(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    PERFORM avesmaps_community._nur_anfrage(v.art);
    IF v.papierkorb_at IS NOT NULL OR v.archiviert_at IS NOT NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: die Anfrage liegt schon im Archiv oder im Papierkorb');
    END IF;
    RETURN avesmaps_community._anfrage_beenden(p_id, p_person, NULL, NULL, p_operation);
END;
$$;

-- Zurück in den Eingang (Bedienkonzept §3.4): ohne Grund, Zustand in Arbeit. Das Ergebnis bleibt im Verlauf stehen (`alt`).
CREATE OR REPLACE FUNCTION avesmaps_community.community_anfrage_zurueckholen(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    PERFORM avesmaps_community._nur_anfrage(v.art);
    IF v.zustand <> 'abgeschlossen' OR v.papierkorb_at IS NOT NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur eine abgeschlossene Anfrage wird in den Eingang zurückgeholt');
    END IF;
    PERFORM avesmaps_community._oeffnen(p_id);
    RETURN avesmaps_community._ereignis(p_id, 'wiedereroeffnet', p_person, false, v.ergebnis, 'in_arbeit', NULL, p_operation);
END;
$$;

-- Als Meldung weiterführen (Fachkonzept §3.1): legt aus der Anfrage eine Meldung mit Bezug an, Eingang `redaktion`, `angelegt_von`, OHNE Melder-Zeile (Name und Adresse bleiben allein an
-- der Anfrage), verknüpft beide (`gehoert_zu`, von der Meldung zur Anfrage) und beendet die Anfrage: mit `p_antwort` beantwortet (die Antwort geht auf die Statusseite; `answer_community`
-- prüft die Route), sonst erledigt. Die Anfrage kann offen oder abgeschlossen sein, nicht im Papierkorb. Gibt die Kennung der neuen Meldung zurück; die Kennung der Operation ist die der Meldung,
-- eine Wiederholung findet sie und legt nichts zweites an.
CREATE OR REPLACE FUNCTION avesmaps_community.community_als_meldung(
    p_operation UUID, p_anfrage BIGINT, p_person UUID, p_revision INTEGER, p_kategorie TEXT, p_text TEXT, p_quelle TEXT,
    p_fehlt_art TEXT, p_bezug JSONB, p_antwort TEXT
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
    v_neu BIGINT;
    v_art TEXT := p_bezug->>'art';
    v_antwort TEXT := NULLIF(btrim(p_antwort), '');
BEGIN
    SELECT id INTO v_neu FROM avesmaps_community.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_neu;
    END IF;
    v := avesmaps_community._pruefe(p_anfrage, p_revision);
    PERFORM avesmaps_community._nur_anfrage(v.art);
    IF v.papierkorb_at IS NOT NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: eine Anfrage im Papierkorb wird nicht weitergeführt');
    END IF;
    IF char_length(btrim(COALESCE(p_text, ''))) NOT BETWEEN 10 AND 2000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Beschreibung braucht 10 bis 2000 Zeichen');
    END IF;
    IF p_kategorie IS NULL OR p_kategorie NOT IN ('lage', 'name', 'angabe', 'fehlt', 'entfaellt', 'sonstiges') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: unbekannte Kategorie');
    END IF;
    IF v_art IS NULL OR v_art NOT IN ('objekt', 'stelle') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Bezug ist Pflicht');
    END IF;
    IF v_antwort IS NOT NULL AND char_length(v_antwort) > 4000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Antwort darf höchstens 4000 Zeichen lang sein');
    END IF;
    INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, quelle, fehlt_art, angelegt_von, operation_id)
    VALUES ('meldung', p_kategorie, 'redaktion', NULLIF(btrim(p_quelle), ''), CASE WHEN p_kategorie = 'fehlt' THEN p_fehlt_art END, p_person, p_operation)
    RETURNING id INTO v_neu;
    INSERT INTO avesmaps_community.bezug (
        vorgang_id, art, objekt_art, objekt_id, name, typ, lage_x, lage_y, vorschlag_x, vorschlag_y, naechster_ort
    ) VALUES (
        v_neu, v_art,
        CASE WHEN v_art = 'objekt' THEN p_bezug->>'objektArt' END,
        CASE WHEN v_art = 'objekt' THEN (p_bezug->>'objektId')::uuid END,
        CASE WHEN v_art = 'objekt' THEN NULLIF(btrim(p_bezug->>'name'), '') END,
        NULLIF(btrim(p_bezug->>'typ'), ''),
        (p_bezug->'lage'->>'x')::double precision, (p_bezug->'lage'->>'y')::double precision,
        (p_bezug->'vorschlagLage'->>'x')::double precision, (p_bezug->'vorschlagLage'->>'y')::double precision,
        NULLIF(btrim(p_bezug->>'naechsterOrt'), '')
    );
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, operation_id)
    VALUES (v_neu, 'ein', 'redaktion', btrim(p_text), gen_random_uuid());
    PERFORM avesmaps_community._ereignis(v_neu, 'eingang', p_person, false, NULL, 'neu', NULL, NULL);
    INSERT INTO avesmaps_community.verknuepfung (vorgang_id, art, ziel_vorgang, von_person)
    VALUES (v_neu, 'gehoert_zu', p_anfrage, p_person);
    IF v_antwort IS NOT NULL THEN
        INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, von_person, operation_id)
        VALUES (p_anfrage, 'aus', 'statusseite', v_antwort, p_person, gen_random_uuid());
    END IF;
    PERFORM avesmaps_community._anfrage_beenden(
        p_anfrage, p_person, CASE WHEN v_antwort IS NOT NULL THEN 'beantwortet' END,
        format('als Meldung weitergeführt: %s', avesmaps_community._com(v_neu)), NULL
    );
    RETURN v_neu;
END;
$$;

-- Keine Funktion des Schemas darf zunächst jeder aufrufen; wer was darf, steht in `community-grants.psql`.
DO $$
DECLARE
    f RECORD;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'avesmaps_community'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    END LOOP;
END;
$$;
