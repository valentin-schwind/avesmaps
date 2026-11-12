import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { recordEvent } from "../src/auth/audit.ts";
import { runAuthCli } from "../src/auth/cli-commands.ts";
import { createInvitation } from "../src/auth/invitations.ts";
import { DEPARTED_NAME, REDACTED } from "../src/auth/dissolve.ts";
import { throttleKey } from "../src/auth/throttle.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { fullAccount as createFullAccount } from "./support/full-account.ts";

/**
 * Ein Konto auflösen (WI-0120, Recht auf Löschung; Betreiber 2026-10-09: „1 wie empfohlen“): `auth aufloesen`.
 *
 * Problemfälle: eine Person mit allen Anmeldewegen, offener Sitzung, Umwegen, Links, Einladung mit Notiz, Legacy-Name und
 * Sonderrecht; der letzte aktive Betreiber; ein zweiter Aufruf; die Tür, die ihr Urteil 30 s im Speicher hält. Soll: alles Genannte
 * gelöscht, geleert oder entzogen, ein Platzhalter, das Protokoll bleibt und nennt den Platzhalter, ein Eintrag ohne alten Namen, die
 * Sitzung sofort ungültig, wiederholbar.
 *
 * Ob die Rechte der App-Rolle genügen, mit der das Werkzeug auf dem VPS läuft, prüft `auth-responsibility.test.ts` auf dem
 * Wegwerf-Cluster mit derselben Person (`support/full-account.ts`; bis WI-0189 hier per `SET ROLE` in eine Handrolle).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const PLACEHOLDER = new RegExp(`^${DEPARTED_NAME} [2-9A-HJ-NP-Z]{4}$`, "u");

describeWithDatabase("Konto auflösen", { timeout: 90_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let app: FastifyInstance | undefined;
    const legacyIds: string[] = [];

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
    };

    async function build(): Promise<FastifyInstance> {
        const instance = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
        });
        await instance.ready();
        return instance;
    }

    async function cli(args: string[]): Promise<{ code: number; out: string; err: string }> {
        const out: string[] = [];
        const err: string[] = [];
        const code = await runAuthCli(
            args,
            { AVESMAPS_ENV: "test", PUBLIC_ORIGIN: TEST_ORIGIN },
            { out: (line) => out.push(line), err: (line) => err.push(line) },
            { database, systemUser: "test" },
        );
        return { code, out: out.join("\n"), err: err.join("\n") };
    }

    const gate = async (cookie: string): Promise<number> =>
        (await app!.inject({ method: "GET", url: "/api/auth/gate", headers: { cookie } })).statusCode;

    /** Bis die Meldung der Datenbank angekommen ist: höchstens 5 s. */
    async function until(expected: number, cookie: string): Promise<number> {
        const end = Date.now() + 5000;
        let status = await gate(cookie);
        while (status !== expected && Date.now() < end) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            status = await gate(cookie);
        }
        return status;
    }

    /** Eine Person mit allem, was ein Konto tragen kann (`support/full-account.ts`); ihr Legacy-Name wird nach dem Fall gelöscht. */
    async function fullAccount(role: "editor" | "admin", name: string, inviter: string) {
        const account = await createFullAccount(database, fixture, role, name, inviter);
        legacyIds.push(account.legacyId);
        return account;
    }

    const departedEvents = (personId: string) =>
        database<{ actor_kind: string; actor_label: string; details: Record<string, unknown> }[]>`
            SELECT actor_kind, actor_label, details FROM avesmaps_auth.security_event
             WHERE target_person_id = ${personId} AND action = 'person.departed' ORDER BY id
        `;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
        if (legacyIds.length > 0) {
            await database`DELETE FROM avesmaps_auth.legacy_identity WHERE id = ANY(${legacyIds}::bigint[])`;
            legacyIds.length = 0;
        }
        // Räumt auch die Zugänge in `staging` und `development` ab: die Fixture löscht je Person, nicht je Umgebung.
        await fixture.cleanup();
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 löst auf: Anmeldewege und Sitzungen weg, Passkeys geleert, alles entzogen, Platzhalter; das Protokoll bleibt", async () => {
        app = await build();
        const boss = await fixture.person("operator", { name: "Auflöse-Betreiberin" });
        const bossSession = await fixture.session(boss.id, { passkeyMinutesAgo: 1 });
        const x = await fullAccount("admin", "Rondrikan Auflösbar", boss.id);
        // Was im Protokoll schon steht: eine Verwaltungshandlung von ihr und eine an ihr.
        await recordEvent(database, {
            environment: "test",
            action: "person.role_changed",
            actorKind: "person",
            actorPersonId: x.id,
            targetPersonId: boss.id,
            details: { from: "admin", to: "operator" },
        });
        await recordEvent(database, {
            environment: "test",
            action: "person.locked",
            actorKind: "person",
            actorPersonId: boss.id,
            targetPersonId: x.id,
            details: { reason: "Probe", sessions: 0 },
        });
        // Was eine Handlung über sie selbst festhält (Bauschritt B, Betreiber 2026-10-09: „1 B“): Name, Discord-Name, ihr Gerät.
        for (const [action, details] of [
            ["person.renamed", { from: "Rondrikan", to: "Rondrikan Auflösbar" }],
            ["discord.linked", { discordUsername: "rondrikan_d" }],
        ] as const) {
            await recordEvent(database, {
                environment: "test",
                action,
                actorKind: "person",
                actorPersonId: x.id,
                targetPersonId: x.id,
                details,
                ipPrefix: "203.0.113.0",
                clientLabel: "Firefox · Windows",
            });
        }
        const protocol = async (): Promise<string> => {
            const entries = await database<{ row: string }[]>`
                SELECT to_jsonb(e)::text AS row FROM avesmaps_auth.security_event e
                 WHERE (e.target_person_id = ${x.id} OR e.actor_person_id = ${x.id}) AND e.action <> 'person.departed'
                 ORDER BY e.id
            `;
            return entries.map((entry) => entry.row).join("\n");
        };
        const unredacted = await protocol();
        for (const trace of ["Rondrikan", "rondrikan_d", "Probe", "Firefox"]) expect(unredacted).toContain(trace);
        expect(await gate(x.cookie)).toBe(204);

        // Ohne Bestätigung: ein Trockenlauf, der zeigt, was geschähe, und nichts ändert, auch nicht im Protokoll.
        const dry = await cli(["aufloesen", "--person", x.id]);
        expect(dry.code).toBe(2);
        expect(dry.out).toContain("Trockenlauf");
        expect(dry.out).toContain("„Rondrikan Auflösbar“");
        expect(dry.out).toContain("Sitzungen 2");
        expect(dry.out).toContain("Protokolleinträge geschwärzt 3");
        // Das Kartenprotokoll (Migration 0273) steht in der Ausgabe; diese Person hat nie an der Karte gehandelt.
        expect(dry.out).toContain("Kartenprotokoll geschwärzt 0");
        expect(dry.err).toContain('--bestaetigung "Rondrikan Auflösbar"');
        expect(await protocol()).toBe(unredacted);
        // Eine falsche Bestätigung ändert ebenso nichts; gewählt wird hier über die Discord-ID.
        const wrong = await cli(["aufloesen", "--discord", x.discord, "--bestaetigung", "Rondrikan"]);
        expect(wrong.code).toBe(2);
        expect(wrong.err).toContain("passt nicht");
        const [still] = await database<{ display_name: string; status: string }[]>`
            SELECT display_name, status FROM avesmaps_auth.person WHERE id = ${x.id}
        `;
        expect(still).toEqual({ display_name: "Rondrikan Auflösbar", status: "active" });
        expect(await departedEvents(x.id)).toHaveLength(0);
        expect(await gate(x.cookie)).toBe(204);

        const done = await cli(["aufloesen", "--benutzer", x.loginName, "--bestaetigung", " Rondrikan Auflösbar "]);
        expect(done.err).toBe("");
        expect(done.code).toBe(0);
        expect(done.out).toContain("aufgelöst");

        const [person] = await database<
            { display_name: string; status: string; last_login_at: Date | null; lock_reason: string | null }[]
        >`SELECT display_name, status, last_login_at, lock_reason FROM avesmaps_auth.person WHERE id = ${x.id}`;
        expect(person!.display_name).toMatch(PLACEHOLDER);
        expect(person).toMatchObject({ status: "departed", last_login_at: null, lock_reason: null });
        expect(done.out).toContain(person!.display_name);

        const count = async (table: string): Promise<number> => {
            const [row] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM ${database(`avesmaps_auth.${table}`)} WHERE person_id = ${x.id}
            `;
            return row!.n;
        };
        for (const table of ["password_login", "discord_login", "session", "oauth_flow", "webauthn_challenge"]) {
            expect(await count(table), table).toBe(0);
        }
        const [throttle] = await database`
            SELECT 1 FROM avesmaps_auth.login_throttle WHERE key_hash = ${throttleKey("name", x.loginName)}
        `;
        expect(throttle).toBeUndefined();
        const passkeys = await database<
            { credential_id: string; key: number; label: string | null; revoked: boolean; transports: string[] }[]
        >`
            SELECT credential_id, octet_length(public_key) AS key, label, revoked_at IS NOT NULL AS revoked, transports
              FROM avesmaps_auth.passkey_credential WHERE person_id = ${x.id}
        `;
        expect(passkeys).toEqual([
            {
                credential_id: expect.stringMatching(/^aufgeloest:/u),
                key: 0,
                label: null,
                revoked: true,
                transports: [],
            },
        ]);
        const [link] = await database<{ revoked: boolean }[]>`
            SELECT revoked_at IS NOT NULL AS revoked FROM avesmaps_auth.access_link WHERE person_id = ${x.id}
        `;
        expect(link).toEqual({ revoked: true });
        const invitations = await database<
            { note: string | null; bound: string | null; accepted: boolean; revoked: boolean }[]
        >`
            SELECT note, bound_discord_user_id AS bound, accepted_person_id IS NOT NULL AS accepted, revoked_at IS NOT NULL AS revoked
              FROM avesmaps_auth.invitation WHERE created_by = ${boss.id} ORDER BY accepted DESC
        `;
        // Die angenommene, die offene an ihre Discord-ID und der Vorgänger der angenommenen beim Neu-Ausstellen.
        expect(invitations).toEqual([
            { note: null, bound: null, accepted: true, revoked: false },
            { note: null, bound: null, accepted: false, revoked: true },
            { note: null, bound: null, accepted: false, revoked: true },
        ]);
        const [legacy] = await database<{ person_id: string | null; evidence: string | null; legacy_name: string }[]>`
            SELECT person_id, evidence, legacy_name FROM avesmaps_auth.legacy_identity WHERE id = ${x.legacyId}::bigint
        `;
        expect(legacy).toEqual({ person_id: null, evidence: null, legacy_name: "rondrikan_alt" });
        const grants = await database<{ revoked: boolean; reason: string; revoke_reason: string }[]>`
            SELECT revoked_at IS NOT NULL AS revoked, reason, revoke_reason
              FROM avesmaps_auth.capability_grant WHERE person_id = ${x.id}
        `;
        expect(grants).toEqual([{ revoked: true, reason: REDACTED, revoke_reason: "departed" }]);
        const access = await database<{ environment: string; status: string }[]>`
            SELECT environment, status FROM avesmaps_auth.person_access WHERE person_id = ${x.id} ORDER BY environment
        `;
        expect(access).toEqual([
            { environment: "staging", status: "revoked" },
            { environment: "test", status: "revoked" },
        ]);

        // Ein Eintrag der Kommandozeile, nur Zahlen: kein alter Name, kein Benutzername, keine Discord-Angabe.
        const events = await departedEvents(x.id);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            actor_kind: "cli",
            actor_label: "cli:test",
            details: {
                methods: ["password", "discord"],
                sessions: 2,
                passkeys: 1,
                links: 1,
                invitations: 3,
                legacyMappings: 1,
                revokedCapabilities: ["access_restricted_mode"],
                capabilityReasons: 1,
                environments: ["staging", "test"],
                redactedEvents: 3,
                redactedMap: 0,
            },
        });
        const written = JSON.stringify(events[0]);
        for (const trace of ["Rondrikan", x.loginName, x.discord, "rondrikan"]) expect(written).not.toContain(trace);
        expect(done.out).toContain("Protokolleinträge geschwärzt 3");

        // Im Protokoll ist geschwärzt, was es über sie festhielt; die Einträge selbst bleiben.
        const redacted = await protocol();
        for (const trace of ["Rondrikan", "rondrikan_d", "Probe", "Firefox"]) expect(redacted).not.toContain(trace);
        const kept = await database<{ action: string; details: Record<string, unknown> }[]>`
            SELECT action, details FROM avesmaps_auth.security_event
             WHERE (target_person_id = ${x.id} OR actor_person_id = ${x.id}) AND action <> 'person.departed'
             ORDER BY id
        `;
        expect(kept).toEqual([
            { action: "person.role_changed", details: { from: "admin", to: "operator" } },
            { action: "person.locked", details: { reason: REDACTED, sessions: 0 } },
            { action: "person.renamed", details: { from: REDACTED, to: REDACTED } },
            { action: "discord.linked", details: { discordUsername: REDACTED } },
        ]);

        // Das Protokoll bleibt und nennt sie mit dem Platzhalter, als Handelnde wie als Betroffene.
        const audit = await app.inject({
            method: "GET",
            url: `/api/admin/audit?personId=${x.id}`,
            headers: { cookie: bossSession.cookie },
        });
        expect(audit.statusCode).toBe(200);
        const entries = audit.json().events as {
            action: string;
            actor: { displayName: string } | null;
            target: { displayName: string } | null;
            details: Record<string, unknown>;
        }[];
        expect(entries.map((entry) => entry.action)).toEqual([
            "person.departed",
            "discord.linked",
            "person.renamed",
            "person.locked",
            "person.role_changed",
        ]);
        expect(entries[0]!.target!.displayName).toBe(person!.display_name);
        expect(entries[3]!.target!.displayName).toBe(person!.display_name);
        expect(entries[4]!.actor!.displayName).toBe(person!.display_name);
        // Die Verwaltung zeigt die Marke, wo der Wert stand.
        expect(entries[2]!.details).toEqual({ from: REDACTED, to: REDACTED });

        // Sofort: Die Tür vergisst ihr Urteil über NOTIFY, und die Sitzung gilt nirgends mehr.
        expect(await until(401, x.cookie)).toBe(401);
        const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: x.cookie } });
        expect(session.json().person).toBeNull();

        // Die Verwaltung gibt einem aufgelösten Konto den Zugang nicht zurück.
        const [row] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM avesmaps_auth.person_access WHERE person_id = ${x.id} AND environment = 'test'
        `;
        const restore = await app.inject({
            method: "POST",
            url: "/api/admin/people/role",
            headers: { origin: TEST_ORIGIN, cookie: bossSession.cookie },
            payload: { operationId: randomUUID(), personId: x.id, role: "editor", baseRevision: row!.revision },
        });
        expect(restore.statusCode).toBe(409);
        expect(restore.json().error.code).toBe("account_inactive");
    });

    it("🔴 die Auflösung zieht die von der Person ausgestellten Einladungen und Links zurück (G2-01)", async () => {
        app = await build();
        const x = await fixture.person("admin", { name: "Einladende Auflösbar" });
        const own = await createInvitation(database, {
            environment: "test",
            role: "editor",
            validDays: 7,
            createdBy: x.id,
        });
        const accept = () =>
            app!.inject({
                method: "POST",
                url: "/api/auth/invitations/accept",
                payload: {
                    token: own.token,
                    loginName: `g2-${randomUUID().slice(0, 8)}`,
                    displayName: "Nachzügler",
                    password: "Ein Satz zur Begrüßung in Gareth",
                },
                headers: { origin: TEST_ORIGIN },
            });
        const done = await cli(["aufloesen", "--person", x.id, "--bestaetigung", "Einladende Auflösbar"]);
        expect(done.code).toBe(0);
        expect((await accept()).json().error.code).toBe("invitation_invalid");
        const events = await departedEvents(x.id);
        expect(events[0]!.details).toMatchObject({ revokedIssuedInvitations: 1, revokedIssuedLinks: 0 });
    });

    it("🔴 „Verantwortlich für:“ (WI-0133): der Trockenlauf zählt es, das Auflösen leert es, im Protokoll stand es nie", async () => {
        const x = await fixture.person("editor", { name: "Verantwortliche Auflösbar" });
        await database`UPDATE avesmaps_auth.person SET responsible_for = 'Flussnamen im Bornland', bezeichnung = 'feminin' WHERE id = ${x.id}`;
        const stored = async (): Promise<string | null> => {
            const [row] = await database<{ responsible_for: string | null }[]>`
                SELECT responsible_for FROM avesmaps_auth.person WHERE id = ${x.id}
            `;
            return row!.responsible_for;
        };
        const dry = await cli(["aufloesen", "--person", x.id]);
        expect(dry.code).toBe(2);
        expect(dry.out).toContain("„Verantwortlich für“ geleert 1");
        expect(await stored()).toBe("Flussnamen im Bornland");

        const done = await cli(["aufloesen", "--person", x.id, "--bestaetigung", "Verantwortliche Auflösbar"]);
        expect(done.code).toBe(0);
        expect(await stored()).toBeNull();
        const events = await departedEvents(x.id);
        expect(events).toHaveLength(1);
        expect(events[0]!.details).toMatchObject({ responsibility: 1 });
        // Die Bezeichnung (WI-0279 E10) geht ebenso mit dem Konto.
        const [wortform] = await database<{ bezeichnung: string | null }[]>`
            SELECT bezeichnung FROM avesmaps_auth.person WHERE id = ${x.id}
        `;
        expect(wortform!.bezeichnung).toBeNull();
        const rows = await database<{ row: string }[]>`
            SELECT to_jsonb(e)::text AS row FROM avesmaps_auth.security_event e WHERE e.target_person_id = ${x.id}
        `;
        expect(rows.map((entry) => entry.row).join(" ")).not.toContain("Bornland");
        // Nichts mehr übrig: Ein zweiter Aufruf schreibt keinen Eintrag.
        expect((await cli(["aufloesen", "--person", x.id])).out).toContain("Nichts mehr zu tun");
        expect(await departedEvents(x.id)).toHaveLength(1);
    });

    it("🔴 nie der letzte aktive Betreiber einer Umgebung", async () => {
        const [others] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.person_access a JOIN avesmaps_auth.person p ON p.id = a.person_id
             WHERE a.environment = 'development' AND a.role = 'operator' AND a.status = 'active' AND p.status = 'active'
        `;
        expect(others!.n, "die Testdatenbank führt schon Betreiber in `development`").toBe(0);
        const lone = await fixture.person("operator", { name: "Einzige Betreiberin" });
        await database`INSERT INTO avesmaps_auth.person_access (person_id, environment, role) VALUES (${lone.id}, 'development', 'operator')`;

        const refused = await cli(["aufloesen", "--person", lone.id, "--bestaetigung", "Einzige Betreiberin"]);
        expect(refused.code).toBe(1);
        expect(refused.err).toContain("mindestens einen aktiven Betreiber");
        expect(refused.err).toContain("development");
        // Auch der Trockenlauf sagt es, statt eine Auflösung vorzuführen, die nicht geht.
        expect((await cli(["aufloesen", "--person", lone.id])).code).toBe(1);
        const [unchanged] = await database<{ status: string }[]>`
            SELECT status FROM avesmaps_auth.person WHERE id = ${lone.id}
        `;
        expect(unchanged).toEqual({ status: "active" });

        // Mit einer zweiten Betreiberin in jeder ihrer Umgebungen geht es.
        const second = await fixture.person("operator", { name: "Zweite Betreiberin" });
        await database`INSERT INTO avesmaps_auth.person_access (person_id, environment, role) VALUES (${second.id}, 'development', 'operator')`;
        expect((await cli(["aufloesen", "--person", lone.id, "--bestaetigung", "Einzige Betreiberin"])).code).toBe(0);
    });

    it("🔴 wiederholbar: ein zweiter Aufruf ist kein Fehler und schreibt nichts; Reste räumt er", async () => {
        const boss = await fixture.person("operator", { name: "Wiederholungs-Betreiberin" });
        const x = await fullAccount("editor", "Wiederholte Person", boss.id);
        expect((await cli(["aufloesen", "--benutzer", x.loginName, "--bestaetigung", "Wiederholte Person"])).code).toBe(
            0,
        );
        const [first] = await database<{ display_name: string }[]>`
            SELECT display_name FROM avesmaps_auth.person WHERE id = ${x.id}
        `;

        const again = await cli(["aufloesen", "--person", x.id]);
        expect(again.code).toBe(0);
        expect(again.out).toContain("schon aufgelöst");
        expect(await departedEvents(x.id)).toHaveLength(1);
        const [second] = await database<{ display_name: string }[]>`
            SELECT display_name FROM avesmaps_auth.person WHERE id = ${x.id}
        `;
        expect(second).toEqual(first);

        // Benutzername und Discord-ID gibt es nicht mehr; die Antwort sagt, wie man nachsieht.
        const byName = await cli(["aufloesen", "--benutzer", x.loginName]);
        expect(byName.code).toBe(1);
        expect(byName.err).toContain("--person <Kennung>");

        // Was danach noch an ihr hinge (hier: eine Sitzung und ein Eintrag mit Sperrgrund, wie ihn ein vor Migration 0083
        // aufgelöstes Konto hinterließ), räumt eine Wiederholung und sagt es im Protokoll.
        await fixture.session(x.id);
        await recordEvent(database, {
            environment: "test",
            action: "person.locked",
            actorKind: "cli",
            actorLabel: "cli:test",
            targetPersonId: x.id,
            details: { reason: "Wiederholte Person hat gepöbelt", sessions: 0 },
        });
        const cleanup = await cli(["aufloesen", "--person", x.id]);
        expect(cleanup.code).toBe(0);
        expect(cleanup.out).toContain("Reste entfernt");
        expect(cleanup.out).toContain("Protokolleinträge geschwärzt 1");
        const events = await departedEvents(x.id);
        expect(events).toHaveLength(2);
        expect(events[1]!.details).toMatchObject({ sessions: 1, methods: [], redactedEvents: 1, capabilityReasons: 0 });
        const [locked] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE target_person_id = ${x.id} AND action = 'person.locked'
        `;
        expect(locked!.details).toEqual({ reason: REDACTED, sessions: 0 });
        // Danach ist nichts mehr übrig: kein dritter Eintrag.
        expect((await cli(["aufloesen", "--person", x.id])).out).toContain("Nichts mehr zu tun");
        expect(await departedEvents(x.id)).toHaveLength(2);
    });
});
