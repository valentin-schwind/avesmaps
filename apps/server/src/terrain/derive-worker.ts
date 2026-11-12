import { parentPort } from "node:worker_threads";
import { buildMountainRaster, rasterSamples, rechnetRueckennetz, type V12Input } from "@avesmaps3d/shared";

/**
 * Rechnet ein Gebirge im eigenen Thread (WI-0049 S3). Ein Gebirge braucht unter Node 8 bis 40 s;
 * im Hauptthread stünde der ganze Lauf so lange still.
 *
 * Mit gezeichneten Kämmen rechnet `buildMountainRaster` das Rückennetz (WI-0246/WI-0247): Die Durchschnittshöhe ist dort das Ziel der
 * Talboden-Suche in der Rechnung selbst (`input.rueckennetz.mittelZiel`), die Halbierung über die Hypsometrie entfällt (sonst lägen
 * zwei Suchen ineinander, bis zu 64 Rechnungen).
 */

export interface TerrainWorkerJob {
    id: number;
    input: V12Input;
    /** Die Durchschnittshöhe aus Avesmaps3D (C3), sonst `null`. */
    durchschnittshoehe: number | null;
    /** Rückennetz: ein früher gefundener Talboden derselben Form (`terrain_raster.rueckennetz_talboden`), sonst `null`. */
    talbodenGemerkt: number | null;
}

export interface TerrainWorkerResult {
    id: number;
    width: number;
    height: number;
    cell: number;
    originX: number;
    originY: number;
    samples: Uint16Array;
    max: number;
    mean: number;
    /** Die Hypsometrie, mit der die Durchschnittshöhe erreicht wurde (C3), sonst `null`. */
    hypsometrie: number | null;
    /** Rückennetz: der wirksame Talboden, sonst `null`. */
    talboden: number | null;
    error?: string;
}

function run(input: V12Input): Omit<TerrainWorkerResult, "id" | "hypsometrie"> {
    const raster = buildMountainRaster(input);
    const samples = rasterSamples(raster);
    let max = 0;
    let sum = 0;
    let inside = 0;
    for (let k = 0; k < samples.length; k += 1) {
        if (!raster.eigen[k]) {
            continue;
        }
        const value = samples[k] ?? 0;
        max = Math.max(max, value);
        sum += value;
        inside += 1;
    }
    return {
        width: raster.w,
        height: raster.hh,
        cell: raster.cell,
        originX: raster.bounds.min_x,
        originY: raster.bounds.min_y,
        samples,
        max,
        mean: inside > 0 ? sum / inside : 0,
        talboden: raster.talboden ?? null,
    };
}

/** Rückennetz: mit gemerktem Talboden, wenn das Gebirge keinen eigenen hat. */
function mitGemerktemTalboden(input: V12Input, talboden: number | null): V12Input {
    const regler = input.rueckennetz;
    if (talboden === null || !regler || regler.talbodenFest !== null) return input;
    return { ...input, rueckennetz: { ...regler, talbodenFest: talboden } };
}

/** Legacys Reglergrenzen der Hypsometrie (index.html: `max="0.7"`); 0 heißt „nicht gesetzt“. */
const HYPSO_MIN = 0.05;
const HYPSO_MAX = 0.7;
const HYPSO_STEPS = 6;

/**
 * C3 (Betreiber 2026-09-27): Die Durchschnittshöhe hebt die Masse um die festen Gipfel. Umgerechnet
 * wird in Legacys Hypsometrie, die vor Talabzug und Erosion wirkt; weil beides den Schnitt danach
 * noch verschiebt, wird die Hypsometrie per Halbierung gesucht, bis der gemessene Schnitt stimmt.
 * Außerhalb der Reichweite des Reglers gilt der nächste erreichbare Wert.
 */
function runWithMean(input: V12Input, target: number): Omit<TerrainWorkerResult, "id"> {
    const at = (hypsometrie: number): Omit<TerrainWorkerResult, "id" | "hypsometrie"> =>
        run({ ...input, regler: { ...input.regler, hypsometrie } });
    let low = HYPSO_MIN;
    let high = HYPSO_MAX;
    let lowResult = at(low);
    if (lowResult.mean >= target) {
        return { ...lowResult, hypsometrie: low };
    }
    let highResult = at(high);
    if (highResult.mean <= target) {
        return { ...highResult, hypsometrie: high };
    }
    for (let step = 0; step < HYPSO_STEPS; step += 1) {
        const middle = (low + high) / 2;
        const result = at(middle);
        if (result.mean < target) {
            low = middle;
            lowResult = result;
        } else {
            high = middle;
            highResult = result;
        }
    }
    return Math.abs(lowResult.mean - target) <= Math.abs(highResult.mean - target)
        ? { ...lowResult, hypsometrie: low }
        : { ...highResult, hypsometrie: high };
}

parentPort?.on("message", (job: TerrainWorkerJob) => {
    try {
        // Dieselbe Weiche wie `buildMountainRaster` (`rechnetRueckennetz`, mit Köpfen auch nur mit Nebengipfeln, WI-0249 P2).
        const rueckennetz = rechnetRueckennetz(job.input, job.input.rueckennetz?.form.kopf);
        const result = rueckennetz
            ? { ...run(mitGemerktemTalboden(job.input, job.talbodenGemerkt)), hypsometrie: null }
            : job.durchschnittshoehe !== null
              ? runWithMean(job.input, job.durchschnittshoehe)
              : { ...run(job.input), hypsometrie: null };
        parentPort?.postMessage({ id: job.id, ...result } satisfies TerrainWorkerResult, [
            result.samples.buffer as ArrayBuffer,
        ]);
    } catch (error) {
        parentPort?.postMessage({
            id: job.id,
            width: 0,
            height: 0,
            cell: 0,
            originX: 0,
            originY: 0,
            samples: new Uint16Array(0),
            max: 0,
            mean: 0,
            hypsometrie: null,
            talboden: null,
            error: error instanceof Error ? error.message : String(error),
        } satisfies TerrainWorkerResult);
    }
});
