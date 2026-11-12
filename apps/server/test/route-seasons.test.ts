import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    dayOfYear,
    FREE_SEA_EDGE_PREFIX,
    type CalendarMonth,
    type SeasonWindow,
} from "@avesmaps3d/shared";
import { NO_CLIMATE, prepareClimate, type ClimateZones } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import type { SeaClosure } from "../src/routing/sea-closures.ts";
import { FreeSea } from "../src/routing/sea-free.ts";
import { RouteService } from "../src/routing/service.ts";
import { kunstSee } from "./support/kunst-see.ts";
import { revisionOf } from "./support/routing-revision.ts";
import { NO_WATER, prepareWater } from "../src/routing/water.ts";

/**
 * Reisebeginn mit Sperrzeiten und dem Boden der Jahreszeit (WI-0038, MCS-024). Die Fälle folgen
 * Legacys `sperrzeiten-routing-test.php` (avesmaps@770c80e): Fenster je Kante gegen die mitlaufende
 * Uhr (B, C), der Bericht der umgangenen Sperre (D), die Wege mit Sperrzeit ohne Reisebeginn (E).
 */

const model = AVENTURIA_TRAVEL_MODEL;
const SOMMER: SeasonWindow = { from_month: "praios", from_day: 1, to_month: "efferd", to_day: 30 };
/** Tempo zu Fuß auf der Straße (Live-Tafel, WdE) und Stunden je Zeiteinheit (3 Meilen × 1,19). */
const STRASSE = 4.4625;
const STUNDEN_JE_ZEIT = 3 * 1.19;

const ort = (id: string, x: number, y: number): RouteNode => ({ id, name: id, kind: "place", isHidden: false, x, y });

function weg(
    id: string,
    subtype: string,
    coordinates: [number, number][],
    seasons: Record<string, SeasonWindow> | null = null,
) {
    return {
        public_id: id,
        name: id,
        subtype,
        coordinates: JSON.stringify({ type: "LineString", coordinates }),
        allowed_transports: null,
        transport_domain: null,
        flow_direction: null,
        flow_factor: null,
        transport_seasons: seasons,
    };
}

/**
 * A und B verbindet ein Hochpfad (10 E, zu Fuß 2,72 Zeiteinheiten), nur im Sommer gangbar; der Umweg
 * über C läuft auf Straßen (12,8 E, 2,78) - kaum langsamer, und ganzjährig offen.
 */
function netz(options: { hochpfad?: Record<string, SeasonWindow> | null; umweg?: boolean } = {}) {
    const paths = [
        weg(
            "hochpfad",
            "Pfad",
            [
                [0, 0],
                [10, 0],
            ],
            options.hochpfad === undefined ? { groupFoot: SOMMER } : options.hochpfad,
        ),
    ];
    if (options.umweg !== false) {
        paths.push(
            weg("ac", "Strasse", [
                [0, 0],
                [5, 4],
            ]),
            weg("cb", "Strasse", [
                [5, 4],
                [10, 0],
            ]),
        );
    }
    return buildRouteNetwork([ort("A", 0, 0), ort("B", 10, 0), ort("C", 5, 4)], paths);
}

const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};
const gelaende = { land: NO_WATER, rivers: NO_RIVERS };

const am = (month: CalendarMonth, day: number, climate: ClimateZones = NO_CLIMATE) => ({
    departure: dayOfYear(month, day),
    hoursPerDay: 8,
    climate,
});

function reise(network: ReturnType<typeof netz>, stations: string[], timing: ReturnType<typeof am> | null) {
    return findRoute(network, buildRouteGraph(network, model, zuFuss, NO_WATER), stations, gelaende, timing);
}

const wege = (route: ReturnType<typeof findRoute>): string[] => route.segments.map((segment) => segment.public_id);

/** Die ganze Gegend in einer Klimazone. */
const zone = (key: string): ClimateZones =>
    prepareClimate([
        {
            key,
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [-100, -100],
                        [100, -100],
                        [100, 100],
                        [-100, 100],
                        [-100, -100],
                    ],
                ],
            },
            minX: -100,
            minY: -100,
            maxX: 100,
            maxY: 100,
        },
    ]);

