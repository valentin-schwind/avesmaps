import { afterEach, describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    airCeilingAbsolute,
    airMaxAboveGround,
    flightAltitude,
    type RouteAir,
} from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { NO_CLIMATE } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import type { TerrainHeights } from "../src/routing/relief.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { createInlineRunner } from "../src/routing/runner.ts";
import { RouteService, type RoutingSource } from "../src/routing/service.ts";
import {
    flightProfiles,
    flightTrack,
    groundHeightAt,
    SEA_LEVEL,
    waterSurfaceProfile,
} from "../src/routing/water-profile.ts";
import { NO_WATER } from "../src/routing/water.ts";
import type { DomainHeightSource } from "../src/terrain/domain/read.ts";
import { profileLine } from "../src/terrain/path-profiles.ts";
import { DEFAULT_CONE } from "../src/terrain/peak-cone.ts";
import { kunstSee } from "./support/kunst-see.ts";
import { revisionOf } from "./support/routing-revision.ts";

/**
 * Die Höhenlinie der Wasserabschnitte und des Flugs (WI-0065 Nachtrag 2026-10-03, Betreiber: „A. Durchgehend zeichnen.
 * Flüsse folgen dem Flussbett aus dem Geländemodell, Meer und Seen liegen auf ihrer Wasserhöhe“; „rot bei luft“).
 * Auf dem Wasser nur Anzeige: Zeiten, Steigung und Wege dürfen sich dadurch nicht ändern. Im Flug (WI-0051 F4) bestimmt
 * die Bahn den Zuschlag über der Reisehöhe, der in die Zeit und die Wahl des Wegs eingeht.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const CELL = 0.25;
const MU = { mountain: 1, peak: 1 };

/** Ein Domain-Höhenmodell über [x0, x0 + width · 0,25] × [y0, y0 + height · 0,25], die Höhe aus einer Funktion. */
function heightsOf(
    height: (x: number, y: number) => number,
    box = { x0: 95, y0: 95, width: 161, rows: 41 },
): TerrainHeights {
    const samples = new Uint16Array(box.width * box.rows);
    for (let j = 0; j < box.rows; j += 1) {
        for (let i = 0; i < box.width; i += 1) {
            samples[j * box.width + i] = Math.max(0, Math.round(height(box.x0 + i * CELL, box.y0 + j * CELL)));
        }
    }
    const domain: DomainHeightSource = {
        fingerprint: "test",
        revision: "test",
        membershipFingerprint: "test",
        mountains: [],
        raster: { cell: CELL, originX: box.x0, originY: box.y0, width: box.width, height: box.rows, samples },
    };
    return { domain, rasters: [], cones: [], rule: DEFAULT_CONE, mu: { FOOT: MU, EQUID: MU, WHEEL: MU } };
}

/** Land bis x = 110 (125 bis 175 Schritt), das Flussbett fällt bis x = 120 auf 5, dahinter Meer. */
const welt = (x: number): number => (x <= 110 ? 125 + 5 * (x - 100) : x <= 120 ? 175 - 17 * (x - 110) : 0);
const heights = heightsOf((x) => welt(x));

