import type { TerritoryEntry } from "./route-landscapes";

export interface TerritoryRow {
    entry: TerritoryEntry;
    depth: number;
}

/** Only encountered territories; siblings retain their first-encounter order. */
export function territoryHierarchy(stages: readonly (readonly TerritoryEntry[])[]): TerritoryRow[] {
    const entries = new Map<string, TerritoryEntry>();
    for (const stage of stages) {
        for (const entry of stage) {
            if (!entries.has(entry.id)) entries.set(entry.id, entry);
        }
    }
    const children = new Map<string, TerritoryEntry[]>();
    const roots: TerritoryEntry[] = [];
    for (const entry of entries.values()) {
        if (entry.parentId && entry.parentId !== entry.id && entries.has(entry.parentId)) {
            const siblings = children.get(entry.parentId) ?? [];
            siblings.push(entry);
            children.set(entry.parentId, siblings);
        } else {
            roots.push(entry);
        }
    }
    const rows: TerritoryRow[] = [];
    const seen = new Set<string>();
    // Remaining entries also seed traversal so malformed cycles cannot hide a territory.
    for (const root of [...roots, ...entries.values()]) {
        const pending: TerritoryRow[] = [{ entry: root, depth: 0 }];
        while (pending.length > 0) {
            const row = pending.pop()!;
            if (seen.has(row.entry.id)) continue;
            seen.add(row.entry.id);
            rows.push(row);
            const descendants = children.get(row.entry.id) ?? [];
            for (let index = descendants.length - 1; index >= 0; index--) {
                pending.push({ entry: descendants[index]!, depth: row.depth + 1 });
            }
        }
    }
    return rows;
}
