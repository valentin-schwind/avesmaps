-- 0244: Die Höhe eines Gipfels folgt dem Wiki, solange niemand sie von Hand setzt (WI-0253 §14 und §21; Vali 2026-10-27: „wir wollen auf jeden fall, dass die werte (wenn es
-- werte gibt) vom wiki übernommen werden!“).
--
--   Der WikiSync liest die Höhe eines Gipfels aus der `{{Infobox Region}}` seines Artikels (`Höhe=`, eine Zahl bis 20.000, Tausenderpunkt, wie Legacy; der Dump vom 2026-10-01 führt das Feld in
--   keinem Berg- oder Vulkan-Artikel, §21.2: Heute wäre der Wiki-Wert überall leer, die Höhen blieben). Legacy setzte sie an Berggipfeln
--   (`region-heights.php`), mit einem Vermerk je Feld („wiki“ oder „manual“), den der Import nicht übernommen hat. Zwei Dinge fehlen dafür:
--
--   1. Der Wiki-Wert hinter der Höhe: `wiki_region_snapshot.height_schritt` (Gipfel und Landschaft teilen die Tafel; nur die Gipfel schreiben die Spalte). `NULL`: das Wiki nennt keine
--      oder der Stand wurde noch nie mit der Höhe geschrieben. Dieselbe Grenze wie `terrain_peak.height_schritt` (0 bis 65535).
--   2. Der Vermerk „von Hand gesetzt“ am Gipfel: `field_origin` (0183) führt Art und Feld, die Art `peak` fehlt in der Prüfung. Ab jetzt schreibt der Editor beim Setzen der Höhe
--      (`peak.update`, die Gipfelliste des Gebirges) den Vermerk `manual`; eine Höhe OHNE Vermerk folgt dem Wiki, wo es einen Wert hat (bewusste Ausnahme von „unbelegt ist Befund“,
--      nur für diese Höhe). Das Feld selbst steht in `packages/shared/src/feld-herkunft.ts` (`FELD_HERKUNFT_FELDER.peak`), nicht als CHECK.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine neue, nullbare Spalte, die das vorige Release nie liest, und eine gelockerte Prüfung (jede bisherige Art bleibt erlaubt). Die Rechte
-- der Jobs-Rolle (Höhe am Gipfel, Wiki-Wert im Stand, die Geländeauftrags-Funktion) stehen in `apps/server/src/db/system-grants.psql` (hinter JEDE Migration).

ALTER TABLE wiki_region_snapshot ADD COLUMN IF NOT EXISTS height_schritt INTEGER CHECK (height_schritt IS NULL OR height_schritt BETWEEN 0 AND 65535);

COMMENT ON COLUMN wiki_region_snapshot.height_schritt IS
    'Die Höhe des Gipfels laut Wiki (Infobox Region, Höhe=; Legacy region-heights.php, auf ganze Schritt gerundet). NULL: das Wiki nennt keine oder der Stand kennt sie noch nicht (WI-0253 §21, 0244). Nur Gipfel und Vulkane schreiben die Spalte.';

ALTER TABLE field_origin DROP CONSTRAINT IF EXISTS field_origin_object_kind_check;
ALTER TABLE field_origin
    ADD CONSTRAINT field_origin_object_kind_check CHECK (object_kind IN ('place', 'path', 'landscape', 'territory', 'powerline', 'peak'));