describe("waterSurfaceProfile: Fluss, See und Meer im Höhenmodell", () => {
    const river: [number, number][] = [
        [110, 100],
        [120, 100],
    ];
    const reversed: [number, number][] = [...river].reverse() as [number, number][];

    it("🔴 der Fluss folgt dem Flussbett: stromab fällt die Linie, stromauf steigt sie", () => {
        const down = waterSurfaceProfile("Flussweg", river, 10, heights, 256);
        expect(down?.surface).toBe("river");
        const line = down?.profile ?? [];
        expect(line[0]).toEqual([0, 175]);
        expect(line.at(-1)).toEqual([10, 5]);
        for (let i = 1; i < line.length; i += 1) {
            expect(line[i]![0]).toBeGreaterThan(line[i - 1]![0]);
            expect(line[i]![1]!).toBeLessThanOrEqual(line[i - 1]![1]!);
        }
        const up = waterSurfaceProfile("Flussweg", reversed, 10, heights, 256)?.profile ?? [];
        expect(up[0]).toEqual([0, 5]);
        expect(up.at(-1)).toEqual([10, 175]);
        for (let i = 1; i < up.length; i += 1) expect(up[i]![1]!).toBeGreaterThanOrEqual(up[i - 1]![1]!);
    });

    it("🔴 das Meer liegt auf 0, der Binnensee auf seinem ebenen Spiegel, auch wo das Ufer in die Randwerte mischt", () => {
        const sea = waterSurfaceProfile(
            "Seeweg",
            [
                [121, 100],
                [134, 100],
            ],
            13,
            heights,
            256,
        );
        expect(sea).toEqual({
            surface: "sea",
            profile: [
                [0, 0],
                [13, 0],
            ],
        });
        // Ein See von 350 Schritt zwischen x = 105 und 125; der Seeweg beginnt am Ufer und endet daran.
        const lake = heightsOf((x) => (x >= 105 && x <= 125 ? 350 : 80));
        expect(
            waterSurfaceProfile(
                "Seeweg",
                [
                    [104, 100],
                    [126, 100],
                ],
                22,
                lake,
                256,
            ),
        ).toEqual({
            surface: "lake",
            profile: [
                [0, 350],
                [22, 350],
            ],
        });
        expect(SEA_LEVEL).toBeLessThan(1);
    });

    it("streckt die Abstände auf die gemeldete Länge des Abschnitts (freie Seefahrt meldet nicht die der Linie)", () => {
        const line = waterSurfaceProfile("Flussweg", river, 20, heights, 256)?.profile ?? [];
        expect(line[0]![0]).toBe(0);
        expect(line.at(-1)![0]).toBeCloseTo(20, 9);
    });

    it("kein Land, kein Modell, keine Länge: keine Linie, nie eine erfundene Höhe", () => {
        expect(waterSurfaceProfile("Strasse", river, 10, heights, 256)).toBeNull();
        expect(waterSurfaceProfile("Pfad", river, 10, heights, 256)).toBeNull();
        expect(waterSurfaceProfile("Flussweg", river, 10, null, 256)).toBeNull();
        expect(waterSurfaceProfile("Flussweg", river, 10, undefined, 256)).toBeNull();
        expect(waterSurfaceProfile("Flussweg", river, 0, heights, 256)).toBeNull();
        expect(waterSurfaceProfile("Flussweg", [[110, 100]], 10, heights, 256)).toBeNull();
    });

    it("hält die Zahl der Punkte und behält die Enden", () => {
        const wave = heightsOf((x) => 500 + 300 * Math.sin(x));
        const line =
            waterSurfaceProfile(
                "Flussweg",
                [
                    [96, 100],
                    [130, 100],
                ],
                34,
                wave,
                20,
            )?.profile ?? [];
        expect(line.length).toBeLessThanOrEqual(20);
        expect(line[0]![0]).toBe(0);
        expect(line.at(-1)![0]).toBeCloseTo(34, 9);
    });
});

