import { fbm, hash2 } from "@avesmaps3d/shared";
import { continentalHeight, type ContinentalBase } from "../continental.ts";
import { accumulate, CellHeap, directionOf, priorityFlood, receiverOf, rho8 } from "./flow.ts";
import {
    cellX,
    cellY,
    grid,
    LAKE,
    LEVEL_SET,
    MAP_EXTENT as MAP_EXTENT_UNITS,
    MOUNTAIN,
    SCHRITT_PER_UNIT,
    SEA,
    type Grid,
} from "./grid.ts";
import { landscapeStrength, type LandscapeArea } from "./landscape.ts";
import { mouthSinks, orientUnknown, riverChains, type RiverChain, type RiverRow } from "./rivers.ts";
import { coastDistance, distanceTransform, fillArea, rasterizeWater, type WaterArea } from "./water.ts";

/**
 * Das visuelle Relief der ganzen Landfläche (WI-0054): ein reines Darstellungsfeld für die
 * Schattierung in Landschaften + 3D. 🔴 Es ist KEINE Höhe. Routing, Steigung, Flug und das Gelände
 * lesen es nie; im Gebirge trägt es das echte Gelände unverändert, außerhalb ist es erfunden.
 *
 * Verfahren (Betreiber 2026-09-28: Licht R3, Übergang Ü2):
 * 1. Wasser (`meer`, `see`) und der Abstand zur Meeresküste.
 * 2. Das echte Gelände aus der veröffentlichten DEM-Revision; Gebirgszellen bleiben fest.
 * 3. In jeder Runde: Routingfläche mit eingebrannten Flüssen (streng fallend in Fließrichtung),
 *    Priority-Flood vom Meer, Rho8, Einzugsfläche, dann das Stream-Power-Gleichgewicht
 *    `Δh = kS · U · max(A, aMin)^−m · d` von der Küste aufwärts. Ein See hat einen Spiegel.
 * 4. Hangdiffusion, danach Täler entlang der bekannten Flüsse (Bach halb so breit wie Fluss).
 * Generator 3: Die Landschaftsart skaliert U und die Taltiefe, mit weichen Übergängen (`landscape.ts`).
 * Generator 4 (Betreiber 2026-09-28: „im moment gibt es stellen wo flüsse bergauf fließen“): Die Böden
 * laufen durch Seen und Gebirge hindurch, ein See liegt auf Höhe des Flussbetts an seinem Abfluss, ein Fluss,
 * der laut Daten im oder am Gebirge endet, ist dort ein Abfluss des Routings, und Läufe ohne Richtung
 * folgen der mit WI-0049 abgestimmten Regel (`orientUnknown`).
 *
 * Speicher (Spitze ≤ 600 MB bei 4096², Betreiber 2026-09-28; gebaut für die erste Grenze von 350 MB):
 * zwei Float32-Felder voller Größe (Relief
 * und ein Arbeitsfeld), Klassen und Richtung als je ein Byte, die Füllfolge nur über Land, das echte
 * Gelände nur für Gebirgszellen, alle glatten Hilfsfelder auf einem groben Gitter.
 */

/**
 * Steigt mit jeder Änderung, die das Bild ändert: 2 = Blatt 2, F2 (feinere Rinnen, ungeglättet);
 * 3 = Stärke je Landschaftsart; 4 = Flüsse durch Seen und Gebirge, Mündungen am Gebirge.
 */
export const VISUAL_RELIEF_GENERATOR = "6";

export interface VisualReliefParams {
    /** Feste Saat für Rauschen und Rho8. */
    seed: number;
    /** Hangsteigung bei höchstens `aMin` E² Einzugsfläche. */
    kS: number;
    /** Konkavität der Stream-Power (S ∝ A^−m). */
    m: number;
    aMin: number;
    /** Regionale Rauheit: U = 1 + ruggedAmp · Rauschen (Wellenlänge ruggedCell E). */
    ruggedAmp: number;
    ruggedCell: number;
    /** Die erste Routingfläche steigt mit dem Küstenabstand, verrauscht. */
    initSlope: number;
    initNoise: number;
    initCell: number;
    /** Flüsse ins Routing einbrennen: Tiefe und Mindestgefälle je Zelle (Schritt). */
    burn: number;
    burnStep: number;
    /** Zittern der Routingfläche (Schritt), fällt je Runde ab. */
    jitter: number;
    iterations: number;
    diffRate: number;
    diffSteps: number;
    /** Ü2 Vorland: U × (1 + foothillAmp · e^(−d / foothillWidth)), d Abstand zum Gebirge in E. */
    foothillAmp: number;
    foothillWidth: number;
    /** Ab dieser Höhe (Schritt) ist eine Zelle echtes Gebirge. */
    mountainThreshold: number;
    /** Täler: halbe Breite (E), Bach mit Anteil; Tiefe = valleyDepth · (A/100)^valleyExp, gedeckelt. */
    valleyWidth: number;
    brookShare: number;
    valleyDepth: number;
    valleyExp: number;
    valleyMaxDepth: number;
    /** Zur Mündung hin läuft das Tal auf dieser Strecke (E) aus. */
    mouthFade: number;
    /** Endet ein Lauf höchstens so weit (E) vor einem Gebirge oder darin, ist sein Ende ein Abfluss. */
    mouthFoot: number;
    /** Faktor auf U und Taltiefe je `region_type` (Topographie und Vegetation), 1 = Bild von Generator 2. */
    landscapeStrength: Readonly<Record<string, number>>;
    /** Für Land ohne Art. */
    landscapeFallback: number;
    /** Übergang: Radius des dreifachen Kastenfilters in E (σ ≈ Radius). */
    landscapeBlur: number;
}

