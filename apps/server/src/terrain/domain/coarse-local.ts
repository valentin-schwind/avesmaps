import type { StoredRaster } from "../dem-tiles.ts";
import { MAP_EXTENT, type Plane } from "../hydrology/grid.ts";
import { simulateDomainTerrain, type SimulationResult } from "./generate.ts";
import type { DomainInputs } from "./inputs.ts";
import { releaseIntermediates } from "./memory.ts";
import { mountainInterior, refineMountainInterior, type MountainInteriorReport } from "./mountain-interior.ts";
import type { TerrainRecipe } from "./recipes.ts";
import { rasterSicht, type HoehenBeobachter } from "./beobachter.ts";

/**
 * Die grobe Stufe im Umkreis einer Änderung (WI-0223 Schritt 2; Betreiber 2026-10-18 „Geländerechnung: A“, JOBS-0001 D6 Option A
 * „lokal gleich voll“, SYS-0001 §9c.11).
 *
 * Ein voller Lauf hinterlässt seinen Stand der groben Stufe (`CoarseState`). Ein lokaler Lauf rechnet damit
 *   - das Anfangsgelände nur in den Rechenkacheln des Fußabdrucks neu (außerhalb übernimmt er es; der Fußabdruck deckt seine
 *     Reichweite), dann
 *   - die Erosion über die ganze Karte, wie der volle Lauf, und
 *   - das Gebirgsinnere nur für die Gruppen, deren Fenster den Fußabdruck berührt; die übrigen behalten den vorigen Lauf.
 * Die grobe Stufe ist damit bytegleich zum vollen Lauf derselben Eingaben (gemessen in WI-0223 §3, Weiden und Garetien).
 *
 * 🪤 Die Erosion selbst lässt sich nicht im Fenster rechnen: Abfluss und Rückverteilung koppeln sie chaotisch, ein Fenster mit
 * Randwerten aus dem vorigen Lauf wich im Fußabdruck bis 707 Schritt ab (WI-0223 §3). Sie bleibt der größte Posten des lokalen Laufs.
 */

/** Der Stand der groben Stufe eines Laufs; der nächste lokale Lauf übernimmt ihn außerhalb seines Fußabdrucks. */
export interface CoarseState {
    /** Das Anfangsgelände vor Gipfeln, Seen und Erosion (Zeile 0 im Norden, wie das Gitter). */
    initial: Float32Array;
    /** Höhe nach dem Gebirgsinneren, vor den Schlussschritten (gespeicherte Ausrichtung, Zeile 0 im Süden). */
    interior: Uint16Array;
}

/** Das Hüllrechteck der Rechenkacheln auf dem groben Gitter (`n`², Zeile 0 im Norden). */
export function tilesPlane(tiles: readonly number[], perSide: number, n: number): Plane {
    if (tiles.length === 0) throw new RangeError("Ein Fenster braucht mindestens eine Rechenkachel");
    const span = n / perSide;
    let tx0 = perSide,
        ty0 = perSide,
        tx1 = -1,
        ty1 = -1;
    for (const tile of tiles) {
        const tx = tile % perSide;
        const ty = Math.floor(tile / perSide);
        tx0 = Math.min(tx0, tx);
        ty0 = Math.min(ty0, ty);
        tx1 = Math.max(tx1, tx);
        ty1 = Math.max(ty1, ty);
    }
    return {
        x0: tx0 * span,
        y0: ty0 * span,
        width: (tx1 - tx0 + 1) * span,
        height: (ty1 - ty0 + 1) * span,
        cell: MAP_EXTENT / n,
    };
}

export interface LocalCoarseResult {
    /** Die grobe Stufe nach dem Gebirgsinneren, vor den Schlussschritten (gespeicherte Ausrichtung). */
    raster: StoredRaster;
    state: CoarseState;
    simulation: Omit<SimulationResult, "raster" | "classes">;
    mountainInterior: MountainInteriorReport;
}

/**
 * Die grobe Stufe bis zum Gebirgsinneren; Anfangsgelände und Gebirgsinneres in `plane` neu, außerhalb aus `previous`.
 * 🪤 Verbraucht `previous`: Der neue Stand steht danach in denselben Feldern (spart beim lokalen Lauf rund 100 MB Spitze).
 */
export function localCoarse(
    input: DomainInputs,
    recipe: TerrainRecipe,
    previous: CoarseState,
    plane: Plane,
    phase?: (name: string) => void,
    /** Sieht das Höhenfeld nach jeder Phase (WI-0249 P6, `beobachter.ts`); nur lesen. */
    beobachter?: HoehenBeobachter,
): LocalCoarseResult {
    // Das Gitter des Stands (im Job das des Rezepts; die Tests rechnen kleiner).
    const n = Math.round(Math.sqrt(previous.initial.length));
    if (previous.initial.length !== n * n || previous.interior.length !== n * n)
        throw new RangeError("Stand der groben Stufe ist kein quadratisches Gitter");
    const { raster, classes, ...simulation } = simulateDomainTerrain(input, recipe, n, phase, {
        initial: { heights: previous.initial, plane },
        // Der vorige Stand ist ab hier übernommen: Das neue Anfangsgelände kommt in sein Feld.
        keepInitial: (height) => previous.initial.set(height),
        ...(beobachter ? { beobachter } : {}),
    });
    releaseIntermediates();

    // Das Gebirgsinnere nur für Gruppen, deren Fenster das Fenster berührt; sie schreiben auch außerhalb. Die übrigen behalten den
    // vorigen Lauf.
    const interior = mountainInterior(raster, input, recipe, classes);
    const written = new Uint8Array(n * n);
    const skipped = new Uint8Array(n * n);
    const touches = (group: Plane): boolean =>
        group.x0 < plane.x0 + plane.width &&
        plane.x0 < group.x0 + group.width &&
        group.y0 < plane.y0 + plane.height &&
        plane.y0 < group.y0 + group.height;
    const report = refineMountainInterior(raster, input, recipe, interior, { select: touches, written, skipped });
    const samples = raster.samples;
    for (let s = 0; s < samples.length; s += 1) if (skipped[s] && !written[s]) samples[s] = previous.interior[s]!;
    previous.interior.set(samples);
    phase?.("mountain-interior");
    beobachter?.("mountain-interior", rasterSicht(raster));
    return { raster, state: previous, simulation, mountainInterior: report };
}
