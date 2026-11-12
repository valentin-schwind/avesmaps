/**
 * Das Raster einer Fläche und ihr Randabstand (hydrologie.js#L429-481, #L748-778, aff0449a5).
 */
import { ECOSYSTEM_HYDRO_ZELLWEITE, SCHRITT_JE_EINHEIT } from "./constants.ts";
import type { V12Bounds, V12Input } from "./types.ts";

export interface Raster {
    w: number;
    hh: number;
    cell: number;
    /** Das Rechengebiet. */
    drin: Uint8Array;
    drinN: number;
    /** Das Speichergebiet; ohne Verbund dasselbe Feld wie `drin` (hydrologie.js#L452). */
    eigen: Uint8Array;
    eigenN: number;
    bounds: V12Bounds;
    /** Zellweite in Schritt. */
    cellS: number;
    x: (i: number) => number;
    y: (j: number) => number;
    i: (x: number) => number;
    j: (y: number) => number;
}

/**
 * hydrologie.js#L429-481 im Pfad des Speicherlaufs: Zellweite 0,25, kein `deckel`, kein Verbund.
 * Die Zellmitten liegen auf `min + i · cell`, `bounds` wird roh übernommen.
 */
export function baueRaster(
    bounds: V12Bounds,
    cellSize: number,
    istDrin: (x: number, y: number) => boolean,
    vorschauZelleMin?: number,
): Raster {
    const spanX = bounds.max_x - bounds.min_x;
    const spanY = bounds.max_y - bounds.min_y;
    let cell = Number(cellSize) > 0 ? Number(cellSize) : ECOSYSTEM_HYDRO_ZELLWEITE;
    const minimum =
        vorschauZelleMin !== undefined && Number.isFinite(vorschauZelleMin) && vorschauZelleMin > 0
            ? vorschauZelleMin
            : ECOSYSTEM_HYDRO_ZELLWEITE;
    if (cell < minimum) {
        cell = minimum;
    }
    const w = Math.round(spanX / cell) + 1;
    const hh = Math.round(spanY / cell) + 1;
    if (
        ![bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y, cell].every(Number.isFinite) ||
        spanX < 0 ||
        spanY < 0 ||
        w < 1 ||
        hh < 1 ||
        w > 65535 ||
        hh > 65535 ||
        w * hh > 4000000
    ) {
        throw new RangeError("Das Höhenfeld überschreitet die zulässige Rastergröße (4 Millionen Zellen).");
    }
    const drin = new Uint8Array(w * hh);
    let drinN = 0;
    for (let j = 0; j < hh; j++) {
        for (let i = 0; i < w; i++) {
            const x = bounds.min_x + i * cell;
            const y = bounds.min_y + j * cell;
            if (istDrin(x, y)) {
                drin[j * w + i] = 1;
                drinN++;
            }
        }
    }
    return {
        w,
        hh,
        cell,
        drin,
        drinN,
        eigen: drin,
        eigenN: drinN,
        bounds,
        cellS: cell * SCHRITT_JE_EINHEIT,
        x: (i) => bounds.min_x + i * cell,
        y: (j) => bounds.min_y + j * cell,
        i: (x) => Math.round((x - bounds.min_x) / cell),
        j: (y) => Math.round((y - bounds.min_y) / cell),
    };
}

/** Der Rahmen samt dem Streifen hinter den gemeinsamen Kanten (`mitAndockStreifen`); ohne Kanten derselbe. */
export function andockRahmen(b: V12Bounds, andock: V12Input["andock"]): V12Bounds {
    if (!andock?.kanten.length) return b;
    let { min_x, min_y, max_x, max_y } = b;
    for (const kante of andock.kanten)
        for (const [x, y] of kante) {
            min_x = Math.min(min_x, x - andock.streifen);
            min_y = Math.min(min_y, y - andock.streifen);
            max_x = Math.max(max_x, x + andock.streifen);
            max_y = Math.max(max_y, y + andock.streifen);
        }
    return { min_x, min_y, max_x, max_y };
}

