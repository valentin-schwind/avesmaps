import type { Queryable } from "../database.ts";
import { loadTerrainManifest } from "../terrain/dem-manifest.ts";
import { retryOnDeadlock } from "./store.ts";

/**
 * Die Bereichsereignisse (JOBS-0001 4.9, V5, WI-0125): `area.changed` (neue Geländekacheln, Bereich und Kachelliste mit neuer
 * Revision) und `display_heights.changed` (neue Höhenlinien und Höhenstufen). Sie stehen in `job_event` wie die Ereignisse der Jobs
 * (Nummer `seq`, `NOTIFY` erst mit dem Commit) und gehen über `/ws` im Kanal `area` an die Karten. Die Wahrheit bleibt der Zeiger:
 * Eine Karte, die ein Ereignis verpasst, vergleicht beim Wiederverbinden die Zeiger.
 *
 * Dazu `map.changed` (WI-0128 E13, EDIT-0001 N8): Eine Kartenoperation hat Orte oder Wege geändert. Die Schreibnaht schreibt es über
 * `map_event_add` (Migration 0103) IN der Transaktion der Operation, ohne Job; seine Nummer ist die Kachelrevision (`?r=`), mit der die
 * Karten Orte, Wege und Wegnamen neu laden.
 *
 * `dem_publish` schreibt sein Ereignis IN der Transaktion des Zeigerwechsels; ein voller Lauf und die Anzeigehöhen wechseln ihren
 * Zeiger in eigenen Transaktionen und melden danach (`addAreaEvent`): Ein Ereignis nach dem Commit erzählt nie von Unveröffentlichtem.
 */

export const AREA_EVENT_KINDS = ["area.changed", "display_heights.changed", "map.changed"] as const;

/** Gehört ein Ereignis in den Kanal `area`? */
export function isAreaEvent(kind: string): boolean {
    return (AREA_EVENT_KINDS as readonly string[]).includes(kind);
}

export interface AreaEventJob {
    id: number;
    publicId: string;
    kind: string;
    mapDomainId: string;
}

/**
 * Schreibt ein Bereichsereignis in einer eigenen Transaktion (als letzte Anweisung, wie `job_event_add` es verlangt).
 *
 * Der Job-Prozess schreibt es gleich nach der Meldung seiner Phase `event`, während der Aufseher die Jobzeile für diese Phase noch
 * sperrt. Seit Migration 0217 wartet `job_event_add` dafür zuerst auf die Zeile (Deadlock auf der Stage, 2026-10-23). Ein seltener
 * Rest wird an der Verbindung einmal wiederholt (`retryOnDeadlock`): Ein fertig gerechneter Job soll daran nicht scheitern.
 */
export async function addAreaEvent(
    database: Queryable,
    kind: (typeof AREA_EVENT_KINDS)[number],
    job: AreaEventJob,
    payload: Record<string, unknown>,
    bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null,
): Promise<void> {
    await retryOnDeadlock(database, async () => {
        await database`
            SELECT job_event_add(
                ${kind}, ${job.id}::bigint, ${job.mapDomainId},
                ${database.json({ jobId: job.publicId, jobKind: job.kind, ...JSON.parse(JSON.stringify(payload)) })}::jsonb,
                ${bounds === null ? null : database.json({ ...bounds })}::jsonb
            )
        `;
    });
}

/** Die Kacheln, deren Revision zwischen zwei Pyramiden verschieden ist (Schlüssel `z/x/y` → neue Kachelrevision). */
export async function changedTilesBetween(
    database: Queryable,
    before: string | null,
    after: string,
): Promise<Record<string, string>> {
    const next = (await loadTerrainManifest(database, after)) ?? {};
    const previous = before === null ? {} : ((await loadTerrainManifest(database, before)) ?? {});
    const changed: Record<string, string> = {};
    for (const [key, revision] of Object.entries(next)) if (previous[key] !== revision) changed[key] = revision;
    return changed;
}

/** Der Kartenbereich (Karteneinheiten) der geänderten Kacheln der feinsten Stufe. */
export function boundsOfTiles(
    tiles: Record<string, string>,
    maxZoom: number,
): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
} | null {
    let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    const span = 1024 / (1 << maxZoom);
    for (const key of Object.keys(tiles)) {
        const [z, x, y] = key.split("/").map(Number) as [number, number, number];
        if (z !== maxZoom) continue;
        const tile = { minX: x * span, maxX: (x + 1) * span, minY: 1024 - (y + 1) * span, maxY: 1024 - y * span };
        bounds = bounds
            ? {
                  minX: Math.min(bounds.minX, tile.minX),
                  minY: Math.min(bounds.minY, tile.minY),
                  maxX: Math.max(bounds.maxX, tile.maxX),
                  maxY: Math.max(bounds.maxY, tile.maxY),
              }
            : tile;
    }
    return bounds;
}
