import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { StoredRaster } from "../dem-tiles.ts";
import { CellHeap } from "../hydrology/flow.ts";
import { SEA, type Grid } from "../hydrology/grid.ts";
import { fineTiles, refineTile, type FineRecipe, type FineScratch, type FineTile } from "./fine.ts";

/**
 * Die Feinstufe NUR im Fußabdruck (WI-0125, `terrain_local`): dieselbe Rechnung wie `composeFine` (WI-0070), aber nur für die
 * Rechenkacheln des Fußabdrucks, eingesetzt in den geltenden Master.
 *
 * - Die Kacheln im Fußabdruck sind „schmutzig“: Sie und ihre Nachbarn (die Verblendung reicht hinein) werden gerechnet, in fester
 *   Reihenfolge summiert, und die Zellen in Reichweite der Verblendung einer schmutzigen Kachel neu zusammengesetzt, Zelle für Zelle
 *   wie `composeFine`. Mit derselben groben Stufe ist das Ergebnis dort bytegleich zur Komposition eines vollen Laufs.
 * - Alles andere bleibt der geltende Master: Er ist schon fertig (Schlussschritte gelaufen), die neuen Zellen sind es noch nicht. Die
 *   Schlussschritte laufen danach über das Ganze (`finishDomainTerrain`), und eingesetzt wird nur der Kern der Kacheln im Fußabdruck.
 * - Gespeichert wird nur das Fenster, das die summierten Kacheln abdecken: bei 3 × 3 Kacheln im Fußabdruck rund 5 × 5 Kacheln statt
 *   der 256 MiB eines ganzen `Float32Array` der Komposition.
 * - **Auf mehreren Kernen** (WI-0283, `composeFineLocalMitWorkern`): Die Kacheln sind unabhängig; gerechnet wird verteilt, summiert in fester Folge auf dem Hauptthread.
 *   Dieselben Bytes wie allein. Es bleibt bei den Threads der Jobart: Die Erosion ist zu der Zeit fertig. Wenige Felder liegen wartend im Speicher, weil ein Worker eine neue
 *   Kachel erst bekommt, wenn die Summe nah genug nachkommt.
 */

