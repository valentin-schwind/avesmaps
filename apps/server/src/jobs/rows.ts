import { JOB_MAX_RETRIES, type JobFinding, type JobOrigin, type JobState, type JobSummary } from "@avesmaps3d/shared";
import { KEIN_UMSTAND, wartegrund, type Warteumstand } from "./wartegrund.ts";

/**
 * Eine Zeile der Tabelle `job`, wie der Server sie in TypeScript hält. postgres.js liefert `BIGINT` als Text: die Nummern
 * (`id`, `seq`) werden hier einmal zu Zahlen (sie bleiben weit unter 2^53).
 */
export interface JobRow {
    id: number;
    publicId: string;
    kind: string;
    kindVersion: number;
    mapDomainId: string;
    origin: JobOrigin;
    actorRef: string | null;
    externalRef: string | null;
    label: string | null;
    inputRef: Record<string, unknown>;
    state: JobState;
    waitReason: string | null;
    priority: number;
    queuedAt: Date;
    notBefore: Date | null;
    firstRequestedAt: Date;
    coalescedCount: number;
    scopeKind: "domain" | "tiles";
    scopeTiles: number[];
    attempt: number;
    leaseOwner: string | null;
    leaseNo: number;
    leaseExpiresAt: Date | null;
    heartbeatAt: Date | null;
    phase: string | null;
    progress: number | null;
    cancelRequestedAt: Date | null;
    cancelReason: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    rssPeakMb: number | null;
    arrayBufferPeakMb: number | null;
    cpuMs: number | null;
    wallMs: number | null;
    swapSeenMb: number | null;
    memExpectedMb: number | null;
    phaseStats: Record<string, unknown>;
    findings: JobFinding[];
    result: Record<string, unknown> | null;
    errorCode: string | null;
    errorSummary: string | null;
    /** Öffentliche Kennungen der Vorgänger. */
    dependsOn: string[];
    /** Das erwartete Ende laut Auftrag selbst (`eta_at`, Migration 0228); fehlt ohne die Spalte. */
    etaAt?: Date | null;
}

/** Die Spalten der Tabelle in der Form, die `rowToJob` liest (snake_case, wie die Datenbank sie liefert). */
export interface RawJobRow {
    id: string | number;
    public_id: string;
    kind: string;
    kind_version: number;
    map_domain_id: string;
    origin: JobOrigin;
    actor_ref: string | null;
    external_ref: string | null;
    label: string | null;
    input_ref: Record<string, unknown> | null;
    state: JobState;
    wait_reason: string | null;
    priority: number;
    queued_at: Date;
    not_before: Date | null;
    first_requested_at: Date;
    coalesced_count: number;
    scope_kind: "domain" | "tiles";
    scope_tiles: number[] | null;
    attempt: number;
    lease_owner: string | null;
    lease_no: number;
    lease_expires_at: Date | null;
    heartbeat_at: Date | null;
    phase: string | null;
    progress: number | null;
    cancel_requested_at: Date | null;
    cancel_reason: string | null;
    started_at: Date | null;
    finished_at: Date | null;
    rss_peak_mb: number | null;
    arraybuffer_peak_mb: number | null;
    cpu_ms: string | number | null;
    wall_ms: string | number | null;
    swap_seen_mb: number | null;
    mem_expected_mb: number | null;
    phase_stats: Record<string, unknown> | null;
    findings: JobFinding[] | null;
    result: Record<string, unknown> | null;
    error_code: string | null;
    error_summary: string | null;
    depends_on: string[] | null;
    /** Erst mit Migration 0228; davor fehlt die Spalte, und `j.*` liefert sie nicht. */
    eta_at?: Date | null;
}

const toNumber = (value: string | number | null): number | null => (value === null ? null : Number(value));

