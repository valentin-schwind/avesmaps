import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { calibrateRelief, type TerrainHeights } from "../../src/routing/relief.ts";
import { coneRadius, freePeakHeight } from "../../src/terrain/peak-cone.ts";
import { STEIGUNG } from "./air-terrain.ts";
import { random } from "./invariants.ts";

/**
 * Zufälliges Gelände für die Invarianten des Flugs (WI-0061): ein Gebirgsraster über 100 × 100 Karteneinheiten
 * (Zelle 0,25, überall mindestens 100 Schritt), darauf Riegel mit flacher Krone und steilen Flanken, Hügel, die
 * auslaufen, und freie Gipfelkegel. Dieselbe Kennzahl ergibt dasselbe Gelände.
 */

export const GELAENDE_GROESSE = 100;
const CELL = 0.25;
const WIDTH = 401;
const SOCKEL = 100;

/** Die Höhen, die Riegel und Hügel bekommen: unter, an und über den Grenzen der Flugmittel (800 bis 9.800 Schritt). */
const HOEHEN = [900, 1500, 2300, 3500, 5000, 9000];

interface Riegel {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    h: number;
}
interface Huegel {
    x: number;
    y: number;
    r: number;
    h: number;
}

export function zufallsGelaende(seed: number): TerrainHeights {
    const next = random(seed);
    const between = (from: number, to: number): number => from + next() * (to - from);
    // Alles bleibt eine Einheit vom Rand des Rasters weg: Ein Gebirge, das am Rand hoch abbricht, gibt es in den
    // echten Rastern nicht (sie laufen zum Rand hin aus), und eine Linie genau auf dem Rand wäre eine Spielerei.
    const riegel: Riegel[] = Array.from({ length: 2 + Math.floor(next() * 5) }, () => {
        const halbX = between(1, 16);
        const halbY = between(1, 16);
        const x = between(halbX + 1, GELAENDE_GROESSE - 1 - halbX);
        const y = between(halbY + 1, GELAENDE_GROESSE - 1 - halbY);
        return {
            x0: x - halbX,
            y0: y - halbY,
            x1: x + halbX,
            y1: y + halbY,
            h: HOEHEN[Math.floor(next() * HOEHEN.length)] as number,
        };
    });
    const huegel: Huegel[] = Array.from({ length: Math.floor(next() * 4) }, () => {
        const r = between(3, 18);
        return {
            x: between(r + 1, GELAENDE_GROESSE - 1 - r),
            y: between(r + 1, GELAENDE_GROESSE - 1 - r),
            r,
            h: HOEHEN[Math.floor(next() * HOEHEN.length)] as number,
        };
    });
    const samples = new Uint16Array(WIDTH * WIDTH);
    for (let j = 0; j < WIDTH; j += 1) {
        const y = j * CELL;
        for (let i = 0; i < WIDTH; i += 1) {
            const x = i * CELL;
            let height = SOCKEL;
            for (const one of riegel) {
                if (x >= one.x0 && x <= one.x1 && y >= one.y0 && y <= one.y1 && one.h > height) height = one.h;
            }
            for (const one of huegel) {
                const d = Math.hypot(x - one.x, y - one.y) / one.r;
                if (d < 1) height = Math.max(height, Math.round(one.h * (1 - d * d) ** 2));
            }
            samples[j * WIDTH + i] = height;
        }
    }
    const raster = {
        cell: CELL,
        originX: 0,
        originY: 0,
        width: WIDTH,
        height: WIDTH,
        samples,
        maxX: GELAENDE_GROESSE,
        maxY: GELAENDE_GROESSE,
    };
    const cones = Array.from({ length: Math.floor(next() * 4) }, () => {
        const peak = { x: between(8, 92), y: between(8, 92), h: Math.round(between(800, 6000)) };
        return { ...peak, radius: coneRadius(freePeakHeight(peak), STEIGUNG) };
    });
    return {
        rasters: [raster],
        cones,
        rule: STEIGUNG,
        mu: calibrateRelief([raster], cones, STEIGUNG, AVENTURIA_TRAVEL_MODEL),
    };
}
