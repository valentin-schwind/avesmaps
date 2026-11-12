/**
 * Ausschnitt-Rechnung für die Vorschau großer Gebirge (WI-0246, Bauplan Schritt 2; Frage der Derographie): gerechnet wird nur ein Rahmen
 * mit einem überlappenden Rand, damit Täler und Erosion am Schnitt nicht abreißen. Was von der ganzen Fläche abhängt, kommt aus ihr:
 * das Netz (Äste laufen bis zum echten Umriss), der Randabstand und sein Größtwert (Sockelanstieg, Randauslauf). Täler, Erosion und Flüsse
 * sind am Schnitt eine Näherung; das Gelände rechnet immer das ganze Gebirge.
 */
import { randAbstand, type Raster } from "../raster.ts";
import type { V12Bounds } from "../types.ts";

/** Überlappender Rand um den Rahmen (E). */
export const AUSSCHNITT_RAND_E = 4;

/** Ein Raster, dessen Randabstand aus der ganzen Fläche vorgegeben ist (Chamfer 3-4 wie `randAbstand`). */
export interface RueckenRaster extends Raster {
    randFeld?: Float64Array;
    /** Größter Randabstand der ganzen Fläche (E). */
    randMaxE?: number;
}

/** Der Randabstand eines Rasters: vorgegeben oder gerechnet. */
export function randFeld(r: RueckenRaster): Float64Array {
    return r.randFeld ?? randAbstand(r);
}

/** Größter Randabstand in E (die Fase von `randAbstand` zählt 3 je Zelle). */
export function randMaxE(r: RueckenRaster, rand: Float64Array): number {
    if (r.randMaxE !== undefined) return r.randMaxE;
    let max = 0;
    for (let k = 0; k < rand.length; k++) if (r.drin[k]) max = Math.max(max, ((rand[k] as number) * r.cell) / 3);
    return max;
}

/** Schneidet den Rahmen samt Rand aus dem Raster der ganzen Fläche; null, wenn er die Fläche nicht trifft. */
export function schneideAus(ganz: Raster, rahmen: V12Bounds): RueckenRaster | null {
    const zelle = (v: number, min: number) => (v - min) / ganz.cell;
    const i0 = Math.max(0, Math.floor(zelle(rahmen.min_x - AUSSCHNITT_RAND_E, ganz.bounds.min_x)));
    const i1 = Math.min(ganz.w - 1, Math.ceil(zelle(rahmen.max_x + AUSSCHNITT_RAND_E, ganz.bounds.min_x)));
    const j0 = Math.max(0, Math.floor(zelle(rahmen.min_y - AUSSCHNITT_RAND_E, ganz.bounds.min_y)));
    const j1 = Math.min(ganz.hh - 1, Math.ceil(zelle(rahmen.max_y + AUSSCHNITT_RAND_E, ganz.bounds.min_y)));
    if (i0 > i1 || j0 > j1) return null;
    const w = i1 - i0 + 1;
    const hh = j1 - j0 + 1;
    const randGanz = randAbstand(ganz);
    const drin = new Uint8Array(w * hh);
    const rand = new Float64Array(w * hh);
    // Mit gemeinsamen Grenzen ist das Speichergebiet kleiner als das Rechengebiet (`mitAndockStreifen`), sonst dasselbe Feld.
    const eigen = ganz.eigen === ganz.drin ? drin : new Uint8Array(w * hh);
    let drinN = 0;
    let eigenN = 0;
    for (let j = 0; j < hh; j++)
        for (let i = 0; i < w; i++) {
            const k = (j0 + j) * ganz.w + i0 + i;
            drin[j * w + i] = ganz.drin[k] as number;
            eigen[j * w + i] = ganz.eigen[k] as number;
            rand[j * w + i] = randGanz[k] as number;
            drinN += ganz.drin[k] as number;
            eigenN += ganz.eigen[k] as number;
        }
    if (drinN === 0) return null;
    const bounds = { min_x: ganz.x(i0), min_y: ganz.y(j0), max_x: ganz.x(i1), max_y: ganz.y(j1) };
    return {
        w,
        hh,
        cell: ganz.cell,
        drin,
        drinN,
        eigen,
        eigenN,
        bounds,
        cellS: ganz.cellS,
        x: (i) => ganz.x(i0 + i),
        y: (j) => ganz.y(j0 + j),
        i: (x) => ganz.i(x) - i0,
        j: (y) => ganz.j(y) - j0,
        randFeld: rand,
        randMaxE: randMaxE(ganz, randGanz),
    };
}