describe("🔴 Ein Weg mit Sperrzeit (WI-0038)", () => {
    it("ohne Reisebeginn sperrt nichts; die Antwort nennt den Weg und sein Fenster (E)", () => {
        const route = reise(netz(), ["A", "B"], null);
        expect(wege(route)).toEqual(["hochpfad"]);
        expect(route.closures).toEqual([]);
        expect(route.seasonalWays).toEqual([
            {
                path_name: "hochpfad",
                public_ids: ["hochpfad"],
                subtype: "Pfad",
                transport: "groupFoot",
                from_node: "A",
                open_from: { month: "praios", day: 1 },
                open_to: { month: "efferd", day: 30 },
                // Ein Landweg, der im Winter zu ist: Schneemassen (Betreiber 2026-09-27, WI-0046).
                reason: "schneemassen",
            },
        ]);
    });

    it("ein Landweg, der nur im Sommer zu ist, hat keinen bekannten Grund: Es bleibt „Gesperrt“", () => {
        const route = reise(
            netz({ hochpfad: { groupFoot: { from_month: "travia", from_day: 1, to_month: "rahja", to_day: 30 } } }),
            ["A", "B"],
            null,
        );
        expect(route.seasonalWays).toHaveLength(1);
        expect(route.seasonalWays[0]).not.toHaveProperty("reason");
    });

    it("im Sommer geht die Route über den Pfad, ohne Bericht (C1)", () => {
        const route = reise(netz(), ["A", "B"], am("praios", 1));
        expect(wege(route)).toEqual(["hochpfad"]);
        expect(route.closures).toEqual([]);
        expect(route.seasonalWays).toEqual([]);
    });

    it("im Firun meidet sie ihn und meldet, wo sie abzweigt und was sie umgeht (C2, D1)", () => {
        const route = reise(netz(), ["A", "B"], am("firun", 1));
        expect(wege(route)).toEqual(["ac", "cb"]);
        expect(route.closures).toHaveLength(1);
        const [bericht] = route.closures;
        expect(bericht).toMatchObject({
            leg_index: 0,
            blocked: false,
            diverges_at_node: "A",
            diverges_at_node_id: "A",
            diverges_at_edge_id: "ac#0",
        });
        expect(bericht?.avoided).toEqual([
            {
                kind: "season",
                path_name: "hochpfad",
                public_ids: ["hochpfad"],
                subtype: "Pfad",
                transport: "groupFoot",
                from_node: "A",
                open_from: { month: "praios", day: 1 },
                open_to: { month: "efferd", day: 30 },
                reason: "schneemassen",
                reached_on: { month: "firun", day: 1, nameless: false, season: "winter", years_passed: 0 },
            },
        ]);
        expect(bericht?.unrestricted.distance_units).toBeCloseTo(10, 9);
        expect(bericht?.actual?.total_hours).toBeGreaterThan(bericht?.unrestricted.total_hours ?? Infinity);
    });

    it("das Fenster gilt nur für das Reisemittel, für das es steht (B)", () => {
        const route = reise(netz({ hochpfad: { caravan: SOMMER } }), ["A", "B"], am("firun", 1));
        expect(wege(route)).toEqual(["hochpfad"]);
        expect(route.closures).toEqual([]);
    });

    it("gibt es nur den gesperrten Weg, sagt die Route ab - mit dem Grund (D3)", () => {
        const route = reise(netz({ umweg: false }), ["A", "B"], am("firun", 1));
        expect(route.found).toBe(false);
        expect(route.seasonClosed).toBe(true);
        expect(route.failedLegIndex).toBe(0);
        expect(route.closures).toHaveLength(1);
        expect(route.closures[0]).toMatchObject({ blocked: true, actual: null, diverges_at_edge_id: "" });
        // Ohne Reisebeginn ist dieselbe Route offen.
        expect(reise(netz({ umweg: false }), ["A", "B"], null).found).toBe(true);
    });

    it("🔴 die Uhr läuft über Zwischenziele weiter: Am 30. Efferd hin, am 1. Travia zurück (C6)", () => {
        // Der Pfad dauert 9,7 Stunden; nach 8 Stunden kommt die Nacht, und man steht am 1. Travia in B.
        const route = reise(netz(), ["A", "B", "A"], am("efferd", 30));
        expect(wege(route)).toEqual(["hochpfad", "cb", "ac"]);
        expect(route.closures.map((closure) => [closure.leg_index, closure.diverges_at_node])).toEqual([[1, "B"]]);
        expect(route.closures[0]?.avoided[0]?.reached_on).toMatchObject({ month: "travia", day: 1 });
    });
});