describe("flightProfiles: das Gelände unter dem Flug und die rote Flughöhe darüber", () => {
    const air: Pick<RouteAir, "altitudeSchritt" | "maxAboveGroundSchritt" | "ceilingSchritt" | "speedMph"> = {
        altitudeSchritt: 800,
        maxAboveGroundSchritt: airMaxAboveGround(model, 800),
        ceilingSchritt: airCeilingAbsolute(model),
        speedMph: 50,
    };
    const hexe: typeof air = {
        altitudeSchritt: 100,
        maxAboveGroundSchritt: airMaxAboveGround(model, 100),
        ceilingSchritt: airCeilingAbsolute(model),
        speedMph: 40,
    };
    const clearance = model.flug.wert.mindestabstandSchritt;
    const line: [number, number][] = [
        [100, 100],
        [120, 100],
    ];

    it("🔴 steigt am Start vom Boden auf die Reisehöhe und sinkt am Ziel auf den Boden, mit 1 : 4", () => {
        const flat = heightsOf(() => 0);
        const result = flightProfiles(line, 20, flat, air, model, 256);
        const path = result?.air_profile ?? [];
        // 20 E sind 60.000 Schritt, abgetastet alle 0,25 E (750 Schritt): Die Bahn steigt je Probe um 187,5.
        expect(path[0]).toEqual([0, 0]);
        expect(path[1]).toEqual([0.25, 187.5]);
        expect(path[2]).toEqual([0.5, 375]);
        expect(Math.max(...path.map(([, altitude]) => altitude))).toBe(800);
        expect(path.at(-1)).toEqual([20, 0]);
        expect(result?.elevation_profile.every(([, ground]) => ground === 0)).toBe(true);
    });

    it("🔴 über einem Grat höher als die Reisehöhe steigt sie darüber, nie unter den Boden, nie über die Höchstflughöhe", () => {
        const ridge = heightsOf((x) => (x >= 109 && x <= 111 ? 3000 : 100));
        const result = flightProfiles(line, 20, ridge, air, model, 256);
        const ground = result?.elevation_profile ?? [];
        const path = result?.air_profile ?? [];
        expect(path.length).toBe(ground.length);
        const at = (points: readonly (readonly [number, number | null])[], x: number) =>
            points.find(([distance]) => Math.abs(distance - x) < 1e-9)?.[1] ?? NaN;
        expect(at(ground, 10)).toBe(3000);
        expect(at(path, 10)).toBe(3000 + clearance);
        for (const [index, [, altitude]] of path.entries()) {
            expect(altitude).toBeGreaterThanOrEqual(ground[index]![1]!);
            expect(altitude).toBeLessThanOrEqual(Math.max(air.ceilingSchritt, ground[index]![1]!));
        }
        // Ohne Grat bleibt es bei der Reisehöhe.
        expect(Math.max(...path.slice(0, 20).map(([, altitude]) => altitude))).toBeLessThan(3200);
    });

    it("🔴 Betreiber 2026-10-04: höchstens 10 × Reisehöhe über dem Boden und 5.000 über dem Meer; der Hexenbesen steigt über einen Grat von 3.000", () => {
        // Ein breites Gebirge von 3.000 Schritt Höhe: Vorher (Höchstflughöhe über dem Meer = 1.000) blieb der Hexenbesen
        // darunter und umflog es; jetzt steigt er bis Boden + Abstand und bleibt höchstens 1.000 über dem Boden.
        const massif = heightsOf((x) => (x >= 105 && x <= 115 ? 3000 : 100));
        const result = flightProfiles(line, 20, massif, hexe, model, 1000);
        const ground = result?.elevation_profile ?? [];
        const path = result?.air_profile ?? [];
        expect(path.length).toBe(ground.length);
        expect(Math.max(...path.map(([, altitude]) => altitude))).toBe(3000 + clearance);
        for (const [index, [, altitude]] of path.entries()) {
            const boden = ground[index]![1]!;
            expect(altitude, `Probe ${String(index)}`).toBeGreaterThanOrEqual(boden);
            expect(altitude, `Probe ${String(index)}`).toBeLessThanOrEqual(
                Math.max(Math.min(hexe.ceilingSchritt, boden + hexe.maxAboveGroundSchritt), boden) + 0.1,
            );
        }
        // Der Greif (8.000 über Grund) darf bis 5.000 über dem Meer, höher nie.
        const hoch = heightsOf((x) => (x >= 105 && x <= 115 ? 4900 : 100));
        const greifPfad = flightProfiles(line, 20, hoch, air, model, 1000)?.air_profile ?? [];
        expect(Math.max(...greifPfad.map(([, altitude]) => altitude))).toBe(airCeilingAbsolute(model));
    });

    it("rechnet mit derselben Regel wie die Bahn auf der Karte (`flightAltitude` in shared), Einheiten in Schritt", () => {
        const hills = heightsOf((x, y) => 400 + 300 * Math.sin(x / 3) + 100 * Math.cos(y));
        const result = flightProfiles(line, 20, hills, air, model, 1000);
        const ground = Array.from({ length: 81 }, (_, k) => groundHeightAt(hills, 100 + k * 0.25, 100));
        const expected = flightAltitude({
            ground,
            length: 20 * 3000,
            cruise: air.altitudeSchritt,
            ceiling: air.ceilingSchritt,
            reach: air.maxAboveGroundSchritt,
            clearance,
            hold: 2 * 3000,
            slope: 0.25,
        });
        const path = result?.air_profile ?? [];
        expect(path).toHaveLength(81);
        for (const [k, [, altitude]] of path.entries()) expect(altitude).toBeCloseTo(expected[k]!, 0);
    });

    it("🔴 F4: ebenes Land und Gelände auf Reisehöhe über Grund kosten keinen Zuschlag; ein Grat darüber kostet, unabhängig von der Größe der Antwort", () => {
        const flat = heightsOf(() => 0);
        for (const mittel of [air, hexe]) {
            expect(flightProfiles(line, 20, flat, mittel, model, 256)?.surcharge).toMatchObject({
                climbSchritt: 0,
                holdSchritt: 0,
                hours: 0,
                peakSchritt: 0,
            });
        }
        // Ein sanfter Hang (10 Schritt je E): Der Greif fliegt auf seinen 800 und zahlt nichts. Der Hexenbesen folgt dem
        // Gelände mit 200 Schritt Abstand; die Bahn hält die Höhe über ± 2 E voraus (`bahn.haltenEinheiten`), liegt also
        // am Hang knapp über dem Standard - das kostet ein wenig Halten (hier unter 0,1 Stunden auf 1,5 Stunden Flug).
        const sanft = heightsOf((x) => 100 + 10 * (x - 100));
        expect(flightProfiles(line, 20, sanft, air, model, 256)?.surcharge.hours).toBe(0);
        const amHang = flightProfiles(line, 20, sanft, hexe, model, 256)?.surcharge.hours ?? NaN;
        expect(amHang).toBeGreaterThan(0);
        expect(amHang).toBeLessThan(0.1);
        // Ein Grat von 3.000 über Land von 100: Steigen und Halten über der Reisehöhe kosten Zeit, für beide Flugmittel.
        const ridge = heightsOf((x) => (x >= 109 && x <= 111 ? 3000 : 100));
        for (const mittel of [air, hexe]) {
            const result = flightProfiles(line, 20, ridge, mittel, model, 256);
            expect(result?.surcharge.climbHours, String(mittel.speedMph)).toBeGreaterThan(0);
            expect(result?.surcharge.holdHours, String(mittel.speedMph)).toBeGreaterThan(0);
            expect(result?.surcharge.hours).toBeCloseTo(
                (result?.surcharge.climbHours ?? NaN) + (result?.surcharge.holdHours ?? NaN),
                12,
            );
            // Der Zuschlag rechnet aus den ungerundeten Proben: Die Antwort mit wenigen Punkten ändert ihn nicht.
            const knapp = flightProfiles(line, 20, ridge, mittel, model, 4);
            expect(knapp?.surcharge).toEqual(result?.surcharge);
        }
        // Dieselbe Rechnung wie die Bahn: Aus den Linien selbst ist er nicht zu lesen, aber `flightTrack` liefert beides.
        const track = flightTrack(line, ridge, air, model);
        expect(track?.surcharge).toEqual(flightProfiles(line, 20, ridge, air, model, 256)?.surcharge);
        expect(track?.altitude.length).toBe(track?.samples.at.length);
    });

    it("ohne Höhenmodell keine Linien", () => {
        expect(flightProfiles(line, 20, null, air, model, 256)).toBeNull();
        expect(flightProfiles(line, 0, heights, air, model, 256)).toBeNull();
        expect(flightTrack(line, null, air, model)).toBeNull();
    });
});

