import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PHOTOBOX_GRENZEN, PHOTOBOX_URL, type PhotoboxEinreichung } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { schluesselHash } from "../src/community/db.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN } from "./support/auth-fixture.ts";
import {
    einreichung,
    neueOperation,
    neueSpuren,
    pngUpload,
    raeumeAuf,
    svgUpload,
    zaehle,
} from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die Drossel der öffentlichen Reisebild-Routen (WI-0272 S2, Review C1, C2, I2) über `app.inject`, gegen echtes PostgreSQL:
 *
 * - 🔴 **Zählt beim Eintritt (C2):** N+1 gleichzeitige Anfragen derselben Adresse ergeben genau N, die durch die Drossel kommen (`Promise.all`); die
 *   Prüfung und das Zählen liegen vor jedem `await`. Ein Versuch zählt auch, wenn er danach scheitert (kaputtes Bild, 409, 422, falscher Schlüssel).
 * - 🔴 **Reihenfolge beim Einreichen (C1):** Schalter, Drossel, Honigtopf und Zeitfalle, Arbeit. Ein Fallen-Treffer zählt in die Drossel der Adresse
 *   (und antwortet weiter 201 ohne Zeile), aber nicht ins Tagesbudget; ein Treffer über der Grenze ist 429.
 * - 🔴 **Bild ersetzen zählt wie eine Einreichung (I2):** gegen die Grenze je Adresse und Stunde und gegen das Tagesbudget, zusätzlich zur Statusdrossel.
 * - Die Statusdrossel (20 je Adresse und Stunde) gilt für alle Statusaktionen und für `/status` und `/status/vorschau`.
 *
 * Jeder Test baut seine eigene Anwendung: Die Zähler leben im Speicher einer Instanz, so zählt kein Test für einen anderen.
 */

