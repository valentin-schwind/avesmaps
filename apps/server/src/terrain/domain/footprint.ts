import type { InputChange } from "./input-index.ts";
import type { TerrainRecipe } from "./recipes.ts";

/**
 * Der Fußabdruck einer lokalen Geländeänderung (JOBS-0001 V1, WI-0125, WI-0223): welche Rechenkacheln (8 × 8 zu je 1024², Index
 * `ty * 8 + tx`, Zeile 0 im Norden, wie `fineTiles`) ein lokaler Job neu rechnet und veröffentlicht.
 *
 * Die Regel aus dem Radius der gültigen Fassung (SYS-0001 §9c.11 Frage 7 B, Betreiber 2026-10-10, mit JOBS-0001 D6 Option A „lokal
 * gleich voll“): je geändertem Objekt die Rechenkacheln, die sein Rahmen vorher oder nachher schneidet, und ein Ring von Kacheln um sie,
 * so breit wie die Reichweite der Rückverteilung je Runde (3 × Radius), auf Kacheln aufgerundet. Bei 16 E ist das ein Ring: 3 × 3
 * Kacheln um ein kleines Objekt (Prototyp D: außerhalb davon ist der volle Lauf bytegleich oder fast). Der Ring deckt zugleich die
 * Reichweite des Anfangsgeländes (bis 100 E, die Kontinentwölbung), das ein lokaler Lauf nur im Fußabdruck neu rechnet. Ausdrücklich
 * genannte Bereiche (`--bounds`) zählen ohne Ring.
 *
 * Bis 2026-10-18 galten eigene Ränder je Art aus R0 (`config/terrain/local-footprint.json`: Gipfel 8 E, Gebirge 64 E), gemessen für
 * die domainweite Rückverteilung von Fassung 17; Frage 7 B ersetzt sie.
 */

export interface Rect {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

const MAP_EXTENT = 1024;

/** Rechenkacheln je Seite: 8 × 8 zu je 1024² im Master 8192² (`fineTiles`, `generator.fine.tiles`). */
export const COMPUTE_TILES_PER_SIDE = 8;

/** Der Ring um die Kacheln einer Änderung in Kacheln: 3 × Radius der Rückverteilung, aufgerundet (bei 16 E einer). */
export function footprintRing(radiusE: number, perSide = COMPUTE_TILES_PER_SIDE): number {
    if (!(radiusE > 0)) throw new RangeError("Der Fußabdruck braucht den Radius einer regionalen Rückverteilung");
    return Math.ceil((3 * radiusE) / (MAP_EXTENT / perSide));
}

/** Der Ring einer Fassung; ohne regionale Rückverteilung (Fassung 17, dort rechnet kein lokaler Job) einer, nur für die Planung. */
export function footprintRingOf(recipe: TerrainRecipe, perSide = COMPUTE_TILES_PER_SIDE): number {
    const uplift = recipe.generator.uplift;
    return uplift?.kind === "regional" ? footprintRing(uplift.radius, perSide) : 1;
}

/** Der Rahmen einer Änderung, vorher und nachher. */
export function changeRect(change: InputChange): Rect | null {
    let rect: Rect | null = null;
    for (const entry of [change.before, change.after]) {
        if (!entry) continue;
        const [, minX, minY, maxX, maxY] = entry;
        rect = rect
            ? {
                  minX: Math.min(rect.minX, minX),
                  minY: Math.min(rect.minY, minY),
                  maxX: Math.max(rect.maxX, maxX),
                  maxY: Math.max(rect.maxY, maxY),
              }
            : { minX, minY, maxX, maxY };
    }
    return rect;
}

/** Der Kartenbereich einer Rechenkachel (Zeile 0 im Norden). */
export function computeTileBounds(index: number, perSide = COMPUTE_TILES_PER_SIDE): Rect {
    const span = MAP_EXTENT / perSide;
    const tx = index % perSide;
    const ty = Math.floor(index / perSide);
    return { minX: tx * span, maxX: (tx + 1) * span, minY: MAP_EXTENT - (ty + 1) * span, maxY: MAP_EXTENT - ty * span };
}

/** Die Rechenkacheln, die eines der Rechtecke schneiden (auf ganze Kacheln aufgerundet), aufsteigend. */
export function computeTilesOf(rects: readonly Rect[], perSide = COMPUTE_TILES_PER_SIDE): number[] {
    // Echt schneiden: Ein Rechteck, das nur an der Kante endet, nimmt die Nachbarkachel nicht mit. Ein Punkt (ein Gipfel ohne Rand)
    // liegt in seiner Kachel, auf einer Kante in beiden.
    const axis = (min: number, max: number, from: number, to: number): boolean =>
        min === max ? from <= min && min <= to : min < to && from < max;
    const tiles: number[] = [];
    for (let index = 0; index < perSide * perSide; index += 1) {
        const tile = computeTileBounds(index, perSide);
        if (
            rects.some(
                (rect) =>
                    axis(rect.minX, rect.maxX, tile.minX, tile.maxX) &&
                    axis(rect.minY, rect.maxY, tile.minY, tile.maxY),
            )
        )
            tiles.push(index);
    }
    return tiles;
}

/** Die Kacheln samt `ring` Kacheln Abstand (in beide Richtungen, auch schräg), an der Karte beschnitten, aufsteigend. */
export function growTiles(tiles: Iterable<number>, ring: number, perSide = COMPUTE_TILES_PER_SIDE): number[] {
    const grown = new Set<number>();
    for (const tile of tiles) {
        const tx = tile % perSide;
        const ty = Math.floor(tile / perSide);
        for (let dy = -ring; dy <= ring; dy += 1)
            for (let dx = -ring; dx <= ring; dx += 1)
                if (tx + dx >= 0 && ty + dy >= 0 && tx + dx < perSide && ty + dy < perSide)
                    grown.add((ty + dy) * perSide + tx + dx);
    }
    return [...grown].sort((a, b) => a - b);
}

export interface Footprint {
    /** Die Rahmen der Änderungen (ohne Ring) und die ausdrücklichen Bereiche. */
    rects: Rect[];
    tiles: number[];
}

/** Der Fußabdruck nach Frage 7 B: `ring` aus `footprintRing(radius)`. */
export function footprintOf(
    changes: readonly InputChange[],
    ring: number,
    extra: readonly Rect[] = [],
    perSide = COMPUTE_TILES_PER_SIDE,
): Footprint {
    const rects = changes.map(changeRect).filter((rect) => rect !== null);
    const tiles = new Set([
        ...growTiles(computeTilesOf(rects, perSide), ring, perSide),
        ...computeTilesOf(extra, perSide),
    ]);
    return { rects: [...rects, ...extra], tiles: [...tiles].sort((a, b) => a - b) };
}