/**
 * Die Werte der Blätter 1 und 2 (Betreiber 2026-09-28: „R3, Ü2“, dann „F2 sieht aus“). Jede Änderung ist
 * eine neue Revision und hebt `VISUAL_RELIEF_GENERATOR`.
 */
export const VISUAL_RELIEF_PARAMS: Readonly<VisualReliefParams> = Object.freeze({
    seed: 54054,
    kS: 0.05,
    m: 0.5,
    // F2: schon Rinnen ab ¼ E² Einzug zählen, statt erst ab 4 E².
    aMin: 0.25,
    ruggedAmp: 0.6,
    ruggedCell: 90,
    initSlope: 0.002,
    initNoise: 0.35,
    initCell: 40,
    burn: 5000,
    burnStep: 0.05,
    jitter: 20,
    iterations: 5,
    diffRate: 0.2,
    // Eine stabile Glättung nimmt einzelne Rasterspitzen zurück; die Rinnen bleiben erhalten.
    diffSteps: 1,
    foothillAmp: 1.5,
    foothillWidth: 3,
    mountainThreshold: 0.5,
    valleyWidth: 1.5,
    brookShare: 0.5,
    valleyDepth: 60,
    valleyExp: 0.25,
    valleyMaxDepth: 250,
    mouthFade: 2,
    mouthFoot: 2,
    // Blatt 3 (Betreiber 2026-09-28: „Wüsten und Ebenen sehr flach, Hügelland hügelig, das Spektrum definierst
    // du“), dann am Relief-Regler eingestellt: „die passen. das machen“ (Stufen sehr flach 0,10, flach 0,20,
    // gewellt 0,30, bewegt 0,50, hügelig 1; Übergang 5 E). Jede Art ist im Verhältnis ihrer Stufe mitgegangen.
    landscapeStrength: Object.freeze({
        // sehr flach (Stufe 0,10)
        wueste: 0.075,
        flussdelta: 0.075,
        tiefebene: 0.05,
        suempfe_moore: 0.1,
        kueste: 0.125,
        auenlandschaft: 0.125,
        // flach (Stufe 0,20)
        wuestenoase: 0.171,
        steppe: 0.065,
        wadi: 0.229,
        hochebene: 0.07,
        flussland_flusstal: 0.229,
        // gewellt (Stufe 0,30)
        graslandschaft: 0.273,
        kulturlandschaft: 0.3,
        tundra: 0.3,
        tal: 0.327,
        insel: 0.327,
        // bewegt (Stufe 0,50)
        wald: 0.5,
        urwald: 0.5,
        dschungel: 0.5,
        // hügelig; am Gebirge zählt nur der Übergang, das Gebirge selbst trägt das echte Gelände
        huegelland: 1,
        schlucht: 1,
        gebirge: 1,
    }),
    landscapeFallback: 0.327,
    landscapeBlur: 5,
});

/**
 * Das veröffentlichte Gelände, Zelle für Zelle gelesen: `forEachCell` ruft für jede Zelle des
 * 4096²-Gitters mit Höhe über 0 (Schritt, Zeile 0 im Norden) einmal `visit` auf, jedes Mal in
 * derselben Folge. Als volles Feld wären es 64 MB, die neben dem Relief keinen Platz haben
 * (gebaut für die erste Grenze von 350 MB); die Kacheln werden deshalb beim Lesen dekodiert.
 */
export interface TerrainSource {
    forEachCell(visit: (k: number, height: number) => void): void;
}

