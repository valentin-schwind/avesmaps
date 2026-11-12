-- Der Editor legt für einen Kartenpunkt seine Stätte an (WI-0196, EDIT-0003 T33 (3) „Innerorts hinzufügen“).
--
-- Die Innerorts-Beziehung (`site_settlement`, 0099) braucht eine `site`. Für ein Gebäude oder Stadtviertel der Karte ohne Innerorts-Bezug
-- gibt es keine: Eine Stätte vom Typ `punkt` legt der Import nur für Punkte an, die in Legacy schon innerorts sind. Der Betreiber hat am
-- 2026-10-16 entschieden, dass auch diese Kartenpunkte angeboten werden.
--
-- 🔴 KEIN Schreibrecht der App-Rolle auf `site` (`map-grants.psql`: „Die Staette selbst und ihre Evidenz schreibt allein der Import“).
-- Stattdessen diese eine Funktion, als Besitzerin mit festem `search_path` und schema-qualifizierten Namen, ohne dynamisches SQL
-- (`render-grants.test.ts`; Claudio 2026-10-16, Handover `2026-10-16-innerorts-staette-anlegen-antwort-an-claudia.md`, fünf
-- Bedingungen): Sie nimmt NUR einen aktiven, nicht verborgenen Ort der Ortsgröße `gebaeude` oder `stadtviertel`, liest ihn `FOR SHARE`
-- (er kann zwischen Prüfung und Anlegen nicht verborgen werden) und legt genau die Zeile an, die der Import für einen solchen Punkt
-- anlegen würde. `source_system 'avesmaps3d'` hält den Legacy-Zug fern (`protectedWhere`, `staetten-rohquellen-import.ts`; er übergeht
-- die Zeile und meldet sie, Test T15). Gibt es die Stätte schon, gibt sie deren `id` zurück und schreibt nichts. Ein ungültiger Ort endet
-- mit eigenem SQLSTATE (`no_data_found`, `invalid_parameter_value`), die Route sagt dann 404 bzw. 400, nie 500. EXECUTE bekommt allein die
-- App-Rolle (`map-grants.psql`); eine Besitzzeile steht dort NICHT (der Rechte-Filter lehnt sie ab), die Besitzerin ergibt sich aus der
-- Migration.
--
-- Rein additiv: eine neue Funktion, keine Tabelle, keine Spalte.
CREATE OR REPLACE FUNCTION public.site_punkt_fuer_ort(p_place UUID) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
DECLARE
    v_name TEXT;
    v_subtype TEXT;
    v_kind TEXT;
    v_hidden BOOLEAN;
    v_id BIGINT;
BEGIN
    SELECT name, subtype, place_kind, is_hidden
      INTO v_name, v_subtype, v_kind, v_hidden
      FROM public.place
     WHERE public_id = p_place AND is_active
       FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'site_punkt_fuer_ort: kein aktiver Ort %', p_place USING ERRCODE = 'no_data_found';
    END IF;
    IF v_subtype NOT IN ('gebaeude', 'stadtviertel') THEN
        RAISE EXCEPTION 'site_punkt_fuer_ort: % ist kein Gebaeude und kein Stadtviertel', p_place
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF v_hidden THEN
        RAISE EXCEPTION 'site_punkt_fuer_ort: % ist verborgen', p_place USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO public.site (source_kind, source_key, name, site_class, site_type, on_map, source_system)
    VALUES ('punkt', p_place::text, v_name, v_subtype, NULLIF(btrim(v_kind), ''), TRUE, 'avesmaps3d')
    ON CONFLICT (source_kind, source_key) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.site WHERE source_kind = 'punkt' AND source_key = p_place::text;
    END IF;
    RETURN v_id;
END;
$$;
COMMENT ON FUNCTION public.site_punkt_fuer_ort(UUID) IS
    'WI-0196: die Stätte eines Kartenpunkts (Gebäude, Stadtviertel) für „Innerorts hinzufügen“; legt sie an, wo es keine gibt.';

REVOKE ALL ON FUNCTION public.site_punkt_fuer_ort(UUID) FROM PUBLIC;
