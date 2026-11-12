import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { ApiErrorBody, MutationEnvelope, OperationReceipt } from "@avesmaps3d/shared";
import { peekAccessLink, type AccessLinkKind } from "../auth/access-links.ts";
import { loginWithPassword, resetPasswordWithLink, setPassword, startRecovery } from "../auth/password-accounts.ts";
import { verifyPassword } from "../auth/password-hash.ts";
import { requestMeta, sessionOnly, setSessionCookie } from "../auth/plugin.ts";
import { revokePersonSessions, rotateSession, type IssuedSession } from "../auth/session-store.ts";
import { runOperation } from "../auth/operations.ts";
import { ApiError } from "../http/api-error.ts";
import { throttleAddress } from "../log-address.ts";
import { createRateLimiter } from "../share/rate-limiter.ts";

/**
 * Benutzername und Passwort (WI-0120 A4, AUTH-0001 §6.4, §6.7, §11.2):
 *
 *     POST /api/auth/login               anmelden (Stufe R)
 *     POST /api/auth/links/inspect       was hinter einem Rücksetz-, Notzugangs- oder Passkey-Link steht, ohne ihn zu verbrauchen
 *     POST /api/auth/password-reset      Rücksetzlink einlösen: neues Passwort, alle Sitzungen enden, neue Anmeldung
 *     POST /api/auth/recovery            Notzugang: Link von der Kommandozeile plus Passwort, 60 Minuten
 *     POST /api/account/password         eigenes Passwort ändern oder einrichten
 *
 * Die Geheimnisse der Links kommen im Körper, nie in der Adresse (sie stehen im Fragment der Seite, AUTH-0001 T9, T14).
 */

/** Je IP höchstens so viele Anfragen an die Anmeldepfade in einer Minute (im Speicher; davor `limit_req` im vhost). */
const PER_IP_PER_MINUTE = 20;

const Password = Type.String({ minLength: 1, maxLength: 1024 });
const Token = Type.String({ minLength: 43, maxLength: 43 });
const LoginName = Type.String({ minLength: 1, maxLength: 80 });

const LoginBody = Type.Object({ loginName: LoginName, password: Password }, { additionalProperties: false });
const LinkKind = Type.Union([
    Type.Literal("password_reset"),
    Type.Literal("recovery"),
    Type.Literal("passkey_enrollment"),
]);
const InspectBody = Type.Object({ token: Token, kind: LinkKind }, { additionalProperties: false });
const InspectResponse = Type.Object({
    kind: LinkKind,
    displayName: Type.String(),
    loginName: Type.Union([Type.String(), Type.Null()]),
    expiresAt: Type.String(),
});
const ResetBody = Type.Object(
    { token: Token, password: Password, loginName: Type.Optional(LoginName) },
    { additionalProperties: false },
);
const RecoveryBody = Type.Object({ token: Token, password: Password }, { additionalProperties: false });
const ChangeBody = Type.Composite([
    MutationEnvelope,
    Type.Object(
        { currentPassword: Type.Optional(Password), newPassword: Password, loginName: Type.Optional(LoginName) },
        { additionalProperties: false },
    ),
]);
const Ok = Type.Object({ ok: Type.Literal(true) });

