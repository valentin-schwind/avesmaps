import { afterEach, describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    dayOfYear,
    isSnowCondition,
    mapPointId,
    snowlineHeight,
    type CalendarMonth,
    type RouteResponse,
    type TravelModel,
} from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { prepareClimate, type ClimateZones } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import { createInlineRunner } from "../src/routing/runner.ts";
import { RouteService } from "../src/routing/service.ts";
import { NO_WATER, prepareWater } from "../src/routing/water.ts";
import { profileLine } from "../src/terrain/path-profiles.ts";
import { revisionOf } from "./support/routing-revision.ts";

/**
 * Was Schnee und Eis kosten (WI-0065 Nachtrag 2026-10-04, Betreiber: „kann man hier auch listen, was der tiefschnee
 * kostet (wenn die schneegrenze überschritten wurde)“). Gezählt werden die Stunden, um die der Boden der Jahreszeit eine
 * Kante verlängert hat, wo er Schnee oder Eis ist - dieselbe Rechnung wie die Reisezeit.
 *
 * Über der Schneegrenze liegt zu jeder Jahreszeit Tiefschnee (`schneegrenze.bodenDarueber`, Betreiber 2026-10-04: „Schnee
 * über der Schneegrenze: ja, A“, dann „schnee B“), wo der Boden der Jahreszeit nicht strenger ist: in Fassung B
 * (`bodenAnteilig`) auf dem Teil jedes Wegstücks im Gebirge über der Grenze, in Fassung A nur auf Stücken, die ganz darüber
 * liegen. Der Schlitten fährt nur auf ganzen Stücken darüber, ohne Abzug.
 */

const model = AVENTURIA_TRAVEL_MODEL;

/** Dasselbe Reisemodell mit anderer Schneegrenzen-Regel. */
function mitSchneegrenze(change: (wert: TravelModel["schneegrenze"]["wert"]) => void): TravelModel {
    const wert = { ...model.schneegrenze.wert };
    change(wert);
    return { ...model, schneegrenze: { ...model.schneegrenze, wert } };
}
/** Ohne Boden über der Schneegrenze: der Stand vor der Regel. */
const ohneBergschnee = mitSchneegrenze((wert) => delete wert.bodenDarueber);
/** Fassung A: nur ganze Stücke über der Grenze. */
const fassungA = mitSchneegrenze((wert) => (wert.bodenAnteilig = false));
/** Fassung B: der Anteil über der Grenze. */
const fassungB = mitSchneegrenze((wert) => (wert.bodenAnteilig = true));

const ort = (id: string, x: number, y: number): RouteNode => ({ id, name: id, kind: "place", isHidden: false, x, y });

function weg(id: string, subtype: string, coordinates: [number, number][]) {
    return {
        public_id: id,
        name: id,
        subtype,
        coordinates: JSON.stringify({ type: "LineString", coordinates }),
        allowed_transports: null,
        transport_domain: null,
        flow_direction: null,
        flow_factor: null,
    };
}

/** Die ganze Gegend in einer Klimazone. */
const zone = (key: string): ClimateZones =>
    prepareClimate([
        {
            key,
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [-1000, -1000],
                        [1000, -1000],
                        [1000, 1000],
                        [-1000, 1000],
                        [-1000, -1000],
                    ],
                ],
            },
            minX: -1000,
            minY: -1000,
            maxX: 1000,
            maxY: 1000,
        },
    ]);

const zuFuss = {
    optimize: "fastest" as const,
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};

/**
 * Ein Gebirgspass von A (100|100) nach B (110|100) ganz in einer Gebirgsfläche, von 2.600 auf 2.800 Schritt und
 * zurück auf 2.650 - über der Schneegrenze der gemäßigten Zone am 1. Praios (2.500), unter der des Winters nicht.
 */
