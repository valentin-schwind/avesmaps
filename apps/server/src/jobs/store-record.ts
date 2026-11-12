import type { JobFinding } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { addEvent, asJson, cancelDependents, inTransaction, type LockedRun } from "./store.ts";

/**
 * Aufzeichnen (JOBS-0001 4.1, Q5): Ein bestehender Ablauf OHNE Aufseher (der tägliche Zug, ein Rollout, `legacy:update`) meldet sich selbst
 * als Job der Herkunft `recorded`: Start (`job_insert`), Phasen, Ende. Kein Aufseher kann ihn neu starten: bleibt die Meldung aus, läuft
 * die Lease ab, und der Planer macht ihn zu `FAILED` mit `recorder_lost` (`recoverExpired` in `store.ts`).
 *
 * Die Funktionen sind die Schreibseite des Recorders (`recorder.ts`, best effort); `countActive` ist die Frage des Zuges „läuft ein Import?“.
 */

// --- Aufzeichnen (origin = recorded) ------------------------------------------------------------------------

/** Wie ein Aufruf von `jobs-cli record` einen Job findet: seine öffentliche Kennung oder die `external_ref` des Aufrufers. */
export type RecordRef = { publicId: string } | { externalRef: string };

export interface RecordPhase {
    phase: string;
    progress?: number | null;
    memExpectedMb?: number | null;
    rssMb?: number | null;
    /** Die Messung der Phase, die gerade endete (Name und Dauer). */
    finished?: { name: string; wallMs: number; rssPeakMb?: number | null } | null;
    /**
     * Warum dieser Lauf gerade wartet, als Satzteil („hinter Gelände voll: Fassung 17“, WI-0143). Fehlt er, steht der Grund auf
     * `NULL`: Wer eine Phase meldet, in der er nicht wartet, wartet nicht mehr. `wait_reason` trägt KEINEN `CHECK`, damit ein
     * neuer Grund kein Schemawechsel ist (0070); die Statusseite zeigt einen unbekannten Grund als Freitext.
     */
    waitReason?: string | null;
    /**
     * Die Beschriftung neu setzen (der Stand und die Feature-Liste einer Auslieferung ändern sich, während sie wartet). Fehlt
     * sie, bleibt die vorhandene: Ein Aufrufer ohne eigene Beschriftung löscht keine.
     */
    label?: string | null;
}

async function lockRecorded(tx: Queryable, ref: RecordRef): Promise<LockedRun | null> {
    const rows =
        "publicId" in ref
            ? await tx<(Omit<LockedRun, "id"> & { id: string })[]>`
                  SELECT id::text, state, origin, lease_no, attempt, cancel_requested_at, cancel_reason, phase, public_id, kind, map_domain_id
                  FROM job WHERE public_id = ${ref.publicId}::uuid AND origin = 'recorded' FOR UPDATE
              `
            : await tx<(Omit<LockedRun, "id"> & { id: string })[]>`
                  SELECT id::text, state, origin, lease_no, attempt, cancel_requested_at, cancel_reason, phase, public_id, kind, map_domain_id
                  FROM job WHERE external_ref = ${ref.externalRef} AND origin = 'recorded' AND state IN ('QUEUED', 'RUNNING')
                  ORDER BY id DESC LIMIT 1 FOR UPDATE
              `;
    const row = rows[0];
    return row ? { ...row, id: Number(row.id) } : null;
}

/**
 * Ein angekündigter Lauf wird übernommen (WI-0248): Die Freigabe-Route reiht beim Druck einen aufgezeichneten Auftrag mit der Person als `QUEUED`
 * ein (`freigabe_auftrag_einreihen`, Migration 0228); kommt der Abholer mit `record start` und demselben Ref, findet `job_insert` ihn (`created =
 * false`), und hier wird er zum laufenden Lauf: Lease, Beginn, Versuch, ohne Wartegrund. Person, Ref und Beschriftung bleiben. `false`: Es gab
 * nichts zu übernehmen (der Lauf lief schon, oder es ist keine angekündigte Zeile dieser Art).
 */
