import { randomInt, randomUUID } from "node:crypto";
import type { LightMyRequestResponse } from "fastify";
import { createAccessLink } from "../../../src/auth/access-links.ts";
import { createInvitation } from "../../../src/auth/invitations.ts";
import { hashPassword } from "../../../src/auth/password-hash.ts";
import { TEST_ORIGIN } from "../auth-fixture.ts";
import { SoftAuthenticator } from "../soft-authenticator.ts";
import { passkeyZeile, type Faelle, type Person, type Welt } from "./welt.ts";

/**
 * Anmeldung, eigenes Konto und Personenverwaltung (WI-0120, WI-0133): jeder Schreibweg einmal, mit einer eigenen Person je Fall, denn
 * viele beenden oder drehen Sitzungen. Rezepte aus `auth-password`, `auth-passkey`, `auth-invitation`, `account` und `admin-api`.
 */

const PASSWORT = "Die Drachen von Gareth singen";
const PLATZHALTER_HASH = "$argon2id$v=19$m=19456,t=2,p=1$platzhalter";
const operationId = (): string => randomUUID();
const loginName = (): string => `r-${randomUUID().slice(0, 8)}`;
const discordId = (): string => `${String(Date.now())}${String(randomInt(10_000, 99_999))}`;

async function passwort(welt: Welt, personId: string, hash = PLATZHALTER_HASH): Promise<string> {
    const name = loginName();
    await welt.cluster.admin`
        INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash) VALUES (${personId}, ${name}, ${hash})
    `;
    return name;
}

async function legacyName(welt: Welt, personId: string | null): Promise<string> {
    const [row] = await welt.cluster.admin<{ id: string }[]>`
        INSERT INTO avesmaps_auth.legacy_identity (legacy_user_id, legacy_name, kind, person_id)
        VALUES (${randomInt(1_000_000, 2_000_000_000)}, 'Rauchtest', 'person', ${personId})
        RETURNING id::text
    `;
    return row!.id;
}

/** Das neue Cookie nach einer Drehung der Sitzung. */
function neuesCookie(antwort: LightMyRequestResponse, bisher: string): string {
    return (
        [antwort.headers["set-cookie"]]
            .flat()
            .map(String)
            .find((cookie) => cookie.startsWith("__Host-avesmaps-session=") && !cookie.includes("Max-Age=0"))
            ?.split(";")[0] ?? bisher
    );
}

/** Eine Person in einer Wiederherstellungssitzung, die einen echten (Software-)Passkey registrieren darf. */
async function mitWiederherstellung(welt: Welt): Promise<Person> {
    return welt.jemand("editor", { sitzung: { method: "recovery", assurance: "recovery" } });
}

async function registriereOptionen(
    welt: Welt,
    person: Person,
): Promise<{ antwort: LightMyRequestResponse; challenge: string }> {
    const antwort = await welt.post("/api/account/passkeys/register/options", person.cookie, {});
    return { antwort, challenge: (antwort.json() as { publicKey?: { challenge: string } }).publicKey?.challenge ?? "" };
}

async function registriere(
    welt: Welt,
    person: Person,
    authenticator: SoftAuthenticator,
): Promise<{ antwort: LightMyRequestResponse; cookie: string }> {
    const { antwort: optionen, challenge } = await registriereOptionen(welt, person);
    welt.muss(optionen);
    const antwort = await welt.post("/api/account/passkeys/register/verify", person.cookie, {
        credential: authenticator.register(challenge),
        label: "Rauchtest",
    });
    return { antwort, cookie: neuesCookie(antwort, person.cookie) };
}

const RP = { rpId: "avesmaps.test", origin: TEST_ORIGIN };

