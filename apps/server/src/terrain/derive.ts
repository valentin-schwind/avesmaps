import { createHash } from "node:crypto";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { AVENTURIA, AVENTURIA_TRAVEL_MODEL, rechnetRueckennetz } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { burnRasters, type BurnRaster, type BurnStored } from "./burn-groups.ts";
import {
    composeDem,
    DEM_ENCODING,
    DEM_MAX_ZOOM,
    DEM_TILE_FORMAT,
    DEM_TILE_SIZE,
    DEM_TILE_VERSION,
    demRevision,
    demTiles,
    type StoredRaster,
} from "./dem-tiles.ts";
import {
    boundsIntersect,
    FULL_SCOPE,
    scopeNames,
    scopeOfChange,
    type DeriveBounds,
    type DeriveScope,
} from "./derive-scope.ts";
import type { TerrainWorkerJob, TerrainWorkerResult } from "./derive-worker.ts";
import { loadFreePeaks, loadMountainJobs, type KammQuelle, type MountainJob } from "./inputs.ts";
import { derivePathProfiles, rasterContentKey, type PathProfileReport } from "./path-profiles.ts";
import { DEFAULT_CONE, type ConeRule, type FreePeak } from "./peak-cone.ts";
import { RISE_TOLERANCE, type RiverBurnReport } from "./river-burn.ts";
import { loadRiverInputs } from "./river-inputs.ts";
import { deriveContinentalBase } from "./continental-derive.ts";
import type { ContinentalBase } from "./continental.ts";
import { diffTiles } from "./tile-diff.ts";
import { withDeriveLock } from "../derive/derive-lock.ts";
import { runDomainTerrainWithinLock, type DomainDeriveReport } from "./domain/derive.ts";
import { activateDomainDem } from "./domain/activate.ts";

/**
 * Canonical domain derivation (ADR-0016): raw V12 seeds, erosive domain master, published DEM,
 * absolute path profiles and verified activation under one domain lock.
 * Legacy derivation below remains a parity harness; productive readers use the domain master.
 * All writes are derived data, never authoritative map edits.
 */

export interface DeriveTerrainOptions {
    mapDomainId?: string;
    /** Parallele Gebirge. Auf dem VPS mit Claudio abzustimmen; lokal gern mehr. */
    workers?: number;
    /** Nur diese Gebirge neu rechnen (public_id oder Name); die Kacheln entstehen trotzdem aus allen. */
    only?: readonly string[];
    /**
     * Worauf sich der Lauf bezieht (`derive-scope.ts`). Ohne Angabe alles, was die Fingerabdrücke als veraltet zeigen.
     * Mit `entities` oder `bounds` rechnet V12 nur die benannten Gebirge; die übrigen bleiben, wie sie gespeichert sind,
     * auch wenn ihre Eingaben sich geändert haben (das Einbrennen und alles danach folgt dem gespeicherten Stand).
     */
    scope?: DeriveScope;
    /** Auch unveränderte Gebirge neu rechnen (bei einem Bereich nur die darin). */
    force?: boolean;
    coneRule?: ConeRule;
    /** Beim Aufräumen nur die aktuelle Revision behalten (lokal, das npm-Skript); siehe `pruneTerrainDem`. */
    onlyCurrent?: boolean;
    onProgress?: (message: string) => void;
}

export interface DeriveTerrainReport {
    domain?: DomainDeriveReport;
    mountains: number;
    /** Gebirge, für die V12 gerechnet wurde. */
    computed: number;
    unchanged: number;
    failed: { name: string; error: string }[];
    removedRasters: number;
    kammQuellen: Record<KammQuelle, number>;
    grundhoehe: { klein: number; gross: number };
    freePeaks: number;
    revision: string;
    revisionChanged: boolean;
    /** Revisionen, die dieser Lauf entfernt hat (älter als einen Tag nach Ablösung). */
    removedRevisions: string[];
    tiles: number;
    bytes: number;
    /** Die Höhenprofile der Landwege (S5a). */
    profiles: PathProfileReport;
    /** Die eingebrannten Flüsse (S6) der Gruppen, die dieser Lauf neu brannte; `null`, wenn keine brannte. */
    rivers: RiverBurnReport | null;
    /** Das Einbrennen in Gruppen (WI-0059): alle, neu gebrannte und die Raster darin. */
    burn: { groups: number; burnedGroups: number; burnedRasters: number };
    /** Kacheln, die sich gegenüber der vorigen Revision geändert haben (alle Stufen); `null` ohne vorige oder ohne neue. */
    changedTiles: number | null;
    /** Der Kartenbereich der geänderten Kacheln der feinsten Stufe; `null`, wenn sich keine änderte. */
    changedBounds: DeriveBounds | null;
    /** Der Auftrag für die nächste Stufe (Relief): der Bereich der Änderung, oder der volle, wenn er unbekannt ist. */
    scope: DeriveScope;
    /** Millisekunden je Abschnitt des Laufs. */
    phases: Record<string, number>;
    ms: number;
}

