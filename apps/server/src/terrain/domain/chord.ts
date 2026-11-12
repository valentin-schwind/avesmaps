import { domainHeightAt, type DomainHeightSource } from "./read.ts";

type Point = { x: number; y: number };

/** A bilinear patch restricted to a straight chord is quadratic: inspect its endpoints and interior maximum. */
export function domainChordAbove(source: DomainHeightSource, from: Point, to: Point, limit: number): boolean {
    const r = source.raster;
    const cuts = [0, 1];
    const addCrossings = (start: number, end: number, origin: number, count: number): void => {
        if (start === end) return;
        const first = Math.max(0, Math.ceil((Math.min(start, end) - origin) / r.cell));
        const last = Math.min(count - 1, Math.floor((Math.max(start, end) - origin) / r.cell));
        for (let index = first; index <= last; index++) {
            const fraction = (origin + index * r.cell - start) / (end - start);
            if (fraction > 0 && fraction < 1) cuts.push(fraction);
        }
    };
    addCrossings(from.x, to.x, r.originX, r.width);
    addCrossings(from.y, to.y, r.originY, r.height);
    cuts.sort((a, b) => a - b);
    const height = (fraction: number): number =>
        domainHeightAt(source, from.x + (to.x - from.x) * fraction, from.y + (to.y - from.y) * fraction);
    const threshold = Math.max(0, limit) + 1e-6;
    let left = height(0);
    if (left > threshold) return true;
    for (let index = 1; index < cuts.length; index++) {
        const a = cuts[index - 1]!,
            b = cuts[index]!;
        if (a === b) continue;
        const right = height(b);
        if (right > threshold) return true;
        const middle = height((a + b) / 2);
        const quadratic = 2 * (left + right - 2 * middle);
        const linear = right - left - quadratic;
        if (quadratic < 0) {
            const vertex = -linear / (2 * quadratic);
            if (vertex > 0 && vertex < 1 && left + linear * vertex + quadratic * vertex ** 2 > threshold) return true;
        }
        left = right;
    }
    return false;
}
