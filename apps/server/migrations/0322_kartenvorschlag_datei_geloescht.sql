-- 0322: Ein Bild aus einem Kartenvorschlag endgültig löschen (WI-0287; Vali 2026-11-07 auf „Soll der Betreiber Bilder aus Vorschlägen an stillgelegten Einträgen
-- endgültig löschen dürfen?“: „Ja, erlauben“). Anlass: Nottels Testbild „Lösch mich bitte“ am Eintrag „Porto Paligan Spielerversion Test“.
--
-- Das Löschen selbst steht in `apps/server/src/media-editor/asset-delete.ts`: Ein Bild aus einem Vorschlag, das nur noch an stillgelegten Einträgen der
-- Kartensammlung hängt, fällt samt diesen Bindungen. Der Vorschlag bleibt als Verlauf stehen (Nummer, Entscheidung, Statusseite des Einreichers), aber
-- ohne Werk: `citymap_suggestion.media_asset_id` wird NULL, und diese Spalte sagt, wann das geschah. Sonst verlangte `citymap_suggestion_file_has_asset`
-- für einen angenommenen Dateivorschlag weiter ein Werk (0295), und der Fremdschlüssel hielte das Werk fest.
--
-- 🔴 Erst erweitern (AGENTS.md): eine nullbare Spalte ohne DEFAULT, und die Prüfung wird WEITER, nie enger. Jede bestehende Zeile erfüllt sie, das vorige
-- Release schreibt die Spalte nie und liest einen Vorschlag ohne Werk schon heute (`redaktion.ts` mit LEFT JOIN, `incoming` hat auch keines).
-- `migration-compat.test.ts` führt die neue Prüfung als bekannte Ausnahme. Kartendaten berührt das nicht; Rechte bringt das Default-Privileg der Tafel mit.

ALTER TABLE citymap_suggestion ADD COLUMN IF NOT EXISTS media_deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN citymap_suggestion.media_deleted_at IS
    'WI-0287: Wann der Betreiber das Werk der Datei endgültig gelöscht hat (nur angenommene Vorschläge, deren Einträge alle stillgelegt sind; asset-delete.ts). Dann ist media_asset_id NULL. NULL: nie gelöscht.';

ALTER TABLE citymap_suggestion DROP CONSTRAINT IF EXISTS citymap_suggestion_file_has_asset;
ALTER TABLE citymap_suggestion ADD CONSTRAINT citymap_suggestion_file_has_asset CHECK (
    way <> 'file' OR state IN ('incoming', 'rejected', 'withdrawn') OR media_asset_id IS NOT NULL
    OR (state = 'approved' AND media_deleted_at IS NOT NULL)
);
