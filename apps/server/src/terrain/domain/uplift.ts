import { blur } from "./blur.ts";

/**
 * Regionale Rückverteilung des Erosionsverlusts (WI-0067 G7, Prototyp D vom 2026-10-09, standardmäßig AUS).
 *
 * Heute (Vorgabe) geht der Verlust einer Erosionsrunde domainweit zurück: `Δh(x) = loss · w(x) / Σw`. Jede Änderung
 * irgendwo hebt oder senkt damit jede Landzelle ein wenig, und das Gebirgsinnere verstärkt das in fernen Gebirgen
 * zu Sprüngen bis über 1.000 Schritt (R0, `project-control/discovery/r0-reichweite-gelaende-2026-10-09.md`).
 *
 * Regional geht der Verlust jeder Zelle gewichtet in ihre Umgebung zurück, wie eine isostatische Ausgleichshebung
 * mit begrenzter Reichweite:
 *
 *     Δh(x) = w(x) · Σ_y K(x − y) · loss(y) / W(y),   W(y) = Σ_z K(z − y) · w(z)
 *
 * `w` ist `upliftWeight` auf freien Landzellen (0 auf Meer, See und Gipfelankern), `K` ein dreifacher Kastenfilter
 * (≈ Gauß mit σ ≈ `radius`, Träger 3 · `radius`). Weil `K` symmetrisch ist, bleibt die Masse je Quellzelle erhalten,
 * also auch je Region und über die ganze Karte; eine Änderung wirkt je Runde höchstens 3 · `radius` weit.
 */
export interface RegionalUplift {
    kind: "regional";
    /** Halbe Breite des Kastenfilters in Karteneinheiten; der Kern reicht dreimal so weit. */
    radius: number;
    /**
     * Sättigung (Nachstimmung 2026-10-10, standardmäßig AUS): Hebung je Runde in Schritt, ab der das Gewicht einer Zelle
     * in der Rückverteilung nicht mehr wächst. Fehlt der Eintrag, rechnet die regionale Rückverteilung wie zuvor.
     */
    saturation?: number;
}

export interface RegionalUpliftReport extends RegionalUplift {
    /** Zellen, deren Höhe die Rückverteilung unter 0 gezogen hätte und die auf 0 stehen (Massenfehler, gemeldet). */
    clampedCells: number;
    /** Verlust ohne freie Landzelle in Reichweite (sollte 0 sein: jede Verlustzelle ist selbst frei). */
    unplacedLoss: number;
    /** Nur mit Sättigung: so viele Zellen hatten in der stärksten Runde ein gesättigtes (gekürztes) Gewicht. */
    saturatedCells?: number;
}

/** Halbe Filterbreite in Zellen, mindestens eine. */
export function regionalRadiusCells(radius: number, cell: number): number {
    return Math.max(1, Math.round(radius / cell));
}

/**
 * `W(y)` für jede Zelle: die gefilterte Gewichtssumme ihrer Umgebung. Gewichte, Anker und Wasser ändern sich während
 * der Erosion nicht, also einmal je Lauf. `spare` ist ein Hilfsfeld derselben Größe.
 */
export function regionalWeightSum(
    n: number,
    weightAt: (k: number) => number,
    spare: Float32Array,
    radiusCells: number,
    /** Wohin die Summe kommt (WI-0227: mit Workern ein Feld im gemeinsamen Speicher); ohne Angabe ein neues. */
    target: Float32Array = new Float32Array(n * n),
): Float32Array {
    const sum = target;
    for (let k = 0; k < sum.length; k += 1) sum[k] = weightAt(k);
    blur(sum, spare, n, radiusCells);
    return sum;
}

/**
 * Hebt `height` um den regional zurückverteilten Verlust einer Runde. `start` ist die Höhe zu Rundenbeginn, `work`
 * ein Hilfsfeld; beide werden überschrieben. `weightAt` muss dieselben Gewichte liefern wie für `weightSum`.
 */
export function redistributeRegionally(
    height: Float32Array,
    start: Float32Array,
    work: Float32Array,
    weightSum: Float32Array,
    weightAt: (k: number) => number,
    n: number,
    radiusCells: number,
): { clampedCells: number; unplacedLoss: number } {
    let unplacedLoss = 0;
    for (let k = 0; k < height.length; k += 1) {
        const loss = start[k]! - height[k]!;
        const sum = weightSum[k]!;
        if (loss !== 0 && !(sum > 0)) unplacedLoss += loss;
        work[k] = loss !== 0 && sum > 0 ? loss / sum : 0;
    }
    blur(work, start, n, radiusCells);
    let clampedCells = 0;
    for (let k = 0; k < height.length; k += 1) {
        const weight = weightAt(k);
        if (weight === 0) continue;
        const next = height[k]! + weight * work[k]!;
        if (next < 0) {
            clampedCells += 1;
            height[k] = 0;
        } else height[k] = next;
    }
    return { clampedCells, unplacedLoss };
}

/** Zwei Hilfsfelder der Sättigung (je n²), einmal je Lauf angelegt. */
export interface SaturationFields {
    first: Float32Array;
    sum: Float32Array;
}

