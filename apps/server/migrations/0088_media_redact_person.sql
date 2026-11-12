-- Konto auflösen: Freitext und Gerätespuren einer Person in den Medientabellen schwärzen (WI-0068 P2, §18 „Offen für P2“: „Freitext
-- mit Personenbezug in media_audit_event.details, override_reason, reason und lift_reason gehört in die Schwärzung“; WI-0120 A15,
-- Betreiber 2026-10-09 „1 B“: echt löschen, „Ehemalige Person lassen“). Gegenstück zu `avesmaps_auth.redact_person_events()` (0083)
-- für die Medien; `dissolve.ts` ruft beide in derselben Transaktion.
--
-- 🔴 Wessen Freitext? 0083 schwärzt den Freitext eines Eintrags, dessen GEGENSTAND die Person ist, und lässt den Freitext, den sie
-- als Handelnde über eine ANDERE Person schrieb (der gehört zu jener und fällt mit deren Auflösung). In den Medientabellen ist der
-- Gegenstand nie eine Person, sondern ein Bild, eine Verwendung oder eine Regel; ein Grund, den eine Person dort schrieb, beschreibt
-- also niemanden außer ihr selbst. Deshalb fällt er mit IHRER Auflösung:
--
-- 1. Fachprotokoll `media_audit_event.details` ihrer Operationen: die Freitextschlüssel `reason` und `note` (dieselbe Liste wie
--    `MEDIA_AUDIT_FREE_TEXT_KEYS` in `apps/server/src/media-editor/audit.ts`; jeder andere Schlüssel ist ein Code, eine Kennung oder
--    eine Zahl) werden "[geschwärzt]". Der Schlüssel bleibt, wie in 0083.
-- 2. `media_operation.request_hash` ihrer Operationen wird NULL: Der Hash über den Inhalt der Anfrage enthielt den Grund und ließe ihn
--    durch Raten bestätigen (wie 0083). Eine Wiederholung derselben Kennung bekommt danach 409 statt der Quittung. Dafür verliert die
--    Spalte ihr NOT NULL (Lockern verträgt das vorige Release; es liest die Spalte nicht).
-- 3. Ihre Begründungen von Einzelentscheidungen (`override_reason`, wo `override_decided_by` sie ist) an den vier Bindungen und den
--    Galerieeinträgen.
-- 4. Einzelbild-Notaus: `reason`, wo sie ihn setzte, `lift_reason`, wo sie ihn aufhob. Der Wächter aus 0086 lässt dafür genau EINEN
--    Übergang zu: ein vorhandener Text wird zur Marke. Bild, Asset, Person, Zeit und alles andere bleiben unveränderlich.
-- 5. `publication_rule.revoked_reason`, wo sie eine Regel widerrief. Das Betreiberzitat einer Regel bleibt: es ist die
--    Rechtsgrundlage der Freigabe, keine Begründung über sich selbst.
-- 6. Provenienz: `media_ingest.original_filename` ihrer eigenen Hochladungen wird NULL; der Dateiname stammt von ihrem Gerät (wie
--    `client_label` in 0083) und ist nur Anzeige.
--
-- Struktur bleibt: Kennungen, Zeiten, wer was entschied (`person.id`, ab jetzt „Ehemalige Person …“), Codes, Revisionen der Operation.
-- Die Revision eines geänderten Datensatzes steigt (Trigger aus 0086): Er hat sich geändert.
--
-- 🔴 Für die App-Rolle bleiben Protokoll, Operation und Provenienz „nur anhängen“ (media-grants.psql). Geschwärzt wird nur hier, in einer
-- Funktion mit `SECURITY DEFINER`, die der Migrationsrolle gehört, und immer nur für EINE Person. Die App-Rolle darf sie aufrufen
-- (`media-grants.psql`, Claudios Vorlage), weil `auth aufloesen` auf dem VPS mit ihr läuft. Wiederholbar: ein zweiter Aufruf gibt 0.
-- Rückgabe ist die Zahl der geänderten Zeilen. Fester Suchpfad, jeder Name voll qualifiziert (render-grants.test.ts).

ALTER TABLE media_operation ALTER COLUMN request_hash DROP NOT NULL;

COMMENT ON COLUMN media_operation.request_hash IS
    'SHA-256 des Anfrageinhalts ohne Geheimnisse. NULL nach dem Auflösen des Kontos der handelnden Person (Migration 0088): Die Kennung antwortet dann mit 409 statt der Quittung.';