export async function uebernimmAngekuendigt(
    db: Queryable,
    publicId: string,
    kind: string,
    takeover: { leaseOwner: string; leaseS: number; memExpectedMb: number | null; release: string | null },
): Promise<boolean> {
    return inTransaction(db, async (tx) => {
        const rows = await tx<
            { id: string; public_id: string; kind: string; map_domain_id: string; attempt: number }[]
        >`
            UPDATE job SET
                state = 'RUNNING', wait_reason = NULL, lease_owner = ${takeover.leaseOwner}, lease_no = lease_no + 1,
                lease_expires_at = now() + make_interval(secs => ${takeover.leaseS}), heartbeat_at = now(),
                started_at = now(), attempt = attempt + 1,
                mem_expected_mb = COALESCE(${takeover.memExpectedMb}::integer, mem_expected_mb),
                release = COALESCE(release, ${takeover.release})
            WHERE public_id = ${publicId}::uuid AND kind = ${kind} AND origin = 'recorded' AND state = 'QUEUED'
            RETURNING id::text, public_id::text, kind, map_domain_id, attempt
        `;
        const row = rows[0];
        if (!row) return false;
        await addEvent(
            tx,
            "job.started",
            { id: Number(row.id), mapDomainId: row.map_domain_id, publicId: row.public_id, kind: row.kind },
            { state: "RUNNING", attempt: row.attempt, angekuendigt: true },
        );
        return true;
    });
}

/** Eine Meldung eines aufgezeichneten Ablaufs: Phase und Lebenszeichen. `terminal`: der Job ist schon beendet (nichts geschrieben). */
export async function recordPhase(
    db: Queryable,
    ref: RecordRef,
    update: RecordPhase,
    leaseS: number,
): Promise<"ok" | "unknown" | "terminal"> {
    return inTransaction(db, async (tx) => {
        const run = await lockRecorded(tx, ref);
        if (!run) return "unknown";
        if (run.state !== "RUNNING") return "terminal";
        const finished = update.finished
            ? {
                  [update.finished.name]: {
                      wallMs: update.finished.wallMs,
                      rssPeakMb: update.finished.rssPeakMb ?? null,
                  },
              }
            : {};
        await tx`
            UPDATE job SET
                phase = ${update.phase}, progress = ${update.progress ?? null}::real,
                wait_reason = ${update.waitReason ?? null},
                label = COALESCE(${update.label ?? null}, label),
                lease_expires_at = now() + make_interval(secs => ${leaseS}), heartbeat_at = now(),
                mem_expected_mb = COALESCE(${update.memExpectedMb ?? null}::integer, mem_expected_mb),
                rss_peak_mb = GREATEST(rss_peak_mb, ${update.rssMb ?? null}::integer),
                phase_stats = phase_stats || ${asJson(tx, finished)}::jsonb
            WHERE id = ${run.id}
        `;
        if (run.phase !== update.phase) {
            await addEvent(
                tx,
                "job.phase",
                { id: run.id, mapDomainId: run.map_domain_id, publicId: run.public_id, kind: run.kind },
                {
                    state: "RUNNING",
                    phase: update.phase,
                    // Die Phase davor: Daraus liest `recordedRunSeconds`, wann ein Lauf aufhörte zu warten.
                    vorher: run.phase,
                },
            );
        }
        return "ok";
    });
}

/** Die Phase, in der ein aufgezeichneter Lauf nur wartet und nicht rechnet (der Rollout hinter fremden Aufträgen, Claudio 2026-10-19). */
const WARTE_PHASE = "wartet";

/** Ein bloßes Lebenszeichen eines aufgezeichneten Ablaufs (verlängert die Lease). */
export async function recordHeartbeat(
    db: Queryable,
    ref: RecordRef,
    leaseS: number,
): Promise<"ok" | "unknown" | "terminal"> {
    return inTransaction(db, async (tx) => {
        const run = await lockRecorded(tx, ref);
        if (!run) return "unknown";
        if (run.state !== "RUNNING") return "terminal";
        await tx`
            UPDATE job SET heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => ${leaseS}) WHERE id = ${run.id}
        `;
        return "ok";
    });
}

