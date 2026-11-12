import { afterAll, describe, expect, it, vi } from "vitest";
import { AVENTURIA, AVENTURIA_TRAVEL_MODEL, prepareBorderTerritory, type SeasonWindow } from "@avesmaps3d/shared";
import { createDatabase, type Queryable } from "../src/database.ts";
import { assertUsableNetwork, networkProblems, RoutingDataInvalid } from "../src/routing/data-validation.ts";
import { buildRouteNetwork, type RouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { techNodeId } from "../src/routing/topology.ts";
import {
    readRoutingRevision,
    revisionKey,
    seaGraphIdentity,
    travelModelVersion,
    type RoutingDataRevision,
} from "../src/routing/revision.ts";
import type { RouteRequest } from "../src/routing/router.ts";
import type { StoredSeaRoutes } from "../src/routing/sea-derive.ts";
import type { CompactSeaGraph } from "../src/routing/sea-graph-store.ts";
import {
    databaseRoutingSource,
    matchingSeaGraph,
    RouteService,
    SNAPSHOT_TRANSACTION,
    type ReloadEvent,
    type RoutingData,
    type RoutingReads,
    type RoutingSource,
} from "../src/routing/service.ts";
import { NO_CLIMATE } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import type { TollTerritories } from "../src/routing/toll-territories.ts";
import { NO_WATER, type Water } from "../src/routing/water.ts";
import { wandHoch } from "./support/air-terrain.ts";
import { keyOf, revisionOf } from "./support/routing-revision.ts";

/**
 * Der Rechendienst der Route (WI-0017 R6): Netz einmal laden, Graphen je Profil halten, veraltete
 * Daten erkennen, Antwort im Vertrag. Die Wegfindung selbst prüft `router.test.ts`.
 */

const ort = (id: string, x: number, y: number): RouteNode => ({
    id,
    name: `Ort ${id}`,
    kind: "place",
    isHidden: false,
    x,
    y,
});
/** Der technische Knoten, an dem der Pfad `kc` auf die Straße a-b stößt (T-Stoß auf ihren Stützpunkt, WI-0132). */
const K = techNodeId("105.00000:100.00000");
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

// A - B - C an einer Straße, K ein technischer Knoten auf halbem Weg (ein Pfad stößt dort auf die Straße), D ohne Weg.
const network = () =>
    buildRouteNetwork(
        [ort("a", 100, 100), ort("b", 110, 100), ort("c", 120, 100), ort("d", 130, 120)],
        [
            weg("ab", "Strasse", [
                [100, 100],
                [105, 100],
                [110, 100],
            ]),
            weg("kc", "Pfad", [
                [105, 100],
                [112, 104],
                [120, 100.3],
            ]),
            weg("bc", "Strasse", [
                [110, 100],
                [120, 100],
            ]),
        ],
    );

/**
 * Eine Quelle, deren Revisionen der Test vorgibt (eine Kennung wie „r1“ oder eine ganze Revision), und die ihre
 * Prüfungen und Ladevorgänge zählt. `load()` liefert die Revision, die zuletzt geprüft wurde - wie die
 * Datenbank, deren Transaktion den Stand des Ladens liest.
 */
function source(
    revisions: (string | RoutingDataRevision)[],
    build: () => RouteNetwork = network,
): RoutingSource & { loads: number; checks: number; probed: RoutingDataRevision } {
    const counter = {
        loads: 0,
        checks: 0,
        probed: revisionOf("?"),
        async revision() {
            const next = revisions[Math.min(counter.checks, revisions.length - 1)] as string | RoutingDataRevision;
            counter.checks += 1;
            counter.probed = typeof next === "string" ? revisionOf(next) : next;
            return counter.probed;
        },
        async load() {
            counter.loads += 1;
            return {
                network: build(),
                water: NO_WATER,
                land: NO_WATER,
                rivers: NO_RIVERS,
                ground: NO_GROUND,
                climate: NO_CLIMATE,
                revision: counter.probed,
            };
        },
    };
    return counter;
}

const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};

const service = (quelle: RoutingSource, extra: Partial<ConstructorParameters<typeof RouteService>[0]> = {}) =>
    new RouteService({ mapDomain: "aventuria", model: AVENTURIA_TRAVEL_MODEL, source: quelle, ...extra });

/** Mit welchem Datenstand der Dienst eine Route rechnet, als Kennung („r1“); ein unbekannter bleibt sein Schlüssel. */
const stand = async (dienst: RouteService, profil: RouteRequest = zuFuss): Promise<string> => {
    const outcome = await dienst.route({ ...profil, waypoints: ["a", "c"] });
    if (!outcome.ok) return "fehler";
    const key = outcome.response.routing_graph_revision;
    return ["r1", "r2", "r3"].find((id) => keyOf(id) === key) ?? key;
};
const reiter: RouteRequest = { ...zuFuss, transports: { ...zuFuss.transports, land: "lightRider" } };
const karawane: RouteRequest = { ...zuFuss, transports: { ...zuFuss.transports, land: "caravan" } };

