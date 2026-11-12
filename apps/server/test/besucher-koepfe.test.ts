import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { leseZahlen } from "../src/besucher/lesen.ts";
import { authFixture, TEST_AUTH, TEST_ORIGIN, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * „Editoren, Köpfe je Tag“ zählt Menschen mit Editorkonto, nicht Geräte (Vali 2026-11-11: „die anzahl editoren kann mit 22 nicht
 * sein - wir sind nur 11 - die editoren haben kein vertrauen mehr in die statistik“).
 *
 * Der Problemfall: Die Tageskennung entstand auch für Angemeldete aus Adresse und Browser. Wer am Rechner und am Telefon arbeitet,
 * wessen Adresse im Mobilnetz oder mit IPv6-Datenschutzadressen wechselt, oder wer einen zweiten Browser offen hat, war mehrere
 * „Köpfe“. Auf der Stage standen am 2026-11-11 elf Köpfe, bei zwei Personen mit Zugang.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "besuch-koepfe-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
        besucher: { salt: "ein-salz-nur-fuer-diesen-test" },
    };
}

describeWithDatabase("Editoren, Köpfe je Tag", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let auth: AuthFixture;

    const leere = async (): Promise<void> => {
        await database`DELETE FROM visitor_metric`;
        await database`DELETE FROM visitor_daily_seen`;
        await database`DELETE FROM visitor_live`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        auth = authFixture(database);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
    });

    beforeEach(leere);

    afterAll(async () => {
        await leere();
        await auth?.cleanup();
        await app?.close();
        await database?.end({ timeout: 5 });
    });

    /** Von der eigenen Seite, mit oder ohne Sitzung; Gerät heißt hier: Browser und Adresse. */
    const kopfzeilen = (browser: string, cookie?: string): Record<string, string> => ({
        origin: TEST_ORIGIN,
        host: new URL(TEST_ORIGIN).host,
        "sec-fetch-site": "same-origin",
        "user-agent": browser,
        ...(cookie === undefined ? {} : { cookie }),
    });

    const melde = async (geraet: { browser: string; adresse: string }, cookie?: string): Promise<void> => {
        const antwort = await app.inject({
            method: "POST",
            url: "/api/besuch",
            remoteAddress: geraet.adresse,
            headers: kopfzeilen(geraet.browser, cookie),
            payload: { ereignisse: [{ metrik: "pageview" }], stunde: 12 },
        });
        expect(antwort.statusCode).toBe(204);
    };

    const pinge = async (geraet: { browser: string; adresse: string }, cookie?: string): Promise<void> => {
        const antwort = await app.inject({
            method: "POST",
            url: "/api/besuch/ping",
            remoteAddress: geraet.adresse,
            headers: kopfzeilen(geraet.browser, cookie),
            payload: { zustand: "active" },
        });
        expect(antwort.statusCode).toBe(204);
    };

    /** Gezählt wird NACH der Antwort; der Seitenaufruf steht in der letzten Anweisung einer Meldung. */
    const aufrufe = async (sorte: "editor" | "visitor" | "bot"): Promise<number> => {
        const [zeile] = await database<{ summe: string }[]>`
            SELECT COALESCE(SUM(count), 0)::text AS summe FROM visitor_metric
             WHERE metric = 'pageview' AND actor_type = ${sorte}
        `;
        return Number(zeile?.summe ?? 0);
    };

    const RECHNER = { browser: "Mozilla/5.0 (Windows NT 10.0) Chrome/142", adresse: "198.51.100.10" };
    const TELEFON = { browser: "Mozilla/5.0 (Linux; Android 15) Mobile Chrome/142", adresse: "203.0.113.20" };
    /** Dasselbe Telefon nach einem Wechsel der Funkzelle: neue Adresse, derselbe Browser. */
    const TELEFON_UNTERWEGS = { ...TELEFON, adresse: "203.0.113.21" };

    it("🔴 K1 eine Person an Rechner und Telefon, mit wechselnder Adresse, ist EIN Kopf", async () => {
        const vali = await auth.person("operator", { name: "Vali" });
        const rechner = await auth.session(vali.id);
        const telefon = await auth.session(vali.id);
        await melde(RECHNER, rechner.cookie);
        await melde(TELEFON, telefon.cookie);
        await melde(TELEFON_UNTERWEGS, telefon.cookie);
        await expect.poll(() => aufrufe("editor"), { timeout: 15_000, interval: 100 }).toBe(3);

        const zahlen = await leseZahlen(database, "visitor", 7, true);
        expect(zahlen.kennzahlen.editorenSpitze).toBe(1);
        expect(zahlen.verlauf.at(-1)?.editoren).toBe(1);
        // Im Unterreiter „Editoren“ ist „Eindeutige je Tag“ dieselbe Zahl.
        expect((await leseZahlen(database, "editor", 7, true)).verlauf.at(-1)?.eindeutige).toBe(1);
    });

    it("K2 zwei Personen sind zwei Köpfe; Besucher und Automaten ohne Konto keiner", async () => {
        const vali = await auth.person("operator", { name: "Vali" });
        const thomas = await auth.person("editor", { name: "Thomas" });
        await melde(RECHNER, (await auth.session(vali.id)).cookie);
        await melde(TELEFON, (await auth.session(thomas.id)).cookie);
        await melde({ browser: "Mozilla/5.0 (Macintosh) Safari/605", adresse: "192.0.2.30" });
        await melde({ browser: "Googlebot/2.1 (+http://www.google.com/bot.html)", adresse: "192.0.2.40" });
        await expect.poll(() => aufrufe("editor"), { timeout: 15_000, interval: 100 }).toBe(2);
        await expect.poll(() => aufrufe("visitor"), { timeout: 15_000, interval: 100 }).toBe(1);
        await expect.poll(() => aufrufe("bot"), { timeout: 15_000, interval: 100 }).toBe(1);

        expect((await leseZahlen(database, "visitor", 7, true)).kennzahlen.editorenSpitze).toBe(2);
    });

    it("K3 „Dazu im Editor“ zählt Köpfe: eine Person an zwei Geräten ist einmal anwesend", async () => {
        const vali = await auth.person("operator", { name: "Vali" });
        const thomas = await auth.person("editor", { name: "Thomas" });
        await pinge(RECHNER, (await auth.session(vali.id)).cookie);
        await pinge(TELEFON, (await auth.session(vali.id)).cookie);
        await pinge(TELEFON_UNTERWEGS, (await auth.session(thomas.id)).cookie);

        await expect
            .poll(async () => (await leseZahlen(database, "visitor", 7, true)).jetzt.editoren, {
                timeout: 15_000,
                interval: 100,
            })
            .toBe(2);
        // Die Tagesspitze der Editoren folgt derselben Zahl.
        expect((await leseZahlen(database, "editor", 7, true)).kennzahlen.gleichzeitigSpitze).toBe(2);
    });

    it("🔴 K4 Tage vor der Kopfzählung zählen nicht mit: keine alte Gerätezahl, keine erfundene Null", async () => {
        // Die alte Zählung (je Gerät, `unique`) vor fünf Tagen mit 22; seit gestern zählen Köpfe.
        await database`
            INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count) VALUES
                (CURRENT_DATE - 5, 24, 'editor', 'unique', '', 22),
                (CURRENT_DATE - 5, 24, 'visitor', 'pageview', '', 100),
                (CURRENT_DATE - 1, 24, 'editor', 'kopf', '', 3),
                (CURRENT_DATE - 1, 24, 'visitor', 'pageview', '', 90),
                (CURRENT_DATE, 24, 'visitor', 'pageview', '', 80)
        `;
        const [tage] = await database<{ vorFuenf: string; gestern: string; heute: string }[]>`
            SELECT (CURRENT_DATE - 5)::text AS "vorFuenf", (CURRENT_DATE - 1)::text AS gestern, CURRENT_DATE::text AS heute
        `;
        const woche = await leseZahlen(database, "visitor", 7, true);
        expect(woche.kennzahlen.editorenSpitze).toBe(3);
        expect(woche.kennzahlen.editorenAb).toBe(tage?.gestern);
        expect(woche.verlauf.map((tag) => [tag.tag, tag.editoren])).toEqual([
            [tage?.vorFuenf, null],
            [tage?.gestern, 3],
            // Heute war noch kein Editor da: gezählt und keiner, also 0.
            [tage?.heute, 0],
        ]);

        // Im Unterreiter „Editoren“ rechnen Mittel und bester Tag nur über gezählte Tage.
        const editoren = await leseZahlen(database, "editor", 7, true);
        expect(editoren.verlauf.map((tag) => tag.eindeutige)).toEqual([null, 3, 0]);
        expect(editoren.kennzahlen.eindeutigeMittel).toBe(2);
        expect(editoren.kennzahlen.besterTag).toBe(3);

        // Liegt der Beginn vor dem Zeitraum, ist der ganze Zeitraum gezählt und braucht keinen Hinweis.
        await database`DELETE FROM visitor_metric WHERE day < CURRENT_DATE - 1`;
        expect((await leseZahlen(database, "visitor", 1, true)).kennzahlen.editorenAb).toBeNull();
    });

    it("K5 nie gezählt heißt null, nicht 0", async () => {
        await database`
            INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count) VALUES
                (CURRENT_DATE, 24, 'editor', 'unique', '', 22),
                (CURRENT_DATE, 24, 'visitor', 'pageview', '', 80)
        `;
        const zahlen = await leseZahlen(database, "visitor", 7, true);
        expect(zahlen.kennzahlen.editorenSpitze).toBeNull();
        expect(zahlen.kennzahlen.editorenAb).toBeNull();
        expect(zahlen.verlauf.at(-1)?.editoren).toBeNull();
    });
});
