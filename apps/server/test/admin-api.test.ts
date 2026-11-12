import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { createAccessLink } from "../src/auth/access-links.ts";
import { recordEvent } from "../src/auth/audit.ts";
import { runAuthCli } from "../src/auth/cli-commands.ts";
import { createInvitation } from "../src/auth/invitations.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type SessionOptions } from "./support/auth-fixture.ts";

/**
 * Die Verwaltungs-API (WI-0120 A7, AUTH-0001 §7.3, §9, §16; ADR-0019, ADR-0020; T12, T17, T18, T21, T23).
 *
 * Problemfälle: Rechte ohne Anmeldung, ohne Recht, mit Passwort allein; zwei Admins ändern gleichzeitig; Admin ernennt
 * Admin; Sonderrecht ohne Admin oder an sich selbst; zwei Betreiber berufen sich gegenseitig ab; Rücksetzlink hängt
 * einen fremden Anmeldeweg an. Soll: Quittung je Handlung, Wiederholung liefert dieselbe, genau ein Protokolleintrag.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const PASSKEY_FRESH: SessionOptions = { passkeyMinutesAgo: 1 };

describeWithDatabase("Verwaltungs-API", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let app: FastifyInstance | undefined;
    const legacyIds: string[] = [];

    const config = (environment: "test" | "staging" = "test"): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: { ...TEST_AUTH, environment },
    });

    async function build(environment: "test" | "staging" = "test"): Promise<FastifyInstance> {
        const instance = buildApp({
            config: config(environment),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await instance.ready();
        return instance;
    }

    const post = (url: string, cookie: string | undefined, payload: object) =>
        app!.inject({
            method: "POST",
            url,
            payload,
            headers: { origin: TEST_ORIGIN, ...(cookie === undefined ? {} : { cookie }) },
        });
    const get = (url: string, cookie?: string) =>
        app!.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });

    /** Eine Person mit Sitzung; Standard: Discord mit 2FA, gerade bestätigt (Stufe V frisch). */
    async function person(role: Role, name: string, options: SessionOptions = {}) {
        const created = await fixture.person(role, { name });
        const { cookie, id: sessionId } = await fixture.session(created.id, options);
        return { ...created, cookie, sessionId };
    }

    const events = (operationId: string) =>
        database<{ action: string; details: Record<string, unknown> }[]>`
            SELECT action, details FROM avesmaps_auth.security_event WHERE operation_id = ${operationId}
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
        await fixture.cleanup();
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 jede Verwaltungsroute: ohne Anmeldung 401, als Editor 403, Admin mit Passwort allein 403 assurance_required", async () => {
        app = await build();
        const routes: { method: string; url: string }[] = [];
        const probe = buildApp({ config: config(), logStream: { write: () => undefined } });
        probe.addHook("onRoute", (route) => {
            const methods = Array.isArray(route.method) ? route.method : [route.method];
            for (const method of methods) {
                if (route.url.startsWith("/api/admin/") && method !== "HEAD") routes.push({ method, url: route.url });
            }
        });
        await probe.ready();
        await probe.close();
        expect(routes.length).toBeGreaterThanOrEqual(20);

        // Unter der Verwaltung gibt es Routen, die schon Tester oder Editoren gehören (Valis Rechte für den WikiSync, WI-0253: Vorschau und Berichte
        // ab `tester`, einzelne Bereiche übernehmen ab `editor` mit Passkey, einen Artikel vergleichen ab `editor`). Sie
        // verlangen weiter eine Anmeldung, aber ein Editor ist dort nicht „forbidden“. Die Liste ist ausdrücklich nach den Rechten in
        // `routes/admin-wikisync.ts`, `admin-wikisync-steuerung.ts` und `admin-wikisync-regeln.ts` (Regelvorschläge, WI-0253 §24 und §25): Jede
        // Route darin muss es geben, und jede andere bleibt 403 für Editoren (zurücknehmen und die Tafeln
        // schreiben ab `admin`, ebenso die Übernahme der Regeln zurücknehmen und die Begriffstafel speichern).
        const unterAdmin = new Set([
            // view_wikisync (ab `tester`)
            "GET /api/admin/wikisync/bericht",
            "GET /api/admin/wikisync/bereiche",
            "GET /api/admin/wikisync/artikel",
            "GET /api/admin/wikisync/stand",
            "GET /api/admin/wikisync/tafeln",
            "POST /api/admin/wikisync/vorschau",
            // run_wikisync_areas und compare_wiki_article (ab `editor`)
            "POST /api/admin/wikisync/uebernehmen",
            "POST /api/admin/wikisync/artikel",
            // Regelvorschläge der Vorkommen und Begriffstafel (WI-0253 §24, §25): lesen ab `tester` (view_wikisync) ...
            "GET /api/admin/wikisync/regeln",
            "GET /api/admin/wikisync/regeln/flaechen",
            "GET /api/admin/wikisync/begriffe",
            // ... Regeln übernehmen ab `editor` mit Passkey (apply_wiki_lore_rules), einer Fläche den Wiki-Artikel zuweisen oder die Zuweisung
            // zurücknehmen ab `editor` (edit_map_objects; den Passkey verlangt nur Production). Zurücknehmen der Regeln und die Begriffstafel
            // schreiben bleiben `admin` und fallen darum durch die Schleife unten.
            "POST /api/admin/wikisync/regeln/uebernehmen",
            "POST /api/admin/wikisync/regeln/flaeche-zuweisen",
            "POST /api/admin/wikisync/regeln/flaeche-zuruecknehmen",
        ]);
        expect(routes.map((r) => `${r.method} ${r.url}`)).toEqual(expect.arrayContaining([...unterAdmin]));

        const editor = await person("editor", "Redakteurin");
        const passwordAdmin = await person("admin", "Passwort-Admin", { method: "password", assurance: "basic" });
        for (const { method, url } of routes) {
            const path = url.replace(":personId", randomUUID());
            // Jede Route mit ihrer eigenen Methode (die Stücke eines Kartenuploads kommen per PUT, WI-0220 Schnitt 3).
            const send = (cookie?: string) =>
                method === "GET"
                    ? get(path, cookie)
                    : app!.inject({
                          method: method as "POST" | "PUT" | "DELETE" | "PATCH",
                          url: path,
                          payload: { unvollständig: true },
                          headers: { origin: TEST_ORIGIN, ...(cookie === undefined ? {} : { cookie }) },
                      });
            const anonymous = await send();
            expect([path, anonymous.statusCode, anonymous.json().error.code]).toEqual([path, 401, "unauthenticated"]);
            if (unterAdmin.has(`${method} ${url}`)) {
                const erlaubt = await send(editor.cookie);
                const code =
                    erlaubt.statusCode === 403 ? (erlaubt.json() as { error?: { code?: string } }).error?.code : null;
                expect([path, code]).not.toEqual([path, "forbidden"]);
                continue;
            }
            const forbidden = await send(editor.cookie);
            expect([path, forbidden.statusCode, forbidden.json().error.code]).toEqual([path, 403, "forbidden"]);
            const weak = await send(passwordAdmin.cookie);
            expect([path, weak.statusCode]).toEqual([path, 403]);
            expect(["assurance_required", "forbidden"]).toContain(weak.json().error.code);
        }
        const list = await get("/api/admin/people", passwordAdmin.cookie);
        expect(list.json().error).toMatchObject({ code: "assurance_required", details: { need: "second_factor" } });
        expect(list.headers["cache-control"]).toBe("no-store");
    });

    it("🔴 Rolle ändern: Quittung mit Revision, ein Protokolleintrag, Rotation; Wiederholung gleiche Quittung, anderer Inhalt 409", async () => {
        app = await build();
        const admin = await person("admin", "Rondra-Admin");
        const tester = await person("tester", "Testerin");
        const operationId = randomUUID();
        const body = { operationId, personId: tester.id, role: "editor", baseRevision: 1 };
        const first = await post("/api/admin/people/role", admin.cookie, body);
        expect(first.statusCode).toBe(200);
        expect(first.json()).toMatchObject({
            operationId,
            status: "applied",
            environment: "test",
            affected: [{ kind: "person_access", id: tester.id, revision: 2 }],
        });
        const again = await post("/api/admin/people/role", admin.cookie, body);
        expect(again.json()).toEqual({ ...first.json(), status: "replayed" });
        const other = await post("/api/admin/people/role", admin.cookie, { ...body, role: "reviewer" });
        expect(other.json().error.code).toBe("idempotency_key_reused");
        expect(await events(operationId)).toEqual([
            { action: "person.role_changed", details: { from: "tester", to: "editor" } },
        ]);
        const [rotation] = await database<{ rotate: boolean }[]>`
            SELECT rotate_required AS rotate FROM avesmaps_auth.session WHERE id = ${tester.sessionId}
        `;
        expect(rotation?.rotate).toBe(true);
    });

    it("🔴 zwei gleichzeitige Rollenänderungen: eine gewinnt, die andere bekommt 409 edit_conflict mit Wer und Wann", async () => {
        app = await build();
        const first = await person("admin", "Erste Admin");
        const second = await person("admin", "Zweite Admin");
        const editor = await person("editor", "Umstrittene");
        const [a, b] = await Promise.all([
            post("/api/admin/people/role", first.cookie, {
                operationId: randomUUID(),
                personId: editor.id,
                role: "reviewer",
                baseRevision: 1,
            }),
            post("/api/admin/people/role", second.cookie, {
                operationId: randomUUID(),
                personId: editor.id,
                role: "tester",
                baseRevision: 1,
            }),
        ]);
        const statuses = [a.statusCode, b.statusCode].sort();
        expect(statuses).toEqual([200, 409]);
        const [winner, loser] = a.statusCode === 200 ? [first, b] : [second, a];
        expect(loser.json().error).toMatchObject({
            code: "edit_conflict",
            details: { currentRevision: 2, changedBy: { id: winner.id, displayName: winner.name } },
        });
        expect(typeof loser.json().error.details.changedAt).toBe("string");
    });

    it("🔴 Stufenregel: Admin ernennt keinen Admin, verwaltet keine Admins und nicht sich selbst; Betreiber nur mit frischem Passkey (T12)", async () => {
        app = await build();
        const admin = await person("admin", "Stufen-Admin");
        const otherAdmin = await person("admin", "Andere Admin");
        const editor = await person("editor", "Aufsteigerin");
        const role = (cookie: string, personId: string, next: string) =>
            post("/api/admin/people/role", cookie, {
                operationId: randomUUID(),
                personId,
                role: next,
                baseRevision: 1,
            });
        expect((await role(admin.cookie, editor.id, "admin")).json().error.code).toBe("forbidden_role");
        expect((await role(admin.cookie, otherAdmin.id, "editor")).json().error.code).toBe("forbidden_target");
        expect((await role(admin.cookie, admin.id, "editor")).json().error.code).toBe("self_change");
        const lock = await post("/api/admin/people/lock", admin.cookie, {
            operationId: randomUUID(),
            personId: otherAdmin.id,
            reason: "Probe",
            baseRevision: 1,
        });
        expect(lock.json().error.code).toBe("forbidden_target");

        const operator = await person("operator", "Betreiberin ohne Passkey");
        const withoutPasskey = await role(operator.cookie, editor.id, "admin");
        expect(withoutPasskey.json().error).toMatchObject({ code: "reauth_required", details: { need: "passkey" } });
        const fresh = await person("operator", "Betreiberin mit Passkey", PASSKEY_FRESH);
        expect((await role(fresh.cookie, editor.id, "admin")).statusCode).toBe(200);
    });

    it("🔴 Sonderrechte nur an Admins, nie an sich selbst, nur durch den Betreiber; Herabstufung entzieht sie (T23)", async () => {
        app = await build();
        const operator = await person("operator", "Leitung", PASSKEY_FRESH);
        const admin = await person("admin", "Systemadmin");
        const editor = await person("editor", "Ohne Sonderrecht");
        const grant = (cookie: string, personId: string, capability: string) =>
            post("/api/admin/people/capabilities/grant", cookie, {
                operationId: randomUUID(),
                personId,
                capability,
                reason: "Wartungsfenster",
            });
        expect((await grant(admin.cookie, editor.id, "access_restricted_mode")).json().error.code).toBe("forbidden");
        expect((await grant(operator.cookie, admin.id, "access_restricted_mode")).statusCode).toBe(200);
        expect((await grant(operator.cookie, admin.id, "access_restricted_mode")).json().error.code).toBe("no_change");
        expect((await grant(operator.cookie, editor.id, "access_restricted_mode")).json().error.code).toBe(
            "grant_requires_admin",
        );
        expect((await grant(operator.cookie, operator.id, "manage_system_settings")).json().error.code).toBe(
            "self_change",
        );
        expect((await grant(operator.cookie, admin.id, "assign_admin")).json().error.code).toBe(
            "capability_not_grantable",
        );

        const session = await get("/api/auth/session", admin.cookie);
        expect(session.json().capabilities).toContain("access_restricted_mode");
        const overview = await get("/api/admin/roles", operator.cookie);
        expect(overview.json().grants).toContainEqual(
            expect.objectContaining({ person: { id: admin.id, displayName: admin.name }, reason: "Wartungsfenster" }),
        );

        const operationId = randomUUID();
        const demote = await post("/api/admin/people/role", operator.cookie, {
            operationId,
            personId: admin.id,
            role: "editor",
            baseRevision: 1,
        });
        expect(demote.statusCode).toBe(200);
        expect(await events(operationId)).toEqual([
            {
                action: "person.role_changed",
                details: { from: "admin", to: "editor", revokedCapabilities: ["access_restricted_mode"] },
            },
        ]);
        const [active] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.capability_grant WHERE person_id = ${admin.id} AND revoked_at IS NULL
        `;
        expect(active?.n).toBe(0);
    });

    it("🔴 Sperren beendet alle Sitzungen, veraltete Revision 409, Entsperren; eine Anmeldung zählt die Revision nicht hoch", async () => {
        app = await build();
        const admin = await person("admin", "Wache");
        const editor = await person("editor", "Gesperrte");
        await database`UPDATE avesmaps_auth.person SET last_login_at = now() WHERE id = ${editor.id}`;
        const lock = await post("/api/admin/people/lock", admin.cookie, {
            operationId: randomUUID(),
            personId: editor.id,
            reason: "Verdacht auf Fremdzugriff",
            baseRevision: 1,
        });
        expect(lock.statusCode).toBe(200);
        expect(lock.json().affected).toEqual([{ kind: "person", id: editor.id, revision: 2 }]);
        expect((await get("/api/account/passkeys", editor.cookie)).statusCode).toBe(401);
        // Die Liste nennt Wann und Wer der Sperre (Mockup „gesperrt · seit gestern · Rondrikan“, A10).
        const listed = (await get("/api/admin/people", admin.cookie))
            .json()
            .people.find((entry: { id: string }) => entry.id === editor.id);
        expect(listed).toMatchObject({
            status: "locked",
            lockReason: "Verdacht auf Fremdzugriff",
            lockedBy: { id: admin.id, displayName: admin.name },
        });
        expect(typeof listed.lockedAt).toBe("string");
        const stale = await post("/api/admin/people/lock", admin.cookie, {
            operationId: randomUUID(),
            personId: editor.id,
            reason: "noch einmal",
            baseRevision: 1,
        });
        expect(stale.json().error).toMatchObject({
            code: "edit_conflict",
            details: { currentRevision: 2, changedBy: { id: admin.id, displayName: admin.name } },
        });
        const unlock = await post("/api/admin/people/unlock", admin.cookie, {
            operationId: randomUUID(),
            personId: editor.id,
            baseRevision: 2,
        });
        expect(unlock.statusCode).toBe(200);
        const detail = await get(`/api/admin/people/${editor.id}`, admin.cookie);
        expect(detail.json().person).toMatchObject({ status: "active", revision: 3, activeSessions: 0 });
    });

    it("🔴 zwei Betreiber berufen sich gleichzeitig gegenseitig ab: genau einer bleibt Betreiber", async () => {
        app = await build("staging");
        const first = await fixture.person("operator", { name: "Erster Betreiber" });
        const second = await fixture.person("operator", { name: "Zweiter Betreiber" });
        await database`
            INSERT INTO avesmaps_auth.person_access (person_id, environment, role)
            VALUES (${first.id}, 'staging', 'operator'), (${second.id}, 'staging', 'operator')
        `;
        const options: SessionOptions = { ...PASSKEY_FRESH, environment: "staging" };
        const one = await fixture.session(first.id, options);
        const two = await fixture.session(second.id, options);
        const [a, b] = await Promise.all([
            post("/api/admin/people/role", one.cookie, {
                operationId: randomUUID(),
                personId: second.id,
                role: "admin",
                baseRevision: 1,
            }),
            post("/api/admin/people/role", two.cookie, {
                operationId: randomUUID(),
                personId: first.id,
                role: "admin",
                baseRevision: 1,
            }),
        ]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([200, 403]);
        // Welche 403 der Verlierer sieht, hängt am Zeitpunkt: Wartete er schon an der Sperre, liest er dort seine neue Rolle
        // (`rights_changed`); kam seine Anfrage erst nach dem Abberufen an, lädt schon die Sitzung ihn als Admin, und ein Admin
        // verwaltet keinen Betreiber (`forbidden_target`). Beides ist richtig; die Zusicherung ist die Zahl darunter.
        expect(["rights_changed", "forbidden_target"]).toContain(
            [a, b].find((response) => response.statusCode === 403)?.json().error.code,
        );
        const [operators] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.person_access
             WHERE environment = 'staging' AND role = 'operator' AND person_id IN (${first.id}, ${second.id})
        `;
        expect(operators?.n).toBe(1);
    });

    it("🔴 Einladungen: Link nur in der ersten Antwort, Liste nur mit Hinweis; Admin-Einladung nur Betreiber und gebunden", async () => {
        app = await build();
        const admin = await person("admin", "Einladende");
        const operationId = randomUUID();
        const body = { operationId, role: "editor", validDays: 7, note: "Hesindian vom Forum" };
        const created = await post("/api/admin/invitations", admin.cookie, body);
        expect(created.statusCode).toBe(200);
        const link = created.json().link as string;
        expect(link).toMatch(/^https:\/\/avesmaps\.test\/einladung#[A-Za-z0-9_-]{43}$/u);
        const token = link.split("#")[1]!;
        const replay = await post("/api/admin/invitations", admin.cookie, body);
        expect(replay.json()).toMatchObject({ link: null, receipt: { status: "replayed" } });
        expect(replay.json().receipt.warnings).toContainEqual(expect.objectContaining({ code: "link_shown_once" }));

        const list = await get("/api/admin/invitations", admin.cookie);
        expect(list.body).not.toContain(token);
        const listed = (list.json().invitations as { tokenHint: string; status: string; id: string }[]).find(
            (entry) => entry.tokenHint === token.slice(-4) && entry.status === "open",
        );
        expect(listed).toBeDefined();

        const adminInvite = await post("/api/admin/invitations", admin.cookie, {
            operationId: randomUUID(),
            role: "admin",
            validDays: 1,
        });
        expect(adminInvite.json().error.code).toBe("forbidden_role");
        const operator = await person("operator", "Leitung", PASSKEY_FRESH);
        const unbound = await post("/api/admin/invitations", operator.cookie, {
            operationId: randomUUID(),
            role: "admin",
            validDays: 1,
        });
        expect(unbound.json().error.code).toBe("invitation_binding_required");
        const bound = await post("/api/admin/invitations", operator.cookie, {
            operationId: randomUUID(),
            role: "admin",
            validDays: 1,
            discordUserId: "123456789012345678",
        });
        expect(bound.statusCode).toBe(200);
    });

    /** G2-01: Was ein Admin ausgestellt hat (eine offene Einladung, einen Rücksetzlink für einen Editor) und was ein anderer ausgestellt hat. */
    async function issuedBy(issuer: { id: string }, other: { id: string }) {
        const target = await person("editor", "Ziel des Links");
        await database`
            INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash)
            VALUES (${target.id}, ${`g2-${target.id.slice(0, 8)}`}, '$argon2id$v=19$m=19456,t=2,p=1$platzhalter')
        `;
        const invite = (createdBy: string) =>
            createInvitation(database, { environment: "test", role: "editor", validDays: 7, createdBy });
        const own = await invite(issuer.id);
        const foreign = await invite(other.id);
        const link = await createAccessLink(database, {
            kind: "password_reset",
            personId: target.id,
            createdBy: issuer.id,
        });
        const PASSWORD = "Ein Satz zur Begrüßung in Gareth";
        const accept = (token: string) =>
            post("/api/auth/invitations/accept", undefined, {
                token,
                loginName: `g2-${randomUUID().slice(0, 8)}`,
                displayName: "Nachzügler",
                password: PASSWORD,
            });
        const redeem = (token: string) => post("/api/auth/password-reset", undefined, { token, password: PASSWORD });
        const gone = async () => {
            expect((await accept(own.token)).json().error.code).toBe("invitation_invalid");
            expect((await redeem(link.token)).json().error.code).toBe("link_invalid");
        };
        // Die Einladung eines anderen gilt weiter (inspect statt accept: kein neues Konto).
        const otherStillValid = async () =>
            expect((await post("/api/auth/invitations/inspect", undefined, { token: foreign.token })).statusCode).toBe(
                200,
            );
        return { gone, otherStillValid };
    }

    it("🔴 Sperren über die Route zieht die Einladungen und Rücksetzlinks des Gesperrten zurück (G2-01)", async () => {
        app = await build();
        const operator = await person("operator", "Wache", PASSKEY_FRESH);
        const admin = await person("admin", "Gesperrter Admin");
        const other = await person("admin", "Andere Einladende");
        const { gone, otherStillValid } = await issuedBy(admin, other);
        const lock = await post("/api/admin/people/lock", operator.cookie, {
            operationId: randomUUID(),
            personId: admin.id,
            reason: "Verdacht",
            baseRevision: 1,
        });
        expect(lock.statusCode).toBe(200);
        await gone();
        await otherStillValid();
        const [event] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'person.locked' AND target_person_id = ${admin.id}
        `;
        expect(event?.details).toMatchObject({ revokedInvitations: 1, revokedLinks: 1 });
    });

    it("🔴 Sperren über die Kommandozeile zieht die Einladungen und Rücksetzlinks zurück (G2-01)", async () => {
        app = await build();
        const admin = await person("admin", "Gesperrter Admin");
        const other = await person("admin", "Andere Einladende");
        const { gone, otherStillValid } = await issuedBy(admin, other);
        const code = await runAuthCli(
            ["sperren", "--person", admin.id, "--grund", "Verdacht"],
            { AVESMAPS_ENV: "test", PUBLIC_ORIGIN: TEST_ORIGIN },
            { out: () => undefined, err: () => undefined },
            { database, systemUser: "test" },
        );
        expect(code).toBe(0);
        await gone();
        await otherStillValid();
        const [event] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'person.locked' AND target_person_id = ${admin.id}
        `;
        expect(event?.details).toMatchObject({ revokedInvitations: 1, revokedLinks: 1 });
    });

    it("🔴 Zugangsentzug zieht die Einladungen und Rücksetzlinks zurück (G2-01)", async () => {
        app = await build();
        const operator = await person("operator", "Leitung", PASSKEY_FRESH);
        const admin = await person("admin", "Entzogener Admin");
        const other = await person("admin", "Andere Einladende");
        const { gone, otherStillValid } = await issuedBy(admin, other);
        const revoke = await post("/api/admin/people/access/revoke", operator.cookie, {
            operationId: randomUUID(),
            personId: admin.id,
            baseRevision: 1,
        });
        expect(revoke.statusCode).toBe(200);
        await gone();
        await otherStillValid();
        const [event] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'access.revoked' AND target_person_id = ${admin.id}
        `;
        expect(event?.details).toMatchObject({ revokedInvitations: 1, revokedLinks: 1 });
    });

    it("🔴 Herabstufung zieht die Einladungen und Rücksetzlinks zurück, eine Hochstufung nicht (G2-01)", async () => {
        app = await build();
        const operator = await person("operator", "Leitung", PASSKEY_FRESH);
        const admin = await person("admin", "Herabgestufter Admin");
        const other = await person("admin", "Andere Einladende");
        const { gone, otherStillValid } = await issuedBy(admin, other);
        const role = (personId: string, next: string) =>
            post("/api/admin/people/role", operator.cookie, {
                operationId: randomUUID(),
                personId,
                role: next,
                baseRevision: 1,
            });
        expect((await role(admin.id, "editor")).statusCode).toBe(200);
        await gone();
        await otherStillValid();
        const [event] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'person.role_changed' AND target_person_id = ${admin.id}
        `;
        expect(event?.details).toMatchObject({ from: "admin", to: "editor", revokedInvitations: 1, revokedLinks: 1 });

        // Hochstufung: die offene Einladung bleibt.
        const promoted = await person("admin", "Hochgestufter Admin");
        const kept = await createInvitation(database, {
            environment: "test",
            role: "editor",
            validDays: 7,
            createdBy: promoted.id,
        });
        expect((await role(promoted.id, "operator")).statusCode).toBe(200);
        expect((await post("/api/auth/invitations/inspect", undefined, { token: kept.token })).statusCode).toBe(200);
    });

    it("🔴 Einladung zurückziehen und neu ausstellen: der alte Link erlischt, der neue gilt", async () => {
        app = await build();
        const admin = await person("admin", "Einladungsverwaltung");
        const inspect = (token: string) => post("/api/auth/invitations/inspect", undefined, { token });
        const create = async () => {
            const response = await post("/api/admin/invitations", admin.cookie, {
                operationId: randomUUID(),
                role: "reviewer",
                validDays: 3,
            });
            const token = (response.json().link as string).split("#")[1]!;
            return { id: response.json().receipt.affected[0].id as string, token };
        };
        const withdrawn = await create();
        const revoke = await post("/api/admin/invitations/revoke", admin.cookie, {
            operationId: randomUUID(),
            invitationId: withdrawn.id,
            baseRevision: 1,
        });
        expect(revoke.statusCode).toBe(200);
        expect((await inspect(withdrawn.token)).json().error.code).toBe("invitation_invalid");

        const renewed = await create();
        const reissue = await post("/api/admin/invitations/reissue", admin.cookie, {
            operationId: randomUUID(),
            invitationId: renewed.id,
            baseRevision: 1,
        });
        expect(reissue.statusCode).toBe(200);
        const newToken = (reissue.json().link as string).split("#")[1]!;
        expect((await inspect(renewed.token)).json().error.code).toBe("invitation_invalid");
        expect((await inspect(newToken)).json()).toMatchObject({ role: "reviewer", requiresDiscord: false });
        const list = await get("/api/admin/invitations", admin.cookie);
        const old = (list.json().invitations as { id: string; status: string }[]).find(
            (entry) => entry.id === renewed.id,
        );
        expect(old?.status).toBe("replaced");
    });

    it("🔴 Rücksetzlink nur für ein vorhandenes Passwort; Passkey-Link nur der Betreiber mit frischem Passkey", async () => {
        app = await build();
        const admin = await person("admin", "Helferin");
        const withPassword = await person("editor", "Mit Passwort");
        const discordOnly = await person("editor", "Nur Discord");
        await database`
            INSERT INTO avesmaps_auth.password_login (person_id, login_name, password_hash)
            VALUES (${withPassword.id}, ${`a7-${withPassword.id.slice(0, 8)}`}, '$argon2id$v=19$m=19456,t=2,p=1$platzhalter')
        `;
        const reset = (cookie: string, personId: string) =>
            post("/api/admin/people/reset-link", cookie, { operationId: randomUUID(), personId });
        const link = await reset(admin.cookie, withPassword.id);
        expect(link.json().link).toMatch(/^https:\/\/avesmaps\.test\/passwort#[A-Za-z0-9_-]{43}$/u);
        expect((await reset(admin.cookie, discordOnly.id)).json().error.code).toBe("no_password_login");

        const passkeyLink = (cookie: string) =>
            post("/api/admin/people/passkey-link", cookie, { operationId: randomUUID(), personId: withPassword.id });
        expect((await passkeyLink(admin.cookie)).json().error.code).toBe("forbidden");
        const operator = await person("operator", "Leitung", PASSKEY_FRESH);
        expect((await passkeyLink(operator.cookie)).json().link).toMatch(/\/passkey#[A-Za-z0-9_-]{43}$/u);
        const [event] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event
             WHERE action = 'access_link.created' AND target_person_id = ${withPassword.id} AND actor_person_id = ${operator.id}
        `;
        expect(event?.details).toEqual({ kind: "passkey_enrollment", validHours: 24 });
    });

    it("🔴 Sitzungen beenden: eine oder alle, nie die eigene über die Verwaltung", async () => {
        app = await build();
        const admin = await person("admin", "Aufräumerin");
        const editor = await person("editor", "Viele Geräte");
        const second = await fixture.session(editor.id);
        const one = await post("/api/admin/people/sessions/revoke", admin.cookie, {
            operationId: randomUUID(),
            personId: editor.id,
            sessionId: second.id,
        });
        expect(one.json().affected).toEqual([{ kind: "session", id: second.id }]);
        expect((await get("/api/account/passkeys", second.cookie)).statusCode).toBe(401);
        expect((await get("/api/account/passkeys", editor.cookie)).statusCode).toBe(200);
        const all = await post("/api/admin/people/sessions/revoke", admin.cookie, {
            operationId: randomUUID(),
            personId: editor.id,
        });
        expect(all.json().affected).toHaveLength(1);
        const own = await post("/api/admin/people/sessions/revoke", admin.cookie, {
            operationId: randomUUID(),
            personId: admin.id,
        });
        expect(own.json().error.code).toBe("self_change");
    });

    it("🔴 Protokoll: Filter nach Person und Gruppe, Blättern; Legacy-Namen zuordnen mit Begründung, Maschine nie", async () => {
        app = await build();
        const admin = await person("admin", "Chronistin");
        const editor = await person("editor", "Alte Bekannte");
        const legacyUser = String(9_000_000_000 + Math.floor(Math.random() * 1_000_000));
        const [human] = await database<{ id: string }[]>`
            INSERT INTO avesmaps_auth.legacy_identity (legacy_user_id, legacy_name, kind)
            VALUES (${legacyUser}, 'Hesindian_alt', 'person') RETURNING id::text
        `;
        const [machine] = await database<{ id: string }[]>`
            INSERT INTO avesmaps_auth.legacy_identity (legacy_name, kind) VALUES ('Import/System', 'machine') RETURNING id::text
        `;
        legacyIds.push(human!.id, machine!.id);
        const map = (id: string, baseRevision: number) =>
            post("/api/admin/legacy/map", admin.cookie, {
                operationId: randomUUID(),
                legacyIdentityId: id,
                personId: editor.id,
                evidence: "Selbe Discord-ID im Forum",
                baseRevision,
            });
        expect((await map(machine!.id, 1)).json().error.code).toBe("legacy_machine");
        expect((await map(human!.id, 1)).statusCode).toBe(200);
        expect((await map(human!.id, 2)).json().error.code).toBe("legacy_already_mapped");
        const detail = await get(`/api/admin/people/${editor.id}`, admin.cookie);
        expect(detail.json().legacy).toEqual([
            { id: human!.id, legacyName: "Hesindian_alt", legacyUserId: legacyUser, revision: 2 },
        ]);
        // Die Revision im Detail ist die, mit der das Fenster die Zuordnung löst (A10).
        const unmap = await post("/api/admin/legacy/unmap", admin.cookie, {
            operationId: randomUUID(),
            legacyIdentityId: human!.id,
            baseRevision: detail.json().legacy[0].revision,
        });
        expect(unmap.statusCode).toBe(200);

        const page = await get(`/api/admin/audit?personId=${editor.id}&action=legacy.&limit=1`, admin.cookie);
        expect(page.json().events.map((event: { action: string }) => event.action)).toEqual(["legacy.unmapped"]);
        expect(page.json().events[0]).toMatchObject({
            actor: { id: admin.id, displayName: admin.name },
            target: { id: editor.id, displayName: editor.name },
            recovery: false,
        });
        const next = await get(
            `/api/admin/audit?personId=${editor.id}&action=legacy.&limit=1&before=${page.json().next as string}`,
            admin.cookie,
        );
        expect(next.json().events.map((event: { action: string }) => event.action)).toEqual(["legacy.mapped"]);
        expect(next.json().events[0].details).toEqual({
            legacyName: "Hesindian_alt",
            legacyUserId: legacyUser,
            evidence: "Selbe Discord-ID im Forum",
        });
    });

    it("🔴 Protokoll-Suche q: Namen, Werte der Details und Handlung in der Datenbank; % und _ sind Zeichen; Titel-Treffer mit qAktionen", async () => {
        // Betreiber 2026-10-11 (Entscheidungsprotokoll 3f7acfc8): eine Freitextsuche links in jeder Leiste; das Protokoll blättert in Seiten
        // zu 50, also sucht der Server.
        app = await build();
        const admin = await person("admin", "Chronistin der Suche");
        const marke = randomUUID().slice(0, 8);
        const ziel = await person("editor", `Zaun_König ${marke}`);
        await recordEvent(database, {
            environment: "test",
            action: "person.locked",
            actorKind: "person",
            actorPersonId: admin.id,
            targetPersonId: ziel.id,
            details: { reason: `Probe 100% Suche ${marke}`, sessions: 0 },
        });
        const suche = async (query: string) => {
            const response = await get(`/api/admin/audit?personId=${ziel.id}&${query}`, admin.cookie);
            expect(response.statusCode).toBe(200);
            return (response.json().events as { action: string }[]).map((event) => event.action);
        };
        // Der Name der betroffenen Person, ohne Groß und Klein.
        expect(await suche(`q=${encodeURIComponent(`zaun_könig ${marke}`)}`)).toContain("person.locked");
        // Ein Wert der Details.
        expect(await suche(`q=${encodeURIComponent(`100% Suche ${marke}`)}`)).toEqual(["person.locked"]);
        // Die Handlung selbst.
        expect(await suche("q=locked")).toContain("person.locked");
        // % und _ sind Zeichen, kein Muster: „Zaun%König“ trifft „Zaun_König“ nicht, „Zaun_K“ schon.
        expect(await suche(`q=${encodeURIComponent("Zaun%König")}`)).toEqual([]);
        expect(await suche(`q=${encodeURIComponent("Zaunxkönig")}`)).toEqual([]);
        expect(await suche(`q=${encodeURIComponent("Zaun_K")}`)).toContain("person.locked");
        // Die Titel kennt nur die Oberfläche: Sie schickt die Handlungen mit, deren Titel passt („gesperrt“).
        expect(await suche("q=gesperrt")).toEqual([]);
        expect(await suche("q=gesperrt&qAktionen=person.locked,person.unlocked")).toEqual(["person.locked"]);
        // qAktionen ohne q gilt nicht, eine falsche Liste ist 400.
        expect(await suche("qAktionen=login.failure")).toContain("person.locked");
        const falsch = await get("/api/admin/audit?q=x&qAktionen=DROP%20TABLE", admin.cookie);
        expect(falsch.statusCode).toBe(400);
    });
});
