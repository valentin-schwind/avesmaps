import { invitationRequiresDiscordBinding, isRole, type Role } from "@avesmaps3d/shared";
import { ApiError } from "../http/api-error.ts";
import type { AuditEvent } from "./audit.ts";
import type { AuthEnvironment } from "./config.ts";
import type { Sql } from "./session-store.ts";
import { loeseEinladungEin } from "./sonderrollen.ts";
import { randomToken, tokenHash } from "./tokens.ts";

/**
 * Einladungen (WI-0120 A6, AUTH-0001 §6.5; Betreiber 2026-10-09: D3 C, Admin- und Betreiber-Einladungen immer an eine
 * Discord-ID gebunden). Einmalig, mit Ablauf und Rolle; nur der Hash steht in der Datenbank, das Geheimnis im Fragment des
 * Links (`/einladung#…`), den Discords Vorschau nie einlöst. Eine Einladung ist immer eine NEUE Person.
 */
export const INVITATION_VALID_DAYS = [1, 3, 7, 14] as const;
export type InvitationValidDays = (typeof INVITATION_VALID_DAYS)[number];

export interface OpenInvitation {
    id: string;
    role: Role;
    environment: AuthEnvironment;
    boundDiscordUserId: string | null;
    expiresAt: Date;
    invitedBy: string | null;
    tokenHint: string;
}

export function invitationLink(origin: string, token: string): string {
    return `${origin}/einladung#${token}`;
}

export async function createInvitation(
    sql: Sql,
    input: {
        environment: AuthEnvironment;
        role: Role;
        validDays: InvitationValidDays;
        note?: string | null | undefined;
        boundDiscordUserId?: string | null | undefined;
        createdBy: string | null;
    },
    now: Date = new Date(),
): Promise<{ id: string; token: string; tokenHint: string; expiresAt: Date }> {
    const bound = input.boundDiscordUserId ?? null;
    if (bound !== null && !/^[0-9]{15,21}$/u.test(bound)) {
        throw new ApiError(400, "discord_id_invalid", "Eine Discord-ID besteht aus 15 bis 21 Ziffern.");
    }
    if (invitationRequiresDiscordBinding(input.role) && bound === null) {
        throw new ApiError(
            400,
            "invitation_binding_required",
            "Einladungen für Admin und Betreiber brauchen die Discord-ID der Person.",
        );
    }
    const token = randomToken();
    const tokenHint = token.slice(-4);
    const expiresAt = new Date(now.getTime() + input.validDays * 24 * 60 * 60_000);
    const [row] = await sql<{ id: string }[]>`
        INSERT INTO avesmaps_auth.invitation
            (token_hash, token_hint, environment, role, note, bound_discord_user_id, created_by, created_at, expires_at)
        VALUES (${tokenHash(token)}, ${tokenHint}, ${input.environment}, ${input.role}, ${input.note ?? null}, ${bound},
                ${input.createdBy}, ${now}, ${expiresAt})
        RETURNING id
    `;
    return { id: row!.id, token, tokenHint, expiresAt };
}

interface InvitationRow {
    id: string;
    role: string;
    environment: AuthEnvironment;
    bound_discord_user_id: string | null;
    expires_at: Date;
    invited_by: string | null;
    token_hint: string;
}

function toOpen(row: InvitationRow | undefined): OpenInvitation | undefined {
    if (row === undefined || !isRole(row.role)) return undefined;
    return {
        id: row.id,
        role: row.role,
        environment: row.environment,
        boundDiscordUserId: row.bound_discord_user_id,
        expiresAt: row.expires_at,
        invitedBy: row.invited_by,
        tokenHint: row.token_hint,
    };
}

/** Eine offene Einladung dieser Umgebung zu einem Token (nicht angenommen, nicht zurückgezogen, nicht abgelaufen). */
export async function findOpenInvitation(
    sql: Sql,
    token: string,
    environment: AuthEnvironment,
): Promise<OpenInvitation | undefined> {
    const [row] = await sql<InvitationRow[]>`
        SELECT i.id, i.role, i.environment, i.bound_discord_user_id, i.expires_at, p.display_name AS invited_by, i.token_hint
          FROM avesmaps_auth.invitation i LEFT JOIN avesmaps_auth.person p ON p.id = i.created_by
         WHERE i.token_hash = ${tokenHash(token)} AND i.environment = ${environment}
           AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
    `;
    return toOpen(row);
}

export async function findOpenInvitationById(sql: Sql, id: string): Promise<OpenInvitation | undefined> {
    const [row] = await sql<InvitationRow[]>`
        SELECT i.id, i.role, i.environment, i.bound_discord_user_id, i.expires_at, p.display_name AS invited_by, i.token_hint
          FROM avesmaps_auth.invitation i LEFT JOIN avesmaps_auth.person p ON p.id = i.created_by
         WHERE i.id = ${id} AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
    `;
    return toOpen(row);
}

/**
 * Nimmt die Einladung atomar an und legt die neue Person samt Zugang an; gibt ihre Kennung zurück, oder `undefined`, wenn eine
 * andere Annahme schneller war (nur eine gewinnt). Den Anmeldeweg legt der Aufrufer in derselben Transaktion an, die Sonderrollen der
 * Einladung kommen hier hinzu (WI-0279).
 */
export async function acceptInvitation(
    sql: Sql,
    invitation: OpenInvitation,
    displayName: string,
    meta: Pick<AuditEvent, "ipPrefix" | "clientLabel"> = {},
): Promise<string | undefined> {
    const [person] = await sql<{ id: string }[]>`
        INSERT INTO avesmaps_auth.person (display_name, created_by, created_via)
        SELECT ${displayName}, created_by, 'invitation' FROM avesmaps_auth.invitation WHERE id = ${invitation.id}
        RETURNING id
    `;
    const personId = person!.id;
    const claimed = await sql`
        UPDATE avesmaps_auth.invitation SET accepted_at = now(), accepted_person_id = ${personId}
         WHERE id = ${invitation.id} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
    `;
    if (claimed.count !== 1) return undefined;
    await sql`
        INSERT INTO avesmaps_auth.person_access (person_id, environment, role, granted_by)
        SELECT ${personId}, environment, role, created_by FROM avesmaps_auth.invitation WHERE id = ${invitation.id}
    `;
    await loeseEinladungEin(sql, { invitationId: invitation.id, personId, environment: invitation.environment }, meta);
    return personId;
}
