import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    AdminZoombaender,
    OperationReceipt,
    ZOOMBAENDER_URL,
    ZOOM_BANDS_URL,
    ZoomBandsPublic,
    ZoombaenderBody,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession, editConflict } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import { assertWritable } from "../system/write-guard.ts";
import { abweichungenVon, leseZoombaender, verstelleZoombaender, zoombaenderModell } from "../zoombaender/stand.ts";

/**
 * Die Zoombänder (WI-0221; Katalog `packages/shared/src/system/zoombaender.ts`):
 *
 *     GET  /api/admin/system/zoombaender   die Abweichungen und ihre Revision                         view_operations (V)
 *     POST /api/admin/system/zoombaender   { operationId, baseRevision, aenderungen }   manage_display_settings + Passkey (S)
 *     GET  /api/zoom-bands                 die Abweichungen für den Start der Karte (öffentlich, ETag)        keine
 *
 * - „Übernehmen“ schickt alle geänderten Spannen auf einmal: genau ein Ereignis `system.zoom_band_changed` (`anzahl`, `spuren`)
 *   in derselben Transaktion (Protokollpflicht, SYS-0001 §9d.2).
 * - Recht `manage_display_settings` („Darstellungstafeln und Zoombänder“, AUTH-0001; geplant für WI-0130, hier die erste Route).
 * - **Schreibklasse `system`:** eine Einstellung der Darstellung, kein Sicherheitshandgriff; unter Systemsperre 423.
 * - `GET /api/zoom-bands` antwortet `no-cache` mit ETag wie `GET /api/map-settings`; die Karte liest es VOR ihrem Start.
 */
const EVENT = "system.zoom_band_changed" as const;
const TARGET = "map:zoom-bands" as const;

export const adminZoombaenderRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        ZOOMBAENDER_URL,
        { ...protect("view_operations"), schema: { response: { 200: AdminZoombaender, ...ADMIN_ERRORS } } },
        async (request) => {
            await adminSession(request);
            return zoombaenderModell(await leseZoombaender(app.database), new Date());
        },
    );

    app.post(
        ZOOMBAENDER_URL,
        {
            ...protect("manage_display_settings", { confirm: "passkey", writeClass: "system" }),
            schema: { body: ZoombaenderBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, baseRevision, aenderungen } = request.body;
            await assertWritable(request, "system");
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "zoombaender.set", aenderungen, baseRevision } },
                async (tx) => {
                    const result = await verstelleZoombaender(tx, {
                        aenderungen,
                        baseRevision,
                        actor: { personId: session.personId, label: session.displayName },
                        conflict: (current) =>
                            editConflict(app.database!, {
                                currentRevision: current.revision,
                                changedAt: current.changedAt,
                                targetRef: TARGET,
                                actions: [EVENT],
                            }),
                    });
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: EVENT,
                            targetRef: TARGET,
                            details: { anzahl: result.geaendert.length, spuren: result.geaendert },
                        },
                    };
                },
            );
        },
    );
};

/** Der öffentliche Leseweg, außerhalb der Verwaltung. */
export const zoomBandsRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        ZOOM_BANDS_URL,
        { config: { auth: "public" }, schema: { response: { 200: ZoomBandsPublic, 304: Type.Null() } } },
        async (request, reply) => {
            const stand = await leseZoombaender(app.database, { personen: false });
            const abweichungen = abweichungenVon(stand);
            const abdruck = createHash("sha256").update(JSON.stringify(abweichungen)).digest("base64url").slice(0, 22);
            const etag = `"z${abdruck}-${stand.source}"`;
            reply.header("cache-control", "no-cache");
            reply.header("etag", etag);
            if (request.headers["if-none-match"] === etag) return reply.code(304).send(null);
            return { abweichungen };
        },
    );
};
