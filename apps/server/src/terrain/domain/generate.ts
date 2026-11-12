import { createHash } from "node:crypto";
import { grid, LAKE, SEA, type Plane } from "../hydrology/grid.ts";
import { accumulate, FloodQueue, floodNoise, priorityFlood, receiverOf, directionOf } from "../hydrology/flow.ts";
import { coastDistance } from "../hydrology/water.ts";
import { landscapeSampler } from "../hydrology/landscape.ts";
import { riverChains, orientUnknown } from "../hydrology/rivers.ts";
import { streamPowerHeight, type WasserHoehe } from "@avesmaps3d/shared";
import type { StoredRaster } from "../dem-tiles.ts";
import { burnRivers, type RiverBurnReport } from "../river-burn.ts";
import type { RiverValley } from "../river-valley.ts";
import type { Finding } from "../../findings.ts";
import {
    constraintFindings,
    lakeRiverNotConvergedFinding,
    peakCoreInSeaFinding,
    riverGateFinding,
} from "./constraint-findings.ts";
import type { DomainInputs, DomainPeak } from "./inputs.ts";
import type { TerrainRecipe } from "./recipes.ts";
import { verifyDomainRaster } from "./verify.ts";
import { domainRivers, eigeneSeeSpiegel, fixedLakeBurn, flattenDomainLakes } from "./lakes.ts";
import { lakeBodies } from "./lake-bodies.ts";
import { bedLevels } from "./lake-level.ts";
import { domainIslands, ignoredMarinePeaks } from "./constraints.ts";
import { domainSummits, restoreSummits, seedPeaks } from "./peak-seed.ts";
import { formInitialTerrain } from "./initial-terrain.ts";
import {
    domainClasses,
    dryLandMask,
    seeUferMask,
    mountainInterior,
    refineMountainInterior,
    type MountainInteriorReport,
} from "./mountain-interior.ts";
import { projectSummits } from "./summits.ts";
import { composeFine, type FineCache } from "./fine.ts";
import { releaseIntermediates } from "./memory.ts";
import { redistributeRegionally, regionalRadiusCells, regionalWeightSum, type RegionalUpliftReport } from "./uplift.ts";
import { gipfelUnterGrundhoehe, gipfelUnterGrundhoeheFinding, type GipfelUnterGrundhoehe } from "./peak-floor.ts";
import type { CoarseState } from "./coarse-local.ts";
import { erosionExec, sharedCopy, sharedFloat32 } from "./erosion-pool.ts";
import { deckleRueckennetz, stelleKoepfeWieder, triffEigeneHoehen } from "./rueckennetz-flaechen.ts";
import { beckenSchutz, hebeSeeRaender } from "./see-becken.ts";
import { fensterLeser, formerhaltFenster } from "./formerhalt.ts";
import { gitterSicht, rasterSicht, type HoehenBeobachter } from "./beobachter.ts";

export const DOMAIN_GENERATOR_VERSION = "19";
type Inputs = DomainInputs;
export interface SimulationResult {
    raster: StoredRaster;
    ignoredPeaks: DomainPeak[];
    peaks: DomainPeak[];
    masses: { before: number; after: number }[];
    /** Real water classes (low bits SEA/LAKE; non-land is SEA), reused by the interior refinement. */
    classes: Uint8Array;
    /** What the run reports without stopping (operator 2026-10-03), e.g. a summit core in the sea. */
    findings: Finding[];
    /** Only with the regional redistribution (prototype D). */
    uplift?: RegionalUpliftReport;
}
export interface DomainTerrainResult {
    raster: StoredRaster;
    fingerprint: string;
    report: {
        /** Fine tiles recomputed in this run, of all tiles (WI-0070). */
        fineTiles?: { computed: number; total: number };
        ignoredPeaks: DomainPeak[];
        masses: { before: number; after: number }[];
        burn: RiverBurnReport;
        generator: string;
        mountainInterior?: MountainInteriorReport;
        /** Prototype D only: the regional redistribution and what it had to clamp. Absent with the default. */
        uplift?: RegionalUpliftReport;
        /** Final summit projection: restored core cells (normally 0) and raised support-flank cells. */
        summits?: { exactCells: number; supportCells: number };
        provenance: {
            GENERATED_LEGACY_SEED: { id: string; name: string }[];
            GENERATED_PEAK_FALLBACK: DomainPeak[];
        };
        /**
         * The final constraints (lakes level, summits exact, sea 0, rivers not uphill, summit core in the sea) as findings
         * with numbers and objects. They do not stop the run (operator 2026-10-03, „A auch für die Prüfungen“). Absent in
         * reports stored before that decision.
         */
        findings?: Finding[];
        /** Je Gebirge die Gipfel unter seiner Grundhöhe mit dem Gelände am Gipfel und ringsum (`peak-floor.ts`); fehlt in älteren Berichten. */
        gipfelUnterGrundhoehe?: GipfelUnterGrundhoehe[];
    };
}

