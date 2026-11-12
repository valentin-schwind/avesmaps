import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { AVENTURIA, AVENTURIA_TRAVEL_MODEL, travelHoursFromTime } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { loadRouteNetwork, type RouteNetwork } from "./network.ts";
import { buildRouteGraph, findRoute, type RouteGraph, type RouteRequest } from "./router.ts";
import { loadLand } from "./land.ts";
import { loadRivers } from "./rivers.ts";
import { loadWater } from "./water.ts";

/**
 * Vergleicht unsere Wegfindung mit Legacys eigenem Router (WI-0017, ROUTE-A).
 *
 * Aufruf: node --env-file-if-exists=../../.env src/routing/parity-cli.ts [--pairs 150] [--seed 7]
 *
 * Legacy rechnet über `scripts/dev/legacy-route-oracle/run.mjs` - seinen eigenen PHP-Code gegen den
 * Snapshot. Wir rechnen gegen die Datenbank, in die derselbe Snapshot importiert ist.
 *
 * 🔴 Maßstab sind die ETAPPEN (Betreibervorgabe 2026-09-23): Landabschnitte einzeln, aufeinander-
 * folgende Wasserabschnitte gleicher Art, gleichen Schiffs und gleicher Strömung zusammen - so baut
 * Legacys Reiseplan sie (route-plan.js, buildRoutePlanEntries). Gleiche Abschnittsfolge heißt gleiche
 * Etappen. Zeiten dürfen leicht abweichen.
 *
 * Paare kommen aus dem zusammenhängenden Netz des Profils; die Profile „abseits" starten an einem Ort
 * außerhalb davon und prüfen so Querfeldein-Brücken und Anker. Beide Seiten rechnen mit den Meer- und
 * Seeflächen (Legacys Orakel liest sie aus `ecosystem-areas.json`, wir aus `region_area`).
 *
 * Stunden zählen wie im Reiseplan der Karte, ohne den Querfeldein-Aufschlag: Legacys `cost_units` je
 * Abschnitt durch `cost_factor`. Legacys API-Feld `duration.travel_hours` rechnet ihn mit ein.
 */

const { values } = parseArgs({
    options: {
        pairs: { type: "string", default: "150" },
        seed: { type: "string", default: "7" },
        workers: { type: "string", default: "6" },
        out: { type: "string", default: "../../review/routing-parity" },
        snapshot: { type: "string", default: "C:/avesmaps3d-data/legacy-snapshots/map-features.json" },
    },
});

interface Profile {
    id: string;
    label: string;
    request: RouteRequest;
    via: boolean;
    /** Der Start liegt außerhalb des zusammenhängenden Netzes des Profils. */
    abseits?: boolean;
}

const all = { land: true, river: true, sea: true };
const PROFILES: Profile[] = [
    {
        id: "fuss-land",
        label: "zu Fuß, nur Land, schnellste",
        request: {
            optimize: "fastest",
            transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
            enabled: { land: true, river: false, sea: false },
            minimizeTransfers: false,
        },
        via: false,
    },
    {
        id: "fuss-alle",
        label: "zu Fuß mit Fluss und See, schnellste",
        request: {
            optimize: "fastest",
            transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
            enabled: all,
            minimizeTransfers: false,
        },
        via: false,
    },
    {
        id: "reiter-kuerzeste",
        label: "Einzelreiter, Lastkahn, Galeere, kürzeste",
        request: {
            optimize: "shortest",
            transports: { land: "lightRider", river: "riverBarge", sea: "galley" },
            enabled: all,
            minimizeTransfers: false,
        },
        via: false,
    },
    {
        id: "kutsche-land",
        label: "Kutsche, nur Land, schnellste",
        request: {
            optimize: "fastest",
            transports: { land: "horseCarriage", river: "riverSailer", sea: "cargoShip" },
            enabled: { land: true, river: false, sea: false },
            minimizeTransfers: false,
        },
        via: false,
    },
    {
        id: "fuss-alle-via",
        label: "zu Fuß mit Fluss und See, ein Zwischenziel",
        request: {
            optimize: "fastest",
            transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
            enabled: all,
            minimizeTransfers: false,
        },
        via: true,
    },
    {
        id: "fuss-land-abseits",
        label: "zu Fuß, nur Land, Start abseits des Netzes",
        request: {
            optimize: "fastest",
            transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
            enabled: { land: true, river: false, sea: false },
            minimizeTransfers: false,
        },
        via: false,
        abseits: true,
    },
    {
        id: "fuss-alle-abseits",
        label: "zu Fuß mit Fluss und See, Start abseits des Netzes",
        request: {
            optimize: "fastest",
            transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
            enabled: all,
            minimizeTransfers: false,
        },
        via: false,
        abseits: true,
    },
];

