import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    AdminRolesOverview,
    GRANTABLE_CAPABILITIES,
    GrantBody,
    OperationReceipt,
    type Capability,
} from "@avesmaps3d/shared";
import {
    ADMIN_ERRORS,
    actorFields,
    adminOperation,
    adminSession,
    guardTarget,
    loadTarget,
} from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import { requireRotation } from "../auth/session-store.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Rollen und Sonderrechte (WI-0120 A7, AUTH-0001 §7.2, §7.3; Betreiber 2026-10-09 D5, T23):
 *
 *     GET  /api/admin/roles                       Betreiber und Inhaber der Sonderrechte    assign_roles (V)
 *     POST /api/admin/people/capabilities/grant   { personId, capability, reason }          grant_special_capabilities (S)
 *     POST /api/admin/people/capabilities/revoke  { personId, capability, reason }          grant_special_capabilities (S)
 *
 * Sonderrechte gehen nur an Admins (Betreiber haben sie aus der Rolle), nie an sich selbst, immer mit Grund. Die Matrix der
 * Rollen steht im Katalog (`capabilities.ts`); die Oberfläche liest sie dort.
 */
export const adminCapabilityRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        "/api/admin/roles",
        { ...protect("assign_roles"), schema: { response: { 200: AdminRolesOverview, ...ADMIN_ERRORS } } },
        async (request) => {
            const { environment } = await adminSession(request);
            const database = app.database!;
            const operators = await database<{ id: string; display_name: string }[]>`
                SELECT p.id, p.display_name FROM avesmaps_auth.person_access a
                  JOIN avesmaps_auth.person p ON p.id = a.person_id AND p.status = 'active'
                 WHERE a.environment = ${environment} AND a.role = 'operator' AND a.status = 'active'
                 ORDER BY lower(p.display_name), p.id
            `;
            const grants = await database<
                {
                    capability: string;
                    granted_at: Date;
                    reason: string;
                    id: string;
                    display_name: string;
                    by_id: string | null;
                    by_name: string | null;
                }[]
            >`
                SELECT g.capability, g.granted_at, g.reason, p.id, p.display_name, b.id AS by_id, b.display_name AS by_name
                  FROM avesmaps_auth.capability_grant g
                  JOIN avesmaps_auth.person p ON p.id = g.person_id
                  LEFT JOIN avesmaps_auth.person b ON b.id = g.granted_by
                 WHERE g.environment = ${environment} AND g.revoked_at IS NULL
                 ORDER BY g.capability, lower(p.display_name), p.id
            `;
            return {
                operators: operators.map((row) => ({ id: row.id, displayName: row.display_name })),
                grants: grants.map((row) => ({
                    person: { id: row.id, displayName: row.display_name },
                    capability: row.capability,
                    grantedAt: row.granted_at.toISOString(),
                    grantedBy:
                        row.by_id === null || row.by_name === null ? null : { id: row.by_id, displayName: row.by_name },
                    reason: row.reason,
                })),
            };
        },
    );

    const grantRoute = (path: string, grant: boolean) =>
        app.post(
            path,
            {
                ...protect("grant_special_capabilities", { writeClass: grant ? "system" : "security" }),
                schema: { body: GrantBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
            },
            async (request) => {
                const session = await adminSession(request);
                const { operationId, personId, capability } = request.body;
                const reason = request.body.reason.trim();
                if (!(GRANTABLE_CAPABILITIES as readonly string[]).includes(capability)) {
                    throw new ApiError(
                        400,
                        "capability_not_grantable",
                        "Dieses Recht ist kein zuteilbares Sonderrecht.",
                    );
                }
                if (reason === "") throw new ApiError(400, "reason_required", "Der Grund fehlt.");
                const environment = session.environment;
                return adminOperation(
                    app.database!,
                    session,
                    {
                        operationId,
                        body: { action: grant ? "people.grant" : "people.ungrant", personId, capability, reason },
                    },
                    async (tx) => {
                        const target = await loadTarget(tx, environment, personId);
                        guardTarget(session, target, app.authConfig);
                        let id: string | undefined;
                        if (grant) {
                            if (target.role === "operator") {
                                throw new ApiError(
                                    409,
                                    "has_by_role",
                                    "Betreiber haben alle Sonderrechte aus ihrer Rolle.",
                                );
                            }
                            if (target.role !== "admin") {
                                throw new ApiError(409, "grant_requires_admin", "Sonderrechte gibt es nur für Admins.");
                            }
                            if (target.status !== "active" || target.access !== "active") {
                                throw new ApiError(
                                    409,
                                    "account_inactive",
                                    "Diese Person ist gesperrt oder hat hier keinen Zugang.",
                                );
                            }
                            const [row] = await tx<{ id: string }[]>`
                                INSERT INTO avesmaps_auth.capability_grant (person_id, environment, capability, granted_by, reason)
                                VALUES (${personId}, ${environment}, ${capability}, ${session.personId}, ${reason})
                                ON CONFLICT (person_id, environment, capability) WHERE revoked_at IS NULL DO NOTHING
                                RETURNING id::text
                            `;
                            if (row === undefined)
                                throw new ApiError(409, "no_change", "Die Person hat dieses Sonderrecht schon.");
                            id = row.id;
                        } else {
                            const [row] = await tx<{ id: string }[]>`
                                UPDATE avesmaps_auth.capability_grant
                                   SET revoked_at = now(), revoked_by = ${session.personId}, revoke_reason = ${reason}
                                 WHERE person_id = ${personId} AND environment = ${environment} AND capability = ${capability}
                                   AND revoked_at IS NULL
                                RETURNING id::text
                            `;
                            if (row === undefined)
                                throw new ApiError(409, "no_change", "Die Person hat dieses Sonderrecht nicht.");
                            id = row.id;
                        }
                        await requireRotation(tx, personId);
                        return {
                            receipt: {
                                environment,
                                affected: [{ kind: "capability_grant", id }],
                                derivedWork: [],
                                warnings: [],
                            },
                            event: {
                                ...actorFields(session, request),
                                action: grant ? "capability.granted" : "capability.revoked",
                                targetPersonId: personId,
                                details: { capability: capability as Capability, reason },
                            },
                        };
                    },
                );
            },
        );

    grantRoute("/api/admin/people/capabilities/grant", true);
    grantRoute("/api/admin/people/capabilities/revoke", false);
};