/**
 * Das Anfangsgelände eines vorigen Laufs übernehmen (WI-0223 Schritt 2): neu gerechnet wird es nur in `plane`, außerhalb gilt `heights`
 * (ganze Karte, Zeile 0 im Norden). Das Fenster muss jede Zelle enthalten, deren Anfangshöhe sich mit den Eingaben geändert haben kann;
 * der Fußabdruck (`footprint.ts`, ein Ring von 128 E um die Änderung) deckt die Reichweite des Anfangsgeländes (bis 100 E).
 */
export interface InitialReuse {
    heights: Float32Array;
    plane: Plane;
}

export interface SimulationOptions {
    initial?: InitialReuse;
    /** Erhält das Anfangsgelände (ganze Karte, Zeile 0 im Norden), bevor Gipfel, Seen und Erosion es verändern; nur lesen. */
    keepInitial?: (height: Float32Array) => void;
    /** Worker der Erosion neben dem Hauptthread (WI-0227); ohne Angabe `erosionWorkersFor`. Das Gelände ist mit jeder Zahl dasselbe. */
    erosionWorkers?: number;
    /** Sieht das Höhenfeld nach jeder Phase (WI-0249, `beobachter.ts`); nur lesen. Ohne ihn rechnet alles wie zuvor. */
    beobachter?: HoehenBeobachter;
}

/** Ab dieser Gittergröße lohnen Worker; kleinere Gitter (Proben, Tests) rechnet der Hauptthread allein. */
export const EROSION_WORKERS_FROM_SIZE = 1024;

/**
 * Die Worker der Erosion, wenn der Aufrufer keine nennt (WI-0227): `TERRAIN_EROSION_WORKERS` (0 bis 8), sonst 2 (Claudio 2026-10-18:
 * 2 Worker plus Hauptthread, einer von vier Kernen bleibt frei). Abends kann Claudio über die Umgebung des Auftrags auf 1 stellen.
 */
export function erosionWorkersFor(size: number, environment: NodeJS.ProcessEnv = process.env): number {
    if (size < EROSION_WORKERS_FROM_SIZE) return 0;
    const raw = environment["TERRAIN_EROSION_WORKERS"];
    const value = raw === undefined || raw === "" ? 2 : Number(raw);
    return Number.isInteger(value) && value >= 0 && value <= 8 ? value : 2;
}

