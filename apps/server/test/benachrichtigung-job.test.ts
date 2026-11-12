import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import {
    BENACHRICHTIGUNG_JOB_ARTEN,
    benachrichtigungUmgebung,
    leseBenachrichtigungAuftrag,
    runBenachrichtigungJob,
} from "../src/jobs/benachrichtigung-job.ts";
import { JOB_HANDLERS, JobFailure, type JobContext } from "../src/jobs/handlers.ts";
import { JOB_KIND_CATALOG, expectedMemoryMb, knowsKind } from "../src/jobs/kinds.ts";
import { getJobById, insertJob } from "../src/jobs/store.ts";
import { JobWorker } from "../src/jobs/worker.ts";
import { authFixture } from "./support/auth-fixture.ts";
import { fakeMemory, testJobsConfig, uniqueScope } from "./support/jobs-support.ts";

/**
 * Die Jobart `benachrichtigung` (WI-0163; Betreiber 2026-10-15: „Meldungen wie „Neu auf Production" sollen über die Warteschlange in
 * die richtige Umgebung gelangen, statt dass Claudio sie direkt einträgt“):
 *
 * - **Soll:** Die Meldung kommt in der Umgebung des Ausführers an, von „system“, bei genau den Personen des Ziels.
 * - **Problemfall Doppelte:** Ein zweiter Lauf mit derselben `quelle` legt nichts an (`benachrichtige`, `ON CONFLICT`).
 * - **Problemfall Eingabe:** Eine unbekannte Art, ein zu langer Text, ein kaputtes Ziel lassen den Auftrag scheitern, und niemand
 *   bekommt etwas.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const DOMAIN = "aventuria";

/** Ein Kontext wie im Job-Prozess, ohne Kindprozess. */
function context(input: Record<string, unknown>): JobContext {
    return {
        input,
        attempt: 1,
        job: { id: 1, publicId: randomUUID(), leaseNo: 1, mapDomainId: DOMAIN },
        beginPhase: async () => undefined,
        checkpoint: () => undefined,
    };
}

function fehler(work: () => unknown): JobFailure {
    try {
        work();
    } catch (error) {
        if (error instanceof JobFailure) return error;
        throw error;
    }
    throw new Error("kein Fehler");
}

const gueltig = {
    art: "production_neu",
    an: { rolle: "operator" },
    text: "Neu auf Production: Wege und Orte",
    quelle: "production:r-20261015",
};

