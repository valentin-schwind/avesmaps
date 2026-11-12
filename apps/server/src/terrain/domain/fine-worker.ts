import { parentPort, workerData } from "node:worker_threads";
import type { StoredRaster } from "../dem-tiles.ts";
import { CellHeap } from "../hydrology/flow.ts";
import { grid } from "../hydrology/grid.ts";
import { refineTile, type FineRecipe, type FineScratch, type FineTile } from "./fine.ts";

/**
 * Ein Worker der lokalen Feinstufe (WI-0283, `local-fine.ts`): rechnet je Nachricht eine Kachel und gibt ihr Feld zurück. Grobe Stufe und Wassermaske liegen im gemeinsamen
 * Speicher. Eine Kachel hängt nur von ihnen und ortsfestem Zufall ab (`fine.ts`); die Summe bildet der Hauptthread in fester Folge.
 */

const { n, coarse, classes, recipe, seed, tiles } = workerData as {
    n: number;
    coarse: StoredRaster;
    classes: Uint8Array;
    recipe: FineRecipe;
    seed: number;
    tiles: FineTile[];
};
const g = grid(n);
const largest = Math.max(...tiles.map((tile) => tile.window.width * tile.window.height));
const scratch: FineScratch = { heap: new CellHeap(largest) };

parentPort?.on("message", ({ position, index }: { position: number; index: number }) => {
    const part = refineTile(g, tiles[index]!, coarse, classes, recipe, seed, scratch);
    parentPort?.postMessage({ position, part }, [part.buffer as ArrayBuffer]);
});
