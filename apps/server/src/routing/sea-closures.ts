import { werte } from "./einstellungen.ts";
import {
    CALENDAR_MONTHS,
    DAYS_PER_MONTH,
    DAYS_PER_YEAR,
    seaGraphTransports,
    windowContains,
    type ClosureReason,
    type SeasonWindow,
    type TravelModel,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { forEachCellInside, type NavigableWater, type SeaGrid } from "./sea-grid.ts";
import { areaEdges } from "./water.ts";

/**
 * Die Sperrgebiete der freien See (WI-0046, S5; Betreiber 2026-09-27: „wir machen mal beides; die
 * sperrzeiten der meere, boreal und subpolare vereisung. wichtig ist, dass wir das später nochmal
 * editieren können“). Beide stehen im Reisemodell, nicht an den Seewegen: Deren Löschen darf keinen
 * Effekt haben (Betreiber 2026-09-27).
 *
 * - **Meere mit Sperrzeit** (Tafel `meerSperren`): je Meerregion ein Fenster und ein Grund. Heute der
 *   Golf von Riva, befahrbar 1. Peraine bis 30. Boron, wegen Vereisung - das Fenster seiner Seewege.
 *   „Wir müssen nachher nur die meere editieren, die gesperrt sind“ (Betreiber).
 * - **Vereisung** (Tafel `vereisung`): Meer und Seen einer Klimazone. Vorerst leer (Betreiber 2026-09-27:
 *   „dann schalt die klimazonen-sperrung vorerst ab“).
 * - Die Ableitung merkt sich je Schiff und Hafenpaar, durch welche Gebiete die Seereise fährt (ein Bit je
 *   Gebiet). Der Router gibt der Seekante das gemeinsame Fenster dieser Gebiete, und die Sperre läuft wie
 *   bei einem Seeweg: gesperrt, wenn man sie an einem Tag außerhalb betritt.
 */

/** Ein Bit je Gebiet, gespeichert als Byte je Hafenpaar. */
export const SEA_CLOSURE_LIMIT = 8;

export interface SeaClosure {
    /** Wie der Sperrbericht das Gebiet nennt: die Meerregion oder „Vereisung (boreal)“. */
    name: string;
    kind: "meer" | "vereisung";
    /** Bei der Vereisung die Klimazone (`climate_band.type_key`). */
    zone?: string;
    /** Warum das Gebiet außerhalb des Fensters nicht befahrbar ist. */
    reason: ClosureReason;
    /** Je Seeschiff mit eigenen Wegen, wann das Gebiet befahrbar ist; ein Schiff ohne Eintrag fährt immer. */
    windows: Record<string, SeasonWindow>;
}

type Geometry = { type: string; coordinates?: unknown };
type ClosureArea = { closure: number; edges: Float64Array; minY: number; maxY: number };

/**
 * Die Sperrgebiete mit ihren Flächen: zuerst die Meere der Tafel `meerSperren` (Flächen der Meerregion
 * dieses Namens), dann die vereisenden Klimazonen in der Reihenfolge der Tafel `vereisung`.
 */
export async function loadSeaClosures(
    database: Queryable,
    model: TravelModel,
    water: NavigableWater,
    // Die Grenze aus den Werten der Ableitung (WI-0153 Schnitt 7a); höchstens SEA_CLOSURE_LIMIT, so das Register.
    limit: number = werte().seaClosureLimit,
): Promise<{ closures: SeaClosure[]; areas: ClosureArea[] }> {
    // Die Fenster je Schiff mit eigenen Wegen im Seegraphen; wer die Wege eines anderen fährt, liest dessen (WI-0069).
    const ships = seaGraphTransports(model);
    const everyShip = (window: SeasonWindow): Record<string, SeasonWindow> =>
        Object.fromEntries(ships.map((ship) => [ship, window]));
    const closures: SeaClosure[] = [];
    const areas: ClosureArea[] = [];
    for (const [region, closure] of Object.entries(model.meerSperren.wert)) {
        const index = closures.length;
        closures.push({ name: region, kind: "meer", reason: closure.grund, windows: everyShip(closure.fenster) });
        for (const area of water.areas) {
            if (area.regionType === "meer" && area.regionName === region) areas.push({ closure: index, ...area });
        }
    }

    const icing = model.vereisung.wert;
    const zones = Object.keys(icing);
    const bands =
        zones.length === 0
            ? []
            : await database<{ zone: string; geometry: string; min_y: number; max_y: number }[]>`
                  SELECT type_key AS zone, ST_AsGeoJSON(geom) AS geometry, ST_YMin(geom) AS min_y, ST_YMax(geom) AS max_y
                  FROM climate_band WHERE type_key IN ${database(zones)} ORDER BY type_key
              `;
    for (const zone of zones) {
        const index = closures.length;
        closures.push({
            name: `Vereisung (${zone})`,
            kind: "vereisung",
            zone,
            reason: "vereisung",
            windows: everyShip(icing[zone] as SeasonWindow),
        });
        for (const band of bands.filter((candidate) => candidate.zone === zone)) {
            areas.push({
                closure: index,
                edges: areaEdges(JSON.parse(band.geometry) as Geometry),
                minY: band.min_y,
                maxY: band.max_y,
            });
        }
    }
    if (closures.length > limit) {
        throw new Error(`${String(closures.length)} Sperrgebiete, gespeichert werden höchstens ${String(limit)}`);
    }
    return { closures, areas };
}

/** Je Zelle des Rasters die Bits der Gebiete, in denen ihre Mitte liegt. */
export function closureCells(
    grid: Pick<SeaGrid, "minX" | "minY" | "cell" | "cols" | "rows">,
    areas: readonly ClosureArea[],
): Uint8Array {
    const cells = new Uint8Array(grid.cols * grid.rows);
    for (const area of areas) {
        const bit = 1 << area.closure;
        forEachCellInside(grid, area, (index) => {
            cells[index] = (cells[index] as number) | bit;
        });
    }
    return cells;
}

/**
 * Wann eine Seereise durch diese Gebiete fährt: der Schnitt ihrer Fenster für ein Schiff. `undefined`
 * heißt immer befahrbar, `null` nie. Zerfällt der Schnitt in zwei Stücke (nur bei Fenstern, die einander
 * nicht mehr überlappen, wie es die heutigen nie tun), gilt das längere - lieber zu viel gesperrt als eine
 * Fahrt übers Eis.
 */
export function combinedWindow(windows: readonly SeasonWindow[]): SeasonWindow | undefined | null {
    if (windows.length === 0) return undefined;
    if (windows.length === 1) return windows[0];
    const open: boolean[] = [];
    for (let day = 1; day <= DAYS_PER_YEAR; day += 1)
        open[day] = windows.every((window) => windowContains(window, day));
    if (open.slice(1).every(Boolean)) return undefined;
    if (!open.slice(1).some(Boolean)) return null;
    // Die Stücke offener Tage, im Kreis: Ein Stück beginnt an einem offenen Tag nach einem gesperrten.
    let best: { from: number; length: number } | null = null;
    for (let day = 1; day <= DAYS_PER_YEAR; day += 1) {
        const before = day === 1 ? DAYS_PER_YEAR : day - 1;
        if (!open[day] || open[before]) continue;
        let length = 0;
        while (open[((day - 1 + length) % DAYS_PER_YEAR) + 1]) length += 1;
        if (!best || length > best.length) best = { from: day, length };
    }
    const { from, length } = best as { from: number; length: number };
    const to = ((from - 1 + length - 1) % DAYS_PER_YEAR) + 1;
    const start = monthDay(from, "from");
    const end = monthDay(to, "to");
    return { from_month: start.month, from_day: start.day, to_month: end.month, to_day: end.day };
}

/** Ein Tag im Jahr als Monat und Tag; ein Namenloser Tag rückt an den Rand des Fensters (1. Praios, 30. Rahja). */
function monthDay(day: number, end: "from" | "to"): { month: string; day: number } {
    const months = CALENDAR_MONTHS.length;
    if (day > months * DAYS_PER_MONTH) {
        return end === "from"
            ? { month: CALENDAR_MONTHS[0], day: 1 }
            : { month: CALENDAR_MONTHS[months - 1] as string, day: DAYS_PER_MONTH };
    }
    return {
        month: CALENDAR_MONTHS[Math.floor((day - 1) / DAYS_PER_MONTH)] as string,
        day: ((day - 1) % DAYS_PER_MONTH) + 1,
    };
}
