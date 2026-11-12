import type { TravelModel } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Flüsse und Bäche im Gelände (WI-0030): Wer querfeldein zu einem Kartenpunkt geht, kommt über einen
 * Fluss nicht hinüber und durch einen Bach nur mit Mühe (Legacys `offroad-grid.php`,
 * `avesmapsCollectRouteRiverBarrierLines`, avesmaps@770c80e).
 *
 * - **Ein Fluss ist eine Wand.** Jeder `Flussweg`, der kein Bach ist. Er ist keine Fläche und steht
 *   deshalb nicht im Wasser (`water.ts`) - ohne diese Linien liefe man quer über die Rakula.
 * - **Ein Bach ist eine Furt** (`is_bach`): Er kostet je Querung die Zeit von `bachQuerung.meilen`
 *   offenem Gelände, mal dem Querungsfaktor Strömung / `stroemungsAnker`; ohne Fließrichtung gilt der
 *   Anker. Wer im Bachbett watet, ist dort `watfaktor` mal Querungsfaktor langsamer. Beide Faktoren
 *   enden bei `hoechstens`.
 * - Seewege bleiben draußen: Sie laufen über das Meer, und das ist ohnehin Wasser.
 *
 * Die gerade Sehne fragt `chordCrossesRivers`; das Raster des gebogenen Gangs (`offroad-grid.ts`)
 * holt sich die Linien seiner Kiste über `riverLinesNear`.
 */

type Position = [number, number];

export interface RiverLine {
    coordinates: Position[];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface FordLine extends RiverLine {
    /** Querungsfaktor aus der Strömung: 1 bei Vorgabe-Strömung. */
    factor: number;
    /** Wie viel langsamer man im Bachbett watet: Watfaktor mal Querungsfaktor. */
    wade: number;
}

export interface Rivers {
    walls: RiverLine[];
    fords: FordLine[];
    /** Welche Linien eine Zelle berühren: Wände als Index, Furten als `-1 - Index`. */
    grid: Map<string, number[]>;
}

export const NO_RIVERS: Rivers = { walls: [], fords: [], grid: new Map() };

/** Zellbreite des Suchgitters in Karteneinheiten. */
const GRID_CELL = 16;
const cellKey = (x: number, y: number): string => `${String(x)}:${String(y)}`;

export interface RiverRow {
    coordinates: Position[];
    isBach: boolean;
    flowDirection: "forward" | "reverse" | null;
    flowFactor: number | null;
}

/** Der Querungsfaktor eines Bachs (Legacy `avesmapsOffroadFurtFaktor`): Strömung / Anker, gedeckelt. */
export function fordFactor(model: TravelModel, row: Pick<RiverRow, "flowDirection" | "flowFactor">): number {
    const { stroemungsAnker, hoechstens } = model.bachQuerung.wert;
    if (row.flowDirection === null) return 1;
    // Wie am Fluss: ohne eigenen Faktor die Vorgabe, nie unter 1.
    return Math.min(Math.max(1, row.flowFactor ?? model.stroemungsfaktorVorgabe.wert) / stroemungsAnker, hoechstens);
}

export function prepareRivers(rows: readonly RiverRow[], model: TravelModel): Rivers {
    const { watfaktor, hoechstens } = model.bachQuerung.wert;
    const walls: RiverLine[] = [];
    const fords: FordLine[] = [];
    for (const row of rows) {
        if (row.coordinates.length < 2) continue;
        const xs = row.coordinates.map(([x]) => x);
        const ys = row.coordinates.map(([, y]) => y);
        const line = {
            coordinates: row.coordinates,
            minX: Math.min(...xs),
            minY: Math.min(...ys),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys),
        };
        if (row.isBach) {
            const factor = fordFactor(model, row);
            fords.push({ ...line, factor, wade: Math.min(watfaktor * factor, hoechstens) });
        } else {
            walls.push(line);
        }
    }
    const grid = new Map<string, number[]>();
    const enter = (line: RiverLine, key: number): void => {
        for (let x = Math.floor(line.minX / GRID_CELL); x <= Math.floor(line.maxX / GRID_CELL); x += 1) {
            for (let y = Math.floor(line.minY / GRID_CELL); y <= Math.floor(line.maxY / GRID_CELL); y += 1) {
                const bucket = grid.get(cellKey(x, y)) ?? [];
                bucket.push(key);
                grid.set(cellKey(x, y), bucket);
            }
        }
    };
    walls.forEach((line, index) => enter(line, index));
    fords.forEach((line, index) => enter(line, -1 - index));
    return { walls, fords, grid };
}

/** Schneiden sich die Strecken? Vorzeichen der vier Kreuzprodukte (Legacy `avesmapsRouteSegmentsIntersect`). */
function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
    const side = (p: Position, q: Position, r: Position): number =>
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return side(a, b, c) > 0 !== side(a, b, d) > 0 && side(c, d, a) > 0 !== side(c, d, b) > 0;
}

