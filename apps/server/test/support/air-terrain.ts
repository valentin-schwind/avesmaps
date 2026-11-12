import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { NO_CLIMATE } from "../../src/routing/climate.ts";
import { NO_GROUND } from "../../src/routing/ground.ts";
import { buildRouteNetwork, type RouteNetwork, type RouteNode } from "../../src/routing/network.ts";
import { calibrateRelief, type TerrainHeights } from "../../src/routing/relief.ts";
import { NO_RIVERS } from "../../src/routing/rivers.ts";
import type { RoutingSource } from "../../src/routing/service.ts";
import { NO_WATER } from "../../src/routing/water.ts";
import { revisionOf } from "./routing-revision.ts";

/**
 * Gelände und Dienstquelle für die Tests des Flugs (WI-0051): Ein Gebirgsraster mit Wänden und Gipfeln, dazu ein
 * kleines Netz aus Orten, damit ein `RouteService` darauf rechnet, ohne Datenbank.
 */

const model = AVENTURIA_TRAVEL_MODEL;
export const STEIGUNG = { kind: "steigung" as const, steigung: 0.3 };

/**
 * Ein Gebirgsraster über 100 × 100 Karteneinheiten (Zelle 0,25), überall 100 Schritt hoch, wo `hoch` gilt `hoehe`
 * (3.000, wenn nichts anderes verlangt). Gipfelkegel kommen dazu; ihre Eichung rechnet mit.
 *
 * 🪤 Seit 2026-10-04 gilt für alle Flugmittel EINE Grenze (5.000 − 200 = 4.800 Schritt): Ein Gelände von 3.000 ist für
 * den Dienst kein Hindernis mehr. Tests, die der Dienst über Gelände fliegen lässt und die ein Hindernis brauchen,
 * nehmen `HOCH_WAND` und `GIPFEL_HOCH` (`wandHoch`).
 */
export function gebirge(
    hoch: (x: number, y: number) => boolean,
    cones: TerrainHeights["cones"] = [],
    hoehe = 3000,
): TerrainHeights {
    const cell = 0.25;
    const width = 401;
    const samples = new Uint16Array(width * width);
    for (let j = 0; j < width; j += 1) {
        for (let i = 0; i < width; i += 1) samples[j * width + i] = hoch(i * cell, j * cell) ? hoehe : 100;
    }
    const raster = { cell, originX: 0, originY: 0, width, height: width, samples, maxX: 100, maxY: 100 };
    return { rasters: [raster], cones, rule: STEIGUNG, mu: calibrateRelief([raster], cones, STEIGUNG, model) };
}

const ort = (id: string, x: number, y: number): RouteNode => ({
    id,
    name: `Ort ${id}`,
    kind: "place",
    isHidden: false,
    x,
    y,
});

/** Neun Orte in der Wand-und-Gipfel-Landschaft; A und B liegen an einer Straße, F mitten in der Wand. */
export const WAND_ORTE = [
    ort("a", 20, 20),
    ort("b", 80, 20),
    ort("c", 20, 50),
    ort("d", 80, 50),
    ort("e", 50, 90),
    ort("f", 50, 42),
    ort("g", 50, 5),
    ort("h", 30, 80),
    ort("i", 70, 80),
];

/** Eine Wand von 10 × 40 E in der Mitte, 3.000 Schritt hoch. */
export const wand = (x: number, y: number): boolean => x >= 45 && x <= 55 && y >= 30 && y <= 70;

/** Ein Gipfel auf der Luftlinie von A nach B: bei einer Grenze von 800 ein Hindernis von gut 2 E Radius. */
export const GIPFEL = { x: 50, y: 20, h: 3000, radius: 3000 / (0.3 * 3000) };

/** Die Höhe von Wand und Gipfel für den Dienst: über der Grenze aller Flugmittel (4.800), ein Hindernis für jedes. */
export const HOCH_WAND = 6000;
/** Der Gipfel auf der Luftlinie von A nach B in der Höhe `HOCH_WAND`: Hindernis von knapp 2 E Radius bei Grenze 4.800. */
export const GIPFEL_HOCH = { x: 50, y: 20, h: HOCH_WAND, radius: HOCH_WAND / (0.3 * 3000) };
/** Die Wand-und-Gipfel-Landschaft des Dienstes, über der Grenze aller Flugmittel. */
export const wandHoch = (): TerrainHeights => gebirge(wand, [GIPFEL_HOCH], HOCH_WAND);

/** Das Netz der Wand-Landschaft: die neun Orte und eine Straße von A nach B. */
export function wandNetz(): RouteNetwork {
    return buildRouteNetwork(WAND_ORTE, [
        {
            public_id: "ab",
            name: "ab",
            subtype: "Strasse",
            coordinates: JSON.stringify({
                type: "LineString",
                coordinates: [
                    [20, 20],
                    [80, 20],
                ],
            }),
            allowed_transports: null,
            transport_domain: null,
            flow_direction: null,
            flow_factor: null,
        },
    ]);
}

/**
 * Eine Quelle mit FRISCH gebautem Gelände: eigene Identität, also keine Zwischenspeicher von einem anderen Dienst.
 * Die Revision `r1` trägt der Test vor.
 */
export function wandQuelle(): RoutingSource {
    const data = {
        network: wandNetz(),
        water: NO_WATER,
        land: NO_WATER,
        rivers: NO_RIVERS,
        ground: NO_GROUND,
        climate: NO_CLIMATE,
        heights: wandHoch(),
        revision: revisionOf("r1"),
    };
    return { revision: async () => revisionOf("r1"), load: async () => data };
}
