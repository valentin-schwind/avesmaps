import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { consumeAccessLink } from "./access-links.ts";
import { recordEvent } from "./audit.ts";
import type { AuthConfig, AuthEnvironment } from "./config.ts";
import { dummyHash, hashPassword, verifyPassword } from "./password-hash.ts";
import { checkPassword, type PasswordProblem } from "./password-policy.ts";
import {
    createSession,
    type IssuedSession,
    revokePersonSessions,
    type SessionAssurance,
    type SessionMethod,
    type Sql,
} from "./session-store.ts";
import { clearFailures, recordFailure, throttleKey, throttleRemaining } from "./throttle.ts";

/**
 * Konten mit Benutzername und Passwort (WI-0120 A4, AUTH-0001 §6.4, §6.7; Betreiber 2026-10-09: „Manuelle Konten sind keine bloße
 * Übergangslösung“). Gleiche Antwort und gleiche Rechenzeit für unbekannte Namen und falsche Passwörter; erst mit richtigem
 * Passwort sagt die Antwort, dass ein Konto gesperrt ist oder hier keinen Zugang hat. Ein Passwort allein ergibt nur Stufe R
 * (`basic`); Verwaltungsrechte brauchen einen Passkey dazu (§11).
 */

/** Nach so vielen Fehlversuchen in Folge wird nur der Passwortweg stillgelegt (NIST SP 800-63B-4 §3.2.2). */
export const PASSWORD_DISABLE_AFTER = 100;

export interface RequestMeta {
    ipPrefix: string | undefined;
    clientLabel: string | undefined;
}

export function normalizeLoginName(value: string): string {
    return value.normalize("NFC").trim().toLowerCase();
}

const LOGIN_NAME = /^[\p{L}\p{N}._-]{3,40}$/u;

export function validLoginName(value: string): boolean {
    return LOGIN_NAME.test(value);
}

const INVALID = (): ApiError => new ApiError(401, "invalid_credentials", "Benutzername oder Passwort stimmen nicht.");

function throttled(seconds: number): ApiError {
    return new ApiError(429, "rate_limited", "Zu viele Versuche. Gleich noch einmal versuchen.", {
        retryAfterSeconds: seconds,
    });
}

export function passwordRejected(problems: readonly PasswordProblem[]): ApiError {
    return new ApiError(400, "password_rejected", "Dieses Passwort erfüllt die Regeln nicht.", {
        problems: [...problems],
    });
}

interface Account {
    person_id: string;
    display_name: string;
    person_status: string;
    password_hash: string;
    disabled_at: Date | null;
    failed_streak: number;
    access_status: string | null;
}

async function findAccount(sql: Sql, loginName: string, environment: AuthEnvironment): Promise<Account | undefined> {
    const [row] = await sql<Account[]>`
        SELECT pl.person_id, p.display_name, p.status AS person_status, pl.password_hash, pl.disabled_at, pl.failed_streak,
               a.status AS access_status
          FROM avesmaps_auth.password_login pl
          JOIN avesmaps_auth.person p ON p.id = pl.person_id
          LEFT JOIN avesmaps_auth.person_access a ON a.person_id = pl.person_id AND a.environment = ${environment}
         WHERE pl.login_name = ${loginName}
    `;
    return row;
}

