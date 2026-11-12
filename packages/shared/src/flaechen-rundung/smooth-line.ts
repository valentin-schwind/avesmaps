/**
 * Linien glätten und vereinfachen, wie PostGIS es tut (WI-0077): Chaikin (`ST_ChaikinSmoothing`) und Douglas-Peucker
 * (`ST_Simplify`), auf flachen Koordinaten x0, y0, x1, y1, …
 *
 * 🔴 Dieselbe Rechnung wie in PostGIS, Schritt für Schritt (liblwgeom `ptarray_chaikin`, `ptarray_simplify_in_place`):
 * Ein Ring, der für sich allein geglättet wird (eine Insel, ein See ohne Nachbarn), ergibt so dieselben Punkte wie
 * `terrain_water_smooth` (Migration 0053), nur mit anderem Anfangspunkt. Die Tests vergleichen beides in PostGIS.
 */

/** Ein Linienzug als flache Koordinaten x0, y0, x1, y1, …; ein Ring endet auf seinem Anfang. */
export type Coords = Float64Array;

/**
 * Wiederverwendete Puffer: Das Netz glättet zehntausende Ketten nacheinander. Mit einem neuen Feld je Durchgang entstünden
 * rund 70 MB Abfall, den V8 erst spät einsammelt (die Spitze des Prozesses stieg um über 100 MB, gemessen).
 */
let bufferA = new Float64Array(1024);
let bufferB = new Float64Array(1024);
let keepScratch = new Uint8Array(512);
let stackScratch = new Int32Array(512);

/**
 * Ein Durchgang Chaikin von `count` Punkten aus `source` nach `target` (groß genug); gibt die Zahl der Punkte zurück.
 * `open`: ein Linienzug mit festen Enden (`ST_ChaikinSmoothing(line, n, true)`); sonst ein geschlossener Ring ohne festen
 * Punkt (`ST_ChaikinSmoothing(polygon, n)` je Ring), der auf seinem neuen Anfang endet. Offen entstehen 2n − 2 Punkte
 * (mindestens die beiden Enden), geschlossen 2n − 1.
 */
function chaikinPass(source: Coords, count: number, open: boolean, target: Float64Array): number {
    const n = count;
    let o = 0;
    let p1x = source[0] as number;
    let p1y = source[1] as number;
    if (open) {
        target[o++] = p1x;
        target[o++] = p1y;
    }
    for (let p = 1; p < n; p += 1) {
        const p2x = p1x;
        const p2y = p1y;
        p1x = source[2 * p] as number;
        p1y = source[2 * p + 1] as number;
        // Wie liblwgeom: ein Viertel der Strecke, vom Anfang dazu und vom Ende ab gerechnet.
        const qx = (p1x - p2x) * 0.25;
        const qy = (p1y - p2y) * 0.25;
        if (!open || p > 1) {
            target[o++] = p2x + qx;
            target[o++] = p2y + qy;
        }
        if (!open || p < n - 1) {
            target[o++] = p1x - qx;
            target[o++] = p1y - qy;
        }
    }
    if (open) {
        target[o++] = p1x;
        target[o++] = p1y;
    } else {
        target[o++] = target[0] as number;
        target[o++] = target[1] as number;
    }
    return o / 2;
}

/** Chaikin in die Puffer; das Ergebnis liegt in den ersten `count` Punkten von `points` (nur bis zum nächsten Aufruf gültig). */
function chaikinScratch(coords: Coords, passes: number, open: boolean): { points: Float64Array; count: number } {
    let count = coords.length / 2;
    let current: Float64Array = coords;
    for (let pass = 0; pass < passes; pass += 1) {
        const needed = 2 * (2 * count + 1);
        const useA = pass % 2 === 0;
        if (useA && bufferA.length < needed) bufferA = new Float64Array(2 * needed);
        if (!useA && bufferB.length < needed) bufferB = new Float64Array(2 * needed);
        const target = useA ? bufferA : bufferB;
        count = chaikinPass(current, count, open, target);
        current = target;
    }
    return { points: current, count };
}

/** Chaikin mit `passes` Durchgängen; `open` hält die Enden fest, sonst ist es ein geschlossener Ring. */
export function chaikin(coords: Coords, passes: number, open: boolean): Coords {
    const { points, count } = chaikinScratch(coords, passes, open);
    return points.slice(0, 2 * count);
}

/**
 * Glätten und vereinfachen in einem Zug, ohne Zwischenfelder: `simplify(chaikin(…), resolution, minPoints)`, das Ergebnis
 * ein neues Feld.
 */
export function smoothLine(
    coords: Coords,
    passes: number,
    open: boolean,
    resolution: number,
    minPoints: number,
): Coords {
    const { points, count } = chaikinScratch(coords, passes, open);
    return simplifyCount(points, count, resolution, minPoints);
}

