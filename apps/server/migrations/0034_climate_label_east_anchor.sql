-- Der Ostanker der Klimanamen liegt eine Kacheleinheit INNERHALB der Welt (Befund 2026-09-23).
--
-- 💣 Migration 0021 setzte ihn auf x = 1024. Die Domäne 0…1024 wird exakt auf die Welt abgebildet,
-- der Punkt lag also genau auf ihrem Ostrand. In der Kachel steht er dort auf x = extent, und
-- MapLibre verwirft jeden Symbolanker außerhalb von [0, extent) — er überlässt ihn der
-- Nachbarkachel, und östlich des Weltrands gibt es keine. Die Kachel lieferte alle 16 Punkte,
-- gezeichnet wurden die 8 im Westen: x = 0 liegt im halboffenen Intervall, x = extent nicht.
--
-- ⭐ GEMESSEN wird die Bandmitte weiter genau an der Kante (Legacys Regel, unverändert). Nur der
-- Anker rückt nach innen, um 1024 / 4096 = 0,25 Karteneinheiten: eine Kacheleinheit auf z0, die
-- kleinste Verschiebung, die auf jeder Quellstufe z0–z8 innen liegt (z0: 4095, z8: 3840). Sichtbar
-- sind bis z4 höchstens 2 px, bei z8 am äußersten Rand 32 px. Betreiberentscheidung 2026-09-23:
-- die Sicht anpassen statt einer eigenen Kachelfunktion.
--
-- 🪤 Die Zahl hängt an Martins extent 4096. Mit einem kleineren extent läge der Anker auf z0 wieder
-- auf dem Rand; `climate.test.ts` prüft deshalb die Lage in der Kachel, nicht diese Konstante.
--
-- Nur die Sicht ändert sich: keine Zeile in climate_divider, climate_band oder climate_zone_type.
-- Vorlage ist die aktuelle Definition aus `render-definitions.sql` — seit 0021 unverändert.
CREATE OR REPLACE VIEW climate_label_render AS
SELECT
    b.type_key,
    t.label AS name,
    kante.seite,
    t.sort_order,
    map_domain_to_render(
        'aventuria',
        ST_SetSRID(ST_MakePoint(kante.anker_x, (span.y_min + span.y_max) / 2.0), 0)
    )::geometry(Point, 3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank
FROM climate_band b
JOIN climate_zone_type t ON t.type_key = b.type_key
-- `x` ist die Kante, an der das Band gemessen wird, `anker_x` der Punkt, an dem der Name steht.
CROSS JOIN LATERAL (VALUES ('west', 0.0, 0.0), ('ost', 1024.0, 1024.0 - 1024.0 / 4096)) AS kante(seite, x, anker_x)
CROSS JOIN LATERAL climate_band_edge_span(b.geom, kante.x) AS span
WHERE t.is_active
  -- 🪤 Legacys Schwelle, unveraendert: ein Band unter 8 Karteneinheiten Hoehe bekommt an dieser
  -- Kante keinen Namen, weil er sonst in die Nachbarzone ragte.
  AND span.y_max - span.y_min >= 8
ORDER BY b.type_key, kante.seite;

COMMENT ON VIEW climate_label_render IS
    'Namen der Klimazonen, je Band an beiden Kartenraendern (WI-0012). Der Ostanker liegt eine Kacheleinheit innerhalb der Welt, sonst verwirft MapLibre ihn (Migration 0034). Der Text stammt aus climate_zone_type.label - in Legacy ist es der Regionsname der Flaeche, kein Label-Objekt; deshalb findet ihn keine Abfrage auf map_label.';
