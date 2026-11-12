import {
    CAPABILITIES,
    GRANT_MIN_ROLE,
    ROLES,
    capabilitiesFor,
    roleRank,
    type CapabilitySpec,
    type OperationReceipt,
    type SystemLock,
    type SystemMode,
} from "@avesmaps3d/shared";
import { editConflict } from "../auth/admin-guard.ts";
import type { AuthEnvironment } from "../auth/config.ts";
import type { Sql } from "../auth/session-store.ts";
import { ApiError } from "../http/api-error.ts";
import { readStateRow, type SystemStateRow } from "./state-row.ts";

/**
 * Umschalten des Betriebszustands (WI-0127 SYS-2, SYS-0001 §4.5): EINE Stelle für die Verwaltung (`routes/admin-system.ts`) und die
 * Kommandozeile (`system-cli.ts`). Läuft in der Transaktion des Aufrufers, unter der Verwaltungssperre der Umgebung
 * (`lockAdministration`); die Zeile wird mit `FOR UPDATE` gelesen und gegen `baseRevision` geprüft. Den Protokolleintrag schreibt der
 * Aufrufer in derselben Transaktion, genau einen je Änderung.
 *
 * Schutzregeln beim Einschränken (E5 A, Blatt A4):
 * 1. Wer einschränkt, hat selbst `access_restricted_mode`, sonst 409 `would_lock_out_self`. Die Kommandozeile prüft das nicht: root
 *    ist der Ausweis, und `betrieb-normal` ist ihr Rückweg.
 * 2. Mindestens eine aktive Person mit dem Zugangsrecht UND einem Passkey in dieser Umgebung, sonst 409
 *    `no_restricted_access_holder`; an der Kommandozeile nur eine Warnung.
 */

/** Der Verweis der Protokolleinträge (`target_ref`): Woran gehandelt wurde, ist der Betriebszustand dieser Umgebung. */
export const SYSTEM_STATE_REF = "system_state";

/** Die Handlungen am Betriebszustand; `editConflict` sucht darunter, wer zuletzt geschaltet hat. */
const STATE_ACTIONS = ["system.mode_changed", "system.lock_changed", "system.queue_changed"] as const;

export type SystemActor = { kind: "person"; personId: string } | { kind: "cli"; label: string };

type Warning = OperationReceipt["warnings"][number];

export interface StateChange<T> {
    from: T;
    to: T;
    /** Die neue Revision der Zeile. */
    revision: number;
    /** Der Grund ohne Ränder, `null` ohne Grund; so steht er in der Zeile und im Protokoll. */
    reason: string | null;
    warnings: Warning[];
}

export interface RestrictedAccessHolderRow {
    id: string;
    displayName: string;
    hasPasskey: boolean;
}

const RESTRICTED = "access_restricted_mode";

/**
 * Wer im eingeschränkten Betrieb hineinkommt: aktive Personen mit Zugang in dieser Umgebung, die `access_restricted_mode` aus ihrer
 * Rolle oder als zugeteiltes Sonderrecht haben. Welche Rollen das sind, sagt der Katalog (AUTH-0001 §8: keine Rollenprüfung im Code).
 */
export async function restrictedAccessHolders(
    sql: Sql,
    environment: AuthEnvironment,
): Promise<RestrictedAccessHolderRow[]> {
    const byRole = ROLES.filter((role) => capabilitiesFor(role).has(RESTRICTED));
    const grantable = (CAPABILITIES[RESTRICTED] as CapabilitySpec).grantable === true;
    const byGrant = grantable ? ROLES.filter((role) => roleRank(role) >= roleRank(GRANT_MIN_ROLE)) : [];
    const rows = await sql<{ id: string; display_name: string; has_passkey: boolean }[]>`
        SELECT p.id, p.display_name,
               EXISTS (SELECT 1 FROM avesmaps_auth.passkey_credential k
                        WHERE k.person_id = p.id AND k.environment = ${environment} AND k.revoked_at IS NULL) AS has_passkey
          FROM avesmaps_auth.person p
          JOIN avesmaps_auth.person_access a ON a.person_id = p.id AND a.environment = ${environment} AND a.status = 'active'
         WHERE p.status = 'active'
           AND (a.role = ANY(${byRole}::text[])
                OR (a.role = ANY(${byGrant}::text[])
                    AND EXISTS (SELECT 1 FROM avesmaps_auth.capability_grant g
                                 WHERE g.person_id = p.id AND g.environment = ${environment}
                                   AND g.capability = ${RESTRICTED} AND g.revoked_at IS NULL)))
         ORDER BY lower(p.display_name), p.id
    `;
    return rows.map((row) => ({ id: row.id, displayName: row.display_name, hasPasskey: row.has_passkey }));
}

