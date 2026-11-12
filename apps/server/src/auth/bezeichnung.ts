import type { Bezeichnung, OperationReceipt } from "@avesmaps3d/shared";
import { ApiError } from "../http/api-error.ts";
import type { AuditEvent } from "./audit.ts";
import type { Sql } from "./session-store.ts";

/**
 * Die Bezeichnung am Konto (WI-0279 E10): die Wortform der eigenen Rollen. Nur die Person selbst schreibt sie (`routes/account.ts`, nur
 * Sitzung), ohne Revision, denn die Spalte zählt nicht mit (Migration 0304).
 *
 * 🔴 Genau ein Protokolleintrag `person.bezeichnung_geaendert` je Änderung, **nie mit der Form**: Datensparsamkeit, beim Auflösen bliebe sie
 * sonst stehen, und `redact_person_events()` braucht keine Zeile dafür.
 */
export async function aendereBezeichnung(
    tx: Sql,
    change: {
        personId: string;
        bezeichnung: Bezeichnung;
        /** Handelnde, Sitzung, Gerät: `actorFields(...)`. */
        actor: Omit<AuditEvent, "action" | "targetPersonId" | "details">;
    },
): Promise<{ receipt: Omit<OperationReceipt, "operationId" | "status">; event: AuditEvent }> {
    const [person] = await tx<{ revision: number }[]>`
        UPDATE avesmaps_auth.person SET bezeichnung = ${change.bezeichnung}
         WHERE id = ${change.personId} AND bezeichnung IS DISTINCT FROM ${change.bezeichnung}
        RETURNING revision::int AS revision
    `;
    if (person === undefined) throw new ApiError(409, "no_change", "Die Bezeichnung steht schon so da.");
    return {
        receipt: {
            environment: change.actor.environment,
            affected: [{ kind: "person", id: change.personId, revision: person.revision }],
            derivedWork: [],
            warnings: [],
        },
        event: {
            ...change.actor,
            action: "person.bezeichnung_geaendert",
            targetPersonId: change.personId,
            details: {},
        },
    };
}
