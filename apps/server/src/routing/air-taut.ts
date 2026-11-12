import { axisOf } from "./air-field.ts";
import { costAlong, type AirGrid } from "./air-search.ts";

/**
 * Das Straffziehen der Treppe über dem Kostenfeld (WI-0051 F4b): Ein gerades Stück ersetzt die Treppe dazwischen, wenn es nach
 * dem Preis des Felds nicht teurer ist als sie. Wie das Straffziehen über Sperren (`pullTautOverTerrain`), nur dass der Preis
 * an der Achse hängt, auf der ein Stück liegt: Jedes Stück kennt die Achse des Stücks davor (`costAlong`, `fromAxis`) und
 * zahlt das Steigen von deren Stand auf den eigenen. Ohne diese Kosten an den Ecken wäre jede Abkürzung durch einen Berg
 * billig: Sie begänne auf einer Achse, auf der die Bahn schon oben liegt. (Das Straffziehen über Sperren, das auch Ecken an
 * das Gelände rückt, führte mit dem Preis des Felds den Weg um eine Wand quer durch sie: gemessen, deshalb hat das Feld sein
 * eigenes.)
 *
 * - **Von Punkt zu Punkt der Treppe**, in wachsenden Sprüngen und dann halbierend (wie `pullStraight`); der Nachbar auf der
 *   Treppe ist immer erlaubt. Die Achse des zuletzt gewählten Stücks gilt für die nächsten Anfragen von seinem Ende.
 * - **Danach fällt jeder Knick**, bei dem die gerade Linie der Nachbarn samt dem Anschluss an das nächste Stück nicht teurer
 *   ist. Die Knicke an die Ecken des Geländes zu rücken (wie über Sperren) lässt das Feld aus: Das Feilen am Ende (`air-polish.ts`)
 *   rechnet es an der exakten Bahn.
 */

type Point = readonly [number, number];

/** Rundung beim Vergleich zweier Preise. */
const SAME = 1e-9;

export function pullTautOverField(grid: AirGrid, stairs: readonly [number, number][]): [number, number][] {
    if (stairs.length <= 2) return [...stairs];
    const last = stairs.length - 1;
    const point = (index: number): Point => stairs[index] as Point;
    const axisBetween = (from: Point, to: Point): number => axisOf(to[0] - from[0], to[1] - from[1]);
    const along = (a: Point, b: Point, fromAxis: number, enough = Infinity): number =>
        costAlong(grid, a[0], a[1], b[0], b[1], enough, fromAxis);
    // Der Preis der Treppe bis zu jedem Punkt, mit den Kosten der Ecken zwischen ihren Stücken.
    const upTo: number[] = [0];
    const stepAxis: number[] = [];
    for (let index = 1; index <= last; index += 1) {
        const axis = axisBetween(point(index - 1), point(index));
        stepAxis.push(axis);
        const previous = index > 1 ? (stepAxis[index - 2] as number) : -1;
        upTo.push((upTo[index - 1] as number) + along(point(index - 1), point(index), previous));
    }
    const kept = [0];
    let anchor = 0;
    let previousAxis = -1;
    while (anchor < last) {
        // Das erste Stück der Treppe von hier, mit dem Anschluss an das gewählte Stück davor.
        const first = along(point(anchor), point(anchor + 1), previousAxis);
        const clear = (probe: number): boolean => {
            if (probe === anchor + 1) return true;
            const replaced = first + (upTo[probe] as number) - (upTo[anchor + 1] as number) + SAME;
            return along(point(anchor), point(probe), previousAxis, replaced) <= replaced;
        };
        let good = anchor + 1;
        let bad = -1;
        let jump = 1;
        while (bad < 0 && good < last) {
            const probe = Math.min(last, good + jump);
            if (clear(probe)) good = probe;
            else bad = probe;
            jump *= 2;
        }
        while (bad > good + 1) {
            const middle = (good + bad) >> 1;
            if (clear(middle)) good = middle;
            else bad = middle;
        }
        kept.push(good);
        previousAxis = axisBetween(point(anchor), point(good));
        anchor = good;
    }
    const points = kept.map((index) => stairs[index] as [number, number]);
    // Jeder Knick, dessen Nachbarn einander samt Anschluss ebenso ersetzen, fällt.
    for (let changed = true; changed;) {
        changed = false;
        for (let index = 1; index + 1 < points.length; index += 1) {
            const before = points[index - 1] as Point;
            const here = points[index] as Point;
            const after = points[index + 1] as Point;
            const next = points[index + 2] as Point | undefined;
            const entering = index >= 2 ? axisBetween(points[index - 2] as Point, before) : -1;
            const viaHere = axisBetween(before, here);
            const viaAfter = axisBetween(here, after);
            const direct = axisBetween(before, after);
            const two =
                along(before, here, entering) +
                along(here, after, viaHere) +
                (next ? along(after, next, viaAfter) : 0) +
                SAME;
            const one = along(before, after, entering, two) + (next ? along(after, next, direct) : 0);
            if (one <= two) {
                points.splice(index, 1);
                changed = true;
                index -= 1;
            }
        }
    }
    return points;
}
