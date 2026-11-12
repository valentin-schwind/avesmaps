import type { TravelModel } from "@avesmaps3d/shared";
import type { Ground, GroundArea } from "./ground.ts";
import { chordCrossesMountain, KIND_MOUNTAIN, reliefAt, type TerrainHeights } from "./relief.ts";
import { areasNear, indexAreas, lineIntervals, pointInEdges, SHORE_TOLERANCE } from "./water.ts";

/**
 * Wohin Wagen nicht querfeldein kommen (WI-0258, Betreiber 2026-10-29, E2 und S-6): Karren, Fuhrwerk und Kutsche
 * (`querfeldeinFahrzeuge.reisemittel`) fahren abseits der Wege nur über offenes Land, Tundra und Hochebenen. Gesperrt sind
 *
 * - die Landschaftsflächen des Bodens (`ground.ts`: Wald, Sumpf, Dschungel, Urwald, Wüste, Schlucht, Flussdelta, Wadi,
 *   Auenlandschaft), deren Art nicht unter `offeneLandschaften` steht - sie tragen ihre Art als `type`; Tundra hat Faktor 1
 *   und steht gar nicht erst im Boden,
 * - mit `gebirge` die Gebirgsflächen (`relief.ts`, `KIND_MOUNTAIN`); einzelne Berge (`KIND_PEAK`) bleiben befahrbar und
 *   kosten Steigung.
 *
 * 🔴 EINE Stelle für alle: Das Raster des gesuchten Gangs (`blockedPlane`), die geraden Verbindungen - Anker, Kartenpunkte,
 * Brücken des Netzes - und die Frage, ob ein Kartenpunkt überhaupt erreichbar ist, lesen diese Sperre. Sie ist wie das
 * Wasser eine Wand, nur ohne Küstenregel: Das Freiräumen am Ufer (`freeAround`) öffnet sie nie.
 *
 * `IMPLEMENTATION DETAIL`: An den Enden einer Sehne zählen `SHORE_TOLERANCE` (eine Rasterzelle) nicht, wie am Ufer: Ein Ort,
 * dessen Zeichnung den Waldrand streift, bleibt Ausgangspunkt. Ohne Höhenmodell kennt die Sperre kein Gebirge.
 */

export interface VehicleBarrier {
    /** Die gesperrten Landschaftsflächen des Bodens. */
    areas: GroundArea[];
    grid: Map<string, number[]>;
    /** Das Gelände, aus dem die Gebirgsflächen kommen; null, wo das Gebirge nicht sperrt oder kein Gelände geladen ist. */
    mountains: TerrainHeights | null;
}

/** Wie weit an den Enden einer Sehne die Sperre nicht zählt: eine Rasterzelle, wie am Ufer. */
export const BARRIER_TOLERANCE = SHORE_TOLERANCE;

const known = new WeakMap<
    Ground,
    { model: TravelModel; terrain: TerrainHeights | null; barrier: VehicleBarrier | null }
>();

/**
 * Die Sperre für dieses Landmittel; null, wenn es keine hat (jedes Mittel außer den Wagen) oder nichts sperrt. Einmal je
 * Datenstand gebaut (die Flächen und ihr Gitter hängen am Boden), nicht je Anfrage.
 */
export function vehicleBarrier(
    model: TravelModel,
    transport: string,
    ground: Ground,
    terrain: TerrainHeights | null | undefined,
): VehicleBarrier | null {
    const rule = model.querfeldeinFahrzeuge.wert;
    if (!rule.reisemittel.includes(transport)) return null;
    const mountains = rule.gebirge ? (terrain ?? null) : null;
    const cached = known.get(ground);
    if (cached && cached.model === model && cached.terrain === mountains) return cached.barrier;
    const areas = ground.areas.filter((area) => !rule.offeneLandschaften.includes(area.type));
    const barrier = areas.length === 0 && mountains === null ? null : { areas, grid: indexAreas(areas), mountains };
    known.set(ground, { model, terrain: mountains, barrier });
    return barrier;
}

/**
 * Läuft die gerade Sehne durch gesperrtes Land? Die Stücke an den Enden (`BARRIER_TOLERANCE`) zählen nicht; was übrig
 * bleibt, ist eine Querung. Wie `chordCrossesWater`.
 */
export function barrierBlocksChord(barrier: VehicleBarrier, x1: number, y1: number, x2: number, y2: number): boolean {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const low = BARRIER_TOLERANCE;
    const high = length - BARRIER_TOLERANCE;
    if (high <= low) return false;
    if (barrier.areas.length > 0) {
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        const chord: [number, number][] = [
            [x1, y1],
            [x2, y2],
        ];
        for (const index of areasNear(barrier.grid, minX, minY, maxX, maxY)) {
            const area = barrier.areas[index] as GroundArea;
            if (area.minX > maxX || area.maxX < minX || area.minY > maxY || area.maxY < minY) continue;
            for (const interval of lineIntervals(chord, area.edges)) {
                if (Math.min(interval.exit, high) > Math.max(interval.enter, low)) return true;
            }
        }
    }
    return (
        barrier.mountains !== null && chordCrossesMountain(barrier.mountains, { x: x1, y: y1 }, { x: x2, y: y2 }, low)
    );
}

/** Liegt der Punkt in gesperrtem Land? Dann kommt kein Wagen hin, auch nicht über die Zelle des Punkts selbst. */
export function barrierContainsPoint(barrier: VehicleBarrier, x: number, y: number): boolean {
    for (const index of areasNear(barrier.grid, x, y, x, y)) {
        const area = barrier.areas[index] as GroundArea;
        if (area.minX > x || area.maxX < x || area.minY > y || area.maxY < y) continue;
        if (pointInEdges(x, y, area.edges)) return true;
    }
    return barrier.mountains !== null && reliefAt(barrier.mountains, x, y).kind === KIND_MOUNTAIN;
}
