-- Die wirksame Darstellungstafel der Landschaften (WI-0064, Betreiber 2026-09-30: „orte haben generische zoombänder, aber
-- landschaften ihre eigenen und die sollten bei uns gelten“).
--
-- 🔴 WAS SIE IST. Legacy führt je Landschaftsart (Namensart, `map_label.subtype`) eine Tafel: Zoomband der Namen, Höchstzahl
-- der Kurvennamen, Priorität und Schriftgröße je Band. Legacys Endpunkt `ecosystem-display.php` liefert nur die Übersteuerungen
-- der Redaktion, die Vorgaben stehen in Legacys Code; die wirksame Tafel ist beides zusammen und entsteht im Import
-- (`legacy:update`, Schritt I16, `packages/shared/src/landscape-display.ts`). Diese Tabelle trägt das Ergebnis, eine Zeile je Art
-- und eine Zeile `*` für die Grundvorgabe (gilt für jede Art ohne eigene Zeile).
--
-- 🔴 WAS SIE NICHT IST: kein Riegel. In Legacy "rät" die Tafel nur (Owner 24.08. und 02.09.2026): der eigene Wert einer
-- Beschriftung gewinnt, die Tafel gilt dort, wo eine Beschriftung KEINEN hat. Genau so wirkt sie hier, in `map_label_effective`
-- unten. Ein Band gilt als eigenes nur, wenn BEIDE Enden gesetzt sind (Legacy `avesmapsLabelImBand`); sonst gilt das der Tafel.
--
-- 🔴 Abgeleitet, nie Wahrheit: die Zeilen entstehen ausschließlich aus Legacys Vorgaben und Übersteuerungen und werden bei jedem
-- Zug ganz neu bestimmt (eine Art, die dort nicht mehr vorkommt, verschwindet hier). Nicht von Hand ändern. Deckkraft, Abstände
-- und Kollisionsrolle führt Legacy in derselben Tafel; sie sind BEWUSST nicht hier (WI-0064, Abweichungsliste).
--
-- Additiv und wirkungslos, solange die Tabelle leer ist: ohne Zeile fällt jede Ansicht auf den bisherigen Wert des Labels zurück.
-- 🪤 Martin liest Katalog und Kacheln beim Start: nach dieser Migration und nach dem ersten Zug Martin neu starten.

CREATE TABLE IF NOT EXISTS landscape_display_art (
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- Die Namensart (`map_label.subtype`, Legacy `feature_subtype`). `*` ist die Grundvorgabe.
    art_key TEXT NOT NULL CHECK (art_key = '*' OR art_key ~ '^[a-z_]{1,32}$'),
    -- Zoomband der Namen in Legacy-Bändern (0 bis 7; z8 erbt z7). `band_to = -1` heißt "aus" (Legacy: bis < ab).
    band_from SMALLINT NOT NULL CHECK (band_from BETWEEN 0 AND 7),
    band_to SMALLINT NOT NULL CHECK (band_to BETWEEN -1 AND 7),
    -- Höchstzahl der Namen auf einer gerechneten Kurve (Legacy `curveMax`).
    curve_max SMALLINT NOT NULL CHECK (curve_max BETWEEN 1 AND 3),
    -- Redaktionelle Priorität 1..5, 5 gewinnt (Legacy-Richtung, wie `map_label.label_priority`).
    priority SMALLINT NOT NULL CHECK (priority BETWEEN 1 AND 5),
    -- Schriftgröße in PIXELN je Band z0..z8 (nicht Punkt, siehe config/zoom-bands). Der Wert bei z5 ist die Grundgröße, die
    -- eine Art vorschlägt (Legacy `avesmapsEcosystemDisplayBasisGroesse`).
    size_by_band NUMERIC(4, 1)[] NOT NULL,
    PRIMARY KEY (map_domain_id, art_key),
    CONSTRAINT landscape_display_art_band CHECK (band_to = -1 OR band_from <= band_to),
    CONSTRAINT landscape_display_art_sizes CHECK (
        cardinality(size_by_band) = 9 AND 4 <= ALL (size_by_band) AND 30 >= ALL (size_by_band)
    )
);

COMMENT ON TABLE landscape_display_art IS
    'Wirksame Darstellungstafel der Landschaftsarten: Legacys Vorgaben plus Übersteuerungen (WI-0064). Abgeleitet, nie Wahrheit; gilt nur, wo eine Beschriftung keinen eigenen Wert trägt.';
COMMENT ON COLUMN landscape_display_art.art_key IS
    'Namensart wie map_label.subtype; * = Grundvorgabe für jede Art ohne eigene Zeile.';
COMMENT ON COLUMN landscape_display_art.band_to IS
    '-1 = aus (Legacy: bis < ab). Die Tafel sagt es so; ein eigener Schalter daneben wäre eine dritte Wahrheit.';

