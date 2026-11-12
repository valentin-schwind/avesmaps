import { runInNewContext } from "node:vm";
import { setFlagsFromString } from "node:v8";
import { describe, expect, it, vi } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import type { Queryable } from "../src/database.ts";
import { NO_CLIMATE } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { buildRouteNetwork, type RouteNetwork, type RouteNode } from "../src/routing/network.ts";
import type { TerrainHeights } from "../src/routing/relief.ts";
import type { RoutingDataRevision } from "../src/routing/revision.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import type { RouteRequest } from "../src/routing/router.ts";
import type { CompactSeaGraph } from "../src/routing/sea-graph-store.ts";
import {
    databaseRoutingSource,
    RouteService,
    type RoutingData,
    type RoutingParts,
    type RoutingReads,
    type RoutingSource,
} from "../src/routing/service.ts";
import { NO_WATER } from "../src/routing/water.ts";
import { keyOf, revisionOf } from "./support/routing-revision.ts";

/**
 * WI-0071: Der Routing-Worker hält das Höhenmodell nur einmal. Der Dienst lädt beim Nachladen nur, was sich geändert
 * hat, gibt den Vorgänger an den Loader weiter (damit auch das Gelände übernimmt, was innen gleich blieb), und ein
 * Stand, den keine Anfrage mehr braucht, wird freigegeben - auch wenn eine Anfrage über den Wechsel hinweg lief.
 */

const ort = (id: string, x: number, y: number): RouteNode => ({
    id,
    name: `Ort ${id}`,
    kind: "place",
    isHidden: false,
    x,
    y,
});
const weg = (id: string, coordinates: [number, number][]) => ({
    public_id: id,
    name: id,
    subtype: "Strasse",
    coordinates: JSON.stringify({ type: "LineString", coordinates }),
    allowed_transports: null,
    transport_domain: null,
    flow_direction: null,
    flow_factor: null,
});
const network = (): RouteNetwork =>
    buildRouteNetwork(
        [ort("a", 100, 100), ort("b", 110, 100), ort("c", 120, 100)],
        [
            weg("ab", [
                [100, 100],
                [110, 100],
            ]),
            weg("bc", [
                [110, 100],
                [120, 100],
            ]),
        ],
    );

const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};
const seegraph = { transports: [] } as unknown as CompactSeaGraph;

/** Die Müllabfuhr des Tests: `--expose-gc` gibt es unter Vitest nicht, ein neuer Kontext liefert `gc` trotzdem. */
setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc") as () => void;
const settle = async (): Promise<void> => {
    // Ein WeakRef bleibt bis zum Ende des laufenden Auftrags am Leben: erst die Schleife drehen lassen.
    for (let round = 0; round < 3; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        collect();
    }
};

describe("Das Gelände wandert mit dem Stand: der Loader bekommt den Vorgänger nur bei gleichem Reisemodell", () => {
    const base: RoutingDataRevision = {
        map: "m1",
        travelModel: "modell",
        terrain: "t1",
        pathProfiles: "p1",
        seaGraph: "s1",
        climate: "c1",
        territories: "z1",
        settings: "z1",
        settingsLive: "z2",
    };
    const verbindung = { art: "transaktion" } as unknown as Queryable;

    function laden(revisions: RoutingDataRevision[]) {
        let next = 0;
        const gegeben: (RoutingData | undefined)[] = [];
        const heights = (): TerrainHeights => ({}) as TerrainHeights;
        const reads: RoutingReads = {
            revision: async () => revisions[Math.min(next++, revisions.length - 1)] as RoutingDataRevision,
            data: async (_database, _domain, _model, wanted, reusable) => {
                gegeben.push(reusable);
                const parts: Partial<RoutingParts> = {};
                if (wanted.has("network")) parts.network = network();
                if (wanted.has("water")) parts.water = { ...NO_WATER };
                if (wanted.has("land")) parts.land = { ...NO_WATER };
                if (wanted.has("rivers")) parts.rivers = { ...NO_RIVERS };
                if (wanted.has("ground")) parts.ground = { ...NO_GROUND };
                if (wanted.has("climate")) parts.climate = { ...NO_CLIMATE };
                if (wanted.has("heights")) parts.heights = reusable?.heights ?? heights();
                if (wanted.has("territories")) parts.territories = { territories: [], yearBf: null };
                return parts;
            },
        };
        return { source: databaseRoutingSource(verbindung, "aventuria", AVENTURIA_TRAVEL_MODEL, reads), gegeben };
    }

    it("🔴 der erste Stand bekommt keinen Vorgänger, ein späterer den geltenden", async () => {
        const { source, gegeben } = laden([base, { ...base, terrain: "t2" }]);
        const first = await source.load();
        const second = await source.load(first);
        expect(gegeben[0]).toBeUndefined();
        expect(gegeben[1]).toBe(first);
        // Der Loader durfte das Gelände übernehmen: Es ist dasselbe Objekt, nicht eine Kopie neben dem alten.
        expect(second.heights).toBe(first.heights);
    });

    it("🔴 mit einem anderen Reisemodell gilt nichts vom alten Stand als Vorlage", async () => {
        const { source, gegeben } = laden([base, { ...base, travelModel: "anderes", terrain: "t2" }]);
        const first = await source.load();
        const second = await source.load(first);
        expect(gegeben[1]).toBeUndefined();
        expect(second.heights).not.toBe(first.heights);
    });
});

