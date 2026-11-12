import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { tagesKennung } from "../src/besucher/kennung.ts";
import { leseZahlen } from "../src/besucher/lesen.ts";
import { lebenszeichen, raeumeAuf } from "../src/besucher/zaehler.ts";
import { TEST_AUTH, TEST_ORIGIN } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Bereinigte Besucherzahlen (OPS-000118, der Melder 2026-11-11: „Aufrufzahlen sind unplausibel“, Singapur und Malaysia aus dem
 * Nichts, viele Besuche unter zehn Sekunden).
 *
 * Problemfälle:
 * - Ein Besuch mit nur einem Lebenszeichen hatte 0 s und stand unter „unter 10 s“, obwohl seine Dauer nie gemessen war.
 * - Ein Besuch unter 10 s ließ sich nirgends herausnehmen: Aufrufe, Länder und Diagramme sind getrennte Summen ohne Verbindung.
 * - Ausgeschlossene Automaten waren unsichtbar; niemand sah, wie viele es gab und warum.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const SALZ = "ein-salz-nur-fuer-diesen-test";
const NETZ_SG = "198.51.100.0/24";
const NETZ_DE = "203.0.113.0/24";

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "besuch-bereinigung-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
        besucher: { salt: SALZ },
    };
}

describeWithDatabase("Bereinigte Besucherzahlen (OPS-000118)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;

    const leere = async (): Promise<void> => {
        await database`DELETE FROM visitor_metric`;
        await database`DELETE FROM visitor_daily_seen`;
        await database`DELETE FROM visitor_live`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await database`
            INSERT INTO visitor_geo_range (netz, country, region) VALUES (${NETZ_SG}, 'SG', ''), (${NETZ_DE}, 'DE', 'BY')
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

    beforeEach(leere);

    afterAll(async () => {
        await leere();
        await database`DELETE FROM visitor_geo_range WHERE netz IN (${NETZ_SG}, ${NETZ_DE})`;
        await app?.close();
        await database?.end({ timeout: 5 });
    });

    const SG = { browser: "Mozilla/5.0 (Windows NT 10.0) Chrome/131", adresse: "198.51.100.7" };
    const DE = { browser: "Mozilla/5.0 (Windows NT 10.0) Chrome/142", adresse: "203.0.113.9" };
    const CRAWLER = { browser: "Googlebot/2.1 (+http://www.google.com/bot.html)", adresse: "192.0.2.50" };

    const melde = async (
        geraet: { browser: string; adresse: string },
        rumpf: { ereignisse: { metrik: string; dimension?: string }[]; bestaetigt?: "nachtrag" | true },
    ): Promise<void> => {
        const antwort = await app.inject({
            method: "POST",
            url: "/api/besuch",
            remoteAddress: geraet.adresse,
            headers: {
                origin: TEST_ORIGIN,
                host: new URL(TEST_ORIGIN).host,
                "sec-fetch-site": "same-origin",
                "user-agent": geraet.browser,
            },
            payload: { stunde: 21, ...rumpf },
        });
        expect(antwort.statusCode).toBe(204);
    };

    const summe = async (sorte: string, metrik: string): Promise<number> => {
        const [zeile] = await database<{ summe: string }[]>`
            SELECT COALESCE(SUM(count), 0)::text AS summe FROM visitor_metric WHERE actor_type = ${sorte} AND metric = ${metrik}
        `;
        return Number(zeile?.summe ?? 0);
    };
    const warteAuf = async (sorte: string, metrik: string, wert: number): Promise<void> => {
        await expect.poll(() => summe(sorte, metrik), { timeout: 15_000, interval: 100 }).toBe(wert);
    };
    const heute = async (): Promise<string> => {
        const [zeile] = await database<{ tag: string }[]>`SELECT CURRENT_DATE::text AS tag`;
        return zeile!.tag;
    };

    it("🔴 D1 ein Besuch mit nur einem Lebenszeichen hat keine Dauer, er steht nicht unter 10 s", async () => {
        const einmal = tagesKennung(SALZ, "203.0.113.1", "Browser")!;
        const kurz = tagesKennung(SALZ, "203.0.113.2", "Browser")!;
        await lebenszeichen(database, einmal, "visitor", "active");
        await lebenszeichen(database, kurz, "visitor", "active");
        await lebenszeichen(database, kurz, "visitor", "hidden");
        // Der kurze Besuch dauerte 4 s, der andere ist nur einmal gemeldet. Beide sind seit 6 Minuten weg.
        await database`
            UPDATE visitor_live SET first_seen = now() - interval '6 minutes' - interval '4 seconds', last_seen = now() - interval '6 minutes'
             WHERE visitor_hash = ${kurz}
        `;
        await database`
            UPDATE visitor_live SET first_seen = now() - interval '6 minutes', last_seen = now() - interval '6 minutes'
             WHERE visitor_hash = ${einmal}
        `;
        expect((await raeumeAuf(database)).beendet).toBe(2);

        const dauer = (await leseZahlen(database, "visitor", 7, true)).dauer;
        expect(dauer.ohne).toBe(1);
        expect(dauer.sitzungen).toBe(1);
        expect(dauer.koerbe).toEqual([{ name: "00000", wert: 1 }]);
        expect(dauer.median).toBe(0);
    });

    it("🔴 F1 der Filter nimmt einen Besuch unter 10 s aus Aufrufen, Eindeutigen und Ländern; ohne Filter zählt er", async () => {
        // Kurz: nur die erste Meldung. Lang: die erste Meldung und nach 10 s der Nachtrag mit allem bis dahin.
        await melde(SG, { ereignisse: [{ metrik: "pageview" }, { metrik: "theme", dimension: "dark" }] });
        await melde(DE, { ereignisse: [{ metrik: "pageview" }, { metrik: "theme", dimension: "dark" }] });
        await melde(DE, {
            ereignisse: [{ metrik: "pageview" }, { metrik: "theme", dimension: "dark" }],
            bestaetigt: "nachtrag",
        });
        await warteAuf("visitor", "pageview", 2);
        await warteAuf("visitor_lang", "pageview", 1);

        const alle = await leseZahlen(database, "visitor", 7, true);
        expect(alle.kennzahlen.aufrufe).toBe(2);
        expect(alle.kennzahlen.eindeutigeMittel).toBe(2);
        expect(alle.listen.land.eintraege.map((land) => land.name).sort()).toEqual(["DE", "SG"]);
        expect(alle.filter).toBeNull();

        const gefiltert = await leseZahlen(database, "visitor", 7, true, { ohneKurz: true });
        expect(gefiltert.kennzahlen.aufrufe).toBe(1);
        expect(gefiltert.kennzahlen.eindeutigeMittel).toBe(1);
        expect(gefiltert.listen.land.eintraege).toEqual([{ name: "DE", wert: 1 }]);
        expect(gefiltert.listen.region.eintraege).toEqual([{ name: "BY", wert: 1 }]);
        expect(gefiltert.filter).toEqual({ ab: await heute(), ausgeblendet: 1, gesamt: 2 });
    });

    it("F2 nach der Bestätigung zählt jede Meldung in beiden Sichten, der Nachtrag nur im Filter", async () => {
        await melde(DE, { ereignisse: [{ metrik: "pageview" }] });
        await melde(DE, { ereignisse: [{ metrik: "pageview" }], bestaetigt: "nachtrag" });
        await melde(DE, { ereignisse: [{ metrik: "search_empty" }], bestaetigt: true });
        await warteAuf("visitor", "search_empty", 1);
        await warteAuf("visitor_lang", "search_empty", 1);
        expect(await summe("visitor", "pageview")).toBe(1);
        expect(await summe("visitor_lang", "pageview")).toBe(1);
        // Eine Person, ein Land, auch wenn sie dreimal meldet.
        expect(await summe("visitor", "land")).toBe(1);
        expect(await summe("visitor_lang", "land")).toBe(1);
    });

    it("F3 Tage vor dem Filter stehen nicht ungefiltert im gefilterten Zeitraum, der Zeitraum beginnt mit dem Filter", async () => {
        await database`
            INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count) VALUES
                (CURRENT_DATE - 5, 21, 'visitor', 'pageview', '', 500),
                (CURRENT_DATE, 21, 'visitor', 'pageview', '', 30),
                (CURRENT_DATE, 21, 'visitor_lang', 'pageview', '', 20)
        `;
        const alle = await leseZahlen(database, "visitor", 7, true);
        expect(alle.kennzahlen.aufrufe).toBe(530);
        const gefiltert = await leseZahlen(database, "visitor", 7, true, { ohneKurz: true });
        expect(gefiltert.kennzahlen.aufrufe).toBe(20);
        expect(gefiltert.verlauf.map((tag) => tag.tag)).toEqual([await heute()]);
        expect(gefiltert.filter).toEqual({ ab: await heute(), ausgeblendet: 10, gesamt: 30 });
        // Ohne Vergleichszeitraum gibt es kein Wachstum, nie eines gegen erfundene Nullen.
        expect(gefiltert.kennzahlen.wachstum).toBeNull();
    });

    it("F4 noch nie gefiltert: der Filter sagt es, statt Nullen zu zeigen", async () => {
        await database`
            INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
            VALUES (CURRENT_DATE, 21, 'visitor', 'pageview', '', 30)
        `;
        const gefiltert = await leseZahlen(database, "visitor", 7, true, { ohneKurz: true });
        expect(gefiltert.filter).toEqual({ ab: null, ausgeblendet: 0, gesamt: 0 });
        expect(gefiltert.verlauf).toEqual([]);
        expect(gefiltert.kennzahlen.eindeutigeMittel).toBeNull();
    });

    it("F5 die Verweildauer im Filter ohne den Korb unter 10 s; ‚ohne Dauer‘ bleibt stehen", async () => {
        await database`
            INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count) VALUES
                (CURRENT_DATE, 24, 'visitor', 'dauer', '00000', 7),
                (CURRENT_DATE, 24, 'visitor', 'dauer', '00060', 3),
                (CURRENT_DATE, 24, 'visitor', 'dauer', 'ohne', 2),
                (CURRENT_DATE, 21, 'visitor_lang', 'pageview', '', 1)
        `;
        const alle = (await leseZahlen(database, "visitor", 7, true)).dauer;
        expect(alle.sitzungen).toBe(10);
        expect(alle.ohne).toBe(2);
        const gefiltert = (await leseZahlen(database, "visitor", 7, true, { ohneKurz: true })).dauer;
        expect(gefiltert.koerbe).toEqual([{ name: "00060", wert: 3 }]);
        expect(gefiltert.sitzungen).toBe(3);
        expect(gefiltert.ohne).toBe(2);
    });

    /** Der Abrufer vom 11.11. (Claudios Auswertung): Tencent-Netz, echter Chrome, nur die Version wechselt. */
    const abrufer = (n: number) => ({
        browser: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${String(103 + n)}.0.0.0 Safari/537.36`,
        adresse: `43.173.${String(n)}.${String(10 + n)}`,
    });

    it("🔴 B1 ein Aufruf aus dem Netz eines Rechenzentrums zählt als Automat, nicht als Person, nicht als Land", async () => {
        await melde(abrufer(1), { ereignisse: [{ metrik: "pageview" }] });
        await melde(abrufer(2), { ereignisse: [{ metrik: "pageview" }], bestaetigt: "nachtrag" });
        await melde(DE, { ereignisse: [{ metrik: "pageview" }] });
        await warteAuf("bot", "pageview", 1);
        await warteAuf("visitor", "pageview", 1);

        const zahlen = await leseZahlen(database, "visitor", 7, true);
        expect(zahlen.kennzahlen.aufrufe).toBe(1);
        expect(zahlen.listen.land.eintraege).toEqual([{ name: "DE", wert: 1 }]);
        expect(zahlen.ausgeschlossen).toEqual({ aufrufe: 1, gruende: [{ name: "rechenzentrum", wert: 1 }] });
        // Auch der Nachtrag eines Automaten zählt nirgends in der gefilterten Sicht.
        expect(await summe("visitor_lang", "pageview")).toBe(0);
    });

    it("🔴 B2 ein Schub neuer Personen aus einem Netz: ab der achten in einer Minute zählt das Netz als Automat", async () => {
        const schub = (n: number) => ({
            browser: `Mozilla/5.0 Chrome/${String(110 + n)}.0.0.0`,
            adresse: `100.70.${String(n)}.1`,
        });
        for (let n = 0; n < 9; n++) await melde(schub(n), { ereignisse: [{ metrik: "pageview" }] });
        await melde(
            { browser: "Mozilla/5.0 Chrome/156.0.0.0", adresse: "100.71.0.1" },
            { ereignisse: [{ metrik: "pageview" }] },
        );
        await warteAuf("bot", "pageview", 2);
        await warteAuf("visitor", "pageview", 8);

        const zahlen = await leseZahlen(database, "visitor", 7, true);
        expect(zahlen.ausgeschlossen).toEqual({ aufrufe: 2, gruende: [{ name: "haeufung", wert: 2 }] });
    });

    it("B3 ein Lebenszeichen aus dem Netz eines Rechenzentrums macht niemanden anwesend", async () => {
        const pinge = async (geraet: { browser: string; adresse: string }): Promise<void> => {
            const antwort = await app.inject({
                method: "POST",
                url: "/api/besuch/ping",
                remoteAddress: geraet.adresse,
                headers: {
                    origin: TEST_ORIGIN,
                    host: new URL(TEST_ORIGIN).host,
                    "sec-fetch-site": "same-origin",
                    "user-agent": geraet.browser,
                },
                payload: { zustand: "active" },
            });
            expect(antwort.statusCode).toBe(204);
        };
        await pinge(abrufer(3));
        await pinge(DE);
        // Gezählt wird nach der Antwort: Steht der Mensch da, ist auch über den Automaten entschieden.
        const anwesend = async (): Promise<number> => (await leseZahlen(database, "visitor", 1, true)).jetzt.gesamt;
        await expect.poll(anwesend, { timeout: 15_000, interval: 100 }).toBe(1);
        await new Promise((fertig) => setTimeout(fertig, 300));
        expect(await anwesend()).toBe(1);
    });

    it("🔴 A1 Automaten stehen in keiner Besucherzahl, aber als ausgeschlossen mit ihrem Grund", async () => {
        await melde(CRAWLER, { ereignisse: [{ metrik: "pageview" }] });
        await melde(CRAWLER, { ereignisse: [{ metrik: "pageview" }] });
        await melde(DE, { ereignisse: [{ metrik: "pageview" }] });
        await warteAuf("bot", "pageview", 2);
        await warteAuf("visitor", "pageview", 1);

        const zahlen = await leseZahlen(database, "visitor", 7, true);
        expect(zahlen.kennzahlen.aufrufe).toBe(1);
        expect(zahlen.ausgeschlossen).toEqual({ aufrufe: 2, gruende: [{ name: "useragent", wert: 2 }] });
        // Der Filter ändert an den Ausgeschlossenen nichts, solange der Zeitraum derselbe ist: Sie sind in keiner Sicht.
        await database`
            INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
            VALUES (CURRENT_DATE, 21, 'visitor_lang', 'pageview', '', 1)
        `;
        expect((await leseZahlen(database, "visitor", 7, true, { ohneKurz: true })).ausgeschlossen.aufrufe).toBe(2);
    });
});
