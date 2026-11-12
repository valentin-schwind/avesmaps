/**
 * Werkzeuge der Seerouting-Messung (WI-0046, `sea-parity-cli.ts`): ein kleiner Heap, ein schneller
 * Punkt-in-Fläche-Test für viele Proben, ein reproduzierbarer Zufall und die Zahlenformen des Berichts.
 */

/** Ein Heap aus (Schlüssel, Knoten) mit verspätetem Löschen; bei gleichem Schlüssel der kleinere Knoten. */
export class MinQueue {
    private readonly items: [number, string][] = [];

    get size(): number {
        return this.items.length;
    }

    push(key: number, id: string): void {
        const items = this.items;
        items.push([key, id]);
        let position = items.length - 1;
        while (position > 0) {
            const parent = (position - 1) >> 1;
            if (!MinQueue.before(items[position] as [number, string], items[parent] as [number, string])) break;
            [items[position], items[parent]] = [items[parent] as [number, string], items[position] as [number, string]];
            position = parent;
        }
    }

    pop(): string {
        const items = this.items;
        const top = items[0] as [number, string];
        const last = items.pop() as [number, string];
        if (items.length > 0) {
            items[0] = last;
            let position = 0;
            for (;;) {
                let child = 2 * position + 1;
                if (child >= items.length) break;
                const right = items[child + 1];
                if (right && MinQueue.before(right, items[child] as [number, string])) child += 1;
                if (!MinQueue.before(items[child] as [number, string], items[position] as [number, string])) break;
                [items[position], items[child]] = [
                    items[child] as [number, string],
                    items[position] as [number, string],
                ];
                position = child;
            }
        }
        return top[1];
    }

    private static before(a: [number, string], b: [number, string]): boolean {
        return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    }
}

/**
 * Punkt in Fläche, schnell für viele Proben: je Streifen von einer halben Einheit Höhe die Kanten, die
 * ihn berühren, mit ihrer Fläche. Derselbe Strahltest wie `areasContainPoint`; der aber fragt beim
 * Kontinent jede seiner Kanten, und der Vergleich stellt Millionen Proben.
 */
export class Bands {
    private static readonly HEIGHT = 0.5;
    private readonly bands = new Map<number, number[]>();

    constructor(areas: readonly { edges: Float64Array }[]) {
        areas.forEach((area, number) => {
            const edges = area.edges;
            for (let offset = 0; offset < edges.length; offset += 4) {
                const y1 = edges[offset + 1] as number;
                const y2 = edges[offset + 3] as number;
                if (y1 === y2) continue;
                const last = Math.floor(Math.max(y1, y2) / Bands.HEIGHT);
                for (let band = Math.floor(Math.min(y1, y2) / Bands.HEIGHT); band <= last; band += 1) {
                    const list = this.bands.get(band) ?? [];
                    list.push(number, edges[offset] as number, y1, edges[offset + 2] as number, y2);
                    this.bands.set(band, list);
                }
            }
        });
    }

    contains(x: number, y: number): boolean {
        const list = this.bands.get(Math.floor(y / Bands.HEIGHT));
        if (!list) return false;
        const odd = new Set<number>();
        for (let offset = 0; offset < list.length; offset += 5) {
            const y1 = list[offset + 2] as number;
            const y2 = list[offset + 4] as number;
            if (y1 > y === y2 > y) continue;
            const x1 = list[offset + 1] as number;
            const x2 = list[offset + 3] as number;
            if (x1 + ((y - y1) / (y2 - y1)) * (x2 - x1) <= x) continue;
            const area = list[offset] as number;
            if (odd.has(area)) odd.delete(area);
            else odd.add(area);
        }
        return odd.size > 0;
    }
}

/** Ein kleiner, reproduzierbarer Zufall (mulberry32). */
export function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const quantile = (list: readonly number[], q: number): number => {
    const sorted = [...list].sort((a, b) => a - b);
    return sorted.length === 0 ? NaN : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};
export const fixed = (value: number, digits = 1): string => (Number.isFinite(value) ? value.toFixed(digits) : "–");
export const pct = (value: number): string => (Number.isFinite(value) ? `${(100 * value).toFixed(1)} %` : "–");
export const count = <T>(list: readonly T[], test: (item: T) => boolean): number => list.filter(test).length;
