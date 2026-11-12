import type postgres from "postgres";
import {
    JOB_MAX_RETRIES,
    type CancelReason,
    type JobEventRecord,
    type JobFinding,
    type JobOrigin,
    type JobState,
} from "@avesmaps3d/shared";
import { isDeadlock, type Queryable } from "../database.ts";
import { GEBIETS_TEILLAUF_DAUER, TERRITORY_DERIVE_JOB_KIND } from "./gebiets-arten.ts";
import { rowToJob, type JobRow, type RawJobRow } from "./rows.ts";

/**
 * Die Tabelle `job` in TypeScript (JOBS-0001 4.2 bis 4.6): Zustandsmaschine, Claim, Lease, Heartbeat, Fencing,
 * Wiederholung, Abbruch.
 *
 * 🔴 FENCING. `lease_no` steigt bei jedem Claim. Jeder schreibende Schritt eines Läufers (Heartbeat, Phase, Ergebnis,
 * Veröffentlichung) trägt sie und gilt nur, solange sie noch die der Zeile ist; weicht sie ab, ist die Antwort `fenced` und
 * nichts ist geschrieben. So veröffentlicht ein Job mit abgelaufener Lease nie etwas, auch wenn sein Prozess noch lebt.
 *
 * 🔴 JEDER ZUSTANDSWECHSEL SCHREIBT SEIN EREIGNIS IN DERSELBEN TRANSAKTION, als LETZTE Anweisung (`job_event_add` nimmt eine
 * Sperre bis zum Ende der Transaktion, siehe Migration 0070). `NOTIFY` wird erst mit `COMMIT` zugestellt: Kein Client hört
 * von etwas, das nicht festgeschrieben ist.
 *
 * 🔴 SPERRREIHENFOLGE: erst die Jobzeile, dann die Advisory-Sperre der Ereignisnummer. Die Zustandswechsel hier sperren die Zeile
 * mit `FOR UPDATE` und rufen `job_event_add` danach; `job_event_add` selbst nimmt seit Migration 0217 die Zeile (`KEY SHARE`)
 * VOR der Advisory-Sperre, damit ein Ereignis, das ein anderer Prozess für denselben Job schreibt (`addAreaEvent`), nicht in
 * umgekehrter Reihenfolge wartet (Deadlock auf der Stage, 2026-10-23). Wer mehrere Ereignisse schreibt und danach noch andere
 * Jobzeilen sperrt (`cancelDependents`), verletzt die Regel „Ereignis als letzte Anweisung“ und bleibt der seltene Rest, den
 * `retryOnDeadlock` am Aufseher auffängt.
 *
 * Alles hier nimmt `Queryable`: an der Verbindung beginnt es seine Transaktion selbst, in einer Transaktion läuft es mit.
 */

type Sql = postgres.Sql;
type JsonValue = postgres.JSONValue;

/** Führt `work` in einer Transaktion aus: an der Verbindung neu, in einer Transaktion läuft es mit. */
export function inTransaction<T>(db: Queryable, work: (tx: Queryable) => Promise<T>): Promise<T> {
    const maybeBegin = (db as Partial<Sql>).begin;
    if (typeof maybeBegin === "function") {
        return (db as Sql).begin((tx) => work(tx)) as unknown as Promise<T>;
    }
    return work(db);
}

export { isDeadlock };

/**
 * Wiederholt einen einzelnen Schreibversuch EINMAL, wenn PostgreSQL ihn als Opfer eines Deadlocks abgebrochen hat (SQLSTATE 40P01).
 * Die Sperrreihenfolge von `job_event_add` ist behoben (Migration 0217); dies fängt einen seltenen Rest ab, damit er nicht einen
 * fertig gerechneten Job rot macht oder den Abschluss des Aufsehers verliert. Das Opfer hat nichts geschrieben, der Gegner ist
 * meist Sekundenbruchteile später fertig: eine kurze, zufällige Pause, dann ein zweiter Versuch; scheitert auch der, geht der Fehler
 * an den Aufrufer.
 *
 * 🔴 Nur an der Verbindung, wo `attempt` seine Transaktion selbst beginnt und endet. Innerhalb einer Transaktion ist die ganze
 * Transaktion abgebrochen (jede weitere Anweisung scheitert mit 25P02): Dort entscheidet der Aufrufer, was zu wiederholen ist.
 * `attempt` darf nichts außerhalb der Datenbank bewirken, denn es läuft gegebenenfalls zweimal.
 */
export async function retryOnDeadlock<T>(db: Queryable, attempt: () => Promise<T>): Promise<T> {
    try {
        return await attempt();
    } catch (error) {
        if (!isDeadlock(error) || typeof (db as Partial<Sql>).begin !== "function") throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 100)));
        return attempt();
    }
}

export const asJson = (db: Queryable, value: unknown): postgres.Parameter => db.json(value as JsonValue);

/** Ein Job samt den öffentlichen Kennungen seiner Vorgänger. */
function jobColumns(db: Queryable) {
    return db`
        j.*,
        COALESCE(
            (SELECT array_agg(p.public_id::text ORDER BY p.id)
             FROM job_dependency d JOIN job p ON p.id = d.depends_on_id
             WHERE d.job_id = j.id),
            '{}'::text[]
        ) AS depends_on
    `;
}

export async function addEvent(
    tx: Queryable,
    kind: string,
    job: { id: number; mapDomainId: string; publicId: string; kind: string },
    extra: Record<string, unknown>,
): Promise<void> {
    await tx`
        SELECT job_event_add(
            ${kind}, ${job.id}::bigint, ${job.mapDomainId},
            ${asJson(tx, { jobId: job.publicId, jobKind: job.kind, ...extra })}::jsonb
        )
    `;
}

