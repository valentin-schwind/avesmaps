import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createContext, runInContext } from "node:vm";
import {
    AVENTURIA,
    AVENTURIA_TRAVEL_MODEL,
    buildRouteStages,
    travelDayHours,
    type RouteSegment,
    type RouteStage,
} from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { loadRouteNetwork, type RouteNetwork } from "./network.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "./router.ts";
import { buildPlaceIndex } from "./stage-context.ts";
import { loadWater } from "./water.ts";

/**
 * Vergleicht unsere Etappen mit Legacys EIGENER Etappenbildung, auf denselben Abschnitten (WI-0017,
 * Abnahme K7: „Gareth → Perricum zeigt dieselben Etappen, Stunden und Rast wie Legacys Reiseplan“).
 *
 * Aufruf: npm run compare:stages --workspace @avesmaps3d/server [-- --pairs 60 --seed 7]
 *
 * ⭐ Wegfindung und Etappenbildung werden GETRENNT geprüft. Die Wegfindung vergleicht
 * `compare:routing` mit Legacys PHP-Router. Hier rechnet unser Router EINMAL, und beide
 * Etappenbildungen bekommen genau seine Abschnitte: unsere (`buildRouteStages`) und Legacys
 * `route-plan.js`/`route-result.js` aus dem Discovery-Mirror, unverändert in einem `vm` geladen - so,
 * wie Legacys eigene Tests sie laden. Ein Unterschied liegt damit an der Etappenbildung, nie am Weg.
 *
 * Legacys Browser-Umgebung wird nachgestellt: die Ortsliste (`locationData`) in Legacys Reihenfolge
 * aus dem Snapshot, die Wegpunkte (`selectedLocations`), die Tempotafel des Reisemodells (die Live-
 * Tafel, mit der Legacys Karte rechnet) und die Reisetage je Mittel.
 *
 * 🪤 Bekannte Abweichung, entschieden: Den Ort an einem Wegende wählt Legacy nach Listenreihenfolge im
 * Kasten ±0,5, wir den nächsten (Betreiber 2026-09-23, „unsere Regel bleibt“). Ein Unterschied im
 * Namen eines Etappenendes kann daher `EXPECTED_CHANGE` sein; der Bericht zeigt die Stelle.
 */

const MIRROR = "C:/GIT/.discovery/avesmaps.git";
const COMMIT = "770c80ee558aac8ed5d900629ca17d3036230ab6";
const LEGACY_SCRIPTS = [
    "js/app/i18n.js",
    "js/routing/route-node.js",
    "js/routing/route-plan.js",
    "js/routing/route-result.js",
];

const { values } = parseArgs({
    options: {
        pairs: { type: "string", default: "40" },
        seed: { type: "string", default: "7" },
        out: { type: "string", default: "../../review/stage-parity" },
        snapshot: { type: "string", default: "C:/avesmaps3d-data/legacy-snapshots/map-features.json" },
        "hours-per-day": { type: "string", default: "8" },
        // Gegenprobe: Legacys Code, nur mit „nächster Ort“ statt Listenreihenfolge im Kasten ±0,5.
        nearest: { type: "boolean", default: false },
    },
});

interface Profile {
    id: string;
    request: RouteRequest;
}
const transports = { land: "groupFoot", river: "riverSailer", sea: "cargoShip" };
const PROFILES: Profile[] = [
    {
        id: "fuss-land",
        request: {
            optimize: "fastest",
            transports,
            enabled: { land: true, river: false, sea: false },
            minimizeTransfers: false,
        },
    },
    {
        id: "fuss-alle",
        request: {
            optimize: "fastest",
            transports,
            enabled: { land: true, river: true, sea: true },
            minimizeTransfers: false,
        },
    },
    {
        id: "reiter-kuerzeste",
        request: {
            optimize: "shortest",
            transports: { land: "lightRider", river: "riverBarge", sea: "galley" },
            enabled: { land: true, river: true, sea: true },
            minimizeTransfers: false,
        },
    },
    {
        id: "schnellsegler",
        request: {
            optimize: "fastest",
            transports: { land: "groupFoot", river: "riverSailer", sea: "fastShip" },
            enabled: { land: true, river: true, sea: true },
            minimizeTransfers: false,
        },
    },
];