describe("Rechendienst", () => {
    it("antwortet im Vertrag: Etappen je Wegpunktpaar, Namen, Versionen", async () => {
        const outcome = await service(source(["r1"])).route({ ...zuFuss, waypoints: ["a", "b", "c"] });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        const route = outcome.response;
        expect(route).toMatchObject({ found: true, failed_leg_index: null, map_domain: "aventuria" });
        expect(route.routing_graph_revision).toBe(keyOf("r1"));
        expect(route.routing_graph_revision).toMatch(/^[0-9a-f]{12}$/);
        expect(route.travel_model_version).toMatch(/^[0-9a-f]{12}$/);
        // Die Teile einzeln (Plan 6.48): Kartenstand als Kurzschlüssel, das Gelände fehlt in dieser Testquelle.
        expect(route.map_revision).toMatch(/^[0-9a-f]{12}$/);
        expect(route.map_revision).not.toBe(route.routing_graph_revision);
        expect(route.terrain_revision).toBeNull();
        expect(route.waypoints.map((waypoint) => waypoint.name)).toEqual(["Ort a", "Ort b", "Ort c"]);
        expect(route.legs.map((leg) => [leg.segment_start, leg.segment_count])).toEqual([
            [0, 2],
            [2, 1],
        ]);
        const legHours = route.legs.reduce((sum, leg) => sum + leg.travel_hours, 0);
        expect(legHours).toBeCloseTo(route.travel_hours, 9);
        // Die Quelle hat keinen Seegraphen: Die Antwort sagt es (seit WI-0153 Schnitt 7e kein Rückfall auf Seewege).
        expect(route.warnings).toEqual(["free_sea_unavailable"]);
    });

    it("🔴 nimmt nur Orte als Wegpunkte - keinen technischen Knoten, keine fremde Kennung", async () => {
        const dienst = service(source(["r1"]));
        expect(network().nodes.get(K)?.kind, "der Knoten gibt es im Netz").toBe("technical");
        expect(await dienst.route({ ...zuFuss, waypoints: ["a", K] })).toEqual({
            ok: false,
            error: "unknown_waypoint",
            detail: K,
        });
        expect(await dienst.route({ ...zuFuss, waypoints: ["gibt-es-nicht", "a"] })).toMatchObject({
            detail: "gibt-es-nicht",
        });
    });

    it("meldet eine Querfeldein-Verbindung als Warnung", async () => {
        const outcome = await service(source(["r1"])).route({ ...zuFuss, waypoints: ["a", "d"] });
        expect(outcome.ok && outcome.response.warnings).toEqual(["cross_country", "free_sea_unavailable"]);
    });

    it("sagt, warum es keine Route gibt, und an welcher Etappe", async () => {
        const nurSee = { ...zuFuss, enabled: { land: false, river: false, sea: true } };
        const outcome = await service(source(["r1"])).route({ ...nurSee, waypoints: ["a", "b", "c"] });
        expect(outcome.ok && outcome.response).toMatchObject({
            found: false,
            reason: "network_disconnected",
            failed_leg_index: 0,
            segments: [],
        });
    });

    it("🔴 lädt neu, sobald sich die Revision ändert - und fragt nicht bei jeder Route", async () => {
        let jetzt = 0;
        const quelle = source(["r1", "r1", "r2"]);
        const wechsel: ReloadEvent[] = [];
        const dienst = service(quelle, { recheckMs: 1000, now: () => jetzt, onReload: (event) => wechsel.push(event) });
        expect(await stand(dienst)).toBe("r1");
        jetzt = 500;
        expect(await stand(dienst)).toBe("r1");
        expect(quelle.checks).toBe(1);
        jetzt = 1500;
        expect(await stand(dienst)).toBe("r1");
        await vi.waitFor(() => expect(quelle.checks).toBe(2));
        expect(quelle.loads).toBe(1);
        jetzt = 3000;
        // Die Anfrage, die den neuen Stand bemerkt, rechnet noch mit dem alten (Stufe 2a).
        expect(await stand(dienst)).toBe("r1");
        await vi.waitFor(() => expect(wechsel).toHaveLength(2));
        expect(await stand(dienst)).toBe("r2");
        expect(quelle.loads).toBe(2);
    });

    it("🔴 Stufe 2a: lädt den neuen Stand im Hintergrund und rechnet bis zum Wechsel mit dem alten", async () => {
        let jetzt = 0;
        const quelle = source(["r1", "r2"]);
        let freigeben = (): void => undefined;
        const langsam: RoutingSource = {
            revision: () => quelle.revision(),
            async load() {
                if (quelle.probed.map === "r2") await new Promise<void>((resolve) => (freigeben = resolve));
                return quelle.load();
            },
        };
        const wechsel: ReloadEvent[] = [];
        const dienst = service(langsam, {
            recheckMs: 1000,
            now: () => jetzt,
            onReload: (event) => wechsel.push(event),
        });
        await dienst.warm(zuFuss);
        expect(wechsel).toMatchObject([{ revision: keyOf("r1"), previous: null }]);
        await stand(dienst, reiter);
        await stand(dienst, karawane);
        expect(dienst.profileCount).toBe(3);
        jetzt = 2000;
        expect(await stand(dienst)).toBe("r1");
        await vi.waitFor(() => expect(quelle.checks).toBe(2));
        // r2 lädt und kommt nicht: Jede Anfrage antwortet trotzdem sofort, mit r1, und es gibt nur ein Laden.
        jetzt = 4000;
        expect(await stand(dienst)).toBe("r1");
        expect(await stand(dienst, reiter)).toBe("r1");
        expect(quelle.checks).toBe(2);
        // Speicher: Solange zwei Stände leben, hält der alte nur seinen zuletzt benutzten Graphen.
        expect(dienst.profileCount).toBe(1);
        freigeben();
        await vi.waitFor(() => expect(wechsel).toHaveLength(2));
        expect(wechsel[1]).toMatchObject({ revision: keyOf("r2"), previous: keyOf("r1"), changed: ["map"] });
        // Die Graphen stehen, bevor der neue Stand gilt - die erste Route baut keinen: das Vorwärmprofil und die beiden,
        // die der alte in Gebrauch hatte (WI-0117).
        expect(dienst.profileCount).toBe(3);
        expect(wechsel[1]?.profiles).toBe(3);
        expect(await stand(dienst)).toBe("r2");
        expect(quelle.loads).toBe(2);
    });

    it("🪤 Stufe 2a: scheitert das Neuladen, gilt der alte Stand weiter, und erst die nächste Frist versucht es wieder", async () => {
        let jetzt = 0;
        const quelle = source(["r1", "r2"]);
        let kaputt = true;
        const wackelig: RoutingSource = {
            revision: () => quelle.revision(),
            async load() {
                if (quelle.probed.map === "r2" && kaputt) throw new Error("Verbindung weg");
                return quelle.load();
            },
        };
        const fehler: unknown[] = [];
        const dienst = service(wackelig, {
            recheckMs: 1000,
            now: () => jetzt,
            onReloadError: (error) => fehler.push(error),
        });
        expect(await stand(dienst)).toBe("r1");
        jetzt = 2000;
        expect(await stand(dienst)).toBe("r1");
        await vi.waitFor(() => expect(fehler).toHaveLength(1));
        jetzt = 2500;
        expect(await stand(dienst)).toBe("r1");
        expect(quelle.checks).toBe(2);
        // Der alte Stand hält wieder so viele Profile wie vorher.
        await stand(dienst, reiter);
        await stand(dienst, karawane);
        expect(dienst.profileCount).toBe(3);
        kaputt = false;
        jetzt = 3000;
        await dienst.refresh();
        expect(await stand(dienst)).toBe("r2");
    });

    it("🔴 M6: ein Stand ohne Kanten wird nie aktiv - der alte gilt weiter, und der Fehler wird gemeldet", async () => {
        let jetzt = 0;
        let halbImportiert = false;
        // Ein Ort, kein Weg: So sieht das Netz aus, wenn Orte da sind und die Wege noch fehlen.
        const quelle = source(["r1", "r2"], () =>
            halbImportiert ? buildRouteNetwork([ort("a", 100, 100)], []) : network(),
        );
        const wechsel: ReloadEvent[] = [];
        const fehler: unknown[] = [];
        const dienst = service(quelle, {
            recheckMs: 1000,
            now: () => jetzt,
            onReload: (event) => wechsel.push(event),
            onReloadError: (error) => fehler.push(error),
        });
        expect(await stand(dienst)).toBe("r1");
        await stand(dienst, reiter);
        await stand(dienst, karawane);
        halbImportiert = true;
        jetzt = 2000;
        expect(await stand(dienst)).toBe("r1");
        await vi.waitFor(() => expect(fehler).toHaveLength(1));
        expect(fehler[0]).toBeInstanceOf(RoutingDataInvalid);
        expect(String(fehler[0])).toMatch(/keine Kanten.*1 Knoten, 0 Kanten/);
        expect(quelle.loads).toBe(2);
        expect(wechsel).toHaveLength(1);
        // Der alte Stand antwortet weiter und hält wieder so viele Profile wie vorher (der Fehler räumt auf).
        expect(await stand(dienst)).toBe("r1");
        await stand(dienst, reiter);
        await stand(dienst, karawane);
        expect(dienst.profileCount).toBe(3);
        // Ist der Import fertig, gilt der neue Stand.
        halbImportiert = false;
        jetzt = 4000;
        await dienst.refresh();
        expect(await stand(dienst)).toBe("r2");
        expect(wechsel).toHaveLength(2);
    });

    it("🔴 M6: schon der erste Stand wird geprüft - ohne brauchbares Netz gibt es keine Antwort und keinen Stand", async () => {
        const wechsel: ReloadEvent[] = [];
        const dienst = service(
            source(["r1"], () => buildRouteNetwork([], [])),
            { onReload: (event) => wechsel.push(event) },
        );
        await expect(dienst.route({ ...zuFuss, waypoints: ["a", "c"] })).rejects.toBeInstanceOf(RoutingDataInvalid);
        expect(wechsel).toEqual([]);
        expect(dienst.profileCount).toBe(0);
    });

    it("🪤 M6: kehrt der Stand zwischen Prüfen und Laden zurück, gibt es nichts zu wechseln", async () => {
        let jetzt = 0;
        const quelle = source(["r1", "r2"]);
        // Die Prüfung sah r2; bis die Transaktion lädt, ist es wieder r1.
        const zurueck: RoutingSource = {
            revision: () => quelle.revision(),
            load: async () => ({ ...(await quelle.load()), revision: revisionOf("r1") }),
        };
        const wechsel: ReloadEvent[] = [];
        const dienst = service(zurueck, {
            recheckMs: 1000,
            now: () => jetzt,
            onReload: (event) => wechsel.push(event),
        });
        await dienst.warm(zuFuss);
        jetzt = 2000;
        await dienst.refresh();
        expect(quelle.loads).toBe(2);
        expect(wechsel).toHaveLength(1);
        expect(await stand(dienst)).toBe("r1");
        expect(dienst.profileCount).toBe(1);
    });

    it("M6: das Journal nennt, welche Teile sich geändert haben - beim ersten Laden alle", async () => {
        let jetzt = 0;
        const erste = revisionOf("r1");
        const quelle = source([
            erste,
            { ...erste, terrain: "1/abc|2/x|3/y" },
            { ...erste, terrain: null, climate: "10/z" },
        ]);
        const wechsel: ReloadEvent[] = [];
        const dienst = service(quelle, { recheckMs: 1000, now: () => jetzt, onReload: (event) => wechsel.push(event) });
        await stand(dienst);
        expect(wechsel[0]?.changed).toEqual([
            "map",
            "travelModel",
            "terrain",
            "pathProfiles",
            "seaGraph",
            "climate",
            "territories",
            "settings",
            "settingsLive",
        ]);
        jetzt = 2000;
        await stand(dienst);
        await vi.waitFor(() => expect(wechsel).toHaveLength(2));
        expect(wechsel[1]?.changed).toEqual(["terrain"]);
        expect(wechsel[1]?.revision).toBe(revisionKey({ ...erste, terrain: "1/abc|2/x|3/y" }));
        jetzt = 4000;
        await stand(dienst);
        await vi.waitFor(() => expect(wechsel).toHaveLength(3));
        expect(wechsel[2]?.changed).toEqual(["terrain", "climate"]);
    });

    it("🔴 M6: der Seegraph wird gegen den Teil seaGraph der geladenen Revision geladen", async () => {
        const gefragt: (string | null)[] = [];
        const quelle: RoutingSource = {
            ...source([{ ...revisionOf("r1"), seaGraph: "algorithmus:quelle" }]),
            loadSea: async (seaGraph) => {
                gefragt.push(seaGraph);
                return null;
            },
        };
        const outcome = await service(quelle).route({ ...zuFuss, waypoints: ["a", "c"] });
        expect(gefragt).toEqual(["algorithmus:quelle"]);
        // Kein passender Seegraph: die Route rechnet ohne Seereise und sagt es (seit WI-0153 Schnitt 7e kein Rückfall auf Seewege).
        expect(outcome.ok && outcome.response.warnings).toContain("free_sea_unavailable");
    });

    it("hält höchstens maxProfiles Graphen im Speicher", async () => {
        const dienst = service(source(["r1"]), { maxProfiles: 2 });
        for (const land of ["groupFoot", "lightRider", "caravan"]) {
            await dienst.route({ ...zuFuss, transports: { ...zuFuss.transports, land }, waypoints: ["a", "c"] });
        }
        expect(dienst.profileCount).toBe(2);
    });

    it("🔴 S-04: das Mittel eines abgeschalteten Mediums macht keinen neuen Graphen", async () => {
        const dienst = service(source(["r1"]), { maxProfiles: 2 });
        const nurLand = { ...zuFuss.enabled, river: false, sea: false };
        for (const sea of ["cargoShip", "fastShip", "galley"]) {
            for (const river of ["riverSailer", "riverBarge"]) {
                await dienst.route({
                    ...zuFuss,
                    enabled: nurLand,
                    transports: { ...zuFuss.transports, river, sea },
                    waypoints: ["a", "c"],
                });
            }
        }
        expect(dienst.profileCount).toBe(1);
    });

    it("🪤 teilt einen Graphen zwischen „schnellste“ und „kürzeste“ - und rechnet trotzdem nach der Anfrage", async () => {
        const dienst = service(source(["r1"]));
        const schnell = await dienst.route({ ...zuFuss, waypoints: ["a", "c"] });
        const kurz = await dienst.route({ ...zuFuss, optimize: "shortest", waypoints: ["a", "c"] });
        expect(dienst.profileCount).toBe(1);
        expect(schnell.ok && kurz.ok).toBe(true);
    });
});

