-- 0183: Herkunft je Feld für die Wiki-Felder aller Editoren (WI-0225; EDIT-0003 G6, F24; Modell c der Editor-Orchestrierung 2026-10-18;
-- Design Guide §13.8 „Ein Wiki-Feld bauen“).
--
--   Ein Feld mit Wiki-Wert (Name eines Wegs, Art einer Derographie-Fläche, Beschreibung einer Kraftlinie …) hat eine Herkunft: `wiki`
--   (zuletzt per ↺ auf den Wiki-Wert gesetzt) oder `manual` (getippt, auch wenn der Wortlaut dem Wiki gleicht). ↺ setzt Wert UND
--   Herkunft wiki; die eigene Spalte am Objekt (`path.name`, `region.region_type`, `powerline.description` …) bleibt der WIRKSAME
--   Wert. Kein Leser ändert sich, keine NULL-Bedeutung ändert sich, keine NOT-NULL-Spalte wird nullbar (verworfen: „NULL folgt dem
--   Wiki“, WI-0225 §2). Der Wiki-Wert selbst steht weiter nur im Schnappschuss der Art (`wiki_*_snapshot`).
--
-- EINE Tafel für alle Arten, in der Form von `territory_detail_field_origin` (0076): Art, Objekt, Feld, Herkunft; nur der Vermerk, nie
-- ein Wert. Die Art und die Kennung wie die Sperre der Editoren (`editor_lock`, 0138): `object_kind` aus dem Register der Handgriffe,
-- `object_id` die öffentliche Kennung. Darum kein Fremdschlüssel (eine Kennung, fünf Tafeln); ein stillgelegtes Objekt behält seinen
-- Vermerk, wie es seine Spalten behält. Welche Felder eine Art hier führt, steht allein in `packages/shared/src/feld-herkunft.ts`
-- (`FELD_HERKUNFT_FELDER`), nicht als CHECK: Eine Art dockt mit einer Zeile dort an, ohne Migration.
--
-- 🔴 Ort und Herrschaftsgebiet behalten ihre Herkunft, wo sie schon steht: `place_detail.*_origin` (Einwohner, Lage, Oberhaupt) und
-- `territory_detail_field_origin` (die 17 Detailfelder). Beide schreibt der Legacy-Zug, und der wird dafür nicht umgebaut. Ein Feld hat
-- seine Herkunft an genau EINER Stelle; diese Tafel trägt alle übrigen.
--
-- 🔴 Legacy-Zug und Wiki-Abgleich sind zweierlei (WI-0225 §2). Bis zum Cutoff überschreibt der Zug weiter ALLES, auch Felder mit
-- Herkunft manual, und schreibt diese Tafel nicht. Ein Vermerk kann danach veraltet sein; das Wiki-Feld bleibt trotzdem richtig, weil
-- es den Zustand aus Wert und Wiki-Wert rechnet und die Herkunft nur „folgt dem Wiki“ von „gleicher Wert“ trennt (beide sehen gleich
-- aus, `wikiLage` in `apps/web/src/fenster/wiki-feld.ts`). Felder mit Herkunft wiki nachzuziehen ist Sache des Wiki-Abgleichs.
--
-- Rechte: In public gibt die Default-Privilegie der Migrationsrolle der App-Rolle SELECT, INSERT, UPDATE, DELETE; die Editoren setzen
-- den Vermerk mit „Fertig“ (`INSERT … ON CONFLICT DO UPDATE`), gelöscht wird nie. `apps/server/src/db/map-grants.psql` nimmt ihr
-- DELETE und TRUNCATE.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine neue Tafel, die das vorige Release nie liest.

CREATE TABLE IF NOT EXISTS field_origin (
    object_kind TEXT NOT NULL CHECK (object_kind IN ('place', 'path', 'landscape', 'territory', 'powerline')),
    object_id UUID NOT NULL,
    field TEXT NOT NULL CHECK (field ~ '^[a-z][a-z0-9_]*$' AND length(field) <= 64),
    origin TEXT NOT NULL CHECK (origin IN ('wiki', 'manual')),
    set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (object_kind, object_id, field)
);

COMMENT ON TABLE field_origin IS
    'Herkunft je Feld mit Wiki-Wert (WI-0225, Modell c): wiki = per ↺ auf den Wiki-Wert gesetzt, manual = getippt. Nur der Vermerk, der wirksame Wert bleibt in der Spalte des Objekts; Ort und Gebietsdetails führen ihre Herkunft in place_detail und territory_detail_field_origin.';
COMMENT ON COLUMN field_origin.object_id IS
    'Öffentliche Kennung des Objekts (public_id), wie editor_lock.object_id; ohne Fremdschlüssel.';
