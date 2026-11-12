import { afterEach, describe, expect, it, vi } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    rawStageEntries,
    resolveAirQuery,
    travelSpeed,
    WEGFINDUNG_WERTE,
    wegfindungWert,
    type RouteAir,
    type RouteSegment,
    type StagePlace,
    type WegfindungId,
    type Wegfindungswerte,
} from "@avesmaps3d/shared";
import { airFieldRule } from "../src/routing/air-field.ts";
import type { AirBox } from "../src/routing/air-obstacles.ts";
import { findAirRoute, type AirPoint } from "../src/routing/air-route.ts";
import { AirSearch, type AirGrid } from "../src/routing/air-search.ts";
import { frameOver } from "../src/routing/air-way.ts";
import { weighedAirFlight } from "../src/routing/air-weigh.ts";
import { modellMitWerten, netzOptionen, setzeWerte, WEGFINDUNG_VORGABEN, werte } from "../src/routing/einstellungen.ts";
import { pathElevationProfile } from "../src/routing/elevation-profile.ts";
import {
    chordIsDry,
    directEdgeAllowed,
    exitReach,
    firstRoadEntry,
    landPathExits,
    nearestExitNodes,
    nearestReachableExit,
    offroadCost,
    roadLines,
} from "../src/routing/map-points.ts";
import { buildRouteNetwork, type PathRow, type RouteNode } from "../src/routing/network.ts";
import { buildOffroadBox, forEachCellNear, type OffroadBox, type OffroadPlanes } from "../src/routing/offroad-grid.ts";
import { finishPath } from "../src/routing/offroad-search.ts";
import { RequestGraph } from "../src/routing/request-graph.ts";
import { anchorWaypoints } from "../src/routing/request-links.ts";
import {
    NO_OFFROAD_TERRAIN,
    syntheticEdges,
    type Edge,
    type GraphBase,
    type RouteRequest,
} from "../src/routing/route-edge.ts";
import { buildRouteGraph } from "../src/routing/route-graph.ts";
import { toNodes } from "../src/routing/route-result.ts";
import { findLeg, findLegs, type SearchGraph } from "../src/routing/route-search.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import type { TerrainHeights } from "../src/routing/relief.ts";
import { coastDistance, coastProfile } from "../src/routing/sea-coast.ts";
import { FreeSea } from "../src/routing/sea-free.ts";
import { compactSeaGraph, waterMask } from "../src/routing/sea-graph-store.ts";
import { buildSeaGrid, nearestWaterCell, prepareNavigableWater } from "../src/routing/sea-grid.ts";
import { VisibilityGraph } from "../src/routing/sea-visibility.ts";
import { NO_SLOPE } from "../src/routing/slope.ts";
import { chordCrossesWater, NO_WATER, prepareWater, type Water } from "../src/routing/water.ts";
import { flightTrack, waterSurfaceProfile } from "../src/routing/water-profile.ts";
import type { DomainHeightSource } from "../src/terrain/domain/read.ts";
import { DEFAULT_CONE } from "../src/terrain/peak-cone.ts";

/**
 * Wirkt ein verstellter Wert der Wegfindung im Routing-Worker (WI-0214, Befund S3-08 des Code-Reviews vom 2026-10-16)?
 *
 * Die Kette Datenbank → `setzeWerte` → `werte()` ist geprüft (`wegfindung-einstellungen.test.ts`), und dass jede Vorgabe
 * ihrer Konstante gleicht, auch (`wegfindung-vorgaben.test.ts`). Beides fängt aber nicht den Leser, der weiter die
 * Konstante nimmt: `exitNearestTries` und `directEdgeMiles` standen in der Systemsteuerung, und niemand las sie. Darum hier
 * je Kennung EIN abweichender Wert (in den Grenzen des Registers) und der echte Leser an einer winzigen Eingabe: Vorher und
 * nachher muss etwas anderes herauskommen, wo es billig geht, in der erwarteten Richtung.
 *
 * 🔴 Ein Fall ohne Wirkung ist kein Grund zum Überspringen: Entweder taugt die Eingabe nicht, oder der Leser liest den Wert
 * nicht. Neue Kennungen im Register erzwingt der Übersetzer (`WorkerId`), und der letzte Fall rechnet die Liste nach.
 *
 * 🪤 Der Zustand von `setzeWerte` ist prozessweit: Jeder Fall stellt ihn danach zurück.
 */

/**
 * Diese zehn prüft der Worker nicht: Sie wirken im Hauptthread, im Browser oder in der Ableitung des Seegraphen
 * (`wegfindung-wirkung.test.ts`). 🔴 `exactHit` gehört seit 2026-10-17 dazu: Im Netzaufbau gewinnt ohne Legacys
 * Listenreihenfolge ohnehin der nächste Ort im Ortskasten (`createEndpointAttacher` in `topology.ts`); der Wert wirkt nur im
 * Infopanel (`subjects/path-route.ts`). Gefunden von genau diesem Test, als sein Fall rot blieb.
 */