/** Ein kleiner, reproduzierbarer Zufall (mulberry32), wie in `compare:routing`. */
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

interface LegacyLocation {
    name: string;
    coordinates: [number, number];
    kind: "place" | "crossing";
    hidden: boolean;
    revealed: boolean;
}

interface LegacyStep {
    type: string;
    transport: string;
    from: string;
    to: string;
    distance: number;
    travel_time: number;
    rest_time: number;
    segment_ids: number[];
}

/** Legacys Etappenbildung in einer eigenen Umgebung - einmal geladen, je Route mit anderen Wegpunkten. */
function legacyStageBuilder(network: RouteNetwork, order: Map<string, number>, hoursPerDay: number, nearest: boolean) {
    const locations: LegacyLocation[] = [...network.nodes.values()]
        .map((node) => ({
            id: node.id,
            location: {
                name: node.name,
                coordinates: [node.y, node.x] as [number, number],
                // Legacy kennt nur Orte und Kreuzungen; ein technischer Knoten (WI-0132) spielt dort die Rolle der Kreuzung.
                kind: node.kind === "place" ? ("place" as const) : ("crossing" as const),
                hidden: node.isHidden,
                revealed: false,
            },
        }))
        .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER))
        .map((entry) => entry.location);
    const byName = new Map<string, LegacyLocation>();
    for (const location of locations)
        if (location.kind === "place" && !byName.has(location.name)) byName.set(location.name, location);

    const model = AVENTURIA_TRAVEL_MODEL;
    const land = new Set(model.transportmittel.wert.land);
    const sandbox: Record<string, unknown> = {
        window: { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} },
        document: {
            getElementById: () => null,
            querySelectorAll: () => [],
            addEventListener() {},
            documentElement: {},
        },
        localStorage: { getItem: () => null, setItem() {} },
        console,
        // Legacys config.js, die Werte, die die Etappenbildung liest.
        SYNTHETIC_ROUTE_TYPE: "Querfeldein",
        TIME_SCALE_FACTOR: model.zeitfaktor.wert,
        KM_TO_MILES: 1,
        THRESHOLD: 0.5,
        ROUTE_CITY_NODE_THRESHOLD: 0.15,
        // Die Live-Tafel: Legacys Karte überschreibt ihre eingebaute Tafel mit der des Servers.
        SPEED_TABLE: model.tempo.wert,
        TRANSPORT_TRAVEL_HOURS: Object.fromEntries(
            Object.values(model.transportmittel.wert)
                .flat()
                .map((transport) => [transport, travelDayHours(model, transport)]),
        ),
        VALID_TRANSPORT_OPTIONS: {
            land,
            river: new Set(model.transportmittel.wert.river),
            sea: new Set(model.transportmittel.wert.sea),
        },
        locationData: locations,
        selectedLocations: [] as unknown[],
        // Die Ortsdomäne, wie Legacy sie hat (map-features.js, routing.js, map-features-location-*.js).
        normalizeNodeName: (name: unknown) =>
            typeof name === "string"
                ? name.replace(/Kreuzung-\d+/i, "Kreuzung").replace(/__wp_anchor_\d+/i, "Kreuzung")
                : "",
        normalizeLocationSearchName: (name: unknown) =>
            typeof name === "string" ? name.normalize("NFC").trim().toLowerCase() : "",
        normalizePathSubtype: (value: unknown) => String(value || "Weg"),
        isCrossingLocation: (location: LegacyLocation | null) => location?.kind === "crossing",
        isHiddenLocation: (location: LegacyLocation | null) => Boolean(location?.hidden && !location.revealed),
        findLocationMarkerByName: (name: string) => {
            const location = byName.get(name);
            return location ? { location } : null;
        },
        getTransportOption: () => "groupFoot",
        findPathByPublicId: () => null,
        calculateScaledDistance: (a: number[], b: number[]) =>
            Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0)) * model.meilenJeKarteneinheit.wert,
    };
    const context = createContext(sandbox);
    for (const script of LEGACY_SCRIPTS) {
        const source = execFileSync("git", [`--git-dir=${MIRROR}`, "show", `${COMMIT}:${script}`], {
            encoding: "utf8",
            maxBuffer: 1 << 26,
        });
        runInContext(source, context, { filename: script });
        if (script.endsWith("i18n.js")) runInContext("var tr = window.tr;", context);
    }
    if (nearest) {
        // Die EINE Regel, in der wir bewusst abweichen (Betreiber 2026-09-23): der nächste Ort im Kasten,
        // nicht der erste der Liste. Alles andere bleibt Legacys Code.
        runInContext(
            `findRouteLocationAtPathEndpoint = function (coordinate, { allowCrossings = true } = {}) {
                if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
                const [x, y] = coordinate;
                const inBox = locationData
                    .filter(({ coordinates: [lat, lng] }) => Math.abs(lat - y) < THRESHOLD && Math.abs(lng - x) < THRESHOLD)
                    .map((location) => ({ location, d: (location.coordinates[1] - x) ** 2 + (location.coordinates[0] - y) ** 2 }))
                    .sort((a, b) => a.d - b.d)
                    .map((entry) => entry.location);
                if (!inBox.length) return null;
                const place = inBox.find((location) => !isCrossingLocation(location));
                return allowCrossings ? place || inBox[0] || null : place || null;
            };`,
            context,
        );
    }

    /**
     * Wie Legacy einen Punkt benennt, und warum: der ERSTE Ort im Kasten ±0,5 in Listenreihenfolge
     * (`findRouteLocationAtPathEndpoint`), und nur, wenn er näher als 0,15 liegt.
     */
    const explain = (x: number, y: number): { legacyName: string; firstInBox: string; distance: number } => {
        sandbox["__point"] = [x, y];
        const legacyName = String(
            runInContext("formatRoutePlanNodeName(routeSegmentEndpointName(__point, true))", context),
        );
        const first = locations.find(
            (location) =>
                location.kind !== "crossing" &&
                Math.abs(location.coordinates[0] - y) < 0.5 &&
                Math.abs(location.coordinates[1] - x) < 0.5,
        );
        return {
            legacyName,
            firstInBox: first?.name ?? "",
            distance: first ? Math.hypot(first.coordinates[1] - x, first.coordinates[0] - y) : Number.NaN,
        };
    };

    const build = (waypointIds: string[], segments: RouteSegment[]): LegacyStep[] => {
        for (const location of locations) location.revealed = false;
        const waypoints = waypointIds.map((id) => network.nodes.get(id));
        sandbox["selectedLocations"] = waypoints.map((node) => {
            const location = node ? byName.get(node.name) : undefined;
            // Als Wegpunkt gesetzt, ist ein versteckter Ort für diesen Besuch aufgedeckt (Legacy B3).
            if (location) location.revealed = true;
            return { name: node?.name ?? "", coordinates: [node?.y ?? 0, node?.x ?? 0], isMapPoint: false };
        });
        const features = segments.map((segment) => ({
            type: "Feature",
            geometry: { type: "LineString", coordinates: segment.geometry.coordinates },
            properties: {
                feature_subtype: segment.synthetic ? "Querfeldein" : segment.subtype,
                name: segment.path_name,
                transportOption: segment.transport_type,
                synthetic: segment.synthetic,
                offroad: segment.offroad,
                flow_time_factor: segment.flow_time_factor,
                flow_state: segment.flow_state,
            },
        }));
        const routeNames = [segments[0]?.from_node ?? "", ...segments.map((segment) => segment.to_node)];
        sandbox["__request"] = { routeNames, features, restHoursPerDay: 24 - hoursPerDay };
        return runInContext(
            "buildRouteSteps(__request.routeNames, __request.features, { includeRests: true, restHoursPerDay: __request.restHoursPerDay })",
            context,
        ) as LegacyStep[];
    };
    return { build, explain };
}

