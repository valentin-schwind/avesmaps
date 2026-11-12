import type { RueckenErgebnis } from "@avesmaps3d/shared";

/**
 * Die Form eines Gebirgsrasters messen (WI-0249 P0): Gipfelzellen, Prominenz und Kopf im Umkreis eines gesetzten Punkts, dazu der Lauf
 * der Flüsse. Die Tests des Rückennetzes (`gebirge-rueckennetz.test.ts`) prüfen damit die tatsächliche Form im Ergebnisraster, nicht
 * nur die Zielhöhe einer Zelle; spätere Pakete der Formerhaltung (P2) messen mit denselben Hilfen.
 */

/** Das Ergebnisraster, wie es die Vorschau zeigt: Höhen in Schritt je Zelle, Zeile 0 = Süden, `eigen` = die Fläche. */
export type FormRaster = Pick<RueckenErgebnis, "w" | "hh" | "cell" | "bounds" | "eigen" | "h">;

/** Eine Gipfelzelle zählt als Kopf, wenn sie mindestens so viel Prominenz (Schritt) hat; darunter ist es Rasterrauschen. */
export const KOPF_PROMINENZ_MIN = 1;
/** Umkreis (Zellen), in dem der Kopf eines gesetzten Punkts liegen darf: bei Unterauflösung ein bis zwei Zellen daneben. */
export const KOPF_REICH_ZELLEN = 2;

/** Die Zelle an einem Punkt (gerundet wie das Raster der Rechnung); -1 außerhalb der Fläche. */
export function zelleAn(e: FormRaster, x: number, y: number): number {
    const i = Math.round((x - e.bounds.min_x) / e.cell);
    const j = Math.round((y - e.bounds.min_y) / e.cell);
    return i >= 0 && j >= 0 && i < e.w && j < e.hh && e.eigen[j * e.w + i] ? j * e.w + i : -1;
}

/** Strikte Gipfelzelle: höher als jeder ihrer Nachbarn (8er-Nachbarschaft) in der Fläche. */
export function istGipfelzelle(e: FormRaster, k: number): boolean {
    const i = k % e.w;
    const j = (k - i) / e.w;
    for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= e.w || nj >= e.hh) continue;
            const m = nj * e.w + ni;
            if (e.eigen[m] && (e.h[m] as number) >= (e.h[k] as number)) return false;
        }
    return true;
}

/** Ein Haufen nach Schlüssel (größter zuerst) für die Prominenz. */
class SattelHaufen {
    private readonly wert: number[] = [];
    private readonly zelle: number[] = [];
    get leer(): boolean {
        return this.wert.length === 0;
    }
    push(wert: number, zelle: number): void {
        let i = this.wert.length;
        this.wert.push(wert);
        this.zelle.push(zelle);
        while (i > 0) {
            const e = (i - 1) >> 1;
            if ((this.wert[e] as number) >= wert) break;
            this.tausche(i, e);
            i = e;
        }
    }
    pop(): { wert: number; zelle: number } {
        const oben = { wert: this.wert[0] as number, zelle: this.zelle[0] as number };
        const wert = this.wert.pop() as number;
        const zelle = this.zelle.pop() as number;
        if (this.wert.length > 0) {
            this.wert[0] = wert;
            this.zelle[0] = zelle;
            let i = 0;
            for (;;) {
                const a = 2 * i + 1;
                const b = a + 1;
                let m = i;
                if (a < this.wert.length && (this.wert[a] as number) > (this.wert[m] as number)) m = a;
                if (b < this.wert.length && (this.wert[b] as number) > (this.wert[m] as number)) m = b;
                if (m === i) break;
                this.tausche(i, m);
                i = m;
            }
        }
        return oben;
    }
    private tausche(a: number, b: number): void {
        [this.wert[a], this.wert[b]] = [this.wert[b] as number, this.wert[a] as number];
        [this.zelle[a], this.zelle[b]] = [this.zelle[b] as number, this.zelle[a] as number];
    }
}

/**
 * Prominenz einer Zelle (Schritt): ihre Höhe minus die Höhe des höchsten Sattels, über den sie mit einer gleich hohen oder höheren Zelle
 * zusammenhängt (8er-Nachbarschaft, nur in der Fläche). Der höchste Punkt der Fläche hat keinen solchen Weg; seine Prominenz zählt
 * bis zur tiefsten erreichbaren Zelle. 0 heißt: Die Zelle liegt auf einer Flanke oder Schulter, über die man nicht absteigen muss.
 */
