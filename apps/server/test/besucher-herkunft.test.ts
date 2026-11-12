import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Herkunft zählt Personen, nicht Meldungen (Betreiber 2026-11-03): Wer viel klickt, schickt viele Meldungen, und sein
 * Bundesland stand auf der Karte dann stärker da als eines mit mehr Besuchern.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const NETZ = "127.0.0.0/8";

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "besuch-herkunft-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
        besucher: { salt: "ein-salz-nur-fuer-diesen-test" },
    };
}

describeWithDatabase("Die Herkunft eines Besuchs", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;

    const leere = async (): Promise<void> => {
        await database`DELETE FROM visitor_metric`;
        await database`DELETE FROM visitor_daily_seen`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await leere();
        await database`
            INSERT INTO visitor_geo_range (netz, country, region) VALUES (${NETZ}, 'DE', 'HE')
            ON CONFLICT (netz) DO UPDATE SET country = EXCLUDED.country, region = EXCLUDED.region
        `;
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
        await database`DELETE FROM visitor_geo_range WHERE netz = ${NETZ}`;
        await leere();
        await app?.close();
        await database?.end({ timeout: 5 });
    });

    /** Eine Meldung; die Tageskennung entsteht aus Adresse und Browser, ein anderer Browser ist also eine andere Person. */
    const melde = async (browser: string): Promise<void> => {
        const antwort = await app.inject({
            method: "POST",
            url: "/api/besuch",
            headers: { origin: "http://localhost", host: "localhost", "user-agent": browser },
            payload: { ereignisse: [{ metrik: "pageview" }], stunde: 12 },
        });
        expect(antwort.statusCode).toBe(204);
    };

    const summe = async (metrik: string): Promise<number> => {
        const [zeile] = await database<{ summe: string }[]>`
            SELECT COALESCE(SUM(count), 0)::text AS summe FROM visitor_metric WHERE metric = ${metrik}
        `;
        return Number(zeile?.summe ?? 0);
    };

    it("🔴 drei Meldungen einer Person zählen einmal, die zweite Person zählt dazu", async () => {
        await melde("Testbrowser eins");
        await melde("Testbrowser eins");
        await melde("Testbrowser eins");
        await melde("Testbrowser zwei");

        // 🪤 Gezählt wird NACH der Antwort. Die Aufrufe laufen in derselben Anweisung wie die Herkunft: Stehen alle vier da, ist
        // auch die Herkunft aller vier Meldungen geschrieben, und eine Wartezeit erübrigt sich.
        await expect.poll(() => summe("pageview"), { timeout: 15_000, interval: 100 }).toBe(4);
        expect(await summe("region")).toBe(2);
        expect(await summe("land")).toBe(2);
        // Alles, was zur Person gehört, ebenso (WI-0286): „Deutsch“ stand bei 270.716 für 34.925 Seitenaufrufe.
        for (const metrik of ["sprache", "geraet", "system", "browser", "einstieg"]) {
            expect(await summe(metrik), metrik).toBe(2);
        }
    });
});
