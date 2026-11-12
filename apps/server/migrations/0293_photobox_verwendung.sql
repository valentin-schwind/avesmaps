-- 0293: Reisebilder, die Verwendung der Rolle `photobox` und der Index des Eingangs (WI-0272 S3 „Prüfen und Freigeben“, Aufgabe 16).
--
-- Zwei Dinge, beide nur Erweiterung:
--
-- 1. `photobox_media`: die Verwendung eines freigegebenen Reisebildes. `media_settle` veröffentlicht nur, was eine aktive Verwendung in der Rolle
--    hat (`assetPublishes`, `readUsages`); ein Reisebild hängt an einer freien Kartenstelle, nicht an einem Fachobjekt, und hatte deshalb keine
--    Tafel. Eine Zeile je freigegebener Einreichung (`media_submission_id` ist eindeutig), Rolle `photobox`, gebaut wie `place_media`:
--    Einzelentscheidung (`publication_override` mit Datum, Zitat oder Person), `retired_at` für das Zurücknehmen (Offline), `revision` mit
--    `revision_bump`. Sie zählt als Verwendung (`MEDIA_USAGE_TABLES`) und steht in `readUsages`. Sie zieht NICHT beim Zusammenführen bytegleicher Werke um: Reisebilder
--    (`source_system = 'photobox'`) nehmen an keiner Zusammenführung teil (Fixrunde zu S3). Ein Fachobjekt hat sie nicht: Die Stelle der Karte und der Ort stehen an der Einreichung. Die Kopf-Galerie am Ort folgt mit S5.
--    Öffentlich wird ein Reisebild damit noch nicht: Es braucht Freigabe der Redaktion UND eine Freigaberegel für die Rolle (Policy).
--
-- 2. Der Index `media_ingest_submission`: Die Aufbewahrung, die Statusseite und die Redaktion finden den Eingang einer Einreichung über
--    `submission_id`; die Spalte bekam mit 0274 den Fremdschlüssel, aber keinen Index (Hinweis aus S2).
--
-- 3. `photobox_aufbewahren(p_jetzt)` (0284) kennt die neue Tafel: Eine aktive Verwendung in `photobox_media` hält, wie jede andere, das Asset, seinen
--    Eingang und die Einreichung; zurückgezogene Zeilen sind nur noch Verlauf und gehen vor Asset UND Einreichung (Fremdschlüssel auf beide). Neu
--    gefasst mit `CREATE OR REPLACE`, gleiche Signatur, gleiche Rechte (`SECURITY DEFINER`, fester `search_path`; die Rechte der Jobs-Rolle bleiben an
--    der Funktion hängen). Der Wächter `photobox-aufbewahrung-db.test.ts` hält die Liste der Tafeln gegen `MEDIA_USAGE_TABLES`.
--
-- 4. Ersetzte Bilder fallen im täglichen Lauf (Fixrunde zu S3, Review I3): Ersetzt ein Besucher sein Bild und gibt die Redaktion das neue frei, blieb das alte
--    Original samt interner Vorschau ohne Frist liegen (die Aufbewahrung lief nur über beendete Einreichungen). Ein eigener Schritt löscht jetzt in JEDEM Zustand der
--    Einreichung die Assets, die weder ihr aktuelles Bild (das des jüngsten Eingangs) noch ihr freigegebenes Medium sind und keine aktive Verwendung haben, wie der
--    Löschschritt der beendeten Einreichungen (Dateizeilen, Belege, Rechte, Entstehung, zurückgezogene Verwendungen, Eingang, Asset). Die Einreichung bleibt. Eine
--    Schonfrist von einem Tag ab dem Ersetzen (`media_ingest.created_at` des aktuellen Bildes) lässt eine laufende Ersetzung und einen noch eingereihten Abgleich
--    in Ruhe. Gesperrte Einreichungen (`SKIP LOCKED`) kommen beim nächsten Lauf dran.
--
-- Erst erweitern (AGENTS.md): eine neue Tafel, ein neuer Index und eine Funktion gleicher Signatur. Das vorige Release schreibt und liest die Tafel
-- nie. Rechte: die Vorgaben der App-Rolle in `public`; die Jobs-Rolle braucht nichts Besonderes (kein Sammellauf der Duplikate berührt die Tafel).

