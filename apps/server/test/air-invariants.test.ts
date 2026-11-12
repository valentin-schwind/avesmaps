import { describe, expect, it } from "vitest";
import {
    airCeilingAbsolute,
    airMaxAboveGround,
    AVENTURIA_TRAVEL_MODEL,
    mapPointId,
    resolveAirQuery,
    type RouteAir,
} from "@avesmaps3d/shared";
import type { Queryable } from "../src/database.ts";
import { airTerrain, blockedCells } from "../src/routing/air-obstacles.ts";
import type { AirPoint } from "../src/routing/air-route.ts";
import { WEIGH_DETOUR, weighedAirFlight } from "../src/routing/air-weigh.ts";
import { frameOver, mountainAirFlight } from "../src/routing/air-way.ts";
import { NO_CLIMATE } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { lineLength } from "../src/routing/network.ts";
import { KIND_NONE, reliefAt, type TerrainHeights } from "../src/routing/relief.ts";
import { partKey, type RoutingDataRevision } from "../src/routing/revision.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import type { RouteRequest } from "../src/routing/router.ts";
import { databaseRoutingSource, RouteService, type RoutingParts, type RoutingReads } from "../src/routing/service.ts";
import { SCHRITT_PER_UNIT } from "../src/routing/slope.ts";
import { flightTrack } from "../src/routing/water-profile.ts";
import { NO_WATER } from "../src/routing/water.ts";
import { FlugOrakel, HEIGHT_EPS, type Point } from "./support/air-oracle.ts";
import { GELAENDE_GROESSE, zufallsGelaende } from "./support/air-random-terrain.ts";
import {
    gebirge,
    GIPFEL,
    GIPFEL_HOCH,
    HOCH_WAND,
    wand,
    WAND_ORTE,
    wandHoch,
    wandNetz,
    wandQuelle,
} from "./support/air-terrain.ts";
import { FULL_INVARIANTS, pick, random, scaled } from "./support/invariants.ts";

/**
 * Die Höhenregel des Flugs als Invariante (WI-0061, Plan 11.54 „Air Route respektiert Höhenregel“, 11.57, 6.61).
 *
 * Die Regel (WI-0051, F-E1 = C, F2; Betreiber 2026-10-04): Die Höchstflughöhe über dem Meer ist für alle Flugmittel
 * 5.000 Schritt (`airCeilingAbsolute`), dazu steigt ein Flugmittel höchstens Reisehöhe × 1.000 % über den Boden
 * (`airMaxAboveGround`; diese Höhe formt die Bahn, `flightAltitude`, nicht den Weg). Unter der Flugbahn liegt nirgends
 * Gelände, das höher ist als 5.000 minus den Mindestabstand (200 Schritt). Ausnahmen sind die begründeten Brücken
 * (`support/air-oracle.ts`): das Gebirge eines Wegpunkts, der selbst darüber liegt, und die eigene Zelle eines
 * tieferen Wegpunkts.
 *
 * Die Fälle kommen aus einem festen Seed: zufälliges Gelände (Riegel, Hügel, freie Gipfel), die Grenzen aller zwölf
 * Flugmittel und einiger eigener, Wegpunkte im Freien und im Gebirge. Geprüft wird gegen `reliefAt` mit einer Probe
 * alle 0,02 E, nicht gegen die Sperre der Suche. Umfang: kleine Teilmenge in `npm test`, voller Satz mit
 * `npm run gate:routing-invariants`. Die Höhe der Bahn im Raum (`flightProfile`) prüft
 * `apps/web/test/flight-profile-invariants.test.ts`.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const CLEARANCE = model.flug.wert.mindestabstandSchritt;
const WHOLE_TERRAIN = { minX: 0, minY: 0, maxX: GELAENDE_GROESSE, maxY: GELAENDE_GROESSE };
const TIMEOUT = scaled(30_000, 600_000);

/**
 * Die Grenzen, gegen die die Suche geprüft wird. Die Grenze des Produkts ist seit 2026-10-04 EINE für alle Flugmittel
 * (die absolute Höchstflughöhe minus Mindestabstand, 4.800); die Suche selbst ist von der Höhe unabhängig, darum laufen
 * dieselben Prüfungen auch mit den früheren Grenzen je Flugmittel (Reisehöhe × 1.000 % − 200, 800 bis 9.800) und einigen
 * eigenen Werten: Sie stehen hier als Prüfstand der Suche, nicht als Regel des Dienstes.
 */
