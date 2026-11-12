import type { Role } from "@avesmaps3d/shared";
import type { AuthConfig } from "../../src/auth/config.ts";
import { DEFAULT_SESSION } from "../../src/auth/config.ts";
import { createSession, type SessionAssurance, type SessionMethod } from "../../src/auth/session-store.ts";
import type { Database } from "../../src/database.ts";

/** Anmeldung in Tests (WI-0120): Umgebung `test`, Herkunft fest, Cookie ohne `__Host-` nicht nötig (`Secure` stört `inject` nicht). */
export const TEST_ORIGIN = "https://avesmaps.test";

export const TEST_AUTH: AuthConfig = {
    environment: "test",
    publicOrigin: TEST_ORIGIN,
    insecureCookie: false,
    anonymousView: "visitor",
    discord: {
        clientId: "test-client",
        clientSecret: "test-secret",
        redirectUri: "https://avesmaps.test/api/auth/discord/callback",
        authorizeUrl: "https://discord.test/oauth2/authorize",
        apiBase: "http://127.0.0.1:9/api/v10",
    },
    session: DEFAULT_SESSION,
};

export const SESSION_COOKIE = "__Host-avesmaps-session";

export interface TestPerson {
    id: string;
    name: string;
}

/** Legt Personen an und räumt sie wieder ab; der Test läuft als Besitzer und darf löschen. */
export interface AuthFixture {
    person(role: Role, options?: { name?: string; status?: "active" | "locked" }): Promise<TestPerson>;
    session(personId: string, options?: SessionOptions): Promise<{ id: string; token: string; cookie: string }>;
    cleanup(): Promise<void>;
}

export interface SessionOptions {
    method?: SessionMethod;
    assurance?: SessionAssurance;
    confirmedMinutesAgo?: number;
    lastSeenMinutesAgo?: number;
    /**
     * Wann der Passkey in dieser Sitzung zuletzt bestätigt wurde. Ohne Angabe trägt eine `strong`-Sitzung einen Nachweis von vor
     * einem Tag (`STRONG_PASSKEY_MINUTES_AGO`): zweiter Faktor ja, für Stufe S nicht frisch. `null` heißt kein Nachweis; eine
     * `strong`-Sitzung ohne ihn ist eine Discord-2FA-Sitzung von vor dem 2026-10-10 und gilt als `basic` (`effectiveAssurance`).
     */
    passkeyMinutesAgo?: number | null;
    environment?: "test" | "staging";
}

/**
 * Seit dem Betreiberentscheid vom 2026-10-10 („4. B“) ist der Passkey der einzige zweite Faktor: Eine Sitzung mit Stufe V hat ihn
 * irgendwann in ihrer Laufzeit bestätigt. Ein Tag ist alt genug, dass Stufe S (≤ 5 min) und `recent` (≤ 15 min) nicht greifen.
 */
export const STRONG_PASSKEY_MINUTES_AGO = 24 * 60;

export function authFixture(database: Database): AuthFixture {
    const created: string[] = [];

    async function person(
        role: Role,
        options: { name?: string; status?: "active" | "locked" } = {},
    ): Promise<TestPerson> {
        const name = options.name ?? `${role}-${String(created.length + 1)}`;
        const [row] = await database<{ id: string }[]>`
            INSERT INTO avesmaps_auth.person (display_name, status, created_via)
            VALUES (${name}, ${options.status ?? "active"}, 'system') RETURNING id
        `;
        const id = row!.id;
        created.push(id);
        await database`
            INSERT INTO avesmaps_auth.person_access (person_id, environment, role) VALUES (${id}, 'test', ${role})
        `;
        return { id, name };
    }

    /** Eine Sitzung mit gewünschtem Alter von Bestätigung, letzter Anfrage und Passkey-Nachweis (in Minuten). */
    async function session(
        personId: string,
        options: SessionOptions = {},
    ): Promise<{ id: string; token: string; cookie: string }> {
        const assurance = options.assurance ?? "strong";
        const { id, token } = await createSession(database, TEST_AUTH, {
            personId,
            environment: options.environment ?? "test",
            method: options.method ?? "discord",
            assurance,
        });
        const minutes = (value: number): Date => new Date(Date.now() - value * 60_000);
        const passkeyAgo =
            options.passkeyMinutesAgo === undefined && assurance === "strong"
                ? STRONG_PASSKEY_MINUTES_AGO
                : (options.passkeyMinutesAgo ?? null);
        await database`
            UPDATE avesmaps_auth.session
               SET confirmed_at = ${minutes(options.confirmedMinutesAgo ?? 0)},
                   last_seen_at = ${minutes(options.lastSeenMinutesAgo ?? 0)},
                   passkey_confirmed_at = ${passkeyAgo === null ? null : minutes(passkeyAgo)}
             WHERE id = ${id}
        `;
        return { id, token, cookie: `${SESSION_COOKIE}=${token}` };
    }

    async function cleanup(): Promise<void> {
        if (created.length === 0) return;
        await database`DELETE FROM avesmaps_auth.security_event WHERE actor_person_id = ANY(${created}) OR target_person_id = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.webauthn_challenge WHERE person_id = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.oauth_flow WHERE person_id = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.session WHERE person_id = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.passkey_credential WHERE person_id = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.access_link WHERE person_id = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.abzug_schluessel WHERE created_by = ANY(${created}) OR revoked_by = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.karten_zugang WHERE created_by = ANY(${created}) OR revoked_by = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.password_login WHERE person_id = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.discord_login WHERE person_id = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.invitation WHERE created_by = ANY(${created}) OR accepted_person_id = ANY(${created})`;
        await database`
            UPDATE avesmaps_auth.legacy_identity SET person_id = NULL, mapped_by = NULL
             WHERE person_id = ANY(${created}) OR mapped_by = ANY(${created})
        `;
        await database`
            DELETE FROM avesmaps_auth.capability_grant
             WHERE person_id = ANY(${created}) OR granted_by = ANY(${created}) OR revoked_by = ANY(${created})
        `;
        await database`
            DELETE FROM avesmaps_auth.sonderrolle_zuteilung
             WHERE person_id = ANY(${created}) OR granted_by = ANY(${created}) OR revoked_by = ANY(${created})
        `;
        await database`DELETE FROM avesmaps_auth.person_access WHERE person_id = ANY(${created})`;
        await database`DELETE FROM avesmaps_auth.person WHERE id = ANY(${created})`;
        created.length = 0;
    }

    return { person, session, cleanup };
}
