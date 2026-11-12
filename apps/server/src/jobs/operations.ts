import type { JobsConfig, OperationsStatus } from "@avesmaps3d/shared";
import { probeDatabase, type Database } from "../database.ts";
import { displayHeightState } from "../terrain/display-height/pointer.ts";
import { toSummary } from "./rows.ts";
import { listRecentByKind } from "./store.ts";

/**
 * Der Reiter „Betrieb“ der Statusseite (JOBS-0001 5.1): Health, Release, höchste Migration, die Zeiger von Gelände und Anzeigehöhen,
 * der Legacy-Satz und die letzten Imports (die Jobs der Art `import`). Alles liest die EIGENE Umgebung, live: Die Seite besitzt
 * keine Daten und pflegt nichts selbst.
 */

export interface OperationsOptions {
    database: Database;
    config: JobsConfig;
    releaseId: string;
    mapDomainId: string;
    now?: () => Date;
}

/** `map_revision=161832`, `ecosystem_revision=141459`, `territories_revision=pt-…` aus der `source_ref` eines Importlaufs. */
export function revisionIn(sourceRef: string, name: string): string | null {
    const match = new RegExp(`(?:^|;)${name}=([^;]+)`).exec(sourceRef);
    return match?.[1] ?? null;
}

/**
 * Der Legacy-Satz: das jeweils NEUESTE Vorkommen jeder Revision in den Importläufen (neueste zuerst). Die Quellen werden in eigenen
 * Läufen geschrieben, deshalb steht keine Revision in jedem Lauf.
 */
export function legacySetFromRuns(
    runs: readonly { source_ref: string; started_at: Date }[],
): OperationsStatus["legacy"] {
    const newest = (name: string): string | null => {
        for (const run of runs) {
            const found = revisionIn(run.source_ref, name);
            if (found) return found;
        }
        return null;
    };
    return {
        mapRevision: newest("map_revision"),
        ecosystemRevision: newest("ecosystem_revision"),
        territoriesRevision: newest("territories_revision"),
        importedAt: runs[0]?.started_at.toISOString() ?? null,
    };
}

export async function buildOperationsStatus(options: OperationsOptions): Promise<OperationsStatus> {
    const { database } = options;
    const now = (options.now ?? (() => new Date()))();
    const probe = await probeDatabase(database);

    const empty: OperationsStatus = {
        now: now.toISOString(),
        releaseId: options.releaseId,
        profile: options.config.profile,
        health: { database: { status: probe.isReachable ? "ok" : "failed", detail: probe.detail } },
        migration: null,
        pointers: { dem: null, displayHeights: { state: "none", revision: null, demRevision: null } },
        legacy: { mapRevision: null, ecosystemRevision: null, territoriesRevision: null, importedAt: null },
        imports: [],
    };
    if (!probe.isReachable) return empty;

    const [migration] = await database<
        { version: string | null }[]
    >`SELECT max(version) AS version FROM schema_migration`;
    const [dem] = await database<{ revision: string; format: string; created_at: Date }[]>`
        SELECT revision, format, created_at FROM terrain_dem WHERE map_domain_id = ${options.mapDomainId} AND is_current
    `;
    const heights = await displayHeightState(database, options.mapDomainId);
    const runs = await database<{ source_ref: string; started_at: Date }[]>`
        SELECT source_ref, started_at FROM migration_run
        WHERE status = 'completed' AND source_system = 'avesmaps-legacy'
        ORDER BY started_at DESC LIMIT 30
    `;
    const imports = await listRecentByKind(database, "import", 5);

    return {
        ...empty,
        migration: migration?.version ?? null,
        pointers: {
            dem: dem ? { revision: dem.revision, format: dem.format, createdAt: dem.created_at.toISOString() } : null,
            displayHeights:
                heights.kind === "none"
                    ? { state: "none", revision: null, demRevision: null }
                    : { state: heights.kind, revision: heights.revision, demRevision: heights.demRevision },
        },
        legacy: legacySetFromRuns(runs),
        imports: imports.map((job) => toSummary(job, now)),
    };
}
