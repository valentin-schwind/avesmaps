import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { AVENTURIA, AVENTURIA_TRAVEL_MODEL, DESIGN_CANON, travelHoursFromTime, travelSpeed } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { coastDistance, coastProfile, smoothSeaLine } from "./sea-coast.ts";
import { writeGraphView } from "./sea-graph-view.ts";
import { buildSeaGrid, LANDING_REACH, loadNavigableWater, nearestWaterCell, type Landing } from "./sea-grid.ts";
import { loadSeaports } from "./sea-ports.ts";
import { clearOverWater, SeaSearch } from "./sea-search.ts";
import { loadCoastRings, VisibilityGraph } from "./sea-visibility.ts";

/**
 * Zeichnet den Sichtbarkeitsgraphen mit A*-Brücken als Seite (WI-0046), mit Ecken in zwei Abständen zur
 * Küste und Beispielreisen je Schiffstyp nach seinem bevorzugten Küstenabstand (S7), geglättet mit
 * Catmull-Rom. Nur lesen und rechnen, keine Kartendaten.
 *
 * Aufruf: npm run view:sea-graph --workspace @avesmaps3d/server
 */

const { values } = parseArgs({
    options: {
        "min-area": { type: "string", default: "10" },
        inset: { type: "string", default: "0.25" },
        tolerance: { type: "string", default: "0.15" },
        offsets: { type: "string", default: "0.35,1.25" },
        reach: { type: "string", default: "16" },
        out: { type: "string", default: "../../review/sea-bench" },
    },
});

/** Lange Reisen, Überfahrten nach Maraskan und die engen Stellen, an denen der Graph ohne Brücken scheiterte. */
const EXAMPLES: [string, string][] = [
    ["Thorwal", "Al'Anfa"],
    ["Festum", "Khunchom"],
    ["Perricum", "Boran"],
    ["Khunchom", "Tuzak"],
    ["Havena", "Kuslik"],
    ["Riva", "Brabak"],
    ["Neersand", "Hôt-Alem"],
    ["Aldevik", "Isenholm"],
    ["Lodinsand", "Serrevik"],
    ["Kord", "Haibuthar"],
];
/** Die Schiffe der Beispiele, mit einer Farbe des Kanons je Schiff. */
const SHIPS = [
    { key: "galley", label: "Galeere", colour: DESIGN_CANON.colour["danger"] as string },
    { key: "cargoShip", label: "Handelsschiff", colour: DESIGN_CANON.colour["route"] as string },
    { key: "fastShip", label: "Schnellsegler", colour: DESIGN_CANON.colour["accentStrong"] as string },
] as const;

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const database = createDatabase(config.databaseUrl);
const domain = AVENTURIA.mapDomain;
const water = await loadNavigableWater(database, domain);
const ports = await loadSeaports(database, domain);
const rings = await loadCoastRings(database, domain, Number(values.inset), Number(values.tolerance));
const shapes = await database<{ region_type: string; svg: string }[]>`
    SELECT r.region_type, ST_AsSVG(ST_SimplifyPreserveTopology(a.geom, 0.1), 0, 2) AS svg
    FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
    WHERE a.map_domain_id = ${domain} AND a.is_active AND r.region_type IN ('meer', 'see', 'kontinent', 'insel')
    ORDER BY CASE r.region_type WHEN 'kontinent' THEN 0 WHEN 'insel' THEN 1 WHEN 'meer' THEN 2 ELSE 3 END, a.public_id
`;
await database.end({ timeout: 5 });

const grid = buildSeaGrid(water);
const search = new SeaSearch(grid);
let clock = performance.now();
const graph = new VisibilityGraph(grid, rings, {
    offsets: values.offsets.split(",").map(Number),
    bridge: { search, reach: Number(values.reach) },
});
const graphMs = performance.now() - clock;
clock = performance.now();
const field = coastDistance(grid);
const fieldMs = performance.now() - clock;
const profiles = SHIPS.map((ship) => coastProfile(AVENTURIA_TRAVEL_MODEL, ship.key));
const weighMs = graph.weigh(profiles, field);
const landingOf = new Map<string, Landing>();
const nodeOf = new Map<string, number>();
clock = performance.now();
for (const port of ports) {
    const landing = nearestWaterCell(grid, port.x, port.y, LANDING_REACH, Number(values["min-area"]));
    if (!landing) continue;
    landingOf.set(port.name, landing);
    nodeOf.set(port.name, graph.attach(landing.x, landing.y));
}
const attachMs = performance.now() - clock;
const byName = new Map(ports.map((port) => [port.name, port]));

