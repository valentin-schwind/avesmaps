import { AVENTURIA, type OperationReceipt } from "@avesmaps3d/shared";
import { runOperation } from "../auth/operations.ts";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { DERIVE_LOCK_CLASS } from "../derive/derive-lock.ts";
import {
    MAP_OPERATION_STORE,
    mapImportRunning,
    mitSperrWiederholung,
    ruecknahmeZiele,
    type MapActor,
    type MapAuditEntry,
    type MapOperationEvent,
} from "../editor/map-operation.ts";

/**
 * Die Naht der Operationen im Fenster „Inhalte bearbeiten“ (WI-0254): dieselbe Speicherstelle wie jeder Editor der Karte
 * (`map_operation` und `map_audit_event`, ADR-0019 Nr. 3), dieselben Regeln von `runOperation` (höchstens einmal je Kennung, Hash,
 * Quittung) und dieselbe Sperre gegen den laufenden Zug (503 `map_import_running`, `editor/map-operation.ts`).
 *
 * 🔴 Was NICHT mitläuft: die Ableitungen und das Ereignis `map.changed` (`deriveAfter`). Eine Quelle ändert weder Linie noch Fläche noch
 * Gelände; ein Ereignis ließe jede offene Karte ihre Kacheln neu laden. Die Infopanels sehen die Änderung trotzdem: Die Leser-Revision
 * der Subjects folgt `max(map_operation.seq)` (`subjects/revision.ts`) und wechselt mit dem Eintrag dieser Operation.
 *
 * Auch die Rücknahme der Inhalte (WI-0265 B6g1; Quelle `restore`, `reverts` = die zurückgenommenen Operationen) läuft über diese Naht: Dieselben Regeln (Kennung, Hash, Quittung, Sperre gegen den
 * Zug), derselbe Verzicht auf Ableitung und Ereignis, und die Verknüpfungen zu den Originalen schreibt derselbe Speicher (`MAP_OPERATION_STORE`).
 */
export interface InhalteArbeit {
    receipt: Omit<OperationReceipt, "operationId" | "status" | "environment">;
    entries: MapAuditEntry[];
    /** Ein Satz für die Liste „Änderungen“ (`map_operation.summary`), etwa „Quelle „X“ geändert“. */
    summary?: string;
}

export function inhalteOperation(
    database: Database,
    actor: MapActor,
    input: {
        operationId: string;
        operation: string;
        body: unknown;
        source?: "editor" | "wikisync" | "restore";
        /** Die Operationen, die diese zurücknimmt (`map_operation_revert_link`, nur mit Quelle `restore`). */
        reverts?: readonly string[];
    },
    work: (tx: Sql) => Promise<InhalteArbeit>,
): Promise<OperationReceipt> {
    const mapDomainId = AVENTURIA.mapDomain;
    const reverts = ruecknahmeZiele({ body: input.body, reverts: input.reverts });
    return mitSperrWiederholung(() =>
        runOperation<MapOperationEvent>(
            database,
            {
                operationId: input.operationId,
                body: { operation: input.operation, mapDomainId, ...(input.body as object) },
            },
            async (tx) => {
                const { receipt, entries, summary } = await work(tx);
                return {
                    receipt: { ...receipt, environment: actor.environment },
                    event: {
                        operation: input.operation,
                        mapDomainId,
                        // Die Übernahme der Regelvorschläge (WI-0253 §24) ist eine Handlung des WikiSync, von einer Person ausgelöst; alles andere in diesem Fenster ist der Editor.
                        source: input.source ?? "editor",
                        actor,
                        entries,
                        reverts,
                        ...(summary === undefined ? {} : { summary }),
                    },
                };
            },
            {
                store: MAP_OPERATION_STORE,
                serialize: async (tx) => {
                    await tx`SELECT pg_advisory_xact_lock(hashtext(${`map_operation:${input.operationId}`}))`;
                    // Der Zug importiert gerade (exklusive Sperre der Domäne): nichts schreiben, später noch einmal.
                    const [frei] = await tx<{ ok: boolean }[]>`
                        SELECT pg_try_advisory_xact_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${mapDomainId})) AS ok
                    `;
                    if (frei?.ok !== true) throw mapImportRunning();
                },
            },
        ),
    );
}