export function simulateDomainTerrain(
    input: Inputs,
    recipe: TerrainRecipe,
    size: number = recipe.generator.size,
    phase?: (name: string) => void,
    options: SimulationOptions = {},
): SimulationResult {
    const g = grid(size);
    const params = recipe.generator;
    const { initial, beobachter } = options;
    const formed = formInitialTerrain(g, input, recipe, phase, initial?.plane, beobachter);
    const { land, landCells, materials } = formed;
    // Mit Workern liegen die großen Felder der Erosion im gemeinsamen Speicher (WI-0227); die Rechnung ist dieselbe.
    const workers = options.erosionWorkers ?? erosionWorkersFor(g.n);
    const height = workers > 0 ? sharedCopy(formed.height) : formed.height;
    const classes = workers > 0 ? sharedCopy(formed.classes) : formed.classes;
    if (initial) {
        if (initial.heights.length !== height.length)
            throw new RangeError("Anfangsgelände und Gitter passen nicht zusammen");
        const { x0, y0, width, height: rows } = initial.plane;
        for (let y = 0; y < g.n; y += 1)
            for (let x = 0; x < g.n; x += 1)
                if (x < x0 || y < y0 || x >= x0 + width || y >= y0 + rows)
                    height[y * g.n + x] = initial.heights[y * g.n + x]!;
    }
    options.keepInitial?.(height);
    beobachter?.("initial", gitterSicht(g, height));
    const ignoredPeaks = ignoredMarinePeaks(input);
    const ignoredIds = new Set(ignoredPeaks.map((p) => p.id));
    const peaks = input.peaks.filter((p) => !ignoredIds.has(p.id));
    const locked = workers > 0 ? new Uint8Array(new SharedArrayBuffer(height.length)) : new Uint8Array(height.length);
    const findings: Finding[] = [];
    const reportedInSea = new Set<string>();
    const projectPeaks = (): void => {
        for (const peak of peaks) {
            if (peak.h === null || !(peak.h > 0)) continue;
            const x = Math.floor(peak.x / g.cell - 0.5);
            const y = g.n - 2 - Math.floor(peak.y / g.cell - 0.5);
            for (const dy of [0, 1])
                for (const dx of [0, 1]) {
                    if (x + dx < 0 || y + dy < 0 || x + dx >= g.n || y + dy >= g.n) continue;
                    const k = (y + dy) * g.n + x + dx;
                    if ((classes[k]! & SEA) !== 0) {
                        // Operator 2026-10-03: a core cell in the sea is a finding, not a stop. The cell is not locked here;
                        // the final verification names what is left (sea cells not 0, peak not exact).
                        if (!reportedInSea.has(peak.id)) {
                            reportedInSea.add(peak.id);
                            findings.push(peakCoreInSeaFinding(peak));
                        }
                        continue;
                    }
                    locked[k] = 1;
                    height[k] = peak.h;
                }
        }
    };
    seedPeaks(g, land, height, domainSummits(peaks, input.landscapes, recipe.mountainMorphology.interior, params.seed));
    projectPeaks();
    // A lake lies on the lowest land under it (WI-0067, operator 2026-10-04), one level per water body (`lake-level.ts`). It
    // starts as a level plane at that height, so the erosion cuts the banks gently down to it: a wide shallow hollow, not a pit
    // with a cliff at the shore.
    const bodies = lakeBodies(g, input.water, classes);
    const levelLakes = (): void => {
        const levels = bedLevels(bodies, (k) => height[k]!, params.lakes.bedQuantile);
        bodies.forEach((body, index) => {
            for (const k of body.cells) height[k] = levels[index]!;
        });
    };
    levelLakes();
    releaseIntermediates();
    phase?.("seed");
    beobachter?.("seed", gitterSicht(g, height));
    releaseIntermediates();
    const sample = landscapeSampler(materials.m, g.n);
    const material = (
        name: "upliftWeight" | "erodibility" | "diffusivity" | "runoff" | "channelBias",
        k: number,
    ): number => sample(materials[name], k % g.n, Math.floor(k / g.n));
    const chains = riverChains(
        g,
        input.rivers.rivers.map((r) => ({ coordinates: r.coordinates, isBach: r.bach, flowDirection: r.direction })),
    );
    const coast = workers > 0 ? sharedFloat32(height.length) : new Float32Array(height.length);
    coastDistance(
        g,
        classes,
        input.water.filter((a) => a.kind === "meer"),
        coast,
    );
    orientUnknown(g, chains, coast, (k) => height[k]!);
    const surface = coast;
    const area = workers > 0 ? sharedFloat32(height.length) : new Float32Array(height.length);
    const spare = area;
    const order = new Int32Array(landCells);
    // Über alle Runden gleich: die Schlange in Eimern und der Zufall des Anstiegs je Zelle (WI-0227, bytegleich zur Rechnung je Runde).
    const heap = new FloodQueue(Math.max(1024, g.n * 8));
    const noise = floodNoise(g, params.seed);
    // Formerhalt der Rückennetz-Gebirge (WI-0249 P2 Schritt 4): Erodierbarkeit und Diffusivität je Gebirge im Fenster; ohne den
    // Eintrag im Rezept keine Fenster, und Einschneiden und Diffusion lesen Zeichen für Zeichen das Materialfeld wie zuvor.
    const formerhalt = formerhaltFenster(g, input, recipe, materials);
    const fenster = formerhalt.length > 0 ? fensterLeser(formerhalt, g.n) : undefined;
    const erodibilityAt = (k: number): number => {
        const eigen = fenster ? fenster("erodibility", k % g.n, Math.floor(k / g.n)) : Number.NaN;
        return Number.isNaN(eigen) ? material("erodibility", k) : eigen;
    };
    let maximumDiffusion = 1;
    for (const d of materials.diffusivity) maximumDiffusion = Math.max(maximumDiffusion, d);
    for (const f of formerhalt)
        for (const d of f.diffusivity) if (!Number.isNaN(d)) maximumDiffusion = Math.max(maximumDiffusion, d);
    const diffusionSteps = Math.max(1, Math.ceil((params.diffusion * params.timeStep * maximumDiffusion) / 0.2));
    const mass = (): number => {
        let sum = 0;
        for (let k = 0; k < height.length; k += 1) if (!(classes[k]! & (SEA | LAKE))) sum += height[k]!;
        return sum;
    };
    const masses: { before: number; after: number }[] = [];
    // Constant over all rounds: locks, water and materials do not change while eroding. No uplift on water and anchors.
    // Mit dem Formerhalt (`hebungFolgt`) im Fenster eines Rückennetz-Gebirges sein Hebungsgewicht; sonst das Materialfeld wie zuvor.
    const hebungAt = (k: number): number => {
        const eigen = fenster ? fenster("upliftWeight", k % g.n, Math.floor(k / g.n)) : Number.NaN;
        return Number.isNaN(eigen) ? material("upliftWeight", k) : eigen;
    };
    const upliftAt = (k: number): number => (locked[k] || classes[k]! & (SEA | LAKE) ? 0 : hebungAt(k));
    let totalWeight = 0;
    for (let k = 0; k < height.length; k += 1) totalWeight += upliftAt(k);
    // Prototyp D (standardmäßig aus): der Verlust jeder Zelle geht in ihre Umgebung zurück statt über die ganze Karte.
    const regional = params.uplift
        ? {
              radiusCells: regionalRadiusCells(params.uplift.radius, g.cell),
              report: {
                  ...params.uplift,
                  clampedCells: 0,
                  unplacedLoss: 0,
                  ...(params.uplift.saturation === undefined ? {} : { saturatedCells: 0 }),
              } as RegionalUpliftReport,
              // Nachstimmung 2026-10-10 (standardmäßig aus): zwei Felder mehr, nur mit Sättigung.
              saturation:
                  params.uplift.saturation === undefined
                      ? undefined
                      : {
                            value: params.uplift.saturation,
                            fields:
                                workers > 0
                                    ? { first: sharedFloat32(height.length), sum: sharedFloat32(height.length) }
                                    : { first: new Float32Array(height.length), sum: new Float32Array(height.length) },
                        },
          }
        : undefined;
    const weightSum = regional
        ? regionalWeightSum(
              g.n,
              upliftAt,
              area,
              regional.radiusCells,
              workers > 0 ? sharedFloat32(height.length) : undefined,
          )
        : undefined;
    const exec = erosionExec(
        {
            n: g.n,
            cell: g.cell,
            height,
            surface,
            spare,
            classes,
            locked,
            weightSum: weightSum ?? null,
            first: regional?.saturation?.fields.first ?? null,
            sum: regional?.saturation?.fields.sum ?? null,
            materials: {
                m: materials.m,
                channelBias: materials.channelBias,
                diffusivity: materials.diffusivity,
                upliftWeight: materials.upliftWeight,
            },
            ...(formerhalt.length > 0 ? { formerhalt } : {}),
        },
        workers,
    );
    let current = mass();
    try {
        for (let round = 0; round < params.iterations; round += 1) {
            const before = current;
            exec.run("surface");
            for (const chain of chains)
                for (let i = 0; i < chain.cells.length; i += 1) {
                    const k = chain.cells[i]!;
                    if (!(classes[k]! & SEA)) surface[k] = -params.drainageBurn - i * params.drainageStep;
                }
            const count = priorityFlood(g, surface, classes, params.drainageStep, order, heap, [], params.seed, noise);
            exec.rho8(params.seed);
            accumulate(g, order, count, classes, area, (k) => material("runoff", k));
            // The routing surface is done; regionally it keeps the height at the start of the round.
            if (weightSum) surface.set(height);
            for (let i = 0; i < count; i += 1) {
                const k = order[i]!;
                if (locked[k] || classes[k]! & (SEA | LAKE)) continue;
                const r = receiverOf(g, k, classes);
                const d = directionOf(classes, k);
                height[k] = streamPowerHeight(
                    height[k]!,
                    r < 0 ? 0 : height[r]!,
                    area[k]!,
                    params.streamPowerK * erodibilityAt(k),
                    params.streamPowerM,
                    params.timeStep,
                    g.cell * (d >= 4 && d < 8 ? Math.SQRT2 : 1),
                );
            }
            beobachter?.(`erosion-${String(round + 1)}/stream`, gitterSicht(g, height));
            for (let step = 0; step < diffusionSteps; step += 1) {
                spare.set(height);
                exec.run("diffuse", [(params.diffusion * params.timeStep) / diffusionSteps]);
                height.set(spare);
            }
            beobachter?.(`erosion-${String(round + 1)}/diffusion`, gitterSicht(g, height));
            const loss = before - mass();
            if (regional && weightSum && regional.saturation) {
                const placed = exec.saturated(upliftAt, regional.radiusCells, regional.saturation.value);
                regional.report.clampedCells += placed.clampedCells;
                regional.report.unplacedLoss += placed.unplacedLoss;
                regional.report.saturatedCells = Math.max(regional.report.saturatedCells ?? 0, placed.saturatedCells);
            } else if (regional && weightSum) {
                const placed = redistributeRegionally(
                    height,
                    surface,
                    spare,
                    weightSum,
                    upliftAt,
                    g.n,
                    regional.radiusCells,
                );
                regional.report.clampedCells += placed.clampedCells;
                regional.report.unplacedLoss += placed.unplacedLoss;
            } else if (loss > 0 && totalWeight > 0)
                for (let k = 0; k < height.length; k += 1)
                    if (!locked[k] && !(classes[k]! & (SEA | LAKE)))
                        height[k] = height[k]! + (loss * hebungAt(k)) / totalWeight;
            beobachter?.(`erosion-${String(round + 1)}/uplift`, gitterSicht(g, height));
            current = mass();
            masses.push({ before, after: current });
            phase?.(`erosion-${String(round + 1)}`);
        }
    } finally {
        exec.close();
    }
    // The erosion leaves the lake cells alone (flat at their level); only the summit cores are set again.
    projectPeaks();
    beobachter?.("erosion", gitterSicht(g, height));
    const samples = new Uint16Array(height.length);
    for (let y = 0; y < g.n; y += 1)
        for (let x = 0; x < g.n; x += 1) {
            const k = y * g.n + x;
            if (!Number.isFinite(height[k]) || height[k]! < 0 || height[k]! > 65535)
                throw new Error("Domain height is outside uint16 range");
            samples[(g.n - 1 - y) * g.n + x] = classes[k]! & SEA ? 0 : Math.round(height[k]!);
        }
    const raster: StoredRaster = {
        cell: g.cell,
        originX: g.cell / 2,
        originY: g.cell / 2,
        width: g.n,
        height: g.n,
        samples,
    };
    return { raster, ignoredPeaks, peaks, masses, classes, findings, ...(regional ? { uplift: regional.report } : {}) };
}