/** Unsere Etappenenden, wie der Planer sie beschriftet - Legacys Wörter. */
function ourLabel(point: RouteStage["from"]): string {
    switch (point.point) {
        case "place":
        case "point":
            return point.name;
        case "exit":
            return "Abgangspunkt";
        case "join":
            return "Anschlusspunkt";
        case "landing":
            return "Anlegestelle";
        case "marker":
            return "Markierung";
    }
}

/**
 * Der Name, den Legacys Reiseplan ANZEIGT: `routePlanPlaceMarkup` formatiert eine Kreuzung erst beim
 * Zeichnen zur „Markierung“ (`formatRoutePlanNodeName`). In `buildRouteSteps` steht noch das Rohe.
 */
const shown = (name: string): string => (/^Kreuzung(-d+)?$/.test(name) ? "Markierung" : name);

interface Difference {
    profile: string;
    route: string;
    field: string;
    stage: number;
    legacy: unknown;
    ours: unknown;
}

const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const database = createDatabase(config.databaseUrl);
const network = await loadRouteNetwork(database, AVENTURIA.mapDomain);
const water = await loadWater(database, AVENTURIA.mapDomain);
await database.end({ timeout: 5 });

const order = new Map<string, number>();
if (existsSync(values.snapshot)) {
    const snapshot = JSON.parse(readFileSync(values.snapshot, "utf8")) as {
        features: { id: string; geometry: { type: string }; properties?: { feature_type?: string } }[];
    };
    snapshot.features.forEach((feature, index) => {
        if (feature.geometry.type === "Point" && feature.properties?.feature_type !== "label")
            order.set(feature.id, index);
    });
} else {
    console.warn(`Kein Snapshot unter ${values.snapshot}: die Ortsliste steht in der Reihenfolge der Datenbank.`);
}