/** Rechteckige Flächen, als Wasser oder als Land. */
function flaechen(...rechtecke: [number, number, number, number][]) {
    return prepareWater(
        rechtecke.map(([minX, minY, maxX, maxY]) => ({
            geometry: {
                type: "Polygon" as const,
                coordinates: [
                    [
                        [minX, minY],
                        [maxX, minY],
                        [maxX, maxY],
                        [minX, maxY],
                        [minX, minY],
                    ],
                ],
            },
            minX,
            minY,
            maxX,
            maxY,
        })),
    );
}

describe("🔴 Ist die See zu, geht es an Land weiter (Betreiber 2026-09-26)", () => {
    /**
     * A–B ist eine Straße. Der Hafen H liegt auf demselben Festland, erreicht aber nur einen Seeweg (im
     * Sommer offen); zwischen ihm und der Straße liegt eine Bucht. Die Insel I hat ihre eigene
     * Landfläche und ebenfalls nur einen Seeweg.
     */
    const kueste = buildRouteNetwork(
        [ort("A", 0, 0), ort("B", 40, 0), ort("H", 40, 40), ort("I", 40, 80)],
        [
            weg("ab", "Strasse", [
                [0, 0],
                [40, 0],
            ]),
            weg(
                "bh",
                "Seeweg",
                [
                    [40, 0],
                    [40, 40],
                ],
                { cargoShip: SOMMER },
            ),
            weg("hi", "Seeweg", [
                [40, 40],
                [40, 80],
            ]),
        ],
    );
    const bucht = flaechen([32, 15, 48, 25]);
    const land = { land: flaechen([-100, -100, 100, 60], [20, 70, 60, 90]), rivers: NO_RIVERS };
    const nurLand: RouteRequest = { ...zuFuss, enabled: { land: true, river: false, sea: false } };
    const route = (request: RouteRequest, stations: string[], timing: ReturnType<typeof am> | null) =>
        findRoute(kueste, buildRouteGraph(kueste, model, request, bucht), stations, land, timing);
    const inBucht = ([x, y]: number[]) =>
        (x as number) > 32 && (x as number) < 48 && (y as number) > 15 && (y as number) < 25;

    it("ein Festlandhafen ohne Landweg bekommt einen Anker um die Bucht herum - mit Aufschlag", () => {
        const reise = route(nurLand, ["A", "H"], null);
        expect(reise.found).toBe(true);
        const anker = reise.segments.find((segment) => segment.synthetic);
        expect(anker).toMatchObject({ synthetic: true, offroad: false, cost_factor: 25 });
        const linie = anker?.geometry.coordinates ?? [];
        expect(linie.length).toBeGreaterThan(2);
        expect(linie[linie.length - 1]).toEqual([40, 40]);
        expect(linie.some(inBucht)).toBe(false);
        // Der Bogen ist länger als die Sehne zur Straße (40 E).
        expect(anker?.distance_units).toBeGreaterThan(40);
    });

    /**
     * Seit der Router keine gezeichneten Seewege mehr fährt (WI-0153 Schnitt 7e), trägt die See zwischen B und H ein künstlicher
     * Seegraph; seine Sperrzeit kommt wie in der Ableitung aus einem Gebiet (Vereisung, offen nur im Sommer).
     */
    const vereisung: SeaClosure = {
        name: "Vereisung (test)",
        kind: "vereisung",
        zone: "test",
        reason: "vereisung",
        windows: { cargoShip: SOMMER, galley: SOMMER },
    };
    const see = new FreeSea(
        kunstSee({ rechteck: [38.5, 1, 41.5, 39], haefen: [ort("B", 40, 0), ort("H", 40, 40)], sperre: vereisung }),
    );
    const mitSee = (request: RouteRequest, stations: string[], timing: ReturnType<typeof am> | null) =>
        findRoute(kueste, buildRouteGraph(kueste, model, request, bucht, see), stations, land, timing);
    const aufSee = (reise: ReturnType<typeof findRoute>) =>
        reise.segments.some((segment) => segment.edge_id.startsWith(FREE_SEA_EDGE_PREFIX));

    it("im Sommer fährt das Schiff, im Firun geht es an Land - mit dem Bericht der Sperre", () => {
        const sommer = mitSee(zuFuss, ["A", "H"], am("praios", 1));
        expect(sommer.found).toBe(true);
        expect(wege(sommer)[0]).toBe("ab");
        expect(aufSee(sommer)).toBe(true);
        const winter = mitSee(zuFuss, ["A", "H"], am("firun", 1));
        expect(winter.found).toBe(true);
        expect(winter.segments.some((segment) => segment.synthetic)).toBe(true);
        expect(aufSee(winter)).toBe(false);
        expect(winter.closures).toHaveLength(1);
    });

    it("🔴 eine Insel bleibt ohne Anker: Ihre Landfläche ist eine andere", () => {
        expect(route(nurLand, ["A", "I"], null).found).toBe(false);
        // Ohne Landflächen gilt Legacys Regel: kein Anker für einen Ort, den nur Seewege erreichen.
        const ohneLand = findRoute(kueste, buildRouteGraph(kueste, model, nurLand, bucht), ["A", "H"], gelaende);
        expect(ohneLand.found).toBe(false);
    });

    /** Zwei Straßennetze, verbunden nur durch einen Wasserweg mit Fenster (Trasik, Lyngskin). */
    const netzteile = (verbindung: string, fenster: Record<string, SeasonWindow>) =>
        buildRouteNetwork(
            [ort("A", 0, 0), ort("B", 40, 0), ort("C", 40, 40), ort("D", 80, 40)],
            [
                weg("ab", "Strasse", [
                    [0, 0],
                    [40, 0],
                ]),
                weg(
                    "bc",
                    verbindung,
                    [
                        [40, 0],
                        [40, 40],
                    ],
                    fenster,
                ),
                weg("cd", "Strasse", [
                    [40, 40],
                    [80, 40],
                ]),
            ],
        );

    it("ein Netzteil, das nur die gesperrte See anbindet, bekommt im Firun eine Brücke", () => {
        // B und C verbindet die freie See (WI-0153 Schnitt 7e), im Firun vereist; der gezeichnete Seeweg dazwischen fährt nicht mehr.
        const network = netzteile("Seeweg", { cargoShip: SOMMER });
        const zwischen = new FreeSea(
            kunstSee({ rechteck: [38.5, 1, 41.5, 39], haefen: [ort("B", 40, 0), ort("C", 40, 40)], sperre: vereisung }),
        );
        const graph = buildRouteGraph(network, model, zuFuss, NO_WATER, zwischen);
        // Das Profil sieht die Teile verbunden und baut keine Brücke.
        expect(graph.bridgeCount).toBe(0);
        const marken = (reise: ReturnType<typeof findRoute>) =>
            reise.segments.map((segment) =>
                segment.edge_id.startsWith(FREE_SEA_EDGE_PREFIX)
                    ? "see"
                    : segment.synthetic
                      ? "brücke"
                      : segment.public_id,
            );
        expect(marken(findRoute(network, graph, ["A", "D"], gelaende, am("praios", 1)))).toEqual(["ab", "see", "cd"]);
        const winter = findRoute(network, graph, ["A", "D"], gelaende, am("firun", 1));
        expect(winter.found).toBe(true);
        expect(marken(winter)).toEqual(["ab", "brücke", "cd"]);
        // Ohne Reisebeginn bleibt alles wie in Legacy.
        expect(marken(findRoute(network, graph, ["A", "D"], gelaende, null))).toEqual(["ab", "see", "cd"]);
    });

    it("🔴 hinter einem gesperrten Pass gibt es keine Brücke: Die Route bleibt gesperrt", () => {
        const network = netzteile("Gebirgspass", { groupFoot: SOMMER });
        const winter = findRoute(
            network,
            buildRouteGraph(network, model, zuFuss),
            ["A", "D"],
            gelaende,
            am("firun", 1),
        );
        expect(winter.found).toBe(false);
        expect(winter.seasonClosed).toBe(true);
    });
});