/** Die grobe Stufe bis zum Gebirgsinneren, vor den Schlussschritten. */
export type FormedCoarse = Omit<SimulationResult, "classes"> & { mountainInterior: MountainInteriorReport };

/** Die grobe Stufe eines Laufs (WI-0223 Schritt 2). */
export interface CoarseOptions {
    /** Erhält den Stand der groben Stufe, bevor die Schlussschritte das Raster verändern; der nächste lokale Lauf baut darauf. */
    keep?: (state: CoarseState) => void;
    /** Statt der vollen groben Stufe diese (`coarse-local.ts`); sie meldet ihren Stand selbst. */
    form?: (phase?: (name: string) => void) => FormedCoarse;
}

/** All terrain-forming steps; the water classes end with this frame. */
function formDomainTerrain(
    input: Inputs,
    recipe: TerrainRecipe,
    size: number,
    phase?: (name: string) => void,
    coarse?: CoarseOptions,
    beobachter?: HoehenBeobachter,
): FormedCoarse {
    if (coarse?.form) return coarse.form(phase);
    let initial: Float32Array | undefined;
    const { classes, ...simulation } = simulateDomainTerrain(input, recipe, size, phase, {
        ...(coarse?.keep ? { keepInitial: (height: Float32Array) => (initial = height.slice()) } : {}),
        ...(beobachter ? { beobachter } : {}),
    });
    releaseIntermediates();
    const interior = mountainInterior(simulation.raster, input, recipe, classes);
    const report = refineMountainInterior(simulation.raster, input, recipe, interior);
    phase?.("mountain-interior");
    beobachter?.("mountain-interior", rasterSicht(simulation.raster));
    if (coarse?.keep && initial) coarse.keep({ initial, interior: simulation.raster.samples.slice() });
    return { ...simulation, mountainInterior: report };
}

