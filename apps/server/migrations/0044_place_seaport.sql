-- Seehafen aus Legacy (WI-0041). Wie is_nodix liegt das Merkmal dort im properties_json, ohne
-- eigene Spalte und ohne Legacy-Migration (Legacy-Commit c13ad72db, 2026-09-26).
--
-- Fuer das spaetere freie Seerouting: Haefen sind die Punkte, an denen man aufs Meer geht und
-- wieder an Land kommt. Hier nur die verlustfreie Uebernahme, ohne jede Wirkung -- kein Rendering,
-- kein Routing, keine Suche (Betreiber 2026-09-26, WI-0041).
ALTER TABLE place ADD COLUMN IF NOT EXISTS is_seaport BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN place.is_seaport IS
    'Aus Legacy verlustfrei uebernommen (WI-0041). Legacy setzt es automatisch bei Seeweg-Anbindung und sonst von Hand; hier noch ohne Verhalten, Grundlage fuer das spaetere freie Seerouting.';
