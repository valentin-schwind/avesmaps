-- Die Klimazonen tragen ihren Namen an beiden Kartenrändern (WI-0012).
--
-- 🪤 DIESE MIGRATION EXISTIERT WEGEN EINES FEHLSCHLUSSES VON MIR. Am 2026-09-22 habe ich gemeldet,
-- Klimazonen hätten keine Beschriftung: `SELECT count(*) FROM map_label ... WHERE region_layer =
-- 'klima'` ergab null, und Legacys `label-arten.test.js` schließt `kind === "klima"` ausdrücklich
-- aus. Beide Messungen sagten etwas anderes, als ich las:
--
--   * Null Zeilen in `map_label` heißt „nicht DORT", nicht „nicht vorhanden".
--   * Legacys Ausschluss betrifft das AUSWAHLFELD der Landschaftsarten im Editor, nicht die Karte.
--
-- Der Betreiber hat widersprochen („Doch es gibt Klimalabels, check avesmaps live"), und die
-- laufende Karte gibt ihm recht. Gegen `api/app/ecosystem-areas.php` live geprüft (Revision 63895):
-- alle acht Zonen führen `region_label_count = 0` — und werden trotzdem beschriftet.
--
-- ⭐ DER NAME IST DER REGIONSNAME DER FLÄCHE, kein Label-Objekt. Genau deshalb findet ihn keine
-- Abfrage auf die Labeltabelle. Bei uns steht derselbe Text längst in `climate_zone_type.label`
-- („Boreale Zone", „Subtropische Wüstenzone", …) — es fehlte nie ein Datum, nur die Ableitung.

-- ---------------------------------------------------------------------------
-- Die Position: beide Kartenränder, je auf der Bandmitte AN DIESER KANTE
-- ---------------------------------------------------------------------------

-- 💣 BEIDE Kanten, und jede für sich gemessen. Legacys Begründung, wörtlich: „Die Karte ist 1024
-- breit; wer rechts arbeitet, hatte die Beschriftung ausserhalb des Bildschirms. Jede Kante wird
-- für sich gemessen -- bei einer schrägen Grenze liegt die Bandmitte links woanders als rechts,
-- und ein gespiegelter Wert wäre dort daneben."
--
-- 🪤 Ein zu dünnes Band bekommt KEINEN Namen. Auch das ist Legacys Regel: „dann lieber kein Name
-- als einer, der in die Nachbarzone ragt und sie mitbeschriftet." Die Schwelle ist dieselbe (8
-- Karteneinheiten).
CREATE OR REPLACE FUNCTION climate_band_edge_span(band geometry, edge_x double precision)
RETURNS TABLE (y_min double precision, y_max double precision)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    -- Der Schnitt des Bandes mit der Senkrechten an dieser Kante. Ein Band reicht über die volle
    -- Kartenbreite, also trifft die Senkrechte es immer - außer das Band endet vorher.
    SELECT ST_YMin(schnitt), ST_YMax(schnitt)
    FROM (
        SELECT ST_Intersection(
                   band,
                   ST_SetSRID(ST_MakeLine(ST_MakePoint(edge_x, 0), ST_MakePoint(edge_x, 1024)), 0)
               ) AS schnitt
    ) s
    WHERE NOT ST_IsEmpty(schnitt);
$$;

COMMENT ON FUNCTION climate_band_edge_span(geometry, double precision) IS
    'Von wo bis wo reicht ein Klimaband an einer Kartenkante? Grundlage der Namensposition (WI-0012). Jede Kante wird fuer sich gemessen - bei einer schraegen Grenze liegt die Bandmitte links woanders als rechts.';

CREATE OR REPLACE VIEW climate_label_render AS
SELECT
    b.type_key,
    t.label AS name,
    kante.seite,
    t.sort_order,
    map_domain_to_render(
        'aventuria',
        ST_SetSRID(ST_MakePoint(kante.x, (span.y_min + span.y_max) / 2.0), 0)
    )::geometry(Point, 3857) AS geom,
    -- Dieselbe Kette wie jede andere Beschriftung (Migration 0017). Klimazonen tragen weder eine
    -- Klassenordnung noch eine redaktionelle Prioritaet - sie stehen alle gleich, und zwischen
    -- ihnen entscheidet die Kachelreihenfolge.
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank
FROM climate_band b
JOIN climate_zone_type t ON t.type_key = b.type_key
CROSS JOIN LATERAL (VALUES ('west', 0.0), ('ost', 1024.0)) AS kante(seite, x)
CROSS JOIN LATERAL climate_band_edge_span(b.geom, kante.x) AS span
WHERE t.is_active
  -- 🪤 Legacys Schwelle, unveraendert: ein Band unter 8 Karteneinheiten Hoehe bekommt an dieser
  -- Kante keinen Namen, weil er sonst in die Nachbarzone ragte.
  AND span.y_max - span.y_min >= 8
-- Feste Reihenfolge wie in 0016. `type_key` plus Seite ist der stabile Schluessel; `sort_order`
-- allein waere bei zwei Kanten mehrdeutig.
ORDER BY b.type_key, kante.seite;

COMMENT ON VIEW climate_label_render IS
    'Namen der Klimazonen, je Band an beiden Kartenraendern (WI-0012). Der Text stammt aus climate_zone_type.label - in Legacy ist es der Regionsname der Flaeche, kein Label-Objekt; deshalb findet ihn keine Abfrage auf map_label.';
