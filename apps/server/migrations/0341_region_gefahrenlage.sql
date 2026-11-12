-- 0341: Die Gefahrenlage einer Landschaft (WI-0308 Paket 1; Vali 2026-11-11 und 2026-11-12, §1 des Work Items).
--
--   1. `region.hazards`: die Gefahrenarten der Fläche, leer heißt „ungefährlich“ (die Vorgabe für jede Fläche). Die Schlüssel sind der
--      Katalog `GEFAHREN_ARTEN` in `packages/shared/src/gefahren.ts`; der CHECK hält beide gleich (`gefahrenlage.test.ts`). Gesetzt wird
--      sie nur im Landschaftseditor (`landscape.update`, `changes.hazards`) von Menschen; kein Zug, kein Import und kein Agent schreibt sie.
--   2. Sie ruht außerhalb von Derographie, Vegetation und Topographie (Antwort 10): Die Spalte bleibt stehen, jede Wirkung liest die Ebene
--      mit (`gefahrWirkt`). Darum kein CHECK auf die Ebene.
--   3. Der Trigger `region_revision` (0137, 0163, 0166) zählt auch `hazards`: Eine neue Gefahrenlage ist eine fachliche Änderung mit Revision.
--
-- 🔴 ERWEITERND („erst erweitern“): eine Spalte mit Vorgabe `'{}'`, derselbe Trigger mit einer Spalte mehr. Das vorige Release liest und
-- schreibt die Spalte nie; jede Zeile ist leer. Keine Sicht und keine Kachel ändert sich (die Schraffur kommt mit Paket 2), keine Kartendaten.

ALTER TABLE region ADD COLUMN IF NOT EXISTS hazards TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE region DROP CONSTRAINT IF EXISTS region_hazards_known;
ALTER TABLE region ADD CONSTRAINT region_hazards_known CHECK (
    hazards <@ ARRAY[
        'kriegsgebiet', 'feindselige_bewohner', 'kriminalitaet', 'kreaturen', 'daemonisch', 'verbotenes_heiligtum',
        'seuche', 'naturgefahren', 'extremwetter', 'wildnis', 'sperrgebiet', 'unerforscht'
    ]::text[]
    AND cardinality(hazards) <= 12
);

COMMENT ON COLUMN region.hazards IS
    'Die Gefahrenlage (WI-0308): Gefahrenarten aus GEFAHREN_ARTEN, leer heisst ungefaehrlich. Wirkt nur in derographisch, vegetation und topographie, sonst ruht sie. Setzen nur Menschen im Landschaftseditor.';

CREATE OR REPLACE TRIGGER region_revision
    BEFORE UPDATE OF map_domain_id, name, region_layer, region_type, stack_order, is_locked, wiki_url, wiki_region_key,
                     label_curve_enabled, label_curve_max, label_curve_degree, primary_label_id, is_active, off_map, is_hidden,
                     hazards, source_system, legacy_public_id, revision
    ON region
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