const PASS: [number, number][] = [
    [100, 100],
    [105, 100],
    [110, 100],
];
const passHeight = (x: number): number => (x <= 105 ? 2600 + 40 * (x - 100) : 2800 - 30 * (x - 105));
/** Die Enden des Passes; über HTTP muss ein Ort eine UUID sein. */
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

/** `lift` hebt oder senkt den ganzen Pass, in Schritt. */
function netz(subtype: string, mountain: boolean, lift = 0) {
    const line = profileLine(PASS, (x) => ({ height: passHeight(x) + lift, mountain }), model.steigung.wert.steilAb);
    return buildRouteNetwork([ort(A, 100, 100), ort(B, 110, 100)], [weg("pass", subtype, PASS)], {
        profiles: new Map([["pass", line.pairs]]),
        samples: new Map([["pass", line.samples]]),
    });
}

function service(network: ReturnType<typeof netz>, climate: ClimateZones, travelModel: TravelModel = model) {
    return new RouteService({
        mapDomain: "aventuria",
        model: travelModel,
        source: {
            revision: async () => revisionOf("r1"),
            load: async () => ({
                network,
                water: NO_WATER,
                land: NO_WATER,
                rivers: NO_RIVERS,
                ground: NO_GROUND,
                climate,
                revision: revisionOf("r1"),
            }),
        },
    });
}

async function reise(
    network: ReturnType<typeof netz>,
    climate: ClimateZones,
    departure: { month: CalendarMonth; day: number } | null,
    land = "groupFoot",
    travelModel: TravelModel = model,
): Promise<RouteResponse> {
    const outcome = await service(network, climate, travelModel).route({
        ...zuFuss,
        transports: { ...zuFuss.transports, land },
        waypoints: [A, B],
        hoursPerDay: 8,
        ...(departure ? { departure } : {}),
    });
    if (!outcome.ok) throw new Error(`Route erwartet: ${outcome.error}`);
    return outcome.response;
}

describe("Schnee und Eis unter den Bodenzuständen", () => {
    it("🔴 sind die Zustände, die auch Straßen bremsen - dieselben, auf denen der Schlitten fährt", () => {
        const zustaende = Object.keys(model.jahreszeitBoden.wert.zustaende);
        expect(zustaende.filter((condition) => isSnowCondition(model, condition))).toEqual(
            model.bodenPflicht.wert["sleigh"]?.zustaende,
        );
        expect(isSnowCondition(model, "aufgeweicht")).toBe(false);
        expect(isSnowCondition(model, "tauboden")).toBe(false);
        expect(isSnowCondition(model, "unbekannt")).toBe(false);
    });

    it("🔴 der Boden über der Schneegrenze ist ein Zustand der Bodentafel, und zwar Schnee", () => {
        const condition = model.schneegrenze.wert.bodenDarueber;
        expect(condition).toBe("tiefschnee");
        expect(model.jahreszeitBoden.wert.zustaende[condition ?? ""]).toBeDefined();
        expect(isSnowCondition(model, condition ?? "")).toBe(true);
        // Eingeschaltet ist Fassung B, anteilig (Betreiber 2026-10-04: „Welche Schneeregel einschalten? B“).
        expect(model.schneegrenze.wert.bodenAnteilig).toBe(true);
    });
});

