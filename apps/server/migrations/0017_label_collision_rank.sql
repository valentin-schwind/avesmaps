-- Label-Kollisionsprioritäten: wer bleibt stehen, wenn zwei Namen denselben Platz wollen (WI-0007).
--
-- 🔴 DER ANLASS IST EIN GEMESSENER FEHLER. Bei z2 bewerben sich 928 Namen um 44 Plätze. Bis heute
-- entschied dort die Zeilenreihenfolge der Kachel, also seit Migration 0016 die `public_id` - eine
-- UUID. 0016 sagt das selbst: „Der Schlüssel ist ein Tie-Breaker, keine Priorität." Genau das wird
-- hier nachgeholt. Der belegte Fall ist Albernia (Finding MCS-010): eine Provinz, die gegen neun
-- Nachbarn mit identischer Priorität verliert, weil ihre UUID mit `f2d0` beginnt und deren mit
-- `053a` bis `ea7b`. Ein Sortierschlüssel entscheidet, was auf der Karte steht.
--
-- 💣 UND EINE RICHTUNG, DIE HEUTE VERKEHRT HERUM WIRKT. Der Style setzt `symbol-sort-key` bisher
-- auf den rohen `label_priority`. MapLibre platziert den NIEDRIGEREN Wert zuerst; Legacy sortiert
-- `right.priority - left.priority` (`js/map-features/map-features-label-collisions.js:340`,
-- `js/map-features/label-placement.js:218`), also absteigend - HÖHER gewinnt. Der Regler im
-- Legacy-Editor läuft 1..5 mit Vorgabe 3. Wir haben die Skala bisher gespiegelt benutzt: das eine
-- Label mit Priorität 1 gewann alles, die beiden mit Priorität 4 verloren. Ab hier ist 5 stark.
--
-- ⭐ WARUM DER RANG IN DIE DATENBANK GEHÖRT UND NICHT IN EINEN MAPLIBRE-AUSDRUCK. Die Klassen-
-- ordnung soll laufzeitpflegbar sein (Betreiberpräzisierung 2026-09-21: nicht pro Objekt über-
-- schreibbar, aber auch keine feste Systemkonstante im Code). Ein Ausdruck im Frontend-Bundle ist
-- das Gegenteil davon - er ändert sich nur durch ein Release. Als Tabelle geändert, wirkt die
-- Ordnung über die nächste Kachel.

-- ---------------------------------------------------------------------------
-- 1. Die Klassenordnung als Daten
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS label_class_rank (
    scope TEXT NOT NULL CHECK (scope IN ('place')),
    class_key TEXT NOT NULL,
    -- Klein gewinnt, wie MapLibre `symbol-sort-key` liest. Lücken sind erwünscht: eine neue Klasse
    -- lässt sich dazwischenschieben, ohne die bestehenden umzunummerieren.
    rank SMALLINT NOT NULL CHECK (rank BETWEEN 0 AND 99),
    label TEXT NOT NULL,
    PRIMARY KEY (scope, class_key)
);

COMMENT ON TABLE label_class_rank IS
    'Globale Klassenpriorität der Kartenbeschriftung, zur Laufzeit pflegbar (WI-0007). Gilt für alle Objekte einer Klasse; pro Objekt NICHT überschreibbar - dafür ist label_priority da.';
COMMENT ON COLUMN label_class_rank.rank IS
    'Kleiner Wert gewinnt die Kollision. Lücken sind erwünscht, damit eine neue Klasse dazwischenpasst.';

-- Seed aus Legacys `AVESMAPS_LABEL_PRIORITY_BY_TYPE` (metropole 100 … dorf/gebaeude/stadtviertel
-- 60), in unsere Richtung gedreht. 🪤 Legacy gibt den drei untersten denselben Wert 60; wir
-- trennen sie, weil ein Gebäude neben einem Dorf sonst wieder per Sortierschlüssel entschieden
-- würde - also genau der Fehler, den dieses Work Item behebt. Das ist eine Abweichung mit Grund,
-- keine Übernahme.
INSERT INTO label_class_rank (scope, class_key, rank, label) VALUES
    ('place', 'metropole',    10, 'Metropole'),
    ('place', 'grossstadt',   20, 'Großstadt'),
    ('place', 'stadt',        30, 'Stadt'),
    ('place', 'kleinstadt',   40, 'Kleinstadt'),
    ('place', 'dorf',         50, 'Dorf'),
    ('place', 'stadtviertel', 60, 'Stadtviertel'),
    ('place', 'gebaeude',     70, 'Gebäude')