-- 1. DIE VERWENDUNG ----------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS photobox_media (
    id BIGSERIAL PRIMARY KEY,
    media_submission_id BIGINT NOT NULL REFERENCES media_submission (id),
    media_asset_id BIGINT NOT NULL REFERENCES media_asset (id),
    role TEXT NOT NULL DEFAULT 'photobox',
    publication_override TEXT NOT NULL DEFAULT 'none',
    override_decided_on DATE,
    override_operator_quote TEXT,
    override_decided_by UUID,
    override_reason TEXT,
    retired_at TIMESTAMPTZ,
    -- Fachrevision (ADR-0020): zählt allein der Trigger `photobox_media_revision` (unten), die Anwendung schreibt sie nie.
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Eine Einreichung hat höchstens EINE Verwendung; wird sie zurückgenommen (`retired_at`), bleibt die Zeile als Verlauf stehen.
    CONSTRAINT photobox_media_submission_unique UNIQUE (media_submission_id),
    CONSTRAINT photobox_media_role_known CHECK (role = 'photobox'),
    CONSTRAINT photobox_media_override_known CHECK (publication_override IN ('none', 'approved', 'blocked')),
    CONSTRAINT photobox_media_approved_has_decision CHECK (
        publication_override <> 'approved'
        OR (
            override_decided_on IS NOT NULL
            AND (btrim(coalesce(override_operator_quote, '')) <> '' OR override_decided_by IS NOT NULL)
        )
    ),
    CONSTRAINT photobox_media_decided_by_has_date CHECK (override_decided_by IS NULL OR override_decided_on IS NOT NULL)
);

-- Wer verwendet dieses Asset (Reverse Usage, Zusammenführen, Löschen): nur die aktiven Zeilen.
CREATE INDEX IF NOT EXISTS photobox_media_asset ON photobox_media (media_asset_id) WHERE retired_at IS NULL;

CREATE OR REPLACE TRIGGER photobox_media_revision BEFORE UPDATE ON photobox_media
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON TABLE photobox_media IS
    'Verwendung eines freigegebenen Reisebildes in der Rolle photobox (WI-0272 S3): eine Zeile je Einreichung, gebaut wie place_media. Ohne aktive Verwendung veröffentlicht media_settle nichts; öffentlich wird das Bild erst mit einer Freigaberegel für die Rolle.';
COMMENT ON COLUMN photobox_media.media_submission_id IS 'Die Einreichung, aus deren Freigabe die Verwendung entstand; eindeutig.';
COMMENT ON COLUMN photobox_media.media_asset_id IS 'Das freigegebene Medium. Reisebilder nehmen an keiner Zusammenführung bytegleicher Werke teil; die Zeile zieht nie um.';
COMMENT ON COLUMN photobox_media.role IS 'Immer photobox.';
COMMENT ON COLUMN photobox_media.publication_override IS 'Einzelentscheidung: none (die Policy entscheidet), approved (freigegeben) oder blocked (gesperrt), wie an place_media.';
COMMENT ON COLUMN photobox_media.override_decided_on IS 'INTERN: Tag der Einzelentscheidung; Pflicht bei approved.';
COMMENT ON COLUMN photobox_media.override_operator_quote IS 'INTERN: wörtliches Betreiberzitat der Einzelfreigabe.';
COMMENT ON COLUMN photobox_media.override_decided_by IS 'INTERN: person.id der Person, die die Einzelentscheidung traf (neben dem Betreiberzitat).';
COMMENT ON COLUMN photobox_media.override_reason IS 'INTERN: Begründung der Einzelentscheidung, nie öffentlich.';
COMMENT ON COLUMN photobox_media.retired_at IS 'Wann die Verwendung zurückgenommen wurde (Offline durch Einreicher oder Redaktion); NULL, solange sie gilt.';
COMMENT ON COLUMN photobox_media.revision IS 'Fachrevision (ADR-0020): zählt allein der Trigger photobox_media_revision (public.revision_bump()).';

-- 2. DER INDEX DES EINGANGS --------------------------------------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS media_ingest_submission ON media_ingest (submission_id) WHERE submission_id IS NOT NULL;

