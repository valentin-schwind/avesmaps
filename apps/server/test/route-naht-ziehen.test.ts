import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { toNodes } from "../src/routing/route-result.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import { coastDistance, coastProfile } from "../src/routing/sea-coast.ts";
import { FreeSea } from "../src/routing/sea-free.ts";
import { compactSeaGraph, waterMask } from "../src/routing/sea-graph-store.ts";
import { buildSeaGrid, nearestWaterCell, prepareNavigableWater } from "../src/routing/sea-grid.ts";
import { VisibilityGraph } from "../src/routing/sea-visibility.ts";
import { NO_WATER } from "../src/routing/water.ts";

/**
 * Wie die Linie an einen Knoten gezogen wird, wenn die Lücke winzig ist (WI-0147, Befund
 * `discovery/seegraph-kehren-2026-10-14.md`, Betreiberfreigabe 2026-10-14).
 *
 * 💣 **Der Befund.** Eine freie Seereise beginnt und endet GENAU auf dem Hafenort (`SeaFleet.line` setzt die Lage des
 * Ortsknotens vor und hinter den Weg im Seegraphen), ein Landweg dagegen dort, wo er gezeichnet ist - bis 0,5 Einheiten
 * neben dem Ort (`ENDPOINT_BOX`). Die Naht klafft deshalb IMMER, die Linie wird an den Ortsknoten gezogen, und der
 * entstehende Schritt zeigt entgegen der Fahrtrichtung. Gemessen an drei Häfen: 0,002 Einheiten bei Tschorkeffskoje
 * (174,9°), 0,005 bei Paavi (168,4°). Die Karte zeichnet den Landabschnitt als Catmull-Rom über seine Linie, und dort
 * schlug die Kurve an dem Mikroschritt 0,080 beziehungsweise 0,042 Einheiten aus - das Vierzigfache des Schritts.
 *
 * 🔴 **Die Regel.** Unter `NODE_SNAP` wird der Endpunkt der Linie durch den Knoten ERSETZT, darüber bleibt er stehen
 * und der Knoten kommt davor. Oberhalb liegt der Fall, für den WI-0147 gebaut wurde: ein Wegende, das 0,33 oder 0,5
 * Einheiten neben dem Ort hängt, ist ein echtes Stück Weg und zählt in der Strecke.
 *
 * Problemfälle: der Mikroschritt bleibt; ein echtes Stück Weg verschwindet still aus der Strecke; die Linie reißt, weil
 * ein Punkt ersetzt wurde, den es nur einmal gab; die ausgewiesene Strecke passt nicht mehr zur gelieferten Linie.
 */

const model = AVENTURIA_TRAVEL_MODEL;

/** Der größte Richtungswechsel in einer Linie, in Grad; Nullschritte zählen nicht, wie im Prüfhaken des Vergleichs. */
function groessteWende(punkte: readonly (readonly [number, number])[]): number {
    const linie = punkte.filter(
        (punkt, index) => index === 0 || punkt[0] !== punkte[index - 1]?.[0] || punkt[1] !== punkte[index - 1]?.[1],
    );
    let groesste = 0;
    for (let index = 1; index < linie.length - 1; index += 1) {
        const [ax, ay] = linie[index - 1] as [number, number];
        const [bx, by] = linie[index] as [number, number];
        const [cx, cy] = linie[index + 1] as [number, number];
        const lu = Math.hypot(bx - ax, by - ay);
        const lv = Math.hypot(cx - bx, cy - by);
        if (lu < 1e-9 || lv < 1e-9) continue;
        const cos = Math.max(-1, Math.min(1, ((bx - ax) * (cx - bx) + (by - ay) * (cy - by)) / (lu * lv)));
        groesste = Math.max(groesste, (Math.acos(cos) * 180) / Math.PI);
    }
    return groesste;
}

/** Die Länge einer Linie in Karteneinheiten. */
function laenge(punkte: readonly (readonly [number, number])[]): number {
    let summe = 0;
    for (let index = 1; index < punkte.length; index += 1) {
        const [ax, ay] = punkte[index - 1] as [number, number];
        const [bx, by] = punkte[index] as [number, number];
        summe += Math.hypot(bx - ax, by - ay);
    }
    return summe;
}