ON CONFLICT (scope, class_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Die redaktionelle Priorität für Orte
-- ---------------------------------------------------------------------------

-- Landschaftsbeschriftungen tragen sie seit 0010; Orte bisher nicht. Ohne sie hätte ein Editor
-- kein Mittel, zwei gleichrangige Dörfer gegeneinander zu gewichten - und die Kette bräche für
-- Orte nach der Klasse ab. NULL heißt „unbestimmt" und wird wie 3 gewertet, exakt wie Legacys
-- `Number(entry.label.priority) || 3`.
ALTER TABLE place ADD COLUMN IF NOT EXISTS label_priority SMALLINT
    CHECK (label_priority BETWEEN 1 AND 5);

COMMENT ON COLUMN place.label_priority IS
    'Redaktionelle Kollisionspriorität 1..5, 5 gewinnt (Legacy-Richtung). NULL = unbestimmt, wirkt wie 3. Verschiebt NIE über eine Klassengrenze.';

-- ---------------------------------------------------------------------------
-- 3. Die Formel an einer Stelle
-- ---------------------------------------------------------------------------

-- 💣 DIE ABSTÄNDE SIND DIE AUSSAGE. `class_stride` 1000 gegen höchstens 400 aus der redaktionellen
-- Priorität und höchstens 8 aus der Erscheinungsstufe: damit kann ein Editor innerhalb seiner
-- Klasse alles ordnen und eine Klassengrenze NIE überspringen. Das war die Betreiberentscheidung -
-- ein Dorf mit Priorität 5 schlägt keine Kleinstadt mit Priorität 1. Wer das ändern will, ändert
-- eine Zahl hier, nicht verstreute Vergleiche.
CREATE OR REPLACE FUNCTION label_collision_rank(
    class_rank SMALLINT,
    label_priority SMALLINT,
    appearance_zoom SMALLINT
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT COALESCE(class_rank, 0)::integer * 1000
         -- 5 gewinnt, MapLibre platziert klein zuerst - also gespiegelt. NULL wirkt wie 3.
         + (5 - COALESCE(label_priority, 3))::integer * 100
         -- Bei gleicher Priorität behält den Platz, was schon länger sichtbar war. Legacys
         -- Kommentar dazu wörtlich: „bei gleicher Priorität wird zuerst platziert, was schon
         -- länger sichtbar ist". Das ist der Fall Albernia: ab z1 sichtbar gegen Nachbarn ab z2.
         + COALESCE(appearance_zoom, 0)::integer;
$$;

COMMENT ON FUNCTION label_collision_rank(SMALLINT, SMALLINT, SMALLINT) IS
    'Kollisionsrang für symbol-sort-key: klein gewinnt. Kette Klasse -> redaktionelle Priorität -> Erscheinungsstufe. Gleichstand löst die Kachelreihenfolge aus 0016 auf (public_id), und nur dort ist sie ein Tie-Breaker.';

-- ---------------------------------------------------------------------------
-- 4. Der fertige Rang im Kachelinhalt
-- ---------------------------------------------------------------------------

-- 🪤 Der Rang wird HIER gerechnet, nicht im Style. Ein MapLibre-Ausdruck, der Klasse, Priorität
-- und Erscheinungsstufe selbst verrechnet, wäre dieselbe Formel ein zweites Mal - und beim
-- nächsten Layer ein drittes Mal anders. Die Kachel trägt eine Zahl, der Style liest sie.
--
-- Die Sortierung aus 0016 bleibt unverändert `public_id`: sie hält die Kachelbytes stabil und
-- entscheidet nur noch dort, wo der Rang gleich ist. Die Renderreihenfolge NACH dem Rang zu
-- sortieren wäre naheliegend und falsch - `symbol-sort-key` ordnet die Platzierung bereits, und
-- die Zeilenreihenfolge muss allein stabil sein.
-- 🪤 `collision_rank` steht HINTER `geom`, und das ist kein Schönheitsfehler. PostgreSQL lässt
-- eine Sicht nur am ENDE wachsen (`42P16: cannot change name of view column`); eine Spalte in der
-- Mitte erzwingt DROP + CREATE. Und ein `DROP VIEW` nimmt der Martin-Rolle das Leserecht - Claudio
-- hat das auf dem VPS gemessen (Handover `2026-09-20-runtime-foundation.md`), und
-- `render-grants.test.ts` wacht seither darüber. Der erste Entwurf dieser Migration hat genau
-- diesen Wächter fallen lassen. Die Sicht wächst deshalb am Ende: die Migration läuft ohne
-- Rechteverlust durch, und Martin findet die Geometriespalte über ihren Typ, nicht über ihre
-- Position.
CREATE OR REPLACE VIEW place_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.is_hidden,
    p.label_min_zoom_override,
    p.label_max_zoom_override,
    p.label_visible_override,
    p.label_size_override,
    -- 🪤 Die Erscheinungsstufe steckt bei Orten schon in der KLASSE: das Zoomband hängt am
    -- `subtype`, und gemessen am 2026-09-21 trägt kein einziger der 3426 aktiven Orte einen
    -- `label_min_zoom_override`. Innerhalb einer Klasse trägt der Term deshalb heute nichts bei -
    -- er greift erst, wenn ein Editor ein Erscheinen verschiebt, und dann genau in Legacys Sinn.
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom,
    label_collision_rank(cr.rank, p.label_priority, p.label_min_zoom_override) AS collision_rank
FROM place p
-- LEFT JOIN, nicht JOIN: eine Klasse ohne Zeile in der Rangtabelle darf einen Ort nicht von der
-- Karte nehmen. Sie landet dann auf Rang 0 und damit ganz oben - sichtbar falsch statt unsichtbar
-- verschwunden (Kap. 2.16: kein stilles Verschlucken).
LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = p.subtype
WHERE p.is_active
ORDER BY p.public_id;

CREATE OR REPLACE VIEW map_label_render AS
SELECT
    l.public_id,
    l.name,
    l.label_size,
    l.label_min_zoom,
    l.label_max_zoom,
    l.label_priority,
    -- Landschaftsbeschriftungen kennen keine Klassenordnung: Legacy hat für sie nur `priority`,
    -- und die 26 Typen tragen dort keinen Rang. Wir erfinden keinen - der Klassenterm ist 0, und
    -- der Rang lebt von Priorität und Erscheinungsstufe. Dass ein Landschaftsname einem Ortsnamen
    -- vorgeht, regelt bei uns die Layerreihenfolge (MCS-008), nicht ein Zahlenaufschlag wie
    -- Legacys `1000 + priority`.
    reg.public_id AS region_public_id,
    reg.region_layer,
    EXISTS (SELECT 1 FROM landscape_label_run r WHERE r.region_id = l.region_id) AS has_curve_run,
    map_domain_to_render(l.map_domain_id, l.geom)::geometry(Point, 3857) AS geom,
    label_collision_rank(NULL::smallint, l.label_priority, l.label_min_zoom) AS collision_rank
FROM map_label l
LEFT JOIN region reg ON reg.id = l.region_id AND reg.is_active
WHERE l.is_active
ORDER BY l.public_id;

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
    map_domain_to_render(reg.map_domain_id, r.geom)::geometry(LineString, 3857) AS geom,
    label_collision_rank(NULL::smallint, l.label_priority, l.label_min_zoom) AS collision_rank
FROM landscape_label_run r
JOIN region reg ON reg.id = r.region_id
JOIN map_label l ON l.id = r.style_label_id
WHERE reg.is_active
  AND l.is_active
ORDER BY reg.public_id, r.instance_count, r.instance;

-- Die Kachelfunktion reicht den Rang durch. Ihre Sortierung bleibt der fachliche Schlüssel aus
-- 0016; nur die Spaltenliste wächst.
CREATE OR REPLACE FUNCTION landscape_label_run_tile(z integer, x integer, y integer)
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
    SELECT ST_AsMVT(source, 'landscape_label_run' ORDER BY source.region_public_id, source.instance_count, source.instance)
    INTO tile
    FROM (
        SELECT
            run.run_id,
            run.region_public_id,
            run.name,
            run.region_layer,
            run.label_size,
            run.label_priority,
            run.collision_rank,
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
    'Schriftläufe je Zoom zugeschnitten, unbeschnitten ausgeliefert (ADR-0007). Feste Reihenfolge über das Aggregat: region_public_id, instance_count, instance - ein Tie-Breaker für gleiche Kachelbytes, keine Label-Priorität. Die trägt collision_rank (0017).';