const PRODUCT_LIMIT = airCeilingAbsolute(model) - CLEARANCE;
const LIMITS: { name: string; limit: number }[] = [
    { name: "alle Flugmittel", limit: PRODUCT_LIMIT },
    ...[...model.flug.wert.profile.map((profile) => profile.reisehoehe), 30, 60, 250].map((altitude) => ({
        name: `Grenze ${String((altitude * model.flug.wert.hoechstflughoeheProzent) / 100 - CLEARANCE)}`,
        limit: (altitude * model.flug.wert.hoechstflughoeheProzent) / 100 - CLEARANCE,
    })),
];

const punkt = (id: string, [x, y]: Point): AirPoint => ({ id, name: id, x, y });
const liniengleich = (a: readonly Point[], b: readonly Point[]): boolean =>
    a.length === b.length && a.every((p, i) => p[0] === (b[i] as Point)[0] && p[1] === (b[i] as Point)[1]);
const fixed = (point: Point): string => point.map((value) => value.toFixed(3)).join("|");

describe("Die Sperre der Suche lässt kein Gelände über der Grenze aus", () => {
    const terrains = scaled(4, 30);
    const probes = scaled(8_000, 40_000);

    it(
        `🔴 jede Stelle über der Grenze liegt in einer gesperrten Zelle (${String(terrains)} Gelände, alle Grenzen, ${String(probes)} Stellen je Grenze)`,
        () => {
            let checked = 0;
            let above = 0;
            for (let seed = 1; seed <= terrains; seed += 1) {
                const heights = zufallsGelaende(seed * 7919);
                const terrain = airTerrain(heights);
                const next = random(seed * 104729);
                for (const { name, limit } of LIMITS) {
                    const frame = frameOver(WHOLE_TERRAIN);
                    const blocked = blockedCells(terrain, frame, limit);
                    for (let probe = 0; probe < probes; probe += 1) {
                        const x = next() * GELAENDE_GROESSE;
                        const y = next() * GELAENDE_GROESSE;
                        checked += 1;
                        const here = reliefAt(heights, x, y);
                        if (here.kind === KIND_NONE || here.height <= limit + HEIGHT_EPS) continue;
                        above += 1;
                        const column = Math.floor((x - frame.minX) / frame.cell);
                        const row = Math.floor((y - frame.minY) / frame.cell);
                        expect(
                            blocked[row * frame.cols + column],
                            `Gelände ${String(seed)}, ${name} (Grenze ${String(limit)}), Stelle ${fixed([x, y])}, Höhe ${here.height.toFixed(1)}`,
                        ).toBe(1);
                    }
                }
            }
            if (FULL_INVARIANTS) console.warn(`Sperre: ${JSON.stringify({ checked, above })}`);
            // Der Test prüft etwas: Ein guter Teil der Stellen liegt über der Grenze.
            expect(above).toBeGreaterThan(checked / 40);
        },
        TIMEOUT,
    );
});