/** Ein Gelände aus zwei Feldern (Tests, Messläufe). */
export function sparseTerrain(cells: Int32Array, heights: Float32Array): TerrainSource {
    return {
        forEachCell(visit) {
            for (let i = 0; i < cells.length; i += 1) visit(cells[i] as number, heights[i] as number);
        },
    };
}

export interface VisualReliefInput {
    continental?: ContinentalBase | undefined;
    terrain: TerrainSource;
    water: readonly WaterArea[];
    rivers: readonly RiverRow[];
    /** Topographie und Vegetation für die Stärke (Generator 3); leer heißt überall der Rückfall. */
    landscapes: readonly LandscapeArea[];
}

export interface VisualReliefResult {
    /** Das Relief in Schritt (Darstellungsgröße), n², Zeile 0 im Norden; Meer 0. */
    field: Float32Array;
    /** Zellklassen (`SEA`, `LAKE`, `MOUNTAIN`) für die Prüfungen. */
    classes: Uint8Array;
    chains: RiverChain[];
    stats: {
        landCells: number;
        mountainCells: number;
        chains: number;
        floodFrontier: number;
        ms: Record<string, number>;
    };
}

const DEM_SIZE = 4096;
/** Das grobe Gitter der glatten Hilfsfelder (Rauschen, Sockel unter dem Gebirge). */
const COARSE = 1024;

/** Setzt `MOUNTAIN` und liefert die echten Höhen der Gebirgszellen, kompakt. Seen sind nie Gebirge. */
function mountainsOnGrid(
    g: Grid,
    terrain: TerrainSource,
    classes: Uint8Array,
    threshold: number,
): { realCells: Int32Array; realValues: Float32Array } {
    const { n } = g;
    const factor = DEM_SIZE / n;
    const isWater = (k: number): boolean => ((classes[k] as number) & (SEA | LAKE)) !== 0;
    if (factor === 1) {
        // Ein Durchgang: Jeder Durchgang dekodiert alle Kacheln und hinterlässt 50 MB Müll.
        let realCells = new Int32Array(1 << 21);
        let realValues = new Float32Array(1 << 21);
        let count = 0;
        terrain.forEachCell((k, height) => {
            if (!(height > threshold) || isWater(k)) return;
            if (count === realCells.length) {
                const cells = new Int32Array(Math.ceil(count * 1.5));
                cells.set(realCells);
                realCells = cells;
                const values = new Float32Array(cells.length);
                values.set(realValues);
                realValues = values;
            }
            realCells[count] = k;
            realValues[count] = height;
            classes[k] = (classes[k] as number) | MOUNTAIN;
            count += 1;
        });
        return { realCells: realCells.slice(0, count), realValues: realValues.slice(0, count) };
    }
    // Gröberes Gitter (nur Messläufe): Mittel über die Zellen des Geländes.
    const sums = new Float32Array(n * n);
    terrain.forEachCell((k, height) => {
        const x = k % DEM_SIZE;
        const y = (k - x) / DEM_SIZE;
        const own = Math.floor(y / factor) * n + Math.floor(x / factor);
        sums[own] = (sums[own] as number) + height / (factor * factor);
    });
    const cells: number[] = [];
    for (let k = 0; k < sums.length; k += 1) if ((sums[k] as number) > threshold && !isWater(k)) cells.push(k);
    for (const k of cells) classes[k] = (classes[k] as number) | MOUNTAIN;
    return { realCells: Int32Array.from(cells), realValues: Float32Array.from(cells, (k) => sums[k] as number) };
}

/** Abstand zum nächsten Gebirge in E, auf dem groben Gitter (eine Zelle mit Gebirge gilt als Gebirge). */
function mountainDistance(g: Grid, classes: Uint8Array): Coarse {
    const m = Math.min(g.n, COARSE);
    const f = g.n / m;
    const mountain = new Uint8Array(m * m);
    for (let gy = 0; gy < g.n; gy += 1) {
        for (let gx = 0; gx < g.n; gx += 1) {
            if ((classes[gy * g.n + gx] as number) & MOUNTAIN)
                mountain[Math.floor(gy / f) * m + Math.floor(gx / f)] = 1;
        }
    }
    const values = new Float32Array(m * m);
    distanceTransform(grid(m), (k) => mountain[k] === 1, values);
    const cell = MAP_EXTENT_UNITS / m;
    for (let k = 0; k < values.length; k += 1) values[k] = (values[k] as number) * cell;
    return { m, values };
}

/** Ein glattes Feld auf dem groben Gitter, bilinear an einer feinen Zelle gelesen. */
interface Coarse {
    m: number;
    values: Float32Array;
}

