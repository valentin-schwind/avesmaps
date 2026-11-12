import { afterEach, describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    landmarkWaypointId,
    mapPointId,
    parseLandmarkWaypointId,
    RouteQuerystring,
    type LandmarkenArt,
    type RouteAir,
    type RouteResponse,
} from "@avesmaps3d/shared";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { NO_CLIMATE } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { asLandmarkRoute, landmarkStations, type RouteLandmark } from "../src/routing/landmark-waypoints.ts";
import { buildRouteNetwork, type RouteNode } from "../src/routing/network.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import type { RouteRequest } from "../src/routing/router.ts";
import { createInlineRunner, type RouteRunner, type RunOutcome } from "../src/routing/runner.ts";
import { RouteService, type RouteQuery } from "../src/routing/service.ts";
import { prepareWater } from "../src/routing/water.ts";
import {
    isWaypointLandmark,
    nearestWaypoint,
    rankWaypoints,
    resolveWaypoints,
    waypointsById,
    type WaypointIndex,
    type WaypointPlace,
} from "../src/routing/waypoints.ts";
import { revisionOf } from "./support/routing-revision.ts";

/**
 * Landmarken als Wegpunkt (WI-0271 L6, §4.3): `l:<uuid>` fährt wie ein Kartenpunkt an der Lage der Landmarke und heißt im Ergebnis
 * wie sie. Auftrag der Orchestrierung: additiv, Ortsrouten bytegleich, abgesichert über die KANTENFOLGE, nie über Reisezeiten
 * (`routing-aenderungen-pruefen`).
 *
 * 🔴 Alle Landmarken hier sind Attrappen im Speicher: Netz, Land und Landmarken baut der Test selbst. Die Abfrage gegen `terrain_peak`
 * prüft `route-waypoints-landmarken.test.ts` im Wegwerf-Cluster.
 *
 * Problemfälle: Eine Ortsroute ändert sich, weil Landmarken im Bestand sind; eine Route über die Landmarke nimmt andere Kanten als
 * über den Kartenpunkt an derselben Stelle; im Ergebnis steht „Kartenpunkt“ oder die interne Kennung `p:` statt Name und `l:`; eine
 * Absage nennt den Kartenpunkt statt der Landmarke; Riff, Strudel oder eine stillgelegte Landmarke werden Wegpunkt; eine Landmarke
 * zählt nicht in die Grenze der Kartenpunkte.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

function quadrat(minX: number, minY: number, maxX: number, maxY: number) {
    return prepareWater([
        {
            geometry: {
                type: "Polygon",
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
        },
    ]);
}

const ort = (id: string, name: string, x: number, y: number): RouteNode => ({
    id,
    name,
    kind: "place",
    isHidden: false,
    x,
    y,
});

/** Eine Straße von Anfang (100|100) nach Ende (120|100) mit Stützpunkten bei 105, 110 und 115. */
const network = () =>
    buildRouteNetwork(
        [ort(A, "Anfang", 100, 100), ort(B, "Ende", 120, 100)],
        [
            {
                public_id: "strasse",
                name: "Reichsweg",
                subtype: "Strasse",
                coordinates: JSON.stringify({
                    type: "LineString",
                    coordinates: [
                        [100, 100],
                        [105, 100],
                        [110, 100],
                        [115, 100],
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

/** Alles Land, und im Osten ein Meer. */
const meer = quadrat(200, 90, 220, 110);
const land = quadrat(0, 0, 300, 300);

const service = () =>
    new RouteService({
        mapDomain: "aventuria",
        model: AVENTURIA_TRAVEL_MODEL,
        source: {
            revision: async () => revisionOf("r1"),
            load: async () => ({
                network: network(),
                water: meer,
                land,
                rivers: NO_RIVERS,
                ground: NO_GROUND,
                climate: NO_CLIMATE,
                revision: revisionOf("r1"),
            }),
        },
    });

const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: false, sea: false },
    minimizeTransfers: false,
};

const landmarke = (uuid: string, name: string, subtype: string, x: number, y: number): RouteLandmark => ({
    id: landmarkWaypointId(uuid),
    name,
    subtype,
    x,
    y,
});
/** Nicht auf drei Stellen: Die Route fährt den Kartenpunkt `p:111:104`. */
const HOEHLE = landmarke("c0c0c0c0-0271-4000-8000-0000000000a1", "Drachenhöhle", "hoehle", 111.0004, 104.0003);
const QUELLE = landmarke("c0c0c0c0-0271-4000-8000-0000000000a2", "Silberquelle", "quelle", 104.2, 97.5);
/** Eine Quelle, die jemand ins Meer gesetzt hat: Sie ist Reiseziel, aber nicht erreichbar. */
const SEEQUELLE = landmarke("c0c0c0c0-0271-4000-8000-0000000000a3", "Seequelle", "quelle", 210, 100);
const BESTAND = [HOEHLE, QUELLE, SEEQUELLE];
const P_HOEHLE = mapPointId(HOEHLE);
const P_QUELLE = mapPointId(QUELLE);

const GREIF: RouteAir = {
    profile: "griffin",
    speedMph: 50,
    altitudeSchritt: 800,
    maxAboveGroundSchritt: 8000,
    ceilingSchritt: 5000,
};

async function rechne(dienst: RouteService, query: Omit<RouteQuery, keyof RouteRequest> & Partial<RouteRequest>) {
    const outcome = await dienst.route({ ...zuFuss, hoursPerDay: 8, ...query });
    if (!outcome.ok) throw new Error(`${outcome.error}: ${outcome.detail}`);
    return outcome.response;
}

/** Die harte Zusicherung jeder Routingänderung: welche Kanten in welcher Folge. */
const kantenfolge = (route: RouteResponse): string[] => route.segments.map((segment) => segment.edge_id);

describe("Die Kennung einer Landmarke", () => {
    it("ist `l:` und die public_id, klein; sie liest sich zurück und ist kein Kartenpunkt", () => {
        expect(landmarkWaypointId("C0C0C0C0-0271-4000-8000-0000000000A1")).toBe(
            "l:c0c0c0c0-0271-4000-8000-0000000000a1",
        );
        expect(parseLandmarkWaypointId(HOEHLE.id)).toBe("c0c0c0c0-0271-4000-8000-0000000000a1");
        expect(parseLandmarkWaypointId(A)).toBeNull();
        expect(parseLandmarkWaypointId("p:111:104")).toBeNull();
        expect(parseLandmarkWaypointId("l:keine-uuid")).toBeNull();
    });

    it("🔴 die Adresse nimmt sie an, neben Orten und Kartenpunkten; eine fremde Form nicht", () => {
        const gilt = (waypoints: string) => Value.Check(RouteQuerystring, { waypoints });
        expect(gilt(`${A},${HOEHLE.id}`)).toBe(true);
        expect(gilt(`${HOEHLE.id},p:1:2,${B}`)).toBe(true);
        expect(gilt(`${A},l:keine-uuid`)).toBe(false);
        expect(gilt(`${A},x:${A}`)).toBe(false);
    });
});

describe("🔴 Ortsrouten bleiben bytegleich (Auftrag: additiv)", () => {
    it("dieselbe Antwort, Byte für Byte, mit und ohne Landmarken im Bestand - an Land, mit Reisebeginn, mit Kartenpunkt, im Flug", async () => {
        const dienst = service();
        const faelle: (Omit<RouteQuery, keyof RouteRequest> & Partial<RouteRequest>)[] = [
            { waypoints: [A, B] },
            { waypoints: [B, A], optimize: "shortest" },
            { waypoints: [A, B], departure: { month: "praios", day: 1 } },
            { waypoints: [A, mapPointId({ x: 108, y: 106 }), B] },
            { waypoints: [A, B], air: GREIF },
        ];
        for (const fall of faelle) {
            const ohne = await rechne(dienst, fall);
            const mit = await rechne(dienst, { ...fall, landmarks: BESTAND });
            const leer = await rechne(dienst, { ...fall, landmarks: [] });
            expect(JSON.stringify(mit), JSON.stringify(fall.waypoints)).toBe(JSON.stringify(ohne));
            expect(JSON.stringify(leer), JSON.stringify(fall.waypoints)).toBe(JSON.stringify(ohne));
            expect(ohne.found).toBe(true);
        }
    });

    it("die Ortsroute fährt die Straße: dieselbe Kantenfolge wie eh und je", async () => {
        const route = await rechne(service(), { waypoints: [A, B], landmarks: BESTAND });
        expect(new Set(route.segments.map((segment) => segment.public_id))).toEqual(new Set(["strasse"]));
        expect(route.segments.some((segment) => segment.synthetic)).toBe(false);
        expect(route.waypoints).toEqual([
            { id: A, name: "Anfang" },
            { id: B, name: "Ende" },
        ]);
    });

    it("ohne Landmarke rührt die Übersetzung das Ergebnis nicht an: dasselbe Objekt", () => {
        const stations = landmarkStations([A, B], BESTAND);
        expect(stations.stations).toEqual([A, B]);
        expect(stations.back.size).toBe(0);
        const ergebnis = { segments: [], legs: [], refused: null, closures: [] } as unknown as Parameters<
            typeof asLandmarkRoute
        >[0];
        expect(asLandmarkRoute(ergebnis, [A, B], stations)).toBe(ergebnis);
    });
});

describe("🔴 Über die Landmarke dieselbe Kantenfolge wie über den Kartenpunkt an ihrer Lage", () => {
    const vergleiche = async (
        mitLandmarke: string[],
        mitPunkt: string[],
        extra: Partial<RouteRequest> & { air?: RouteAir } = {},
    ) => {
        const dienst = service();
        const ueberLandmarke = await rechne(dienst, { waypoints: mitLandmarke, landmarks: BESTAND, ...extra });
        const ueberPunkt = await rechne(dienst, { waypoints: mitPunkt, ...extra });
        expect(ueberLandmarke.found).toBe(true);
        expect(kantenfolge(ueberLandmarke)).toEqual(kantenfolge(ueberPunkt));
        // Dieselben Etappen der Reise, nur anders benannt.
        expect(ueberLandmarke.stages.map((stage) => [stage.leg_index, stage.type, stage.segment_count])).toEqual(
            ueberPunkt.stages.map((stage) => [stage.leg_index, stage.type, stage.segment_count]),
        );
        return { ueberLandmarke, ueberPunkt };
    };

    it("als Zwischenziel: Name und Kennung der Landmarke statt „Kartenpunkt“ in Wegpunkten, Etappen und Abschnitten", async () => {
        const { ueberLandmarke: route, ueberPunkt } = await vergleiche([A, HOEHLE.id, B], [A, P_HOEHLE, B]);
        // Die Kante des Gangs heißt wie beim Kartenpunkt: Der Router fährt genau diesen Punkt.
        expect(kantenfolge(route)).toContain(`offroad-${P_HOEHLE}`);
        expect(route.waypoints).toEqual([
            { id: A, name: "Anfang" },
            { id: HOEHLE.id, name: "Drachenhöhle" },
            { id: B, name: "Ende" },
        ]);
        expect(route.legs.map((leg) => [leg.from, leg.to])).toEqual([
            [A, HOEHLE.id],
            [HOEHLE.id, B],
        ]);
        const amPunkt = route.segments.filter(
            (segment) => segment.from_node_id === HOEHLE.id || segment.to_node_id === HOEHLE.id,
        );
        expect(amPunkt.length).toBeGreaterThan(0);
        for (const segment of amPunkt) {
            expect(segment.from_node_id === HOEHLE.id ? segment.from_node : segment.to_node).toBe("Drachenhöhle");
        }
        // Die Etappen enden und beginnen an der Landmarke: ein Punkt der Anfrage mit Name, Kennung und Art.
        const ankunft = route.stages.find((stage) => stage.to.place_id === HOEHLE.id);
        expect(ankunft?.to).toMatchObject({
            point: "point",
            place_id: HOEHLE.id,
            name: "Drachenhöhle",
            subtype: "hoehle",
        });
        expect(route.stages.find((stage) => stage.from.place_id === HOEHLE.id)?.from.name).toBe("Drachenhöhle");
        // Nichts verrät mehr den Kartenpunkt, außer der Kennung der Kante.
        const text = JSON.stringify({
            ...route,
            segments: route.segments.map((segment) => ({ ...segment, edge_id: "" })),
        });
        expect(text).not.toContain("Kartenpunkt");
        expect(text).not.toContain(P_HOEHLE);
        // Gegenprobe: Über den Kartenpunkt heißt er so.
        expect(ueberPunkt.waypoints[1]).toEqual({ id: P_HOEHLE, name: "Kartenpunkt" });
        // Gleiche Strecke, gleiche Lage: Die Etappen liegen auf denselben Punkten.
        expect(route.air_legs_units).toEqual(ueberPunkt.air_legs_units);
        expect(ankunft?.to.x).toBe(111);
        expect(ankunft?.to.y).toBe(104);
    });

    it("als Start und als Ziel, auch zwei Landmarken nacheinander", async () => {
        await vergleiche([HOEHLE.id, B], [P_HOEHLE, B]);
        const { ueberLandmarke } = await vergleiche([QUELLE.id, A, HOEHLE.id], [P_QUELLE, A, P_HOEHLE]);
        expect(ueberLandmarke.waypoints.map((waypoint) => waypoint.name)).toEqual([
            "Silberquelle",
            "Anfang",
            "Drachenhöhle",
        ]);
        const { ueberLandmarke: direkt } = await vergleiche([QUELLE.id, HOEHLE.id], [P_QUELLE, P_HOEHLE]);
        expect(direkt.stages[0]?.from.name).toBe("Silberquelle");
        expect(direkt.stages[direkt.stages.length - 1]?.to.name).toBe("Drachenhöhle");
    });

    it("im Flug: dieselben Flugkanten (`flug-p:…`), Namen der Landmarke", async () => {
        const { ueberLandmarke } = await vergleiche([A, HOEHLE.id, B], [A, P_HOEHLE, B], { air: GREIF });
        expect(kantenfolge(ueberLandmarke)).toEqual([`flug-${A}-${P_HOEHLE}`, `flug-${P_HOEHLE}-${B}`]);
        expect(ueberLandmarke.segments.map((segment) => [segment.from_node, segment.to_node])).toEqual([
            ["Anfang", "Drachenhöhle"],
            ["Drachenhöhle", "Ende"],
        ]);
        expect(ueberLandmarke.segments[0]?.to_node_id).toBe(HOEHLE.id);
    });
});

describe("Abgewiesen wird, was kein Reiseziel ist", () => {
    it("eine Landmarke, die der Index nicht auflöst (Riff, Strudel, stillgelegt, unbekannt), ist `unknown_waypoint` mit ihrer Kennung", async () => {
        const riff = landmarkWaypointId("c0c0c0c0-0271-4000-8000-0000000000f1");
        expect(await service().route({ ...zuFuss, waypoints: [A, riff], landmarks: BESTAND })).toEqual({
            ok: false,
            error: "unknown_waypoint",
            detail: riff,
        });
        // Ohne aufgelöste Landmarken (eine Anfrage ohne Hauptthread): jede `l:`-Kennung ist unbekannt.
        expect(await service().route({ ...zuFuss, waypoints: [A, HOEHLE.id] })).toEqual({
            ok: false,
            error: "unknown_waypoint",
            detail: HOEHLE.id,
        });
    });

    it("die Absage eines Punkts nennt die Landmarke, nicht den Kartenpunkt dahinter", async () => {
        expect(await service().route({ ...zuFuss, waypoints: [A, SEEQUELLE.id], landmarks: BESTAND })).toEqual({
            ok: false,
            error: "point_not_on_land",
            detail: SEEQUELLE.id,
        });
    });
});

describe("Die Wegpunktsuche kennt Orte und Landmarken", () => {
    const ortHit = (name: string, over: Partial<WaypointPlace> = {}): WaypointPlace => ({
        id: name.toLowerCase(),
        name,
        subtype: "dorf",
        hidden: false,
        x: 0,
        y: 0,
        ...over,
    });
    const landmarkHit = (landmark: RouteLandmark, over: Partial<WaypointPlace> = {}): WaypointPlace => ({
        id: landmark.id,
        name: landmark.name,
        subtype: landmark.subtype,
        hidden: false,
        x: landmark.x,
        y: landmark.y,
        landmark: landmark.subtype as LandmarkenArt,
        ...over,
    });
    const orte = [ortHit("Drachenfels"), ortHit("Gareth"), ortHit("Drachenhöhle")];
    const landmarken = [landmarkHit(HOEHLE), landmarkHit(QUELLE)];

    it("in derselben Rangfolge; bei gleichem Namen steht der Ort vorn, und ein Ort trägt kein Feld `landmark`", () => {
        const { hits } = rankWaypoints([...orte, ...landmarken], "drachen", 20);
        expect(hits.map((hit) => hit.id)).toEqual(["drachenfels", "drachenhöhle", HOEHLE.id]);
        expect(hits[0]).toEqual({ id: "drachenfels", name: "Drachenfels", subtype: "dorf", hidden: false, x: 0, y: 0 });
        expect(hits[2]).toMatchObject({ id: HOEHLE.id, name: "Drachenhöhle", subtype: "hoehle", landmark: "hoehle" });
        expect(rankWaypoints([...orte, ...landmarken], "silber", 20).hits.map((hit) => hit.id)).toEqual([QUELLE.id]);
    });

    it("die Kennung löst sich auf (Kurzlink, Link), ein Landmarkenname nicht: Er könnte auch ein Ort sein", () => {
        expect(
            waypointsById([...orte, ...landmarken], [HOEHLE.id, "gareth", "l:c0c0c0c0-0271-4000-8000-0000000000ff"]),
        ).toEqual([landmarkHit(HOEHLE), ortHit("Gareth"), null]);
        expect(
            resolveWaypoints(orte, ["Gareth", HOEHLE.id, "Silberquelle", "Drachenhöhle"], landmarken).map(
                (hit) => hit?.id ?? null,
            ),
        ).toEqual(["gareth", HOEHLE.id, null, "drachenhöhle"]);
    });

    it("der nächste Ort zu einem Kartenpunkt bleibt ein Ort", () => {
        // Der Index übergibt nur Orte (`databaseWaypointIndex`); die Funktion selbst kennt keinen Unterschied.
        expect(nearestWaypoint([ortHit("Gareth", { x: 50, y: 0 })], 111, 104).place?.name).toBe("Gareth");
    });

    it("Reiseziel sind die Arten des Katalogs, nicht Riff und Strudel", () => {
        expect(isWaypointLandmark("hoehle")).toBe(true);
        expect(isWaypointLandmark("berggipfel")).toBe(true);
        expect(isWaypointLandmark("vulkan")).toBe(true);
        expect(isWaypointLandmark("riff")).toBe(false);
        expect(isWaypointLandmark("strudel")).toBe(false);
        expect(isWaypointLandmark("unbekannt")).toBe(false);
    });
});

describe("GET /api/route mit Landmarken", () => {
    const config = { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined };
    let app: FastifyInstance | undefined;
    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    /** Der Wegpunktindex als Attrappe: Er kennt Höhle und Quelle; Riff und Stillgelegtes hat er gar nicht erst. */
    const index = (): WaypointIndex & { gefragt: string[][] } => {
        const gefragt: string[][] = [];
        const alle: WaypointPlace[] = BESTAND.map((landmark) => ({
            id: landmark.id,
            name: landmark.name,
            subtype: landmark.subtype,
            hidden: false,
            x: landmark.x,
            y: landmark.y,
            landmark: landmark.subtype as LandmarkenArt,
        }));
        return {
            gefragt,
            lookup: async (query, limit) => ({ query, ...rankWaypoints(alle, query, limit) }),
            resolve: async (names) => resolveWaypoints([], names, alle),
            byIds: async (ids) => {
                gefragt.push([...ids]);
                return waypointsById(alle, ids);
            },
            nearest: async () => ({ place: null, distance: null }),
        };
    };
    const recorder = (outcome: RunOutcome): RouteRunner & { queries: RouteQuery[] } => {
        const queries: RouteQuery[] = [];
        return {
            queries,
            run: async (query) => {
                queries.push(query);
                return outcome;
            },
            warm() {},
            status: () => ({ state: "ready", ageMs: 0 }),
            async close() {},
        };
    };

    it("rechnet über die Landmarke und antwortet im Vertrag (der Serialisierer lässt kein Feld fallen)", async () => {
        app = buildApp({ config, routeRunner: createInlineRunner(service()), waypointIndex: index() });
        const response = await app.inject({
            method: "GET",
            url: `/api/route?waypoints=${A},${HOEHLE.id},${B}&domains=land`,
        });
        expect(response.statusCode).toBe(200);
        const route = response.json<RouteResponse>();
        expect(route.waypoints[1]).toEqual({ id: HOEHLE.id, name: "Drachenhöhle" });
        expect(route.stages.find((stage) => stage.to.place_id === HOEHLE.id)?.to).toMatchObject({
            point: "point",
            name: "Drachenhöhle",
            subtype: "hoehle",
        });
        expect(kantenfolge(route)).toContain(`offroad-${P_HOEHLE}`);
    });

    it("🔴 eine Ortsroute fragt den Index nicht, und ihre Anfrage an den Rechendienst trägt kein Feld `landmarks`", async () => {
        const runner = recorder({ ok: false, error: "unknown_waypoint", detail: A });
        const wegpunkte = index();
        app = buildApp({ config, routeRunner: runner, waypointIndex: wegpunkte });
        await app.inject({ method: "GET", url: `/api/route?waypoints=${A},${B}` });
        expect(runner.queries[0]).not.toHaveProperty("landmarks");
        expect(wegpunkte.gefragt).toEqual([]);
        // Mit Landmarke: die aufgelösten, je Kennung einmal gefragt.
        await app.inject({ method: "GET", url: `/api/route?waypoints=${HOEHLE.id},${A},${HOEHLE.id}` });
        expect(wegpunkte.gefragt).toEqual([[HOEHLE.id]]);
        expect(runner.queries[1]?.landmarks).toEqual([
            { id: HOEHLE.id, name: "Drachenhöhle", subtype: "hoehle", x: HOEHLE.x, y: HOEHLE.y },
        ]);
    });

    it("eine Landmarke, die kein Reiseziel ist, wird 400 `unknown_waypoint` mit ihrer Kennung", async () => {
        app = buildApp({ config, routeRunner: createInlineRunner(service()), waypointIndex: index() });
        const riff = landmarkWaypointId("c0c0c0c0-0271-4000-8000-0000000000f1");
        const response = await app.inject({ method: "GET", url: `/api/route?waypoints=${A},${riff}` });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: "unknown_waypoint", detail: riff });
    });

    it("🔴 S-04: eine Landmarke zählt wie ein Kartenpunkt - zehn Kartenpunkte und eine Landmarke sind 400, bevor gerechnet wird", async () => {
        const runner = recorder({ ok: false, error: "point_not_on_land", detail: "p:1:1" });
        const wegpunkte = index();
        app = buildApp({ config, routeRunner: runner, waypointIndex: wegpunkte });
        const punkte = (n: number) => Array.from({ length: n }, (_, at) => `p:${String(at)}:1`).join(",");
        const zuViele = await app.inject({ method: "GET", url: `/api/route?waypoints=${punkte(10)},${HOEHLE.id}` });
        expect(zuViele.statusCode).toBe(400);
        expect(zuViele.json()).toEqual({ error: "too_many_map_points", detail: "11" });
        expect(runner.queries).toHaveLength(0);
        expect(wegpunkte.gefragt).toEqual([]);
        const genug = await app.inject({ method: "GET", url: `/api/route?waypoints=${punkte(9)},${HOEHLE.id}` });
        expect(genug.statusCode).toBe(422);
        expect(runner.queries).toHaveLength(1);
    });

    it("ohne Wegpunktindex (keine Datenbank) ist eine Landmarke nicht aufzulösen: 503", async () => {
        app = buildApp({ config, routeRunner: recorder({ ok: false, error: "unknown_waypoint", detail: A }) });
        const response = await app.inject({ method: "GET", url: `/api/route?waypoints=${A},${HOEHLE.id}` });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ error: "database_unavailable" });
    });
});
