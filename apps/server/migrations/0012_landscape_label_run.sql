-- Schriftläufe: die Geometrie, auf der ein Landschaftsname steht (WI-0004, ADR-0007).
--
-- 💣 DERIVED DATA, NIEMALS AUTHORITATIVE. Ein Schriftlauf entsteht aus der Region und ihren
-- aktiven Flächen und wird neu gerechnet, wenn die sich ändern. Er wird nie migriert, nie von Hand
-- bearbeitet, und ein Verlust kostet nichts als einen Lauf des Ableitungswerkzeugs.
--
-- Eine Zeile ist EINE Namensinstanz. `label_curve_max` ist die maximale Anzahl gerenderter
-- Instanzen der REGION auf ihrem Kurvenzug (ADR-0007 Fassung 4) - kein Deckel auf Labelobjekte und
-- kein Multiplikator. Deshalb hängt der Lauf an der Region und trägt den Text mit, statt an einem
-- Labelobjekt zu hängen: zwei Instanzen desselben Namens sind zwei Zeilen, nicht zwei Labels.

CREATE TABLE IF NOT EXISTS landscape_label_run (
    id BIGSERIAL PRIMARY KEY,
    region_id BIGINT NOT NULL REFERENCES region (id) ON DELETE CASCADE,
    -- Das Label, dessen Stil die Instanzen steuert: das Primärlabel der Region. Gemessen wurde,
    -- dass die wenigen Sekundärlabels alte Platzierungsduplikate sind (WI-0004 Fassung 3).
    style_label_id BIGINT NOT NULL REFERENCES map_label (id) ON DELETE CASCADE,
    -- Die wievielte Instanz auf dem Kurvenzug, von 0 an in Laufrichtung.
    instance INTEGER NOT NULL CHECK (instance >= 0),
    -- Wie viele Instanzen dieser Lauf zusammen mit seinen Geschwistern bildet. Wird der Platz
    -- knapp, wird 3 -> 2 -> 1 reduziert und VOLLSTÄNDIG neu verteilt; dann ändert sich diese Zahl
    -- für alle Zeilen des Satzes gemeinsam.
    instance_count INTEGER NOT NULL CHECK (instance_count BETWEEN 1 AND 3),
    -- 💣 Das Zoomband dieses SATZES, nicht das Erscheinungsband des Namens.
    --
    -- Eine Region trägt mehrere Sätze: bei `label_curve_max = 2` einen mit zwei Instanzen für die
    -- Stufen, auf denen zwei Namen passen, und darunter einen mit einer. Ohne diese Bänder stünden
    -- am unteren Rand des Erscheinungsbands zwei Namen auf einer Kurve, auf die keiner passt --
    -- und MapLibre ließe dann BEIDE weg. Gemessen betrifft das 11 der 13 Regionen mit mehr als
    -- einer Instanz (WI-0004). Der Satz mit einer Instanz wird nie auf Passung geprüft: er reicht
    -- bis ans untere Ende des Erscheinungsbands, damit der Name nie ausfällt (MCS-008, I7).
    run_min_zoom SMALLINT NOT NULL,
    run_max_zoom SMALLINT NOT NULL,
    -- Wie breit der Name auf dem Schirm steht, in Bildschirmpixeln samt Vorhalt. Hier gemessen aus
    -- den Vorschubweiten der ausgelieferten Schriftart und NICHT geschätzt: die Kachelfunktion
    -- schneidet den Lauf danach zu, und SQL kennt keine Glyphenmetrik.
    name_width_px DOUBLE PRECISION NOT NULL CHECK (name_width_px > 0),
    geom geometry(LineString, 0) NOT NULL,
    -- Woraus der Lauf entstand. Ändert sich der Fingerabdruck, ist er veraltet - egal ob eine
    -- Geometrie anders wurde, eine Fläche dazukam oder die Ableitung selbst sich änderte.
    source_fingerprint TEXT NOT NULL,
    algorithm_version TEXT NOT NULL,
    derived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT landscape_label_run_instance_unique UNIQUE (region_id, instance_count, instance),
    CONSTRAINT landscape_label_run_instance_in_range CHECK (instance < instance_count),
    CONSTRAINT landscape_label_run_zoom_band CHECK (run_min_zoom <= run_max_zoom)
);

CREATE INDEX IF NOT EXISTS landscape_label_run_geom_gist ON landscape_label_run USING GIST (geom);
CREATE INDEX IF NOT EXISTS landscape_label_run_region ON landscape_label_run (region_id);

COMMENT ON TABLE landscape_label_run IS
    'Abgeleitete Schriftläufe der Landschaftsnamen (ADR-0007). Eine Zeile ist eine Namensinstanz. Niemals Source of Truth.';
