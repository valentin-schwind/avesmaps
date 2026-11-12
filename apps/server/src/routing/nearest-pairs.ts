import type { RouteNode } from "./network.ts";

/**
 * Die nächsten Paare zwischen einem abgetrennten Netzteil und dem Hauptnetz (Brücken, `route-graph.ts`).
 *
 * 🔴 Das Ergebnis ist Legacys Reihenfolge, Zahl für Zahl: die `limit` kleinsten Abstände, aufsteigend; gleich weite
 * Paare behalten die Reihenfolge, in der die zwei Schleifen sie sehen (erst der Index im Netzteil, dann der im
 * Hauptnetz). Paar 0 ist genau das, das eine Suche nach dem einen nächsten fände.
 *
 * Gerechnet wird gegen ein Gitter über dem Hauptnetz statt gegen jeden seiner Knoten (WI-0117): Mit 1.800 abgetrennten
 * Teilen und 6.000 Knoten im Hauptnetz waren das 13 Millionen Paare je Graph, das Hauptstück der ersten Route eines
 * neuen Profils. Das Gitter ändert nichts am Ergebnis: Es grenzt nur ein, wo gesucht wird; `squared`, der Vergleich und
 * die Reihenfolge bei Gleichstand sind die der Schleife.
 */

export interface Pair {
    from: RouteNode;
    to: RouteNode;
    /** Das Quadrat des Abstands. */
    distance: number;
}

/** Bis zu so vielen Paaren (Netzteil mal Hauptnetz) lohnt das Gitter nicht; dort rechnet die einfache Schleife. */
const GRID_THRESHOLD = 512;
/** Wie viele Knoten eine Gitterzelle im Mittel trägt. */
const PER_CELL = 4;
/** Das Gitter hat höchstens so viele Zellen. */
const MAX_CELLS = 1 << 18;

/** Die Knoten des Hauptnetzes in einem Gitter; einmal je Netz gebaut, für alle Netzteile benutzt. */
export interface NodeGrid {
    nodes: readonly RouteNode[];
    minX: number;
    minY: number;
    cell: number;
    cols: number;
    rows: number;
    /** Je Zelle die Indizes ihrer Knoten in `nodes`, aufsteigend (CSR: `start`, `items`). */
    start: Int32Array;
    items: Int32Array;
}

export function buildNodeGrid(nodes: readonly RouteNode[]): NodeGrid {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
        if (node.x < minX) minX = node.x;
        if (node.x > maxX) maxX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.y > maxY) maxY = node.y;
    }
    if (nodes.length === 0) {
        return {
            nodes,
            minX: 0,
            minY: 0,
            cell: 1,
            cols: 1,
            rows: 1,
            start: new Int32Array(2),
            items: new Int32Array(),
        };
    }
    const width = Math.max(maxX - minX, 1e-6);
    const height = Math.max(maxY - minY, 1e-6);
    let cell = Math.sqrt((width * height * PER_CELL) / nodes.length);
    // Eine schmale Verteilung (alle Knoten auf einer Linie) hätte sonst zu viele leere Zellen.
    cell = Math.max(cell, Math.max(width, height) / 512, 1e-6);
    let cols = Math.floor(width / cell) + 1;
    let rows = Math.floor(height / cell) + 1;
    while (cols * rows > MAX_CELLS) {
        cell *= 2;
        cols = Math.floor(width / cell) + 1;
        rows = Math.floor(height / cell) + 1;
    }
    const cellOf = (node: RouteNode): number =>
        Math.floor((node.y - minY) / cell) * cols + Math.floor((node.x - minX) / cell);
    const start = new Int32Array(cols * rows + 1);
    for (const node of nodes) start[cellOf(node) + 1] = (start[cellOf(node) + 1] as number) + 1;
    for (let index = 0; index < cols * rows; index += 1) {
        start[index + 1] = (start[index + 1] as number) + (start[index] as number);
    }
    const items = new Int32Array(nodes.length);
    const fill = start.slice(0, cols * rows);
    nodes.forEach((node, index) => {
        const at = cellOf(node);
        items[fill[at] as number] = index;
        fill[at] = (fill[at] as number) + 1;
    });
    return { nodes, minX, minY, cell, cols, rows, start, items };
}

/** Der Kandidat in `into` (aufsteigend nach Abstand, dann Index), höchstens `limit` Stück. */
interface Candidate {
    squared: number;
    index: number;
}

/**
 * Die `limit` nächsten Knoten des Gitters zu `from`, nach (Abstand, Index) geordnet. Ring für Ring um die Zelle von
 * `from`; nach Ring r liegt jeder noch nicht gesehene Knoten weiter als r Zellbreiten entfernt, und die Suche hört auf,
 * wenn der `limit`-te Abstand darunter liegt - bei Gleichstand wird weiter gesucht, denn ein gleich weiter Knoten mit
 * kleinerem Index gewänne.
 */