const workerFile = new URL(`./derive-worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);

/**
 * Ab so vielen Zellen rechnet ein Rückennetz-Gebirge allein (Claudio 2026-10-20, Antwort auf die Rechenzeit-Frage: „Gebirge über etwa
 * 500 k Zellen mit einem Thread rechnen“): Seine Talboden-Suche braucht am Ehernen Schwert rund 220 MB je Thread, zwei davon stießen an
 * den Speicherrahmen der Stage.
 */
export const RUECKENNETZ_ALLEIN_AB_ZELLEN = 500_000;

/** Zellen des Rasters auf Legacys Speicherauflösung (0,25 E). */
const zellenVon = (job: MountainJob): number => {
    const b = job.input.bounds;
    return (Math.round((b.max_x - b.min_x) / 0.25) + 1) * (Math.round((b.max_y - b.min_y) / 0.25) + 1);
};

/** Rechnet die Aufträge in `count` Threads, große Rückennetze danach einzeln; die Reihenfolge der Ergebnisse ist gleichgültig. */
async function computeAll(
    jobs: readonly MountainJob[],
    count: number,
    onResult: (job: MountainJob, result: TerrainWorkerResult) => Promise<void>,
): Promise<void> {
    const allein = (job: MountainJob): boolean =>
        rechnetRueckennetz(job.input, job.input.rueckennetz?.form.kopf) &&
        zellenVon(job) > RUECKENNETZ_ALLEIN_AB_ZELLEN;
    await computeInThreads(
        jobs.filter((job) => !allein(job)),
        count,
        onResult,
    );
    await computeInThreads(jobs.filter(allein), 1, onResult);
}

async function computeInThreads(
    jobs: readonly MountainJob[],
    count: number,
    onResult: (job: MountainJob, result: TerrainWorkerResult) => Promise<void>,
): Promise<void> {
    if (jobs.length === 0) return;
    const queue = jobs.map((job, id) => ({ job, id }));
    const pending: Promise<void>[] = [];
    const threads = Math.max(1, Math.min(count, queue.length));
    for (let t = 0; t < threads; t += 1) {
        pending.push(
            new Promise<void>((resolve, reject) => {
                const worker = new Worker(workerFile);
                let current: { job: MountainJob; id: number } | undefined;
                const next = (): void => {
                    current = queue.shift();
                    if (!current) {
                        void worker.terminate().then(() => resolve());
                        return;
                    }
                    worker.postMessage({
                        id: current.id,
                        input: current.job.input,
                        durchschnittshoehe: current.job.durchschnittshoehe,
                        talbodenGemerkt: current.job.talbodenGemerkt,
                    } satisfies TerrainWorkerJob);
                };
                worker.on("message", (result: TerrainWorkerResult) => {
                    const done = current;
                    if (!done) {
                        return;
                    }
                    onResult(done.job, result).then(next, (error: unknown) => {
                        void worker.terminate();
                        reject(error instanceof Error ? error : new Error(String(error)));
                    });
                });
                worker.on("error", reject);
                next();
            }),
        );
    }
    await Promise.all(pending);
}

export async function deriveTerrain(
    database: Database,
    options: DeriveTerrainOptions = {},
): Promise<DeriveTerrainReport> {
    // Eine Ableitung des Geländes zur Zeit, für jeden Aufrufer (derive/derive-lock.ts, Koordination 2026-09-29).
    const domainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    return withDeriveLock(database, domainId, "derive:terrain", async () => {
        const started = performance.now();
        const report = await runDeriveTerrain(database, options, true);
        if (report.failed.length > 0) return report;
        const domain = await runDomainTerrainWithinLock(database, {
            mapDomainId: domainId,
            force: options.force === true,
            ...(options.scope ? { scope: options.scope } : {}),
            ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        });
        if (!domain.publication || !domain.profiles) throw new Error("Domain terrain publication incomplete");
        const activationStarted = performance.now();
        const activated = await activateDomainDem(database, domainId, domain.fingerprint);
        report.domain = domain;
        report.revision = domain.publication.revision;
        report.revisionChanged = activated;
        report.tiles = domain.publication.tiles;
        report.bytes = domain.publication.bytes;
        report.profiles = domain.profiles;
        report.phases = { ...report.phases, ...domain.phases, activation: performance.now() - activationStarted };
        const cleanupStarted = performance.now();
        report.removedRevisions = await pruneTerrainDem(database, domainId, options.onlyCurrent === true);
        report.phases["cleanup"] = performance.now() - cleanupStarted;
        report.ms = performance.now() - started;
        return report;
    });
}

/** Historical parity harness; production callers use deriveTerrain. */
export async function deriveLegacyTerrain(
    database: Database,
    options: DeriveTerrainOptions = {},
): Promise<DeriveTerrainReport> {
    return withDeriveLock(database, options.mapDomainId ?? AVENTURIA.mapDomain, "derive:terrain", () =>
        runDeriveTerrain(database, options),
    );
}

interface StoredRasterRow {
    area_id: string;
    fingerprint: string;
    v12_fingerprint: string | null;
    cell: number;
    origin_x: number;
    origin_y: number;
    width: number;
    height: number;
    samples: Buffer;
    v12_samples: Buffer | null;
    rueckennetz_talboden: number | null;
    rueckennetz_talboden_fingerprint: string | null;
}

/** Ein Puffer aus der Datenbank als Raster-Samples (eigene Kopie, ausgerichtet). */
const samplesOf = (bytes: Buffer): Uint16Array =>
    new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

/** Samples als Puffer für die Datenbank, ohne Kopie. */
const bytesOf = (samples: Uint16Array): Buffer => Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);

async function persistMountainRaster(
    transaction: Queryable,
    mapDomainId: string,
    job: MountainJob,
    result: TerrainWorkerResult,
    fingerprint: string,
    samples: Buffer,
): Promise<void> {
    const ridge = job.kammlinieErzeugt
        ? `LINESTRING(${job.kammlinieErzeugt.map(([x, y]) => `${String(x)} ${String(y)}`).join(",")})`
        : null;
    // `max_schritt` und `mean_schritt` bleiben die Werte von V12, vor dem Einbrennen.
    await transaction`
                INSERT INTO terrain_raster (
                    area_id, map_domain_id, fingerprint, cell, origin_x, origin_y, width, height, samples,
                    max_schritt, mean_schritt, kamm_quelle, kammlinie_erzeugt, grundhoehe, derived_at,
                    v12_fingerprint, v12_samples, rueckennetz_talboden, rueckennetz_talboden_fingerprint
                ) VALUES (
                    ${job.areaId}, ${mapDomainId}, ${fingerprint}, ${result.cell},
                    ${result.originX}, ${result.originY}, ${result.width}, ${result.height}, ${samples}, ${result.max},
                    ${result.mean}, ${job.kammQuelle}, ST_SetSRID(ST_GeomFromText(${ridge}), 0), ${job.grundhoehe}, now(),
                    ${job.fingerprint}, ${bytesOf(result.samples)}, ${result.talboden},
                    ${result.talboden === null ? null : job.talbodenFingerprint}
                )
                ON CONFLICT (area_id) DO UPDATE SET
                    fingerprint = EXCLUDED.fingerprint, cell = EXCLUDED.cell, origin_x = EXCLUDED.origin_x,
                    origin_y = EXCLUDED.origin_y, width = EXCLUDED.width, height = EXCLUDED.height,
                    samples = EXCLUDED.samples, max_schritt = EXCLUDED.max_schritt,
                    mean_schritt = EXCLUDED.mean_schritt, kamm_quelle = EXCLUDED.kamm_quelle,
                    kammlinie_erzeugt = EXCLUDED.kammlinie_erzeugt, grundhoehe = EXCLUDED.grundhoehe,
                    v12_fingerprint = EXCLUDED.v12_fingerprint, v12_samples = EXCLUDED.v12_samples,
                    rueckennetz_talboden = EXCLUDED.rueckennetz_talboden,
                    rueckennetz_talboden_fingerprint = EXCLUDED.rueckennetz_talboden_fingerprint,
                    derived_at = now()
            `;
}

export async function deriveTerrainSeeds(
    database: Database,
    options: DeriveTerrainOptions = {},
): Promise<DeriveTerrainReport> {
    return withDeriveLock(database, options.mapDomainId ?? AVENTURIA.mapDomain, "derive:terrain-seeds", () =>
        runDeriveTerrain(database, options, true),
    );
}

/**
 * Die V12-Saaten ohne eigene Sperre: für einen Job der Queue (`terrain_local`, WI-0125), dessen Worker die geteilte Sperre der Domäne
 * hält. Rechnet wie `deriveTerrainSeeds` nur Gebirge mit geänderten Eingaben.
 */
export function deriveTerrainSeedsWithinLock(
    database: Database,
    options: DeriveTerrainOptions = {},
): Promise<DeriveTerrainReport> {
    return runDeriveTerrain(database, options, true);
}

async function runDeriveTerrain(
    database: Database,
    options: DeriveTerrainOptions,
    seedsOnly = false,
): Promise<DeriveTerrainReport> {
    const started = Date.now();
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const progress0 = options.onProgress ?? (() => undefined);
    const progress = (message: string): void => progress0(`[${String(Date.now() - started)} ms] ${message}`);
    const coneRule = options.coneRule ?? DEFAULT_CONE;
    const phases: Record<string, number> = {};
    let lapStart = Date.now();
    const lap = (name: string): void => {
        phases[name] = (phases[name] ?? 0) + Date.now() - lapStart;
        lapStart = Date.now();
    };

    const scope: DeriveScope =
        options.only && options.only.length > 0
            ? { kind: "entities", ids: options.only }
            : (options.scope ?? FULL_SCOPE);
    const jobs = await loadMountainJobs(database, mapDomainId);
    const freePeaks = await loadFreePeaks(database, mapDomainId, jobs);
    const riverInputs = await loadRiverInputs(database, mapDomainId);
    const rows = new Map(
        // 🔴 Nur die Saaten (Geländelauf der Warteschlange, WI-0283): Die Raster aller Gebirge wandern hier sonst über die Leitung, gebraucht wird nur, ob es sie gibt.
        (
            await database<StoredRasterRow[]>`
                SELECT area_id::text, fingerprint, v12_fingerprint, cell, origin_x, origin_y, width, height,
                       ${
                           seedsOnly
                               ? database`''::bytea AS samples, CASE WHEN v12_samples IS NULL THEN NULL ELSE ''::bytea END AS v12_samples`
                               : database`samples, v12_samples`
                       },
                       rueckennetz_talboden, rueckennetz_talboden_fingerprint
                FROM terrain_raster WHERE map_domain_id = ${mapDomainId} ORDER BY area_id
            `
        ).map((row) => [Number(row.area_id), row]),
    );
    lap("eingaben");

    // Ausgewählt heißt: V12 darf für dieses Gebirge neu rechnen. Ohne Bereich alle.
    const selected = (job: MountainJob): boolean => {
        if (scope.kind === "full") return true;
        if (scope.kind === "entities") return scopeNames(scope, job.areaPublicId, job.name);
        const b = job.input.bounds;
        return (
            scope.bounds !== null &&
            boundsIntersect({ minX: b.min_x, minY: b.min_y, maxX: b.max_x, maxY: b.max_y }, scope.bounds)
        );
    };
    // Veraltet: kein ungeschnittener Stand gespeichert oder von anderen Eingaben. `force` rechnet auch das Aktuelle neu.
    const stale = jobs
        .filter((job) => {
            if (!selected(job)) return false;
            const row = rows.get(job.areaId);
            return options.force === true || !row?.v12_samples || row.v12_fingerprint !== job.fingerprint;
        })
        // Rückennetz: Ein Talboden, der an derselben Form gefunden wurde, erspart die Suche (WI-0247, Migration 0213).
        .map((job) => {
            const row = rows.get(job.areaId);
            const gemerkt =
                job.talbodenFingerprint !== null &&
                options.force !== true &&
                row?.rueckennetz_talboden_fingerprint === job.talbodenFingerprint
                    ? row.rueckennetz_talboden
                    : null;
            return gemerkt === null ? job : { ...job, talbodenGemerkt: gemerkt };
        });

    const report: DeriveTerrainReport = {
        mountains: jobs.length,
        computed: 0,
        unchanged: jobs.length - stale.length,
        failed: [],
        removedRasters: 0,
        kammQuellen: { kammlinie: 0, beschriftungskurve: 0, erzeugt: 0, gipfel: 0, keiner: 0 },
        grundhoehe: { klein: 0, gross: 0 },
        freePeaks: 0,
        revision: "",
        revisionChanged: false,
        removedRevisions: [],
        tiles: 0,
        bytes: 0,
        profiles: {
            paths: 0,
            computed: 0,
            unchanged: 0,
            removed: 0,
            withHeight: 0,
            fingerprint: "",
            steep: { threshold: 0, paths: 0, top: [] },
            wheel: { threshold: 0, paths: 0, top: [] },
        },
        rivers: null,
        burn: { groups: 0, burnedGroups: 0, burnedRasters: 0 },
        changedTiles: null,
        changedBounds: null,
        scope: FULL_SCOPE,
        phases,
        ms: 0,
    };
    for (const job of jobs) {
        report.kammQuellen[job.kammQuelle] += 1;
        if (job.grundhoehe !== null) {
            report.grundhoehe[job.grundhoehe > 1000 ? "gross" : "klein"] += 1;
        }
    }
    progress(`${String(jobs.length)} Gebirge, ${String(stale.length)} neu zu rechnen`);

    // Erst alle Gebirge rechnen, dann einbrennen: Ein Bett hängt am Gelände flussauf, auch im Nachbargebirge.
    const fresh = new Map<number, { job: MountainJob; result: TerrainWorkerResult }>();
    await computeAll(stale, options.workers ?? 2, (job, result) => {
        if (result.error) {
            report.failed.push({ name: job.name, error: result.error });
            progress(`FEHLER ${job.name}: ${result.error}`);
        } else {
            fresh.set(job.areaId, { job, result });
            report.computed += 1;
            progress(
                `${job.name}: ${String(result.width)}×${String(result.height)}, höchstens ${String(result.max)}, Schnitt ${result.mean.toFixed(0)}`,
            );
        }
        return Promise.resolve();
    });
    lap("gebirge");

    // Raster von Flächen, die kein aktives Gebirge mehr sind, sind wertlos: Derived Data, gelöscht.
    const ids = jobs.map((job) => job.areaId);
    const removed = await database`
        DELETE FROM terrain_raster WHERE map_domain_id = ${mapDomainId} AND area_id <> ALL(${ids}::bigint[])
        RETURNING area_id
    `;
    report.removedRasters = removed.length;
    report.freePeaks = freePeaks.length;
    if (seedsOnly) {
        await database.begin(async (transaction) => {
            for (const { job, result } of fresh.values()) {
                await persistMountainRaster(
                    transaction,
                    mapDomainId,
                    job,
                    result,
                    job.fingerprint,
                    bytesOf(result.samples),
                );
            }
        });
        lap("seeds-speichern");
        report.ms = Date.now() - started;
        return report;
    }

    // Der ungeschnittene Stand je Gebirge: frisch gerechnet, sonst der gespeicherte (auch ein veralteter, wenn das
    // Gebirge nicht ausgewählt ist oder scheiterte - dann bleibt es, wie es war, und rechnet der nächste Lauf neu).
    // Ein Gebirge ganz ohne gespeicherten Stand fehlt in dieser Rechnung.
    const inputs: BurnRaster[] = [];
    const stored = new Map<number, BurnStored>();
    for (const job of jobs) {
        const made = fresh.get(job.areaId);
        if (made) {
            const { result } = made;
            inputs.push({
                areaId: job.areaId,
                v12Fingerprint: job.fingerprint,
                raster: {
                    cell: result.cell,
                    originX: result.originX,
                    originY: result.originY,
                    width: result.width,
                    height: result.height,
                    samples: result.samples,
                },
            });
            continue;
        }
        const row = rows.get(job.areaId);
        if (!row?.v12_samples || !row.v12_fingerprint) continue;
        inputs.push({
            areaId: job.areaId,
            v12Fingerprint: row.v12_fingerprint,
            raster: {
                cell: row.cell,
                originX: row.origin_x,
                originY: row.origin_y,
                width: row.width,
                height: row.height,
                samples: samplesOf(row.v12_samples),
            },
        });
        stored.set(job.areaId, { fingerprint: row.fingerprint, samples: samplesOf(row.samples) });
    }

    // Einbrennen über die Gruppen: nur die neu, deren Fingerabdruck nicht zum Gespeicherten passt.
    const forced =
        options.force !== true
            ? false
            : scope.kind === "full"
              ? true
              : new Set(jobs.filter(selected).map((job) => job.areaId));
    const run = burnRasters({
        rasters: inputs,
        stored,
        rivers: riverInputs.rivers,
        lakes: riverInputs.lakes,
        peaks: freePeaks,
        rule: coneRule,
        anchors: jobs.flatMap((job) => job.input.peaks),
        force: forced,
    });
    report.burn = { groups: run.groups, burnedGroups: run.burnedGroups, burnedRasters: run.burnedRasters };
    report.rivers = run.report;
    lap("einbrennen");
    progress(
        `Einbrennen: ${String(run.burnedGroups)} von ${String(run.groups)} Gruppen neu (${String(run.burnedRasters)} Raster)`,
    );
    if (run.report) {
        const rivers = run.report;
        progress(
            `Flüsse eingebrannt: von ${String(rivers.withHeight)} Läufen im Gebirge stiegen ${String(rivers.rasters.risingBefore)} in den Rastern und ${String(rivers.tiles.risingBefore)} in den Kacheln, jetzt ${String(rivers.rasters.risingAfter)} und ${String(rivers.tiles.risingAfter)} (${String(rivers.peakRises.length)} an Gipfeln); ${String(rivers.changedCells)} Zellen in ${String(rivers.rounds)} Runden`,
        );
        if (rivers.unresolved.length > 0) {
            progress(`FEHLER Einbrennen nicht fertig: ${String(rivers.unresolved.length)} Läufe steigen noch`);
        }
        // Befunde für die Redaktion (Map Mutation Guard): gemeldet, nicht korrigiert.
        const list = (entries: { id: string; name: string; value: number }[]): string =>
            entries
                .slice(0, 8)
                .map((entry) => `${entry.name} (${entry.id}) ${entry.value.toFixed(0)}`)
                .join(", ");
        const lakes = rivers.lakes.filter((lake) => lake.lowered > RISE_TOLERANCE || lake.outflows > 1);
        for (const [count, what, entries] of [
            [rivers.undirected.length, "Läufe ohne Fließrichtung", ""],
            [rivers.uphill.length, "Läufe laut Daten bergauf (Schritt)", list(rivers.uphill)],
            [rivers.deepCuts.length, "Einschnitte über 1.000 Schritt", list(rivers.deepCuts)],
            [rivers.coneRises.length, "Läufe über freie Gipfelkegel, nicht geschnitten", list(rivers.coneRises)],
            [rivers.peakRises.length, "Läufe an Gipfeln im Gebirge, Gipfel stehen gelassen", list(rivers.peakRises)],
            [
                lakes.length,
                "Seen tief eingeebnet oder mit mehreren Abflüssen",
                lakes
                    .slice(0, 8)
                    .map((lake) => `${lake.name} −${lake.lowered.toFixed(0)}, ${String(lake.outflows)} Abflüsse`)
                    .join(", "),
            ],
        ] as const) {
            if (count > 0) progress(`Befund: ${String(count)} ${what}${entries ? `, zuerst ${entries}` : ""}`);
        }
    } else {
        progress("Flüsse: alle Gruppen sind mit dem heutigen Stand eingebrannt");
    }

    await database.begin(async (transaction) => {
        for (const entry of run.rasters) {
            const made = fresh.get(entry.areaId);
            const samples = bytesOf(entry.samples);
            if (!made) {
                if (entry.changed) {
                    await transaction`
                        UPDATE terrain_raster SET samples = ${samples}, fingerprint = ${entry.fingerprint}, derived_at = now()
                        WHERE area_id = ${entry.areaId}
                    `;
                }
                continue;
            }
            await persistMountainRaster(transaction, mapDomainId, made.job, made.result, entry.fingerprint, samples);
        }
    });
    lap("speichern");

    // Das Höhenmodell, wie es jetzt gespeichert ist: die eingebrannten Raster aller Gebirge.
    const state = await database<
        {
            cell: number;
            origin_x: number;
            origin_y: number;
            width: number;
            height: number;
            samples: Buffer;
            fingerprint: string;
            area_id: string;
        }[]
    >`
        SELECT cell, origin_x, origin_y, width, height, samples, fingerprint, area_id::text
        FROM terrain_raster WHERE map_domain_id = ${mapDomainId} ORDER BY area_id
    `;
    const rasters: StoredRaster[] = state.map((row) => ({
        cell: row.cell,
        originX: row.origin_x,
        originY: row.origin_y,
        width: row.width,
        height: row.height,
        samples: samplesOf(row.samples),
    }));
    const continental = await deriveContinentalBase(
        database,
        mapDomainId,
        [...freePeaks, ...jobs.flatMap((job) => job.input.peaks)],
        riverInputs,
        rasters,
        options.force === true,
        freePeaks,
    );
    lap("kontinentalsockel");
    const fingerprint = createHash("sha256")
        .update(continental?.fingerprint ?? "")
        .update(state.map((row) => row.fingerprint).join("|"))
        .update(`|${JSON.stringify(freePeaks)}|${JSON.stringify(coneRule)}|${DEM_TILE_VERSION}`)
        .digest("hex");
    await publishDem(
        database,
        mapDomainId,
        { rasters, freePeaks, coneRule, fingerprint, force: options.force === true, continental },
        report,
        progress,
    );
    lap("kacheln");

    // Aufräumen bei JEDEM Lauf, auch ohne neue Revision: Einen Timer auf dem VPS gibt es nicht
    // (Claudio 2026-09-27, wie `retire-png`). Die Regel steht an `pruneTerrainDem`.
    report.removedRevisions = await pruneTerrainDem(database, mapDomainId, options.onlyCurrent === true);
    if (report.removedRevisions.length > 0) {
        progress(`Alte Revisionen entfernt: ${report.removedRevisions.join(", ")}`);
    }

    // Die Höhenprofile der Landwege: dieselben Höhen wie das Gelände, aber aus den Rastern selbst und nur
    // innerhalb ihrer Fläche (Legacys Profillauf), nicht aus den Kacheln - die sind ein Renderartefakt.
    const byArea = new Map(jobs.map((job) => [job.areaId, job]));
    const heightRasters = state.flatMap((row, index) => {
        const job = byArea.get(Number(row.area_id));
        const raster = rasters[index];
        if (!job || !raster) return [];
        const b = job.input.bounds;
        return [
            {
                raster,
                geometry: job.input.geometry,
                bounds: { minX: b.min_x, minY: b.min_y, maxX: b.max_x, maxY: b.max_y },
                fingerprint: rasterContentKey(raster),
            },
        ];
    });
    report.profiles = await derivePathProfiles(
        database,
        mapDomainId,
        { rasters: heightRasters, peaks: freePeaks, rule: coneRule, continental },
        AVENTURIA_TRAVEL_MODEL,
    );
    lap("wegprofile");
    progress(
        `Wegprofile: ${String(report.profiles.computed)} gerechnet, ${String(report.profiles.unchanged)} unverändert, ${String(report.profiles.withHeight)} von ${String(report.profiles.paths)} Landwegen mit Höhe`,
    );
    // Die Prüfgrenzen (MCS-026, Punkt 7): gemeldet, nicht abgeschnitten.
    for (const [list, what] of [
        [report.profiles.steep, "Landwege"],
        [report.profiles.wheel, "Landwege für Wagen"],
    ] as const) {
        if (list.paths === 0) continue;
        progress(
            `Prüfgrenze ${String(list.threshold * 100)} %: ${String(list.paths)} ${what} steiler, zuerst ${list.top
                .slice(0, 5)
                .map((entry) => `${entry.name} ${(entry.grade * 100).toFixed(0)} %`)
                .join(", ")}`,
        );
    }

    report.ms = Date.now() - started;
    return report;
}

/**
 * Setzt die Kachelpyramide zusammen und veröffentlicht sie, wenn sich ein Byte geändert hat.
 *
 * Passt der Fingerabdruck der Eingaben (Raster, freie Gipfel, Regel, Kachelversion) zur aktuellen Revision, ist sie
 * die Revision; gerechnet wird nichts (WI-0059: die Kacheln sind eine Funktion ihrer Eingaben, ein Lauf ohne Änderung
 * kodierte sie bisher trotzdem jedes Mal, rund eine Sekunde). Sonst werden sie zusammengesetzt und kodiert; die
 * Revision ist der Inhalts-Hash aller Kacheln, damit bytegleich zu einem vollen Lauf, und ist sie die aktuelle, wird
 * nur der neue Fingerabdruck vermerkt.
 */
async function publishDem(
    database: Database,
    mapDomainId: string,
    input: {
        rasters: readonly StoredRaster[];
        freePeaks: readonly FreePeak[];
        coneRule: ConeRule;
        fingerprint: string;
        force: boolean;
        continental?: ContinentalBase | undefined;
    },
    report: DeriveTerrainReport,
    progress: (message: string) => void,
): Promise<void> {
    const { fingerprint } = input;
    const [known] = await database<{ revision: string; fingerprint: string; tiles: number; bytes: string }[]>`
        SELECT revision, fingerprint, tiles, bytes FROM terrain_dem WHERE map_domain_id = ${mapDomainId} AND is_current
    `;
    if (!input.force && known && known.fingerprint === fingerprint) {
        report.revision = known.revision;
        report.tiles = known.tiles;
        report.bytes = Number(known.bytes);
        report.scope = scopeOfChange(true, null);
        progress(`Kacheln: Eingaben unverändert, Revision ${known.revision} bleibt`);
        return;
    }
    progress(
        `Kacheln aus ${String(input.rasters.length)} Gebirgen und ${String(input.freePeaks.length)} freien Gipfeln`,
    );
    const tiles = demTiles(composeDem(input.rasters, input.freePeaks, input.coneRule, input.continental));
    const revision = demRevision(tiles);
    report.revision = revision;
    report.tiles = tiles.length;
    report.bytes = tiles.reduce((sum, tile) => sum + tile.image.length, 0);

    if (known) {
        const before = await database<{ z: number; x: number; y: number; digest: string }[]>`
            SELECT z, x, y, encode(sha256(png), 'hex') AS digest FROM terrain_dem_tile WHERE revision = ${known.revision}
        `;
        const diff = diffTiles(
            new Map(before.map((row) => [`${String(row.z)}/${String(row.x)}/${String(row.y)}`, row.digest])),
            tiles,
            DEM_MAX_ZOOM,
        );
        report.changedTiles = diff.changed;
        report.changedBounds = diff.bounds;
    }
    report.scope = scopeOfChange(known !== undefined, report.changedBounds);

    await database.begin(async (transaction) => {
        const [current] = await transaction<{ revision: string }[]>`
            SELECT revision FROM terrain_dem WHERE map_domain_id = ${mapDomainId} AND is_current
        `;
        if (current?.revision === revision) {
            // Dasselbe Bild unter neuem Fingerabdruck (etwa nach einer Änderung der Fingerabdrücke selbst): nur merken.
            await transaction`UPDATE terrain_dem SET fingerprint = ${fingerprint}, continental_fingerprint = ${input.continental?.fingerprint ?? null} WHERE revision = ${revision}`;
            return;
        }
        report.revisionChanged = true;
        await transaction`
            INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, continental_fingerprint, format)
            VALUES (${revision}, ${mapDomainId}, ${fingerprint}, ${DEM_TILE_SIZE}, ${DEM_MAX_ZOOM}, ${DEM_ENCODING},
                    ${report.tiles}, ${report.bytes}, ${input.continental?.fingerprint ?? null}, ${DEM_TILE_FORMAT})
            ON CONFLICT (revision) DO NOTHING
        `;
        for (const tile of tiles) {
            await transaction`
                INSERT INTO terrain_dem_tile (revision, z, x, y, png)
                VALUES (${revision}, ${tile.z}, ${tile.x}, ${tile.y}, ${tile.image})
                ON CONFLICT (revision, z, x, y) DO NOTHING
            `;
        }
        // Der Zeiger wechselt in derselben Transaktion; die vorige Revision bleibt einen Tag stehen,
        // damit ein offener Tab nicht kachelweise leer wird (ADR-0008, Betreiber 2026-09-23).
        await transaction`
            UPDATE terrain_dem SET is_current = FALSE, superseded_at = now()
            WHERE map_domain_id = ${mapDomainId} AND is_current
        `;
        await transaction`UPDATE terrain_dem SET is_current = TRUE, superseded_at = NULL WHERE revision = ${revision}`;
    });
}

/**
 * Die Revisionen des Höhenmodells aufräumen, bei JEDEM Lauf (Betreiber 2026-09-28: „dass du dopplung vermeidest
 * oder dass unsere stage oder lokale db mit temporären daten überwuchert, weil du alles immer sichern willst“,
 * current.md „Ohne Ballast“; dieselbe Regel wie `pruneVisualRelief`, WI-0054 `e6e47ba`):
 * - Vorgabe (Stage, die gebaute CLI ohne Schalter): höchstens die aktuelle und die zuletzt abgelöste. Die vorige
 *   nur für die Übergangszeit, einen Tag lang, weil offene Karten noch ihren Zeiger tragen (ADR-0008); Älteres
 *   sofort.
 * - `onlyCurrent` (lokal, das npm-Skript `derive:terrain`): nur die aktuelle.
 * Ohne aktuelle Revision bleibt alles stehen. Die Kacheln gehen per `ON DELETE CASCADE` mit.
 */
export async function pruneTerrainDem(
    database: Queryable,
    mapDomainId: string,
    onlyCurrent: boolean,
): Promise<string[]> {
    const rows = await database<{ revision: string }[]>`
        DELETE FROM terrain_dem
        WHERE map_domain_id = ${mapDomainId} AND NOT is_current
          AND EXISTS (SELECT 1 FROM terrain_dem WHERE map_domain_id = ${mapDomainId} AND is_current)
          AND (
              ${onlyCurrent}
              OR superseded_at < now() - interval '1 day'
              OR revision IS DISTINCT FROM (
                  SELECT revision FROM terrain_dem
                  WHERE map_domain_id = ${mapDomainId} AND NOT is_current
                  ORDER BY superseded_at DESC NULLS LAST, revision LIMIT 1
              )
          )
        RETURNING revision
    `;
    await database`
        DELETE FROM terrain_continental_base b WHERE b.map_domain_id = ${mapDomainId}
        AND NOT EXISTS (SELECT 1 FROM terrain_dem d WHERE d.map_domain_id = b.map_domain_id AND d.continental_fingerprint = b.fingerprint)
    `;
    await database`
        DELETE FROM terrain_domain_raster t WHERE t.map_domain_id = ${mapDomainId}
        AND EXISTS (SELECT 1 FROM terrain_dem d WHERE d.map_domain_id = t.map_domain_id AND d.is_current AND d.domain_fingerprint IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM terrain_dem d WHERE d.map_domain_id = t.map_domain_id AND d.domain_fingerprint = t.fingerprint)
    `;
    return rows.map((row) => row.revision).sort();
}
