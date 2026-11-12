-- 0284: Reisebilder, Folgefelder der Einreichung und tägliche Aufbewahrung (WI-0272 S2 „Einreichen und Status“, Aufgabe 7).
--
-- Zwei Dinge, beide nur Erweiterung:
--
-- 1. Zwei Spalten an `media_submission` (Tafel aus 0274): die Beschreibung, die ein Einreicher NACH der Freigabe ändert und die auf die
--    Prüfung der Redaktion wartet (`pending_description`, die freigegebene bleibt bis dahin sichtbar), und die Nachricht der Redaktion an
--    den Einreicher bei einer Rückfrage oder Ablehnung (`editor_message`, auf der Statusseite). Beide nullable, ohne Vorgabe: das vorige
--    Release schreibt und liest sie nie. Die Längenprüfungen stehen am Spaltenkopf (`ADD COLUMN … CONSTRAINT … CHECK`), also nur auf den
--    neuen, leeren Spalten; das ist keine Regel von `migration-compat` (kein `ADD CONSTRAINT`).
--
-- 2. `photobox_aufbewahren(p_jetzt)`: der tägliche Lauf der Aufbewahrung (WI-0272 §5.5 und §13). Offene Einreichungen (`incoming`, `pending`,
--    `changes_requested`) und technisch gescheiterte (`technical_failed`; sonst blieben sie samt Dateien für immer) verfallen 60 Tage nach
--    dem letzten Zustandswechsel (`expired`); abgelehnte, zurückgezogene, verfallene und offline
--    genommene Einreichungen werden 30 Tage danach WIRKLICH gelöscht, samt Bild und Angaben: erst die Assets (Dateizeilen, Belege, Rechte,
--    Entstehung, wie `deleteAsset` in `media-editor/asset-delete.ts`), dann der Eingang (`media_ingest`), die Einreichung selbst, zuletzt die
--    Assets. Der Zustand `purged` aus 0274 bleibt ungenutzt: Leeren statt Löschen war nötig, solange die App-Rolle `media_ingest` nicht löschen
--    darf; diese Funktion läuft mit den Rechten der Migrationsrolle (`SECURITY DEFINER`) und löscht den Eingang gleich mit.
--
--    🔴 Offline genommene Einreichungen verlieren ihre DATEIEN schon beim nächsten täglichen Lauf, nicht erst nach 30 Tagen (Datenschutztext
--    WI-0272 §15: „Offline nehmen wirkt sofort … die Dateien löscht der nächste tägliche Lauf“; Review S2a I1): alle `media_file`-Zeilen der
--    Assets (Original mit EXIF und GPS, frühere Originale, interne Vorschauen, Ableitungen) gehen sofort, ihre Schlüssel kommen zurück. Asset,
--    Rechte, Eingang und Einreichung bleiben bis zum Löschen nach 30 Tagen (die Angaben samt Frist). Das Asset ist `rejected`, und `media_settle`
--    rechnet für ein abgelehntes Asset nichts mehr, es entsteht also keine neue Vorschau. Auch hier gilt: was aktiv irgendwo hängt, bleibt.
--
--    🔴 Was irgendwo hängt, wird nicht gelöscht. Hat EIN Asset der Einreichung eine aktive Verwendung (eine Zeile ohne `retired_at` in einer
--    Tafel aus `MEDIA_USAGE_TABLES`: Ort, Gebiet, Werk, Karte, Galerieeintrag, Typbild), bleiben alle Assets, ihr Eingang und die Einreichung.
--    Ebenso bleibt, was einen Fremdschlüssel hält, den die Funktion nicht auflösen darf: ein Notaus, eine Zusammenführung, eine Legacy-Quelle.
--    Zurückgezogene Verwendungen (`retired_at` gesetzt) sind nur noch Verlauf eines Werks, das gelöscht wird; sie gehen mit ihm, sonst hielte
--    der Fremdschlüssel das Werk ewig. Der Wächter `photobox-aufbewahrung-db.test.ts` hält die Liste der Tafeln gegen `MEDIA_USAGE_TABLES`.
--
--    Die Funktion löscht nur Zeilen. Sie GIBT die Speicherschlüssel der gelöschten Dateizeilen und Belege zurück (nur solche, die nach dem
--    Löschen keine andere Zeile mehr hält: bytegleiche Werke teilen sich eine Datei); die Dateien selbst löscht der Job (Aufgabe 11), der
--    jeden Schlüssel nach der Transaktion noch einmal gegen die Tafeln prüft.
--
--    Rechte: Die Funktion gehört der Migrationsrolle. PUBLIC darf sie nicht rufen (hier), die App-Rolle auch nicht und die Jobs-Rolle schon
--    (beides in `media-grants.psql`, weil die Rollennamen je Umgebung heißen). Die App darf sie nicht rufen: `p_jetzt` ist ein Parameter, mit
--    einem Datum in der Zukunft löschte jeder Aufruf alles, und sie umginge das Verbot, `media_ingest` zu löschen.
--
-- Erst erweitern (AGENTS.md): zwei nullable Spalten und eine neue Funktion, die nur der neue Job ruft. Das vorige Release kennt weder das
-- eine noch das andere.

