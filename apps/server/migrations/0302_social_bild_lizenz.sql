-- 0302: Das Bild eines Beitrags hängt an der Lizenz, nicht nur an der Klärung (WI-0278, Vali 2026-11-03: „bestehende bilder im MAM sollten ausgewählt werden können wenn die lizenz das zulässt“).
--
-- `_beitrag_bild_pruefen` verlangte `cleared` oder `legacy_asserted`. Das passte in beide Richtungen nicht: Ein KI-Bild auf `unreviewed` ist nach der KI-Regel öffentlich und blieb gesperrt, ein Cover unter der
-- Fan-Richtlinie auf `legacy_asserted` kam durch. Die Entscheidung trifft jetzt die Policy (`community/social/bild-urteil.ts`): die Route vor dem Vorlegen und Freigeben, der Auftrag vor dem Senden. In der Datenbank
-- bleibt die Beschreibung und, was auch die Policy nie zulässt: keine Rechteangabe, eine unbekannte Grundlage, abgelehnte Rechte.
--
-- Erst erweitern (AGENTS.md): eine Funktion gleicher Signatur, die weniger sperrt. Das vorige Release prüft in der Route strenger und merkt nichts davon.

CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_bild_pruefen(p_bild UUID, p_alt TEXT) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF p_bild IS NULL THEN
        RETURN;
    END IF;
    IF btrim(COALESCE(p_alt, '')) = '' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Bildbeschreibung fehlt');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.media_asset a JOIN public.media_rights r ON r.media_asset_id = a.id
         WHERE a.public_id = p_bild AND r.rights_basis <> 'unknown' AND r.clearance_state <> 'rejected'
    ) THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Rechte des Bildes lassen keinen Beitrag zu');
    END IF;
END;
$$;
