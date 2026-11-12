import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    airCeilingAbsolute,
    airMaxAboveGround,
    calendarDate,
    dayOfYear,
    resolveAirQuery,
    ROUTE_FLIGHT_SEARCH_LIMIT,
    type RouteAir,
} from "@avesmaps3d/shared";
import { findAirRoute, STRAIGHT_AIR_WAY, type AirPoint } from "../src/routing/air-route.ts";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { calibrateRelief, chordAbove, type TerrainHeights } from "../src/routing/relief.ts";
import { flightProfiles } from "../src/routing/water-profile.ts";
import { lineLength, type RouteRequest } from "../src/routing/router.ts";
import { RouteService, type RoutingSource } from "../src/routing/service.ts";
import { revisionOf } from "./support/routing-revision.ts";
import { NO_CLIMATE, type ClimateZones } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { NO_WATER } from "../src/routing/water.ts";

/**
 * Der Flug (WI-0051, F1): von Wegpunkt zu Wegpunkt auf der Luftlinie, je Paar ein Abschnitt und eine Etappe,
 * Reisestunden und Rast wie an Land (F-E2 = A), Start und Landung überall (F-E3 = A).
 */

const model = AVENTURIA_TRAVEL_MODEL;
const greif: RouteAir = {
    profile: "griffin",
    speedMph: 50,
    altitudeSchritt: 800,
    maxAboveGroundSchritt: airMaxAboveGround(model, 800),
    ceilingSchritt: airCeilingAbsolute(model),
};

const ort = (id: string, x: number, y: number): RouteNode => ({
    id,
    name: `Ort ${id}`,
    kind: "place",
    isHidden: false,
    x,
    y,
});

// A (100|100) und B (140|130) an einer Straße, 50 Einheiten = 150 Meilen; C (140|30) ohne Weg, 100 Einheiten
// von B. Mit dem Greifen (50 Meilen/h): A → B 3 h, B → C 6 h.
const quelle: RoutingSource = {
    revision: async () => revisionOf("r1"),
    load: async () => ({
        network: buildRouteNetwork(
            [ort("a", 100, 100), ort("b", 140, 130), ort("c", 140, 30)],
            [
                {
                    public_id: "ab",
                    name: "ab",
                    subtype: "Strasse",
                    coordinates: JSON.stringify({
                        type: "LineString",
                        coordinates: [
                            [100, 100],
                            [140, 130],
                        ],
                    }),
                    allowed_transports: null,
                    transport_domain: null,
                    flow_direction: null,
                    flow_factor: null,
                },
            ],
        ),
        // Kein Land: Ein Kartenpunkt ist für den Landweg überall „nicht an Land“, für den Flug egal.
        water: NO_WATER,
        land: NO_WATER,
        rivers: NO_RIVERS,
        ground: NO_GROUND,
        climate: NO_CLIMATE,
        revision: revisionOf("r1"),
    }),
};

const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};

const dienst = () => new RouteService({ mapDomain: "aventuria", model, source: quelle });

