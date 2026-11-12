import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    AVENTURIA,
    AVENTURIA_TRAVEL_MODEL,
    airCeilingAbsolute,
    airMaxAboveGround,
    FREE_SEA_EDGE_PREFIX,
    resolveAirQuery,
    travelHoursFromTime,
    travelSpeed,
    type RouteAir,
} from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { airTerrain, boundsAbove } from "../src/routing/air-obstacles.ts";
import { WEIGH_DETOUR, weighedAirFlight } from "../src/routing/air-weigh.ts";
import { flyAround, mountainAirFlight } from "../src/routing/air-way.ts";
import { SCHRITT_PER_UNIT } from "../src/routing/slope.ts";
import { flightProfiles, flightTrack } from "../src/routing/water-profile.ts";
import { openGateService, type GateService } from "../src/routing/corpus-gate-run.ts";
import { lineLength, type RouteNode } from "../src/routing/network.ts";
import { chordAbove } from "../src/routing/relief.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import { partKey } from "../src/routing/revision.ts";
import { loadSeaRoutes, type StoredSeaRoutes } from "../src/routing/sea-derive.ts";
import { FreeSea, type SeaFleet } from "../src/routing/sea-free.ts";
import { clearOnMask } from "../src/routing/sea-graph-store.ts";
import { LANDING_REACH, loadNavigableWater, SEA_CELL_UNITS, type NavigableWater } from "../src/routing/sea-grid.ts";
import { distanceToWater } from "../src/routing/sea-ports.ts";
import { NO_WATER } from "../src/routing/water.ts";
import { boxAround, FlugOrakel, type Point } from "./support/air-oracle.ts";
import { FULL_INVARIANTS, pick, random, scaled } from "./support/invariants.ts";

/**
 * Die Invarianten des Routings gegen die echten Daten der lokalen Entwicklungsdatenbank (WI-0061): die Höhenregel des
 * Flugs am echten Gelände (Gebirgsraster und freie Gipfel), die freie Seefahrt auf dem gespeicherten Seegraphen und
 * die Revision des Geländes im Ergebnis. Die Regeln stehen in `air-invariants.test.ts` und `sea-invariants.test.ts`;
 * dort laufen sie auf erzeugten Fällen, hier auf gezogenen Paaren der echten Orte und Häfen (fester Seed).
 *
 * Wie `route-corpus-gate.test.ts` gegen `DATABASE_URL`, nicht gegen die Testdatenbank; ohne Datenbank oder ohne
 * Routingdaten darin überspringt jeder Test sichtbar. Nur lesend. Umfang: kleine Teilmenge in `npm test`, voller
 * Satz mit `npm run gate:routing-invariants`.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const CLEARANCE = model.flug.wert.mindestabstandSchritt;
const HALF_CELL = SEA_CELL_UNITS / 2;
const TIMEOUT = scaled(60_000, 1_800_000);

const databaseUrl = process.env["DATABASE_URL"];
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const airOf = (id: string): RouteAir => {
    const resolved = resolveAirQuery(model, { air: id });
    if (!resolved.ok || !resolved.air) throw new Error("Flugmittel erwartet");
    return resolved.air;
};

const speedOf = (ship: string): number => travelSpeed(model, ship, "Seeweg") as number;

/** Zwei Punkte gelten als einer, wie in `SeaFleet.line`. */
const samePoint = (a: Point | undefined, b: Point): boolean => !!a && Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-9;

/**
 * Die gemessene Linie einer freien Seereise von Anlegestelle zu Anlegestelle (WI-0123). `SeaFleet.line` legt Hafen,
 * Anlegestelle, Seegraph, Anlegestelle, Hafen hintereinander und lässt einen Punkt aus, der mit seinem Vorgänger
 * zusammenfällt (ein Stück der Länge 0). Liegt ein Hafen genau auf seiner Anlegestelle, fehlt sie deshalb in der Linie,
 * und `geometry[1]` ist schon der nächste Knoten des Seegraphen: Ireth (412,75 | 91,25) steht im Wasser auf einer
 * Zellmitte, die Reise nach Tares sah ihre „Anlegestelle“ so 7,56 E vom Hafen entfernt, und die Hafenverschiebung sah
 * einen Punkt mehr. Hier steht der Hafen als Anlegestelle wieder davor; dass sie die des Seegraphen ist, prüft der
 * Aufrufer.
 */
