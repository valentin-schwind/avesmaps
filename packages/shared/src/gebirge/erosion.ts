/**
 * Die Erosion: Senken füllen, D8, Akkumulation, Stream Power (implizit), Hangdiffusion und eine
 * gleichmäßige Hebung, die den Abtrag ersetzt (hydrologie.js#L1464-1741, aff0449a5).
 */
import type { Raster } from "./raster.ts";
import { streamPowerHeight } from "./stream-power.ts";

/**
 * Binärer Min-Heap wie Legacys `Heap` (hydrologie.js#L1464-1495), dieselben Vergleiche und Tausche,
 * also dieselbe Reihenfolge bei Gleichstand. Schlüssel und Zelle liegen in zwei Feldern statt in
 * einem Paar je Eintrag; jede Zelle kommt höchstens einmal hinein.
 */
class Heap {
    private readonly keys: Float64Array;
    private readonly vals: Int32Array;
    private n = 0;

    constructor(capacity: number) {
        this.keys = new Float64Array(capacity);
        this.vals = new Int32Array(capacity);
    }

    push(key: number, val: number): void {
        const keys = this.keys;
        const vals = this.vals;
        let i = this.n++;
        keys[i] = key;
        vals[i] = val;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if ((keys[p] as number) <= (keys[i] as number)) break;
            const tk = keys[p] as number;
            const tv = vals[p] as number;
            keys[p] = keys[i] as number;
            vals[p] = vals[i] as number;
            keys[i] = tk;
            vals[i] = tv;
            i = p;
        }
    }

    /** Die Zelle mit dem kleinsten Schlüssel. */
    pop(): number {
        const keys = this.keys;
        const vals = this.vals;
        const top = vals[0] as number;
        this.n--;
        const len = this.n;
        if (len) {
            keys[0] = keys[len] as number;
            vals[0] = vals[len] as number;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let s = i;
                if (l < len && (keys[l] as number) < (keys[s] as number)) s = l;
                if (r < len && (keys[r] as number) < (keys[s] as number)) s = r;
                if (s === i) break;
                const tk = keys[s] as number;
                const tv = vals[s] as number;
                keys[s] = keys[i] as number;
                vals[s] = vals[i] as number;
                keys[i] = tk;
                vals[i] = tv;
                i = s;
            }
        }
        return top;
    }

    size(): number {
        return this.n;
    }
}

/** Priority-Flood mit epsilon; Zellen in `senke` (Seen, Talsohlen) bleiben Senken (hydrologie.js#L1503-1545). */
function fuelleSenken(
    h: Float64Array,
    w: number,
    hh: number,
    drin: Uint8Array,
    eps: number,
    senke: Uint8Array | null,
): Float64Array {
    const out = new Float64Array(h.length);
    const fertig = new Uint8Array(h.length);
    const q = new Heap(h.length);
    for (let j = 0; j < hh; j++) {
        for (let i = 0; i < w; i++) {
            const k = j * w + i;
            if (!drin[k]) {
                fertig[k] = 1;
                continue;
            }
            let rand = i === 0 || j === 0 || i === w - 1 || j === hh - 1;
            if (!rand) {
                for (let dj = -1; dj <= 1 && !rand; dj++) {
                    for (let di = -1; di <= 1; di++) {
                        if (!drin[(j + dj) * w + i + di]) {
                            rand = true;
                            break;
                        }
                    }
                }
            }
            if (rand) {
                out[k] = h[k] as number;
                fertig[k] = 1;
                q.push(h[k] as number, k);
            } else {
                out[k] = Infinity;
            }
        }
    }
    while (q.size()) {
        const k = q.pop();
        const i = k % w;
        const j = (k - i) / w;
        for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
                if (!di && !dj) continue;
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= w || nj >= hh) continue;
                const nk = nj * w + ni;
                if (fertig[nk] || !drin[nk]) continue;
                out[nk] = senke && senke[nk] ? (h[nk] as number) : Math.max(h[nk] as number, (out[k] as number) + eps);
                fertig[nk] = 1;
                q.push(out[nk] as number, nk);
            }
        }
    }
    for (let k = 0; k < out.length; k++) {
        if (!drin[k] || !Number.isFinite(out[k] as number)) out[k] = h[k] as number;
    }
    return out;
}