/** Ein kleiner, reproduzierbarer Zufall (mulberry32). */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Die sichtbaren Orte im größten zusammenhängenden Teil der gezeichneten Wege, und die übrigen. */
function placesByComponent(network: RouteNetwork, graph: RouteGraph): { main: string[]; off: string[] } {
    const seen = new Set<string>();
    let best: string[] = [];
    for (const start of graph.drawn.keys()) {
        if (seen.has(start)) continue;
        const component: string[] = [];
        const stack = [start];
        seen.add(start);
        while (stack.length > 0) {
            const node = stack.pop() as string;
            component.push(node);
            for (const edge of graph.drawn.get(node) ?? []) {
                if (!seen.has(edge.to)) {
                    seen.add(edge.to);
                    stack.push(edge.to);
                }
            }
        }
        if (component.length > best.length) best = component;
    }
    const inMain = new Set(best);
    const visible = [...network.nodes.values()].filter((node) => node.kind === "place" && !node.isHidden);
    return {
        main: visible.filter((node) => inMain.has(node.id)).map((node) => node.id),
        off: visible.filter((node) => !inMain.has(node.id)).map((node) => node.id),
    };
}

interface ComparableSegment {
    publicId: string;
    from: string;
    to: string;
    subtype: string;
    transport: string;
    flowState: string;
    distance: number;
    time: number;
    synthetic: boolean;
}

interface Stage {
    type: string;
    transport: string;
    start: string;
    end: string;
}

/**
 * Kreuzungen heißen in Legacy `Kreuzung-<Id>`, bei uns „Kreuzung"; ein Fußpunkt heißt `__wp_anchor_<n>`,
 * und die Karte beschriftet ihn als „Kreuzung". Für den Vergleich ist das alles dasselbe.
 */
const station = (name: string): string => (/^(Kreuzung(-\d+)?|__wp_anchor_\d+)$/.test(name) ? "Kreuzung" : name);

/** Legacys Etappenbildung, auf das Vergleichbare reduziert (route-plan.js, buildRoutePlanEntries). */
function stagesOf(segments: ComparableSegment[]): Stage[] {
    const stages: Stage[] = [];
    let water: (Stage & { flowState: string }) | null = null;
    for (const segment of segments) {
        const type = segment.synthetic ? "Querfeldein" : segment.subtype;
        const isWater = type === "Flussweg" || type === "Seeweg";
        if (isWater) {
            if (
                water &&
                (water.type !== type || water.transport !== segment.transport || water.flowState !== segment.flowState)
            ) {
                stages.push(water);
                water = null;
            }
            water ??= {
                type,
                transport: segment.transport,
                start: segment.from,
                end: segment.to,
                flowState: segment.flowState,
            };
            water.end = segment.to;
            continue;
        }
        if (water) {
            stages.push(water);
            water = null;
        }
        stages.push({ type, transport: segment.transport, start: segment.from, end: segment.to });
    }
    if (water) stages.push(water);
    return stages.map(({ type, transport, start, end }) => ({ type, transport, start, end }));
}