describe("Reisekosten im Rechendienst (WI-0065 U4)", () => {
    const quadrat = (id: string, name: string, x0: number, x1: number) => {
        const territory = prepareBorderTerritory({
            id,
            name,
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [x0, 0],
                        [x1, 0],
                        [x1, 200],
                        [x0, 200],
                        [x0, 0],
                    ],
                ],
            },
        });
        if (territory === null) throw new Error("kein Polygon");
        return territory;
    };
    // Die Straße a - b - c läuft von x = 100 bis 120. West reicht bis 112, Ost ab dort: eine Grenze zwischen b und c.
    const geteilt: TollTerritories = {
        territories: [quadrat("west", "Westreich", 0, 112), quadrat("ost", "Ostreich", 112, 200)],
        yearBf: 1049,
    };
    // Dasselbe Land als EIN Reich: keine Grenze.
    const ganz: TollTerritories = { territories: [quadrat("reich", "Ganzes Reich", 0, 200)], yearBf: 1049 };

    /** Eine Quelle, deren Stand (Revision samt Zollgebieten) der Test wechselt. */
    function quelleMitGebieten(
        current: () => { revision: RoutingDataRevision; gebiete: TollTerritories },
    ): RoutingSource {
        return {
            revision: async () => current().revision,
            load: async () => ({
                network: network(),
                water: NO_WATER,
                land: NO_WATER,
                rivers: NO_RIVERS,
                ground: NO_GROUND,
                climate: NO_CLIMATE,
                territories: current().gebiete,
                revision: current().revision,
            }),
        };
    }
    const einStand = (gebiete: TollTerritories, id = "r1") =>
        service(quelleMitGebieten(() => ({ revision: { ...revisionOf(id), territories: "z1" }, gebiete })));

    const kosten = async (
        dienst: RouteService,
        request: RouteRequest = zuFuss,
        extra: { hoursPerDay?: number } = {},
    ) => {
        const outcome = await dienst.route({ ...request, ...extra, waypoints: ["a", "c"] });
        if (!outcome.ok || !outcome.response.travel_costs) throw new Error("keine Kosten");
        return outcome.response;
    };
    const zoll = (response: Awaited<ReturnType<typeof kosten>>, level: "frei" | "strohsack" | "bett" | "zimmer") =>
        response.travel_costs?.by_lodging[level].rows.find((row) => row.key === "tolls");

    it("🔴 die Landesgrenzen kommen aus den Zollgebieten des Datenstands: eine Grenze, Zoll je Stufe, das Jahr", async () => {
        const response = await kosten(einStand(geteilt));
        expect(response.travel_costs?.borders?.count).toBe(1);
        expect(response.travel_costs?.borders?.crossings[0]).toMatchObject({
            from: { id: "west", name: "Westreich", short_name: "Westreich" },
            to: { id: "ost", name: "Ostreich" },
        });
        expect(response.travel_costs?.territory_year_bf).toBe(1049);
        expect([zoll(response, "frei")?.heller, zoll(response, "strohsack")?.heller]).toEqual([1, 5]);
        expect([zoll(response, "bett")?.heller, zoll(response, "zimmer")?.heller]).toEqual([100, 500]);
        // Die Linie ist die der Fahrtrichtung: dieselbe Reise rückwärts hat dieselbe Grenze in umgekehrter Richtung.
        const back = await einStand(geteilt).route({ ...zuFuss, waypoints: ["c", "a"] });
        expect(back.ok && back.response.travel_costs?.borders?.crossings[0]).toMatchObject({
            from: { id: "ost" },
            to: { id: "west" },
        });
    });

    it("🔴 ohne Gebiete (nichts abgeleitet) ist der Zoll nicht ermittelbar: null, nie 0, und die Summe unvollständig", async () => {
        const response = await kosten(einStand({ territories: [], yearBf: null }));
        expect(response.travel_costs?.borders).toBeNull();
        expect(response.travel_costs?.territory_year_bf).toBeNull();
        expect(zoll(response, "bett")).toEqual({ key: "tolls", heller: null, status: "UNKNOWN", count: 0 });
        expect(response.travel_costs?.by_lodging.bett.complete).toBe(false);
        // Ein Stand ohne das Feld (ältere Quelle) verhält sich ebenso.
        const ohne = await kosten(service(source(["r1"])));
        expect(ohne.travel_costs?.borders).toBeNull();
    });

    it("die Kosten hängen nur an Route, Landmittel, Reisestunden und Gebieten - nicht an Optimierung oder den anderen Medien", async () => {
        const dienst = einStand(geteilt);
        const standard = (await kosten(dienst)).travel_costs;
        // Dieselbe Route, andere Optimierung, Fluss und See abgeschaltet: dieselben Kosten.
        expect((await kosten(dienst, { ...zuFuss, optimize: "shortest" })).travel_costs).toEqual(standard);
        expect(
            (await kosten(dienst, { ...zuFuss, enabled: { land: true, river: false, sea: false } })).travel_costs,
        ).toEqual(standard);
        // Das Landmittel bringt das Reittier: Der Zoll bleibt, eine Zeile Reittier kommt hinzu.
        const zuPferd = await kosten(dienst, reiter);
        expect(zoll(zuPferd, "bett")).toEqual(zoll(await kosten(dienst), "bett"));
        expect(zuPferd.travel_costs?.by_lodging.bett.rows.some((row) => row.key === "mount")).toBe(true);
        expect(standard?.by_lodging.bett.rows.some((row) => row.key === "mount")).toBe(false);
        // Reisestunden: 24 heißt keine Rast und keine Nacht.
        const ohneRast = await kosten(dienst, zuFuss, { hoursPerDay: 24 });
        expect(ohneRast.travel_costs?.by_lodging.bett.nights).toEqual({ inn: 0, open: 0, aboard: 0 });
        expect(zoll(ohneRast, "bett")).toEqual(zoll(await kosten(dienst), "bett"));
    });

    it("🔴 ein Wechsel der Gebiets-Revision ändert die Grenzen und die Revision, nicht die Route", async () => {
        let jetzt = 0;
        let stand = { revision: { ...revisionOf("r1"), territories: "z1" }, gebiete: geteilt };
        const dienst = service(
            quelleMitGebieten(() => stand),
            { recheckMs: 1000, now: () => jetzt },
        );
        const vorher = await kosten(dienst);
        expect(vorher.travel_costs?.borders?.count).toBe(1);
        // Eine neue Ableitung: dasselbe Land als ein Reich, anderer Teil in der Revision.
        stand = { revision: { ...revisionOf("r1"), territories: "z2" }, gebiete: ganz };
        jetzt = 2000;
        await dienst.refresh();
        const nachher = await kosten(dienst);
        expect(nachher.routing_graph_revision).not.toBe(vorher.routing_graph_revision);
        expect(nachher.travel_costs?.borders?.count).toBe(0);
        expect(zoll(nachher, "bett")).toEqual({ key: "tolls", heller: 0, status: "SOURCE_RULE", count: 0 });
        // Die Route selbst bleibt: Kosten ändern keinen Weg.
        expect(nachher.segments).toEqual(vorher.segments);
        expect(nachher.stages).toEqual(vorher.stages);
        expect(nachher.total_hours).toBe(vorher.total_hours);
        expect(nachher.travel_days).toBe(vorher.travel_days);
    });

    it("im Flug und ohne Route trägt die Antwort keine Kosten (Plan 6.37)", async () => {
        const dienst = einStand(geteilt);
        const flug = await dienst.route({
            ...zuFuss,
            waypoints: ["a", "c"],
            air: {
                profile: "griffin",
                speedMph: 50,
                altitudeSchritt: 800,
                maxAboveGroundSchritt: 8000,
                ceilingSchritt: 5000,
            },
        });
        expect(flug.ok && flug.response.found).toBe(true);
        expect(flug.ok && "travel_costs" in flug.response).toBe(false);
        // Kein Weg zu d: ein Gang querfeldein wäre gefunden; mit nur Seewegen gibt es keine Route.
        const ohneRoute = await dienst.route({
            ...zuFuss,
            enabled: { land: false, river: false, sea: true },
            waypoints: ["a", "c"],
        });
        expect(ohneRoute.ok && ohneRoute.response.found).toBe(false);
        expect(ohneRoute.ok && "travel_costs" in ohneRoute.response).toBe(false);
    });
});

