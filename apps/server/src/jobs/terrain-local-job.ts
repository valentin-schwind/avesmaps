import type { Queryable } from "../database.ts";
import { resolveTerrainRecipe } from "../terrain/auswahl.ts";
import type { Rect } from "../terrain/domain/footprint.ts";
import { fassungsName } from "../terrain/domain/recipes.ts";
import { LocalTerrainRefusal, runLocalTerrain, type LocalTerrainReport } from "../terrain/domain/local.ts";
import { JobFailure, type JobContext } from "./handlers.ts";
import { jobDomain, withJobDatabase } from "./job-database.ts";
import { enqueueTerrainFull, vollerLaufEtikett } from "./terrain-chain.ts";

/**
 * Die Jobart `terrain_local` (JOBS-0001 4.4, WI-0125): das Gelände im Fußabdruck rechnen und einen Kandidaten ablegen
 * (`terrain/domain/local.ts`). Sie veröffentlicht nichts; ihr Nachfolger `dem_publish` tut es.
 *
 * Eingabe (`input_ref`), alles optional:
 *   - `bounds`: ausdrücklich genannte Bereiche `[[minX, minY, maxX, maxY], …]` in Karteneinheiten (CLI `--bounds`), ohne Rand;
 *   - `workers`: Threads für V12 (Vorgabe 2, wie `derive:terrain`).
 *
 * Ergebnis (klein, `terrainLocalResult`): Fußabdruck (Rechenkacheln, Rechtecke), erkannte Änderungen (Zahl je Art), Basis,
 * Kandidat, ob die grobe Stufe den Stand zum Master nutzte, Zeiten je Phase.
 * Eine Weigerung (kein Index, kein Master, V12 scheiterte) endet ohne Wiederholung: ein zweiter Lauf änderte nichts.
 * Ausnahme `recipe_changed`: Der Lauf übergibt an den vollen (`uebergibAnVollenLauf`).
 */

export function parseTerrainLocalInput(raw: Record<string, unknown>): { bounds: Rect[]; workers: number | undefined } {
    const bounds: Rect[] = [];
    const given = raw["bounds"];
    if (given !== undefined) {
        if (!Array.isArray(given) || given.length > 16)
            throw new JobFailure("invalid_input", "bounds: höchstens 16 Rechtecke [minX, minY, maxX, maxY]", false);
        for (const entry of given) {
            if (
                !Array.isArray(entry) ||
                entry.length !== 4 ||
                entry.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1024)
            )
                throw new JobFailure("invalid_input", "bounds: je Rechteck vier Zahlen zwischen 0 und 1024", false);
            const [minX, minY, maxX, maxY] = entry as [number, number, number, number];
            if (!(minX < maxX && minY < maxY))
                throw new JobFailure("invalid_input", "bounds: min muss kleiner als max sein", false);
            bounds.push({ minX, minY, maxX, maxY });
        }
    }
    const workers = raw["workers"];
    if (
        workers !== undefined &&
        (typeof workers !== "number" || !Number.isInteger(workers) || workers < 1 || workers > 8)
    )
        throw new JobFailure("invalid_input", "workers: eine ganze Zahl von 1 bis 8", false);
    return { bounds, workers: workers as number | undefined };
}

/**
 * Das Ergebnis im Auftrag (`job.result`). `coarseFromState` sagt, ob die grobe Stufe mit dem Stand zum Master `base` rechnete
 * (WI-0223 Schritt 2): Beim zweiten Lauf nach einer Veröffentlichung belegt `true`, dass `dem_publish` den Stand des
 * Kandidaten zum neuen Master gemacht hat (Claudios Probe, der Cache selbst ist für ihn nicht lesbar).
 */
export function terrainLocalResult(report: LocalTerrainReport): Record<string, unknown> {
    const kinds: Record<string, number> = {};
    for (const change of report.changes) kinds[change.kind] = (kinds[change.kind] ?? 0) + 1;
    return {
        unchanged: report.unchanged,
        reason: report.reason,
        base: report.base,
        inputFingerprint: report.inputFingerprint,
        tiles: report.tiles,
        rects: report.rects,
        changes: kinds,
        changedObjects: report.changes.slice(0, 20).map((change) => change.key),
        candidate: report.candidate !== null,
        coarseFromState: report.coarseWindow !== null,
        coarseWindow: report.coarseWindow,
        fineComputed: report.fineComputed,
        seedsComputed: report.seedsComputed,
        seedRetry: report.seedRetry,
        findings: report.findings,
        phasesMs: report.phasesMs,
        coarsePhasesMs: report.coarsePhasesMs,
    };
}

/**
 * Der Master stammt aus einem anderen Rezept als dem gewählten (`recipe_changed`): Lokal lässt sich dann nichts fortschreiben, also
 * übergibt der Lauf an den vollen (Betreiber 2026-10-19, A: „alle änderungen die wir mit test machen soll automatisch passieren wenn wir
 * was machen oder wenn jemand auf aktivieren geklickt haben“). Einen wartenden vollen Lauf nimmt er mit, sonst reiht er einen ein, mit
 * dem Auslöser dieses Laufs, damit er in dessen Warteschlange steht. Der Auftrag endet ohne Fehler und ohne Kandidat (`unchanged`); sein
 * `dem_publish` schließt darum leer ab.
 */
export async function uebergibAnVollenLauf(
    database: Queryable,
    job: { id: number; mapDomainId: string },
    grund: string,
): Promise<Record<string, unknown>> {
    const [zeile] = await database<{ actor_ref: string | null; release: string | null }[]>`
        SELECT actor_ref, release FROM job WHERE id = ${job.id}
    `;
    const recipe = await resolveTerrainRecipe(database, job.mapDomainId);
    const kette = await enqueueTerrainFull(database, {
        mapDomainId: job.mapDomainId,
        actorRef: zeile?.actor_ref ?? null,
        release: zeile?.release ?? null,
        label: vollerLaufEtikett(fassungsName(recipe.version)),
    });
    return {
        unchanged: true,
        reason: "recipe_changed",
        detail: grund,
        handedOver: { job: kette.full.publicId, coalesced: kette.coalesced },
    };
}

export async function runTerrainLocalJob(context: JobContext): Promise<Record<string, unknown>> {
    const { bounds, workers } = parseTerrainLocalInput(context.input);
    const domain = jobDomain(context.job.mapDomainId);
    try {
        const report = await withJobDatabase((database) =>
            runLocalTerrain(database, {
                mapDomainId: domain,
                job: context.job.publicId,
                bounds,
                ...(workers ? { workers } : {}),
                phase: (name, progress) => context.beginPhase(name, progress),
            }),
        );
        return terrainLocalResult(report);
    } catch (error) {
        if (error instanceof LocalTerrainRefusal && error.code === "recipe_changed") {
            const grund = error.message;
            return withJobDatabase((database) =>
                uebergibAnVollenLauf(database, { id: context.job.id, mapDomainId: domain }, grund),
            );
        }
        if (error instanceof LocalTerrainRefusal) throw new JobFailure(error.code, error.message, false);
        throw error;
    }
}
