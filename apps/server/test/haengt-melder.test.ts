import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WarteschlangeAuftrag, WarteschlangeStand, WarteschlangeUmgebung } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { schreibeStand } from "../src/jobs/dirigent/stand.ts";
import { createHaengtMelder } from "../src/jobs/haengt-melder.ts";
import { createWarteschlangeStandLeser } from "../src/jobs/stand-datei.ts";
import { authFixture, type AuthFixture, type TestPerson } from "./support/auth-fixture.ts";

/**
 * Der Melder hängender Aufträge (WI-0179) gegen echtes PostgreSQL: Die App liest den Stand des Dirigenten und meldet die hängenden
 * Aufträge IHRER Umgebung einmal in die Glocke der Betreiber (`auftrag_haengt`, an die Rolle `operator`).
 *
 * Problemfall: Am 2026-10-15 stand der Landschaften-Zug in Production acht Stunden auf „Wartet“, und niemand wurde benachrichtigt.
 * Soll: genau eine Meldung je Auftrag und Versuch, nicht eine je Takt, je Instanz oder je Neustart; nichts für fremde Umgebungen,
 * nichts aus einem alten Stand.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const stumm = { warn: () => undefined };

describeWithDatabase("Melder hängender Aufträge", { timeout: 60_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let betreiberin: TestPerson;
    let admin: TestPerson;
    let verzeichnis: string;
    let datei: string;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
        betreiberin = await fixture.person("operator", { name: "Betreiberin WI-0179" });
        admin = await fixture.person("admin", { name: "Admin WI-0179" });
        verzeichnis = await mkdtemp(join(tmpdir(), "haengt-melder-"));
        datei = join(verzeichnis, "stand.json");
    });

    const leeren = () => database`DELETE FROM benachrichtigung WHERE quelle LIKE 'haengt:%'`;
    beforeEach(leeren);

    afterAll(async () => {
        await leeren().catch(() => undefined);
        await fixture?.cleanup();
        await rm(verzeichnis, { recursive: true, force: true });
        await database?.end({ timeout: 5 });
    });

    function auftrag(
        umgebung: WarteschlangeUmgebung,
        id: number,
        haengt: { attempt: number } | null,
        label: string | null = "Legacy-Zug: Landschaften",
    ): WarteschlangeAuftrag {
        return {
            umgebung,
            id,
            publicId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
            kind: "legacy_zug",
            label,
            state: "QUEUED",
            origin: "queued",
            platz: 1,
            queuedAt: new Date(Date.now() - 3_600_000).toISOString(),
            startedAt: null,
            phase: null,
            progress: null,
            wartegrund: "waits_executor",
            schwer: true,
            ...(haengt === null
                ? {}
                : {
                      haengt: {
                          seit: new Date(Date.now() - 600_000).toISOString(),
                          ablehnungen: 3,
                          grund: "exit_3",
                          code: 3,
                          attempt: haengt.attempt,
                      },
                  }),
        };
    }

    async function stand(auftraege: WarteschlangeAuftrag[], atMs = Date.now()): Promise<void> {
        const inhalt: WarteschlangeStand = {
            schema: 1,
            at: new Date(atMs).toISOString(),
            dirigent: { instanz: "test", release: "test", taktS: 2 },
            pause: {
                paused: false,
                umgebung: null,
                changedAt: null,
                since: null,
                by: null,
                byLabel: null,
                reason: null,
            },
            umgebungen: [{ name: "test", erreichbar: true, planer: true }],
            auftraege,
        };
        await schreibeStand(datei, inhalt);
    }

    const melder = () =>
        createHaengtMelder({
            database,
            leser: createWarteschlangeStandLeser(datei, "test", { ttlMs: 0 }),
            umgebung: "test",
            log: stumm,
        });

    async function meldungen(person: TestPerson) {
        return database<{ art: string; von_art: string; text: string | null; quelle: string }[]>`
            SELECT art, von_art, text, quelle FROM benachrichtigung
             WHERE an_person = ${person.id} AND quelle LIKE 'haengt:%'
             ORDER BY id
        `;
    }

    it("meldet einen hängenden Auftrag der eigenen Umgebung genau einmal an die Betreiber, auch über zwei Instanzen", async () => {
        await stand([auftrag("test", 81, { attempt: 0 })]);
        const erste = melder();
        expect(await erste.pruefe()).toBeGreaterThanOrEqual(1);
        expect(await erste.pruefe()).toBe(0);
        // Die zweite Instanz im Blue/Green (oder die App nach einem Neustart) weiß nichts davon: Die Quelle hält die Doppelte ab.
        expect(await melder().pruefe()).toBe(0);
        expect(await meldungen(betreiberin)).toEqual([
            { art: "auftrag_haengt", von_art: "system", text: "Legacy-Zug: Landschaften", quelle: "haengt:test-81-0" },
        ]);
        expect(await meldungen(admin)).toEqual([]);
    });

    it("hängt derselbe Auftrag nach einem neuen Versuch wieder, ist das eine neue Meldung", async () => {
        await stand([auftrag("test", 81, { attempt: 0 })]);
        await melder().pruefe();
        await stand([auftrag("test", 81, { attempt: 1 })]);
        await melder().pruefe();
        expect((await meldungen(betreiberin)).map((zeile) => zeile.quelle)).toEqual([
            "haengt:test-81-0",
            "haengt:test-81-1",
        ]);
    });

    it("nichts für wartende, die nicht hängen, nichts für die andere Umgebung, nichts aus einem alten Stand", async () => {
        await stand([auftrag("test", 5, null), auftrag("production", 81, { attempt: 0 })]);
        expect(await melder().pruefe()).toBe(0);
        await stand([auftrag("test", 81, { attempt: 0 })], Date.now() - 120_000);
        expect(await melder().pruefe()).toBe(0);
        expect(await meldungen(betreiberin)).toEqual([]);
    });

    it("ohne Bezeichnung steht die Art im Text", async () => {
        await stand([auftrag("test", 82, { attempt: 0 }, null)]);
        await melder().pruefe();
        expect((await meldungen(betreiberin)).map((zeile) => zeile.text)).toEqual(["legacy_zug"]);
    });
});
