import {
    EDITOR_LOCK_REQUEST_KEEP_MINUTES,
    EDITOR_LOCK_REQUEST_MINUTES,
    EDITOR_LOCK_TIMEOUT_MINUTES,
    type EditorLockIncoming,
    type EditorLockKind,
    type EditorLockRequest,
    type EditorLockRequestAnswer,
    type EditorLockRequestState,
    type EditorLockTarget,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Bitte um Freigabe einer Sperre (WI-0262, OPS-000059; Tafel `editor_lock_request`, Migration 0253; Vertrag
 * `packages/shared/src/editor-lock.ts`). Die Sperre selbst bleibt in `editor-lock.ts`; hier steht nur, was eine Bitte ausmacht.
 *
 * - **Bitten:** Das Objekt muss gerade gesperrt sein (Herzschlag in den letzten 15 Minuten), von einem anderen Lauf. Die Bitte merkt
 *   sich den Halter (Person und Lauf) und läuft nach 5 Minuten ab. Je Person und Objekt höchstens eine OFFENE (Teilindex); eine
 *   neue geht erst nach Antwort oder Ablauf. Das Bitten räumt abgelaufene und alte Zeilen selbst weg, wie das Nehmen der Sperre.
 * - **Antworten** darf nur der Halter, den die Bitte meint: Lauf UND Person müssen stimmen. „Freigegeben“ gibt die Sperre dieses
 *   Laufs in derselben Anweisung frei; war sie schon frei (der Browser des Halters hat sie nach dem Speichern abgegeben), bleibt es
 *   dabei. Dieselbe Antwort ein zweites Mal ist kein Fehler.
 * - **Lesen:** der Halter über seinen Herzschlag (`incomingEditorLockRequests`), der Bittende über die Liste der Sperren
 *   (`ownEditorLockRequests`). Der Stand für den Bittenden wird beim Lesen aus der Zeile und der Sperre gerechnet: offen, solange
 *   der Halter sie hält; `released`, sobald sie weg ist; `expired`, wenn sie abgelaufen ist oder inzwischen ein anderer Lauf hält.
 */

interface RequestRow {
    id: string;
    object_kind: EditorLockKind;
    object_id: string;
    state: EditorLockRequestState;
    created_at: Date;
    expires_at: Date;
}

const requestOf = (row: RequestRow): EditorLockRequest => ({
    requestId: row.id,
    kind: row.object_kind,
    id: row.object_id,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
});

export interface AskInput {
    kind: EditorLockKind;
    id: string;
    /** Der Lauf des Bittenden. */
    run: string;
    personId: string;
    personName: string;
}

export type AskResult =
    | { art: "gestellt"; request: EditorLockRequest }
    /** Das Objekt ist gar nicht (mehr) gesperrt: Bitten ist unnötig, nehmen geht. */
    | { art: "nicht_gesperrt" }
    /** Die Sperre hält der bittende Lauf selbst. */
    | { art: "eigene_sperre" }
    /** Es gibt schon eine offene Bitte dieser Person an dieselbe Sperre. */
    | { art: "offen"; request: EditorLockRequest };

export async function askEditorLockRelease(db: Queryable, input: AskInput): Promise<AskResult> {
    // Aufräumen wie beim Nehmen der Sperre: alte Zeilen weg (über den Index, billig).
    await db`DELETE FROM editor_lock_request WHERE created_at < now() - interval '1 day'`;
    // Eine offene Bitte, die abgelaufen ist oder einem früheren Halter galt, ist erledigt und blockiert keine neue.
    await db`
        UPDATE editor_lock_request r
           SET state = 'expired'
         WHERE r.state = 'open'
           AND r.object_kind = ${input.kind} AND r.object_id = ${input.id} AND r.requester_person_id = ${input.personId}
           AND (r.expires_at <= now()
                OR NOT EXISTS (
                     SELECT 1 FROM editor_lock l
                      WHERE l.object_kind = r.object_kind AND l.object_id = r.object_id AND l.run_id = r.holder_run
                        AND l.heartbeat_at >= now() - make_interval(mins => ${EDITOR_LOCK_TIMEOUT_MINUTES})))
    `;
    // EINE Anweisung: Die Bitte entsteht nur, wenn die Sperre jetzt gilt und ein anderer Lauf sie hält; der Teilindex lässt keine zweite
    // offene Bitte derselben Person zu (`DO NOTHING`, zwei zugleich: genau eine).
    const [neu] = await db<RequestRow[]>`
        INSERT INTO editor_lock_request
               (object_kind, object_id, requester_person_id, requester_name, requester_run, holder_person_id, holder_run, expires_at)
        SELECT l.object_kind, l.object_id, ${input.personId}, ${input.personName}, ${input.run}, l.person_id, l.run_id,
               now() + make_interval(mins => ${EDITOR_LOCK_REQUEST_MINUTES})
          FROM editor_lock l
         WHERE l.object_kind = ${input.kind} AND l.object_id = ${input.id}
           AND l.heartbeat_at >= now() - make_interval(mins => ${EDITOR_LOCK_TIMEOUT_MINUTES})
           AND l.run_id <> ${input.run}
        ON CONFLICT (object_kind, object_id, requester_person_id) WHERE state = 'open' DO NOTHING
        RETURNING id, object_kind, object_id, state, created_at, expires_at
    `;
    if (neu) return { art: "gestellt", request: requestOf(neu) };
    // Nichts eingefügt: warum? Zuerst die Sperre, dann die offene Bitte.
    const [halter] = await db<{ run_id: string }[]>`
        SELECT run_id FROM editor_lock
         WHERE object_kind = ${input.kind} AND object_id = ${input.id}
           AND heartbeat_at >= now() - make_interval(mins => ${EDITOR_LOCK_TIMEOUT_MINUTES})
    `;
    if (halter === undefined) return { art: "nicht_gesperrt" };
    if (halter.run_id === input.run) return { art: "eigene_sperre" };
    const [offene] = await db<RequestRow[]>`
        SELECT id, object_kind, object_id, state, created_at, expires_at
          FROM editor_lock_request
         WHERE object_kind = ${input.kind} AND object_id = ${input.id} AND requester_person_id = ${input.personId} AND state = 'open'
    `;
    if (offene) return { art: "offen", request: requestOf(offene) };
    // Die Sperre fiel zwischen den Abfragen: wie „nicht gesperrt“.
    return { art: "nicht_gesperrt" };
}

/** Die offenen Bitten an die Sperren dieses Laufs, die älteste zuerst (für die Antwort des Herzschlags). */
export async function incomingEditorLockRequests(db: Queryable, run: string): Promise<EditorLockIncoming[]> {
    const rows = await db<(RequestRow & { requester_person_id: string; requester_name: string })[]>`
        SELECT r.id, r.object_kind, r.object_id, r.state, r.created_at, r.expires_at, r.requester_person_id, r.requester_name
          FROM editor_lock_request r
          JOIN editor_lock l ON l.object_kind = r.object_kind AND l.object_id = r.object_id AND l.run_id = r.holder_run
         WHERE r.holder_run = ${run} AND r.state = 'open' AND r.expires_at > now()
         ORDER BY r.created_at, r.id
    `;
    return rows.map((row) => ({
        requestId: row.id,
        kind: row.object_kind,
        id: row.object_id,
        from: { id: row.requester_person_id, name: row.requester_name },
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
    }));
}

/**
 * Die Bitten dieser Person an Objekte einer Art, die noch offen sind oder deren Antwort oder Ablauf höchstens
 * `EDITOR_LOCK_REQUEST_KEEP_MINUTES` zurückliegt; die jüngste zuerst. Der Stand ist der, den der Bittende sieht (siehe oben).
 */
export async function ownEditorLockRequests(
    db: Queryable,
    personId: string,
    kind: EditorLockKind,
): Promise<EditorLockRequest[]> {
    const rows = await db<RequestRow[]>`
        SELECT r.id, r.object_kind, r.object_id, r.created_at, r.expires_at,
               CASE
                 WHEN r.state <> 'open' THEN r.state
                 WHEN r.expires_at <= now() THEN 'expired'
                 WHEN l.run_id = r.holder_run AND l.heartbeat_at >= now() - make_interval(mins => ${EDITOR_LOCK_TIMEOUT_MINUTES}) THEN 'open'
                 WHEN l.run_id IS NULL OR l.heartbeat_at < now() - make_interval(mins => ${EDITOR_LOCK_TIMEOUT_MINUTES}) THEN 'released'
                 ELSE 'expired'
               END AS state
          FROM editor_lock_request r
          LEFT JOIN editor_lock l ON l.object_kind = r.object_kind AND l.object_id = r.object_id
         WHERE r.requester_person_id = ${personId} AND r.object_kind = ${kind}
           AND COALESCE(r.answered_at, r.expires_at) >= now() - make_interval(mins => ${EDITOR_LOCK_REQUEST_KEEP_MINUTES})
         ORDER BY r.created_at DESC, r.id
    `;
    return rows.map(requestOf);
}

export interface AnswerInput {
    requestId: string;
    /** Der Lauf des Antwortenden. */
    run: string;
    personId: string;
    answer: EditorLockRequestAnswer;
}

export type AnswerResult = "ok" | "unbekannt" | "nicht_halter" | "geschlossen";

/**
 * Antwortet auf eine Bitte. Nur der Halter, den sie meint (Lauf UND Person), und nur auf eine offene, nicht abgelaufene. „Freigegeben“
 * gibt die Sperre dieses Laufs in derselben Anweisung frei.
 */
export async function answerEditorLockRequest(db: Queryable, input: AnswerInput): Promise<AnswerResult> {
    const [row] = await db<
        { holder_run: string; holder_person_id: string; state: EditorLockRequestState; expires_at: Date }[]
    >`
        SELECT holder_run, holder_person_id, state, expires_at FROM editor_lock_request WHERE id = ${input.requestId}
    `;
    if (row === undefined) return "unbekannt";
    // Ein fremder Lauf erfährt nicht mehr als „nicht der Halter“; ob die Bitte offen ist, sagt ihm niemand.
    if (row.holder_run !== input.run || row.holder_person_id !== input.personId) return "nicht_halter";
    // Dieselbe Antwort noch einmal (der Browser gab nach dem Speichern schon frei und der Server markierte es): kein Fehler.
    if (row.state === input.answer) return "ok";
    const [gesetzt] = await db<{ object_kind: EditorLockKind; object_id: string }[]>`
        WITH beantwortet AS (
            UPDATE editor_lock_request
               SET state = ${input.answer}, answered_at = now()
             WHERE id = ${input.requestId} AND state = 'open' AND expires_at > now()
               AND holder_run = ${input.run} AND holder_person_id = ${input.personId}
            RETURNING object_kind, object_id, holder_run
        ), frei AS (
            DELETE FROM editor_lock l
             USING beantwortet b
             WHERE ${input.answer}::text = 'released'
               AND l.object_kind = b.object_kind AND l.object_id = b.object_id AND l.run_id = b.holder_run
            RETURNING 1
        )
        SELECT object_kind, object_id FROM beantwortet
    `;
    return gesetzt === undefined ? "geschlossen" : "ok";
}

/**
 * Das Ende einer Sperre durch ihren Halter oder einen Admin: Offene Bitten an sie gelten als freigegeben, damit der Bittende es sofort
 * liest und eine spätere Sperre desselben Laufs keine alte Bitte wiederbelebt.
 */
export async function closeEditorLockRequests(
    db: Queryable,
    target: EditorLockTarget,
    holderRun: string | undefined,
): Promise<void> {
    await db`
        UPDATE editor_lock_request
           SET state = 'released', answered_at = now()
         WHERE object_kind = ${target.kind} AND object_id = ${target.id} AND state = 'open'
           AND (${holderRun ?? null}::uuid IS NULL OR holder_run = ${holderRun ?? null}::uuid)
    `;
}