export function prominenz(e: FormRaster, k0: number): number {
    const hoehe = e.h[k0] as number;
    const bester = new Float64Array(e.w * e.hh).fill(-Infinity);
    const haufen = new SattelHaufen();
    bester[k0] = hoehe;
    haufen.push(hoehe, k0);
    let tiefste = hoehe;
    while (!haufen.leer) {
        const { wert, zelle: k } = haufen.pop();
        if (wert < (bester[k] as number)) continue;
        if (k !== k0 && (e.h[k] as number) >= hoehe) return hoehe - wert;
        tiefste = Math.min(tiefste, wert);
        const i = k % e.w;
        const j = (k - i) / e.w;
        for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
                if (!di && !dj) continue;
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= e.w || nj >= e.hh) continue;
                const m = nj * e.w + ni;
                if (!e.eigen[m]) continue;
                const schluessel = Math.min(wert, e.h[m] as number);
                if (schluessel > (bester[m] as number)) {
                    bester[m] = schluessel;
                    haufen.push(schluessel, m);
                }
            }
    }
    return hoehe - tiefste;
}

export interface Kopf {
    zelle: number;
    prominenz: number;
}

/**
 * Der Kopf eines gesetzten Punkts: seine eigene Zelle, wenn sie eine Gipfelzelle mit messbarer Prominenz ist, sonst die Gipfelzelle mit der
 * größten Prominenz im Umkreis von `reich` Zellen (Unterauflösung); `null`, wenn der Punkt nur auf einer Schulter oder Flanke steht.
 */
export function findeKopf(e: FormRaster, k0: number, reich: number = KOPF_REICH_ZELLEN): Kopf | null {
    if (istGipfelzelle(e, k0)) {
        const p = prominenz(e, k0);
        if (p >= KOPF_PROMINENZ_MIN) return { zelle: k0, prominenz: p };
    }
    const pi = k0 % e.w;
    const pj = (k0 - pi) / e.w;
    let beste: Kopf | null = null;
    for (let j = Math.max(0, pj - reich); j <= Math.min(e.hh - 1, pj + reich); j++)
        for (let i = Math.max(0, pi - reich); i <= Math.min(e.w - 1, pi + reich); i++) {
            const k = j * e.w + i;
            if (k === k0 || !e.eigen[k] || !istGipfelzelle(e, k)) continue;
            const p = prominenz(e, k);
            if (p >= KOPF_PROMINENZ_MIN && (beste === null || p > beste.prominenz)) beste = { zelle: k, prominenz: p };
        }
    return beste;
}

/** Ein Flusslauf wie in der Eingabe der Rechnung. */
export interface FlussLauf {
    p: readonly (readonly [number, number])[];
    dir?: string | null;
}

/** Die Zellen, die ein Flusslauf berührt (so abgetastet wie der Einschnitt der Rechnung, `lasseFluesseFallen`). */
export function flussZellen(e: FormRaster, fluesse: readonly FlussLauf[]): Set<number> {
    const zellen = new Set<number>();
    for (const fluss of fluesse)
        for (let s = 1; s < fluss.p.length; s++) {
            const [ax, ay] = fluss.p[s - 1] as readonly [number, number];
            const [bx, by] = fluss.p[s] as readonly [number, number];
            const stueck = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (e.cell * 0.05)));
            for (let t = 0; t <= stueck; t++) {
                const k = zelleAn(e, ax + ((bx - ax) * t) / stueck, ay + ((by - ay) * t) / stueck);
                if (k >= 0) zellen.add(k);
            }
        }
    return zellen;
}

/**
 * Der größte Anstieg (Schritt) entlang eines Flusslaufs in Fließrichtung, im Abstand einer Zelle abgetastet. Ein Fluss fließt talwärts:
 * Mehr als ein Schritt Anstieg heißt, er fließt bergauf. Ohne Richtung gilt die vom höheren zum tieferen Ende.
 */
export function flussAnstieg(e: FormRaster, fluss: FlussLauf): number {
    const proben: number[] = [];
    for (let s = 1; s < fluss.p.length; s++) {
        const [ax, ay] = fluss.p[s - 1] as readonly [number, number];
        const [bx, by] = fluss.p[s] as readonly [number, number];
        const l = Math.hypot(bx - ax, by - ay);
        for (let u = 0; u < l; u += e.cell) {
            const k = zelleAn(e, ax + ((bx - ax) * u) / (l || 1), ay + ((by - ay) * u) / (l || 1));
            if (k >= 0) proben.push(e.h[k] as number);
        }
    }
    if (proben.length < 2) return 0;
    const rueckwaerts =
        fluss.dir === "reverse" || (fluss.dir !== "forward" && (proben[0] as number) < (proben.at(-1) as number));
    const lauf = rueckwaerts ? proben.reverse() : proben;
    let max = 0;
    for (let s = 1; s < lauf.length; s++) max = Math.max(max, (lauf[s] as number) - (lauf[s - 1] as number));
    return max;
}