export function rowToJob(row: RawJobRow): JobRow {
    return {
        id: Number(row.id),
        publicId: row.public_id,
        kind: row.kind,
        kindVersion: row.kind_version,
        mapDomainId: row.map_domain_id,
        origin: row.origin,
        actorRef: row.actor_ref,
        externalRef: row.external_ref,
        label: row.label,
        inputRef: row.input_ref ?? {},
        state: row.state,
        waitReason: row.wait_reason,
        priority: row.priority,
        queuedAt: row.queued_at,
        notBefore: row.not_before,
        firstRequestedAt: row.first_requested_at,
        coalescedCount: row.coalesced_count,
        scopeKind: row.scope_kind,
        scopeTiles: row.scope_tiles ?? [],
        attempt: row.attempt,
        leaseOwner: row.lease_owner,
        leaseNo: row.lease_no,
        leaseExpiresAt: row.lease_expires_at,
        heartbeatAt: row.heartbeat_at,
        phase: row.phase,
        progress: row.progress,
        cancelRequestedAt: row.cancel_requested_at,
        cancelReason: row.cancel_reason,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        rssPeakMb: row.rss_peak_mb,
        arrayBufferPeakMb: row.arraybuffer_peak_mb,
        cpuMs: toNumber(row.cpu_ms),
        wallMs: toNumber(row.wall_ms),
        swapSeenMb: row.swap_seen_mb,
        memExpectedMb: row.mem_expected_mb,
        phaseStats: row.phase_stats ?? {},
        findings: row.findings ?? [],
        result: row.result,
        errorCode: row.error_code,
        errorSummary: row.error_summary,
        dependsOn: row.depends_on ?? [],
        etaAt: row.eta_at ?? null,
    };
}

/** Ob ein Job „hängt“: `RUNNING` mit abgelaufener Lease (abgeleitet, nie gespeichert). */
export function isStalled(job: Pick<JobRow, "state" | "leaseExpiresAt">, now: Date): boolean {
    return job.state === "RUNNING" && job.leaseExpiresAt !== null && job.leaseExpiresAt.getTime() < now.getTime();
}

/** Läuft der Job noch (RUNNING), auch wenn er gerade hängt. */
export function isActive(job: Pick<JobRow, "state">): boolean {
    return job.state === "QUEUED" || job.state === "RUNNING";
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/**
 * Ein Job, wie die Statusseite ihn zeigt. Keine Namen, keine Pfade (Abschnitt 4.1).
 *
 * `umstand` (WI-0160) sagt, was die Umgebung über das Warten weiß — pausiert, Planer, Abholarten, laufende Arten. Ohne ihn bleibt es
 * beim Grund aus der Spalte; das brauchen Aufrufer, die nur fertige Zeilen zeigen.
 */
export function toSummary(job: JobRow, now: Date, umstand: Warteumstand = KEIN_UMSTAND): JobSummary {
    return {
        id: job.publicId,
        kind: job.kind,
        origin: job.origin,
        state: job.state,
        stalled: isStalled(job, now),
        label: job.label,
        waitReason: wartegrund(job, umstand),
        phase: job.phase,
        progress: job.progress,
        mapDomainId: job.mapDomainId,
        scope: { kind: job.scopeKind, tiles: job.scopeTiles },
        priority: job.priority,
        queuedAt: job.queuedAt.toISOString(),
        notBefore: iso(job.notBefore),
        startedAt: iso(job.startedAt),
        finishedAt: iso(job.finishedAt),
        heartbeatAt: iso(job.heartbeatAt),
        leaseExpiresAt: iso(job.leaseExpiresAt),
        attempt: job.attempt,
        maxAttempts: JOB_MAX_RETRIES + 1,
        wallMs: job.wallMs,
        rssPeakMb: job.rssPeakMb,
        memExpectedMb: job.memExpectedMb,
        swapSeenMb: job.swapSeenMb,
        cancelRequested: job.cancelRequestedAt !== null,
        cancelReason: job.cancelReason,
        errorCode: job.errorCode,
        errorSummary: job.errorSummary,
        findings: job.findings,
        coalescedCount: job.coalescedCount,
        dependsOn: job.dependsOn,
        result: job.result,
        // Nur ein laufender Auftrag hat ein Ende in Aussicht; ein alter Wert eines früheren Versuchs zählt nicht.
        ...(job.state === "RUNNING" && job.etaAt != null ? { etaAt: job.etaAt.toISOString() } : {}),
    };
}
