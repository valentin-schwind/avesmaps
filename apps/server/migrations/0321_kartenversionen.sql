-- Mehrere Karten (Versionen) je Eintrag der Kartensammlung (WI-0287 Stufe 2, Teil A; Vali: „"Die Karte" darf mehrere einträge haben (das muss auch in der kartensammlung im frontend
-- sichtbar sein)“). Schritt ERWEITERN nach `docs/regeln/entwicklung.md`: Die Datenbank lässt mehrere aktive Karten (`map_full`) je Eintrag zu und kennt ihre Bezeichnung und
-- Reihenfolge; geschrieben wird beides erst mit dem Umstellen (Operationen `citymap.image` und `citymap.version`).
--
-- 1. `citymap_media.version_label`: die Bezeichnung einer Version („Spielerversion“, „SL-Version“), nullable, nie leer. NULL heißt: ohne Bezeichnung (Besucher lesen „Version n“).
-- 2. `citymap_media.version_position`: die Reihenfolge der Versionen eines Eintrags, nullable, ab 0. Gelesen wird `version_position NULLS FIRST, id`: Die eine Karte aus der Zeit vor
--    den Versionen (NULL) steht vorn, und eine Folge ohne Lücken entsteht beim ersten Schreiben.
--    Beide Spalten gelten nur für die Karte (`map_full`); an einer Vorschau bleiben sie NULL.
-- 3. 🔴 Der Index `citymap_media_one_active_per_role` gilt ab jetzt nur noch für die Vorschau: genau eine aktive je Eintrag, beliebig viele aktive Karten. Er behält seinen
--    NAMEN, damit alles, was ihn kennt (der Schematest in `citymaps.test.ts`, eine Meldung mit `constraint_name`), für die Vorschau weiter stimmt. Gelesen hat ihn kein Code beim
--    Namen (kein `ON CONFLICT ON CONSTRAINT`, kein Abfangen von 23505 an ihm); `ON CONFLICT` an `citymap_media` nennt `(citymap_id, media_asset_id, role)`, also
--    `citymap_media_unique`, das bleibt. Abgelöst wird er in einer Transaktion (die Migration läuft in einer): Zwischen DROP und CREATE sieht niemand die Tafel ohne ihn.
--
-- 🔴 Das vorige Release erträgt das: Es schreibt die neuen Spalten nie (NULL erfüllt beide Bedingungen), es legt keine zweite Karte an (Zuweisen ersetzt dort, was hängt), und
-- seine Lesewege nehmen bei mehreren Karten die erste in Folge der Bindung (`resolveCitymapFulls`) bzw. zeigen alle (`MamKarteDetail.images`). Kartendaten berührt das nicht.

ALTER TABLE citymap_media ADD COLUMN IF NOT EXISTS version_label TEXT
    CONSTRAINT citymap_media_version_label_valid CHECK (version_label IS NULL OR (role = 'map_full' AND btrim(version_label) <> ''));

ALTER TABLE citymap_media ADD COLUMN IF NOT EXISTS version_position INTEGER
    CONSTRAINT citymap_media_version_position_valid CHECK (version_position IS NULL OR (role = 'map_full' AND version_position >= 0));

COMMENT ON COLUMN citymap_media.version_label IS
    'WI-0287 Stufe 2: die Bezeichnung einer Version der Karte (map_full), etwa Spielerversion; NULL ohne Bezeichnung. Nie leer, nie an einer Vorschau.';
COMMENT ON COLUMN citymap_media.version_position IS
    'WI-0287 Stufe 2: die Reihenfolge der Versionen eines Eintrags (map_full), ab 0; gelesen als version_position NULLS FIRST, id. Die erste aktive ist die Karte, aus der eine Vorschau entsteht und die Besucher zuerst sehen.';

DROP INDEX IF EXISTS citymap_media_one_active_per_role;
CREATE UNIQUE INDEX citymap_media_one_active_per_role ON citymap_media (citymap_id, role)
    WHERE retired_at IS NULL AND role = 'map_preview';

COMMENT ON INDEX citymap_media_one_active_per_role IS
    'Höchstens EINE aktive Vorschau (map_preview) je Eintrag. Karten (map_full) dürfen seit WI-0287 Stufe 2 mehrere aktive haben (Versionen, version_position). Name aus 0069 behalten.';
