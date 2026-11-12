-- `job_event_add`: die Jobzeile zuerst, dann die Advisory-Sperre (WI-0248, Befund Stage 2026-10-23).
--
-- Der Fehler: Der Job „Höhenlinien nach vollem Lauf“ (`display_heights`) endete in der Phase `event` mit `deadlock detected`, obwohl
-- die Ableitung fertig war. Zwei Wege nahmen dieselben zwei Sperren in umgekehrter Reihenfolge:
--
--   Aufseher (`setJobPhase`, `completeJob`, `failJob`, `handOffJob` …): Jobzeile `FOR UPDATE`  →  `job_event_add` (Advisory-Sperre)
--   Job-Prozess (`addAreaEvent`, ein einzelnes `SELECT job_event_add(…)`): Advisory-Sperre  →  `INSERT INTO job_event`, und der
--                                                  Fremdschlüssel `job_event.job_id` nimmt dabei `FOR KEY SHARE` auf die Jobzeile
--
-- `FOR KEY SHARE` verträgt sich mit allem außer `FOR UPDATE`. Meldet der Job-Prozess die Phase `event` (Nachricht an den Aufseher,
-- ohne Antwort) und schreibt gleich danach sein Bereichsereignis, laufen beide Wege gleichzeitig: Der Aufseher hält die Zeile und
-- wartet auf die Advisory-Sperre, der Job-Prozess hält die Advisory-Sperre und wartet auf die Zeile. PostgreSQL bricht einen von
-- beiden nach einer Sekunde ab (SQLSTATE 40P01); traf es den Job-Prozess, war ein fertig gerechneter Job rot.
--
-- Die Behebung: Die Funktion nimmt dieselbe `FOR KEY SHARE`-Sperre, die der Fremdschlüssel ohnehin nähme, VOR der Advisory-Sperre.
-- Damit gilt für jeden Aufrufer dieselbe Reihenfolge, Zeile vor Advisory:
--
--   * Wer die Zeile schon selbst hält (`FOR UPDATE` oder `UPDATE` im selben Vorgang, alle Zustandswechsel des Aufsehers und der
--     `job_sync_*`-Funktionen), ändert nichts: Die eigene Sperre genügt, es kommt nichts hinzu.
--   * Wer nur ein Ereignis schreibt (`addAreaEvent`), wartet auf die Zeile, BEVOR er die Advisory-Sperre nimmt. Er hält dann nichts,
--     was der Aufseher braucht, und kommt nach dessen Commit durch.
--   * Absichtlich `KEY SHARE` und nicht `UPDATE`: Es ist exakt die Sperre des Fremdschlüssels, nur früher. Ein gewöhnliches `UPDATE`
--     der Zeile (Heartbeat, Fortschritt, Befund) blockiert sie nicht und wird von ihr nicht blockiert. Eine stärkere Sperre würde
--     den Heartbeat hinter jedes wartende Ereignis stellen und neue Zyklen schaffen.
--   * Ohne Job (`p_job_id IS NULL`, `map_event_add`, `map.changed`) entfällt der Schritt.
--
-- 🔴 Rein additiv: Name, Argumente, Rückgabe, Sprache und Rechte bleiben (`CREATE OR REPLACE` behält EXECUTE). Das vorige Release ruft
-- die Funktion unverändert auf. Die Funktion läuft mit den Rechten des Aufrufers; `FOR KEY SHARE` braucht UPDATE-Recht auf `job`,
-- das die Jobs-Rolle hat (`runtime-foundation.sh`: INSERT, UPDATE, DELETE auf job) und die SECURITY-DEFINER-Türen (`job_enqueue`,
-- `map_event_add`) unter der Migrationsrolle ohnehin.
--
-- 🪤 Nicht behoben, weil es die Regel „Ereignis als LETZTE Anweisung“ verletzt: Wer mehrere Ereignisse in einer Transaktion schreibt
-- und danach noch andere Jobzeilen sperrt (`cancelDependents`, `job_chain_cancel_waiting`: Ereignis je Zeile, dann die nächste
-- Ebene), hält die Advisory-Sperre über das nächste Zeilen-Update hinaus. Das ist ein anderer, seltener Weg; der Wiederholungsversuch
-- bei 40P01 (`retryOnDeadlock` in `apps/server/src/jobs/store.ts`) fängt die Einzelschritte des Aufsehers und `addAreaEvent` ab.

CREATE OR REPLACE FUNCTION job_event_add(
    p_kind TEXT,
    p_job_id BIGINT,
    p_map_domain_id TEXT,
    p_payload JSONB,
    p_scope_bounds JSONB DEFAULT NULL
) RETURNS BIGINT
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_seq BIGINT;
BEGIN
    IF p_job_id IS NOT NULL THEN
        -- Die Sperre des Fremdschlüssels, vor der Advisory-Sperre: Zeile → Advisory wie bei allen Zustandswechseln des Aufsehers.
        PERFORM 1 FROM job WHERE id = p_job_id FOR KEY SHARE;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('avesmaps3d:job-event'), 0);
    INSERT INTO job_event (kind, job_id, map_domain_id, scope_bounds, payload)
    VALUES (p_kind, p_job_id, p_map_domain_id, p_scope_bounds, COALESCE(p_payload, '{}'::jsonb))
    RETURNING seq INTO v_seq;
    PERFORM pg_notify('avesmaps3d_jobs', v_seq::text);
    RETURN v_seq;
END;
$$;

COMMENT ON FUNCTION job_event_add(TEXT, BIGINT, TEXT, JSONB, JSONB) IS
    'Ereignis schreiben und bekanntgeben. Sperrreihenfolge: Jobzeile (KEY SHARE) vor der Advisory-Sperre der Nummernvergabe (Migration 0217). IMMER als letzte Anweisung der Transaktion.';
