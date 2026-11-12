import { createHash } from "node:crypto";
import { DESIGN_CANON } from "@avesmaps3d/shared";
import { MAP_EXTENT, MOUNTAIN } from "../hydrology/grid.ts";
import {
    byElevationAndStart,
    contourLevel,
    contourLines,
    CONTOUR_OPTIONS,
    pointCount,
    WATER_SMOOTHING,
    type ContourLine,
    type ContourOptions,
} from "./contours.ts";

/**
 * Höhenlinien und Höhenstufen aus EINEM Satz Linien (WI-0055, Betreiber 2026-09-28: „überall sind so kleine
 * artefakte oder ungenaue farbumfüllungen“).
 *
 * Die Höhenstufen waren zuerst MapLibres `color-relief` über Höhenkacheln von 0,25 E: Bei Zoom 8 ist ein
 * Kachelpixel rund 30 Bildpunkte breit, die Farbkanten liefen treppig und neben den geglätteten Linien.
 * Jetzt sind sie Flächen, deren Ränder GENAU die Linien sind: Eine Stufe ist die Fläche „höher als ihre
 * Schwelle“, gebaut aus den geschlossenen Ringen derselben Rechnung. Gestapelt von unten nach oben ergeben
 * sie die Stufen der Legende. Stufe 0 ist die ganze Karte; Meer und Seen malen die Landschaftsflächen darüber.
 *
 * Jede volle Hundert wird überall gezogen, als geschlossener Ring. Die feinen Linien (Stufe 0) im Gebirge
 * werden zu eigenen Stücken (`detail`), die die Karte erst aus der Nähe zeigt: Vorher endeten sie an der
 * unsichtbaren Gebirgsgrenze mitten auf dem Talboden (Betreiber 2026-09-28: „manchmal enden so
 * höhenlinien, kriegt man das in griff?“), jetzt laufen sie weiter und schmiegen sich an die Fünfhunderter.
 */

export interface HeightBand {
    /** Index in `topography.heightSteps`; 0 ist die ganze Karte und hat keine Ringe. */
    step: number;
    threshold: number;
    /** Geschlossene Ringe der Schwelle; die Fläche entsteht daraus nach der Gerade-ungerade-Regel. */
    rings: ContourLine[];
}

export interface ContourSet {
    /** Die Linien der Karte (Höhenlinien); feine Linien im Gebirge als Stücke mit `detail`. */
    lines: ContourLine[];
    /** Die Ringe der Höhenstufen, je Stufe ab 1. */
    bands: HeightBand[];
}

/** So viele Höhen je Lauf über das Feld: Alle auf einmal hielten die Kanten aller Höhen zugleich (Speicher). */
const LEVELS_PER_RUN = 12;
/** Kürzere Wechsel zwischen Gebirge und Flachland (Punkte) zählen zum Stück davor: kein Flackern am Rand. */
const MIN_RUN_POINTS = 4;

/**
 * Eine feine Linie in Stücke je Lage: im Flachland, im Gebirge (`detail`). Benachbarte Stücke teilen ihren
 * Wechselpunkt, gezeigt zusammen sind sie wieder die ganze Linie.
 */