interface Fliessnetz {
    /** Empfänger je Zelle; -1 keiner, -2 fließt aus der Fläche. */
    rec: Int32Array;
    dist: Float64Array;
    /** Zellen in topologischer Folge, Empfänger nach ihren Gebern. */
    ordnung: Int32Array;
    n: number;
}

/** D8 nach steilstem Gefälle je Länge; außen zählt als 0 (hydrologie.js#L1551-1593). */
function flussrichtung(h: Float64Array, w: number, hh: number, drin: Uint8Array, cellS: number): Fliessnetz {
    const rec = new Int32Array(h.length).fill(-1);
    const dist = new Float64Array(h.length);
    const diag = cellS * Math.SQRT2;
    for (let j = 0; j < hh; j++) {
        for (let i = 0; i < w; i++) {
            const k = j * w + i;
            if (!drin[k]) continue;
            let best = 0;
            let bk = -1;
            let bd = cellS;
            for (let dj = -1; dj <= 1; dj++) {
                for (let di = -1; di <= 1; di++) {
                    if (!di && !dj) continue;
                    const ni = i + di;
                    const nj = j + dj;
                    if (ni < 0 || nj < 0 || ni >= w || nj >= hh) continue;
                    const nk = nj * w + ni;
                    const d = di && dj ? diag : cellS;
                    const s = ((h[k] as number) - (drin[nk] ? (h[nk] as number) : 0)) / d;
                    if (s > best) {
                        best = s;
                        bk = drin[nk] ? nk : -2;
                        bd = d;
                    }
                }
            }
            rec[k] = bk;
            dist[k] = bd;
        }
    }
    // Topologische Folge per Zuflusszahl, abgearbeitet über einen Stapel.
    const nrec = new Int32Array(h.length);
    for (let k = 0; k < h.length; k++) {
        const e = rec[k] as number;
        if (drin[k] && e >= 0) nrec[e] = (nrec[e] as number) + 1;
    }
    const stapel = new Int32Array(h.length);
    let sp = 0;
    const ordnung = new Int32Array(h.length);
    let op = 0;
    for (let k = 0; k < h.length; k++) {
        if (drin[k] && nrec[k] === 0) stapel[sp++] = k;
    }
    while (sp) {
        const k = stapel[--sp] as number;
        ordnung[op++] = k;
        const e = rec[k] as number;
        if (e >= 0) {
            nrec[e] = (nrec[e] as number) - 1;
            if (nrec[e] === 0) stapel[sp++] = e;
        }
    }
    return { rec, dist, ordnung, n: op };
}

/** Fläche je Zelle, in topologischer Folge an den Empfänger weitergereicht (hydrologie.js#L1600-1611). */
function akkumuliere(
    fd: Fliessnetz,
    drin: Uint8Array,
    zellFlaeche: number,
    vorgabe: Float64Array | null,
): Float64Array {
    const acc = new Float64Array(drin.length);
    for (let k = 0; k < drin.length; k++) {
        if (drin[k]) acc[k] = zellFlaeche + (vorgabe ? (vorgabe[k] as number) : 0);
    }
    for (let n = 0; n < fd.n; n++) {
        const k = fd.ordnung[n] as number;
        const e = fd.rec[k] as number;
        if (e >= 0) acc[e] = (acc[e] as number) + (acc[k] as number);
    }
    return acc;
}