/**
 * Die Talform des Einbrennens (WI-0249, Flusstäler unter hohen Massiven; nur Fassung 19 setzt `riverValley.mountainShare`): Die Flanke wird
 * steiler, je höher das Land am Fluss liegt, aus vorhandenen Werten: im Hochgebirge um `mountainShare` von der Talflanke (`flankGrade`) zur
 * größten Gebirgssteilheit (`interior.maximumGrade`), weich über die Hochgebirgsgrenze (`interior.alpine.from` bis `to`) wie Felsgrenzhang und
 * Gipfel. Ohne den Wert das Rezept selbst, Zeichen für Zeichen wie zuvor.
 */
export function flusstal(recipe: TerrainRecipe): RiverValley {
    const anteil = recipe.riverValley.mountainShare;
    if (anteil === undefined) return recipe.riverValley;
    const { flankGrade } = recipe.riverValley;
    const { maximumGrade, alpine } = recipe.mountainMorphology.interior;
    return {
        flankGrade,
        gebirge: { grade: flankGrade + anteil * (maximumGrade - flankGrade), from: alpine.from, to: alpine.to },
    };
}

/** Die eigenen Höhen an Flüssen und Seen aller Rückennetz-Gebirge (WI-0249), `undefined` ohne welche. */
function eigenesWasser(input: Inputs): { fluesse: WasserHoehe[]; seen: WasserHoehe[] } | undefined {
    const gebirge = (input.rueckennetz ?? []).filter((g) => g.wasser !== undefined);
    if (gebirge.length === 0) return undefined;
    return {
        fluesse: gebirge.flatMap((g) => g.wasser!.fluesse),
        seen: gebirge.flatMap((g) => g.wasser!.seen),
    };
}

