/**
 * Das Rückennetz als Erzeugermodus von `buildMountainRaster` (WI-0246): dieselbe Eingabe, dasselbe Raster wie die V12, damit Gelände,
 * Zwischenspeicher und Vorschau nichts unterscheiden müssen. Die Regler kommen mit der Eingabe (`V12Input.rueckennetz`, aufgelöst mit
 * `rueckennetzRegler`); fehlen sie, gelten die Typwerte des Kettengebirges aus dem Vorschlag.
 */
import type { V12Input, V12Raster } from "../types.ts";
import { rechneRueckennetz } from "./rechne.ts";
import { rueckennetzRegler } from "./werte.ts";

/**
 * Stand der Rechnung im Fingerabdruck jedes Rückennetz-Gebirges (`terrain/inputs.ts`): Steigt mit jeder Änderung, die ein Ergebnis
 * ändert, damit der nächste Geländelauf diese Gebirge neu rechnet. Gebirge ohne Kamm tragen ihn nicht.
 * WI-0247: Das Gelände übernimmt die Saat dieser Gebirge seither unverändert (`terrain/domain/rueckennetz-flaechen.ts`).
 */
export const RUECKENNETZ_QUELLE = "rueckennetz@WI-0249-nebengipfel-7";

export function rueckennetzRaster(input: V12Input): V12Raster {
    const regler = input.rueckennetz ?? rueckennetzRegler(null, null, {});
    const e = rechneRueckennetz(
        input,
        { struktur: regler.struktur, form: regler.form },
        {
            band: regler.band,
            gratMin: regler.gratMin,
            ...(regler.talbodenFest !== null ? { talbodenFest: regler.talbodenFest } : {}),
            ...(regler.mittelZiel !== null ? { mittelZiel: regler.mittelZiel } : {}),
            ...(regler.gitter ? { gitter: regler.gitter } : {}),
            ...(regler.punktHoehenAbsolut ? { punktHoehenAbsolut: true } : {}),
        },
    );
    let leer = true;
    for (let k = 0; k < e.h.length && leer; k++) if (e.eigen[k] && (e.h[k] as number) > 0) leer = false;
    return { w: e.w, hh: e.hh, cell: e.cell, bounds: e.bounds, eigen: e.eigen, h: e.h, leer, talboden: e.talboden };
}
