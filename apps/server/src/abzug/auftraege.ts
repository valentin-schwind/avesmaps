import { ABZUG_JOB_ART, type AbgleichAuftrag, type AbgleichLauf } from "@avesmaps3d/shared";
import { auftrag, lauf, type JobRow } from "../abgleiche/lesen.ts";
import type { Queryable } from "../database.ts";
import { KEIN_UMSTAND, type Warteumstand } from "../jobs/wartegrund.ts";
import { isMissingTable } from "../system/state-row.ts";

/**
 * Der Auftrag „Abzug für lokal erstellen“ auf Stage und Production (WI-0251): der wartende oder laufende und der letzte fertige, mit denselben
 * Feldern und demselben Wartegrund wie die Zeilen der Abgleiche (`abgleiche/lesen.ts`), damit die Oberfläche sie gleich liest.
 */
async function zeilen(db: Queryable, aktiv: boolean): Promise<JobRow[]> {
    return await db<JobRow[]>`
        SELECT j.public_id::text AS public_id, j.kind, j.state, j.phase, j.progress::float8 AS progress, j.wait_reason, j.queued_at,
               j.started_at, j.finished_at, j.error_summary, j.result, j.label, j.actor_ref, p.display_name
          FROM job j
          LEFT JOIN avesmaps_auth.person p ON p.id::text = j.actor_ref
         WHERE j.kind = ${ABZUG_JOB_ART}
           AND ${aktiv ? db`j.state IN ('QUEUED', 'RUNNING')` : db`j.finished_at IS NOT NULL`}
         ORDER BY ${aktiv ? db`(j.state = 'RUNNING') DESC, j.queued_at` : db`j.finished_at`} DESC, j.id DESC
         LIMIT 1
    `;
}

export async function leseAbzugAuftraege(
    db: Queryable,
    umstand: Warteumstand = KEIN_UMSTAND,
): Promise<{ laufend: AbgleichAuftrag | null; letzter: AbgleichLauf | null }> {
    try {
        const [[fertig], [aktiv]] = await Promise.all([zeilen(db, false), zeilen(db, true)]);
        return {
            laufend: aktiv === undefined ? null : auftrag(aktiv, umstand),
            letzter: fertig === undefined ? null : lauf(fertig),
        };
    } catch (error) {
        if (!isMissingTable(error)) throw error;
        return { laufend: null, letzter: null };
    }
}