function lineCrossesChord(line: RiverLine, a: Position, b: Position): boolean {
    const minX = Math.min(a[0], b[0]);
    const maxX = Math.max(a[0], b[0]);
    const minY = Math.min(a[1], b[1]);
    const maxY = Math.max(a[1], b[1]);
    if (line.minX > maxX || line.maxX < minX || line.minY > maxY || line.maxY < minY) return false;
    for (let index = 0; index < line.coordinates.length - 1; index += 1) {
        const c = line.coordinates[index] as Position;
        const d = line.coordinates[index + 1] as Position;
        if (Math.max(c[0], d[0]) < minX || Math.min(c[0], d[0]) > maxX) continue;
        if (Math.max(c[1], d[1]) < minY || Math.min(c[1], d[1]) > maxY) continue;
        if (segmentsIntersect(a, b, c, d)) return true;
    }
    return false;
}

/** Die Linien, deren Gitterzellen das Rechteck berühren, je einmal. */
function candidates(rivers: Rivers, minX: number, minY: number, maxX: number, maxY: number): Set<number> {
    const found = new Set<number>();
    for (let x = Math.floor(minX / GRID_CELL); x <= Math.floor(maxX / GRID_CELL); x += 1) {
        for (let y = Math.floor(minY / GRID_CELL); y <= Math.floor(maxY / GRID_CELL); y += 1) {
            for (const key of rivers.grid.get(cellKey(x, y)) ?? []) found.add(key);
        }
    }
    return found;
}

/**
 * Quert die gerade Sehne einen Fluss oder einen Bach? (Legacy `avesmapsRouteChordCrossesRiver`, für
 * Wand und Furt gefragt.) 🔴 Ein Bach verwirft die Sehne, statt sie zu bepreisen (Entscheidung i): Eine
 * Gerade kann nicht ausweichen - fällt sie weg, wägt die Suche den Umweg gegen die Furt.
 */
export function chordCrossesRivers(x1: number, y1: number, x2: number, y2: number, rivers: Rivers): boolean {
    const a: Position = [x1, y1];
    const b: Position = [x2, y2];
    for (const key of candidates(rivers, Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2))) {
        const line = key >= 0 ? (rivers.walls[key] as RiverLine) : (rivers.fords[-1 - key] as FordLine);
        if (lineCrossesChord(line, a, b)) return true;
    }
    return false;
}

/** Die Wände und Furten, deren Hüllkasten das Rechteck berührt - in fester Reihenfolge. */
export function riverLinesNear(
    rivers: Rivers,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
): { walls: RiverLine[]; fords: FordLine[] } {
    const keys = [...candidates(rivers, minX, minY, maxX, maxY)];
    const touches = (line: RiverLine): boolean =>
        line.minX <= maxX && line.maxX >= minX && line.minY <= maxY && line.maxY >= minY;
    const walls = keys
        .filter((key) => key >= 0)
        .sort((a, b) => a - b)
        .map((key) => rivers.walls[key] as RiverLine)
        .filter(touches);
    const fords = keys
        .filter((key) => key < 0)
        .map((key) => -1 - key)
        .sort((a, b) => a - b)
        .map((index) => rivers.fords[index] as FordLine)
        .filter(touches);
    return { walls, fords };
}

const frozen = new WeakMap<Rivers, Rivers>();

/**
 * Die Flüsse ohne ihre Bäche: Für ein Mittel, dem die Bäche zugefroren sind (`bodenPflicht.baecheGefroren`, der
 * Schlitten auf Schnee, Betreiber 2026-10-03), gibt es keine Furt und kein Waten. Ein Fluss bleibt eine Wand. Einmal je
 * Datenstand gebaut.
 */
export function frozenBrooks(rivers: Rivers): Rivers {
    let result = frozen.get(rivers);
    if (!result) {
        const grid = new Map<string, number[]>();
        for (const [key, lines] of rivers.grid) {
            const walls = lines.filter((line) => line >= 0);
            if (walls.length > 0) grid.set(key, walls);
        }
        result = { walls: rivers.walls, fords: [], grid };
        frozen.set(rivers, result);
    }
    return result;
}

/** Die Flüsse und Bäche der Kartendomäne. */
export async function loadRivers(database: Queryable, mapDomainId: string, model: TravelModel): Promise<Rivers> {
    const rows = await database<
        {
            coordinates: string;
            is_bach: boolean;
            flow_direction: "forward" | "reverse" | null;
            flow_factor: number | null;
        }[]
    >`
        SELECT ST_AsGeoJSON(geom) AS coordinates, is_bach, flow_direction, flow_factor::float8 AS flow_factor
        FROM path
        WHERE map_domain_id = ${mapDomainId} AND is_active AND subtype = 'Flussweg'
        ORDER BY public_id
    `;
    return prepareRivers(
        rows.map((row) => ({
            coordinates: (JSON.parse(row.coordinates) as { coordinates: Position[] }).coordinates,
            isBach: row.is_bach,
            flowDirection: row.flow_direction,
            flowFactor: row.flow_factor,
        })),
        model,
    );
}
