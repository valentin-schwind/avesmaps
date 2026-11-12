-- 0118: Benachrichtigungen über neue Stände (WI-0136 Erweiterung; Claudio 2026-10-13 „Glocke: Neu auf der Stage",
-- Nachtrag „auch in Production"; Betreiber 2026-10-13: „kann dein cron-job für neue features bei neuigkeiten das
-- benachrichtigungssystem nutzen?" und „wenn jemand neue features freigegeben hat, sollen in production für alle
-- benachrichtigungen erscheinen").
--
-- 🔴 REIN ADDITIV: Der CHECK wird **erweitert** (er lässt mehr zu, nie weniger), die Funktion bekommt einen dritten
-- Zielfall. Das vorige Release erträgt beides: Es schreibt keine der neuen Arten, und eine Art, die seine Oberfläche
-- nicht kennt, zeigt sie als unbekannten Satz an (`satzSchluessel` in `benachrichtigungen.ts` fällt auf
-- `notify.text.unbekannt`), statt zu brechen. Nichts wird umgestellt, nichts entfernt.

-- 1 Zwei neue Arten: „Neu auf der Stage" (nach jedem grünen automatischen Rollout) und „Neu in Production" (nach jeder
--   Freigabe, FREIGABE-0001 §2a). Beide trägt Claudios Korridor ein, beide über `quelle` gegen Doppelte gesichert
--   (`stage:<sha>`, `production:<release>`).
--
-- 🔴 Die Art steht ab hier NICHT mehr als CHECK in der Datenbank, sondern allein im Katalog `BENACHRICHTIGUNG_ARTEN`
--    (`packages/shared/src/benachrichtigung.ts`) — dieselbe Lehre wie bei den Jobarten (`packages/shared/src/jobs.ts`:
--    „Eine Jobart steht NICHT als CHECK in der Datenbank (ein neuer Name wäre sonst ein DROP CONSTRAINT mitten in einem
--    Blue/Green-Wechsel)“). Genau dieser Fall tritt hier ein: Der CHECK zu erweitern heißt, ihn fallen zu lassen und neu
--    zu setzen, während zwei Releases nebeneinander laufen. Ein CHECK weniger nimmt dem alten Code nichts; er erlaubt
--    mehr. Geschrieben wird ohnehin nur über `benachrichtige()`, und wer sie ruft, ist Code (die Auslöser des Kanals und
--    Claudios Korridor), kein Formular.
ALTER TABLE public.benachrichtigung DROP CONSTRAINT IF EXISTS benachrichtigung_art;

-- 2 Das Ziel „alle aktiven Personen dieser Umgebung" (`{"alle": true}`). Bisher gab es nur `person` und `rolle`; in
--   Production soll die Meldung alle Angemeldeten erreichen (Betreiber 2026-10-13), und je Rolle einzeln zu rufen
--   hieße, die Rollenliste an zwei Stellen zu pflegen.
--   🔴 Die Reihenfolge der Zweige bleibt: `person`, dann `rolle`, dann `alle`. Wer `{"person": …}` schickt, bekommt
--   weiter genau eine Zeile.
CREATE OR REPLACE FUNCTION public.benachrichtige(
    p_environment TEXT, p_an JSONB, p_von_art TEXT, p_von_person UUID, p_art TEXT, p_bezug_ops BIGINT, p_text TEXT, p_quelle TEXT,
    p_frage_geloest BOOLEAN DEFAULT false
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_anzahl INTEGER;
    v_ausser UUID := NULLIF(p_an->>'ausser', '')::uuid;
BEGIN
    IF p_an ? 'person' THEN
        INSERT INTO public.benachrichtigung (environment, an_person, von_art, von_person, art, bezug_ops, text, frage_geloest, quelle)
        SELECT p_environment, p.id, p_von_art, p_von_person, p_art, p_bezug_ops, NULLIF(btrim(p_text), ''), p_frage_geloest, p_quelle
          FROM avesmaps_auth.person p
         WHERE p.id = (p_an->>'person')::uuid AND p.status = 'active' AND p.id IS DISTINCT FROM v_ausser
        ON CONFLICT (an_person, quelle) DO NOTHING;
    ELSIF p_an ? 'rolle' THEN
        INSERT INTO public.benachrichtigung (environment, an_person, von_art, von_person, art, bezug_ops, text, frage_geloest, quelle)
        SELECT p_environment, p.id, p_von_art, p_von_person, p_art, p_bezug_ops, NULLIF(btrim(p_text), ''), p_frage_geloest, p_quelle
          FROM avesmaps_auth.person p
          JOIN avesmaps_auth.person_access a ON a.person_id = p.id
         WHERE a.environment = p_environment AND a.role = p_an->>'rolle' AND a.status = 'active' AND p.status = 'active'
           AND p.id IS DISTINCT FROM v_ausser
        ON CONFLICT (an_person, quelle) DO NOTHING;
    ELSIF (p_an->>'alle')::boolean IS TRUE THEN
        -- Jede Person mit aktivem Zugang zu DIESER Umgebung, unabhängig von der Rolle. Ein Konto ohne Zugang hier bekommt nichts.
        INSERT INTO public.benachrichtigung (environment, an_person, von_art, von_person, art, bezug_ops, text, frage_geloest, quelle)
        SELECT p_environment, p.id, p_von_art, p_von_person, p_art, p_bezug_ops, NULLIF(btrim(p_text), ''), p_frage_geloest, p_quelle
          FROM avesmaps_auth.person p
          JOIN avesmaps_auth.person_access a ON a.person_id = p.id
         WHERE a.environment = p_environment AND a.status = 'active' AND p.status = 'active'
           AND p.id IS DISTINCT FROM v_ausser
        ON CONFLICT (an_person, quelle) DO NOTHING;
    ELSE
        RAISE EXCEPTION 'benachrichtige: an braucht "person", "rolle" oder "alle"' USING ERRCODE = '22023';
    END IF;
    GET DIAGNOSTICS v_anzahl = ROW_COUNT;
    RETURN v_anzahl;
END;
$$;

-- 3 PUBLIC bekommt die Funktion nie (wie in 0107). Welche Rolle sie ausführen darf, steht in den Grant-Vorlagen
--   (`apps/server/src/db/system-grants.psql`): die App-Rolle wie bisher, neu die Jobs-Rolle, mit der Claudios Korridor
--   meldet (`avesmaps3d-corridor-jobs notify-stage`), wie bei `job_sync_*`.
REVOKE EXECUTE ON FUNCTION public.benachrichtige(TEXT, JSONB, TEXT, UUID, TEXT, BIGINT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
