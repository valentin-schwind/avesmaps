import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    AdminInvitation,
    InvitationActionBody,
    InvitationCreateBody,
    LinkReceipt,
    OperationReceipt,
    assignableRoles,
    isRole,
    mayManage,
    roleRank,
    type Role,
} from "@avesmaps3d/shared";
import {
    ADMIN_ERRORS,
    actorFields,
    adminOperation,
    adminSession,
    editConflict,
    guardRole,
    linkOrigin,
    linkResponse,
} from "../auth/admin-guard.ts";
import type { AuditAction } from "../auth/audit.ts";
import type { AuthConfig, AuthEnvironment } from "../auth/config.ts";
import {
    INVITATION_VALID_DAYS,
    createInvitation,
    invitationLink,
    type InvitationValidDays,
} from "../auth/invitations.ts";
import { demand, protect } from "../auth/plugin.ts";
import type { SessionRecord, Sql } from "../auth/session-store.ts";
import {
    kopiereEinladung,
    ladeEinladungsRollen,
    merkeFuerEinladung,
    pruefeEinePersonJeRegion,
    pruefeWahl,
    sonderrollenLesbar,
} from "../auth/sonderrollen.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Einladungen verwalten (WI-0120 A7, AUTH-0001 §6.5; D3 C):
 *
 *     GET  /api/admin/invitations           offene und die der letzten 30 Tage      manage_invitations (V)
 *     POST /api/admin/invitations           { role, validDays, note?, discordUserId? } → Link, einmal   (V, bestätigt)
 *     POST /api/admin/invitations/revoke    { invitationId, baseRevision }          manage_invitations (V)
 *     POST /api/admin/invitations/reissue   { invitationId, baseRevision } → neuer Link, alter erlischt (V, bestätigt)
 *
 * Admins laden bis Editor ein; Admin- und Betreiber-Einladungen stellt nur der Betreiber aus, mit frischem Passkey und immer an
 * eine Discord-ID gebunden. Die Liste zeigt vom Token nur die letzten vier Zeichen.
 *
 * Sonderrollen in einer Einladung (WI-0279; Betreiber 2026-11-03: „sonderrollen schon bei der einladung zu vergeben (zusätzlich zur
 * eigentlichen rolle + keine)“): nur mit `grant_special_capabilities` (Stufe S), mit Grund und immer an eine Discord-ID gebunden. Wirksam
 * werden sie erst beim Einlösen, in derselben Transaktion wie der Zugang (`auth/sonderrollen.ts`).
 */
const INVITATION_ACTIONS: readonly AuditAction[] = ["invitation.revoked", "invitation.reissued", "invitation.accepted"];

interface InvitationRow {
    id: string;
    role: string;
    note: string | null;
    token_hint: string;
    bound_discord_user_id: string | null;
    created_at: Date;
    expires_at: Date;
    accepted_at: Date | null;
    revoked_at: Date | null;
    replaced_by: string | null;
    updated_at: Date;
    revision: number;
}

/** Wer darf an einer Einladung mit dieser Rolle handeln: dieselbe Stufenregel wie an Personen. */
function guardInvitationRole(session: SessionRecord, role: Role, config: AuthConfig): void {
    if (!assignableRoles(session.role).includes(role)) {
        throw new ApiError(403, "forbidden_role", "Diese Rolle lädt nur der Betreiber ein.");
    }
    if (roleRank(role) >= roleRank("admin")) demand(session, "assign_admin", config);
}

async function lockInvitation(sql: Sql, environment: AuthEnvironment, id: string): Promise<InvitationRow> {
    const [row] = await sql<InvitationRow[]>`
        SELECT id, role, note, token_hint, bound_discord_user_id, created_at, expires_at, accepted_at, revoked_at, replaced_by,
               updated_at, revision::int AS revision
          FROM avesmaps_auth.invitation WHERE id = ${id} AND environment = ${environment}
           FOR UPDATE
    `;
    if (row === undefined) throw new ApiError(404, "not_found", "Diese Einladung gibt es hier nicht.");
    return row;
}

/** Die erlaubte Gültigkeit, die der ursprünglichen am nächsten kommt. */
function validDaysOf(row: InvitationRow): InvitationValidDays {
    const days = (row.expires_at.getTime() - row.created_at.getTime()) / 86_400_000;
    return INVITATION_VALID_DAYS.reduce((best, option) =>
        Math.abs(option - days) < Math.abs(best - days) ? option : best,
    );
}

