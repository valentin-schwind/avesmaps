-- 0336: Was aus dem Betreiber-Kanal weitergeleitet wird, ist eine Meldung, keine Anfrage (WI-0297; Vali am 2026-11-10 zu „An Community weiterleiten“, der
-- Vorgang landete im Mail-Eingang; gewählte Option: bei den Meldungen, dort wo die Meldungen von der Website stehen, mit Objekt und Stelle, wenn bekannt;
-- die Antwort an den Discord-Melder bleibt).
--
-- 1. `community_aus_discord_meldung`: wie `community_aus_discord` (0332), aber Art `meldung`, Kategorie `sonstiges` und, wenn die App einen kennt, ein Bezug
--    (Objekt oder Stelle) in derselben Form wie `community_melden` (0311). Ohne Bezug gibt es keine Zeile in `bezug`.
-- 2. `community_rueckfrage`: Eine Rückfrage geht auch an einen Melder, der nur über Discord erreichbar ist (er liest sie mit `/offen`, Migration 0333); dann mit
--    dem Weg `discord`. Sonst wie 0265.
--
-- 🔴 ERWEITERND: eine neue Funktion; `community_rueckfrage` mit derselben Signatur neu geschrieben (sie lässt nur einen Fall mehr zu). `community_aus_discord` bleibt
-- für das vorige Release. Was dort schon als Anfrage liegt, bleibt, wie es ist (Production-Daten, Verschieben nur auf Valis Wort). EXECUTE vergibt
-- `community-grants.psql` an die App-Rolle.

CREATE OR REPLACE FUNCTION avesmaps_community.community_aus_discord_meldung(
    p_operation UUID, p_text TEXT, p_name TEXT, p_discord_id TEXT, p_ops TEXT, p_bilder JSONB, p_bezug JSONB
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_nachricht BIGINT;
    v_name TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
    v_bilder JSONB := COALESCE(p_bilder, '[]'::jsonb);
    v_art TEXT := p_bezug ->> 'art';
    b JSONB;
BEGIN
    SELECT id INTO v_id FROM avesmaps_community.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF char_length(btrim(COALESCE(p_text, ''))) NOT BETWEEN 1 AND 4000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Nachricht braucht 1 bis 4000 Zeichen');
    END IF;
    IF v_name IS NOT NULL AND char_length(v_name) > 80 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Name darf höchstens 80 Zeichen lang sein');
    END IF;
    IF p_discord_id IS NOT NULL AND p_discord_id !~ '^[0-9]{17,20}$' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Discord-Kennung hat die falsche Form');
    END IF;
    IF p_ops IS NULL OR p_ops !~ '^OPS-[0-9]{6,12}$' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Herkunft ist eine OPS-Nummer');
    END IF;
    IF jsonb_typeof(v_bilder) <> 'array' OR jsonb_array_length(v_bilder) > 10 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: höchstens zehn Bilder');
    END IF;
    IF p_bezug IS NOT NULL AND (v_art IS NULL OR v_art NOT IN ('objekt', 'stelle')) THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: ein Bezug ist ein Objekt oder eine Stelle');
    END IF;
    INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, prioritaet, operation_id)
    VALUES ('meldung', 'sonstiges', 'discord', 'normal', p_operation)
    RETURNING id INTO v_id;
    -- Mit Kennung ist der Name der von Discord (wie „Mit Discord verbinden“); ohne Kennung bleibt er der Name des Melders.
    INSERT INTO avesmaps_community.melder (vorgang_id, name, discord_id, discord_name)
    VALUES (v_id, CASE WHEN p_discord_id IS NULL THEN v_name END, p_discord_id, CASE WHEN p_discord_id IS NOT NULL THEN v_name END);
    IF p_bezug IS NOT NULL THEN
        INSERT INTO avesmaps_community.bezug (vorgang_id, art, objekt_art, objekt_id, name, typ, lage_x, lage_y, naechster_ort)
        VALUES (
            v_id, v_art,
            CASE WHEN v_art = 'objekt' THEN p_bezug ->> 'objektArt' END,
            CASE WHEN v_art = 'objekt' THEN (p_bezug ->> 'objektId')::uuid END,
            CASE WHEN v_art = 'objekt' THEN NULLIF(btrim(p_bezug ->> 'name'), '') END,
            NULLIF(btrim(p_bezug ->> 'typ'), ''),
            (p_bezug -> 'lage' ->> 'x')::double precision, (p_bezug -> 'lage' ->> 'y')::double precision,
            NULLIF(btrim(p_bezug ->> 'naechsterOrt'), '')
        );
    END IF;
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, operation_id)
    VALUES (v_id, 'ein', 'discord', btrim(p_text), gen_random_uuid())
    RETURNING id INTO v_nachricht;
    FOR b IN SELECT value FROM jsonb_array_elements(v_bilder) LOOP
        INSERT INTO avesmaps_community.mail_anhang (nachricht_id, dateiname, mime, groesse, datei)
        VALUES (v_nachricht, b ->> 'name', b ->> 'mime', (b ->> 'groesse')::bigint, b ->> 'datei');
    END LOOP;
    INSERT INTO avesmaps_community.verknuepfung (vorgang_id, art, ziel) VALUES (v_id, 'herkunft', p_ops);
    PERFORM avesmaps_community._ereignis(v_id, 'eingang', NULL, true, NULL, 'neu', p_ops, NULL);
    RETURN v_id;
END;
$$;

-- Rückfrage wie 0265; neu: Ein Melder nur mit Discord-Kennung ist erreichbar (`/offen`), die Nachricht trägt dann den Weg `discord`.
CREATE OR REPLACE FUNCTION avesmaps_community.community_rueckfrage(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_text TEXT
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
    v_weg TEXT;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    IF v.zustand = 'abgeschlossen' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: ein abgeschlossener Vorgang wird erst wieder geöffnet');
    END IF;
    SELECT CASE WHEN m.schluessel_hash IS NOT NULL OR m.mail IS NOT NULL THEN 'statusseite' WHEN m.discord_id IS NOT NULL THEN 'discord' END
      INTO v_weg
      FROM avesmaps_community.melder m WHERE m.vorgang_id = p_id;
    IF v_weg IS NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: kein Rückweg zum Melder');
    END IF;
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, von_person, operation_id)
    VALUES (p_id, 'aus', v_weg, btrim(p_text), p_person, p_operation);
    UPDATE avesmaps_community.vorgang SET zustand = 'rueckfrage', rueckfrage_at = now() WHERE id = p_id;
    RETURN avesmaps_community._ereignis(p_id, 'rueckfrage', p_person, false, v.zustand, 'rueckfrage', NULL, NULL);
END;
$$;

REVOKE ALL ON FUNCTION avesmaps_community.community_aus_discord_meldung(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;