function splitByMountain(line: ContourLine, classes: Uint8Array, n: number): ContourLine[] {
    const cell = MAP_EXTENT / n;
    const count = pointCount(line) - (line.closed ? 1 : 0);
    // Flach und typisiert (1: im Gebirge): Als Feld von Wahrheitswerten und Zahlen ließ das den Speicher der jungen
    // Generation von V8 wachsen, bei einem Ring mit 100 000 Punkten um Megabyte (I13, Speicherspitze).
    const flags = new Uint8Array(count);
    for (let q = 0; q < count; q += 1) {
        const gx = Math.min(n - 1, Math.max(0, Math.floor((line.coords[2 * q] as number) / cell)));
        const gy = Math.min(n - 1, Math.max(0, Math.floor((MAP_EXTENT - (line.coords[2 * q + 1] as number)) / cell)));
        flags[q] = ((classes[gy * n + gx] as number) & MOUNTAIN) !== 0 ? 1 : 0;
    }
    // Kurze Wechsel glätten: Ein Lauf unter MIN_RUN_POINTS nimmt die Lage des Laufs davor an.
    for (let q = 1, runStart = 0; q <= flags.length; q += 1) {
        if (q < flags.length && flags[q] === flags[runStart]) continue;
        if (q - runStart < MIN_RUN_POINTS && runStart > 0) {
            for (let r = runStart; r < q; r += 1) flags[r] = flags[runStart - 1] as number;
        }
        runStart = q;
    }
    if (flags.every((flag) => flag === flags[0])) return [{ ...line, detail: flags[0] === 1 }];
    // Ein Ring beginnt an einem Wechsel, damit sein erstes und letztes Stück nicht zwei halbe sind.
    let order = Int32Array.from({ length: count }, (_, q) => q);
    if (line.closed) {
        const first = flags.findIndex((flag, q) => q > 0 && flag !== flags[q - 1]);
        const rotated = new Int32Array(count + 1);
        rotated.set(order.subarray(first));
        rotated.set(order.subarray(0, first), count - first);
        rotated[count] = first;
        order = rotated;
    }
    const pieces: ContourLine[] = [];
    const piece = (from: number, to: number, detail: boolean): void => {
        if (to - from < 1) return;
        const coords = new Float64Array(2 * (to - from + 1));
        for (let r = from; r <= to; r += 1) {
            const q = order[r] as number;
            coords[2 * (r - from)] = line.coords[2 * q] as number;
            coords[2 * (r - from) + 1] = line.coords[2 * q + 1] as number;
        }
        pieces.push({ ele: line.ele, level: line.level, closed: false, detail, coords });
    };
    // Benachbarte Stücke teilen den Wechselpunkt.
    let from = 0;
    for (let r = 1; r < order.length; r += 1) {
        if (flags[order[r] as number] !== flags[order[r - 1] as number]) {
            piece(from, r, flags[order[from] as number] === 1);
            from = r;
        }
    }
    piece(from, order.length - 1, flags[order[from] as number] === 1);
    return pieces;
}

export function contourSet(
    field: Float32Array,
    classes: Uint8Array,
    n: number,
    options: Readonly<ContourOptions> = CONTOUR_OPTIONS,
    onPhase: (phase: string) => void = () => undefined,
    steps: readonly number[] = DESIGN_CANON.topography.heightSteps,
): ContourSet {
    let highest = 0;
    for (let k = 0; k < field.length; k += 1) if ((field[k] as number) > highest) highest = field[k] as number;
    const levels = Array.from({ length: Math.floor(highest / options.step) }, (_, q) => (q + 1) * options.step);
    const thresholds = new Set(steps.filter((step) => step > 0));
    const lines: ContourLine[] = [];
    const rings = new Map<number, ContourLine[]>();
    for (let start = 0; start < levels.length; start += LEVELS_PER_RUN) {
        for (const line of contourLines(field, n, levels.slice(start, start + LEVELS_PER_RUN), options)) {
            // Jede Linie ist ein Ring (Rand aus Nullen). Eine offene wäre eine Stufe ohne Fläche: laut abbrechen.
            if (!line.closed) {
                const [x, y] = [line.coords[0] as number, line.coords[1] as number];
                throw new Error(
                    `Höhenlinie ${String(line.ele)} bei ${x.toFixed(1)}/${y.toFixed(1)} ist nicht geschlossen`,
                );
            }
            if (thresholds.has(line.ele)) {
                const same = rings.get(line.ele) ?? [];
                same.push(line);
                rings.set(line.ele, same);
            }
            if (contourLevel(line.ele) === 0) lines.push(...splitByMountain(line, classes, n));
            else lines.push({ ...line, detail: false });
        }
        onPhase(`linien bis ${String(levels[Math.min(start + LEVELS_PER_RUN, levels.length) - 1])}`);
    }
    lines.sort(byElevationAndStart);
    const bands = steps.map((threshold, step) => ({
        step,
        threshold,
        rings: step === 0 ? [] : (rings.get(threshold) ?? []),
    }));
    return { lines, bands };
}

/**
 * Die Revision: zwölf Hexzeichen über Linien, Ringe der Stufen und die Glättung der Ufer, an denen die Linien
 * enden (ADR-0008, ADR-0012).
 */
export function displayHeightRevision(set: ContourSet): string {
    const hash = createHash("sha256");
    hash.update(`ufer:chaikin${String(WATER_SMOOTHING)}`);
    const feed = (tag: string, line: ContourLine): void => {
        hash.update(`|${tag}${String(line.ele)}:`);
        for (let q = 0; q < line.coords.length; q += 2) {
            hash.update(`${(line.coords[q] as number).toFixed(4)},${(line.coords[q + 1] as number).toFixed(4)};`);
        }
    };
    for (const line of set.lines) feed(line.detail === true ? "d" : "l", line);
    for (const band of set.bands) for (const ring of band.rings) feed(`b${String(band.step)}/`, ring);
    return hash.digest("hex").slice(0, 12);
}
