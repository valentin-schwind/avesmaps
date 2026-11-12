import { MAP_EXTENT } from "../hydrology/grid.ts";

/**
 * Höhenlinien aus den Anzeigehöhen (WI-0055): Marching Squares auf dem Gitter, zu Linien gefügt,
 * vereinfacht und geglättet, in Karteneinheiten. Dieselben Linien begrenzen die Flächen der Höhenstufen
 * (`bands.ts`): Farbe und Linie decken sich in jedem Zoom (Betreiber 2026-09-28: „ungenaue farbumfüllungen“).
 *
 * - `level` 2 an jedem Tausender (dick), 1 an jedem Fünfhunderter, 0 sonst (Betreiber 2026-09-28: „alle 1000 m
 *   dick, alle 500 m dünn“). Wo die feinen Linien stehen, entscheidet `bands.ts`.
 * - Außerhalb des Gitters gilt 0 (ein Rand aus Meer): Jede Linie ist geschlossen, auch wo Land an den
 *   Kartenrand stößt. Das Stück außen läuft eine halbe Zelle jenseits des Randes, wo die Karte endet.
 * - Kleine Ringe unter `minRing` E fallen weg; sie wären auf der Karte nur Flecken.
 * - Mehrdeutige Zellen (Sattel) entscheidet der Mittelwert der vier Ecken, eindeutig und stabil.
 */

export interface ContourOptions {
    step: number;
    /** Kleinster Ring in E. */
    minRing: number;
    /** Toleranz der Vereinfachung in Zellen (Douglas-Peucker). */
    simplify: number;
    /** Durchgänge der Glättung (Chaikin). */
    smooth: number;
}

/**
 * Wie die Ufer der Topographie geglättet sind: Durchgänge von `ST_ChaikinSmoothing` in der SQL-Funktion
 * `terrain_water_smooth` (Migration 0053). Die Linien enden an dieser Form; die Zahl steht im Fingerabdruck
 * und in der Revision, damit eine andere Glättung neu abschneidet. Ein Test hält sie gleich.
 */
export const WATER_SMOOTHING = 3;

export const CONTOUR_OPTIONS: Readonly<ContourOptions> = Object.freeze({
    step: 100,
    minRing: 1,
    simplify: 0.3,
    smooth: 2,
});

export interface ContourLine {
    ele: number;
    /** 2 Tausender, 1 Fünfhunderter, 0 Hunderter. */
    level: 0 | 1 | 2;
    closed: boolean;
    /** Ein Stück einer feinen Linie im Gebirge: erst aus der Nähe gezeigt (`bands.ts`). */
    detail?: boolean;
    /**
     * x0, y0, x1, y1, … in Karteneinheiten (y nach Norden); ein Ring endet auf seinem Anfang. 🪤 Flach und
     * typisiert: Als Feld von [x, y] kostete ein Punkt rund 70 Byte, bei gut 4 Mio. Punkten über 600 MB Spitze.
     */
    coords: Float64Array;
}

/** Wie viele Punkte eine Linie hat. */
export function pointCount(line: ContourLine): number {
    return line.coords.length / 2;
}

export function contourLevel(ele: number): 0 | 1 | 2 {
    return ele % 1000 === 0 ? 2 : ele % 500 === 0 ? 1 : 0;
}

/**
 * Die Rechnung je Linie (Kantenkette, Douglas-Peucker, Chaikin) läuft auf wiederverwendeten, flachen Feldern
 * (x0, y0, x1, y1, …) statt auf einem Feld von [x, y]: Als Feld von Paaren kostete ein Punkt rund 70 Byte und
 * ließ die junge Generation von V8 auf 128 MB wachsen (I13, Speicherspitze). Dieselben Rechenschritte in
 * derselben Reihenfolge, also dieselben Zahlen.
 */
