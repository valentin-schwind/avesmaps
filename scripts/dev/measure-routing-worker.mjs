// Speichermessung des Routing-Workers (WI-0071): ArrayBuffer, Heap und RSS im Grundbedarf, beim Nachladen und unter
// den Proben der Stage-Rollouts. Nur lesend: Das Nachladen wird erzwungen, indem der Dienst im Speicher eine andere
// Revision zu sehen bekommt, nie durch Schreiben in die Datenbank.
//
// Aufruf (von der Wurzel, gegen die Entwicklungsdatenbank):
//   node --expose-gc --env-file-if-exists=.env scripts/dev/measure-routing-worker.mjs [base | dem] [--out datei.json]
//   base  nur den Grundbedarf nach dem Vorwärmen
//   dem   dreimal ein neues Gelände-Raster nachladen (der teuerste Fall)
//   ohne  Grundbedarf, Proben, jedes Nachladen, Proben noch einmal
//
// Beim Kaltstart (`warm`) zeigt die Tabelle außerdem die Ladezeit je Teil (`parts_ms` des Journals `routing graph loaded`) und
// die Pausen in der Schnappschuss-Transaktion: Was der Worker zwischen zwei Anfragen rechnet, steht der Verbindung gegenüber
// als „idle in transaction“, und dafür gilt im Worker die Grenze von 30 s (`WORKER_TIMEOUTS`). Die längste Pause mal der
// Faktor einer langsameren CPU ist der Abstand zu dieser Grenze.
//
// Gemessen wird im Worker-Thread selbst (`process.memoryUsage().arrayBuffers`, wie Claudio auf Stage):
//   - „nach gc“: zweimal `gc()` im Abstand von 150 ms. Einmal liest zu hoch, weil V8 die Puffer erst danach nebenher
//     freigibt.
//   - Spitze „roh“: alle 10 ms ohne gc, mit dem Abfall, den der Treiber hinterlässt.
//   - Spitze „gc“: alle 250 ms nach gc(), nur die lebenden Daten (die Weise der Rollout-Berichte).
//   - `nhash`: Hash der Antwort ohne ihre Revisionsschlüssel. Gleich vor und nach einer Änderung am Dienst heißt:
//     dieselben Routen Byte für Byte, solange sich die Daten dazwischen nicht ändern (parallele Sitzungen!).
// Die Werte hängen von der Entwicklungsdatenbank ab; verglichen wird vorher/nachher am selben Tag und Stand.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { isMainThread, MessageChannel, Worker, workerData } from "node:worker_threads";

const MiB = 1024 * 1024;
const mib = (bytes) => (bytes / MiB).toFixed(1);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (isMainThread) {
    await driver();
} else {
    await probeWorker();
}