/** Stream Power implizit (Braun & Willett 2013), rückwärts in topologischer Folge (hydrologie.js#L1623-1633). */
function streamPower(
    h: Float64Array,
    fd: Fliessnetz,
    acc: Float64Array,
    K: number,
    m: number,
    dt: number,
    fest: Uint8Array | null,
): void {
    for (let n = fd.n - 1; n >= 0; n--) {
        const k = fd.ordnung[n] as number;
        if (fest && fest[k]) continue;
        const r = fd.rec[k] as number;
        const hr = r >= 0 ? (h[r] as number) : 0;
        const hk = h[k] as number;
        if (hk <= hr) continue;
        h[k] = streamPowerHeight(hk, hr, acc[k] as number, K, m, dt, fd.dist[k] as number);
    }
}

/** Explizite Hangdiffusion in stabilen Teilschritten; außen zählt als 0 (hydrologie.js#L1642-1665). */
function diffundiere(
    h: Float64Array,
    w: number,
    hh: number,
    drin: Uint8Array,
    D: number,
    dt: number,
    cellS: number,
    fest: Uint8Array | null,
): Float64Array {
    const gesamt = (D * dt) / (cellS * cellS);
    const schritte = Math.max(1, Math.ceil(gesamt / 0.2));
    const f = gesamt / schritte;
    let cur = h;
    for (let s = 0; s < schritte; s++) {
        const out = cur.slice();
        for (let j = 1; j < hh - 1; j++) {
            for (let i = 1; i < w - 1; i++) {
                const k = j * w + i;
                if (!drin[k] || (fest && fest[k])) continue;
                const e = drin[k + 1] ? (cur[k + 1] as number) : 0;
                const we = drin[k - 1] ? (cur[k - 1] as number) : 0;
                const su = drin[k + w] ? (cur[k + w] as number) : 0;
                const no = drin[k - w] ? (cur[k - w] as number) : 0;
                const ck = cur[k] as number;
                const v = ck + f * (e + we + su + no - 4 * ck);
                out[k] = v < 0 ? 0 : v;
            }
        }
        cur = out;
    }
    return cur;
}

/** Was ein Erosionslauf über seine Schritte mitführt (hydrologie.js#L2060). */
export interface ErosionsZustand {
    r: Raster;
    h: Float64Array;
    /** Legacys Erosionsmaske `festEro`: Gipfelkern, Achse, See, Zellen mit Ausgangshöhe 0. */
    festEro: Uint8Array;
    senke: Uint8Array;
    hebungZellen: number;
    accVorgabe: Float64Array | null;
}

/** Ein Schritt samt Hebung um genau den Abtrag, gleichmäßig auf die freien Zellen (hydrologie.js#L1695-1741). */
export function erosionsSchritt(zustand: ErosionsZustand, opt: { K: number; D: number; m?: number }): void {
    const { r, senke } = zustand;
    const fest = zustand.festEro;
    let h = zustand.h;
    let vorher = 0;
    for (let k = 0; k < r.drin.length; k++) {
        if (r.drin[k]) vorher += h[k] as number;
    }

    const gefuellt = fuelleSenken(h, r.w, r.hh, r.drin, 1e-4, senke);
    const fd = flussrichtung(gefuellt, r.w, r.hh, r.drin, r.cellS);
    const acc = akkumuliere(fd, r.drin, r.cellS * r.cellS, zustand.accVorgabe);
    streamPower(h, fd, acc, opt.K, opt.m || 0.5, 1, fest);
    h = diffundiere(h, r.w, r.hh, r.drin, opt.D * r.cellS * r.cellS, 1, r.cellS, fest);

    let nachher = 0;
    for (let k = 0; k < r.drin.length; k++) {
        if (r.drin[k]) nachher += h[k] as number;
    }
    const verlust = vorher - nachher;
    if (verlust > 0 && zustand.hebungZellen > 0) {
        const je = verlust / zustand.hebungZellen;
        for (let k = 0; k < r.drin.length; k++) {
            if (r.drin[k] && !fest[k]) h[k] = (h[k] as number) + je;
        }
    }
    zustand.h = h;
}