interface Scratch {
    /** Kanten der Kette: Fluss zurück, Fluss vor, die Kette daraus. */
    backward: Int32Array;
    forward: Int32Array;
    chain: Int32Array;
    /** Punkte der Kette, vereinfacht, und die beiden Puffer der Glättung. */
    raw: Float64Array;
    simple: Float64Array;
    smoothA: Float64Array;
    smoothB: Float64Array;
    keep: Uint8Array;
    stack: Int32Array;
}

/** Ein Feld mit Platz für `length` Einträge; der Inhalt bleibt erhalten (Kanten der Kette, Stapel). */
function growInt32(array: Int32Array, length: number): Int32Array {
    if (array.length >= length) return array;
    const more = new Int32Array(Math.max(length, 2 * array.length));
    more.set(array);
    return more;
}

function growFloat64(array: Float64Array, length: number): Float64Array {
    if (array.length >= length) return array;
    const more = new Float64Array(Math.max(length, 2 * array.length));
    more.set(array);
    return more;
}

/** Douglas-Peucker über `count` Punkte in `raw`; die behaltenen Punkte nach `scratch.simple`, ihre Zahl zurück. */
function simplifyInto(scratch: Scratch, count: number, tolerance: number): number {
    const { raw } = scratch;
    if (scratch.keep.length < count) scratch.keep = new Uint8Array(Math.max(count, 2 * scratch.keep.length));
    const keep = scratch.keep;
    keep.fill(0, 0, count);
    keep[0] = 1;
    keep[count - 1] = 1;
    let stack = scratch.stack;
    stack[0] = 0;
    stack[1] = count - 1;
    let top = 2;
    while (top > 0) {
        top -= 2;
        const s = stack[top] as number;
        const e = stack[top + 1] as number;
        const x1 = raw[2 * s] as number;
        const y1 = raw[2 * s + 1] as number;
        const x2 = raw[2 * e] as number;
        const y2 = raw[2 * e + 1] as number;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        // 🪤 Ein Ring beginnt und endet an benachbarten Kantenpunkten (Kette ohne Schlusspunkt). Geht die Linie genau
        // durch eine Gitterecke auf der Höhe (ganzzahlige Anzeigehöhen: oft), fallen beide zusammen: Der Abstand zur
        // „Geraden“ durch zwei gleiche Punkte war 0 für jeden Punkt, und der ganze Ring schrumpfte auf einen Punkt
        // (Finsterkamm: der 500er-Ring um das Massiv, 9 000 Punkte, fehlte samt Linie und Stufenfläche). Dann misst
        // der Abstand zum gemeinsamen Punkt; die Teilung läuft wie sonst.
        const degenerate = length < 1e-9;
        let farthest = -1;
        let distance = 0;
        for (let q = s + 1; q < e; q += 1) {
            const px = raw[2 * q] as number;
            const py = raw[2 * q + 1] as number;
            const d = degenerate
                ? Math.hypot(px - x1, py - y1)
                : Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / length;
            if (d > distance) {
                distance = d;
                farthest = q;
            }
        }
        if (distance > tolerance && farthest > 0) {
            keep[farthest] = 1;
            if (top + 4 > stack.length) stack = scratch.stack = growInt32(stack, top + 4);
            stack[top] = s;
            stack[top + 1] = farthest;
            stack[top + 2] = farthest;
            stack[top + 3] = e;
            top += 4;
        }
    }
    scratch.simple = growFloat64(scratch.simple, 2 * count);
    const out = scratch.simple;
    let kept = 0;
    for (let q = 0; q < count; q += 1) {
        if (keep[q] !== 1) continue;
        out[2 * kept] = raw[2 * q] as number;
        out[2 * kept + 1] = raw[2 * q + 1] as number;
        kept += 1;
    }
    return kept;
}

/**
 * Chaikin über `count` Punkte in `source`, `passes` Durchgänge; das Ergebnis liegt in einem der beiden Puffer
 * der Glättung (oder ist `source`, ohne Durchgang), seine Zahl steht in `result.count`.
 */