/**
 * Final water and summit constraints on one raster: river burn ⇄ lakes, summit shapes, exact cores, verify. Exported for the local
 * terrain job (WI-0125), which runs it over the master with the footprint tiles recomposed.
 */
export function finishDomainTerrain(
    raster: StoredRaster,
    input: Inputs,
    recipe: TerrainRecipe,
    peaks: readonly DomainPeak[],
    ignoredPeaks: readonly DomainPeak[],
    phase?: (name: string) => void,
    /** Nur die grobe Stufe gibt den Seen ihren Spiegel: Dort bestimmt der tiefste Zufluss an der Mündung den See mit. */
    pullInflow = false,
    /** Sieht das Raster nach Wasser, Deckel und Gipfeln (WI-0249, `beobachter.ts`); nur lesen. */
    beobachter?: HoehenBeobachter,
): { burn: RiverBurnReport; summits: { exactCells: number; supportCells: number }; findings: Finding[] } {
    // Operator 2026-10-03 („A auch für die Prüfungen“): The constraint gates below no longer throw. They keep their
    // calculation and limits and report what they find; the run goes on and publishes.
    const findings: Finding[] = [];
    const anchors = peaks.filter((p) => p.h !== null);
    // Each lake keeps its own level (operator 2026-10-04): the river burn does not lower its cells afterwards. The lakes are
    // levelled first, then the rivers are burnt; the lowest inflow at the mouth sets the level once, at the coarse stage.
    const { bodies: lakes, ...fixedLakes } = fixedLakeBurn(raster.width, input.water, anchors, domainIslands(input));
    const lakePull = pullInflow ? { reach: recipe.generator.lakes.mouthReach } : undefined;
    // Eigene Höhen an Flüssen und Seen der Rückennetz-Gebirge (WI-0249, 0230; Vali wählte A, 2026-10-26; nur Fassung 19, der Lader setzt sie nur
    // dort): Ein eigener Spiegel gilt statt Median und Zufluss, an eigenen Höhen der Flüsse gilt „Flüsse fallen“ nicht. Ohne sie wie zuvor.
    const wasser = eigenesWasser(input);
    const spiegel = wasser ? eigeneSeeSpiegel(input.water, lakes, wasser.seen) : undefined;
    // Einläufe der Seen (WI-0249 P7, nur Fassung 19): Eine Rinne eines Zuflusses unter dem Spiegel steigt auf ihn, in beiden Stufen.
    const einlauf = recipe.generator.lakes.inletDepth;
    const burning = {
        anchors,
        peaks: [],
        riverValley: flusstal(recipe),
        ...fixedLakes,
        ...(lakePull ? { lakePull } : {}),
        ...(wasser?.fluesse.length ? { flussPunkte: wasser.fluesse } : {}),
        ...(wasser?.seen.length ? { seeSpiegel: wasser.seen } : {}),
        ...(einlauf === undefined ? {} : { einlauf: { tiefe: einlauf } }),
    };
    const rivers = domainRivers(input.rivers);
    flattenDomainLakes(raster, input.water, anchors, domainIslands(input), lakes, spiegel);
    let burn = burnRivers([raster], rivers, burning);
    let repaired = false;
    for (let round = 0; round < 100; round += 1) {
        releaseIntermediates();
        const lakeRepair = flattenDomainLakes(raster, input.water, anchors, domainIslands(input), lakes, spiegel);
        if (lakeRepair.changedCells === 0) {
            repaired = true;
            break;
        }
        burn = burnRivers([raster], rivers, burning);
    }
    if (!repaired) findings.push(lakeRiverNotConvergedFinding(100));
    if (!burn.converged || burn.unresolved.length > 0) findings.push(riverGateFinding(burn, input));
    beobachter?.("constraints/water", rasterSicht(raster));
    deckleRueckennetz(raster, input);
    beobachter?.("constraints/cap", rasterSicht(raster));
    const trocken = dryLandMask({ n: raster.width, cell: raster.cell }, raster, input);
    // Köpfe der Nebengipfel (WI-0249 P2, nur mit Kegel der Fassung 19) wie die Gipfel unten: nach Erosion und Brennen zur Saat gehoben.
    stelleKoepfeWieder(raster, input, trocken);
    // Punkt trifft seine Höhe (WI-0249, Fassung 19; Vali wählte: Punkt trifft seine Höhe): Erosion, Brennen und Auslaufen wirken nur zwischen den
    // Punkten mit eigener Höhe. Ohne solche Punkte keine Änderung.
    triffEigeneHoehen(raster, input, trocken);
    // Das Becken um jeden See (OPS-000086, nur in einer Fassung mit `randBreite`): Vom See aus fällt nichts ab.
    const randBreite = recipe.generator.lakes.randBreite;
    if (randBreite !== undefined)
        hebeSeeRaender(
            raster,
            lakes,
            seeUferMask({ n: raster.width, cell: raster.cell }, raster, input),
            randBreite,
            beckenSchutz(input),
        );
    const supportCells = restoreSummits(
        raster,
        domainSummits(peaks, input.landscapes, recipe.mountainMorphology.interior, recipe.generator.seed),
        trocken,
        recipe.mountainMorphology.interior.alpine.summit.dominance,
    );
    const summits = { ...projectSummits(raster, peaks), supportCells };
    beobachter?.("constraints/summits", rasterSicht(raster));
    phase?.("constraints");
    releaseIntermediates();
    const verification = verifyDomainRaster(raster, input, ignoredPeaks);
    findings.push(...constraintFindings(verification.errors, input));
    phase?.("verify");
    return { burn, summits, findings };
}

