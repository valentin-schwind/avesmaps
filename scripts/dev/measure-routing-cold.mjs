// Kaltstart der ersten Route nach dem Neuladen (WI-0117): Wie lange braucht die erste schwere Route auf einem
// frisch geladenen Stand, gegen die zweite? Gemessen direkt im Prozess, mit dem echten Dienst (`RouteService`) und der
// echten Quelle (`databaseRoutingSource`), nur lesend: Das Nachladen wird erzwungen, indem der Dienst im Speicher eine
// andere Revision zu sehen bekommt (wie `measure-routing-worker.mjs`), nie durch Schreiben in die Datenbank.
//
// Aufruf (von der Wurzel, gegen die Entwicklungsdatenbank):
//   node --expose-gc --env-file-if-exists=.env scripts/dev/measure-routing-cold.mjs [--mode MODE,...] [--probes a,b]
//        [--repeat n] [--no-pre] [--profile] [--idle-ms n] [--out datei.json]
//   MODE  start (Kaltstart mit warm()), map | terrain | all (Neuladen, danach die Proben auf dem neuen Stand)
//   --no-pre    die Probe läuft vor dem Neuladen NICHT einmal: Ihr Profil war im alten Stand nicht in Gebrauch (der Fall
//               „ein Nutzer wählt nach dem Neuladen zum ersten Mal ein anderes Mittel“)
//   --profile   die CPU-Verteilung der ERSTEN Route (Eigenzeit je Funktion, die zwölf größten) dazu
//   --idle-ms   Ruhe zwischen Neuladen und erster Probe (Stage: ein Tageszug lässt rund zwei Sekunden)
//
// Je Probe und Betriebsart: erst Neuladen (oder Start), dann die Probe zweimal hintereinander. Die erste Zeit ist die,
// die ein Nutzer nach dem Neuladen erlebt; die zweite ist der Beharrungszustand.
import { writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 ? args[at + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const modes = option("mode", "start,map,terrain,all").split(",");
const only = option("probes", "").split(",").filter(Boolean);
const repeat = Number(option("repeat", "1"));
const idleMs = Number(option("idle-ms", "0"));
const usedBefore = !flag("no-pre");
const profile = flag("profile");
const out = option("out", undefined);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL fehlt (--env-file-if-exists=.env)");

const { createDatabase, WORKER_TIMEOUTS } = await import("../../apps/server/src/database.ts");
const { databaseRoutingSource, RouteService } = await import("../../apps/server/src/routing/service.ts");
const { queryOf } = await import("../../apps/server/src/routing/corpus-gate-run.ts");
const { AVENTURIA, AVENTURIA_TRAVEL_MODEL, ROUTE_DEFAULTS } = await import("@avesmaps3d/shared");

const database = createDatabase(process.env.DATABASE_URL, { max: 2, timeouts: WORKER_TIMEOUTS });
const real = databaseRoutingSource(database, AVENTURIA.mapDomain, AVENTURIA_TRAVEL_MODEL);

// Die Revision wird im Speicher verfälscht: Jeder Teil in `forced` gilt dem Dienst als geändert, `tamperDem` zwingt
// auch das Raster zum neuen Lesen (der teuerste Fall).
const bumps = { map: 0, terrain: 0, climate: 0, pathProfiles: 0, territories: 0 };
let forced = [];
let tamperDem = false;
let lastData;
const plain = (value) => (typeof value === "string" ? value.replace(/#\d+$/, "") : value);
const bumped = (revision) => {
    const result = { ...revision };
    for (const [part, count] of Object.entries(bumps)) {
        if (count > 0 && typeof result[part] === "string") result[part] = `${result[part]}#${String(count)}`;
    }
    return result;
};
const source = {
    revision: async () => bumped(await real.revision()),
    load: async (previous, report) => {
        let before = previous;
        if (previous) {
            const revision = { ...previous.revision };
            for (const part of Object.keys(bumps)) revision[part] = plain(revision[part]);
            for (const part of forced) revision[part] = "erzwungen";
            before = { ...previous, revision };
            const domain = previous.heights?.domain;
            if (domain && tamperDem) {
                before = {
                    ...before,
                    heights: { ...previous.heights, domain: { ...domain, fingerprint: "alt", revision: "alt" } },
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
const newService = () =>
    new RouteService({
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

const probes = [
    ["Gareth > Perricum", ["Gareth", "Perricum"], {}],
    ["Thorwal > Al'Anfa", ["Thorwal", "Al'Anfa"], {}],
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
    ["Gareth > Perricum, Praios", ["Gareth", "Perricum"], { start_month: "praios" }],
    ["Gareth > Kartenpunkt", ["Gareth", "@punkt"], {}],
    ["Flug Punin > Perricum, Hexenbesen", ["Punin", "Perricum"], { air: "witchFlight" }],
].filter(([name]) => only.length === 0 || only.some((part) => name.includes(part)));

const idOf = (name) => {
    for (const node of lastData.network.nodes.values()) {
        if (node.kind === "place" && node.name === name) {
            return node.id;
        }
    }
    throw new Error(`Ort nicht gefunden: ${name}`);
};
const placeOf = (name) => {
    for (const node of lastData.network.nodes.values()) if (node.kind === "place" && node.name === name) return node;
    throw new Error(`Ort nicht gefunden: ${name}`);
};
const idsOf = (names) =>
    names.map((name) => {
        if (name !== "@punkt") return idOf(name);
        // Ein Kartenpunkt ein Stück abseits von Gareth: der Gang querfeldein (Raster).
        const gareth = placeOf("Gareth");
        return `p:${(gareth.x + 18).toFixed(2)}:${(gareth.y + 14).toFixed(2)}`;
    });

const rows = [];
const say = (text) => process.stdout.write(`${text}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Die Eigenzeit je Funktion aus einem V8-Profil, die größten zuerst. */
function selfTimes(cpuProfile, top = 12) {
    const byId = new Map(cpuProfile.nodes.map((node) => [node.id, node]));
    const microseconds = new Map();
    cpuProfile.samples.forEach((id, index) => {
        microseconds.set(id, (microseconds.get(id) ?? 0) + (cpuProfile.timeDeltas[index] ?? 0));
    });
    const byFunction = new Map();
    for (const [id, us] of microseconds) {
        const { callFrame } = byId.get(id);
        const key = `${callFrame.functionName || "(anonym)"} ${callFrame.url.split("/").slice(-2).join("/")}:${callFrame.lineNumber + 1}`;
        byFunction.set(key, (byFunction.get(key) ?? 0) + us);
    }
    return [...byFunction.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([key, us]) => `${(us / 1000).toFixed(0).padStart(6)} ms  ${key}`);
}
const inspector = profile ? new Session() : null;
inspector?.connect();
if (inspector) await inspector.post("Profiler.enable");

async function timed(service, name, names, request, wantProfile = false) {
    const query = queryOf(request);
    if ("invalid" in query) throw new Error(query.invalid);
    const waypoints = idsOf(names);
    const doProfile = inspector && wantProfile;
    if (doProfile) await inspector.post("Profiler.start");
    const began = performance.now();
    const outcome = await service.route({ ...query, waypoints });
    const ms = performance.now() - began;
    if (doProfile) {
        const { profile: cpuProfile } = await inspector.post("Profiler.stop");
        say(`  Profil der ersten Route "${name}" (${ms.toFixed(0)} ms):`);
        for (const line of selfTimes(cpuProfile)) say(`    ${line}`);
    }
    const result = outcome.ok ? (outcome.response.found ? "gefunden" : "nicht gefunden") : outcome.error;
    return { ms, result, name };
}

for (const mode of modes) {
    for (const [name, names, request] of probes) {
        let service = newService();
        let line;
        try {
            if (mode === "start") {
                // Wie ein neuer Worker: Dienst neu, warm() zuerst. Die Zeit der ersten Route zählt ab dem Ende von warm().
                const began = performance.now();
                await service.warm(warmRequest);
                const warmMs = performance.now() - began;
                if (idleMs > 0) await sleep(idleMs);
                line = { mode, load_ms: Math.round(warmMs) };
            } else {
                await service.warm(warmRequest);
                // Ein erster Lauf des Profils, damit nur das Neuladen die Frage ist, nicht der Kaltstart: Das Profil ist
                // im alten Stand in Gebrauch, und der neue baut es vor dem Wechsel nach.
                if (usedBefore) await timed(service, name, names, request);
                const parts = {
                    map: ["map"],
                    terrain: ["terrain"],
                    all: ["map", "terrain", "climate", "pathProfiles", "territories"],
                }[mode];
                if (!parts) throw new Error(`Unbekannte Betriebsart: ${mode}`);
                forced = parts;
                tamperDem = mode === "terrain" || mode === "all";
                for (const part of parts) bumps[part] += 1;
                const began = performance.now();
                await service.refresh();
                const loadMs = performance.now() - began;
                line = { mode, load_ms: Math.round(loadMs), parts: reloads.at(-1)?.parts_ms };
                if (idleMs > 0) await sleep(idleMs);
                forced = [];
                tamperDem = false;
            }
            const runs = [];
            for (let run = 0; run <= repeat; run += 1) runs.push(await timed(service, name, names, request, run === 0));
            const [first, ...rest] = runs;
            line = {
                ...line,
                probe: name,
                result: first.result,
                first_ms: Math.round(first.ms),
                next_ms: rest.map((entry) => Math.round(entry.ms)),
                ratio: (first.ms / Math.max(1, rest.at(-1).ms)).toFixed(1),
            };
        } catch (error) {
            line = { ...line, mode, probe: name, error: String(error?.stack ?? error) };
        }
        rows.push(line);
        if (line.parts) say(`  parts_ms ${JSON.stringify(line.parts)}`);
        say(
            `${String(line.mode).padEnd(8)} ${String(line.probe).padEnd(42)} laden=${String(line.load_ms).padStart(5)} ms` +
                `  erste=${String(line.first_ms).padStart(5)} ms  danach=${JSON.stringify(line.next_ms)}  x${line.ratio}  ${line.result ?? line.error}`,
        );
        await service?.refresh?.().catch(() => undefined);
        globalThis.gc?.();
    }
}
if (out) writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
await database.end({ timeout: 5 });
process.exit(0);
