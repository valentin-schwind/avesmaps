/**
 * Das Rauschen, das die Wellenzüge des Wassers verbiegt (`wellen` in `wasser-shader.ts`, Textur `uRauschen`), wie es die Engine bis
 * WI-0288 Stufe 4 für ihr Wasser las: kachelbares Zellrauschen in drei Oktaven (`FS_NOISE`, Modus 1), Rot mit 4, Grün mit 8 Zellen je
 * Periode. Glatt und grob, damit der Verzug die Wellen nur biegt.
 *
 * 🪤 **Kein weißes Rauschen** (Betreiber 2026-11-09: „sieht noch ein bisschen aus wie ein säurebad - das war am anfang schöner“): Bis dahin
 * stand hier ein Zufallswert je Bildpunkt. Gelesen mit `p * 0,017` liegen dessen Bildpunkte 0,46 Karteneinheiten auseinander, kürzer als
 * eine Welle (0,9), und springen über die ganze Spanne; mit dem Verzug 3 faltete das die Wellen mehrfach, zu Wirbeln, Ringen und Marmor.
 * Das Zellrauschen ändert sich je Bildpunkt um höchstens wenige Hundertstel (`wasser-rauschen.test.ts`).
 */
export const WASSER_RAUSCHEN_GROESSE = 128;

/** Zwei Kanäle (RG8) zu je `n²` Werten, Zeile für Zeile; die Ränder schließen ohne Naht aneinander. */
export function wasserRauschen(n = WASSER_RAUSCHEN_GROESSE): Uint8Array {
    const d = new Uint8Array(n * n * 2);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const u = (x + 0.5) / n;
            const v = (y + 0.5) / n;
            const i = (y * n + x) * 2;
            d[i] = Math.round(zellOktaven(u, v, 4) * 255);
            d[i + 1] = Math.round(zellOktaven(u, v, 8) * 255);
        }
    }
    return d;
}

function zellOktaven(u: number, v: number, f: number): number {
    return (
        zellen(u * f, v * f, f) * 0.625 +
        zellen(u * 2 * f, v * 2 * f, 2 * f) * 0.25 +
        zellen(u * 4 * f, v * 4 * f, 4 * f) * 0.125
    );
}

/** 1 minus Abstand zum nächsten Zellpunkt; je Zelle ein Punkt, die Zellen wiederholen sich alle `f`. */
function zellen(x: number, y: number, f: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let naechster = Number.POSITIVE_INFINITY;
    for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
            const [px, py] = zellpunkt((((ix + i) % f) + f) % f, (((iy + j) % f) + f) % f, f);
            const dx = x - (ix + i + px);
            const dy = y - (iy + j + py);
            naechster = Math.min(naechster, dx * dx + dy * dy);
        }
    }
    return Math.min(1, Math.max(0, 1 - Math.sqrt(naechster)));
}

/** Lage des Punkts in der Zelle, 0 bis 1 je Achse, fest aus Zelle und Periode. */
function zellpunkt(x: number, y: number, f: number): [number, number] {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(f, 0x1b873593);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    const a = (h >>> 0) / 4294967296;
    h = Math.imul(h ^ 0x68e31da4, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
    h ^= h >>> 16;
    return [a, (h >>> 0) / 4294967296];
}
