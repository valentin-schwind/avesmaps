import { werte } from "./einstellungen.ts";
import { STEP_FLOATS, type SlopeSums } from "./slope.ts";

export type ProfilePoint = [distance: number, height: number | null];

/**
 * Wie viele Profilpunkte ein Abschnitt höchstens trägt: bis 256, bei langen Routen weniger, damit die Antwort
 * auch dann klein bleibt (rund 8.192 Punkte je Linie für die ganze Route, nie unter 6 je Abschnitt).
 */
export function profilePointLimit(segmentCount: number): number {
    return Math.max(6, Math.min(256, Math.floor(8192 / Math.max(1, segmentCount))));
}

/** Bounded envelope: retain each bucket's endpoints/extrema, but never draw across an unknown height. */
export function compactProfile(points: readonly ProfilePoint[], limit = 256): ProfilePoint[] {
    if (points.length <= limit) return points.map(([x, y]) => [x, y]);
    const buckets = Math.max(1, Math.floor(limit / 6));
    const width = Math.ceil(points.length / buckets);
    const result: ProfilePoint[] = [];
    for (let start = 0; start < points.length; start += width) {
        const end = Math.min(points.length - 1, start + width - 1);
        const indices = new Set([start, end]);
        let low = start;
        let high = start;
        let gap = false;
        for (let i = start; i <= end; i++) {
            const height = points[i]![1];
            if (height === null) gap = true;
            else {
                if (points[low]![1] === null || height < points[low]![1]!) low = i;
                if (points[high]![1] === null || height > points[high]![1]!) high = i;
            }
        }
        if (gap) {
            // Preserve extrema as isolated points; never imply coverage through a gap.
            result.push([points[start]![0], null]);
            for (const i of [...new Set([low, high])].sort((a, b) => a - b)) {
                if (points[i]![1] !== null) result.push([...points[i]!], [points[i]![0], null]);
            }
            result.push([points[end]![0], null]);
        } else {
            indices.add(low);
            indices.add(high);
            for (const i of [...indices].sort((a, b) => a - b)) result.push([...points[i]!]);
        }
    }
    return result;
}

/** Read the actual sampled step heights, clipping split links and reversing travel direction. */
export function pathElevationProfile(
    slope: SlopeSums | undefined,
    forward: boolean,
    distance: number,
    span?: { from: number; to: number },
): ProfilePoint[] {
    const steps = slope?.steps;
    if (!steps || !(distance > 0)) return [];
    // Derselbe Maßstab, mit dem das Netz die Abtastschritte gelegt hat (`network.ts`, WI-0214); vorher die Konstante.
    const schritt = werte().schrittPerUnit;
    const from = (span?.from ?? 0) * schritt;
    const to = (span?.to ?? distance) * schritt;
    const points: ProfilePoint[] = [];
    let previousEnd = from;
    for (let i = 0; i + STEP_FLOATS <= steps.length; i += STEP_FLOATS) {
        const rise = steps[i]!;
        const run = steps[i + 1]!;
        const height = steps[i + 3]!;
        const offset = steps[i + 4]!;
        if (!(run > 0)) continue;
        const left = Math.max(from, offset);
        const right = Math.min(to, offset + run);
        if (right <= left) continue;
        if (left - previousEnd > 0.01) points.push([(previousEnd - from) / schritt, null]);
        for (const at of [left, right]) {
            const x = (at - from) / schritt;
            const y = height + rise * ((at - offset) / run);
            const last = points[points.length - 1];
            if (!last || last[0] !== x || last[1] !== y) points.push([x, y]);
        }
        previousEnd = right;
    }
    if (previousEnd < to) points.push([(to - from) / schritt, null]);
    const directed: ProfilePoint[] = forward ? points : points.reverse().map(([x, y]) => [distance - x, y]);
    return compactProfile(directed);
}
