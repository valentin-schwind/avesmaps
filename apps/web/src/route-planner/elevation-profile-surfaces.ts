import { AIR_TYPE, type ElevationSurface, type RouteResponse } from "@avesmaps3d/shared";

/**
 * Worauf die Höhenlinie des Diagramms liegt, Abschnitt für Abschnitt (WI-0065 Nachtrag 2026-10-03, Betreiber: „A.
 * Durchgehend zeichnen. … hellbraun bei land, blau bei fluss, dunkelblau bei meer, … rot bei luft“).
 *
 * - Jeder Abschnitt bringt seine Art mit (`elevation_surface`, der Server tastet sie im Höhenmodell ab); ohne Angabe
 *   gilt Land. Zusammenhängende Messwerte einer Art bilden einen Lauf; eine Lücke (`null`) beendet ihn.
 * - **Unter einem Flug** ist die Linie das Gelände darunter: Wo es auf 0 liegt, ist dort Meer (das Modell setzt das
 *   Meer exakt auf 0), sonst Land. Der Lauf der anderen Art beginnt am letzten Punkt des vorigen, damit die Linie am
 *   Übergang nicht reißt.
 * - Ein Binnensee zeichnet in der Farbe des Flusses (`surfaceTone`, Annahme; der Betreiber kann widersprechen).
 */

/** Ein Punkt des Diagramms: Meilen ab Reisebeginn und Höhe in Schritt (`null` ist eine Lücke). */
export type ChartPoint = [miles: number, height: number | null];

/** Ein zusammenhängendes Stück Linie einer Art, ohne Lücke. */
export interface ChartRun {
    kind: ElevationSurface;
    points: [number, number][];
}

/** Die Farbe im Diagramm: Land hellbraun, Fluss und Binnensee blau, Meer dunkelblau. */
export type SurfaceTone = "land" | "river" | "sea";

export const SURFACE_TONES: Record<ElevationSurface, SurfaceTone> = {
    land: "land",
    river: "river",
    lake: "river",
    sea: "sea",
};

/** Die Farbe, in der eine Art gezeichnet wird. */
export const surfaceTone = (kind: ElevationSurface): SurfaceTone => SURFACE_TONES[kind];

/** Höchstens so hoch liegt das Gelände unter einem Flug noch auf dem Meer (Meer ist im Höhenmodell exakt 0). */
const SEA_HEIGHT = 0.05;

/** Ein Flugabschnitt: sein Profil ist das Gelände unter der Bahn, nicht eine Fläche. */
const isFlight = (segment: { subtype?: string }): boolean => segment.subtype === AIR_TYPE;

/** Die Läufe eines Abschnitts, `offset` und `scale` setzen seine Abstände auf die Meilen der Reise. */
export function segmentRuns(
    segment: Pick<RouteResponse["segments"][number], "elevation_profile" | "elevation_surface"> & {
        subtype?: string;
    },
    offset: number,
    scale: number,
): ChartRun[] {
    const runs: ChartRun[] = [];
    const flying = isFlight(segment);
    const base: ElevationSurface = segment.elevation_surface ?? "land";
    let current: ChartRun | undefined;
    for (const [at, height] of segment.elevation_profile ?? []) {
        if (height === null) {
            current = undefined;
            continue;
        }
        const point: [number, number] = [offset + at * scale, height];
        const kind: ElevationSurface = flying ? (height <= SEA_HEIGHT ? "sea" : "land") : base;
        if (current && current.kind === kind) {
            current.points.push(point);
            continue;
        }
        // Eine neue Art mitten im Flug beginnt am letzten Punkt der alten: Die Linie reißt am Ufer nicht.
        const previous = current?.points[current.points.length - 1];
        current = { kind, points: previous ? [previous, point] : [point] };
        runs.push(current);
    }
    return runs;
}

/**
 * Der Messpunkt der Läufe, der `at` am nächsten liegt, samt seiner Art. An einem Übergang (zwei Läufe teilen die
 * Meile) gewinnt der Lauf, über dem der Zeiger steht.
 */
export function nearestRunPoint(
    runs: readonly ChartRun[],
    at: number,
): { point: [number, number]; kind: ElevationSurface } | null {
    let best: { point: [number, number]; kind: ElevationSurface } | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    let bestInside = false;
    for (const run of runs) {
        const first = run.points[0]?.[0] ?? 0;
        const last = run.points[run.points.length - 1]?.[0] ?? 0;
        const inside = at >= first && at <= last;
        for (const point of run.points) {
            const gap = Math.abs(point[0] - at);
            if (gap < bestGap - 1e-9 || (gap <= bestGap + 1e-9 && inside && !bestInside)) {
                best = { point, kind: run.kind };
                bestGap = gap;
                bestInside = inside;
            }
        }
    }
    return best;
}

/**
 * Die Flughöhe an der Stelle `at` (Meilen), zwischen zwei Punkten der roten Linie linear; null, wo keine Bahn liegt.
 * `air` sind die Linien der Flugabschnitte, je Abschnitt eine.
 */
export function airHeightAt(air: readonly (readonly ChartPoint[])[], at: number): number | null {
    for (const line of air) {
        const first = line[0];
        const last = line[line.length - 1];
        if (!first || !last || at < first[0] || at > last[0]) continue;
        for (let i = 1; i < line.length; i += 1) {
            const [x0, h0] = line[i - 1] as [number, number];
            const [x1, h1] = line[i] as [number, number];
            if (at > x1) continue;
            return x1 > x0 ? h0 + ((h1 - h0) * (at - x0)) / (x1 - x0) : h1;
        }
    }
    return null;
}