describe("Nachladen während einer laufenden Anfrage (WI-0071)", () => {
    /** Eine Quelle mit zwei Ständen; der Seegraph des ersten kommt erst, wenn der Test ihn freigibt. */
    function quelle() {
        let revision = revisionOf("r1");
        let seegraphFreigeben: (graph: CompactSeaGraph | null) => void = () => undefined;
        const geladen: WeakRef<RoutingData>[] = [];
        const source: RoutingSource = {
            revision: async () => revision,
            load: async () => {
                const data: RoutingData = {
                    network: network(),
                    water: NO_WATER,
                    land: NO_WATER,
                    rivers: NO_RIVERS,
                    ground: NO_GROUND,
                    climate: NO_CLIMATE,
                    revision,
                };
                geladen.push(new WeakRef(data));
                return data;
            },
            loadSea: (graphId) =>
                graphId === revisionOf("r1").seaGraph && geladen.length === 1
                    ? new Promise((resolve) => (seegraphFreigeben = resolve))
                    : Promise.resolve(seegraph),
        };
        return {
            source,
            geladen,
            wechseln: (id: string) => (revision = revisionOf(id)),
            seegraphFreigeben: (graph: CompactSeaGraph | null) => seegraphFreigeben(graph),
        };
    }

    it("🔴 die Anfrage rechnet auf ihrem Startstand zu Ende, die nächste auf dem neuen, und der alte wird frei", async () => {
        const { source, geladen, wechseln, seegraphFreigeben } = quelle();
        let jetzt = 0;
        const dienst = new RouteService({
            mapDomain: "aventuria",
            model: AVENTURIA_TRAVEL_MODEL,
            source,
            recheckMs: 1000,
            now: () => jetzt,
        });
        // Die Anfrage beginnt auf r1 und wartet auf den Seegraphen (die freie Seefahrt ist Vorgabe).
        const laufend = dienst.route({ ...zuFuss, waypoints: ["a", "c"] });
        await vi.waitFor(() => expect(geladen).toHaveLength(1));
        // Bis sie am Seegraphen hängt: Die Rechnung beginnt erst nach dem ersten Stand.
        await new Promise((resolve) => setTimeout(resolve, 10));
        // Während sie wartet, wird r2 geladen und gilt.
        wechseln("r2");
        jetzt = 5000;
        await dienst.refresh();
        expect(geladen).toHaveLength(2);
        const dazwischen = await dienst.route({ ...zuFuss, waypoints: ["a", "c"] });
        expect(dazwischen.ok && dazwischen.response.routing_graph_revision).toBe(keyOf("r2"));
        // Der alte Stand lebt noch: Die Anfrage hält ihn.
        await settle();
        expect(geladen[0]?.deref()).toBeDefined();
        seegraphFreigeben(seegraph);
        const ergebnis = await laufend;
        expect(ergebnis.ok && ergebnis.response.routing_graph_revision).toBe(keyOf("r1"));
        // Danach hält ihn niemand mehr: kein zweiter Stand neben dem neuen.
        await settle();
        expect(geladen[0]?.deref()).toBeUndefined();
        expect(geladen[1]?.deref()).toBeDefined();
    });

    it("kein zweiter Stand nach dem Wechsel ohne laufende Anfrage: der alte ist sofort frei", async () => {
        const { source, geladen, wechseln } = quelle();
        let jetzt = 0;
        const dienst = new RouteService({
            mapDomain: "aventuria",
            model: AVENTURIA_TRAVEL_MODEL,
            source,
            recheckMs: 1000,
            now: () => jetzt,
        });
        // Ohne Seefahrt wartet die Anfrage auf nichts.
        const ohneSee: RouteRequest = { ...zuFuss, enabled: { ...zuFuss.enabled, sea: false } };
        const erste = await dienst.route({ ...ohneSee, waypoints: ["a", "c"] });
        expect(erste.ok && erste.response.routing_graph_revision).toBe(keyOf("r1"));
        wechseln("r2");
        jetzt = 5000;
        await dienst.refresh();
        await settle();
        expect(geladen[0]?.deref()).toBeUndefined();
        const zweite = await dienst.route({ ...ohneSee, waypoints: ["a", "c"] });
        expect(zweite.ok && zweite.response.routing_graph_revision).toBe(keyOf("r2"));
    });
});
