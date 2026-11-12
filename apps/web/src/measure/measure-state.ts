import { AVENTURIA, distanceInMiles, type MapPoint } from "@avesmaps3d/shared";
import { miles } from "../route-planner/stage-figures";

/**
 * Die Entfernungsmessung, nur als Rechnung (WI-0095, Finding MCS-030). Keine Karte, kein Vue - damit
 * sich jeder Fall benennen lässt, ohne einen Browser zu starten.
 *
 * 🔴 **Legacy rechnet die Luftlinie in der Ebene und EINMAL** (`js/app/utils.js` `calculateScaledDistance`:
 * `Math.hypot` über die Kartenkoordinaten mal `DISTANCE_SCALING_FACTOR` = 3). Genau dieselbe Rechnung steht
 * bei uns in `distanceInMiles` (`packages/shared/src/map-domain.ts`) mit
 * `coordinateSpace.distance.milesPerUnit` = 3 — die eine Stelle, die den Maßstab anwendet (Kap. 2.4,
 * Finding MCS-002). Der Drachenflug des Reiseplaners summiert dieselbe Länge über die Stationen. Eine
 * zweite Rechnung hier wäre derselbe Wert aus zwei Quellen.
 *
 * 🪤 **Die Punkte sind Kartenkoordinaten (`aventuria-v1`), nie Renderkoordinaten.** Wer einen Klick
 * misst, rechnet ihn mit `fromRenderLngLat` um, bevor er hier ankommt (ADR-0003: die Renderprojektion
 * ist abgeleitet und darf keine Entfernung tragen).
 */

const space = AVENTURIA.coordinateSpace;

/** Welchen der beiden Punkte eine Geste anfasst. */
export type MeasureHandle = "start" | "end";

/**
 * Eine Messung: der erste Punkt steht, der zweite fehlt noch oder steht auch. Mehr gibt es nicht -
 * Legacy kennt genau zwei Punkte und keine Kette (`startDistanceMeasurementAt` /
 * `completeDistanceMeasurementAt`, `js/ui/ui-controls.js`).
 */
export interface Measurement {
    readonly start: MapPoint;
    readonly end?: MapPoint;
}

/** Wartet die Messung noch auf ihren zweiten Punkt? Dann nimmt der nächste Klick ihn (Legacy `isAwaitingDistanceMeasurementEnd`). */
export function isPending(measurement: Measurement | undefined): boolean {
    return measurement !== undefined && measurement.end === undefined;
}

/** Die Entfernung in Meilen, sobald beide Punkte stehen. */
export function measureMiles(measurement: Measurement | undefined): number | undefined {
    if (measurement?.end === undefined) return undefined;
    return distanceInMiles(space, measurement.start, measurement.end);
}

/**
 * Die Mitte der Strecke, wo der Wert steht: das arithmetische Mittel beider Punkte, wie Legacy
 * (`getDistanceMeasurementMidpoint`). In einem kartesischen Kartenraum ist das die echte Mitte.
 */
export function measureMidpoint(measurement: Measurement | undefined): MapPoint | undefined {
    if (measurement?.end === undefined) return undefined;
    return {
        x: (measurement.start.x + measurement.end.x) / 2,
        y: (measurement.start.y + measurement.end.y) / 2,
    };
}

/** Einen der beiden Punkte verschieben; der andere bleibt. */
export function withHandleAt(measurement: Measurement, handle: MeasureHandle, to: MapPoint): Measurement {
    return handle === "start" ? { ...measurement, start: to } : { ...measurement, end: to };
}

/**
 * Der Wert, wie ihn die Pille schreibt: „157,2 Meilen“ beziehungsweise „157.2 miles“.
 *
 * 🔴 EINE Nachkommastelle und keine Einheitengrenze — Legacy schreibt jede Entfernung in Meilen
 * (`formatDistanceMeasurement` → `formatDecimalNumber(value, 1)` + `units.miles`), von 0,0 bis über
 * dreitausend; es gibt keinen Wechsel auf Spann oder Schritt. Das Format kommt aus derselben Stelle,
 * die der Planer für seine Meilen benutzt (`route-planner/stage-figures.ts`).
 */
export const MEASURE_DIGITS = 1;

export function measureText(measurement: Measurement | undefined): string | undefined {
    const value = measureMiles(measurement);
    return value === undefined ? undefined : miles(value, MEASURE_DIGITS);
}
