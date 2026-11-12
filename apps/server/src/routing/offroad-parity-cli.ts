import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { AVENTURIA, AVENTURIA_TRAVEL_MODEL, mapPointId, travelHoursFromTime } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { pointIsOnLand } from "./land.ts";
import { chordIsDry } from "./map-points.ts";
import type { RouteNode } from "./network.ts";
import { buildRouteGraph, findRoute, type RouteGraph, type RouteRequest } from "./router.ts";
import { databaseRoutingSource } from "./service.ts";

/**
 * Vergleicht den Gang zu einem Kartenpunkt mit Legacys eigenem Router (WI-0030 R7): Ort → Kartenpunkt,
 * Legacy über `scripts/dev/legacy-route-oracle/run.mjs` mit `to_point`, wir gegen die Datenbank.
 *
 * Aufruf: npm run compare:offroad --workspace @avesmaps3d/server [-- --points 80 --seed 11]
 * [--database <orakel.sqlite>] - das Orakel muss aus demselben Kartensatz gebaut sein wie die Datenbank.
 *
 * Die Kartenpunkte sind zur Hälfte zufällig an Land verteilt, zur Hälfte nahe an Flüssen und Bächen -
 * dort biegt der Gang. Die Reise beginnt an einem der fünf nächsten Orte des Hauptnetzes: So misst der
 * Vergleich den Gang und nicht die bekannten Unterschiede langer Reisen (WI-0017). Verglichen wird, ob
 * beide ankommen oder gleich absagen, wo der Gang das Netz verlässt, seine Länge und Zeit, und die
 * Etappen der Reise - Stücke desselben Weges zusammengefasst, denn Legacy teilt den Weg an jedem
 * Kandidaten, wir nur am benutzten.
 *
 * 🔴 Erwartete Abweichung (Entscheidung h): Ist die Sehne trocken, gehen wir sie in beiden Modi.
 * Legacy sucht unter „Schnellste“ trotzdem und liefert ohne Gelände eine Treppe, die länger ist als
 * die Sehne. Der Ausstieg ist davon nicht berührt: Trocken heißt in beiden Routern erreichbar.
 *
 * 🔴 Ebenso erwartet (Betreiber 2026-09-24): Unsere Linie ist straff gezogen, also kürzer als Legacys
 * Treppe (l); ein Ausstieg am Ufer zahlt die Furt (j); der Einzelreiter zahlt 5 statt 15 Meilen je
 * Querung (k). Die Gruppe zu Fuß zahlt wie Legacy - ihr Profil misst j und l allein. Kommt der Gang
 * unterwegs an einen Weg, steigt er dort ein (n), und einen Fluss nahe Punkt oder Ausstieg quert er
 * nicht gratis wie Legacy, sondern zuletzt und mit Preis (m): Dort weichen Ausstieg und Stunden ab.
 *
 * 🔴 Boden (R8): Das Orakel muss mit `build-db.mjs --ground` gebaut sein, sonst rechnet Legacy still
 * ohne Boden, und die Stunden weichen im Median um 13 % statt 4 % ab. Einen Weg, den man zu Fuß
 * schneller erreicht, bieten wir zusätzlich an (q); nimmt das Netz ihn, weicht der Ausstieg ab.
 */

const { values } = parseArgs({
    options: {
        points: { type: "string", default: "80" },
        seed: { type: "string", default: "11" },
        workers: { type: "string", default: "6" },
        out: { type: "string", default: "../../review/offroad-parity" },
        database: { type: "string" },
    },
});

