import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { buildRouteNetwork, type PathRow, type RouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";

/**
 * Die zwei Stellschrauben, mit denen der Vergleich der 200 Routen rechnet (`topologie-vergleich-cli.ts`,
 * Betreiberauftrag 2026-10-14: „sie soll erst mit 200 zufälligen routen einen vergleich mit legacy und ihrem ansatz
 * machen“). Sie halten die ZWEI Ursachen fest, die der Betreiber an einem Tag gemeldet hat:
 *
 * 1. **Der Stichweg mit Kehrtwende** (Trallop → Baliho): Drei Wegenden treffen sich 0,33 neben Burg Trutzfels. Der
 *    Ortskasten ±0,5 nimmt den Treffpunkt auf, und seit `cfc3ffe9` zieht die Antwort die Linie beider Straßenstücke an den
 *    Ort. Gezeichnet wird dadurch ein Stich in die Burg und zurück, und 2 × 0,33 Einheiten stehen in der Strecke.
 * 2. **Der Umweg um eine Lücke von 0,003** (Oblotin → Weidensee): Das Ende des Rabenpasses und der Anfang der
 *    Karawanenroute liegen 0,0032 auseinander. Mit dem alten `END_SNAP` von 0,001 gab es dort keine Verbindung,
 *    und die Route läuft 1308 Meilen statt 139.
 *
 * Alle Zahlen und Koordinaten stammen aus dem Datenstand vom 2026-10-11 (`place`, `path`), nicht aus einer Erfindung.
 *
 * Problemfälle: der Stich bleibt, obwohl nur an Wegpunkte gezogen wird; der Ortskasten verliert seine Wirkung an einem
 * losen Ende; ein größerer Fangradius verbindet zwei Enden nicht; der Treffpunkt-Schalter schneidet einen Ort vom Netz ab,
 * ohne dass es auffällt.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};

const ort = (id: string, name: string, x: number, y: number): RouteNode => ({
    id,
    name,
    kind: "place",
    isHidden: false,
    subtype: "dorf",
    x,
    y,
});

const weg = (id: string, subtype: string, coordinates: [number, number][]): PathRow => ({
    public_id: id,
    name: id,
    subtype,
    coordinates: JSON.stringify({ type: "LineString", coordinates }),
    allowed_transports: null,
    transport_domain: null,
    flow_direction: null,
    flow_factor: null,
});

/**
 * Der größte Richtungswechsel in der Linie der Route, in Grad: 180 heißt Kehrtwende.
 *
 * 🪤 Doppelte Punkte zuerst heraus: An der Naht zweier Abschnitte steht der Knoten zweimal, und mit ihm wäre der
 * Richtungswechsel ein Schritt der Länge 0 und damit unsichtbar.
 */
function groessteWende(punkte: readonly [number, number][]): number {
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
        if (lu < 0.001 || lv < 0.001) continue;
        const cos = Math.max(-1, Math.min(1, ((bx - ax) * (cx - bx) + (by - ay) * (cy - by)) / (lu * lv)));
        groesste = Math.max(groesste, (Math.acos(cos) * 180) / Math.PI);
    }
    return groesste;
}

/**
 * Burg Trutzfels, wie sie in den Daten steht: Der Ort liegt auf (591,453 | 654,555), drei Wegenden treffen sich auf
 * (591,742 | 654,719), also 0,332 daneben — zwei Stücke der Reichsstraße 2 und ein Pfad. Gereist wird von Süden nach
 * Norden über die Burg hinweg; sie ist KEIN Wegpunkt.
 */
function trutzfels(): { network: RouteNetwork; von: string; nach: string } {
    const network = buildRouteNetwork(
        [
            ort("sued", "Süden", 591.984, 654.063),
            ort("burg", "Burg Trutzfels", 591.453, 654.555),
            ort("nord", "Norden", 591.023, 655.984),
        ],
        [
            weg("reichsstrasse-sued", "Reichsstrasse", [
                [591.984, 654.063],
                [591.742, 654.719],
            ]),
            weg("reichsstrasse-nord", "Reichsstrasse", [
                [591.742, 654.719],
                [591.023, 655.984],
            ]),
        ],
    );
    return { network, von: "sued", nach: "nord" };
}