/** Die gesperrte Zeile; fehlt sie, ist der Zustand unbekannt, und geschaltet wird nichts. */
async function lockedRow(tx: Sql): Promise<SystemStateRow> {
    const row = await readStateRow(tx, { forUpdate: true });
    if (row === undefined) {
        throw new ApiError(503, "system_state_unknown", "Der Betriebszustand ist gerade nicht bekannt.");
    }
    return row;
}

async function checkRevision(tx: Sql, row: SystemStateRow, baseRevision: number | undefined): Promise<void> {
    if (baseRevision === undefined || baseRevision === row.revision) return;
    throw await editConflict(tx, {
        currentRevision: row.revision,
        changedAt: row.updatedAt,
        targetRef: SYSTEM_STATE_REF,
        actions: STATE_ACTIONS,
    });
}

function cleanReason(reason: string | undefined): string | null {
    const trimmed = reason?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
}

function setterOf(actor: SystemActor): { by: string | null; byLabel: string | null } {
    return actor.kind === "person" ? { by: actor.personId, byLabel: null } : { by: null, byLabel: actor.label };
}

export interface ModeInput {
    environment: AuthEnvironment;
    mode: SystemMode;
    reason?: string | undefined;
    /** `undefined` nur an der Kommandozeile: root schaltet immer auf den aktuellen Stand. */
    baseRevision?: number | undefined;
    actor: SystemActor;
}

export async function changeMode(tx: Sql, input: ModeInput): Promise<StateChange<SystemMode>> {
    const row = await lockedRow(tx);
    await checkRevision(tx, row, input.baseRevision);
    const reason = cleanReason(input.reason);
    if (row.mode === input.mode) {
        throw new ApiError(409, "no_change", "Der Betrieb steht schon so.", { currentRevision: row.revision });
    }
    const warnings: Warning[] = [];
    if (input.mode === "restricted") {
        if (reason === null) throw new ApiError(400, "reason_required", "Der Grund fehlt.");
        const holders = await restrictedAccessHolders(tx, input.environment);
        const actor = input.actor;
        if (actor.kind === "person" && !holders.some((holder) => holder.id === actor.personId)) {
            throw new ApiError(
                409,
                "would_lock_out_self",
                "Wer den Betrieb einschränkt, muss selbst im eingeschränkten Betrieb hineinkommen.",
            );
        }
        if (!holders.some((holder) => holder.hasPasskey)) {
            const message =
                "Niemand mit dem Zugangsrecht hat in dieser Umgebung einen Passkey; im eingeschränkten Betrieb käme niemand hinein.";
            if (input.actor.kind === "person") throw new ApiError(409, "no_restricted_access_holder", message);
            warnings.push({ code: "no_restricted_access_holder", message });
        }
    }
    const { by, byLabel } = setterOf(input.actor);
    const [updated] = await tx<{ revision: number }[]>`
        UPDATE system_state
           SET mode = ${input.mode}, mode_since = now(), mode_by = ${by}, mode_by_label = ${byLabel}, mode_reason = ${reason}
         WHERE id = 1
        RETURNING revision::int AS revision
    `;
    return { from: row.mode, to: input.mode, revision: updated!.revision, warnings, reason };
}

export interface LockInput {
    environment: AuthEnvironment;
    lock: SystemLock;
    locked: boolean;
    reason?: string | undefined;
    baseRevision?: number | undefined;
    actor: SystemActor;
}

/** Ob eine Sperre gerade gesetzt ist. */
export function isLocked(row: SystemStateRow, lock: SystemLock): boolean {
    return lock === "map" ? row.mapLock : row.systemLock;
}