const NICHT_IM_WORKER = [
    "exactHit",
    "routeWaypointLimit",
    "routeMapPointLimit",
    "waypointLookupLimit",
    "looseDistance",
    "landscapeMinShare",
    "seaClosureLimit",
    "seaCellUnits",
    "landingReach",
    "farSearch",
] as const satisfies readonly WegfindungId[];

/** Jede Kennung, die ein Leser im Routing-Worker nimmt. */
type WorkerId = Exclude<WegfindungId, (typeof NICHT_IM_WORKER)[number]>;

interface Fall {
    /** Der abweichende Wert, innerhalb `min..max` des Registers. */
    wert: number;
    /** Ruft den echten Leser mit einer winzigen Eingabe. */
    beobachte: () => unknown;
    /** Wo es billig geht: die erwartete Richtung, an den Ergebnissen von `beobachte`. */
    richtung?: (vorher: unknown, nachher: unknown) => void;
}

const fall = <T>(wert: number, beobachte: () => T, richtung?: (vorher: T, nachher: T) => void): Fall => ({
    wert,
    beobachte,
    ...(richtung ? { richtung: (vorher: unknown, nachher: unknown) => richtung(vorher as T, nachher as T) } : {}),
});

type Punkt = [number, number];
const model = AVENTURIA_TRAVEL_MODEL;

// ---------------------------------------------------------------------------------------------
// Netz, Graph und Suche
// ---------------------------------------------------------------------------------------------

const ort = (id: string, x: number, y: number): RouteNode => ({ id, name: id, kind: "place", isHidden: false, x, y });

const weg = (id: string, coordinates: Punkt[], subtype = "Strasse"): PathRow => ({
    public_id: id,
    name: id,
    subtype,
    coordinates: JSON.stringify({ type: "LineString", coordinates }),
    allowed_transports: null,
    transport_domain: null,
    flow_direction: null,
    flow_factor: null,
});

const zuFuss: RouteRequest = {
    optimize: "fastest",
    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
    enabled: { land: true, river: true, sea: true },
    minimizeTransfers: false,
};

const basis: GraphBase = {
    model,
    request: zuFuss,
    water: NO_WATER,
    synthetic: { transport: "groupFoot", speed: 2.3 },
    drawn: new Map(),
    sea: null,
    seaBound: new Set(),
};

/** Eine Kante der Suche, wie in `route-search.test.ts`. */
function kante(from: string, to: string, distance: number, extra: Partial<Edge> = {}): Edge {
    return {
        to,
        distance,
        transport: "groupFoot",
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
        ...extra,
    };
}

function sicht(edges: Edge[]): SearchGraph {
    const nodes = new Set(edges.flatMap((item) => [item.link.from, item.to]));
    return {
        has: (id) => nodes.has(id),
        edges: (id) => edges.filter((item) => item.link.from === id),
        forEachSeaEdge: vi.fn(),
        keepSeaEdge: (item) => item,
    };
}

/** Ein Ort ohne Weg bei (0|0) vor einem Kamm aus zehn Straßen: Wie viele Querfeldein-Kanten bekommt er? */
function ankerAmKamm(): number {
    const zinken = Array.from({ length: 10 }, (_, k) =>
        weg(`zinke-${String(k + 1)}`, [
            [-5, k + 1],
            [5, k + 1],
        ]),
    );
    const network = buildRouteNetwork(
        [ort("p", 0, 0)],
        [
            weg("ruecken", [
                [5, 1],
                [5, 10],
            ]),
            ...zinken,
        ],
    );
    const graph = buildRouteGraph(network, model, zuFuss);
    const view = new RequestGraph(graph.adjacency, graph.sea);
    anchorWaypoints(network, graph, view, ["p"], NO_OFFROAD_TERRAIN);
    return view.edges("p").filter((edge) => edge.synthetic).length;
}

/** Ein abgetrennter Ort, dessen nächste Sehne ins Hauptnetz über einen See führt: Bekommt er eine Brücke? */
function brueckeUmDenSee(): number {
    const network = buildRouteNetwork(
        [ort("m1", 0, 0), ort("m2", 10, 0), ort("d", 0, 5)],
        [
            weg("haupt", [
                [0, 0],
                [10, 0],
            ]),
        ],
    );
    return buildRouteGraph(network, model, zuFuss, quadrate([-1, 1.5, 1, 3.5])).bridgeCount;
}

// ---------------------------------------------------------------------------------------------
// Querfeldein
// ---------------------------------------------------------------------------------------------

function quadrate(...boxes: [number, number, number, number][]): Water {
    return prepareWater(
        boxes.map(([minX, minY, maxX, maxY]) => ({
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
        })),
    );
}

