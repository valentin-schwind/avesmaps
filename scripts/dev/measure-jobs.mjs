// Das Messwerkzeug der Warteschlange (JOBS-0001 Abschnitt 6.0, WI-0074, Q6): Probe-Jobs mit Speicherballast in Schritten von 256 MB, und
// was der Rechner dabei tut. Für Claudios Probe auf der Stage (auf Betreiberauftrag) und für jeden, der die Startwerte (MS1 bis MS20)
// bestätigen oder ersetzen will.
//
// 🔴 ES SCHREIBT NIE SELBST IN TABELLEN. Probe-Jobs reiht das CLI ein (`jobs-cli probe`, mit der Jobs-Rolle; auf dem VPS über den
// Korridor-Wrapper `avesmaps3d-corridor-jobs probe <Jobart> <Ballast-MB>`, feste Whitelist, kein freier Zugang der Anwendung). Dieses
// Skript ruft nur dessen Befehl auf (`--probe-cmd`) und MISST: Speicher und Swap des Rechners, die Antwortzeit der API unter der Last
// und, über eine schreibgeschützte Verbindung, das Lebenszeichen des Aufsehers (Verzögerung der Heartbeats, MS1).
//
// Aufruf:
//   node --env-file-if-exists=.env scripts/dev/measure-jobs.mjs [--steps 256,512,768,1024] [--api http://127.0.0.1:3000]
//        [--api-paths /health/ready] [--probe-cmd "node apps/server/dist/jobs/cli.js probe"] [--phase-ms 4000] [--phases 3]
//        [--out datei.json]
//   --steps       Ballast je Probe in MB, ein Lauf je Schritt (Vorgabe 256 bis 1.024 in 256er-Schritten)
//   --api         Grundadresse der API, deren Antwortzeit unter der Last gemessen wird (je Pfad eine Anfrage alle 0,5 s)
//   --api-paths   Pfade, Komma-getrennt (Vorgabe /health/ready; für die Route des Betreibers einen echten Pfad nennen)
//   --probe-cmd   der Befehl, der eine Probe einreiht (Vorgabe `node apps/server/src/jobs/cli.ts probe`); `--ballast-mb`, `--phases`,
//                 `--phase-ms`, `--json` hängt das Skript an (ein Wrapper darf `--wait` selbst anhängen, der Beobachter findet den Job trotzdem)
//   --out         schreibt alle Zahlen als JSON (Claudio legt die Datei unter ~/ops-evidence/… ab)
//
// Gemessen wird je Schritt: Walltime und Spitze RSS des Job-Prozesses (aus der Jobzeile, `VmHWM`), Selbstmeldung gegen Messung von außen
// (die Abweichung steht im Befund), MemAvailable-Minimum und Swap-Maximum (Takt 1 s, nur Linux), p50/p95/p99 der API und die
// Verzögerung der Heartbeats (p99; erwartet unter 1 s, weil der Aufseher nicht rechnet). Ein wartender Job (Zulassung) wird als solcher
// gemeldet, die Zulassung wartet und bricht nie ab: `waitReason` steht im Ergebnis.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import postgres from "postgres";

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : fallback;
};
const steps = valueOf("--steps", "256,512,768,1024")
    .split(",")
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
const api = valueOf("--api", "http://127.0.0.1:3000");
const apiPaths = valueOf("--api-paths", "/health/ready").split(",").filter(Boolean);
const probeCommand = valueOf("--probe-cmd", "node apps/server/src/jobs/cli.ts probe").split(/\s+/);
/**
 * Der Statusbefehl entsteht aus dem Probe-Befehl, indem das Wort `probe` zu `status` wird und alles danach wegfällt.
 * 💣 Früher fiel einfach das LETZTE Wort weg: Ein Befehl wie `… probe --wait` wurde so zu `… probe status`, und jede
 * Statusfrage reihte einen weiteren Probe-Job ein (lokal am 2026-10-08: rund 300 in fünf Minuten). Ohne das Wort `probe`
 * gibt es keine Statusfrage; dann zählt allein, was der Beobachter in der Datenbank sieht.
 */
const probeWord = probeCommand.lastIndexOf("probe");
const statusCommand = probeWord >= 0 ? [...probeCommand.slice(0, probeWord), "status"] : null;
const TERMINAL = ["SUCCEEDED", "FAILED", "CANCELLED"];
const phaseMs = Number(valueOf("--phase-ms", "4000"));
const phases = Number(valueOf("--phases", "3"));
const out = valueOf("--out", undefined);

const percentile = (values, fraction) => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * fraction;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return sorted[low] + ((sorted[high] ?? sorted[low]) - sorted[low]) * (position - low);
};
const round = (value) => (value === null ? null : Math.round(value * 10) / 10);

