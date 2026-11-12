import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    AdminPerson,
    AdminPersonDetail,
    LockBody,
    OperationReceipt,
    PersonResponsibilityBody,
    PersonRevisionBody,
    RoleChangeBody,
    SessionsRevokeBody,
    UUID_PATTERN,
    roleRank,
} from "@avesmaps3d/shared";
import {
    ADMIN_ERRORS,
    actorFields,
    adminOperation,
    adminSession,
    editConflict,
    guardTarget,
    keepAnOperator,
    loadTarget,
    revokeGrants,
} from "../auth/admin-guard.ts";
import { listPeople, personDetail } from "../auth/admin-people.ts";
import type { AuditAction } from "../auth/audit.ts";
import { protect } from "../auth/plugin.ts";
import { PERSON_REVISION_ACTIONS, changeResponsibility, parseResponsibility } from "../auth/responsibility.ts";
import { requireRotation, revokePersonIssued, revokePersonSessions } from "../auth/session-store.ts";
import { ApiError } from "../http/api-error.ts";
import { assertWritable } from "../system/write-guard.ts";

/**
 * Personen verwalten (WI-0120 A7, AUTH-0001 §7.3, §12.2):
 *
 *     GET  /api/admin/people                     Liste dieser Umgebung                       manage_people (V)
 *     GET  /api/admin/people/:personId           Detail: Anmeldewege, Sitzungen, Sonderrechte manage_people (V)
 *     POST /api/admin/people/role                { personId, role, baseRevision }            assign_roles (V, bestätigt)
 *     POST /api/admin/people/access/revoke       { personId, baseRevision }                  assign_roles (V, bestätigt)
 *     POST /api/admin/people/lock                { personId, reason, baseRevision }          manage_people (V, bestätigt)
 *     POST /api/admin/people/unlock              { personId, baseRevision }                  manage_people (V, bestätigt)
 *     POST /api/admin/people/sessions/revoke     { personId, sessionId? }                    manage_people (V)
 *     POST /api/admin/people/responsibility      { personId, responsibleFor, baseRevision }  set_responsibility (V)
 *
 * Jede Handlung trägt `operationId`; Rolle und Zugang vergleichen `baseRevision` mit dem Zugang dieser Umgebung, Sperren mit
 * der Person. Betrifft eine Handlung Admins oder Betreiber, verlangt sie `assign_admin` mit frischem Passkey (Stufe S).
 */
const ACCESS_ACTIONS: readonly AuditAction[] = ["person.role_changed", "access.revoked"];

