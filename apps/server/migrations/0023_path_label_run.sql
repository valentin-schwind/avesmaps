-- Schriftläufe für Wegnamen (WI-0010 P5) — dieselbe Bauform wie bei den Landschaften.
--
-- 💣 DERIVED DATA, NIEMALS AUTHORITATIVE. Authoritativ ist allein die Weggeometrie. Ein Lauf
-- entsteht aus ihr und wird neu gerechnet, wenn sie sich ändert; ein Verlust kostet einen Aufruf
-- des Ableitungswerkzeugs.
--
-- ⭐ WARUM ES DIESE TABELLE BRAUCHT, gemessen am 2026-09-22: Ohne sie stand von 149 Wegnamen im
-- Bild EINER auf der Karte. Nicht wegen der Ortsnamen (bei z7 stehen nur 14 im Weg und es waren
-- trotzdem drei), nicht wegen der Segmentlänge (56 % der Abschnitte sind lang genug) — sondern
-- weil eine Kette wie „Reichsstraße 2" ein MultiLineString aus 74 Abschnitten über die halbe Karte
-- ist. MapLibre findet darauf keine Stelle, die lang und gerade genug wäre. Gefiltert auf nur
-- Reichsstraßen, ganz ohne Konkurrenz: null Namen.
--
-- 🪤 DER UNTERSCHIED ZU DEN LANDSCHAFTEN, und er ist der ganze Punkt dieser Datei:
--
--   Landschaft: eine FLÄCHE. Die Mittelachse muss erst abgeleitet werden (Triangulation, chordale
--               Achse), und weil sie selbst abgeleitet ist, DARF sie geglättet werden.
--   Weg:        eine LINIE. Es gibt nichts abzuleiten — und die Geometrie ist authoritativ, also
--               darf sie NICHT geglättet werden. Ein geglätteter Lauf ließe den Namen neben dem
--               Weg laufen, und genau das prüft die Abnahme („Verlauf tatsächlich auf dem Weg").
--
-- Was beide teilen, steht seit heute in `src/derive/run-geometry.ts`: die Ruhesuche, die
-- Aufteilung in Instanzen, die Zoomband-Rechnung und die Pixel-Umrechnung. Herausgezogen, nicht
-- kopiert.

CREATE TABLE IF NOT EXISTS path_label_run (
    id BIGSERIAL PRIMARY KEY,

    -- 🔴 Der Schlüssel ist die KETTE, nicht der Abschnitt: Name plus Art. Damit steht ein
    -- Straßenname einmal je zusammenhängendem Zug und nicht siebenundsiebzig Mal. Legacy gruppiert
    -- ebenso (`wpGroupKeyOf`), und zwar ausdrücklich auch über Lücken hinweg.
    --
    -- 🪤 KEINE Laufnummer als Identität. Legacys teuerste Lektion steht genau hier: sein
    -- Kreuzungs-Zähler machte aus einem Namen eine Position und benannte bei jeder Änderung bis zu
    -- 2083 Knoten um.
    name TEXT NOT NULL,
    subtype TEXT NOT NULL,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),

    -- Das wievielte Teilstück der Kette. Eine Kette mit Lücken zerfällt in mehrere zusammenhängende
    -- Stücke, und jedes trägt seinen eigenen Lauf - sonst bliebe die halbe Straße namenlos.
    part INTEGER NOT NULL CHECK (part >= 0),
    -- Die wievielte Namensinstanz auf diesem Teilstück.
    instance INTEGER NOT NULL CHECK (instance >= 0),
    instance_count INTEGER NOT NULL CHECK (instance_count >= 1),

    -- 💣 Das Zoomband dieses SATZES. Ein langes Teilstück trägt bei z7 drei Namen und bei z4 einen;
    -- ohne getrennte Bänder stünden am unteren Rand drei Namen auf einer Strecke, auf die keiner
    -- passt - und MapLibre liesse dann ALLE weg. Derselbe Fall wie bei den Landschaften, wo er 11
    -- von 13 mehrinstanzigen Regionen betraf.
    run_min_zoom SMALLINT NOT NULL,
    run_max_zoom SMALLINT NOT NULL,

    -- Wie breit der Name auf dem Schirm steht, in Bildschirmpixeln samt Vorhalt. Aus den
    -- Vorschubweiten der ausgelieferten Schrift gemessen, nicht geschätzt: die Kachelfunktion
    -- schneidet danach zu, und SQL kennt keine Glyphenmetrik.
    name_width_px DOUBLE PRECISION NOT NULL CHECK (name_width_px > 0),

    geom geometry(LineString, 0) NOT NULL,

    -- Woraus der Lauf entstand. Ändert sich der Fingerabdruck, ist er veraltet - egal ob eine
    -- Weggeometrie anders wurde, ein Abschnitt dazukam oder die Ableitung selbst sich änderte.
    source_fingerprint TEXT NOT NULL,
    algorithm_version TEXT NOT NULL,
    derived_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT path_label_run_unique UNIQUE (map_domain_id, name, subtype, part, instance_count, instance),
    CONSTRAINT path_label_run_instance_in_range CHECK (instance < instance_count),
    CONSTRAINT path_label_run_zoom_order CHECK (run_min_zoom <= run_max_zoom)
);

