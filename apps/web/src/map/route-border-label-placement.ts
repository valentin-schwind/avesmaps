/**
 * Wo ein Grenzschild steht, und ob es steht (Betreiber 2026-10-03: „willst du vielleicht ein bisschen verhindern, dass
 * sie kollidieren, indem sie nicht nur über dem Item liegen und nach unten zeigen, sondern auch nach oben, links,
 * rechts“; dazu „dass sie ausgeblendet werden, wenn keine Überlappung verhindert werden kann“, bestätigt als Regel A:
 * „A, Variante 1, bau es“). Jedes Schild hat vier mögliche Seiten an seiner Marke: darüber (Pfeil nach unten), darunter
 * (Pfeil nach oben), links (Pfeil nach rechts) und rechts (Pfeil nach links). Die Spitze steht immer `lift` Pixel von
 * der Mitte der Marke entfernt (Guide §15.3).
 *
 * Reine Rechnung ohne DOM: Eingang sind Bildschirmpunkte, gemessene Schildgrößen und die Rangfolge, Ausgang je Schild
 * die Seite und ob es sichtbar bleibt.
 *
 * 🔴 **Die Rangfolge entscheidet, wer weicht.** Der Reihe nach, der Rang zuerst: Ein Schild bleibt sichtbar, wenn es kein
 * höher gerangtes sichtbares Schild überdeckt, sonst wird es ausgeblendet. Der Rang ist die Reihenfolge der Reise; ein
 * gewählter Übertritt kommt davor. Es gewinnt also nicht das größte oder das nächste, sondern das, was auf der Reise
 * früher kommt, und das Bild ändert sich nicht, wenn man die Karte verschiebt.
 *
 * Gewählt werden die Seiten so, dass möglichst wenige Schilder ausgeblendet werden. Bei gleich vielen weichen die mit dem
 * niedrigsten Rang. Danach zählt, was sichtbare Schilder über den Rand der Karte oder über fremde Marken ragen lassen,
 * danach, dass möglichst viele oben stehen. Ein einzelner
 * Durchgang bleibt leicht in einer schlechten Lage stecken, deshalb fängt die Suche mehrfach an: einmal mit allen
 * Schildern oben, dann mit festen Pseudozufalls-Lagen, jeweils bis nichts mehr besser wird. Die Rechnung hängt nur von der
 * Geometrie und dem Rang ab, nicht von früheren Seiten oder vom Zufall.
 */

export type LabelSide = "top" | "bottom" | "right" | "left";

/** Die Rangfolge bei Gleichstand: so steht das Schild, wenn nichts im Weg ist. */
export const LABEL_SIDES: readonly LabelSide[] = ["top", "bottom", "right", "left"];

export interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface LabelSpot {
    /** Mitte der Marke im Bild (Pixel). */
    x: number;
    y: number;
    /** Größe des Schildes ohne Pfeil. */
    width: number;
    height: number;
}

export interface PlacementOptions {
    /** Abstand der Pfeilspitze von der Mitte der Marke. */
    lift: number;
    /** Kantenlänge des Pfeils. */
    arrow: number;
    /** Halbe Breite der Marke: Ein Schild soll keine fremde Marke zudecken. */
    markerRadius: number;
    /** Der sichtbare Teil der Karte: Ein Schild soll nicht über den Rand hinausragen. */
    viewport: Rect;
}

export interface Arrangement {
    /** Die Seite je Schild, in der Reihenfolge der Eingabe. Ein ausgeblendetes Schild steht oben. */
    sides: LabelSide[];
    /** Ob das Schild sichtbar bleibt. */
    visible: boolean[];
}

const MAX_PASSES = 6;
/** Rechenbudget (Schritte je Aufruf): Daraus folgt die Zahl der Neustarts, höchstens `MAX_STARTS`. */
const BUDGET = 4_000_000;
const MAX_STARTS = 120;
/** Ab so viel gemeinsamer Fläche (px²) überdecken sich zwei Schilder; eine bloße Berührung zählt nicht. */
const OVERLAP_EPSILON = 1;

/** Das Rechteck, das ein Schild samt Pfeil auf der gewählten Seite einnimmt. */
export function labelRect(spot: LabelSpot, side: LabelSide, options: Pick<PlacementOptions, "lift" | "arrow">): Rect {
    const { x, y, width, height } = spot;
    const gap = options.lift + options.arrow;
    switch (side) {
        case "top":
            return { left: x - width / 2, right: x + width / 2, bottom: y - options.lift, top: y - gap - height };
        case "bottom":
            return { left: x - width / 2, right: x + width / 2, top: y + options.lift, bottom: y + gap + height };
        case "left":
            return { right: x - options.lift, left: x - gap - width, top: y - height / 2, bottom: y + height / 2 };
        case "right":
            return { left: x + options.lift, right: x + gap + width, top: y - height / 2, bottom: y + height / 2 };
    }
}

function overlap(a: Rect, b: Rect): number {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
}

function area(r: Rect): number {
    return (r.right - r.left) * (r.bottom - r.top);
}

