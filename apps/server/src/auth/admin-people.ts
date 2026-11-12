import {
    isRole,
    mayManage,
    type AdminPerson,
    type AdminPersonDetail,
    type Bezeichnung,
    type LoginMethod,
    type SonderrolleAnzeige,
} from "@avesmaps3d/shared";
import { sonderrollenJePerson } from "./sonderrollen.ts";
import { effectiveAssurance, type SessionAssurance, type SessionRecord, type Sql } from "./session-store.ts";

/**
 * Personen lesen für die Verwaltung (WI-0120 A7, AUTH-0001 §12.2 Reiter „Personen“): Liste und Detail einer Umgebung.
 * Nie ein Hash, nie ein Token; die IP-Präfixe der Sitzungen bleiben im Protokoll.
 */
interface PersonRow {
    id: string;
    display_name: string;
    status: AdminPerson["status"];
    revision: number;
    created_at: Date;
    last_login_at: Date | null;
    lock_reason: string | null;
    responsible_for: string | null;
    locked_at: Date | null;
    locked_by_id: string | null;
    locked_by_name: string | null;
    role: string;
    bezeichnung: Bezeichnung | null;
    access: AdminPerson["access"];
    access_revision: number;
    login_name: string | null;
    password_disabled: boolean | null;
    discord_user_id: string | null;
    passkeys: number;
    sessions: number;
    last_seen_at: Date | null;
    grants: string[];
    invited_by_id: string | null;
    invited_by_name: string | null;
}

const ref = (id: string | null, displayName: string | null): { id: string; displayName: string } | null =>
    id === null || displayName === null ? null : { id, displayName };

async function personRows(sql: Sql, session: SessionRecord, personId?: string): Promise<PersonRow[]> {
    const environment = session.environment;
    return sql<PersonRow[]>`
        SELECT p.id, p.display_name, p.status, p.revision::int AS revision, p.created_at, p.last_login_at, p.lock_reason,
               p.responsible_for, p.bezeichnung, p.locked_at, lb.id AS locked_by_id, lb.display_name AS locked_by_name,
               a.role, a.status AS access, a.revision::int AS access_revision,
               pl.login_name, pl.disabled_at IS NOT NULL AS password_disabled, dl.discord_user_id,
               (SELECT count(*)::int FROM avesmaps_auth.passkey_credential k
                 WHERE k.person_id = p.id AND k.environment = a.environment AND k.revoked_at IS NULL) AS passkeys,
               (SELECT count(*)::int FROM avesmaps_auth.session s
                 WHERE s.person_id = p.id AND s.environment = a.environment AND s.revoked_at IS NULL
                   AND s.expires_at > now() AND s.idle_expires_at > now()) AS sessions,
               (SELECT max(s.last_seen_at) FROM avesmaps_auth.session s
                 WHERE s.person_id = p.id AND s.environment = a.environment) AS last_seen_at,
               coalesce((SELECT array_agg(g.capability ORDER BY g.capability) FROM avesmaps_auth.capability_grant g
                 WHERE g.person_id = p.id AND g.environment = a.environment AND g.revoked_at IS NULL), '{}') AS grants,
               ib.id AS invited_by_id, ib.display_name AS invited_by_name
          FROM avesmaps_auth.person_access a
          JOIN avesmaps_auth.person p ON p.id = a.person_id
          LEFT JOIN avesmaps_auth.person lb ON lb.id = p.locked_by
          LEFT JOIN avesmaps_auth.person ib ON ib.id = p.created_by
          LEFT JOIN avesmaps_auth.password_login pl ON pl.person_id = p.id
          LEFT JOIN avesmaps_auth.discord_login dl ON dl.person_id = p.id
         WHERE a.environment = ${environment} ${personId === undefined ? sql`` : sql`AND p.id = ${personId}`}
         ORDER BY lower(p.display_name), p.id
    `;
}

function toPerson(
    row: PersonRow,
    session: SessionRecord,
    sonderrollen: ReadonlyMap<string, SonderrolleAnzeige[]>,
): AdminPerson | undefined {
    if (!isRole(row.role)) return undefined;
    const methods: LoginMethod[] = [];
    if (row.discord_user_id !== null) methods.push("discord");
    if (row.login_name !== null) methods.push("password");
    if (row.passkeys > 0) methods.push("passkey");
    const self = row.id === session.personId;
    return {
        id: row.id,
        displayName: row.display_name,
        status: row.status,
        revision: row.revision,
        role: row.role,
        bezeichnung: row.bezeichnung,
        sonderrollen: sonderrollen.get(row.id) ?? [],
        access: row.access,
        accessRevision: row.access_revision,
        methods,
        passwordDisabled: row.password_disabled === true,
        passkeyCount: row.passkeys,
        activeSessions: row.sessions,
        grants: row.grants,
        createdAt: row.created_at.toISOString(),
        lastLoginAt: row.last_login_at?.toISOString() ?? null,
        lastSeenAt: row.last_seen_at?.toISOString() ?? null,
        invitedBy: ref(row.invited_by_id, row.invited_by_name),
        lockReason: row.lock_reason,
        lockedAt: row.locked_at?.toISOString() ?? null,
        lockedBy: ref(row.locked_by_id, row.locked_by_name),
        responsibleFor: row.responsible_for,
        self,
        manageable: !self && mayManage(session.role, row.role),
    };
}