describe("🔴 Der Boden der Jahreszeit (WI-0038, E2)", () => {
    const offen = netz({ hochpfad: null });

    it("im Frühling bremst die Nässe den Pass mehr als die Straße (×1,5 gegen ×1,2): Die Route nimmt die Straße", () => {
        // Ein kurzer Pass gegen eine viel längere Reichsstraße (WdE zu Fuß: Pass 12 / 8, Straße 30 / 25).
        const pass = buildRouteNetwork(
            [ort("A", 0, 0), ort("B", 10, 0), ort("C", 5, 14.7)],
            [
                weg("dachspass", "Gebirgspass", [
                    [0, 0],
                    [10, 0],
                ]),
                weg("ac", "Reichsstrasse", [
                    [0, 0],
                    [5, 14.7],
                ]),
                weg("cb", "Reichsstrasse", [
                    [5, 14.7],
                    [10, 0],
                ]),
            ],
        );
        const gemaessigt = zone("gemaessigt");
        expect(wege(reise(pass, ["A", "B"], am("praios", 1, gemaessigt)))).toEqual(["dachspass"]);
        const fruehling = reise(pass, ["A", "B"], am("peraine", 1, gemaessigt));
        expect(wege(fruehling)).toEqual(["ac", "cb"]);
        // Auch die Straße ist aufgeweicht: zu Fuß 30 / 25.
        for (const segment of fruehling.segments) {
            expect(segment.ground?.condition).toBe("aufgeweicht");
            expect(segment.ground?.factor).toBeCloseTo(30 / 25, 9);
        }
    });

    it("im Winter bremst leichter Schnee auch die Straße (+20 %), und der Abschnitt nennt ihn", () => {
        const sommer = reise(netz(), ["A", "B"], am("praios", 1, zone("gemaessigt")));
        const winter = reise(netz(), ["A", "B"], am("firun", 1, zone("gemaessigt")));
        // Der Hochpfad ist im Winter zu: Die Straße über C, zu Fuß 30 / 25 (WdE).
        expect(wege(winter)).toEqual(["ac", "cb"]);
        for (const segment of winter.segments) {
            expect(segment.ground?.condition).toBe("schnee_leicht");
            expect(segment.ground?.factor).toBeCloseTo(30 / 25, 9);
            const ohneBoden = (segment.distance_units / STRASSE) * STUNDEN_JE_ZEIT;
            expect(segment.travel_hours).toBeCloseTo((ohneBoden * 30) / 25, 9);
        }
        expect(winter.arrivalHours).toBeGreaterThan(sommer.arrivalHours ?? Infinity);
    });

    it("ohne Reisebeginn gilt kein Boden", () => {
        const route = reise(offen, ["A", "B"], null);
        expect(route.segments.every((segment) => segment.ground === undefined)).toBe(true);
        expect(route.arrivalHours).toBeNull();
    });
});