export const authPasswordRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const limiter = createRateLimiter(PER_IP_PER_MINUTE, 60_000);
    const errors = {
        400: ApiErrorBody,
        401: ApiErrorBody,
        403: ApiErrorBody,
        409: ApiErrorBody,
        413: ApiErrorBody,
        415: ApiErrorBody,
        429: ApiErrorBody,
        503: ApiErrorBody,
    };
    const open = {
        config: { auth: "public" as const, errorEnvelope: true, writeClass: "account" as const },
        bodyLimit: 4096,
    };

    /** Die Anmeldung muss eingerichtet sein, und dieselbe IP darf nicht beliebig oft fragen. */
    function guard(ip: string): void {
        if (app.authConfig.environment === undefined || app.database === undefined) {
            throw new ApiError(503, "auth_unavailable", "Die Anmeldung ist auf dieser Instanz nicht eingerichtet.");
        }
        const key = throttleAddress(ip);
        if (!limiter.allows(key)) {
            throw new ApiError(429, "rate_limited", "Zu viele Versuche. Gleich noch einmal versuchen.", {
                retryAfterSeconds: 60,
            });
        }
        limiter.record(key);
    }

    app.post(
        "/api/auth/login",
        { ...open, schema: { body: LoginBody, response: { 200: Ok, ...errors } } },
        async (request, reply) => {
            guard(request.ip);
            void reply.header("cache-control", "no-store");
            const session = await loginWithPassword(app.database!, app.authConfig, request.body, requestMeta(request));
            setSessionCookie(reply, app.authConfig, session);
            return { ok: true as const };
        },
    );

    app.post(
        "/api/auth/links/inspect",
        { ...open, schema: { body: InspectBody, response: { 200: InspectResponse, ...errors } } },
        async (request, reply) => {
            guard(request.ip);
            void reply.header("cache-control", "no-store");
            const info = await peekAccessLink(app.database!, request.body.token, request.body.kind as AccessLinkKind);
            if (info === undefined) throw new ApiError(400, "link_invalid", "Dieser Link gilt nicht mehr.");
            return {
                kind: request.body.kind,
                displayName: info.displayName,
                loginName: info.loginName,
                expiresAt: info.expiresAt.toISOString(),
            };
        },
    );

    app.post(
        "/api/auth/password-reset",
        { ...open, schema: { body: ResetBody, response: { 200: Ok, ...errors } } },
        async (request, reply) => {
            guard(request.ip);
            void reply.header("cache-control", "no-store");
            const session = await resetPasswordWithLink(
                app.database!,
                app.authConfig,
                request.body,
                requestMeta(request),
            );
            setSessionCookie(reply, app.authConfig, session);
            return { ok: true as const };
        },
    );

    app.post(
        "/api/auth/recovery",
        { ...open, schema: { body: RecoveryBody, response: { 200: Ok, ...errors } } },
        async (request, reply) => {
            guard(request.ip);
            void reply.header("cache-control", "no-store");
            const session = await startRecovery(app.database!, app.authConfig, request.body, requestMeta(request));
            setSessionCookie(reply, app.authConfig, session);
            return { ok: true as const };
        },
    );

    app.post(
        "/api/account/password",
        {
            ...sessionOnly(),
            bodyLimit: 4096,
            schema: { body: ChangeBody, response: { 200: OperationReceipt, ...errors } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "no-store");
            const config = app.authConfig;
            const database = app.database!;
            const session = (await request.auth.session())!;
            const { operationId, currentPassword, newPassword, loginName } = request.body;
            const [login] = await database<{ password_hash: string }[]>`
                SELECT password_hash FROM avesmaps_auth.password_login WHERE person_id = ${session.personId}
            `;
            const recent = Date.now() - session.confirmedAt.getTime() <= config.session.stepUpMinutes * 60_000;
            if (login !== undefined) {
                // Ändern: mit dem alten Passwort, oder frisch über einen anderen Weg bestätigt (Discord, Passkey, Notzugang).
                if (currentPassword !== undefined) {
                    if (!(await verifyPassword(currentPassword, login.password_hash)).ok) {
                        throw new ApiError(403, "current_password_wrong", "Das bisherige Passwort stimmt nicht.");
                    }
                } else if (!(recent && session.method !== "password")) {
                    throw new ApiError(403, "reauth_required", "Das bisherige Passwort fehlt.", {
                        need: "current_password",
                    });
                }
            } else if (!recent) {
                throw new ApiError(403, "reauth_required", "Die Anmeldung muss kurz bestätigt werden.", {
                    need: "confirmation",
                });
            }
            const meta = requestMeta(request);
            let rotated: IssuedSession | undefined;
            const receipt = await runOperation(
                database,
                { operationId, body: { action: "account.password", personId: session.personId, loginName } },
                async (tx) => {
                    const outcome = await setPassword(tx, session.personId, newPassword, loginName);
                    await revokePersonSessions(tx, session.personId, session.personId, "password_changed", session.id);
                    rotated = await rotateSession(tx, session, "password_changed");
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [{ kind: "password_login", id: session.personId }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            environment: session.environment,
                            action: outcome === "set" ? "password.set" : "password.changed",
                            actorKind: "person",
                            actorPersonId: session.personId,
                            targetPersonId: session.personId,
                            details: outcome === "set" ? { via: "account" } : {},
                            sessionId: session.id,
                            recovery: session.assurance === "recovery",
                            ...meta,
                        },
                    };
                },
            );
            if (rotated !== undefined) setSessionCookie(reply, config, rotated);
            return receipt;
        },
    );
};
