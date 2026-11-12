-- Die Fliessrichtung eines Flusses (WI-0010, V11 aus dem visuellen Katalog).
--
-- 🔴 SIE IST HIER EINE DARSTELLUNGSANGABE, KEIN ROUTINGATTRIBUT. Der Migrationsvertrag `paths.yaml`
-- sperrt `allowed_transports`, `transport_domain` und `befahrbar` weiterhin; `flow` ist seit dem
-- 2026-09-22 ausdruecklich ausgenommen, weil es ein BILD erzeugt, das der Betreiber bestellt hat:
-- die kleinen blauen Dreieckspfeile auf den Fluessen.
--
-- 💣 Der `factor`, der im Snapshot neben der Richtung steht, wird NICHT importiert. DAS waere das
-- Routingattribut (Legacy: 3 Dukaten stromauf gegen 1 stromab). Wer ihn spaeter holt, holt ihn mit
-- dem Travel-Modell in Stufe 3 - und nicht "schon mal in eine Spalte".
--
-- 🪤 NULL heisst "Richtung unbekannt" und ist ein gueltiger, haeufiger Zustand: 1245 von 6983 Wegen
-- tragen ueberhaupt eine Richtung. Legacy zeichnet fuer die uebrigen bewusst KEINEN Pfeil - so sieht
-- ein Editor sofort, wo die Richtung fehlt. Ein Vorgabewert 'forward' waere eine erfundene Aussage.

ALTER TABLE path ADD COLUMN IF NOT EXISTS flow_direction TEXT
    CHECK (flow_direction IS NULL OR flow_direction IN ('forward', 'reverse'));

COMMENT ON COLUMN path.flow_direction IS
    'Fliessrichtung entlang der gespeicherten Geometrie: forward = in Punktreihenfolge, reverse = entgegen. NULL = unbekannt, und das ist keine Luecke, sondern ein Befund (Legacy zeichnet dort keinen Pfeil). Darstellungsangabe, kein Routingattribut - der Kostenfaktor bleibt ausdruecklich liegen.';

-- 🪤 `CREATE OR REPLACE VIEW` und die neue Spalte ans ENDE, hinter `collision_rank`. PostgreSQL
-- laesst eine Sicht nur ERWEITERN (42P16), und ein `DROP VIEW` naehme der Kachelrolle ihr Leserecht
-- (auf Stage gemessen, Migration 0017).
CREATE OR REPLACE VIEW path_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.label_visible,
    p.is_bach,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(LineString, 3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
    p.flow_direction
FROM path p
WHERE p.is_active
ORDER BY p.public_id;

COMMENT ON VIEW path_render IS
    'Wegabschnitte fuer die Kachel. Feste Reihenfolge nach public_id (0016). Die Kettenbildung fuer die Beschriftung passiert NICHT hier - sie braucht eine eigene Relation, weil sie Abschnitte zusammenfasst. Traegt seit 0028 die Fliessrichtung fuer die Stroemungspfeile.';
