import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { ApiErrorBody } from "@avesmaps3d/shared";
import { recordEvent } from "../auth/audit.ts";
import { cleanDisplayName } from "../auth/discord-flow.ts";
import { acceptInvitation, findOpenInvitation } from "../auth/invitations.ts";
import { setPassword, startSession } from "../auth/password-accounts.ts";
import { requestMeta, setSessionCookie } from "../auth/plugin.ts";
import { ApiError } from "../http/api-error.ts";
import { throttleAddress } from "../log-address.ts";
import { createRateLimiter } from "../share/rate-limiter.ts";

/**
 * Einladung ansehen und mit Passwort annehmen (WI-0120 A6, AUTH-0001 §6.5). Die Annahme mit Discord läuft über
 * `POST /api/auth/discord/start` mit `purpose: "invitation"` (`routes/auth-discord.ts`).
 *
 *     POST /api/auth/invitations/inspect   { token } → Rolle, Umgebung, Ablauf, Einladende; verbraucht nichts
 *     POST /api/auth/invitations/accept    { token, loginName, displayName, password } → neue Person, angemeldet (Stufe R)
 *
 * Das Token kommt im Körper (es steht im Fragment des Links), nie in der Adresse.
 */
const PER_IP_PER_MINUTE = 20;
const Token = Type.String({ minLength: 43, maxLength: 43 });
const InspectResponse = Type.Object({
    role: Type.String(),
    environment: Type.String(),
    expiresAt: Type.String(),
    invitedBy: Type.Union([Type.String(), Type.Null()]),
    requiresDiscord: Type.Boolean(),
});
const AcceptBody = Type.Object(
    {
        token: Token,
        loginName: Type.String({ minLength: 1, maxLength: 80 }),
        displayName: Type.String({ minLength: 1, maxLength: 40 }),
        password: Type.String({ minLength: 1, maxLength: 1024 }),
    },
    { additionalProperties: false },
);

export const authInvitationRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const limiter = createRateLimiter(PER_IP_PER_MINUTE, 60_000);
    const errors = {
        400: ApiErrorBody,
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
        "/api/auth/invitations/inspect",
        {
            ...open,
            schema: {
                body: Type.Object({ token: Token }, { additionalProperties: false }),
                response: { 200: InspectResponse, ...errors },
            },
        },
        async (request, reply) => {
            guard(request.ip);
            void reply.header("cache-control", "no-store");
            const invitation = await findOpenInvitation(app.database!, request.body.token, app.authConfig.environment!);
            if (invitation === undefined) {
                throw new ApiError(
                    400,
                    "invitation_invalid",
                    "Diese Einladung gilt nicht mehr. Eine neue kommt von der Verwaltung.",
                );
            }
            return {
                role: invitation.role,
                environment: invitation.environment,
                expiresAt: invitation.expiresAt.toISOString(),
                invitedBy: invitation.invitedBy,
                requiresDiscord: invitation.boundDiscordUserId !== null,
            };
        },
    );

    app.post(
        "/api/auth/invitations/accept",
        {
            ...open,
            schema: { body: AcceptBody, response: { 200: Type.Object({ ok: Type.Literal(true) }), ...errors } },
        },
        async (request, reply) => {
            guard(request.ip);
            void reply.header("cache-control", "no-store");
            const config = app.authConfig;
            const database = app.database!;
            const displayName = cleanDisplayName(request.body.displayName);
            if (displayName === "") throw new ApiError(400, "display_name_invalid", "Der Anzeigename fehlt.");
            const meta = requestMeta(request);
            const session = await database.begin(async (tx) => {
                const invitation = await findOpenInvitation(tx, request.body.token, config.environment!);
                if (invitation === undefined) {
                    throw new ApiError(
                        400,
                        "invitation_invalid",
                        "Diese Einladung gilt nicht mehr. Eine neue kommt von der Verwaltung.",
                    );
                }
                if (invitation.boundDiscordUserId !== null) {
                    throw new ApiError(
                        400,
                        "invitation_requires_discord",
                        "Diese Einladung lässt sich nur mit Discord annehmen.",
                    );
                }
                const personId = await acceptInvitation(tx, invitation, displayName, meta);
                if (personId === undefined) {
                    throw new ApiError(409, "invitation_invalid", "Diese Einladung wurde gerade schon angenommen.");
                }
                await setPassword(tx, personId, request.body.password, request.body.loginName);
                await recordEvent(tx, {
                    environment: config.environment!,
                    action: "invitation.accepted",
                    actorKind: "person",
                    actorPersonId: personId,
                    targetPersonId: personId,
                    targetRef: invitation.id,
                    details: { role: invitation.role, method: "password", tokenHint: invitation.tokenHint },
                    ...meta,
                });
                return startSession(tx, config, personId, "password", "basic", meta);
            });
            setSessionCookie(reply, config, session);
            return { ok: true as const };
        },
    );
};