-- 3. DIE TÄGLICHE AUFBEWAHRUNG KENNT DIE NEUE TAFEL ---------------------------------------------------------------------------------------

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
    v_alt RECORD;
    v_aktuell BIGINT;
    v_seit TIMESTAMPTZ;
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
           OR EXISTS (SELECT 1 FROM photobox_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
           -- Die Verwendung der Einreichung selbst hält die Einreichung, auch wenn sie nach einem Zusammenführen an einem anderen Asset hängt
           -- (der Fremdschlüssel auf die Einreichung ließe sonst den ganzen Lauf scheitern).
           OR EXISTS (SELECT 1 FROM photobox_media WHERE media_submission_id = v_einreichung.id AND retired_at IS NULL)
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
        -- Die Verwendung eines Reisebildes hält Asset UND Einreichung (zwei Fremdschlüssel): sie geht vor beiden.
        DELETE FROM photobox_media
         WHERE (media_asset_id = ANY(v_assets) OR media_submission_id = v_einreichung.id) AND retired_at IS NOT NULL;

        -- Der Eingang hält die Einreichung (Fremdschlüssel ohne ON DELETE) und das Asset (CASCADE); die Einreichung hält das freigegebene
        -- Asset. Deshalb: Eingang, Einreichung, Assets.
        DELETE FROM media_ingest WHERE media_asset_id = ANY(v_assets) OR submission_id = v_einreichung.id;
        DELETE FROM media_submission WHERE id = v_einreichung.id;
        DELETE FROM media_asset WHERE id = ANY(v_assets);
    END LOOP;

    -- 3. 🔴 Ersetzte Bilder (Review I3), in jedem Zustand der Einreichung: Assets, die weder das aktuelle Bild (das des jüngsten Eingangs, wie `aktuellesAsset` und die
    --    Fakten der Medienverwaltung) noch das freigegebene Medium sind. Die Einreichung selbst bleibt; nach dem Löschen hat sie einen Eingang weniger. Ein Asset mit
    --    aktiver Verwendung, Notaus, Zusammenführung oder Legacy-Quelle bleibt (dieselben Tafeln wie oben; der Wächter verlangt jede zweimal).
    FOR v_einreichung IN
        SELECT s.id, s.approved_media_asset_id
          FROM media_submission s
         WHERE s.id IN (SELECT i.submission_id FROM media_ingest i WHERE i.submission_id IS NOT NULL GROUP BY i.submission_id HAVING count(*) > 1)
         ORDER BY s.id
           FOR UPDATE OF s SKIP LOCKED
    LOOP
        SELECT i.media_asset_id, i.created_at INTO v_aktuell, v_seit
          FROM media_ingest i
         WHERE i.submission_id = v_einreichung.id
         ORDER BY i.id DESC
         LIMIT 1;
        -- Schonfrist: Das letzte Ersetzen liegt noch keinen Tag zurück.
        IF v_seit >= p_jetzt - interval '1 day' THEN
            CONTINUE;
        END IF;

        FOR v_alt IN
            SELECT DISTINCT i.media_asset_id AS id
              FROM media_ingest i
             WHERE i.submission_id = v_einreichung.id
               AND i.media_asset_id <> v_aktuell
               AND i.media_asset_id IS DISTINCT FROM v_einreichung.approved_media_asset_id
             ORDER BY 1
        LOOP
            v_assets := ARRAY[v_alt.id];

            IF EXISTS (SELECT 1 FROM place_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
               OR EXISTS (SELECT 1 FROM territory_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
               OR EXISTS (SELECT 1 FROM adventure_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
               OR EXISTS (SELECT 1 FROM citymap_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
               OR EXISTS (SELECT 1 FROM media_gallery_item WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
               OR EXISTS (SELECT 1 FROM media_type_image WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
               OR EXISTS (SELECT 1 FROM photobox_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NULL)
               OR EXISTS (SELECT 1 FROM media_submission WHERE approved_media_asset_id = v_alt.id)
               OR EXISTS (SELECT 1 FROM media_publication_suspension WHERE media_asset_id = ANY(v_assets))
               OR EXISTS (SELECT 1 FROM media_merge WHERE merged_asset_id = ANY(v_assets) OR kept_asset_id = ANY(v_assets))
               OR EXISTS (SELECT 1 FROM media_legacy_source WHERE media_asset_id = ANY(v_assets))
            THEN
                CONTINUE;
            END IF;

            WITH d AS (DELETE FROM media_file f WHERE f.media_asset_id = ANY(v_assets) RETURNING f.storage_key)
            SELECT COALESCE(array_agg(d.storage_key), '{}') INTO v_neu FROM d;
            v_schluessel := v_schluessel || v_neu;

            WITH d AS (DELETE FROM media_rights_evidence e WHERE e.media_asset_id = ANY(v_assets) RETURNING e.storage_key)
            SELECT COALESCE(array_agg(d.storage_key) FILTER (WHERE d.storage_key IS NOT NULL), '{}') INTO v_neu FROM d;
            v_schluessel := v_schluessel || v_neu;
            DELETE FROM media_rights WHERE media_asset_id = ANY(v_assets);
            DELETE FROM media_creation WHERE media_asset_id = ANY(v_assets);

            DELETE FROM place_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;
            DELETE FROM territory_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;
            DELETE FROM adventure_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;
            DELETE FROM citymap_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;
            DELETE FROM media_gallery_item WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;
            DELETE FROM media_type_image WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;
            DELETE FROM photobox_media WHERE media_asset_id = ANY(v_assets) AND retired_at IS NOT NULL;

            -- Der Eingang fällt mit dem Asset (Fremdschlüssel `ON DELETE CASCADE`); die Einreichung bleibt.
            DELETE FROM media_asset WHERE id = ANY(v_assets);
        END LOOP;
    END LOOP;

    -- 4. Die Schlüssel, die nach dem Löschen keine Zeile mehr hält (bytegleiche Werke teilen sich ihre Datei).
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
    'Tägliche Aufbewahrung der Reisebilder (WI-0272 S2): offene Einreichungen verfallen nach 60 Tagen, beendete werden 30 Tage danach samt Assets gelöscht, offline genommene verlieren ihre Dateien schon beim nächsten Lauf, außer eines hängt aktiv irgendwo (auch in photobox_media, seit 0293). Ersetzte Bilder (weder aktuelles noch freigegebenes Medium einer Einreichung) fallen in jedem Zustand einen Tag nach dem Ersetzen (seit 0293). Gibt die Speicherschlüssel der gelöschten Dateizeilen zurück; die Dateien löscht der Job. SECURITY DEFINER, nur für die Jobs-Rolle (media-grants.psql).';
