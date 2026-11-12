/**
 * Der Kamm als Randbedingung: entlang der Kurve oder des Spannbaums über den Gipfeln, dazu das
 * Plateau als Isolinie des Randabstands (hydrologie.js#L647-913, aff0449a5).
 */
import { ECOSYSTEM_HYDRO_PLATEAU_VORGABE } from "./constants.ts";
import { randAbstand, type Raster } from "./raster.ts";

/** Ein Stützpunkt des Kamms: Gipfel oder Kurvenpunkt auf Maximalhöhe. */
export interface KammPunkt {
    x: number;
    y: number;
    h: number | null;
}

interface HoehenPunkt {
    x: number;
    y: number;
    h: number;
}

/** Minimaler Spannbaum (Prim) über die Punkte, als Indexpaare (hydrologie.js#L647-673). */
export function spannbaum(punkte: readonly { x: number; y: number }[]): [number, number][] {
    const n = punkte.length;
    if (n < 2) {
        return [];
    }
    const drin = new Array<boolean>(n).fill(false);
    const kanten: [number, number][] = [];
    drin[0] = true;
    for (let s = 1; s < n; s++) {
        let bi = -1;
        let bj = -1;
        let bd = Infinity;
        for (let i = 0; i < n; i++) {
            if (!drin[i]) continue;
            const pi = punkte[i] as { x: number; y: number };
            for (let j = 0; j < n; j++) {
                if (drin[j]) continue;
                const pj = punkte[j] as { x: number; y: number };
                const d = Math.hypot(pi.x - pj.x, pi.y - pj.y);
                if (d < bd) {
                    bd = d;
                    bi = i;
                    bj = j;
                }
            }
        }
        if (bj < 0) break;
        drin[bj] = true;
        kanten.push([bi, bj]);
    }
    return kanten;
}

/** Kammhöhe an einer Stelle: invers quadratisch gewichtete Gipfel, zwischen ihnen auf `sattel` abgesenkt (hydrologie.js#L701-720). */
export function kammHoeheAn(x: number, y: number, pts: readonly HoehenPunkt[], sattel: number): number {
    let summe = 0;
    let gewicht = 0;
    let naechster = Infinity;
    for (const p of pts) {
        const d2 = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y);
        if (d2 < 1e-9) {
            return p.h;
        }
        const g = 1 / d2;
        summe += g * p.h;
        gewicht += g;
        if (d2 < naechster) {
            naechster = d2;
        }
    }
    if (!(gewicht > 0)) {
        return 0;
    }
    const mittel = summe / gewicht;
    const d = Math.sqrt(naechster);
    const nah = Math.exp((-d * d) / (2 * 4 * 4));
    return mittel * (sattel + (1 - sattel) * nah);
}

/**
 * Stempelt den Kamm, nur wo er anhebt und nie auf eine feste Zelle; danach das Plateau.
 * Gibt die Zahl gesetzter Zellen zurück (hydrologie.js#L836-913).
 */
export function stempleKamm(
    r: Raster,
    h: Float64Array,
    fest: Uint8Array,
    gipfel: readonly KammPunkt[],
    sattel: number,
    vorgabe: number,
    kurve: readonly (readonly number[])[] | null | undefined,
    marke: Uint8Array | null,
    grundhoehe: number,
    plateau: number,
): number {
    const standard = Number(vorgabe) > 0 ? Number(vorgabe) : 5000;
    const pts: HoehenPunkt[] = gipfel.map((p) => ({
        x: p.x,
        y: p.y,
        h: Number(p.h) > 0 ? Number(p.h) : standard,
    }));
    if (!pts.length) {
        return 0;
    }
    const sockel = Number(grundhoehe) > 0 ? Number(grundhoehe) : 0;

    // Die echte Kurve, sonst der Spannbaum über die Punkte.
    let linien: (readonly (readonly number[])[])[];
    if (Array.isArray(kurve) && kurve.length >= 2) {
        linien = [kurve];
    } else {
        linien = spannbaum(pts).map(([a, c]) => {
            const pa = pts[a] as HoehenPunkt;
            const pc = pts[c] as HoehenPunkt;
            return [
                [pa.x, pa.y],
                [pc.x, pc.y],
            ];
        });
    }

    let zellen = 0;
    for (const linie of linien) {
        for (let s = 1; s < linie.length; s++) {
            const [ax, ay] = linie[s - 1] as [number, number];
            const [bx, by] = linie[s] as [number, number];
            const len = Math.hypot(bx - ax, by - ay);
            const schritte = Math.max(2, Math.ceil((len / r.cell) * 2));
            for (let t = 0; t <= schritte; t++) {
                const u = t / schritte;
                const x = ax + (bx - ax) * u;
                const y = ay + (by - ay) * u;
                const i = r.i(x);
                const j = r.j(y);
                if (i < 0 || j < 0 || i >= r.w || j >= r.hh) {
                    continue;
                }
                const k = j * r.w + i;
                if (!r.drin[k] || fest[k]) {
                    continue;
                }
                const H = Math.max(kammHoeheAn(x, y, pts, sattel), sockel);
                if (H > (h[k] as number)) {
                    h[k] = H;
                    fest[k] = 1;
                    zellen++;
                    if (marke) {
                        marke[k] = 1;
                    }
                }
            }
        }
    }

    // Das Plateau: jede Zelle ab `anteil · größter Randabstand` auf Kammhöhe.
    const anteil = Number.isFinite(Number(plateau)) ? Number(plateau) : ECOSYSTEM_HYDRO_PLATEAU_VORGABE;
    if (anteil < 1 && anteil >= 0 && pts.length) {
        const dist = randAbstand(r);
        let dmax = 0;
        for (let k = 0; k < dist.length; k++) {
            if (r.drin[k] && (dist[k] as number) > dmax) {
                dmax = dist[k] as number;
            }
        }
        const schwelle = anteil * dmax;
        for (let j = 0; j < r.hh; j++) {
            for (let i = 0; i < r.w; i++) {
                const k = j * r.w + i;
                if (!r.drin[k] || fest[k] || (dist[k] as number) < schwelle) {
                    continue;
                }
                const H = Math.max(kammHoeheAn(r.x(i), r.y(j), pts, sattel), sockel);
                if (H > (h[k] as number)) {
                    h[k] = H;
                    fest[k] = 1;
                    zellen++;
                    if (marke) {
                        marke[k] = 1;
                    }
                }
            }
        }
    }
    return zellen;
}