/** Die Fläche eines Schildes, die über den Rand der Karte hinausragt. */
function outside(rect: Rect, viewport: Rect): number {
    return area(rect) - overlap(rect, viewport);
}

function markerRect(spot: LabelSpot, radius: number): Rect {
    return { left: spot.x - radius, right: spot.x + radius, top: spot.y - radius, bottom: spot.y + radius };
}

/** Ein fester Pseudozufall (Lehmer): dieselbe Eingabe gibt immer dieselbe Antwort. */
function lehmer(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 16807) % 2147483647;
        return state / 2147483647;
    };
}

/** Die Rangfolge vollständig machen: die genannten Indizes zuerst, der Rest in der Reihenfolge der Eingabe. */
function rankOrder(count: number, order?: readonly number[]): number[] {
    const seen = new Set<number>();
    const result: number[] = [];
    for (const index of order ?? []) {
        if (index >= 0 && index < count && !seen.has(index)) {
            seen.add(index);
            result.push(index);
        }
    }
    for (let index = 0; index < count; index++) if (!seen.has(index)) result.push(index);
    return result;
}

interface Score {
    hidden: number;
    /** Wie hoch gerangt die ausgeblendeten sind (Summe von Anzahl − Platz): kleiner heißt, es weichen die hinteren. */
    hiddenRank: number;
    spill: number;
    offTop: number;
}

const better = (a: Score, b: Score): boolean => {
    if (a.hidden !== b.hidden) return a.hidden < b.hidden;
    if (a.hiddenRank !== b.hiddenRank) return a.hiddenRank < b.hiddenRank;
    if (a.spill !== b.spill) return a.spill < b.spill;
    return a.offTop < b.offTop;
};

const perfect = (score: Score): boolean => score.hidden === 0 && score.spill === 0 && score.offTop === 0;

/**
 * Die Seiten und die Sichtbarkeit aller Schilder. `order` ist die Rangfolge als Liste von Indizes (vorne gewinnt);
 * was fehlt, folgt in der Reihenfolge der Eingabe.
 */
export function arrangeLabels(
    spots: readonly LabelSpot[],
    options: PlacementOptions,
    order?: readonly number[],
): Arrangement {
    const count = spots.length;
    if (count === 0) return { sides: [], visible: [] };
    const rank = rankOrder(count, order);
    const markers = spots.map((spot) => markerRect(spot, options.markerRadius));
    // Alle vier Rechtecke je Schild einmal rechnen, samt dem, was sie über Rand und Marken ragen.
    const candidates = spots.map((spot) => LABEL_SIDES.map((side) => labelRect(spot, side, options)));
    const spill = candidates.map((rects) =>
        rects.map(
            (rect) => outside(rect, options.viewport) + markers.reduce((sum, mark) => sum + overlap(rect, mark), 0),
        ),
    );

    const evaluate = (current: readonly number[]): { score: Score; visible: boolean[] } => {
        const visible: boolean[] = new Array<boolean>(count).fill(false);
        const shown: number[] = [];
        let hidden = 0;
        let hiddenRank = 0;
        let spillSum = 0;
        let offTop = 0;
        for (const [place, index] of rank.entries()) {
            const rect = candidates[index]![current[index]!]!;
            if (shown.some((other) => overlap(rect, candidates[other]![current[other]!]!) > OVERLAP_EPSILON)) {
                hidden++;
                hiddenRank += count - place;
                continue;
            }
            visible[index] = true;
            shown.push(index);
            spillSum += spill[index]![current[index]!]!;
            offTop += current[index]!;
        }
        return { score: { hidden, hiddenRank, spill: Math.round(spillSum), offTop }, visible };
    };

    /** Von einer Ausgangslage so lange ein Schild umsetzen, wie es besser wird. */
    const descend = (start: number[]): { sides: number[]; score: Score; visible: boolean[] } => {
        const current = start.slice();
        let result = evaluate(current);
        for (let pass = 0; pass < MAX_PASSES; pass++) {
            let changed = false;
            for (const index of rank) {
                const was = current[index]!;
                let best = was;
                for (let side = 0; side < LABEL_SIDES.length; side++) {
                    if (side === was) continue;
                    current[index] = side;
                    const tried = evaluate(current);
                    if (better(tried.score, result.score)) {
                        result = tried;
                        best = side;
                    }
                }
                current[index] = best;
                if (best !== was) changed = true;
            }
            if (!changed) break;
        }
        return { sides: current, score: result.score, visible: result.visible };
    };

    let best = descend(spots.map(() => 0));
    const perStart = MAX_PASSES * LABEL_SIDES.length * count * count * count;
    const starts = Math.max(0, Math.min(MAX_STARTS, Math.floor(BUDGET / perStart)) - 1);
    const random = lehmer(1);
    for (let start = 0; start < starts && !perfect(best.score); start++) {
        const found = descend(spots.map(() => Math.floor(random() * LABEL_SIDES.length)));
        if (better(found.score, best.score)) best = found;
    }
    return {
        sides: best.sides.map((side, index) => (best.visible[index] ? LABEL_SIDES[side]! : "top")),
        visible: best.visible,
    };
}
