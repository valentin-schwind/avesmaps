-- 0311: Eine Meldung kennt das Reisebild, aus dem sie kam (WI-0272; Vali 2026-11-04: „das bild oder den link ins MAM“). „Melden“ in der Bildansicht trug bisher nur Stelle und Ort; die Redaktion musste
-- raten, welches Bild gemeint ist.
--
-- Erweitern nach `docs/regeln/entwicklung.md`: eine neue Spalte, die das vorige Release nicht kennt, und `community_melden` mit derselben Unterschrift. Das vorige Release schickt kein `reisebildId` und bekommt NULL;
-- das neue gegen die alte Funktion verlöre nur das Bild, nie die Meldung. `reisebild_id` ist die Kennung des Mediums (`ReisebildKarte.id`), weich wie `objekt_id` und `bewertung_id`: ohne Fremdschlüssel, denn `media_asset`
-- wandert mit dem Abzug und das Community-Schema nicht. Die Kennung kommt vom Melder; gelesen wird sie nur über `reisebildVorschauen`, das allein Medien der PhotoBox kennt.
--
-- map_mutation = false: Keine Kartendaten.

ALTER TABLE avesmaps_community.bezug ADD COLUMN IF NOT EXISTS reisebild_id UUID;

CREATE OR REPLACE FUNCTION avesmaps_community.community_melden(
    p_operation UUID, p_kategorie TEXT, p_text TEXT, p_quelle TEXT, p_fehlt_art TEXT, p_name TEXT, p_schluessel_hash BYTEA, p_bezug JSONB
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_art TEXT := p_bezug->>'art';
BEGIN
    SELECT id INTO v_id FROM avesmaps_community.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF char_length(btrim(COALESCE(p_text, ''))) NOT BETWEEN 10 AND 2000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Beschreibung braucht 10 bis 2000 Zeichen');
    END IF;
    IF p_schluessel_hash IS NULL OR v_art IS NULL OR v_art NOT IN ('objekt', 'stelle') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: Schlüssel und Bezug sind Pflicht');
    END IF;
    INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, quelle, fehlt_art, operation_id)
    VALUES ('meldung', p_kategorie, 'website', NULLIF(btrim(p_quelle), ''), p_fehlt_art, p_operation)
    RETURNING id INTO v_id;
    INSERT INTO avesmaps_community.melder (vorgang_id, name, schluessel_hash)
    VALUES (v_id, NULLIF(btrim(p_name), ''), p_schluessel_hash);
    INSERT INTO avesmaps_community.bezug (
        vorgang_id, art, objekt_art, objekt_id, name, typ, lage_x, lage_y, vorschlag_x, vorschlag_y, naechster_ort, reisebild_id
    ) VALUES (
        v_id, v_art,
        CASE WHEN v_art = 'objekt' THEN p_bezug->>'objektArt' END,
        CASE WHEN v_art = 'objekt' THEN (p_bezug->>'objektId')::uuid END,
        CASE WHEN v_art = 'objekt' THEN NULLIF(btrim(p_bezug->>'name'), '') END,
        NULLIF(btrim(p_bezug->>'typ'), ''),
        (p_bezug->'lage'->>'x')::double precision, (p_bezug->'lage'->>'y')::double precision,
        (p_bezug->'vorschlagLage'->>'x')::double precision, (p_bezug->'vorschlagLage'->>'y')::double precision,
        NULLIF(btrim(p_bezug->>'naechsterOrt'), ''),
        (p_bezug->>'reisebildId')::uuid
    );
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, operation_id)
    VALUES (v_id, 'ein', 'formular', btrim(p_text), gen_random_uuid());
    PERFORM avesmaps_community._ereignis(v_id, 'eingang', NULL, true, NULL, 'neu', NULL, NULL);
    RETURN v_id;
END;
$$;
