/**
 * Die Gipfel: Kerne als feste Zellen, danach die Einzelberge additiv (hydrologie.js#L512-643, aff0449a5).
 */
import { ECOSYSTEM_HYDRO_BERGFORM } from "./constants.ts";
import type { Raster } from "./raster.ts";
import type { V12Peak } from "./types.ts";

/** Die 3×3-Kerne, der höhere gewinnt; gibt die Zahl gesetzter Zellen zurück (hydrologie.js#L512-542). */
export function stempleGipfel(
    r: Raster,
    h: Float64Array,
    fest: Uint8Array,
    gipfel: readonly V12Peak[],
    vorgabe: number,
    kern: Uint8Array | null,
): number {
    const standard = Number(vorgabe) > 0 ? Number(vorgabe) : 5000;
    let gesetzt = 0;
    for (const p of gipfel) {
        const i = r.i(p.x);
        const j = r.j(p.y);
        if (i < 0 || j < 0 || i >= r.w || j >= r.hh) {
            continue;
        }
        const H = Number(p.h) > 0 ? Number(p.h) : standard;
        for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
                const ii = i + di;
                const jj = j + dj;
                if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.hh) {
                    continue;
                }
                const k = jj * r.w + ii;
                if (!r.drin[k]) {
                    continue;
                }
                if (H >= (h[k] as number)) {
                    h[k] = H;
                    fest[k] = 1;
                    gesetzt++;
                    if (kern) {
                        kern[k] = 1;
                    }
                }
            }
        }
    }
    return gesetzt;
}

/**
 * Die Einzelberge als Überhöhung über dem Niveau am Kegelrand, Radius höchstens 0,72 × Abstand zum
 * nächsten Gipfel; `radius` undefined nimmt die Vorgabe 2,5, eine ausdrückliche 0 heißt kein Kegel.
 * Gibt die Zahl berührter Zellen zurück (hydrologie.js#L563-643).
 */
export function addiereGipfelkegel(
    r: Raster,
    h: Float64Array,
    gipfel: readonly V12Peak[],
    radius: number | null | undefined,
    vorgabe: number,
    fest: Uint8Array | null,
    mantel: Uint8Array | null,
): number {
    const rad0 =
        radius === null || radius === undefined ? ECOSYSTEM_HYDRO_BERGFORM : Number(radius) > 0 ? Number(radius) : 0;
    if (!(rad0 > 0)) {
        return 0;
    }
    const standard = Number(vorgabe) > 0 ? Number(vorgabe) : 5000;
    let gesetzt = 0;

    for (const p of gipfel) {
        const i = r.i(p.x);
        const j = r.j(p.y);
        if (i < 0 || j < 0 || i >= r.w || j >= r.hh || !r.drin[j * r.w + i]) {
            continue;
        }
        const H = Number(p.h) > 0 ? Number(p.h) : standard;
        let naechster = Infinity;
        for (const q of gipfel) {
            if (q === p) {
                continue;
            }
            const d = Math.hypot(p.x - q.x, p.y - q.y);
            if (d < naechster) {
                naechster = d;
            }
        }
        const rad = Math.min(rad0, 0.72 * naechster);
        if (!(rad > 0)) {
            continue;
        }

        // Die Basis ist das mittlere Niveau im Ring 0,85·rad bis rad um den Gipfel.
        const reich = Math.ceil(rad / r.cell);
        let randSumme = 0;
        let randZahl = 0;
        for (let dj = -reich; dj <= reich; dj++) {
            for (let di = -reich; di <= reich; di++) {
                const ii = i + di;
                const jj = j + dj;
                if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.hh) {
                    continue;
                }
                const k = jj * r.w + ii;
                if (!r.drin[k]) {
                    continue;
                }
                const d = Math.hypot(r.x(ii) - p.x, r.y(jj) - p.y);
                if (d < 0.85 * rad || d > rad) {
                    continue;
                }
                randSumme += h[k] as number;
                randZahl++;
            }
        }
        const basis = randZahl > 0 ? randSumme / randZahl : 0;
        const ueber = H - basis;
        if (!(ueber > 0)) {
            continue;
        }

        for (let dj = -reich; dj <= reich; dj++) {
            for (let di = -reich; di <= reich; di++) {
                const ii = i + di;
                const jj = j + dj;
                if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.hh) {
                    continue;
                }
                const k = jj * r.w + ii;
                if (!r.drin[k] || (fest && fest[k])) {
                    continue;
                }
                const d = Math.hypot(r.x(ii) - p.x, r.y(jj) - p.y);
                if (d >= rad) {
                    continue;
                }
                const u = 1 - (d / rad) * (d / rad);
                h[k] = (h[k] as number) + ueber * u * u * u;
                if (mantel) {
                    mantel[k] = 1;
                }
                gesetzt++;
            }
        }
    }
    return gesetzt;
}
