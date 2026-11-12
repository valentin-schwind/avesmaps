import { createHash } from "node:crypto";
import { unionBounds, type DeriveBounds } from "./derive-scope.ts";

/**
 * Welche Kacheln einer Pyramide sich gegenüber einer früheren Revision geändert haben (WI-0059, 4.5), und über
 * welchem Kartenbereich. Ein Vergleich der gespeicherten Bytes, keine Schätzung: Was gleich ist, ist gleich.
 * Das Gelände (I11), das Relief (I12) und später die Anzeigehöhen (I13) melden es gleich, und die nächste Stufe
 * bekommt daraus ihren Bereich (`DeriveScope`).
 */

/** Kantenlänge des Kartenraums in Karteneinheiten (wie das Gitter des Reliefs). */
const MAP_EXTENT = 1024;

export interface TileKey {
    z: number;
    x: number;
    y: number;
}

/** Der Schlüssel einer Kachel im Vergleich. */
export const tileKey = (tile: TileKey): string => `${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;

/** Der Kartenbereich einer Kachel in Karteneinheiten (Zeile 0 im Norden, Süden = kleines y). */
export function tileBounds(z: number, x: number, y: number): DeriveBounds {
    const span = MAP_EXTENT / (1 << z);
    return { minX: x * span, maxX: (x + 1) * span, minY: MAP_EXTENT - (y + 1) * span, maxY: MAP_EXTENT - y * span };
}

/** Der Fingerabdruck einer Kachel für den Vergleich. */
export const tileDigest = (image: Buffer): string => createHash("sha256").update(image).digest("hex");

export interface TileDiff {
    /** Anzahl der Kacheln über alle Stufen, die neu oder anders sind. */
    changed: number;
    /** Der Bereich der geänderten Kacheln der feinsten Stufe; `null`, wenn keine davon sich änderte. */
    bounds: DeriveBounds | null;
    /** Der Bereich jeder geänderten Kachel der feinsten Stufe. */
    finest: DeriveBounds[];
}

/**
 * Vergleicht die neuen Kacheln mit den Fingerabdrücken der früheren (Schlüssel `z/x/y` zu SHA-256 der Bytes).
 * Der Bereich zählt nur die feinste Stufe: Die gröberen mitteln sie und ändern sich mit ihr.
 */
export function diffTiles(
    before: ReadonlyMap<string, string>,
    tiles: readonly (TileKey & { image: Buffer })[],
    finestZoom: number,
): TileDiff {
    let changed = 0;
    let bounds: DeriveBounds | null = null;
    const finest: DeriveBounds[] = [];
    for (const tile of tiles) {
        if (before.get(tileKey(tile)) === tileDigest(tile.image)) continue;
        changed += 1;
        if (tile.z !== finestZoom) continue;
        const b = tileBounds(tile.z, tile.x, tile.y);
        finest.push(b);
        bounds = unionBounds(bounds, b);
    }
    return { changed, bounds, finest };
}