function sampleCoarse(c: Coarse, g: Grid, gx: number, gy: number): number {
    const f = c.m / g.n;
    const u = Math.min(c.m - 1, Math.max(0, (gx + 0.5) * f - 0.5));
    const v = Math.min(c.m - 1, Math.max(0, (gy + 0.5) * f - 0.5));
    const i = Math.min(c.m - 2, Math.floor(u));
    const j = Math.min(c.m - 2, Math.floor(v));
    const tx = u - i;
    const ty = v - j;
    const a = c.values[j * c.m + i] as number;
    const b = c.values[j * c.m + i + 1] as number;
    const d = c.values[(j + 1) * c.m + i] as number;
    const e = c.values[(j + 1) * c.m + i + 1] as number;
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + d * (1 - tx) * ty + e * tx * ty;
}

function noiseCoarse(g: Grid, seed: number, cell: number, octaves: number): Coarse {
    const m = Math.min(g.n, COARSE);
    const cg = grid(m);
    const values = new Float32Array(m * m);
    for (let j = 0; j < m; j += 1) {
        const y = cellY(cg, j);
        for (let i = 0; i < m; i += 1) values[j * m + i] = fbm(seed, cellX(cg, i), y, cell, octaves, 0.5);
    }
    return { m, values };
}

/** Harmonische Füllung der `free`-Zellen aus den übrigen, grob nach fein (Mehrgitter). */
function harmonicFill(m: number, values: Float32Array, free: Uint8Array, sweeps: number): Float32Array {
    let start: Float32Array<ArrayBuffer>;
    if (m > 64) {
        const half = m / 2;
        const coarseValues = new Float32Array(half * half);
        const coarseFree = new Uint8Array(half * half);
        for (let y = 0; y < half; y += 1) {
            for (let x = 0; x < half; x += 1) {
                let sum = 0;
                let count = 0;
                for (let dy = 0; dy < 2; dy += 1) {
                    for (let dx = 0; dx < 2; dx += 1) {
                        const k = (2 * y + dy) * m + 2 * x + dx;
                        if (!free[k]) {
                            sum += values[k] as number;
                            count += 1;
                        }
                    }
                }
                coarseFree[y * half + x] = count === 0 ? 1 : 0;
                coarseValues[y * half + x] = count > 0 ? sum / count : 0;
            }
        }
        const filled = harmonicFill(half, coarseValues, coarseFree, sweeps);
        start = new Float32Array(m * m);
        for (let y = 0; y < m; y += 1) {
            for (let x = 0; x < m; x += 1) {
                const k = y * m + x;
                start[k] = free[k] ? (filled[(y >> 1) * half + (x >> 1)] as number) : (values[k] as number);
            }
        }
    } else {
        start = Float32Array.from(values);
    }
    let a = start;
    let b = new Float32Array(m * m);
    for (let s = 0; s < sweeps; s += 1) {
        for (let y = 0; y < m; y += 1) {
            for (let x = 0; x < m; x += 1) {
                const k = y * m + x;
                if (!free[k]) {
                    b[k] = a[k] as number;
                    continue;
                }
                const l = x > 0 ? (a[k - 1] as number) : (a[k] as number);
                const r = x < m - 1 ? (a[k + 1] as number) : (a[k] as number);
                const u = y > 0 ? (a[k - m] as number) : (a[k] as number);
                const d = y < m - 1 ? (a[k + m] as number) : (a[k] as number);
                b[k] = 0.25 * (l + r + u + d);
            }
        }
        const t = a;
        a = b;
        b = t;
    }
    return a;
}

/** Der Sockel unter den Gebirgen: das Flachland ringsum harmonisch fortgesetzt, auf dem groben Gitter. */
function mountainBase(g: Grid, h: Float32Array, classes: Uint8Array): Coarse {
    const m = Math.min(g.n, COARSE);
    const f = g.n / m;
    const values = new Float32Array(m * m);
    const free = new Uint8Array(m * m);
    for (let j = 0; j < m; j += 1) {
        for (let i = 0; i < m; i += 1) {
            let sum = 0;
            let count = 0;
            for (let dy = 0; dy < f; dy += 1) {
                for (let dx = 0; dx < f; dx += 1) {
                    const k = (j * f + dy) * g.n + i * f + dx;
                    if (!((classes[k] as number) & MOUNTAIN)) {
                        sum += h[k] as number;
                        count += 1;
                    }
                }
            }
            free[j * m + i] = count === 0 ? 1 : 0;
            values[j * m + i] = count > 0 ? sum / count : 0;
        }
    }
    return { m, values: harmonicFill(m, values, free, 60) };
}