/**
 * The fine stage (WI-0070): the finished coarse raster guides tiles in full resolution; the composed fine
 * raster gets the same final constraints as the coarse one.
 */
function refineToFine(
    coarse: StoredRaster,
    input: Inputs,
    recipe: TerrainRecipe,
    previous: FineCache | undefined,
    keep: ((cache: FineCache) => void) | undefined,
    phase?: (name: string) => void,
    beobachter?: HoehenBeobachter,
): { raster: StoredRaster; tiles: { computed: number; total: number } } {
    const fine = recipe.generator.fine!;
    const g = grid(fine.size);
    const classes = domainClasses(g, input);
    const { cache, computed } = composeFine(
        coarse,
        g,
        classes,
        fine,
        recipe.generator.seed,
        DOMAIN_GENERATOR_VERSION,
        previous,
    );
    keep?.(cache);
    const samples = new Uint16Array(g.n * g.n);
    for (let gy = 0; gy < g.n; gy += 1)
        samples.set(cache.composite.subarray(gy * g.n, (gy + 1) * g.n), (g.n - 1 - gy) * g.n);
    phase?.("fine-tiles");
    const raster: StoredRaster = {
        width: g.n,
        height: g.n,
        cell: g.cell,
        originX: g.cell / 2,
        originY: g.cell / 2,
        samples,
    };
    beobachter?.("fine-tiles", rasterSicht(raster));
    return { raster, tiles: { computed, total: cache.fingerprints.length } };
}

