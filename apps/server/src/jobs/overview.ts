import {
    JOB_PLANNER_LOCK_CLASS,
    JOBS_FINISHED_LIMIT,
    type JobsConfig,
    type JobSummary,
    type JobsMemory,
    type JobsOverview,
    type QueueEntry,
    type WarteschlangeUmgebung,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { compareCandidates } from "./admission.ts";
import { anzeigenamen, ausloeserVon } from "./ausloeser.ts";
import {
    durationStat,
    estimateDuration,
    estimateQueue,
    type DurationStat,
    type QueuedForEstimate,
    type RunningForEstimate,
} from "./estimate.ts";
import { JOB_KIND_CATALOG, claimsSlot, expectedMemoryMb, knowsKind, threadsFor } from "./kinds.ts";
import { readSystemMemory, type MemoryProbe } from "./memory.ts";
import { dirigentPlant, gemeinsameWarteschlange, leseEigeneAnweisung, pauseAnsicht } from "./gemeinsame-reihe.ts";
import { ownSummary } from "./own-view.ts";
import { isStalled, toSummary, type JobRow } from "./rows.ts";
import type { StandLage } from "./stand-datei.ts";
import { umstandMitStand, type Warteumstand } from "./wartegrund.ts";
import {
    isRolloutActive,
    latestSeq,
    listFinished,
    listQueued,
    listRunning,
    loadPendingDependencies,
    loadWallMsHistory,
} from "./store.ts";

/**
 * Der Stand der Queue für die Statusseite (JOBS-0001 5.2 bis 5.4): läuft, wartet (mit Position, Grund und geschätzter Zeit), fertig,
 * fehlgeschlagen, hängt, dazu das Speicherbudget. Fastify liest nur: Dieser Aufbau schreibt nie.
 */

export interface OverviewOptions {
    database: Queryable;
    config: JobsConfig;
    releaseId: string;
    mapDomainId: string;
    memory?: MemoryProbe;
    now?: () => Date;
    /** Wie viele fertige und fehlgeschlagene Jobs die Seite zeigt. */
    recentLimit?: number;
    /** Der Schlüssel der Planersperre (Tests nehmen einen eigenen). */
    plannerScope?: string;
    /** Die eigene Sicht eines Editors (WI-0120 A11, JOBS-0001 D1 A): nur Jobs dieses Auslösers, ohne Speicher und Befunde. */
    owner?: string;
    /**
     * Die Jobarten, die Claudios Abholer übernimmt (`ABGLEICHE=korridor`, WI-0160): Ohne sie kann die Seite nicht sagen, dass eine
     * Zeile auf die Abholung wartet — in Production schreibt kein Planer diesen Grund.
     */
    pickupKinds?: ReadonlySet<string>;
    /**
     * Der Stand der gemeinsamen Warteschlange (WI-0163) und wie diese Umgebung darin heißt. Ohne ihn (oder ohne Stand-Datei) gilt die
     * eigene Tafel wie bis WI-0163.
     */
    stand?: { lage: StandLage; umgebung: WarteschlangeUmgebung } | undefined;
}

/** Lebt gerade ein Planer? Ein Worker hält den Advisory Lock `(avesmaps3d:job-worker, <Domäne>)`. */
export async function isPlannerActive(database: Queryable, mapDomainId: string, scope?: string): Promise<boolean> {
    const [row] = await database<{ active: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM pg_locks
            WHERE locktype = 'advisory' AND granted AND objsubid = 2
              AND classid::bigint = (hashtext(${JOB_PLANNER_LOCK_CLASS})::bigint & 4294967295)
              AND objid::bigint = (hashtext(${scope ?? mapDomainId})::bigint & 4294967295)
        ) AS active
    `;
    return row?.active === true;
}

/**
 * Lebt ein Planer für diese Umgebung? 🔴 Mit Stand-Datei (WI-0163) entscheidet allein der Stand: frisch (höchstens 30 s alt) und der
 * Dirigent plant diese Umgebung. Die Planersperre in `pg_locks` sagte dann nichts mehr: Die Abfrage filtert nicht nach der Datenbank,
 * und ein Dirigent für mehrere Umgebungen hält die Sperre in jeder. Ohne Stand-Datei die Planersperre wie bis WI-0163.
 */
export async function planerAktiv(
    database: Queryable,
    mapDomainId: string,
    stand: { lage: StandLage; umgebung: WarteschlangeUmgebung } | undefined,
    scope?: string,
): Promise<boolean> {
    const ausStand = stand === undefined ? undefined : dirigentPlant(stand.lage, stand.umgebung);
    return ausStand ?? isPlannerActive(database, mapDomainId, scope);
}

function statsByKind(wallMs: Record<string, number[]>): Record<string, DurationStat> {
    const stats: Record<string, DurationStat> = {};
    for (const [kind, values] of Object.entries(wallMs)) {
        const stat = durationStat(values);
        if (stat) stats[kind] = stat;
    }
    return stats;
}

function runningResources(job: JobRow, config: JobsConfig): { memExpectedMb: number | null; threads: number | null } {
    const spec = JOB_KIND_CATALOG[job.kind];
    return {
        memExpectedMb:
            job.memExpectedMb ?? (spec ? expectedMemoryMb(spec, job.inputRef, job.phase, config, null) : null),
        threads: spec ? threadsFor(spec, config) : null,
    };
}

export async function buildJobsOverview(options: OverviewOptions): Promise<JobsOverview> {
    const { database, config } = options;
    const now = (options.now ?? (() => new Date()))();
    const limit = options.recentLimit ?? JOBS_FINISHED_LIMIT;
    const readMemory = options.memory ?? readSystemMemory;

    const [queuedRows, runningRows, recentRows, failedRows, seq, rolloutActive, wallMs, plannerActive, pause] =
        await Promise.all([
            listQueued(database),
            listRunning(database),
            listFinished(database, ["SUCCEEDED", "CANCELLED"], limit, options.owner),
            listFinished(database, ["FAILED"], limit, options.owner),
            latestSeq(database),
            isRolloutActive(database),
            loadWallMsHistory(database),
            planerAktiv(database, options.mapDomainId, options.stand, options.plannerScope),
            leseEigeneAnweisung(database),
        ]);
    // Der Umstand für den Wartegrund (WI-0160): aus dem, was dieser Aufbau ohnehin liest — kein zweites Lesen. Mit frischem Stand
    // des Dirigenten gelten dessen Gründe und die wirksame Pause (WI-0163).
    const eigenerUmstand: Warteumstand = {
        queuePaused: pause.paused,
        plannerActive,
        pickupKinds: options.pickupKinds ?? new Set(),
        runningKinds: new Set(runningRows.map((row) => row.kind)),
        eigene: pause,
    };
    const umstand =
        options.stand === undefined
            ? eigenerUmstand
            : umstandMitStand(eigenerUmstand, options.stand.lage, options.stand.umgebung);
    const pending = await loadPendingDependencies(
        database,
        queuedRows.map((row) => row.id),
    );
    const history = statsByKind(wallMs);
    const memory = readMemory();
    // Wer jeden Auftrag ausgelöst hat (WI-0293): die Namen in EINER Abfrage für alle Listen dieser Umgebung.
    const namen = await anzeigenamen(
        database,
        [...queuedRows, ...runningRows, ...recentRows, ...failedRows].map((row) => row.actorRef),
    );
    const zeile = (row: JobRow): JobSummary => ({
        ...toSummary(row, now, umstand),
        ausgeloest: ausloeserVon(row, namen),
    });

    // Nur Läufe mit Bedarf: die Marke `rollout` wirkt allein über `rolloutActive`, die Auslieferung `stage_rollout` beobachtet
    // sich selbst. Beide stehen auf der Seite, belegen aber keinen Platz und halten nichts hinter sich auf (`claimsSlot`).
    const runningForEstimate: RunningForEstimate[] = runningRows
        .filter((row) => claimsSlot(row.kind))
        .map((row) => ({
            id: row.id,
            kind: row.kind,
            mapDomainId: row.mapDomainId,
            scopeKind: row.scopeKind,
            scopeTiles: row.scopeTiles,
            ...runningResources(row, config),
            startedAtMs: (row.startedAt ?? row.queuedAt).getTime(),
            duration: estimateDuration(row.kind, row.inputRef, config, history),
        }));

    const queuedForEstimate: QueuedForEstimate[] = queuedRows.map((row) => {
        const spec = JOB_KIND_CATALOG[row.kind];
        const known = spec !== undefined && knowsKind(row.kind, row.kindVersion);
        return {
            id: row.id,
            kind: row.kind,
            mapDomainId: row.mapDomainId,
            scopeKind: row.scopeKind,
            scopeTiles: row.scopeTiles,
            priority: row.priority,
            queuedAtMs: row.queuedAt.getTime(),
            notBeforeMs: row.notBefore?.getTime() ?? null,
            memExpectedMb: known ? expectedMemoryMb(spec, row.inputRef, null, config, null) : null,
            threads: known ? threadsFor(spec, config) : null,
            dependenciesDone: !pending.has(row.id),
            pendingDependsOn: pending.get(row.id) ?? [],
            duration: estimateDuration(row.kind, row.inputRef, config, history),
        };
    });
    // Ein angekündigter Lauf (Herkunft `recorded`, noch `QUEUED`: die Production-Freigabe vor der Abholung, WI-0248) startet nicht über die
    // Warteschlange: Er bekommt keinen geschätzten Start, und kein anderer wartet in der Rechnung hinter ihm.
    const angekuendigt = new Set(queuedRows.filter((row) => row.origin !== "queued").map((row) => row.id));
    const estimates = estimateQueue({
        nowMs: now.getTime(),
        queued: queuedForEstimate.filter((candidate) => !angekuendigt.has(candidate.id)),
        running: runningForEstimate,
        config,
        rolloutActive,
        memAvailableMb: memory?.availableMb ?? null,
    });

    const order = [...queuedForEstimate].sort(
        (a, b) => Number(angekuendigt.has(a.id)) - Number(angekuendigt.has(b.id)) || compareCandidates(a, b),
    );
    const position = positionen(
        order.map((candidate) => (queuedRows.find((entry) => entry.id === candidate.id) as JobRow).publicId),
        umstand.stand?.plaetze,
    );
    const queued: QueueEntry[] = order.map((candidate) => {
        const row = queuedRows.find((entry) => entry.id === candidate.id) as JobRow;
        const estimate = estimates.get(candidate.id);
        return {
            ...zeile(row),
            position: position.get(row.publicId) ?? 1,
            estimate: {
                startAt: estimate?.startMs == null ? null : new Date(estimate.startMs).toISOString(),
                finishAt: estimate?.finishMs == null ? null : new Date(estimate.finishMs).toISOString(),
                durationP50S: estimate?.duration.p50S ?? candidate.duration.p50S,
                durationP95S: estimate?.duration.p95S ?? candidate.duration.p95S,
                basis: estimate?.duration.basis ?? candidate.duration.basis,
            },
        };
    });
    // Mit dem Stand des Dirigenten zählt der Platz in der GEMEINSAMEN Reihe; die Liste folgt ihm.
    if (umstand.stand !== undefined) queued.sort((a, b) => a.position - b.position);

    const running = runningRows.map(zeile);
    const jobsMemory: JobsMemory = {
        bookedMb: Math.round(runningForEstimate.reduce((total, job) => total + (job.memExpectedMb ?? 0), 0)),
        budgetMb: config.memTotalBudgetMb,
        availableMb: memory?.availableMb ?? null,
        availFloorMb: config.memAvailFloorMb,
        swapUsedMb: memory?.swapUsedMb ?? null,
        rolloutActive,
    };
    const full = options.owner === undefined;
    const stand = options.stand ?? {
        lage: { zustand: "nicht_eingerichtet" as const },
        umgebung: "development" as const,
    };
    const queuePause = await pauseAnsicht(database, stand.lage, stand.umgebung, pause, { full });
    const overview: JobsOverview = {
        seq,
        now: now.toISOString(),
        releaseId: options.releaseId,
        profile: config.profile,
        plannerActive,
        queuePause,
        view: "all",
        running,
        queued,
        recent: recentRows.map(zeile),
        failed: failedRows.map(zeile),
        stalled: runningRows.filter((row) => isStalled(row, now)).map(zeile),
        memory: jobsMemory,
        ...(options.stand === undefined ? {} : { umgebung: options.stand.umgebung }),
    };
    const owner = options.owner;
    if (owner === undefined) {
        const gemeinsam = gemeinsameWarteschlange(stand.lage, stand.umgebung, queuePause);
        return gemeinsam === undefined ? overview : { ...overview, gemeinsam };
    }
    // Positionen und Schätzungen sind über die ganze Warteschlange gerechnet; gezeigt werden nur die eigenen Zeilen.
    const own = new Set(
        [...queuedRows, ...runningRows].filter((row) => row.actorRef === owner).map((row) => row.publicId),
    );
    const gemeinsam = gemeinsameWarteschlange(stand.lage, stand.umgebung, queuePause, { nurEigene: own });
    return {
        ...overview,
        ...(gemeinsam === undefined ? {} : { gemeinsam }),
        view: "own",
        running: overview.running.filter((job) => own.has(job.id)).map(ownSummary),
        queued: overview.queued.filter((job) => own.has(job.id)).map(ownSummary),
        recent: overview.recent.map(ownSummary),
        failed: overview.failed.map(ownSummary),
        stalled: overview.stalled.filter((job) => own.has(job.id)).map(ownSummary),
        memory: null,
    };
}

/**
 * Die Plätze der wartenden Aufträge in der Reihenfolge `ids`: ohne Stand 1, 2, 3 … wie bisher. Mit frischem Stand (WI-0163) der Platz
 * in der gemeinsamen Reihe; wer dort noch nicht steht (eben eingereiht), kommt dahinter.
 */
export function positionen(
    ids: readonly string[],
    plaetze: ReadonlyMap<string, number | null> | undefined,
): Map<string, number> {
    if (plaetze === undefined) return new Map(ids.map((id, index) => [id, index + 1]));
    const bekannt = [...plaetze.values()].filter((platz): platz is number => platz !== null);
    let naechster = bekannt.length === 0 ? 1 : Math.max(...bekannt) + 1;
    return new Map(ids.map((id) => [id, plaetze.get(id) ?? naechster++]));
}