function chaikinInto(
    scratch: Scratch,
    source: Float64Array,
    count: number,
    closed: boolean,
    passes: number,
    result: { points: Float64Array; count: number },
): void {
    let current = source;
    let m = count;
    for (let pass = 0; pass < passes; pass += 1) {
        const target =
            pass % 2 === 0
                ? (scratch.smoothA = growFloat64(scratch.smoothA, 4 * m))
                : (scratch.smoothB = growFloat64(scratch.smoothB, 4 * m));
        let o = 0;
        if (!closed) {
            target[0] = current[0] as number;
            target[1] = current[1] as number;
            o = 2;
        }
        for (let q = 0; q < (closed ? m : m - 1); q += 1) {
            const next = (q + 1) % m;
            const ax = current[2 * q] as number;
            const ay = current[2 * q + 1] as number;
            const bx = current[2 * next] as number;
            const by = current[2 * next + 1] as number;
            target[o] = 0.75 * ax + 0.25 * bx;
            target[o + 1] = 0.75 * ay + 0.25 * by;
            target[o + 2] = 0.25 * ax + 0.75 * bx;
            target[o + 3] = 0.25 * ay + 0.75 * by;
            o += 4;
        }
        if (!closed) {
            target[o] = current[2 * (m - 1)] as number;
            target[o + 1] = current[2 * (m - 1) + 1] as number;
            o += 2;
        }
        current = target;
        m = o / 2;
    }
    result.points = current;
    result.count = m;
}

/** Umfang eines Rings aus `count` Punkten (der Schluss zurück zum Anfang zählt mit). */
function ringLengthOf(points: Float64Array, count: number): number {
    let length = 0;
    for (let q = 0; q < count; q += 1) {
        const next = (q + 1) % count;
        length += Math.hypot(
            (points[2 * next] as number) - (points[2 * q] as number),
            (points[2 * next + 1] as number) - (points[2 * q + 1] as number),
        );
    }
    return length;
}

/**
 * Die Linien des Feldes `field` (n², Schritt, Zeile 0 im Norden) auf genau diesen Höhen (aufsteigend).
 * Sortiert (Höhe, dann erste Koordinate): gleiche Eingabe, gleiche Linien.
 */