describe("Prüfung eines Netzes vor der Aktivierung", () => {
    const problems = (nodes: RouteNode[], paths: Parameters<typeof buildRouteNetwork>[1]): string[] =>
        networkProblems(buildRouteNetwork(nodes, paths));
    const strasse = weg("ab", "Strasse", [
        [100, 100],
        [110, 100],
    ]);

    it("lässt ein Netz mit Orten und Kanten durch", () => {
        expect(networkProblems(network())).toEqual([]);
    });

    it("weist ein Netz ohne Knoten zurück, und eines ohne Kanten", () => {
        expect(problems([], [])).toEqual(["keine Knoten", "keine Kanten"]);
        expect(problems([ort("a", 100, 100)], [])).toEqual(["keine Kanten"]);
    });

    it("🪤 verlangt einen Ort: technische Knoten allein beantworten keine Anfrage", () => {
        // Ohne Orte entstehen an beiden Enden Sackgassen: ein Netz mit Kante, aber ohne einen einzigen Ort.
        expect(problems([], [strasse])).toEqual(["keine Orte"]);
        expect(problems([ort("a", 100, 100), ort("b", 110, 100)], [strasse])).toEqual([]);
    });

    it("weist eine Kante mit unbekanntem Ende zurück", () => {
        const netz = network();
        netz.nodes.delete("b");
        // b liegt an zwei Kanten: dem zweiten Stück der Strasse a-b und an b-c.
        expect(networkProblems(netz)).toEqual(["2 Kanten mit unbekanntem Ende"]);
        expect(() => assertUsableNetwork(netz)).toThrow(/Kanten mit unbekanntem Ende; 4 Knoten, 4 Kanten/);
    });
});

