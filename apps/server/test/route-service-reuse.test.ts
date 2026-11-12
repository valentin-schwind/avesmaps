import { afterAll, describe, expect, it, vi } from "vitest";
import { AVENTURIA, AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { createDatabase, type Queryable } from "../src/database.ts";
import { NO_CLIMATE } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { buildRouteNetwork, type RouteNetwork, type RouteNode } from "../src/routing/network.ts";
import type { TerrainHeights } from "../src/routing/relief.ts";
import {
    changedParts,
    readRoutingRevision,
    type RoutingDataPart,
    type RoutingDataRevision,
} from "../src/routing/revision.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import type { RouteRequest } from "../src/routing/router.ts";
import type { CompactSeaGraph } from "../src/routing/sea-graph-store.ts";
import {
    databaseRoutingSource,
    RouteService,
    type ReloadEvent,
    type RoutingData,
    type RoutingParts,
    type RoutingReads,
    type RoutingSource,
} from "../src/routing/service.ts";
import { NO_WATER } from "../src/routing/water.ts";

/**
 * Nachladen übernimmt Unverändertes (Nachtrag zu M6, Anlass: Messung auf Stage nach dem ersten Live-Zug mit Gelände:
 * ArrayBuffer-Spitze 45 von 48 MB, weil beim Nachladen alter und neuer Stand das Geländeraster gleichzeitig hielten).
 * Ein neuer Stand lädt nur die Bestandteile, deren Revisionsteile sich geändert haben (`staleDataParts`); die anderen
 * sind DASSELBE Objekt wie im alten Stand, samt der Zwischenspeicher, die an ihm hängen.
 */

const ort = (id: string, x: number, y: number): RouteNode => ({
    id,
    name: `Ort ${id}`,
    kind: "place",
    isHidden: false,
    x,
    y,
});
const network = (): RouteNetwork =>
    buildRouteNetwork(
        [ort("a", 100, 100), ort("b", 110, 100), ort("c", 120, 100)],
        [
            {
                public_id: "ab",
                name: "ab",
                subtype: "Strasse",
                coordinates: JSON.stringify({
                    type: "LineString",
                    coordinates: [
                        [100, 100],
                        [110, 100],
                    ],
                }),
                allowed_transports: null,
                transport_domain: null,
                flow_direction: null,
                flow_factor: null,
            },
            {
                public_id: "bc",
                name: "bc",
                subtype: "Strasse",
                coordinates: JSON.stringify({
                    type: "LineString",
                    coordinates: [
                        [110, 100],
                        [120, 100],
                    ],
                }),
                allowed_transports: null,
                transport_domain: null,
                flow_direction: null,
                flow_factor: null,
            },
        ],
    );

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
const all: RoutingDataPart[] = ["network", "water", "land", "rivers", "ground", "climate", "heights", "territories"];

describe("Die Datenbankquelle lädt nur, was sich geändert hat", () => {
    /** Reads mit einer Revisionsfolge; jeder Bestandteil ist bei jedem Laden ein neues Objekt, und mitgeschrieben wird, was verlangt war. */
    function zaehlend(revisions: RoutingDataRevision[]) {
        let next = 0;
        const verlangt: RoutingDataPart[][] = [];
        const reads: RoutingReads = {
            revision: async () => revisions[Math.min(next++, revisions.length - 1)] as RoutingDataRevision,
            data: async (_database, _domain, _model, wanted) => {
                verlangt.push([...wanted]);
                const parts: Partial<RoutingParts> = {};
                if (wanted.has("network")) parts.network = network();
                if (wanted.has("water")) parts.water = { ...NO_WATER };
                if (wanted.has("land")) parts.land = { ...NO_WATER };
                if (wanted.has("rivers")) parts.rivers = { ...NO_RIVERS };
                if (wanted.has("ground")) parts.ground = { ...NO_GROUND };
                if (wanted.has("climate")) parts.climate = { ...NO_CLIMATE };
                if (wanted.has("heights")) parts.heights = {} as TerrainHeights;
                if (wanted.has("territories")) parts.territories = { territories: [], yearBf: null };
                return parts;
            },
        };
        return { reads, verlangt };
    }
    // Eine offene Transaktion genügt: die Quelle liest dann an ihr, ohne `begin`.
    const verbindung = { art: "transaktion" } as unknown as Queryable;
    const laden = (revisions: RoutingDataRevision[]) => {
        const { reads, verlangt } = zaehlend(revisions);
        const source = databaseRoutingSource(verbindung, "aventuria", AVENTURIA_TRAVEL_MODEL, reads);
        return { source, verlangt };
    };

    it("lädt ohne geltenden Stand alles", async () => {
        const { source, verlangt } = laden([base]);
        const first = await source.load();
        expect(verlangt).toEqual([all]);
        expect(first.heights).toBeDefined();
    });

    it("🔴 nach einer Ortsänderung bleiben Gelände und Klima dasselbe Objekt und werden nicht geladen", async () => {
        const { source, verlangt } = laden([base, { ...base, map: "m2" }]);
        const first = await source.load();
        const second = await source.load(first);
        expect(verlangt[1]).toEqual(["network", "water", "land", "rivers", "ground"]);
        expect(second.heights).toBe(first.heights);
        expect(second.climate).toBe(first.climate);
        expect(second.network).not.toBe(first.network);
        expect(second.revision.map).toBe("m2");
    });

    it("🔴 mit geändertem Gelände wird das Gelände neu geladen, alles andere bleibt", async () => {
        const { source, verlangt } = laden([base, { ...base, terrain: "t2" }]);
        const first = await source.load();
        const second = await source.load(first);
        expect(verlangt[1]).toEqual(["heights"]);
        expect(second.heights).not.toBe(first.heights);
        for (const part of ["network", "water", "land", "rivers", "ground", "climate"] as const) {
            expect(second[part], part).toBe(first[part]);
        }
    });

    it("🔴 eine neue Ableitung der Herrschaftsgebiete lädt NUR die Zollgebiete, alles andere bleibt dasselbe Objekt (WI-0065)", async () => {
        const { source, verlangt } = laden([base, { ...base, territories: "z2" }]);
        const first = await source.load();
        const second = await source.load(first);
        expect(verlangt[1]).toEqual(["territories"]);
        expect(second.territories).not.toBe(first.territories);
        for (const part of ["network", "water", "land", "rivers", "ground", "climate", "heights"] as const) {
            expect(second[part], part).toBe(first[part]);
        }
        expect(second.revision.territories).toBe("z2");
    });

    it("🔴 umgekehrt lassen Orts-, Gelände- und Klimaänderung die Zollgebiete stehen (dasselbe Objekt)", async () => {
        const { source, verlangt } = laden([base, { ...base, map: "m2", terrain: "t2", climate: "c2" }]);
        const first = await source.load();
        const second = await source.load(first);
        expect(verlangt[1]).not.toContain("territories");
        expect(second.territories).toBe(first.territories);
    });

    it("geänderte Wegprofile laden das Netz neu, aber nicht das Gelände", async () => {
        const { source, verlangt } = laden([base, { ...base, pathProfiles: "p2" }]);
        const first = await source.load();
        const second = await source.load(first);
        expect(verlangt[1]).toEqual(["network"]);
        expect(second.network).not.toBe(first.network);
        expect(second.heights).toBe(first.heights);
        expect(second.water).toBe(first.water);
    });

    it("ein neuer Seegraph lädt nichts: Er kommt erst auf Verlangen (`loadSea`)", async () => {
        const { source, verlangt } = laden([base, { ...base, seaGraph: "s2" }]);
        const first = await source.load();
        const second = await source.load(first);
        expect(verlangt[1]).toEqual([]);
        for (const part of all) expect(second[part], part).toBe(first[part]);
        expect(second.revision.seaGraph).toBe("s2");
    });

    it("ein anderes Reisemodell lädt alles", async () => {
        const { source, verlangt } = laden([base, { ...base, travelModel: "anderes" }]);
        const first = await source.load();
        await source.load(first);
        expect(verlangt[1]).toEqual(all);
    });

    it("die Revision des neuen Stands ist die, die die Transaktion las - auch für die übernommenen Teile", async () => {
        const { source } = laden([base, { ...base, map: "m2", terrain: "t2" }]);
        const first = await source.load();
        const second = await source.load(first);
        expect(changedParts(first.revision, second.revision)).toEqual(["map", "terrain"]);
    });
});

/** Ein Rechendienst über einer Quelle, die ihre `load(previous)`-Aufrufe und Seegraph-Fragen mitschreibt. */
function beobachtet(revisions: RoutingDataRevision[], sea: (seaGraph: string | null) => CompactSeaGraph | null) {
    let probed = revisions[0] as RoutingDataRevision;
    let checks = 0;
    const previous: (RoutingData | undefined)[] = [];
    const seaAsked: (string | null)[] = [];
    const source: RoutingSource = {
        async revision() {
            probed = revisions[Math.min(checks++, revisions.length - 1)] as RoutingDataRevision;
            return probed;
        },
        async load(before) {
            previous.push(before);
            return {
                network: network(),
                water: NO_WATER,
                land: NO_WATER,
                rivers: NO_RIVERS,
                ground: NO_GROUND,
                climate: NO_CLIMATE,
                revision: probed,
            };
        },
        async loadSea(seaGraph) {
            seaAsked.push(seaGraph);
            return sea(seaGraph);
        },
    };
    return { source, previous, seaAsked };
}

const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};
/** Ein Seegraph, den das Schiff nicht kennt: `fleet()` liefert null, die Route rechnet über Land. */
const seegraph = { transports: [] } as unknown as CompactSeaGraph;

