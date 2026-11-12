-- 0277: einmalige Übernahme der offenen Legacy-Meldungen in die Community-Vorgänge (WI-0268 C9; Entscheidung E6, Vali 2026-10-31: „offene Meldungen
-- übernehmen, ohne IP und Browserdaten, Mails nicht“). Vertrag: project-control/migration/contracts/community-meldungen.yaml.
--
-- - `legacy_meldung` merkt, welche Meldung aus Legacy (`map_reports.id`) welcher Vorgang geworden ist. Eine Meldung entsteht höchstens einmal; ein zweiter Lauf
--   (oder derselbe Lauf nach einem Abbruch) gibt den vorhandenen Vorgang zurück und legt nichts an.
-- - `community_legacy_uebernehmen` legt EINE Meldung an: Vorgang (Art `meldung`, Eingang `website`, die Zeit der alten Meldung als Eingang), Melder nur mit Namen
--   (ohne Mail und ohne Schlüssel der Statusseite: Die Melder aus Legacy haben nie einen Rückweg bekommen), Bezug wie `community_melden`, Nachricht, Ereignis `eingang`
--   und die interne Notiz, woher sie kommt. Keine IP, kein Browser, keine Seitenadresse: Die gibt der Export nie her, die Tafel hätte auch keine Spalte dafür.
--   Die Prüfungen sind die von `community_melden` (Beschreibung 10 bis 2000 Zeichen, Bezug Pflicht), dazu die Längen der Felder, damit ein Fehler eine Meldung ist und
--   keine Verletzung einer Einschränkung.
-- - Wiederholbar: Dieselbe Legacy-Nummer zweimal im selben Augenblick (zwei Läufe) trifft sich an einer Sperre auf der Nummer; der zweite sieht den ersten.
--
-- 🔴 REIN ADDITIV: eine neue Tafel und eine neue Funktion, keine Änderung an vorhandenen. Die Rechte stehen in `apps/server/src/db/community-grants.psql`; ohne sie
-- kann niemand die Funktion rufen (das Werkzeug läuft als Migrationsrolle oder mit der App-Rolle, sobald Claudio die Rechte nachgezogen hat).

CREATE TABLE IF NOT EXISTS avesmaps_community.legacy_meldung (
    legacy_id INTEGER PRIMARY KEY,
    vorgang_id BIGINT NOT NULL UNIQUE REFERENCES avesmaps_community.vorgang (id) ON DELETE CASCADE,
    uebernommen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT legacy_meldung_id CHECK (legacy_id > 0)
);
COMMENT ON TABLE avesmaps_community.legacy_meldung IS 'Welche offene Meldung aus Legacy (map_reports.id) welcher Vorgang geworden ist (WI-0268 C9); nur Nummern, nie ein Name oder Text.';

CREATE OR REPLACE FUNCTION avesmaps_community.community_legacy_uebernehmen(
    p_legacy_id INTEGER, p_kategorie TEXT, p_text TEXT, p_quelle TEXT, p_fehlt_art TEXT, p_melder_name TEXT, p_bezug JSONB,
    p_eingegangen_at TIMESTAMPTZ, p_notiz TEXT
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_art TEXT := p_bezug->>'art';
    v_name TEXT := NULLIF(btrim(p_melder_name), '');
    v_quelle TEXT := NULLIF(btrim(p_quelle), '');
    v_notiz TEXT := NULLIF(btrim(p_notiz), '');
BEGIN
    IF p_legacy_id IS NULL OR p_legacy_id <= 0 OR p_eingegangen_at IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: Legacy-Nummer und Eingangszeit sind Pflicht');
    END IF;
    -- Zwei Läufe zugleich: Wer zuerst die Sperre hat, legt an; der zweite sieht danach die Zeile.
    PERFORM pg_advisory_xact_lock(268, p_legacy_id);
    SELECT vorgang_id INTO v_id FROM avesmaps_community.legacy_meldung WHERE legacy_id = p_legacy_id;
    IF FOUND THEN
        RETURN v_id;
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
    IF v_quelle IS NOT NULL AND char_length(v_quelle) > 1000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Quelle darf höchstens 1000 Zeichen lang sein');
    END IF;
    IF v_name IS NOT NULL AND char_length(v_name) > 80 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Name darf höchstens 80 Zeichen lang sein');
    END IF;
    IF v_notiz IS NOT NULL AND char_length(v_notiz) > 4000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Notiz darf höchstens 4000 Zeichen lang sein');
    END IF;
    INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, quelle, fehlt_art, eingegangen_at, aktiv_at, operation_id)
    VALUES (
        'meldung', p_kategorie, 'website', v_quelle, CASE WHEN p_kategorie = 'fehlt' THEN p_fehlt_art END,
        p_eingegangen_at, p_eingegangen_at, gen_random_uuid()
    )
    RETURNING id INTO v_id;
    -- Ohne Namen kein Melder: Der Vorgang hat keinen Rückweg und keinen Personenbezug, die Redaktion liest „anonym“.
    IF v_name IS NOT NULL THEN
        INSERT INTO avesmaps_community.melder (vorgang_id, name) VALUES (v_id, v_name);
    END IF;
    INSERT INTO avesmaps_community.bezug (
        vorgang_id, art, objekt_art, objekt_id, name, typ, lage_x, lage_y, vorschlag_x, vorschlag_y, naechster_ort
    ) VALUES (
        v_id, v_art,
        CASE WHEN v_art = 'objekt' THEN p_bezug->>'objektArt' END,
        CASE WHEN v_art = 'objekt' THEN (p_bezug->>'objektId')::uuid END,
        CASE WHEN v_art = 'objekt' THEN NULLIF(btrim(p_bezug->>'name'), '') END,
        NULLIF(btrim(p_bezug->>'typ'), ''),
        (p_bezug->'lage'->>'x')::double precision, (p_bezug->'lage'->>'y')::double precision,
        (p_bezug->'vorschlagLage'->>'x')::double precision, (p_bezug->'vorschlagLage'->>'y')::double precision,
        NULLIF(btrim(p_bezug->>'naechsterOrt'), '')
    );
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, at, operation_id)
    VALUES (v_id, 'ein', 'formular', btrim(p_text), p_eingegangen_at, gen_random_uuid());
    -- Das Ereignis „eingang“ trägt die alte Zeit (nicht die Stunde der Übernahme) und zählt die Revision wie `_ereignis` (die Übernahme selbst steht in der Notiz).
    INSERT INTO avesmaps_community.ereignis (vorgang_id, seq, art, vom_melder, neu, text, at)
    VALUES (v_id, 1, 'eingang', true, 'neu', format('Aus Legacy übernommen (Meldung %s)', p_legacy_id), p_eingegangen_at);
    UPDATE avesmaps_community.vorgang SET revision = revision + 1 WHERE id = v_id;
    -- Die interne Notiz: woher, wann, was Legacy dazu hatte. Ohne Verfasser (das Werkzeug ist keine Person).
    IF v_notiz IS NOT NULL THEN
        INSERT INTO avesmaps_community.notiz (vorgang_id, text, von_person, operation_id)
        VALUES (v_id, v_notiz, NULL, gen_random_uuid());
    END IF;
    INSERT INTO avesmaps_community.legacy_meldung (legacy_id, vorgang_id) VALUES (p_legacy_id, v_id);
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION avesmaps_community.community_legacy_uebernehmen(INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TEXT) FROM PUBLIC;