/** MemAvailable und Swap in MB (Linux); anderswo null. */
function memory() {
    if (process.platform !== "linux") return null;
    try {
        const text = readFileSync("/proc/meminfo", "utf8");
        const kb = (name) => Number(new RegExp(`^${name}:\\s+(\\d+)`, "m").exec(text)?.[1] ?? Number.NaN);
        return { availableMb: kb("MemAvailable") / 1024, swapUsedMb: (kb("SwapTotal") - kb("SwapFree")) / 1024 };
    } catch {
        return null;
    }
}

/** Die Antwortzeiten der API, eine Anfrage je Pfad alle 0,5 s, bis `stop()` gerufen wird. */
function loadProbe() {
    const latencies = [];
    let errors = 0;
    let running = true;
    const loop = (async () => {
        while (running) {
            for (const path of apiPaths) {
                const started = performance.now();
                try {
                    const response = await globalThis.fetch(api + path, { cache: "no-store" });
                    await response.arrayBuffer();
                    if (response.status >= 500) errors += 1;
                    else latencies.push(performance.now() - started);
                } catch {
                    errors += 1;
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    })();
    return {
        async stop() {
            running = false;
            await loop;
            return {
                requests: latencies.length + errors,
                errors,
                p50Ms: round(percentile(latencies, 0.5)),
                p95Ms: round(percentile(latencies, 0.95)),
                p99Ms: round(percentile(latencies, 0.99)),
            };
        },
    };
}

/**
 * Lesender Blick auf die Jobzeile: das Lebenszeichen des Aufsehers (MS1) und der Wartegrund. Schreibt nichts.
 *
 * 💣 **Der Job wird über die Datenbank gefunden, nicht über die Ausgabe des Probe-Befehls.** Auf Stage hängt der
 * Korridor-Wrapper (`avesmaps3d-corridor-jobs probe`) fest `--wait` an: der Befehl kehrt erst zurück, wenn der Job
 * schon fertig ist. Wer erst dann zusieht, sieht nie einen laufenden Job und meldet `beats: 0`, obwohl der Aufseher
 * pünktlich schlug (Claudios Messlauf vom 2026-10-05, `handovers/2026-10-05-stage-rollout-9b6213f.md`). Darum sucht der
 * Beobachter ab `begin()` selbst den jüngsten Probe-Job, der seit Beginn des Schritts (Uhr der DATENBANK) eingereiht wurde.
 * Fehlgeschlagene Abfragen werden gezählt und gemeldet: Eine stille 0 ließ nicht unterscheiden, ob der Aufseher schwieg
 * oder die Verbindung nichts sah.
 */
function jobWatcher() {
    if (!process.env.DATABASE_URL)
        return {
            async begin() {},
            async stop() {
                return null;
            },
            watch() {},
        };
    const sql = postgres(process.env.DATABASE_URL, {
        max: 1,
        onnotice: () => {},
        connection: { default_transaction_read_only: "on", application_name: "measure-jobs" },
    });
    let publicId = null;
    let since = null;
    let running = true;
    const beats = [];
    const reasons = new Set();
    let last = null;
    let runningSamples = 0;
    let queryErrors = 0;
    let firstError = null;
    const loop = (async () => {
        while (running) {
            try {
                if (!publicId && since) {
                    const [found] = await sql`
                        SELECT public_id FROM job WHERE kind = 'probe' AND queued_at >= ${since} ORDER BY id DESC LIMIT 1`;
                    if (found) publicId = found.public_id;
                }
                if (publicId) {
                    const [row] =
                        await sql`SELECT state, wait_reason, heartbeat_at FROM job WHERE public_id = ${publicId}::uuid`;
                    if (row?.wait_reason) reasons.add(row.wait_reason);
                    if (row?.state === "RUNNING" && row.heartbeat_at) {
                        runningSamples += 1;
                        const at = row.heartbeat_at.getTime();
                        if (last !== null && at !== last) beats.push(at - last);
                        last = at;
                    }
                }
            } catch (error) {
                queryErrors += 1;
                firstError ??= error instanceof Error ? error.message : String(error);
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    })();
    return {
        /** Merkt sich die Uhr der Datenbank: ab hier zählt ein eingereihter Probe-Job zu diesem Schritt. */
        async begin() {
            try {
                const [row] = await sql`SELECT now() AS now`;
                since = row.now;
            } catch (error) {
                queryErrors += 1;
                firstError ??= error instanceof Error ? error.message : String(error);
            }
        },
        /** Die Kennung aus der Ausgabe des Probe-Befehls; ein schon gefundener Job bleibt. */
        watch(id) {
            if (publicId) return;
            publicId = id;
            last = null;
        },
        async stop() {
            running = false;
            await loop;
            await sql.end({ timeout: 2 });
            // Der Takt von `heartbeatS` steht als Soll im Profil; hier zählt die Abweichung der Abstände.
            return {
                beats: beats.length,
                gapP50Ms: round(percentile(beats, 0.5)),
                gapP99Ms: round(percentile(beats, 0.99)),
                waitReasons: [...reasons],
                // 0 heißt: der Beobachter hat den Job nie laufen sehen. Dann ist `beats: 0` keine Aussage über den Aufseher.
                runningSamples,
                queryErrors,
                ...(firstError ? { firstError } : {}),
            };
        },
    };
}

/** Führt das CLI aus und liefert seine Ausgabe (Zeilen) und den Exit-Code. */
function run(command, extra) {
    return new Promise((resolve) => {
        const child = spawn(command[0], [...command.slice(1), ...extra], {
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

const results = [];
console.log(
    `Messwerkzeug der Warteschlange: ${steps.length} Schritte (${steps.join(", ")} MB), API ${api}${apiPaths.join(",")}`,
);
const before = memory();
for (const ballastMb of steps) {
    const watcher = jobWatcher();
    const load = loadProbe();
    let minAvailable = before?.availableMb ?? null;
    let maxSwap = before?.swapUsedMb ?? null;
    const sampler = setInterval(() => {
        const sample = memory();
        if (!sample) return;
        minAvailable = minAvailable === null ? sample.availableMb : Math.min(minAvailable, sample.availableMb);
        maxSwap = maxSwap === null ? sample.swapUsedMb : Math.max(maxSwap, sample.swapUsedMb);
    }, 1000);

    // Einreihen. Der Beobachter sucht den Job selbst (siehe `jobWatcher`), denn ein Befehl mit `--wait` kehrt erst nach dem
    // Ende zurück; ohne `--wait` liefert die Ausgabe die Kennung zusätzlich.
    await watcher.begin();
    const queued = await run(probeCommand, [
        "--ballast-mb",
        String(ballastMb),
        "--phases",
        String(phases),
        "--phase-ms",
        String(phaseMs),
        "--json",
    ]);
    let publicId = null;
    let summary = null;
    try {
        const answer = JSON.parse(queued.stdout.trim().split("\n").at(-1) ?? "{}");
        publicId = answer.id ?? null;
        // Mit `--wait` (der Korridor-Wrapper hängt es an) ist die Antwort schon die Zusammenfassung des beendeten Jobs.
        if (TERMINAL.includes(answer.state)) summary = answer;
    } catch {
        publicId = null;
    }
    if (publicId) watcher.watch(publicId);
    const started = performance.now();
    if (publicId && summary === null && statusCommand) {
        // Die Ausgabe von `jobs-cli status --json` genügt nicht für ein einzelnes Ende; wir fragen die Jobzeile über das CLI nach.
        for (;;) {
            const status = await run(statusCommand, ["--json"]);
            try {
                const overview = JSON.parse(status.stdout.trim().split("\n").at(-1) ?? "{}");
                const all = [
                    ...(overview.recent ?? []),
                    ...(overview.failed ?? []),
                    ...(overview.running ?? []),
                    ...(overview.queued ?? []),
                ];
                const mine = all.find((entry) => entry.id === publicId);
                if (mine && TERMINAL.includes(mine.state)) {
                    summary = mine;
                    break;
                }
            } catch {
                // nächste Runde
            }
            if (performance.now() - started > 15 * 60_000) break;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
    clearInterval(sampler);
    const api = await load.stop();
    const heartbeat = await watcher.stop();
    const result = {
        ballastMb,
        state: summary?.state ?? "unbekannt",
        wallMs: summary?.wallMs ?? null,
        rssPeakMb: summary?.rssPeakMb ?? null,
        memExpectedMb: summary?.memExpectedMb ?? null,
        // Selbstmeldung gegen Messung von außen (Spitze des Prozesses): die Abweichung prüft Claudio in Etappe 2 (MS5)
        deviationMb:
            summary?.rssPeakMb != null && summary?.memExpectedMb != null
                ? summary.rssPeakMb - summary.memExpectedMb
                : null,
        findings: summary?.findings ?? [],
        memAvailableMinMb: round(minAvailable),
        swapMaxMb: round(maxSwap),
        api,
        heartbeat,
    };
    results.push(result);
    console.log(JSON.stringify(result));
}
if (out) {
    writeFileSync(
        out,
        `${JSON.stringify({ at: new Date().toISOString(), host: process.platform, steps, results }, null, 2)}\n`,
    );
    console.log(`geschrieben: ${out}`);
}