describe("Flugreise (findAirRoute)", () => {
    const a: AirPoint = { id: "a", name: "Ort a", x: 100, y: 100 };
    const b: AirPoint = { id: "b", name: "Ort b", x: 140, y: 130 };
    const c: AirPoint = { id: "c", name: "Ort c", x: 140, y: 30 };

    it("fliegt je Wegpunktpaar einen Abschnitt auf der Luftlinie: Meilen / Tempo", () => {
        const route = findAirRoute([a, b, c], greif, model, { hoursPerDay: 8, timed: false });
        expect(route.found).toBe(true);
        expect(route.nodeIds).toEqual(["a", "b", "c"]);
        expect(route.segments).toHaveLength(2);
        expect(route.segments[0]).toEqual({
            index: 0,
            edge_id: "flug-a-b",
            public_id: "",
            from_node: "Ort a",
            to_node: "Ort b",
            from_node_id: "a",
            to_node_id: "b",
            subtype: "Flug",
            path_name: "",
            transport_type: "griffin",
            distance_units: 50,
            cost_units: 3 / (3 * 1.19),
            cost_factor: 1,
            travel_hours: 3,
            flow_time_factor: 1,
            flow_state: "",
            synthetic: false,
            offroad: false,
            geometry: {
                type: "LineString",
                coordinates: [
                    [100, 100],
                    [140, 130],
                ],
            },
        });
        expect(route.segments[1]).toMatchObject({ edge_id: "flug-b-c", distance_units: 100, travel_hours: 6 });
        expect(route.legs).toEqual([
            { from: "a", to: "b", segmentStart: 0, segmentCount: 1, distanceUnits: 50, travelHours: 3 },
            { from: "b", to: "c", segmentStart: 1, segmentCount: 1, distanceUnits: 100, travelHours: 6 },
        ]);
        expect(route).toMatchObject({ distanceUnits: 150, travelHours: 9, arrivalHours: null, closures: [] });
        // Reisetage wie an Land: 9 h durch den 8-h-Tag des Reisemodells.
        expect(route.travelDays).toBeCloseTo(9 / 8, 12);
    });

    it("⭐ F4: Der Zuschlag über der Reisehöhe steht in der Zeit des Abschnitts, in cost_units und in air_extra; ohne Höhenmodell gibt es ihn nicht", () => {
        const zuschlag = {
            climbSchritt: 10,
            holdSchritt: 5,
            climbHours: 0.5,
            holdHours: 0.25,
            hours: 0.75,
            peakSchritt: 300,
        };
        const mit = findAirRoute([a, b], greif, model, {
            hoursPerDay: 8,
            timed: false,
            profiles: () => ({
                elevation_profile: [[0, 0]],
                air_profile: [[0, 0]],
                surcharge: zuschlag,
            }),
        });
        const segment = mit.segments[0];
        expect(segment?.travel_hours).toBeCloseTo(3.75, 12);
        expect(segment?.cost_units).toBeCloseTo(3.75 / (3 * 1.19), 12);
        expect(segment?.air_extra).toEqual({
            extra_hours: 0.75,
            climb_hours: 0.5,
            hold_hours: 0.25,
            peak_schritt: 300,
        });
        // Länge bleibt die der Linie; Reise, Etappe und Tage rechnen mit der längeren Zeit.
        expect(mit).toMatchObject({ distanceUnits: 50 });
        expect(mit.travelHours).toBeCloseTo(3.75, 12);
        expect(mit.legs[0]?.travelHours).toBeCloseTo(3.75, 12);
        expect(mit.travelDays).toBeCloseTo(3.75 / 8, 12);
        // Ohne Ergebnis des Profils (kein Höhenmodell): Luftlinienzeit, kein air_extra.
        const ohne = findAirRoute([a, b], greif, model, { hoursPerDay: 8, timed: false, profiles: () => null });
        expect(ohne.segments[0]?.travel_hours).toBe(3);
        expect(ohne.segments[0]?.air_extra).toBeUndefined();
    });

    it("zweimal derselbe Wegpunkt ist eine Etappe ohne Abschnitt, wie an Land", () => {
        const route = findAirRoute([a, a, b], greif, model, { hoursPerDay: 8, timed: false });
        expect(route.segments).toHaveLength(1);
        expect(route.nodeIds).toEqual(["a", "b"]);
        expect(route.legs.map((leg) => [leg.segmentStart, leg.segmentCount])).toEqual([
            [0, 0],
            [0, 1],
        ]);
    });

    it("⭐ F2 dockt am Weg an: Ein Weg mit Knick zählt seine Länge, keiner lässt die Etappe scheitern", () => {
        const umweg = findAirRoute([a, b], greif, model, {
            hoursPerDay: 8,
            timed: false,
            way: (from, to) => [
                [from.x, from.y],
                [from.x, to.y],
                [to.x, to.y],
            ],
        });
        expect(umweg.segments[0]?.geometry.coordinates).toHaveLength(3);
        expect(umweg.distanceUnits).toBe(70);
        expect(umweg.travelHours).toBeCloseTo((70 * 3) / 50, 12);
        const gesperrt = findAirRoute([a, b, c], greif, model, {
            hoursPerDay: 8,
            timed: false,
            way: (from, to) => (to.id === "c" ? null : STRAIGHT_AIR_WAY(from, to)),
        });
        expect(gesperrt).toMatchObject({ found: false, failedLegIndex: 1, segments: [], legs: [], travelHours: 0 });
    });

    it("🔴 Budget der Suchen (Claudio 2026-09-28): zu viele suchende Etappen weist er vor jeder Suche ab, Luftlinien zählen nicht", () => {
        const zickzack = Array.from({ length: ROUTE_FLIGHT_SEARCH_LIMIT + 2 }, (_, index) => (index % 2 === 0 ? a : b));
        let gesucht = 0;
        const zaehlend = (from: AirPoint, to: AirPoint): [number, number][] | null => {
            gesucht += 1;
            return STRAIGHT_AIR_WAY(from, to);
        };
        const zuViel = findAirRoute(zickzack, greif, model, {
            hoursPerDay: 8,
            timed: false,
            way: zaehlend,
            searches: () => true,
        });
        expect(zuViel).toMatchObject({
            found: false,
            tooLarge: `flight_legs:${String(ROUTE_FLIGHT_SEARCH_LIMIT + 1)}`,
            segments: [],
        });
        expect(gesucht).toBe(0);
        // Genau an der Grenze wird gerechnet, und Etappen auf der Luftlinie zählen nie.
        const genau = findAirRoute(zickzack.slice(1), greif, model, {
            hoursPerDay: 8,
            timed: false,
            searches: () => true,
        });
        expect(genau).toMatchObject({ found: true, tooLarge: null });
        const gerade = findAirRoute([...zickzack, ...zickzack], greif, model, {
            hoursPerDay: 8,
            timed: false,
            searches: () => false,
        });
        expect(gerade).toMatchObject({ found: true, tooLarge: null });
    });
});

