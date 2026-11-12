-- Die gezeichnete Wegkurve: abgeleitete visuelle Geometrie (WI-0010, Betreiberauftrag 2026-09-22).
--
-- 🔴 `path.geom` BLEIBT AUTHORITATIV UND UNVERÄNDERT. Routing und Topologie rechnen weiter darauf.
-- Was hier steht, ist Darstellung — und zwar für BEIDE Zwecke: die sichtbare Linie und den
-- Schriftlauf. Es darf nicht passieren, dass die Straße geglättet wird und ihr Name auf der
-- Rohgeometrie liegen bleibt.
--
-- 💣 DIE KURVE ÜBERSCHWINGT AN ECKEN, UND DAS IST GEWOLLT. Legacy hat es an einem rechten Winkel
-- gemessen: 0,732 Karteneinheiten unter den einlaufenden Schenkel und ebenso weit über den
-- auslaufenden hinaus. Sein Kommentar: „That is not a defect to damp out; it is what the map
-- draws." Unsere Umsetzung trifft die Zahl exakt (`packages/shared/test/catmull-rom.test.ts`).
--
-- 🪤 ZOOMUNABHÄNGIG. Eine je Zoomstufe neu berechnete Spline wäre eine andere Linie pro Stufe -
-- und ein Name, der beim Hineinzoomen von seinem Weg rutscht. Wird Generalisierung nötig, wird
-- DIESE Kurve vereinfacht, nicht eine neue gerechnet.

CREATE TABLE IF NOT EXISTS path_visual (
    path_id BIGINT PRIMARY KEY REFERENCES path (id) ON DELETE CASCADE,
    geom geometry(LineString, 0) NOT NULL,
    -- Woraus sie entstand und womit. Ändert sich eines von beiden, ist die Kurve veraltet.
    source_fingerprint TEXT NOT NULL,
    algorithm_version TEXT NOT NULL,
    derived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS path_visual_geom_idx ON path_visual USING GIST (geom);

COMMENT ON TABLE path_visual IS
    'Gezeichnete Wegkurve (Catmull-Rom, samples 8, tension 0.5 - Legacys ausgelieferte Werte). DERIVED DATA: path.geom bleibt authoritativ, Routing rechnet dort. Sichtbare Linie UND Schriftlauf lesen diese Tabelle, damit sie nicht auseinanderlaufen koennen.';

-- 🪤 Die Renderrelation liest ab jetzt die VISUELLE Geometrie - mit Rückfall auf die rohe, falls
-- die Ableitung noch nicht gelaufen ist. Ein LEFT JOIN, kein JOIN: eine fehlende Kurve darf keinen
-- Weg von der Karte nehmen (Kap. 2.16). Dann ist die Linie eckig statt unsichtbar, und der
-- Verifier sagt, dass sie fehlt.
--
-- `collision_rank` bleibt am Ende: eine Sicht wächst in PostgreSQL nur dort, und ein DROP VIEW
-- nähme der Martin-Rolle das Leserecht (Migration 0017).
CREATE OR REPLACE VIEW path_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.label_visible,
    p.is_bach,
    map_domain_to_render(p.map_domain_id, COALESCE(v.geom, p.geom))::geometry(LineString, 3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank
FROM path p
LEFT JOIN path_visual v ON v.path_id = p.id
WHERE p.is_active
ORDER BY p.public_id;

COMMENT ON VIEW path_render IS
    'Wegabschnitte fuer die Kachel, mit der GEZEICHNETEN Kurve aus path_visual (Rueckfall: die rohe Geometrie). Feste Reihenfolge nach public_id (0016).';