COMMENT ON COLUMN landscape_label_run.source_fingerprint IS
    'sha256 ueber die nach public_id sortierten aktiven Flaechen (public_id:geometry_revision) plus Algorithmusversion.';

-- Kachelquelle. Der Zuschnitt je Zoom passiert in der Funktion, nicht hier: eine Sicht kennt kein
-- z. Diese Ansicht liefert den ganzen Lauf samt Stil; die Funktion daneben schneidet ihn zu.
CREATE OR REPLACE VIEW landscape_label_run_render AS
SELECT
    r.id AS run_id,
    reg.public_id AS region_public_id,
    l.name,
    reg.region_layer,
    l.label_size,
    l.label_min_zoom,
    l.label_max_zoom,
    l.label_priority,
    r.instance,
    r.instance_count,
    r.run_min_zoom,
    r.run_max_zoom,
    r.name_width_px,
    map_domain_to_render(reg.map_domain_id, r.geom)::geometry(LineString, 3857) AS geom
FROM landscape_label_run r
JOIN region reg ON reg.id = r.region_id
JOIN map_label l ON l.id = r.style_label_id
WHERE reg.is_active
  AND l.is_active;

COMMENT ON VIEW landscape_label_run_render IS
    'Abgeleitete Renderansicht der Schriftlaeufe fuer Martin. Niemals Source of Truth (Kapitel 4.17.4).';

/*
 * Die Kachelquelle der Schriftläufe.
 *
 * ⭐ Auf dem echten Stack gemessen (ADR-0007): MapLibre wählt die zeichnende Kachel selbst.
 * `addSymbolAtAnchor` verwirft ein Symbol, dessen Anker außerhalb der eigenen Kachel liegt, nach
 * eigener Aussage "to prevent double-drawing symbols". Der Test ist halboffen - von allen Kacheln,
 * die einen Lauf tragen, hält genau eine seine Mitte und zeichnet den Namen.
 *
 * 💣 Die Vervielfachung kam nie von Puffern, sondern vom ZUSCHNEIDEN. Ein zugeschnittener Lauf wird
 * zu mehreren Linien, jede mit eigener Mitte, jede in ihrer eigenen Kachel - und jede trägt dann
 * denselben Namen. Deshalb `clip_geom => false` und derselbe Lauf an jede berührte Kachel.
 *
 * Der Zuschnitt um die Mitte hängt allein am Zoom, nie an x oder y. Nur dadurch liefern alle
 * Kacheln dieselbe Geometrie und errechnen dieselbe Mitte.
 *
 * 🪤 Ein zu kurzer Lauf wird NICHT weggelassen. Die Ableitung hat die Instanzzahl bereits so
 * gewählt, dass der Name auf seinem Zoomband passt (`run_min_zoom`/`run_max_zoom`); ihn hier noch
 * einmal zu prüfen hieße, ihn zweimal zu verwerfen - und das kostete nach I7 den Namen.
 */
CREATE OR REPLACE FUNCTION landscape_label_run_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    -- Eine Kachel ist auf jeder Stufe 512 Bildschirmpixel breit; daraus wird aus Pixeln eine Länge
    -- in projizierten Einheiten, ohne dass die Funktion die Schriftart kennen müsste.
    units_per_pixel double precision := (2 * 20037508.342789244) / (512.0 * power(2, z));
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'landscape_label_run') INTO tile
    FROM (
        SELECT
            run.run_id,
            run.region_public_id,
            run.name,
            run.region_layer,
            run.label_size,
            run.label_priority,
            run.instance,
            run.instance_count,
            ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom
        FROM landscape_label_run_render run
        CROSS JOIN LATERAL (SELECT run.name_width_px * units_per_pixel AS target) need
        CROSS JOIN LATERAL (
            SELECT
                GREATEST(0.0, 0.5 - (need.target / 2.0) / NULLIF(ST_Length(run.geom), 0)) AS lo,
                LEAST(1.0, 0.5 + (need.target / 2.0) / NULLIF(ST_Length(run.geom), 0)) AS hi
        ) cut
        WHERE z BETWEEN run.run_min_zoom AND run.run_max_zoom
          AND ST_Intersects(
                  ST_LineInterpolatePoint(run.geom, 0.5),
                  ST_Expand(envelope, GREATEST(need.target, ST_Length(run.geom)) / 2.0)
              )
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$$;

COMMENT ON FUNCTION landscape_label_run_tile(integer, integer, integer) IS
    'Kachelquelle der Schriftlaeufe: je Zoom um die Mitte zugeschnitten, unzugeschnitten an jede beruehrte Kachel (ADR-0007).';