-- Woher der Stand kam: eine Zeile je Kartendomäne, ein Stand, keine Sicherungen (Betreiber: lokal/Stage ohne Ballast).
CREATE TABLE IF NOT EXISTS landscape_display_source (
    map_domain_id TEXT PRIMARY KEY REFERENCES map_domain (id),
    -- Legacys Stempel der Tafel (Unix-Sekunden der letzten Speicherung), als Text wie geliefert.
    stamp TEXT NOT NULL CHECK (stamp ~ '^[0-9]{1,12}$'),
    -- SHA-256 der Antwortdatei; an ihr erkennt der Prüfer, dass Datei und Tabelle zusammengehören.
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    -- Die Legacy-Datei, aus der die Vorgaben kamen, mit Commit (`ecosystem-display.js@d9ec0e669`).
    defaults_ref TEXT NOT NULL,
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE landscape_display_source IS
    'Herkunft der Darstellungstafel: Stempel und SHA-256 der Legacy-Antwort, Bezug der Vorgaben (WI-0064).';

-- ---------------------------------------------------------------------------
-- Die Werte einer Beschriftung, wie sie WIRKEN: eigener Wert, sonst die Tafel ihrer Art, sonst die Grundvorgabe.
-- ---------------------------------------------------------------------------

-- 🔴 EINE Stelle für die Regel. Die beiden Renderansichten und die Ableitung der Schriftläufe (`loadCurveRegions`) fragen hier;
-- eine Regel, die nur einen von dreien bindet, ist keine Regel (dieselbe Lehre wie bei Legacys Verkehrsmittel-Sperre).
-- Kein `_render`: sie wird nie ausgeliefert, sondern nur von Ansichten gelesen, die Martin mit dem Recht ihres Besitzers ausführt.
--
-- Das Band: ein eigenes Band gilt nur, wenn min UND max gesetzt sind (Legacy `avesmapsLabelImBand`: `hatEigenes` verlangt beide).
-- Fehlt eines, gilt das Band der Tafel für beide Enden; gibt es keine Tafelzeile, bleibt das halbe Band des Labels stehen (bisher).
-- Die Größe ist die Grundgröße der Art (z5). Legacy nimmt an dieser Stelle den Wert der Tafel bei der aktuellen Zoomstufe; eine
-- Ansicht liefert aber einen Wert je Beschriftung, und heute trägt jede Beschriftung ihre eigene Größe (WI-0064, Abweichungsliste).
CREATE OR REPLACE VIEW map_label_effective AS
SELECT l.id AS label_id,
    COALESCE(l.label_size, t.size_by_band[6])::numeric(4,1) AS label_size,
    CASE WHEN l.label_min_zoom IS NOT NULL AND l.label_max_zoom IS NOT NULL
         THEN l.label_min_zoom ELSE COALESCE(t.band_from, l.label_min_zoom) END::smallint AS label_min_zoom,
    CASE WHEN l.label_min_zoom IS NOT NULL AND l.label_max_zoom IS NOT NULL
         THEN l.label_max_zoom ELSE COALESCE(t.band_to, l.label_max_zoom) END::smallint AS label_max_zoom,
    COALESCE(l.label_priority, t.priority)::smallint AS label_priority,
    t.curve_max
   FROM map_label l
     LEFT JOIN LATERAL ( SELECT a.band_from, a.band_to, a.curve_max, a.priority, a.size_by_band
           FROM landscape_display_art a
          WHERE a.map_domain_id = l.map_domain_id AND (a.art_key = l.subtype OR a.art_key = '*')
          -- Die eigene Art zuerst, sonst die Grundvorgabe.
          ORDER BY (a.art_key = '*')
         LIMIT 1) t ON true
  WHERE l.is_active;

COMMENT ON VIEW map_label_effective IS
    'Die Werte einer Beschriftung, wie sie wirken: eigener Wert, sonst Tafel der Art, sonst Grundvorgabe (WI-0064). Eine Zeile je aktive Beschriftung.';

-- ---------------------------------------------------------------------------
-- Die zwei Ansichten der Namen. Vorlage ist die aktuelle Definition (render-definitions.sql), nicht eine ältere Fassung:
-- geändert sind allein die vier Werte und der Rang, dazu der Verweis auf `map_label_effective`. Spalten und Reihenfolge bleiben.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW landscape_label_run_render AS
SELECT r.id AS run_id,
    reg.public_id AS region_public_id,
    l.name,
    reg.region_layer,
    e.label_size,
    e.label_min_zoom,
    e.label_max_zoom,
    e.label_priority,
    r.instance,
    r.instance_count,
    r.run_min_zoom,
    r.run_max_zoom,
    r.name_width_px,
    map_domain_to_render(reg.map_domain_id, r.geom)::geometry(LineString,3857) AS geom,
    label_collision_rank(NULL::smallint, e.label_priority, e.label_min_zoom) AS collision_rank,
    reg.region_type,
    l.subtype AS label_type
   FROM landscape_label_run r
     JOIN region reg ON reg.id = r.region_id
     JOIN map_label l ON l.id = r.style_label_id
     JOIN map_label_effective e ON e.label_id = l.id
  WHERE reg.is_active AND l.is_active
  ORDER BY reg.public_id, r.instance_count, r.instance;

CREATE OR REPLACE VIEW map_label_render AS
SELECT l.public_id,
    l.name,
    e.label_size,
    e.label_min_zoom,
    e.label_max_zoom,
    e.label_priority,
    reg.public_id AS region_public_id,
    reg.region_layer,
    (EXISTS ( SELECT 1
           FROM landscape_label_run r
          WHERE r.region_id = l.region_id)) AS has_curve_run,
    map_domain_to_render(l.map_domain_id, l.geom)::geometry(Point,3857) AS geom,
    label_collision_rank(NULL::smallint, e.label_priority, e.label_min_zoom) AS collision_rank,
    reg.region_type,
    l.subtype AS label_type
   FROM map_label l
     JOIN map_label_effective e ON e.label_id = l.id
     LEFT JOIN region reg ON reg.id = l.region_id AND reg.is_active
  WHERE l.is_active
  ORDER BY l.public_id;
