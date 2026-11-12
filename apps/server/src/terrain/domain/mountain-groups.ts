/**
 * Rechengruppen der Gebirgsinnen-Verfeinerung (WI-0067): 8-zusammenhängende Komponenten der verfeinerbaren
 * Fläche und ihre Vereinigung, wenn sich ihre Halos überlappen können.
 */

export interface Components {
    /** Cells of all components, component after component. */
    cells: Int32Array;
    /** Start of each component in `cells`, plus the end. */
    starts: number[];
}

/** 8-connected components; `mask` is used as visited marker and restored. */
export function components(n: number, mask: Uint8Array): Components {
    let total = 0;
    for (let k = 0; k < mask.length; k++) if (mask[k]) total++;
    const cells = new Int32Array(total);
    const starts: number[] = [];
    const VISITED = 2;
    let end = 0;
    for (let seed = 0; seed < mask.length; seed++) {
        if (mask[seed] !== 1) continue;
        starts.push(end);
        mask[seed] = 1 | VISITED;
        cells[end++] = seed;
        // `cells` doubles as the breadth-first queue of this component.
        for (let head = end - 1; head < end; head++) {
            const k = cells[head]!;
            const x = k % n,
                y = Math.floor(k / n);
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx,
                        ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
                    const nk = ny * n + nx;
                    if (mask[nk] !== 1) continue;
                    mask[nk] = 1 | VISITED;
                    cells[end++] = nk;
                }
        }
    }
    for (let k = 0; k < mask.length; k++) mask[k] = mask[k]! & 1;
    starts.push(end);
    return { cells, starts };
}

/**
 * Components whose halos may overlap (distance ≤ 2 · halo) compute together. With blocks of edge `halo`,
 * two cells that close lie at most two blocks apart; merging all components within ±2 blocks is a superset.
 */
export function groupComponents(n: number, found: Components, halo: number): number[][] {
    const count = found.starts.length - 1;
    const parent = Array.from({ length: count }, (_, i) => i);
    const root = (i: number): number => {
        while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
        return i;
    };
    const blocks = Math.ceil(n / halo);
    const owners = new Map<number, number[]>();
    for (let c = 0; c < count; c++) {
        const seen = new Set<number>();
        for (let i = found.starts[c]!; i < found.starts[c + 1]!; i++) {
            const k = found.cells[i]!;
            const block = Math.floor(Math.floor(k / n) / halo) * blocks + Math.floor((k % n) / halo);
            if (seen.has(block)) continue;
            seen.add(block);
            const list = owners.get(block);
            if (list) list.push(c);
            else owners.set(block, [c]);
        }
    }
    for (const [block, list] of owners) {
        const bx = block % blocks,
            by = Math.floor(block / blocks);
        for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
                if (bx + dx < 0 || by + dy < 0 || bx + dx >= blocks || by + dy >= blocks) continue;
                const other = owners.get((by + dy) * blocks + bx + dx);
                if (!other) continue;
                for (const c of other) parent[root(c)] = root(list[0]!);
            }
    }
    const groups = new Map<number, number[]>();
    for (let c = 0; c < count; c++) {
        const r = root(c);
        const group = groups.get(r);
        if (group) group.push(c);
        else groups.set(r, [c]);
    }
    return [...groups.values()];
}
