import { parseArgs } from "node:util";
import { AVENTURIA, getJobsConfig, type JobsConfig, type JobSummary } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../database.ts";
import { jobsProfileName } from "./profile.ts";
import { JobRecorder } from "./recorder.ts";
import { buildJobsOverview } from "./overview.ts";
import { cancelJob, getJobByPublicId, insertJob } from "./store.ts";
import { countActive, type RecordRef } from "./store-record.ts";
import { toSummary } from "./rows.ts";
import { enqueueTerrainFull, enqueueTerrainLocal } from "./terrain-chain.ts";
import type { Rect } from "../terrain/domain/footprint.ts";

/**
 * `jobs-cli` (JOBS-0001 Etappe 1): das Werkzeug, mit dem der Korridor und der Entwickler die Queue bedienen.
 *
 *   record start|phase|heartbeat|finish|mark   einen bestehenden Ablauf aufzeichnen (der Zug, ein Rollout). 🔴 BEST EFFORT:
 *                                              ein Fehler beim Aufzeichnen beendet NIE einen Import, der Exit-Code ist 0
 *   status [--json] [--active]                 der Stand; mit `--active`: Exit 10, wenn ein Import oder Rollout läuft
 *                                              (der Zug fragt das statt `pgrep`), 2, wenn es sich nicht feststellen ließ
 *   probe                                      einen Probe-Job einreihen (Messwerkzeug, Tests), mit `--wait` bis zum Ende
 *   cancel <Kennung>                           einen Job abbrechen
 *   enqueue terrain_local|terrain_full         die Gelände-Kette einreihen (JOBS-0001 Etappe 2, WI-0125): Auslöser nur hier,
 *                                              kein Editor; mit `--wait` bis alle Glieder fertig sind
 *
 * Verbindung: `JOBS_DATABASE_URL`, sonst `DATABASE_URL` (die Jobs-Rolle `avesmaps3d_<env>_jobs`, Q5/Q10). Profil: `JOBS_PROFILE`
 * (`local`, `staging`; ohne die Variable gilt `local` nur auf dem Entwicklungsrechner, sonst `unknown`: jede Jobart läuft allein).
 */

export interface CliIo {
    out(line: string): void;
    err(line: string): void;
}

export interface CliDeps {
    /** Für Tests: eine fertige Verbindung statt der aus der Umgebung. */
    database?: Database;
    now?: () => Date;
}

const USAGE = `jobs-cli <Befehl>

  record start --kind <Art> [--label <Text>] [--ref <Kennung>] [--phase <Phase>] [--wait-reason <Text>]
               mit --phase meldet derselbe Aufruf die Phase gleich mit: anlegen oder den aktiven Lauf finden, dann Phase,
               Wartegrund, Beschriftung und Lebenszeichen. Ein Aufruf je Takt, beliebig oft wiederholbar.
  record phase (--job <Kennung> | --ref <Kennung>) [--kind import] --phase <Phase> [--progress 0..1] [--rss-mb N]
               [--wait-reason <Text>] [--label <Text>] [--prev-phase <Name> --prev-wall-ms N [--prev-rss-mb N]]
  record heartbeat (--job <Kennung> | --ref <Kennung>) [--kind import]
  record finish (--job <Kennung> | --ref <Kennung>) [--kind import] --status ok|failed [--error-code <Code>]
               [--error-summary <Text>] [--rss-peak-mb N] [--swap-mb N] [--swap-in-mb N] [--phase <Phase>]
  record mark rollout on|off
  status [--json] [--active [--kinds import,rollout]]
  probe [--ballast-mb N] [--sleep-ms N] [--phases N --phase-ms N] [--crash exit|sigkill|throw] [--priority N]
        [--scope domain|tiles] [--wait [--timeout-s N]] [--json]
  cancel <Kennung>
  enqueue terrain_local [--bounds minX,minY,maxX,maxY]... [--full-after] [--wait [--timeout-s N]] [--json]
  enqueue terrain_full [--wait [--timeout-s N]] [--json]

record: best effort, Exit immer 0 (mit --strict: Exit 1 bei einem Fehler). Alle Befehle: --timeout-s N (Standard 8).
Umgebung: JOBS_DATABASE_URL oder DATABASE_URL, JOBS_PROFILE (local|staging), JOBS_DOMAIN, RELEASE_ID.`;