const hoursPerDay = Number(values["hours-per-day"]);
const legacy = legacyStageBuilder(network, order, hoursPerDay, values.nearest);
const index = buildPlaceIndex(network);
const next = random(Number(values.seed));
const places = [...network.nodes.values()].filter((node) => node.kind === "place" && !node.isHidden);
const byName = (name: string): string => {
    const node = places.find((place) => place.name === name);
    if (!node) throw new Error(`Ort ${name} fehlt`);
    return node.id;
};

const differences: Difference[] = [];
const summary: { profile: string; routes: number; identical: number }[] = [];
for (const profile of PROFILES) {
    const graph = buildRouteGraph(network, AVENTURIA_TRAVEL_MODEL, profile.request, water);
    const pairs: string[][] = [[byName("Gareth"), byName("Perricum")]];
    while (pairs.length < Number(values.pairs)) {
        const from = places[Math.floor(next() * places.length)];
        const to = places[Math.floor(next() * places.length)];
        if (from && to && from.id !== to.id) pairs.push([from.id, to.id]);
    }
    let routes = 0;
    let identical = 0;
    for (const waypointIds of pairs) {
        const result = findRoute(network, graph, waypointIds);
        if (!result.found) continue;
        routes += 1;
        const legs = result.legs.map((leg) => ({
            from: leg.from,
            to: leg.to,
            segment_start: leg.segmentStart,
            segment_count: leg.segmentCount,
            distance_units: leg.distanceUnits,
            travel_hours: leg.travelHours,
        }));
        const ours = buildRouteStages(
            result.segments,
            legs,
            {
                model: AVENTURIA_TRAVEL_MODEL,
                waypointIds,
                placeAt: (nodeId) => index.placeAt(nodeId),
                placeNear: (x, y, radius, accept) => index.placeNear(x, y, radius, accept),
            },
            { hoursPerDay },
        );
        const steps = legacy.build(waypointIds, result.segments);
        const route = waypointIds.map((id) => network.nodes.get(id)?.name ?? id).join(" → ");
        const found: Difference[] = [];
        const note = (stage: number, field: string, legacyValue: unknown, ourValue: unknown): void => {
            found.push({ profile: profile.id, route, field, stage, legacy: legacyValue, ours: ourValue });
        };
        if (steps.length !== ours.length) {
            // Wo schneiden wir, wo Legacy nicht? An jedem solchen Ort: Legacys Name dort und warum.
            const legacyEnds = new Set(steps.map((step) => step.to));
            for (const stage of ours) {
                if (stage.to.point !== "place" || legacyEnds.has(stage.to.name)) continue;
                // Am Ende des letzten Abschnitts der Etappe, in Fahrtrichtung - dort benennt Legacy.
                const segment = result.segments[stage.segment_start + stage.segment_count - 1];
                const end = segment?.geometry.coordinates.at(-1) ?? [stage.to.x, stage.to.y];
                const why = legacy.explain(end[0], end[1]);
                note(stage.index, "Schnitt nur bei uns", why, stage.to.name);
            }
            note(
                -1,
                "Etappenzahl",
                steps.map((step) => `${step.from} > ${step.to}`),
                ours.map((stage) => `${ourLabel(stage.from)} > ${ourLabel(stage.to)}`),
            );
        } else {
            ours.forEach((stage, position) => {
                const step = steps[position] as LegacyStep;
                const segmentIds = Array.from(
                    { length: stage.segment_count },
                    (_, offset) => stage.segment_start + offset,
                );
                if (step.type !== stage.type) note(position, "Art", step.type, stage.type);
                if (step.transport !== stage.transport) note(position, "Mittel", step.transport, stage.transport);
                if (shown(step.from) !== ourLabel(stage.from)) note(position, "von", step.from, ourLabel(stage.from));
                if (shown(step.to) !== ourLabel(stage.to)) note(position, "bis", step.to, ourLabel(stage.to));
                if (step.segment_ids.join(",") !== segmentIds.join(","))
                    note(position, "Abschnitte", step.segment_ids, segmentIds);
                const miles = stage.distance_units * AVENTURIA_TRAVEL_MODEL.meilenJeKarteneinheit.wert;
                if (!close(step.distance, miles)) note(position, "Meilen", step.distance, miles);
                if (!close(step.travel_time, stage.travel_hours))
                    note(position, "Stunden", step.travel_time, stage.travel_hours);
                if (!close(step.rest_time, stage.rest_hours)) note(position, "Rast", step.rest_time, stage.rest_hours);
            });
        }
        if (found.length === 0) identical += 1;
        differences.push(...found);
    }
    summary.push({ profile: profile.id, routes, identical });
}

