-- 0276: Landmarken in `terrain_peak` (WI-0271 L2; Vali 2026-10-31 „Ja, D“; Zuteilung der Editor-Orchestrierung nach L1 in Production).
--
--   `terrain_peak` nimmt neben Berggipfel und Vulkan alle Landmarkenarten auf (Katalog `LANDMARKEN_ARTEN` in
--   `packages/shared/src/landmarken.ts`, dieselbe Liste wie hier; `landmarken-katalog.test.ts` hält beide zusammen). Gelände formen weiter nur
--   Berggipfel und Vulkan: Alle Geländeleser lesen seit 0268 die Sicht `terrain_peak_gelaende`, die nur diese zwei Arten zeigt.
--
--   1. CHECK der Art: die bisherigen zwei Werte und die neuen Arten. Die Liste des Legacy-Zugs (`TERRAIN_PEAK_SUBTYPES`) bleibt bei zwei.
--   2. `merkmale`: Bedeutung statt Art (heilig, magisch, gefährlich, unzugänglich, verborgen), Vorgabe leer.
--   3. Höhe nur bei Berggipfel und Vulkan: Eine Höhle trägt keine Höhe (die Wiki-Höhe und die Gebirgsliste schreiben nur Geländearten).
--   4. `terrain_peak_bezug`: was sich nicht rechnen lässt (Wasserfall oder Furt am Fluss, Kultstätte an der Höhle). „Liegt in Gebirge X“
--      wird gerechnet, nicht gespeichert.
--   5. `terrain_peak_render` hängt `formt_gelaende` an: Die Karte zeichnet ▲ und Höhenzahl nur dort (WI-0271 L5); die Art liefert sie
--      schon (`subtype`). Martin liest neue Spalten erst nach einem Neustart (Handover an Claudio).
--
-- 🔴 Nur gelockert und angehängt (AGENTS.md, „erst erweitern“): Das vorige Release schreibt nur `berggipfel` und `vulkan`, nie `merkmale`
-- und nie `terrain_peak_bezug`; jede bestehende Zeile erfüllt die neuen Bedingungen (L1-Nachweis: lokal 287 Zeilen, nur die zwei Arten;
-- auf der Stage zählt Claudio vor der ersten Landmarke). Eine Zeile einer neuen Art entsteht erst mit dem Editor (L3), nicht hier.

ALTER TABLE terrain_peak DROP CONSTRAINT IF EXISTS terrain_peak_subtype_check;
ALTER TABLE terrain_peak
    ADD CONSTRAINT terrain_peak_subtype_check CHECK (subtype IN (
        'berggipfel', 'vulkan', 'huegel', 'hoehle', 'grotte', 'krater', 'schlucht', 'wasserfall', 'quelle', 'geysir', 'furt', 'strudel',
        'fels', 'klippe', 'riff'
    ));

ALTER TABLE terrain_peak ADD COLUMN IF NOT EXISTS merkmale TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE terrain_peak DROP CONSTRAINT IF EXISTS terrain_peak_merkmale_known;
ALTER TABLE terrain_peak
    ADD CONSTRAINT terrain_peak_merkmale_known
        CHECK (merkmale <@ ARRAY['heilig', 'magisch', 'gefaehrlich', 'unzugaenglich', 'verborgen']::TEXT[]);

ALTER TABLE terrain_peak DROP CONSTRAINT IF EXISTS terrain_peak_hoehe_nur_gelaende;
ALTER TABLE terrain_peak
    ADD CONSTRAINT terrain_peak_hoehe_nur_gelaende CHECK (height_schritt IS NULL OR subtype IN ('berggipfel', 'vulkan'));

COMMENT ON COLUMN terrain_peak.subtype IS
    'Landmarkenart (WI-0271, Katalog LANDMARKEN_ARTEN): nur berggipfel und vulkan formen Gelaende (Sicht terrain_peak_gelaende), alle anderen sind Landmarken ohne Gelaendewirkung.';
COMMENT ON COLUMN terrain_peak.merkmale IS
    'Bedeutung der Landmarke (WI-0271): heilig, magisch, gefaehrlich, unzugaenglich, verborgen. Nie eine Art, aendert das Kartenzeichen nicht.';

CREATE TABLE IF NOT EXISTS terrain_peak_bezug (
    id BIGSERIAL PRIMARY KEY,
    terrain_peak_id BIGINT NOT NULL REFERENCES terrain_peak (id) ON DELETE CASCADE,
    ziel_art TEXT NOT NULL CONSTRAINT terrain_peak_bezug_ziel_art_known CHECK (ziel_art IN ('place', 'path', 'region', 'peak')),
    ziel_public_id UUID NOT NULL,
    rolle TEXT NOT NULL CONSTRAINT terrain_peak_bezug_rolle_known CHECK (rolle IN ('am_fluss', 'kultstaette')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    source_system TEXT NOT NULL DEFAULT 'avesmaps3d' CONSTRAINT terrain_peak_bezug_source_known CHECK (source_system = 'avesmaps3d'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS terrain_peak_bezug_einmal
    ON terrain_peak_bezug (terrain_peak_id, ziel_art, ziel_public_id, rolle)
    WHERE is_active;
CREATE INDEX IF NOT EXISTS terrain_peak_bezug_ziel ON terrain_peak_bezug (ziel_art, ziel_public_id) WHERE is_active;

COMMENT ON TABLE terrain_peak_bezug IS
    'Gespeicherte Bezuege einer Landmarke (WI-0271): nur, was sich nicht rechnen laesst (am_fluss: Wasserfall, Furt, Quelle an einem Fluss; kultstaette: Ort oder Staette, deren Kultort die Landmarke ist). Liegt-in wird gerechnet.';

CREATE OR REPLACE VIEW terrain_peak_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.height_schritt AS height,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom,
    p.subtype IN ('berggipfel', 'vulkan') AS formt_gelaende
FROM terrain_peak p
WHERE p.is_active AND p.show_name
ORDER BY p.public_id;
