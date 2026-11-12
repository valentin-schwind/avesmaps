-- 0296: Karte vorschlagen, tägliche Aufbewahrung (WI-0275 Stufe B2; Vorbild: `photobox_aufbewahren`, Migration 0284).
--
-- `kartenvorschlag_aufbewahren(p_jetzt)` räumt auf, was ein Besucher-Vorschlag an Zeilen und privaten Bytes hinterlässt:
--
--   * `incoming` nach 7 Tagen: Die Angaben kamen, die Datei nie (oder sie wurde nie verarbeitet). Ein Vorschlag, dessen Datei technisch fertig ist, bleibt:
--     Der nächste Lesezugriff zieht ihn nach `pending` (`technikNachziehen`), die Redaktion entscheidet.
--   * `technical_failed` nach 7 Tagen: Die Datei war nicht verarbeitbar; der Einreicher hat sie gesehen und kann neu einreichen.
--   * `rejected` und `withdrawn` nach 30 Tagen: abgelehnt oder zurückgezogen; die Frist gibt dem Einreicher Zeit, den Grund zu lesen.
--
--   Gelöscht wird beides, die Zeile des Vorschlags (mit dem Namen des Einreichers und seiner Notiz) und das Werk samt Dateizeilen, Belegen, Rechten und
--   Entstehung. `pending` fasst die Funktion nie an (die Redaktion entscheidet) und `approved` auch nicht: Dort gehört das Werk einer Karte.
--
--   🔴 Was irgendwo hängt, bleibt. Hat das Werk eine aktive Verwendung (eine Zeile ohne `retired_at` in einer Tafel aus `MEDIA_USAGE_TABLES`) oder halten es
--   ein Notaus, eine Zusammenführung, eine Legacy-Quelle oder eine Einreichung der Reisebilder, bleibt das Werk; die Zeile des Vorschlags geht trotzdem.
--   Zurückgezogene Verwendungen sind nur Verlauf und gehen mit dem Werk. Der Wächter `kartenvorschlag-aufbewahrung.test.ts` hält die Liste der Tafeln gegen
--   `MEDIA_USAGE_TABLES`.
--
--   Die Funktion löscht nur Zeilen und GIBT die Speicherschlüssel der gelöschten Dateizeilen und Belege zurück, die danach keine andere Zeile mehr hält
--   (bytegleiche Werke teilen sich eine Datei). Die Dateien löscht der Job `kartenvorschlag_aufbewahrung`, der jeden Schlüssel noch einmal prüft.
--
--   Rechte: `SECURITY DEFINER` (Migrationsrolle). PUBLIC darf sie nicht rufen (hier), die App-Rolle auch nicht, die Jobs-Rolle schon (`media-grants.psql`):
--   `p_jetzt` ist ein Parameter, mit einem Datum in der Zukunft löschte jeder Aufruf alles.
--
-- Erst erweitern (AGENTS.md): eine neue Funktion, die nur der neue Job ruft. Das vorige Release kennt sie nicht und liest die Tafeln unverändert.