const stageKey = (stage: Stage): string => `${stage.type}|${stage.transport}|${stage.start}>${stage.end}`;

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const database = createDatabase(config.databaseUrl);
const model = AVENTURIA_TRAVEL_MODEL;
const network = await loadRouteNetwork(database, AVENTURIA.mapDomain);
const water = await loadWater(database, AVENTURIA.mapDomain);
// Wie im Dienst: Land und Flüsse gehören dazu - unter „schnellste“ biegt die Route benutzte
// Notverbindungen um Flüsse und Bäche (R7), genau wie Legacys Verfeinerung.
const terrain = {
    land: await loadLand(database, AVENTURIA.mapDomain),
    rivers: await loadRivers(database, AVENTURIA.mapDomain, AVENTURIA_TRAVEL_MODEL),
};
// Die Gegenprobe: dasselbe Netz, aber mit Legacys zwei Abweichungen. Wegenden hängen nach Listen-
// reihenfolge (die des Snapshots - Legacys Endpunkt sortiert wie sein Router nach sort_order, id), und
// versteckte Orte gelten als sichtbar: Legacys Versteckt-Riegel liest `is_hidden` aus den äußeren
// Eigenschaften, das Feld steht aber in `properties_json` - er greift nie (MCS-017, Nachtrag).
const snapshot = JSON.parse(readFileSync(values.snapshot, "utf8")) as {
    features: { id: string; geometry: { type: string }; properties?: { feature_type?: string } }[];
};
const legacyOrder = new Map<string, number>();
snapshot.features.forEach((feature, index) => {
    if (feature.geometry.type === "Point" && feature.properties?.feature_type !== "label") {
        legacyOrder.set(feature.id, index);
    }
});
const legacyOrderNetwork = await loadRouteNetwork(database, AVENTURIA.mapDomain, { legacyOrder });
for (const node of legacyOrderNetwork.nodes.values()) node.isHidden = false;
await database.end({ timeout: 5 });

const next = random(Number(values.seed));
const pairsPerProfile = Number(values.pairs);
const outDirectory = resolve(values.out);
mkdirSync(outDirectory, { recursive: true });

interface Case {
    profile: Profile;
    stations: string[];
}
const graphs = new Map<string, RouteGraph>();
const cases: Case[] = [];
for (const profile of PROFILES) {
    const graph = buildRouteGraph(network, model, profile.request, water);
    graphs.set(profile.id, graph);
    const { main, off } = placesByComponent(network, graph);
    for (let index = 0; index < pairsPerProfile; index += 1) {
        const pick = (from: string[] = main): string => from[Math.floor(next() * from.length)] as string;
        const stations = profile.via ? [pick(), pick(), pick()] : [pick(profile.abseits ? off : main), pick()];
        if (new Set(stations).size !== stations.length) continue;
        cases.push({ profile, stations });
    }
}

const nameOf = (id: string): string => network.nodes.get(id)?.name ?? id;
const legacyRequests = cases.map(({ profile, stations }) => ({
    from: nameOf(stations[0] as string),
    to: nameOf(stations[stations.length - 1] as string),
    via: stations.slice(1, -1).map(nameOf),
    optimize: profile.request.optimize,
    // Querfeldein reist wie in der Karte mit dem Landmittel (route-engine.js); ohne Angabe nähme
    // Legacys API zu Fuß.
    transports: { ...profile.request.transports, synthetic: profile.request.transports.land },
    enabled_transports: profile.request.enabled,
    minimize_transfers: profile.request.minimizeTransfers,
    include_geometry: false,
    debug: false,
}));
const requestsFile = join(outDirectory, "legacy-requests.json");
const resultsFile = join(outDirectory, "legacy-results.jsonl");
writeFileSync(requestsFile, JSON.stringify(legacyRequests));
const oracle = resolve(import.meta.dirname, "../../../../scripts/dev/legacy-route-oracle/run.mjs");
console.log(`${String(cases.length)} Fälle, Legacy rechnet ...`);
execFileSync(
    process.execPath,
    [oracle, "--requests", requestsFile, "--out", resultsFile, "--workers", values.workers],
    {
        stdio: "inherit",
    },
);
const legacyResults = readFileSync(resultsFile, "utf8")
    .trim()
    .split("\n")
    .map(
        (line) =>
            JSON.parse(line) as {
                ms: number;
                error?: { message: string };
                route?: {
                    found: boolean;
                    distance_units: number;
                    duration?: { travel_hours: number };
                    segments?: {
                        public_id: string;
                        from_node: string;
                        to_node: string;
                        subtype: string;
                        transport_type: string;
                        flow_state: string;
                        distance_units: number;
                        cost_units: number;
                        cost_factor?: number;
                        synthetic: boolean;
                    }[];
                };
            },
    );