/**
 * Gemeinsame Grenzen (OPS-000089, Vali 2026-11-07: „An gemeinsamen Grenzen fällt nichts mehr ab.“): Das Rechengebiet (`drin`) wächst um einen Streifen hinter den gemeinsamen Kanten, das
 * Speichergebiet (`eigen`) bleibt die Fläche. So rechnet alles, was am Umriss ausläuft (Fase, Sockel, das Lösen des Reliefs der V12, die Erosion), bis hinter die Kante und läuft dort aus,
 * wo niemand es sieht; an der Kante steht die volle Höhe. An den freien Rändern bleibt alles, wie es war, und um das Ende einer Kante geht der eine Rand weich in den anderen über.
 * Ohne Kanten dasselbe Raster: `eigen` bleibt dasselbe Feld wie `drin`.
 */
export function mitAndockStreifen(r: Raster, andock: V12Input["andock"]): Raster {
    if (!andock?.kanten.length) return r;
    const drin = r.drin.slice();
    const reichweite = andock.streifen;
    const quadrat = reichweite * reichweite;
    for (const kante of andock.kanten) {
        for (let s = 1; s < kante.length; s++) {
            const [ax, ay] = kante[s - 1] as [number, number];
            const [bx, by] = kante[s] as [number, number];
            const dx = bx - ax;
            const dy = by - ay;
            const nenner = dx * dx + dy * dy;
            const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reichweite - r.bounds.min_x) / r.cell));
            const i1 = Math.min(r.w - 1, Math.ceil((Math.max(ax, bx) + reichweite - r.bounds.min_x) / r.cell));
            const j0 = Math.max(0, Math.floor((Math.min(ay, by) - reichweite - r.bounds.min_y) / r.cell));
            const j1 = Math.min(r.hh - 1, Math.ceil((Math.max(ay, by) + reichweite - r.bounds.min_y) / r.cell));
            for (let j = j0; j <= j1; j++) {
                for (let i = i0; i <= i1; i++) {
                    const k = j * r.w + i;
                    if (drin[k]) continue;
                    const px = r.x(i) - ax;
                    const py = r.y(j) - ay;
                    const t = nenner > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / nenner)) : 0;
                    const qx = px - t * dx;
                    const qy = py - t * dy;
                    if (qx * qx + qy * qy <= quadrat) drin[k] = 1;
                }
            }
        }
    }
    let drinN = 0;
    for (let k = 0; k < drin.length; k++) drinN += drin[k] as number;
    return { ...r, drin, drinN, eigen: r.drin, eigenN: r.drinN };
}

/** Abstand jeder Zelle zum Flächenrand in Zellen, Chamfer 3-4; außen 0 (hydrologie.js#L748-778). */
export function randAbstand(r: Raster): Float64Array {
    const d = new Float64Array(r.w * r.hh);
    const GROSS = 1e9;
    for (let k = 0; k < d.length; k++) {
        d[k] = r.drin[k] ? GROSS : 0;
    }
    for (let j = 0; j < r.hh; j++) {
        for (let i = 0; i < r.w; i++) {
            const k = j * r.w + i;
            if (!r.drin[k]) continue;
            let v = d[k] as number;
            if (i > 0) v = Math.min(v, (d[k - 1] as number) + 3);
            if (j > 0) v = Math.min(v, (d[k - r.w] as number) + 3);
            if (i > 0 && j > 0) v = Math.min(v, (d[k - r.w - 1] as number) + 4);
            if (i < r.w - 1 && j > 0) v = Math.min(v, (d[k - r.w + 1] as number) + 4);
            d[k] = v;
        }
    }
    for (let j = r.hh - 1; j >= 0; j--) {
        for (let i = r.w - 1; i >= 0; i--) {
            const k = j * r.w + i;
            if (!r.drin[k]) continue;
            let v = d[k] as number;
            if (i < r.w - 1) v = Math.min(v, (d[k + 1] as number) + 3);
            if (j < r.hh - 1) v = Math.min(v, (d[k + r.w] as number) + 3);
            if (i < r.w - 1 && j < r.hh - 1) v = Math.min(v, (d[k + r.w + 1] as number) + 4);
            if (i > 0 && j < r.hh - 1) v = Math.min(v, (d[k + r.w - 1] as number) + 4);
            d[k] = v;
        }
    }
    return d;
}