interface Profile {
    id: string;
    label: string;
    request: RouteRequest;
}
const all = { land: true, river: true, sea: true };
const PROFILES: Profile[] = [
    {
        id: "fuss-schnellste",
        label: "zu Fuß, schnellste",
        request: {
            optimize: "fastest",
            transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
            enabled: all,
            minimizeTransfers: false,
        },
    },
    {
        id: "reiter-kuerzeste",
        label: "Einzelreiter, kürzeste",
        request: {
            optimize: "shortest",
            transports: { land: "lightRider", river: "riverBarge", sea: "galley" },
            enabled: all,
            minimizeTransfers: false,
        },
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

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const database = createDatabase(config.databaseUrl);
const model = AVENTURIA_TRAVEL_MODEL;
const data = await databaseRoutingSource(database, AVENTURIA.mapDomain, model).load();
await database.end({ timeout: 5 });
const { network, water, land, rivers } = data;

const next = random(Number(values.seed));
const count = Number(values.points);
const bounds = land.areas.reduce(
    (box, area) => ({
        minX: Math.min(box.minX, area.minX),
        minY: Math.min(box.minY, area.minY),
        maxX: Math.max(box.maxX, area.maxX),
        maxY: Math.max(box.maxY, area.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
);
const lines = [...rivers.walls, ...rivers.fords];
/** Ein Punkt an Land: zufällig, oder 1,5 bis 4 Einheiten seitlich eines Flusses oder Baches. */
function samplePoint(nearRiver: boolean): { x: number; y: number } {
    for (;;) {
        let x: number;
        let y: number;
        if (nearRiver) {
            const line = lines[Math.floor(next() * lines.length)] as (typeof lines)[number];
            const segment = Math.floor(next() * (line.coordinates.length - 1));
            const [ax, ay] = line.coordinates[segment] as [number, number];
            const [bx, by] = line.coordinates[segment + 1] as [number, number];
            const t = next();
            const length = Math.hypot(bx - ax, by - ay) || 1;
            const offset = (1.5 + next() * 2.5) * (next() < 0.5 ? -1 : 1);
            x = ax + (bx - ax) * t + (-(by - ay) / length) * offset;
            y = ay + (by - ay) * t + ((bx - ax) / length) * offset;
        } else {
            x = bounds.minX + next() * (bounds.maxX - bounds.minX);
            y = bounds.minY + next() * (bounds.maxY - bounds.minY);
        }
        const point = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
        if (pointIsOnLand(point.x, point.y, land, water)) return point;
    }
}

/** Die sichtbaren Orte des größten zusammenhängenden Netzteils - dort beginnt jede Reise. */
function mainPlaces(graph: RouteGraph): RouteNode[] {
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
    return best.flatMap((id) => {
        const node = network.nodes.get(id);
        return node?.kind === "place" && !node.isHidden ? [node] : [];
    });
}

/** Einer der fünf nächsten Orte, mindestens zwei Einheiten entfernt: eine kurze Reise mit Netzteil. */
function nearbyStart(places: readonly RouteNode[], point: { x: number; y: number }): string {
    const nearest = places
        .map((node) => ({ id: node.id, distance: Math.hypot(node.x - point.x, node.y - point.y) }))
        .filter((entry) => entry.distance >= 2)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5);
    return (nearest[Math.floor(next() * nearest.length)] as { id: string }).id;
}

interface Case {
    profile: Profile;
    start: string;
    point: { x: number; y: number };
    nearRiver: boolean;
}
const graphs = new Map<string, RouteGraph>();
const cases: Case[] = [];
const points = Array.from({ length: count }, (_, index) => ({ nearRiver: index % 2 === 1 })).map(({ nearRiver }) => ({
    point: samplePoint(nearRiver),
    nearRiver,
}));
for (const profile of PROFILES) {
    const graph = buildRouteGraph(network, model, profile.request, water);
    graphs.set(profile.id, graph);
    const places = mainPlaces(graph);
    for (const { point, nearRiver } of points) {
        cases.push({ profile, start: nearbyStart(places, point), point, nearRiver });
    }
}

const nameOf = (id: string): string => network.nodes.get(id)?.name ?? id;
const outDirectory = resolve(values.out);
mkdirSync(outDirectory, { recursive: true });
const requestsFile = join(outDirectory, "legacy-requests.json");
const resultsFile = join(outDirectory, "legacy-results.jsonl");
writeFileSync(
    requestsFile,
    JSON.stringify(
        cases.map(({ profile, start, point }) => ({
            from: nameOf(start),
            to: "Kartenpunkt",
            to_point: point,
            optimize: profile.request.optimize,
            transports: { ...profile.request.transports, synthetic: profile.request.transports.land },
            enabled_transports: profile.request.enabled,
            minimize_transfers: profile.request.minimizeTransfers,
            include_geometry: true,
            debug: true,
        })),
    ),
);
const oracle = resolve(import.meta.dirname, "../../../../scripts/dev/legacy-route-oracle/run.mjs");
console.log(`${String(cases.length)} Fälle, Legacy rechnet ...`);
execFileSync(
    process.execPath,
    [
        oracle,
        "--requests",
        requestsFile,
        "--out",
        resultsFile,
        "--workers",
        values.workers,
        ...(values.database ? ["--database", values.database] : []),
    ],
    {
        stdio: "inherit",
    },
);

interface LegacySegment {
    public_id?: string;
    subtype: string;
    from_node: string;
    to_node: string;
    transport_type: string;
    distance_units: number;
    cost_units: number;
    cost_factor?: number;
    synthetic: boolean;
    offroad?: boolean;
    geometry?: { coordinates: [number, number][] };
}
const legacyResults = readFileSync(resultsFile, "utf8")
    .trim()
    .split("\n")
    .map(
        (line) =>
            JSON.parse(line) as {
                ms: number;
                error?: { message: string; code?: string | null };
                route?: { found: boolean; segments?: LegacySegment[] };
            },
    );

interface Leg {
    exit: [number, number];
    distance: number;
    hours: number;
    points: number;
}
interface Row {
    profile: string;
    start: string;
    point: string;
    nearRiver: boolean;
    /** Ist die Sehne zum Ausstieg, den wir wählen, trocken? */
    dry: boolean | null;
    legacy: string;
    ours: string;
    legacyLeg: Leg | null;
    ourLeg: Leg | null;
    sameExit: boolean;
    distanceDelta: number | null;
    hoursDelta: number | null;
    sameStages: boolean;
    ourMs: number;
    legacyMs: number;
}

const station = (name: string): string =>
    /^(Kreuzung(-\d+)?|__wp_anchor_\d+|__offroad_\w+|Kartenpunkt)$/.test(name) ? "*" : name;
/** Die Etappen als Text: Stücke desselben gezeichneten Weges in Folge sind eine. */
function stagesOf(
    segments: { publicId: string; subtype: string; synthetic: boolean; from: string; to: string }[],
): string {
    const merged: { key: string; type: string; from: string; to: string }[] = [];
    for (const segment of segments) {
        const type = segment.synthetic ? "Querfeldein" : segment.subtype;
        const key = segment.synthetic ? "" : segment.publicId;
        const last = merged[merged.length - 1];
        if (last && key !== "" && last.key === key) last.to = segment.to;
        else merged.push({ key, type, from: segment.from, to: segment.to });
    }
    return merged.map((stage) => `${stage.type}:${station(stage.from)}>${station(stage.to)}`).join(",");
}

const rows: Row[] = cases.map(({ profile, start, point, nearRiver }, index) => {
    const legacy = legacyResults[index];
    const graph = graphs.get(profile.id) as RouteGraph;
    const started = performance.now();
    const ours = findRoute(network, graph, [start, mapPointId(point)], data);
    const ourMs = performance.now() - started;

    const legacySegments = legacy?.route?.segments ?? [];
    const legacyOffroad = legacySegments.findLast((segment) => segment.offroad === true);
    const ourOffroad = ours.segments.findLast((segment) => segment.offroad);
    const legacyLeg: Leg | null = legacyOffroad?.geometry
        ? {
              exit: legacyOffroad.geometry.coordinates[0] as [number, number],
              distance: legacyOffroad.distance_units,
              hours: travelHoursFromTime(model, legacyOffroad.cost_units / (legacyOffroad.cost_factor ?? 1)),
              points: legacyOffroad.geometry.coordinates.length,
          }
        : null;
    const ourLeg: Leg | null = ourOffroad
        ? {
              exit: ourOffroad.geometry.coordinates[0] as [number, number],
              distance: ourOffroad.distance_units,
              hours: ourOffroad.travel_hours,
              points: ourOffroad.geometry.coordinates.length,
          }
        : null;
    const legacyOutcome = legacy?.error
        ? (legacy.error.code ?? `Fehler: ${legacy.error.message}`)
        : legacy?.route?.found
          ? "found"
          : "not_found";
    const ourOutcome = ours.refused ? ours.refused.reason : ours.found ? "found" : "not_found";
    const sameExit =
        legacyLeg !== null &&
        ourLeg !== null &&
        Math.hypot(legacyLeg.exit[0] - ourLeg.exit[0], legacyLeg.exit[1] - ourLeg.exit[1]) < 1e-6;
    return {
        profile: profile.id,
        start: nameOf(start),
        point: `${String(point.x)}|${String(point.y)}`,
        nearRiver,
        dry: ourLeg ? chordIsDry({ water, rivers }, { x: ourLeg.exit[0], y: ourLeg.exit[1] }, point) : null,
        legacy: legacyOutcome,
        ours: ourOutcome,
        legacyLeg,
        ourLeg,
        sameExit,
        distanceDelta: legacyLeg && ourLeg ? ourLeg.distance / legacyLeg.distance - 1 : null,
        hoursDelta: legacyLeg && ourLeg ? ourLeg.hours / legacyLeg.hours - 1 : null,
        sameStages:
            stagesOf(
                legacySegments.map((segment) => ({
                    publicId: segment.public_id ?? "",
                    subtype: segment.subtype,
                    synthetic: segment.synthetic,
                    from: segment.from_node,
                    to: segment.to_node,
                })),
            ) ===
            stagesOf(
                ours.segments.map((segment) => ({
                    publicId: segment.public_id,
                    subtype: segment.subtype,
                    synthetic: segment.synthetic,
                    from: segment.from_node,
                    to: segment.to_node,
                })),
            ),
        ourMs,
        legacyMs: legacy?.ms ?? 0,
    };
});

const share = (part: number, total: number): string =>
    total === 0 ? "-" : `${String(part)} von ${String(total)} (${((100 * part) / total).toFixed(1)} %)`;
const quantile = (list: number[], q: number): number => {
    const sorted = [...list].sort((a, b) => a - b);
    return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};
const percent = (value: number): string => `${(100 * value).toFixed(2)} %`;

const lines_: string[] = [
    "# Gang zum Kartenpunkt: Avesmaps3D gegen Legacys eigenen Router",
    "",
    `Legacy avesmaps@bfec670 (Routing wie 770c80e), ${String(cases.length)} Fälle, Seed ${values.seed}. Erzeugt von \`src/routing/offroad-parity-cli.ts\`.`,
    "",
    "| Profil | Fälle | gleiches Ergebnis | beide angekommen | gleicher Ausstieg | davon gebogen (Legacy / wir) | Länge Median / max (gesucht) | Stunden Median / max (gesucht) | gleiche Etappen |",
    "|---|---|---|---|---|---|---|---|---|",
];
for (const profile of PROFILES) {
    const own = rows.filter((row) => row.profile === profile.id);
    const both = own.filter((row) => row.legacyLeg && row.ourLeg);
    const searched = both.filter((row) => row.dry === false && row.sameExit);
    lines_.push(
        `| ${profile.label} | ${String(own.length)} | ${share(own.filter((row) => row.legacy === row.ours).length, own.length)} | ${share(both.length, own.length)} | ${share(both.filter((row) => row.sameExit).length, both.length)} | ${String(both.filter((row) => (row.legacyLeg?.points ?? 0) > 2).length)} / ${String(both.filter((row) => (row.ourLeg?.points ?? 0) > 2).length)} | ${percent(
            quantile(
                searched.map((row) => Math.abs(row.distanceDelta ?? 0)),
                0.5,
            ),
        )} / ${percent(
            quantile(
                searched.map((row) => Math.abs(row.distanceDelta ?? 0)),
                1,
            ),
        )} | ${percent(
            quantile(
                searched.map((row) => Math.abs(row.hoursDelta ?? 0)),
                0.5,
            ),
        )} / ${percent(
            quantile(
                searched.map((row) => Math.abs(row.hoursDelta ?? 0)),
                1,
            ),
        )} | ${share(own.filter((row) => row.sameStages).length, own.length)} |`,
    );
}
const ourTimes = rows.map((row) => row.ourMs);
lines_.push(
    "",
    `Rechenzeit je Route (Graph einmal je Profil gebaut): wir p50 ${quantile(ourTimes, 0.5).toFixed(1)} ms, p95 ${quantile(ourTimes, 0.95).toFixed(1)} ms, max ${quantile(ourTimes, 1).toFixed(1)} ms; Legacy p50 ${quantile(
        rows.map((row) => row.legacyMs),
        0.5,
    ).toFixed(0)} ms.`,
    "",
    "„gesucht“: der Gang, dessen Sehne nass ist - dort rechnen beide dieselbe Suche. Bei trockener Sehne geht Avesmaps3D gerade (Entscheidung h).",
    "",
    "## Abweichungen",
    "",
    ...rows
        .filter(
            (row) =>
                row.legacy !== row.ours ||
                (row.legacyLeg && row.ourLeg && !row.sameExit) ||
                (row.dry === false && Math.abs(row.distanceDelta ?? 0) > 0.05),
        )
        .slice(0, 40)
        .map(
            (row) =>
                `- **${row.profile}** ${row.start} → (${row.point})${row.nearRiver ? " am Fluss" : ""}: Legacy ${row.legacy}${row.legacyLeg ? ` Ausstieg ${row.legacyLeg.exit.map((v) => v.toFixed(3)).join("|")} ${row.legacyLeg.distance.toFixed(3)} E, ${String(row.legacyLeg.points)} Pkt` : ""}; wir ${row.ours}${row.ourLeg ? ` Ausstieg ${row.ourLeg.exit.map((v) => v.toFixed(3)).join("|")} ${row.ourLeg.distance.toFixed(3)} E, ${String(row.ourLeg.points)} Pkt, Sehne ${row.dry ? "trocken" : "nass"}` : ""}`,
        ),
);
writeFileSync(join(outDirectory, "parity.md"), lines_.join("\n") + "\n");
writeFileSync(join(outDirectory, "parity.json"), JSON.stringify(rows, null, 1));
console.log(lines_.slice(0, 10).join("\n"));
console.log(`\nBericht: ${join(outDirectory, "parity.md")}`);
