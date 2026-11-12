import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    CITY_NODE_RADIUS,
    LANDSCAPE_MIN_SHARE,
    ROUTE_FLIGHT_SEARCH_LIMIT,
    ROUTE_FREE_SEA_LIMIT,
    ROUTE_MAP_POINT_LIMIT,
    ROUTE_WAYPOINT_LIMIT,
    WAYPOINT_LOOKUP_LIMIT,
    WEGFINDUNG_ALS_ANTEIL,
    WEGFINDUNG_PANELE,
    WEGFINDUNG_WERTE,
    WEIGHT_NORMALIZER_HOURS,
    wegfindungVorgabe,
} from "@avesmaps3d/shared";
import { AIR_CELL_UNITS } from "../src/routing/air-obstacles.ts";
import { BLOCKED_WEIGHT, HOME_FACTOR, POCKET_CELLS } from "../src/routing/air-search.ts";
import { AIR_CELL_LIMIT } from "../src/routing/air-way.ts";
import {
    WEIGH_CELL_LIMIT,
    WEIGH_DETOUR,
    WEIGH_DETOUR_NEAR,
    WEIGH_MIN_HOURS,
    WEIGH_NEAR_COST,
    WEIGH_NEAR_EDGE,
    WEIGH_POLISH_EVALUATIONS,
    WEIGH_POLISH_MIN,
    WEIGH_POLISH_PASSES,
    WEIGH_WORK_BUDGET,
} from "../src/routing/air-weigh.ts";
import { LOOSE_DISTANCE } from "../src/routing/loose-endpoints.ts";
import {
    DIRECT_EDGE_MILES,
    EXIT_NEAREST_TRIES,
    EXIT_NODE_LIMIT,
    EXIT_PATH_LIMIT,
    EXIT_VERTEX_LIMIT,
    ROAD_REACH,
} from "../src/routing/map-points.ts";
import { CELL_LIMIT, CELL_UNITS } from "../src/routing/offroad-grid.ts";
import { DISPLAY_EPSILON, SIMPLIFY_EPSILON } from "../src/routing/offroad-search.ts";
import { ANCHOR_LIMIT } from "../src/routing/request-graph.ts";
import { FREE_SEA_DISPLAY_TOLERANCE } from "../src/routing/sea-free.ts";
import { LANDING_REACH, SEA_CELL_UNITS } from "../src/routing/sea-grid.ts";
import { FAR_SEARCH } from "../src/routing/sea-landless.ts";
import { SEA_CLOSURE_LIMIT } from "../src/routing/sea-closures.ts";
import { SCHRITT_PER_UNIT } from "../src/routing/slope.ts";
import { END_SNAP, ENDPOINT_BOX, EXACT_HIT } from "../src/routing/topology.ts";
import { COAST_TOLERANCE, DRY_SEARCH_LIMIT, SHORE_TOLERANCE } from "../src/routing/water.ts";
import { NODE_GAP } from "../src/routing/route-result.ts";
import { SEA_LEVEL } from "../src/routing/water-profile.ts";

/**
 * Die Tafel der Kenngrößen (WI-0153, `packages/shared/src/wegfindung.ts`) gegen den Code, aus dem sie stammt.
 *
 * 💣 **Das ist der Grund, warum es die Tafel geben darf.** Sie wird im Reiter „Wegfindung“ als Vorgabe angezeigt und
 * als Ziel eines Rücksetzens angeboten; eine Zahl, die dort von der Konstante abweicht, wäre eine Lüge an der
 * Oberfläche. Dieser Test rechnet jede nach. Ändert jemand eine Konstante, fällt er um, und die Tafel wird mitgezogen.
 *
 * 🪤 Er prüft NICHT, ob ein Wert sinnvoll ist, und auch nicht, wo er wirkt (`folge`) — nur, dass die Zahl stimmt und
 * dass keine Kennung doppelt vorkommt.
 */