/** Der Hauptthread: startet den Worker, gibt die Befehle und schreibt die Tabelle. */
async function driver() {
    const args = process.argv.slice(2);
    const outAt = args.indexOf("--out");
    const out = outAt >= 0 ? args[outAt + 1] : undefined;
    const mode = args.find((arg, index) => !arg.startsWith("--") && !(outAt >= 0 && index === outAt + 1));
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL fehlt (--env-file-if-exists=.env)");
    if (typeof globalThis.gc !== "function") throw new Error("Mit --expose-gc starten");

    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(fileURLToPath(import.meta.url), {
        workerData: { databaseUrl: process.env.DATABASE_URL, port: port2 },
        transferList: [port2],
    });
    worker.on("error", (error) => {
        console.error("Worker-Fehler", error);
        process.exit(1);
    });
    let nextId = 1;
    const waiting = new Map();
    port1.on("message", (message) => {
        waiting.get(message.id)?.(message);
        waiting.delete(message.id);
    });
    const ask = (body) =>
        new Promise((resolve, reject) => {
            const id = nextId++;
            waiting.set(id, (reply) => (reply.failure ? reject(new Error(reply.failure)) : resolve(reply)));
            port1.postMessage({ id, ...body });
        });
    await ask({ cmd: "ready" });

    let rssPeak = 0;
    const rssTimer = setInterval(() => {
        rssPeak = Math.max(rssPeak, process.memoryUsage.rss());
    }, 10);
    const rows = [];
    const table = (name, data) => {
        rows.push({ name, ...data });
        process.stdout.write(
            `${name.padEnd(48)} ${Object.entries(data)
                .map(([key, value]) => `${key}=${String(value)}`)
                .join("  ")}\n`,
        );
    };
    /** Zweimal gc im Abstand, dann die lebenden Daten. */
    const settle = async () => {
        await ask({ cmd: "gc" });
        await sleep(150);
        return (await ask({ cmd: "gc" })).mem;
    };
    const measured = async (work) => {
        await ask({ cmd: "resetPeak" });
        rssPeak = process.memoryUsage.rss();
        const result = await work();
        const { peak } = await ask({ cmd: "peak" });
        return { result, peak, rss: rssPeak };
    };

    const started = Date.now();
    const warmed = await measured(() => ask({ cmd: "warm" }));
    await sleep(300);
    const rawAfterWarm = (await ask({ cmd: "raw" })).mem;
    const base = await settle();
    table("0 Kaltstart warm() nach Teilen, ms", { gesamt: Math.round(warmed.result.ms), ...warmed.result.parts });
    for (const pause of warmed.result.pauses)
        table("0 Pause in der Transaktion", {
            ms: Math.round(pause.ms),
            nach: JSON.stringify(pause.after),
            vor: JSON.stringify(pause.before),
        });
    for (const query of warmed.result.queries)
        table("0 Längste Anfrage der Transaktion", { ms: Math.round(query.ms), text: JSON.stringify(query.text) });
    table("1 Grundbedarf nach warm() und gc", {
        arrayBuffers_MiB: mib(base.arrayBuffers),
        heap_MiB: mib(base.heapUsed),
        rss_MiB: mib(process.memoryUsage.rss()),
        roh_ohne_gc_MiB: mib(rawAfterWarm.arrayBuffers),
        warm_spitze_roh_MiB: mib(warmed.peak.arrayBuffers),
        warm_spitze_gc_MiB: mib(warmed.peak.gcArrayBuffers),
        warm_spitze_rss_MiB: mib(warmed.rss),
        warm_s: ((Date.now() - started) / 1000).toFixed(1),
    });

    const reload = async (name, options) => {
        const { result, peak, rss } = await measured(() => ask({ cmd: "reload", ...options }));
        const after = await settle();
        table(name, {
            ms: result.ms,
            geaendert: result.last?.changed?.join("+"),
            spitze_roh_MiB: mib(peak.arrayBuffers),
            spitze_gc_MiB: mib(peak.gcArrayBuffers),
            nach_gc_MiB: mib(after.arrayBuffers),
            heap_spitze_gc_MiB: mib(peak.gcHeapUsed),
            rss_spitze_MiB: mib(rss),
        });
    };

    const probes = [
        ["Gareth > Perricum", ["Gareth", "Perricum"], {}],
        ["Havena > Gareth > Festum > Khunchom", ["Havena", "Gareth", "Festum", "Khunchom"], {}],
        [
            "Greifenfurt > Lowangen, Reiter, Praios",
            ["Greifenfurt", "Lowangen"],
            { land: "lightRider", start_month: "praios" },
        ],
        [
            "Greifenfurt > Lowangen, Reiter, Firun",
            ["Greifenfurt", "Lowangen"],
            { land: "lightRider", start_month: "firun" },
        ],
        ["Riva > Geheimlager, Firun", ["Riva", "Geheimlager des Horasiats"], { start_month: "firun" }],
        ["Riva > Varmur, Praios", ["Riva", "Varmur"], { start_month: "praios" }],
        ["Riva > Varmur, Firun (845 h)", ["Riva", "Varmur"], { start_month: "firun" }],
        ["Riva/Al'Anfa x100 (zu groß)", Array.from({ length: 100 }, (_, i) => (i % 2 ? "Al'Anfa" : "Riva")), {}],
        ["Flug Punin > Perricum, Hexenbesen", ["Punin", "Perricum"], { air: "witchFlight" }],
        [
            "Flug Punin/Perricum x100",
            Array.from({ length: 100 }, (_, i) => (i % 2 ? "Perricum" : "Punin")),
            { air: "witchFlight" },
        ],
    ];
    const hashes = {};
    const runProbes = async (phase) => {
        for (const [name, names, request] of probes) {
            await settle();
            const { result, peak, rss } = await measured(() => ask({ cmd: "route", names, request }));
            (hashes[name] ??= {})[phase] = result.nhash;
            table(`P${phase} ${name}`, {
                ergebnis: result.ok ? (result.found ? "gefunden" : "nicht gefunden") : result.error,
                ms: result.ms.toFixed(0),
                nhash: result.nhash,
                spitze_roh_MiB: mib(peak.arrayBuffers),
                rss_spitze_MiB: mib(rss),
            });
        }
    };

    if (mode === "dem") {
        for (let run = 1; run <= 3; run += 1)
            await reload(`DEM neu #${String(run)}`, { part: "terrain", tamper: "dem" });
    } else if (mode !== "base") {
        await runProbes("a");
        await reload("2 Nachladen terrain (Raster und Gebirgsflächen gleich)", { part: "terrain" });
        await reload("3 Nachladen terrain (Gebirgsflächen anders)", { part: "terrain", tamper: "membership" });
        await reload("4 Nachladen terrain (neues Raster)", { part: "terrain", tamper: "dem" });
        await reload("5 Nachladen map (Orte, Wege)", { part: "map" });
        await reload("6 Nachladen terrain (noch einmal gleich)", { part: "terrain" });
        await runProbes("b");
        const end = await settle();
        table("9 Ende nach Proben und gc", {
            arrayBuffers_MiB: mib(end.arrayBuffers),
            heap_MiB: mib(end.heapUsed),
            rss_MiB: mib(process.memoryUsage.rss()),
        });
        const changed = Object.entries(hashes).filter(([, phases]) => phases.a !== phases.b);
        process.stdout.write(
            changed.length === 0
                ? "Antworten vor und nach den Nachladevorgängen gleich (nhash)\n"
                : `ABWEICHUNG nach dem Nachladen: ${changed.map(([name]) => name).join(", ")}\n`,
        );
    }
    clearInterval(rssTimer);
    if (out) writeFileSync(out, `${JSON.stringify({ rows, hashes }, null, 2)}\n`);
    await worker.terminate();
    process.exit(0);
}

