-- 0242: WikiSync kennt die Quellen als Bereich (WI-0253, Scheibe Quellen; Vali 2026-10-26: „jetzt warten wir erstmal ab, ob wikisync die bestehenden einträge verknüpft bevor wir
-- neue laden“).
--
--   Die Publikationen eines Artikels (Abschnitt „Publikationen“: „Beschrieben“, „Ergänzend“, „Erwähnt“) werden mit den Verknüpfungen seines Trägers (`place_source`,
--   `path_source`, `territory_source`, `region_source`, `terrain_peak_source`) und mit der Katalogquelle (`feature_source`) verglichen. Das Objekt der Zeilen ist die Quelle; übernommen
--   werden an einer Verknüpfung, die dem Wiki gehört, Art, Seiten und Notiz, an einer Quelle, die nicht der Redaktion gehört, der Titel. Angelegt oder still gelegt wird nichts:
--   „neu zitiert“ und „nicht mehr zitiert“ sind Befunde mit Zahl.
--
--   Die Tafeln des WikiSync (0224, 0225) nennen ihre Bereiche und die Arten der Objekte in je einem CHECK. Sie lernen je ein Wort:
--
--   1. der Bereich `quelle` in `wikisync_lauf.bereiche`, `wikisync_lauf_zeile.bereich`, `wikisync_bereich_setting.bereich` und `wikisync_uebernahme.bereich`;
--   2. die Art `source` (eine Katalogquelle, `feature_source.public_id`) in `wikisync_lauf_zeile.objekt_art` und `wikisync_uebernahme_befund.objekt_art`.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): nur gelockerte Prüfungen, jedes bisherige Wort bleibt erlaubt; das vorige Release schreibt keines der neuen. Keine Tafel, keine
-- Spalte, keine Datenänderung. Die Rechte der Jobs-Rolle an `feature_source` und den fünf Verknüpfungstafeln stehen in `apps/server/src/db/system-grants.psql` (hinter JEDE Migration).

ALTER TABLE wikisync_lauf DROP CONSTRAINT IF EXISTS wikisync_lauf_bereiche_bekannt;
ALTER TABLE wikisync_lauf
    ADD CONSTRAINT wikisync_lauf_bereiche_bekannt CHECK (
        cardinality(bereiche) >= 1
        AND bereiche <@ ARRAY['ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle']::text[]
    );

ALTER TABLE wikisync_lauf_zeile DROP CONSTRAINT IF EXISTS wikisync_lauf_zeile_bereich_check;
ALTER TABLE wikisync_lauf_zeile
    ADD CONSTRAINT wikisync_lauf_zeile_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle')
    );

ALTER TABLE wikisync_lauf_zeile DROP CONSTRAINT IF EXISTS wikisync_lauf_zeile_objekt_art_check;
ALTER TABLE wikisync_lauf_zeile
    ADD CONSTRAINT wikisync_lauf_zeile_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'source', 'article')
    );

ALTER TABLE wikisync_bereich_setting DROP CONSTRAINT IF EXISTS wikisync_bereich_setting_bereich_check;
ALTER TABLE wikisync_bereich_setting
    ADD CONSTRAINT wikisync_bereich_setting_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle')
    );

ALTER TABLE wikisync_uebernahme DROP CONSTRAINT IF EXISTS wikisync_uebernahme_bereich_check;
ALTER TABLE wikisync_uebernahme
    ADD CONSTRAINT wikisync_uebernahme_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur', 'quelle')
    );

ALTER TABLE wikisync_uebernahme_befund DROP CONSTRAINT IF EXISTS wikisync_uebernahme_befund_objekt_art_check;
ALTER TABLE wikisync_uebernahme_befund
    ADD CONSTRAINT wikisync_uebernahme_befund_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'source')
    );