function nearestInGrid(from: RouteNode, grid: NodeGrid, limit: number): Candidate[] {
    const { nodes, minX, minY, cell, cols, rows, start, items } = grid;
    const found: Candidate[] = [];
    const column = Math.floor((from.x - minX) / cell);
    const row = Math.floor((from.y - minY) / cell);
    // Die Ringe, in denen überhaupt Zellen des Gitters liegen: ein Knoten weit außerhalb beginnt erst dort (sonst liefe die
    // Suche durch Millionen leerer Ringe, wenn das Hauptnetz auf einen Punkt zusammenfällt und die Zellen winzig sind).
    const gapColumn = column < 0 ? -column : Math.max(0, column - (cols - 1));
    const gapRow = row < 0 ? -row : Math.max(0, row - (rows - 1));
    const first = Math.max(gapColumn, gapRow);
    const last = Math.max(Math.abs(column), Math.abs(cols - 1 - column), Math.abs(row), Math.abs(rows - 1 - row));
    const visit = (c: number, r: number): void => {
        const at = r * cols + c;
        for (let item = start[at] as number; item < (start[at + 1] as number); item += 1) {
            const index = items[item] as number;
            const to = nodes[index] as RouteNode;
            const dx = from.x - to.x;
            const dy = from.y - to.y;
            const squared = dx * dx + dy * dy;
            if (found.length >= limit) {
                const worst = found[found.length - 1] as Candidate;
                if (squared > worst.squared || (squared === worst.squared && index > worst.index)) continue;
            }
            let position = found.length;
            while (
                position > 0 &&
                ((found[position - 1] as Candidate).squared > squared ||
                    ((found[position - 1] as Candidate).squared === squared &&
                        (found[position - 1] as Candidate).index > index))
            ) {
                position -= 1;
            }
            found.splice(position, 0, { squared, index });
            if (found.length > limit) found.pop();
        }
    };
    /** Die Zellen einer Zeile oder Spalte des Rings, soweit sie im Gitter liegen. */
    const visitRow = (r: number, c0: number, c1: number): void => {
        if (r < 0 || r >= rows) return;
        for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c += 1) visit(c, r);
    };
    const visitColumn = (c: number, r0: number, r1: number): void => {
        if (c < 0 || c >= cols) return;
        for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r += 1) visit(c, r);
    };
    for (let ring = first; ring <= last; ring += 1) {
        if (ring === 0) visitRow(row, column, column);
        else {
            visitRow(row - ring, column - ring, column + ring);
            visitRow(row + ring, column - ring, column + ring);
            visitColumn(column - ring, row - ring + 1, row + ring - 1);
            visitColumn(column + ring, row - ring + 1, row + ring - 1);
        }
        if (found.length >= limit) {
            // Eine Spanne Sicherheit gegen die Rundung der Zellnummer.
            const reach = Math.max(0, ring * cell - 1e-6);
            if ((found[found.length - 1] as Candidate).squared <= reach * reach) break;
        }
    }
    return found;
}

/** Die einfache Schleife über alle Paare - die Vorschrift, an der das Gitter gemessen wird. */
export function nearestPairsByLoop(detached: readonly RouteNode[], main: readonly RouteNode[], limit: number): Pair[] {
    const pairs: Pair[] = [];
    let worst = Infinity;
    for (const from of detached) {
        for (const to of main) {
            const dx = from.x - to.x;
            const dy = from.y - to.y;
            const squared = dx * dx + dy * dy;
            if (pairs.length >= limit && squared >= worst) continue;
            let position = pairs.length;
            while (position > 0 && (pairs[position - 1] as Pair).distance > squared) position -= 1;
            pairs.splice(position, 0, { from, to, distance: squared });
            if (pairs.length > limit) pairs.pop();
            worst = (pairs[pairs.length - 1] as Pair).distance;
        }
    }
    return pairs;
}

/**
 * Die `limit` nächsten Paare zwischen einem Netzteil und dem Hauptnetz, aufsteigend. Gleich weite behalten ihre
 * Reihenfolge - Paar 0 ist genau das, das eine Suche nach dem einen nächsten fände. `grid` ist das Gitter über `main`
 * (`buildNodeGrid`); ohne es oder bei wenigen Paaren rechnet die Schleife.
 */
export function nearestPairs(
    detached: readonly RouteNode[],
    main: readonly RouteNode[],
    limit: number,
    grid?: NodeGrid,
): Pair[] {
    if (limit < 1) return [];
    if (!grid || detached.length * main.length <= GRID_THRESHOLD) return nearestPairsByLoop(detached, main, limit);
    // Jedes Paar der Gesamtliste steht auch in der Liste seines Netzknotens: Wer `limit` Paare mit demselben `from`
    // vor sich hat, steht nicht unter den ersten `limit` insgesamt.
    const all: { squared: number; from: number; to: number }[] = [];
    detached.forEach((from, fromIndex) => {
        for (const candidate of nearestInGrid(from, grid, limit)) {
            all.push({ squared: candidate.squared, from: fromIndex, to: candidate.index });
        }
    });
    all.sort((a, b) => a.squared - b.squared || a.from - b.from || a.to - b.to);
    return all.slice(0, limit).map((entry) => ({
        from: detached[entry.from] as RouteNode,
        to: main[entry.to] as RouteNode,
        distance: entry.squared,
    }));
}