describe("`toNodes`: ersetzen oder davorsetzen", () => {
    it("🔴 eine Lücke von 0,002 ersetzt den Endpunkt: kein Mikroschritt, kein Punkt mehr als vorher", () => {
        // Die Zahlen von Tschorkeffskoje: Wegende [760,550 | 678,520], Ortsknoten [760,5516 | 678,5212].
        const roh: [number, number][] = [
            [760.94, 679.55],
            [760.55, 678.52],
        ];
        const { line, extra } = toNodes(roh, undefined, { x: 760.5516, y: 678.5212 });
        expect(line).toHaveLength(2);
        expect(line[1]).toEqual([760.5516, 678.5212]);
        // Die Strecke folgt der gelieferten Linie: Das letzte Stück ist um die Verschiebung länger geworden.
        expect(laenge(roh) + extra).toBeCloseTo(laenge(line), 12);
    });

    it("eine Lücke von 0,332 bleibt ein eigener Punkt und zählt in der Strecke (WI-0147, Burg Trutzfels)", () => {
        const roh: [number, number][] = [
            [591.984, 654.063],
            [591.742, 654.719],
        ];
        const { line, extra } = toNodes(roh, undefined, { x: 591.453, y: 654.555 });
        expect(line).toHaveLength(3);
        expect(line[2]).toEqual([591.453, 654.555]);
        expect(extra).toBeCloseTo(Math.hypot(591.742 - 591.453, 654.719 - 654.555), 9);
        expect(laenge(roh) + extra).toBeCloseTo(laenge(line), 12);
    });

    it("unter der Rundungsgrenze bleibt alles, wie es ist", () => {
        const roh: [number, number][] = [
            [10, 10],
            [20, 10],
        ];
        const { line, extra } = toNodes(roh, { x: 10.0002, y: 10 }, { x: 20, y: 10.0001 });
        expect(line).toEqual(roh);
        expect(extra).toBe(0);
    });

    it("beide Enden zugleich, jedes nach seiner eigenen Lücke", () => {
        const roh: [number, number][] = [
            [10, 10],
            [15, 10],
            [20, 10],
        ];
        const { line, extra } = toNodes(roh, { x: 10.002, y: 10 }, { x: 20.4, y: 10 });
        // Vorn ersetzt (0,002), hinten davorgesetzt (0,4): aus drei Punkten werden vier.
        expect(line).toHaveLength(4);
        expect(line[0]).toEqual([10.002, 10]);
        expect(line[3]).toEqual([20.4, 10]);
        expect(laenge(roh) + extra).toBeCloseTo(laenge(line), 12);
    });

    it("🪤 eine Linie aus einem Punkt verliert keinen Knoten", () => {
        const { line } = toNodes([[10, 10]], { x: 10.002, y: 10 }, { x: 10.004, y: 10 });
        expect(line[0]).toEqual([10.002, 10]);
        expect(line[line.length - 1]).toEqual([10.004, 10]);
    });

    it("eine leere Linie bleibt leer", () => {
        expect(toNodes([], { x: 1, y: 1 }, { x: 2, y: 2 })).toEqual({
            line: [],
            extra: 0,
            stubStart: false,
            stubEnd: false,
        });
    });

    it("🔴 ein davorgesetzter Punkt wird als Anschlussstück gemeldet, ein ersetzter nicht", () => {
        const roh: [number, number][] = [
            [10, 10],
            [20, 10],
        ];
        // 0,332 wird davorgesetzt: ein eigenes Stück Weg, das die Karte nicht mitglätten darf.
        const weit = toNodes(roh, { x: 9.668, y: 10 }, undefined);
        expect(weit.stubStart).toBe(true);
        expect(weit.line).toHaveLength(3);
        // 0,002 wird ersetzt: Dort geht die Rohlinie selbst bis zum Knoten, es gibt kein Anschlussstück.
        const nah = toNodes(roh, { x: 9.998, y: 10 }, undefined);
        expect(nah.stubStart).toBe(false);
        expect(nah.line).toHaveLength(2);
        // Ohne Knoten gar nichts.
        expect(toNodes(roh, undefined, undefined)).toMatchObject({ stubStart: false, stubEnd: false });
    });
});

