import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { recordEvent } from "../src/auth/audit.ts";
import { dissolvePerson } from "../src/auth/dissolve.ts";
import type { ServerConfig } from "../src/config.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { fullAccount } from "./support/full-account.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Verantwortlich für:“ (WI-0133, Betreiber 2026-10-10) gegen echtes PostgreSQL mit den Rollen des VPS: Fastify meldet sich als
 * App-Rolle an wie auf Stage (Migration 0097 samt Rechten der Tafel `person`), die Personen legt der Superuser an. Ein eigener
 * Wegwerf-Cluster, weil 0097 vor dem Push nicht in die geteilte Testdatenbank gehört.
 *
 * Problemfälle: die Person selbst (Stufe R, ohne jedes Verwaltungsrecht), der Betreiber an einer anderen, ein Admin ohne das Recht,
 * ein Reviewer, ein Betreiber ohne zweiten Faktor, Zeilenumbruch, 121 Zeichen, nur Leerzeichen, leer, veraltete Revision, ein
 * aufgelöstes Konto, das Auflösen selbst. Soll: genau ein Protokolleintrag je Änderung, in dem der Text nirgends steht; der Wert in
 * Personenansicht, Konto und Sitzung; die Bedingung der Tafel hält auch einen Schreiber am Server vorbei auf.
 *
 * Dazu die Rechte im Schema `avesmaps_auth` als App- und Jobs-Rolle (WI-0189, vorher per `SET ROLE` in Handrollen in
 * `auth-schema.test.ts`, `auth-redact-events.test.ts` und `auth-dissolve.test.ts`): Personen anlegen, nie löschen; am Protokoll nur
 * anhängen, schwärzen nur über `redact_person_events`; Sitzungen löschen; die Aufbewahrung nur die Jobs-Rolle, die sonst an keine Tafel
 * des Schemas kommt; das Auflösen einer Person mit allem, was ein Konto tragen kann, als App-Rolle.
 */

const ENV = "responsibility";
const describeWithCluster = postgresBin ? describe : describe.skip;

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "wi-0133-test",
    databaseUrl: undefined,
    tileRoot: undefined,
    auth: TEST_AUTH,
};