const outDirectory = resolve(values.out);
mkdirSync(outDirectory, { recursive: true });
writeFileSync(join(outDirectory, "stage-parity.json"), JSON.stringify({ summary, differences }, null, 2));
console.log(
    values.nearest
        ? "Gegenprobe: Legacys Code, nur mit „nächster Ort“ statt Listenreihenfolge (die entschiedene Regel)"
        : "Legacys Code unverändert",
);
for (const row of summary) {
    console.log(
        `${row.profile.padEnd(18)} ${String(row.identical)} von ${String(row.routes)} Routen mit denselben Etappen`,
    );
}
const byField = new Map<string, number>();
for (const difference of differences) byField.set(difference.field, (byField.get(difference.field) ?? 0) + 1);
console.log("Unterschiede je Feld:", Object.fromEntries(byField));
const cuts = differences.filter((difference) => difference.field === "Schnitt nur bei uns");
if (cuts.length > 0) {
    const byOrder = cuts.filter(
        (difference) => (difference.legacy as { legacyName: string }).legacyName !== difference.ours,
    ).length;
    console.log(
        `Davon benennt Legacy den Punkt nach seiner Listenreihenfolge anders: ${String(byOrder)} von ${String(cuts.length)} Schnitten`,
    );
}
console.log(`Bericht: ${join(outDirectory, "stage-parity.json")}`);