describe("Seegraph passend zur Revision", () => {
    const graph = { nodeX: new Float32Array(0) } as unknown as CompactSeaGraph;
    const stored = {
        graph,
        algorithm: "algo",
        fingerprint: "fp",
        derivedAt: "",
        stats: {},
    } as unknown as StoredSeaRoutes;

    it("liefert den Graphen nur, wenn Algorithmus und Quellen zur geladenen Revision passen", () => {
        expect(matchingSeaGraph(stored, seaGraphIdentity("algo", "fp"))).toBe(graph);
        expect(matchingSeaGraph(stored, seaGraphIdentity("algo", "neu"))).toBeNull();
        expect(matchingSeaGraph(stored, seaGraphIdentity("algo-neu", "fp"))).toBeNull();
    });

    it("liefert keinen, wenn der Stand keinen kannte oder inzwischen keiner mehr da ist", () => {
        expect(matchingSeaGraph(stored, null)).toBeNull();
        expect(matchingSeaGraph(null, seaGraphIdentity("algo", "fp"))).toBeNull();
        expect(matchingSeaGraph(null, null)).toBeNull();
    });
});

describe("Ladezeit je Schritt im Journal (`parts_ms`)", () => {
    /** Eine Quelle, die zwei Bestandteile mit festen Zeiten meldet, wie es `databaseRoutingSource` tut. */
    function meldend(extra: Partial<RoutingSource> = {}): RoutingSource {
        const basis = source(["r1"]);
        return {
            revision: () => basis.revision(),
            async load(previous, report) {
                report?.("network", 7);
                report?.("heights", 11);
                return basis.load();
            },
            ...extra,
        };
    }
    const ganzzahlig = (ms: unknown): boolean => typeof ms === "number" && Number.isInteger(ms) && ms >= 0;

    it("🔴 trägt Prüfen, die Zeiten der Quelle und das Vorbereiten des Warmprofils ins Ereignis", async () => {
        const wechsel: ReloadEvent[] = [];
        const dienst = service(meldend(), { onReload: (event) => wechsel.push(event) });
        await dienst.warm(zuFuss);
        expect(wechsel).toHaveLength(1);
        const parts = wechsel[0]?.parts_ms ?? {};
        // Mit See braucht das Warmprofil den Seegraphen (WI-0153 Schnitt 7e): der Schritt `sea` steht immer dabei.
        expect(Object.keys(parts).sort()).toEqual([
            "graph",
            "heights",
            "index",
            "network",
            "probe",
            "sea",
            "year_round",
        ]);
        expect(parts["network"]).toBe(7);
        expect(parts["heights"]).toBe(11);
        expect(ganzzahlig(parts["probe"]) && ganzzahlig(parts["graph"]) && ganzzahlig(parts["index"])).toBe(true);
    });

    it("der Seegraph steht dabei, wenn das Warmprofil ihn braucht", async () => {
        const wechsel: ReloadEvent[] = [];
        const dienst = service(meldend({ loadSea: async () => null }), { onReload: (event) => wechsel.push(event) });
        await dienst.warm({ ...zuFuss });
        expect(Object.keys(wechsel[0]?.parts_ms ?? {})).toContain("sea");
        expect(ganzzahlig(wechsel[0]?.parts_ms["sea"])).toBe(true);
    });

    it("eine Quelle ohne Meldung gibt ein Ereignis mit den Schritten des Dienstes, ohne Fehler", async () => {
        const wechsel: ReloadEvent[] = [];
        const dienst = service(source(["r1"]), { onReload: (event) => wechsel.push(event) });
        await dienst.warm(zuFuss);
        expect(Object.keys(wechsel[0]?.parts_ms ?? {}).sort()).toEqual([
            "graph",
            "index",
            "probe",
            "sea",
            "year_round",
        ]);
    });
});