/**
 * Derselbe Fall im Router, mit einer echten freien Seereise: Das Meer liegt im Westen, der Hafen am Ufer, und die
 * Landstraße endet 0,002 Einheiten WESTLICH des Hafenorts - also in Fahrtrichtung hinter ihm. Vor der Korrektur stand
 * dort ein Schritt zurück nach Osten zwischen zwei Stücken, die beide nach Westen führen: zwei Scheitel von 180°.
 */
const water = prepareNavigableWater([
    {
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [40, 0],
                    [40, 20],
                    [0, 20],
                    [0, 0],
                ],
            ],
        },
        minX: 0,
        minY: 0,
        maxX: 40,
        maxY: 20,
        regionName: "Meer",
        regionType: "meer",
        areaPublicId: "0",
    },
]);
const grid = buildSeaGrid(water, 0.5);
const ort = (id: string, x: number, y: number): RouteNode => ({ id, name: id, kind: "place", isHidden: false, x, y });
const places = [ort("hafen", 40.5, 10.25), ort("dorf", 45, 10.25), ort("west", -0.5, 10.25)];
const network = buildRouteNetwork(places, [
    {
        public_id: "landstrasse",
        name: "landstrasse",
        subtype: "Strasse",
        coordinates: JSON.stringify({
            type: "LineString",
            // 🪤 Das Wegende liegt 0,002 WESTLICH des Hafens, also in Fahrtrichtung dahinter: Der Ortskasten ±0,5
            // sammelt es ein, aber der Schritt von dort auf den Ort zeigt zurück nach Osten - wie bei Tschorkeffskoje.
            coordinates: [
                [45, 10.25],
                [40.498, 10.25],
            ],
        }),
        allowed_transports: null,
        transport_domain: null,
        flow_direction: null,
        flow_factor: null,
    },
]);

function seaGraph() {
    const graph = new VisibilityGraph(grid, [
        [
            [0, 0],
            [40, 0],
            [40, 20],
            [0, 20],
        ],
    ]);
    const transports = ["cargoShip"];
    graph.weigh(
        transports.map((transport) => coastProfile(model, transport)),
        coastDistance(grid),
    );
    const ports = ["hafen", "west"].map((placeId) => {
        const place = places.find((candidate) => candidate.id === placeId) as RouteNode;
        const landing = nearestWaterCell(grid, place.x, place.y, 3) as { x: number; y: number };
        return { placeId, node: graph.attach(landing.x, landing.y) };
    });
    return compactSeaGraph(graph.snapshot(), transports, ports, waterMask(grid));
}
const freeSea = new FreeSea(seaGraph());
const frei: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};

describe("Die Naht zwischen Landweg und freier Seereise (WI-0147)", () => {
    const fahrt = () => findRoute(network, buildRouteGraph(network, model, frei, NO_WATER, freeSea), ["dorf", "west"]);

    it("🔴 am Hafen bleibt kein Schritt zurück: keine Kehrtwende in der Linie", () => {
        const route = fahrt();
        expect(route.found).toBe(true);
        expect(route.segments.map((segment) => segment.subtype)).toEqual(["Strasse", "Seeweg"]);
        const linie = route.segments.flatMap((segment) => segment.geometry.coordinates as [number, number][]);
        expect(groessteWende(linie)).toBeLessThan(154);
    });

    it("die Landstraße endet auf dem Hafen, mit genau zwei Punkten", () => {
        const [strasse] = fahrt().segments;
        const linie = strasse?.geometry.coordinates ?? [];
        expect(linie).toHaveLength(2);
        expect(linie[1]).toEqual([40.5, 10.25]);
    });

    it("die ausgewiesene Strecke ist die Länge der gelieferten Linie, Abschnitt für Abschnitt", () => {
        for (const segment of fahrt().segments) {
            expect(segment.distance_units).toBeCloseTo(laenge(segment.geometry.coordinates as [number, number][]), 3);
        }
    });

    it("die Seereise beginnt weiter auf dem Hafen (Betreiber 2026-09-27)", () => {
        const [, see] = fahrt().segments;
        expect(see?.geometry.coordinates[0]).toEqual([40.5, 10.25]);
        expect(see?.display?.coordinates[0]).toEqual([40.5, 10.25]);
    });
});
