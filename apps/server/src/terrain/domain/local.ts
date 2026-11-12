import type { Database } from "../../database.ts";
import type { Finding } from "../../findings.ts";
import { deriveTerrainSeedsWithinLock } from "../derive.ts";
import type { StoredRaster } from "../dem-tiles.ts";
import { grid, type Plane } from "../hydrology/grid.ts";
import { readCurrentCoarseState } from "./coarse-cache.ts";
import { localCoarse, tilesPlane, type CoarseState } from "./coarse-local.ts";
import { pruneCandidates, writeCandidate } from "./candidate.ts";
import { domainInputFingerprint } from "./fingerprint.ts";
import { COMPUTE_TILES_PER_SIDE, footprintOf, footprintRingOf, type Rect } from "./footprint.ts";
import { erosionWorkersFor, finishDomainTerrain, generateDomainTerrain, type FormedCoarse } from "./generate.ts";
import { diffInputIndex, loadDomainInputIndex, readInputIndex, type InputChange } from "./input-index.ts";
import { loadDomainInputsUndAuftraege, StaleDomainSeedError, type DomainInputs } from "./inputs.ts";
import { composeFineLocal, composeFineLocalMitWorkern, extractComputeTile } from "./local-fine.ts";
import { domainClasses } from "./mountain-interior.ts";
import { PROVISIONAL_INPUT_PREFIX } from "./provisional.ts";
import { readDomainSamples } from "./read.ts";
import { resolveTerrainRecipe } from "../auswahl.ts";
import { AVENTURIA_TERRAIN_SELECTION, recipeFingerprint, type TerrainRecipe } from "./recipes.ts";
import { rasterSicht, type HoehenBeobachter } from "./beobachter.ts";

/**
 * `terrain_local` (JOBS-0001 V1, D6 = B, WI-0125): das Gelände im Fußabdruck einer Änderung neu rechnen und als Kandidaten ablegen.
 * Veröffentlicht wird nichts; das tut `dem_publish`.
 *
 * Ablauf:
 *   1. **Saaten:** V12 rechnet die Gebirge mit geänderten Eingaben (wie `derive:terrain`; abgeleitete Daten in `terrain_raster`).
 *   2. **Eingaben:** ein Schnappschuss der Eingaben samt Index; der Fußabdruck ist der Unterschied zum Index des geltenden Masters
 *      (`footprint.ts`, Ränder aus R0), dazu ausdrücklich genannte Bereiche.
 *   3. **Grobe Stufe: voll.** Die grobe Erosion ist domainweit gekoppelt (R0: Massenrückverteilung, G7); eine auf den Fußabdruck
 *      beschränkte grobe Stufe wiche im Fußabdruck vom vollen Lauf ab. Voll gerechnet ist sie dort genau die des vollen Laufs, und
 *      der Kandidat kommt ihm so nah wie möglich (der Rest sind die Schlussschritte am Rand des Fußabdrucks, gemessen in WI-0125).
 *      Ob eine regionale grobe Stufe reicht, entscheidet sich mit Prototyp D.
 *   4. **Feine Stufe nur im Fußabdruck** (`local-fine.ts`), eingesetzt in den geltenden Master.
 *   5. **Schlussschritte** (Flüsse, Seen, Gipfel) über den ganzen Master; eingesetzt wird nur der Kern der Kacheln im Fußabdruck.
 *   6. **Kandidat** in die Ablage (`candidate.ts`).
 *
 * Der Job hält die geteilte Sperre der Domäne über seinen Worker; er schreibt nur `terrain_raster` (Saaten) und die Ablage.
 */

export interface LocalTerrainOptions {
    mapDomainId: string;
    /** Die öffentliche Kennung des Jobs: der Name des Kandidaten. */
    job: string;
    /** Ausdrücklich genannte Bereiche (CLI `--bounds`), ohne Rand. */
    bounds?: readonly Rect[];
    /** Threads für V12 (wie `derive:terrain --workers`). */
    workers?: number;
    /** Eine Phase beginnt (der Job prüft dort den Abbruch). */
    phase?: (name: string, progress: number) => Promise<void>;
    candidateRoot?: string;
    recipe?: TerrainRecipe;
}

