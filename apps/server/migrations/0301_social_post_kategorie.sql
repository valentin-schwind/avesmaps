-- 0301: Die Kategorie „Social Media Posts“ der Medienverwaltung (WI-0278, Betreiber 2026-11-03).
--
-- Im Social Hub lässt sich ein Bild hochladen. Es landet in einem eigenen Asset-Typ `social_post` mit der gleichnamigen Rolle.
--
-- 1. Die CHECKs von Asset-Typ (0095) und Freigaberegel (0274) nehmen den neuen Wert dazu. Eine eigene Tafel der Verwendung gibt es nicht: Die Verwendung folgt aus dem Typ (`readUsages`, `activeUsagesSql`).
-- 2. `beitrag_vorlegen`: Ein Bild dieser Kategorie darf beim Vorlegen noch ohne bestätigte Rechte sein, die Beschreibung bleibt Pflicht. Die Rechte bestätigt, wer freigibt; Freigeben, Änderung veröffentlichen
--    und Erneut senden prüfen unverändert (`_beitrag_bild_pruefen`). Jedes andere Bild prüft auch das Vorlegen wie bisher.
--
-- Erst erweitern (AGENTS.md): zwei weitere CHECKs (Eintrag in `KNOWN_EXCEPTIONS`, migration-compat.test.ts) und eine Funktion gleicher Signatur. Das vorige Release schreibt den neuen Wert nie.

ALTER TABLE media_asset
    DROP CONSTRAINT IF EXISTS media_asset_type_known,
    ADD CONSTRAINT media_asset_type_known CHECK (
        asset_type IS NULL OR asset_type IN ('coat', 'picture', 'map', 'map_preview', 'cover', 'model_3d', 'social_post')
    );

ALTER TABLE publication_rule
    DROP CONSTRAINT IF EXISTS publication_rule_role_known,
    ADD CONSTRAINT publication_rule_role_known CHECK (
        role IN ('coat', 'header', 'map_full', 'map_preview', 'literature_cover', 'photobox', 'social_post')
    );

CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_vorlegen(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    IF v.papierkorb_at IS NOT NULL OR v.zustand <> 'entwurf' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur ein Entwurf wird zur Freigabe vorgelegt');
    END IF;
    IF btrim(v.text) = '' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Text fehlt');
    END IF;
    IF EXISTS (SELECT 1 FROM public.media_asset a WHERE a.public_id = v.bild_id AND a.asset_type = 'social_post') THEN
        IF btrim(COALESCE(v.bild_beschreibung, '')) = '' THEN
            PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Bildbeschreibung fehlt');
        END IF;
    ELSE
        PERFORM avesmaps_community._beitrag_bild_pruefen(v.bild_id, v.bild_beschreibung);
    END IF;
    UPDATE avesmaps_community.beitrag SET zustand = 'vorgelegt', vorgelegt_at = now() WHERE id = p_id;
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'vorgelegt', p_person, NULL, p_operation);
END;
$$;