export const adminPeopleRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        "/api/admin/people",
        {
            ...protect("manage_people"),
            schema: { response: { 200: Type.Object({ people: Type.Array(AdminPerson) }), ...ADMIN_ERRORS } },
        },
        async (request) => ({ people: await listPeople(app.database!, await adminSession(request)) }),
    );

    app.get(
        "/api/admin/people/:personId",
        {
            ...protect("manage_people"),
            schema: {
                params: Type.Object({ personId: Type.String({ pattern: UUID_PATTERN }) }),
                response: { 200: AdminPersonDetail, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const detail = await personDetail(app.database!, await adminSession(request), request.params.personId);
            if (detail === undefined) throw new ApiError(404, "not_found", "Diese Person gibt es hier nicht.");
            return detail;
        },
    );

    app.post(
        "/api/admin/people/role",
        {
            ...protect("assign_roles", { confirm: "recent", writeClass: "by_direction" }),
            schema: { body: RoleChangeBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, personId, role, baseRevision } = request.body;
            const environment = session.environment;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "people.role", personId, role, baseRevision } },
                async (tx) => {
                    const target = await loadTarget(tx, environment, personId);
                    guardTarget(session, target, app.authConfig, role);
                    const restored = target.access === "revoked";
                    // Mit Richtung (SYS-4): hoch oder den Zugang zurückgeben gewährt etwas (Systemsperre hält es an), herab schützt.
                    const grants = restored || roleRank(role) > roleRank(target.role);
                    await assertWritable(request, grants ? "system" : "security");
                    if (target.accessRevision !== baseRevision) {
                        throw await editConflict(tx, {
                            currentRevision: target.accessRevision,
                            changedAt: target.accessUpdatedAt,
                            targetPersonId: personId,
                            actions: ACCESS_ACTIONS,
                        });
                    }
                    if (!restored && target.role === role) {
                        throw new ApiError(409, "no_change", "Die Person hat diese Rolle schon.");
                    }
                    if (role !== "operator") await keepAnOperator(tx, environment, target);
                    const [access] = await tx<{ revision: number }[]>`
                        UPDATE avesmaps_auth.person_access
                           SET role = ${role}, status = 'active', revoked_at = NULL, revoked_by = NULL,
                               granted_by = CASE WHEN status = 'revoked' THEN ${session.personId}::uuid ELSE granted_by END,
                               granted_at = CASE WHEN status = 'revoked' THEN now() ELSE granted_at END
                         WHERE person_id = ${personId} AND environment = ${environment}
                        RETURNING revision::int AS revision
                    `;
                    const revoked =
                        roleRank(role) < roleRank("admin")
                            ? await revokeGrants(tx, environment, personId, session.personId, "role_changed")
                            : [];
                    await requireRotation(tx, personId);
                    // Herabgestuft (G2-01, Betreiber 2026-11-10): Was die Person in der höheren Rolle ausgestellt hat, gilt nicht mehr.
                    const issued =
                        roleRank(role) < roleRank(target.role)
                            ? await revokePersonIssued(tx, personId, session.personId, environment, "alle")
                            : undefined;
                    return {
                        receipt: {
                            environment,
                            affected: [{ kind: "person_access", id: personId, revision: access!.revision }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "person.role_changed",
                            targetPersonId: personId,
                            details: {
                                from: target.role,
                                to: role,
                                ...(revoked.length > 0 ? { revokedCapabilities: revoked } : {}),
                                ...(restored ? { restored: true } : {}),
                                // Nur wenn etwas zurückgezogen wurde: Eine Herabstufung ohne offene Einladungen schreibt dasselbe wie vorher.
                                ...(issued && issued.revokedInvitations + issued.revokedLinks > 0 ? issued : {}),
                            },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/admin/people/access/revoke",
        {
            ...protect("assign_roles", { confirm: "recent", writeClass: "security" }),
            schema: { body: PersonRevisionBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, personId, baseRevision } = request.body;
            const environment = session.environment;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "people.access_revoke", personId, baseRevision } },
                async (tx) => {
                    const target = await loadTarget(tx, environment, personId);
                    guardTarget(session, target, app.authConfig);
                    if (target.accessRevision !== baseRevision) {
                        throw await editConflict(tx, {
                            currentRevision: target.accessRevision,
                            changedAt: target.accessUpdatedAt,
                            targetPersonId: personId,
                            actions: ACCESS_ACTIONS,
                        });
                    }
                    if (target.access === "revoked") {
                        throw new ApiError(409, "no_change", "Der Zugang ist schon entzogen.");
                    }
                    await keepAnOperator(tx, environment, target);
                    const [access] = await tx<{ revision: number }[]>`
                        UPDATE avesmaps_auth.person_access
                           SET status = 'revoked', revoked_at = now(), revoked_by = ${session.personId}
                         WHERE person_id = ${personId} AND environment = ${environment}
                        RETURNING revision::int AS revision
                    `;
                    const revoked = await revokeGrants(tx, environment, personId, session.personId, "access_revoked");
                    const ended = await tx`
                        UPDATE avesmaps_auth.session
                           SET revoked_at = now(), revoked_by = ${session.personId}, revoke_reason = 'access_revoked'
                         WHERE person_id = ${personId} AND environment = ${environment} AND revoked_at IS NULL
                    `;
                    const issued = await revokePersonIssued(tx, personId, session.personId, environment);
                    return {
                        receipt: {
                            environment,
                            affected: [{ kind: "person_access", id: personId, revision: access!.revision }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "access.revoked",
                            targetPersonId: personId,
                            details: {
                                role: target.role,
                                sessions: ended.count,
                                ...issued,
                                ...(revoked.length > 0 ? { revokedCapabilities: revoked } : {}),
                            },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/admin/people/lock",
        {
            ...protect("manage_people", { confirm: "recent", writeClass: "security" }),
            schema: { body: LockBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, personId, baseRevision } = request.body;
            const reason = request.body.reason.trim();
            if (reason === "") throw new ApiError(400, "reason_required", "Der Grund der Sperre fehlt.");
            const environment = session.environment;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "people.lock", personId, reason, baseRevision } },
                async (tx) => {
                    const target = await loadTarget(tx, environment, personId);
                    guardTarget(session, target, app.authConfig);
                    if (target.revision !== baseRevision) {
                        throw await editConflict(tx, {
                            currentRevision: target.revision,
                            changedAt: target.updatedAt,
                            targetPersonId: personId,
                            actions: PERSON_REVISION_ACTIONS,
                        });
                    }
                    if (target.status !== "active") {
                        throw new ApiError(409, "no_change", "Die Person ist nicht aktiv.");
                    }
                    await keepAnOperator(tx, environment, target);
                    const [person] = await tx<{ revision: number }[]>`
                        UPDATE avesmaps_auth.person
                           SET status = 'locked', locked_at = now(), locked_by = ${session.personId}, lock_reason = ${reason}
                         WHERE id = ${personId}
                        RETURNING revision::int AS revision
                    `;
                    const ended = await revokePersonSessions(tx, personId, session.personId, "locked");
                    const issued = await revokePersonIssued(tx, personId, session.personId);
                    return {
                        receipt: {
                            environment,
                            affected: [{ kind: "person", id: personId, revision: person!.revision }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "person.locked",
                            targetPersonId: personId,
                            details: { reason, sessions: ended.length, ...issued },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/admin/people/unlock",
        {
            ...protect("manage_people", { confirm: "recent", writeClass: "system" }),
            schema: { body: PersonRevisionBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, personId, baseRevision } = request.body;
            const environment = session.environment;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "people.unlock", personId, baseRevision } },
                async (tx) => {
                    const target = await loadTarget(tx, environment, personId);
                    guardTarget(session, target, app.authConfig);
                    if (target.revision !== baseRevision) {
                        throw await editConflict(tx, {
                            currentRevision: target.revision,
                            changedAt: target.updatedAt,
                            targetPersonId: personId,
                            actions: PERSON_REVISION_ACTIONS,
                        });
                    }
                    if (target.status !== "locked") {
                        throw new ApiError(409, "no_change", "Die Person ist nicht gesperrt.");
                    }
                    const [person] = await tx<{ revision: number }[]>`
                        UPDATE avesmaps_auth.person
                           SET status = 'active', locked_at = NULL, locked_by = NULL, lock_reason = NULL
                         WHERE id = ${personId}
                        RETURNING revision::int AS revision
                    `;
                    return {
                        receipt: {
                            environment,
                            affected: [{ kind: "person", id: personId, revision: person!.revision }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "person.unlocked",
                            targetPersonId: personId,
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/admin/people/sessions/revoke",
        {
            ...protect("manage_people", { writeClass: "security" }),
            schema: { body: SessionsRevokeBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, personId, sessionId } = request.body;
            const environment = session.environment;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "people.sessions_revoke", personId, sessionId } },
                async (tx) => {
                    const target = await loadTarget(tx, environment, personId);
                    guardTarget(session, target, app.authConfig);
                    const ended = await tx<{ id: string }[]>`
                        UPDATE avesmaps_auth.session
                           SET revoked_at = now(), revoked_by = ${session.personId}, revoke_reason = 'admin'
                         WHERE person_id = ${personId} AND environment = ${environment} AND revoked_at IS NULL
                           ${sessionId === undefined ? tx`` : tx`AND id = ${sessionId}`}
                        RETURNING id
                    `;
                    if (ended.length === 0) {
                        throw new ApiError(409, "no_change", "Es gibt keine offene Sitzung zum Beenden.");
                    }
                    return {
                        receipt: {
                            environment,
                            affected: ended.map((row) => ({ kind: "session", id: row.id })),
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "session.revoked",
                            targetPersonId: personId,
                            details: {
                                reason: "admin",
                                count: ended.length,
                                ...(sessionId === undefined ? {} : { sessionId }),
                            },
                        },
                    };
                },
            );
        },
    );

    /**
     * „Verantwortlich für:“ einer Person (WI-0133, Betreiber 2026-10-10: „betreiben können es auch ändern“): nur mit
     * `set_responsibility` (Betreiber-Vorlage, Stufe V), an jeder Person dieser Umgebung, auch an sich selbst und an Admins und
     * Betreibern; ein freier Text gewährt nichts, deshalb weder die Stufenregel noch `assign_admin`. Ein aufgelöstes Konto nicht.
     * Klasse `system`: Unter der Systemsperre hält es an wie jede Verwaltungshandlung; den eigenen Eintrag im Konto nicht.
     */
    app.post(
        "/api/admin/people/responsibility",
        {
            ...protect("set_responsibility", { writeClass: "system" }),
            schema: { body: PersonResponsibilityBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, personId, baseRevision } = request.body;
            const value = parseResponsibility(request.body.responsibleFor);
            return adminOperation(
                app.database!,
                session,
                {
                    operationId,
                    body: { action: "people.responsibility", personId, responsibleFor: value, baseRevision },
                },
                async (tx) => {
                    // Nur eine Person mit Zugang in dieser Umgebung; aufgelöst (409) prüft `changeResponsibility`.
                    await loadTarget(tx, session.environment, personId);
                    return changeResponsibility(tx, {
                        personId,
                        value,
                        baseRevision,
                        via: personId === session.personId ? "self" : "operator",
                        actor: actorFields(session, request),
                    });
                },
            );
        },
    );
};