const betweenLandings = (geometry: readonly Point[], from: Point, to: Point): Point[] => {
    const inner = geometry.slice(1, -1);
    const [start] = geometry;
    const end = geometry[geometry.length - 1];
    if (start && samePoint(start, from)) inner.unshift(start);
    if (end && samePoint(end, to)) inner.push(end);
    return inner;
};

interface Schiff {
    fleet: SeaFleet;
    ship: string;
    ids: string[];
}

describeWithDatabase("Routing-Invarianten gegen die Entwicklungsdaten", () => {
    let database: Database | undefined;
    let gate: GateService | undefined;
    let sea: StoredSeaRoutes | null = null;
    let water: NavigableWater | undefined;
    let places: RouteNode[] = [];
    let unavailable: string | undefined;

    beforeAll(async () => {
        if (!databaseUrl) return;
        try {
            database = createDatabase(databaseUrl, { max: 2 });
            gate = await openGateService(database);
            if (gate.data.network.nodes.size < 100) unavailable = "die Datenbank enthält keine Routingdaten";
            places = [...gate.data.network.nodes.values()].filter((node) => node.kind === "place");
            sea = await loadSeaRoutes(database, AVENTURIA.mapDomain, { current: true });
            // Die gezeichnete Küste braucht nur der volle Satz (sie kostet nichts, prüft aber jeden Schritt einzeln).
            if (FULL_INVARIANTS) water = await loadNavigableWater(database, AVENTURIA.mapDomain);
        } catch (error) {
            unavailable = `die Datenbank ist nicht lesbar (${error instanceof Error ? error.name : "unbekannt"})`;
        }
    }, 120_000);

    afterAll(async () => {
        await database?.end({ timeout: 5 });
    });

    /** Je Hafen des Seegraphen seine Anlegestelle, der Knoten, an dem jede seiner Seereisen beginnt und endet. */
    const landingsOf = (stored: StoredSeaRoutes): Map<string, Point> =>
        new Map(
            stored.graph.ports.map((port) => [
                port.placeId,
                [stored.graph.nodeX[port.node] as number, stored.graph.nodeY[port.node] as number],
            ]),
        );

    /** Der Seegraph der Datenbank mit einem Schiff je Seeschiff des Reisemodells, oder null ohne ihn. */
    const ships = (nodes: ReadonlyMap<string, RouteNode> | undefined = gate?.data.network.nodes): Schiff[] | null => {
        if (!sea || !nodes) return null;
        const free = new FreeSea(sea.graph);
        return sea.graph.transports.map((ship) => {
            const fleet = free.fleet(ship, speedOf(ship), nodes);
            if (!fleet) throw new Error(`der Seegraph kennt ${ship} nicht`);
            return { fleet, ship, ids: [...fleet.ports] };
        });
    };

    it(
        "🔴 Flug: nirgends Gelände über der Grenze außer an den Brücken, am echten Gelände (Orte als Wegpunkte, die Grenze aller Flugmittel und zwei tiefere)",
        (context) => {
            const heights = gate?.data.heights;
            if (unavailable || !gate || !heights) {
                return context.skip(`übersprungen: ${unavailable ?? "kein abgeleitetes Gelände in der Datenbank"}`);
            }
            const terrain = airTerrain(heights);
            // Seit 2026-10-04 gilt EINE Grenze für alle Flugmittel (5.000 − 200 = 4.800, Betreiber). Die Suche selbst ist von
            // der Höhe unabhängig; darum laufen zwei tiefere Grenzen mit, damit sie auch am echten Gelände weit mehr
            // Umwege als heute sieht.
            const limits = [
                {
                    name: "alle Flugmittel",
                    limit: airOf("witchFlight").ceilingSchritt - CLEARANCE,
                    pairs: scaled(60, 600),
                },
                { name: "Grenze 3800", limit: 3800, pairs: scaled(8, 150) },
                { name: "Grenze 800", limit: 800, pairs: scaled(8, 150) },
            ];
            const next = random(20260929);
            const stats = { flights: 0, detours: 0, straight: 0, home: 0, niches: 0, free: 0, rounded: 0 };
            for (const { name: profile, limit, pairs } of limits) {
                const flight = mountainAirFlight(terrain, limit);
                for (let index = 0; index < pairs; index += 1) {
                    const from = pick(places, next);
                    const to = pick(places, next);
                    if (from.id === to.id) continue;
                    const where = `${profile} (Grenze ${String(limit)}), ${from.name} -> ${to.name}`;
                    const a = { id: from.id, name: from.name, x: from.x, y: from.y };
                    const b = { id: to.id, name: to.name, x: to.x, y: to.y };
                    const bounds = boundsAbove(terrain, limit);
                    const detour = bounds && flight.searches(a, b) ? flyAround(terrain, limit, a, b, bounds) : null;
                    const line = detour?.points ?? (flight.way(a, b) as Point[] | null);
                    if (!line) throw new Error(`${where}: der Flug findet immer einen Weg`);
                    stats.flights += 1;
                    expect(line[0], where).toEqual([from.x, from.y]);
                    expect(line[line.length - 1], where).toEqual([to.x, to.y]);
                    expect(lineLength(line), where).toBeGreaterThanOrEqual(
                        Math.hypot(to.x - from.x, to.y - from.y) - 1e-9,
                    );
                    // Ist die Luftlinie frei, ist sie der Flug; sonst sucht er, und die Linie hat Knicke.
                    if (!flight.searches(a, b)) {
                        expect(line, where).toEqual([
                            [from.x, from.y],
                            [to.x, to.y],
                        ]);
                    }
                    const oracle = new FlugOrakel(
                        heights,
                        limit,
                        detour?.frame ?? boxAround([...line, [from.x, from.y], [to.x, to.y]], 12),
                    );
                    const befund = oracle.pruefe([from.x, from.y], [to.x, to.y], line);
                    if (befund.nische) {
                        stats.niches += 1;
                    }
                    if (line.length > 2) stats.detours += 1;
                    else stats.straight += 1;
                    if (oracle.above([from.x, from.y]) || oracle.above([to.x, to.y])) stats.home += 1;
                    expect(
                        befund.verstoesse,
                        `${where}: Stelle ${befund.erster ? `${befund.erster.x.toFixed(3)}|${befund.erster.y.toFixed(3)}` : "-"}, Höhe ${befund.erster?.hoehe.toFixed(1) ?? "-"}`,
                    ).toBe(0);
                    // Die gezeichnete Linie (Befund 2026-10-03: „flug- und querfeldeinrouten sind nicht mehr geglättet“):
                    // Wo der Umweg Ecken hat, sind sie gerundet, und wo er selbst frei ist, schneidet die Rundung nie hinein.
                    const shown = flight.display?.(line);
                    if (shown) {
                        expect(shown[0], where).toEqual([from.x, from.y]);
                        expect(shown[shown.length - 1], where).toEqual([to.x, to.y]);
                        const clear = (path: readonly Point[]): boolean =>
                            path.every(
                                (end, index) =>
                                    index === 0 ||
                                    !chordAbove(
                                        heights,
                                        { x: (path[index - 1] as Point)[0], y: (path[index - 1] as Point)[1] },
                                        { x: end[0], y: end[1] },
                                        limit,
                                    ),
                            );
                        if (line.length > 2 && clear(line)) {
                            stats.free += 1;
                            expect(clear(shown), `${where}: die gerundete Linie schneidet ins Gelände`).toBe(true);
                            if (shown.length > line.length) stats.rounded += 1;
                        }
                    }
                }
            }
            if (FULL_INVARIANTS) console.warn(`Flüge am echten Gelände: ${JSON.stringify(stats)}`);
            expect(stats.flights).toBeGreaterThan(limits.reduce((sum, { pairs }) => sum + pairs, 0) * 0.9);
            expect(stats.detours).toBeGreaterThan(0);
            expect(stats.straight).toBeGreaterThan(0);
            // Gemessen 2026-10-03: vorher 11 von 124 Umwegen gerundet (die Prüfung im Ganzen), jetzt alle.
            expect(stats.free).toBeGreaterThan(0);
            expect(stats.rounded).toBeGreaterThanOrEqual(stats.free * 0.9);
        },
        TIMEOUT,
    );

    it(
        "🔴 Flug: das Höhenprofil hält die Höhenregel am echten Gelände (Bahn ≥ Boden, ≤ Boden + 10 × Reisehöhe, ≤ 5.000), alle Flugmittel",
        (context) => {
            const heights = gate?.data.heights;
            if (unavailable || !gate || !heights) {
                return context.skip(`übersprungen: ${unavailable ?? "kein abgeleitetes Gelände in der Datenbank"}`);
            }
            // Betreiber 2026-10-04: Ein Flugmittel steigt höchstens auf Reisehöhe × 1.000 % über dem Boden darunter und nie
            // höher als 5.000 Schritt über dem Meer. Wo der Boden selbst höher liegt (Start oder Ziel im Hochgebirge, eine
            // erzwungene Querung), liegt die Bahn auf ihm.
            const next = random(20261004);
            const pairs = scaled(6, 120);
            const eps = 0.15;
            const stats = { flights: 0, samples: 0, atReach: 0, atCeiling: 0, onGround: 0, steep: 0 };
            for (const profile of model.flug.wert.profile) {
                const air = airOf(profile.id);
                // Der Flug des Dienstes: mit der Abwägung (F4, F4b), also auch der Weg der Suche über dem Kostenfeld samt Feilen.
                const flight = weighedAirFlight(heights, air, model);
                for (let index = 0; index < pairs; index += 1) {
                    const from = pick(places, next);
                    const to = pick(places, next);
                    if (from.id === to.id) continue;
                    const a = { id: from.id, name: from.name, x: from.x, y: from.y };
                    const b = { id: to.id, name: to.name, x: to.x, y: to.y };
                    const line = flight.way(a, b);
                    if (!line) throw new Error("der Flug findet immer einen Weg");
                    const where = `${profile.id}, ${from.name} -> ${to.name}`;
                    // Ohne Verdichtung (Grenze weit über der Probenzahl): Boden und Bahn tragen dieselben Proben.
                    const result = flightProfiles(line, lineLength(line), heights, air, model, 1_000_000);
                    if (!result) throw new Error(`${where}: kein Höhenprofil`);
                    const ground = result.elevation_profile;
                    const path = result.air_profile;
                    expect(path.length, where).toBe(ground.length);
                    stats.flights += 1;
                    for (const [k, [distance, altitude]] of path.entries()) {
                        const boden = ground[k]![1] as number;
                        expect(ground[k]![0], where).toBe(distance);
                        stats.samples += 1;
                        const cap = Math.min(air.ceilingSchritt, boden + air.maxAboveGroundSchritt);
                        const spot = `${where}, Probe ${String(k)} (Boden ${boden.toFixed(1)})`;
                        expect(altitude, `${spot}: unter dem Boden`).toBeGreaterThanOrEqual(boden - eps);
                        expect(
                            altitude,
                            `${spot}: über Boden + ${String(air.maxAboveGroundSchritt)}`,
                        ).toBeLessThanOrEqual(Math.max(boden, boden + air.maxAboveGroundSchritt) + eps);
                        expect(altitude, `${spot}: über ${String(air.ceilingSchritt)}`).toBeLessThanOrEqual(
                            Math.max(boden, air.ceilingSchritt) + eps,
                        );
                        if (altitude <= Math.max(cap, boden) + eps && altitude >= cap - eps && cap > boden + eps) {
                            if (cap < air.ceilingSchritt - eps) stats.atReach += 1;
                            else stats.atCeiling += 1;
                        }
                        if (altitude <= boden + eps) stats.onGround += 1;
                        // Der Hang ist steiler als 1 : 4 (die Bahn folgt der Obergrenze, nicht der Hülle).
                        if (k > 0) {
                            const run = (distance - path[k - 1]![0]) * SCHRITT_PER_UNIT;
                            if (run > 0 && Math.abs(altitude - path[k - 1]![1]) / run > 0.25 + 1e-3) stats.steep += 1;
                        }
                    }
                }
            }
            if (FULL_INVARIANTS) console.warn(`Höhenprofil am echten Gelände: ${JSON.stringify(stats)}`);
            expect(stats.flights).toBeGreaterThan(model.flug.wert.profile.length * pairs * 0.9);
            expect(stats.samples).toBeGreaterThan(stats.flights * 30);
        },
        TIMEOUT,
    );

    it(
        "🔴 Flug: die Abwägung am echten Gelände (F4): nie langsamer als der Weg der Höchstflughöhe, Zuschlag nie negativ, Umwege höchstens 50 % über der Luftlinie, alle Flugmittel",
        (context) => {
            const heights = gate?.data.heights;
            if (unavailable || !gate || !heights) {
                return context.skip(`übersprungen: ${unavailable ?? "kein abgeleitetes Gelände in der Datenbank"}`);
            }
            const terrain = airTerrain(heights);
            const next = random(20261004);
            const pairs = scaled(6, 120);
            const costOf = (air: RouteAir, line: readonly Point[]): { cost: number; surcharge: number } => {
                const surcharge = flightTrack(line, heights, air, model)?.surcharge;
                const extra = surcharge ? surcharge.climbSchritt + surcharge.holdSchritt : 0;
                return { cost: lineLength(line) * SCHRITT_PER_UNIT + extra, surcharge: surcharge?.hours ?? 0 };
            };
            const stats = { flights: 0, detours: 0, surcharged: 0, free: 0, saved: 0 };
            for (const profile of model.flug.wert.profile) {
                const air = airOf(profile.id);
                const base = mountainAirFlight(terrain, air.ceilingSchritt - CLEARANCE);
                for (let index = 0; index < pairs; index += 1) {
                    const from = pick(places, next);
                    const to = pick(places, next);
                    if (from.id === to.id) continue;
                    const a = { id: from.id, name: from.name, x: from.x, y: from.y };
                    const b = { id: to.id, name: to.name, x: to.x, y: to.y };
                    const where = `${profile.id}, ${from.name} -> ${to.name}`;
                    // Eine frische Abwägung je Etappe: kein Budget einer früheren Etappe.
                    const line = weighedAirFlight(heights, air, model).way(a, b) as Point[] | null;
                    const first = base.way(a, b) as Point[] | null;
                    if (!line || !first) throw new Error(`${where}: der Flug findet immer einen Weg`);
                    stats.flights += 1;
                    expect(line[0], where).toEqual([from.x, from.y]);
                    expect(line[line.length - 1], where).toEqual([to.x, to.y]);
                    // 🔴 Kein Stück über der Sperre (Höchstflughöhe minus Mindestabstand): nie mehr Sehnen darüber als im Weg der
                    // Höchstflughöhe (der nur im Hochgebirge der Wegpunkte, wo der Flug muss, welche hat).
                    const above = (l: readonly Point[]): number =>
                        l.slice(1).filter(([x, y], k) => {
                            const [x0, y0] = l[k] as Point;
                            return chordAbove(heights, { x: x0, y: y0 }, { x, y }, air.ceilingSchritt - CLEARANCE);
                        }).length;
                    expect(above(line), where).toBeLessThanOrEqual(above(first));
                    const chosen = costOf(air, line);
                    const before = costOf(air, first);
                    expect(chosen.surcharge, where).toBeGreaterThanOrEqual(0);
                    expect(before.surcharge, where).toBeGreaterThanOrEqual(0);
                    // Nie langsamer als ohne Abwägung (Länge und Zuschlag sind beide Strecke).
                    expect(chosen.cost, where).toBeLessThanOrEqual(before.cost + 1e-6);
                    const different =
                        line.length !== first.length ||
                        line.some(([x, y], k) => x !== (first[k] as Point)[0] || y !== (first[k] as Point)[1]);
                    if (different) {
                        stats.detours += 1;
                        expect(chosen.cost, where).toBeLessThan(before.cost);
                        stats.saved += (before.cost - chosen.cost) / SCHRITT_PER_UNIT;
                        const direct = Math.hypot(to.x - from.x, to.y - from.y);
                        expect(lineLength(line), where).toBeLessThan(direct * (1 + WEIGH_DETOUR) + 1e-9);
                    }
                    if (chosen.surcharge > 0) stats.surcharged += 1;
                    else stats.free += 1;
                }
            }
            if (FULL_INVARIANTS) console.warn(`Abwägung am echten Gelände: ${JSON.stringify(stats)}`);
            expect(stats.flights).toBeGreaterThan(model.flug.wert.profile.length * pairs * 0.9);
            // Die Probe prüft etwas: Es gibt Umwege durch die Abwägung, Flüge mit und ohne Zuschlag.
            expect(stats.detours).toBeGreaterThan(0);
            expect(stats.surcharged).toBeGreaterThan(0);
            expect(stats.free).toBeGreaterThan(0);
        },
        TIMEOUT,
    );

    it(
        "🔴 Querfeldein: die gezeichnete Linie ist ruhiger als die Treppe der Suche und endet auf denselben Punkten (Befund 2026-10-03)",
        async (context) => {
            const start = places.find((place) => place.name === "Gareth");
            if (unavailable || !gate || !start) {
                return context.skip(`übersprungen: ${unavailable ?? "kein Gareth in den Orten"}`);
            }
            // Wie sehr eine Linie biegt: die Summe der Knickwinkel in Bogenmaß.
            const turning = (line: readonly (readonly [number, number])[]): number => {
                let sum = 0;
                for (let index = 1; index + 1 < line.length; index += 1) {
                    const [ax, ay] = line[index - 1] as [number, number];
                    const [bx, by] = line[index] as [number, number];
                    const [cx, cy] = line[index + 1] as [number, number];
                    const first = Math.hypot(bx - ax, by - ay);
                    const second = Math.hypot(cx - bx, cy - by);
                    if (first === 0 || second === 0) continue;
                    const cosine = ((bx - ax) * (cx - bx) + (by - ay) * (cy - by)) / (first * second);
                    sum += Math.acos(Math.max(-1, Math.min(1, cosine)));
                }
                return sum;
            };
            const next = random(20261003);
            const samples = scaled(20, 200);
            const rough: number[] = [];
            const drawn: number[] = [];
            for (let sample = 0; sample < samples; sample += 1) {
                const x = 300 + Math.floor(next() * 24) * 20;
                const y = 330 + Math.floor(next() * 16) * 20;
                const outcome = await gate.service.route({
                    optimize: "fastest",
                    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
                    enabled: { land: true, river: true, sea: true },
                    minimizeTransfers: false,
                    waypoints: [start.id, `p:${String(x)}:${String(y)}`],
                });
                // Ein Punkt im Wasser oder ohne Weg ist keine Probe.
                if (!outcome.ok) continue;
                for (const segment of outcome.response.segments) {
                    const steps = segment.geometry.coordinates;
                    if (!segment.offroad || steps.length < 4) continue;
                    const line = (segment.display ?? segment.geometry).coordinates;
                    const where = `Gareth -> p:${String(x)}:${String(y)}`;
                    // Das Bild ändert nur den Weg dazwischen: Anfang und Ende liegen bei der Wegkurve höchstens ihr
                    // Überschwingen (0,73 E) daneben.
                    for (const index of [0, line.length - 1]) {
                        const from = line[index] as [number, number];
                        const near = steps[index === 0 ? 0 : steps.length - 1] as [number, number];
                        expect(Math.hypot(from[0] - near[0], from[1] - near[1]), where).toBeLessThan(1);
                    }
                    rough.push(turning(steps));
                    drawn.push(turning(line));
                }
            }
            const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
            if (FULL_INVARIANTS) {
                console.warn(
                    `Querfeldein: ${String(rough.length)} Stücke, Knickwinkel Treppe ${sum(rough).toFixed(1)}, gezeichnet ${sum(drawn).toFixed(1)}`,
                );
            }
            // Gemessen 2026-10-03 an 52 Stücken: Median 1,99 -> 1,03 rad, 90. Perzentil 6,2 -> 3,1.
            expect(rough.length).toBeGreaterThan(0);
            expect(sum(drawn)).toBeLessThan(sum(rough) * 0.8);
        },
        TIMEOUT,
    );

    it("Flug: die Gelände-Revision im Ergebnis ist die des geladenen Stands, die Höchstgrenzen die des Reisemodells", async (context) => {
        if (unavailable || !gate?.data.heights) return context.skip(`übersprungen: ${unavailable ?? "kein Gelände"}`);
        const [from, to] = places.filter((place) => !place.isHidden);
        if (!from || !to) throw new Error("zwei Orte erwartet");
        const air = airOf("griffin");
        const outcome = await gate.service.route({
            optimize: "fastest",
            transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
            enabled: { land: true, river: true, sea: true },
            minimizeTransfers: false,
            waypoints: [from.id, to.id],
            air,
        });
        if (!outcome.ok) throw new Error(`${outcome.error} ${outcome.detail}`);
        expect(outcome.response.terrain_revision).toBe(partKey(gate.data.revision.terrain));
        expect(outcome.response.terrain_revision).not.toBeNull();
        expect(outcome.response.air?.ceiling_schritt).toBe(airCeilingAbsolute(model));
        expect(outcome.response.air?.max_above_ground_schritt).toBe(airMaxAboveGround(model, air.altitudeSchritt));
    });

    it(
        "🔴 See: jede freie Seereise beginnt und endet am Hafen mit Anlegestelle im Wasser, dazwischen nirgends Land (echte Häfen, alle Schiffe)",
        (context) => {
            const all = ships();
            if (unavailable || !sea || !gate || !all) {
                return context.skip(`übersprungen: ${unavailable ?? "kein Seegraph in der Datenbank"}`);
            }
            const mask = sea.graph.mask;
            const nodes = gate.data.network.nodes;
            const graphPorts = sea.graph.ports.map((port) => port.placeId);
            const landings = landingsOf(sea);
            const next = random(20260929);
            const samples = scaled(20, 300);
            const stats = { lines: 0, unconnected: 0, deepest: 0, exactPieces: 0 };
            for (const { fleet, ship, ids } of all) {
                const table = sea.graph.pairs[sea.graph.transports.indexOf(ship)] as Float32Array;
                for (let sample = 0; sample < samples; sample += 1) {
                    const a = pick(ids, next);
                    const b = pick(ids, next);
                    if (a === b) continue;
                    const where = `${ship}, ${nodes.get(a)?.name ?? a} -> ${nodes.get(b)?.name ?? b}`;
                    const line = fleet.line(a, b);
                    // Ohne Weg nur, wo der Seegraph das Paar nicht verbindet (getrennte Wasser).
                    const stored = table[graphPorts.indexOf(a) * graphPorts.length + graphPorts.indexOf(b)] as number;
                    expect(line === null, where).toBe(Number.isNaN(stored));
                    if (!line) {
                        stats.unconnected += 1;
                        continue;
                    }
                    stats.lines += 1;
                    const { geometry, display } = line;
                    const from = nodes.get(a) as RouteNode;
                    const to = nodes.get(b) as RouteNode;
                    expect(geometry[0], where).toEqual([from.x, from.y]);
                    expect(geometry[geometry.length - 1], where).toEqual([to.x, to.y]);
                    // Die Anlegestelle liegt im Wasser und höchstens drei Einheiten vom Hafen, und die Linie läuft durch sie.
                    const first = landings.get(a) as Point;
                    const last = landings.get(b) as Point;
                    expect(Math.hypot(first[0] - from.x, first[1] - from.y), where).toBeLessThanOrEqual(LANDING_REACH);
                    expect(Math.hypot(last[0] - to.x, last[1] - to.y), where).toBeLessThanOrEqual(LANDING_REACH);
                    expect(clearOnMask(mask, first[0], first[1], first[0], first[1]), where).toBe(true);
                    expect(clearOnMask(mask, last[0], last[1], last[0], last[1]), where).toBe(true);
                    const between = betweenLandings(geometry, first, last);
                    expect(samePoint(between[0], first), where).toBe(true);
                    expect(samePoint(between[between.length - 1], last), where).toBe(true);
                    for (let piece = 1; piece < between.length; piece += 1) {
                        const [ax, ay] = between[piece - 1] as Point;
                        const [bx, by] = between[piece] as Point;
                        expect(clearOnMask(mask, ax, ay, bx, by), `${where}, Stück ${String(piece)}`).toBe(true);
                        if (!water) continue;
                        stats.exactPieces += 1;
                        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.1));
                        for (let step = 0; step <= steps; step += 1) {
                            const depth = distanceToWater(
                                water,
                                ax + ((bx - ax) * step) / steps,
                                ay + ((by - ay) * step) / steps,
                                5,
                            );
                            stats.deepest = Math.max(stats.deepest, depth);
                            expect(depth, `${where}, Stück ${String(piece)}`).toBeLessThanOrEqual(HALF_CELL);
                        }
                    }
                    expect(display[0], where).toEqual([from.x, from.y]);
                    expect(display[display.length - 1], where).toEqual([to.x, to.y]);
                }
            }
            if (FULL_INVARIANTS) console.warn(`Freie Seereisen an den echten Häfen: ${JSON.stringify(stats)}`);
            expect(stats.lines).toBeGreaterThan(all.length * samples * 0.5);
        },
        TIMEOUT,
    );

    it(
        "See: jeder Hafen des Netzes um weniger als eine Zelle verschoben, derselbe Seegraph: Distanz und Zeit der Reise ändern sich um höchstens die Verschiebung beider Enden",
        (context) => {
            if (unavailable || !sea || !gate) {
                return context.skip(`übersprungen: ${unavailable ?? "kein Seegraph in der Datenbank"}`);
            }
            const free = new FreeSea(sea.graph);
            const landings = landingsOf(sea);
            const { network } = gate.data;
            const next = random(77);
            const size = 0.49;
            // Jeder Ort bekommt seine eigene Verschiebung unter einer Zelle.
            const moved = new Map<string, RouteNode>();
            for (const [id, node] of network.nodes) {
                const angle = next() * 2 * Math.PI;
                moved.set(id, { ...node, x: node.x + Math.cos(angle) * size, y: node.y + Math.sin(angle) * size });
            }
            const shifted = { ...network, nodes: moved };
            const ports = sea.graph.ports.map((port) => port.placeId).filter((id) => network.nodes.has(id));
            for (const ship of sea.graph.transports.slice(0, scaled(1, 3))) {
                // Nur die Seefahrt: So ist die erste Etappe die freie Seereise.
                const request: RouteRequest = {
                    optimize: "fastest",
                    transports: { land: "groupFoot", river: "riverSailer", sea: ship },
                    enabled: { land: false, river: false, sea: true },
                    minimizeTransfers: false,
                };
                const before = buildRouteGraph(network, model, request, NO_WATER, free);
                const after = buildRouteGraph(shifted, model, request, NO_WATER, free);
                const hours = (distance: number): number => travelHoursFromTime(model, distance / speedOf(ship));
                let compared = 0;
                for (let sample = 0; sample < scaled(15, 200); sample += 1) {
                    const a = pick(ports, next);
                    const b = pick(ports, next);
                    if (a === b) continue;
                    const one = findRoute(network, before, [a, b]);
                    const two = findRoute(shifted, after, [a, b]);
                    const where = `${ship}, ${a} -> ${b}`;
                    expect(two.found, where).toBe(one.found);
                    const [first] = one.segments;
                    const [second] = two.segments;
                    if (!first || !second) continue;
                    compared += 1;
                    // Beide Enden verschoben: höchstens 2 · 0,49 E; die Linie zwischen den Anlegestellen bleibt.
                    expect(Math.abs(second.distance_units - first.distance_units), where).toBeLessThanOrEqual(
                        2 * size + 1e-3,
                    );
                    expect(Math.abs(second.travel_hours - first.travel_hours), where).toBeLessThanOrEqual(
                        hours(2 * size + 1e-3),
                    );
                    const from = landings.get(a) as Point;
                    const to = landings.get(b) as Point;
                    expect(betweenLandings(second.geometry.coordinates as Point[], from, to), where).toEqual(
                        betweenLandings(first.geometry.coordinates as Point[], from, to),
                    );
                }
                expect(compared, ship).toBeGreaterThan(0);
            }
        },
        TIMEOUT,
    );

    it(
        "See: im Router haben freie Seekanten nur Häfen mit Anlegestelle als Enden",
        async (context) => {
            if (!FULL_INVARIANTS)
                return context.skip("übersprungen: nur im vollen Satz (npm run gate:routing-invariants)");
            if (unavailable || !sea || !gate) {
                return context.skip(`übersprungen: ${unavailable ?? "kein Seegraph in der Datenbank"}`);
            }
            const graphPorts = new Set(sea.graph.ports.map((port) => port.placeId));
            const next = random(5);
            const ids = [...graphPorts].filter((id) => gate?.data.network.nodes.has(id));
            let free = 0;
            for (let sample = 0; sample < 60; sample += 1) {
                const a = pick(ids, next);
                const b = pick(ids, next);
                if (a === b) continue;
                const outcome = await gate.service.route({
                    optimize: "fastest",
                    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
                    enabled: { land: true, river: true, sea: true },
                    minimizeTransfers: false,
                    waypoints: [a, b],
                });
                if (!outcome.ok) continue;
                for (const segment of outcome.response.segments) {
                    if (!segment.edge_id.startsWith(FREE_SEA_EDGE_PREFIX)) continue;
                    free += 1;
                    expect(graphPorts.has(segment.from_node_id), `${segment.from_node} -> ${segment.to_node}`).toBe(
                        true,
                    );
                    expect(graphPorts.has(segment.to_node_id), `${segment.from_node} -> ${segment.to_node}`).toBe(true);
                }
            }
            expect(free).toBeGreaterThan(0);
        },
        TIMEOUT,
    );
});