export async function changeLock(tx: Sql, input: LockInput): Promise<StateChange<boolean>> {
    const row = await lockedRow(tx);
    await checkRevision(tx, row, input.baseRevision);
    const reason = cleanReason(input.reason);
    const from = isLocked(row, input.lock);
    if (from === input.locked) {
        throw new ApiError(409, "no_change", "Die Sperre steht schon so.", { currentRevision: row.revision });
    }
    if (input.locked && reason === null) throw new ApiError(400, "reason_required", "Der Grund fehlt.");
    const { by, byLabel } = setterOf(input.actor);
    // Zwei Anweisungen statt eines zusammengesetzten Spaltennamens: kein Bezeichner aus einer Eingabe.
    const [updated] =
        input.lock === "map"
            ? await tx<{ revision: number }[]>`
                UPDATE system_state
                   SET map_lock = ${input.locked}, map_lock_since = now(), map_lock_by = ${by}, map_lock_by_label = ${byLabel},
                       map_lock_reason = ${reason}
                 WHERE id = 1
                RETURNING revision::int AS revision
            `
            : await tx<{ revision: number }[]>`
                UPDATE system_state
                   SET system_lock = ${input.locked}, system_lock_since = now(), system_lock_by = ${by},
                       system_lock_by_label = ${byLabel}, system_lock_reason = ${reason}
                 WHERE id = 1
                RETURNING revision::int AS revision
            `;
    return { from, to: input.locked, revision: updated!.revision, warnings: [], reason };
}

export interface QueuePauseInput {
    paused: boolean;
    reason?: string | undefined;
    baseRevision?: number | undefined;
    actor: SystemActor;
    /**
     * Die WIRKSAME Pause aus dem frischen Stand des Dirigenten (WI-0163): die jüngste Anweisung über alle Umgebungen. Ohne sie (keine
     * Stand-Datei, Stand unbekannt oder veraltet) vergleicht der Wunsch mit der eigenen Zeile wie bis WI-0163.
     */
    wirksam?: { paused: boolean } | undefined;
}

/**
 * Die Warteschlange pausieren oder fortsetzen (WI-0160, Claudios Entwurf §5): dieselbe Form wie eine Sperre — Pausieren mit Grund,
 * Fortsetzen ohne Pflicht, unter der Verwaltungssperre, gegen `baseRevision`, genau ein Protokolleintrag beim Aufrufer.
 *
 * 🔴 Keine Schutzregel wie beim Einschränken. Eine Pause sperrt niemanden aus: Wer pausiert hat, kann jederzeit fortsetzen, und der
 * Rückweg über die Kommandozeile (`warteschlange-fort`) steht ohne Sitzung offen. Was eine Pause anhält, ist das ÜBERNEHMEN neuer
 * Aufträge; laufende laufen zu Ende, und das Einreihen bleibt offen.
 *
 * 🔴 **Ein Schalter für alle Umgebungen** (WI-0163 §1.6): Gespeichert wird je Umgebung die letzte Anweisung, wirksam ist die jüngste
 * über alle. Deshalb trägt jede Anweisung ihren Zeitpunkt (`queue_changed_at`), und verglichen wird der Wunsch mit der WIRKSAMEN Pause
 * (`wirksam`), nicht mit der eigenen Zeile: 409 `no_change` nur, wenn der Wunsch schon wirkt. Trägt die eigene Zeile den Wunschwert
 * schon, wirkt aber eine jüngere Anweisung einer anderen Umgebung, wird die eigene Zeile trotzdem neu geschrieben (neue Revision,
 * neuer Zeitpunkt): Erst dann ist sie die jüngste, und wer zuletzt drückt, entscheidet.
 */
export async function changeQueuePause(tx: Sql, input: QueuePauseInput): Promise<StateChange<boolean>> {
    const row = await lockedRow(tx);
    await checkRevision(tx, row, input.baseRevision);
    const reason = cleanReason(input.reason);
    const vorher = input.wirksam?.paused ?? row.queuePaused;
    if (vorher === input.paused) {
        throw new ApiError(409, "no_change", "Die Warteschlange steht schon so.", { currentRevision: row.revision });
    }
    if (input.paused && reason === null) throw new ApiError(400, "reason_required", "Der Grund fehlt.");
    const { by, byLabel } = setterOf(input.actor);
    const [updated] = await tx<{ revision: number }[]>`
        UPDATE system_state
           SET queue_paused = ${input.paused}, queue_paused_since = now(), queue_paused_by = ${by},
               queue_paused_by_label = ${byLabel}, queue_paused_reason = ${reason}, queue_changed_at = now()
         WHERE id = 1
        RETURNING revision::int AS revision
    `;
    return { from: vorher, to: input.paused, revision: updated!.revision, warnings: [], reason };
}
