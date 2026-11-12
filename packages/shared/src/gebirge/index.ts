/**
 * Legacys Gebirgsrechnung V12 in TypeScript (WI-0049 S3): der Pfad von Legacys Speicherlauf,
 * `avesmapsGebirgsRasterMitUeberlappung(eingabe)` ohne `nachbarFelder` und ohne `deckel`
 * (hydrologie.js#L2105-2112, #L2156-2177, aff0449a5).
 *
 * Bitgenau heißt: dieselben Gleitkommaoperationen in derselben Folge. Das Ergebnis ist Zelle für
 * Zelle dasselbe wie Legacys Modul, geprüft mit `scripts/dev/terrain-oracle/compare-v12.mjs`.
 */
import { avesmapsGebirgsRasterBauen, type GebirgsRaster } from "./build.ts";
import { pointInGeometry } from "./geometry.ts";
import { rueckennetzRaster } from "./rueckennetz/raster.ts";
import { rechnetRueckennetz } from "./rueckennetz/werte.ts";
import type { V12Geometry, V12Input, V12Raster } from "./types.ts";

export type { V12Bounds, V12Controls, V12Geometry, V12Input, V12Lake, V12Peak, V12Raster, V12River } from "./types.ts";

export const V12_SOURCE = "avesmaps@aff0449a5:js/map-features/map-features-ecosystem-hydrologie.js";

/** Legacys `ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT` (heightmap-raster.js#L27). */
const MAX_SCHRITT = 65535;

/**
 * Die Höhe an einer Stelle, bilinear aus dem Raster, nur in der Fläche (hydrologie.js#L2114-2135).
 * Legacy misst damit, ob das Raster leer ist; die Steigung daneben braucht der Speicherlauf nicht.
 */
function avesmapsGebirgsRasterProbe(raster: GebirgsRaster, geometry: V12Geometry, x: number, y: number): number | null {
    const r = raster.r;
    const fx = (x - r.bounds.min_x) / r.cell;
    const fy = (y - r.bounds.min_y) / r.cell;
    if (fx < 0 || fy < 0 || fx > r.w - 1 || fy > r.hh - 1 || !pointInGeometry([x, y], geometry)) {
        return null;
    }
    const i = Math.min(Math.floor(fx), Math.max(0, r.w - 2));
    const j = Math.min(Math.floor(fy), Math.max(0, r.hh - 2));
    const tx = fx - i;
    const ty = fy - j;
    const rechts = Math.min(i + 1, r.w - 1);
    const unten = Math.min(j + 1, r.hh - 1);
    const nw = raster.h[j * r.w + i] as number;
    const ne = raster.h[j * r.w + rechts] as number;
    const sw = raster.h[unten * r.w + i] as number;
    const se = raster.h[unten * r.w + rechts] as number;
    return nw * (1 - tx) * (1 - ty) + ne * tx * (1 - ty) + sw * (1 - tx) * ty + se * tx * ty;
}

/**
 * Das Raster einer Gebirgsfläche wie Legacys Speicherlauf. `leer` misst Legacy über die
 * bilineare Probe an jeder eigenen Zelle (hydrologie.js#L2156-2177).
 */
export function buildMountainRaster(input: V12Input): V12Raster {
    // Die Weiche (WI-0246): Mit mindestens einem gezeichneten Kamm rechnet das Rückennetz, sonst die V12 wie Legacy.
    if (rechnetRueckennetz(input, input.rueckennetz?.form.kopf)) return rueckennetzRaster(input);
    // avesmapsGebirgsEigenesRaster (hydrologie.js#L2105-2112)
    const eigen = avesmapsGebirgsRasterBauen(
        input,
        (x, y) => pointInGeometry([x, y], input.geometry),
        (i, x, y) => pointInGeometry([x, y], input.seen[i]?.g),
    );
    const r = eigen.r;
    // Der Streifen hinter einer gemeinsamen Grenze ist nur Rechengebiet (`mitAndockStreifen`): Dort steht nichts.
    if (r.eigen !== r.drin) for (let k = 0; k < eigen.h.length; k++) if (!r.eigen[k]) eigen.h[k] = 0;
    let maximum = 0;
    for (let j = 0; j < r.hh; j++) {
        for (let i = 0; i < r.w; i++) {
            if (!r.eigen[j * r.w + i]) continue;
            const probe = avesmapsGebirgsRasterProbe(
                eigen,
                input.geometry,
                r.bounds.min_x + i * r.cell,
                r.bounds.min_y + j * r.cell,
            );
            maximum = Math.max(maximum, probe || 0);
        }
    }
    return { w: r.w, hh: r.hh, cell: r.cell, bounds: r.bounds, eigen: r.eigen, h: eigen.h, leer: maximum <= 0 };
}

/** Legacys Speicherkodierung (height-render.js#L1031-1044): eigen ? clamp(round(h), 0, 65535) : 0. */
export function rasterSamples(raster: V12Raster): Uint16Array<ArrayBuffer> {
    const samples = new Uint16Array(raster.w * raster.hh);
    for (let k = 0; k < samples.length; k++) {
        if (!raster.eigen[k]) continue;
        const wert = Math.round(raster.h[k] as number);
        samples[k] = wert > MAX_SCHRITT ? MAX_SCHRITT : wert > 0 ? wert : 0;
    }
    return samples;
}