/** Explizite Hangdiffusion nur im Flachland; `spare` ist das zweite Feld. Zurück kommt das Ergebnis. */
function diffuse(
    g: Grid,
    h: Float32Array,
    spare: Float32Array,
    classes: Uint8Array,
    rate: number,
    steps: number,
    weight?: (x: number, y: number) => number,
): Float32Array {
    const { n } = g;
    let a = h;
    let b = spare;
    for (let s = 0; s < steps; s += 1) {
        b.set(a);
        for (let y = 1; y < n - 1; y += 1) {
            for (let x = 1; x < n - 1; x += 1) {
                const k = y * n + x;
                if ((classes[k] as number) & (SEA | LAKE | MOUNTAIN)) continue;
                const c = a[k] as number;
                b[k] =
                    c +
                    rate *
                        (weight?.(x, y) ?? 1) *
                        ((a[k - 1] as number) +
                            (a[k + 1] as number) +
                            (a[k - n] as number) +
                            (a[k + n] as number) -
                            4 * c);
            }
        }
        const t = a;
        a = b;
        b = t;
    }
    return a;
}

/** Setzt den Spiegel eines Sees auf alle seine Zellen (4er-Nachbarschaft) und markiert sie. */
function fillLake(g: Grid, start: number, level: number, h: Float32Array, classes: Uint8Array, stack: number[]): void {
    const { n } = g;
    stack.length = 0;
    stack.push(start);
    classes[start] = (classes[start] as number) | LEVEL_SET;
    while (stack.length > 0) {
        const k = stack.pop() as number;
        h[k] = level;
        const x = k % n;
        const next = [x > 0 ? k - 1 : -1, x < n - 1 ? k + 1 : -1, k - n, k + n];
        for (const nk of next) {
            if (nk < 0 || nk >= n * n) continue;
            const c = classes[nk] as number;
            if (!(c & LAKE) || c & LEVEL_SET) continue;
            classes[nk] = c | LEVEL_SET;
            stack.push(nk);
        }
    }
}

