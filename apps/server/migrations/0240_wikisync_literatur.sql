-- 0240: WikiSync kennt die Literatur als Bereich (WI-0253, Scheibe Literatur; Vali 2026-10-26: „alles über WikiSync, zuerst Gipfel, dann Literatur, …“ und
-- „jetzt warten wir erstmal ab, ob wikisync die bestehenden einträge verknüpft bevor wir neue laden“).
--
--   Ein Werk der Spielliteratur (`adventure`, Migration 0068) wird mit seinem Wiki-Artikel (`{{Infobox Produkt}}`) verglichen, über die gespeicherte Adresse
--   (`adventure.wiki_url`); übernommen werden die Felder, die Legacys Literatur-Abgleich aus der Infobox setzt (Titel, Werkart, Regeln, Genre, Komplexität, Autoren,
--   Reihe, F-Shop-Nummer). Angelegt wird nichts: Ein Artikel ohne Werk ist nur ein Befund.
--
--   Die Tafeln des WikiSync (0224, 0225) nennen ihre Bereiche und die Arten der Objekte in je einem CHECK. Sie lernen je ein Wort:
--
--   1. der Bereich `literatur` in `wikisync_lauf.bereiche`, `wikisync_lauf_zeile.bereich`, `wikisync_bereich_setting.bereich` und `wikisync_uebernahme.bereich`;
--   2. die Art `work` (ein Werk, `adventure.public_id`) in `wikisync_lauf_zeile.objekt_art` und `wikisync_uebernahme_befund.objekt_art`.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): nur gelockerte Prüfungen, jedes bisherige Wort bleibt erlaubt; das vorige Release schreibt keines der neuen. Keine Tafel, keine
-- Spalte, keine Datenänderung. Die Rechte der Jobs-Rolle an `adventure` und `adventure_field_origin` stehen in `apps/server/src/db/system-grants.psql` (hinter JEDE Migration).

ALTER TABLE wikisync_lauf DROP CONSTRAINT IF EXISTS wikisync_lauf_bereiche_bekannt;
ALTER TABLE wikisync_lauf
    ADD CONSTRAINT wikisync_lauf_bereiche_bekannt CHECK (
        cardinality(bereiche) >= 1
        AND bereiche <@ ARRAY['ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur']::text[]
    );

ALTER TABLE wikisync_lauf_zeile DROP CONSTRAINT IF EXISTS wikisync_lauf_zeile_bereich_check;
ALTER TABLE wikisync_lauf_zeile
    ADD CONSTRAINT wikisync_lauf_zeile_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur')
    );

ALTER TABLE wikisync_lauf_zeile DROP CONSTRAINT IF EXISTS wikisync_lauf_zeile_objekt_art_check;
ALTER TABLE wikisync_lauf_zeile
    ADD CONSTRAINT wikisync_lauf_zeile_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work', 'article')
    );

ALTER TABLE wikisync_bereich_setting DROP CONSTRAINT IF EXISTS wikisync_bereich_setting_bereich_check;
ALTER TABLE wikisync_bereich_setting
    ADD CONSTRAINT wikisync_bereich_setting_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur')
    );

ALTER TABLE wikisync_uebernahme DROP CONSTRAINT IF EXISTS wikisync_uebernahme_bereich_check;
ALTER TABLE wikisync_uebernahme
    ADD CONSTRAINT wikisync_uebernahme_bereich_check CHECK (
        bereich IN ('ort', 'weg', 'gebiet', 'region', 'gipfel', 'kraftlinie', 'literatur')
    );

ALTER TABLE wikisync_uebernahme_befund DROP CONSTRAINT IF EXISTS wikisync_uebernahme_befund_objekt_art_check;
ALTER TABLE wikisync_uebernahme_befund
    ADD CONSTRAINT wikisync_uebernahme_befund_objekt_art_check CHECK (
        objekt_art IN ('place', 'path', 'region', 'territory', 'powerline', 'peak', 'work')
    );