describe("im Rechendienst und über HTTP", () => {
    const ids = {
        a: "aaaaaaaa-0000-4000-8000-000000000001",
        b: "bbbbbbbb-0000-4000-8000-000000000002",
        c: "cccccccc-0000-4000-8000-000000000003",
        d: "dddddddd-0000-4000-8000-000000000004",
    };
    const ort = (id: string, name: string, x: number, y: number): RouteNode => ({
        id,
        name,
        kind: "place",
        isHidden: false,
        x,
        y,
    });
    const weg = (id: string, subtype: string, coordinates: [number, number][]) => ({
        public_id: id,
        name: id,
        subtype,
        coordinates: JSON.stringify({ type: "LineString", coordinates }),
        allowed_transports: null,
        transport_domain: null,
        flow_direction: null,
        flow_factor: null,
    });
    // Land (A–B, mit gespeichertem Wegprofil), Fluss (B–C), Meer (C–D): die Reise des Betreibers im Kleinen.
    const land = profileLine(
        [
            [100, 100],
            [110, 100],
        ],
        (x) => ({ height: welt(x), mountain: false }),
        model.steigung.wert.steilAb,
    );
    const network = () =>
        buildRouteNetwork(
            [
                ort(ids.a, "Anfang", 100, 100),
                ort(ids.b, "Furt", 110, 100),
                ort(ids.c, "Mündung", 120, 100),
                ort(ids.d, "Hafen", 135, 100),
            ],
            [
                weg("pfad", "Pfad", [
                    [100, 100],
                    [110, 100],
                ]),
                weg("fluss", "Flussweg", [
                    [110, 100],
                    [120, 100],
                ]),
                weg("meer", "Seeweg", [
                    [120, 100],
                    [135, 100],
                ]),
            ],
            { profiles: new Map([["pfad", land.pairs]]), samples: new Map([["pfad", land.samples]]) },
        );
    // Das Meer zwischen Mündung und Hafen trägt ein künstlicher Seegraph: Seit WI-0153 Schnitt 7e fährt der Router den gezeichneten
    // Seeweg nicht mehr.
    const meer = kunstSee({
        rechteck: [120.5, 97, 134.5, 103],
        haefen: [ort(ids.c, "Mündung", 120, 100), ort(ids.d, "Hafen", 135, 100)],
    });
    const source = (terrain: TerrainHeights | null): RoutingSource => ({
        revision: async () => revisionOf("r1"),
        loadSea: async () => meer,
        load: async () => ({
            network: network(),
            water: NO_WATER,
            land: NO_WATER,
            rivers: NO_RIVERS,
            ground: NO_GROUND,
            climate: NO_CLIMATE,
            ...(terrain ? { heights: terrain } : {}),
            revision: revisionOf("r1"),
        }),
    });
    const service = (terrain: TerrainHeights | null) =>
        new RouteService({ mapDomain: "aventuria", model, source: source(terrain) });
    const request = {
        optimize: "fastest" as const,
        transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
        enabled: { land: true, river: true, sea: true },
        minimizeTransfers: false,
        waypoints: [ids.a, ids.d],
    };
    const ride = async (terrain: TerrainHeights | null, extra: object = {}) => {
        const outcome = await service(terrain).route({ ...request, ...extra });
        if (!outcome.ok) throw new Error(`Route erwartet: ${outcome.error}`);
        return outcome.response;
    };

    it("🔴 Land, Fluss und Meer tragen eine durchgehende Linie ihrer Art; Wasser trägt keine Steigung", async () => {
        const route = await ride(heights);
        expect(route.segments.map((segment) => [segment.subtype, segment.elevation_surface])).toEqual([
            ["Pfad", "land"],
            ["Flussweg", "river"],
            ["Seeweg", "sea"],
        ]);
        const [pfad, fluss, meer] = route.segments;
        // Das Flussbett beginnt dort, wo der Weg endet, und fällt stromab bis zum Meer.
        expect(pfad?.elevation_profile?.at(-1)?.[1]).toBeCloseTo(175, 0);
        expect(fluss?.elevation_profile?.[0]?.[1]).toBeCloseTo(175, 0);
        const bed = (fluss?.elevation_profile ?? []).map(([, height]) => height as number);
        expect(bed.at(-1)).toBeCloseTo(5, 0);
        expect(bed).toEqual([...bed].sort((x, y) => y - x));
        expect(meer?.elevation_profile).toEqual([
            [0, 0],
            [meer?.distance_units, 0],
        ]);
        expect(pfad?.slope).toBeDefined();
        expect(fluss?.slope).toBeUndefined();
        expect(meer?.slope).toBeUndefined();
        expect(route.segments.some((segment) => segment.air_profile !== undefined)).toBe(false);
    });

    it("🔴 Reisezeit, Steigung und Wege bleiben unberührt: dieselbe Antwort wie ohne Höhenmodell, bis auf die neuen Linien", async () => {
        // Alles außer den neuen Linien: Zeiten, Wege, Steigung, Etappen, Summen.
        const strip = (route: Awaited<ReturnType<typeof ride>>) => ({
            ...route,
            segments: route.segments.map((segment) => {
                const rest = { ...segment };
                delete rest.elevation_profile;
                delete rest.elevation_surface;
                delete rest.air_profile;
                return rest;
            }),
        });
        const withDem = await ride(heights);
        const without = await ride(null);
        expect(withDem.segments.every((segment) => segment.elevation_profile !== undefined)).toBe(true);
        expect(
            without.segments.filter((segment) => segment.subtype !== "Pfad").every((s) => !s.elevation_profile),
        ).toBe(true);
        expect(strip(withDem)).toEqual(strip(without));
        // Die Zusammenfassung der Reise bleibt auf Land bezogen: nur der Pfad geht ein, kein Wasser.
        expect(withDem.slope?.covered_miles).toBeCloseTo(10 * model.meilenJeKarteneinheit.wert, 6);
        expect(withDem.slope?.highest_schritt).toBeCloseTo(175, 0);
        expect(withDem.stages.filter((stage) => stage.slope !== undefined)).toHaveLength(1);
    });

    it("🔴 ein Flug trägt das Gelände darunter und die rote Flughöhe; Zeit und Länge bleiben, die Steigung fehlt", async () => {
        const flight = {
            air: {
                profile: "griffin",
                speedMph: 50,
                altitudeSchritt: 800,
                maxAboveGroundSchritt: airMaxAboveGround(model, 800),
                ceilingSchritt: airCeilingAbsolute(model),
            },
        };
        const route = await ride(heights, flight);
        const segment = route.segments[0];
        expect(segment?.subtype).toBe("Flug");
        expect(segment?.elevation_surface).toBe("land");
        const ground = segment?.elevation_profile ?? [];
        const path = segment?.air_profile ?? [];
        expect(ground[0]?.[1]).toBe(125);
        expect(ground.at(-1)?.[1]).toBe(0);
        expect(path[0]).toEqual([0, 125]);
        expect(path.at(-1)).toEqual([segment?.distance_units, 0]);
        expect(Math.max(...path.map(([, altitude]) => altitude))).toBe(800);
        expect(segment?.slope).toBeUndefined();
        expect(route.slope).toBeUndefined();
        const without = await ride(null, flight);
        expect(without.segments[0]?.elevation_profile).toBeUndefined();
        expect(without.segments[0]?.air_profile).toBeUndefined();
        expect(without.travel_hours).toBe(route.travel_hours);
        expect(without.distance_units).toBe(route.distance_units);
    });

    describe("HTTP: der Serialisierer lässt kein Feld still weg", () => {
        let app: FastifyInstance | undefined;
        afterEach(async () => {
            await app?.close();
            app = undefined;
        });
        const get = async (url: string) => {
            app = buildApp({
                config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
                routeRunner: createInlineRunner(service(heights)),
            });
            return app.inject({ method: "GET", url });
        };

        it("Land, Fluss und Meer samt Art", async () => {
            const response = await get(`/api/route?waypoints=${ids.a},${ids.d}`);
            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(
                body.segments.map(
                    (segment: { subtype: string; elevation_surface: string; elevation_profile: unknown[] }) => [
                        segment.subtype,
                        segment.elevation_surface,
                        segment.elevation_profile.length > 1,
                    ],
                ),
            ).toEqual([
                ["Pfad", "land", true],
                ["Flussweg", "river", true],
                ["Seeweg", "sea", true],
            ]);
            expect(body.segments[1].elevation_profile[0][1]).toBeCloseTo(175, 0);
            expect(body.segments[2].elevation_profile).toEqual([
                [0, 0],
                [body.segments[2].distance_units, 0],
            ]);
        });

        it("der Flug samt air_profile", async () => {
            const response = await get(`/api/route?waypoints=${ids.a},${ids.d}&air=griffin`);
            expect(response.statusCode).toBe(200);
            const [segment] = response.json().segments;
            expect(segment.subtype).toBe("Flug");
            expect(segment.elevation_surface).toBe("land");
            expect(segment.elevation_profile.length).toBeGreaterThan(2);
            expect(segment.air_profile.length).toBeGreaterThan(2);
            expect(Math.max(...segment.air_profile.map(([, altitude]: [number, number]) => altitude))).toBe(800);
        });
    });
});