export function contourLines(
    field: Float32Array,
    n: number,
    levels: readonly number[],
    options: Readonly<ContourOptions> = CONTOUR_OPTIONS,
): ContourLine[] {
    const cell = MAP_EXTENT / n;
    // Ein Rand aus Nullen um das Gitter: Zellen −1 … n−1, Ecken −1 … n (also n + 2 je Zeile), Werte außen 0,
    // Klassen außen leer. 🪤 Mit n + 1 lief die Ostkante in die nächste Zeile über (Test: Hang über den Rand).
    const m = n + 2;
    const value = (i: number, j: number): number =>
        i < 0 || j < 0 || i >= n || j >= n ? 0 : (field[j * n + i] as number);
    // Je Höhe eine wachsende Liste von Kantenpaaren (typisiert: als JS-Felder kostete das Hunderte MB).
    // Kanten im gepolsterten Gitter: waagerecht 2·k, senkrecht 2·k + 1, k = (j+1)·m + (i+1).
    const segments = new Map<number, { edges: Int32Array; length: number }>();
    const push = (level: number, a: number, b: number): void => {
        let list = segments.get(level);
        if (!list) segments.set(level, (list = { edges: new Int32Array(1024), length: 0 }));
        if (list.length + 2 > list.edges.length) {
            const more = new Int32Array(list.edges.length * 2);
            more.set(list.edges);
            list.edges = more;
        }
        list.edges[list.length] = a;
        list.edges[list.length + 1] = b;
        list.length += 2;
    };
    // Einmal angelegt, nicht je Zelle: Bei 17 Mio. Zellen wäre jede Schließung ein Objekt für die junge Generation.
    const emit = (level: number, a: number, b: number, c: number, d: number, k: number): void => {
        const index = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
        if (index === 0 || index === 15) return;
        const top = 2 * k;
        const right = 2 * (k + 1) + 1;
        const bottom = 2 * (k + m);
        const left = 2 * k + 1;
        switch (index) {
            case 1:
            case 14:
                push(level, left, bottom);
                break;
            case 2:
            case 13:
                push(level, bottom, right);
                break;
            case 3:
            case 12:
                push(level, left, right);
                break;
            case 4:
            case 11:
                push(level, top, right);
                break;
            case 6:
            case 9:
                push(level, top, bottom);
                break;
            case 7:
            case 8:
                push(level, left, top);
                break;
            default: {
                // 5 oder 10, ein Sattel: Der Mittelwert entscheidet, ob die oberen Ecken verbunden sind.
                const above = (a + b + c + d) / 4 > level;
                if ((index === 5) === above) {
                    push(level, left, top);
                    push(level, bottom, right);
                } else {
                    push(level, left, bottom);
                    push(level, top, right);
                }
            }
        }
    };
    for (let j = -1; j < n; j += 1) {
        for (let i = -1; i < n; i += 1) {
            const a = value(i, j);
            const b = value(i + 1, j);
            const c = value(i + 1, j + 1);
            const d = value(i, j + 1);
            const lo = Math.min(a, b, c, d);
            const hi = Math.max(a, b, c, d);
            if (hi - lo < 1e-6) continue;
            const k = (j + 1) * m + (i + 1);
            // 🪤 Eine Ecke genau auf der Höhe zählt als „darunter“; die Zelle trägt die Linie trotzdem. Wer hier
            // `level > lo` verlangte, riss jeden Ring, der über eine solche Ecke lief (Test: Hang über den Rand).
            for (let q = 0; q < levels.length; q += 1) {
                const level = levels[q] as number;
                if (level >= hi) break;
                if (level >= lo) emit(level, a, b, c, d, k);
            }
        }
    }

    const pointInto = (out: Float64Array, q: number, edge: number, level: number): void => {
        const vertical = edge & 1;
        const k = edge >> 1;
        const i = (k % m) - 1;
        const j = Math.floor(k / m) - 1;
        const v1 = value(i, j);
        const v2 = vertical ? value(i, j + 1) : value(i + 1, j);
        const t = (level - v1) / (v2 - v1);
        const gx = i + 0.5 + (vertical ? 0 : t);
        const gy = j + 0.5 + (vertical ? t : 0);
        out[2 * q] = gx * cell;
        out[2 * q + 1] = MAP_EXTENT - gy * cell;
    };

    // Alles, was je Kette und je Höhe gebraucht wird, liegt in Feldern, die über die Höhen wachsen und bleiben.
    const scratch: Scratch = {
        backward: new Int32Array(1024),
        forward: new Int32Array(1024),
        chain: new Int32Array(1024),
        raw: new Float64Array(2048),
        simple: new Float64Array(2048),
        smoothA: new Float64Array(2048),
        smoothB: new Float64Array(2048),
        keep: new Uint8Array(1024),
        stack: new Int32Array(1024),
    };
    const smoothed = { points: scratch.simple, count: 0 };
    let keys: Float64Array = new Float64Array(1024);
    let partner: Int32Array = new Int32Array(1024);
    let used = new Uint8Array(1024);
    const lines: ContourLine[] = [];
    for (const level of [...segments.keys()].sort((x, y) => x - y)) {
        const { edges, length } = segments.get(level) as { edges: Int32Array; length: number };
        segments.delete(level);
        // Jede Kante trägt höchstens zwei Enden (die zwei Zellen daneben). Nach Kante sortiert liegen
        // diese Enden nebeneinander; `partner` verbindet sie. Ein Ende e gehört zum Stück e >> 1.
        keys = growFloat64(keys, length);
        for (let e = 0; e < length; e += 1) keys[e] = (edges[e] as number) * 8388608 + e;
        keys.subarray(0, length).sort();
        partner = growInt32(partner, length);
        partner.fill(-1, 0, length);
        for (let q = 0; q + 1 < length; q += 1) {
            const x = keys[q] as number;
            const y = keys[q + 1] as number;
            if (Math.floor(x / 8388608) === Math.floor(y / 8388608)) {
                const ex = x % 8388608;
                const ey = y % 8388608;
                partner[ex] = ey;
                partner[ey] = ex;
                q += 1;
            }
        }
        if (used.length < length / 2) used = new Uint8Array(Math.max(length / 2, 2 * used.length));
        used.fill(0, 0, length / 2);
        // Von einem Ende aus weiter: über den Partner ins nächste Stück, dort zu dessen anderem Ende. Die Kanten
        // stehen in `scratch.forward` beziehungsweise `scratch.backward`, ihre Zahl wird zurückgegeben.
        const walk = (end: number, backwards: boolean): number => {
            let list = backwards ? scratch.backward : scratch.forward;
            let count = 0;
            let at = partner[end] as number;
            while (at >= 0 && !used[at >> 1]) {
                used[at >> 1] = 1;
                const other = at ^ 1;
                if (count === list.length) {
                    list = growInt32(list, count + 1);
                    if (backwards) scratch.backward = list;
                    else scratch.forward = list;
                }
                list[count] = edges[other] as number;
                count += 1;
                at = partner[other] as number;
            }
            return count;
        };
        for (let segment = 0; segment < length / 2; segment += 1) {
            if (used[segment]) continue;
            used[segment] = 1;
            const nForward = walk(2 * segment + 1, false);
            const nBackward = walk(2 * segment, true);
            // Die Kette: rückwärts Gefundenes umgekehrt, die zwei Kanten des Stücks, vorwärts Gefundenes.
            const total = nBackward + 2 + nForward;
            scratch.chain = growInt32(scratch.chain, total);
            const chain = scratch.chain;
            for (let r = 0; r < nBackward; r += 1) chain[r] = scratch.backward[nBackward - 1 - r] as number;
            chain[nBackward] = edges[2 * segment] as number;
            chain[nBackward + 1] = edges[2 * segment + 1] as number;
            for (let r = 0; r < nForward; r += 1) chain[nBackward + 2 + r] = scratch.forward[r] as number;
            const closed = total > 3 && chain[0] === chain[total - 1];
            // Ein Ring endet auf seinem Anfang: der Schlusspunkt zählt nicht mit.
            const count = closed ? total - 1 : total;
            if (count < 3) continue;
            scratch.raw = growFloat64(scratch.raw, 2 * count);
            for (let q = 0; q < count; q += 1) pointInto(scratch.raw, q, chain[q] as number, level);
            if (closed && ringLengthOf(scratch.raw, count) < options.minRing) continue;
            const kept = simplifyInto(scratch, count, cell * options.simplify);
            chaikinInto(scratch, scratch.simple, kept, closed, options.smooth, smoothed);
            const points = smoothed.count + (closed ? 1 : 0);
            const coords = new Float64Array(2 * points);
            coords.set(smoothed.points.subarray(0, 2 * smoothed.count));
            if (closed) {
                coords[2 * smoothed.count] = coords[0] as number;
                coords[2 * smoothed.count + 1] = coords[1] as number;
            }
            lines.push({ ele: level, level: contourLevel(level), closed, coords });
        }
    }
    return lines.sort(byElevationAndStart);
}

/** Die Reihenfolge der Linien: Höhe, dann erster Punkt. Gleiche Eingabe, gleiche Reihenfolge. */
export function byElevationAndStart(x: ContourLine, y: ContourLine): number {
    return (
        x.ele - y.ele ||
        (x.coords[0] as number) - (y.coords[0] as number) ||
        (x.coords[1] as number) - (y.coords[1] as number)
    );
}
