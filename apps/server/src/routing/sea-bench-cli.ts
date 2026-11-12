import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { AVENTURIA } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import {
    buildSeaGrid,
    LANDING_REACH,
    loadNavigableWater,
    nearestWaterCell,
    SEA_CELL_UNITS,
    seaGridBytes,
    waterNeighbours,
    type Landing,
} from "./sea-grid.ts";
import { JumpPointSearch } from "./sea-jps.ts";
import { deriveNetwork } from "./sea-parity-derived.ts";
import { count, fixed, pct, quantile, random } from "./sea-parity-tools.ts";
import { loadSeaports, type SeaPort } from "./sea-ports.ts";
import { SeaSearch } from "./sea-search.ts";
import { loadCoastRings, VisibilityGraph } from "./sea-visibility.ts";

/**
 * Benchmark der Verfahren für das freie Seerouting (WI-0046, Betreiber 2026-09-27: „mach ne benchmark
 * matrix mit allen zeiten vor und nachteilen“). Nur lesen und rechnen, keine Kartendaten.
 *
 * Aufruf: node --env-file-if-exists=../../.env src/routing/sea-bench-cli.ts [--long 100 --seed 7]
 *
 * Alle Verfahren fahren dieselben Reisen zwischen denselben Anlegestellen (H1 mit Mindestgröße, S2 A):
 * kurze Reisen zu den zwei nächsten Häfen, lange Reisen zufällig. Verglichen werden Rechenzeit je Reise,
 * Länge gegen den kürzesten der gefundenen Wege, Vorberechnung, Speicher und was ein neuer Hafen kostet.
 */

const { values } = parseArgs({
    options: {
        cell: { type: "string", default: String(SEA_CELL_UNITS) },
        "min-area": { type: "string", default: "10" },
        inset: { type: "string", default: "0.25" },
        tolerance: { type: "string", default: "0.15" },
        offset: { type: "string", default: "0.35" },
        reach: { type: "string", default: "16" },
        long: { type: "string", default: "100" },
        seed: { type: "string", default: "7" },
        out: { type: "string", default: "../../review/sea-bench" },
    },
});

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const database = createDatabase(config.databaseUrl);
const domain = AVENTURIA.mapDomain;
const water = await loadNavigableWater(database, domain);
const ports = await loadSeaports(database, domain);
let clock = performance.now();
const rings = await loadCoastRings(database, domain, Number(values.inset), Number(values.tolerance));
const ringsMs = performance.now() - clock;
await database.end({ timeout: 5 });

clock = performance.now();
const grid = buildSeaGrid(water, Number(values.cell));
const gridMs = performance.now() - clock;

// --- Anlegestellen und Reisen ------------------------------------------------------------------------
const landingOf = new Map<string, Landing>();
for (const port of ports) {
    const landing = nearestWaterCell(grid, port.x, port.y, LANDING_REACH, Number(values["min-area"]));
    if (landing) landingOf.set(port.id, landing);
}
const reachable = ports.filter((port) => landingOf.has(port.id));
const partOf = (port: SeaPort): number => (landingOf.get(port.id) as Landing).part;

interface Trip {
    kind: "kurz" | "lang";
    a: SeaPort;
    b: SeaPort;
}
const trips: Trip[] = [];
const seen = new Set<string>();
const addTrip = (kind: Trip["kind"], a: SeaPort, b: SeaPort): void => {
    const key = [a.id, b.id].sort().join("|");
    if (a.id === b.id || partOf(a) !== partOf(b) || seen.has(key)) return;
    seen.add(key);
    trips.push({ kind, a, b });
};
for (const port of reachable) {
    const nearest = reachable
        .filter((other) => other.id !== port.id && partOf(other) === partOf(port))
        .sort((x, y) => Math.hypot(x.x - port.x, x.y - port.y) - Math.hypot(y.x - port.x, y.y - port.y))
        .slice(0, 2);
    for (const other of nearest) addTrip("kurz", port, other);
}
const byName = new Map(reachable.map((port) => [port.name, port]));
for (const [a, b] of [
    ["Havena", "Kuslik"],
    ["Thorwal", "Al'Anfa"],
    ["Festum", "Khunchom"],
    ["Riva", "Brabak"],
    ["Prem", "Sylla"],
    ["Perricum", "Mengbilla"],
    ["Olport", "Charypso"],
    ["Neersand", "Hôt-Alem"],
] as const) {
    const from = byName.get(a);
    const to = byName.get(b);
    if (from && to) addTrip("lang", from, to);
}
const next = random(Number(values.seed));
const longWanted = trips.length + Number(values.long);
for (let attempt = 0; trips.length < longWanted && attempt < 20_000; attempt += 1) {
    const a = reachable[Math.floor(next() * reachable.length)] as SeaPort;
    const b = reachable[Math.floor(next() * reachable.length)] as SeaPort;
    if (Math.hypot(a.x - b.x, a.y - b.y) >= 30) addTrip("lang", a, b);
}
console.log(
    `${String(trips.length)} Reisen: ${String(count(trips, (trip) => trip.kind === "kurz"))} kurz, ${String(count(trips, (trip) => trip.kind === "lang"))} lang`,
);