/** Anmelden mit Benutzername und Passwort; gibt das Token der neuen Sitzung zurück. */
export async function loginWithPassword(
    database: Database,
    config: AuthConfig,
    input: { loginName: string; password: string },
    meta: RequestMeta,
): Promise<{ token: string; expiresAt: Date; personId: string }> {
    const environment = config.environment!;
    const loginName = normalizeLoginName(input.loginName);
    const key = throttleKey("name", loginName);
    const wait = await throttleRemaining(database, key);
    if (wait > 0) throw throttled(wait);

    const account = await findAccount(database, loginName, environment);
    if (account === undefined) {
        await verifyPassword(input.password, await dummyHash());
        await recordFailure(database, key);
        throw INVALID();
    }
    const { ok, needsRehash } = await verifyPassword(input.password, account.password_hash);
    if (!ok) {
        await recordFailure(database, key);
        await database.begin(async (tx) => {
            const [row] = await tx<{ failed_streak: number; disabled_at: Date | null }[]>`
                UPDATE avesmaps_auth.password_login SET failed_streak = failed_streak + 1,
                       disabled_at = CASE WHEN failed_streak + 1 >= ${PASSWORD_DISABLE_AFTER} THEN coalesce(disabled_at, now()) ELSE disabled_at END
                 WHERE person_id = ${account.person_id}
                RETURNING failed_streak, disabled_at
            `;
            await recordEvent(tx, {
                environment,
                action: "login.failure",
                actorKind: "anonymous",
                targetPersonId: account.person_id,
                details: { method: "password", reason: "wrong_password" },
                ...meta,
            });
            if (row !== undefined && row.failed_streak === PASSWORD_DISABLE_AFTER) {
                await recordEvent(tx, {
                    environment,
                    action: "password.disabled",
                    actorKind: "system",
                    targetPersonId: account.person_id,
                    details: { failures: row.failed_streak },
                });
            }
        });
        throw INVALID();
    }
    // Ab hier ist das Passwort richtig: Jetzt darf die Antwort sagen, warum es trotzdem nicht geht.
    if (account.disabled_at !== null) {
        throw new ApiError(
            403,
            "password_disabled",
            "Die Anmeldung mit Passwort ist nach zu vielen Fehlversuchen stillgelegt. Ein Rücksetzlink gibt sie wieder frei.",
        );
    }
    if (account.person_status !== "active") throw new ApiError(403, "account_locked", "Dieses Konto ist gesperrt.");
    if (account.access_status !== "active") {
        throw new ApiError(403, "no_access", "Für diese Umgebung gibt es mit diesem Konto keinen Zugang.");
    }
    await clearFailures(database, key);
    const rehashed = needsRehash ? await hashPassword(input.password) : undefined;
    return database.begin(async (tx) => {
        await tx`
            UPDATE avesmaps_auth.password_login
               SET failed_streak = 0, password_hash = coalesce(${rehashed ?? null}, password_hash)
             WHERE person_id = ${account.person_id}
        `;
        const session = await startSession(tx, config, account.person_id, "password", "basic", meta);
        return { token: session.token, expiresAt: session.expiresAt, personId: account.person_id };
    });
}

/** Legt eine Sitzung an, vermerkt die Anmeldung an der Person und im Protokoll. */
export async function startSession(
    sql: Sql,
    config: AuthConfig,
    personId: string,
    method: SessionMethod,
    assurance: SessionAssurance,
    meta: RequestMeta,
    options: { passkeyConfirmed?: boolean } = {},
): Promise<IssuedSession> {
    const environment = config.environment!;
    const session = await createSession(sql, config, {
        personId,
        environment,
        method,
        assurance,
        ...(options.passkeyConfirmed === true ? { passkeyConfirmed: true } : {}),
        ipPrefix: meta.ipPrefix,
        clientLabel: meta.clientLabel,
    });
    await sql`UPDATE avesmaps_auth.person SET last_login_at = now() WHERE id = ${personId}`;
    await recordEvent(sql, {
        environment,
        action: assurance === "recovery" ? "recovery.started" : "login.success",
        actorKind: "person",
        actorPersonId: personId,
        targetPersonId: personId,
        details: assurance === "recovery" ? { via: "link" } : { method, assurance },
        sessionId: session.id,
        recovery: assurance === "recovery",
        ...meta,
    });
    return session;
}

/** Setzt das Passwort einer Person (neu oder ersetzt), nach den Regeln, und gibt den Passwortweg wieder frei. */
export async function setPassword(
    sql: Sql,
    personId: string,
    password: string,
    loginName: string | undefined,
): Promise<"set" | "changed"> {
    const [existing] = await sql<{ login_name: string }[]>`
        SELECT login_name FROM avesmaps_auth.password_login WHERE person_id = ${personId}
    `;
    const [person] = await sql<
        { display_name: string }[]
    >`SELECT display_name FROM avesmaps_auth.person WHERE id = ${personId}`;
    const name = existing?.login_name ?? (loginName === undefined ? undefined : normalizeLoginName(loginName));
    if (name === undefined || !validLoginName(name)) {
        throw new ApiError(
            400,
            "login_name_invalid",
            "Der Benutzername braucht 3 bis 40 Buchstaben, Ziffern, Punkt, Strich oder Unterstrich.",
        );
    }
    const problems = checkPassword(password, { loginName: name, displayName: person?.display_name });
    if (problems.length > 0) throw passwordRejected(problems);
    const hash = await hashPassword(password);
    if (existing !== undefined) {
        await sql`
            UPDATE avesmaps_auth.password_login
               SET password_hash = ${hash}, changed_at = now(), must_change = false, failed_streak = 0, disabled_at = NULL
             WHERE person_id = ${personId}
        `;
        return "changed";
    }
    const [taken] = await sql<{ person_id: string }[]>`
        SELECT person_id FROM avesmaps_auth.password_login WHERE login_name = ${name}
    `;
    if (taken !== undefined) throw new ApiError(409, "login_name_taken", "Dieser Benutzername ist schon vergeben.");
    await sql`
        INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash) VALUES (${personId}, ${name}, ${hash})
    `;
    return "set";
}