export interface LocalTerrainReport {
    /** Nichts zu tun: die Eingaben sind die des geltenden Masters, oder es änderte sich kein erkanntes Objekt. */
    unchanged: boolean;
    reason: "inputs_current" | "no_tracked_change" | null;
    base: { fingerprint: string; revision: string };
    inputFingerprint: string;
    changes: { key: string; kind: string }[];
    rects: Rect[];
    tiles: number[];
    candidate: string | null;
    /** Gerechnete Kacheln der feinen Stufe (Fußabdruck und Nachbarn). */
    fineComputed: number;
    /** Das Fenster der groben Stufe (WI-0223); `null`: voll gerechnet, weil kein Stand zum Master lag. */
    coarseWindow: Plane | null;
    seedsComputed: number;
    findings: number;
    phasesMs: Record<string, number>;
    /**
     * Die grobe Stufe nach Abschnitten (`mask`, `initial-details`, `seed`, `erosion` über alle Runden, `mountain-interior`), damit eine
     * Messung auf der Stage zeigt, was in `phasesMs.coarse` steckt (Claudios Messlauf 2026-10-18: 175 s von 254 s).
     */
    coarsePhasesMs: Record<string, number>;
    /**
     * Die Meldung einer veralteten Saat aus dem ersten Durchgang, wenn erst der zweite die Eingaben laden konnte (WI-0223, Stage 1696);
     * sonst `null`. Beleg für die Ursache, die lokal nicht nachzustellen war.
     */
    seedRetry: string | null;
}

export interface LocalComputeOptions {
    /** Die Rechenkacheln des Fußabdrucks. */
    tiles: readonly number[];
    /** Der geltende Master (Zeile 0 im Süden); wird nicht verändert. */
    base: Uint16Array;
    /**
     * Der Stand der groben Stufe, der zum Master gehört (WI-0223 Schritt 2). Mit ihm rechnet die grobe Stufe Anfangsgelände und
     * Gebirgsinneres nur in den Kacheln des Fußabdrucks (`coarse-local.ts`), ohne ihn alles wie in Schritt 1.
     */
    previous?: CoarseState;
    phase?: (name: string, progress: number) => Promise<void>;
    /** Die Phasen des Generators in der groben Stufe (Messung). */
    coarsePhase?: (name: string) => void;
    /** Threads der Feinstufe; ohne Angabe wie die Erosion (`erosionWorkersFor`, Worker plus Hauptthread). */
    fineThreads?: number;
    /**
     * Sieht das Höhenfeld nach jeder Phase wie beim vollen Lauf (WI-0249 P6, `beobachter.ts`; fürs Terrain-Lab): grobe Stufe, auch im
     * Fenster mit Stand, `fine-tiles` und die Schlussschritte. Nur lesen; ohne ihn rechnet alles Zeichen für Zeichen wie zuvor.
     */
    beobachter?: HoehenBeobachter;
}

export interface LocalComputeResult {
    /** Der Master nach den Schlussschritten über das Ganze; eingesetzt wird nur der Kern der Kacheln im Fußabdruck. */
    raster: StoredRaster;
    findings: Finding[];
    fineComputed: number;
    /** Der neue Stand der groben Stufe (für den nächsten lokalen Lauf). */
    state: CoarseState | undefined;
    /** Das Fenster der groben Stufe (Kacheln des Fußabdrucks), ohne Stand `null` (dann voll). */
    window: Plane | null;
    /** Die Abschnitte der groben Stufe in Millisekunden (`LocalTerrainReport.coarsePhasesMs`). */
    coarsePhasesMs: Record<string, number>;
}

