import type { SystemMode, SystemStateView } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";

/**
 * Die eine Zeile `system_state` (Migration 0087, SYS-0001 §3.1): lesen, unter Sperre lesen, in die Ansicht der Verwaltung bringen.
 * Geschrieben wird sie nur in `state-changes.ts`.
 */
export interface SystemSetter {
    since: Date | null;
    /** Die pseudonyme `person.id`, wenn eine Person geschaltet hat. */
    by: string | null;
    /** `cli:<Systembenutzer>`, wenn die Kommandozeile geschaltet hat. */
    byLabel: string | null;
    reason: string | null;
}

export interface SystemStateRow {
    mode: SystemMode;
    modeSetter: SystemSetter;
    mapLock: boolean;
    mapLockSetter: SystemSetter;
    systemLock: boolean;
    systemLockSetter: SystemSetter;
    /** Die Warteschlange dieser Umgebung ist pausiert (WI-0160, Migration 0130). */
    queuePaused: boolean;
    queuePauseSetter: SystemSetter;
    revision: number;
    contentRevision: number;
    updatedAt: Date;
}

interface Row {
    mode: SystemMode;
    mode_since: Date;
    mode_by: string | null;
    mode_by_label: string | null;
    mode_reason: string | null;
    map_lock: boolean;
    map_lock_since: Date | null;
    map_lock_by: string | null;
    map_lock_by_label: string | null;
    map_lock_reason: string | null;
    system_lock: boolean;
    system_lock_since: Date | null;
    system_lock_by: string | null;
    system_lock_by_label: string | null;
    system_lock_reason: string | null;
    queue_paused: boolean;
    queue_paused_since: Date | null;
    queue_paused_by: string | null;
    queue_paused_by_label: string | null;
    queue_paused_reason: string | null;
    revision: number;
    content_revision: number;
    updated_at: Date;
}

function toRow(row: Row): SystemStateRow {
    return {
        mode: row.mode,
        modeSetter: { since: row.mode_since, by: row.mode_by, byLabel: row.mode_by_label, reason: row.mode_reason },
        mapLock: row.map_lock,
        mapLockSetter: {
            since: row.map_lock_since,
            by: row.map_lock_by,
            byLabel: row.map_lock_by_label,
            reason: row.map_lock_reason,
        },
        systemLock: row.system_lock,
        systemLockSetter: {
            since: row.system_lock_since,
            by: row.system_lock_by,
            byLabel: row.system_lock_by_label,
            reason: row.system_lock_reason,
        },
        queuePaused: row.queue_paused,
        queuePauseSetter: {
            since: row.queue_paused_since,
            by: row.queue_paused_by,
            byLabel: row.queue_paused_by_label,
            reason: row.queue_paused_reason,
        },
        revision: row.revision,
        contentRevision: row.content_revision,
        updatedAt: row.updated_at,
    };
}

/**
 * Liest die Zeile; mit `forUpdate` gesperrt bis zum Ende der Transaktion (SYS-0001 §4.5). `undefined`, wenn sie fehlt: Das ist kein
 * Normalbetrieb, sondern ein unbekannter Zustand (nur die Migration legt sie an). Fehlt die Tabelle, wirft PostgreSQL 42P01.
 */
export async function readStateRow(
    sql: Sql,
    options: { forUpdate?: boolean } = {},
): Promise<SystemStateRow | undefined> {
    const [row] = await sql<Row[]>`
        SELECT mode, mode_since, mode_by, mode_by_label, mode_reason,
               map_lock, map_lock_since, map_lock_by, map_lock_by_label, map_lock_reason,
               system_lock, system_lock_since, system_lock_by, system_lock_by_label, system_lock_reason,
               queue_paused, queue_paused_since, queue_paused_by, queue_paused_by_label, queue_paused_reason,
               revision::int AS revision, content_revision::int AS content_revision, updated_at
          FROM system_state
         WHERE id = 1
        ${options.forUpdate === true ? sql`FOR UPDATE` : sql``}
    `;
    return row === undefined ? undefined : toRow(row);
}

/** Ob ein Fehler heißt „die Tabelle gibt es noch nicht“: Fastify startet im Korridor vor `migrate` (SYS-0001 §3.2, `unprovisioned`). */
export function isMissingTable(error: unknown): boolean {
    return (error as { code?: unknown } | null)?.code === "42P01";
}

/** Die Ansicht der Verwaltung; Personen mit ihrem heutigen Anzeigenamen, die Kommandozeile mit ihrem Etikett. */
export async function stateView(sql: Sql, row: SystemStateRow): Promise<SystemStateView> {
    const ids = [row.modeSetter.by, row.mapLockSetter.by, row.systemLockSetter.by, row.queuePauseSetter.by].filter(
        (id): id is string => id !== null,
    );
    const names = new Map<string, string>();
    if (ids.length > 0) {
        const people = await sql<{ id: string; display_name: string }[]>`
            SELECT id, display_name FROM avesmaps_auth.person WHERE id = ANY(${ids}::uuid[])
        `;
        for (const person of people) names.set(person.id, person.display_name);
    }
    const setter = (value: SystemSetter) => ({
        since: value.since?.toISOString() ?? null,
        by: value.by === null ? null : { id: value.by, displayName: names.get(value.by) ?? value.by },
        byLabel: value.byLabel,
        reason: value.reason,
    });
    return {
        mode: { mode: row.mode, ...setter(row.modeSetter), since: row.modeSetter.since?.toISOString() ?? "" },
        mapLock: { locked: row.mapLock, ...setter(row.mapLockSetter) },
        systemLock: { locked: row.systemLock, ...setter(row.systemLockSetter) },
        queuePause: { paused: row.queuePaused, ...setter(row.queuePauseSetter) },
        revision: row.revision,
        contentRevision: row.contentRevision,
        updatedAt: row.updatedAt.toISOString(),
    };
}
