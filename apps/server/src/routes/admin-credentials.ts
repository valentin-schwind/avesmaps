import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { LinkReceipt, OperationReceipt, PersonActionBody } from "@avesmaps3d/shared";
import { ACCESS_LINK_MINUTES, ACCESS_LINK_PATH, createAccessLink, type AccessLinkKind } from "../auth/access-links.ts";
import {
    ADMIN_ERRORS,
    actorFields,
    adminOperation,
    adminSession,
    guardTarget,
    linkOrigin,
    linkResponse,
    loadTarget,
} from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import { revokePersonSessions } from "../auth/session-store.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Anmeldewege einer anderen Person (WI-0120 A7; AUTH-0001 §6.7 D4, §11.4):
 *
 *     POST /api/admin/people/reset-link       { personId } → Rücksetzlink, 24 h        manage_people (V, bestätigt)
 *     POST /api/admin/people/passkey-link     { personId } → Link zum ersten Passkey   manage_passkeys (S)
 *     POST /api/admin/people/passkeys/revoke  { personId } → alle Passkeys weg         manage_passkeys (S)
 *
 * Ein Rücksetzlink ersetzt nur ein vorhandenes Passwort: Wer sich ohne Passwort anmeldet, richtet es selbst im Konto ein
 * (§6.6: kein Admin hängt einen Anmeldeweg an eine fremde Person). Der Link steht nur in der ersten Antwort.
 */
export const adminCredentialRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const linkRoute = (path: string, kind: AccessLinkKind, check: "password" | "none") =>
        app.post(
            path,
            {
                ...(kind === "password_reset"
                    ? protect("manage_people", { confirm: "recent", writeClass: "system" })
                    : protect("manage_passkeys", { writeClass: "system" })),
                schema: { body: PersonActionBody, response: { 200: LinkReceipt, ...ADMIN_ERRORS } },
            },
            async (request) => {
                const session = await adminSession(request);
                const { operationId, personId } = request.body;
                const environment = session.environment;
                const out: { link?: { token: string; expiresAt: Date } } = {};
                const receipt = await adminOperation(
                    app.database!,
                    session,
                    { operationId, body: { action: `people.${kind}`, personId } },
                    async (tx) => {
                        const target = await loadTarget(tx, environment, personId);
                        guardTarget(session, target, app.authConfig);
                        if (target.status !== "active" || target.access !== "active") {
                            throw new ApiError(
                                409,
                                "account_inactive",
                                "Diese Person ist gesperrt oder hat hier keinen Zugang.",
                            );
                        }
                        if (check === "password") {
                            const [login] =
                                await tx`SELECT 1 FROM avesmaps_auth.password_login WHERE person_id = ${personId}`;
                            if (login === undefined) {
                                throw new ApiError(
                                    409,
                                    "no_password_login",
                                    "Diese Person meldet sich ohne Passwort an. Ein Passwort richtet sie selbst im Konto ein.",
                                );
                            }
                        }
                        const link = await createAccessLink(tx, { kind, personId, createdBy: session.personId });
                        out.link = link;
                        return {
                            receipt: {
                                environment,
                                affected: [{ kind: "access_link", id: link.id }],
                                derivedWork: [],
                                warnings: [],
                            },
                            event: {
                                ...actorFields(session, request),
                                action: "access_link.created",
                                targetPersonId: personId,
                                details: { kind, validHours: ACCESS_LINK_MINUTES[kind] / 60 },
                            },
                        };
                    },
                );
                return linkResponse(
                    receipt,
                    out.link === undefined
                        ? undefined
                        : {
                              url: `${linkOrigin(request, app.authConfig)}${ACCESS_LINK_PATH[kind]}#${out.link.token}`,
                              expiresAt: out.link.expiresAt,
                          },
                );
            },
        );

    linkRoute("/api/admin/people/reset-link", "password_reset", "password");
    linkRoute("/api/admin/people/passkey-link", "passkey_enrollment", "none");

    app.post(
        "/api/admin/people/passkeys/revoke",
        {
            ...protect("manage_passkeys", { writeClass: "security" }),
            schema: { body: PersonActionBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, personId } = request.body;
            const environment = session.environment;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "people.passkeys_revoke", personId } },
                async (tx) => {
                    const target = await loadTarget(tx, environment, personId);
                    guardTarget(session, target, app.authConfig);
                    const revoked = await tx<{ id: string }[]>`
                        UPDATE avesmaps_auth.passkey_credential
                           SET revoked_at = now(), revoked_by = ${session.personId}, revoke_reason = 'operator'
                         WHERE person_id = ${personId} AND environment = ${environment} AND revoked_at IS NULL
                        RETURNING id
                    `;
                    if (revoked.length === 0) throw new ApiError(409, "no_change", "Diese Person hat keinen Passkey.");
                    const ended = await revokePersonSessions(tx, personId, session.personId, "passkeys_revoked");
                    return {
                        receipt: {
                            environment,
                            affected: revoked.map((row) => ({ kind: "passkey", id: row.id })),
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "passkey.revoked",
                            targetPersonId: personId,
                            details: { reason: "operator", count: revoked.length, sessions: ended.length },
                        },
                    };
                },
            );
        },
    );
};