describe("benachrichtigung: Art und Eingabe (ohne Datenbank)", () => {
    it("🔴 eine Jobart der Queue: bekannt, mit Handler, ohne Sperre der Domäne, ohne Speicherschlüssel", () => {
        const spec = JOB_KIND_CATALOG["benachrichtigung"];
        expect(spec).toMatchObject({
            kind: "benachrichtigung",
            version: 1,
            origin: "queued",
            holdsSharedDomainLock: false,
        });
        expect(knowsKind("benachrichtigung", 1)).toBe(true);
        expect(JOB_HANDLERS["benachrichtigung"]).toBeTypeOf("function");
        expect(spec?.memoryKey({}, null)).toBeNull();
        expect(expectedMemoryMb(spec!, {}, null, testJobsConfig(), null)).toBe(0);
        // Über die Warteschlange kommen nur Arten ohne Vorgang; die des Kanals entstehen in seinen Auslösern, die Störungen nie
        // in der Warteschlange (WI-0179). Dazu der Prüflauf nach dem Push (WI-0201, Migration 0140) und die erloschene Freigabe für
        // Production (WI-0234, Migration 0207); das Ende der eigenen Aufträge meldet der Ausführer selbst (WI-0230).
        expect(BENACHRICHTIGUNG_JOB_ARTEN).toEqual([
            "stage_neu",
            "production_neu",
            "pruefung_rot",
            "pruefung_gruen",
            "freigabe_erloschen",
        ]);
    });

    it("🔴 die Eingabe wird streng geprüft: Art, Ziel, Text 1 bis 300 Zeichen, Quelle, keine fremden Felder", () => {
        expect(leseBenachrichtigungAuftrag({ ...gueltig, text: `  ${"ä".repeat(300)}  ` }).text).toBe("ä".repeat(300));
        expect(leseBenachrichtigungAuftrag({ ...gueltig, an: { alle: true } }).an).toEqual({ alle: true });
        const person = randomUUID();
        const ausser = randomUUID();
        expect(leseBenachrichtigungAuftrag({ ...gueltig, an: { person, ausser } }).an).toEqual({ person, ausser });
        for (const kaputt of [
            { ...gueltig, art: "kanal_antwort" },
            { ...gueltig, art: "neu_irgendwo" },
            { ...gueltig, art: undefined },
            { ...gueltig, text: "ä".repeat(301) },
            { ...gueltig, text: "   " },
            { ...gueltig, text: 7 },
            { ...gueltig, quelle: "" },
            { ...gueltig, quelle: "ohne doppelpunkt" },
            { ...gueltig, quelle: `stage:${"a".repeat(200)}` },
            { ...gueltig, an: {} },
            { ...gueltig, an: { rolle: "chef" } },
            { ...gueltig, an: { alle: false } },
            { ...gueltig, an: { person: "niemand" } },
            { ...gueltig, an: { rolle: "operator", alle: true } },
            { ...gueltig, an: { alle: true, ausser: "x" } },
            { ...gueltig, an: [] },
            { ...gueltig, umgebung: "production" },
        ]) {
            const error = fehler(() => leseBenachrichtigungAuftrag(kaputt as Record<string, unknown>));
            expect([error.code, error.retryable], JSON.stringify(kaputt).slice(0, 80)).toEqual([
                "input_invalid",
                false,
            ]);
        }
    });

    it("die Umgebung ist die des Ausführers: AVESMAPS_ENV, ohne Wert nur lokal `development`", () => {
        expect(benachrichtigungUmgebung({ AVESMAPS_ENV: "production", RELEASE_ID: "r1" })).toBe("production");
        expect(benachrichtigungUmgebung({ AVESMAPS_ENV: "staging" })).toBe("staging");
        expect(benachrichtigungUmgebung({})).toBe("development");
        expect(fehler(() => benachrichtigungUmgebung({ RELEASE_ID: "r1" })).code).toBe("environment_missing");
        expect(fehler(() => benachrichtigungUmgebung({ AVESMAPS_ENV: "prod" })).code).toBe("environment_invalid");
    });
});

