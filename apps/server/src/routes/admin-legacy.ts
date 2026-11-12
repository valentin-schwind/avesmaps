import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    AdminLegacyIdentity,
    LegacyMapBody,
    LegacyQuery,
    LegacyUnmapBody,
    OperationReceipt,
    isRole,
} from "@avesmaps3d/shared";
import {
    ADMIN_ERRORS,
    actorFields,
    adminOperation,
    adminSession,
    editConflict,
    guardRole,
    guardTarget,
    loadTarget,
    refuseSelf,
} from "../auth/admin-guard.ts";
import type { AuditAction } from "../auth/audit.ts";
import { protect } from "../auth/plugin.ts";
import type { Sql } from "../auth/session-store.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Legacy-Namen zuordnen (WI-0120 A7, AUTH-0001 §6.9): Schlüssel ist Legacys `users.id`, nie der Name. Zuordnen kann nur die
 * Verwaltung, mit Begründung, umkehrbar, im Protokoll; nie automatisch über gleiche Namen. Eine Legacy-Maschine („Import/
 * System“) ist nie eine Person.
 *
 *     GET  /api/admin/legacy?status=unmapped|mapped|all&q=     manage_people (V)
 *     POST /api/admin/legacy/map     { legacyIdentityId, personId, evidence, baseRevision }
 *     POST /api/admin/legacy/unmap   { legacyIdentityId, baseRevision }
 */
const LEGACY_ACTIONS: readonly AuditAction[] = ["legacy.mapped", "legacy.unmapped"];

interface LegacyRow {
    id: string;
    legacy_user_id: string | null;
    legacy_name: string;
    known_names: string[];
    kind: "person" | "machine" | "deleted";
    person_id: string | null;
    person_name: string | null;
    person_role: string | null;
    mapped_at: Date | null;
    mapped_by_id: string | null;
    mapped_by_name: string | null;
    evidence: string | null;
    revision: number;
    updated_at: Date;
}

const ref = (id: string | null, displayName: string | null): { id: string; displayName: string } | null =>
    id === null || displayName === null ? null : { id, displayName };

async function legacyRows(
    sql: Sql,
    environment: string,
    filter: { id?: string; status?: "unmapped" | "mapped" | "all"; q?: string; lock?: boolean },
): Promise<LegacyRow[]> {
    return sql<LegacyRow[]>`
        SELECT l.id::text, l.legacy_user_id::text, l.legacy_name, l.known_names, l.kind, l.person_id,
               p.display_name AS person_name, pa.role AS person_role, l.mapped_at, m.id AS mapped_by_id,
               m.display_name AS mapped_by_name, l.evidence, l.revision::int AS revision, l.updated_at
          FROM avesmaps_auth.legacy_identity l
          LEFT JOIN avesmaps_auth.person p ON p.id = l.person_id
          LEFT JOIN avesmaps_auth.person_access pa ON pa.person_id = l.person_id AND pa.environment = ${environment}
          LEFT JOIN avesmaps_auth.person m ON m.id = l.mapped_by
         WHERE true
           ${filter.id === undefined ? sql`` : sql`AND l.id = ${filter.id}::bigint`}
           ${filter.status === "unmapped" ? sql`AND l.person_id IS NULL` : sql``}
           ${filter.status === "mapped" ? sql`AND l.person_id IS NOT NULL` : sql``}
           ${
               filter.q === undefined
                   ? sql``
                   : sql`AND (strpos(lower(l.legacy_name), lower(${filter.q})) > 0
                         OR EXISTS (SELECT 1 FROM unnest(l.known_names) n WHERE strpos(lower(n), lower(${filter.q})) > 0))`
           }
         ORDER BY lower(l.legacy_name), l.id
         LIMIT 200
           ${filter.lock === true ? sql`FOR UPDATE OF l` : sql``}
    `;
}

function toIdentity(row: LegacyRow): AdminLegacyIdentity {
    return {
        id: row.id,
        legacyUserId: row.legacy_user_id,
        legacyName: row.legacy_name,
        knownNames: row.known_names,
        kind: row.kind,
        person: ref(row.person_id, row.person_name),
        mappedAt: row.mapped_at?.toISOString() ?? null,
        mappedBy: ref(row.mapped_by_id, row.mapped_by_name),
        evidence: row.evidence,
        revision: row.revision,
    };
}