/** Das Stück vom Hafen zur Anlegestelle an beiden Enden, gehört zur Seeetappe. */
const portLegs = (trip: Trip): number => {
    const la = landingOf.get(trip.a.id) as Landing;
    const lb = landingOf.get(trip.b.id) as Landing;
    return Math.hypot(la.x - trip.a.x, la.y - trip.a.y) + Math.hypot(trip.b.x - lb.x, trip.b.y - lb.y);
};

interface Result {
    distance: number | null;
    ms: number;
}
const results = new Map<string, Result[]>();

// --- A* je Anfrage -------------------------------------------------------------------------------------
const search = new SeaSearch(grid);
results.set(
    "astar",
    trips.map((trip) => {
        const start = performance.now();
        const route = search.find(
            (landingOf.get(trip.a.id) as Landing).cell,
            (landingOf.get(trip.b.id) as Landing).cell,
        );
        return { distance: route ? route.distance + portLegs(trip) : null, ms: performance.now() - start };
    }),
);
console.log("A* fertig");

// --- JPS je Anfrage ------------------------------------------------------------------------------------
const jps = new JumpPointSearch(grid);
results.set(
    "jps",
    trips.map((trip) => {
        const start = performance.now();
        const route = jps.find((landingOf.get(trip.a.id) as Landing).cell, (landingOf.get(trip.b.id) as Landing).cell);
        return { distance: route ? route.distance + portLegs(trip) : null, ms: performance.now() - start };
    }),
);
console.log("JPS fertig");

// --- Hafennetz Ring 3, vorberechnet --------------------------------------------------------------------
clock = performance.now();
const landingCells = [...new Set([...landingOf.values()].map((landing) => landing.cell))];
const neighbours = waterNeighbours(grid, landingCells);
const neighbourMs = performance.now() - clock;
const astar = results.get("astar") as Result[];
const measured = trips.flatMap((trip, index) => {
    const reference = (astar[index] as Result).distance;
    if (reference === null) return [];
    return [
        {
            index,
            voyage: {
                from: { x: trip.a.x, y: trip.a.y, landing: landingOf.get(trip.a.id) as Landing },
                to: { x: trip.b.x, y: trip.b.y, landing: landingOf.get(trip.b.id) as Landing },
                distance: reference,
            },
        },
    ];
});
const ring = deriveNetwork(
    search,
    landingCells,
    neighbours,
    measured.map((entry) => entry.voyage),
    3,
);
const ringResults: Result[] = trips.map(() => ({ distance: null, ms: 0 }));
measured.forEach((entry, position) => {
    const ratio = ring.ratios[position] as number;
    ringResults[entry.index] = {
        distance: Number.isFinite(ratio) ? ratio * entry.voyage.distance : null,
        ms: ring.times[position] as number,
    };
});
results.set("ring", ringResults);
// Was ein neuer Hafen kostet: die freien Wege zu allen Anlegestellen in drei Schritten Nachbarschaft.
const adjacent = new Map<number, Set<number>>();
for (const [a, b] of neighbours) {
    adjacent.set(a, (adjacent.get(a) ?? new Set<number>()).add(b));
    adjacent.set(b, (adjacent.get(b) ?? new Set<number>()).add(a));
}
const ringAttach: number[] = [];
for (let sample = 0; sample < Math.min(30, landingCells.length); sample += 1) {
    const origin = Math.floor((sample * landingCells.length) / 30);
    const start = performance.now();
    let frontier = new Set([origin]);
    const reached = new Set([origin]);
    for (let step = 0; step < 3; step += 1) {
        const following = new Set<number>();
        for (const node of frontier) {
            for (const other of adjacent.get(node) ?? []) {
                if (reached.has(other)) continue;
                reached.add(other);
                following.add(other);
                search.find(landingCells[origin] as number, landingCells[other] as number);
            }
        }
        frontier = following;
    }
    ringAttach.push(performance.now() - start);
}
console.log("Hafennetz fertig");

