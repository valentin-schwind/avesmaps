-- 0328: PhotoBox-Bilder endgültig löschen, auch mit Notaus (WI-0272; Vali 2026-11-08 im Entwurf „Eingänge“ Fassung 2, Antworten „B, löschbar“ zum Notaus und
-- „Ja, bauen“; die Knopftexte stammen von der Sitzung, sie sind keine Betreiberzitate).
--
-- Das Löschen selbst steht in `apps/server/src/media-editor/asset-delete.ts` und `photobox-loeschen.ts`. Zwei Dinge hielten ein Werk bisher fest, und beide
-- löst diese Migration, ohne Verlauf wegzunehmen:
--
-- 1. 🔴 Der Notaus (`media_publication_suspension`, 0086) zeigte mit einem Fremdschlüssel OHNE `ON DELETE` auf das Werk, an dem er ausgelöst wurde. Er gilt aber
--    den BYTES (`source_sha256`), nicht dem Werk: Resolver, Quarantäne, Abgleich und Medienlauf fragen ihn über die Prüfsumme (`media/notaus.ts`,
--    `GEHALTENE_QUELLBYTES_SQL`). Darum darf das Werk jetzt fallen: Die Zeile bleibt mit Grund, Person, Zeit und Prüfsumme stehen, nur `media_asset_id` wird
--    NULL (`ON DELETE SET NULL`). Dieselben Bytes bleiben an jedem anderen Werk und für jeden späteren Upload gesperrt.
--    Der Wächter (0086, erweitert in 0088) erlaubt dafür genau EINEN neuen Übergang: Asset-Kennung → NULL, und nur, wenn das Werk dabei nicht mehr besteht,
--    also im selben Schritt gelöscht wurde (der Fremdschlüssel setzt die Spalte erst nach dem Löschen der Zeile von `media_asset`). Von NULL zurück, auf ein
--    anderes Werk und ein NULL bei lebendem Werk bleiben verboten, wie jede andere Änderung an Bild, Grund, Person und Zeit.
-- 2. Die Einreichung (`media_submission`, 0274) verlangte bei `approved` und `offline` ein Werk (`media_submission_approved_has_asset`). Nach dem Löschen bleibt sie
--    als Verlauf stehen (Zustand, Entscheidung, Statusseite des Einsenders), aber ohne Werk: `approved_media_asset_id` wird NULL, und die neue Spalte
--    `media_deleted_at` sagt, wann das geschah. Die Prüfung wird WEITER: ohne Werk nur mit diesem Zeitpunkt.
--
-- 🔴 Erst erweitern (AGENTS.md, docs/regeln/entwicklung.md): eine nullbare Spalte ohne DEFAULT, ein gelockertes NOT NULL, ein Fremdschlüssel mit einer
-- Löschregel und eine weitere Prüfung. Jede bestehende Zeile erfüllt alles. Das vorige Release löscht nie ein Werk mit Notaus (`asset-delete.ts` prüfte ihn,
-- die Aufbewahrungen `photobox_aufbewahren` und `kartenvorschlag_aufbewahren` lassen solche Werke liegen), schreibt `media_deleted_at` nie und liest eine
-- Einreichung ohne Werk schon heute (`rejected`, `incoming` haben keines; Karte, Leiste und Reisebilder des Orts lesen über `photobox_media`).
-- `migration-compat.test.ts` führt die neue Prüfung als bekannte Ausnahme. Rechte: keine neuen. Die App-Rolle löscht `photobox_media` und ändert
-- `media_submission` schon heute; die Notaus-Zeile ändert der Fremdschlüssel mit den Rechten der Eigentümerin der Tafel, die App-Rolle schreibt sie dafür nicht.
-- Kartendaten berührt das nicht.

-- 1. DER NOTAUS ÜBERLEBT SEIN WERK -------------------------------------------------------------------------------------------------------

ALTER TABLE media_publication_suspension ALTER COLUMN media_asset_id DROP NOT NULL;

