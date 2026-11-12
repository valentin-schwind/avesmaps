-- 0245: Der Wiki-Teil eines Bereichs wird wiederverwendet, wenn der Dump derselbe ist (WI-0253 §20 Nachtrag; Entscheidung Claudia 2026-10-27, Umsetzung).
--
--   Der Wiki-Teil (0226) kostet für Orte 110 Schritte zu 20 Sekunden, rund 37 Minuten. Er hängt an der Vorschau, aus der er entstand; rechnet jemand die Vorschau neu („WikiSync
--   starten“ tut das jedes Mal), ist der Wiki-Teil der alten nicht mehr der ihre, und alles wird noch einmal gefragt – auch wenn der Dump (die Datei, ihre SHA-256) derselbe ist und sich
--   an den Antworten des Wikis nichts ändert, was der Dump beschreibt. Ab jetzt kopiert ein neuer Wiki-Teil die fertigen, vollständig gelesenen Stände und Werte eines Bereichs aus dem
--   jüngsten früheren Wiki-Teil DESSELBEN Dumps (anderer Dump: liest neu; dieselbe Vorschau noch einmal: liest neu) und hängt die Planzeilen an die neue Vorschau wie sonst. Hier steht nur,
--   woher der Bereich kam, damit die Oberfläche es zeigen kann („Wiki-Teil vom … wiederverwendet“):
--
--   - `wiederverwendet_von`: der Lauf des Wiki-Teils, dessen Stände und Werte kopiert wurden (ohne Fremdschlüssel: Räumt `raeumeWikiTeileAb` den alten Lauf ab, bleibt die Nummer als Protokoll).
--   - `wiederverwendet_am`: wann dieser Bereich damals fertig wurde (sein `beendet_am`) – das Datum, das die Oberfläche nennt.
--   Beide NULL: Der Bereich wurde aus dem Wiki gelesen.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): zwei nullbare Spalten, die das vorige Release nie liest; keine Datenänderung, keine neue Tafel. Die Rechte stehen schon da (die Jobs-Rolle hat
-- INSERT, UPDATE, DELETE an den Tafeln des Wiki-Teils, `system-grants.psql`, Migration 0226); die App liest.

ALTER TABLE wikisync_wiki_teil_bereich ADD COLUMN IF NOT EXISTS wiederverwendet_von BIGINT;
ALTER TABLE wikisync_wiki_teil_bereich ADD COLUMN IF NOT EXISTS wiederverwendet_am TIMESTAMPTZ;

ALTER TABLE wikisync_wiki_teil_bereich DROP CONSTRAINT IF EXISTS wikisync_wiki_teil_bereich_wiederverwendet;
ALTER TABLE wikisync_wiki_teil_bereich
    ADD CONSTRAINT wikisync_wiki_teil_bereich_wiederverwendet CHECK ((wiederverwendet_von IS NULL) = (wiederverwendet_am IS NULL));

COMMENT ON COLUMN wikisync_wiki_teil_bereich.wiederverwendet_von IS
    'Der Lauf des Wiki-Teils, dessen fertige Stände und Werte dieser Bereich übernommen hat (gleicher Dump, WI-0253 §20); NULL: aus dem Wiki gelesen. Ohne Fremdschlüssel: ein Protokoll.';
COMMENT ON COLUMN wikisync_wiki_teil_bereich.wiederverwendet_am IS
    'Wann der übernommene Wiki-Teil dieses Bereichs fertig wurde; NULL: aus dem Wiki gelesen.';