describe("Das Orakel der Höhenregel erkennt eine Verletzung (sonst prüfte der Rest nichts)", () => {
    const heights = gebirge(wand, [GIPFEL]);
    const limit = 800;
    const oracle = new FlugOrakel(heights, limit, WHOLE_TERRAIN);

    it("eine gerade Linie durch die Wand ist ein Verstoß; um sie herum nicht", () => {
        const c: Point = [20, 50];
        const d: Point = [80, 50];
        const straight = oracle.pruefe(c, d, [c, d]);
        expect(straight.verstoesse).toBeGreaterThan(200);
        expect(straight.erster?.hoehe).toBeGreaterThan(limit);
        const around: Point[] = [c, [44, 72], [56, 72], d];
        expect(oracle.pruefe(c, d, around).verstoesse).toBe(0);
    });

    it("das Gebirge eines Wegpunkts im Gebirge ist Brücke, ein Stück des fremden Gebirges nicht", () => {
        const f: Point = [50, 42];
        const e: Point = [50, 90];
        // Aus der Wand nach Norden: gut 28 E über der Wand (bis y = 70), alles Heimat von F.
        const out = oracle.pruefe(f, e, [f, e]);
        expect(out.ueberGrenze).toBeGreaterThan(27);
        expect(out.verstoesse).toBe(0);
        // Nach Süden über den Gipfel bei (50|20): Er ist fremd, die Linie ein Verstoß.
        const g: Point = [50, 5];
        const through = oracle.pruefe(f, g, [f, [50, 30], g]);
        expect(through.verstoesse).toBeGreaterThan(0);
    });

    it("ein Tal erlaubt nur seinen umschließenden Ring, kein fremdes Hindernis", () => {
        const ring = gebirge(
            (x, y) => x >= 30 && x <= 70 && y >= 30 && y <= 70 && !(x > 36 && x < 64 && y > 36 && y < 68),
            [GIPFEL],
        );
        const ringOracle = new FlugOrakel(ring, limit, WHOLE_TERRAIN);
        const tal: Point = [50, 50];
        const draussen: Point = [50, 95];
        expect(ringOracle.pruefe(tal, draussen, [tal, draussen]).nische).toBe(true);
        expect(ringOracle.pruefe(tal, draussen, [tal, draussen]).verstoesse).toBe(0);
        const fremd: Point = [50, 5];
        expect(ringOracle.pruefe(tal, fremd, [tal, fremd]).verstoesse).toBeGreaterThan(0);
        expect(ringOracle.pruefe(draussen, [50, 96], [draussen, [50, 96]]).nische).toBe(false);
    });
});

describe("Die Flugbahn hält die Höhenregel (zufälliges Gelände, Wegpunkte im Freien und im Gebirge)", () => {
    const terrains = scaled(6, 24);
    const limitsPerTerrain = scaled(3, 6);
    const pairsPerLimit = scaled(6, 14);

    it(
        `🔴 nirgends Gelände über der Grenze außer an den Brücken (${String(terrains)} Gelände, je ${String(limitsPerTerrain)} Grenzen, je ${String(pairsPerLimit)} Paare)`,
        () => {
            const stats = { pairs: 0, detours: 0, straight: 0, home: 0, niches: 0 };
            for (let seed = 1; seed <= terrains; seed += 1) {
                const heights = zufallsGelaende(seed * 15485863);
                const terrain = airTerrain(heights);
                const next = random(seed * 32452843);
                for (let one = 0; one < limitsPerTerrain; one += 1) {
                    // Die Grenze des Produkts kommt je Gelände immer dran, die übrigen nach dem Zufall.
                    const { name, limit } = one === 0 ? (LIMITS[0] as (typeof LIMITS)[number]) : pick(LIMITS, next);
                    const flight = mountainAirFlight(terrain, limit);
                    const oracle = new FlugOrakel(heights, limit, WHOLE_TERRAIN);
                    const randomPoint = (): Point => [1 + next() * 98, 1 + next() * 98];
                    const freePoint = (): Point => {
                        for (;;) {
                            const found = randomPoint();
                            if (!oracle.above(found)) return found;
                        }
                    };
                    const homePoint = (): Point => {
                        for (let attempt = 0; attempt < 400; attempt += 1) {
                            const found = randomPoint();
                            if (oracle.above(found)) return found;
                        }
                        return freePoint();
                    };
                    for (let pair = 0; pair < pairsPerLimit; pair += 1) {
                        // Ein Drittel frei-frei, ein Drittel eines im Gebirge, ein Drittel beide.
                        const kind = pair % 3;
                        const from = kind === 1 || kind === 2 ? homePoint() : freePoint();
                        const to = kind === 2 ? homePoint() : freePoint();
                        const line = flight.way(punkt("von", from), punkt("nach", to));
                        const where = `Gelände ${String(seed)}, ${name} (Grenze ${String(limit)}), ${fixed(from)} -> ${fixed(to)}`;
                        if (!line) throw new Error(`${where}: der Flug findet immer einen Weg`);
                        stats.pairs += 1;
                        // Die Enden sitzen auf den Wegpunkten, jede Koordinate ist eine Zahl, die Linie nie kürzer als die Luftlinie.
                        expect(line[0], where).toEqual(from);
                        expect(line[line.length - 1], where).toEqual(to);
                        expect(
                            line.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
                            where,
                        ).toBe(true);
                        expect(lineLength(line), where).toBeGreaterThanOrEqual(
                            Math.hypot(to[0] - from[0], to[1] - from[1]) - 1e-9,
                        );
                        const befund = oracle.pruefe(from, to, line);
                        if (befund.nische) {
                            stats.niches += 1;
                        }
                        if (line.length > 2) stats.detours += 1;
                        else stats.straight += 1;
                        if (oracle.above(from) || oracle.above(to)) stats.home += 1;
                        expect(
                            befund.verstoesse,
                            `${where}: Stelle ${befund.erster ? fixed([befund.erster.x, befund.erster.y]) : "-"}, Höhe ${befund.erster?.hoehe.toFixed(1) ?? "-"}`,
                        ).toBe(0);
                    }
                }
            }
            if (FULL_INVARIANTS) console.warn(`Flugbahnen auf erzeugtem Gelände: ${JSON.stringify(stats)}`);
            // Der Test prüft etwas: Umwege, gerade Linien und Wegpunkte im Gebirge kommen vor, Nischen sind die Ausnahme.
            expect(stats.detours).toBeGreaterThan(stats.pairs / 10);
            expect(stats.straight).toBeGreaterThan(0);
            expect(stats.home).toBeGreaterThan(stats.pairs / 10);
            expect(stats.niches).toBeLessThan(stats.pairs / 10);
        },
        TIMEOUT,
    );
});

