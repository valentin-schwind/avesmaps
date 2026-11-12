import type { Sql } from "./session-store.ts";
import { randomToken, tokenHash } from "./tokens.ts";

/**
 * Einmalige Links an eine Person (WI-0120 A4, AUTH-0001 §6.7, §11.2, §11.4): Passwort zurücksetzen, Notzugang, ersten Passkey
 * einrichten. Nur der Hash steht in der Datenbank; das Geheimnis steht im Fragment des Links (`/passwort#…`), erreicht also
 * keinen Server-Log und keine Link-Vorschau. Verbraucht wird atomar: zweimal einlösen geht nie.
 */
export type AccessLinkKind = "password_reset" | "recovery" | "passkey_enrollment";

/** Gültigkeit in Minuten: Rücksetzen und Passkey 24 Stunden, Notzugang eine Stunde. */
export const ACCESS_LINK_MINUTES: Record<AccessLinkKind, number> = {
    password_reset: 24 * 60,
    recovery: 60,
    passkey_enrollment: 24 * 60,
};

/** Der Pfad der Seite, die den Link annimmt; das Geheimnis kommt als Fragment dahinter. */
export const ACCESS_LINK_PATH: Record<AccessLinkKind, string> = {
    password_reset: "/passwort",
    recovery: "/notzugang",
    passkey_enrollment: "/passkey",
};

export async function createAccessLink(
    sql: Sql,
    input: { kind: AccessLinkKind; personId: string; createdBy?: string | null; createdByCli?: string | null },
    now: Date = new Date(),
): Promise<{ id: string; token: string; expiresAt: Date }> {
    const token = randomToken();
    const expiresAt = new Date(now.getTime() + ACCESS_LINK_MINUTES[input.kind] * 60_000);
    // Ein neuer Link derselben Art ersetzt einen offenen: es gibt je Person und Art höchstens einen gültigen.
    await sql`
        UPDATE avesmaps_auth.access_link SET revoked_at = ${now}
         WHERE person_id = ${input.personId} AND kind = ${input.kind} AND used_at IS NULL AND revoked_at IS NULL
    `;
    const [row] = await sql<{ id: string }[]>`
        INSERT INTO avesmaps_auth.access_link (token_hash, kind, person_id, created_by, created_by_cli, created_at, expires_at)
        VALUES (${tokenHash(token)}, ${input.kind}, ${input.personId}, ${input.createdBy ?? null}, ${input.createdByCli ?? null},
                ${now}, ${expiresAt})
        RETURNING id
    `;
    return { id: row!.id, token, expiresAt };
}

export interface AccessLinkInfo {
    personId: string;
    displayName: string;
    loginName: string | null;
    expiresAt: Date;
}

/** Was hinter einem Link steht, ohne ihn zu verbrauchen; `undefined` für unbekannt, abgelaufen, benutzt oder widerrufen. */
export async function peekAccessLink(
    sql: Sql,
    token: string,
    kind: AccessLinkKind,
): Promise<AccessLinkInfo | undefined> {
    const [row] = await sql<{ person_id: string; display_name: string; login_name: string | null; expires_at: Date }[]>`
        SELECT l.person_id, p.display_name, pl.login_name, l.expires_at
          FROM avesmaps_auth.access_link l
          JOIN avesmaps_auth.person p ON p.id = l.person_id AND p.status <> 'departed'
          LEFT JOIN avesmaps_auth.password_login pl ON pl.person_id = l.person_id
         WHERE l.token_hash = ${tokenHash(token)} AND l.kind = ${kind}
           AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at > now()
    `;
    if (row === undefined) return undefined;
    return {
        personId: row.person_id,
        displayName: row.display_name,
        loginName: row.login_name,
        expiresAt: row.expires_at,
    };
}

/** Verbraucht einen Link atomar und gibt die Person zurück, oder `undefined`. */
export async function consumeAccessLink(sql: Sql, token: string, kind: AccessLinkKind): Promise<string | undefined> {
    const [row] = await sql<{ person_id: string }[]>`
        UPDATE avesmaps_auth.access_link SET used_at = now()
         WHERE token_hash = ${tokenHash(token)} AND kind = ${kind}
           AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING person_id
    `;
    return row?.person_id;
}
