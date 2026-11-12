-- 0273: Verknüpfungen eines Community-Vorgangs von Hand (WI-0268 C7; Fachkonzept WI-0263 §6 und §7, Umsetzungsplan C7):
-- - „Korrektur verknüpfen“: eine Kartenoperation aus „Änderungen“ (Kennung `map_operation.operation_id`) gehört zu diesem Vorgang. Die Herkunft beim Öffnen aus dem
--   Vorgang schreibt der Editor selbst (Migration 0272, `map_operation.community_vorgang`); diese Verknüpfung ist der Weg für eine Korrektur, die anders entstand.
-- - „An den Betreiber-Kanal weiterreichen“: die Nummer des Kanal-Vorgangs (OPS-…) als Verweis. Zwei Umgebungen, keine Datenbankverbindung: nur die Nummer.
--
-- Beide Arten stehen seit 0265 in `verknuepfung_art`; neu ist nur die Funktion. Eine Verknüpfung ändert weder Zustand noch Revision (wie eine Notiz): Sie stört
-- niemanden, der gerade etwas anderes am Vorgang tut. Dieselbe Verknüpfung zweimal ergibt eine Zeile.
--
-- 🔴 REIN ADDITIV: eine neue Funktion. Die Rechte (EXECUTE an die App-Rolle) stehen in `apps/server/src/db/community-grants.psql`.

CREATE OR REPLACE FUNCTION avesmaps_community.community_verknuepfen(p_id BIGINT, p_person UUID, p_art TEXT, p_ziel TEXT)
    RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_ziel TEXT := btrim(COALESCE(p_ziel, ''));
BEGIN
    PERFORM avesmaps_community._sperre(p_id);
    IF p_art = 'korrektur' THEN
        IF v_ziel !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            PERFORM avesmaps_community._fehler('KC422', 'community_invalid: eine Korrektur nennt die Kennung einer Operation');
        END IF;
        v_ziel := lower(v_ziel);
        IF NOT EXISTS (SELECT 1 FROM public.map_operation WHERE operation_id = v_ziel::uuid) THEN
            PERFORM avesmaps_community._fehler('KC404', 'community_not_found: diese Operation gibt es nicht');
        END IF;
    ELSIF p_art = 'ops' THEN
        IF v_ziel !~ '^OPS-[0-9]{6,12}$' THEN
            PERFORM avesmaps_community._fehler('KC422', 'community_invalid: ein Kanal-Vorgang heißt OPS- mit sechs Ziffern');
        END IF;
    ELSE
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: von Hand verknüpft man nur Korrektur und Kanal');
    END IF;
    SELECT id INTO v_id FROM avesmaps_community.verknuepfung WHERE vorgang_id = p_id AND art = p_art AND ziel = v_ziel;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    INSERT INTO avesmaps_community.verknuepfung (vorgang_id, art, ziel, von_person)
    VALUES (p_id, p_art, v_ziel, p_person)
    RETURNING id INTO v_id;
    UPDATE avesmaps_community.vorgang SET aktiv_at = now() WHERE id = p_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION avesmaps_community.community_verknuepfen(BIGINT, UUID, TEXT, TEXT) FROM PUBLIC;