export function generateDomainTerrain(
    input: Inputs,
    recipe: TerrainRecipe,
    size: number = recipe.generator.size,
    phase?: (name: string) => void,
    fineCache?: FineCache,
    /** Receives the new fine composition before the final constraints; it is not kept afterwards. */
    keepFineCache?: (cache: FineCache) => void,
    coarse?: CoarseOptions,
    /** Sieht das Höhenfeld nach jeder Phase (WI-0249, `beobachter.ts`); nur lesen. Ohne ihn rechnet alles wie zuvor. */
    beobachter?: HoehenBeobachter,
): DomainTerrainResult {
    // Order (WI-0067): domain erosion → mountain interiors → final river burn → lakes → peaks → verify.
    // With a fine stage (WI-0070) the finished coarse raster guides the tiles, and the same final
    // constraints run again on the composed fine raster. They are the last writes to the published height.
    const formed = formDomainTerrain(input, recipe, size, phase, coarse, beobachter);
    const { ignoredPeaks, peaks, masses, mountainInterior, uplift } = formed;
    releaseIntermediates();
    let raster = formed.raster;
    let { burn, summits, findings } = finishDomainTerrain(
        raster,
        input,
        recipe,
        peaks,
        ignoredPeaks,
        phase,
        true,
        beobachter,
    );
    let fine: { computed: number; total: number } | undefined;
    if (recipe.generator.fine && size === recipe.generator.size) {
        const refined = refineToFine(raster, input, recipe, fineCache, keepFineCache, phase, beobachter);
        raster = refined.raster;
        fine = refined.tiles;
        releaseIntermediates();
        // The composed fine raster is what gets published: its constraint findings replace those of the coarse one.
        ({ burn, summits, findings } = finishDomainTerrain(
            raster,
            input,
            recipe,
            peaks,
            ignoredPeaks,
            phase,
            false,
            beobachter,
        ));
    }
    const fingerprint = createHash("sha256").update(Buffer.from(raster.samples.buffer)).digest("hex");
    // Nur melden (Betreiber 2026-10-17): Gipfel unter der Grundhöhe ihres Gebirges, am fertigen Raster gemessen.
    const gipfel = gipfelUnterGrundhoehe(raster, input);
    const gipfelBefund = gipfelUnterGrundhoeheFinding(gipfel);
    return {
        raster,
        fingerprint,
        report: {
            ignoredPeaks,
            masses,
            ...(uplift ? { uplift } : {}),
            burn,
            generator: DOMAIN_GENERATOR_VERSION,
            mountainInterior,
            summits,
            ...(fine ? { fineTiles: fine } : {}),
            provenance: {
                GENERATED_LEGACY_SEED: input.generatedLegacySeeds ?? [],
                GENERATED_PEAK_FALLBACK: peaks.filter((peak) => peak.h === null),
            },
            findings: [...formed.findings, ...findings, ...(gipfelBefund === null ? [] : [gipfelBefund])],
            gipfelUnterGrundhoehe: gipfel,
        },
    };
}
