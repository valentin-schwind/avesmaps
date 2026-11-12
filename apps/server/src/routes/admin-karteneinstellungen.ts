import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    AdminKarteneinstellungen,
    KARTENEINSTELLUNGEN_URL,
    KarteneinstellungBody,
    MAP_SETTINGS_URL,
    MapSettings,
    OperationReceipt,
    rechteVon,
    privateKarteneinstellung,
    wegfindungImBrowser,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession, editConflict } from "../auth/admin-guard.ts";
import { demand, protect } from "../auth/plugin.ts";
import {
    karteneinstellungenModell,
    leseKarteneinstellungen,
    verstelleKarteneinstellung,
    wirksameKarteneinstellungen,
} from "../system/karteneinstellungen.ts";
import { wegfindungswerte } from "../system/wegfindungsstand.ts";
import { assertWritable } from "../system/write-guard.ts";

/**
 * Die Karteneinstellungen (WI-0166; Tafel `packages/shared/src/system/karteneinstellungen.ts`):
 *
 *     GET  /api/admin/system/karteneinstellungen   die Abweichungen und ihre Revision                     view_operations (V)
 *     POST /api/admin/system/karteneinstellungen   { operationId, baseRevision, id, value }   manage_system_settings (S)
 *     GET  /api/map-settings                       die wirksamen Werte (öffentlich, ETag)                 keine
 *
 * - Verstellen ohne Grund und ohne Dialog, wie Wegfindung und Inhaltsschalter: Wert eintragen, der Browser fragt den Passkey
 *   (Stufe S). Genau ein Ereignis `system.map_setting_changed` (`key`, `from`, `to`) in derselben Transaktion (Protokollpflicht,
 *   SYS-0001 §9d.2); `to: null` heißt zurück auf die Vorgabe.
 * - **Schreibklasse `system`:** Eine Voreinstellung ist eine Einstellung, kein Sicherheitshandgriff; unter Systemsperre 423.
 * - `GET /api/map-settings` antwortet `no-cache` mit ETag, wie `GET /api/content-state`: Die Karte liest es VOR ihrem Start
 *   (`apps/web/src/map/start-view.ts`), ein unveränderter Stand kostet ein 304.
 * - 🔴 **Private Einstellungen** (WI-0180 §8, Bedingungen der Regel-Koordination): lesen (`privat` im Lesemodell) und schreiben
 *   nur mit `switch_environment`, das nur die Rolle Betreiber hat und das kein Sonderrecht ist; im Protokoll steht der Schlüssel,
 *   der Wert als `privat`. Der öffentliche Leseweg kennt sie nicht, auch nicht im ETag: Das ETag ist ein Abdruck der
 *   öffentlichen Werte, und die öffentliche Antwort trägt keine Revision mehr (`null`), weil die Revision auch private Änderungen
 *   zählt. Die Karte liest beides nicht.
 */
const EVENT = "system.map_setting_changed" as const;
const TARGET = "map:settings" as const;

export const adminKarteneinstellungenRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        KARTENEINSTELLUNGEN_URL,
        { ...protect("view_operations"), schema: { response: { 200: AdminKarteneinstellungen, ...ADMIN_ERRORS } } },
        async (request) => {
            const session = await adminSession(request);
            const privat = rechteVon(session).has("switch_environment");
            return karteneinstellungenModell(await leseKarteneinstellungen(app.database!), new Date(), { privat });
        },
    );

    app.post(
        KARTENEINSTELLUNGEN_URL,
        {
            ...protect("manage_system_settings", { confirm: "passkey", writeClass: "system" }),
            schema: { body: KarteneinstellungBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, baseRevision, id, value } = request.body;
            // Eine private Einstellung (WI-0180 §8) verlangt zusätzlich `switch_environment`: Ein Admin mit dem zugeteilten
            // `manage_system_settings` schreibt sie nicht.
            const privat = privateKarteneinstellung(id) !== undefined;
            if (privat) demand(session, "switch_environment", app.authConfig);
            await assertWritable(request, "system");
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "karteneinstellung.set", id, value, baseRevision } },
                async (tx) => {
                    const result = await verstelleKarteneinstellung(tx, {
                        id,
                        value,
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
                            // Privat: der Schlüssel ja, der Wert nie (WI-0180 §8, Bedingung 3).
                            details: privat
                                ? { key: id, from: "privat", to: "privat" }
                                : { key: id, from: result.from, to: result.to },
                        },
                    };
                },
            );
        },
    );
};

/** Der öffentliche Lesepfad, außerhalb der Verwaltung (dort gilt `no-store`; hier `no-cache` mit ETag). */
export const mapSettingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        MAP_SETTINGS_URL,
        { config: { auth: "public" }, schema: { response: { 200: MapSettings, 304: Type.Null() } } },
        async (request, reply) => {
            // Ohne Datenbank (ein Entwicklungsstart ohne `DATABASE_URL`) gelten die Vorgaben; die Karte startet trotzdem.
            const stand =
                app.database === undefined
                    ? { source: "unprovisioned" as const, revision: null, zeilen: new Map(), unknownKeys: [] }
                    : await leseKarteneinstellungen(app.database, { personen: false });
            const werte = wirksameKarteneinstellungen(stand);
            // Die Werte der Wegfindung, die der Browser selbst anwendet (WI-0214): wirksam, über die Lesestelle des
            // Hauptthreads. Ohne Datenbank die Vorgaben.
            const wegfindung = wegfindungImBrowser(await wegfindungswerte(app.database));
            // Ein Abdruck der öffentlichen Werte, nicht die Revision: Die zählt auch private Änderungen (WI-0180 §8).
            const abdruck = createHash("sha256")
                .update(JSON.stringify({ ...werte, wegfindung }))
                .digest("base64url")
                .slice(0, 22);
            const etag = `"m${abdruck}-${stand.source}"`;
            reply.header("cache-control", "no-cache");
            reply.header("etag", etag);
            if (request.headers["if-none-match"] === etag) return reply.code(304).send(null);
            return { revision: null, ...werte, wegfindung };
        },
    );
};
