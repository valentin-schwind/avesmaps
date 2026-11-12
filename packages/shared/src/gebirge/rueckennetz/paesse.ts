/**
 * Pässe (Entwurf, Plan Topographie Stufe 3, Betreiber „B“: der Korridor glättet bis zur Grenzsteigung, was darüber bleibt, ist Befund).
 * Entlang der Passroute wird das Gelände zum Sattel gesenkt: das Längsprofil nur nach unten auf die Grenzsteigung geglättet (vorwärts und
 * rückwärts), quer dazu weich über die Korridorbreite. Nie gehoben.
 * Grenzsteigung 30 % über den Messschritt der Wegprofile (0,25 E); ein Pass zeichnet keine Kehren, gemessen wird die Steigung des Hangs.
 */
import type { Raster } from "../raster.ts";

export interface Pass {
    id?: string;
    name?: string | null;
    punkte: [number, number][];
}

/** Grenzsteigung (Anteil) und Korridorbreite (halb, E). */
export const PASS_GRENZE = 0.3;
export const PASS_BREITE = 1;

/** Tastet einen Linienzug in Zellschritten ab, nur in der Fläche. */
function proben(r: Raster, punkte: readonly [number, number][]): { x: number; y: number; k: number }[] {
    const aus: { x: number; y: number; k: number }[] = [];
    for (let s = 1; s < punkte.length; s++) {
        const [ax, ay] = punkte[s - 1]!;
        const [bx, by] = punkte[s]!;
        const l = Math.hypot(bx - ax, by - ay);
        const n = Math.max(1, Math.ceil(l / r.cell));
        for (let t = s === 1 ? 0 : 1; t <= n; t++) {
            const x = ax + ((bx - ax) * t) / n;
            const y = ay + ((by - ay) * t) / n;
            const i = r.i(x);
            const j = r.j(y);
            if (i >= 0 && j >= 0 && i < r.w && j < r.hh && r.drin[j * r.w + i]) aus.push({ x, y, k: j * r.w + i });
        }
    }
    return aus;
}

/** Größte Steigung entlang des Passes (Anteil, je Messschritt 0,25 E). */
export function passSteigung(r: Raster, h: ArrayLike<number>, pass: Pass): number {
    const p = proben(r, pass.punkte);
    let max = 0;
    for (let s = 1; s < p.length; s++) {
        const d = (Math.hypot(p[s]!.x - p[s - 1]!.x, p[s]!.y - p[s - 1]!.y) * r.cellS) / r.cell;
        if (d > 0) max = Math.max(max, Math.abs((h[p[s]!.k] as number) - (h[p[s - 1]!.k] as number)) / d);
    }
    return max;
}

/** Senkt das Gelände entlang jedes Passes zum Sattel (in `h`). */
export function legePaesse(r: Raster, h: Float64Array, paesse: readonly Pass[]): void {
    const schrittE = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
    for (const pass of paesse) {
        const p = proben(r, pass.punkte);
        if (p.length < 2) continue;
        // Ziel längs: nur senken, Steigung je E höchstens Grenze × 3000 Schritt.
        const ziel = p.map((q) => h[q.k] as number);
        const proE = PASS_GRENZE * (r.cellS / r.cell);
        for (let s = 1; s < p.length; s++)
            ziel[s] = Math.min(ziel[s]!, ziel[s - 1]! + proE * schrittE(p[s - 1]!, p[s]!));
        for (let s = p.length - 2; s >= 0; s--)
            ziel[s] = Math.min(ziel[s]!, ziel[s + 1]! + proE * schrittE(p[s + 1]!, p[s]!));
        // Quer: weich über die Korridorbreite.
        const reich = Math.ceil(PASS_BREITE / r.cell) + 1;
        const besucht = new Map<number, number>();
        p.forEach((q, s) => {
            const pi = q.k % r.w;
            const pj = Math.floor(q.k / r.w);
            for (let j = Math.max(0, pj - reich); j <= Math.min(r.hh - 1, pj + reich); j++)
                for (let i = Math.max(0, pi - reich); i <= Math.min(r.w - 1, pi + reich); i++) {
                    const k = j * r.w + i;
                    if (!r.drin[k]) continue;
                    const d = Math.hypot(r.x(i) - q.x, r.y(j) - q.y);
                    if (d > PASS_BREITE) continue;
                    // Bis eine Zellweite neben der Route genau auf dem Sattelprofil, dann weich bis zur Korridorbreite.
                    const f = Math.max(0, d - r.cell) / (PASS_BREITE - r.cell);
                    const weich = f * f * (3 - 2 * f);
                    const neu = Math.min(h[k] as number, ziel[s]! + ((h[k] as number) - ziel[s]!) * weich);
                    const bisher = besucht.get(k);
                    besucht.set(k, bisher === undefined ? neu : Math.min(bisher, neu));
                }
        });
        for (const [k, v] of besucht) h[k] = Math.min(h[k] as number, v);
        // Nachglätten auf den echten Zellen: Der Korridor nimmt je Zelle das Tiefste aller nahen Routenstellen; wo die Route an sich selbst
        // oder einem Gipfel vorbeiläuft, entstehen so Stufen. Das Längsprofil der Routenzellen noch einmal nur nach unten begrenzen.
        for (let runde = 0; runde < 3; runde++) {
            const werte = p.map((q) => h[q.k] as number);
            for (let s = 1; s < p.length; s++)
                werte[s] = Math.min(werte[s]!, werte[s - 1]! + proE * schrittE(p[s - 1]!, p[s]!));
            for (let s = p.length - 2; s >= 0; s--)
                werte[s] = Math.min(werte[s]!, werte[s + 1]! + proE * schrittE(p[s + 1]!, p[s]!));
            p.forEach((q, s) => (h[q.k] = Math.min(h[q.k] as number, werte[s]!)));
        }
    }
}