/**
 * Wie lange der aufgezeichnete Lauf schon arbeitet (Sekunden); `null` ohne laufenden Job dazu. Für die Rate des Swap-Befunds (MS9).
 * Gezählt wird ab dem letzten Wechsel heraus aus einer Wartephase, sonst ab `started_at`: Ein Rollout wird mit „wartet“ angelegt, und
 * `started_at` liegt dann um die Wartezeit vor „bauen“ (Claudio 2026-10-19, Job 2222: 6 min).
 */
export async function recordedRunSeconds(db: Queryable, ref: RecordRef): Promise<number | null> {
    const [row] =
        "publicId" in ref
            ? await db<{ id: string; started_at: Date | null }[]>`
                  SELECT id::text, started_at FROM job WHERE public_id = ${ref.publicId}::uuid AND origin = 'recorded'
              `
            : await db<{ id: string; started_at: Date | null }[]>`
                  SELECT id::text, started_at FROM job
                  WHERE external_ref = ${ref.externalRef} AND origin = 'recorded' AND state IN ('QUEUED', 'RUNNING')
                  ORDER BY id DESC LIMIT 1
              `;
    if (!row?.started_at) return null;
    const [warten] = await db<{ ende: Date | null }[]>`
        SELECT max(at) AS ende FROM job_event
        WHERE job_id = ${Number(row.id)} AND kind = 'job.phase' AND payload ->> 'vorher' = ${WARTE_PHASE}
    `;
    const ab = warten?.ende ?? row.started_at;
    return Math.max(0, (Date.now() - ab.getTime()) / 1000);
}

export interface RecordFinish {
    ok: boolean;
    errorCode?: string | null;
    errorSummary?: string | null;
    rssPeakMb?: number | null;
    swapSeenMb?: number | null;
    findings?: JobFinding[];
    result?: Record<string, unknown> | null;
}

/** Der aufgezeichnete Ablauf ist zu Ende. `false`: es gab keinen aktiven Job dazu (nichts geschrieben). */
export async function recordFinish(db: Queryable, ref: RecordRef, finish: RecordFinish): Promise<boolean> {
    return inTransaction(db, async (tx) => {
        const run = await lockRecorded(tx, ref);
        if (!run || run.state !== "RUNNING") return false;
        const target = { id: run.id, mapDomainId: run.map_domain_id, publicId: run.public_id, kind: run.kind };
        const state = finish.ok ? "SUCCEEDED" : "FAILED";
        await tx`
            UPDATE job SET
                state = ${state}, finished_at = now(), wait_reason = NULL,
                wall_ms = (extract(epoch FROM now() - started_at) * 1000)::bigint,
                progress = CASE WHEN ${finish.ok} THEN 1 ELSE progress END,
                rss_peak_mb = GREATEST(rss_peak_mb, ${finish.rssPeakMb ?? null}::integer),
                swap_seen_mb = GREATEST(swap_seen_mb, ${finish.swapSeenMb ?? null}::integer),
                findings = findings || ${asJson(tx, finish.findings ?? [])}::jsonb,
                result = ${finish.result ? asJson(tx, finish.result) : null}::jsonb,
                error_code = ${finish.ok ? null : (finish.errorCode ?? "failed")},
                error_summary = ${finish.ok ? null : (finish.errorSummary ?? null)}
            WHERE id = ${run.id}
        `;
        if (!finish.ok) await cancelDependents(tx, { id: run.id, state: "FAILED" });
        await addEvent(tx, finish.ok ? "job.succeeded" : "job.failed", target, {
            state,
            ...(finish.ok ? {} : { code: finish.errorCode ?? "failed" }),
        });
        return true;
    });
}

/** Wie viele aktive Jobs der Arten laufen gerade (RUNNING mit gültiger Lease)? Für `jobs-cli status --active`. */
export async function countActive(db: Queryable, kinds: readonly string[]): Promise<number> {
    const [row] = await db<{ n: string }[]>`
        SELECT count(*)::text AS n FROM job
        WHERE state = 'RUNNING' AND lease_expires_at >= now()
          AND (${kinds.length === 0}::boolean OR kind = ANY(${db.array([...kinds], 1009)}::text[]))
    `;
    return Number(row?.n ?? 0);
}
