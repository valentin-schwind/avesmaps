-- 0172: Wege „Tunnel“ (WI-0177; Betreiber 2026-10-18, wörtlich: „Kannst du den "Wegen" das merkmal "Tunnel" hinzufügen? keine
-- besonderheit - nur dass es erwähnt wird (wie unterirdisch bei den Orten)“).
--
--   1. `path.is_tunnel`: Der Abschnitt läuft durch einen Tunnel. Infopanel und Wege-Fenster nennen es (wie `place.is_underground`,
--      0108). Nachträge des Betreibers 2026-10-18: „du kannst unterirdische wege (tunnel) auf der map gestrichelt darstellen“ und „der
--      tunnel hat doch eine einschränkung: er ist davon ausgenommen, dass man von/auf ihn querfeldein kann“. Die Linie wird also
--      gestrichelt (Farbe und Breite des Wegtyps bleiben), und die Wegfindung bindet einen Tunnel nicht querfeldein an; Tempo und
--      Reisemittel bleiben die des Wegtyps.
--   2. Der Trigger `path_revision` (0091, zuletzt 0150) zählt auch `is_tunnel`: Das Merkmal ist eine fachliche Änderung mit Revision.
--   3. `path_render` trägt `is_tunnel` am Ende (Kacheleigenschaft für die gestrichelte Linie). 🪤 `CREATE OR REPLACE VIEW` schreibt
--      die GANZE Sicht neu (0029): Vorlage ist die letzte Fassung (0029), unverändert bis auf die neue Spalte am Ende.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine Spalte mit Vorgabe `FALSE` (nur ein Katalogeintrag), dazu derselbe Trigger mit einer
-- Spalte mehr und dieselbe Sicht mit einer Spalte mehr am Ende (Kacheleigenschaften nur hinzufügen; ein alter Client liest sie nicht). Das vorige Release liest und schreibt die Spalte nie. Legacy kennt kein solches Feld: Der Legacy-Wegeimport
-- (`migration/paths.ts`) schreibt die Spalte nie, die Testwelt setzt sie zurück (`editor/testwelt.ts`). Die Rechte der App-Rolle stehen
-- in `apps/server/src/db/map-grants.psql`.

ALTER TABLE path ADD COLUMN IF NOT EXISTS is_tunnel BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN path.is_tunnel IS
    'Tunnel (WI-0177, Betreiber 2026-10-18): Der Abschnitt läuft durch einen Tunnel. Infopanel und Wege-Fenster nennen es, die Linie ist gestrichelt, die Wegfindung bindet ihn nicht querfeldein an. Der Legacy-Wegeimport schreibt die Spalte nie.';

CREATE OR REPLACE TRIGGER path_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, label_visible, is_bach, geom, is_active, off_map, is_tunnel, flow_direction,
                     allowed_transports, transport_domain, transport_seasons, flow_factor, source_system, legacy_public_id, revision
    ON path
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

CREATE OR REPLACE VIEW path_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.label_visible,
    p.is_bach,
    -- LEFT JOIN mit Rueckfall: eine fehlende Kurve darf keinen Weg von der Karte nehmen. Dann ist
    -- die Linie eckig statt unsichtbar, und `verify:path-visuals` meldet, dass sie fehlt.
    map_domain_to_render(p.map_domain_id, COALESCE(v.geom, p.geom))::geometry(LineString, 3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
    p.flow_direction,
    p.is_tunnel
FROM path p
LEFT JOIN path_visual v ON v.path_id = p.id
WHERE p.is_active
ORDER BY p.public_id;

COMMENT ON VIEW path_render IS
    'Wegabschnitte fuer die Kachel, mit der GEZEICHNETEN Kurve aus path_visual (Rueckfall: die rohe Geometrie, 0024). Feste Reihenfolge nach public_id (0016). Traegt seit 0028 die Fliessrichtung fuer die Stroemungspfeile. 0029 stellt die Kurve wieder her, die 0028 verloren hatte. 0172: is_tunnel am Ende, fuer die gestrichelte Linie.';
