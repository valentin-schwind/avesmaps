import {
    catmullRomLine,
    coastProfileOf,
    seaGraphTransports,
    type CatmullConfig,
    type CoastProfile,
    type TravelModel,
} from "@avesmaps3d/shared";
import type { SeaGrid } from "./sea-grid.ts";

/**
 * Küstenfahrt je Schiffstyp (WI-0046, S7, Betreiber 2026-09-27): Schiffe halten einen bevorzugten
 * Abstand zur Küste. Zu nah kostet (Klippen, Brandung), zu weit draußen kostet (die Meere sind
 * gefährlich, Galeeren nur bedingt hochseetauglich). Nur für entfernte Inseln geht es hinaus.
 *
 * - **Der Aufschlag wirkt nur auf die Wegwahl.** Die Reisezeit rechnet mit dem Tempo des Schiffs auf
 *   dem gefahrenen Weg: Wer der Küste folgt, fährt weiter und braucht darum länger.
 * - **Die Werte stehen im Reisemodell** (`kuestenfahrt`, je Seeschiff). Festgelegt werden sie später im
 *   Wege-Editor (Betreiber 2026-09-27).
 */

/**
 * Der bevorzugte Küstenabstand eines Seeschiffs, ein Verweis (`{ wie }`, WI-0069) aufgelöst; ohne Eintrag ist das
 * Reisemodell kaputt, kein Rückfall.
 */
export function coastProfile(model: TravelModel, transport: string): CoastProfile {
    const profile = coastProfileOf(model, transport);
    if (!profile) throw new Error(`Reisemodell ohne Küstenfahrt für ${transport}`);
    return profile;
}

/** Die Seeschiffe mit eigenen Seereisen im Seegraphen (`seaGraphTransports`) und ihrem Küstenabstand. */
export function coastProfiles(model: TravelModel): { transport: string; profile: CoastProfile }[] {
    return seaGraphTransports(model).map((transport) => ({ transport, profile: coastProfile(model, transport) }));
}

/** Was ein Stück Weg in diesem Abstand zur Küste kostet, je Karteneinheit; nie unter 1. */
export function coastFactor(profile: CoastProfile, distance: number): number {
    const tooNear = distance < profile.near ? (profile.near - distance) / profile.near : 0;
    const tooFar = distance > profile.far ? (distance - profile.far) / profile.far : 0;
    return 1 + profile.nearPenalty * tooNear + profile.farPenalty * tooFar;
}

/**
 * Der Abstand jeder Zelle zur nächsten Landzelle, in Karteneinheiten (Chamfer über acht Nachbarn,
 * zwei Durchgänge). Land und Rand tragen 0.
 */
export function coastDistance(grid: SeaGrid): Float32Array {
    const { cols, rows, water, cell } = grid;
    const field = new Float32Array(cols * rows);
    for (let index = 0; index < field.length; index += 1) field[index] = water[index] === 1 ? Infinity : 0;
    const diagonal = Math.SQRT2;
    const relax = (index: number, other: number, step: number): void => {
        const candidate = (field[other] as number) + step;
        if (candidate < (field[index] as number)) field[index] = candidate;
    };
    for (let row = 1; row < rows - 1; row += 1) {
        for (let column = 1; column < cols - 1; column += 1) {
            const index = row * cols + column;
            if (field[index] === 0) continue;
            relax(index, index - 1, 1);
            relax(index, index - cols, 1);
            relax(index, index - cols - 1, diagonal);
            relax(index, index - cols + 1, diagonal);
        }
    }
    for (let row = rows - 2; row > 0; row -= 1) {
        for (let column = cols - 2; column > 0; column -= 1) {
            const index = row * cols + column;
            if (field[index] === 0) continue;
            relax(index, index + 1, 1);
            relax(index, index + cols, 1);
            relax(index, index + cols + 1, diagonal);
            relax(index, index + cols - 1, diagonal);
        }
    }
    for (let index = 0; index < field.length; index += 1) field[index] = (field[index] as number) * cell;
    return field;
}

/** Die Kosten einer Linie unter einem Profil: je Viertelzelle der Aufschlag an dieser Stelle. */
export function lineCost(
    grid: SeaGrid,
    field: Float32Array,
    profile: CoastProfile,
    points: readonly [number, number][],
): number {
    const step = grid.cell * 0.25;
    let cost = 0;
    for (let index = 1; index < points.length; index += 1) {
        const [ax, ay] = points[index - 1] as [number, number];
        const [bx, by] = points[index] as [number, number];
        const length = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(1, Math.ceil(length / step));
        for (let sample = 0; sample < steps; sample += 1) {
            const t = (sample + 0.5) / steps;
            const column = Math.floor((ax + (bx - ax) * t - grid.minX) / grid.cell);
            const row = Math.floor((ay + (by - ay) * t - grid.minY) / grid.cell);
            const distance =
                column < 0 || row < 0 || column >= grid.cols || row >= grid.rows
                    ? 0
                    : (field[row * grid.cols + column] as number);
            cost += (length / steps) * coastFactor(profile, distance);
        }
    }
    return cost;
}

/** Leicht gespannt: rundet die Ecken natürlich ab, ohne weit über die Knoten hinauszuschwingen. */
export const SEA_CATMULL: CatmullConfig = { samples: 6, tension: 0.4 };
/**
 * Wie weit eine Ecke gerundet wird: bis zu 6 E vor und nach ihr, höchstens 45 % jeder Seite - so
 * überlappen die Rundungen zweier Ecken nie; an einem Hafenstück 90 %, dort folgt keine Ecke mehr.
 * Gemessen an Havena - Kuslik (2026-09-27): Gleich dichte Stützpunkte alle 1,5 E rundeten nur auf
 * 1,5 E, in der Übersicht blieben die Ecken hart. Über 300 Seereisen bleiben 17 % der Ecken ungerundet,
 * alle mit Seiten unter 0,5 E: Knicke der A*-Brücken in engen Durchfahrten.
 */
