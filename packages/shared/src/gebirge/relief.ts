/**
 * Das Grundrelief als Randwertaufgabe (SOR, Rot-Schwarz, Mehrgitter) und die Hypsometrie
 * (hydrologie.js#L781-834, #L1345-1406, aff0449a5).
 */
import { ECOSYSTEM_HYDRO_HYPSO_POTENZ_MAX, ECOSYSTEM_HYDRO_HYPSO_POTENZ_MIN } from "./constants.ts";

/** Ein Durchgang einer Farbe; Nachbarn außerhalb zählen als 0 (hydrologie.js#L1345-1356). */
function sorDurchgang(
    h: Float64Array,
    w: number,
    hh: number,
    drin: Uint8Array,
    fest: Uint8Array,
    omega: number,
    farbe: number,
): void {
    for (let j = 1; j < hh - 1; j++) {
        for (let i = 1 + ((j + farbe) & 1); i < w - 1; i += 2) {
            const k = j * w + i;
            if (!drin[k] || fest[k]) continue;
            const s =
                (drin[k + 1] ? (h[k + 1] as number) : 0) +
                (drin[k - 1] ? (h[k - 1] as number) : 0) +
                (drin[k + w] ? (h[k + w] as number) : 0) +
                (drin[k - w] ? (h[k - w] as number) : 0);
            const hk = h[k] as number;
            const neu = hk + omega * (s / 4 - hk);
            h[k] = neu < 0 ? 0 : neu;
        }
    }
}

interface Grob {
    h: Float64Array;
    drin: Uint8Array;
    fest: Uint8Array;
    w: number;
    hh: number;
}

/** Halbiert das Gitter: Mittel der Zellen drin, fest wenn eine fest ist (hydrologie.js#L1358-1383). */
function vergroebern(h: Float64Array, drin: Uint8Array, fest: Uint8Array, w: number, hh: number): Grob {
    const w2 = w >> 1;
    const h2 = hh >> 1;
    const H = new Float64Array(w2 * h2);
    const D = new Uint8Array(w2 * h2);
    const F = new Uint8Array(w2 * h2);
    for (let j = 0; j < h2; j++) {
        for (let i = 0; i < w2; i++) {
            let s = 0;
            let n = 0;
            let f = 0;
            let d = 0;
            for (let dj = 0; dj < 2; dj++) {
                for (let di = 0; di < 2; di++) {
                    if (2 * j + dj >= hh || 2 * i + di >= w) continue;
                    const k = (2 * j + dj) * w + (2 * i + di);
                    if (drin[k]) {
                        d = 1;
                        s += h[k] as number;
                        n++;
                        if (fest[k]) f = 1;
                    }
                }
            }
            const K = j * w2 + i;
            D[K] = d;
            F[K] = f;
            H[K] = n ? s / n : 0;
        }
    }
    return { h: H, drin: D, fest: F, w: w2, hh: h2 };
}

/** Grob vorlösen, auf das feine Gitter übertragen, dann fein iterieren (hydrologie.js#L1388-1406). */
export function loeseRelief(
    h: Float64Array,
    w: number,
    hh: number,
    drin: Uint8Array,
    fest: Uint8Array,
    stufen: number,
    iterGrob: number,
    iterFein: number,
    omega: number,
): Float64Array {
    if (stufen > 0 && w > 32 && hh > 32) {
        const g = vergroebern(h, drin, fest, w, hh);
        loeseRelief(g.h, g.w, g.hh, g.drin, g.fest, stufen - 1, iterGrob, iterGrob, omega);
        for (let j = 0; j < hh; j++) {
            for (let i = 0; i < w; i++) {
                const k = j * w + i;
                if (!drin[k] || fest[k]) continue;
                h[k] = g.h[Math.min(g.hh - 1, j >> 1) * g.w + Math.min(g.w - 1, i >> 1)] as number;
            }
        }
    }
    for (let n = 0; n < iterFein; n++) {
        sorDurchgang(h, w, hh, drin, fest, omega, 0);
        sorDurchgang(h, w, hh, drin, fest, omega, 1);
    }
    return h;
}

/** (Mittel − Min) / (Max − Min) über die Zellen drin (hydrologie.js#L781-796). */
export function hypsometrischesIntegral(h: Float64Array, drin: Uint8Array): number {
    let summe = 0;
    let n = 0;
    let max = -Infinity;
    let min = Infinity;
    for (let k = 0; k < h.length; k++) {
        if (!drin[k]) continue;
        const v = h[k] as number;
        summe += v;
        n++;
        if (v > max) max = v;
        if (v < min) min = v;
    }
    if (!n || !(max > min)) return 0;
    return (summe / n - min) / (max - min);
}

/**
 * Zieht das Feld per `max · (h/max)^p` auf ein Ziel-HI, die Potenz per Bisektion in 24 Schritten;
 * die Zellen in `fest` (hier die Gipfelkerne) bleiben (hydrologie.js#L809-834).
 */
export function zieheAufHypsometrie(
    h: Float64Array,
    drin: Uint8Array,
    fest: Uint8Array,
    ziel: number,
): { potenz: number; erreicht: number } {
    let max = 0;
    for (let k = 0; k < h.length; k++) {
        if (drin[k] && (h[k] as number) > max) max = h[k] as number;
    }
    if (!(max > 0)) return { potenz: 1, erreicht: 0 };
    const roh = h.slice();
    const versuch = (potenz: number): number => {
        for (let k = 0; k < h.length; k++) {
            const v = roh[k] as number;
            if (!drin[k] || v <= 0) continue;
            h[k] = fest[k] ? v : max * Math.pow(v / max, potenz);
        }
        return hypsometrischesIntegral(h, drin);
    };
    let lo = ECOSYSTEM_HYDRO_HYPSO_POTENZ_MIN;
    let hi = ECOSYSTEM_HYDRO_HYPSO_POTENZ_MAX;
    let potenz = 1;
    let erreicht = versuch(1);
    for (let it = 0; it < 24; it++) {
        potenz = (lo + hi) / 2;
        erreicht = versuch(potenz);
        if (erreicht > ziel) {
            lo = potenz;
        } else {
            hi = potenz;
        }
    }
    return { potenz, erreicht };
}
