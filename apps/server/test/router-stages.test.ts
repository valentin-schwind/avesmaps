import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import * as router from "../src/routing/router.ts";
import { buildRouteGraph, type RouteRequest } from "../src/routing/router.ts";
import { yearRoundBridgesFor } from "../src/routing/route-graph.ts";

/**
 * Die Stufen des Routers (Hardening Review M7): `router.ts` ist die Fassade über vier Stufen, und jede kennt nur
 * die davor. Das hält dieser Test fest, damit die Phase-6-Invalidierung die Materialisierung je Revision
 * verwerfen kann, ohne an die Anfrage-Kanten zu geraten - und damit der Umzug nicht still zurückwächst.
 */

const ROUTING = resolve(import.meta.dirname, "..", "src", "routing");

/** Wer wen importieren darf, unter den Modulen des Routers; `router` darf alle, `route-edge` keines. */
const STAGES: Record<string, string[]> = {
    "route-edge": [],
    "route-graph": ["route-edge"],
    "request-graph": ["route-edge"],
    "request-links": ["request-graph", "route-edge"],
    "route-search": ["request-graph", "route-edge"],
    "route-result": ["request-graph", "route-edge", "route-search"],
    router: ["request-graph", "request-links", "route-edge", "route-graph", "route-result", "route-search"],
};

/** Die Module (ohne Endung), die eine Datei aus dem Routing-Verzeichnis importiert oder re-exportiert. */
function importsOf(file: string): string[] {
    const text = readFileSync(resolve(ROUTING, `${file}.ts`), "utf8");
    const found = new Set<string>();
    for (const match of text.matchAll(/^(?:import|export)\s[^;]*?\sfrom\s+"\.\/([\w-]+)\.ts";/gms)) {
        found.add(match[1] as string);
    }
    return [...found].sort();
}

describe("Stufen des Routers", () => {
    it.each(Object.entries(STAGES))("%s importiert nur, was seine Stufe darf", (file, allowed) => {
        const routerModules = Object.keys(STAGES);
        const own = importsOf(file).filter((module) => routerModules.includes(module));
        expect(own.filter((module) => !allowed.includes(module))).toEqual([]);
    });

    it("kein Modul des Routers steht in einem Zyklus (auch nicht über Typen)", () => {
        // Aus den erlaubten Kanten folgt es, sobald die Tabelle stimmt: Jede Kante zeigt auf eine frühere Stufe.
        const order = [
            "route-edge",
            "route-graph",
            "request-graph",
            "request-links",
            "route-search",
            "route-result",
            "router",
        ];
        for (const [file, allowed] of Object.entries(STAGES)) {
            for (const module of allowed) {
                expect(order.indexOf(module), `${file} -> ${module}`).toBeLessThan(order.indexOf(file));
            }
        }
    });

    it("die Länge eines Linienzugs wird an genau einer Stelle gerechnet", () => {
        const definitions = readdirSync(ROUTING)
            .filter((name) => name.endsWith(".ts"))
            .filter((name) => /function\s+lineLength\b/.test(readFileSync(resolve(ROUTING, name), "utf8")));
        expect(definitions).toEqual(["network.ts"]);
    });
});

describe("Fassade router.ts", () => {
    it("stellt bereit, was Importeure von dort lesen", () => {
        for (const name of [
            "buildRouteGraph",
            "findRoute",
            "lineLength",
            "MAP_POINT_NAME",
            "SYNTHETIC_TYPE",
            "ANCHOR_LIMIT",
            "ANCHOR_PREFIX",
            "NO_OFFROAD_TERRAIN",
        ]) {
            expect(router, name).toHaveProperty(name);
        }
        expect(router.MAP_POINT_NAME).toBe("Kartenpunkt");
        expect(router.SYNTHETIC_TYPE).toBe("Querfeldein");
        expect(router.ANCHOR_PREFIX).toBe("__wp_anchor_");
        expect(router.ANCHOR_LIMIT).toBe(6);
        expect(
            router.lineLength([
                [0, 0],
                [3, 4],
                [3, 10],
            ]),
        ).toBe(11);
    });
});

describe("Zwischenspeicher an ihrer Objektidentität", () => {
    const node = (id: string, x: number, y: number): RouteNode => ({
        id,
        name: id,
        kind: "place",
        isHidden: false,
        x,
        y,
    });
    const path = (id: string, from: [number, number], to: [number, number]) => ({
        public_id: id,
        name: id,
        subtype: "Strasse",
        coordinates: JSON.stringify({ type: "LineString", coordinates: [from, to] }),
        allowed_transports: null,
        transport_domain: null,
        flow_direction: null,
        flow_factor: null,
    });
    const network = buildRouteNetwork(
        [node("a", 100, 100), node("b", 110, 100), node("c", 200, 200), node("d", 210, 200)],
        [path("ab", [100, 100], [110, 100]), path("cd", [200, 200], [210, 200])],
    );
    const request: RouteRequest = {
        optimize: "fastest",
        transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
        enabled: { land: true, river: true, sea: true },
        minimizeTransfers: false,
    };
    const graph = buildRouteGraph(network, AVENTURIA_TRAVEL_MODEL, request);
    const anyNode = (): boolean => true;

    it("die ganzjährigen Brücken hängen an den gezeichneten Kanten und überleben die frische Hülle des Dienstes", () => {
        const first = yearRoundBridgesFor(network, graph, anyNode, graph.adjacency, true);
        // Der Dienst reicht je Anfrage `{ ...graph, request }`: andere Hülle, dieselben Kanten.
        const again = yearRoundBridgesFor(network, { ...graph, request }, anyNode, graph.adjacency, true);
        expect(again).toBe(first);
    });

    it("nennt die Anfrage einen versteckten Ort, wird nichts gemerkt und nichts aus dem Merkzettel gelesen", () => {
        const first = yearRoundBridgesFor(network, graph, anyNode, graph.adjacency, true);
        const one = yearRoundBridgesFor(network, graph, anyNode, graph.adjacency, false);
        const two = yearRoundBridgesFor(network, graph, anyNode, graph.adjacency, false);
        expect(one).not.toBe(two);
        expect(one).not.toBe(first);
        // Auch das Ergebnis ohne Merkzettel ist dasselbe wie das gemerkte.
        expect(one).toEqual(first);
    });
});
