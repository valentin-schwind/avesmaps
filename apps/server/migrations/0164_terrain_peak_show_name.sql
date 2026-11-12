-- 0164: „Auf der Karte anzeigen“ am Gipfel (WI-0178; Befund der Topographie-Sitzung, Editor-Orchestrierung 2026-10-18; Legacy-Parität,
-- keine Betreiberentscheidung nötig).
--
--   Legacy trägt an jeder Beschriftung `show_name`, auch an Berggipfel und Vulkan, mit Vorgabe an (Mirror a7f2dac86). Aus blendet die ganze
--   Beschriftung aus, Name UND Dreieck (`shouldShowLabelMarker`, `js/map-features/map-features-labels.js:1309`); ins Gelände zählt der
--   Gipfel weiter (`peaksInsideArea` filtert nicht danach). 28 Berggipfel stehen in Legacy auf aus, fast alle Hilfspunkte fürs Gelände
--   (Walli-…, Drachi-…, „5000 in der Großen Olochtai“, Rote Sichel 11 von 34). `terrain_peak` kannte das Feld nicht, der Import verwarf es,
--   die Karte zeigte sie alle.
--
--   1. `terrain_peak.show_name`, Vorgabe TRUE. Der Landschaften-Zug (I10, `migration/terrain.ts`) schreibt Legacys Wert; später schreibt
--      ihn der Editor als „Auf der Karte anzeigen“ (EDIT-0003 T55, Gebirge-Entwurf Fassung 15).
--   2. Nur die Kartensicht `terrain_peak_render` lässt verborgene Gipfel aus. Geländerechnung, Gelände-Fingerabdruck und Wegfindung
--      lesen die Spalte nicht (wie `region.is_hidden`, Claudio 2026-10-18): Der Gipfel formt das Gelände weiter.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine Spalte mit Vorgabe (seit PostgreSQL 11 nur ein Katalogeintrag) und dieselbe Sicht mit
-- einer Bedingung mehr. Das vorige Release liest und schreibt die Spalte nie; bis zum nächsten Zug sind alle Zeilen TRUE und die Karte
-- zeigt, was sie heute zeigt.

ALTER TABLE terrain_peak ADD COLUMN IF NOT EXISTS show_name BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN terrain_peak.show_name IS
    'Auf der Karte anzeigen (Legacy show_name, Vorgabe an, WI-0178): aus blendet Name und Dreieck aus; das Gelaende zaehlt den Gipfel weiter.';

CREATE OR REPLACE VIEW terrain_peak_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.height_schritt AS height,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom
FROM terrain_peak p
WHERE p.is_active AND p.show_name
ORDER BY p.public_id;
