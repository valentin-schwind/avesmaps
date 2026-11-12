-- 0235: Vorkommen ohne Wiki-Artikel (WI-0254, Runde 3b; Vali wählte B am Betreiber-Gate „Vorkommen ohne Wiki-Artikel“).
--
-- Bis hierher war die Identität eines Lore-Eintrags sein Wiki-Schlüssel (`lore_entry.wiki_key`, 0074) und das Ziel einer Ortszeile ein Wiki-Artikel
-- (`lore_place.place_wiki_key`). Entschieden ist: Die Redaktion darf Vorkommen auch OHNE Wiki-Artikel anlegen, und eine Ortszeile darf einen
-- ungeklärten Namen tragen. Dafür werden zwei Spalten nur GELOCKERT (NOT NULL → NULL), nichts wird entfernt oder umbenannt:
--
--   1. `lore_entry.wiki_key` darf NULL sein. Die Identität eines solchen Eintrags ist seine Kennung `public_id` (0234); er trägt eine eigene
--      Avesmaps-Kennung und steht als INOFFIZIELL | Avesmaps (Rang 4 der Kanon-Regel). `UNIQUE (wiki_key)` bleibt (mehrere NULL sind erlaubt),
--      ebenso die Prüfung gegen leere Schlüssel. Kein Schlüssel wird je erfunden: Ein Eintrag ohne Artikel hat keinen.
--   2. `lore_place.place_wiki_key` darf NULL sein; dann trägt `place_title` den Namen, den die Redaktion eingetragen hat („ungeklärt übernehmen“).
--      Das Ziel einer Zeile ist damit ein Wiki-Schlüssel ODER ein Name (die neue Prüfung `lore_place_target_present`). Eine Namenszeile hat nie
--      Treffer (`unresolved`, `key_class other`, kein `lore_place_target`): ein Name ist nie ein Schlüssel und wird nie gegen Kartenobjekte
--      verglichen. Dieselbe Beziehung mit demselben Namen steht je Eintrag nur einmal (der neue Index; Groß- und Kleinschreibung gleich).
--
-- Das vorige Release schreibt weiterhin immer einen Schlüssel; was es liest, bleibt gültig. Die Leser, die den Schlüssel erwarten (Anzeige am Objekt,
-- Import, Prüfer), kennen den NULL-Fall seit diesem Release (`subjects/sections/lore.ts`, `migration/lore-import.ts`, `migration/verify-lore.ts`).
--
-- 🔴 Importschutz: Ein so angelegter Eintrag trägt `source_system = 'editor'` und gehört der Redaktion (Eintragsebene, 0234); der Legacy-Zug kennt
-- keinen Schlüssel für ihn, fasst ihn nie an und legt ihn nicht still.

ALTER TABLE lore_entry ALTER COLUMN wiki_key DROP NOT NULL;
ALTER TABLE lore_place ALTER COLUMN place_wiki_key DROP NOT NULL;

ALTER TABLE lore_place
    ADD CONSTRAINT lore_place_target_present CHECK (place_wiki_key IS NOT NULL OR place_title IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS lore_place_name_unique
    ON lore_place (lore_entry_id, lower(place_title), relation)
    WHERE place_wiki_key IS NULL;

COMMENT ON COLUMN lore_entry.wiki_key IS
    'Legacys wiki_key, wörtlich (Slug des normalisierten Seitentitels; der Namensraum steht als Vorsilbe im Schlüssel). NULL (0235): ein Eintrag der Redaktion ohne Wiki-Artikel; seine Identität ist public_id. Information und Verbindung zum Artikel, nie ein Fremdschlüssel auf ein Kartenobjekt.';
COMMENT ON COLUMN lore_place.place_wiki_key IS
    'Der Schlüssel des Wiki-Artikels, auf den die Zeile zeigt, wörtlich. NULL (0235): ein ungeklärter Name der Redaktion in place_title, ohne Treffer, nie ein Schlüssel.';
COMMENT ON COLUMN lore_place.place_title IS
    'Anzeigetitel des Linkziels; nur Anzeige, nie Schlüssel. Bei place_wiki_key NULL (0235) der Name selbst.';
