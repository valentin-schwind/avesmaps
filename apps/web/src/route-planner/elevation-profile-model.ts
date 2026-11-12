import {
    AVENTURIA_TRAVEL_MODEL,
    DAYS_PER_YEAR,
    dayOfYear,
    snowlineHeight,
    type CalendarDate,
    type RouteResponse,
} from "@avesmaps3d/shared";
import { segmentRuns, type ChartPoint, type ChartRun } from "./elevation-profile-surfaces";

export type { ChartPoint, ChartRun } from "./elevation-profile-surfaces";

/**
 * Die Schneegrenze des Profils: dieselbe Tafel und Rechnung wie die Schneeregel des Schlittens und der Tiefschnee über der
 * Schneegrenze im Router (`schneegrenze` im Reisemodell, `snowlineHeight`; WI-0065, WI-0069, Betreiber 2026-10-04 A).
 * Eine Näherung, kein Wettermodell.
 */
export function snowHeight(zone: string | null | undefined, day: number): number | null {
    return snowlineHeight(AVENTURIA_TRAVEL_MODEL, zone, day);
}

function absoluteDay(date: CalendarDate): number {
    return (
        date.years_passed * DAYS_PER_YEAR +
        (date.nameless ? 360 + date.day : dayOfYear(date.month || "rahja", date.day))
    );
}

/**
 * Ob die Route Profilpunkte mit einer Höhe trägt, das Diagramm also etwas zu zeichnen hat (dieselbe Frage wie
 * `profileLines(elevationChartData(route).terrain).length > 0`, ohne die Schneegrenze zu rechnen). Ohne sie gibt es
 * keine Profilbox; „Höhenprofil abgeleitet“ heißt genau das (Betreiber 2026-10-03).
 */
export function hasElevationProfile(route: Pick<RouteResponse, "segments">): boolean {
    return route.segments.some((segment) => segment.elevation_profile?.some(([, height]) => height !== null) === true);
}

/**
 * Was das Diagramm zeichnet. `terrain` ist die Höhenlinie der ganzen Reise mit Lücken (`null`); `runs` dieselben
 * Messwerte als Läufe je Art (Land, Fluss, See, Meer: `elevation-profile-surfaces.ts`), `air` die rote Linie der
 * Flughöhe (WI-0065 Nachtrag 2026-10-03), `snow` die Schneegrenze.
 */
export function elevationChartData(route: RouteResponse): {
    terrain: ChartPoint[];
    runs: ChartRun[];
    air: ChartPoint[];
    snow: ChartPoint[];
    distance: number;
    partial: boolean;
} {
    const terrain: ChartPoint[] = [];
    const runs: ChartRun[] = [];
    const air: ChartPoint[] = [];
    const snow: ChartPoint[] = [];
    let units = 0;
    let partial = false;
    // Der letzte Messpunkt des vorigen Abschnitts, solange sein Profil ohne Lücke endet: Daran schließt der nächste Lauf an.
    let anschluss: [number, number] | undefined;
    for (const [index, segment] of route.segments.entries()) {
        const offset = units * route.miles_per_unit;
        const length = segment.distance_units * route.miles_per_unit;
        const profile = segment.elevation_profile;
        terrain.push([offset, null]);
        if (!profile?.length) {
            partial = true;
            anschluss = undefined;
        } else {
            for (const [x, height] of profile) {
                terrain.push([offset + x * route.miles_per_unit, height]);
                if (height === null) partial = true;
            }
            if (profile[0]![0] > 0 || profile[profile.length - 1]![0] < segment.distance_units - 0.001) partial = true;
            const laeufe = segmentRuns(segment, offset, route.miles_per_unit);
            // 🔴 Durchgehend (WI-0065 Nachtrag 2026-10-03): Der Lauf beginnt dort, wo der vorige endet. Zieht der Router an einer Naht eine
            // Lücke zu (die Strecke geht auf `distance_units`, nicht auf das Profil: `route-result.ts`, `toNodes`), endet das Profil des
            // Abschnitts vor dessen Ende, und die Linie risse an der Naht. Dann beginnt der nächste Lauf auf der Meile, an der der vorige
            // endet, in seiner eigenen Höhe (wie am Ufer: Meer bleibt auf 0). Wo nichts klafft, bleibt alles, wie es ist. Nicht über eine echte
            // Lücke (`null`): Dort ist die Höhe unbekannt, und das Diagramm sagt es.
            const erster = laeufe[0];
            const ersterPunkt = erster?.points[0];
            if (anschluss && erster && ersterPunkt && profile[0]![1] !== null && anschluss[0] < ersterPunkt[0] - 1e-9)
                erster.points.unshift([anschluss[0], ersterPunkt[1]]);
            runs.push(...laeufe);
            const letzter = laeufe[laeufe.length - 1];
            anschluss = letzter && profile[profile.length - 1]![1] !== null ? letzter.points.at(-1) : undefined;
        }
        if (segment.air_profile?.length) {
            air.push([offset, null]);
            for (const [x, altitude] of segment.air_profile) air.push([offset + x * route.miles_per_unit, altitude]);
        }
        const stage = route.stages.find((s) => index >= s.segment_start && index < s.segment_start + s.segment_count);
        if (stage?.start_date && stage.end_date) {
            const start = absoluteDay(stage.start_date);
            const end = absoluteDay(stage.end_date);
            const stageSegments = route.segments.slice(stage.segment_start, stage.segment_start + stage.segment_count);
            const hours = stageSegments.reduce((sum, s) => sum + s.travel_hours, 0);
            const elapsed = stageSegments
                .slice(0, index - stage.segment_start)
                .reduce((sum, s) => sum + s.travel_hours, 0);
            snow.push([offset, null]);
            for (let step = 0; step <= 8; step++) {
                const progress = hours > 0 ? (elapsed + (segment.travel_hours * step) / 8) / hours : 0;
                snow.push([
                    offset + (length * step) / 8,
                    snowHeight(segment.climate_zone, start + (end - start) * progress),
                ]);
            }
        }
        units += segment.distance_units;
    }
    return { terrain, runs, air, snow, distance: units * route.miles_per_unit, partial };
}

export function profileLines(points: readonly ChartPoint[]): ChartPoint[][] {
    const lines: ChartPoint[][] = [];
    let current: ChartPoint[] = [];
    for (const point of points) {
        if (point[1] === null) {
            if (current.length > 0) lines.push(current);
            current = [];
        } else current.push(point);
    }
    if (current.length > 0) lines.push(current);
    return lines;
}