CREATE OR REPLACE FUNCTION public.kartenvorschlag_aufbewahren(p_jetzt timestamptz) RETURNS TABLE (storage_key text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_vorschlag RECORD;
    v_asset BIGINT;
    v_neu TEXT[];
    v_schluessel TEXT[] := '{}';
BEGIN
    FOR v_vorschlag IN
        SELECT s.id, s.media_asset_id
          FROM citymap_suggestion s
          LEFT JOIN media_asset a ON a.id = s.media_asset_id
         WHERE (s.state = 'incoming' AND s.state_changed_at < p_jetzt - interval '7 days' AND (a.id IS NULL OR a.technical_state <> 'ok'))
            OR (s.state = 'technical_failed' AND s.state_changed_at < p_jetzt - interval '7 days')
            OR (s.state IN ('rejected', 'withdrawn') AND s.state_changed_at < p_jetzt - interval '30 days')
         ORDER BY s.id
           FOR UPDATE OF s
    LOOP
        v_asset := v_vorschlag.media_asset_id;
        -- Erst die Zeile des Vorschlags: Sie hält das Werk (Fremdschlüssel).
        DELETE FROM citymap_suggestion WHERE id = v_vorschlag.id;
        IF v_asset IS NULL THEN
            CONTINUE;
        END IF;

        -- 🔴 Aktive Verwendung: dieselben Tafeln wie MEDIA_USAGE_TABLES (usage-sql.ts); der Wächter hält die Liste gegen die Konstante.
        IF EXISTS (SELECT 1 FROM place_media WHERE media_asset_id = v_asset AND retired_at IS NULL)
           OR EXISTS (SELECT 1 FROM territory_media WHERE media_asset_id = v_asset AND retired_at IS NULL)
           OR EXISTS (SELECT 1 FROM adventure_media WHERE media_asset_id = v_asset AND retired_at IS NULL)
           OR EXISTS (SELECT 1 FROM citymap_media WHERE media_asset_id = v_asset AND retired_at IS NULL)
           OR EXISTS (SELECT 1 FROM media_gallery_item WHERE media_asset_id = v_asset AND retired_at IS NULL)
           OR EXISTS (SELECT 1 FROM media_type_image WHERE media_asset_id = v_asset AND retired_at IS NULL)
           OR EXISTS (SELECT 1 FROM photobox_media WHERE media_asset_id = v_asset AND retired_at IS NULL)
           -- Fremdschlüssel, die diese Funktion nicht auflösen darf: Notaus und Zusammenführung sind Verlauf, die Legacy-Quelle Herkunft; eine Einreichung
           -- oder ein Vorschlag desselben Werks gehört dem anderen Weg.
           OR EXISTS (SELECT 1 FROM media_publication_suspension WHERE media_asset_id = v_asset)
           OR EXISTS (SELECT 1 FROM media_merge WHERE merged_asset_id = v_asset OR kept_asset_id = v_asset)
           OR EXISTS (SELECT 1 FROM media_legacy_source WHERE media_asset_id = v_asset)
           OR EXISTS (SELECT 1 FROM media_submission WHERE approved_media_asset_id = v_asset)
           OR EXISTS (SELECT 1 FROM citymap_suggestion WHERE media_asset_id = v_asset)
        THEN
            CONTINUE;
        END IF;

        -- Reihenfolge wie deleteAsset: Dateizeilen, Belege, Rechte, Entstehung; die Schlüssel merken wir uns für den Job.
        WITH d AS (DELETE FROM media_file f WHERE f.media_asset_id = v_asset RETURNING f.storage_key)
        SELECT COALESCE(array_agg(d.storage_key), '{}') INTO v_neu FROM d;
        v_schluessel := v_schluessel || v_neu;
        WITH d AS (DELETE FROM media_rights_evidence e WHERE e.media_asset_id = v_asset RETURNING e.storage_key)
        SELECT COALESCE(array_agg(d.storage_key) FILTER (WHERE d.storage_key IS NOT NULL), '{}') INTO v_neu FROM d;
        v_schluessel := v_schluessel || v_neu;
        DELETE FROM media_rights WHERE media_asset_id = v_asset;
        DELETE FROM media_creation WHERE media_asset_id = v_asset;

        -- Zurückgezogene Verwendungen sind nur noch Verlauf des Werks (aktive haben oben angehalten).
        DELETE FROM place_media WHERE media_asset_id = v_asset AND retired_at IS NOT NULL;
        DELETE FROM territory_media WHERE media_asset_id = v_asset AND retired_at IS NOT NULL;
        DELETE FROM adventure_media WHERE media_asset_id = v_asset AND retired_at IS NOT NULL;
        DELETE FROM citymap_media WHERE media_asset_id = v_asset AND retired_at IS NOT NULL;
        DELETE FROM media_gallery_item WHERE media_asset_id = v_asset AND retired_at IS NOT NULL;
        DELETE FROM media_type_image WHERE media_asset_id = v_asset AND retired_at IS NOT NULL;
        DELETE FROM photobox_media WHERE media_asset_id = v_asset AND retired_at IS NOT NULL;

        DELETE FROM media_ingest WHERE media_asset_id = v_asset;
        DELETE FROM media_asset WHERE id = v_asset;
    END LOOP;

    -- Die Schlüssel, die nach dem Löschen keine Zeile mehr hält (bytegleiche Werke teilen sich ihre Datei).
    RETURN QUERY
    SELECT DISTINCT k.schluessel
      FROM unnest(v_schluessel) AS k(schluessel)
     WHERE NOT EXISTS (SELECT 1 FROM media_file f WHERE f.storage_key = k.schluessel)
       AND NOT EXISTS (SELECT 1 FROM media_rights_evidence e WHERE e.storage_key = k.schluessel)
     ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.kartenvorschlag_aufbewahren(timestamptz) FROM PUBLIC;

COMMENT ON FUNCTION public.kartenvorschlag_aufbewahren(timestamptz) IS
    'Tägliche Aufbewahrung der Kartenvorschläge (WI-0275 B2): incoming ohne fertige Datei und technical_failed nach 7 Tagen, rejected und withdrawn nach 30 Tagen samt Werk und Dateizeilen gelöscht, außer das Werk hängt aktiv irgendwo. pending und approved nie. Gibt die Speicherschlüssel der gelöschten Dateizeilen zurück; die Dateien löscht der Job. SECURITY DEFINER, nur für die Jobs-Rolle (media-grants.psql).';
