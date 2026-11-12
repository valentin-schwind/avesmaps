import type { StagePlace } from "@avesmaps3d/shared";
import type { RouteNetwork } from "./network.ts";

/**
 * Die Orte des Wegenetzes, so abgelegt, dass die Etappenbildung zwei Fragen schnell beantworten kann
 * (`RouteStageContext`): welcher Ort an einem Knoten liegt und welcher einem Punkt am nächsten ist.
 *
 * Ein Raster aus Zellen von 0,5 Einheiten: Gefragt wird mit 0,15 (`CITY_NODE_RADIUS`), also genügen
 * die Nachbarzellen. Ohne Raster wären es bei 100 Wegpunkten Millionen Abstände je Route.
 */

const CELL = 0.5;

export interface PlaceIndex {
    placeAt(nodeId: string): StagePlace | undefined;
    placeNear(x: number, y: number, radius: number, accept: (place: StagePlace) => boolean): StagePlace | undefined;
    /** Die Lage eines Ortes, für den Drachenflug. */
    coordinates(nodeId: string): { x: number; y: number } | undefined;
}

const cellKey = (column: number, row: number): string => `${String(column)}:${String(row)}`;

export function buildPlaceIndex(network: RouteNetwork): PlaceIndex {
    const places = new Map<string, StagePlace>();
    const cells = new Map<string, StagePlace[]>();
    for (const node of network.nodes.values()) {
        if (node.kind !== "place") continue;
        const place: StagePlace = {
            id: node.id,
            name: node.name,
            // 🔴 Entrückt (WI-0128 E21) heißt für die Etappen dasselbe wie versteckt: Der Ort wird zur namenlosen Markierung,
            // es sei denn, die Anfrage nennt ihn selbst (`visible` in `route-stages.ts`). Der Graph liest das nicht.
            hidden: node.isHidden || node.isWithdrawn === true,
            ...(node.subtype === undefined ? {} : { subtype: node.subtype }),
            x: node.x,
            y: node.y,
        };
        places.set(node.id, place);
        const key = cellKey(Math.floor(node.x / CELL), Math.floor(node.y / CELL));
        const cell = cells.get(key);
        if (cell) cell.push(place);
        else cells.set(key, [place]);
    }

    return {
        placeAt: (nodeId) => places.get(nodeId),
        coordinates: (nodeId) => {
            const place = places.get(nodeId);
            return place ? { x: place.x, y: place.y } : undefined;
        },
        placeNear(x, y, radius, accept) {
            const reach = Math.ceil(radius / CELL);
            const column = Math.floor(x / CELL);
            const row = Math.floor(y / CELL);
            let best: StagePlace | undefined;
            let bestDistance = radius * radius;
            for (let dc = -reach; dc <= reach; dc += 1) {
                for (let dr = -reach; dr <= reach; dr += 1) {
                    for (const place of cells.get(cellKey(column + dc, row + dr)) ?? []) {
                        const distance = (place.x - x) ** 2 + (place.y - y) ** 2;
                        // Gleich weit: der zuerst gefundene bleibt - die Zellen werden immer gleich abgelaufen.
                        if (
                            distance <= bestDistance &&
                            (best === undefined || distance < bestDistance) &&
                            accept(place)
                        ) {
                            best = place;
                            bestDistance = distance;
                        }
                    }
                }
            }
            return best;
        },
    };
}