describeWithDatabase("benachrichtigung gegen die Testdatenbank", { timeout: 60_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    const TEST_ENV = { AVESMAPS_ENV: "test" };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
    });

    beforeEach(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
    });

    afterEach(async () => {
        // Die Meldungen gehen mit ihren Personen (ON DELETE CASCADE).
        await fixture.cleanup();
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    const meldungen = (quelle: string) =>
        database<{ an_person: string; environment: string; von_art: string; art: string; text: string }[]>`
            SELECT an_person::text, environment, von_art, art, text FROM public.benachrichtigung WHERE quelle = ${quelle}
        `;

    it("🔴 die Meldung kommt an: in der Umgebung des Ausführers, von „system“, nur beim Ziel", async () => {
        const betreiber = await fixture.person("operator", { name: "WI-0163-Betreiber" });
        const editor = await fixture.person("editor", { name: "WI-0163-Editor" });
        const quelle = `production:${randomUUID()}`;
        const ergebnis = await runBenachrichtigungJob(context({ ...gueltig, quelle }), {
            database,
            environment: TEST_ENV,
        });
        expect(ergebnis).toMatchObject({ art: "production_neu", umgebung: "test", quelle });
        const rows = await meldungen(quelle);
        expect(rows.find((row) => row.an_person === betreiber.id)).toEqual({
            an_person: betreiber.id,
            environment: "test",
            von_art: "system",
            art: "production_neu",
            text: "Neu auf Production: Wege und Orte",
        });
        expect(rows.some((row) => row.an_person === editor.id)).toBe(false);
    });

    it("🔴 dieselbe Quelle zweimal: eine Meldung, der zweite Lauf legt nichts an und endet erfolgreich", async () => {
        const person = await fixture.person("editor", { name: "WI-0163-Einmal" });
        const auftrag = { ...gueltig, art: "stage_neu", an: { person: person.id }, quelle: `stage:${randomUUID()}` };
        expect(await runBenachrichtigungJob(context(auftrag), { database, environment: TEST_ENV })).toMatchObject({
            angelegt: 1,
        });
        expect(await runBenachrichtigungJob(context(auftrag), { database, environment: TEST_ENV })).toMatchObject({
            angelegt: 0,
        });
        expect(await meldungen(auftrag.quelle)).toHaveLength(1);
    });

    it("🔴 unbekannte Art oder zu langer Text: der Auftrag scheitert, und niemand bekommt etwas", async () => {
        const person = await fixture.person("operator", { name: "WI-0163-Nichts" });
        for (const kaputt of [
            { ...gueltig, art: "kanal_fix_live", an: { person: person.id }, quelle: `stage:${randomUUID()}` },
            { ...gueltig, text: "x".repeat(301), an: { person: person.id }, quelle: `stage:${randomUUID()}` },
        ]) {
            await expect(
                runBenachrichtigungJob(context(kaputt), { database, environment: TEST_ENV }),
            ).rejects.toMatchObject({ code: "input_invalid", retryable: false });
            expect(await meldungen(kaputt.quelle)).toHaveLength(0);
        }
    });

    it("🔴 durch die Warteschlange: der Ausführer rechnet sie im echten Job-Prozess; eine unbekannte Art endet FAILED ohne Meldung", async () => {
        const person = await fixture.person("operator", { name: "WI-0163-Queue" });
        const quelle = `production:${randomUUID()}`;
        const kaputtQuelle = `production:${randomUUID()}`;
        const add = (input: Record<string, unknown>) =>
            insertJob(database, {
                kind: "benachrichtigung",
                mapDomainId: DOMAIN,
                scopeKind: "tiles",
                scopeTiles: [],
                actorRef: "korridor",
                inputRef: input,
            });
        const gut = await add({ ...gueltig, an: { person: person.id }, quelle });
        const schlecht = await add({
            ...gueltig,
            art: "neu_irgendwo",
            an: { person: person.id },
            quelle: kaputtQuelle,
        });
        const worker = new JobWorker({
            database,
            config: testJobsConfig({ heartbeatS: { value: 0.2 } }),
            mapDomainId: DOMAIN,
            deriveScope: uniqueScope("derive"),
            memory: fakeMemory().probe,
            killGraceMs: 1000,
            stopGraceMs: 2000,
        });
        // 🔴 Der Job-Prozess erbt die Umgebung dieses Prozesses: für die Dauer des Falls die Testdatenbank und `test`, nie die
        //    Datenbank des Entwicklungsrechners aus der `.env`.
        const vorher = {
            JOBS_DATABASE_URL: process.env["JOBS_DATABASE_URL"],
            DATABASE_URL: process.env["DATABASE_URL"],
            AVESMAPS_ENV: process.env["AVESMAPS_ENV"],
        };
        process.env["JOBS_DATABASE_URL"] = testDatabaseUrl as string;
        process.env["DATABASE_URL"] = testDatabaseUrl as string;
        process.env["AVESMAPS_ENV"] = "test";
        try {
            expect(await worker.runOne(gut.id, { art: "benachrichtigung" })).toEqual({
                ergebnis: "erledigt",
                state: "SUCCEEDED",
            });
            expect(await worker.runOne(schlecht.id)).toEqual({ ergebnis: "erledigt", state: "FAILED" });
        } finally {
            for (const [key, value] of Object.entries(vorher)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
            await worker.stop(0);
        }
        expect(await getJobById(database, gut.id)).toMatchObject({
            result: { art: "production_neu", umgebung: "test", quelle, angelegt: 1 },
        });
        expect(await meldungen(quelle)).toHaveLength(1);
        expect(await getJobById(database, schlecht.id)).toMatchObject({ errorCode: "input_invalid", attempt: 1 });
        expect(await meldungen(kaputtQuelle)).toHaveLength(0);
    }, 45_000);
});
