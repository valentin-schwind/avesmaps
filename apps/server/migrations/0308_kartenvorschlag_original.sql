-- 0308: Karte vorschlagen, das hochgeladene Original eines angenommenen Vorschlags und die Angaben des Einreichers (WI-0275, Betreiberentscheid 2026-11-04:
-- Formular und Bedingungen sagen „Das Original wird nach der Prüfung gelöscht.“, und das soll stimmen).
--
-- `media_file.bytes_deleted_at`: Die BYTES dieser Zeile sind fällig oder fort, die ZEILE bleibt mit allen Werten. Sie trägt Hash und Maße, an denen Notaus,
-- Zusammenführen, „gibt es schon“ und die Suche hängen (`media/notaus.ts`, `media-editor/merge.ts`, `upload.ts`, `search.ts`, `usage.ts`, `detail.ts`). Der Abgleich
-- rechnet bei einem Stempel aus der verlustfreien Fassung (Zeile der Klasse `master`, `media-editor/settle.ts`). Bewusst ohne CHECK: Gesetzt wird der Stempel nur von
-- `kartenvorschlag/original-loeschen.ts` (Jobs-Rolle, `media-grants.psql`), und dessen Schalter steht im ersten Release aus.
--
-- `kartenvorschlag_aufbewahren`: unverändert bis auf zwei Stellen.
--   * Ein Halter einer Datei ist nur eine LEBENDE Zeile. Eine gestempelte Zeile hielte sonst eine Datei fest, die ein bytegleicher späterer Upload wieder hat wachsen lassen.
--   * Name und Notiz angenommener Vorschläge fallen 90 Tage nach der Entscheidung weg. Das ist an keinen Schalter gebunden. Der Vorschlag selbst bleibt: Er ist die
--     Herkunft der Karte (`accepted_citymap_id`), und die Karte hat beides nie übernommen (`annehmen.ts`).
--
-- Erst erweitern (AGENTS.md): eine neue Spalte, die das vorige Release nicht liest, und dieselbe Funktion mit derselben Argumentliste und demselben Rückgabetyp.
-- CREATE OR REPLACE behält Besitzerin und Rechte; das REVOKE steht nur noch einmal da, damit es hier nachzulesen ist.

ALTER TABLE media_file ADD COLUMN IF NOT EXISTS bytes_deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN media_file.bytes_deleted_at IS
    'Nur an einem privaten Original (WI-0275): Seit wann gilt die Datei dieser Zeile als gelöscht? Die Zeile bleibt, sie trägt Hash und Maße für Notaus, Zusammenführen und Suche; gerechnet wird aus der Zeile der Klasse master. Eine gestempelte Zeile hält keine Datei.';

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

    -- Name und Notiz angenommener Vorschläge: 90 Tage nach der Entscheidung (WI-0275, Betreiberentscheid 2026-11-04).
    UPDATE citymap_suggestion
       SET attribution_name = NULL, note = NULL
     WHERE state = 'approved'
       AND decided_at < p_jetzt - interval '90 days'
       AND (attribution_name IS NOT NULL OR note IS NOT NULL);

    -- Die Schlüssel, die nach dem Löschen keine LEBENDE Zeile mehr hält (bytegleiche Werke teilen sich ihre Datei; eine gestempelte Zeile hält nichts).
    RETURN QUERY
    SELECT DISTINCT k.schluessel
      FROM unnest(v_schluessel) AS k(schluessel)
     WHERE NOT EXISTS (SELECT 1 FROM media_file f WHERE f.storage_key = k.schluessel AND f.bytes_deleted_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM media_rights_evidence e WHERE e.storage_key = k.schluessel)
     ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.kartenvorschlag_aufbewahren(timestamptz) FROM PUBLIC;

COMMENT ON FUNCTION public.kartenvorschlag_aufbewahren(timestamptz) IS
    'Tägliche Aufbewahrung der Kartenvorschläge (WI-0275): incoming ohne fertige Datei und technical_failed nach 7 Tagen, rejected und withdrawn nach 30 Tagen samt Werk und Dateizeilen gelöscht, außer das Werk hängt aktiv irgendwo. Name und Notiz angenommener Vorschläge fallen 90 Tage nach der Entscheidung weg. pending nie. Gibt die Speicherschlüssel der gelöschten Dateizeilen zurück, die keine lebende Zeile mehr hält; die Dateien löscht der Job. SECURITY DEFINER, nur für die Jobs-Rolle (media-grants.psql).';
