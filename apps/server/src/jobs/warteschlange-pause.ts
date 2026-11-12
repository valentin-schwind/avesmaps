import type { QueuePauseView } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Pause der Warteschlange, gelesen aus `system_state` (WI-0160, Migration 0130; Claudios Entwurf §5). Form und Weg wie der Halt
 * der Editor-Jobs (`editor-freeze.ts`): eine Abfrage auf die eine Zeile, mit der Rolle des Aufrufers, in jeder Runde neu.
 *
 * - Der **Worker** liest sie in seinem Takt (Jobs-Rolle) und holt in der Pause keinen neuen Job; laufende Kinder bleiben unberührt.
 * - Die **Lesewege** lesen sie mit (App-Rolle), damit eine wartende Zeile „pausiert“ sagen kann.
 * - Der **Claim** liest sie nicht hier, sondern in sich selbst (`job_sync_claim`, Migration 0130): So braucht Claudios Abholer in
 *   Production keine Änderung — er ruft weiter `sync-claim` und bekommt `NULL`.
 *
 * 🪤 **Fehlerrichtung: fail-open**, anders als bei `editor-freeze.ts`. Lässt sich die Zeile nicht lesen, läuft die Warteschlange
 * weiter. Eine Sperre SCHÜTZT etwas, eine Pause BREMST nur: Fail-closed hieße, ein Datenbankhusten stellt die Warteschlange still,
 * und niemand sieht warum. Dieselbe Begründung steht in der Migration.
 */

export interface QueuePause {
    paused: boolean;
    since: Date | null;
    /** Die pseudonyme `person.id`, wenn eine Person pausiert hat. */
    by: string | null;
    /** `cli:<Systembenutzer>`, wenn die Kommandozeile pausiert hat. */
    byLabel: string | null;
    reason: string | null;
}

export const QUEUE_RUNNING: QueuePause = { paused: false, since: null, by: null, byLabel: null, reason: null };

/** Liest die Pause; wirft nie (ein Fehler heißt „nicht pausiert“, siehe Fehlerrichtung oben). */
export async function readQueuePause(db: Queryable): Promise<QueuePause> {
    try {
        const [row] = await db<
            {
                queue_paused: boolean;
                queue_paused_since: Date | null;
                queue_paused_by: string | null;
                queue_paused_by_label: string | null;
                queue_paused_reason: string | null;
            }[]
        >`
            SELECT queue_paused, queue_paused_since, queue_paused_by, queue_paused_by_label, queue_paused_reason
              FROM system_state
             WHERE id = 1
        `;
        if (row === undefined || !row.queue_paused) return QUEUE_RUNNING;
        return {
            paused: true,
            since: row.queue_paused_since,
            by: row.queue_paused_by,
            byLabel: row.queue_paused_by_label,
            reason: row.queue_paused_reason,
        };
    } catch {
        // Fehlt die Tabelle (ein Worker vor `migrate`, `42P01`) oder die Spalte (ein Worker vor 0130, `42703`), ist nichts
        // pausiert — und jeder andere Fehler zählt genauso, weil die Pause nichts schützt. Ein echter Lesefehler fällt im selben
        // Takt ohnehin an der Abfrage der Warteschlange auf, die ihn nicht schluckt.
        return QUEUE_RUNNING;
    }
}

/**
 * Die Pause für die Statusseite (WI-0160): „pausiert seit … von … · Grund“. Der Name der Person wird nachgeschlagen; die pseudonyme
 * `person.id` geht nie hinaus (JOBS-0001 4.1: keine Rohschlüssel auf der Seite), und lässt sich der Name nicht lesen, bleibt `by`
 * leer. In der eigenen Sicht eines Editors entfällt der Grund — er kann Personenbezug tragen, wie der Grund einer Sperre.
 */
export async function queuePauseView(
    db: Queryable,
    pause: QueuePause,
    options: { full: boolean },
): Promise<QueuePauseView> {
    if (!pause.paused) return { paused: false, since: null, by: null, reason: null };
    const since = pause.since?.toISOString() ?? null;
    const reason = options.full ? pause.reason : null;
    if (!options.full) return { paused: true, since, by: null, reason };
    if (pause.by === null) return { paused: true, since, by: pause.byLabel, reason };
    try {
        const [person] = await db<{ display_name: string }[]>`
            SELECT display_name FROM avesmaps_auth.person WHERE id = ${pause.by}::uuid
        `;
        return { paused: true, since, by: person?.display_name ?? null, reason };
    } catch {
        return { paused: true, since, by: null, reason };
    }
}
