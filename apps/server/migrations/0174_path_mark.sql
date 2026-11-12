-- 0174: Wege „Karawanenroute“ als Kennzeichen über dem Wegtyp (WI-0177 §30; Betreiber 2026-10-18, wörtlich: „kannst du nicht die
-- werte übernehmen, die es in legacy hat UND einen neuen typ machen?“; Entwurf Fassung 2 abgenommen: „karawanenrouten sind schön ->
-- machen“).
--
--   1. `path.mark`: das Kennzeichen des Abschnitts, `karawanenroute` oder leer. Es ist ein sichtbarer Typ OHNE Reisewerte: Tempo,
--      Reisemittel, Eiltempo und Unterbringung kommen weiter von `subtype`, und kein Leser der Wegfindung liest die Spalte. Eine
--      Straße mit Kennzeichen sind die Abschnitte gleichen Namens und gleichen Kennzeichens, auch auf verschiedenem Wegtyp.
--   2. Der Trigger `path_revision` (zuletzt 0172) zählt auch `mark`: Das Kennzeichen ist eine fachliche Änderung mit Revision.
--   3. `path_render` trägt `mark` am Ende (Kacheleigenschaft für die Punktreihe). 🪤 `CREATE OR REPLACE VIEW` schreibt die GANZE Sicht
--      neu: Vorlage ist die letzte Fassung (0172), unverändert bis auf die neue Spalte am Ende.
--   4. Die Wegnamen tragen das Kennzeichen ihrer Kette: `path_label_run_render` (zuletzt 0025) bekommt `mark` am Ende, nachgeschlagen
--      an einem Abschnitt derselben Kette (Name und Wegtyp), und `path_label_run_tile` (zuletzt 0030) liefert es aus. Die Schriftläufe
--      selbst bleiben, wie sie sind: Die Ableitung kennt das Kennzeichen nicht, und ein neues Kennzeichen braucht keinen neuen Lauf.
--      Der Teilindex hält das Nachschlagen klein (nur Abschnitte mit Kennzeichen).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine Spalte ohne Vorgabe (nullable, der CHECK gilt nur ihr), derselbe Trigger mit einer
-- Spalte mehr, zwei Sichten mit einer Spalte mehr am Ende, die Kachelfunktion mit derselben Signatur und einer Eigenschaft mehr. Das
-- vorige Release liest und schreibt die Spalte nie. 🔴 Der Legacy-Wegeimport (`migration/paths.ts`) schreibt sie nie (Test in
-- `paths.test.ts`): Legacy kennt Karawanenrouten nur als Wiki-Art. Kein Abschnitt bekommt hier ein Kennzeichen. Die Rechte der
-- App-Rolle stehen in `apps/server/src/db/map-grants.psql`.

ALTER TABLE path ADD COLUMN IF NOT EXISTS mark TEXT CHECK (mark IS NULL OR mark IN ('karawanenroute'));

COMMENT ON COLUMN path.mark IS
    'Kennzeichen über dem Wegtyp (WI-0177 §30, Betreiber 2026-10-18): karawanenroute oder NULL. Ohne Reisewerte - Tempo und Reisemittel kommen von subtype. Linie (Punktreihe), Namensfarbe, Wegeliste und Infopanel lesen es. Der Legacy-Wegeimport schreibt die Spalte nie.';

CREATE INDEX IF NOT EXISTS path_mark_chain
    ON path (map_domain_id, name, subtype)
    WHERE mark IS NOT NULL AND is_active;

CREATE OR REPLACE TRIGGER path_revision
    BEFORE UPDATE OF map_domain_id, name, subtype, label_visible, is_bach, geom, is_active, off_map, is_tunnel, mark,
                     flow_direction, allowed_transports, transport_domain, transport_seasons, flow_factor, source_system,
                     legacy_public_id, revision
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
    p.is_tunnel,
    p.mark
FROM path p
LEFT JOIN path_visual v ON v.path_id = p.id
WHERE p.is_active
ORDER BY p.public_id;

COMMENT ON VIEW path_render IS
    'Wegabschnitte fuer die Kachel, mit der GEZEICHNETEN Kurve aus path_visual (Rueckfall: die rohe Geometrie, 0024). Feste Reihenfolge nach public_id (0016). Traegt seit 0028 die Fliessrichtung fuer die Stroemungspfeile. 0029 stellt die Kurve wieder her, die 0028 verloren hatte. 0172: is_tunnel am Ende, fuer die gestrichelte Linie. 0174: mark am Ende, fuer die Punktreihe der Karawanenroute.';

CREATE OR REPLACE VIEW path_label_run_render AS
SELECT
    r.name,
    r.subtype,
    r.part,
    r.instance,
    r.instance_count,
    r.run_min_zoom,
    r.run_max_zoom,
    r.name_width_px,
    map_domain_to_render(r.map_domain_id, r.geom)::geometry(LineString, 3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
    k.mark
FROM path_label_run r
LEFT JOIN LATERAL (
    SELECT p.mark
      FROM path p
     WHERE p.map_domain_id = r.map_domain_id AND p.name = r.name AND p.subtype = r.subtype
       AND p.mark IS NOT NULL AND p.is_active
     LIMIT 1
) k ON TRUE
ORDER BY r.name, r.subtype, r.part, r.instance;

COMMENT ON VIEW path_label_run_render IS
    'Wegnamen-Schriftlaeufe im Darstellungsraum (0025). 0174: mark am Ende, das Kennzeichen eines Abschnitts derselben Kette (Name und Wegtyp), fuer die Namensfarbe der Karawanenroute.';

CREATE OR REPLACE FUNCTION path_label_run_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    units_per_pixel double precision := (2 * 20037508.342789244) / (512.0 * power(2, z));
    tile bytea;
BEGIN
    SELECT ST_AsMVT(
               source,
               'path_label_run'
               ORDER BY source.name, source.subtype, source.part, source.instance, source.candidate
           )
    INTO tile
    FROM (
        SELECT
            run.name,
            run.subtype,
            run.part,
            run.instance,
            run.instance_count,
            run.collision_rank,
            kandidat.ordnung AS candidate,
            ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom,
            run.mark
        FROM path_label_run_render run
        CROSS JOIN LATERAL (
            SELECT run.name_width_px * units_per_pixel AS target, NULLIF(ST_Length(run.geom), 0) AS laenge
        ) need
        -- Reihenfolge = Vorrang: erst die Mitte, dann nah, dann weiter, je abwechselnd.
        CROSS JOIN LATERAL (
            VALUES (0, 0.0), (1, 0.125), (2, -0.125), (3, 0.25), (4, -0.25)
        ) AS kandidat(ordnung, versatz)
        CROSS JOIN LATERAL (
            SELECT 0.5 + kandidat.versatz * need.target / need.laenge AS mitte,
                   (need.target / 2.0) / need.laenge AS halb
        ) lage
        CROSS JOIN LATERAL (
            SELECT GREATEST(0.0, lage.mitte - lage.halb) AS lo,
                   LEAST(1.0, lage.mitte + lage.halb) AS hi
        ) cut
        WHERE z BETWEEN run.run_min_zoom AND run.run_max_zoom
          AND (
                kandidat.ordnung = 0
                OR (lage.mitte - lage.halb >= 0.0 AND lage.mitte + lage.halb <= 1.0)
              )
          AND ST_Intersects(
                  ST_LineInterpolatePoint(run.geom, 0.5),
                  ST_Expand(envelope, GREATEST(need.target, ST_Length(run.geom)) / 2.0)
              )
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$;