CREATE INDEX IF NOT EXISTS path_label_run_geom_idx ON path_label_run USING GIST (geom);

COMMENT ON TABLE path_label_run IS
    'Schriftlaeufe fuer Wegnamen (WI-0010 P5). Derived Data aus der Weggeometrie, je KETTE gleichnamiger Abschnitte. Anders als bei den Landschaften wird NICHT geglaettet: die Weggeometrie ist authoritativ, ein geglaetteter Lauf liesse den Namen neben dem Weg laufen.';

-- 🪤 Die Kachelfunktion schneidet je Zoom zu und liefert UNBESCHNITTEN aus (`clip_geom => false`).
-- Das ist dieselbe Lösung wie bei `landscape_label_run_tile` und aus demselben Grund: ein Lauf,
-- der an der Kachelgrenze endet, verliert seinen Namen - MapLibre platziert Symbole je Kachel.
CREATE OR REPLACE FUNCTION path_label_run_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    units_per_pixel double precision := (2 * 20037508.342789244) / (512.0 * power(2, z));
    tile bytea;
BEGIN
    -- Die Sortierung steht IM AGGREGAT, wo PostgreSQL sie zusichert (Migration 0016).
    SELECT ST_AsMVT(source, 'path_label_run' ORDER BY source.name, source.subtype, source.part, source.instance)
    INTO tile
    FROM (
        SELECT
            run.name,
            run.subtype,
            run.part,
            run.instance,
            run.instance_count,
            label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
            ST_AsMVTGeom(ST_LineSubstring(geom_render, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom
        FROM (
            SELECT r.*, map_domain_to_render(r.map_domain_id, r.geom) AS geom_render
            FROM path_label_run r
        ) run
        CROSS JOIN LATERAL (SELECT run.name_width_px * units_per_pixel AS target) need
        CROSS JOIN LATERAL (
            SELECT
                GREATEST(0.0, 0.5 - (need.target / 2.0) / NULLIF(ST_Length(run.geom_render), 0)) AS lo,
                LEAST(1.0, 0.5 + (need.target / 2.0) / NULLIF(ST_Length(run.geom_render), 0)) AS hi
        ) cut
        WHERE z BETWEEN run.run_min_zoom AND run.run_max_zoom
          AND ST_Intersects(
                  ST_LineInterpolatePoint(run.geom_render, 0.5),
                  ST_Expand(envelope, GREATEST(need.target, ST_Length(run.geom_render)) / 2.0)
              )
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

COMMENT ON FUNCTION path_label_run_tile(integer, integer, integer) IS
    'Wegnamen-Schriftlaeufe je Zoom zugeschnitten, unbeschnitten ausgeliefert (clip_geom => false) - wie landscape_label_run_tile und aus demselben Grund: ein Lauf, der an der Kachelgrenze endet, verliert seinen Namen.';