const fussKosten = (water: "coast" | "shore" = "coast") =>
    offroadCost(model, { transport: "groupFoot", speed: 2.3 }, "fastest", "free", water);

/** Ebenen ohne Sperre, Furt und Boden: nur die Kiste. */
const freieEbenen = (box: OffroadBox): OffroadPlanes => ({
    box,
    blocked: new Uint8Array(box.cellCount),
    fords: null,
    walls: null,
    ground: null,
    roads: null,
});

/** Die Gerade zwischen zwei Kartenpunkten im Abstand 0,5 bis 20: wie viele bekommen sie angeboten? */
function geradeAngeboten(m = model): number {
    let angeboten = 0;
    for (let d = 0.5; d <= 20; d += 0.5) if (directEdgeAllowed(m, { x: 0, y: 0 }, { x: d, y: 0 }, 0, 0)) angeboten += 1;
    return angeboten;
}

// ---------------------------------------------------------------------------------------------
// Freie Seefahrt: ein Meer 0..40 × 0..20 mit einer Insel mitten auf der Geraden von West nach Ost
// ---------------------------------------------------------------------------------------------

const ring = (minX: number, minY: number, maxX: number, maxY: number): Punkt[] => [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
];

function seeFlotte() {
    const water = prepareNavigableWater([
        {
            geometry: { type: "Polygon", coordinates: [ring(0, 0, 40, 20), ring(15, 6, 25, 14)] },
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
    const places = [ort("west", -0.5, 10.25), ort("ost", 40.5, 10.25)];
    const network = buildRouteNetwork(places, []);
    const graph = new VisibilityGraph(grid, [
        [
            [0, 0],
            [40, 0],
            [40, 20],
            [0, 20],
        ],
        [
            [15, 6],
            [15, 14],
            [25, 14],
            [25, 6],
        ],
    ]);
    graph.weigh([coastProfile(model, "cargoShip")], coastDistance(grid));
    const ports = places.map((place) => {
        const landing = nearestWaterCell(grid, place.x, place.y, 3) as { x: number; y: number };
        return { placeId: place.id, node: graph.attach(landing.x, landing.y) };
    });
    const freeSea = new FreeSea(compactSeaGraph(graph.snapshot(), ["cargoShip"], ports, waterMask(grid)));
    const speed = travelSpeed(model, "cargoShip", "Seeweg") as number;
    return freeSea.fleet("cargoShip", speed, network.nodes);
}
const flotte = seeFlotte();

// ---------------------------------------------------------------------------------------------
// Flug
// ---------------------------------------------------------------------------------------------

const MU = { mountain: 1, peak: 1 };

/** Ein Domain-Höhenmodell über `size` × `size` Stützstellen ab (0|0), wie in `air-weigh.test.ts`. */
function karte(height: (x: number, y: number) => number, size = 401, cell = 0.25): TerrainHeights {
    const samples = new Uint16Array(size * size);
    for (let j = 0; j < size; j += 1) {
        for (let i = 0; i < size; i += 1) samples[j * size + i] = Math.max(0, Math.round(height(i * cell, j * cell)));
    }
    const domain: DomainHeightSource = {
        fingerprint: "test",
        revision: "test",
        membershipFingerprint: "test",
        mountains: [],
        raster: { cell, originX: 0, originY: 0, width: size, height: size, samples },
    };
    return { domain, rasters: [], cones: [], rule: DEFAULT_CONE, mu: { FOOT: MU, EQUID: MU, WHEEL: MU } };
}

const airOf = (id: string): RouteAir => {
    const resolved = resolveAirQuery(model, { air: id });
    if (!resolved.ok || !resolved.air) throw new Error(`${id} erwartet`);
    return resolved.air;
};
const hexe = airOf("witchFlight");
const punkt = (id: string, x: number, y: number): AirPoint => ({ id, name: id, x, y });
const A = punkt("a", 20, 50);
const B = punkt("b", 80, 50);

/** Eine Wand quer über der Luftlinie von A nach B: x 48 bis 52, y 40 bis 60. */
const wand =
    (hoehe: number) =>
    (x: number, y: number): number =>
        x >= 48 && x <= 52 && y >= 40 && y <= 60 ? hoehe : 100;
const hoheWand = karte(wand(2500));
const niedrigeWand = karte(wand(500));
const huegel = karte((x, y) => 100 + 300 * Math.max(0, Math.sin(x / 5) * Math.cos(y / 7)));

interface Abwaegung {
    suchen: { bound: number; cells: number; cell: number }[];
    gewaehlt: { source: string; cost: number; searched: number; polished: number; work: number; skipped: boolean }[];
    linien: (Punkt[] | null)[];
    sucht: boolean[];
}

/** Die Abwägung des Flugs über `legs`, mit allem, was sie meldet (`WeighObserver`). */
function abwaegen(terrain: TerrainHeights, legs: [AirPoint, AirPoint][], budget?: number): Abwaegung {
    const result: Abwaegung = { suchen: [], gewaehlt: [], linien: [], sucht: [] };
    const flight = weighedAirFlight(terrain, hexe, model, {
        ...(budget === undefined ? {} : { budget }),
        observer: {
            search: ({ bound, detour }) => result.suchen.push({ bound, cells: detour.cells, cell: detour.frame.cell }),
            chosen: (choice) => result.gewaehlt.push(choice),
        },
    });
    for (const [from, to] of legs) {
        result.linien.push(flight.way(from, to));
        result.sucht.push(flight.searches(from, to));
    }
    return result;
}

const gefeilt = (a: Abwaegung): number => a.gewaehlt.reduce((sum, choice) => sum + choice.polished, 0);

/** Ein Raster der Flugsuche, 0,5 E je Zelle; `gesperrt` nennt die Zellen über der Grenze. */
function luftraster(cols: number, rows: number, gesperrt: (column: number, row: number) => boolean): AirGrid {
    const blocked = new Uint8Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < cols; column += 1) if (gesperrt(column, row)) blocked[row * cols + column] = 1;
    }
    return { minX: 0, minY: 0, cell: 0.5, cols, rows, blocked };
}

function luftweg(grid: AirGrid, from: Punkt, to: Punkt) {
    return new AirSearch(grid).route(from[1] * grid.cols + from[0], to[1] * grid.cols + to[0]);
}

const box = (minX: number, minY: number, maxX: number, maxY: number): AirBox => ({ minX, minY, maxX, maxY });

/** Ein Abschnitt des Reiseplans, nur mit dem, was die Etappen lesen. */
const abschnitt = (coordinates: Punkt[]): RouteSegment => ({
    index: 0,
    edge_id: "e",
    public_id: "w",
    from_node: "",
    to_node: "",
    from_node_id: "a",
    to_node_id: "b",
    subtype: "Strasse",
    path_name: "",
    transport_type: "groupFoot",
    distance_units: 1,
    cost_units: 1,
    cost_factor: 1,
    travel_hours: 1,
    flow_time_factor: 1,
    flow_state: "",
    synthetic: false,
    offroad: false,
    geometry: { type: "LineString", coordinates },
});

// ---------------------------------------------------------------------------------------------
// Die Fälle
// ---------------------------------------------------------------------------------------------

const FAELLE: Record<WorkerId, Fall> = {
    // --- Netzaufbau (`netzOptionen`, `buildRouteNetwork`) ---
    endSnap: fall(
        0.005,
        // Zwei Wegenden 0,01 auseinander: mit 0,02 ein Knoten, mit 0,005 zwei.
        () =>
            buildRouteNetwork(
                [],
                [
                    weg("a", [
                        [0, 0],
                        [1, 0],
                    ]),
                    weg("b", [
                        [1.01, 0],
                        [2, 0],
                    ]),
                ],
                netzOptionen(werte()),
            ).nodes.size,
        (vorher, nachher) => expect(nachher).toBe(vorher + 1),
    ),
    endpointBox: fall(
        0.2,
        // Ein Ort 0,3 neben dem Wegende: im Kasten ±0,5 hängt der Weg an ihm, im Kasten ±0,2 nicht.
        () =>
            buildRouteNetwork(
                [ort("burg", 0, 0.3)],
                [
                    weg("w", [
                        [0, 0],
                        [2, 0],
                    ]),
                ],
                netzOptionen(werte()),
            ).links.map((link) => [link.from, link.to]),
        (vorher, nachher) => {
            expect(vorher.flat()).toContain("burg");
            expect(nachher.flat()).not.toContain("burg");
        },
    ),
    schrittPerUnit: fall(
        6000,
        () => ({
            // Das Halten der Flugbahn in Schritt (`airFieldRule`), das Wegprofil (`pathElevationProfile`) und der Zuschlag
            // des Flugs über einer Wand (`flightTrack`).
            halten: airFieldRule(hexe, model).hold,
            profil: pathElevationProfile(
                { ...NO_SLOPE, steps: new Float64Array([300, 3000, 1, 100, 0, -100, 3000, 1, 400, 3000]) },
                true,
                2,
            ),
            zuschlag: flightTrack(
                [
                    [A.x, A.y],
                    [B.x, B.y],
                ],
                niedrigeWand,
                hexe,
                model,
            )?.surcharge,
        }),
        (vorher, nachher) => {
            expect(nachher.halten).toBe(vorher.halten * 2);
            // Dieselben Abtastschritte liegen bei doppeltem Maßstab auf der halben Strecke.
            expect(nachher.profil[1]?.[0]).toBe((vorher.profil[1]?.[0] ?? 0) / 2);
        },
    ),
    meilenJeKarteneinheit: fall(
        1,
        // Über das Modell des Stands (`modellMitWerten`): Bei 1 Meile je Einheit sind 15 Meilen 15 Einheiten.
        () => geradeAngeboten(modellMitWerten(model, werte())),
        (vorher, nachher) => expect(nachher).toBeGreaterThan(vorher),
    ),
    querfeldeinAufschlag: fall(
        50,
        // Die Notverbindung über das Modell des Stands (`syntheticEdges` liest `model.querfeldeinAufschlag.wert`).
        () =>
            syntheticEdges(
                { ...basis, model: modellMitWerten(model, werte()) },
                { id: "a", x: 0, y: 0 },
                { id: "b", x: 3, y: 4 },
            )[0]?.[1].distance,
        (vorher, nachher) => expect(nachher).toBeCloseTo((vorher ?? 0) * 2, 9),
    ),

    // --- Ergebnis und Reiseplan ---
    nodeGap: fall(
        0.005,
        // Die Linie beginnt 0,002 neben ihrem Knoten: über 0,0005 wird sie herangezogen, unter 0,005 nicht.
        () =>
            toNodes(
                [
                    [0, 0],
                    [1, 0],
                ],
                { x: 0.002, y: 0 },
                undefined,
            ).line[0],
        (vorher, nachher) => {
            expect(vorher).toEqual([0.002, 0]);
            expect(nachher).toEqual([0, 0]);
        },
    ),
    cityNodeRadius: fall(
        0.3,
        // Der Ausdruck des Dienstes (`service.ts`: `cityNodeRadius` aus den Werten des Stands) an einem Wegende, 0,2 neben
        // dem einzigen Ort.
        () => {
            const burg: StagePlace = { id: "burg", name: "Burg", hidden: false, x: 1.2, y: 0 };
            return rawStageEntries(
                [
                    abschnitt([
                        [0, 0],
                        [1, 0],
                    ]),
                ],
                {
                    model,
                    waypointIds: [],
                    cityNodeRadius: werte().cityNodeRadius,
                    placeAt: () => undefined,
                    placeNear: (x, y, radius, accept) =>
                        Math.hypot(burg.x - x, burg.y - y) <= radius && accept(burg) ? burg : undefined,
                },
            )[0]?.end.point;
        },
        (vorher, nachher) => {
            expect(vorher).toBe("marker");
            expect(nachher).toBe("place");
        },
    ),

    // --- Suche ---
    routeFreeSeaLimit: fall(
        2,
        // Drei Seereisen hintereinander (S → T → S → T).
        () => {
            const view = sicht([kante("S", "T", 1, { freeSea: true }), kante("T", "S", 1, { freeSea: true })]);
            const found = findLegs(view, basis, ["S", "T", "S", "T"]);
            return "tooLarge" in found ? found.tooLarge : "gefunden";
        },
        (vorher, nachher) => {
            expect(vorher).toBe("gefunden");
            expect(nachher).toBe("sea_legs:3");
        },
    ),
    weightNormalizerHours: fall(
        24,
        // Unter „Schnellste“ wiegt die Zeit mal Normierung / Reisetag: doppelte Normierung, doppelte Kosten.
        () => findLeg(sicht([kante("S", "T", 4)]), basis, "S", "T").cost,
        (vorher, nachher) => expect(nachher).toBeCloseTo(vorher * 2, 9),
    ),
    anchorLimit: fall(
        3,
        () => ankerAmKamm(),
        // Eine Brücke ins Netz und je ein Anker in beide Richtungen: weniger Anker, weniger Kanten.
        (vorher, nachher) => expect(nachher).toBeLessThan(vorher),
    ),
    drySearchLimit: fall(
        1,
        // Die Anker eines Wegpunkts (`anchorWaypoints`) und die Brücke um einen See (`componentBridges`).
        () => ({ anker: ankerAmKamm(), bruecke: brueckeUmDenSee() }),
        (vorher, nachher) => {
            expect(nachher.anker).toBeLessThan(vorher.anker);
            expect(vorher.bruecke).toBe(1);
            expect(nachher.bruecke).toBe(0);
        },
    ),

    // --- Kartenpunkte (`map-points.ts`) ---
    exitPathLimit: fall(
        3,
        () =>
            landPathExits(
                Array.from({ length: 8 }, (_, k) => ({
                    id: `w${String(k)}`,
                    coordinates: [
                        [-5, k + 1],
                        [5, k + 1],
                    ] as Punkt[],
                })),
                0,
                0,
            ).length,
        (vorher, nachher) => {
            expect(vorher).toBe(6);
            expect(nachher).toBe(3);
        },
    ),
    exitVertexLimit: fall(
        5,
        // Ein Weg mit 39 inneren Stützpunkten.
        () =>
            landPathExits([{ id: "w", coordinates: Array.from({ length: 41 }, (_, k): Punkt => [k - 20, 1]) }], 0, 0)[0]
                ?.cuts.length,
        (vorher, nachher) => {
            expect(vorher).toBe(24);
            expect(nachher).toBe(5);
        },
    ),
    exitNodeLimit: fall(
        3,
        () =>
            nearestExitNodes(
                Array.from({ length: 20 }, (_, k) => ({ id: `n${String(k)}`, x: k + 1, y: 0, landPath: true })),
                0,
                0,
            ).length,
        (vorher, nachher) => {
            expect(vorher).toBe(12);
            expect(nachher).toBe(3);
        },
    ),
    exitNearestTries: fall(
        3,
        // Zehn Kandidaten in 1 bis 10 Einheiten: Die erste Stufe reicht bis zum sechst- beziehungsweise drittnächsten.
        () =>
            exitReach(
                [
                    {
                        link: "w",
                        cuts: Array.from({ length: 10 }, (_, k) => ({
                            segment: 0,
                            t: 0,
                            x: k + 1,
                            y: 0,
                            distance: k + 1,
                        })),
                    },
                ],
                [],
            ),
        (vorher, nachher) => {
            expect(vorher).toBe(6);
            expect(nachher).toBe(3);
        },
    ),
    directEdgeMiles: fall(
        30,
        () => geradeAngeboten(),
        (vorher, nachher) => expect(nachher).toBeGreaterThan(vorher),
    ),
    roadReach: fall(
        1,
        // Ein Gang von (10|0) zum Ausstieg (0|0), eine Straße 0,8 daneben: Mit 0,5 kommt er nicht hin, mit 1 steigt er ein.
        () =>
            firstRoadEntry(
                [
                    [0, 0],
                    [10, 0],
                ],
                roadLines([
                    {
                        id: "r",
                        coordinates: [
                            [5, 0.8],
                            [6, 0.8],
                        ] as Punkt[],
                    },
                ]),
                { water: NO_WATER, rivers: NO_RIVERS },
            ),
        (vorher, nachher) => {
            expect(vorher).toBeNull();
            expect(nachher).not.toBeNull();
        },
    ),
    coastTolerance: fall(
        3,
        // Eine Sehne, die 2 Einheiten ins Meer reicht; dazu die Zellen im Umkreis der Toleranz (`forEachCellNear`).
        () => {
            const see = quadrate([0, 0, 10, 10]);
            const kiste = buildOffroadBox(0, 0, 10, 10);
            let zellen = 0;
            forEachCellNear(kiste, 5, 5, () => {
                zellen += 1;
                return false;
            });
            return {
                quer: chordCrossesWater(-5, 5, 2, 5, see),
                trocken: chordIsDry({ water: see, rivers: NO_RIVERS }, { x: -5, y: 5 }, { x: 2, y: 5 }),
                zellen,
            };
        },
        (vorher, nachher) => {
            expect([vorher.quer, vorher.trocken]).toEqual([true, false]);
            expect([nachher.quer, nachher.trocken]).toEqual([false, true]);
            expect(nachher.zellen).toBeGreaterThan(vorher.zellen);
        },
    ),
    shoreTolerance: fall(
        1,
        // Am Ufer („shore“): ein See 0,3 bis 0,8 vor dem Kartenpunkt. Mit 0,25 ist die Sehne nass und der Gang sucht außen
        // herum, mit 1 zählt das Wasser am Ende nicht, und er geht gerade.
        () =>
            nearestReachableExit(
                { water: quadrate([0.3, -0.5, 0.8, 0.5]), rivers: NO_RIVERS },
                fussKosten("shore"),
                { x: 0, y: 0 },
                [{ x: 4, y: 0 }],
            )?.path.points.length ?? null,
        (vorher, nachher) => expect(nachher).toBe(2),
    ),
    cellUnits: fall(
        0.5,
        () => buildOffroadBox(0, 0, 10, 10).cell,
        (vorher, nachher) => expect(nachher).toBeGreaterThan(vorher),
    ),
    cellLimit: fall(
        10_000,
        // 223 × 223 Zellen zu 0,25: unter 150.000, über 10.000.
        () => buildOffroadBox(0, 0, 30, 30).cell,
        (vorher, nachher) => expect(nachher).toBeGreaterThan(vorher),
    ),
    simplifyEpsilon: fall(
        0.3,
        // Ein Knick 0,2 neben der Sehne bleibt bei 0,1 stehen und fällt bei 0,3.
        () =>
            finishPath(
                freieEbenen(buildOffroadBox(0, 0, 4, 1)),
                fussKosten(),
                [
                    [0, 0],
                    [2, 0.2],
                    [4, 0],
                ],
                false,
            ).points.length,
        (vorher, nachher) => expect(nachher).toBeLessThan(vorher),
    ),
    displayEpsilon: fall(
        1,
        // Ein Knick 0,8 neben der Sehne: Mit 0,5 bleibt die Treppe, mit 1 zeichnet die Karte die Gerade.
        () =>
            finishPath(
                freieEbenen(buildOffroadBox(0, 0, 4, 1)),
                fussKosten(),
                [
                    [0, 0],
                    [2, 0.8],
                    [4, 0],
                ],
                false,
            ).display ?? null,
        (vorher, nachher) => {
            expect(vorher).toBeNull();
            expect(nachher).toEqual([
                [0, 0],
                [4, 0],
            ]);
        },
    ),

    // --- Freie Seefahrt ---
    freeSeaDisplayTolerance: fall(
        0.2,
        () => flotte?.line("west", "ost")?.display.length,
        (vorher, nachher) => expect(nachher).toBeLessThan(vorher ?? 0),
    ),

    // --- Flug: Raster und Suche ---
    airCellUnits: fall(
        1,
        () => frameOver(box(0, 0, 10, 10)).cell,
        (vorher, nachher) => expect(nachher).toBeGreaterThan(vorher),
    ),
    airCellLimit: fall(
        100_000,
        // 404 × 404 Zellen zu 0,5: unter 1.500.000, über 100.000.
        () => frameOver(box(0, 0, 200, 200)).cell,
        (vorher, nachher) => expect(nachher).toBeGreaterThan(vorher),
    ),
    blockedWeight: fall(
        10,
        // Eine fremde Wand zwischen Start und Ziel, offen nur weit oben: Bei 10.000 fliegt er außen herum, bei 10 drüber.
        () =>
            luftweg(
                luftraster(41, 21, (column, row) => column === 20 && row <= 17),
                [5, 2],
                [35, 2],
            ).crossing,
        (vorher, nachher) => {
            expect(vorher).toBe(0);
            expect(nachher).toBeGreaterThan(0);
        },
    ),
    homeFactor: fall(
        1,
        // Der Start liegt im Gebirge, dessen nächster Rand nach Süden zeigt, das Ziel im Osten: Zehnfach teuer verlässt er es
        // nach Süden, einfach teuer fliegt er geradeaus darüber.
        () =>
            luftweg(
                luftraster(41, 25, (column, row) => column <= 20 && row >= 3),
                [2, 12],
                [38, 12],
            ).blocked,
        (vorher, nachher) => expect(nachher).toBeGreaterThan(vorher),
    ),
    pocketCells: fall(
        64,
        // Der Start in einem Tal von 10 × 10 Zellen, ringsum Gebirge: Unter 8.192 Zellen ist das Tal eine Nische und der Ring
        // seine Heimat; ab 64 ist es offen, und der Ring ist fremdes Gebirge.
        () =>
            luftweg(
                luftraster(
                    40,
                    40,
                    (column, row) =>
                        column >= 5 &&
                        column <= 30 &&
                        row >= 5 &&
                        row <= 30 &&
                        !(column >= 13 && column <= 22 && row >= 13 && row <= 22),
                ),
                [17, 17],
                [36, 36],
            ).crossing,
        (vorher, nachher) => {
            expect(vorher).toBe(0);
            expect(nachher).toBeGreaterThan(0);
        },
    ),
    routeFlightSearchLimit: fall(
        2,
        // Drei Etappen, die alle um Gebirge suchen müssten.
        () =>
            findAirRoute([punkt("1", 0, 0), punkt("2", 1, 0), punkt("3", 2, 0), punkt("4", 3, 0)], hexe, model, {
                hoursPerDay: 24,
                timed: false,
                searches: () => true,
            }).tooLarge,
        (vorher, nachher) => {
            expect(vorher).toBeNull();
            expect(nachher).toBe("flight_legs:3");
        },
    ),

    // --- Flug: Abwägung (`air-weigh.ts`) ---
    weighDetour: fall(
        1,
        // Der Umweg um die Wand ist 5 % länger als die Luftlinie: Mit dem Deckel bei 1 % darf das Feilen ihn nicht nachziehen.
        () => abwaegen(hoheWand, [[A, B]]).gewaehlt,
        (vorher, nachher) => expect(nachher[0]?.cost).toBeGreaterThan(vorher[0]?.cost ?? Infinity),
    ),
    weighDetourNear: fall(
        5,
        () => abwaegen(hoheWand, [[A, B]]).suchen,
        (vorher, nachher) => expect(nachher[0]?.bound).toBeLessThan(vorher[0]?.bound ?? 0),
    ),
    weighNearEdge: fall(
        1,
        // Bei 1 % liegt jeder Umweg „am Rand“ des engen Rasters: Es folgt das weite.
        () => abwaegen(hoheWand, [[A, B]]).suchen.length,
        (vorher, nachher) => {
            expect(vorher).toBe(1);
            expect(nachher).toBe(2);
        },
    ),
    weighNearCost: fall(
        1,
        // Im Hügelland verliert der Weg der Suche knapp gegen die Luftlinie: Bis 1,15 wird er mit gefeilt, bei 1 nicht mehr.
        () => gefeilt(abwaegen(huegel, [[punkt("p", 12, 12), punkt("q", 88, 88)]])),
        (vorher, nachher) => expect(nachher).toBeLessThan(vorher),
    ),
    weighCellLimit: fall(
        10_000,
        () => abwaegen(hoheWand, [[A, B]]).suchen.map((suche) => suche.cell),
        (vorher, nachher) => expect(nachher[0]).toBeGreaterThan(vorher[0] ?? Infinity),
    ),
    weighWorkBudget: fall(
        100_000,
        // Sechs Etappen über die Wand teilen sich das Budget der Anfrage: Bei 100.000 bleibt für die letzte weniger zu feilen.
        () =>
            gefeilt(
                abwaegen(
                    hoheWand,
                    Array.from({ length: 6 }, (_, k): [AirPoint, AirPoint] => [
                        punkt(`a${String(k)}`, 20, 45 + k),
                        punkt(`b${String(k)}`, 80, 45 + k),
                    ]),
                ),
            ),
        (vorher, nachher) => expect(nachher).toBeLessThan(vorher),
    ),
    weighPolishPasses: fall(
        1,
        () => gefeilt(abwaegen(hoheWand, [[A, B]])),
        (vorher, nachher) => expect(nachher).toBeLessThan(vorher),
    ),
    weighPolishEvaluations: fall(
        30,
        // Gefeilt werden der Sieger und die Luftlinie, jeder höchstens so oft: 71 Bewertungen gehen nicht mehr.
        () => gefeilt(abwaegen(hoheWand, [[A, B]])),
        (vorher, nachher) => {
            expect(vorher).toBeGreaterThan(2 * 30);
            expect(nachher).toBeLessThanOrEqual(2 * 30);
        },
    ),
    weighPolishMin: fall(
        120,
        // Das Budget der Anfrage ist fast verbraucht (`WeighOptions.budget` als Eingabe, wie am Ende einer langen Reise): Es
        // reicht für 19 Bewertungen. Ab 12 wird gefeilt, ab 120 nicht mehr.
        () => gefeilt(abwaegen(hoheWand, [[A, B]], 20_000)),
        (vorher, nachher) => {
            expect(vorher).toBeGreaterThan(0);
            expect(nachher).toBe(0);
        },
    ),
    weighMinHours: fall(
        1,
        // Eine Wand von 500 Schritt kostet die Luftlinie rund 0,6 Stunden Zuschlag: genug für eine Suche ab 0,05, nicht ab 1.
        () => {
            const abwaegung = abwaegen(niedrigeWand, [[A, B]]);
            return { sucht: abwaegung.sucht[0], gesucht: abwaegung.gewaehlt[0]?.searched };
        },
        (vorher, nachher) => {
            expect(vorher).toEqual({ sucht: true, gesucht: 1 });
            expect(nachher).toEqual({ sucht: false, gesucht: 0 });
        },
    ),

    // --- Höhenlinie des Wassers ---
    seaLevel: fall(
        2,
        // Ein Seeweg über Wasser auf 1 Schritt: über 0,5 ein Binnensee, unter 2 das Meer.
        () =>
            waterSurfaceProfile(
                "Seeweg",
                [
                    [1, 1],
                    [9, 1],
                ],
                8,
                karte(() => 1, 41),
                256,
            )?.surface,
        (vorher, nachher) => {
            expect(vorher).toBe("lake");
            expect(nachher).toBe("sea");
        },
    ),
};

afterEach(() => setzeWerte(null));

describe("Ein verstellter Wert wirkt am Leser im Routing-Worker (WI-0214, S3-08)", () => {
    it.each(Object.keys(FAELLE) as WorkerId[])("%s", (id) => {
        const { wert, beobachte, richtung } = FAELLE[id];
        const regel = wegfindungWert(id);
        if (!regel) throw new Error(`${id} fehlt im Register`);
        expect(wert, "abweichend").not.toBe(WEGFINDUNG_VORGABEN[id]);
        expect(wert, "über min").toBeGreaterThanOrEqual(regel.min);
        expect(wert, "unter max").toBeLessThanOrEqual(regel.max);

        setzeWerte(null);
        const vorher = beobachte();
        const verstellt: Wegfindungswerte = { ...WEGFINDUNG_VORGABEN, [id]: wert };
        setzeWerte(verstellt);
        const nachher = beobachte();
        expect(JSON.stringify(nachher), "der Wert wirkt nicht").not.toBe(JSON.stringify(vorher));
        richtung?.(vorher, nachher);
    });

    it("🔴 die Fälle und die zehn Werte außerhalb des Workers sind genau das Register", () => {
        const hier = [...Object.keys(FAELLE), ...NICHT_IM_WORKER];
        expect(new Set(hier).size, "keine doppelt").toBe(hier.length);
        expect([...hier].sort()).toEqual(WEGFINDUNG_WERTE.map((wert) => wert.id).sort());
    });
});