describeWithCluster("„Verantwortlich für:“ (Wegwerf-Cluster mit den Rollen des VPS)", { timeout: 180_000 }, () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let app: FastifyInstance;

    beforeAll(async () => {
        // Die Auflösung schwärzt auch im Betreiber-Kanal (Migration 0106); seine Rechte kommen aus kanal-grants.psql. Die Rechte im Schema
        // avesmaps_auth stehen abgeschrieben im Werkzeug; die Vorlage selbst läuft dazu, damit die Fälle unten auch sie prüfen.
        cluster = await startVpsCluster(
            ENV,
            ["auth-grants.psql", "kanal-grants.psql"].map((file) =>
                fileURLToPath(new URL(`../src/db/${file}`, import.meta.url)),
            ),
        );
        fixture = authFixture(cluster.admin);
        app = buildApp({ config, database: cluster.app, logStream: { write: () => undefined } });
        await app.ready();
    }, 180_000);

    afterEach(async () => {
        await fixture.cleanup();
    });

    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    async function someone(role: Role, name: string, assurance: "strong" | "basic" = "strong") {
        const person = await fixture.person(role, { name });
        const { cookie } = await fixture.session(person.id, {
            assurance,
            ...(assurance === "basic" ? { passkeyMinutesAgo: null } : {}),
        });
        return { ...person, cookie };
    }

    const post = (url: string, cookie: string, payload: object) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
    const own = (cookie: string, responsibleFor: string, baseRevision: number, operationId: string = randomUUID()) =>
        post("/api/account/responsibility", cookie, { operationId, responsibleFor, baseRevision });
    const forPerson = (cookie: string, personId: string, responsibleFor: string, baseRevision: number) =>
        post("/api/admin/people/responsibility", cookie, {
            operationId: randomUUID(),
            personId,
            responsibleFor,
            baseRevision,
        });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

    async function stored(personId: string): Promise<{ responsible_for: string | null; revision: number }> {
        const [row] = await cluster!.admin<{ responsible_for: string | null; revision: number }[]>`
            SELECT responsible_for, revision::int AS revision FROM avesmaps_auth.person WHERE id = ${personId}
        `;
        return row!;
    }

    /** Die Einträge zu dieser Person, ganz, als Text: So fällt jeder Rest des Freitexts auf, auch in Quittung und Einzelheiten. */
    async function events(personId: string) {
        return cluster!.admin<
            {
                actor_person_id: string | null;
                details: Record<string, unknown>;
                operation_id: string | null;
                row: string;
            }[]
        >`
            SELECT e.actor_person_id, e.details, e.operation_id::text AS operation_id, to_jsonb(e)::text AS row
              FROM avesmaps_auth.security_event e
             WHERE e.target_person_id = ${personId} AND e.action = 'person.responsibility_changed'
             ORDER BY e.id
        `;
    }

    it("🔴 selbst ändern: jede Person mit Konto, Stufe R; genau ein Eintrag ohne den Text, in Konto und Sitzung sichtbar", async () => {
        const vali = await someone("tester", "Vali", "basic");
        const text = "Entwicklung, Claudia, Claudio, Gemotze";
        const operationId = randomUUID();
        const first = await own(vali.cookie, `  ${text}  `, 1, operationId);
        expect(code(first)).toBe("200");
        expect(first.json()).toMatchObject({
            status: "applied",
            affected: [{ kind: "person", id: vali.id, revision: 2 }],
        });
        expect(await stored(vali.id)).toEqual({ responsible_for: text, revision: 2 });
        // Dieselbe Kennung: dieselbe Quittung, kein zweiter Eintrag.
        expect((await own(vali.cookie, text, 1, operationId)).json().status).toBe("replayed");

        const logged = await events(vali.id);
        expect(logged).toHaveLength(1);
        expect(logged[0]).toMatchObject({
            actor_person_id: vali.id,
            details: { via: "self", cleared: false },
            operation_id: operationId,
        });
        for (const piece of ["Entwicklung", "Gemotze"]) expect(logged[0]!.row).not.toContain(piece);

        const account = await app.inject({ method: "GET", url: "/api/account", headers: { cookie: vali.cookie } });
        expect(account.json().person.responsibleFor).toBe(text);
        const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: vali.cookie } });
        expect(session.json().person.responsibleFor).toBe(text);

        // Auch ein Reviewer ändert seinen eigenen Eintrag; das Recht der Verwaltung braucht er dafür nicht.
        const reviewer = await someone("reviewer", "Rhenaya", "basic");
        expect(code(await own(reviewer.cookie, "Meldungen", 1))).toBe("200");
        expect(
            code(
                await post("/api/account/responsibility", "", {
                    operationId: randomUUID(),
                    responsibleFor: "x",
                    baseRevision: 1,
                }),
            ),
        ).toBe("401 unauthenticated");
    });

    it("🔴 der Betreiber ändert bei einer anderen Person; der Admin liest es nur, ohne Recht 403; der Reviewer 403", async () => {
        const operator = await someone("operator", "Rondrikan");
        const admin = await someone("admin", "Admina");
        const reviewer = await someone("reviewer", "Prüferin");
        const editor = await someone("editor", "Editorin", "basic");

        const set = await forPerson(operator.cookie, editor.id, "Redaktion Garetien", 1);
        expect(code(set)).toBe("200");
        expect(await stored(editor.id)).toEqual({ responsible_for: "Redaktion Garetien", revision: 2 });
        const logged = await events(editor.id);
        expect(logged).toHaveLength(1);
        expect(logged[0]).toMatchObject({ actor_person_id: operator.id, details: { via: "operator", cleared: false } });
        expect(logged[0]!.row).not.toContain("Garetien");

        // Lesen: wer Personen sieht, sieht den Eintrag (Liste und Detail), ändern darf er ihn nicht.
        const detail = await app.inject({
            method: "GET",
            url: `/api/admin/people/${editor.id}`,
            headers: { cookie: admin.cookie },
        });
        expect(detail.json().person.responsibleFor).toBe("Redaktion Garetien");
        const list = await app.inject({ method: "GET", url: "/api/admin/people", headers: { cookie: admin.cookie } });
        expect(
            (list.json().people as { id: string; responsibleFor: string | null }[]).find(
                (person) => person.id === editor.id,
            )?.responsibleFor,
        ).toBe("Redaktion Garetien");

        expect(code(await forPerson(admin.cookie, editor.id, "Admins Wunsch", 2))).toBe("403 forbidden");
        expect(code(await forPerson(reviewer.cookie, editor.id, "Prüferins Wunsch", 2))).toBe("403 forbidden");
        // Der Betreiber ohne zweiten Faktor: Stufe V fehlt.
        const operatorBasic = await someone("operator", "Ohne Faktor", "basic");
        expect(code(await forPerson(operatorBasic.cookie, editor.id, "ohne Passkey", 2))).toBe(
            "403 assurance_required",
        );
        expect(await stored(editor.id)).toEqual({ responsible_for: "Redaktion Garetien", revision: 2 });
        expect(await events(editor.id)).toHaveLength(1);

        // Auch an Admins und an sich selbst: Ein Text gewährt nichts, deshalb keine Stufenregel und kein frischer Passkey.
        expect(code(await forPerson(operator.cookie, admin.id, "Konten", 1))).toBe("200");
        expect(code(await forPerson(operator.cookie, operator.id, "Leitung", 1))).toBe("200");
        expect((await events(operator.id))[0]!.details).toEqual({ via: "self", cleared: false });
    });

    it("🔴 Prüfung: Zeilenumbruch und 121 Zeichen abgewiesen, nur Leerzeichen und leer heißen NULL", async () => {
        const vali = await someone("editor", "Vali");
        const problem = async (text: string, revision: number) => {
            const response = await own(vali.cookie, text, revision);
            return response.statusCode === 400 ? response.json().error : response.json();
        };
        expect(await problem("Zeile eins\nZeile zwei", 1)).toMatchObject({
            code: "responsibility_invalid",
            details: { problem: "line", max: 120 },
        });
        expect(await problem("Tab\tim Text", 1)).toMatchObject({ details: { problem: "line" } });
        expect(await problem("x".repeat(121), 1)).toMatchObject({ details: { problem: "too_long" } });
        expect(await events(vali.id)).toHaveLength(0);
        expect((await stored(vali.id)).responsible_for).toBeNull();

        expect(code(await own(vali.cookie, "x".repeat(120), 1))).toBe("200");
        expect((await stored(vali.id)).responsible_for).toBe("x".repeat(120));
        expect(code(await own(vali.cookie, "   ", 2))).toBe("200");
        expect(await stored(vali.id)).toEqual({ responsible_for: null, revision: 3 });
        // Schon leer: nichts zu ändern, kein Eintrag.
        expect(code(await own(vali.cookie, "", 3))).toBe("409 no_change");
        expect((await events(vali.id)).map((event) => event.details)).toEqual([
            { via: "self", cleared: false },
            { via: "self", cleared: true },
        ]);

        // Die Bedingung der Tafel (0097) hält auch auf, was am Server vorbei geschrieben würde.
        for (const bad of ["", "   ", "a\nb", "a\u2028b", "a\u0085b", "y".repeat(121)]) {
            await expect(
                cluster!.admin`UPDATE avesmaps_auth.person SET responsible_for = ${bad} WHERE id = ${vali.id}`,
                JSON.stringify(bad),
            ).rejects.toMatchObject({ code: "23514" });
        }
        await cluster!
            .admin`UPDATE avesmaps_auth.person SET responsible_for = ${"🐉".repeat(120)} WHERE id = ${vali.id}`;
    });

    it("🔴 veraltete Revision: 409 mit Wer; ein aufgelöstes Konto: 409; die Revision zählt eine Anmeldung weiter nicht", async () => {
        const operator = await someone("operator", "Rondrikan");
        const editor = await someone("editor", "Editorin", "basic");
        expect(code(await forPerson(operator.cookie, editor.id, "Karten", 1))).toBe("200");
        const stale = await own(editor.cookie, "Mein Text", 1);
        expect(stale.json().error).toMatchObject({
            code: "edit_conflict",
            details: { currentRevision: 2, changedBy: { id: operator.id, displayName: "Rondrikan" } },
        });
        // Eine Anmeldung schreibt `last_login_at` und hebt keine Revision (0080 bleibt in 0097 erhalten).
        await cluster!.admin`UPDATE avesmaps_auth.person SET last_login_at = now() WHERE id = ${editor.id}`;
        expect(code(await own(editor.cookie, "Mein Text", 2))).toBe("200");
        // Ein Admin sperrt mit dem Stand von vorher: Auch das ist ein Konflikt, wie nach einer Umbenennung.
        const admin = await someone("admin", "Admina");
        const lock = await post("/api/admin/people/lock", admin.cookie, {
            operationId: randomUUID(),
            personId: editor.id,
            reason: "Probe",
            baseRevision: 2,
        });
        expect(lock.json().error).toMatchObject({ code: "edit_conflict", details: { changedBy: { id: editor.id } } });

        const gone = await someone("editor", "Gegangen");
        await cluster!.app.begin((tx) =>
            dissolvePerson(tx, { personId: gone.id, environment: "test", actorLabel: "cli:test" }),
        );
        const [{ revision } = { revision: 0 }] = await cluster!.admin<{ revision: number }[]>`
            SELECT revision::int AS revision FROM avesmaps_auth.person WHERE id = ${gone.id}
        `;
        expect(code(await forPerson(operator.cookie, gone.id, "zu spät", revision))).toBe("409 account_inactive");
    });

    it("🔴 Konto auflösen leert „Verantwortlich für“, als App-Rolle; ein zweiter Aufruf findet nichts mehr", async () => {
        const leaving = await someone("editor", "Ausgetretene");
        expect(code(await own(leaving.cookie, "Flussnamen im Bornland", 1))).toBe("200");
        const first = await cluster!.app.begin((tx) =>
            dissolvePerson(tx, { personId: leaving.id, environment: "test", actorLabel: "cli:test" }),
        );
        expect(first.counts.responsibility).toBe(1);
        expect((await stored(leaving.id)).responsible_for).toBeNull();
        const second = await cluster!.app.begin((tx) =>
            dissolvePerson(tx, { personId: leaving.id, environment: "test", actorLabel: "cli:test" }),
        );
        expect(second.counts.responsibility).toBe(0);
        // Im Protokoll stand der Text nie; das Auflösen nennt nur die Zahl.
        const rows = await cluster!.admin<{ row: string }[]>`
            SELECT to_jsonb(e)::text AS row FROM avesmaps_auth.security_event e WHERE e.target_person_id = ${leaving.id}
        `;
        expect(rows.map((entry) => entry.row).join("\n")).not.toContain("Bornland");
    });

    it("🔴 die App-Rolle legt Personen an und liest sie, löscht sie aber nicht und ändert keine Tafel", async () => {
        expect(
            await cluster!.codesAs(cluster!.app, [
                "INSERT INTO avesmaps_auth.person (display_name, created_via) VALUES ('Praiodan', 'system')",
                "SELECT count(*) FROM avesmaps_auth.person",
                "DELETE FROM avesmaps_auth.person",
                "DROP TABLE avesmaps_auth.login_throttle",
            ]),
        ).toEqual(["ok", "ok", "42501", "42501"]);
    });

    it("🔴 die App-Rolle hängt ans Protokoll nur an: kein UPDATE, kein DELETE, kein TRUNCATE; schwärzen nur über die Funktion", async () => {
        expect(
            await cluster!.codesAs(cluster!.app, [
                "INSERT INTO avesmaps_auth.security_event (environment, actor_kind, action) VALUES ('test', 'system', 'probe')",
                `SELECT avesmaps_auth.redact_person_events('${randomUUID()}')`,
                "UPDATE avesmaps_auth.security_event SET action = 'gefaelscht'",
                "UPDATE avesmaps_auth.security_event SET details = '{}' WHERE false",
                "UPDATE avesmaps_auth.security_event SET client_label = NULL WHERE false",
                "DELETE FROM avesmaps_auth.security_event",
                "TRUNCATE avesmaps_auth.security_event",
            ]),
        ).toEqual(["ok", "ok", "42501", "42501", "42501", "42501", "42501"]);
    });

    it("🔴 die App-Rolle darf Sitzungen löschen (Abmelden, Aufräumen), aber die Aufbewahrung nicht rufen", async () => {
        expect(
            await cluster!.codesAs(cluster!.app, [
                "DELETE FROM avesmaps_auth.session WHERE false",
                "SELECT avesmaps_auth.purge_expired()",
            ]),
        ).toEqual(["ok", "42501"]);
    });

    it("🔴 die Jobs-Rolle ruft nur die Aufbewahrung: an keiner Tafel des Schemas ein Recht, kein Schwärzen (Claudio 2026-10-09)", async () => {
        expect(
            await cluster!.codesAs(cluster!.jobs, [
                "SELECT avesmaps_auth.purge_expired()",
                "DELETE FROM avesmaps_auth.security_event WHERE false",
                "UPDATE avesmaps_auth.security_event SET ip_prefix = NULL WHERE false",
                "SELECT 1 FROM avesmaps_auth.session LIMIT 1",
                `SELECT avesmaps_auth.redact_person_events('${randomUUID()}')`,
            ]),
        ).toEqual(["ok", "42501", "42501", "42501", "42501"]);
    });

    it("🔴 Konto auflösen: die Rechte der App-Rolle genügen für eine Person mit allem, was ein Konto tragen kann", async () => {
        const boss = await fixture.person("operator", { name: "Rollen-Betreiberin" });
        const x = await fullAccount(cluster!.admin, fixture, "editor", "Person der App-Rolle", boss.id);
        // Das Schwärzen geht über die Funktion aus Migration 0083; am Protokoll selbst darf die App-Rolle nur anhängen.
        await recordEvent(cluster!.admin, {
            environment: "test",
            action: "person.locked",
            actorKind: "person",
            actorPersonId: boss.id,
            targetPersonId: x.id,
            details: { reason: "Probe der App-Rolle", sessions: 0 },
        });
        const rollback = new Error("zurück");
        let seen:
            { status: string; methods: string[]; passkeys: number; redacted: number; reasons: number } | undefined;
        try {
            await expect(
                cluster!.app.begin(async (tx) => {
                    const result = await dissolvePerson(tx, {
                        personId: x.id,
                        environment: "test",
                        actorLabel: "cli:test",
                        expectName: "Person der App-Rolle",
                    });
                    const [row] = await tx<
                        { status: string }[]
                    >`SELECT status FROM avesmaps_auth.person WHERE id = ${x.id}`;
                    seen = {
                        status: row!.status,
                        methods: result.counts.methods,
                        passkeys: result.counts.passkeys,
                        redacted: result.counts.redactedEvents,
                        reasons: result.counts.capabilityReasons,
                    };
                    throw rollback;
                }),
            ).rejects.toBe(rollback);
        } finally {
            await cluster!.admin`DELETE FROM avesmaps_auth.legacy_identity WHERE id = ${x.legacyId}::bigint`;
        }
        expect(seen).toEqual({
            status: "departed",
            methods: ["password", "discord"],
            passkeys: 1,
            redacted: 1,
            reasons: 1,
        });
    });
});