describe("🔴 Die Mehrzeit durch Schnee (WI-0065 Nachtrag 2026-10-04)", () => {
    it("Winterreise: leichter Schnee auf dem Pass kostet genau die Stunden, um die der Winter länger ist", async () => {
        // Außerhalb der Gebirgsflächen: Dort gilt der Boden der Jahreszeit allein, auch über der Schneegrenze.
        const network = netz("Gebirgspass", false);
        const winter = await reise(network, zone("gemaessigt"), { month: "firun", day: 1 });
        const ohne = await reise(network, zone("gemaessigt"), null);
        const [segment] = winter.segments;
        expect(segment?.ground?.condition).toBe("schnee_leicht");
        expect(segment?.snow?.condition).toBe("schnee_leicht");
        // Gebirgspass zu Fuß, WdE: 12 trocken, 8 bei Regen oder Schnee, die Reise ist um ein Drittel ihrer Zeit länger.
        expect(segment?.ground?.factor).toBeCloseTo(12 / 8, 9);
        expect(segment?.snow?.extra_hours).toBeCloseTo((segment?.travel_hours ?? 0) / 3, 9);
        // Stunden mit Schnee minus Stunden ohne Schnee, an derselben Strecke samt Steigung.
        expect(winter.snow?.extra_hours).toBeCloseTo(winter.travel_hours - ohne.travel_hours, 9);
        expect(winter.snow?.conditions).toEqual(["schnee_leicht"]);
        // Steigung und Schnee stehen nebeneinander; die Reisezeit bleibt die der Suche.
        expect(winter.slope?.extra_hours).toBeGreaterThan(0);
        expect(winter.travel_hours).toBeCloseTo(
            winter.segments.reduce((sum, own) => sum + own.travel_hours, 0),
            12,
        );
    });

    it("Tiefschnee in der borealen Zone zählt als Schnee: im Gebirge kostet er wie leichter Schnee (WdE)", async () => {
        const network = netz("Gebirgspass", true);
        const boreal = await reise(network, zone("boreal"), { month: "firun", day: 1 });
        const ohne = await reise(network, zone("boreal"), null);
        expect(boreal.snow?.conditions).toEqual(["tiefschnee"]);
        // Gebirgspass 12 / 8: anderthalbmal so lang, ein Drittel der Zeit ist Schnee.
        expect(boreal.snow?.extra_hours).toBeCloseTo(boreal.travel_hours / 3, 9);
        expect(boreal.snow?.extra_hours).toBeCloseTo(boreal.travel_hours - ohne.travel_hours, 9);
    });

    it("🔴 Bergroute über der Schneegrenze im Sommer: Tiefschnee, zu jeder Jahreszeit (Betreiber 2026-10-04, A)", async () => {
        const network = netz("Gebirgspass", true);
        const sommer = await reise(network, zone("gemaessigt"), { month: "praios", day: 1 });
        const ohne = await reise(network, zone("gemaessigt"), null);
        expect(snowlineHeight(model, "gemaessigt", dayOfYear("praios", 1))).toBe(2500);
        // Der ganze Pass liegt darüber: der tiefste Punkt 2.600 Schritt.
        expect(sommer.segments[0]?.ground).toEqual({ condition: "tiefschnee", factor: 1.5 });
        expect(sommer.segments[0]?.snow?.condition).toBe("tiefschnee");
        // Gebirgspass 12 / 8: anderthalbmal so lang, ein Drittel der Zeit ist Schnee - samt Steigung.
        expect(sommer.travel_hours).toBeCloseTo(ohne.travel_hours * 1.5, 9);
        expect(sommer.snow?.extra_hours).toBeCloseTo(sommer.travel_hours - ohne.travel_hours, 9);
        expect(sommer.snow?.conditions).toEqual(["tiefschnee"]);
        // Der Schlitten fährt dort, weil Bergschnee liegt - seine Werte im Gebirge sind 6 trocken wie tief verschneit,
        // also ohne Mehrzeit.
        const schlitten = await reise(network, zone("gemaessigt"), { month: "praios", day: 1 }, "sleigh");
        expect(schlitten.found).toBe(true);
        expect(schlitten.segments[0]?.transport_type).toBe("sleigh");
        expect(schlitten.segments[0]?.ground).toBeUndefined();
        expect(schlitten.snow).toBeUndefined();
    });

    it("🔴 ohne `bodenDarueber` bremst die Schneegrenze nicht (der Stand vor der Regel)", async () => {
        const network = netz("Gebirgspass", true);
        const sommer = await reise(
            network,
            zone("gemaessigt"),
            { month: "praios", day: 1 },
            "groupFoot",
            ohneBergschnee,
        );
        const ohne = await reise(network, zone("gemaessigt"), null, "groupFoot", ohneBergschnee);
        expect(sommer.segments[0]?.ground).toBeUndefined();
        expect(sommer.snow).toBeUndefined();
        expect(sommer.travel_hours).toBe(ohne.travel_hours);
    });

    it("🔴 nur im Gebirge: außerhalb der Gebirgsflächen kein Tiefschnee, auch hoch über der Grenze", async () => {
        for (const fassung of [fassungA, fassungB]) {
            const flach = await reise(
                netz("Gebirgspass", false),
                zone("gemaessigt"),
                { month: "praios", day: 1 },
                "groupFoot",
                fassung,
            );
            expect(flach.segments[0]?.ground).toBeUndefined();
        }
    });

    // Am 19. Praios liegt die gemäßigte Grenze bei 2.700 Schritt: Der Pass (2.600 → 2.800 → 2.650) reicht darunter. Über
    // ihr liegen 2,5 E des Anstiegs (ab 102,5) und 3,33 E des Abstiegs (bis 108,33), 5,83 von 10 E.
    const HALB = { month: "praios", day: 19 } as const;
    const ANTEIL = (2.5 + 10 / 3) / 10;
    /** Die Mehrzeit des Tiefschnees auf dem Pass zu Fuß: 12 / 8 − 1 (WdE). */
    const MEHR = 12 / 8 - 1;

    it("🔴 Fassung A: nur ein Stück ganz über der Grenze; reicht es darunter, kein Tiefschnee", async () => {
        expect(snowlineHeight(model, "gemaessigt", dayOfYear("praios", 19))).toBe(2700);
        const halb = await reise(netz("Gebirgspass", true), zone("gemaessigt"), HALB, "groupFoot", fassungA);
        expect(halb.segments[0]?.ground).toBeUndefined();
        expect(halb.snow).toBeUndefined();
    });

    it("🔴 Fassung B: Tiefschnee auf dem Teil über der Grenze, die Kante dauert anteilig länger", async () => {
        const network = netz("Gebirgspass", true);
        const halb = await reise(network, zone("gemaessigt"), HALB, "groupFoot", fassungB);
        const ohne = await reise(network, zone("gemaessigt"), null, "groupFoot", fassungB);
        // Gebirgspass ×1,5 auf 58,3 % der Länge, sonst kein Boden (Sommer): Faktor 1 + 0,583 × 0,5.
        expect(halb.segments[0]?.ground?.condition).toBe("tiefschnee");
        expect(halb.segments[0]?.ground?.factor).toBeCloseTo(1 + ANTEIL * MEHR, 6);
        expect(halb.travel_hours).toBeCloseTo(ohne.travel_hours * (1 + ANTEIL * MEHR), 6);
        // Die Mehrzeit ist ganz Schnee, und das Höhenprofil zählt sie.
        expect(halb.snow?.extra_hours).toBeCloseTo(halb.travel_hours - ohne.travel_hours, 6);
        expect(halb.snow?.conditions).toEqual(["tiefschnee"]);
        // Liegt das ganze Stück darüber, rechnen A und B gleich.
        const sommerA = await reise(network, zone("gemaessigt"), { month: "praios", day: 1 }, "groupFoot", fassungA);
        const sommerB = await reise(network, zone("gemaessigt"), { month: "praios", day: 1 }, "groupFoot", fassungB);
        expect(sommerB.travel_hours).toBeCloseTo(sommerA.travel_hours, 9);
        expect(sommerB.segments[0]?.ground).toEqual(sommerA.segments[0]?.ground);
        expect(sommerB.snow?.extra_hours).toBeCloseTo(sommerA.snow?.extra_hours ?? 0, 9);
    });

    it("🔴 Fassung B neben Nässe: Im Gebirge kostet Nässe wie Tiefschnee, der Boden der Jahreszeit bleibt (WdE)", async () => {
        // Derselbe Pass 1.600 Schritt tiefer (1.000 → 1.200 → 1.050), am 1. Peraine: gemäßigte Grenze 1.100, Boden
        // aufgeweicht (Gebirgspass 12 / 8). Der Tiefschnee über der Grenze kostet dasselbe, ist also nicht strenger.
        expect(snowlineHeight(model, "gemaessigt", dayOfYear("peraine", 1))).toBe(1100);
        const network = netz("Gebirgspass", true, -1600);
        const fruehling = await reise(network, zone("gemaessigt"), { month: "peraine", day: 1 }, "groupFoot", fassungB);
        const ohne = await reise(network, zone("gemaessigt"), null, "groupFoot", fassungB);
        expect(fruehling.segments[0]?.ground?.condition).toBe("aufgeweicht");
        expect(fruehling.segments[0]?.ground?.factor).toBeCloseTo(1.5, 6);
        expect(fruehling.travel_hours).toBeCloseTo(ohne.travel_hours * 1.5, 6);
        // Nässe ist kein Schnee: Der Bergschnee wird erst gezählt, wo er mehr kostet als der Boden der Jahreszeit.
        expect(fruehling.snow).toBeUndefined();
    });

    it("🔴 der Schlitten fährt auch in Fassung B nur auf Stücken ganz über der Grenze (Freigabe unverändert)", async () => {
        const network = netz("Gebirgspass", true);
        const halb = await reise(network, zone("gemaessigt"), HALB, "sleigh", fassungB);
        expect(halb.segments.some((segment) => segment.transport_type === "sleigh")).toBe(false);
        const ganz = await reise(network, zone("gemaessigt"), { month: "praios", day: 1 }, "sleigh", fassungB);
        expect(ganz.segments[0]?.transport_type).toBe("sleigh");
        expect(ganz.snow).toBeUndefined();
    });

    it("🔴 der strengere Boden gilt: Im Gebirge kosten Nässe, Schnee und Eis gleich, es bleibt der Boden der Jahreszeit (WdE)", async () => {
        const network = netz("Gebirgspass", true);
        // Polar: Schneegrenze 0. Im Winter Eis (wie Tiefschnee): Es bleibt Eis.
        const polarWinter = await reise(network, zone("polar"), { month: "firun", day: 1 });
        expect(polarWinter.segments[0]?.ground?.condition).toBe("eis");
        // Im polaren Sommer nur Tauboden (Nässe): Der Tiefschnee darüber kostet dasselbe, Tauboden bleibt.
        const polarSommer = await reise(network, zone("polar"), { month: "praios", day: 1 });
        expect(polarSommer.segments[0]?.ground).toEqual({ condition: "tauboden", factor: 1.5 });
        // Gemäßigter Winter: leichter Schnee, im Gebirge über der Grenze Tiefschnee zum selben Preis: Er bleibt.
        const winter = await reise(network, zone("gemaessigt"), { month: "firun", day: 1 });
        expect(winter.segments[0]?.ground).toEqual({ condition: "schnee_leicht", factor: 1.5 });
        expect(winter.snow?.conditions).toEqual(["schnee_leicht"]);
    });

    it("Nässe zählt nicht: aufgeweichter Boden im Frühling verlängert, ist aber kein Schnee", async () => {
        const fruehling = await reise(netz("Pfad", false), zone("gemaessigt"), { month: "peraine", day: 1 });
        expect(fruehling.segments[0]?.ground?.condition).toBe("aufgeweicht");
        expect(fruehling.segments[0]?.snow).toBeUndefined();
        expect(fruehling.snow).toBeUndefined();
    });

    it("🔴 ohne Reisebeginn gibt es keinen Boden und keinen Schnee", async () => {
        const route = await reise(netz("Gebirgspass", true), zone("boreal"), null);
        expect(route.segments.every((segment) => segment.ground === undefined && segment.snow === undefined)).toBe(
            true,
        );
        expect(route.snow).toBeUndefined();
    });
});

