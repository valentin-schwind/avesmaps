import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    AccountSessionsRevokeBody,
    AdminPersonDetail,
    ApiErrorBody,
    DisplayNameBody,
    OperationOnlyBody,
    OperationReceipt,
    BezeichnungBody,
    ResponsibilityBody,
} from "@avesmaps3d/shared";
import { actorFields, editConflict, noStore } from "../auth/admin-guard.ts";
import { personDetail } from "../auth/admin-people.ts";
import { cleanDisplayName } from "../auth/discord-flow.ts";
import { runOperation } from "../auth/operations.ts";
import { aendereBezeichnung } from "../auth/bezeichnung.ts";
import { sessionOnly } from "../auth/plugin.ts";
import { PERSON_REVISION_ACTIONS, changeResponsibility, parseResponsibility } from "../auth/responsibility.ts";
import type { SessionRecord, Sql } from "../auth/session-store.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Das eigene Konto (WI-0120 A9, AUTH-0001 §6.6, §12.2 `konto-fenster`):
 *
 *     GET  /api/account                    eigene Angaben, Anmeldewege, Passkeys, Sitzungen, Sonderrechte
 *     POST /api/account/sessions/revoke    { operationId, sessionId? }  andere Sitzungen beenden (die laufende: Abmelden)
 *     POST /api/account/display-name       { operationId, displayName, baseRevision }
 *     POST /api/account/responsibility     { operationId, responsibleFor, baseRevision }  „Verantwortlich für:“ (WI-0133), "" leert
 *     POST /api/account/bezeichnung        { operationId, bezeichnung }  Wortform der eigenen Rollen (WI-0279 E10)
 *     POST /api/account/discord/unlink     { operationId }  nur frisch bestätigt und nur, wenn ein Passwort bleibt
 *
 * Passwort ändern oder einrichten: `auth-password.ts`; Passkeys: `auth-passkey.ts`; Discord verknüpfen: `auth-discord.ts`.
 */
const ERRORS = {
    400: ApiErrorBody,
    401: ApiErrorBody,
    403: ApiErrorBody,
    404: ApiErrorBody,
    409: ApiErrorBody,
    413: ApiErrorBody,
    415: ApiErrorBody,
    503: ApiErrorBody,
};

/** Handlungen am eigenen Konto laufen je Person nacheinander: ein Doppelklick bekommt die Quittung der ersten. */
function ownOperation(
    database: Parameters<typeof runOperation>[0],
    session: SessionRecord,
    input: { operationId: string; body: unknown },
    work: Parameters<typeof runOperation>[2],
): ReturnType<typeof runOperation> {
    return runOperation(database, input, work, {
        serialize: async (tx: Sql) => {
            await tx`SELECT pg_advisory_xact_lock(hashtext(${`avesmaps_auth.account:${session.personId}`}))`;
        },
    });
}