// --- Sichtbarkeitsgraph, vorberechnet ------------------------------------------------------------------
const graph = new VisibilityGraph(grid, rings, {
    offset: Number(values.offset),
    bridge: { search, reach: Number(values.reach) },
});
const nodeOf = new Map<string, number>();
const attachTimes: number[] = [];
for (const port of reachable) {
    const landing = landingOf.get(port.id) as Landing;
    const start = performance.now();
    nodeOf.set(port.id, graph.attach(landing.x, landing.y));
    attachTimes.push(performance.now() - start);
}
const attachMs = attachTimes.reduce((sum, value) => sum + value, 0);
results.set(
    "sicht",
    trips.map((trip) => {
        const start = performance.now();
        const route = graph.route(nodeOf.get(trip.a.id) as number, nodeOf.get(trip.b.id) as number);
        return { distance: route ? route.distance + portLegs(trip) : null, ms: performance.now() - start };
    }),
);
console.log("Sichtbarkeitsgraph fertig");

// --- Matrix ----------------------------------------------------------------------------------------------
const reference = trips.map((_, index) => {
    const found = [...results.values()]
        .map((list) => (list[index] as Result).distance)
        .filter((distance): distance is number => distance !== null);
    return found.length === 0 ? null : Math.min(...found);
});

interface Row {
    key: string;
    label: string;
    precompute: string;
    memory: string;
    load: string;
    newPort: string;
    coast: string;
}
const rows: Row[] = [
    {
        key: "astar",
        label: "A* je Anfrage",
        precompute: "keine",
        memory: `${fixed((seaGridBytes(grid) + search.bytes) / 1e6, 0)} MB (Raster ${fixed(seaGridBytes(grid) / 1e6, 0)}, Suche ${fixed(search.bytes / 1e6, 0)})`,
        load: `Raster ${fixed(gridMs, 0)} ms`,
        newPort: "sofort",
        coast: "sofort (Raster beim Laden)",
    },
    {
        key: "jps",
        label: "Jump Point Search je Anfrage",
        precompute: "keine",
        memory: `${fixed(seaGridBytes(grid) / 1e6, 0)} MB (nur Raster)`,
        load: `Raster ${fixed(gridMs, 0)} ms`,
        newPort: "sofort",
        coast: "sofort (Raster beim Laden)",
    },
    {
        key: "ring",
        label: "Hafennetz Ring 3, vorberechnet",
        precompute: `${fixed((ring.ms + neighbourMs + gridMs) / 1000, 1)} s (${String(ring.pairs)} Wege)`,
        memory: `${fixed((ring.points * 16 + ring.pairs * 16) / 1e6, 1)} MB`,
        load: "fertige Tabelle lesen (ms, geschätzt)",
        newPort: `nachrechnen: p50 ${fixed(quantile(ringAttach, 0.5), 0)} ms, max ${fixed(quantile(ringAttach, 1), 0)} ms`,
        coast: "alles neu ableiten",
    },
    {
        key: "sicht",
        label: "Sichtbarkeitsgraph mit A*-Brücken, vorberechnet",
        precompute: `${fixed((ringsMs + gridMs + graph.stats.ms + attachMs) / 1000, 1)} s (Küste ${fixed(ringsMs / 1000, 1)} s, Ecken und Sichtlinien ${fixed(graph.stats.ms / 1000, 1)} s, Häfen ${fixed(attachMs / 1000, 1)} s)`,
        memory: `${fixed(graph.bytes / 1e6, 1)} MB (${String(graph.nodeCount)} Knoten, ${String(graph.edgeCount)} Kanten, davon ${String(graph.bridgeCount)} Brücken)`,
        load: "fertige Tabelle lesen (ms, geschätzt)",
        newPort: `anhängen: p50 ${fixed(quantile(attachTimes, 0.5), 0)} ms, max ${fixed(quantile(attachTimes, 1), 0)} ms`,
        coast: "alles neu ableiten",
    },
];