/** Die Vorgabe je Kennung, gelesen an der Stelle, die die Tafel in `quelle` nennt. */
const AUS_DEM_CODE: Readonly<Record<string, number>> = {
    // Allgemeine Wegfindungseinstellungen
    endSnap: END_SNAP,
    endpointBox: ENDPOINT_BOX,
    exactHit: EXACT_HIT,
    nodeGap: NODE_GAP,
    meilenJeKarteneinheit: AVENTURIA_TRAVEL_MODEL.meilenJeKarteneinheit.wert,
    schrittPerUnit: SCHRITT_PER_UNIT,
    routeWaypointLimit: ROUTE_WAYPOINT_LIMIT,
    routeMapPointLimit: ROUTE_MAP_POINT_LIMIT,
    waypointLookupLimit: WAYPOINT_LOOKUP_LIMIT,
    looseDistance: LOOSE_DISTANCE,
    cityNodeRadius: CITY_NODE_RADIUS,
    landscapeMinShare: LANDSCAPE_MIN_SHARE,
    // Dijkstra
    querfeldeinAufschlag: AVENTURIA_TRAVEL_MODEL.querfeldeinAufschlag.wert,
    routeFreeSeaLimit: ROUTE_FREE_SEA_LIMIT,
    routeFlightSearchLimit: ROUTE_FLIGHT_SEARCH_LIMIT,
    anchorLimit: ANCHOR_LIMIT,
    weightNormalizerHours: WEIGHT_NORMALIZER_HOURS,
    seaClosureLimit: SEA_CLOSURE_LIMIT,
    exitPathLimit: EXIT_PATH_LIMIT,
    exitVertexLimit: EXIT_VERTEX_LIMIT,
    exitNodeLimit: EXIT_NODE_LIMIT,
    exitNearestTries: EXIT_NEAREST_TRIES,
    directEdgeMiles: DIRECT_EDGE_MILES,
    roadReach: ROAD_REACH,
    // A*: querfeldein
    cellUnits: CELL_UNITS,
    cellLimit: CELL_LIMIT,
    simplifyEpsilon: SIMPLIFY_EPSILON,
    displayEpsilon: DISPLAY_EPSILON,
    // A*: Seefahrt
    seaCellUnits: SEA_CELL_UNITS,
    landingReach: LANDING_REACH,
    freeSeaDisplayTolerance: FREE_SEA_DISPLAY_TOLERANCE,
    farSearch: FAR_SEARCH,
    // A*: Flug
    airCellUnits: AIR_CELL_UNITS,
    airCellLimit: AIR_CELL_LIMIT,
    blockedWeight: BLOCKED_WEIGHT,
    homeFactor: HOME_FACTOR,
    pocketCells: POCKET_CELLS,
    weighDetour: WEIGH_DETOUR,
    weighDetourNear: WEIGH_DETOUR_NEAR,
    weighNearEdge: WEIGH_NEAR_EDGE,
    weighNearCost: WEIGH_NEAR_COST,
    weighCellLimit: WEIGH_CELL_LIMIT,
    weighWorkBudget: WEIGH_WORK_BUDGET,
    weighPolishPasses: WEIGH_POLISH_PASSES,
    weighPolishEvaluations: WEIGH_POLISH_EVALUATIONS,
    weighPolishMin: WEIGH_POLISH_MIN,
    weighMinHours: WEIGH_MIN_HOURS,
    // A*: Wasser
    drySearchLimit: DRY_SEARCH_LIMIT,
    coastTolerance: COAST_TOLERANCE,
    shoreTolerance: SHORE_TOLERANCE,
    seaLevel: SEA_LEVEL,
};

/** Was die Oberfläche als Prozent zeigt, steht im Code als Anteil: 50 % gegen 0,5. */
const ALS_ANTEIL = new Set<string>(WEGFINDUNG_ALS_ANTEIL);

describe("Die Tafel der Kenngrößen der Wegfindung", () => {
    it("nennt jede Kennung genau einmal", () => {
        const ids = WEGFINDUNG_WERTE.map((wert) => wert.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("deckt genau die Werte ab, die der Test kennt", () => {
        const inDerTafel = new Set(WEGFINDUNG_WERTE.map((wert) => wert.id));
        const imTest = new Set(Object.keys(AUS_DEM_CODE));
        expect([...inDerTafel].filter((id) => !imTest.has(id))).toEqual([]);
        expect([...imTest].filter((id) => !inDerTafel.has(id))).toEqual([]);
    });

    it.each(WEGFINDUNG_WERTE.map((wert) => [wert.id, wert] as const))(
        "%s trägt die Zahl, die im Code steht",
        (id, wert) => {
            const code = AUS_DEM_CODE[id];
            expect(code, `keine Quelle im Test für ${id}`).toBeDefined();
            const erwartet = ALS_ANTEIL.has(id) ? (code as number) * 100 : (code as number);
            expect(wegfindungVorgabe(wert), `${wert.name} (${wert.quelle})`).toBeCloseTo(erwartet, 6);
        },
    );

    it("nennt zu jedem Wert eine Quelle mit Datei und Namen", () => {
        for (const wert of WEGFINDUNG_WERTE) {
            expect(wert.quelle, wert.name).toMatch(/^[\w./-]+ \S+$/u);
            expect(wert.satz.length, `${wert.name} hat keinen Satz`).toBeGreaterThan(20);
        }
    });

    it("hat drei Panele, und jedes sagt, wo seine Werte wirken", () => {
        expect(WEGFINDUNG_PANELE.map((panel) => panel.titel)).toEqual([
            "Allgemeine Wegfindungseinstellungen",
            "Dijkstra-Einstellungen",
            "A* Einstellungen",
        ]);
        for (const panel of WEGFINDUNG_PANELE) expect(panel.wirkung.length).toBeGreaterThan(20);
    });
});