/** Die Rechnung des lokalen Jobs ohne Datenbank: grobe Stufe, feine Stufe im Fußabdruck, Schlussschritte (auch für die Messung). */
export async function computeLocalTerrain(
    input: DomainInputs,
    recipe: TerrainRecipe,
    options: LocalComputeOptions,
): Promise<LocalComputeResult> {
    const fine = recipe.generator.fine;
    if (!fine) throw new LocalTerrainRefusal("no_fine_stage", "Das Rezept hat keine feine Stufe");
    const n = recipe.generator.size;
    const size = fine.size;
    await options.phase?.("coarse", 0.2);
    globalThis.gc?.();
    const coarseRecipe = coarseOnly(recipe);
    const previous = options.previous;
    const window = previous ? tilesPlane(options.tiles, fine.tiles, n) : null;
    let state: CoarseState | undefined;
    // Der Generator meldet das Ende eines Abschnitts; die Runden der Erosion zählen zusammen.
    const coarsePhasesMs: Record<string, number> = {};
    let mark = performance.now();
    const coarsePhase = (name: string): void => {
        const now = performance.now();
        const key = name.startsWith("erosion-") ? "erosion" : name;
        coarsePhasesMs[key] = Math.round((coarsePhasesMs[key] ?? 0) + now - mark);
        mark = now;
        options.coarsePhase?.(name);
    };
    const { beobachter } = options;
    const coarse = generateDomainTerrain(
        input,
        coarseRecipe,
        n,
        coarsePhase,
        undefined,
        undefined,
        {
            keep: (kept) => {
                state = kept;
            },
            ...(previous && window
                ? {
                      form: (phase?: (name: string) => void): FormedCoarse => {
                          const local = localCoarse(input, coarseRecipe, previous, window, phase, beobachter);
                          state = local.state;
                          return {
                              raster: local.raster,
                              ...local.simulation,
                              mountainInterior: local.mountainInterior,
                          };
                      },
                  }
                : {}),
        },
        beobachter,
    );
    const ignored = new Set(coarse.report.ignoredPeaks.map((peak) => peak.id));
    const peaks = input.peaks.filter((peak) => !ignored.has(peak.id));

    await options.phase?.("fine", 0.75);
    const g = grid(size);
    const klassen = domainClasses(g, input);
    const imFussabdruck = new Set(options.tiles);
    // Dieselben Threads wie die Erosion davor (Worker plus Hauptthread): Der Hauptthread summiert hier nur. Scheitert ein Worker, rechnet er dieselben Kacheln allein.
    const fineThreads = options.fineThreads ?? erosionWorkersFor(size) + 1;
    const allein = (): ReturnType<typeof composeFineLocal> =>
        composeFineLocal(coarse.raster, g, klassen, fine, recipe.generator.seed, imFussabdruck, options.base);
    let local: ReturnType<typeof composeFineLocal>;
    if (fineThreads > 1 && !beobachter) {
        try {
            local = await composeFineLocalMitWorkern(
                coarse.raster,
                g,
                klassen,
                fine,
                recipe.generator.seed,
                imFussabdruck,
                options.base,
                fineThreads,
            );
        } catch (error) {
            console.warn("Gelände: Feinstufe auf Workern gescheitert, rechne allein", error);
            local = allein();
        }
    } else {
        local = allein();
    }
    globalThis.gc?.();

    await options.phase?.("finish", 0.85);
    const raster: StoredRaster = {
        width: size,
        height: size,
        cell: g.cell,
        originX: g.cell / 2,
        originY: g.cell / 2,
        samples: local.samples,
    };
    beobachter?.("fine-tiles", rasterSicht(raster));
    const finished = finishDomainTerrain(
        raster,
        input,
        recipe,
        peaks,
        coarse.report.ignoredPeaks,
        undefined,
        false,
        beobachter,
    );
    return { raster, findings: finished.findings, fineComputed: local.computed, state, window, coarsePhasesMs };
}

/** Wirft dieser Fehler, kann ein zweiter Lauf nichts ändern. */
export class LocalTerrainRefusal extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "LocalTerrainRefusal";
        this.code = code;
    }
}

/** Das Rezept ohne feine Stufe: `generateDomainTerrain` endet damit nach der fertigen groben Stufe, wie ein voller Lauf dort. */
function coarseOnly(recipe: TerrainRecipe): TerrainRecipe {
    const generator = { ...recipe.generator };
    delete generator.fine;
    return { ...recipe, generator };
}

/**
 * Warum ein Master unter diesem Rezept NICHT lokal fortgeschrieben wird, sonst `undefined`. Der lokale Lauf rechnet nur den Fußabdruck neu;
 * alles daneben bleibt, wie es der Master rechnete.
 *
 * - Eine andere Fassung (Befund WI-0067: sonst stünde Fassung 18 in einem Master aus 17).
 * - 🔴 Ein anderer Stand derselben Fassung (WI-0239; Betreiber 2026-10-19: „wir testen noch 19. kannst du alle änderungen in die 19 tun
 *   ohne neue versionen zu generieren bis wir sie abnehmen?“). Eine offene Fassung ändert sich in sich; die Nummer allein sagte dann
 *   „gleich“, und der Fußabdruck käme mit neuem Inhalt in einen Master mit altem. Verglichen wird `recipe_fingerprint` (Migration 0209).
 * - Ein Master ohne Stand (vor 0209) unter einer OFFENEN Fassung: Ob er zu ihrem heutigen Inhalt passt, weiß niemand. Unter einer
 *   abgenommenen Fassung reicht die Nummer, denn abgenommen ändert sie sich nicht mehr (`domain-terrain-recipes.test.ts`).
 */