const ROUND_MAX = 6;
const ROUND_SHARE = 0.45;
/** Enger wird nicht gerundet; passt auch das nicht übers Wasser, bleibt die Ecke. */
const ROUND_MIN = 0.1;
/** So dicht wird die Rundung abgetastet, in Karteneinheiten. */
const ROUND_SAMPLE = 0.25;

type LinePoint = [number, number];

/**
 * Die Rundung EINER Ecke `v` zwischen den Seiten `a → v` und `v → b`: Catmull-Rom durch die Schultern
 * `v - r` und `v + r`, die Ecke selbst und je eine Stütze eine Schulter weiter. Die Stützen liegen gleich
 * weit auseinander, darum schlägt die Kurve keine Schleife, und sie läuft tangential in die Seiten ein.
 * Liefert die Punkte von der ersten Schulter bis zur zweiten; `split` ist der Index der Ecke darin.
 */
function roundCorner(
    a: LinePoint,
    v: LinePoint,
    b: LinePoint,
    radius: number,
    config: CatmullConfig,
): { points: LinePoint[]; split: number } {
    const inLength = Math.hypot(v[0] - a[0], v[1] - a[1]);
    const outLength = Math.hypot(b[0] - v[0], b[1] - v[1]);
    const inX = (v[0] - a[0]) / inLength;
    const inY = (v[1] - a[1]) / inLength;
    const outX = (b[0] - v[0]) / outLength;
    const outY = (b[1] - v[1]) / outLength;
    const at = (x: number, y: number): { x: number; y: number } => ({ x, y });
    const supports = [
        at(v[0] - 2 * radius * inX, v[1] - 2 * radius * inY),
        at(v[0] - radius * inX, v[1] - radius * inY),
        at(v[0], v[1]),
        at(v[0] + radius * outX, v[1] + radius * outY),
        at(v[0] + 2 * radius * outX, v[1] + 2 * radius * outY),
    ];
    const samples = Math.max(Math.trunc(config.samples), Math.ceil(radius / ROUND_SAMPLE));
    const curve = catmullRomLine(supports, { samples, tension: config.tension });
    // Nur die beiden mittleren Abschnitte: Schulter - Ecke - Schulter. Der erste Abschnitt endet bei `samples`.
    const points = curve.slice(samples, 3 * samples + 1).map((point): LinePoint => [point.x, point.y]);
    return { points, split: samples };
}

/**
 * Die gezeichnete Linie einer Seereise: jede Ecke mit Catmull-Rom gerundet (`catmullRomLine`, dieselbe
 * Kurve wie bei den Wegen), dazwischen gerade. Die Stücke vom Hafen zur Anlegestelle, erstes und letztes,
 * gehören dazu und dürfen über Land führen; sonst muss die Rundung über Wasser laufen (`clear`: beim
 * Ableiten das Raster, im Worker die Wassermaske des Seegraphen). Täte sie es nicht, wird sie enger
 * versucht; bleibt sie auch bei `ROUND_MIN` nicht über Wasser, bleibt die Ecke (`fallbacks` zählt sie).
 */
export function smoothSeaLine(
    clear: (ax: number, ay: number, bx: number, by: number) => boolean,
    points: readonly LinePoint[],
    config: CatmullConfig = SEA_CATMULL,
): { points: LinePoint[]; fallbacks: number } {
    if (points.length < 3) return { points: [...points], fallbacks: 0 };
    const last = points.length - 1;
    const wet = (line: readonly LinePoint[], from: number, to: number): boolean => {
        for (let index = from + 1; index <= to; index += 1) {
            const [ax, ay] = line[index - 1] as LinePoint;
            const [bx, by] = line[index] as LinePoint;
            if (!clear(ax, ay, bx, by)) return false;
        }
        return true;
    };
    const result: LinePoint[] = [points[0] as LinePoint];
    let fallbacks = 0;
    for (let index = 1; index < last; index += 1) {
        const a = points[index - 1] as LinePoint;
        const v = points[index] as LinePoint;
        const b = points[index + 1] as LinePoint;
        // Am Hafenstück liegt am anderen Ende keine Ecke: Dort darf die Rundung fast die ganze Seite nehmen.
        const share = (portLeg: boolean): number => (portLeg ? 2 * ROUND_SHARE : ROUND_SHARE);
        const widest = Math.min(
            ROUND_MAX,
            share(index - 1 === 0) * Math.hypot(v[0] - a[0], v[1] - a[1]),
            share(index + 1 === last) * Math.hypot(b[0] - v[0], b[1] - v[1]),
        );
        let rounded: LinePoint[] | null = null;
        for (let radius = widest; radius >= ROUND_MIN; radius /= 2) {
            const corner = roundCorner(a, v, b, radius, config);
            // Die Hälfte an einem Hafenstück darf über Land, die andere nicht.
            const inOk = index - 1 === 0 || wet(corner.points, 0, corner.split);
            const outOk = index + 1 === last || wet(corner.points, corner.split, corner.points.length - 1);
            if (inOk && outOk) {
                rounded = corner.points;
                break;
            }
        }
        if (rounded) {
            result.push(...rounded);
        } else {
            fallbacks += 1;
            result.push(v);
        }
    }
    result.push(points[last] as LinePoint);
    return { points: result, fallbacks };
}
