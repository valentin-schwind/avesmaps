import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { AdminKartenserien, KARTENSERIEN_URL, KartenserieBody, OperationReceipt } from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession, editConflict } from "../auth/admin-guard.ts";
import { protect, protectEines } from "../auth/plugin.ts";
import { ApiError } from "../http/api-error.ts";
import { handleKartenserie } from "../map-series/schreiben.ts";
import { kartenserienModell } from "../map-series/modell.ts";
import { assertWritable } from "../system/write-guard.ts";

/**
 * Der Reiter „Kartenserien“ (WI-0220 Schnitt 2; Vorlage Fassung 4, Betreiber 2026-10-18: „passt! … fertig bauen“):
 *
 *     GET  /api/admin/system/kartenserien   die Serien, ihre Sichtbarkeit, Vorgabe, Fassung, Papierkorb       view_operations (V)
 *     POST /api/admin/system/kartenserien   { operationId, baseRevision, id, aktion }       manage_map_series + Passkey (S)
 *
 * - Eine Handlung je Aufruf, genau ein Ereignis `system.map_series_changed` (`series`, `aktion`, `from`, `to`) in derselben
 *   Transaktion (Protokollpflicht, SYS-0001 §9d.2). Die Regeln stehen in `map-series/schreiben.ts`.
 * - **Schreibklasse `system`:** Eine Kartenserie zu ändern ist eine Einstellung, kein Sicherheitshandgriff; unter Systemsperre 423.
 * - Auf Production gilt dieselbe Route; dort ändern nur die Betreiber (das Sonderrecht teilt der Betreiber zu). Der Weg „von Stage
 *   übernehmen“ ist Schnitt 4.
 */
const EVENT = "system.map_series_changed" as const;
const target = (id: string) => `map:series:${id}`;

export const adminMapSeriesRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        KARTENSERIEN_URL,
        {
            ...protectEines(["view_operations", "manage_map_series"]),
            schema: { response: { 200: AdminKartenserien, ...ADMIN_ERRORS } },
        },
        async (request) => {
            await adminSession(request);
            return kartenserienModell(app.database!, { tileRoot: app.config.tileRoot, now: new Date() });
        },
    );

    app.post(
        KARTENSERIEN_URL,
        {
            ...protect("manage_map_series", { confirm: "passkey", writeClass: "system" }),
            schema: { body: KartenserieBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, baseRevision, id, aktion } = request.body;
            // Vorlage Fassung 4, Weg nach Production „A von Stage übernehmen“: Auf Production ändert dieser Reiter nichts.
            if (session.environment === "production") {
                throw new ApiError(
                    409,
                    "kartenserien_production",
                    "Auf Production kommt eine Kartenserie über die Übernahme von Stage, ausgelöst von den Betreibern.",
                );
            }
            await assertWritable(request, "system");
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "kartenserie", id, aktion, baseRevision } },
                async (tx) => {
                    const result = await handleKartenserie(tx, {
                        id,
                        aktion,
                        baseRevision,
                        actor: { personId: session.personId, label: session.displayName },
                        tileRoot: app.config.tileRoot,
                        conflict: (current) =>
                            editConflict(app.database!, {
                                currentRevision: current.revision,
                                changedAt: current.changedAt,
                                targetRef: target(id),
                                actions: [EVENT],
                            }),
                    });
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: EVENT,
                            targetRef: target(id),
                            details: { series: id, aktion: aktion.art, from: result.from, to: result.to },
                        },
                    };
                },
            );
        },
    );
};