/**
 * Rücksetzlink einlösen (§6.7): setzt das Passwort, beendet alle Sitzungen der Person und meldet sie neu an (Stufe R). Hat
 * die Person noch keinen Passwortweg (Erstkonto von der Kommandozeile), legt `loginName` ihn an.
 */
export async function resetPasswordWithLink(
    database: Database,
    config: AuthConfig,
    input: { token: string; password: string; loginName?: string | undefined },
    meta: RequestMeta,
): Promise<{ token: string; expiresAt: Date; personId: string }> {
    const environment = config.environment!;
    return database.begin(async (tx) => {
        const personId = await consumeAccessLink(tx, input.token, "password_reset");
        if (personId === undefined) {
            throw new ApiError(
                400,
                "link_invalid",
                "Dieser Link gilt nicht mehr. Ein neuer kommt von einer Person der Verwaltung.",
            );
        }
        const [person] = await tx<{ status: string; access: string | null }[]>`
            SELECT p.status, a.status AS access FROM avesmaps_auth.person p
              LEFT JOIN avesmaps_auth.person_access a ON a.person_id = p.id AND a.environment = ${environment}
             WHERE p.id = ${personId}
        `;
        if (person?.status !== "active") throw new ApiError(403, "account_locked", "Dieses Konto ist gesperrt.");
        if (person.access !== "active")
            throw new ApiError(403, "no_access", "Für diese Umgebung gibt es mit diesem Konto keinen Zugang.");
        const outcome = await setPassword(tx, personId, input.password, input.loginName);
        const ended = await revokePersonSessions(tx, personId, null, "password_reset");
        await recordEvent(tx, {
            environment,
            action: "access_link.used",
            actorKind: "person",
            actorPersonId: personId,
            targetPersonId: personId,
            details: { kind: "password_reset" },
            ...meta,
        });
        await recordEvent(tx, {
            environment,
            action: outcome === "set" ? "password.set" : "password.changed",
            actorKind: "person",
            actorPersonId: personId,
            targetPersonId: personId,
            details: outcome === "set" ? { via: "link" } : {},
            ...meta,
        });
        if (ended.length > 0) {
            await recordEvent(tx, {
                environment,
                action: "session.revoked",
                actorKind: "system",
                targetPersonId: personId,
                details: { reason: "password_reset", count: ended.length },
            });
        }
        const session = await startSession(tx, config, personId, "password", "basic", meta);
        return { token: session.token, expiresAt: session.expiresAt, personId };
    });
}

/**
 * Notzugang (§11.2): einmaliger Link von der Kommandozeile (SSH) plus Passwort der Person ergibt eine Notzugangs-Sitzung,
 * 60 Minuten, nicht verlängerbar, überall gekennzeichnet. Der einzige Weg, auf dem ein Passwort Verwaltungsrechte trägt.
 */
export async function startRecovery(
    database: Database,
    config: AuthConfig,
    input: { token: string; password: string },
    meta: RequestMeta,
): Promise<{ token: string; expiresAt: Date; personId: string }> {
    const environment = config.environment!;
    return database.begin(async (tx) => {
        const personId = await consumeAccessLink(tx, input.token, "recovery");
        if (personId === undefined) throw new ApiError(400, "link_invalid", "Dieser Notzugang gilt nicht mehr.");
        const [account] = await tx<{ password_hash: string | null; status: string; access: string | null }[]>`
            SELECT pl.password_hash, p.status, a.status AS access FROM avesmaps_auth.person p
              LEFT JOIN avesmaps_auth.password_login pl ON pl.person_id = p.id
              LEFT JOIN avesmaps_auth.person_access a ON a.person_id = p.id AND a.environment = ${environment}
             WHERE p.id = ${personId}
        `;
        const hash = account?.password_hash ?? (await dummyHash());
        const { ok } = await verifyPassword(input.password, hash);
        if (!ok || account?.password_hash === null || account === undefined) throw INVALID();
        if (account.status !== "active") throw new ApiError(403, "account_locked", "Dieses Konto ist gesperrt.");
        if (account.access !== "active")
            throw new ApiError(403, "no_access", "Für diese Umgebung gibt es mit diesem Konto keinen Zugang.");
        await recordEvent(tx, {
            environment,
            action: "access_link.used",
            actorKind: "person",
            actorPersonId: personId,
            targetPersonId: personId,
            details: { kind: "recovery" },
            recovery: true,
            ...meta,
        });
        const session = await startSession(tx, config, personId, "recovery", "recovery", meta);
        return { token: session.token, expiresAt: session.expiresAt, personId };
    });
}