describe("🔴 Vorbereiten vor dem ersten Gebrauch (WI-0117)", () => {
    /**
     * Die erste Route nach dem Nachladen lief auf Stage in die 2 s des Runners (`routing_timeout`, dahinter alles
     * `routing_busy`): Was sie sonst im Anfragepfad rechnete - die ganzjährigen Brücken jedes Profils für Routen mit
     * Reisebeginn, der Graph eines Profils, das der alte Stand schon hielt, das Flugraster -, steht jetzt im Vorbereiten,
     * das Start und Nachladen teilen. Beobachtet wird, wie oft die Brückensuche das Wasser fragt (`chordCrossesWater`
     * liest zuerst `water.areas`): Eine Rechnung im Anfragepfad zählt dort mit.
     */
    const SOMMER: SeasonWindow = { from_month: "praios", from_day: 1, to_month: "efferd", to_day: 30 };
    const praios = { month: "praios" as const, day: 1 };

    /** A–B und C–D an Straßen, dazwischen ein Flussweg, der nur im Sommer fährt: ohne ihn zwei Netzteile. */
    const flussNetz = (): RouteNetwork =>
        buildRouteNetwork(
            [ort("A", 0, 0), ort("B", 10, 0), ort("C", 30, 0), ort("D", 40, 0)],
            [
                weg("ab", "Strasse", [
                    [0, 0],
                    [10, 0],
                ]),
                weg("cd", "Strasse", [
                    [30, 0],
                    [40, 0],
                ]),
                {
                    ...weg("bc", "Flussweg", [
                        [10, 0],
                        [30, 0],
                    ]),
                    transport_seasons: { riverSailer: SOMMER },
                },
            ],
        );

    /** Eine Quelle über dem Flussnetz, deren Wasser zählt, wie oft es gefragt wird. */
    function zaehlend(revisions: string[], extra: Partial<RoutingData> = {}) {
        const basis = source(revisions, flussNetz);
        let fragen = 0;
        const wasser: Water = {
            get areas() {
                fragen += 1;
                return [];
            },
            grid: new Map(),
        };
        const quelle: RoutingSource = {
            revision: () => basis.revision(),
            async load() {
                return { ...(await basis.load()), water: wasser, land: wasser, ...extra };
            },
        };
        return { quelle, fragen: () => fragen };
    }
    /** Nur Land: ohne den Flussweg hängen die Netzteile nicht zusammen, und jeder Graph sucht die Brücke zwischen ihnen. */
    const nurLand = (request: RouteRequest): RouteRequest => ({
        ...request,
        enabled: { land: true, river: false, sea: false },
    });

    it("das Vorwärmen legt die ganzjährigen Brücken ab: die erste Route mit Reisebeginn rechnet sie nicht mehr", async () => {
        const { quelle, fragen } = zaehlend(["r1"]);
        const dienst = service(quelle);
        await dienst.warm(zuFuss);
        const nachStart = fragen();
        expect(nachStart, "beim Vorwärmen gerechnet").toBeGreaterThan(0);
        const outcome = await dienst.route({ ...zuFuss, departure: praios, waypoints: ["A", "D"] });
        expect(outcome.ok && outcome.response.found).toBe(true);
        expect(fragen(), "die erste Route rechnet nichts mehr").toBe(nachStart);
    });

    it("nach dem Nachladen steht dasselbe bereit, bevor der neue Stand gilt", async () => {
        let jetzt = 0;
        const { quelle, fragen } = zaehlend(["r1", "r2"]);
        const dienst = service(quelle, { recheckMs: 1000, now: () => jetzt });
        await dienst.warm(zuFuss);
        const vorLaden = fragen();
        jetzt = 5000;
        await dienst.refresh();
        const nachLaden = fragen();
        expect(nachLaden, "der neue Stand hat seine Brücken gerechnet").toBeGreaterThan(vorLaden);
        const outcome = await dienst.route({ ...zuFuss, departure: praios, waypoints: ["A", "D"] });
        expect(outcome.ok && outcome.response.routing_graph_revision).toBe(keyOf("r2"));
        expect(fragen(), "die erste Route auf dem neuen Stand rechnet nichts mehr").toBe(nachLaden);
    });

    it("die Profile, die der alte Stand in Gebrauch hatte, baut der neue vor dem Wechsel nach", async () => {
        let jetzt = 0;
        const { quelle, fragen } = zaehlend(["r1", "r2"]);
        const dienst = service(quelle, { recheckMs: 1000, now: () => jetzt });
        await dienst.warm(zuFuss);
        const eigenes = nurLand(reiter);
        /** Wie oft eine Route auf dem anderen Profil das Wasser fragt: Graph (wenn er noch fehlt) und Wegfindung. */
        const gelesen = async (): Promise<number> => {
            const vor = fragen();
            const outcome = await dienst.route({ ...eigenes, waypoints: ["A", "D"] });
            expect(outcome.ok && outcome.response.found).toBe(true);
            return fragen() - vor;
        };
        const mitGraph = await gelesen();
        const stetig = await gelesen();
        expect(mitGraph, "die erste Route baute den Graphen").toBeGreaterThan(stetig);
        expect(dienst.profileCount).toBe(2);
        jetzt = 5000;
        await dienst.refresh();
        // Der neue Stand hält beide, und die erste Route auf dem anderen Profil baut keinen Graphen mehr.
        expect(dienst.profileCount).toBe(2);
        expect(await gelesen()).toBe(stetig);
    });

    it("🪤 ein Profil, das der alte Stand nie hielt, ist kalt - es baut in der Anfrage (die Grenze des Vorwärmens)", async () => {
        let jetzt = 0;
        const { quelle, fragen } = zaehlend(["r1", "r2"]);
        const dienst = service(quelle, { recheckMs: 1000, now: () => jetzt });
        await dienst.warm(zuFuss);
        const eigenes = nurLand(reiter);
        const gelesen = async (): Promise<number> => {
            const vor = fragen();
            await dienst.route({ ...eigenes, waypoints: ["A", "D"] });
            return fragen() - vor;
        };
        jetzt = 5000;
        await dienst.refresh();
        const kalt = await gelesen();
        const stetig = await gelesen();
        expect(kalt).toBeGreaterThan(stetig);
    });

    it("das Flugraster des Geländes steht im Vorbereiten: jeder Flug braucht es", async () => {
        const basis = source(["r1"]);
        const quelle: RoutingSource = {
            revision: () => basis.revision(),
            async load() {
                return { ...(await basis.load()), heights: wandHoch() };
            },
        };
        const wechsel: ReloadEvent[] = [];
        const dienst = service(quelle, { onReload: (event) => wechsel.push(event) });
        await dienst.warm(zuFuss);
        const air = wechsel[0]?.parts_ms["air"];
        expect(typeof air === "number" && Number.isInteger(air) && air >= 0).toBe(true);
    });

    it("ohne Gelände gibt es kein Flugraster zu bereiten", async () => {
        const wechsel: ReloadEvent[] = [];
        const dienst = service(source(["r1"]), { onReload: (event) => wechsel.push(event) });
        await dienst.warm(zuFuss);
        expect(Object.keys(wechsel[0]?.parts_ms ?? {})).not.toContain("air");
    });
});

