import type { Map as MapLibreMap } from "maplibre-gl";
import { centreForOffset, locationAtOffset } from "./camera-math";

/**
 * Wohin die Mitte der Karte muss, damit ein Punkt an einer bestimmten Stelle des Bildes steht (WI-0218).
 *
 * 🔴 **Der Fluchtpunkt bleibt in der Bildmitte** (Betreiber 2026-10-17, über die Editor-Orchestrierung; auf den Vorschlag
 * „Fluchtpunkt bleibt in der Bildmitte, nur Ziele beim Hinfliegen rücken in die freie Fläche“ wörtlich: „ok, aber beachte dass bei
 * angedockten editoren ein klick auf die ziel objekte ebenfalls nicht in der bildmitte erfolgen sollen“). Bis WI-0218 ging die freie
 * Fläche als MapLibres `padding` in die Karte; das verschob in 3D den Fluchtpunkt, und ein aufklappender Editor verzerrte die
 * Perspektive. Jetzt rechnet jede Fahrt ihr Ziel selbst in die Mitte der freien Fläche (`camera.ts`).
 *
 * Gerechnet wird mit MapLibres Lochkamera (`groundOffset` in `camera-math.ts`): geneigt und gedreht, für Boden in der Höhe der
 * Kartenmitte. 🪤 Nicht MapLibres `offset`: Bei „Bewegung reduzieren“ springt `flyTo` und verwirft ihn; und wer auf einer laufenden
 * Fahrt aufbaut, braucht deren Mitte. 🪤 Auch nicht die Transformation selbst: MapLibre 6 hält sie intern (`_camera`).
 */

/** Ein Blick ohne Mitte. */
export interface CameraView {
    zoom: number;
    bearing: number;
    pitch: number;
}

/** Eine Stelle im Bild, in Bildpunkten der Karte. */
export interface ScreenPoint {
    x: number;
    y: number;
}

/** Näher als einen halben Bildpunkt an der Bildmitte ist die Bildmitte: Dann gibt es nichts zu rechnen. */
const SAME_PIXEL = 0.5;

/** Wie weit `at` von der Bildmitte liegt; `undefined`, wenn es die Bildmitte ist. */
function offsetOf(map: MapLibreMap, at: ScreenPoint): { dx: number; dy: number; height: number } | undefined {
    const canvas = map.getCanvas();
    const dx = at.x - canvas.clientWidth / 2;
    const dy = at.y - canvas.clientHeight / 2;
    if (Math.abs(dx) < SAME_PIXEL && Math.abs(dy) < SAME_PIXEL) return undefined;
    return { dx, dy, height: canvas.clientHeight };
}

/** Die Mitte der Karte, bei der `point` im Blick `view` an der Stelle `at` steht. */
export function centreFor(
    map: MapLibreMap,
    point: [number, number],
    view: CameraView,
    at: ScreenPoint,
): [number, number] {
    const offset = offsetOf(map, at);
    if (offset === undefined) return point;
    return centreForOffset(point, offset.dx, offset.dy, view, map.getVerticalFieldOfView(), offset.height);
}

/** Was im Blick `view` mit der Mitte `center` an der Stelle `at` liegt (auf Bodenhöhe der Kartenmitte). */
export function locationAt(
    map: MapLibreMap,
    view: CameraView,
    center: [number, number],
    at: ScreenPoint,
): [number, number] {
    const offset = offsetOf(map, at);
    if (offset === undefined) return center;
    return locationAtOffset(center, offset.dx, offset.dy, view, map.getVerticalFieldOfView(), offset.height);
}