/**
 * Die vier zellweisen Schritte von `redistributeSaturated` über die Zellen `[from, to)` (WI-0227). Zwischen ihnen liegt je ein
 * Kastenfilter über das ganze Feld. Jede Zelle rechnet nur mit sich selbst, darum dürfen Threads die Zellen unter sich aufteilen; der
 * Hauptthread rechnet dieselben Funktionen über das Ganze. Zurück kommen die Zählungen des Bereichs.
 */
export const saturatedSteps = {
    /** q-Vorstufe: Verlust je Gewichtssumme; dazu der Verlust ohne freie Landzelle in Reichweite. */
    first(
        height: Float32Array,
        start: Float32Array,
        weightSum: Float32Array,
        first: Float32Array,
        from: number,
        to: number,
    ): number {
        let unplacedLoss = 0;
        for (let k = from; k < to; k += 1) {
            const loss = start[k]! - height[k]!;
            const total = weightSum[k]!;
            if (loss !== 0 && !(total > 0)) unplacedLoss += loss;
            first[k] = loss !== 0 && total > 0 ? loss / total : 0;
        }
        return unplacedLoss;
    },
    /** Gesättigtes Gewicht w' in `work` und `sum`; zurück die Zahl der gesättigten Zellen. */
    weights(
        first: Float32Array,
        work: Float32Array,
        sum: Float32Array,
        weightAt: (k: number) => number,
        saturation: number,
        from: number,
        to: number,
    ): number {
        let saturatedCells = 0;
        for (let k = from; k < to; k += 1) {
            const weight = weightAt(k);
            const perWeight = first[k]!;
            let saturated = weight;
            if (weight > 0 && perWeight * weight > saturation) {
                saturated = saturation / perWeight;
                saturatedCells += 1;
            }
            work[k] = saturated;
            sum[k] = saturated;
        }
        return saturatedCells;
    },
    /** Verlust je gesättigter Gewichtssumme W'. */
    second(
        height: Float32Array,
        start: Float32Array,
        sum: Float32Array,
        first: Float32Array,
        from: number,
        to: number,
    ): void {
        for (let k = from; k < to; k += 1) {
            const loss = start[k]! - height[k]!;
            const total = sum[k]!;
            first[k] = loss !== 0 && total > 0 ? loss / total : 0;
        }
    },
    /** Hebung Δh = w' · Σ; zurück die Zahl der Zellen, die unter 0 fielen und auf 0 stehen. */
    apply(height: Float32Array, work: Float32Array, first: Float32Array, from: number, to: number): number {
        let clampedCells = 0;
        for (let k = from; k < to; k += 1) {
            const weight = work[k]!;
            if (weight === 0) continue;
            const next = height[k]! + weight * first[k]!;
            if (next < 0) {
                clampedCells += 1;
                height[k] = 0;
            } else height[k] = next;
        }
        return clampedCells;
    },
};

/**
 * Regionale Rückverteilung mit Sättigung (Nachstimmung 2026-10-10, standardmäßig AUS).
 *
 * Ohne Sättigung nimmt ein stark abgetragenes Gebirge seinen Abtrag fast ganz selbst zurück (Gewicht 20 gegen 1 im
 * Umland), und die Kämme wachsen (Bericht `project-control/discovery/d-regionale-erosion-2026-10-09.md`). Mit Sättigung
 * zählt das Gewicht einer Zelle höchstens so viel, wie sie für `saturation` Schritt Hebung je Runde braucht:
 *
 *     q(x)  = Σ_y K(x − y) · loss(y) / W(y)                    erste Verteilung, Hebung je Gewicht
 *     w'(x) = min(w(x), saturation / q(x))                     gesättigtes Gewicht
 *     Δh(x) = w'(x) · Σ_y K(x − y) · loss(y) / W'(y),   W'(y) = Σ_z K(z − y) · w'(z)
 *
 * Wo der Abtrag schwach ist (w · q ≤ `saturation`), ist w' = w und alles bleibt wie ohne Sättigung. Wo er stark ist,
 * zählen Gebirge und Umland ähnlicher, und der Abtrag geht mehr ins Umland statt auf die eigenen Kämme. Eine Regel für
 * jede Zelle, ohne Namen oder Lage. `K` ist symmetrisch, also bleibt die Masse je Quellzelle erhalten wie ohne
 * Sättigung. Δh ist nur im Kern um die Verlustzellen von null verschieden; über `q` und `W'` wirkt eine Änderung
 * schwach weiter (je Runde höchstens dreimal so weit wie der Kern).
 */
export function redistributeSaturated(
    height: Float32Array,
    start: Float32Array,
    work: Float32Array,
    fields: SaturationFields,
    weightSum: Float32Array,
    weightAt: (k: number) => number,
    n: number,
    radiusCells: number,
    saturation: number,
): { clampedCells: number; unplacedLoss: number; saturatedCells: number } {
    const { first, sum } = fields;
    const cells = height.length;
    const unplacedLoss = saturatedSteps.first(height, start, weightSum, first, 0, cells);
    blur(first, work, n, radiusCells);
    const saturatedCells = saturatedSteps.weights(first, work, sum, weightAt, saturation, 0, cells);
    blur(sum, first, n, radiusCells);
    saturatedSteps.second(height, start, sum, first, 0, cells);
    blur(first, start, n, radiusCells);
    const clampedCells = saturatedSteps.apply(height, work, first, 0, cells);
    return { clampedCells, unplacedLoss, saturatedCells };
}