describe("Der Dienst mit Reisebeginn", () => {
    const service = (network: ReturnType<typeof netz>) =>
        new RouteService({
            mapDomain: "aventuria",
            model,
            recheckMs: 1e12,
            source: {
                revision: async () => revisionOf("r1"),
                load: async () => ({
                    network,
                    water: NO_WATER,
                    land: NO_WATER,
                    rivers: NO_RIVERS,
                    ground: NO_GROUND,
                    climate: NO_CLIMATE,
                    revision: revisionOf("r1"),
                }),
            },
        });
    const anfrage = { ...zuFuss, waypoints: ["A", "B"], hoursPerDay: 8 };

    it("nennt Abreise, Ankunft und die Tage je Etappe - mit derselben Uhr wie die Sperre (E1)", async () => {
        const out = await service(netz()).route({ ...anfrage, departure: { month: "firun", day: 1 } });
        if (!out.ok) throw new Error(out.error);
        const response = out.response;
        expect(response.departure).toMatchObject({ month: "firun", day: 1, season: "winter" });
        expect(response.closures).toHaveLength(1);
        expect(response.seasonal_ways).toBeUndefined();
        const [first] = response.stages;
        const last = response.stages[response.stages.length - 1];
        expect(first?.start_date).toMatchObject({ month: "firun", day: 1 });
        expect(last?.end_date).toEqual(response.arrival);
        // Die Uhr der Suche und die der Etappen enden gleich: Reise und Rast.
        expect(response.total_hours).toBeCloseTo(
            response.stages.reduce((sum, stage) => sum + stage.travel_hours + stage.rest_hours, 0),
            9,
        );
    });

    it("ohne Reisebeginn: kein Datum, aber die Wege mit Sperrzeit", async () => {
        const out = await service(netz()).route(anfrage);
        if (!out.ok) throw new Error(out.error);
        expect(out.response.departure).toBeUndefined();
        expect(out.response.stages[0]?.start_date).toBeUndefined();
        expect(out.response.seasonal_ways?.map((way) => way.path_name)).toEqual(["hochpfad"]);
    });

    it("nur über Gesperrtes: found falsch, Grund season_closed", async () => {
        const out = await service(netz({ umweg: false })).route({ ...anfrage, departure: { month: "firun", day: 1 } });
        if (!out.ok) throw new Error(out.error);
        expect(out.response).toMatchObject({ found: false, reason: "season_closed", failed_leg_index: 0 });
        expect(out.response.closures?.[0]?.blocked).toBe(true);
    });
});