export function generateVisualRelief(
    input: VisualReliefInput,
    n: number = DEM_SIZE,
    params: Readonly<VisualReliefParams> = VISUAL_RELIEF_PARAMS,
    onPhase: (phase: string) => void = () => undefined,
): VisualReliefResult {
    const g = grid(n);
    const size = n * n;
    const ms: Record<string, number> = {};
    let t0 = Date.now();
    const lap = (name: string): void => {
        ms[name] = Date.now() - t0;
        t0 = Date.now();
        onPhase(name);
    };

    // 1. Wasser und Küste. `h` hält zunächst den Küstenabstand (E).
    const classes = new Uint8Array(size);
    rasterizeWater(g, input.water, classes);
    const h = new Float32Array(size);
    coastDistance(
        g,
        classes,
        input.water.filter((area) => area.kind === "meer"),
        h,
    );
    const chains = riverChains(g, input.rivers);
    lap("wasser");

    // 2. Das echte Gelände, nur für Gebirgszellen (Mittel über die Zellen des Geländes, wenn gröber).
    const { realCells, realValues } = mountainsOnGrid(g, input.terrain, classes, params.mountainThreshold);
    // Das echte Gelände dort, wo die Flüsse es brauchen: an den Enden der Läufe ohne Richtung und unter jeder
    // Flusszelle im Gebirge (`carveValleys`). Im Flachland ist es 0.
    const terrainOf = new Map<number, number>();
    for (const chain of chains) {
        if (chain.unknown) {
            terrainOf.set(chain.cells[0] as number, 0);
            terrainOf.set(chain.cells[chain.cells.length - 1] as number, 0);
        }
        for (const k of chain.cells) if ((classes[k] as number) & MOUNTAIN) terrainOf.set(k, 0);
    }
    for (let i = 0; i < realCells.length; i += 1) {
        if (terrainOf.has(realCells[i] as number)) terrainOf.set(realCells[i] as number, realValues[i] as number);
    }
    const terrainAt = (k: number): number => terrainOf.get(k) ?? 0;
    // Läufe ohne Richtung: vom Nachbarn, sonst von hoch nach tief im Gelände, sonst zur Küste (`h` ist noch
    // der Küstenabstand).
    orientUnknown(g, chains, h, terrainAt);
    // Das Auslaufen zur Mündung braucht den Küstenabstand je Flusszelle; danach wird `h` das Relief.
    const fade = chains.map((chain) =>
        Float32Array.from(chain.cells, (k) => Math.min(1, (h[k] as number) / params.mouthFade)),
    );
    const sinks = params.mouthFoot >= 0 ? mouthSinks(g, chains, classes, Math.ceil(params.mouthFoot / g.cell)) : [];
    lap("gelaende");

    // 3. Rauheit U: großräumiges Rauschen, dazu Ü2 das rauere Vorland um jedes Gebirge, mal die Stärke der
    //    Landschaft (Generator 3).
    const rugged = noiseCoarse(g, params.seed, params.ruggedCell, 3);
    const strength = landscapeStrength(g, classes, input.landscapes, params);
    const work = new Float32Array(size);
    // Der Abstand zum Gebirge auf dem groben Gitter (1 E): für ein Vorland von 3 E fein genug.
    const foot = params.foothillAmp > 0 ? mountainDistance(g, classes) : undefined;
    const upliftAt = (k: number, gx: number, gy: number): number => {
        let u =
            Math.max(0.1, 1 + params.ruggedAmp * sampleCoarse(rugged, g, gx, gy)) * sampleCoarse(strength, g, gx, gy);
        if (foot) {
            u *= 1 + params.foothillAmp * Math.exp(-sampleCoarse(foot, g, gx, gy) / params.foothillWidth);
        }
        return u;
    };
    lap("rauheit");

    // 4. Die erste Fläche: steigt mit dem Küstenabstand, verrauscht.
    const initNoise = noiseCoarse(g, params.seed + 17, params.initCell, 4);
    for (let gy = 0; gy < n; gy += 1) {
        for (let gx = 0; gx < n; gx += 1) {
            const k = gy * n + gx;
            h[k] =
                (classes[k] as number) & SEA
                    ? 0
                    : params.initSlope *
                      (h[k] as number) *
                      SCHRITT_PER_UNIT *
                      (1 + params.initNoise * sampleCoarse(initNoise, g, gx, gy));
        }
    }

    let landCells = 0;
    for (let k = 0; k < size; k += 1) if (!((classes[k] as number) & SEA)) landCells += 1;
    const order = new Int32Array(landCells);
    const stack: number[] = [];
    const heap = new CellHeap(1 << 19);
    const depth = chains.map((chain) => new Float32Array(chain.cells.length));
    const setMountains = (): void => {
        const base = mountainBase(g, h, classes);
        for (let i = 0; i < realCells.length; i += 1) {
            const k = realCells[i] as number;
            const gx = k % n;
            h[k] = sampleCoarse(base, g, gx, (k - gx) / n) + (realValues[i] as number);
        }
    };

    for (let round = 0; round < params.iterations; round += 1) {
        setMountains();
        // Routingfläche: aktuelles Relief, gezittert, Flüsse eingebrannt.
        const jitter = params.jitter / (round + 1);
        for (let gy = 0; gy < n; gy += 1) {
            for (let gx = 0; gx < n; gx += 1) {
                const k = gy * n + gx;
                const c = classes[k] as number;
                work[k] =
                    c & SEA
                        ? 0
                        : c & MOUNTAIN
                          ? (h[k] as number)
                          : (h[k] as number) + jitter * hash2(params.seed + 99 + round, gx, gy);
            }
        }
        for (const chain of chains) {
            let previous = -Infinity;
            for (let i = chain.cells.length - 1; i >= 0; i -= 1) {
                const k = chain.cells[i] as number;
                if ((classes[k] as number) & SEA) {
                    previous = -Infinity;
                    continue;
                }
                const v = Math.max((work[k] as number) - params.burn, previous + params.burnStep);
                previous = v;
                if (v < (work[k] as number)) work[k] = v;
            }
        }
        const count = priorityFlood(g, work, classes, 0.01, order, heap, sinks, params.seed);
        rho8(g, work, classes, params.seed + 7 * round);
        accumulate(g, order, count, classes, work);

        // Das Gleichgewicht von der Küste aufwärts; Gebirge fest, ein Spiegel je See.
        for (let k = 0; k < size; k += 1) classes[k] = (classes[k] as number) & ~LEVEL_SET;
        for (let i = 0; i < count; i += 1) {
            const k = order[i] as number;
            const c = classes[k] as number;
            if (c & (MOUNTAIN | LEVEL_SET)) continue;
            const r = receiverOf(g, k, classes);
            // Ohne Empfänger (Meer, Rand, Mündung am Gebirge) ist die Grundhöhe 0: Ein Becken, das am Gebirge
            // mündet, baut darauf auf wie eines am Meer.
            const below = r >= 0 ? (h[r] as number) : 0;
            if (c & LAKE) {
                fillLake(g, k, below, h, classes, stack);
                continue;
            }
            const d = directionOf(classes, k);
            const run = (d < 4 || d >= 8 ? 1 : Math.SQRT2) * g.cell * SCHRITT_PER_UNIT;
            const gx = k % n;
            const slope =
                params.kS *
                upliftAt(k, gx, (k - gx) / n) *
                Math.pow(Math.max(work[k] as number, params.aMin), -params.m);
            h[k] = below + slope * run;
        }
        onPhase(`runde ${String(round + 1)}`);
        if (round === params.iterations - 1) {
            // Die Tiefe der Täler aus der letzten Einzugsfläche.
            chains.forEach((chain, c) => {
                const share = chain.bach ? params.brookShare : 1;
                for (let i = 0; i < chain.cells.length; i += 1) {
                    const k = chain.cells[i] as number;
                    const area = work[k] as number;
                    const gx = k % n;
                    (depth[c] as Float32Array)[i] =
                        Math.min(params.valleyMaxDepth, params.valleyDepth * Math.pow(area / 100, params.valleyExp)) *
                        ((fade[c] as Float32Array)[i] as number) *
                        share *
                        sampleCoarse(strength, g, gx, (k - gx) / n);
                }
            });
        }
    }
    setMountains();
    lap("gleichgewicht");

    // 5. Hangdiffusion, danach die Täler.
    const smooth = diffuse(g, h, work, classes, params.diffRate, params.diffSteps);
    if (smooth !== h) h.set(smooth);
    const rounded = landscapeStrength(g, classes, input.landscapes, {
        landscapeStrength: { huegelland: 1, hochebene: 0.6, steppe: 0.25 },
        landscapeFallback: 0,
        landscapeBlur: params.landscapeBlur,
    });
    const softer = diffuse(g, h, work, classes, params.diffRate, 4, (x, y) => sampleCoarse(rounded, g, x, y));
    if (softer !== h) h.set(softer);
    // Die breiten Landformen und der zum Meer gerichtete Küstenhang sollen auch im Licht lesbar sein.
    for (let y = 0; y < n; y += 1) {
        for (let x = 0; x < n; x += 1) {
            const k = y * n + x;
            if (!((classes[k] as number) & SEA))
                h[k] = (h[k] as number) + continentalHeight(input.continental, cellX(g, x), cellY(g, y));
        }
    }
    // Auch Seen ohne eingezeichneten Fluss brauchen nach der Addition genau einen Spiegel.
    for (const lake of input.water.filter((area) => area.kind === "see")) {
        let level = Infinity;
        fillArea(g, lake.geometry, (k) => {
            if ((classes[k] as number) & LAKE) level = Math.min(level, h[k] as number);
        });
        fillArea(g, lake.geometry, (k) => {
            if ((classes[k] as number) & LAKE) h[k] = level;
        });
    }
    carveValleys(g, h, work, classes, chains, depth, params, terrainAt);
    lap("taeler");

    for (let k = 0; k < size; k += 1) classes[k] = (classes[k] as number) & (SEA | LAKE | MOUNTAIN);
    return {
        field: h,
        classes,
        chains,
        stats: { landCells, mountainCells: realCells.length, chains: chains.length, floodFrontier: heap.peak, ms },
    };
}