interface Row {
    profile: string;
    stations: string[];
    legacyFound: boolean;
    ourFound: boolean;
    sameSegments: boolean;
    sameStages: boolean;
    legacyStages: number;
    ourStages: number;
    legacyHours: number;
    ourHours: number;
    legacyDistance: number;
    ourDistance: number;
    legacySynthetic: boolean;
    ourSynthetic: boolean;
    /** Legacys `duration.travel_hours`, MIT Querfeldein-Aufschlag - nur zum Nachlesen. */
    legacyApiHours: number;
    legacyMs: number;
    ourMs: number;
    firstStageDifference: string | null;
}
function compareVariant(variantNetwork: RouteNetwork, variantGraphs: Map<string, RouteGraph>): Row[] {
    const rows: Row[] = [];
    cases.forEach(({ profile, stations }, index) => {
        const legacy = legacyResults[index];
        const graph = variantGraphs.get(profile.id) as RouteGraph;
        const started = performance.now();
        const ours = findRoute(variantNetwork, graph, stations, terrain);
        const ourMs = performance.now() - started;

        const legacySegments: ComparableSegment[] = (legacy?.route?.segments ?? []).map((segment) => ({
            publicId: segment.public_id,
            from: station(segment.from_node),
            to: station(segment.to_node),
            subtype: segment.subtype,
            transport: segment.transport_type,
            flowState: segment.flow_state,
            distance: segment.distance_units,
            time: segment.cost_units / (segment.cost_factor ?? 1),
            synthetic: segment.synthetic,
        }));
        const ourSegments: ComparableSegment[] = ours.segments.map((segment) => ({
            publicId: segment.public_id,
            from: station(segment.from_node),
            to: station(segment.to_node),
            subtype: segment.subtype,
            transport: segment.transport_type,
            flowState: segment.flow_state,
            distance: segment.distance_units,
            time: segment.cost_units / segment.cost_factor,
            synthetic: segment.synthetic,
        }));
        const segmentKey = (segment: ComparableSegment): string => `${segment.publicId}:${segment.from}>${segment.to}`;
        const legacyStages = stagesOf(legacySegments);
        const ourStages = stagesOf(ourSegments);
        let firstStageDifference: string | null = null;
        for (let stage = 0; stage < Math.max(legacyStages.length, ourStages.length); stage += 1) {
            const left = legacyStages[stage];
            const right = ourStages[stage];
            if (!left || !right || stageKey(left) !== stageKey(right)) {
                firstStageDifference = `Etappe ${String(stage + 1)}: Legacy ${left ? stageKey(left) : "-"} | wir ${right ? stageKey(right) : "-"}`;
                break;
            }
        }
        rows.push({
            profile: profile.id,
            stations: stations.map(nameOf),
            legacyFound: legacy?.route?.found === true,
            ourFound: ours.found,
            sameSegments: legacySegments.map(segmentKey).join(",") === ourSegments.map(segmentKey).join(","),
            sameStages: firstStageDifference === null,
            legacyStages: legacyStages.length,
            ourStages: ourStages.length,
            legacyHours: legacySegments.reduce((sum, segment) => sum + travelHoursFromTime(model, segment.time), 0),
            ourHours: ours.travelHours,
            legacyDistance: legacy?.route?.distance_units ?? 0,
            ourDistance: ours.distanceUnits,
            legacySynthetic: legacySegments.some((segment) => segment.synthetic),
            ourSynthetic: ourSegments.some((segment) => segment.synthetic),
            legacyApiHours: legacy?.route?.duration?.travel_hours ?? 0,
            legacyMs: legacy?.ms ?? 0,
            ourMs,
            firstStageDifference,
        });
    });
    return rows;
}

const legacyOrderGraphs = new Map(
    PROFILES.map((profile) => [profile.id, buildRouteGraph(legacyOrderNetwork, model, profile.request, water)]),
);
const rows = compareVariant(network, graphs);
const proofRows = compareVariant(legacyOrderNetwork, legacyOrderGraphs);