/** Wie weit die Linie höchstens von der Küste abrückt, zwischen den beiden Anlegestellen. */
function maxCoast(points: readonly [number, number][]): number {
    let most = 0;
    const sea = points.slice(1, -1);
    for (let index = 1; index < sea.length; index += 1) {
        const [ax, ay] = sea[index - 1] as [number, number];
        const [bx, by] = sea[index] as [number, number];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / grid.cell));
        for (let step = 0; step <= steps; step += 1) {
            const column = Math.floor((ax + ((bx - ax) * step) / steps - grid.minX) / grid.cell);
            const row = Math.floor((ay + ((by - ay) * step) / steps - grid.minY) / grid.cell);
            if (column < 0 || row < 0 || column >= grid.cols || row >= grid.rows) continue;
            most = Math.max(most, field[row * grid.cols + column] as number);
        }
    }
    return most;
}

let fallbacks = 0;
const examples = EXAMPLES.flatMap(([a, b]) => {
    const from = byName.get(a);
    const to = byName.get(b);
    const la = landingOf.get(a);
    const lb = landingOf.get(b);
    if (!from || !to || !la || !lb) {
        console.log(`Beispiel übersprungen: ${a} → ${b}`);
        return [];
    }
    const astar = search.find(la.cell, lb.cell);
    const routes = SHIPS.flatMap((ship, profile) => {
        const route = graph.route(nodeOf.get(a) as number, nodeOf.get(b) as number, profile);
        if (!route) return [];
        const raw: [number, number][] = [[from.x, from.y], ...route.points, [to.x, to.y]];
        const smooth = smoothSeaLine((ax, ay, bx, by) => clearOverWater(grid, ax, ay, bx, by), raw);
        fallbacks += smooth.fallbacks;
        const units = route.distance + Math.hypot(la.x - from.x, la.y - from.y) + Math.hypot(to.x - lb.x, to.y - lb.y);
        const speed = travelSpeed(AVENTURIA_TRAVEL_MODEL, ship.key, "Seeweg") as number;
        return [
            {
                label: ship.label,
                colour: ship.colour,
                points: smooth.points,
                units,
                hours: travelHoursFromTime(AVENTURIA_TRAVEL_MODEL, units / speed),
                maxCoast: maxCoast(raw),
            },
        ];
    });
    return [
        {
            label: `${a} → ${b}`,
            astar: astar
                ? [[from.x, from.y] as [number, number], ...astar.points, [to.x, to.y] as [number, number]]
                : [],
            routes,
        },
    ];
});

const outDirectory = resolve(values.out);
mkdirSync(outDirectory, { recursive: true });
const file = join(outDirectory, "graph.html");
const stats = `Satz map154313: ${String(graph.stats.corners)} Küstenecken in zwei Ringen (${values.offsets} E vor der Küste), ${String(graph.stats.edges)} Sichtkanten, ${String(graph.bridgeCount)} A*-Brücken, ${String(landingOf.size)} Häfen. Gebaut in ${(graphMs / 1000).toFixed(1)} s, Küstenabstand ${(fieldMs / 1000).toFixed(1)} s, Gewichte für drei Schiffe ${(weighMs / 1000).toFixed(1)} s, Häfen ${(attachMs / 1000).toFixed(1)} s; ${String(graph.edgeCount)} Kanten, ${(graph.bytes / 1e6).toFixed(1)} MB. Geglättet: ${String(fallbacks)} Stücke blieben gerade, weil die Kurve dort Land gestreift hätte.`;
writeGraphView(file, { shapes, nodes: graph.nodes(), edges: graph.displayEdges(), examples, stats });
console.log(stats);
console.log(
    examples
        .map(
            (example) =>
                `${example.label}: ${example.routes.map((route) => `${route.label} ${route.units.toFixed(0)} E ${route.hours.toFixed(0)} h max ${route.maxCoast.toFixed(1)} E`).join(" | ")}`,
        )
        .join("\n"),
);
console.log(`Ansicht: ${file}`);