/**
 * Douglas-Peucker wie `ST_Simplify` (liblwgeom `ptarray_simplify_in_place`): Anfang und Ende bleiben, ein Punkt bleibt,
 * wenn er weiter als `tolerance` vom Stück zwischen seinen Nachbarn liegt; die ersten `minPoints` Punkte bleiben ohne
 * Rücksicht auf die Toleranz (ein Ring braucht vier). Bei einem Ring (Anfang gleich Ende) misst der erste Schritt den
 * Abstand zum Anfangspunkt.
 */
export function simplify(coords: Coords, tolerance: number, minPoints: number): Coords {
    return simplifyCount(coords, coords.length / 2, tolerance, minPoints);
}

/** Wie `simplify` über die ersten `n` Punkte; das Ergebnis ist immer ein neues Feld. */
function simplifyCount(coords: Coords, n: number, tolerance: number, minPoints: number): Coords {
    if (n < 3 || n <= minPoints) return coords.slice(0, 2 * n);
    if (keepScratch.length < n) keepScratch = new Uint8Array(2 * n);
    if (stackScratch.length < n) stackScratch = new Int32Array(2 * n);
    const keep = keepScratch;
    const stack = stackScratch;
    keep.fill(0, 0, n);
    keep[0] = 1;
    keep[n - 1] = 1;
    let kept = 2;
    let top = 0;
    stack[top++] = 0;
    let first = 0;
    let last = n - 1;
    const toleranceSqr = tolerance * tolerance;
    let limit = kept >= minPoints ? toleranceSqr : -1;
    while (top > 0) {
        const split = findSplit(coords, first, last, limit);
        if (split === first) {
            first = last;
            last = stack[--top] as number;
        } else {
            keep[split] = 1;
            kept += 1;
            stack[top++] = last;
            last = split;
            limit = kept >= minPoints ? toleranceSqr : -1;
        }
    }
    const out = new Float64Array(2 * kept);
    let o = 0;
    for (let q = 0; q < n; q += 1) {
        if (keep[q] !== 1) continue;
        out[o++] = coords[2 * q] as number;
        out[o++] = coords[2 * q + 1] as number;
    }
    return out;
}

/** Der Punkt zwischen `first` und `last`, der am weitesten vom Stück dazwischen liegt, wenn weiter als die Grenze. */
function findSplit(coords: Coords, first: number, last: number, limitSqr: number): number {
    let split = first;
    if (last - first < 2) return first;
    const ax = coords[2 * first] as number;
    const ay = coords[2 * first + 1] as number;
    const bx = coords[2 * last] as number;
    const by = coords[2 * last + 1] as number;
    let max = limitSqr;
    const bax = bx - ax;
    const bay = by - ay;
    const lengthSqr = bax * bax + bay * bay;
    if (lengthSqr < Number.EPSILON) {
        for (let k = first + 1; k < last; k += 1) {
            const dx = (coords[2 * k] as number) - ax;
            const dy = (coords[2 * k + 1] as number) - ay;
            const d = dx * dx + dy * dy;
            if (d > max) {
                split = k;
                max = d;
            }
        }
        return split;
    }
    // Wie liblwgeom: mit dem Quadrat der Länge multipliziert statt dividiert.
    max *= lengthSqr;
    for (let k = first + 1; k < last; k += 1) {
        const cx = coords[2 * k] as number;
        const cy = coords[2 * k + 1] as number;
        const cax = cx - ax;
        const cay = cy - ay;
        const dot = cax * bax + cay * bay;
        let d: number;
        if (dot <= 0) {
            d = (cax * cax + cay * cay) * lengthSqr;
        } else if (dot >= lengthSqr) {
            const cbx = cx - bx;
            const cby = cy - by;
            d = (cbx * cbx + cby * cby) * lengthSqr;
        } else {
            const cross = cax * bay - cay * bax;
            d = cross * cross;
        }
        if (d > max) {
            split = k;
            max = d;
        }
    }
    return split;
}

/** Lexikografisch nach x, dann y: negativ, wenn (ax, ay) vor (bx, by) liegt. */
export function compareXY(ax: number, ay: number, bx: number, by: number): number {
    return ax !== bx ? ax - bx : ay - by;
}

/** Doppelte vorzeichenbehaftete Fläche eines geschlossenen Rings (positiv gegen den Uhrzeigersinn). */
export function ringSignedArea2(coords: Coords): number {
    let sum = 0;
    const n = coords.length / 2;
    for (let q = 0; q + 1 < n; q += 1) {
        sum +=
            (coords[2 * q] as number) * (coords[2 * q + 3] as number) -
            (coords[2 * q + 2] as number) * (coords[2 * q + 1] as number);
    }
    return sum;
}

/** Ein Linienzug rückwärts. */
export function reverseCoords(coords: Coords): Coords {
    const n = coords.length / 2;
    const out = new Float64Array(coords.length);
    for (let q = 0; q < n; q += 1) {
        out[2 * q] = coords[2 * (n - 1 - q)] as number;
        out[2 * q + 1] = coords[2 * (n - 1 - q) + 1] as number;
    }
    return out;
}
