import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, dayOfYear, type SeasonWindow } from "@avesmaps3d/shared";
import { prepareClimate, type ClimateZones } from "../src/routing/climate.ts";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import { NO_OFFROAD_TERRAIN } from "../src/routing/route-edge.ts";
import type { RouteTiming } from "../src/routing/closures.ts";

/**
 * WI-0082: Die Sperrmeldung erscheint auch, wenn die Route den gesperrten Weg ohnehin meidet.
 *
 * **Der Befund** (Claudio, Rollout `9b6213f`, nachgemessen in §1a): Seit der Schneeregel meidet eine Winterreise
 * den Saljethweg schon über die KOSTEN. Der Vergleichslauf ohne Sperrfenster fährt mit derselben Kalenderuhr und
 * meidet ihn ebenso - also blieb der Bericht leer, und der Reisende verlor die Auskunft „dieser Pass ist jetzt zu“.
 *
 * **Fassung C** (Betreiber 2026-10-05 „JA!“): Gemeldet wird eine Sperre, die auf der Route läge, die diese Reise
 * **ohne jede Wirkung der Jahreszeit** nähme - ohne Fenster UND ohne den Boden der Jahreszeit. Der Bericht trägt
 * `avoided_anyway`; der Hinweis nennt dann keine Zeit, weil die Route nicht wegen der Sperre länger ist.
 *
 * 🔴 **AC3, die Abgrenzung ist belegt, nicht geraten:** Keine Reise bekommt eine Meldung, die mit ihr nichts zu
 * tun hat. Dafür steht hier der Gegenfall „die Sperre liegt abseits“.
 *
 * Der Hebel dieser Fälle ist die Bodentafel (WdE S. 160-162, seit WI-0258): Aufgeweichter Boden im Frühling bremst
 * einen **Gebirgspass** zu Fuß um 12 / 8 = 1,5, eine Straße nur um 30 / 25 = 1,2. Ein kurzer Pass gegen eine etwas
 * längere Reichsstraße kippt dadurch die Wahl - genau wie der Schnee es am Saljethweg tut, nur ohne Höhenmodell.
 */

const model = AVENTURIA_TRAVEL_MODEL;

const ort = (id: string, x: number, y: number): RouteNode => ({ id, name: id, kind: "place", isHidden: false, x, y });

function weg(id: string, name: string, subtype: string, coordinates: [number, number][], seasons?: SeasonWindow) {
    return {
        public_id: id,
        name,
        subtype,
        coordinates: JSON.stringify({ type: "LineString", coordinates }),
        allowed_transports: null,
        transport_domain: null,
        flow_direction: null,
        flow_factor: null,
        ...(seasons ? { transport_seasons: { groupFoot: seasons } } : {}),
    };
}

