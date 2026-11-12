import { cleanResponsibility, RESPONSIBILITY_MAX, type OperationReceipt } from "@avesmaps3d/shared";
import { ApiError } from "../http/api-error.ts";
import { editConflict } from "./admin-guard.ts";
import type { AuditAction, AuditEvent } from "./audit.ts";
import type { Sql } from "./session-store.ts";

/**
 * „Verantwortlich für:“ (WI-0133, Betreiber 2026-10-10): ein freiwilliger Freitext an der Person. Zwei Wege schreiben ihn, beide
 * hierüber: die Person selbst (`routes/account.ts`, nur Sitzung) und ein Betreiber an jeder Person (`routes/admin-people.ts`,
 * `set_responsibility`, Stufe V).
 *
 * - Eine Zeile, höchstens `RESPONSIBILITY_MAX` Zeichen, leer heißt `NULL` (`cleanResponsibility` in packages/shared; dieselbe Regel
 *   als CHECK in Migration 0097). Ein Zeilenumbruch oder eine Überlänge ist 400 `responsibility_invalid`, kein stilles Kürzen.
 * - Revision der Person (Migration 0097 zählt die Spalte mit): Wer auf einem älteren Stand schreibt, bekommt 409 `edit_conflict`.
 * - 🔴 Genau ein Protokolleintrag `person.responsibility_changed` je Änderung, in derselben Transaktion (`runOperation`), mit
 *   `via` (`self` oder `operator`) und `cleared`, aber **nie mit dem Text** (Datensparsamkeit; beim Auflösen bliebe er sonst stehen).
 */

/** Die Handlungen, nach denen ein Konflikt an der Person fragt, wer zuletzt geändert hat. */
export const PERSON_REVISION_ACTIONS: readonly AuditAction[] = [
    "person.renamed",
    "person.locked",
    "person.unlocked",
    "person.responsibility_changed",
];

/** Der bereinigte Text, `null` für leer; sonst 400 `responsibility_invalid` mit dem Grund. */
export function parseResponsibility(raw: string): string | null {
    const result = cleanResponsibility(raw);
    if (result.ok) return result.value;
    throw new ApiError(
        400,
        "responsibility_invalid",
        result.problem === "line"
            ? "„Verantwortlich für“ ist eine Zeile, ohne Zeilenumbruch und Steuerzeichen."
            : `„Verantwortlich für“ hat höchstens ${String(RESPONSIBILITY_MAX)} Zeichen.`,
        { problem: result.problem, max: RESPONSIBILITY_MAX },
    );
}

export interface ResponsibilityChange {
    personId: string;
    value: string | null;
    baseRevision: number;
    /** `self`: die Person an sich selbst; `operator`: ein Betreiber an einer anderen. */
    via: "self" | "operator";
    /** Handelnde, Sitzung, Gerät: `actorFields(...)`. */
    actor: Omit<AuditEvent, "action" | "targetPersonId" | "details">;
}

/** Setzt den Text in der laufenden Transaktion; gibt Quittung und Protokolleintrag für `runOperation` zurück. */
export async function changeResponsibility(
    tx: Sql,
    change: ResponsibilityChange,
): Promise<{ receipt: Omit<OperationReceipt, "operationId" | "status">; event: AuditEvent }> {
    const [person] = await tx<{ responsible_for: string | null; status: string; revision: number; updated_at: Date }[]>`
        SELECT responsible_for, status, revision::int AS revision, updated_at FROM avesmaps_auth.person
         WHERE id = ${change.personId} FOR UPDATE
    `;
    if (person === undefined) throw new ApiError(404, "not_found", "Diese Person gibt es hier nicht.");
    if (person.status === "departed") throw new ApiError(409, "account_inactive", "Dieses Konto ist aufgelöst.");
    if (person.revision !== change.baseRevision) {
        throw await editConflict(tx, {
            currentRevision: person.revision,
            changedAt: person.updated_at,
            targetPersonId: change.personId,
            actions: PERSON_REVISION_ACTIONS,
        });
    }
    if (person.responsible_for === change.value) {
        throw new ApiError(409, "no_change", "„Verantwortlich für“ steht schon so da.");
    }
    const [updated] = await tx<{ revision: number }[]>`
        UPDATE avesmaps_auth.person SET responsible_for = ${change.value} WHERE id = ${change.personId}
        RETURNING revision::int AS revision
    `;
    return {
        receipt: {
            environment: change.actor.environment,
            affected: [{ kind: "person", id: change.personId, revision: updated!.revision }],
            derivedWork: [],
            warnings: [],
        },
        event: {
            ...change.actor,
            action: "person.responsibility_changed",
            targetPersonId: change.personId,
            details: { via: change.via, cleared: change.value === null },
        },
    };
}