describe("🔴 Ein Weg, den die Route durch einen Ausstieg hindurch fährt, zählt den Schnee beider Stücke", () => {
    // Ein Pfad von A nach B; der Kartenpunkt teilt ihn an seinem Ausstieg (111|100). Westlich davon nasser Winter
    // (winterfeuchte Subtropen: aufgeweicht), östlich gemäßigt (leichter Schnee). Der Pfad hat in beiden 24 / 20 (WdE).
    const network = buildRouteNetwork(
        [ort("A", 100, 100), ort("B", 120, 100)],
        [
            weg("pfad", "Pfad", [
                [100, 100],
                [105, 100],
                [110, 100],
                [115, 100],
                [120, 100],
            ]),
        ],
    );
    const P = mapPointId({ x: 111, y: 104 });
    const land = prepareWater([
        {
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [0, 0],
                        [300, 0],
                        [300, 300],
                        [0, 300],
                        [0, 0],
                    ],
                ],
            },
            minX: 0,
            minY: 0,
            maxX: 300,
            maxY: 300,
        },
    ]);
    const request: RouteRequest = zuFuss;
    const graph = buildRouteGraph(network, model, request);
    const halbiert: ClimateZones = {
        bands: [],
        zoneOf: (coordinates) => ((coordinates[0]?.[0] ?? 0) < 111 ? "subtropen_winterfeucht" : "gemaessigt"),
    };
    const timing = { departure: dayOfYear("firun", 1), hoursPerDay: 8, climate: halbiert };

    it("der Schnee des kürzeren Stücks fehlt nicht, die Nässe des längeren zählt nicht mit", () => {
        const winter = findRoute(network, graph, ["A", "B", P], { land, rivers: NO_RIVERS }, timing);
        const ohne = findRoute(network, graph, ["A", "B", P], { land, rivers: NO_RIVERS }, null);
        const [pfad] = winter.segments;
        expect(pfad?.from_node).toBe("A");
        expect(pfad?.to_node).toBe("B");
        expect(pfad?.distance_units).toBeCloseTo(20, 9);
        // Der Abschnitt nennt den Boden des längeren Stücks (11 von 20 Einheiten); der Schnee liegt auf dem kürzeren.
        expect(pfad?.ground?.condition).toBe("aufgeweicht");
        expect(pfad?.snow?.condition).toBe("schnee_leicht");
        const plain = ohne.segments[0]?.travel_hours ?? 0;
        const ostStueck = (plain * 9) / 20;
        expect(pfad?.snow?.extra_hours).toBeCloseTo(ostStueck * (24 / 20 - 1), 9);
        // Beide Stücke sind gleich gebremst: Die Hälfte der Mehrzeit ist Nässe, nicht Schnee.
        expect(pfad?.travel_hours).toBeCloseTo((plain * 24) / 20, 9);
    });
});

describe("HTTP: der Serialisierer lässt den Schnee nicht still weg", () => {
    let app: FastifyInstance | undefined;
    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    it("am Abschnitt und an der Reise", async () => {
        app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
            routeRunner: createInlineRunner(service(netz("Gebirgspass", true), zone("boreal"))),
        });
        const response = await app.inject({
            method: "GET",
            url: `/api/route?waypoints=${A},${B}&start_month=firun&start_day=1`,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json() as RouteResponse;
        expect(body.segments[0]?.snow?.condition).toBe("tiefschnee");
        expect(body.segments[0]?.snow?.extra_hours).toBeGreaterThan(0);
        expect(body.snow?.conditions).toEqual(["tiefschnee"]);
        expect(body.snow?.extra_hours).toBeCloseTo(body.segments[0]?.snow?.extra_hours ?? 0, 9);
    });
});
