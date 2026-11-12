-- 0268: Die Gelände-Sicht der Gipfel (WI-0271 L1; Vali 2026-10-31 „Ja, D“: Landmarken kommen in `terrain_peak`).
--
--   `terrain_peak` soll künftig auch Landmarken ohne Geländewirkung aufnehmen (Höhle, Grotte, Wasserfall, Quelle, Furt, Krater, Schlucht,
--   Fels, Klippe, Riff, Strudel, Hügel). Nur Berggipfel und Vulkan formen Gelände. Darum lesen alle Geländeleser (Eingaben, Fingerabdruck,
--   Anzeigehöhen, DEM-Prüfung, Gipfelliste des Gebirges, Bezüge) ab diesem Release diese Sicht statt der Tabelle; ein Wächter
--   (`apps/server/test/terrain-peak-gelaende.test.ts`) hält das.
--
--   Kein Filter auf `is_active`: Die Sicht ist ein reiner Ersatz für die Tabelle, die Leser behalten ihre Bedingungen. Die Spalten stehen
--   ausdrücklich da (Topographie-Koordination 2026-10-31): `p.*` würde beim Anlegen festgeschrieben, eine spätere Spalte der Tabelle fehlte
--   still. Bekommt `terrain_peak` eine Spalte, die ein Geländeleser braucht, wird sie hier hinten angehängt (`CREATE OR REPLACE VIEW` erlaubt
--   nur das). Heute gibt es nur die zwei Arten (CHECK aus 0047), die Sicht liefert also genau die Zeilen der Tabelle; Saat, Fingerabdruck
--   und DEM bleiben bytegleich (Nachweis im WI).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine neue Sicht, sonst nichts. Das vorige Release liest sie nie. Die neuen Arten (CHECK) kommen
-- erst ein Release später (WI-0271 §8, L2), damit kein Release, das noch die Tabelle liest, je eine Landmarke als Berg sieht.
-- Rechte: App- und Jobs-Rolle lesen die Sicht wie jede neue Relation in `public` (Default-Privilegien der Migrationsrolle in
-- `ops/runtime/runtime-foundation.sh`, dazu `GRANT SELECT ON ALL TABLES` an die Jobs-Rolle nach jeder Migration); Claudios Leserolle über
-- `ops/db-readonly/claudio-readonly.sh`.

CREATE OR REPLACE VIEW terrain_peak_gelaende AS
SELECT
    p.id,
    p.public_id,
    p.map_domain_id,
    p.name,
    p.subtype,
    p.geom,
    p.height_schritt,
    p.is_active,
    p.source_system,
    p.legacy_public_id,
    p.legacy_revision,
    p.migration_run_id,
    p.imported_at,
    p.created_at,
    p.updated_at,
    p.show_name,
    p.revision
FROM terrain_peak p
WHERE p.subtype IN ('berggipfel', 'vulkan');

COMMENT ON VIEW terrain_peak_gelaende IS
    'Gipfel und Vulkane, die das Gelaende formen (WI-0271): die einzige Quelle aller Gelaendeleser; andere Arten in terrain_peak sind Landmarken ohne Gelaendewirkung.';
