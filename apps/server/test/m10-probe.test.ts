import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * 🔴 Die M10-Probe (WI-0120 A11): EIN Schreibpfad, Ende zu Ende über HTTP und PostgreSQL, alle drei Verträge der Reihe nach.
 * Er ist die Vorlage für jeden späteren Schreibpfad einer Fachdomäne (WI-0068 und die Editoren), die dieselben Verträge erfüllen
 * müssen, nur mit eigener Speicherstelle der Kennung (ADR-0019 Nr. 3).
 *
 * - (a) ADR-0018: jede Ablehnung im Umschlag `{ error: { code, message, details? } }`, auch Fastifys eigene.
 * - (b) ADR-0019: eine Kennung je Handlung; Wiederholung gleich → dieselbe Quittung `replayed`, keine zweite Wirkung; Wiederholung
 *   mit anderem Inhalt → 409 `idempotency_key_reused`.
 * - (c) ADR-0020: die gesehene Revision; wer zu spät kommt, bekommt 409 `edit_conflict` mit Wer und Wann, und die Revision aus der
 *   Quittung ist die nächste `baseRevision`.
 *
 * Probe ist der erste echte Schreibpfad (Rolle ändern, A7) statt einer eigenen Testdomäne: Eine Domäne nur für die Probe wäre
 * Ballast, und Fachdomänen legen ihre Speicherstelle mit ihrem ersten Schreibpfad fest.
 */
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("M10-Probe am ersten Schreibpfad", { timeout: 60_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let app: FastifyInstance | undefined;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    afterAll(async () => {
        await fixture.cleanup();
        await database.end({ timeout: 5 });
    });

    it("🔴 (a), (b) und (c) der Reihe nach an „Rolle ändern“", async () => {
        app = buildApp({
            config: {
                port: 0,
                host: "127.0.0.1",
                releaseId: "m10-probe",
                databaseUrl: undefined,
                tileRoot: undefined,
                auth: TEST_AUTH,
            },
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
        const first = await fixture.person("admin", { name: "M10-Erste" });
        const second = await fixture.person("admin", { name: "M10-Zweite" });
        const target = await fixture.person("tester", { name: "M10-Ziel" });
        const firstCookie = (await fixture.session(first.id)).cookie;
        const secondCookie = (await fixture.session(second.id)).cookie;
        const role = (cookie: string, payload: object) =>
            app!.inject({
                method: "POST",
                url: "/api/admin/people/role",
                payload,
                headers: { origin: TEST_ORIGIN, cookie },
            });

        // (a) Auch Fastifys Schemaprüfung antwortet im Umschlag; sie nennt Pfad und Regel, nie den Wert.
        const malformed = await role(firstCookie, { operationId: randomUUID(), personId: target.id, role: "kaiser" });
        expect(malformed.statusCode).toBe(400);
        expect(malformed.json().error).toMatchObject({
            code: "validation_failed",
            details: { issues: expect.any(Array) },
        });

        // (b) Angewandt: Quittung mit Umgebung und neuer Revision.
        const operationId = randomUUID();
        const body = { operationId, personId: target.id, role: "reviewer", baseRevision: 1 };
        const applied = await role(firstCookie, body);
        expect(applied.statusCode).toBe(200);
        expect(applied.json()).toMatchObject({
            operationId,
            status: "applied",
            environment: "test",
            affected: [{ kind: "person_access", id: target.id, revision: 2 }],
        });

        // (b) Dieselbe Handlung noch einmal (Doppelklick, Netzwiederholung): dieselbe Quittung, keine zweite Wirkung.
        const replayed = await role(firstCookie, body);
        expect(replayed.json()).toEqual({ ...applied.json(), status: "replayed" });
        const [written] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.security_event WHERE operation_id = ${operationId}
        `;
        expect(written?.n).toBe(1);

        // (a)(b) Dieselbe Kennung für eine andere Handlung: abgelehnt, im Umschlag.
        const reused = await role(firstCookie, { ...body, role: "editor" });
        expect(reused.statusCode).toBe(409);
        expect(reused.json().error.code).toBe("idempotency_key_reused");

        // (c) Wer mit der alten Revision kommt, erfährt Wer und Wann.
        const late = await role(secondCookie, {
            operationId: randomUUID(),
            personId: target.id,
            role: "editor",
            baseRevision: 1,
        });
        expect(late.statusCode).toBe(409);
        expect(late.json().error).toMatchObject({
            code: "edit_conflict",
            details: { currentRevision: 2, changedBy: { id: first.id, displayName: "M10-Erste" } },
        });

        // (c) Die Revision aus der Quittung ist die nächste `baseRevision`.
        const next = await role(secondCookie, {
            operationId: randomUUID(),
            personId: target.id,
            role: "editor",
            baseRevision: applied.json().affected[0].revision,
        });
        expect(next.json()).toMatchObject({ status: "applied", affected: [{ revision: 3 }] });
    });
});