function config(mediaRoot: string): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "photobox-drossel-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Reisebilder: Drossel (WI-0272 S2, Review C1, C2, I2)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    const spuren = neueSpuren();
    const UNBEKANNT = "A".repeat(43);

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-drossel-"));
    }, 120_000);

    beforeEach(async () => {
        await schalter(true);
        app = buildApp({
            config: config(mediaRoot),
            database: createDatabase(testDatabaseUrl as string, { max: 3 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    });

    afterEach(async () => {
        await app?.close();
        await schalter(true);
        await raeumeAuf(database, spuren);
        spuren.schluessel.length = 0;
        spuren.operationen.length = 0;
    });

    afterAll(async () => {
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    /** Der Schalter „Einreichungen annehmen“, direkt in der Tafel (der Speicher der Anwendung wird verworfen). */
    async function schalter(an: boolean): Promise<void> {
        if (an) await database`DELETE FROM content_switch WHERE key = 'photobox.submissions'`;
        else {
            await database`
                INSERT INTO content_switch (key, enabled, changed_at, changed_by_label)
                VALUES ('photobox.submissions', false, now(), 'photobox-drossel-test')
                ON CONFLICT (key) DO UPDATE SET enabled = false`;
        }
        app?.inhaltsschalter?.forget();
    }

    const senden = (url: string, payload: unknown, ip: string) =>
        app.inject({
            method: "POST",
            url,
            payload: payload as object,
            remoteAddress: ip,
            headers: { origin: TEST_ORIGIN },
        });
    const fehler = (antwort: { statusCode: number; json(): unknown }): string =>
        antwort.statusCode < 300
            ? String(antwort.statusCode)
            : `${String(antwort.statusCode)} ${(antwort.json() as { error: { code: string } }).error.code}`;
    const aktion = (name: string, schluessel: string, felder: Record<string, unknown>, ip: string) =>
        senden(`${PHOTOBOX_URL}/status/${name}`, { schluessel, operationId: neueOperation(spuren), ...felder }, ip);
    const lesen = (schluessel: string, ip: string) => senden(`${PHOTOBOX_URL}/status`, { schluessel }, ip);
    const einreichen = (body: PhotoboxEinreichung, ip: string) => senden(`${PHOTOBOX_URL}/einreichungen`, body, ip);
    /** Wie viele Antworten NICHT von der Drossel kamen. */
    const durchgekommen = (antworten: { statusCode: number }[]): number =>
        antworten.filter((antwort) => antwort.statusCode !== 429).length;
    /** Eine Adresse je Nummer (die Drossel zählt je Adresse). */
    const adresse = (nummer: number): string =>
        `10.50.${String(Math.floor(nummer / 250))}.${String((nummer % 250) + 1)}`;

    async function eingereicht(seed: number, ip: string): Promise<PhotoboxEinreichung> {
        const body = await einreichung(spuren, seed);
        expect(fehler(await einreichen(body, ip)), "Einreichung").toBe("201");
        return body;
    }

    const beschreibungZu = async (schluessel: string): Promise<string | undefined> => {
        const [row] = await database<
            { description: string }[]
        >`SELECT description FROM media_submission WHERE status_key_hash = ${schluesselHash(schluessel)}`;
        return row?.description;
    };
    /** Wie viele Bilder die Einreichung zählt (die Einreichung selbst und jede Ersetzung). */
    const bilderZu = async (schluessel: string): Promise<number> => {
        const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_ingest i JOIN media_submission s ON s.id = i.submission_id
             WHERE s.status_key_hash = ${schluesselHash(schluessel)}`;
        return row?.n ?? 0;
    };

    describe("🔴 zählt beim Eintritt (C2)", () => {
        it("sieben gleichzeitige Einreichungen derselben Adresse: genau sechs kommen durch, die siebte ist 429 und schreibt nichts", async () => {
            const ip = adresse(1);
            const bodies = await Promise.all(
                Array.from({ length: PHOTOBOX_GRENZEN.jeAdresseJeStunde + 1 }, (_, nummer) =>
                    einreichung(spuren, 300 + nummer),
                ),
            );
            const antworten = await Promise.all(bodies.map((body) => einreichen(body, ip)));
            expect(antworten.filter((antwort) => antwort.statusCode === 201)).toHaveLength(
                PHOTOBOX_GRENZEN.jeAdresseJeStunde,
            );
            const abgelehnt = antworten.filter((antwort) => antwort.statusCode === 429);
            expect(abgelehnt).toHaveLength(1);
            expect(fehler(abgelehnt[0]!)).toBe("429 photobox_rate");
            expect((await zaehle(database, spuren)).einreichung).toBe(PHOTOBOX_GRENZEN.jeAdresseJeStunde);
        });

        it("121 gleichzeitige Lesezugriffe derselben Adresse: genau 120 kommen durch die Lesedrossel", async () => {
            const ip = adresse(2);
            const antworten = await Promise.all(
                Array.from({ length: PHOTOBOX_GRENZEN.statusLesenJeStunde + 1 }, () => lesen(UNBEKANNT, ip)),
            );
            expect(durchgekommen(antworten)).toBe(PHOTOBOX_GRENZEN.statusLesenJeStunde);
            expect(antworten.filter((antwort) => antwort.statusCode === 404)).toHaveLength(
                PHOTOBOX_GRENZEN.statusLesenJeStunde,
            );
            expect(antworten.filter((antwort) => fehler(antwort) === "429 photobox_rate")).toHaveLength(1);
        });

        it("sieben gleichzeitige Bildersetzungen derselben Adresse: genau sechs kommen durch die Grenze der Einreichungen", async () => {
            const ip = adresse(3);
            const bild = await pngUpload(310);
            const antworten = await Promise.all(
                Array.from({ length: PHOTOBOX_GRENZEN.jeAdresseJeStunde + 1 }, () =>
                    aktion("bild", UNBEKANNT, { bild }, ip),
                ),
            );
            expect(durchgekommen(antworten)).toBe(PHOTOBOX_GRENZEN.jeAdresseJeStunde);
        });

        it("ein Versuch zählt, auch wenn er scheitert: sechs abgewiesene Einreichungen verbrauchen die Stunde, die siebte ist 429", async () => {
            const ip = adresse(4);
            // Drei kaputte Bilder (SVG, 415) und drei Aufnahmen unter CC BY (422).
            for (let nummer = 0; nummer < 3; nummer += 1) {
                const kaputt = await einreichung(spuren, 320 + nummer, { bild: svgUpload() });
                expect(fehler(await einreichen(kaputt, ip))).toBe("415 unsupported_media_type");
                const unzulaessig = await einreichung(spuren, 330 + nummer, {
                    entstehung: "avesmaps_capture",
                    nutzung: "cc-by-4.0",
                });
                expect(fehler(await einreichen(unzulaessig, ip))).toBe("422 photobox_invalid");
            }
            const gueltig = await einreichung(spuren, 340);
            expect(fehler(await einreichen(gueltig, ip))).toBe("429 photobox_rate");
            expect((await zaehle(database, spuren)).einreichung).toBe(0);
            // Eine andere Adresse geht weiter.
            expect(fehler(await einreichen(gueltig, adresse(5)))).toBe("201");
        });

        it("die Statusdrossel zählt Fehlversuche der Aktionen, Lesen hat eine eigene: die 21. Aktion ist 429, Lesen geht weiter", async () => {
            const body = await eingereicht(350, adresse(6));
            const ip = adresse(7);
            // Zwanzig Aktionen im falschen Zustand (409), dazwischen Lesezugriffe, die keine Aktion verbrauchen.
            for (let nummer = 0; nummer < PHOTOBOX_GRENZEN.statusJeStunde; nummer += 1) {
                expect(fehler(await aktion("offline", body.schluessel, {}, ip))).toBe("409 photobox_transition");
                expect(fehler(await lesen(body.schluessel, ip))).toBe("200");
            }
            expect(fehler(await aktion("beschreibung", body.schluessel, { beschreibung: "Eine zu viel" }, ip))).toBe(
                "429 photobox_rate",
            );
            expect(fehler(await lesen(body.schluessel, ip))).toBe("200");
            expect(await beschreibungZu(body.schluessel)).toBe("Der Blick vom Hafen auf die Bucht");
            // Eine andere Adresse darf weiter handeln.
            expect(fehler(await aktion("beschreibung", body.schluessel, { beschreibung: "Neu" }, adresse(8)))).toBe(
                "200",
            );
        });

        it("gescheiterte Einreichungen verbrauchen das Tagesbudget aller nicht", async () => {
            // 34 Adressen schicken je sechs kaputte Bilder (415): jede Adresse ist für die Stunde verbraucht, das Tagesbudget nicht.
            for (let nummer = 0; nummer < 34; nummer += 1) {
                const ip = adresse(500 + nummer);
                for (let versuch = 0; versuch < PHOTOBOX_GRENZEN.jeAdresseJeStunde; versuch += 1) {
                    const kaputt = await einreichung(spuren, 5000 + nummer * 10 + versuch, { bild: svgUpload() });
                    expect(fehler(await einreichen(kaputt, ip))).toBe("415 unsupported_media_type");
                }
            }
            expect(fehler(await einreichen(await einreichung(spuren, 5999), adresse(999)))).toBe("201");
        });
    });

    describe("🔴 Reihenfolge beim Einreichen (C1)", () => {
        it("ein Fallen-Treffer zählt in die Drossel der Adresse: drei Treffer und drei Einreichungen verbrauchen die Stunde", async () => {
            const ip = adresse(10);
            for (let nummer = 0; nummer < 3; nummer += 1) {
                const honig = await einreichung(spuren, 400 + nummer, {
                    falle: { feld: "http://spam.example", dauerMs: 9000 },
                });
                expect(fehler(await einreichen(honig, ip))).toBe("201");
                await eingereicht(410 + nummer, ip);
            }
            const siebte = await einreichung(spuren, 420);
            expect(fehler(await einreichen(siebte, ip))).toBe("429 photobox_rate");
            // Es entstanden nur die drei echten.
            expect((await zaehle(database, spuren)).einreichung).toBe(3);
        });

        it("über der Grenze ist auch ein Fallen-Treffer 429 (die Falle umgeht die Drossel nie), und eine echte Einreichung ebenso", async () => {
            const ip = adresse(11);
            for (let nummer = 0; nummer < PHOTOBOX_GRENZEN.jeAdresseJeStunde; nummer += 1) {
                const honig = await einreichung(spuren, 430 + nummer, { falle: { feld: "bot", dauerMs: 10 } });
                expect(fehler(await einreichen(honig, ip)), `Treffer ${String(nummer + 1)}`).toBe("201");
            }
            for (let nummer = 0; nummer < 20; nummer += 1) {
                const honig = await einreichung(spuren, 440 + nummer, { falle: { feld: "bot", dauerMs: 10 } });
                expect(fehler(await einreichen(honig, ip))).toBe("429 photobox_rate");
            }
            expect(fehler(await einreichen(await einreichung(spuren, 470), ip))).toBe("429 photobox_rate");
            expect((await zaehle(database, spuren)).einreichung).toBe(0);
        });

        it("Fallen-Treffer zählen nicht ins Tagesbudget: 204 Treffer aus 34 Adressen lassen eine echte Einreichung zu", async () => {
            const honig = await einreichung(spuren, 480, { falle: { feld: "bot", dauerMs: 10 } });
            const treffer: string[] = [];
            for (let nummer = 0; nummer < 34; nummer += 1) {
                const antworten = await Promise.all(
                    Array.from({ length: PHOTOBOX_GRENZEN.jeAdresseJeStunde }, () =>
                        einreichen(honig, adresse(100 + nummer)),
                    ),
                );
                treffer.push(...antworten.map(fehler));
            }
            expect(treffer).toHaveLength(204);
            expect(treffer.every((code) => code === "201")).toBe(true);
            expect(fehler(await einreichen(await einreichung(spuren, 481), adresse(200)))).toBe("201");
        });

        it("der Schalter steht vor der Drossel: ausgeschaltet ist es immer 503 und zählt nichts; wieder an, darf die Adresse sofort", async () => {
            const ip = adresse(12);
            await schalter(false);
            for (let nummer = 0; nummer < PHOTOBOX_GRENZEN.jeAdresseJeStunde + 3; nummer += 1) {
                const body = await einreichung(spuren, 490 + nummer);
                expect(fehler(await einreichen(body, ip))).toBe("503 photobox_paused");
            }
            await schalter(true);
            expect(fehler(await einreichen(await einreichung(spuren, 500), ip))).toBe("201");
            expect((await zaehle(database, spuren)).einreichung).toBe(1);
        });
    });

    describe("🔴 Bild ersetzen zählt wie eine Einreichung (I2)", () => {
        it("drei Ersetzungen und drei Einreichungen verbrauchen die Stunde der Adresse: Einreichen und Ersetzen sind dann 429", async () => {
            const vorhanden = await eingereicht(510, adresse(20));
            const ip = adresse(21);
            for (let nummer = 0; nummer < 3; nummer += 1) {
                const ersetzt = await aktion("bild", vorhanden.schluessel, { bild: await pngUpload(520 + nummer) }, ip);
                expect(fehler(ersetzt), `Ersetzung ${String(nummer + 1)}`).toBe("200");
                await eingereicht(530 + nummer, ip);
            }
            expect(fehler(await einreichen(await einreichung(spuren, 540), ip))).toBe("429 photobox_rate");
            expect(fehler(await aktion("bild", vorhanden.schluessel, { bild: await pngUpload(541) }, ip))).toBe(
                "429 photobox_rate",
            );
            // Die abgewiesene Ersetzung schrieb nichts: das erste Bild und drei Ersetzungen.
            expect(await bilderZu(vorhanden.schluessel)).toBe(4);
            // Andere Statusaktionen derselben Adresse laufen weiter (eigene Statusdrossel).
            expect(fehler(await aktion("beschreibung", vorhanden.schluessel, { beschreibung: "Geht noch" }, ip))).toBe(
                "200",
            );
        });

        it("gescheiterte Bildersetzungen verbrauchen das Tagesbudget aller nicht: nach 204 Fehlversuchen aus 34 Adressen geht eine Einreichung", async () => {
            const bild = svgUpload();
            const antworten: { statusCode: number }[] = [];
            // 34 Adressen zu je sechs Versuchen (SVG, ohne Datenbank abgewiesen): jede Adresse ist für die Stunde verbraucht, das Tagesbudget nicht.
            for (let nummer = 0; nummer < 34; nummer += 1) {
                antworten.push(
                    ...(await Promise.all(
                        Array.from({ length: PHOTOBOX_GRENZEN.jeAdresseJeStunde }, () =>
                            aktion("bild", UNBEKANNT, { bild }, adresse(300 + nummer)),
                        ),
                    )),
                );
            }
            expect(durchgekommen(antworten)).toBe(34 * PHOTOBOX_GRENZEN.jeAdresseJeStunde);
            expect(fehler(await einreichen(await einreichung(spuren, 550), adresse(400)))).toBe("201");
        });
    });
});
