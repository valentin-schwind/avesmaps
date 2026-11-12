import type { Queryable } from "../database.ts";
import { buildAxisGraph, longestPath, resample } from "../derive/chordal-axis.ts";
import { fitCurve } from "../derive/curve-fit.ts";
import { interiorTriangles, shapeOf, trianglesOf } from "../derive/label-runs.ts";

/**
 * Erzeugt die Kammlinie einer Gebirgsfläche, wo keine vorliegt (Betreiber 2026-09-27: „kammlinien
 * automatisch generieren, wenn die einstellungen es nötig machen“).
 *
 * Legacys Knopf „Kammlinie erzeugen“ rechnet mit DEMSELBEN Rechner wie die Beschriftungskurve
 * (`avesmapsCurveBaseline`, ecosystem.php, Kommentar zu `terrain_ridge_line`). Hier ist
 * das unsere Ableitung der Schriftläufe bis zur geglätteten Achse, ohne die Namensplatzierung:
 * vereinfachen, triangulieren, Mittelachse, längster Weg, Polynomfit (label-runs.ts).
 */

/** Stützpunkte der Kurve, wie bei den Schriftläufen (`SAMPLES` in label-runs.ts). */
const SAMPLES = 120;

export async function generateRidge(database: Queryable, areaPublicId: string): Promise<[number, number][] | null> {
    const shape = await shapeOf(database, [areaPublicId]);
    if (!shape) {
        return null;
    }
    const inside = await interiorTriangles(database, await trianglesOf(database, shape), shape);
    if (inside.length < 2) {
        return null;
    }
    const axis = longestPath(buildAxisGraph(inside));
    if (axis.length < 2) {
        return null;
    }
    return fitCurve(resample(axis, SAMPLES), SAMPLES).map((point) => [point.x, point.y]);
}
