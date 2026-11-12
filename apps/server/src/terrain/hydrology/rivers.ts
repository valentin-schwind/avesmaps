import { LAKE, MAP_EXTENT, MOUNTAIN, SEA, type Grid } from "./grid.ts";

/**
 * Bekannte Flüsse und Bäche als Zellketten in Fließrichtung (WI-0054). Quelle wie überall: aktive
 * `path` mit `subtype = 'Flussweg'`, samt `is_bach` und `flow_direction`.
 *
 * Die Fließrichtung liest sich wie in V12 (`valleys.ts`): `forward` fließt vom ersten zum letzten
 * Stützpunkt, `reverse` umgekehrt. Ohne Angabe gilt die Regel, die auch das Höhenmodell (WI-0049)
 * nimmt (abgestimmt 2026-09-28), siehe `orientUnknown`.
 */

type Position = [number, number];

export interface RiverRow {
    coordinates: Position[];
    isBach: boolean;
    flowDirection: "forward" | "reverse" | null;
}

export interface RiverChain {
    /** Zellen von der Quelle zur Mündung, ohne Wiederholung aufeinanderfolgender Zellen. */
    cells: Int32Array;
    bach: boolean;
    /** Ohne Richtung in den Daten: bis `orientUnknown` in der Reihenfolge der Geometrie. */
    unknown?: boolean;
}

/** Legt den Lauf in Schritten von einer Drittelzelle ab, damit keine Zelle übersprungen wird. */
function cellsAlong(g: Grid, points: readonly Position[]): number[] {
    const { n, cell } = g;
    const cells: number[] = [];
    const put = (x: number, y: number): void => {
        const gx = Math.min(n - 1, Math.max(0, Math.floor(x / cell)));
        const gy = Math.min(n - 1, Math.max(0, Math.floor((MAP_EXTENT - y) / cell)));
        const k = gy * n + gx;
        if (cells[cells.length - 1] !== k) cells.push(k);
    };
    for (let i = 0; i + 1 < points.length; i += 1) {
        const [ax, ay] = points[i] as Position;
        const [bx, by] = points[i + 1] as Position;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 3)));
        for (let t = 0; t < steps; t += 1) put(ax + ((bx - ax) * t) / steps, ay + ((by - ay) * t) / steps);
    }
    const last = points[points.length - 1];
    if (last) put(last[0], last[1]);
    return cells;
}

/**
 * Die Ketten aller Läufe. Zellen im Meer bleiben in der Kette; wer sie liest, überspringt sie (dort
 * endet der Fluss). Läufe ohne Richtung kommen als `unknown` in der Reihenfolge der Geometrie zurück;
 * `orientUnknown` richtet sie aus.
 */
export function riverChains(g: Grid, rows: readonly RiverRow[]): RiverChain[] {
    const chains: RiverChain[] = [];
    for (const row of rows) {
        let cells = cellsAlong(g, row.coordinates);
        if (cells.length < 2) continue;
        if (row.flowDirection === "reverse") cells = cells.reverse();
        const unknown = row.flowDirection !== "forward" && row.flowDirection !== "reverse";
        chains.push({ cells: Int32Array.from(cells), bach: row.isBach, ...(unknown ? { unknown } : {}) });
    }
    return chains;
}

/**
 * Richtet die Läufe ohne Richtung aus, an Ort und Stelle (WI-0054 und WI-0049, abgestimmt 2026-09-28):
 * (a) Sie erben die Richtung verbundener Läufe mit Richtung: Endet ein Lauf an ihrem einen Ende oder
 *     beginnt einer an ihrem anderen, fließen sie dorthin (Nachbarschaft 3 × 3 Zellen). Das wiederholt
 *     sich, bis nichts mehr dazukommt; widersprechen sich die Nachbarn, entscheidet (b).
 * (b) Sonst von der höheren zur tieferen Stelle an den Enden (`heightAt`, das veröffentlichte Gelände).
 * (c) Bei Gleichstand ist das küstennähere Ende die Mündung.
 */