const share = (count: number, total: number): string =>
    total === 0 ? "-" : `${String(count)} von ${String(total)} (${((100 * count) / total).toFixed(1)} %)`;
const median = (list: number[]): number => {
    const sorted = [...list].sort((a, b) => a - b);
    return sorted.length === 0 ? 0 : (sorted[Math.floor(sorted.length / 2)] as number);
};
function table(variantRows: Row[]): string[] {
    const tableLines = [
        "| Profil | Fälle | beide gefunden | gleiche Abschnitte | **gleiche Etappen** | Stunden-Abweichung (Median) | Querfeldein Legacy / wir |",
        "|---|---|---|---|---|---|---|",
    ];
    for (const profile of PROFILES) {
        tableLines.push(profileRow(variantRows, profile));
    }
    return tableLines;
}
const lines: string[] = [
    "# Routing-Parität: Avesmaps3D gegen Legacys eigenen Router",
    "",
    `Snapshot 140088, Legacy avesmaps@bfec670, ${String(rows.length)} Fälle, Seed ${values.seed}. Erzeugt von \`src/routing/parity-cli.ts\`.`,
    "",
    "## Unsere Regel: ein Wegende hängt am nächsten Knoten",
    "",
    ...table(rows),
    "",
    "## Gegenprobe: Wegenden nach Legacys Listenreihenfolge",
    "",
    "Nur zum Nachweis, nicht als Regel: Mit Legacys Reihenfolge bleibt übrig, was nicht an der Anbindungsregel liegt.",
    "",
    ...table(proofRows),
];
function profileRow(variantRows: Row[], profile: Profile): string {
    const own = variantRows.filter((row) => row.profile === profile.id);
    const both = own.filter((row) => row.legacyFound && row.ourFound);
    const hourDelta = both.map((row) => Math.abs(row.ourHours - row.legacyHours) / Math.max(row.legacyHours, 1e-9));
    return `| ${profile.label} | ${String(own.length)} | ${share(both.length, own.length)} | ${share(
        both.filter((row) => row.sameSegments).length,
        both.length,
    )} | **${share(both.filter((row) => row.sameStages).length, both.length)}** | ${(100 * median(hourDelta)).toFixed(
        2,
    )} % | ${String(own.filter((row) => row.legacySynthetic).length)} / ${String(own.filter((row) => row.ourSynthetic).length)} |`;
}
const differing = proofRows.filter((row) => row.legacyFound && row.ourFound && !row.sameStages);
lines.push(
    "",
    `Rechenzeit je Route (Median): Legacy ${median(rows.map((row) => row.legacyMs)).toFixed(0)} ms, wir ${median(
        rows.map((row) => row.ourMs),
    ).toFixed(1)} ms (Graph einmal je Profil gebaut).`,
    "",
    "## Was nach der Gegenprobe noch abweicht (Auszug)",
    "",
    "Beide biegen unter „schnellste“ die benutzten Querfeldein-Sehnen und rechnen die Route neu (`synthetic-refine.php`, WI-0017 R7). Bewusster Unterschied (Entscheidung h): Legacy sucht auch über eine trockene Sehne und bekommt ohne Gelände eine längere Treppe; wir lassen sie gerade und messen sie nur.",
    "",
    ...differing
        .slice(0, 25)
        .map(
            (row) =>
                `- **${row.profile}** ${row.stations.join(" → ")}: ${row.firstStageDifference ?? ""} (Stunden Legacy ${row.legacyHours.toFixed(1)}, wir ${row.ourHours.toFixed(1)})`,
        ),
    "",
    "## Nur eine Seite findet eine Route",
    "",
    ...rows
        .filter((row) => row.legacyFound !== row.ourFound)
        .slice(0, 25)
        .map(
            (row) =>
                `- **${row.profile}** ${row.stations.join(" → ")}: Legacy ${String(row.legacyFound)}, wir ${String(row.ourFound)}`,
        ),
);
writeFileSync(join(outDirectory, "parity.md"), lines.join("\n") + "\n");
writeFileSync(join(outDirectory, "parity.json"), JSON.stringify(rows, null, 1));
console.log(lines.slice(0, 12).join("\n"));
console.log(`\nBericht: ${join(outDirectory, "parity.md")}`);