describe("Die Abwägung des Flugs (F4): nie langsamer als der Weg der Höchstflughöhe, Zuschlag nie negativ, Wegpunkte erhalten", () => {
    const terrains = scaled(6, 30);
    const pairsPerTerrain = scaled(12, 60);
    const costOf = (heights: TerrainHeights, air: RouteAir, line: readonly Point[]): number => {
        const surcharge = flightTrack(line, heights, air, model)?.surcharge;
        return lineLength(line) * SCHRITT_PER_UNIT + (surcharge ? surcharge.climbSchritt + surcharge.holdSchritt : 0);
    };

    it(
        `🔴 der gewählte Weg kostet nie mehr als der erste (die Luftlinie oder der Weg um die Höchstflughöhe), Umwege höchstens ${String(WEIGH_DETOUR * 100)} % über der Luftlinie, Enden auf den Wegpunkten (${String(terrains)} Gelände, je ${String(pairsPerTerrain)} Paare, alle Flugmittel)`,
        () => {
            const stats = { pairs: 0, detours: 0, cheaper: 0, surcharged: 0, free: 0 };
            const profiles = [
                ...model.flug.wert.profile.map((profile) => ({ air: profile.id })),
                { air: "custom", air_speed: 20, air_altitude: 60 },
            ];
            for (let seed = 1; seed <= terrains; seed += 1) {
                const heights = zufallsGelaende(seed * 49979687);
                const terrain = airTerrain(heights);
                // Die Sperre aller Flugmittel (Höchstflughöhe minus Mindestabstand): Auch der Weg der Abwägung bleibt davon frei.
                const sperre = new FlugOrakel(heights, 5000 - CLEARANCE, WHOLE_TERRAIN);
                const next = random(seed * 67867967);
                for (let pair = 0; pair < pairsPerTerrain; pair += 1) {
                    const air = airOf(pick(profiles, next) as Parameters<typeof resolveAirQuery>[1]);
                    const flight = weighedAirFlight(heights, air, model);
                    const base = mountainAirFlight(terrain, air.ceilingSchritt - CLEARANCE);
                    const from: Point = [1 + next() * 98, 1 + next() * 98];
                    const to: Point = [1 + next() * 98, 1 + next() * 98];
                    const a = punkt("von", from);
                    const b = punkt("nach", to);
                    const where = `Gelände ${String(seed)}, ${air.profile} (${String(air.altitudeSchritt)} Schritt), ${fixed(from)} -> ${fixed(to)}`;
                    const line = flight.way(a, b);
                    const first = base.way(a, b);
                    if (!line || !first) throw new Error(`${where}: der Flug findet immer einen Weg`);
                    stats.pairs += 1;
                    expect(line[0], where).toEqual(from);
                    expect(line[line.length - 1], where).toEqual(to);
                    expect(
                        line.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
                        where,
                    ).toBe(true);
                    // 🔴 Kein Stück über der Sperre: höchstens so viele Verstöße wie der Weg der Höchstflughöhe (der nur an den
                    // Brücken seiner Wegpunkte im Hochgebirge welche hat).
                    expect(sperre.pruefe(from, to, line).verstoesse, where).toBeLessThanOrEqual(
                        sperre.pruefe(from, to, first).verstoesse,
                    );
                    // Der Zuschlag ist nie negativ, auf beiden Wegen.
                    for (const candidate of [line, first]) {
                        const surcharge = flightTrack(candidate, heights, air, model)?.surcharge;
                        if (!surcharge) continue;
                        expect(surcharge.climbSchritt, where).toBeGreaterThanOrEqual(0);
                        expect(surcharge.holdSchritt, where).toBeGreaterThanOrEqual(0);
                        expect(surcharge.hours, where).toBeGreaterThanOrEqual(0);
                    }
                    // Nie langsamer als der Weg, den es ohne Abwägung gäbe: Die Kosten (Länge plus Zuschlag, beides Strecke).
                    const chosenCost = costOf(heights, air, line);
                    const firstCost = costOf(heights, air, first);
                    expect(chosenCost, where).toBeLessThanOrEqual(firstCost + 1e-6);
                    if (!liniengleich(line, first)) {
                        stats.detours += 1;
                        // Strikt günstiger, sonst bliebe es beim ersten; und höchstens so viel länger wie erlaubt.
                        expect(chosenCost, where).toBeLessThan(firstCost);
                        stats.cheaper += firstCost - chosenCost > 0 ? 1 : 0;
                        const direct = Math.hypot(to[0] - from[0], to[1] - from[1]);
                        expect(lineLength(line), where).toBeLessThan(direct * (1 + WEIGH_DETOUR) + 1e-9);
                    }
                    const zuschlag = flightTrack(line, heights, air, model)?.surcharge.hours ?? 0;
                    if (zuschlag > 0) stats.surcharged += 1;
                    else stats.free += 1;
                    // Dieselbe Etappe gibt dieselbe Linie (Zwischenspeicher), und ein frischer Flug dieselbe wieder.
                    expect(flight.way(a, b), where).toBe(line);
                    expect(liniengleich(weighedAirFlight(heights, air, model).way(a, b) as Point[], line), where).toBe(
                        true,
                    );
                }
            }
            if (FULL_INVARIANTS) console.warn(`Abwägung auf erzeugtem Gelände: ${JSON.stringify(stats)}`);
            // Der Test prüft etwas: Umwege kommen vor, ebenso Flüge mit und ohne Zuschlag.
            expect(stats.pairs).toBeGreaterThan(0);
            expect(stats.detours).toBeGreaterThan(0);
            expect(stats.surcharged).toBeGreaterThan(0);
            expect(stats.free).toBeGreaterThan(0);
        },
        TIMEOUT,
    );
});

