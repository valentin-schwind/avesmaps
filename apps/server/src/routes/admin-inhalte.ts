import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    AdminContentSwitches,
    CONTENT_STATE_URL,
    ContentState,
    ContentSwitchBody,
    OperationReceipt,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession, editConflict } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import { oeffentlicheVerwendungen, zahlenJeSchalter } from "../media/quarantine.ts";
import {
    MEDIA_QUARANTINE_KIND,
    ausgeschaltet,
    inhaltsModell,
    schalteUm,
    type Inhaltsstand,
} from "../system/inhaltsschalter.ts";
import { reisebilderStand } from "../photobox/karte.ts";
import { assertWritable } from "../system/write-guard.ts";

/**
 * Die Inhaltsschalter (WI-0127 SYS-10, SYS-0001 §3.4, §4.2, §6.4):
 *
 *     GET  /api/admin/system/content-switches   Stand je Schalter                                    view_operations (V)
 *     POST /api/admin/system/content-switches   { operationId, baseRevision, key, enabled }         manage_system_settings (S)
 *     GET  /api/content-state                   welche Schlüssel aus sind (öffentlich, ETag)         keine
 *
 * - Umschalten ohne Grund und ohne Dialog (Blatt B, abgenommen): Haken weg, der Browser fragt den Passkey (Stufe S). Genau ein Ereignis
 *   `system.content_switch_changed` (`key`, `from`, `to`) in derselben Transaktion (Protokollpflicht, SYS-0001 §9d.2).
 * - **Schreibklasse mit Richtung:** Ausschalten schützt (`security`, auch unter Sperre); Einschalten gibt frei (`system`, unter
 *   Systemsperre 423).
 * - `baseRevision` ist die Inhaltsrevision (`system_state.content_revision`); veraltet: 409 `edit_conflict`.
 * - `GET /api/content-state` antwortet `no-cache` mit ETag = Inhaltsrevision; der Client liest ihn beim Start und nach einer neueren
 *   Revision neu.
 */
export const adminInhalteRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const store = (): NonNullable<typeof app.inhaltsschalter> => app.inhaltsschalter!;

    /**
     * Die Zahlen je Bilder-Schalter (b3: dieselbe Entscheidung wie Resolver und Quarantäne, eine Abfrage über alle Verwendungen) und ob ein
     * Quarantäne-Abgleich noch aussteht. Scheitert das Zählen, fehlen nur die Zahlen; der Eintrag bleibt bedienbar.
     */
    const zaehle = async (
        stand: Inhaltsstand,
    ): Promise<{ zahlen?: Map<string, { sichtbar: number; ausgeblendet: number }>; pending?: boolean }> => {
        const database = app.database!;
        try {
            const [zahlen, [offen]] = await Promise.all([
                oeffentlicheVerwendungen(database, stand).then(zahlenJeSchalter),
                database<{ offen: boolean }[]>`
                    SELECT EXISTS (SELECT 1 FROM job WHERE kind = ${MEDIA_QUARANTINE_KIND} AND state IN ('QUEUED', 'RUNNING')) AS offen
                `,
            ]);
            return { zahlen, pending: offen?.offen === true };
        } catch (error) {
            app.log.warn({ err: error }, "Inhaltsschalter: Zahlen je Rechtsgrund nicht gezählt");
            return {};
        }
    };

    app.get(
        "/api/admin/system/content-switches",
        { ...protect("view_operations"), schema: { response: { 200: AdminContentSwitches, ...ADMIN_ERRORS } } },
        async (request) => {
            await adminSession(request);
            const stand = await store().read();
            return inhaltsModell(stand, new Date(), await zaehle(stand));
        },
    );

    app.post(
        "/api/admin/system/content-switches",
        {
            ...protect("manage_system_settings", { confirm: "passkey", writeClass: "by_direction" }),
            schema: { body: ContentSwitchBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, baseRevision, key, enabled } = request.body;
            await assertWritable(request, enabled ? "system" : "security");
            const receipt = await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "content.switch", key, enabled, baseRevision } },
                async (tx) => {
                    const result = await schalteUm(tx, {
                        key,
                        enabled,
                        baseRevision,
                        actor: { personId: session.personId, label: session.displayName },
                        conflict: (current) =>
                            editConflict(app.database!, {
                                currentRevision: current.revision,
                                changedAt: current.changedAt,
                                targetRef: "content:switches",
                                actions: ["system.content_switch_changed"],
                            }),
                    });
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.content_switch_changed",
                            targetRef: "content:switches",
                            details: { key, from: result.from, to: result.to },
                        },
                    };
                },
            );
            store().forget();
            return receipt;
        },
    );
};

/** Der öffentliche Lesepfad, außerhalb der Verwaltung (dort gilt `no-store`; hier `no-cache` mit ETag). */
export const contentStateRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const store = (): NonNullable<typeof app.inhaltsschalter> => app.inhaltsschalter!;

    app.get(
        CONTENT_STATE_URL,
        { config: { auth: "public" }, schema: { response: { 200: ContentState, 304: Type.Null() } } },
        async (request, reply) => {
            const stand = await store().read();
            // Der Stand der Reisebilder fährt im vorhandenen Takt mit (`photobox/karte.ts`); fehlt er, bleibt nur das Mitfahren aus.
            const reisebilder =
                app.database === undefined ? undefined : await reisebilderStand(app.database).catch(() => undefined);
            const etag = `"c${String(stand.revision ?? 0)}-${stand.source}-${reisebilder ?? ""}"`;
            reply.header("cache-control", "no-cache");
            reply.header("etag", etag);
            if (request.headers["if-none-match"] === etag) return reply.code(304).send(null);
            return {
                revision: stand.revision,
                off: ausgeschaltet(stand),
                ...(reisebilder === undefined ? {} : { reisebilder }),
            };
        },
    );
};
