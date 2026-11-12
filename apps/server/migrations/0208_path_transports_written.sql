-- 0208: Reisemittel je Abschnitt „vom Editor vollständig geschrieben“ (WI-0177 §44, F16 „A“; Vorschlag 3 Schritt 3).
--
--   1. `path.transports_written`: Ein Editor hat Liste und Zeitfenster dieses Abschnitts gespeichert. Dann gilt, was dasteht, und
--      nichts erbt mehr (Betreiber 2026-10-18 zu F16: „A“, WI-0177 §37): Ohne das Merkmal lässt `allowedTransportsForPath` Karren und
--      Fuhrwerk von der Kutsche erben, den Schlitten von der Reisegruppe zu Pferd, und `pathSeasonWindow` gibt einem Mittel ohne eigenes
--      Fenster das seines Vorbilds (`freigabeErbe`, WI-0069). Abwählen oder „ganzjährig“ für das erbende Mittel wirkte so nicht. Mit dem
--      Merkmal ist die Liste genau die gespeicherte (geschnitten mit dem Angebot des Wegtyps), auch leer, und ein Mittel ohne eigenes
--      Fenster fährt ganzjährig. Beim ersten Speichern schreibt der Editor die geerbte Liste samt Fenstern aus, damit sich keine
--      Reisezeit ändert.
--   2. Der Grund eines Fensters (`schneemassen`, `vereisung`, …; `CLOSURE_REASONS`) steht im Fenster selbst, als `reason` neben
--      `from_month` … in `transport_seasons` (jsonb): keine Spalte, kein Schema. Das vorige Release liest ihn nicht und übergeht ihn.
--   3. Der Trigger `path_revision` (zuletzt 0174) zählt auch `transports_written`.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine Spalte mit Vorgabe `FALSE` (nur ein Katalogeintrag) und derselbe Trigger mit einer
-- Spalte mehr. Kein Weg hat das Merkmal; Reisezeiten und Kantenfolge bleiben, bis ein Editor speichert. Das vorige Release liest und
-- schreibt die Spalte nie. Legacy kennt kein solches Feld: Der Legacy-Wegeimport (`migration/paths.ts`) schreibt die Spalte nie, die
-- Testwelt setzt sie zurück (`editor/testwelt.ts`). Die Rechte der App-Rolle stehen in `apps/server/src/db/map-grants.psql`.

ALTER TABLE path ADD COLUMN IF NOT EXISTS transports_written BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN path.transports_written IS
    'Reisemittel vom Editor vollständig geschrieben (WI-0177, F16 „A“, Betreiber 2026-10-18): allowed_transports und transport_seasons gelten wie gespeichert, ohne Erbe (freigabeErbe). Der Legacy-Wegeimport schreibt die Spalte nie.';

CREATE OR REPLACE TRIGGER path_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, label_visible, is_bach, geom, is_active, off_map, is_tunnel, mark,
                     flow_direction, allowed_transports, transport_domain, transport_seasons, transports_written, flow_factor,
                     source_system, legacy_public_id, revision
    ON path
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