describe("Flug im Rechendienst", () => {
    it("🔴 drei Wegpunkte mit Greif: Etappen, Rast mit den Reisestunden des Planers und Datum ab Reisebeginn", async () => {
        const service = dienst();
        const outcome = await service.route({
            ...zuFuss,
            waypoints: ["a", "b", "c"],
            hoursPerDay: 4,
            departure: { month: "praios", day: 1 },
            air: greif,
        });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        const route = outcome.response;
        expect(route).toMatchObject({
            found: true,
            failed_leg_index: null,
            air: {
                profile: "griffin",
                speed_mph: 50,
                altitude_schritt: 800,
                max_above_ground_schritt: 8000,
                ceiling_schritt: 5000,
            },
            distance_units: 150,
            travel_hours: 9,
            hours_per_day: 4,
            air_legs_units: [50, 100],
            warnings: [],
        });
        expect(route.segments.map((segment) => [segment.subtype, segment.transport_type, segment.edge_id])).toEqual([
            ["Flug", "griffin", "flug-a-b"],
            ["Flug", "griffin", "flug-b-c"],
        ]);
        // Eine Etappe je Wegpunktpaar, von Ort zu Ort - auch nach C, wohin kein Weg führt.
        expect(route.stages.map((stage) => [stage.type, stage.transport, stage.from.name, stage.to.name])).toEqual([
            ["Flug", "griffin", "Ort a", "Ort b"],
            ["Flug", "griffin", "Ort b", "Ort c"],
        ]);
        // F-E2: der 4-h-Tag des Planers, nicht der 12-h-Tag des Wassers. A → B: 3 h, der Tag ist zu drei
        // Vierteln voll. B → C: 1 h bis zum vollen Tag, dann 20 h Rast, 4 h, 20 h Rast, 1 h.
        expect(route.stages.map((stage) => [stage.travel_hours, stage.rest_hours])).toEqual([
            [3, 0],
            [6, 40],
        ]);
        expect(route.rest_hours).toBe(40);
        expect(route.total_hours).toBe(49);
        const aufbruch = dayOfYear("praios", 1);
        expect(route.departure).toEqual(calendarDate(aufbruch, 0));
        expect(route.stages[1]?.start_date).toEqual(calendarDate(aufbruch, 3));
        expect(route.stages[1]?.end_date).toMatchObject({ month: "praios", day: 3 });
        // Die Ankunft ist das Ende der letzten Etappe: dieselbe Uhr.
        expect(route.arrival).toEqual(route.stages[1]?.end_date);
        // Nichts vom Land: keine Steigung, kein Boden, keine Sperren.
        expect(route.slope).toBeUndefined();
        expect(route.closures).toBeUndefined();
        expect(route.seasonal_ways).toBeUndefined();
        expect(route.stages.some((stage) => stage.ground !== undefined || stage.slope !== undefined)).toBe(false);
        // Der Flug baut keinen Graphen.
        expect(service.profileCount).toBe(0);
    });

    it("🔴 Klimazone je Flugabschnitt wie an Land: nur mit Reisebeginn, aus der Linie des Abschnitts (Betreiber 2026-10-04: „Kann ja nicht sein, die Klimazonen sind bekannt.“)", async () => {
        const gefragt: [number, number][][] = [];
        const klima: ClimateZones = {
            bands: [],
            zoneOf: (coordinates) => {
                gefragt.push([...coordinates]);
                return "temperate";
            },
        };
        const mitKlima = new RouteService({
            mapDomain: "aventuria",
            model,
            source: { ...quelle, load: async () => ({ ...(await quelle.load()), climate: klima }) },
        });
        const mitDatum = await mitKlima.route({
            ...zuFuss,
            waypoints: ["a", "b", "c"],
            departure: { month: "firun", day: 15 },
            air: greif,
        });
        expect(mitDatum.ok).toBe(true);
        if (!mitDatum.ok) return;
        // Jeder Abschnitt trägt die Zone seiner Linie; die Etappen tragen das Datum, aus dem die Schneegrenze folgt.
        expect(mitDatum.response.segments.map((segment) => segment.climate_zone)).toEqual(["temperate", "temperate"]);
        expect(gefragt).toEqual([
            [
                [100, 100],
                [140, 130],
            ],
            [
                [140, 130],
                [140, 30],
            ],
        ]);
        expect(mitDatum.response.stages.every((stage) => stage.start_date && stage.end_date)).toBe(true);
        // Ohne Reisebeginn gibt es keine Jahreszeit und keine Zone, wie an Land.
        const ohneDatum = await mitKlima.route({ ...zuFuss, waypoints: ["a", "b"], air: greif });
        expect(ohneDatum.ok).toBe(true);
        if (!ohneDatum.ok) return;
        expect(ohneDatum.response.segments[0]).not.toHaveProperty("climate_zone");
    });

    it("ohne Rast mit 24 Reisestunden; ein eigenes Flugmittel mit seinem Tempo", async () => {
        const outcome = await dienst().route({
            ...zuFuss,
            waypoints: ["a", "b"],
            hoursPerDay: 24,
            air: {
                profile: "custom",
                speedMph: 12.5,
                altitudeSchritt: 250,
                maxAboveGroundSchritt: 2500,
                ceilingSchritt: 5000,
            },
        });
        expect(outcome.ok && outcome.response).toMatchObject({
            air: {
                profile: "custom",
                speed_mph: 12.5,
                altitude_schritt: 250,
                max_above_ground_schritt: 2500,
                ceiling_schritt: 5000,
            },
            travel_hours: 12,
            rest_hours: 0,
            total_hours: 12,
        });
        expect(outcome.ok && outcome.response.stages[0]).toMatchObject({ type: "Flug", transport: "custom" });
    });

    it("F-E3: Start und Landung überall - auch an einem Kartenpunkt, den der Landweg ablehnt", async () => {
        const service = dienst();
        const punkt = "p:160:130";
        expect(await service.route({ ...zuFuss, waypoints: ["b", punkt] })).toMatchObject({
            ok: false,
            error: "point_not_on_land",
        });
        const outcome = await service.route({ ...zuFuss, waypoints: ["b", punkt], air: greif });
        expect(outcome.ok && outcome.response.stages[0]?.to).toMatchObject({ point: "point", place_id: punkt });
        expect(outcome.ok && outcome.response.segments[0]).toMatchObject({
            to_node: "Kartenpunkt",
            distance_units: 20,
        });
        // Ein unbekannter Ort bleibt auch im Flug unbekannt.
        expect(await service.route({ ...zuFuss, waypoints: ["b", "gibt-es-nicht"], air: greif })).toMatchObject({
            ok: false,
            error: "unknown_waypoint",
        });
    });

    /** Das Gelände: eine Wand der Höhe `wandHoehe` Schritt quer über der Luftlinie von A nach B, sonst 100 Schritt. */
    const wandGelaende = (wandHoehe: number): TerrainHeights => {
        const cell = 0.25;
        const width = 81;
        const height = 201;
        const samples = new Uint16Array(width * height);
        for (let j = 0; j < height; j += 1) {
            for (let i = 0; i < width; i += 1) {
                const x = 110 + i * cell;
                const y = 90 + j * cell;
                samples[j * width + i] = x >= 118 && x <= 122 && y >= 95 && y <= 135 ? wandHoehe : 100;
            }
        }
        const raster = { cell, originX: 110, originY: 90, width, height, samples, maxX: 130, maxY: 140 };
        const rule = { kind: "steigung" as const, steigung: 0.3 };
        return { rasters: [raster], cones: [], rule, mu: calibrateRelief([raster], [], rule, model) };
    };
    /** Ein Dienst über diesem Gelände. */
    const dienstMitWand = (wandHoehe: number): RouteService => {
        const heights = wandGelaende(wandHoehe);
        return new RouteService({
            mapDomain: "aventuria",
            model,
            source: { ...quelle, load: async () => ({ ...(await quelle.load()), heights }) },
        });
    };
    const airOf = (id: string): RouteAir => {
        const resolved = resolveAirQuery(model, { air: id });
        if (!resolved.ok || !resolved.air) throw new Error(`${id} erwartet`);
        return resolved.air;
    };

    it("🔴 F2 (Betreiber 2026-10-04): Eine Wand über 5.000 − 200 Schritt umfliegt jedes Flugmittel, auf derselben Linie; der Greif fliegt nicht mehr darüber", async () => {
        const service = dienstMitWand(6000);
        const hexe = airOf("witchFlight");
        // Dieselbe absolute Höchstflughöhe für alle: Die Grenze ist 4.800, nicht mehr die Reisehöhe mal 1.000 %.
        expect(hexe.ceilingSchritt - model.flug.wert.mindestabstandSchritt).toBe(4800);
        expect(greif.ceilingSchritt).toBe(hexe.ceilingSchritt);
        const umweg = await service.route({ ...zuFuss, waypoints: ["a", "b"], air: hexe });
        expect(umweg.ok).toBe(true);
        if (!umweg.ok) return;
        const segment = umweg.response.segments[0];
        if (!segment) throw new Error("Abschnitt erwartet");
        const linie = segment.geometry.coordinates as [number, number][];
        expect(linie.length).toBeGreaterThan(2);
        expect(linie[0]).toEqual([100, 100]);
        expect(linie[linie.length - 1]).toEqual([140, 130]);
        // Länge und Zeit rechnen über die gelieferte Linie.
        expect(segment.distance_units).toBeCloseTo(lineLength(linie), 9);
        expect(segment.distance_units).toBeGreaterThan(50);
        // F4: Luftlinienzeit plus der Zuschlag über der Reisehöhe (hier nur der kleine am Rand der Wand).
        expect(segment.air_extra?.extra_hours).toBeGreaterThanOrEqual(0);
        expect(segment.air_extra?.extra_hours).toBeLessThan(0.5);
        expect(segment.travel_hours).toBeCloseTo(
            (segment.distance_units * 3) / 40 + (segment.air_extra?.extra_hours ?? Number.NaN),
            9,
        );
        expect(umweg.response.air).toEqual({
            profile: "witchFlight",
            speed_mph: 40,
            altitude_schritt: 100,
            max_above_ground_schritt: airMaxAboveGround(model, 100),
            ceiling_schritt: airCeilingAbsolute(model),
        });
        // Dieselbe Sperre für alle (4.800): Auch der Greif umfliegt die Wand und fliegt nicht darüber. Die Linie selbst kann
        // sich je Flugmittel unterscheiden: Seit F4b sucht und feilt der Flug nach dem Zuschlag, und der hängt an der Reisehöhe.
        const greifFlug = await service.route({ ...zuFuss, waypoints: ["a", "b"], air: greif });
        expect(greifFlug.ok).toBe(true);
        if (!greifFlug.ok) return;
        const greifLinie = greifFlug.response.segments[0]?.geometry.coordinates as [number, number][];
        expect(greifLinie.length).toBeGreaterThan(2);
        for (const weg of [linie, greifLinie]) {
            for (let index = 1; index < weg.length; index += 1) {
                const [x0, y0] = weg[index - 1] as [number, number];
                const [x1, y1] = weg[index] as [number, number];
                expect(chordAbove(wandGelaende(6000), { x: x0, y: y0 }, { x: x1, y: y1 }, 4800)).toBe(false);
            }
        }
        expect(lineLength(greifLinie)).toBeLessThan(lineLength(linie) * 1.1);
        expect(lineLength(linie)).toBeLessThan(lineLength(greifLinie) * 1.1);
    });

    it("🔴 F2 (Betreiber 2026-10-04): Eine niedrige Wand überfliegt jedes Flugmittel auf der Luftlinie, auch ein eigenes mit nur 30 Schritt Reisehöhe (vorher große Umwege)", async () => {
        const service = dienstMitWand(600);
        const eigenes: RouteAir = {
            profile: "custom",
            speedMph: 20,
            altitudeSchritt: 30,
            maxAboveGroundSchritt: airMaxAboveGround(model, 30),
            ceilingSchritt: airCeilingAbsolute(model),
        };
        for (const air of [airOf("witchFlight"), greif, eigenes]) {
            const outcome = await service.route({ ...zuFuss, waypoints: ["a", "b"], air });
            expect(outcome.ok && outcome.response.segments[0]?.geometry.coordinates, air.profile).toEqual([
                [100, 100],
                [140, 130],
            ]);
        }
    });

    it("🔴 F4 (Betreiber 2026-10-04): Eine hohe Wand umfliegt der Flug lieber, als sie zu überfliegen; sie kostet Zeit über der Reisehöhe, und die Wahl ist nie langsamer als die Luftlinie", async () => {
        const wand = wandGelaende(3000);
        const service = dienstMitWand(3000);
        const luftlinie: [number, number][] = [
            [100, 100],
            [140, 130],
        ];
        for (const air of [airOf("witchFlight"), airOf("hippogriff"), greif]) {
            const outcome = await service.route({ ...zuFuss, waypoints: ["a", "b"], air });
            expect(outcome.ok, air.profile).toBe(true);
            if (!outcome.ok) return;
            const segment = outcome.response.segments[0];
            if (!segment) throw new Error("Abschnitt erwartet");
            const linie = segment.geometry.coordinates as [number, number][];
            // Dieselbe Rechnung für die Luftlinie, über derselben Wand.
            const gerade = findAirRoute(
                [
                    { id: "a", name: "Ort a", x: 100, y: 100 },
                    { id: "b", name: "Ort b", x: 140, y: 130 },
                ],
                air,
                model,
                {
                    hoursPerDay: 24,
                    timed: false,
                    profiles: (coordinates, distance, limit) =>
                        flightProfiles(coordinates, distance, wand, air, model, limit),
                },
            );
            // Die Wand über der Luftlinie kostet über der Reisehöhe, also weicht der Flug aus.
            expect(gerade.segments[0]?.air_extra?.extra_hours, air.profile).toBeGreaterThan(0);
            expect(linie.length, air.profile).toBeGreaterThan(2);
            expect(segment.distance_units, air.profile).toBeGreaterThan(50);
            expect(linie[0]).toEqual(luftlinie[0]);
            expect(linie[linie.length - 1]).toEqual(luftlinie[1]);
            // Nie langsamer als die Luftlinie samt ihrem Zuschlag.
            expect(outcome.response.travel_hours, air.profile).toBeLessThan(gerade.travelHours);
            // Länge und Zuschlag stehen in der Zeit.
            expect(segment.air_extra?.extra_hours ?? 0, air.profile).toBeGreaterThanOrEqual(0);
            expect(segment.travel_hours, air.profile).toBeCloseTo(
                (segment.distance_units * 3) / air.speedMph + (segment.air_extra?.extra_hours ?? 0),
                9,
            );
            // Je Etappe und für die Reise summiert, derselbe Zuschlag.
            expect(outcome.response.stages[0]?.air_extra?.extra_hours, air.profile).toBeCloseTo(
                segment.air_extra?.extra_hours ?? Number.NaN,
                12,
            );
            expect(outcome.response.air_extra?.extra_hours, air.profile).toBeCloseTo(
                segment.air_extra?.extra_hours ?? Number.NaN,
                12,
            );
        }
    });

    it("🔴 ohne air rechnet die Route wie zuvor: kein Echo, kein Flugabschnitt, der Graph des Profils", async () => {
        const service = dienst();
        const outcome = await service.route({ ...zuFuss, waypoints: ["a", "b"] });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect("air" in outcome.response).toBe(false);
        expect(outcome.response.segments.map((segment) => [segment.subtype, segment.transport_type])).toEqual([
            ["Strasse", "groupFoot"],
        ]);
        expect(outcome.response.stages[0]).toMatchObject({ type: "Strasse", transport: "groupFoot" });
        // 50 Einheiten Straße zu Fuß, mit Zeitfaktor: 150 / 4,61 × 1,19 h.
        expect(outcome.response.travel_hours).toBeCloseTo((150 / 4.4625) * 1.19, 9);
        expect(service.profileCount).toBe(1);
    });
});
