import { describe, expect, it, vi } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import type { Edge, GraphBase } from "../src/routing/route-edge.ts";
import { findLeg, type SearchGraph } from "../src/routing/route-search.ts";
import { NO_WATER } from "../src/routing/water.ts";

function edge(from: string, to: string, distance: number, transport = "groupFoot"): Edge {
    return {
        to,
        distance,
        transport,
        time: distance,
        forward: true,
        flowFactor: 1,
        flowState: "",
        costFactor: 1,
        synthetic: false,
        offroad: false,
        link: {
            id: `${from}-${to}`,
            pathPublicId: `${from}-${to}`,
            pathName: "",
            subtype: "Strasse",
            from,
            to,
            coordinates: [
                [0, 0],
                [distance, 0],
            ],
            distance,
            allowedTransports: null,
            transportDomain: null,
            flow: null,
        },
    };
}

const graph: GraphBase = {
    model: { ...AVENTURIA_TRAVEL_MODEL, umstiegsaufschlag: { ...AVENTURIA_TRAVEL_MODEL.umstiegsaufschlag, wert: 10 } },
    request: {
        optimize: "shortest",
        minimizeTransfers: true,
        transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
        enabled: { land: true, river: true, sea: true },
    },
    water: NO_WATER,
    synthetic: null,
    drawn: new Map(),
    sea: null,
    seaBound: new Set(),
};

function view(edges: Edge[]): SearchGraph & { expanded: string[] } {
    const nodes = new Set(edges.flatMap((item) => [item.link.from, item.to]));
    const expanded: string[] = [];
    return {
        expanded,
        has: (id) => nodes.has(id),
        edges: (id) => {
            expanded.push(id);
            return edges.filter((item) => item.link.from === id);
        },
        forEachSeaEdge: vi.fn(),
        keepSeaEdge: (item) => item,
    };
}

describe("Umsteigen minimieren: Suchgrenze", () => {
    it("verbessert das erste Zielangebot, ohne teurere Fortsetzungen zu expandieren", () => {
        const search = view([edge("S", "T", 10), edge("S", "A", 1), edge("A", "T", 1), edge("S", "F", 50)]);
        expect(findLeg(search, graph, "S", "T")).toMatchObject({ found: true, cost: 2, nodeIds: ["S", "A", "T"] });
        expect(search.expanded).toEqual(["S", "A"]);
        expect(search.forEachSeaEdge).toHaveBeenCalledTimes(2);
    });

    it("behält ältere Heap-Einträge anderer Mittel mit inzwischen günstigeren Knotenkosten", () => {
        const search = view([
            edge("S", "A", 20, "cargoShip"),
            edge("S", "B", 1),
            edge("B", "A", 1),
            edge("A", "T", 1, "cargoShip"),
        ]);
        // Legacy führt ein Kostenlabel je Knoten: A/Schiff (Heap 20, Knoten 2) verbessert Ziel 13 auf 3.
        expect(findLeg(search, graph, "S", "T")).toMatchObject({ found: true, cost: 3, nodeIds: ["S", "B", "A", "T"] });
    });

    it("beendet auch eine Suche ohne erreichbares Ziel", () => {
        const search = view([edge("S", "A", 1), edge("A", "S", 1), edge("X", "T", 1)]);
        expect(findLeg(search, graph, "S", "T").found).toBe(false);
        expect(search.expanded).toEqual(["S", "A"]);
    });
});
