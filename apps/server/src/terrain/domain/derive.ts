import { domainInputFingerprint } from "./fingerprint.ts";
import { AVENTURIA, AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import type { Database } from "../../database.ts";
import { withDeriveLock } from "../../derive/derive-lock.ts";
import { FULL_SCOPE, type DeriveScope } from "../derive-scope.ts";
import { generateDomainTerrain, type DomainTerrainResult } from "./generate.ts";
import { loadDomainInputsUndAuftraege } from "./inputs.ts";
import { resolveTerrainRecipe } from "../auswahl.ts";
import { recipeFingerprint, type TerrainRecipe } from "./recipes.ts";
import { publishDomainDem, type DomainPublication } from "./publish.ts";
import { backfillInputIndex, storeDomainRaster } from "./store.ts";
import { loadDomainInputIndex } from "./input-index.ts";
import { fineCacheDir, readFineCache, writeFineCache } from "./fine-cache.ts";
import { coarseCacheName, promoteCoarseState, writeNextCoarseState } from "./coarse-cache.ts";
import type { CoarseState } from "./coarse-local.ts";
import type { FineCache } from "./fine.ts";
import { loadPublishedDomainSource, readDomainSamples } from "./read.ts";
import { derivePathProfiles, type PathProfileReport } from "../path-profiles.ts";
import { DEFAULT_CONE } from "../peak-cone.ts";

export interface DomainDeriveOptions {
    mapDomainId?: string;
    force?: boolean;
    dryRun?: boolean;
    size?: number;
    scope?: DeriveScope;
    onProgress?: (phase: string) => void;
    /** Ein bestimmtes Rezept statt der Fassung dieser Umgebung (Tests, Messung eines Entwurfs ohne Veröffentlichung). */
    recipe?: TerrainRecipe;
}

export interface DomainDeriveReport {
    fingerprint: string;
    inputFingerprint: string;
    computed: boolean;
    persisted: boolean;
    scope: DeriveScope;
    ms: number;
    phases: Record<string, number>;
    maxRssKiB: number;
    constraints: DomainTerrainResult["report"];
    publication?: DomainPublication;
    profiles?: PathProfileReport;
}

export async function deriveDomainTerrain(
    database: Database,
    options: DomainDeriveOptions = {},
): Promise<DomainDeriveReport> {
    const domain = options.mapDomainId ?? AVENTURIA.mapDomain;
    return withDeriveLock(database, domain, "derive:domain-terrain", () =>
        runDomainTerrainWithinLock(database, options),
    );
}

/** Internal engine: the canonical seed/domain orchestrator already owns the domain derive lock. */
export async function runDomainTerrainWithinLock(
    database: Database,
    options: DomainDeriveOptions = {},
): Promise<DomainDeriveReport> {
    const domain = options.mapDomainId ?? AVENTURIA.mapDomain;
    const start = performance.now();
    let previous = start;
    const phases: Record<string, number> = {};
    const phase = (name: string): void => {
        const now = performance.now();
        phases[name] = now - previous;
        previous = now;
        options.onProgress?.(name);
    };
    const profilesFor = async (fingerprint: string, known?: Uint16Array): Promise<PathProfileReport | undefined> => {
        if (options.dryRun) return undefined;
        const source = await loadPublishedDomainSource(database, domain, fingerprint, known);
        if (!source) throw new Error("Published domain source missing for path profiles");
        const profiles = await derivePathProfiles(
            database,
            domain,
            { domain: source, rasters: [], peaks: [], rule: DEFAULT_CONE },
            AVENTURIA_TRAVEL_MODEL,
        );
        phase("profiles");
        return profiles;
    };
    // Die Fassung dieser Umgebung (WI-0127 SYS-13); ein Lauf rechnet von Anfang bis Ende mit derselben.
    const recipe: TerrainRecipe = options.recipe ?? (await resolveTerrainRecipe(database, domain));
    const size = options.size ?? recipe.generator.size;
    if (!options.dryRun && size !== 4096) throw new Error("Only a dry run may use a smaller domain grid");
    // Eingaben und ihr Index (WI-0125) aus EINEM Schnappschuss: der Index beschreibt genau diese Eingaben.
    const { input, index } = await database.begin("isolation level repeatable read read only", async (tx) => ({
        ...(await (async () => {
            const { input, jobs } = await loadDomainInputsUndAuftraege(tx, domain);
            return { input, index: await loadDomainInputIndex(tx, domain, jobs) };
        })()),
    }));
    const inputFingerprint = domainInputFingerprint(input.fingerprint, size, recipe);
    phase("inputs");
    const [known] = await database<{ fingerprint: string; size: number; report: DomainTerrainResult["report"] }[]>`
            SELECT fingerprint, size, report FROM terrain_domain_raster
            WHERE map_domain_id = ${domain} AND input_fingerprint = ${inputFingerprint}
            ORDER BY fingerprint LIMIT 1
        `;
    if (known && !options.force) {
        let publication: DomainPublication | undefined;
        if (!options.dryRun) {
            // Ein Master von vor WI-0125 bekommt seinen Index nach: Seine Eingaben sind genau die heutigen.
            await backfillInputIndex(database, domain, known.fingerprint, index);
            // The stored master's own size: with the fine stage it is finer than the coarse grid.
            const stored = known.size;
            const samples = await readDomainSamples(database, domain, known.fingerprint, stored);
            publication = await publishDomainDem(database, domain, known.fingerprint, inputFingerprint, {
                width: stored,
                height: stored,
                cell: 1024 / stored,
                originX: 512 / stored,
                originY: 512 / stored,
                samples,
            });
        }
        phase("publish");
        const profiles = await profilesFor(known.fingerprint);
        return {
            fingerprint: known.fingerprint,
            inputFingerprint,
            computed: false,
            persisted: false,
            scope: options.scope ?? FULL_SCOPE,
            ms: performance.now() - start,
            phases,
            maxRssKiB: process.resourceUsage().maxRSS,
            constraints: known.report,
            ...(publication ? { publication } : {}),
            ...(profiles ? { profiles } : {}),
        };
    }
    globalThis.gc?.();
    // The fine stage reuses the tiles whose inputs did not change (WI-0070); without a cache it computes all.
    const fineCache = recipe.generator.fine ? await readFineCache(domain) : undefined;
    const keep = options.dryRun ? undefined : (cache: FineCache) => writeFineCache(domain, cache);
    // Der Stand der groben Stufe für den nächsten lokalen Lauf (WI-0223), abgelegt vor der feinen Stufe; er gilt ab dem Speichern.
    const coarse = options.dryRun ? undefined : { keep: (state: CoarseState) => writeNextCoarseState(domain, state) };
    const result = generateDomainTerrain(input, recipe, size, phase, fineCache, keep, coarse);
    if (!options.dryRun)
        await database.begin((tx) =>
            storeDomainRaster(tx, domain, inputFingerprint, result, index, null, {
                version: recipe.version,
                fingerprint: recipeFingerprint(recipe),
            }),
        );
    phase("persist");
    if (coarse)
        await promoteCoarseState(
            { dir: fineCacheDir(), name: `${coarseCacheName(domain)}-next`, move: true },
            domain,
            result.fingerprint,
        );
    const publication = !options.dryRun
        ? await publishDomainDem(database, domain, result.fingerprint, inputFingerprint, result.raster, options.force)
        : undefined;
    phase("publish");
    const profiles = await profilesFor(result.fingerprint, result.raster.samples);
    return {
        fingerprint: result.fingerprint,
        inputFingerprint,
        computed: true,
        persisted: !options.dryRun,
        scope: options.scope ?? FULL_SCOPE,
        ms: performance.now() - start,
        phases,
        maxRssKiB: process.resourceUsage().maxRSS,
        constraints: result.report,
        ...(publication ? { publication } : {}),
        ...(profiles ? { profiles } : {}),
    };
}