export function rezeptGrund(
    base: { recipe_version: number | null; recipe_fingerprint: string | null },
    recipe: TerrainRecipe,
    abgenommen: readonly number[],
): string | undefined {
    const fassung = String(recipe.version);
    if (base.recipe_version !== null && base.recipe_version !== recipe.version)
        return `Der Master stammt aus Fassung ${String(base.recipe_version)}, gewählt ist ${fassung}: erst der volle Lauf`;
    if (base.recipe_fingerprint !== null)
        return base.recipe_fingerprint === recipeFingerprint(recipe)
            ? undefined
            : `Der Master stammt aus einem älteren Stand von Fassung ${fassung}: erst der volle Lauf`;
    if (!abgenommen.includes(recipe.version))
        return `Fassung ${fassung} ist noch offen, und der Master trägt keinen Stand ihres Inhalts: erst der volle Lauf`;
    return undefined;
}

export async function runLocalTerrain(database: Database, options: LocalTerrainOptions): Promise<LocalTerrainReport> {
    const domain = options.mapDomainId;
    const recipe = options.recipe ?? (await resolveTerrainRecipe(database, domain));
    // Nur eine Fassung mit regionaler Rückverteilung wirkt lokal (Betreiber 2026-10-10, SYS-0001 §9c.11): Unter einer domainweiten
    // (Fassung 17) rechnet jede Änderung an Gipfeln und Gebirgen die ganze Karte neu; das tut der volle Lauf.
    if (recipe.generator.uplift?.kind !== "regional")
        throw new LocalTerrainRefusal(
            "recipe_not_local",
            `Unter Fassung ${String(recipe.version)} rechnet jede Änderung an Gipfeln und Gebirgen die ganze Karte neu`,
        );
    const fine = recipe.generator.fine;
    if (!fine) throw new LocalTerrainRefusal("no_fine_stage", "Das Rezept hat keine feine Stufe");
    if (fine.tiles !== COMPUTE_TILES_PER_SIDE)
        throw new LocalTerrainRefusal(
            "tile_grid",
            "Rechenkacheln des Rezepts und des Fußabdrucks passen nicht zusammen",
        );
    const phasesMs: Record<string, number> = {};
    let started = performance.now();
    let current = "";
    const phase = async (name: string, progress: number): Promise<void> => {
        if (current) phasesMs[current] = Math.round(performance.now() - started);
        current = name;
        started = performance.now();
        await options.phase?.(name, progress);
    };

    await phase("seeds", 0);
    await pruneCandidates(domain, Date.now(), undefined, options.candidateRoot);
    const loadSnapshot = (): Promise<{
        base: {
            fingerprint: string;
            revision: string;
            size: number;
            input_fingerprint: string;
            input_index: unknown;
            recipe_version: number | null;
            recipe_fingerprint: string | null;
        };
        input: DomainInputs;
        index: Awaited<ReturnType<typeof loadDomainInputIndex>>;
    } | null> =>
        database.begin("isolation level repeatable read read only", async (tx) => {
            // 🪤 Nie die ganze Zeile in jsonb wandeln: Sie trägt den Master (`samples`, size² · 2 Byte), als jsonb-Hex über der Grenze von 256 MB
            // (Stage-Job 2355, 2026-10-19: „string too long to represent as jsonb string“, jeder lokale Lauf nach dem vollen unter 19).
            // Die Spalte aus 0209 wird gelesen, wenn es sie gibt; vor `migrate` gilt der Master als ohne Stand.
            const [spalte] = await tx`
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'terrain_domain_raster' AND column_name = 'recipe_fingerprint'
            `;
            const rezeptStand = spalte === undefined ? tx`NULL::text` : tx`t.recipe_fingerprint`;
            const [base] = await tx<
                {
                    fingerprint: string;
                    revision: string;
                    size: number;
                    input_fingerprint: string;
                    input_index: unknown;
                    recipe_version: number | null;
                    recipe_fingerprint: string | null;
                }[]
            >`
                SELECT t.fingerprint, d.revision, t.size, t.input_fingerprint, t.input_index, t.recipe_version,
                       ${rezeptStand} AS recipe_fingerprint
                FROM terrain_dem d JOIN terrain_domain_raster t ON t.map_domain_id = d.map_domain_id AND t.fingerprint = d.domain_fingerprint
                WHERE d.map_domain_id = ${domain} AND d.is_current
            `;
            if (!base) return null;
            const { input, jobs } = await loadDomainInputsUndAuftraege(tx, domain);
            return { base, input, index: await loadDomainInputIndex(tx, domain, jobs) };
        });
    // Saaten, dann Eingaben. Meldet die Prüfung danach eine veraltete Saat, obwohl die Saat-Phase eben lief (Stage 1696, WI-0223),
    // rechnet ein zweiter Durchgang die Saaten nach; die Meldung des ersten bleibt im Ergebnis (`seedRetry`) als Beleg.
    let seeds: Awaited<ReturnType<typeof deriveTerrainSeedsWithinLock>>;
    let snapshot: Awaited<ReturnType<typeof loadSnapshot>>;
    let seedRetry: string | null = null;
    for (let attempt = 1; ; attempt += 1) {
        seeds = await deriveTerrainSeedsWithinLock(database, {
            mapDomainId: domain,
            ...(options.workers ? { workers: options.workers } : {}),
        });
        if (seeds.failed.length > 0)
            throw new LocalTerrainRefusal(
                "seeds_failed",
                `V12 scheiterte: ${seeds.failed.map((entry) => entry.name).join(", ")}`,
            );
        await phase("inputs", 0.1);
        try {
            snapshot = await loadSnapshot();
            break;
        } catch (error) {
            if (attempt >= 2 || !(error instanceof Error && error.cause instanceof StaleDomainSeedError)) throw error;
            seedRetry = error.message;
            await phase("seeds", 0);
        }
    }
    if (!snapshot) throw new LocalTerrainRefusal("no_master", "Es gibt keinen veröffentlichten Domain-Master");
    const { base, input, index } = snapshot;
    const size = fine.size;
    if (base.size !== size)
        throw new LocalTerrainRefusal("master_size", `Der Master hat ${String(base.size)}² statt ${String(size)}²`);
    const anderesRezept = rezeptGrund(base, recipe, AVENTURIA_TERRAIN_SELECTION.accepted);
    if (anderesRezept !== undefined) throw new LocalTerrainRefusal("recipe_changed", anderesRezept);
    const inputFingerprint = domainInputFingerprint(input.fingerprint, undefined, recipe);
    const report: LocalTerrainReport = {
        unchanged: true,
        reason: null,
        base: { fingerprint: base.fingerprint, revision: base.revision },
        inputFingerprint,
        changes: [],
        rects: [],
        tiles: [],
        candidate: null,
        fineComputed: 0,
        coarseWindow: null,
        seedsComputed: seeds.computed,
        seedRetry,
        findings: 0,
        phasesMs,
        coarsePhasesMs: {},
    };
    if (
        (base.input_fingerprint === inputFingerprint ||
            base.input_fingerprint === PROVISIONAL_INPUT_PREFIX + inputFingerprint) &&
        (options.bounds ?? []).length === 0
    ) {
        report.reason = "inputs_current";
        return report;
    }
    const baseIndex = readInputIndex(base.input_index);
    if (!baseIndex && (options.bounds ?? []).length === 0)
        throw new LocalTerrainRefusal(
            "needs_index",
            "Der geltende Master trägt keinen Eingabeindex: erst ein voller Lauf (derive:terrain) oder ein ausdrücklicher Bereich",
        );
    const changes: InputChange[] = baseIndex ? diffInputIndex(baseIndex, index) : [];
    const footprint = footprintOf(changes, footprintRingOf(recipe), options.bounds ?? []);
    report.changes = changes.map((change) => ({ key: change.key, kind: change.kind }));
    report.rects = footprint.rects;
    report.tiles = footprint.tiles;
    if (footprint.tiles.length === 0) {
        report.reason = "no_tracked_change";
        return report;
    }

    // Der Stand der groben Stufe zum geltenden Master (WI-0223): mit ihm rechnet die grobe Stufe nur im Umkreis, ohne ihn voll.
    const previous = await readCurrentCoarseState(domain, base.fingerprint, recipe.generator.size);
    const computed = await computeLocalTerrain(input, recipe, {
        tiles: footprint.tiles,
        base: await readDomainSamples(database, domain, base.fingerprint, size),
        ...(previous ? { previous } : {}),
        phase,
    });
    report.coarseWindow = computed.window;
    report.coarsePhasesMs = computed.coarsePhasesMs;
    const { raster, findings } = computed;
    report.fineComputed = computed.fineComputed;
    report.findings = findings.length;

    await phase("candidate", 0.95);
    report.candidate = await writeCandidate(
        {
            domain,
            job: options.job,
            createdAt: new Date().toISOString(),
            base: report.base,
            inputFingerprint,
            inputIndex: index,
            tiles: footprint.tiles,
            tilesPerSide: fine.tiles,
            size,
            changes: report.changes,
            findings,
        },
        footprint.tiles.map((tile) => extractComputeTile(raster.samples, size, tile, fine.tiles)),
        options.candidateRoot,
        computed.state,
    );
    phasesMs[current] = Math.round(performance.now() - started);
    report.unchanged = false;
    return report;
}