const lines = [
    "# Freies Seerouting: Benchmark der Verfahren (WI-0046)",
    "",
    `Satz in \`${config.databaseUrl.replace(/^.*\//, "")}\`, Zelle ${String(grid.cell)} E, Anlegestelle nach H1 mit Mindestgröße ${values["min-area"]} E² (${String(reachable.length)} von ${String(ports.length)} Häfen), Sichtbarkeitsgraph mit Einrückung ${values.inset} E, Vereinfachung ${values.tolerance} E, Ecken ${values.offset} E vor der Küste und A*-Brücken bis ${values.reach} E. ${String(trips.length)} Reisen: ${String(count(trips, (trip) => trip.kind === "kurz"))} kurze (je Hafen die zwei nächsten), ${String(count(trips, (trip) => trip.kind === "lang"))} lange (8 benannte, der Rest zufällig, Seed ${values.seed}). Gemessen auf dem Entwicklungsrechner, ein Thread; der VPS ist 1,2- bis 2-mal langsamer (Claudio 2026-09-27).`,
    "",
    "| Verfahren | gefunden | kurz p50 / p95 / max | lang p50 / p95 / max | Länge gegen den kürzesten: Median / P90 / max | Vorberechnung | Speicher im Worker | Laden im Worker | neuer Hafen | Küste geändert |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((row) => {
        const list = results.get(row.key) as Result[];
        const times = (kind: Trip["kind"]): number[] =>
            list
                .filter((_, index) => (trips[index] as Trip).kind === kind && (list[index] as Result).distance !== null)
                .map((result) => result.ms);
        const excess = list.flatMap((result, index) => {
            const best = reference[index];
            return result.distance === null || best === null || best === undefined ? [] : [result.distance / best - 1];
        });
        const found = count(list, (result) => result.distance !== null);
        const ms = (values_: number[]): string =>
            `${fixed(quantile(values_, 0.5), 1)} / ${fixed(quantile(values_, 0.95), 1)} / ${fixed(quantile(values_, 1), 1)} ms`;
        return `| ${row.label} | ${String(found)} von ${String(trips.length)} | ${ms(times("kurz"))} | ${ms(times("lang"))} | ${pct(quantile(excess, 0.5))} / ${pct(quantile(excess, 0.9))} / ${pct(quantile(excess, 1))} | ${row.precompute} | ${row.memory} | ${row.load} | ${row.newPort} | ${row.coast} |`;
    }),
    "",
    `Sichtbarkeitsgraph: ${String(graph.stats.corners)} Küstenecken, ${String(graph.stats.pairs)} Paare im selben Wasserteil, davon ${String(graph.stats.tangent)} an beiden Enden tangential und auf Sicht geprüft, ${String(graph.stats.edges)} Sichtkanten und ${String(graph.stats.bridges)} Brücken zwischen Ecken; mit den Häfen ${String(graph.edgeCount)} Kanten.`,
    "",
    "Nicht gefunden (Reise, Verfahren):",
    "",
    ...trips.flatMap((trip, index) => {
        const missing = [...results.entries()]
            .filter(([, list]) => (list[index] as Result).distance === null)
            .map(([key]) => key);
        return missing.length === 0 ? [] : [`- ${trip.a.name} → ${trip.b.name} (${trip.kind}): ${missing.join(", ")}`];
    }),
];
const outDirectory = resolve(values.out);
mkdirSync(outDirectory, { recursive: true });
writeFileSync(join(outDirectory, "sea-bench.md"), lines.join("\n") + "\n");
writeFileSync(
    join(outDirectory, "sea-bench.json"),
    JSON.stringify(
        {
            options: values,
            trips: trips.map((trip, index) => ({
                kind: trip.kind,
                from: trip.a.name,
                to: trip.b.name,
                reference: reference[index],
                ...Object.fromEntries([...results.entries()].map(([key, list]) => [key, list[index]])),
            })),
            visibility: { ...graph.stats, nodes: graph.nodeCount, edges: graph.edgeCount, attachMs, ringsMs },
            ring: { pairs: ring.pairs, points: ring.points, ms: ring.ms, neighbourMs, attach: ringAttach },
            gridMs,
        },
        null,
        1,
    ),
);
console.log(lines.join("\n"));