describe("Der Rechendienst reicht den geltenden Stand weiter und vererbt, was gleich bleibt", () => {
    async function nachladen(
        revisions: RoutingDataRevision[],
        sea: (seaGraph: string | null) => CompactSeaGraph | null,
    ) {
        let jetzt = 0;
        const wechsel: ReloadEvent[] = [];
        const beobachter = beobachtet(revisions, sea);
        const dienst = new RouteService({
            mapDomain: "aventuria",
            model: AVENTURIA_TRAVEL_MODEL,
            source: beobachter.source,
            recheckMs: 1000,
            now: () => jetzt,
            onReload: (event) => wechsel.push(event),
        });
        const route = () => dienst.route({ ...zuFuss, waypoints: ["a", "c"] });
        /** Lässt die Frist verstreichen und wartet, bis der neue Stand gilt. */
        const weiter = async (): Promise<void> => {
            const bisher = wechsel.length;
            jetzt += 2000;
            await route();
            await vi.waitFor(() => expect(wechsel).toHaveLength(bisher + 1));
        };
        return { ...beobachter, route, weiter, wechsel };
    }

    it("gibt `load` beim ersten Laden keinen, danach den geltenden Stand", async () => {
        const { route, weiter, previous } = await nachladen([base, { ...base, map: "m2" }], () => null);
        await route();
        expect(previous).toEqual([undefined]);
        await weiter();
        expect(previous).toHaveLength(2);
        expect(previous[1]?.revision.map).toBe("m1");
    });

    it("🔴 ein Seegraph, dessen Kennung gleich blieb, wird nicht noch einmal geladen", async () => {
        const { route, weiter, seaAsked } = await nachladen(
            [base, { ...base, map: "m2" }, { ...base, map: "m3" }],
            () => seegraph,
        );
        await route();
        expect(seaAsked).toEqual(["s1"]);
        await weiter();
        await route();
        await weiter();
        await route();
        // Zwei neue Stände mit demselben Seegraphen fragten nicht wieder.
        expect(seaAsked).toEqual(["s1"]);
    });

    it("ein anderer Seegraph wird geladen, gegen seine neue Kennung", async () => {
        const { route, weiter, seaAsked } = await nachladen([base, { ...base, seaGraph: "s2" }], () => seegraph);
        await route();
        await weiter();
        await route();
        expect(seaAsked).toEqual(["s1", "s2"]);
    });

    it("🪤 eine Absage des Seegraphen (keiner passt) wird nicht vererbt: der nächste Stand fragt neu", async () => {
        const { route, weiter, seaAsked } = await nachladen([base, { ...base, map: "m2" }], () => null);
        await route();
        await weiter();
        await route();
        expect(seaAsked).toEqual(["s1", "s1"]);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
describe.skipIf(!testDatabaseUrl)("Nachladen gegen die Datenbank", () => {
    const database = createDatabase(testDatabaseUrl ?? "");
    afterAll(() => database.end({ timeout: 5 }));
    const quelle = () => databaseRoutingSource(database, AVENTURIA.mapDomain, AVENTURIA_TRAVEL_MODEL);

    it("übernimmt alles, wenn sich nichts geändert hat", async () => {
        const source = quelle();
        const first = await source.load();
        const again = await source.load(first);
        for (const part of ["network", "water", "land", "rivers", "ground", "climate", "heights"] as const) {
            expect(again[part], part).toBe(first[part]);
        }
        expect(again.revision).toEqual(first.revision);
    });

    it("lädt bei geändertem Teil `map` das Netz neu und übernimmt Klima und Gelände", async () => {
        const source = quelle();
        const first = await source.load();
        const older: RoutingData = { ...first, revision: { ...first.revision, map: "aelter" } };
        const second = await source.load(older);
        expect(second.network).not.toBe(first.network);
        expect(second.climate).toBe(first.climate);
        expect(second.heights).toBe(first.heights);
        expect(second.revision.map).toBe(first.revision.map);
    });

    it("🔴 ein neuer Weg ändert nur den Teil map, ein neuer Seegraph nur den Teil seaGraph, eine Kreuzung nichts mehr", async () => {
        const gelesen: {
            before?: RoutingDataRevision;
            crossing?: RoutingDataRevision;
            path?: RoutingDataRevision;
            sea?: RoutingDataRevision;
        } = {};
        await database
            .begin(async (transaction) => {
                const read = () => readRoutingRevision(transaction, AVENTURIA.mapDomain, "modell");
                gelesen.before = await read();
                // WI-0132 Release N: Das Netz liest die Tabelle `crossing` nicht mehr, also gehört sie nicht in die Revision.
                await transaction`
                    INSERT INTO crossing (public_id, map_domain_id, legacy_name, legacy_kind, geom, source_system)
                    VALUES (gen_random_uuid(), ${AVENTURIA.mapDomain}, 'Kreuzung', 'crossing',
                            ST_SetSRID(ST_MakePoint(1, 1), 0), 'test')
                `;
                gelesen.crossing = await read();
                await transaction`
                    INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system)
                    VALUES (gen_random_uuid(), ${AVENTURIA.mapDomain}, 'Testweg', 'Strasse',
                            ST_SetSRID(ST_MakeLine(ST_MakePoint(1, 1), ST_MakePoint(2, 2)), 0), 'test')
                `;
                gelesen.path = await read();
                await transaction`
                    INSERT INTO sea_route_graph (map_domain_id, algorithm_version, source_fingerprint, graph, stats)
                    VALUES (${AVENTURIA.mapDomain}, 'algo-test', 'quelle-test', ${Buffer.from([1])}, '{}'::jsonb)
                    ON CONFLICT (map_domain_id) DO UPDATE SET
                        algorithm_version = EXCLUDED.algorithm_version,
                        source_fingerprint = EXCLUDED.source_fingerprint
                `;
                gelesen.sea = await read();
                throw new Error("zurückrollen");
            })
            .catch((error: unknown) => {
                if (!(error instanceof Error) || error.message !== "zurückrollen") throw error;
            });
        expect(changedParts(gelesen.before as RoutingDataRevision, gelesen.crossing as RoutingDataRevision)).toEqual(
            [],
        );
        expect(changedParts(gelesen.crossing as RoutingDataRevision, gelesen.path as RoutingDataRevision)).toEqual([
            "map",
        ]);
        expect(changedParts(gelesen.path as RoutingDataRevision, gelesen.sea as RoutingDataRevision)).toEqual([
            "seaGraph",
        ]);
    });
});