describe("Stichwege an Orten (Betreiber 2026-10-14, Trallop → Baliho)", () => {
    it("die Durchfahrt bleibt auf der Straße: kein Punkt im Ort, keine Kehrtwende", () => {
        const { network, von, nach } = trutzfels();
        const graph = buildRouteGraph(network, model, zuFuss);
        const route = findRoute(network, graph, [von, nach]);
        expect(route.found).toBe(true);
        const linie = route.segments.flatMap((segment) => segment.geometry.coordinates as [number, number][]);
        // Die Burg liegt 0,332 neben dem Treffpunkt, und kein Weg berührt sie: Sie darf nicht in der Linie stehen.
        expect(linie.some(([x, y]) => x === 591.453 && y === 654.555)).toBe(false);
        expect(groessteWende(linie)).toBeLessThan(154);
        // Die Strecke ist die der zwei Straßenstücke, ohne die zwei Stiche in den Ort.
        const stueck = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
        const erwartet =
            stueck([591.984, 654.063], [591.742, 654.719]) + stueck([591.742, 654.719], [591.023, 655.984]);
        expect(route.distanceUnits).toBeCloseTo(erwartet, 5);
    });

    it("der Ort bleibt Station im Reiseplan, obwohl die Linie vorbeifährt", () => {
        const { network, von, nach } = trutzfels();
        const graph = buildRouteGraph(network, model, zuFuss);
        const route = findRoute(network, graph, [von, nach]);
        // 🪤 Der Ortskasten hält den Treffpunkt weiter: Der Knoten der Durchfahrt IST die Burg, nur die Linie geht vorbei.
        expect(route.segments.map((segment) => segment.to_node)).toContain("Burg Trutzfels");
    });

    it("am Start und am Ziel wird weiter gezogen (Befund Kaldenberg, `cfc3ffe9`)", () => {
        const { network } = trutzfels();
        const graph = buildRouteGraph(network, model, zuFuss);
        const route = findRoute(network, graph, ["burg", "nord"]);
        expect(route.found).toBe(true);
        const linie = route.segments.flatMap((segment) => segment.geometry.coordinates as [number, number][]);
        expect(linie[0]).toEqual([591.453, 654.555]);
    });
});

describe("Der Fangradius am Wegende (Betreiber 2026-10-14, Oblotin → Weidensee)", () => {
    /** Rabenpass und Karawanenroute, wie sie in den Daten stehen: 0,0032 Einheiten Lücke. */
    const rabenpass = (endSnap?: number): RouteNetwork =>
        buildRouteNetwork(
            [ort("westen", "Westen", 651.094, 769.719), ort("osten", "Osten", 672.92, 767.23)],
            [
                weg("rabenpass", "Gebirgspass", [
                    [651.094, 769.719],
                    [658.221, 769.643],
                ]),
                weg("karawanenroute", "Strasse", [
                    [658.22, 769.64],
                    [672.92, 767.23],
                ]),
            ],
            endSnap === undefined ? {} : { endSnap },
        );

    it("die geltenden 0,02 verbinden die Lücke: ein Netzteil, die Route geht durch", () => {
        const network = rabenpass();
        const graph = buildRouteGraph(network, model, zuFuss);
        const route = findRoute(network, graph, ["westen", "osten"]);
        expect(route.found).toBe(true);
        // Kein Stück querfeldein: Die Route fährt über die beiden gezeichneten Wege.
        expect(route.segments.every((segment) => !segment.synthetic)).toBe(true);
    });

    it("mit 0,001 blieben es zwei Netzteile (der Stand vor WI-0147)", () => {
        const network = rabenpass(0.001);
        const enden = new Set(network.links.flatMap((link) => [link.from, link.to]));
        // Vier Knoten: zwei Orte und zwei technische Knoten, die nicht zusammenfinden.
        expect(enden.size).toBe(4);
    });
});
