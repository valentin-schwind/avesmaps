import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import type { RouteNode } from "../../src/routing/network.ts";
import { closureCells, type SeaClosure } from "../../src/routing/sea-closures.ts";
import { coastDistance, coastProfile } from "../../src/routing/sea-coast.ts";
import { compactSeaGraph, waterMask, type CompactSeaGraph } from "../../src/routing/sea-graph-store.ts";
import { buildSeaGrid, nearestWaterCell, prepareNavigableWater } from "../../src/routing/sea-grid.ts";
import { VisibilityGraph } from "../../src/routing/sea-visibility.ts";
import { areaEdges } from "../../src/routing/water.ts";

/**
 * Ein rechteckiges Meer für die Tests des Routers (WI-0153 Schnitt 7e). Seit der Router keine gezeichneten Seewege mehr fährt, braucht
 * jede Seereise im Test einen Seegraphen; dieser entsteht wie in `sea-free.test.ts` aus denselben Bausteinen wie die echte Ableitung:
 * Sichtgraph über dem Raster, Küstenabstand je Schiff, Häfen am nächsten Wasser (höchstens drei Einheiten), dazu auf Wunsch EIN
 * Sperrgebiet über das ganze Meer (Vereisung mit Fenster je Schiff), wie es die Ableitung aus den Sperrzeiten der Gebiete baut.
 */
const model = AVENTURIA_TRAVEL_MODEL;

export interface KunstSee {
    /** Das Meer als Rechteck `[x0, y0, x1, y1]` in Karteneinheiten. */
    rechteck: readonly [number, number, number, number];
    /** Die Häfen: Orte nah am Wasser; jeder bekommt einen Anleger an der nächsten Wasserzelle. */
    haefen: readonly RouteNode[];
    /** Die Schiffe, die der Graph kennt. */
    schiffe?: readonly string[];
    /** Ein Sperrgebiet über das ganze Meer, zum Beispiel eine Vereisung nur im Sommer offen. */
    sperre?: SeaClosure;
}

export function kunstSee(see: KunstSee): CompactSeaGraph {
    const [x0, y0, x1, y1] = see.rechteck;
    const ring: [number, number][] = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
    ];
    const water = prepareNavigableWater([
        {
            geometry: { type: "Polygon", coordinates: [ring] },
            minX: x0,
            minY: y0,
            maxX: x1,
            maxY: y1,
            regionName: "Meer",
            regionType: "meer",
            areaPublicId: "0",
        },
    ]);
    const grid = buildSeaGrid(water, 0.5);
    const graph = new VisibilityGraph(grid, [ring.slice(0, -1)]);
    const schiffe = see.schiffe ?? ["cargoShip", "galley"];
    graph.weigh(
        schiffe.map((schiff) => coastProfile(model, schiff)),
        coastDistance(grid),
    );
    const ports = see.haefen.map((hafen) => {
        const landing = nearestWaterCell(grid, hafen.x, hafen.y, 3);
        if (landing === null || landing === undefined) throw new Error(`Hafen ${hafen.id} liegt nicht am Wasser`);
        return { placeId: hafen.id, node: graph.attach(landing.x, landing.y) };
    });
    const closures =
        see.sperre === undefined
            ? undefined
            : {
                  list: [see.sperre],
                  cells: closureCells(grid, [
                      { closure: 0, edges: areaEdges({ type: "Polygon", coordinates: [ring] }), minY: y0, maxY: y1 },
                  ]),
              };
    return compactSeaGraph(graph.snapshot(), schiffe, ports, waterMask(grid), closures);
}