// --- Anlegen ------------------------------------------------------------------------------------------------

export interface NewJob {
    kind: string;
    kindVersion?: number;
    mapDomainId: string;
    origin?: JobOrigin;
    actorRef?: string | null;
    externalRef?: string | null;
    label?: string | null;
    inputRef?: Record<string, unknown>;
    priority?: number;
    notBefore?: Date | null;
    scopeKind?: "domain" | "tiles";
    scopeTiles?: number[];
    /** Nummern der Vorgänger (Abhängigkeiten als Baum). */
    dependsOn?: number[];
    /** Nur `recorded`: wer meldet, und wie lange ohne Meldung gilt die Lease (Sekunden). */
    leaseOwner?: string;
    leaseS?: number;
    phase?: string | null;
    memExpectedMb?: number | null;
    release?: string | null;
}

export interface InsertedJob {
    id: number;
    publicId: string;
    /** `false`: mit derselben `external_ref` gab es schon einen aktiven Job, er ist zurückgegeben. */
    created: boolean;
}

/** Legt einen Job an (Funktion `job_insert`, Migration 0070): Zeile, Abhängigkeiten und Ereignis in einer Transaktion. */
export async function insertJob(db: Queryable, job: NewJob): Promise<InsertedJob> {
    const rows = await db<{ id: string; public_id: string; created: boolean }[]>`
        SELECT * FROM job_insert(
            ${job.kind},
            ${job.kindVersion ?? 1}::smallint,
            ${job.mapDomainId},
            ${job.origin ?? "queued"},
            ${job.actorRef ?? null},
            ${job.externalRef ?? null},
            ${job.label ?? null},
            ${asJson(db, job.inputRef ?? {})}::jsonb,
            ${job.priority ?? 50}::smallint,
            ${job.notBefore ?? null}::timestamptz,
            ${job.scopeKind ?? "domain"},
            ${db.array(job.scopeTiles ?? [], 1005)}::smallint[],
            ${db.array(job.dependsOn ?? [], 1016)}::bigint[],
            ${job.leaseOwner ?? null},
            ${job.leaseS ?? null}::double precision,
            ${job.phase ?? null},
            ${job.memExpectedMb ?? null}::integer,
            ${job.release ?? null}
        )
    `;
    const row = rows[0];
    if (!row) throw new Error("job_insert lieferte keine Zeile");
    return { id: Number(row.id), publicId: row.public_id, created: row.created };
}

// --- Lesen --------------------------------------------------------------------------------------------------

export async function getJobByPublicId(db: Queryable, publicId: string): Promise<JobRow | null> {
    const rows = await db<RawJobRow[]>`SELECT ${jobColumns(db)} FROM job j WHERE j.public_id = ${publicId}::uuid`;
    return rows[0] ? rowToJob(rows[0]) : null;
}

export async function getJobById(db: Queryable, id: number): Promise<JobRow | null> {
    const rows = await db<RawJobRow[]>`SELECT ${jobColumns(db)} FROM job j WHERE j.id = ${id}`;
    return rows[0] ? rowToJob(rows[0]) : null;
}

/** Alle wartenden Jobs in der Reihenfolge der Zulassung. */
export async function listQueued(db: Queryable): Promise<JobRow[]> {
    const rows = await db<RawJobRow[]>`
        SELECT ${jobColumns(db)} FROM job j WHERE j.state = 'QUEUED' ORDER BY j.priority, j.queued_at, j.id
    `;
    return rows.map(rowToJob);
}

/** Alles, was läuft (auch die hängenden): ihr Speicher zählt, bis die Wiederaufnahme sie einsammelt. */
export async function listRunning(db: Queryable): Promise<JobRow[]> {
    const rows = await db<RawJobRow[]>`
        SELECT ${jobColumns(db)} FROM job j WHERE j.state = 'RUNNING' ORDER BY j.started_at, j.id
    `;
    return rows.map(rowToJob);
}

export async function listFinished(
    db: Queryable,
    states: readonly JobState[],
    limit: number,
    /** Nur Jobs dieses Auslösers (WI-0120 A11: die eigene Sicht eines Editors). */
    actorRef?: string,
): Promise<JobRow[]> {
    const rows = await db<RawJobRow[]>`
        SELECT ${jobColumns(db)} FROM job j
        WHERE j.state = ANY(${db.array([...states], 1009)}::text[])
          ${actorRef === undefined ? db`` : db`AND j.actor_ref = ${actorRef}`}
        ORDER BY j.finished_at DESC, j.id DESC
        LIMIT ${limit}
    `;
    return rows.map(rowToJob);
}

/** Die letzten Jobs einer Art, gleich in welchem Zustand (neueste zuerst): für „letzte Imports“ auf der Statusseite. */
export async function listRecentByKind(db: Queryable, kind: string, limit: number): Promise<JobRow[]> {
    const rows = await db<RawJobRow[]>`
        SELECT ${jobColumns(db)} FROM job j WHERE j.kind = ${kind}
        ORDER BY COALESCE(j.finished_at, j.started_at, j.queued_at) DESC, j.id DESC LIMIT ${limit}
    `;
    return rows.map(rowToJob);
}

/**
 * Lief eine Art in den letzten `withinMs` Millisekunden, gleich mit welchem Ausgang? Die Uhr ist die der Datenbank. Für die
 * täglichen Aufbewahrungen der Pflege (WI-0163): Der Ausführer lebt nur für einen Aufruf und weiß vom letzten Lauf nur, was die
 * Tafel sagt. Das Aufräumen behält je Art die letzten Läufe (`keepRuns`), der jüngste geht also nie verloren.
 */