-- Der Wächter aus 0086, abgeschrieben von dort und nur um den Übergang zur Marke erweitert.
CREATE OR REPLACE FUNCTION media_publication_suspension_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    mark CONSTANT text := '[geschwärzt]';
BEGIN
    IF (NEW.source_sha256, NEW.media_asset_id, NEW.suspended_by_person, NEW.suspended_at)
       IS DISTINCT FROM (OLD.source_sha256, OLD.media_asset_id, OLD.suspended_by_person, OLD.suspended_at)
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

CREATE OR REPLACE FUNCTION redact_person_media(person_ref uuid) RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
DECLARE
    mark_text CONSTANT text := '[geschwärzt]';
    mark CONSTANT jsonb := to_jsonb(mark_text);
    -- Die Freitextschlüssel des Fachprotokolls; dieselbe Liste wie MEDIA_AUDIT_FREE_TEXT_KEYS.
    free_text CONSTANT text[] := ARRAY['reason', 'note'];
    changed bigint;
    total bigint := 0;
BEGIN
    IF person_ref IS NULL THEN
        RETURN 0;
    END IF;

    -- 1. Fachprotokoll: Freitext in den Einträgen ihrer Operationen.
    UPDATE public.media_audit_event e
       SET details = e.details || (
               SELECT jsonb_object_agg(k.key, mark) FROM unnest(free_text) AS k (key)
                WHERE e.details ? k.key AND e.details -> k.key NOT IN ('null'::jsonb, mark)
           )
     WHERE e.operation_id IN (SELECT o.operation_id FROM public.media_operation o WHERE o.actor_person_id = person_ref)
       AND EXISTS (
               SELECT 1 FROM unnest(free_text) AS k (key)
                WHERE e.details ? k.key AND e.details -> k.key NOT IN ('null'::jsonb, mark)
           );
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;

    -- 2. Der Hash über den Inhalt ihrer Anfragen.
    UPDATE public.media_operation SET request_hash = NULL WHERE actor_person_id = person_ref AND request_hash IS NOT NULL;
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;

    -- 3. Ihre Begründungen von Einzelentscheidungen.
    UPDATE public.place_media SET override_reason = mark_text
     WHERE override_decided_by = person_ref AND override_reason IS NOT NULL AND override_reason <> mark_text;
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;
    UPDATE public.territory_media SET override_reason = mark_text
     WHERE override_decided_by = person_ref AND override_reason IS NOT NULL AND override_reason <> mark_text;
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;
    UPDATE public.adventure_media SET override_reason = mark_text
     WHERE override_decided_by = person_ref AND override_reason IS NOT NULL AND override_reason <> mark_text;
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;
    UPDATE public.citymap_media SET override_reason = mark_text
     WHERE override_decided_by = person_ref AND override_reason IS NOT NULL AND override_reason <> mark_text;
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;
    UPDATE public.media_gallery_item SET override_reason = mark_text
     WHERE override_decided_by = person_ref AND override_reason IS NOT NULL AND override_reason <> mark_text;
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;

    -- 4. Einzelbild-Notaus: Grund und Begründung der Wiederfreigabe.
    UPDATE public.media_publication_suspension SET reason = mark_text
     WHERE suspended_by_person = person_ref AND reason <> mark_text;
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;
    UPDATE public.media_publication_suspension SET lift_reason = mark_text
     WHERE lifted_by_person = person_ref AND lift_reason IS NOT NULL AND lift_reason <> mark_text;
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;

    -- 5. Ihr Grund für den Widerruf einer Freigaberegel (das Zitat der Regel bleibt).
    UPDATE public.publication_rule SET revoked_reason = mark_text
     WHERE revoked_by_person = person_ref AND revoked_reason IS NOT NULL AND revoked_reason <> mark_text;
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;

    -- 6. Der Dateiname ihrer eigenen Hochladungen.
    UPDATE public.media_ingest SET original_filename = NULL
     WHERE actor_person_id = person_ref AND original_filename IS NOT NULL;
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;

    RETURN total;
END;
$$;

COMMENT ON FUNCTION redact_person_media(uuid) IS
    'Konto auflösen (WI-0068 P2, Migration 0088): Freitext und Gerätespuren EINER Person in den Medientabellen schwärzen. Nur über dissolve.ts.';

-- Eine Funktion darf zunächst jeder aufrufen (PUBLIC); diese nur, wem `media-grants.psql` es erlaubt (die App-Rolle).
REVOKE ALL ON FUNCTION redact_person_media(uuid) FROM PUBLIC;