export function orientUnknown(
    g: Grid,
    chains: RiverChain[],
    coast: Float32Array,
    heightAt: (k: number) => number,
): void {
    const { n } = g;
    const starts = new Map<number, number>();
    const ends = new Map<number, number>();
    const add = (map: Map<number, number>, k: number): void => {
        map.set(k, (map.get(k) ?? 0) + 1);
    };
    const near = (map: Map<number, number>, k: number): boolean => {
        const x = k % n;
        for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
                if (x + dx < 0 || x + dx >= n) continue;
                if (map.has(k + dy * n + dx)) return true;
            }
        }
        return false;
    };
    const decide = (chain: RiverChain, reverse: boolean): void => {
        if (reverse) chain.cells.reverse();
        delete chain.unknown;
        add(starts, chain.cells[0] as number);
        add(ends, chain.cells[chain.cells.length - 1] as number);
    };
    for (const chain of chains) {
        if (chain.unknown) continue;
        add(starts, chain.cells[0] as number);
        add(ends, chain.cells[chain.cells.length - 1] as number);
    }
    for (let changed = true; changed;) {
        changed = false;
        for (const chain of chains) {
            if (!chain.unknown) continue;
            const a = chain.cells[0] as number;
            const b = chain.cells[chain.cells.length - 1] as number;
            const forward = near(ends, a) || near(starts, b);
            const backward = near(ends, b) || near(starts, a);
            if (forward === backward) continue;
            decide(chain, backward);
            changed = true;
        }
    }
    for (const chain of chains) {
        if (!chain.unknown) continue;
        const a = chain.cells[0] as number;
        const b = chain.cells[chain.cells.length - 1] as number;
        const rise = heightAt(b) - heightAt(a);
        decide(chain, Math.abs(rise) > 0.5 ? rise > 0 : (coast[a] as number) < (coast[b] as number));
    }
}

/**
 * Mündungen, die laut Daten nicht ins Meer, in einen See oder in einen anderen Lauf gehen, sondern im
 * Gebirge enden oder höchstens `reach` Zellen davor (Gotjasach an der Roten Sichel, WI-0054 Generator 4).
 * Ohne eigenen Abfluss entwässerte das Routing ihr Tal über irgendeinen Pass, und das Tal stieg zur
 * Mündung hin an. Zurück kommt je solchem Lauf die letzte Zelle vor dem Gebirge. Wo ein Lauf offen im Land
 * endet, bleibt es beim Meer: Das sind meist Lücken in den Daten, und ein Abfluss dort gäbe eine Senke.
 */
export function mouthSinks(g: Grid, chains: readonly RiverChain[], classes: Uint8Array, reach: number): number[] {
    const { n } = g;
    const owner = new Map<number, number>();
    chains.forEach((chain, c) => {
        for (const k of chain.cells) owner.set(k, owner.has(k) && owner.get(k) !== c ? -1 : c);
    });
    const within = (k: number, r: number, test: (nk: number) => boolean): boolean => {
        const x = k % n;
        const y = (k - x) / n;
        for (let dy = -r; dy <= r; dy += 1) {
            for (let dx = -r; dx <= r; dx += 1) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && ny >= 0 && nx < n && ny < n && test(ny * n + nx)) return true;
            }
        }
        return false;
    };
    const sinks: number[] = [];
    chains.forEach((chain, c) => {
        const cells = chain.cells;
        const end = cells[cells.length - 1] as number;
        if ((classes[end] as number) & (SEA | LAKE)) return;
        if (within(end, 1, (nk) => owner.has(nk) && owner.get(nk) !== c)) return;
        let i = cells.length - 1;
        while (i >= 0 && (classes[cells[i] as number] as number) & MOUNTAIN) i -= 1;
        if (i < 0) return;
        const last = cells[i] as number;
        if ((classes[last] as number) & (SEA | LAKE)) return;
        const inside = i < cells.length - 1;
        if (inside || within(last, reach, (nk) => ((classes[nk] as number) & MOUNTAIN) !== 0)) sinks.push(last);
    });
    return sinks;
}