/** Ein Flugmittel nach Namen, oder das eigene mit Tempo und Reisehöhe. */
function airOf(query: Parameters<typeof resolveAirQuery>[1]): RouteAir {
    const resolved = resolveAirQuery(model, query);
    if (!resolved.ok || !resolved.air) throw new Error("Flugmittel erwartet");
    return resolved.air;
}

const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};

describe("Flugreisen im Rechendienst: Höhenregel, Wegpunkte und Kennzahlen (Wand und Gipfel, zufällige Reisen)", () => {
    const journeys = scaled(24, 1000);
    // Wand und Gipfel über der Grenze aller Flugmittel (6.000 > 4.800), wie die Quelle des Dienstes.
    const heights = wandHoch();
    const places = new Map(WAND_ORTE.map((one) => [one.id, [one.x, one.y] as Point]));
    const oracles = new Map<number, FlugOrakel>();
    const oracleFor = (limit: number): FlugOrakel => {
        let found = oracles.get(limit);
        if (!found) {
            found = new FlugOrakel(heights, limit, WHOLE_TERRAIN);
            oracles.set(limit, found);
        }
        return found;
    };

    it(
        `🔴 ${String(journeys)} zufällige Reisen: Höhenregel gegen das Echo, Wegpunkte erhalten, Länge nie unter der Luftlinie`,
        async () => {
            const service = new RouteService({ mapDomain: "aventuria", model, source: wandQuelle() });
            const next = random(20260929);
            let legs = 0;
            let detours = 0;
            for (let journey = 0; journey < journeys; journey += 1) {
                // Zwei bis fünf Wegpunkte: Orte und Kartenpunkte, hin und wieder derselbe zweimal hintereinander.
                const count = 2 + Math.floor(next() * 4);
                const ids: string[] = [];
                for (let index = 0; index < count; index += 1) {
                    if (index > 0 && next() < 0.12) ids.push(ids[index - 1] as string);
                    else if (next() < 0.5) ids.push(pick([...places.keys()], next));
                    else ids.push(mapPointId({ x: 1 + next() * 98, y: 1 + next() * 98 }));
                }
                const air =
                    next() < 0.75
                        ? airOf({ air: pick(model.flug.wert.profile, next).id })
                        : airOf({
                              air: "custom",
                              air_speed: Math.round((5 + next() * 200) * 10) / 10,
                              air_altitude: Math.round(30 + next() * 600),
                          });
                const where = `Reise ${String(journey)} (${ids.join(",")}, ${air.profile}, ${String(air.altitudeSchritt)} Schritt)`;
                const outcome = await service.route({ ...zuFuss, waypoints: ids, air, hoursPerDay: 8 });
                if (!outcome.ok) throw new Error(`${where}: ${outcome.error} ${outcome.detail}`);
                const { response } = outcome;
                expect(response.found, where).toBe(true);
                // Die Kennzahlen der Höhenregel stehen im Echo: höchstens Reisehöhe mal 1.000 % über Grund, höchstens
                // 5.000 Schritt über dem Meer, für alle Flugmittel.
                expect(response.air, where).toEqual({
                    profile: air.profile,
                    speed_mph: air.speedMph,
                    altitude_schritt: air.altitudeSchritt,
                    max_above_ground_schritt: air.altitudeSchritt * 10,
                    ceiling_schritt: 5000,
                });
                // Die Wegpunkte bleiben, wie sie verlangt wurden, und jedes Paar ist eine Etappe.
                expect(
                    response.waypoints.map((waypoint) => waypoint.id),
                    where,
                ).toEqual(ids);
                expect(response.legs, where).toHaveLength(ids.length - 1);
                const limit = (response.air?.ceiling_schritt ?? 0) - CLEARANCE;
                expect(limit, where).toBe(PRODUCT_LIMIT);
                expect(response.air?.max_above_ground_schritt, where).toBe(
                    airMaxAboveGround(model, air.altitudeSchritt),
                );
                const oracle = oracleFor(limit);
                const position = (id: string): Point => {
                    const known = places.get(id);
                    if (known) return known;
                    const [, x, y] = id.split(":");
                    return [Number(x), Number(y)];
                };
                let sum = 0;
                let straightSum = 0;
                for (const [index, leg] of response.legs.entries()) {
                    const from = position(ids[index] as string);
                    const to = position(ids[index + 1] as string);
                    if (ids[index] === ids[index + 1]) {
                        expect(leg.segment_count, where).toBe(0);
                        continue;
                    }
                    expect(leg.segment_count, where).toBe(1);
                    const segment = response.segments[leg.segment_start];
                    if (!segment) throw new Error(`${where}: Abschnitt fehlt`);
                    expect(segment.subtype, where).toBe("Flug");
                    const line = segment.geometry.coordinates as Point[];
                    legs += 1;
                    if (line.length > 2) detours += 1;
                    expect(line[0], where).toEqual(from);
                    expect(line[line.length - 1], where).toEqual(to);
                    const befund = oracle.pruefe(from, to, line);
                    expect(
                        befund.verstoesse,
                        `${where}, Etappe ${String(index)}: Stelle ${befund.erster ? fixed([befund.erster.x, befund.erster.y]) : "-"}`,
                    ).toBe(0);
                    expect(segment.distance_units, where).toBeCloseTo(lineLength(line), 9);
                    // F4: Die Zeit ist die Luftlinienzeit der Linie plus der Zuschlag über der Reisehöhe, und der ist nie negativ.
                    const zuschlag = segment.air_extra?.extra_hours ?? Number.NaN;
                    expect(zuschlag, where).toBeGreaterThanOrEqual(0);
                    expect(segment.air_extra?.climb_hours ?? Number.NaN, where).toBeGreaterThanOrEqual(0);
                    expect(segment.air_extra?.hold_hours ?? Number.NaN, where).toBeGreaterThanOrEqual(0);
                    expect(zuschlag, where).toBeCloseTo(
                        (segment.air_extra?.climb_hours ?? Number.NaN) + (segment.air_extra?.hold_hours ?? Number.NaN),
                        12,
                    );
                    expect(segment.travel_hours, where).toBeCloseTo(
                        (segment.distance_units * 3) / air.speedMph + zuschlag,
                        9,
                    );
                    sum += segment.distance_units;
                    straightSum += Math.hypot(to[0] - from[0], to[1] - from[1]);
                }
                expect(response.distance_units, where).toBeGreaterThanOrEqual(0);
                expect(response.distance_units, where).toBeCloseTo(sum, 9);
                expect(response.distance_units, where).toBeGreaterThanOrEqual(straightSum - 1e-9);
            }
            if (FULL_INVARIANTS) console.warn(`Flugreisen im Dienst: ${JSON.stringify({ journeys, legs, detours })}`);
            expect(legs).toBeGreaterThan(journeys);
            expect(detours).toBeGreaterThan(0);
        },
        TIMEOUT,
    );
});

