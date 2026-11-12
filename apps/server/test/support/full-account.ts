import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createAccessLink } from "../../src/auth/access-links.ts";
import { hashPassword } from "../../src/auth/password-hash.ts";
import { createChallenge } from "../../src/auth/passkeys.ts";
import { throttleKey } from "../../src/auth/throttle.ts";
import type { Database } from "../../src/database.ts";
import type { AuthFixture, TestPerson } from "./auth-fixture.ts";

export interface FullAccount extends TestPerson {
    loginName: string;
    discord: string;
    /** Die offene Sitzung der Person. */
    cookie: string;
    /** Die Zeile in `legacy_identity`; `fixture.cleanup` löst sie nur, gelöscht wird sie vom Test. */
    legacyId: string;
}

const discordId = (): string => `${String(Date.now())}${String(randomInt(10_000, 99_999))}`;

/**
 * Eine Person mit allem, was ein Konto tragen kann (WI-0120, „Konto auflösen“): Passwort mit Drosselzähler, Discord, Passkey, eine offene
 * und eine beendete Sitzung, ein OAuth-Umweg, eine Passkey-Herausforderung, ein Rücksetzlink, die angenommene Einladung samt Vorgänger
 * und eine zweite offene an dieselbe Discord-ID, ein Legacy-Name, ein Sonderrecht und ein Zugang in `staging`. Angelegt mit `database`
 * als Besitzer oder Superuser; `auth-dissolve.test.ts` löst sie auf der Testdatenbank auf, `auth-responsibility.test.ts` als App-Rolle
 * auf dem Wegwerf-Cluster (WI-0189).
 */
export async function fullAccount(
    database: Database,
    fixture: AuthFixture,
    role: "editor" | "admin",
    name: string,
    inviter: string,
): Promise<FullAccount> {
    const person = await fixture.person(role, { name });
    const loginName = `d-${randomUUID().slice(0, 8)}`;
    const discord = discordId();
    await database`
        INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash)
        VALUES (${person.id}, ${loginName}, ${await hashPassword("Die Drachen von Gareth singen")})
    `;
    await database`
        INSERT INTO avesmaps_auth.login_throttle (key_hash, kind, failures) VALUES (${throttleKey("name", loginName)}, 'name', 2)
    `;
    await database`
        INSERT INTO avesmaps_auth.discord_login (person_id, discord_user_id, discord_username, discord_global_name)
        VALUES (${person.id}, ${discord}, 'rondrikan_d', 'Rondrikan')
    `;
    await database`
        INSERT INTO avesmaps_auth.passkey_credential (person_id, environment, rp_id, credential_id, public_key, label, created_via, transports)
        VALUES (${person.id}, 'test', 'avesmaps.test', ${randomBytes(16).toString("base64url")}, ${randomBytes(65)},
                'Rondrikans Telefon', 'passkey', '{internal}')
    `;
    const live = await fixture.session(person.id);
    const old = await fixture.session(person.id);
    await database`UPDATE avesmaps_auth.session SET revoked_at = now(), revoke_reason = 'logout' WHERE id = ${old.id}`;
    await database`
        INSERT INTO avesmaps_auth.oauth_flow (state_hash, browser_nonce_hash, code_verifier, purpose, person_id, session_id, expires_at)
        VALUES (${randomBytes(32)}, ${randomBytes(32)}, 'verifier', 'link', ${person.id}, ${live.id}, now() + interval '10 minutes')
    `;
    await createChallenge(database, { purpose: "register", sessionId: live.id, personId: person.id });
    await createAccessLink(database, { kind: "password_reset", personId: person.id, createdByCli: "cli:test" });
    // Die Einladung, mit der sie kam, und eine zweite, noch offene an dieselbe Discord-ID.
    let acceptedInvitation = "";
    for (const accepted of [true, false]) {
        const [invitation] = await database<{ id: string }[]>`
            INSERT INTO avesmaps_auth.invitation
                (token_hash, token_hint, environment, role, note, bound_discord_user_id, created_by, expires_at, accepted_at, accepted_person_id)
            VALUES (${randomBytes(32)}, 'abcd', 'test', ${role}, 'Für Rondrikan aus Gareth', ${discord}, ${inviter},
                    now() + interval '3 days', ${accepted ? new Date() : null}, ${accepted ? person.id : null})
            RETURNING id::text
        `;
        if (accepted) acceptedInvitation = invitation!.id;
    }
    // Die angenommene war neu ausgestellt: Ihr Vorgänger trägt dieselbe Notiz, ohne Bindung (Bauschritt B).
    await database`
        INSERT INTO avesmaps_auth.invitation
            (token_hash, token_hint, environment, role, note, created_by, expires_at, revoked_at, replaced_by)
        VALUES (${randomBytes(32)}, 'wxyz', 'test', ${role}, 'Für Rondrikan aus Gareth', ${inviter},
                now() + interval '3 days', now(), ${acceptedInvitation})
    `;
    const [legacy] = await database<{ id: string }[]>`
        INSERT INTO avesmaps_auth.legacy_identity (legacy_user_id, legacy_name, person_id, mapped_by, mapped_at, evidence)
        VALUES (${randomInt(1_000_000, 2_000_000_000)}, 'rondrikan_alt', ${person.id}, ${inviter}, now(), 'Selber Discord-Name')
        RETURNING id::text
    `;
    await database`
        INSERT INTO avesmaps_auth.capability_grant (person_id, environment, capability, granted_by, reason)
        VALUES (${person.id}, 'test', 'access_restricted_mode', ${inviter}, 'Probe')
    `;
    await database`INSERT INTO avesmaps_auth.person_access (person_id, environment, role) VALUES (${person.id}, 'staging', 'editor')`;
    return { ...person, loginName, discord, cookie: live.cookie, legacyId: legacy!.id };
}