export const KONTEN: Faelle = {
    "POST /api/auth/logout": {
        erwartet: 204,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            return welt.post("/api/auth/logout", person.cookie);
        },
    },
    "POST /api/auth/login": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const name = await passwort(welt, person.id, await hashPassword(PASSWORT));
            return welt.post("/api/auth/login", undefined, { loginName: name, password: PASSWORT });
        },
    },
    "POST /api/auth/links/inspect": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const link = await createAccessLink(welt.cluster.admin, {
                kind: "password_reset",
                personId: person.id,
                createdByCli: "rauchtest",
            });
            return welt.post("/api/auth/links/inspect", undefined, { token: link.token, kind: "password_reset" });
        },
    },
    "POST /api/auth/password-reset": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            await passwort(welt, person.id);
            const link = await createAccessLink(welt.cluster.admin, {
                kind: "password_reset",
                personId: person.id,
                createdByCli: "rauchtest",
            });
            return welt.post("/api/auth/password-reset", undefined, {
                token: link.token,
                password: "Ein neuer Satz für den Rondrakult",
            });
        },
    },
    "POST /api/auth/recovery": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("operator");
            await passwort(welt, person.id, await hashPassword(PASSWORT));
            const link = await createAccessLink(welt.cluster.admin, {
                kind: "recovery",
                personId: person.id,
                createdByCli: "rauchtest",
            });
            return welt.post("/api/auth/recovery", undefined, { token: link.token, password: PASSWORT });
        },
    },
    "POST /api/auth/discord/start": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            return welt.post("/api/auth/discord/start", person.cookie, { purpose: "confirm" });
        },
    },
    "POST /api/auth/passkey/confirm/options": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor", { passkey: true });
            return welt.post("/api/auth/passkey/confirm/options", person.cookie, {});
        },
    },
    "POST /api/auth/passkey/confirm/verify": {
        erwartet: 200,
        async rufe(welt) {
            const person = await mitWiederherstellung(welt);
            const authenticator = new SoftAuthenticator(RP);
            const { antwort, cookie } = await registriere(welt, person, authenticator);
            welt.muss(antwort);
            const optionen = welt.muss(await welt.post("/api/auth/passkey/confirm/options", cookie, {}));
            return welt.post("/api/auth/passkey/confirm/verify", cookie, {
                credential: authenticator.assert(
                    (optionen.json() as { publicKey: { challenge: string } }).publicKey.challenge,
                ),
            });
        },
    },
    "POST /api/auth/invitations/inspect": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            const einladung = await createInvitation(welt.cluster.admin, {
                environment: "test",
                role: "editor",
                validDays: 7,
                createdBy: admin.id,
            });
            return welt.post("/api/auth/invitations/inspect", undefined, { token: einladung.token });
        },
    },
    "POST /api/auth/invitations/accept": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            const einladung = await createInvitation(welt.cluster.admin, {
                environment: "test",
                role: "editor",
                validDays: 7,
                createdBy: admin.id,
            });
            return welt.post("/api/auth/invitations/accept", undefined, {
                token: einladung.token,
                loginName: loginName(),
                displayName: "Rauch-Gast",
                password: "Ein Lied für die Zwölfe am Abend",
            });
        },
    },
    "POST /api/account/password": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            return welt.post("/api/account/password", person.cookie, {
                operationId: operationId(),
                newPassword: PASSWORT,
                loginName: loginName(),
            });
        },
    },
    "POST /api/account/passkeys/register/options": {
        erwartet: 200,
        async rufe(welt) {
            return (await registriereOptionen(welt, await mitWiederherstellung(welt))).antwort;
        },
    },
    "POST /api/account/passkeys/register/verify": {
        erwartet: 200,
        async rufe(welt) {
            return (await registriere(welt, await mitWiederherstellung(welt), new SoftAuthenticator(RP))).antwort;
        },
    },
    "POST /api/account/passkeys/revoke": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const passkeyId = await passkeyZeile(welt, person.id);
            return welt.post("/api/account/passkeys/revoke", person.cookie, { operationId: operationId(), passkeyId });
        },
    },
    "POST /api/account/sessions/revoke": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            await welt.fixture.session(person.id);
            return welt.post("/api/account/sessions/revoke", person.cookie, { operationId: operationId() });
        },
    },
    "POST /api/account/display-name": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            return welt.post("/api/account/display-name", person.cookie, {
                operationId: operationId(),
                displayName: "Rauch Neuname",
                baseRevision: 1,
            });
        },
    },
    "POST /api/account/discord/unlink": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            await welt.cluster.admin`
                INSERT INTO avesmaps_auth.discord_login (person_id, discord_user_id) VALUES (${person.id}, ${discordId()})
            `;
            await passwort(welt, person.id);
            return welt.post("/api/account/discord/unlink", person.cookie, { operationId: operationId() });
        },
    },
    "POST /api/account/responsibility": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            return welt.post("/api/account/responsibility", person.cookie, {
                operationId: operationId(),
                responsibleFor: "Meldungen",
                baseRevision: 1,
            });
        },
    },
    "POST /api/account/bezeichnung": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            return welt.post("/api/account/bezeichnung", person.cookie, {
                operationId: operationId(),
                bezeichnung: "feminin",
            });
        },
    },
    "POST /api/admin/people/unlock": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            const ziel = await welt.fixture.person("editor", { status: "locked" });
            return welt.post("/api/admin/people/unlock", admin.cookie, {
                operationId: operationId(),
                personId: ziel.id,
                baseRevision: 1,
            });
        },
    },
    "POST /api/admin/people/reset-link": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            const ziel = await welt.fixture.person("editor");
            await passwort(welt, ziel.id);
            return welt.post("/api/admin/people/reset-link", admin.cookie, {
                operationId: operationId(),
                personId: ziel.id,
            });
        },
    },
    "POST /api/admin/people/passkey-link": {
        erwartet: 200,
        async rufe(welt) {
            const betreiber = await welt.jemand("operator", { frisch: true });
            const ziel = await welt.fixture.person("editor");
            return welt.post("/api/admin/people/passkey-link", betreiber.cookie, {
                operationId: operationId(),
                personId: ziel.id,
            });
        },
    },
    "POST /api/admin/people/capabilities/grant": {
        erwartet: 200,
        async rufe(welt) {
            const betreiber = await welt.jemand("operator", { frisch: true });
            const ziel = await welt.fixture.person("admin");
            return welt.post("/api/admin/people/capabilities/grant", betreiber.cookie, {
                operationId: operationId(),
                personId: ziel.id,
                capability: "access_restricted_mode",
                reason: "Rauchtest",
            });
        },
    },
    "POST /api/admin/invitations": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            return welt.post("/api/admin/invitations", admin.cookie, {
                operationId: operationId(),
                role: "editor",
                validDays: 7,
                note: "Rauchtest",
            });
        },
    },
    "POST /api/admin/invitations/reissue": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            const einladung = await createInvitation(welt.cluster.admin, {
                environment: "test",
                role: "reviewer",
                validDays: 3,
                createdBy: admin.id,
            });
            return welt.post("/api/admin/invitations/reissue", admin.cookie, {
                operationId: operationId(),
                invitationId: einladung.id,
                baseRevision: 1,
            });
        },
    },
    "POST /api/admin/invitations/revoke": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            const einladung = await createInvitation(welt.cluster.admin, {
                environment: "test",
                role: "editor",
                validDays: 7,
                createdBy: admin.id,
            });
            return welt.post("/api/admin/invitations/revoke", admin.cookie, {
                operationId: operationId(),
                invitationId: einladung.id,
                baseRevision: 1,
            });
        },
    },
    "POST /api/admin/legacy/map": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            const ziel = await welt.fixture.person("editor");
            return welt.post("/api/admin/legacy/map", admin.cookie, {
                operationId: operationId(),
                legacyIdentityId: await legacyName(welt, null),
                personId: ziel.id,
                evidence: "Rauchtest",
                baseRevision: 1,
            });
        },
    },
    "POST /api/admin/legacy/unmap": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            const ziel = await welt.fixture.person("editor");
            return welt.post("/api/admin/legacy/unmap", admin.cookie, {
                operationId: operationId(),
                legacyIdentityId: await legacyName(welt, ziel.id),
                baseRevision: 1,
            });
        },
    },
    "POST /api/admin/people/responsibility": {
        erwartet: 200,
        async rufe(welt) {
            const betreiber = await welt.jemand("operator");
            const ziel = await welt.fixture.person("editor");
            return welt.post("/api/admin/people/responsibility", betreiber.cookie, {
                operationId: operationId(),
                personId: ziel.id,
                responsibleFor: "Redaktion Garetien",
                baseRevision: 1,
            });
        },
    },
    "POST /api/admin/people/role": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            const ziel = await welt.fixture.person("tester");
            return welt.post("/api/admin/people/role", admin.cookie, {
                operationId: operationId(),
                personId: ziel.id,
                role: "editor",
                baseRevision: 1,
            });
        },
    },
    "POST /api/admin/people/lock": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            const ziel = await welt.fixture.person("editor");
            return welt.post("/api/admin/people/lock", admin.cookie, {
                operationId: operationId(),
                personId: ziel.id,
                reason: "Rauchtest",
                baseRevision: 1,
            });
        },
    },
    "POST /api/admin/people/sessions/revoke": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            const ziel = await welt.jemand("editor");
            return welt.post("/api/admin/people/sessions/revoke", admin.cookie, {
                operationId: operationId(),
                personId: ziel.id,
            });
        },
    },
    "POST /api/admin/people/access/revoke": {
        erwartet: 200,
        async rufe(welt) {
            const admin = await welt.jemand("admin");
            const ziel = await welt.fixture.person("editor");
            return welt.post("/api/admin/people/access/revoke", admin.cookie, {
                operationId: operationId(),
                personId: ziel.id,
                baseRevision: 1,
            });
        },
    },
    "POST /api/admin/people/passkeys/revoke": {
        erwartet: 200,
        async rufe(welt) {
            const betreiber = await welt.jemand("operator", { frisch: true });
            const ziel = await welt.fixture.person("editor");
            await passkeyZeile(welt, ziel.id);
            return welt.post("/api/admin/people/passkeys/revoke", betreiber.cookie, {
                operationId: operationId(),
                personId: ziel.id,
            });
        },
    },
    "POST /api/admin/sonderrollen/vergeben": {
        erwartet: 200,
        async rufe(welt) {
            const betreiber = await welt.jemand("operator", { frisch: true });
            const ziel = await welt.fixture.person("reviewer");
            return welt.post("/api/admin/sonderrollen/vergeben", betreiber.cookie, {
                operationId: operationId(),
                personId: ziel.id,
                sonderrolle: "kurator",
                grund: "Rauchtest",
            });
        },
    },
    "POST /api/admin/sonderrollen/entziehen": {
        erwartet: 200,
        async rufe(welt) {
            const betreiber = await welt.jemand("operator", { frisch: true });
            const ziel = await welt.fixture.person("reviewer");
            const [zeile] = await welt.cluster.admin<{ id: string }[]>`
                INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, granted_by, reason)
                VALUES (${ziel.id}, 'test', 'kurator', ${betreiber.id}, 'Rauchtest')
                RETURNING id::text
            `;
            return welt.post("/api/admin/sonderrollen/entziehen", betreiber.cookie, {
                operationId: operationId(),
                zuteilungId: zeile!.id,
                grund: "Rauchtest",
            });
        },
    },
    "POST /api/admin/people/capabilities/revoke": {
        erwartet: 200,
        async rufe(welt) {
            const betreiber = await welt.jemand("operator", { frisch: true });
            const ziel = await welt.fixture.person("admin");
            await welt.cluster.admin`
                INSERT INTO avesmaps_auth.capability_grant (person_id, environment, capability, granted_by, reason)
                VALUES (${ziel.id}, 'test', 'access_restricted_mode', ${betreiber.id}, 'Rauchtest')
            `;
            return welt.post("/api/admin/people/capabilities/revoke", betreiber.cookie, {
                operationId: operationId(),
                personId: ziel.id,
                capability: "access_restricted_mode",
                reason: "Rauchtest",
            });
        },
    },
};