export const adminInvitationRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        "/api/admin/invitations",
        {
            ...protect("manage_invitations"),
            schema: {
                response: { 200: Type.Object({ invitations: Type.Array(AdminInvitation) }), ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const rows = await app.database!<
                (InvitationRow & {
                    created_by_id: string | null;
                    created_by_name: string | null;
                    accepted_id: string | null;
                    accepted_name: string | null;
                })[]
            >`
                SELECT i.id, i.role, i.note, i.token_hint, i.bound_discord_user_id, i.created_at, i.expires_at, i.accepted_at,
                       i.revoked_at, i.replaced_by, i.updated_at, i.revision::int AS revision,
                       c.id AS created_by_id, c.display_name AS created_by_name,
                       ap.id AS accepted_id, ap.display_name AS accepted_name
                  FROM avesmaps_auth.invitation i
                  LEFT JOIN avesmaps_auth.person c ON c.id = i.created_by
                  LEFT JOIN avesmaps_auth.person ap ON ap.id = i.accepted_person_id
                 WHERE i.environment = ${session.environment}
                   AND (i.created_at > now() - interval '30 days'
                        OR (i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() - interval '30 days'))
                 ORDER BY i.created_at DESC, i.id
                 LIMIT 200
            `;
            const now = Date.now();
            const sonderrollen = await ladeEinladungsRollen(
                app.database!,
                rows.map((row) => row.id),
            );
            return {
                invitations: rows.flatMap((row) => {
                    if (!isRole(row.role)) return [];
                    const status =
                        row.accepted_at !== null
                            ? ("accepted" as const)
                            : row.replaced_by !== null
                              ? ("replaced" as const)
                              : row.revoked_at !== null
                                ? ("revoked" as const)
                                : row.expires_at.getTime() <= now
                                  ? ("expired" as const)
                                  : ("open" as const);
                    return [
                        {
                            id: row.id,
                            role: row.role,
                            note: row.note,
                            tokenHint: row.token_hint,
                            boundDiscordUserId: row.bound_discord_user_id,
                            status,
                            createdAt: row.created_at.toISOString(),
                            expiresAt: row.expires_at.toISOString(),
                            createdBy:
                                row.created_by_id === null || row.created_by_name === null
                                    ? null
                                    : { id: row.created_by_id, displayName: row.created_by_name },
                            acceptedAt: row.accepted_at?.toISOString() ?? null,
                            acceptedPerson:
                                row.accepted_id === null || row.accepted_name === null
                                    ? null
                                    : { id: row.accepted_id, displayName: row.accepted_name },
                            revokedAt: row.revoked_at?.toISOString() ?? null,
                            revision: row.revision,
                            manageable: mayManage(session.role, row.role),
                            sonderrollen: sonderrollen.get(row.id) ?? [],
                        },
                    ];
                }),
            };
        },
    );

    app.post(
        "/api/admin/invitations",
        {
            ...protect("manage_invitations", { confirm: "recent", writeClass: "system" }),
            schema: { body: InvitationCreateBody, response: { 200: LinkReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, role, validDays, discordUserId } = request.body;
            const note = request.body.note?.trim() || undefined;
            const gewaehlt = request.body.sonderrollen ?? [];
            const sonderrollenGrund = request.body.sonderrollenGrund?.trim() ?? "";
            guardInvitationRole(session, role, app.authConfig);
            if (gewaehlt.length > 0) {
                demand(session, "grant_special_capabilities", app.authConfig);
                if (app.sonderrollenAbgleich !== undefined) {
                    throw new ApiError(
                        409,
                        "sonderrollen_production",
                        "Sonderrollen werden in Production vergeben; die Stage übernimmt sie von dort.",
                    );
                }
                if (discordUserId === undefined) {
                    throw new ApiError(
                        400,
                        "invitation_binding_required",
                        "Einladungen mit Sonderrolle brauchen die Discord-ID der Person.",
                    );
                }
                if (sonderrollenGrund === "") throw new ApiError(400, "reason_required", "Der Grund fehlt.");
                if (!(await sonderrollenLesbar(app.database!))) {
                    throw new ApiError(503, "auth_unavailable", "Die Sonderrollen sind hier noch nicht eingerichtet.");
                }
            }
            const environment = session.environment;
            const out: { invitation?: { token: string; expiresAt: Date } } = {};
            const receipt = await adminOperation(
                app.database!,
                session,
                {
                    operationId,
                    body: {
                        action: "invitations.create",
                        role,
                        validDays,
                        note,
                        discordUserId,
                        ...(gewaehlt.length > 0 ? { sonderrollen: gewaehlt, sonderrollenGrund } : {}),
                    },
                },
                async (tx) => {
                    const wahlen = [];
                    for (const wahl of gewaehlt) {
                        const geprueft = await pruefeWahl(tx, wahl.sonderrolle, wahl.regionen);
                        await pruefeEinePersonJeRegion(tx, environment, geprueft, null);
                        wahlen.push(geprueft);
                    }
                    const invitation = await createInvitation(tx, {
                        environment,
                        role,
                        validDays,
                        note: note ?? null,
                        boundDiscordUserId: discordUserId ?? null,
                        createdBy: session.personId,
                    });
                    await merkeFuerEinladung(tx, invitation.id, wahlen, sonderrollenGrund);
                    out.invitation = invitation;
                    return {
                        receipt: {
                            environment,
                            affected: [{ kind: "invitation", id: invitation.id, revision: 1 }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "invitation.created",
                            targetRef: invitation.id,
                            details: {
                                role,
                                validDays,
                                bound: discordUserId !== undefined,
                                tokenHint: invitation.tokenHint,
                                ...(note === undefined ? {} : { note }),
                                ...(wahlen.length === 0
                                    ? {}
                                    : {
                                          sonderrollen: wahlen.flatMap((wahl) =>
                                              wahl.regionen.map((region) =>
                                                  region === null
                                                      ? wahl.sonderrolle
                                                      : `${wahl.sonderrolle} (${region.name})`,
                                              ),
                                          ),
                                          grund: sonderrollenGrund,
                                      }),
                            },
                        },
                    };
                },
            );
            return linkResponse(
                receipt,
                out.invitation === undefined
                    ? undefined
                    : {
                          url: invitationLink(linkOrigin(request, app.authConfig), out.invitation.token),
                          expiresAt: out.invitation.expiresAt,
                      },
            );
        },
    );

    app.post(
        "/api/admin/invitations/revoke",
        {
            ...protect("manage_invitations", { writeClass: "security" }),
            schema: { body: InvitationActionBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, invitationId, baseRevision } = request.body;
            const environment = session.environment;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "invitations.revoke", invitationId, baseRevision } },
                async (tx) => {
                    const row = await lockInvitation(tx, environment, invitationId);
                    if (!isRole(row.role)) throw new ApiError(404, "not_found", "Diese Einladung gibt es hier nicht.");
                    guardRole(session, row.role, app.authConfig);
                    if (row.revision !== baseRevision) {
                        throw await editConflict(tx, {
                            currentRevision: row.revision,
                            changedAt: row.updated_at,
                            targetRef: invitationId,
                            actions: INVITATION_ACTIONS,
                        });
                    }
                    if (row.accepted_at !== null || row.revoked_at !== null) {
                        throw new ApiError(
                            409,
                            "invitation_closed",
                            "Diese Einladung ist schon angenommen oder zurückgezogen.",
                        );
                    }
                    const [updated] = await tx<{ revision: number }[]>`
                        UPDATE avesmaps_auth.invitation SET revoked_at = now(), revoked_by = ${session.personId}
                         WHERE id = ${invitationId}
                        RETURNING revision::int AS revision
                    `;
                    return {
                        receipt: {
                            environment,
                            affected: [{ kind: "invitation", id: invitationId, revision: updated!.revision }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "invitation.revoked",
                            targetRef: invitationId,
                            details: { tokenHint: row.token_hint },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/admin/invitations/reissue",
        {
            ...protect("manage_invitations", { confirm: "recent", writeClass: "system" }),
            schema: { body: InvitationActionBody, response: { 200: LinkReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, invitationId, baseRevision } = request.body;
            const environment = session.environment;
            const out: { invitation?: { token: string; expiresAt: Date } } = {};
            const receipt = await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "invitations.reissue", invitationId, baseRevision } },
                async (tx) => {
                    const row = await lockInvitation(tx, environment, invitationId);
                    if (!isRole(row.role)) throw new ApiError(404, "not_found", "Diese Einladung gibt es hier nicht.");
                    guardInvitationRole(session, row.role, app.authConfig);
                    // Ein Admin stellt keine Einladung neu aus, die jemandem Sonderrollen bringt.
                    if ((await ladeEinladungsRollen(tx, [invitationId])).has(invitationId)) {
                        demand(session, "grant_special_capabilities", app.authConfig);
                    }
                    if (row.revision !== baseRevision) {
                        throw await editConflict(tx, {
                            currentRevision: row.revision,
                            changedAt: row.updated_at,
                            targetRef: invitationId,
                            actions: INVITATION_ACTIONS,
                        });
                    }
                    if (row.accepted_at !== null || row.revoked_at !== null) {
                        throw new ApiError(
                            409,
                            "invitation_closed",
                            "Diese Einladung ist schon angenommen oder zurückgezogen.",
                        );
                    }
                    const invitation = await createInvitation(tx, {
                        environment,
                        role: row.role,
                        validDays: validDaysOf(row),
                        note: row.note,
                        boundDiscordUserId: row.bound_discord_user_id,
                        createdBy: session.personId,
                    });
                    if (await sonderrollenLesbar(tx)) await kopiereEinladung(tx, invitationId, invitation.id);
                    const [old] = await tx<{ revision: number }[]>`
                        UPDATE avesmaps_auth.invitation
                           SET revoked_at = now(), revoked_by = ${session.personId}, replaced_by = ${invitation.id}
                         WHERE id = ${invitationId}
                        RETURNING revision::int AS revision
                    `;
                    out.invitation = invitation;
                    return {
                        receipt: {
                            environment,
                            affected: [
                                { kind: "invitation", id: invitation.id, revision: 1 },
                                { kind: "invitation", id: invitationId, revision: old!.revision },
                            ],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "invitation.reissued",
                            targetRef: invitationId,
                            details: { tokenHint: invitation.tokenHint, previousHint: row.token_hint },
                        },
                    };
                },
            );
            return linkResponse(
                receipt,
                out.invitation === undefined
                    ? undefined
                    : {
                          url: invitationLink(linkOrigin(request, app.authConfig), out.invitation.token),
                          expiresAt: out.invitation.expiresAt,
                      },
            );
        },
    );
};
