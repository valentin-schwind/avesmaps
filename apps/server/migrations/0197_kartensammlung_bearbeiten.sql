-- Die Kartensammlung in der Medienverwaltung bearbeiten (WI-0068 R5; Betreiber 2026-10-18: „B jetzt“, dazu „wir werden nix
-- redaktionelles machen, müssen aber schauen, dass es geht“).
--
-- 1. `citymap.revision`: der gesehene Stand einer Karte (ADR-0020), wie an jedem Medienobjekt. Der Trigger zählt mit
--    `revision_bump_forward()` (0115): Eine Änderung der Typen setzt die Revision der Karte ausdrücklich höher, ohne dass sich eine
--    ihrer Spalten ändert; zurückdrehen lässt sie sich nie. Er feuert nur an den Spalten, die jemand ändern kann (die Eigenschaften der
--    Karte, ihr Elter, ihr Zustand), nicht an `updated_at` oder den Spalten des Imports (`migration_run_id`, `imported_at`).
-- 2. `media_audit_event.citymap_public_id`: Die Karte wird ein Ziel des Fachprotokolls der Medien, wie Asset, Galerie und Freigaberegel
--    (0086), ohne Fremdschlüssel. Aus diesem Protokoll liest der Legacy-Zug (Schritt I21), welche Karten ein Mensch geändert hat, und
--    fasst sie nicht mehr an (`protectedWhere`, Befund statt Überschreiben, Kapitel 9.37) - dieselbe Regel wie bei den Medien
--    (`media-import.ts`: Rechte, die ein Mensch gesetzt hat, bleiben).
--
-- Additiv: eine Spalte mit Vorgabe 1, ein Trigger, eine nullbare Spalte samt erweiterter Prüfung und ein Index. Das vorige Release liest
-- und schreibt weiter, ohne sie zu kennen. Keine neuen Rechte: Die App schreibt `citymap` und `citymap_type` heute über ihr
-- Standardrecht; die Einordnung für Claudios Vorlage steht in `apps/server/test/support/public-rechte.ts`.

ALTER TABLE citymap ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE TRIGGER citymap_revision
    BEFORE UPDATE OF title, art, color_mode, is_multilevel, is_labeled, is_official, is_spoiler, has_scale, width_px, height_px, format,
                     valid_from_bf, valid_to_bf, author, publisher, note, parent_id, state, is_active, revision
    ON citymap
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump_forward();

COMMENT ON COLUMN citymap.revision IS
    'Fachrevision (ADR-0020): steigt mit jeder Änderung einer Eigenschaft, des Elters oder des Zustands; eine Änderung der Typen setzt sie ausdrücklich höher (0197).';

ALTER TABLE media_audit_event ADD COLUMN IF NOT EXISTS citymap_public_id UUID;

ALTER TABLE media_audit_event DROP CONSTRAINT IF EXISTS media_audit_event_has_target;
ALTER TABLE media_audit_event ADD CONSTRAINT media_audit_event_has_target CHECK (
    num_nonnulls(media_asset_public_id, media_gallery_public_id, publication_rule_id, citymap_public_id) >= 1
);

CREATE INDEX IF NOT EXISTS media_audit_event_citymap ON media_audit_event (citymap_public_id, id DESC)
    WHERE citymap_public_id IS NOT NULL;

COMMENT ON COLUMN media_audit_event.citymap_public_id IS
    'Ziel: eine Karte der Kartensammlung (WI-0068 R5), ohne Fremdschlüssel. Eine Zeile `citymap.updated` hält die Karte gegen den Legacy-Zug fest.';