const workerFile = new URL(`./fine-worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);

export interface LocalFineResult {
    /** Der Master mit den neu zusammengesetzten Zellen (Zeile 0 im Süden, wie gespeichert), noch ohne Schlussschritte. */
    samples: Uint16Array;
    /** Gerechnete Kacheln (Fußabdruck und Nachbarn). */
    computed: number;
}

interface FeinAufgabe {
    tiles: FineTile[];
    dirty: boolean[];
    /** Die zu rechnenden Kacheln in fester Folge: Die Summe in Float32 hängt an ihr. */
    liste: number[];
    samples: Uint16Array;
    ax0: number;
    ay0: number;
    aw: number;
    acc: Float32Array;
}

function feinAufgabe(
    g: Grid,
    recipe: FineRecipe,
    inside: ReadonlySet<number>,
    base: Uint16Array,
): FeinAufgabe | Uint16Array {
    const n = g.n;
    if (base.length !== n * n) throw new Error("Lokale Feinstufe: Master und Gitter passen nicht zusammen");
    const tiles = fineTiles(n, recipe, g.cell);
    const per = recipe.tiles;
    const dirty = tiles.map((_, i) => inside.has(i));
    const needed = tiles.map((tile) => {
        for (let dy = -1; dy <= 1; dy += 1)
            for (let dx = -1; dx <= 1; dx += 1) {
                const tx = tile.tx + dx,
                    ty = tile.ty + dy;
                if (tx >= 0 && ty >= 0 && tx < per && ty < per && dirty[ty * per + tx]) return true;
            }
        return false;
    });
    // Das Fenster der Summe: alle Fenster der gerechneten Kacheln.
    let ax0 = n,
        ay0 = n,
        ax1 = 0,
        ay1 = 0;
    tiles.forEach((tile, i) => {
        if (!needed[i]) return;
        const w = tile.window;
        ax0 = Math.min(ax0, w.x0);
        ay0 = Math.min(ay0, w.y0);
        ax1 = Math.max(ax1, w.x0 + w.width);
        ay1 = Math.max(ay1, w.y0 + w.height);
    });
    const samples = base.slice();
    if (ax1 <= ax0) return samples;
    const aw = ax1 - ax0;
    const liste = tiles.flatMap((_, i) => (needed[i] ? [i] : []));
    return { tiles, dirty, liste, samples, ax0, ay0, aw, acc: new Float32Array(aw * (ay1 - ay0)) };
}

function addiere(aufgabe: FeinAufgabe, tile: FineTile, part: Float32Array): void {
    const { acc, aw, ax0, ay0 } = aufgabe;
    const w = tile.window;
    for (let y = 0; y < w.height; y += 1) {
        const row = (w.y0 + y - ay0) * aw + w.x0 - ax0;
        for (let x = 0; x < w.width; x += 1) acc[row + x] = acc[row + x]! + part[y * w.width + x]!;
    }
}

function setzeEin(aufgabe: FeinAufgabe, n: number, classes: Uint8Array, recipe: FineRecipe): LocalFineResult {
    const { acc, aw, ax0, ay0, samples, tiles, dirty } = aufgabe;
    tiles.forEach((tile, i) => {
        if (!dirty[i]) return;
        const c0 = Math.max(0, tile.c0 - recipe.blend),
            c1 = Math.min(n, tile.c0 + tile.size + recipe.blend);
        const r0 = Math.max(0, tile.r0 - recipe.blend),
            r1 = Math.min(n, tile.r0 + tile.size + recipe.blend);
        for (let y = r0; y < r1; y += 1)
            for (let x = c0; x < c1; x += 1) {
                const k = y * n + x;
                const value = acc[(y - ay0) * aw + x - ax0]!;
                samples[(n - 1 - y) * n + x] = classes[k]! & SEA ? 0 : Math.max(1, Math.min(65535, Math.round(value)));
            }
    });
    return { samples, computed: aufgabe.liste.length };
}

export function composeFineLocal(
    coarse: StoredRaster,
    g: Grid,
    classes: Uint8Array,
    recipe: FineRecipe,
    seed: number,
    inside: ReadonlySet<number>,
    /** Der geltende Master, Zeile 0 im Süden; wird nicht verändert. */
    base: Uint16Array,
): LocalFineResult {
    const aufgabe = feinAufgabe(g, recipe, inside, base);
    if (aufgabe instanceof Uint16Array) return { samples: aufgabe, computed: 0 };
    const largest = Math.max(...aufgabe.tiles.map((tile) => tile.window.width * tile.window.height));
    const scratch: FineScratch = { heap: new CellHeap(largest) };
    // 🔴 Dieselbe Reihenfolge wie `composeFine` (Index der Kachel): Die Summe in Float32 hängt an ihr.
    for (const i of aufgabe.liste) {
        const tile = aufgabe.tiles[i]!;
        addiere(aufgabe, tile, refineTile(g, tile, coarse, classes, recipe, seed, scratch));
    }
    return setzeEin(aufgabe, g.n, classes, recipe);
}

/** Dieselbe Rechnung auf `threads` Workern; die Summe in derselben festen Folge. Scheitert ein Worker, scheitert der Aufruf (`local.ts` rechnet dann allein). */
export async function composeFineLocalMitWorkern(
    coarse: StoredRaster,
    g: Grid,
    classes: Uint8Array,
    recipe: FineRecipe,
    seed: number,
    inside: ReadonlySet<number>,
    base: Uint16Array,
    threads: number,
): Promise<LocalFineResult> {
    const aufgabe = feinAufgabe(g, recipe, inside, base);
    if (aufgabe instanceof Uint16Array) return { samples: aufgabe, computed: 0 };
    const geteilteKlassen = new Uint8Array(new SharedArrayBuffer(classes.length));
    geteilteKlassen.set(classes);
    const geteilteHoehen = new Uint16Array(new SharedArrayBuffer(coarse.samples.byteLength));
    geteilteHoehen.set(coarse.samples);
    const { liste, tiles } = aufgabe;
    const anzahl = Math.max(1, Math.min(threads, liste.length));
    const workerData = {
        n: g.n,
        coarse: { ...coarse, samples: geteilteHoehen },
        classes: geteilteKlassen,
        recipe,
        seed,
        tiles,
    };
    const worker: Worker[] = [];
    try {
        await new Promise<void>((fertig, scheitert) => {
            const wartend = new Map<number, Float32Array>();
            const frei: Worker[] = [];
            let naechste = 0;
            let summiert = 0;
            const verteile = (): void => {
                while (frei.length > 0 && naechste < liste.length && naechste - summiert < anzahl * 2) {
                    frei.pop()!.postMessage({ position: naechste, index: liste[naechste] });
                    naechste += 1;
                }
            };
            for (let t = 0; t < anzahl; t += 1) {
                const thread = new Worker(workerFile, { workerData });
                worker.push(thread);
                frei.push(thread);
                thread.on("error", scheitert);
                thread.on("message", ({ position, part }: { position: number; part: Float32Array }) => {
                    wartend.set(position, part);
                    for (let feld = wartend.get(summiert); feld !== undefined; feld = wartend.get(summiert)) {
                        wartend.delete(summiert);
                        addiere(aufgabe, tiles[liste[summiert]!]!, feld);
                        summiert += 1;
                    }
                    frei.push(thread);
                    if (summiert === liste.length) fertig();
                    else verteile();
                });
            }
            verteile();
        });
    } finally {
        await Promise.all(worker.map((thread) => thread.terminate()));
    }
    return setzeEin(aufgabe, g.n, classes, recipe);
}

/** Der Kern einer Rechenkachel aus einem Master (Zeile 0 im Süden), zeilenweise wie gespeichert. */
export function extractComputeTile(samples: Uint16Array, n: number, index: number, per: number): Uint16Array {
    const size = n / per;
    const tx = index % per;
    const ty = Math.floor(index / per);
    const out = new Uint16Array(size * size);
    // Zeile ty (von Norden) liegt gespeichert in den Zeilen n - (ty + 1) * size bis n - ty * size.
    const bottom = n - (ty + 1) * size;
    for (let row = 0; row < size; row += 1) {
        const from = (bottom + row) * n + tx * size;
        out.set(samples.subarray(from, from + size), row * size);
    }
    return out;
}

/** Setzt den Kern einer Rechenkachel in einen Master (Gegenstück zu `extractComputeTile`). */
export function insertComputeTile(
    samples: Uint16Array,
    n: number,
    index: number,
    per: number,
    tile: Uint16Array,
): void {
    const size = n / per;
    if (tile.length !== size * size) throw new Error("Rechenkachel mit falscher Größe");
    const tx = index % per;
    const ty = Math.floor(index / per);
    const bottom = n - (ty + 1) * size;
    for (let row = 0; row < size; row += 1)
        samples.set(tile.subarray(row * size, (row + 1) * size), (bottom + row) * n + tx * size);
}