export const accountRoutes: FastifyPluginAsyncTypebox = async (app) => {
    noStore(app);

    const own = async (request: FastifyRequest): Promise<SessionRecord> => {
        const session = await request.auth.session();
        if (session === undefined) throw new ApiError(401, "unauthenticated", "Dafür ist eine Anmeldung nötig.");
        return session;
    };

    app.get(
        "/api/account",
        { ...sessionOnly(), schema: { response: { 200: AdminPersonDetail, ...ERRORS } } },
        async (request) => {
            const session = await own(request);
            const detail = await personDetail(app.database!, session, session.personId);
            if (detail === undefined) throw new ApiError(401, "unauthenticated", "Dafür ist eine Anmeldung nötig.");
            return detail;
        },
    );

    app.post(
        "/api/account/sessions/revoke",
        {
            ...sessionOnly(),
            schema: { body: AccountSessionsRevokeBody, response: { 200: OperationReceipt, ...ERRORS } },
        },
        async (request) => {
            const session = await own(request);
            const { operationId, sessionId } = request.body;
            if (sessionId === session.id) {
                throw new ApiError(409, "current_session", "Diese Sitzung endet mit „Abmelden“.");
            }
            return ownOperation(
                app.database!,
                session,
                { operationId, body: { action: "account.sessions_revoke", sessionId } },
                async (tx) => {
                    const ended = await tx<{ id: string }[]>`
                        UPDATE avesmaps_auth.session
                           SET revoked_at = now(), revoked_by = ${session.personId}, revoke_reason = 'self'
                         WHERE person_id = ${session.personId} AND revoked_at IS NULL AND id <> ${session.id}
                           ${sessionId === undefined ? tx`` : tx`AND id = ${sessionId}`}
                        RETURNING id
                    `;
                    if (ended.length === 0) {
                        throw new ApiError(409, "no_change", "Es gibt keine andere offene Sitzung.");
                    }
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: ended.map((row) => ({ kind: "session", id: row.id })),
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "session.revoked",
                            targetPersonId: session.personId,
                            details: {
                                reason: "self",
                                count: ended.length,
                                ...(sessionId === undefined ? {} : { sessionId }),
                            },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/account/display-name",
        { ...sessionOnly(), schema: { body: DisplayNameBody, response: { 200: OperationReceipt, ...ERRORS } } },
        async (request) => {
            const session = await own(request);
            const { operationId, baseRevision } = request.body;
            const displayName = cleanDisplayName(request.body.displayName);
            if (displayName === "") throw new ApiError(400, "display_name_invalid", "Der Anzeigename fehlt.");
            return ownOperation(
                app.database!,
                session,
                { operationId, body: { action: "account.display_name", displayName, baseRevision } },
                async (tx) => {
                    const [person] = await tx<{ display_name: string; revision: number; updated_at: Date }[]>`
                        SELECT display_name, revision::int AS revision, updated_at FROM avesmaps_auth.person
                         WHERE id = ${session.personId} FOR UPDATE
                    `;
                    if (person === undefined)
                        throw new ApiError(401, "unauthenticated", "Dafür ist eine Anmeldung nötig.");
                    if (person.revision !== baseRevision) {
                        throw await editConflict(tx, {
                            currentRevision: person.revision,
                            changedAt: person.updated_at,
                            targetPersonId: session.personId,
                            actions: PERSON_REVISION_ACTIONS,
                        });
                    }
                    if (person.display_name === displayName) {
                        throw new ApiError(409, "no_change", "Der Anzeigename ist schon so.");
                    }
                    const [updated] = await tx<{ revision: number }[]>`
                        UPDATE avesmaps_auth.person SET display_name = ${displayName} WHERE id = ${session.personId}
                        RETURNING revision::int AS revision
                    `;
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [{ kind: "person", id: session.personId, revision: updated!.revision }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "person.renamed",
                            targetPersonId: session.personId,
                            details: { from: person.display_name, to: displayName },
                        },
                    };
                },
            );
        },
    );

    // Den eigenen Eintrag „Verantwortlich für:“ ändert jede Person mit Konto, ohne weiteres Recht (Stufe R, WI-0133).
    app.post(
        "/api/account/responsibility",
        { ...sessionOnly(), schema: { body: ResponsibilityBody, response: { 200: OperationReceipt, ...ERRORS } } },
        async (request) => {
            const session = await own(request);
            const { operationId, baseRevision } = request.body;
            const value = parseResponsibility(request.body.responsibleFor);
            return ownOperation(
                app.database!,
                session,
                { operationId, body: { action: "account.responsibility", responsibleFor: value, baseRevision } },
                (tx) =>
                    changeResponsibility(tx, {
                        personId: session.personId,
                        value,
                        baseRevision,
                        via: "self",
                        actor: actorFields(session, request),
                    }),
            );
        },
    );

    // Die eigene Bezeichnung wählt nur die Person selbst, ohne weiteres Recht (WI-0279 E10).
    app.post(
        "/api/account/bezeichnung",
        { ...sessionOnly(), schema: { body: BezeichnungBody, response: { 200: OperationReceipt, ...ERRORS } } },
        async (request) => {
            const session = await own(request);
            const { operationId, bezeichnung } = request.body;
            return ownOperation(
                app.database!,
                session,
                { operationId, body: { action: "account.bezeichnung", bezeichnung } },
                (tx) =>
                    aendereBezeichnung(tx, {
                        personId: session.personId,
                        bezeichnung,
                        actor: actorFields(session, request),
                    }),
            );
        },
    );

    app.post(
        "/api/account/discord/unlink",
        { ...sessionOnly(), schema: { body: OperationOnlyBody, response: { 200: OperationReceipt, ...ERRORS } } },
        async (request) => {
            const session = await own(request);
            const config = app.authConfig;
            const confirmedRecently =
                Date.now() - session.confirmedAt.getTime() <= config.session.stepUpMinutes * 60_000;
            // Am eigenen Konto zählt auch die frische Passwortanmeldung als Bestätigung (§6.8, Stufe R).
            if (!confirmedRecently) {
                throw new ApiError(403, "reauth_required", "Die Anmeldung muss kurz bestätigt werden.", {
                    need: "confirmation",
                });
            }
            const { operationId } = request.body;
            return ownOperation(
                app.database!,
                session,
                { operationId, body: { action: "account.discord_unlink" } },
                async (tx) => {
                    const [password] = await tx<{ disabled: boolean }[]>`
                        SELECT disabled_at IS NOT NULL AS disabled FROM avesmaps_auth.password_login
                         WHERE person_id = ${session.personId}
                    `;
                    if (password === undefined || password.disabled) {
                        throw new ApiError(
                            409,
                            "last_login_method",
                            "Ohne Discord bliebe kein Weg zur Anmeldung. Erst ein Passwort einrichten.",
                        );
                    }
                    const removed =
                        await tx`DELETE FROM avesmaps_auth.discord_login WHERE person_id = ${session.personId}`;
                    if (removed.count === 0)
                        throw new ApiError(409, "no_change", "Es ist kein Discord-Konto verknüpft.");
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [{ kind: "discord_login", id: session.personId }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "discord.unlinked",
                            targetPersonId: session.personId,
                        },
                    };
                },
            );
        },
    );
};