function describeJob(job: JobSummary, now: Date): string {
    const parts = [job.id.slice(0, 8), job.kind.padEnd(8), job.state.padEnd(9)];
    if (job.stalled) parts.push("HÄNGT");
    if (job.phase) parts.push(`Phase ${job.phase}`);
    if (job.waitReason) parts.push(job.waitReason);
    if (job.state === "RUNNING" && job.startedAt) {
        parts.push(`seit ${String(Math.round((now.getTime() - Date.parse(job.startedAt)) / 1000))} s`);
    }
    if (job.rssPeakMb !== null) parts.push(`Spitze ${String(job.rssPeakMb)} MB`);
    if (job.errorCode) parts.push(`Fehler ${job.errorCode}`);
    if (job.findings.length > 0) parts.push(`Befunde ${job.findings.map((finding) => finding.code).join(",")}`);
    return parts.join("  ");
}

/** Führt `work` mit einer Frist aus: ein hängender Datenbankaufruf darf einen Ablauf nie aufhalten. */
async function withDeadline<T>(seconds: number, fallback: T, work: Promise<T>, onTimeout: () => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((resolve) => {
        timer = setTimeout(() => {
            onTimeout();
            resolve(fallback);
        }, seconds * 1000);
    });
    try {
        return await Promise.race([work, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

export async function runJobsCli(
    argv: readonly string[],
    environment: NodeJS.ProcessEnv,
    io: CliIo,
    deps: CliDeps = {},
): Promise<number> {
    const [command, ...rest] = argv;
    if (command === undefined || command === "--help" || command === "-h" || command === "help") {
        io.out(USAGE);
        return command === undefined ? 2 : 0;
    }
    if (!["record", "status", "probe", "cancel", "enqueue"].includes(command)) {
        io.err(`unbekannter Befehl: ${command}\n${USAGE}`);
        return 2;
    }

    const url = environment["JOBS_DATABASE_URL"] ?? environment["DATABASE_URL"];
    const profile = jobsProfileName(environment);
    const config: JobsConfig = getJobsConfig(profile);
    const mapDomainId = environment["JOBS_DOMAIN"] ?? AVENTURIA.mapDomain;
    const isRecord = command === "record";
    let strict = false;
    let timeoutS = 8;
    /** `status --active`: Exit 2 heißt „nicht feststellbar“, nie „nichts los“. */
    let wantsActive = false;

    // Jede Meldung des Aufzeichnens ist best effort: Exit 0, außer mit --strict.
    const bestEffortExit = (code: number): number => (isRecord && !strict ? 0 : code);

    let database: Database | undefined = deps.database;
    const ownsDatabase = database === undefined;
    try {
        let parsed;
        try {
            parsed = parseArgs({
                args: [...rest],
                allowPositionals: true,
                strict: false,
                options: {
                    kind: { type: "string" },
                    label: { type: "string" },
                    ref: { type: "string" },
                    job: { type: "string" },
                    phase: { type: "string" },
                    progress: { type: "string" },
                    "rss-mb": { type: "string" },
                    "prev-phase": { type: "string" },
                    "prev-wall-ms": { type: "string" },
                    "prev-rss-mb": { type: "string" },
                    "wait-reason": { type: "string" },
                    status: { type: "string" },
                    "error-code": { type: "string" },
                    "error-summary": { type: "string" },
                    "rss-peak-mb": { type: "string" },
                    "swap-mb": { type: "string" },
                    "swap-in-mb": { type: "string" },
                    json: { type: "boolean" },
                    active: { type: "boolean" },
                    kinds: { type: "string" },
                    strict: { type: "boolean" },
                    wait: { type: "boolean" },
                    "timeout-s": { type: "string" },
                    "ballast-mb": { type: "string" },
                    "sleep-ms": { type: "string" },
                    phases: { type: "string" },
                    "phase-ms": { type: "string" },
                    crash: { type: "string" },
                    priority: { type: "string" },
                    scope: { type: "string" },
                    bounds: { type: "string", multiple: true },
                    "full-after": { type: "boolean" },
                },
            });
        } catch (error) {
            io.err(error instanceof Error ? error.message : String(error));
            return bestEffortExit(2);
        }
        const { values, positionals } = parsed;
        strict = values.strict === true;
        wantsActive = command === "status" && values.active === true;
        if (typeof values["timeout-s"] === "string" && Number(values["timeout-s"]) > 0)
            timeoutS = Number(values["timeout-s"]);
        const num = (value: string | boolean | undefined): number | null => {
            if (typeof value !== "string" || value.trim() === "") return null;
            const parsedNumber = Number(value);
            return Number.isFinite(parsedNumber) ? parsedNumber : null;
        };
        /**
         * Ein Freitext aus der Befehlszeile: ohne Steuerzeichen, gekürzt, leer heißt `null`. Der Aufrufer ist ein Skript des
         * Korridors, aber die Grenze wird hier gezogen, nicht dort: Der Text landet in einer Zeile, die Menschen lesen.
         */
        const text = (value: string | boolean | undefined, max: number): string | null => {
            if (typeof value !== "string") return null;
            // eslint-disable-next-line no-control-regex -- Steuerzeichen sind genau das, was hier wegfällt.
            const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
            return clean === "" ? null : clean.slice(0, max);
        };

        if (!url && !database) {
            io.err("jobs-cli: weder JOBS_DATABASE_URL noch DATABASE_URL gesetzt");
            return wantsActive ? 2 : bestEffortExit(1);
        }
        database = database ?? createDatabase(url as string, { max: 2, connectTimeoutS: Math.min(timeoutS, 10) });
        const db = database;
        const now = deps.now ?? (() => new Date());
        const recorder = new JobRecorder({
            database: db,
            config,
            mapDomainId,
            release: environment["RELEASE_ID"] ?? null,
            strict,
            warn: (message) => io.err(`jobs record: ${message}`),
        });

        const refOf = (): RecordRef | null => {
            if (typeof values.job === "string" && values.job.length > 0) return { publicId: values.job };
            if (typeof values.ref === "string" && values.ref.length > 0) return { externalRef: values.ref };
            return null;
        };

        const run = async (): Promise<number> => {
            switch (command) {
                case "record": {
                    const [action, argument] = positionals;
                    const kind = typeof values.kind === "string" ? values.kind : "import";
                    if (action === "start") {
                        if (typeof values.kind !== "string") {
                            io.err("record start: --kind fehlt");
                            return bestEffortExit(2);
                        }
                        const label = text(values.label, 300);
                        const phase = typeof values.phase === "string" ? values.phase : null;
                        const started = await recorder.start(kind, {
                            label,
                            externalRef: typeof values.ref === "string" ? values.ref : null,
                            phase,
                        });
                        if (!started) return bestEffortExit(1);
                        io.out(started.publicId);
                        // Mit `--phase` ist derselbe Aufruf auch die Meldung dieser Phase: Er setzt den groben Fortschritt, den
                        // Wartegrund und die Beschriftung und verlängert die Lease. So braucht ein Takt eines Cron-Skripts
                        // genau EINEN Aufruf, ob der Lauf gerade entsteht oder schon läuft.
                        if (phase === null) return bestEffortExit(0);
                        const reported = await recorder.phase({ publicId: started.publicId }, kind, phase, {
                            waitReason: text(values["wait-reason"], 200),
                            label,
                        });
                        return bestEffortExit(reported === "ok" ? 0 : 1);
                    }
                    if (action === "mark") {
                        if (argument !== "rollout" || !["on", "off"].includes(positionals[2] ?? "")) {
                            io.err("record mark: erwartet `rollout on|off`");
                            return bestEffortExit(2);
                        }
                        const ok = await recorder.mark("rollout", positionals[2] === "on");
                        return bestEffortExit(ok ? 0 : 1);
                    }
                    const ref = refOf();
                    if (!ref) {
                        io.err(`record ${action ?? ""}: --job oder --ref fehlt`);
                        return bestEffortExit(2);
                    }
                    if (action === "phase") {
                        if (typeof values.phase !== "string") {
                            io.err("record phase: --phase fehlt");
                            return bestEffortExit(2);
                        }
                        const previousWall = num(values["prev-wall-ms"]);
                        const result = await recorder.phase(ref, kind, values.phase, {
                            progress: num(values.progress),
                            rssMb: num(values["rss-mb"]),
                            waitReason: text(values["wait-reason"], 200),
                            label: text(values.label, 300),
                            previous:
                                typeof values["prev-phase"] === "string" && previousWall !== null
                                    ? {
                                          name: values["prev-phase"],
                                          wallMs: previousWall,
                                          rssPeakMb: num(values["prev-rss-mb"]),
                                      }
                                    : null,
                        });
                        return bestEffortExit(result === "ok" ? 0 : 1);
                    }
                    if (action === "heartbeat") {
                        const result = await recorder.heartbeat(ref, kind);
                        return bestEffortExit(result === "ok" ? 0 : 1);
                    }
                    if (action === "finish") {
                        const outcome = values.status;
                        if (outcome !== "ok" && outcome !== "failed") {
                            io.err("record finish: --status ok|failed fehlt");
                            return bestEffortExit(2);
                        }
                        const finished = await recorder.finish(
                            ref,
                            kind,
                            {
                                ok: outcome === "ok",
                                errorCode: typeof values["error-code"] === "string" ? values["error-code"] : null,
                                errorSummary:
                                    typeof values["error-summary"] === "string"
                                        ? values["error-summary"].slice(0, 240)
                                        : null,
                                rssPeakMb: num(values["rss-peak-mb"]),
                                swapSeenMb: num(values["swap-mb"]),
                                swapInMb: num(values["swap-in-mb"]),
                            },
                            { phase: typeof values.phase === "string" ? values.phase : null },
                        );
                        return bestEffortExit(finished ? 0 : 1);
                    }
                    io.err(`record: unbekannte Aktion ${action ?? "(keine)"}\n${USAGE}`);
                    return bestEffortExit(2);
                }
                case "status": {
                    if (values.active === true) {
                        const kinds =
                            typeof values.kinds === "string"
                                ? values.kinds.split(",").filter(Boolean)
                                : ["import", "rollout"];
                        const active = await countActive(db, kinds);
                        io.out(`active=${String(active)}`);
                        return active > 0 ? 10 : 0;
                    }
                    const overview = await buildJobsOverview({
                        database: db,
                        config,
                        releaseId: environment["RELEASE_ID"] ?? "dev",
                        mapDomainId,
                        now,
                    });
                    if (values.json === true) {
                        io.out(JSON.stringify(overview));
                        return 0;
                    }
                    const stamp = now();
                    io.out(
                        `Warteschlange (Profil ${overview.profile}, Planer ${overview.plannerActive ? "aktiv" : "keiner"}, Ereignis ${String(overview.seq)})`,
                    );
                    io.out(
                        `läuft: ${String(overview.running.length)}, wartet: ${String(overview.queued.length)}, hängt: ${String(overview.stalled.length)}`,
                    );
                    for (const job of overview.running) io.out(`  läuft    ${describeJob(job, stamp)}`);
                    for (const job of overview.queued)
                        io.out(
                            `  ${String(job.position).padStart(2)}. wartet ${describeJob(job, stamp)}  Start ${job.estimate.startAt ?? "unbekannt"}`,
                        );
                    for (const job of overview.failed.slice(0, 5)) io.out(`  gescheitert ${describeJob(job, stamp)}`);
                    for (const job of overview.recent.slice(0, 5)) io.out(`  zuletzt  ${describeJob(job, stamp)}`);
                    // Die Kommandozeile baut immer die volle Sicht; Speicher fehlt nur in der eigenen Sicht eines Editors.
                    const memory = overview.memory;
                    if (memory !== null)
                        io.out(
                            `Speicher: gebucht ${String(memory.bookedMb)} MB, Budget ${memory.budgetMb === null ? "unbekannt" : `${String(memory.budgetMb)} MB`}, frei ${memory.availableMb === null ? "unbekannt" : `${String(memory.availableMb)} MB`}${memory.rolloutActive ? ", Marke rollout aktiv" : ""}`,
                        );
                    return 0;
                }
                case "probe": {
                    const phases = num(values.phases);
                    const phaseMs = num(values["phase-ms"]) ?? 200;
                    const input: Record<string, unknown> = {};
                    const ballast = num(values["ballast-mb"]);
                    if (ballast !== null) input["ballastMb"] = ballast;
                    const sleepMs = num(values["sleep-ms"]);
                    if (sleepMs !== null) input["sleepMs"] = sleepMs;
                    if (phases !== null && phases > 0) {
                        input["phases"] = Array.from({ length: Math.min(phases, 64) }, (_, index) => ({
                            name: `phase-${String(index + 1)}`,
                            ms: phaseMs,
                        }));
                    }
                    if (typeof values.crash === "string") input["crash"] = values.crash;
                    const inserted = await insertJob(db, {
                        kind: "probe",
                        mapDomainId,
                        origin: "queued",
                        actorRef: "jobs-cli",
                        label: ballast === null ? "Probe" : `Probe, ${String(ballast)} MB Ballast`,
                        inputRef: input,
                        priority: num(values.priority) ?? 50,
                        // Eine Probe beansprucht keinen Bereich, außer sie soll es: so laufen zwei nebeneinander.
                        scopeKind: values.scope === "domain" ? "domain" : "tiles",
                        scopeTiles: [],
                        release: environment["RELEASE_ID"] ?? null,
                    });
                    if (values.wait !== true) {
                        io.out(values.json === true ? JSON.stringify({ id: inserted.publicId }) : inserted.publicId);
                        return 0;
                    }
                    const waitUntil = Date.now() + (num(values["timeout-s"]) ?? 600) * 1000;
                    for (;;) {
                        const job = await getJobByPublicId(db, inserted.publicId);
                        if (job && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state)) {
                            const summary = toSummary(job, now());
                            io.out(values.json === true ? JSON.stringify(summary) : describeJob(summary, now()));
                            return job.state === "SUCCEEDED" ? 0 : 1;
                        }
                        if (Date.now() > waitUntil) {
                            io.err(
                                `probe ${inserted.publicId}: nach ${String(num(values["timeout-s"]) ?? 600)} s noch nicht beendet`,
                            );
                            return 3;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 500));
                    }
                }
                case "enqueue": {
                    const kind = positionals[0];
                    const request = {
                        mapDomainId,
                        actorRef: "jobs-cli",
                        release: environment["RELEASE_ID"] ?? null,
                    };
                    let jobs: { kind: string; id: string }[];
                    let report: Record<string, unknown>;
                    if (kind === "terrain_local") {
                        const bounds: Rect[] = [];
                        for (const text of (values.bounds ?? []) as string[]) {
                            const numbers = text.split(",").map((part) => Number(part.trim()));
                            if (numbers.length !== 4 || numbers.some((value) => !Number.isFinite(value))) {
                                io.err(`enqueue: --bounds erwartet minX,minY,maxX,maxY, nicht ${text}`);
                                return 2;
                            }
                            const [minX, minY, maxX, maxY] = numbers as [number, number, number, number];
                            bounds.push({ minX, minY, maxX, maxY });
                        }
                        const chain = await enqueueTerrainLocal(db, {
                            ...request,
                            bounds,
                            fullAfter: values["full-after"] === true,
                        });
                        jobs = [
                            { kind: "terrain_local", id: chain.local.publicId },
                            { kind: "dem_publish", id: chain.publish.publicId },
                            { kind: "routing_reload", id: chain.routing.publicId },
                            { kind: "display_heights", id: chain.heights.publicId },
                            ...(chain.full
                                ? [
                                      { kind: "terrain_full", id: chain.full.full.publicId },
                                      ...(chain.full.routing
                                          ? [{ kind: "routing_reload", id: chain.full.routing.publicId }]
                                          : []),
                                      ...(chain.full.heights
                                          ? [{ kind: "display_heights", id: chain.full.heights.publicId }]
                                          : []),
                                  ]
                                : []),
                        ];
                        report = {
                            tiles: chain.footprint.tiles,
                            changes: chain.footprint.changes,
                            indexMissing: chain.footprint.indexMissing,
                        };
                        if (chain.footprint.indexMissing && bounds.length === 0)
                            io.err(
                                "enqueue: der geltende Master trägt keinen Eingabeindex; der Job weigert sich ohne --bounds (erst derive:terrain)",
                            );
                    } else if (kind === "terrain_full") {
                        const chain = await enqueueTerrainFull(db, request);
                        jobs = [
                            { kind: "terrain_full", id: chain.full.publicId },
                            ...(chain.routing ? [{ kind: "routing_reload", id: chain.routing.publicId }] : []),
                            ...(chain.heights ? [{ kind: "display_heights", id: chain.heights.publicId }] : []),
                        ];
                        report = { coalesced: chain.coalesced };
                    } else {
                        io.err("enqueue: terrain_local oder terrain_full");
                        return 2;
                    }
                    if (values.wait !== true) {
                        io.out(
                            values.json === true
                                ? JSON.stringify({ ...report, jobs })
                                : [
                                      ...jobs.map((job) => `${job.kind.padEnd(16)} ${job.id}`),
                                      JSON.stringify(report),
                                  ].join("\n"),
                        );
                        return 0;
                    }
                    const waitUntil = Date.now() + (num(values["timeout-s"]) ?? 1800) * 1000;
                    for (;;) {
                        const rows = await Promise.all(jobs.map((job) => getJobByPublicId(db, job.id)));
                        if (rows.every((job) => job && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state))) {
                            const summaries = rows.map((job) => toSummary(job!, now()));
                            io.out(
                                values.json === true
                                    ? JSON.stringify({ ...report, jobs: summaries })
                                    : summaries.map((summary) => describeJob(summary, now())).join("\n"),
                            );
                            return rows.every((job) => job?.state === "SUCCEEDED") ? 0 : 1;
                        }
                        if (Date.now() > waitUntil) {
                            io.err(`enqueue: nach ${String(num(values["timeout-s"]) ?? 1800)} s noch nicht beendet`);
                            return 3;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                }
                case "cancel": {
                    const target = positionals[0];
                    if (!target) {
                        io.err("cancel: Kennung fehlt");
                        return 2;
                    }
                    const outcome = await cancelJob(db, { publicId: target }, "operator");
                    io.out(outcome);
                    return outcome === "noop" ? 1 : 0;
                }
                default:
                    return 2;
            }
        };

        // Aufzeichnen und Abfragen haben eine Frist; `probe --wait` wartet bewusst länger.
        const needsDeadline = !((command === "probe" || command === "enqueue") && values.wait === true);
        if (!needsDeadline) return await run();
        const fallback = wantsActive ? 2 : bestEffortExit(1);
        return await withDeadline(timeoutS, fallback, run(), () =>
            io.err(`jobs-cli ${command}: keine Antwort der Datenbank in ${String(timeoutS)} s, abgebrochen`),
        );
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        io.err(`jobs-cli ${command}: ${detail.replace(/postgres(?:ql)?:\/\/\S+/gi, "<verbindung>").slice(0, 200)}`);
        if (wantsActive) return 2;
        return bestEffortExit(1);
    } finally {
        if (ownsDatabase && database) {
            await database.end({ timeout: 2 }).catch(() => undefined);
        }
    }
}