/**
 * Der Worker-Thread: Dienst und Quelle des echten Routing-Workers (`routing/worker.ts`), dazu ein Steuerkanal. Die
 * Revision, die der Dienst sieht, wird im Speicher verfälscht, damit ein Nachladen des Geländes stattfindet.
 */
async function probeWorker() {
    const { databaseUrl, port } = workerData;
    const { createDatabase, WORKER_TIMEOUTS } = await import("../../apps/server/src/database.ts");
    const { databaseRoutingSource, RouteService } = await import("../../apps/server/src/routing/service.ts");
    const { queryOf } = await import("../../apps/server/src/routing/corpus-gate-run.ts");
    const { AVENTURIA, AVENTURIA_TRAVEL_MODEL, ROUTE_DEFAULTS } = await import("@avesmaps3d/shared");

    const pauses = [];
    const database = watchTransactions(createDatabase(databaseUrl, { max: 2, timeouts: WORKER_TIMEOUTS }), pauses);
    const real = databaseRoutingSource(database, AVENTURIA.mapDomain, AVENTURIA_TRAVEL_MODEL);
    const bumps = { terrain: 0, map: 0 };
    let plan = { part: "terrain", tamper: "none" };
    let lastData;
    const bumped = (revision) => ({
        ...revision,
        terrain: bumps.terrain === 0 ? revision.terrain : `${String(revision.terrain)}#${String(bumps.terrain)}`,
        map: bumps.map === 0 ? revision.map : `${revision.map}#${String(bumps.map)}`,
    });
    const source = {
        revision: async () => bumped(await real.revision()),
        load: async (previous, report) => {
            let before = previous;
            if (previous) {
                // Die verfälschten Teile zurücknehmen, dann nur den geplanten als geändert melden.
                const plain = (value) => (typeof value === "string" ? value.replace(/#\d+$/, "") : value);
                const revision = {
                    ...previous.revision,
                    terrain: plain(previous.revision.terrain),
                    map: plain(previous.revision.map),
                };
                before = { ...previous, revision: { ...revision, [plan.part]: "erzwungen" } };
                const domain = previous.heights?.domain;
                if (domain && plan.tamper === "dem") {
                    // Ein neues Raster: der Fingerabdruck des alten weicht ab.
                    const old = { ...domain, fingerprint: "alt", revision: "alt" };
                    before = { ...before, heights: { ...previous.heights, domain: old } };
                } else if (domain && plan.tamper === "membership") {
                    // Geänderte Gebirgsflächen auf demselben Raster.
                    before = {
                        ...before,
                        heights: { ...previous.heights, domain: { ...domain, membershipFingerprint: "alt" } },
                    };
                }
            }
            const data = await real.load(before, report);
            lastData = { ...data, revision: bumped(data.revision) };
            return lastData;
        },
        ...(real.loadSea ? { loadSea: real.loadSea } : {}),
    };
    const reloads = [];
    const service = new RouteService({
        mapDomain: AVENTURIA.mapDomain,
        model: AVENTURIA_TRAVEL_MODEL,
        source,
        recheckMs: 3_600_000,
        onReload: (event) => reloads.push(event),
        onReloadError: (error) => reloads.push({ error: String(error) }),
    });
    const warmRequest = {
        optimize: ROUTE_DEFAULTS.optimize,
        transports: { land: ROUTE_DEFAULTS.land, river: ROUTE_DEFAULTS.river, sea: ROUTE_DEFAULTS.sea },
        enabled: { land: true, river: true, sea: true },
        minimizeTransfers: ROUTE_DEFAULTS.minimize_transfers,
        seaRouting: ROUTE_DEFAULTS.sea_routing,
    };

    const raw = () => {
        const usage = process.memoryUsage();
        return { heapUsed: usage.heapUsed, arrayBuffers: usage.arrayBuffers };
    };
    let peak;
    const resetPeak = () => {
        peak = { arrayBuffers: 0, heapUsed: 0, gcArrayBuffers: 0, gcHeapUsed: 0 };
    };
    resetPeak();
    const sample = () => {
        const now = raw();
        peak.arrayBuffers = Math.max(peak.arrayBuffers, now.arrayBuffers);
        peak.heapUsed = Math.max(peak.heapUsed, now.heapUsed);
    };
    setInterval(sample, 10).unref();
    setInterval(() => {
        globalThis.gc();
        const now = raw();
        peak.gcArrayBuffers = Math.max(peak.gcArrayBuffers, now.arrayBuffers);
        peak.gcHeapUsed = Math.max(peak.gcHeapUsed, now.heapUsed);
    }, 250).unref();

    const idOf = (name) => {
        for (const node of lastData.network.nodes.values())
            if (node.kind === "place" && node.name === name) return node.id;
        throw new Error(`Ort nicht gefunden: ${name}`);
    };

    port.on("message", async (message) => {
        const reply = (body) => port.postMessage({ id: message.id, ...body });
        try {
            if (message.cmd === "warm") {
                pauses.length = 0;
                const began = performance.now();
                await service.warm(warmRequest);
                const top = (kind, count) =>
                    pauses
                        .filter((entry) => entry.kind === kind)
                        .sort((a, b) => b.ms - a.ms)
                        .slice(0, count);
                reply({
                    ok: true,
                    ms: performance.now() - began,
                    parts: reloads.at(-1)?.parts_ms,
                    pauses: top("pause", 4),
                    queries: top("query", 4),
                });
            } else if (message.cmd === "gc") {
                globalThis.gc();
                reply({ mem: raw() });
            } else if (message.cmd === "raw") {
                reply({ mem: raw() });
            } else if (message.cmd === "resetPeak") {
                resetPeak();
                reply({ ok: true });
            } else if (message.cmd === "peak") {
                sample();
                reply({ peak });
            } else if (message.cmd === "reload") {
                plan = { part: message.part ?? "terrain", tamper: message.tamper ?? "none" };
                bumps[plan.part] += 1;
                const began = Date.now();
                await service.refresh();
                reply({ ms: Date.now() - began, last: reloads.at(-1) });
            } else if (message.cmd === "route") {
                const query = queryOf(message.request ?? {});
                if ("invalid" in query) throw new Error(query.invalid);
                const began = performance.now();
                const outcome = await service.route({ ...query, waypoints: message.names.map(idOf) });
                const ms = performance.now() - began;
                let body = outcome;
                if (outcome.ok) {
                    // Ohne die Revisionsschlüssel: Sie ändern sich mit jedem erzwungenen Nachladen.
                    const rest = { ...outcome.response };
                    delete rest.routing_graph_revision;
                    delete rest.map_revision;
                    delete rest.terrain_revision;
                    body = rest;
                }
                reply({
                    ok: outcome.ok,
                    error: outcome.ok ? undefined : `${outcome.error}:${outcome.detail ?? ""}`,
                    found: outcome.ok ? outcome.response.found : undefined,
                    ms,
                    nhash: createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16),
                });
            } else {
                reply({ ready: true });
            }
        } catch (error) {
            reply({ failure: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
        }
    });
}

/**
 * Die Datenbank mit einer Uhr in jeder Transaktion (`begin`): Jede Pause zwischen dem Ende einer Anfrage und dem Beginn
 * der nächsten (und dem Ende der Transaktion) landet mit den Anfängen der beiden Anfragen in `pauses` (`kind: "pause"`),
 * dazu die Dauer jeder Anfrage (`kind: "query"`; die Grenze `statement_timeout` des Workers gilt je Anfrage). Sie
 * verändert nichts: die Anfragen laufen unverändert durch.
 */
function watchTransactions(database, pauses) {
    return new Proxy(database, {
        get(target, key, receiver) {
            if (key !== "begin") return Reflect.get(target, key, receiver);
            return (...args) => {
                const work = args.pop();
                return target.begin(...args, (transaction) => {
                    let lastEnd = performance.now();
                    let lastText = "BEGIN";
                    const watched = new Proxy(transaction, {
                        apply(query, thisArg, [strings, ...values]) {
                            const text = strings.join("?").replace(/\s+/g, " ").trim().slice(0, 64);
                            // Die Anfrage selbst zurückgeben (sie kann auch als Teil einer anderen dienen); nur ihr `then`,
                            // das sie ausführt, bekommt die Uhr.
                            const pending = Reflect.apply(query, thisArg, [strings, ...values]);
                            const run = pending.then.bind(pending);
                            let started = false;
                            let began = 0;
                            let ended = false;
                            pending.then = (resolve, reject) => {
                                // `await` ruft `then` einmal, die Verkettung darin ein zweites Mal: nur der erste Aufruf zählt.
                                if (!started) {
                                    started = true;
                                    began = performance.now();
                                    pauses.push({
                                        kind: "pause",
                                        ms: Math.max(0, performance.now() - lastEnd),
                                        after: lastText,
                                        before: text,
                                    });
                                }
                                return run((rows) => {
                                    lastEnd = performance.now();
                                    lastText = text;
                                    if (!ended) pauses.push({ kind: "query", ms: lastEnd - began, text });
                                    ended = true;
                                    return resolve ? resolve(rows) : rows;
                                }, reject);
                            };
                            return pending;
                        },
                    });
                    return Promise.resolve(work(watched)).then((result) => {
                        pauses.push({
                            kind: "pause",
                            ms: performance.now() - lastEnd,
                            after: lastText,
                            before: "COMMIT",
                        });
                        return result;
                    });
                });
            };
        },
    });
}
