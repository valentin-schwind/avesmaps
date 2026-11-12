import type { CurvePoint } from "./catmull-rom.ts";

/** Chaikin corner rounding; callers that need obstacle safety must verify the resulting segments. */
export function roundCorners(points: readonly CurvePoint[], times: number): CurvePoint[] {
    let line = points.map((point) => ({ x: point.x, y: point.y }));
    if (line.length < 3) return line;
    for (let round = 0; round < times; round += 1) {
        const next: CurvePoint[] = [line[0] as CurvePoint];
        for (let index = 0; index + 1 < line.length; index += 1) {
            const a = line[index] as CurvePoint;
            const b = line[index + 1] as CurvePoint;
            if (index > 0) next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
            if (index + 2 < line.length) next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
        }
        next.push(line[line.length - 1] as CurvePoint);
        line = next;
    }
    return line;
}

/** Teilstücke je gerundeter Ecke, wenn der Aufrufer nichts anderes nennt. */
export const ROUNDED_CORNER_SEGMENTS = 16;
/** Um diesen Faktor wird eine Rundung enger, solange sie nicht frei bleibt. */
const NARROWER = 0.8;
/** Enger als dieser Anteil der vollen Rundung wird nicht mehr versucht; dann bleibt die Ecke. */
const NARROWEST = 0.05;
/** Ein Knick, der kleiner ist als dieser Sinus, ist keine Ecke (gerade weiter oder zurück). */
const STRAIGHT = 1e-9;

/**
 * Rundet jede Ecke einer Linie so weit, wie sie dabei frei bleibt (`free` für jedes Stück der Rundung).
 *
 * Die volle Rundung einer Ecke ist die Kurve, die Chaikins Abschneiden im Grenzfall zeichnet: eine Parabel
 * (quadratische Bézierkurve) mit der Ecke als Stütze, die beide Seiten in ihrer Mitte berührt. Bleibt sie nicht
 * frei, wird sie enger gezogen (auf 80 %, 64 %, ...), bis sie es tut; schafft das auch bei 5 % keine Rundung, bleibt
 * die Ecke stehen. Jede Ecke wird für sich geprüft: Eine Ecke, die nicht rund werden darf, hält die anderen nicht
 * auf. Zwei benachbarte Rundungen nehmen von ihrer gemeinsamen Seite je höchstens die Hälfte, überlappen also nie,
 * und die Linie bleibt an jeder Naht tangential.
 *
 * 🔴 Warum nicht Chaikin im Ganzen (`roundCorners`) mit einer Prüfung am Ende: Eine Linie, die um Hindernisse
 * herum straff gezogen ist, berührt deren Ecken. Rundet man ihre Ecken, schneidet man in das Hindernis. Die
 * Prüfung der ganzen Linie fiel an jeder einzigen solchen Ecke durch, und die Linie blieb eckig - bei 113 von 124
 * gemessenen Umwegflügen (2026-10-03).
 *
 * Anfang und Ende der Linie bleiben stehen, ebenso jede Ecke, die nicht rund werden darf.
 */
export function roundCornersWhere(
    points: readonly CurvePoint[],
    free: (from: CurvePoint, to: CurvePoint) => boolean,
    segments: number = ROUNDED_CORNER_SEGMENTS,
): CurvePoint[] {
    const line = points.map((point) => ({ x: point.x, y: point.y }));
    if (line.length < 3) return line;
    const count = Math.max(2, Math.trunc(segments));
    const result: CurvePoint[] = [line[0] as CurvePoint];
    const add = (point: CurvePoint): void => {
        const last = result[result.length - 1] as CurvePoint;
        if (Math.hypot(point.x - last.x, point.y - last.y) > 1e-12) result.push(point);
    };
    for (let index = 1; index + 1 < line.length; index += 1) {
        const corner = line[index] as CurvePoint;
        const arc = widestFreeArc(line[index - 1] as CurvePoint, corner, line[index + 1] as CurvePoint, free, count);
        if (arc) for (const point of arc) add(point);
        else add(corner);
    }
    add(line[line.length - 1] as CurvePoint);
    return result;
}

/** Die breiteste freie Rundung der Ecke `corner` zwischen `before` und `after`, oder null. */
function widestFreeArc(
    before: CurvePoint,
    corner: CurvePoint,
    after: CurvePoint,
    free: (from: CurvePoint, to: CurvePoint) => boolean,
    segments: number,
): CurvePoint[] | null {
    const inX = before.x - corner.x;
    const inY = before.y - corner.y;
    const outX = after.x - corner.x;
    const outY = after.y - corner.y;
    const inLength = Math.hypot(inX, inY);
    const outLength = Math.hypot(outX, outY);
    if (!(inLength > 0 && outLength > 0)) return null;
    if (Math.abs(inX * outY - inY * outX) <= STRAIGHT * inLength * outLength) return null;
    for (let share = 1; share >= NARROWEST; share *= NARROWER) {
        // Die Rundung beginnt und endet `share` mal die halbe Seite von der Ecke entfernt.
        const start = { x: corner.x + (inX * share) / 2, y: corner.y + (inY * share) / 2 };
        const end = { x: corner.x + (outX * share) / 2, y: corner.y + (outY * share) / 2 };
        const arc: CurvePoint[] = [start];
        for (let step = 1; step < segments; step += 1) {
            const t = step / segments;
            const a = (1 - t) * (1 - t);
            const b = 2 * (1 - t) * t;
            const c = t * t;
            arc.push({ x: a * start.x + b * corner.x + c * end.x, y: a * start.y + b * corner.y + c * end.y });
        }
        arc.push(end);
        let clear = true;
        for (let index = 1; index < arc.length && clear; index += 1) {
            clear = free(arc[index - 1] as CurvePoint, arc[index] as CurvePoint);
        }
        if (clear) return arc;
    }
    return null;
}