/** Die ganze Gegend in der gemäßigten Zone: Frühling heißt dort „aufgeweicht“. */
const CLIMATE: ClimateZones = prepareClimate([
    {
        key: "gemaessigt",
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

/** Gangbar nur im Sommer und Herbst - der 1. Peraine (Frühling) liegt außerhalb. */
const SOMMER_UND_HERBST: SeasonWindow = { from_month: "praios", from_day: 1, to_month: "hesinde", to_day: 30 };

const request = (): RouteRequest => ({
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
});

const timing = (month: Parameters<typeof dayOfYear>[0], day = 1): RouteTiming => ({
    departure: dayOfYear(month, day),
    hoursPerDay: 8,
    climate: CLIMATE,
    heights: null,
});

/**
 * Zwei Wege von A nach B: der kurze „Dachsenpfad“ (10 Einheiten, Gebirgspass, im Frühling gesperrt) und der viel
 * längere „Kaiserweg“ als Reichsstraße (31 Einheiten über einen Knick). Ohne Boden ist der Pass schneller (5,43
 * gegen 6,12 Zeiteinheiten), mit aufgeweichtem Boden die Straße (8,15 gegen 7,35) - und die Straße ist zu jeder
 * Zeit offen.
 */
function netz() {
    return buildRouteNetwork(
        [ort("A", 100, 100), ort("B", 110, 100)],
        [
            weg(
                "pfad",
                "Dachsenpfad",
                "Gebirgspass",
                [
                    [100, 100],
                    [110, 100],
                ],
                SOMMER_UND_HERBST,
            ),
            weg("strasse", "Kaiserweg", "Reichsstrasse", [
                [100, 100],
                [105, 114.7],
                [110, 100],
            ]),
        ],
    );
}

const fahre = (network: ReturnType<typeof netz>, clock: RouteTiming | null) =>
    findRoute(network, buildRouteGraph(network, model, request()), ["A", "B"], NO_OFFROAD_TERRAIN, clock);

describe("die Route meidet den gesperrten Weg ohnehin - und sagt es trotzdem", () => {
    it("die Lage: ohne Jahreszeit der Pfad, im Frühling die Straße - und zwar wegen des Bodens", () => {
        const guterTag = fahre(netz(), null);
        expect(guterTag.segments.map((segment) => segment.path_name)).toEqual(["Dachsenpfad"]);
        // Im Frühling ist der Pass aufgeweicht (×1,5), die Reichsstraße nur ×1,2: Sie gewinnt.
        const fruehling = fahre(netz(), timing("peraine"));
        expect(fruehling.segments.map((segment) => segment.path_name)).toEqual(["Kaiserweg"]);
        // Im Sommer ist weder das Fenster zu noch der Boden weich: dann fährt die Reise wieder den Pfad.
        expect(fahre(netz(), timing("praios")).segments.map((segment) => segment.path_name)).toEqual(["Dachsenpfad"]);
    });

    it("🔴 der gesperrte Weg wird gemeldet, obwohl die Route ihn aus anderem Grund meidet", () => {
        const route = fahre(netz(), timing("peraine"));
        expect(route.closures).toHaveLength(1);
        const report = route.closures[0];
        expect(report?.avoided_anyway).toBe(true);
        expect(report?.blocked).toBe(false);
        expect(report?.avoided.map((way) => way.path_name)).toEqual(["Dachsenpfad"]);
        // Das Fenster und der Tag, an dem die Reise ihn erreicht hätte, stehen im Bericht.
        expect(report?.avoided[0]?.open_from).toEqual({ month: "praios", day: 1 });
        expect(report?.avoided[0]?.reached_on.month).toBe("peraine");
        // Der Abzweig liegt auf der GEFAHRENEN Route: so findet der Hinweis seine Etappe.
        expect(report?.diverges_at_node).toBe("A");
        expect(report?.diverges_at_edge_id).toBe(route.segments[0]?.edge_id);
    });

    it("🔴 die Route bleibt dieselbe - der dritte Lauf meldet nur (AC2, AC4)", () => {
        const stumm = fahre(netz(), timing("peraine"));
        // Dieselbe Reise ohne jeden Bericht gerechnet: Kantenfolge, Geometrie und Zeit sind bitgleich.
        const sommer = fahre(netz(), timing("praios"));
        expect(stumm.segments.map((segment) => segment.public_id)).toEqual(["strasse"]);
        expect(sommer.segments.map((segment) => segment.public_id)).toEqual(["pfad"]);
        const nochmal = fahre(netz(), timing("peraine"));
        expect(nochmal.segments.map((segment) => segment.edge_id)).toEqual(
            stumm.segments.map((segment) => segment.edge_id),
        );
        expect(nochmal.travelHours).toBe(stumm.travelHours);
    });

    it("ohne Reisebeginn gibt es keinen Bericht, sondern wie bisher die Wege mit Sperrzeit", () => {
        const route = fahre(netz(), null);
        expect(route.closures).toEqual([]);
        expect(route.seasonalWays.map((way) => way.path_name)).toEqual(["Dachsenpfad"]);
    });

    it("im Sommer, wenn die Reise den Weg wirklich fährt, meldet nichts", () => {
        const route = fahre(netz(), timing("praios"));
        expect(route.closures).toEqual([]);
    });
});

describe("🔴 AC3: eine Sperre abseits der Reise wird NICHT gemeldet", () => {
    /** A nach B über eine offene Straße; daneben hängt ein gesperrter Pfad in eine Sackgasse. */
    function abseits() {
        return buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 110, 100), ort("C", 100, 112)],
            [
                weg("strasse", "Kaiserweg", "Reichsstrasse", [
                    [100, 100],
                    [110, 100],
                ]),
                weg(
                    "sackgasse",
                    "Dachsenpfad",
                    "Pfad",
                    [
                        [100, 100],
                        [100, 112],
                    ],
                    SOMMER_UND_HERBST,
                ),
            ],
        );
    }

    it("die Suche berührt die Sperre, aber keine der beiden Routen benutzt sie", () => {
        const route = fahre(abseits(), timing("peraine"));
        expect(route.segments.map((segment) => segment.path_name)).toEqual(["Kaiserweg"]);
        expect(route.closures).toEqual([]);
    });
});

describe("der erste Fall bleibt, wie er war: wegen der Sperrung anders geführt", () => {
    /**
     * Der kurze Weg ist auch bei gutem Wetter der beste, nur eben gesperrt: Dann ist die Route wirklich WEGEN der
     * Sperrung länger, und der Bericht trägt kein `avoided_anyway`.
     */
    function umweg() {
        return buildRouteNetwork(
            [ort("A", 100, 100), ort("B", 110, 100)],
            [
                weg(
                    "kurz",
                    "Dachsenpfad",
                    "Strasse",
                    [
                        [100, 100],
                        [110, 100],
                    ],
                    SOMMER_UND_HERBST,
                ),
                weg("lang", "Kaiserweg", "Strasse", [
                    [100, 100],
                    [105, 120],
                    [110, 100],
                ]),
            ],
        );
    }

    it("der Vergleichslauf ohne Fenster findet den kürzeren - der alte Wortlaut gilt", () => {
        const route = fahre(umweg(), timing("peraine"));
        expect(route.segments.map((segment) => segment.path_name)).toEqual(["Kaiserweg"]);
        expect(route.closures).toHaveLength(1);
        expect(route.closures[0]?.avoided_anyway).toBeUndefined();
        expect(route.closures[0]?.avoided.map((way) => way.path_name)).toEqual(["Dachsenpfad"]);
        // Hier ist die Route wirklich länger: Das trägt die Zeitangabe des Kopfhinweises.
        expect(route.closures[0]?.actual?.total_hours ?? 0).toBeGreaterThan(
            route.closures[0]?.unrestricted.total_hours ?? 0,
        );
    });
});