/**
 * Täler entlang der bekannten Flüsse: Boden = Flusshöhe minus Tiefe, fallend in Fließrichtung, der Hang
 * läuft mit `(1 − t²)²` glatt aus (t Abstand durch halbe Breite). Ein Bach ist halb so breit.
 *
 * Der Boden reicht durch Seen und Gebirge weiter (Betreiber 2026-09-28: „wenn ein see auf der höhe eines
 * flusses ist, muss der see an dieser höhe sein“): Ein See, durch den ein Fluss läuft, liegt eben auf Höhe
 * des Flussbetts an seinem Abfluss, der Zufluss liegt nie tiefer, der Abfluss nie höher. Im Gebirge bleibt
 * das echte Gelände (`terrainAt`); unter einer Flusszelle sinkt nur der Sockel höchstens auf den Boden, der
 * von flussauf kommt, und flussab fließt der Lauf nicht höher weiter, als er hineinkam.
 */
export function carveValleys(
    g: Grid,
    h: Float32Array,
    spare: Float32Array,
    classes: Uint8Array,
    chains: readonly RiverChain[],
    depth: readonly Float32Array[],
    params: Readonly<VisualReliefParams>,
    terrainAt: (k: number) => number = () => 0,
): void {
    if (params.valleyWidth <= 0) return;
    const { n, cell } = g;
    const blocked = SEA | LAKE | MOUNTAIN;
    // Je Flusszelle die größte Breite und Tiefe über alle Läufe, die sie berühren.
    const width = new Map<number, number>();
    const floor = new Map<number, number>();
    chains.forEach((chain, c) => {
        const w = params.valleyWidth * (chain.bach ? params.brookShare : 1);
        for (let i = 0; i < chain.cells.length; i += 1) {
            const k = chain.cells[i] as number;
            if ((classes[k] as number) & blocked) continue;
            width.set(k, Math.max(width.get(k) ?? 0, w));
            const bottom = (h[k] as number) - ((depth[c] as Float32Array)[i] as number);
            floor.set(k, Math.min(floor.get(k) ?? Infinity, bottom));
        }
    });
    // Die Seen, durch die ein Lauf geht, mit ihrem Spiegel.
    const lakeOf = new Map<number, number>();
    const lakeCells: number[][] = [];
    const level: number[] = [];
    for (const chain of chains) {
        for (const start of chain.cells) {
            if (!((classes[start] as number) & LAKE) || lakeOf.has(start)) continue;
            const id = lakeCells.length;
            const cells = [start];
            lakeOf.set(start, id);
            for (let i = 0; i < cells.length; i += 1) {
                const k = cells[i] as number;
                const x = k % n;
                for (const nk of [x > 0 ? k - 1 : -1, x < n - 1 ? k + 1 : -1, k - n, k + n]) {
                    if (nk < 0 || nk >= n * n || lakeOf.has(nk) || !((classes[nk] as number) & LAKE)) continue;
                    lakeOf.set(nk, id);
                    cells.push(nk);
                }
            }
            lakeCells.push(cells);
            level.push(h[start] as number);
        }
    }
    // Fallend in Fließrichtung, Durchgang um Durchgang, bis sich nichts mehr ändert: Jeder Durchgang reicht
    // einen tiefen Boden nur einen Zusammenfluss (oder See) weiter. Es endet, weil nur das Minimum
    // vorhandener Werte gesetzt wird; ein Ring aus Läufen endet eben.
    for (let changed = true; changed;) {
        changed = false;
        for (const chain of chains) {
            let run = Infinity;
            let lake = -1;
            for (const k of chain.cells) {
                const c = classes[k] as number;
                if (c & SEA) {
                    run = Infinity;
                    lake = -1;
                    continue;
                }
                const id = lakeOf.get(k);
                if (id !== undefined) {
                    // Der Zufluss zieht den Spiegel herab, nie hinauf.
                    if (run < (level[id] as number)) {
                        level[id] = run;
                        changed = true;
                    }
                    run = level[id] as number;
                    lake = id;
                    continue;
                }
                if (c & MOUNTAIN) {
                    // Unter dem Fluss sinkt nur der Sockel auf den Boden, das echte Gelände bleibt obenauf. Sonst
                    // stünde ein schmaler Gebirgsrand quer im Fluss auf dem Sockel des Hügellands, 1.200 Schritt
                    // über dem Bett (Gotjasach an den Drachensteinen).
                    // Auf Float32 gerundet vergleichen: Sonst rundet das Feld beim Schreiben auf, und die
                    // Schleife hält den Sockel ewig für zu hoch.
                    const lowered = Math.fround(run + terrainAt(k));
                    if (lowered < (h[k] as number)) {
                        h[k] = lowered;
                        changed = true;
                    }
                }
                const value = c & MOUNTAIN ? (h[k] as number) : floor.get(k);
                if (value === undefined) continue;
                if (lake >= 0) {
                    // Das Flussbett am Abfluss ist der Spiegel.
                    if (value < (level[lake] as number)) {
                        level[lake] = value;
                        changed = true;
                    }
                    lake = -1;
                }
                if (c & MOUNTAIN) {
                    run = Math.min(run, value);
                } else if (run < value) {
                    floor.set(k, run);
                    changed = true;
                } else {
                    run = value;
                }
            }
        }
    }
    lakeCells.forEach((cells, id) => {
        for (const k of cells) h[k] = level[id] as number;
    });
    spare.set(h);
    for (const [source, w] of width) {
        const bottom = floor.get(source) as number;
        const sx = source % n;
        const sy = (source - sx) / n;
        const reach = Math.ceil(w / cell);
        for (let dy = -reach; dy <= reach; dy += 1) {
            const y = sy + dy;
            if (y < 0 || y >= n) continue;
            for (let dx = -reach; dx <= reach; dx += 1) {
                const x = sx + dx;
                if (x < 0 || x >= n) continue;
                const k = y * n + x;
                if ((classes[k] as number) & blocked) continue;
                // Eine Flusszelle trägt nur ihren eigenen Boden: Sonst zöge ein tieferer Nachbarfluss sie hinab,
                // und der Lauf stiege danach wieder an.
                if (k !== source && width.has(k)) continue;
                const t = (Math.hypot(dx, dy) * cell) / w;
                if (!(t < 1)) continue;
                const bell = (1 - t * t) * (1 - t * t);
                const target = bottom + ((h[k] as number) - bottom) * (1 - bell);
                if (target < (spare[k] as number)) spare[k] = target;
            }
        }
    }
    h.set(spare);
}