export async function listPeople(sql: Sql, session: SessionRecord): Promise<AdminPerson[]> {
    const rows = await personRows(sql, session);
    const sonderrollen = await sonderrollenJePerson(sql, session.environment);
    return rows.flatMap((row) => toPerson(row, session, sonderrollen) ?? []);
}

export async function personDetail(
    sql: Sql,
    session: SessionRecord,
    personId: string,
): Promise<AdminPersonDetail | undefined> {
    const [row] = await personRows(sql, session, personId);
    const person =
        row === undefined
            ? undefined
            : toPerson(row, session, await sonderrollenJePerson(sql, session.environment, [personId]));
    if (row === undefined || person === undefined) return undefined;
    const environment = session.environment;
    const [discord] = await sql<
        {
            discord_user_id: string;
            discord_username: string | null;
            discord_global_name: string | null;
            linked_at: Date;
            last_login_at: Date | null;
        }[]
    >`
        SELECT discord_user_id, discord_username, discord_global_name, linked_at, last_login_at
          FROM avesmaps_auth.discord_login WHERE person_id = ${personId}
    `;
    const passkeys = await sql<
        {
            id: string;
            label: string | null;
            backed_up: boolean;
            created_via: string;
            created_at: Date;
            last_used_at: Date | null;
        }[]
    >`
        SELECT id, label, backed_up, created_via, created_at, last_used_at FROM avesmaps_auth.passkey_credential
         WHERE person_id = ${personId} AND environment = ${environment} AND revoked_at IS NULL
         ORDER BY created_at
    `;
    const sessions = await sql<
        {
            id: string;
            method: string;
            assurance: SessionAssurance;
            passkey_confirmed_at: Date | null;
            created_at: Date;
            last_seen_at: Date;
            client_label: string | null;
        }[]
    >`
        SELECT id, method, assurance, passkey_confirmed_at, created_at, last_seen_at, client_label FROM avesmaps_auth.session
         WHERE person_id = ${personId} AND environment = ${environment} AND revoked_at IS NULL
           AND expires_at > now() AND idle_expires_at > now()
         ORDER BY last_seen_at DESC
    `;
    const grants = await sql<
        {
            capability: string;
            granted_at: Date;
            reason: string;
            by_id: string | null;
            by_name: string | null;
        }[]
    >`
        SELECT g.capability, g.granted_at, g.reason, b.id AS by_id, b.display_name AS by_name
          FROM avesmaps_auth.capability_grant g LEFT JOIN avesmaps_auth.person b ON b.id = g.granted_by
         WHERE g.person_id = ${personId} AND g.environment = ${environment} AND g.revoked_at IS NULL
         ORDER BY g.capability
    `;
    const legacy = await sql<{ id: string; legacy_name: string; legacy_user_id: string | null; revision: number }[]>`
        SELECT id::text, legacy_name, legacy_user_id::text, revision::int AS revision FROM avesmaps_auth.legacy_identity
         WHERE person_id = ${personId} ORDER BY lower(legacy_name)
    `;
    return {
        person,
        loginName: row.login_name,
        discord:
            discord === undefined
                ? null
                : {
                      userId: discord.discord_user_id,
                      username: discord.discord_username,
                      globalName: discord.discord_global_name,
                      linkedAt: discord.linked_at.toISOString(),
                      lastLoginAt: discord.last_login_at?.toISOString() ?? null,
                  },
        passkeys: passkeys.map((key) => ({
            id: key.id,
            label: key.label,
            backedUp: key.backed_up,
            createdVia: key.created_via,
            createdAt: key.created_at.toISOString(),
            lastUsedAt: key.last_used_at?.toISOString() ?? null,
        })),
        sessions: sessions.map((entry) => ({
            id: entry.id,
            method: entry.method,
            // Dieselbe Regel wie beim Prüfen: Discord-2FA allein ist kein zweiter Faktor (Betreiber 2026-10-10, „4. B“).
            assurance: effectiveAssurance(entry.assurance, entry.passkey_confirmed_at),
            createdAt: entry.created_at.toISOString(),
            lastSeenAt: entry.last_seen_at.toISOString(),
            clientLabel: entry.client_label,
            current: entry.id === session.id,
        })),
        specialCapabilities: grants.map((grant) => ({
            capability: grant.capability,
            grantedAt: grant.granted_at.toISOString(),
            grantedBy: ref(grant.by_id, grant.by_name),
            reason: grant.reason,
        })),
        legacy: legacy.map((entry) => ({
            id: entry.id,
            legacyName: entry.legacy_name,
            legacyUserId: entry.legacy_user_id,
            revision: entry.revision,
        })),
    };
}
