import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    AVENTURIA_SERIES,
    KARTENSERIE_UEBERNAHME_ART,
    KARTENSERIEN_PRODUCTION_URL,
    KartenserieUebernahmeBody,
    OperationReceipt,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import { protectEines } from "../auth/plugin.ts";
import { ApiError } from "../http/api-error.ts";
import { KARTENSERIEN_SPERRE } from "../map-series/schreiben.ts";
import { uebernahmeEingabe } from "../map-series/uebernahme.ts";
import { assertWritable } from "../system/write-guard.ts";

/**
 * „Nach Production übernehmen“ (WI-0220 Schnitt 4; Vorlage Fassung 4, Weg A „von Stage übernehmen“, Betreiber 2026-10-18 abgenommen):
 *
 *     POST /api/admin/system/kartenserien/production   { operationId, id }   release_to_production + Passkey (S)
 *
 * - **Nur die Betreiber:** dasselbe Recht wie die Production-Freigabe. Die Route reiht in der Stage den Auftrag `map_series_production`
 *   ein, in derselben Transaktion wie ihr Ereignis `system.map_series_changed` (`aktion: "production"`). Ausgeführt wird er von
 *   Claudios Korridor (kopieren, `kartenserie-uebernehmen` auf Production, Proben); in der App hat er keinen Handler.
 * - Auf Production gibt es den Knopf nicht (409 `kartenserien_production`): Dort ändert der Reiter nichts.
 * - Schreibklasse `system`; der Auftrag fasst keine Kartendaten an (`p_scope_kind = 'tiles'`).
 */
const EVENT = "system.map_series_changed" as const;

export const adminMapSeriesProductionRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        KARTENSERIEN_PRODUCTION_URL,
        {
            ...protectEines(["release_to_production", "release_map_series"], {
                confirm: "passkey",
                writeClass: "system",
            }),
            schema: { body: KartenserieUebernahmeBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            if (session.environment === "production") {
                throw new ApiError(
                    409,
                    "kartenserien_production",
                    "Auf Production kommt eine Kartenserie über die Übernahme von Stage, ausgelöst von den Betreibern.",
                );
            }
            await assertWritable(request, "system");
            const { operationId, id } = request.body;
            return adminOperation(app.database!, session, { operationId, body: request.body }, async (tx) => {
                await tx`SELECT pg_advisory_xact_lock(hashtext(${KARTENSERIEN_SPERRE}))`;
                const eingabe = await uebernahmeEingabe(tx, { id, tileRoot: app.config.tileRoot });
                const [job] = await tx<{ public_id: string }[]>`
                    SELECT public_id::text AS public_id
                      FROM job_enqueue(${KARTENSERIE_UEBERNAHME_ART}, 1::smallint, ${AVENTURIA_SERIES.mapDomain},
                                       ${session.personId}, ${tx.json(eingabe as never)}, 50::smallint, NULL, 'tiles',
                                       '{}'::smallint[])
                `;
                return {
                    receipt: {
                        environment: session.environment,
                        affected: [{ kind: "map_series", id }],
                        derivedWork: [{ kind: KARTENSERIE_UEBERNAHME_ART, jobId: job!.public_id, state: "queued" }],
                        warnings: [],
                    },
                    event: {
                        ...actorFields(session, request),
                        action: EVENT,
                        targetRef: `map:series:${id}`,
                        details: { series: id, aktion: "production", from: null, to: eingabe.revision },
                    },
                };
            });
        },
    );
};