-- 1. DIE FOLGEFELDER ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE media_submission
    ADD COLUMN IF NOT EXISTS pending_description TEXT
        CONSTRAINT media_submission_pending_description_len CHECK (
            pending_description IS NULL OR char_length(btrim(pending_description)) BETWEEN 1 AND 300
        ),
    ADD COLUMN IF NOT EXISTS editor_message TEXT
        CONSTRAINT media_submission_editor_message_len CHECK (
            editor_message IS NULL OR char_length(btrim(editor_message)) BETWEEN 1 AND 1000
        );

COMMENT ON COLUMN media_submission.pending_description IS
    'INTERN bis zur Prüfung: die Bildbeschreibung, die der Einreicher nach der Freigabe änderte; die freigegebene (description) bleibt sichtbar, bis die Redaktion prüft. NULL ohne wartende Änderung; 1 bis 300 Zeichen (WI-0272 §12).';
COMMENT ON COLUMN media_submission.editor_message IS
    'Die Nachricht der Redaktion an den Einreicher bei Rückfrage oder Ablehnung; erscheint auf der Statusseite. NULL ohne Nachricht; 1 bis 1000 Zeichen (WI-0272 §12).';

-- 2. DIE TÄGLICHE AUFBEWAHRUNG ---------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.photobox_aufbewahren(p_jetzt timestamptz) RETURNS TABLE (storage_key text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_einreichung RECORD;
    v_assets BIGINT[];
    v_neu TEXT[];
    v_schluessel TEXT[] := '{}';
BEGIN
    -- 1. Offene Einreichungen ohne Entscheidung und technisch gescheiterte verfallen nach 60 Tagen. Die Frist des Löschens beginnt mit dem Verfall (p_jetzt).
    UPDATE media_submission
       SET state = 'expired', state_changed_at = p_jetzt
     WHERE state IN ('incoming', 'pending', 'changes_requested', 'technical_failed')
       AND state_changed_at < p_jetzt - interval '60 days';

    -- 2. Beendete Einreichungen 30 Tage nach dem Zustandswechsel löschen, eine nach der anderen. Die Funktion ist EINE Transaktion: Scheitert eine,
    --    scheitert der Lauf (kein Ausnahmeblock). Offline genommene Einreichungen verlieren ihre Dateien schon vorher (`abgelaufen` ist dann falsch).
    FOR v_einreichung IN
        SELECT s.id, s.approved_media_asset_id, s.state_changed_at < p_jetzt - interval '30 days' AS abgelaufen
          FROM media_submission s
         WHERE (s.state IN ('rejected', 'withdrawn', 'expired') AND s.state_changed_at < p_jetzt - interval '30 days')
            OR s.state = 'offline'
         ORDER BY s.id
           FOR UPDATE OF s
    LOOP
        -- Die Assets der Einreichung: alle, die ein Eingang nennt (ein ersetztes Bild hat mehrere), und das freigegebene.
        SELECT COALESCE(array_agg(DISTINCT a.id), '{}') INTO v_assets
          FROM (
              SELECT i.media_asset_id AS id FROM media_ingest i WHERE i.submission_id = v_einreichung.id
              UNION ALL
              SELECT v_einreichung.approved_media_asset_id WHERE v_einreichung.approved_media_asset_id IS NOT NULL
          ) a;

        -- 🔴 Aktive Verwendung: dieselben Tafeln wie MEDIA_USAGE_TABLES (usage-sql.ts); der Wächter hält die Liste gegen die Konstante.
        IF EXISTS (SELECT 1 FROM place_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
           OR EXISTS (SELECT 1 FROM territory_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
           OR EXISTS (SELECT 1 FROM adventure_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
           OR EXISTS (SELECT 1 FROM citymap_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
           OR EXISTS (SELECT 1 FROM media_gallery_item WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
           OR EXISTS (SELECT 1 FROM media_type_image WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
           -- Fremdschlüssel, die diese Funktion nicht auflösen darf: Notaus und Zusammenführung sind Verlauf, die Legacy-Quelle Herkunft.
           OR EXISTS (SELECT 1 FROM media_publication_suspension WHERE media_asset_id = ANY(v_assets))
           OR EXISTS (SELECT 1 FROM media_merge WHERE merged_asset_id = ANY(v_assets) OR kept_asset_id = ANY(v_assets))
           OR EXISTS (SELECT 1 FROM media_legacy_source WHERE media_asset_id = ANY(v_assets))
        THEN
            CONTINUE;
        END IF;

        -- Reihenfolge wie deleteAsset: Dateizeilen, Belege, Rechte, Entstehung; die Schlüssel merken wir uns für den Job.
        WITH d AS (DELETE FROM media_file f WHERE f.media_asset_id = ANY(v_assets) RETURNING f.storage_key)
        SELECT COALESCE(array_agg(d.storage_key), '{}') INTO v_neu FROM d;
        v_schluessel := v_schluessel || v_neu;

        -- Offline genommen und noch innerhalb der 30 Tage: Die Dateien sind weg (Datenschutz), Asset, Rechte, Eingang und Einreichung bleiben bis zum Löschen.
        IF NOT v_einreichung.abgelaufen THEN
            CONTINUE;
        END IF;

        WITH d AS (DELETE FROM media_rights_evidence e WHERE e.media_asset_id = ANY(v_assets) RETURNING e.storage_key)
        SELECT COALESCE(array_agg(d.storage_key) FILTER (WHERE d.storage_key IS NOT NULL), '{}') INTO v_neu FROM d;
        v_schluessel := v_schluessel || v_neu;
        DELETE FROM media_rights WHERE media_asset_id = ANY(v_assets);
        DELETE FROM media_creation WHERE media_asset_id = ANY(v_assets);

        -- Zurückgezogene Verwendungen sind nur noch Verlauf des Werks (aktive haben oben angehalten).
        DELETE FROM place_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;
        DELETE FROM territory_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;
        DELETE FROM adventure_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;
        DELETE FROM citymap_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;
        DELETE FROM media_gallery_item WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;
        DELETE FROM media_type_image WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;

        -- Der Eingang hält die Einreichung (Fremdschlüssel ohne ON DELETE) und das Asset (CASCADE); die Einreichung hält das freigegebene
        -- Asset. Deshalb: Eingang, Einreichung, Assets.
        DELETE FROM media_ingest WHERE media_asset_id = ANY(v_assets) OR submission_id = v_einreichung.id;
        DELETE FROM media_submission WHERE id = v_einreichung.id;
        DELETE FROM media_asset WHERE id = ANY(v_assets);
    END LOOP;

    -- 3. Die Schlüssel, die nach dem Löschen keine Zeile mehr hält (bytegleiche Werke teilen sich ihre Datei).
    RETURN QUERY
    SELECT DISTINCT k.schluessel
      FROM unnest(v_schluessel) AS k(schluessel)
     WHERE NOT EXISTS (SELECT 1 FROM media_file f WHERE f.storage_key = k.schluessel)
       AND NOT EXISTS (SELECT 1 FROM media_rights_evidence e WHERE e.storage_key = k.schluessel)
     ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.photobox_aufbewahren(timestamptz) FROM PUBLIC;

COMMENT ON FUNCTION public.photobox_aufbewahren(timestamptz) IS
    'Tägliche Aufbewahrung der Reisebilder (WI-0272 S2): offene Einreichungen verfallen nach 60 Tagen, beendete werden 30 Tage danach samt Assets gelöscht, offline genommene verlieren ihre Dateien schon beim nächsten Lauf, außer eines hängt aktiv irgendwo. Gibt die Speicherschlüssel der gelöschten Dateizeilen zurück; die Dateien löscht der Job. SECURITY DEFINER, nur für die Jobs-Rolle (media-grants.psql).';
