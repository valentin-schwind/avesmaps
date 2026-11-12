import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { ApiErrorBody, AuthSessionResponse, type Bezeichnung, type LoginMethod } from "@avesmaps3d/shared";
import { recordEvent } from "../auth/audit.ts";
import { clearSessionCookie, requestMeta } from "../auth/plugin.ts";
import { revokeSession } from "../auth/session-store.ts";
import { sonderrollenJePerson } from "../auth/sonderrollen.ts";
import { liveChannelFor } from "./live-hint.ts";

/**
 * Die eigene Sitzung (WI-0120 A3, AUTH-0001 §8):
 *
 *     GET  /api/auth/session   wer, was darf diese Anfrage, welche Umgebung, ob sie `/ws` betreten darf (`liveChannel`, WI-0197);
 *                              nie gecacht; erneuert das Cookie (volle Laufzeit)
 *     POST /api/auth/logout    beendet die Sitzung dieses Browsers (204), auch ohne Sitzung
 *     GET  /api/auth/gate      die Tür für Nginx `auth_request` (AUTH-0001 §4.5, SYS-0001 §4.3): 204, 401, 403 oder 503 ohne Körper
 *     GET  /api/auth/gate?nur=bereitschaft   nur die Bereitschaft: 204 oder 503 (Einstiegsseiten auf Production)
 *
 * Die Tür prüft nur und merkt sich ihr Urteil höchstens 30 s (`auth/gate.ts`, eine je Instanz: `app.gate`): keine Erneuerung, kein
 * `Set-Cookie`, nur GET (Nginx schickt die Türfrage mit `proxy_method GET`; keine weitere Methode auf diesem Pfad).
 */
export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const errors = { 403: ApiErrorBody, 415: ApiErrorBody, 503: ApiErrorBody };
    const gate = app.gate;

    app.get(
        "/api/auth/session",
        {
            config: { auth: "public", errorEnvelope: true },
            schema: { response: { 200: AuthSessionResponse, ...errors } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "no-store");
            const config = app.authConfig;
            const enabled = config.environment !== undefined && app.database !== undefined;
            const capabilities = [...(await request.auth.capabilities())].sort();
            const session = enabled ? await request.auth.session() : undefined;
            const liveChannel = liveChannelFor(app, session);
            if (session === undefined || app.database === undefined) {
                return {
                    environment: config.environment ?? null,
                    authEnabled: enabled,
                    person: null,
                    capabilities,
                    liveChannel,
                };
            }
            // Jedes Laden der Seite erneuert das Cookie mit voller Laufzeit: Eine benutzte Sitzung läuft nie ab (2026-10-10).
            await request.auth.renewCookie();
            const [methods] = await app.database<
                {
                    password: boolean;
                    discord: boolean;
                    passkeys: number;
                    responsible_for: string | null;
                    bezeichnung: Bezeichnung | null;
                }[]
            >`
                SELECT (SELECT responsible_for FROM avesmaps_auth.person WHERE id = ${session.personId}) AS responsible_for,
                       (SELECT bezeichnung FROM avesmaps_auth.person WHERE id = ${session.personId}) AS bezeichnung,
                       EXISTS (SELECT 1 FROM avesmaps_auth.password_login WHERE person_id = ${session.personId} AND disabled_at IS NULL) AS password,
                       EXISTS (SELECT 1 FROM avesmaps_auth.discord_login WHERE person_id = ${session.personId}) AS discord,
                       (SELECT count(*)::int FROM avesmaps_auth.passkey_credential
                         WHERE person_id = ${session.personId} AND environment = ${session.environment} AND revoked_at IS NULL) AS passkeys
            `;
            const sonderrollen =
                session.sonderrollen.length === 0
                    ? []
                    : ((await sonderrollenJePerson(app.database, session.environment, [session.personId])).get(
                          session.personId,
                      ) ?? []);
            const list: LoginMethod[] = [];
            if (methods?.discord === true) list.push("discord");
            if (methods?.password === true) list.push("password");
            if ((methods?.passkeys ?? 0) > 0) list.push("passkey");
            return {
                environment: session.environment,
                authEnabled: true,
                capabilities,
                liveChannel,
                person: {
                    id: session.personId,
                    displayName: session.displayName,
                    role: session.role,
                    methods: list,
                    assurance: session.assurance,
                    sessionMethod: session.method,
                    confirmedAt: session.confirmedAt.toISOString(),
                    passkeyConfirmedAt: session.passkeyConfirmedAt?.toISOString() ?? null,
                    expiresAt: session.expiresAt.toISOString(),
                    passkeyCount: methods?.passkeys ?? 0,
                    // Für die späteren Statusanzeigen („Vali – Verantwortlich für: …“, WI-0133); heute zeigt es noch keine Stelle.
                    responsibleFor: methods?.responsible_for ?? null,
                    bezeichnung: methods?.bezeichnung ?? null,
                    sonderrollen,
                },
            };
        },
    );

    app.post(
        "/api/auth/logout",
        {
            config: { auth: "public", errorEnvelope: true, writeClass: "account" },
            schema: { response: { 204: Type.Null(), ...errors } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "no-store");
            const config = app.authConfig;
            const session = await request.auth.session();
            if (session !== undefined && app.database !== undefined && config.environment !== undefined) {
                const database = app.database;
                await database.begin(async (tx) => {
                    await revokeSession(tx, session.id, session.personId, "logout");
                    await recordEvent(tx, {
                        environment: session.environment,
                        action: "logout",
                        actorKind: "person",
                        actorPersonId: session.personId,
                        targetPersonId: session.personId,
                        sessionId: session.id,
                        recovery: session.assurance === "recovery",
                        ...requestMeta(request),
                    });
                });
            }
            // Die Tür dieser Instanz vergisst das Token sofort; die übrigen erfahren es über `NOTIFY`.
            gate.forget(request.headers.cookie);
            clearSessionCookie(reply, config);
            return reply.code(204).send(null);
        },
    );

    app.get("/api/auth/gate", { config: { auth: "public" } }, async (request, reply) => {
        void reply.header("cache-control", "no-store");
        // Ohne Schema: Ein unerwarteter Parameter darf die Türfrage nie zu 400 machen (Nginx zeigte sonst die Störungsseite).
        const readinessOnly = (request.query as { nur?: unknown }).nur === "bereitschaft";
        const status = readinessOnly ? gate.readiness() : await gate.decide(request.headers.cookie);
        return reply.code(status).send();
    });
};