export const adminLegacyRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        "/api/admin/legacy",
        {
            ...protect("manage_people"),
            schema: {
                querystring: LegacyQuery,
                response: { 200: Type.Object({ identities: Type.Array(AdminLegacyIdentity) }), ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const { environment } = await adminSession(request);
            const filter = {
                status: request.query.status ?? "all",
                ...(request.query.q === undefined ? {} : { q: request.query.q }),
            };
            const rows = await legacyRows(app.database!, environment, filter);
            return { identities: rows.map(toIdentity) };
        },
    );

    async function lockIdentity(sql: Sql, environment: string, id: string): Promise<LegacyRow> {
        const [row] = await legacyRows(sql, environment, { id, lock: true });
        if (row === undefined) throw new ApiError(404, "not_found", "Diesen Legacy-Namen gibt es nicht.");
        return row;
    }

    app.post(
        "/api/admin/legacy/map",
        {
            ...protect("manage_people", { writeClass: "system" }),
            schema: { body: LegacyMapBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, legacyIdentityId, personId, baseRevision } = request.body;
            const evidence = request.body.evidence.trim();
            if (evidence === "") throw new ApiError(400, "reason_required", "Die Begründung fehlt.");
            const environment = session.environment;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "legacy.map", legacyIdentityId, personId, evidence, baseRevision } },
                async (tx) => {
                    const identity = await lockIdentity(tx, environment, legacyIdentityId);
                    const target = await loadTarget(tx, environment, personId);
                    guardTarget(session, target, app.authConfig);
                    if (identity.revision !== baseRevision) {
                        throw await editConflict(tx, {
                            currentRevision: identity.revision,
                            changedAt: identity.updated_at,
                            targetRef: `legacy:${legacyIdentityId}`,
                            actions: LEGACY_ACTIONS,
                        });
                    }
                    if (identity.kind === "machine") {
                        throw new ApiError(
                            409,
                            "legacy_machine",
                            "Ein Import- oder Systemkonto aus Legacy ist keine Person.",
                        );
                    }
                    if (identity.person_id !== null) {
                        throw new ApiError(409, "legacy_already_mapped", "Dieser Legacy-Name ist schon zugeordnet.");
                    }
                    const [updated] = await tx<{ revision: number }[]>`
                        UPDATE avesmaps_auth.legacy_identity
                           SET person_id = ${personId}, mapped_by = ${session.personId}, mapped_at = now(), evidence = ${evidence}
                         WHERE id = ${legacyIdentityId}::bigint
                        RETURNING revision::int AS revision
                    `;
                    return {
                        receipt: {
                            environment,
                            affected: [{ kind: "legacy_identity", id: legacyIdentityId, revision: updated!.revision }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "legacy.mapped",
                            targetPersonId: personId,
                            targetRef: `legacy:${legacyIdentityId}`,
                            details: {
                                legacyName: identity.legacy_name,
                                legacyUserId: identity.legacy_user_id,
                                evidence,
                            },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/admin/legacy/unmap",
        {
            ...protect("manage_people", { writeClass: "system" }),
            schema: { body: LegacyUnmapBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, legacyIdentityId, baseRevision } = request.body;
            const environment = session.environment;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "legacy.unmap", legacyIdentityId, baseRevision } },
                async (tx) => {
                    const identity = await lockIdentity(tx, environment, legacyIdentityId);
                    if (identity.revision !== baseRevision) {
                        throw await editConflict(tx, {
                            currentRevision: identity.revision,
                            changedAt: identity.updated_at,
                            targetRef: `legacy:${legacyIdentityId}`,
                            actions: LEGACY_ACTIONS,
                        });
                    }
                    if (identity.person_id === null) {
                        throw new ApiError(409, "no_change", "Dieser Legacy-Name ist keiner Person zugeordnet.");
                    }
                    refuseSelf(session, identity.person_id);
                    // Ohne Zugang hier gilt die strengste Stufe: dann löst nur der Betreiber die Zuordnung.
                    const role =
                        identity.person_role !== null && isRole(identity.person_role)
                            ? identity.person_role
                            : "operator";
                    guardRole(session, role, app.authConfig);
                    const [updated] = await tx<{ revision: number }[]>`
                        UPDATE avesmaps_auth.legacy_identity
                           SET person_id = NULL, mapped_by = NULL, mapped_at = NULL, evidence = NULL
                         WHERE id = ${legacyIdentityId}::bigint
                        RETURNING revision::int AS revision
                    `;
                    return {
                        receipt: {
                            environment,
                            affected: [{ kind: "legacy_identity", id: legacyIdentityId, revision: updated!.revision }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "legacy.unmapped",
                            targetPersonId: identity.person_id,
                            targetRef: `legacy:${legacyIdentityId}`,
                            details: { legacyName: identity.legacy_name, legacyUserId: identity.legacy_user_id },
                        },
                    };
                },
            );
        },
    );
};