describe("Terrain-Revision: der Flug lädt die Hindernisse neu, wenn sie sich ändert, sonst nicht", () => {
    /**
     * Wie oft das Gelände eines Stands für den Flug vorbereitet wurde: `airTerrain` läuft einmal über die Stützwerte und
     * liest dazu die Länge genau einmal (`highestOf`). Früher zählte der Test den Iterator; der Durchlauf zählt mit
     * Zähler statt `for…of`, weil das über dem Domain-Raster zehnmal so langsam war (WI-0117).
     */
    const prepared = { count: 0 };
    /** Ein frisches Gelände mit gezählten Stützwerten. */
    const gelaende = (hoch: (x: number, y: number) => boolean, cones: TerrainHeights["cones"] = []): TerrainHeights => {
        const one = gebirge(hoch, cones, HOCH_WAND);
        const raster = one.rasters[0];
        if (!raster) throw new Error("Raster erwartet");
        const samples = new Uint16Array(raster.samples.length);
        samples.set(raster.samples);
        const length = samples.length;
        Object.defineProperty(samples, "length", {
            get: () => {
                prepared.count += 1;
                return length;
            },
        });
        return { ...one, rasters: [{ ...raster, samples }] };
    };

    it("die Vorbereitung des Geländes gilt für dieses Gelände und wird nicht wiederholt", () => {
        const start = prepared.count;
        const one = gelaende(wand);
        expect(prepared.count - start).toBe(0);
        const first = airTerrain(one);
        expect(prepared.count - start).toBe(1);
        expect(Object.is(airTerrain(one), first)).toBe(true);
        expect(prepared.count - start).toBe(1);
        // Ein neu geladenes Gelände, auch mit gleichem Inhalt, ist ein anderes Objekt und wird neu vorbereitet.
        const other = gelaende(wand);
        expect(Object.is(airTerrain(other), first)).toBe(false);
        expect(prepared.count - start).toBe(2);
    });

    const base: RoutingDataRevision = {
        map: "m1",
        travelModel: "modell",
        terrain: "g1",
        pathProfiles: "p1",
        seaGraph: "s1",
        climate: "c1",
        territories: "z1",
        settings: "z1",
        settingsLive: "z2",
    };
    const query = { ...zuFuss, waypoints: ["c", "d"], air: airOf({ air: "witchFlight" }) };

    /** Ein Dienst über der Datenbankquelle: welche Bestandteile je Stand verlangt wurden, welches Gelände zu welcher Revision. */
    function dienst() {
        let aktuell = base;
        const verlangt: string[][] = [];
        const reads: RoutingReads = {
            revision: async () => aktuell,
            data: async (_database, _domain, _model, wanted) => {
                verlangt.push([...wanted]);
                const parts: Partial<RoutingParts> = {};
                if (wanted.has("network")) parts.network = wandNetz();
                if (wanted.has("water")) parts.water = { ...NO_WATER };
                if (wanted.has("land")) parts.land = { ...NO_WATER };
                if (wanted.has("rivers")) parts.rivers = { ...NO_RIVERS };
                if (wanted.has("ground")) parts.ground = { ...NO_GROUND };
                if (wanted.has("climate")) parts.climate = { ...NO_CLIMATE };
                // Die Wand steht in g1 zwischen C und D, in g2 fehlt sie, in g3 steht sie weiter im Norden.
                if (wanted.has("heights")) {
                    parts.heights =
                        aktuell.terrain === null
                            ? null
                            : aktuell.terrain === "g2"
                              ? gelaende(() => false)
                              : aktuell.terrain === "g3"
                                ? gelaende((x, y) => x >= 45 && x <= 55 && y >= 60 && y <= 95)
                                : gelaende(wand, [GIPFEL_HOCH]);
                }
                return parts;
            },
        };
        const source = databaseRoutingSource({ art: "transaktion" } as unknown as Queryable, "aventuria", model, reads);
        const service = new RouteService({
            mapDomain: "aventuria",
            model,
            source,
            recheckMs: Number.POSITIVE_INFINITY,
        });
        return {
            service,
            verlangt,
            aendere: async (teil: Partial<RoutingDataRevision>): Promise<void> => {
                aktuell = { ...aktuell, ...teil };
                await service.refresh();
            },
            fliege: async (waypoints: string[] = query.waypoints) => {
                const outcome = await service.route({ ...query, waypoints });
                if (!outcome.ok) throw new Error(`${outcome.error} ${outcome.detail}`);
                return outcome.response;
            },
        };
    }

    const linie = (response: { segments: { geometry: { coordinates: unknown } }[] }): string =>
        JSON.stringify(response.segments[0]?.geometry.coordinates);

    it("🔴 gleiche Revision: dieselben Hindernisse, nicht neu vorbereitet; geänderte Revision: neu geladen, neu vorbereitet, neue Linie", async () => {
        const one = dienst();
        await one.service.refresh();
        const start = prepared.count;
        const vorbereitet = (): number => prepared.count - start;
        // g1: Die Wand steht zwischen C und D, die Hexe fliegt um sie herum.
        const first = await one.fliege();
        expect(first.terrain_revision).toBe(partKey("g1"));
        expect((first.segments[0]?.geometry.coordinates as unknown[]).length).toBeGreaterThan(2);
        expect(vorbereitet()).toBe(1);
        await one.fliege();
        await one.fliege(["a", "b"]);
        expect(vorbereitet()).toBe(1);

        // Nur die Karte ändert sich: Der neue Stand übernimmt das Gelände, die Hindernisse bleiben vorbereitet.
        await one.aendere({ map: "m2" });
        expect(one.verlangt[1]).not.toContain("heights");
        const sameTerrain = await one.fliege();
        expect(sameTerrain.routing_graph_revision).not.toBe(first.routing_graph_revision);
        expect(sameTerrain.terrain_revision).toBe(first.terrain_revision);
        expect(linie(sameTerrain)).toBe(linie(first));
        expect(vorbereitet()).toBe(1);

        // Das Gelände ändert sich (die Wand fehlt): Es wird allein neu geladen, der Flug bereitet die Hindernisse neu
        // vor und fliegt geradeaus.
        await one.aendere({ terrain: "g2" });
        expect(one.verlangt[2]).toEqual(["heights"]);
        const gone = await one.fliege();
        expect(gone.terrain_revision).toBe(partKey("g2"));
        expect(gone.terrain_revision).not.toBe(first.terrain_revision);
        expect(vorbereitet()).toBe(2);
        expect(gone.segments[0]?.geometry.coordinates).toEqual([
            [20, 50],
            [80, 50],
        ]);
        await one.fliege();
        expect(vorbereitet()).toBe(2);

        // Wieder eine andere Wand (weiter im Norden, zwischen E und H stünde sie im Weg): noch einmal neu vorbereitet.
        await one.aendere({ terrain: "g3" });
        const shifted = await one.fliege(["h", "i"]);
        expect(shifted.terrain_revision).toBe(partKey("g3"));
        expect(vorbereitet()).toBe(3);
        expect((shifted.segments[0]?.geometry.coordinates as unknown[]).length).toBeGreaterThan(2);
    });

    it("die Revision im Ergebnis ist die des Stands, auf dem geflogen wurde, auch ohne Gelände", async () => {
        const one = dienst();
        await one.service.refresh();
        const before = await one.fliege();
        await one.aendere({ terrain: null });
        const after = await one.fliege();
        expect(before.terrain_revision).toBe(partKey("g1"));
        expect(after.terrain_revision).toBeNull();
    });
});
