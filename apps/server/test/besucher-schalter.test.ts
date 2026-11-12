import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BESUCH_SCHALTER, CONTENT_SWITCHES, type ContentState } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Der Schalter „Besucherzählung“ (WI-0138 V7, BESUCH-0001 §4.7): Steht er auf aus, nimmt der Server die Meldung weiter an und
 * zählt sie nicht. Besucher merken nichts — das ist der Punkt, und darum prüft der Fall beide Richtungen.
 *
 * 🪤 Der Stand kommt aus dem Speicher der Anwendung, nicht aus der Datenbank: Nach dem `INSERT` vergeht ein Augenblick, bis der
 * Store ihn kennt. Gewartet wird deshalb auf `/api/content-state` — dieselbe Quelle, nur von außen sichtbar — und nicht auf eine
 * Zahl, die sich gerade nicht ändern soll.
 */

describe("Der Schalter im Katalog", () => {
    it("steht in der Gruppe „betrieb“ und behält den letzten bekannten Stand", () => {
        const spec = CONTENT_SWITCHES.find((eintrag) => eintrag.key === BESUCH_SCHALTER);
        expect(spec).toMatchObject({ group: "betrieb", failure: "last_known" });
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "besuch-schalter-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Besucherzählung anhalten", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await database`DELETE FROM content_switch WHERE key = ${BESUCH_SCHALTER}`;
        await database`DELETE FROM visitor_metric`;
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
    });

    afterAll(async () => {
        await database`DELETE FROM content_switch WHERE key = ${BESUCH_SCHALTER}`;
        await database`DELETE FROM visitor_metric`;
        await app?.close();
        await database?.end({ timeout: 5 });
    });

    /** Eine Meldung von der eigenen Seite; die Antwort ist immer 204, auch wenn nichts gezählt wird. */
    const melde = async (): Promise<void> => {
        const antwort = await app.inject({
            method: "POST",
            url: "/api/besuch",
            headers: { origin: "http://localhost", host: "localhost", "user-agent": "Testbrowser" },
            payload: { ereignisse: [{ metrik: "pageview" }], stunde: 12 },
        });
        expect(antwort.statusCode).toBe(204);
    };

    const summe = async (): Promise<number> => {
        const [zeile] = await database<{ summe: string }[]>`
            SELECT COALESCE(SUM(count), 0)::text AS summe FROM visitor_metric WHERE metric = 'pageview'
        `;
        return Number(zeile?.summe ?? 0);
    };

    /** Wartet, bis der Store den Schalter so kennt, wie die Tabelle ihn hält. */
    const warteAufStand = async (aus: boolean): Promise<void> => {
        await expect
            .poll(
                async () => {
                    const antwort = await app.inject({ method: "GET", url: "/api/content-state" });
                    return antwort.json<ContentState>().off.includes(BESUCH_SCHALTER);
                },
                { timeout: 15_000, interval: 250 },
            )
            .toBe(aus);
    };

    it("🔴 aus: die Meldung wird angenommen und nicht gezählt; an: sie zählt wieder", async () => {
        // 🪤 Gezählt wird NACH der Antwort (204 kommt sofort, damit die Zählung die Karte nie aufhält). Darum wird hier
        // gepollt und nie direkt nach `inject` gelesen.
        await melde();
        await expect.poll(summe, { timeout: 15_000, interval: 100 }).toBeGreaterThan(0);
        const vorher = await summe();

        await database`INSERT INTO content_switch (key, enabled) VALUES (${BESUCH_SCHALTER}, FALSE)`;
        await warteAufStand(true);
        await melde();
        await melde();

        // Dass zwei Meldungen NICHT gezählt wurden, zeigt eine dritte, die es wird: Steigt die Summe nur um eins, sind die
        // beiden davor nie angekommen. Eine Wartezeit würde dasselbe behaupten, ohne es zu belegen.
        await database`DELETE FROM content_switch WHERE key = ${BESUCH_SCHALTER}`;
        await warteAufStand(false);
        await melde();
        await expect.poll(summe, { timeout: 15_000, interval: 100 }).toBeGreaterThan(vorher);
        expect(await summe()).toBe(vorher + 1);
    });
});
