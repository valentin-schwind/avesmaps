-- Der Seegraph des freien Seeroutings (WI-0046, Betreiber 2026-09-27: „Sichtbarkeitsgraph mit
-- A*-Brücken ist entschieden“; „die vorberechnung muss von und durch editoren angestoßen werden können“).
--
-- DERIVED DATA. Abgeleitet aus Meer, Seen, Häfen (`place.is_seaport`) und dem bevorzugten
-- Küstenabstand je Seeschiff (`kuestenfahrt` im Reisemodell) durch `npm run derive:sea-routes`;
-- geprüft durch `npm run verify:sea-routes`. Keine redaktionellen Daten: Wer ihn löscht, leitet ihn neu ab.
--
-- Eine Zeile je Kartendomäne. `graph` ist das kompakte Binärformat aus `sea-graph-store.ts`: Knoten,
-- Kanten, Aufschläge je Schiff, Brückenlinien, die Häfen mit ihrer Anlegestelle, die Längen von Hafen
-- zu Hafen je Schiff und die Wassermaske. Der Routing-Worker liest nur diese Zeile (Claudio 2026-09-27:
-- ableiten beim Import, nicht im Worker, sonst träfe das Laden den `routing_timeout`).
CREATE TABLE IF NOT EXISTS sea_route_graph (
    map_domain_id TEXT PRIMARY KEY REFERENCES map_domain (id),
    -- Womit und woraus er entstand. Ändert sich eines von beiden, ist er veraltet.
    algorithm_version TEXT NOT NULL,
    source_fingerprint TEXT NOT NULL,
    graph BYTEA NOT NULL,
    stats JSONB NOT NULL,
    derived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sea_route_graph IS
    'Seegraph des freien Seeroutings (WI-0046): Sichtbarkeitsgraph mit A*-Bruecken, je Kartendomaene eine Zeile, Binaerformat aus sea-graph-store.ts. DERIVED DATA aus Meer, Seen, Haefen und kuestenfahrt; derive:sea-routes, verify:sea-routes.';