export async function ranWithin(db: Queryable, kind: string, withinMs: number): Promise<boolean> {
    const [row] = await db<{ ran: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM job
            WHERE kind = ${kind} AND COALESCE(started_at, queued_at) > now() - make_interval(secs => ${withinMs / 1000})
        ) AS ran
    `;
    return row?.ran === true;
}

/**
 * Scheiterte eine Art in den letzten `withinMs` Millisekunden mit genau diesem Fehlercode? Für die Pflege des Mailabrufs (WI-0268 C6b): Nach „Anmeldung abgelehnt“ fragt sie nicht im Takt von fünf Minuten wieder an,
 * denn Wiederholen sperrte höchstens das Konto. Die Uhr ist die der Datenbank.
 */
export async function failedWithin(db: Queryable, kind: string, errorCode: string, withinMs: number): Promise<boolean> {
    const [row] = await db<{ failed: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM job
            WHERE kind = ${kind} AND state = 'FAILED' AND error_code = ${errorCode}
              AND COALESCE(finished_at, started_at, queued_at) > now() - make_interval(secs => ${withinMs / 1000})
        ) AS failed
    `;
    return row?.failed === true;
}

/** Läuft gerade die Marke `rollout` (Lease noch gültig)? Eine abgelaufene Marke heilt sich selbst. */
export async function isRolloutActive(db: Queryable): Promise<boolean> {
    const [row] = await db<{ active: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM job WHERE kind = 'rollout' AND state = 'RUNNING' AND lease_expires_at > now()
        ) AS active
    `;
    return row?.active === true;
}

/** Wie lang die letzten erfolgreichen Läufe je Jobart waren (Walltime in ms, neueste zuerst). */
export async function loadWallMsHistory(db: Queryable, limitPerKind = 50): Promise<Record<string, number[]>> {
    const rows = await db<{ kind: string; wall: (string | number)[] }[]>`
        SELECT kind, array_agg(wall_ms ORDER BY finished_at DESC) AS wall
        FROM (
            SELECT kind, wall_ms, finished_at,
                   row_number() OVER (PARTITION BY kind ORDER BY finished_at DESC, id DESC) AS rn
            FROM (
                SELECT CASE WHEN kind = ${TERRITORY_DERIVE_JOB_KIND} AND result->>'modus' = 'teil' THEN ${GEBIETS_TEILLAUF_DAUER} ELSE kind END AS kind,
                       wall_ms, finished_at, id
                FROM job
                WHERE state = 'SUCCEEDED' AND wall_ms IS NOT NULL AND origin IN ('queued', 'recorded')
            ) gelaufen
        ) recent
        WHERE rn <= ${limitPerKind}
        GROUP BY kind
    `;
    return Object.fromEntries(rows.map((row) => [row.kind, row.wall.map(Number)]));
}

/** Der p95 der Spitze RSS der letzten Läufe je Jobart (MB), für die Erwartung der Zulassung („nur nach oben“). */
export async function loadRssP95History(
    db: Queryable,
    kinds: readonly string[],
    minRuns: number,
): Promise<Record<string, number>> {
    if (kinds.length === 0) return {};
    const rows = await db<{ kind: string; p95: number | null; n: string }[]>`
        SELECT kind, percentile_cont(0.95) WITHIN GROUP (ORDER BY rss_peak_mb)::double precision AS p95, count(*)::text AS n
        FROM (
            SELECT kind, rss_peak_mb,
                   row_number() OVER (PARTITION BY kind ORDER BY finished_at DESC, id DESC) AS rn
            FROM job
            WHERE state = 'SUCCEEDED' AND rss_peak_mb IS NOT NULL AND kind = ANY(${db.array([...kinds], 1009)}::text[])
        ) recent
        WHERE rn <= 50
        GROUP BY kind
    `;
    return Object.fromEntries(
        rows.filter((row) => row.p95 !== null && Number(row.n) >= minRuns).map((row) => [row.kind, row.p95 as number]),
    );
}

/** Die Vorgänger, auf die ein wartender Job noch wartet (nicht `SUCCEEDED`), je Job. Ohne Eintrag: nichts, worauf er wartet. */
export async function loadPendingDependencies(
    db: Queryable,
    jobIds: readonly number[],
): Promise<Map<number, number[]>> {
    const pending = new Map<number, number[]>();
    if (jobIds.length === 0) return pending;
    const rows = await db<{ job_id: string; depends_on_id: string }[]>`
        SELECT d.job_id::text, d.depends_on_id::text
        FROM job_dependency d JOIN job p ON p.id = d.depends_on_id
        WHERE d.job_id = ANY(${db.array([...jobIds], 1016)}::bigint[]) AND p.state <> 'SUCCEEDED'
    `;
    for (const row of rows) {
        const list = pending.get(Number(row.job_id)) ?? [];
        list.push(Number(row.depends_on_id));
        pending.set(Number(row.job_id), list);
    }
    return pending;
}

export async function latestSeq(db: Queryable): Promise<number> {
    const [row] = await db<{ seq: string | null }[]>`SELECT max(seq)::text AS seq FROM job_event`;
    return row?.seq == null ? 0 : Number(row.seq);
}

export async function oldestSeq(db: Queryable): Promise<number> {
    const [row] = await db<{ seq: string | null }[]>`SELECT min(seq)::text AS seq FROM job_event`;
    return row?.seq == null ? 0 : Number(row.seq);
}

interface RawEvent {
    seq: string;
    at: Date;
    kind: string;
    job_id: string | null;
    map_domain_id: string | null;
    payload: Record<string, unknown>;
}

export async function readEvents(db: Queryable, since: number, limit: number): Promise<JobEventRecord[]> {
    const rows = await db<RawEvent[]>`
        SELECT seq::text, at, kind, job_id::text, map_domain_id, payload
        FROM job_event WHERE seq > ${since} ORDER BY seq LIMIT ${limit}
    `;
    return rows.map((row) => ({
        seq: Number(row.seq),
        at: row.at.toISOString(),
        kind: row.kind,
        jobId: typeof row.payload["jobId"] === "string" ? row.payload["jobId"] : null,
        mapDomainId: row.map_domain_id,
        payload: row.payload,
    }));
}

// --- Claim und Lauf -----------------------------------------------------------------------------------------

/**
 * Der Ausführer übernimmt einen wartenden Job: neue Lease, Zähler hoch. `null`, wenn der Job inzwischen nicht mehr `QUEUED` ist
 * (ein anderer Ausführer, ein Abbruch): dann ist nichts geschrieben.
 */
export async function claimJob(
    db: Queryable,
    id: number,
    owner: string,
    leaseS: number,
    memExpectedMb: number | null = null,
): Promise<JobRow | null> {
    return inTransaction(db, async (tx) => {
        const claimed = await tx<{ id: string }[]>`
            UPDATE job SET
                state = 'RUNNING', wait_reason = NULL, lease_owner = ${owner}, lease_no = lease_no + 1,
                lease_expires_at = now() + make_interval(secs => ${leaseS}), heartbeat_at = now(),
                started_at = now(), attempt = attempt + 1, phase = NULL, progress = NULL,
                finished_at = NULL, mem_expected_mb = COALESCE(${memExpectedMb}::integer, mem_expected_mb)
            WHERE id = ${id} AND state = 'QUEUED' AND origin = 'queued'
            RETURNING id::text
        `;
        if (claimed.length === 0) return null;
        const rows = await tx<RawJobRow[]>`SELECT ${jobColumns(tx)} FROM job j WHERE j.id = ${id}`;
        const job = rows[0] ? rowToJob(rows[0]) : null;
        if (!job) return null;
        await addEvent(tx, "job.started", job, { state: "RUNNING", attempt: job.attempt, leaseNo: job.leaseNo });
        return job;
    });
}

export interface HeartbeatUsage {
    rssMb?: number | null;
    arrayBufferMb?: number | null;
    cpuMs?: number | null;
    swapUsedMb?: number | null;
}

export type HeartbeatResult = { ok: true; cancelRequested: boolean } | { ok: false };

/**
 * Das Lebenszeichen des Aufsehers: Lease verlängern, Spitzen eintragen. Kein Ereignis (Heartbeats wachsen nie in die
 * Ereignistabelle, Kap. 7.38). `ok: false` heißt: die Lease gehört einem anderen (Fencing): der Läufer hört auf.
 */
export async function heartbeatJob(
    db: Queryable,
    id: number,
    leaseNo: number,
    leaseS: number,
    usage: HeartbeatUsage = {},
): Promise<HeartbeatResult> {
    const rows = await db<{ cancel_requested: boolean }[]>`
        UPDATE job SET
            heartbeat_at = now(),
            lease_expires_at = now() + make_interval(secs => ${leaseS}),
            rss_peak_mb = GREATEST(rss_peak_mb, ${usage.rssMb ?? null}::integer),
            arraybuffer_peak_mb = GREATEST(arraybuffer_peak_mb, ${usage.arrayBufferMb ?? null}::integer),
            swap_seen_mb = GREATEST(swap_seen_mb, ${usage.swapUsedMb ?? null}::integer),
            cpu_ms = COALESCE(${usage.cpuMs ?? null}::bigint, cpu_ms)
        WHERE id = ${id} AND lease_no = ${leaseNo} AND state = 'RUNNING'
        RETURNING cancel_requested_at IS NOT NULL AS cancel_requested
    `;
    const row = rows[0];
    return row ? { ok: true, cancelRequested: row.cancel_requested } : { ok: false };
}

export interface PhaseUpdate {
    phase: string;
    progress?: number | null;
    /** Messung der Phase, die gerade endete (Name, Walltime, Spitze). */
    finished?: { name: string; wallMs: number; rssPeakMb?: number | null; cpuMs?: number | null } | null;
    /**
     * Die Restzeit, die der Auftrag selbst kennt, in Millisekunden (WI-0248, der Release-Test): wird `eta_at`; `null` löscht sie. Fehlt der Wert,
     * bleibt die Spalte unberührt: Nur Arten, die eine Restzeit melden, schreiben sie (die Spalte kommt erst mit Migration 0228).
     */
    restMs?: number | null;
}

/** Eine neue Phase (und der Fortschritt). Ein Ereignis nur beim Wechsel der Phase. `false`: Lease verloren (fenced). */
export async function setJobPhase(db: Queryable, id: number, leaseNo: number, update: PhaseUpdate): Promise<boolean> {
    return inTransaction(db, async (tx) => {
        const rows = await tx<{ phase: string | null; public_id: string; kind: string; map_domain_id: string }[]>`
            SELECT phase, public_id, kind, map_domain_id FROM job
            WHERE id = ${id} AND lease_no = ${leaseNo} AND state = 'RUNNING' FOR UPDATE
        `;
        const row = rows[0];
        if (!row) return false;
        const finished = update.finished
            ? {
                  [update.finished.name]: {
                      wallMs: update.finished.wallMs,
                      rssPeakMb: update.finished.rssPeakMb ?? null,
                      cpuMs: update.finished.cpuMs ?? null,
                  },
              }
            : {};
        const rest = update.restMs;
        await tx`
            UPDATE job SET
                phase = ${update.phase}, progress = ${update.progress ?? null}::real,
                phase_stats = phase_stats || ${asJson(tx, finished)}::jsonb
                ${rest === undefined ? tx`` : tx`, eta_at = now() + make_interval(secs => ${rest === null ? null : Math.max(0, rest) / 1000}::double precision)`}
            WHERE id = ${id}
        `;
        if (row.phase !== update.phase) {
            await addEvent(
                tx,
                "job.phase",
                { id, mapDomainId: row.map_domain_id, publicId: row.public_id, kind: row.kind },
                {
                    state: "RUNNING",
                    phase: update.phase,
                },
            );
        }
        return true;
    });
}

/** Nur den Fortschritt (und die Messung) fortschreiben, ohne Ereignis. */
export async function setJobProgress(
    db: Queryable,
    id: number,
    leaseNo: number,
    progress: number | null,
): Promise<boolean> {
    const rows = await db`
        UPDATE job SET progress = ${progress}::real
        WHERE id = ${id} AND lease_no = ${leaseNo} AND state = 'RUNNING' RETURNING id
    `;
    return rows.length > 0;
}

/** Einen Befund an eine Zeile hängen (je Code höchstens einmal). Befunde melden, sie halten nie an. */
export async function addJobFinding(
    db: Queryable,
    id: number,
    finding: JobFinding,
    leaseNo?: number,
): Promise<boolean> {
    return inTransaction(db, async (tx) => {
        const rows = await tx<{ public_id: string; kind: string; map_domain_id: string }[]>`
            UPDATE job SET findings = findings || ${asJson(tx, [finding])}::jsonb
            WHERE id = ${id}
              AND NOT (findings @> ${asJson(tx, [{ code: finding.code }])}::jsonb)
              AND (${leaseNo ?? null}::integer IS NULL OR lease_no = ${leaseNo ?? null}::integer)
            RETURNING public_id, kind, map_domain_id
        `;
        const row = rows[0];
        if (!row) return false;
        await addEvent(
            tx,
            "job.finding",
            { id, mapDomainId: row.map_domain_id, publicId: row.public_id, kind: row.kind },
            {
                code: finding.code,
                detail: finding.detail,
            },
        );
        return true;
    });
}

// --- Ende ---------------------------------------------------------------------------------------------------

export interface Completion {
    result?: Record<string, unknown> | null;
    wallMs?: number | null;
    cpuMs?: number | null;
    rssPeakMb?: number | null;
    arrayBufferPeakMb?: number | null;
}

/**
 * Ein Job ist fertig. 🔴 Mit `publish` läuft die Veröffentlichung (Zeigerwechsel, neue Revision) in DERSELBEN Transaktion: Die
 * Jobzeile ist mit `FOR UPDATE` gesperrt und ihre `lease_no` geprüft, bevor `publish` etwas schreibt. Weicht sie ab, rollt
 * nichts zurück, weil nichts geschrieben ist: die Antwort ist `fenced`, der Läufer räumt auf und endet. Wirft `publish`, rollt
 * die ganze Transaktion zurück, und der Fehler geht an den Aufrufer.
 */
export async function completeJob(
    db: Queryable,
    id: number,
    leaseNo: number,
    completion: Completion = {},
    publish?: (tx: Queryable) => Promise<void>,
): Promise<"ok" | "fenced"> {
    return inTransaction(db, async (tx) => {
        const rows = await tx<
            { state: JobState; lease_no: number; public_id: string; kind: string; map_domain_id: string }[]
        >`
            SELECT state, lease_no, public_id, kind, map_domain_id FROM job WHERE id = ${id} FOR UPDATE
        `;
        const row = rows[0];
        if (!row || row.state !== "RUNNING" || row.lease_no !== leaseNo) return "fenced";
        if (publish) await publish(tx);
        await tx`
            UPDATE job SET
                state = 'SUCCEEDED', finished_at = now(), wait_reason = NULL, progress = 1,
                result = ${completion.result ? asJson(tx, completion.result) : null}::jsonb,
                wall_ms = COALESCE(${completion.wallMs ?? null}::bigint, (extract(epoch FROM now() - started_at) * 1000)::bigint),
                cpu_ms = COALESCE(${completion.cpuMs ?? null}::bigint, cpu_ms),
                rss_peak_mb = GREATEST(rss_peak_mb, ${completion.rssPeakMb ?? null}::integer),
                arraybuffer_peak_mb = GREATEST(arraybuffer_peak_mb, ${completion.arrayBufferPeakMb ?? null}::integer),
                error_code = NULL, error_summary = NULL
            WHERE id = ${id}
        `;
        await addEvent(
            tx,
            "job.succeeded",
            { id, mapDomainId: row.map_domain_id, publicId: row.public_id, kind: row.kind },
            {
                state: "SUCCEEDED",
                unchanged: completion.result?.["unchanged"] === true,
            },
        );
        return "ok";
    });
}

/**
 * Die Messung eines Laufs nachtragen, der sich in der Transaktion seiner Veröffentlichung selbst abgeschlossen hat (WI-0125,
 * `dem_publish`): kein Zustandswechsel, kein Ereignis. Gilt nur für den Lauf mit dieser Lease, der `SUCCEEDED` ist.
 */
export async function recordCompletionStats(
    db: Queryable,
    id: number,
    leaseNo: number,
    completion: Completion,
): Promise<"ok" | "fenced"> {
    const rows = await db`
        UPDATE job SET
            wall_ms = COALESCE(${completion.wallMs ?? null}::bigint, wall_ms),
            cpu_ms = COALESCE(${completion.cpuMs ?? null}::bigint, cpu_ms),
            rss_peak_mb = GREATEST(rss_peak_mb, ${completion.rssPeakMb ?? null}::integer),
            arraybuffer_peak_mb = GREATEST(arraybuffer_peak_mb, ${completion.arrayBufferPeakMb ?? null}::integer)
        WHERE id = ${id} AND lease_no = ${leaseNo} AND state = 'SUCCEEDED'
        RETURNING id
    `;
    return rows.length > 0 ? "ok" : "fenced";
}

/** Hat sich dieser Lauf (diese Lease) selbst abgeschlossen (`SUCCEEDED` in der Transaktion seiner Veröffentlichung, WI-0125)? */
export async function isCommittedBy(db: Queryable, id: number, leaseNo: number): Promise<boolean> {
    const rows = await db`SELECT 1 FROM job WHERE id = ${id} AND lease_no = ${leaseNo} AND state = 'SUCCEEDED'`;
    return rows.length > 0;
}

export interface Failure {
    code: string;
    /** Klartext, kein Stacktrace, kein Pfad, kein Geheimnis (4.2). */
    summary: string;
    /** Kann ein zweiter Lauf es ändern (toter Prozess, Verbindungsverlust, Sperrzeit)? Sonst endet der Job sofort. */
    retryable: boolean;
    wallMs?: number | null;
    rssPeakMb?: number | null;
}

export type FailureOutcome = "failed" | "requeued" | "cancelled" | "fenced";

/** Beendet die abhängigen, noch wartenden Jobs: scheitert oder entfällt ein Vorgänger, startet der Nachfolger nicht. */
export async function cancelDependents(
    tx: Queryable,
    root: { id: number; state: "FAILED" | "CANCELLED" },
): Promise<number> {
    let cancelled = 0;
    const queue: { id: number; state: "FAILED" | "CANCELLED" }[] = [root];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) break;
        const reason = current.state === "FAILED" ? "dependency_failed" : "dependency_cancelled";
        const rows = await tx<{ id: string; public_id: string; kind: string; map_domain_id: string }[]>`
            UPDATE job SET
                state = 'CANCELLED', cancel_reason = ${reason}, cancel_ref_job_id = ${current.id},
                finished_at = now(), wait_reason = NULL
            WHERE id IN (SELECT job_id FROM job_dependency WHERE depends_on_id = ${current.id})
              AND state = 'QUEUED'
            RETURNING id::text, public_id, kind, map_domain_id
        `;
        for (const row of rows) {
            cancelled += 1;
            queue.push({ id: Number(row.id), state: "CANCELLED" });
            await addEvent(
                tx,
                "job.cancelled",
                { id: Number(row.id), mapDomainId: row.map_domain_id, publicId: row.public_id, kind: row.kind },
                {
                    state: "CANCELLED",
                    reason,
                },
            );
        }
    }
    return cancelled;
}

export interface LockedRun {
    id: number;
    state: JobState;
    origin: JobOrigin;
    lease_no: number;
    attempt: number;
    cancel_requested_at: Date | null;
    cancel_reason: string | null;
    phase: string | null;
    public_id: string;
    kind: string;
    map_domain_id: string;
}

/**
 * Ein Lauf endet ohne Erfolg. Wiederholung nur, wenn die Ursache wiederholbar ist UND der Job höchstens `maxRetries` Mal
 * wiederholt wurde (also höchstens drei Läufe); sonst `FAILED` und die Nachfolger entfallen. Wurde ein Abbruch angefordert,
 * endet der Job als `CANCELLED`, nicht als Fehler.
 */
async function endRun(
    tx: Queryable,
    run: LockedRun,
    failure: Failure,
    maxRetries: number,
): Promise<Exclude<FailureOutcome, "fenced">> {
    const target = { id: Number(run.id), mapDomainId: run.map_domain_id, publicId: run.public_id, kind: run.kind };
    if (run.cancel_requested_at !== null) {
        await tx`
            UPDATE job SET state = 'CANCELLED', finished_at = now(), wait_reason = NULL,
                cancel_reason = COALESCE(cancel_reason, 'operator')
            WHERE id = ${run.id}
        `;
        await addEvent(tx, "job.cancelled", target, { state: "CANCELLED", reason: run.cancel_reason ?? "operator" });
        await cancelDependents(tx, { id: Number(run.id), state: "CANCELLED" });
        return "cancelled";
    }
    // `attempt` zählt die gestarteten Läufe: Lauf 1 hat 0 Wiederholungen verbraucht, Lauf 2 eine, Lauf 3 zwei.
    if (failure.retryable && run.origin === "queued" && run.attempt <= maxRetries) {
        await tx`
            UPDATE job SET
                state = 'QUEUED', lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
                phase = NULL, progress = NULL, wait_reason = NULL,
                error_code = ${failure.code}, error_summary = ${failure.summary}
            WHERE id = ${run.id}
        `;
        await addEvent(tx, "job.requeued", target, {
            state: "QUEUED",
            reason: failure.code,
            attempt: run.attempt,
            nextAttempt: run.attempt + 1,
        });
        return "requeued";
    }
    await tx`
        UPDATE job SET
            state = 'FAILED', finished_at = now(), wait_reason = NULL,
            error_code = ${failure.code}, error_summary = ${failure.summary},
            wall_ms = COALESCE(${failure.wallMs ?? null}::bigint, (extract(epoch FROM now() - started_at) * 1000)::bigint),
            rss_peak_mb = GREATEST(rss_peak_mb, ${failure.rssPeakMb ?? null}::integer)
        WHERE id = ${run.id}
    `;
    await addEvent(tx, "job.failed", target, { state: "FAILED", code: failure.code, attempt: run.attempt });
    await cancelDependents(tx, { id: Number(run.id), state: "FAILED" });
    return "failed";
}

async function lockRun(tx: Queryable, id: number): Promise<LockedRun | null> {
    const rows = await tx<(Omit<LockedRun, "id"> & { id: string })[]>`
        SELECT id::text, state, origin, lease_no, attempt, cancel_requested_at, cancel_reason, phase, public_id, kind, map_domain_id
        FROM job WHERE id = ${id} FOR UPDATE
    `;
    const row = rows[0];
    return row ? { ...row, id: Number(row.id) } : null;
}

/** Der Läufer meldet einen Fehler (fenced: seine Lease ist nicht mehr die der Zeile, es wird nichts geschrieben). */
export async function failJob(
    db: Queryable,
    id: number,
    leaseNo: number,
    failure: Failure,
    maxRetries: number = JOB_MAX_RETRIES,
): Promise<FailureOutcome> {
    return inTransaction(db, async (tx) => {
        const run = await lockRun(tx, id);
        if (!run || run.state !== "RUNNING" || run.lease_no !== leaseNo) return "fenced";
        return endRun(tx, run, failure, maxRetries);
    });
}

export interface RecoveryAction {
    id: number;
    publicId: string;
    kind: string;
    leaseOwner: string | null;
    outcome: Exclude<FailureOutcome, "fenced">;
    origin: JobOrigin;
}

/**
 * Die Pflege (`auftrag-cli --pflege`) sammelt `RUNNING` mit abgelaufener Lease ein (JOBS-0001 4.6): wiederholbar bis zu zwei
 * Mal, dann `FAILED` mit `lease_expired_exhausted`. Ein aufgezeichneter Job hat keinen Aufseher, der ihn neu starten könnte:
 * verlorene Meldung heißt `FAILED` mit `recorder_lost`. Bis dahin zeigt die Statusseite „hängt“.
 */
export async function recoverExpired(db: Queryable, maxRetries: number = JOB_MAX_RETRIES): Promise<RecoveryAction[]> {
    return inTransaction(db, async (tx) => {
        const expired = await tx<{ id: string; lease_owner: string | null }[]>`
            SELECT id::text, lease_owner FROM job
            WHERE state = 'RUNNING' AND lease_expires_at < now()
            ORDER BY id FOR UPDATE SKIP LOCKED
        `;
        const actions: RecoveryAction[] = [];
        for (const candidate of expired) {
            const run = await lockRun(tx, Number(candidate.id));
            if (!run || run.state !== "RUNNING") continue;
            let failure: Failure;
            if (run.origin === "recorded") {
                failure = {
                    code: "recorder_lost",
                    summary: "Die Meldung des Ablaufs blieb aus: Lease abgelaufen.",
                    retryable: false,
                };
            } else if (run.attempt > maxRetries) {
                failure = {
                    code: "lease_expired_exhausted",
                    summary: "Lease abgelaufen, alle Wiederholungen aufgebraucht.",
                    retryable: false,
                };
            } else {
                failure = {
                    code: "lease_expired",
                    summary: "Lease abgelaufen, der Job wird erneut eingereiht.",
                    retryable: true,
                };
            }
            const outcome = await endRun(tx, run, failure, maxRetries);
            if (run.origin === "recorded") {
                await tx`
                    UPDATE job SET findings = findings || ${asJson(tx, [{ code: "recorder_lost", detail: "Lease abgelaufen" }])}::jsonb
                    WHERE id = ${run.id} AND NOT (findings @> '[{"code": "recorder_lost"}]'::jsonb)
                `;
            }
            actions.push({
                id: run.id,
                publicId: run.public_id,
                kind: run.kind,
                leaseOwner: candidate.lease_owner,
                outcome,
                origin: run.origin,
            });
        }
        return actions;
    });
}

/**
 * Ein abgelöster Ausführer (oder ein Editor-Job unter Sperre) gibt einen Job zurück: wieder `QUEUED`, OHNE den Versuch zu zählen
 * (Ereignis `handed_off`). Der Dirigent startet ihn neu.
 */
export async function handOffJob(db: Queryable, id: number, leaseNo: number): Promise<boolean> {
    return inTransaction(db, async (tx) => {
        const run = await lockRun(tx, id);
        if (!run || run.state !== "RUNNING" || run.lease_no !== leaseNo) return false;
        const target = { id: run.id, mapDomainId: run.map_domain_id, publicId: run.public_id, kind: run.kind };
        if (run.cancel_requested_at !== null) {
            await tx`
                UPDATE job SET state = 'CANCELLED', finished_at = now(), wait_reason = NULL,
                    cancel_reason = COALESCE(cancel_reason, 'operator')
                WHERE id = ${run.id}
            `;
            await cancelDependents(tx, { id: run.id, state: "CANCELLED" });
            await addEvent(tx, "job.cancelled", target, {
                state: "CANCELLED",
                reason: run.cancel_reason ?? "operator",
            });
            return true;
        }
        await tx`
            UPDATE job SET
                state = 'QUEUED', lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
                phase = NULL, progress = NULL, wait_reason = NULL, attempt = GREATEST(attempt - 1, 0)
            WHERE id = ${run.id}
        `;
        await addEvent(tx, "job.handed_off", target, { state: "QUEUED", reason: "handed_off" });
        return true;
    });
}

export type CancelOutcome = "cancelled" | "cancel_requested" | "noop";

/**
 * Abbrechen. Ein wartender Job wird sofort `CANCELLED` (samt seinen Nachfolgern). Ein laufender bekommt `cancel_requested_at`:
 * der Job-Prozess prüft ZWISCHEN den Phasen und endet; die Veröffentlichung selbst ist eine Transaktion und wird nie
 * unterbrochen. Aufgezeichnete Jobs lassen sich nicht abbrechen: kein Aufseher kann sie anhalten.
 */
export async function cancelJob(
    db: Queryable,
    ref: { id: number } | { publicId: string },
    reason: CancelReason = "operator",
): Promise<CancelOutcome> {
    return inTransaction(db, async (tx) => {
        const rows =
            "id" in ref
                ? await tx<{ id: string }[]>`SELECT id::text FROM job WHERE id = ${ref.id}`
                : await tx<{ id: string }[]>`SELECT id::text FROM job WHERE public_id = ${ref.publicId}::uuid`;
        const found = rows[0];
        if (!found) return "noop";
        const run = await lockRun(tx, Number(found.id));
        if (!run) return "noop";
        const target = { id: run.id, mapDomainId: run.map_domain_id, publicId: run.public_id, kind: run.kind };
        if (run.state === "QUEUED") {
            await tx`
                UPDATE job SET state = 'CANCELLED', cancel_reason = ${reason}, finished_at = now(), wait_reason = NULL
                WHERE id = ${run.id}
            `;
            await cancelDependents(tx, { id: run.id, state: "CANCELLED" });
            await addEvent(tx, "job.cancelled", target, { state: "CANCELLED", reason });
            return "cancelled";
        }
        if (run.state === "RUNNING" && run.origin === "queued") {
            if (run.cancel_requested_at !== null) return "noop";
            await tx`UPDATE job SET cancel_requested_at = now(), cancel_reason = ${reason} WHERE id = ${run.id}`;
            await addEvent(tx, "job.cancel_requested", target, { state: "RUNNING", reason });
            return "cancel_requested";
        }
        return "noop";
    });
}

/** Der Job-Prozess hat den Abbruch an einer Phasengrenze bestätigt: `CANCELLED`. */
export async function finishCancelled(db: Queryable, id: number, leaseNo: number): Promise<boolean> {
    return inTransaction(db, async (tx) => {
        const run = await lockRun(tx, id);
        if (!run || run.state !== "RUNNING" || run.lease_no !== leaseNo) return false;
        await tx`
            UPDATE job SET state = 'CANCELLED', finished_at = now(), wait_reason = NULL,
                cancel_reason = COALESCE(cancel_reason, 'operator'),
                wall_ms = (extract(epoch FROM now() - started_at) * 1000)::bigint
            WHERE id = ${run.id}
        `;
        await cancelDependents(tx, { id: run.id, state: "CANCELLED" });
        await addEvent(
            tx,
            "job.cancelled",
            { id: run.id, mapDomainId: run.map_domain_id, publicId: run.public_id, kind: run.kind },
            {
                state: "CANCELLED",
                reason: run.cancel_reason ?? "operator",
            },
        );
        return true;
    });
}

/** Setzt den Grund der Wartezeit, wo er sich geändert hat. Kein Ereignis: die Seite fragt den Stand ohnehin neu. */
export async function setWaitReasons(db: Queryable, reasons: ReadonlyMap<number, string | null>): Promise<void> {
    if (reasons.size === 0) return;
    const ids = [...reasons.keys()];
    const values = ids.map((id) => reasons.get(id) ?? null);
    await db`
        UPDATE job SET wait_reason = r.reason
        FROM (SELECT unnest(${db.array(ids, 1016)}::bigint[]) AS id, unnest(${db.array(values, 1009)}::text[]) AS reason) r
        WHERE job.id = r.id AND job.state = 'QUEUED' AND job.wait_reason IS DISTINCT FROM r.reason
    `;
}

// --- Aufräumen ----------------------------------------------------------------------------------------------

export interface PruneResult {
    jobs: number;
    events: number;
}

/**
 * Aufbewahrung (Kap. 7.38, harte Invariante: kein Telemetrietyp wächst unbegrenzt). Terminale Jobzeilen bleiben mindestens die
 * letzten `keepRuns` je Jobart (sie speisen p50 und p95) UND mindestens `keepDays` Tage; Ereignisse kürzer (`eventKeepDays`).
 * Laufende und wartende Jobs bleiben immer.
 */
export async function pruneJobs(
    db: Queryable,
    retention: { keepDays: number; keepRuns: number; eventKeepDays: number },
): Promise<PruneResult> {
    return inTransaction(db, async (tx) => {
        const events = await tx`
            DELETE FROM job_event WHERE at < now() - make_interval(days => ${retention.eventKeepDays})
        `;
        const jobs = await tx`
            DELETE FROM job WHERE id IN (
                SELECT id FROM (
                    SELECT id, finished_at,
                           row_number() OVER (PARTITION BY kind ORDER BY finished_at DESC, id DESC) AS rn
                    FROM job WHERE state IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
                ) ranked
                WHERE rn > ${retention.keepRuns} AND finished_at < now() - make_interval(days => ${retention.keepDays})
            )
        `;
        return { jobs: jobs.count, events: events.count };
    });
}