describe("Schnappschuss der Datenbankquelle (M6)", () => {
    const transaktion = { art: "transaktion" } as unknown as Queryable;
    const empty: Omit<RoutingData, "revision"> = {
        network: network(),
        water: NO_WATER,
        land: NO_WATER,
        rivers: NO_RIVERS,
        ground: NO_GROUND,
        climate: NO_CLIMATE,
    };

    /** Eine Verbindung, die nur `begin` kann, und Lesezugriffe, die sich merken, woran sie gelesen haben. */
    function beobachtet() {
        const begins: string[] = [];
        const verbindung = {
            begin: async (options: string, callback: (connection: Queryable) => Promise<unknown>) => {
                begins.push(options);
                return callback(transaktion);
            },
        } as unknown as Queryable;
        const gelesen: { was: string; an: Queryable; modell?: string }[] = [];
        const reads: RoutingReads = {
            async revision(an, _domain, modell) {
                gelesen.push({ was: "revision", an, modell });
                return revisionOf("r1");
            },
            async data(an) {
                gelesen.push({ was: "daten", an });
                return empty;
            },
        };
        return { begins, verbindung, gelesen, reads };
    }

    it("🔴 liest Revision und Daten in EINER Transaktion, nicht an der Verbindung", async () => {
        const { begins, verbindung, gelesen, reads } = beobachtet();
        const data = await databaseRoutingSource(verbindung, "aventuria", AVENTURIA_TRAVEL_MODEL, reads).load();
        expect(begins).toEqual([SNAPSHOT_TRANSACTION]);
        expect(gelesen.map((lesen) => lesen.was)).toEqual(["revision", "daten"]);
        expect(gelesen.every((lesen) => lesen.an === transaktion)).toBe(true);
        // Die Revision des Standes ist die aus der Transaktion.
        expect(data.revision).toEqual(revisionOf("r1"));
        expect(gelesen[0]?.modell).toBe(travelModelVersion(AVENTURIA_TRAVEL_MODEL));
    });

    it("die Prüfung der Frist braucht keine Transaktion", async () => {
        const { begins, verbindung, gelesen, reads } = beobachtet();
        await databaseRoutingSource(verbindung, "aventuria", AVENTURIA_TRAVEL_MODEL, reads).revision();
        expect(begins).toEqual([]);
        expect(gelesen).toMatchObject([{ was: "revision", an: verbindung }]);
    });

    it("liest in der schon offenen Transaktion, statt eine zweite zu beginnen", async () => {
        const { gelesen, reads } = beobachtet();
        await databaseRoutingSource(transaktion, "aventuria", AVENTURIA_TRAVEL_MODEL, reads).load();
        expect(gelesen.map((lesen) => lesen.an)).toEqual([transaktion, transaktion]);
    });

    it("meldet die Zeit der Revision, der Bestandteile und der Transaktion - und ohne Meldung geschieht nichts", async () => {
        const { verbindung } = beobachtet();
        const reads: RoutingReads = {
            async revision() {
                return revisionOf("r1");
            },
            async data(_an, _domain, _modell, _wanted, _reusable, report) {
                report?.("network", 5);
                return empty;
            },
        };
        const gemeldet: [string, number][] = [];
        const report = (part: string, ms: number): void => void gemeldet.push([part, ms]);
        await databaseRoutingSource(verbindung, "aventuria", AVENTURIA_TRAVEL_MODEL, reads).load(undefined, report);
        expect(gemeldet.map(([part]) => part)).toEqual(["revision", "network", "transaction"]);
        expect(gemeldet[1]).toEqual(["network", 5]);
        expect(gemeldet.every(([, ms]) => Number.isInteger(ms) && ms >= 0)).toBe(true);
        // In der schon offenen Transaktion gibt es keine eigene Zeit dafür.
        gemeldet.length = 0;
        await databaseRoutingSource(transaktion, "aventuria", AVENTURIA_TRAVEL_MODEL, reads).load(undefined, report);
        expect(gemeldet.map(([part]) => part)).toEqual(["revision", "network"]);
        // Ohne `report` lädt die Quelle wie zuvor.
        await expect(
            databaseRoutingSource(verbindung, "aventuria", AVENTURIA_TRAVEL_MODEL, reads).load(),
        ).resolves.toMatchObject({ revision: revisionOf("r1") });
    });

    it("ein Fehler beim Lesen der Daten gibt keine halbe Revision zurück", async () => {
        const { verbindung, reads } = beobachtet();
        const kaputt: RoutingReads = { ...reads, data: () => Promise.reject(new Error("Verbindung weg")) };
        await expect(
            databaseRoutingSource(verbindung, "aventuria", AVENTURIA_TRAVEL_MODEL, kaputt).load(),
        ).rejects.toThrow("Verbindung weg");
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
describe.skipIf(!testDatabaseUrl)("Revision aus der Datenbank", () => {
    const database = createDatabase(testDatabaseUrl ?? "");
    afterAll(() => database.end({ timeout: 5 }));
    const quelle = () => databaseRoutingSource(database, AVENTURIA.mapDomain, AVENTURIA_TRAVEL_MODEL);

    it("hat einen kurzen Schlüssel und bleibt gleich, solange sich nichts ändert", async () => {
        const erste = await quelle().revision();
        expect(revisionKey(erste)).toMatch(/^[0-9a-f]{12}$/);
        expect(erste.travelModel).toBe(travelModelVersion(AVENTURIA_TRAVEL_MODEL));
        // Orte, Wege, Regionen, Flächen; seit WI-0132 Release N ohne Kreuzungen.
        expect(erste.map.split("|")).toHaveLength(4);
        expect(await quelle().revision()).toEqual(erste);
    });

    it("🔴 load() bringt die Revision der eigenen Transaktion mit, und sie ist die geprüfte, wenn sich nichts ändert", async () => {
        const source = quelle();
        const geprueft = await source.revision();
        const data = await source.load();
        expect(data.revision).toEqual(geprueft);
        expect(data.network.nodes).toBeInstanceOf(Map);
    });

    it("🔴 der Schnappschuss ist wirklich repeatable read und nur lesend", async () => {
        const [isolation, lesend] = await database.begin(SNAPSHOT_TRANSACTION, async (transaction) => [
            (await transaction<{ transaction_isolation: string }[]>`SHOW transaction_isolation`)[0]
                ?.transaction_isolation,
            (await transaction<{ transaction_read_only: string }[]>`SHOW transaction_read_only`)[0]
                ?.transaction_read_only,
        ]);
        expect(isolation).toBe("repeatable read");
        expect(lesend).toBe("on");
    });

    it("ein Teil ohne Ableitung fehlt (null), und die Anweisung läuft auch ohne Zeilen", async () => {
        const revision = await readRoutingRevision(database, "gibt-es-nicht", "modell");
        expect(revision).toMatchObject({ travelModel: "modell", terrain: null, pathProfiles: null, seaGraph: null });
        expect(revision.map).toBe("0/-|0/-|0/-|0/-");
    });

    it("🔴 der Teil seaGraph ist genau die Kennung, mit der der Lader vergleicht", async () => {
        // Eine Zeile in einer Transaktion, die zurückgerollt wird: Die Testdatenbank bleibt, wie sie war.
        const gelesen: { revision?: RoutingDataRevision } = {};
        await database
            .begin(async (transaction) => {
                await transaction`
                    INSERT INTO sea_route_graph (map_domain_id, algorithm_version, source_fingerprint, graph, stats)
                    VALUES (${AVENTURIA.mapDomain}, 'algo-test', 'quelle-test', ${Buffer.from([1])}, '{}'::jsonb)
                    ON CONFLICT (map_domain_id) DO UPDATE SET
                        algorithm_version = EXCLUDED.algorithm_version,
                        source_fingerprint = EXCLUDED.source_fingerprint
                `;
                gelesen.revision = await readRoutingRevision(transaction, AVENTURIA.mapDomain, "modell");
                throw new Error("zurückrollen");
            })
            .catch((error: unknown) => {
                if (!(error instanceof Error) || error.message !== "zurückrollen") throw error;
            });
        expect(gelesen.revision?.seaGraph).toBe(seaGraphIdentity("algo-test", "quelle-test"));
    });
});