ALTER TABLE media_publication_suspension
    DROP CONSTRAINT IF EXISTS media_publication_suspension_media_asset_id_fkey,
    ADD CONSTRAINT media_publication_suspension_media_asset_id_fkey
        FOREIGN KEY (media_asset_id) REFERENCES media_asset (id) ON DELETE SET NULL;

COMMENT ON COLUMN media_publication_suspension.media_asset_id IS
    'Das Asset, an dem der Notaus ausgelöst wurde (die Bestätigung nennt alle Stellen mit denselben Bytes). NULL, wenn es endgültig gelöscht wurde (0328, WI-0272): Der Notaus gilt den Bytes und bleibt mit Grund, Person, Zeit und Prüfsumme stehen.';

-- Der Wächter aus 0088, abgeschrieben von dort und nur um den Übergang „Werk gelöscht“ erweitert.
CREATE OR REPLACE FUNCTION media_publication_suspension_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    mark CONSTANT text := '[geschwärzt]';
    werk_geloescht boolean := false;
BEGIN
    -- Asset-Kennung → NULL nur, wenn das Werk nicht mehr besteht: Der Fremdschlüssel (ON DELETE SET NULL) setzt die Spalte erst, nachdem die Zeile in
    -- `media_asset` gelöscht ist. Ein UPDATE von Hand bei lebendem Werk, ein Zurück von NULL und ein anderes Werk sind keine Löschung.
    IF OLD.media_asset_id IS NOT NULL AND NEW.media_asset_id IS NULL THEN
        werk_geloescht := NOT EXISTS (SELECT 1 FROM public.media_asset a WHERE a.id = OLD.media_asset_id);
    END IF;
    IF (NEW.source_sha256, NEW.suspended_by_person, NEW.suspended_at)
       IS DISTINCT FROM (OLD.source_sha256, OLD.suspended_by_person, OLD.suspended_at)
       OR (NEW.media_asset_id IS DISTINCT FROM OLD.media_asset_id AND NOT werk_geloescht)
       OR (NEW.reason IS DISTINCT FROM OLD.reason AND NEW.reason IS DISTINCT FROM mark) THEN
        RAISE EXCEPTION 'Bild, Asset, Grund, Person und Zeit eines Notaus ändern sich nie (Notaus %): aufheben und neu setzen', OLD.id
            USING ERRCODE = '23514', CONSTRAINT = 'media_publication_suspension_fixed';
    END IF;
    IF OLD.lifted_at IS NOT NULL
       AND (
           (NEW.lifted_at, NEW.lifted_by_person) IS DISTINCT FROM (OLD.lifted_at, OLD.lifted_by_person)
           OR (
               NEW.lift_reason IS DISTINCT FROM OLD.lift_reason
               AND (OLD.lift_reason IS NULL OR NEW.lift_reason IS DISTINCT FROM mark)
           )
       ) THEN
        RAISE EXCEPTION 'Notaus % ist aufgehoben; die Wiederfreigabe bleibt als Verlauf, wie sie ist', OLD.id
            USING ERRCODE = '23514', CONSTRAINT = 'media_publication_suspension_lifted_is_final';
    END IF;
    RETURN NEW;
END
$$;

-- 2. DIE EINREICHUNG BLEIBT OHNE WERK IM VERLAUF -----------------------------------------------------------------------------------------

ALTER TABLE media_submission ADD COLUMN IF NOT EXISTS media_deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN media_submission.media_deleted_at IS
    'WI-0272 (0328): Wann der Betreiber das Bild der Einreichung endgültig gelöscht hat (nur entschiedene Einreichungen; asset-delete.ts). Dann ist approved_media_asset_id NULL, und die Statusseite sagt, dass das Bild entfernt wurde. NULL: nie gelöscht.';

ALTER TABLE media_submission DROP CONSTRAINT IF EXISTS media_submission_approved_has_asset;
ALTER TABLE media_submission ADD CONSTRAINT media_submission_approved_has_asset CHECK (
    state NOT IN ('approved', 'offline') OR approved_media_asset_id IS NOT NULL OR media_deleted_at IS NOT NULL
);
