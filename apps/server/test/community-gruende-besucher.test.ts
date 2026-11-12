import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { bewertungGefaellt, bewertungMelden, bewertungSchreiben } from "../src/community/bewertungen.ts";
import { CommunityFehler, anfragen, melden } from "../src/community/db.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { TEST_AUTH, TEST_ORIGIN } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Fachcodes der Besucherfenster gegen echtes PostgreSQL (WI-0291, Vali 2026-11-08: „ich will genau fehlermeldungen“): Jeder Satz der Datenbankfunktionen, den ein Fenster der Besucher
 * erreichen kann, kommt als `CommunityFehler` mit `details.reason` an, und die Routen reichen ihn in `error.details` weiter. Die Tafel selbst (jedes Muster trifft genau einen Satz) prüft
 * `community-gruende-besucher-tafel.test.ts` ohne Datenbank.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "gruende-besucher-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

const SCHLUESSEL = "G".repeat(43);
const LAGE = { art: "stelle", lage: { x: 500, y: 400 } } as const;
const TEXT = "Dieser Text ist lang genug, um angenommen zu werden.";

describeWithDatabase("Besucher: Fachcodes der Datenbank (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let adresse = 10;
    const neueAdresse = (): string => `10.91.0.${String(adresse++)}`;

    /** Der Fehler, den ein Aufruf wirft; schlägt der Test fehl, wenn nichts abgelehnt wird. */
    async function faenge(lauf: () => Promise<unknown>): Promise<CommunityFehler> {
        try {
            await lauf();
        } catch (fehler) {
            expect(fehler).toBeInstanceOf(CommunityFehler);
            return fehler as CommunityFehler;
        }
        throw new Error("Der Aufruf wurde nicht abgelehnt.");
    }
    const grund = async (lauf: () => Promise<unknown>): Promise<unknown> => (await faenge(lauf)).details?.["reason"];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
    });

    beforeEach(async () => {
        await database`DELETE FROM avesmaps_community.vorgang`;
    });

    afterAll(async () => {
        await app?.close();
        await database`DELETE FROM avesmaps_community.vorgang`.catch(() => undefined);
        await database?.end({ timeout: 5 });
    });

    describe("Kontakt und Meldung", () => {
        const kontakt = (patch: Record<string, unknown> = {}) => ({
            operationId: randomUUID(),
            schluessel: SCHLUESSEL,
            kategorie: "frage",
            text: TEXT,
            ...patch,
        });

        it("Nachricht zu kurz oder zu lang: nachricht_laenge", async () => {
            expect(await grund(() => anfragen(database, kontakt({ text: "kurz" })))).toBe("nachricht_laenge");
            expect(await grund(() => anfragen(database, kontakt({ text: "x".repeat(2001) })))).toBe("nachricht_laenge");
        });

        it("unbekanntes Thema, Name über 80 Zeichen, Adresse falsch", async () => {
            expect(await grund(() => anfragen(database, kontakt({ kategorie: "nix" })))).toBe("kategorie_unbekannt");
            expect(await grund(() => anfragen(database, kontakt({ name: "n".repeat(81) })))).toBe("name_zu_lang");
            expect(await grund(() => anfragen(database, kontakt({ mail: "kaputt" })))).toBe("adresse_falsch");
        });

        it("Meldung: Beschreibung nach Länge, Schlüssel und Bezug sind Pflicht", async () => {
            const meldung = (patch: Record<string, unknown> = {}) => ({
                operationId: randomUUID(),
                schluessel: SCHLUESSEL,
                kategorie: "angabe",
                text: TEXT,
                bezug: LAGE,
                ...patch,
            });
            expect(await grund(() => melden(database, meldung({ text: "kurz" }) as never))).toBe("beschreibung_laenge");
            // Ein Bezug, der weder Objekt noch Stelle ist, trifft „Schlüssel und Bezug sind Pflicht“.
            expect(await grund(() => melden(database, meldung({ bezug: { art: "nix" } }) as never))).toBe(
                "schluessel_bezug_fehlt",
            );
        });
    });

    describe("Statusseite", () => {
        const body = (patch: Record<string, unknown> = {}) => ({
            operationId: randomUUID(),
            schluessel: randomBytes(32).toString("base64url"),
            kategorie: "angabe",
            text: TEXT,
            bezug: LAGE,
            falle: { feld: "", dauerMs: 8000 },
            ...patch,
        });
        const post = (url: string, payload: Record<string, unknown>) =>
            app.inject({
                method: "POST",
                url,
                payload,
                remoteAddress: neueAdresse(),
                headers: { origin: TEST_ORIGIN },
            });

        it("🔴 nach dem Zurückziehen sagt der 409 den Grund: meldung_zurueckgezogen bzw. vorgang_abgeschlossen, in error.details", async () => {
            const melde = body();
            expect((await post("/api/community/meldungen", melde)).statusCode).toBe(201);
            const zurueck = await post("/api/community/status/zurueckziehen", {
                operationId: randomUUID(),
                schluessel: melde["schluessel"] as string,
            });
            expect(zurueck.statusCode).toBe(200);

            const antwort = await post("/api/community/status/antwort", {
                operationId: randomUUID(),
                schluessel: melde["schluessel"] as string,
                text: "Noch etwas dazu.",
            });
            expect(antwort.statusCode).toBe(409);
            expect(antwort.json()).toMatchObject({
                error: { code: "community_transition", details: { reason: "meldung_zurueckgezogen" } },
            });

            const nochmal = await post("/api/community/status/zurueckziehen", {
                operationId: randomUUID(),
                schluessel: melde["schluessel"] as string,
            });
            expect(nochmal.statusCode).toBe(409);
            expect(nochmal.json()).toMatchObject({
                error: { code: "community_transition", details: { reason: "vorgang_abgeschlossen" } },
            });
        });
    });

    describe("Bewertungen", () => {
        const ORT = "69910000-0000-4000-8000-000000000001";
        const neu = (patch: Record<string, unknown> = {}) => ({
            operationId: randomUUID(),
            ort: ORT,
            sterne: 4,
            datum: "7. Rahja 1049 BF",
            zustand: "neu" as const,
            grund: null,
            ...patch,
        });

        beforeAll(async () => {
            await database`DELETE FROM place WHERE public_id = ${ORT}::uuid`;
            await database`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${ORT}, 'aventuria', 'GRB Gareth', 'stadt', ST_SetSRID(ST_MakePoint(500, 400), 0), 'test', TRUE)
            `;
        });
        afterAll(async () => {
            await database`DELETE FROM place_review WHERE place_id IN (SELECT id FROM place WHERE public_id = ${ORT}::uuid)`.catch(
                () => undefined,
            );
            await database`DELETE FROM place WHERE public_id = ${ORT}::uuid`.catch(() => undefined);
        });

        it("schreiben: Sterne, Text, Name, Datum und Ort jeder mit eigenem Code", async () => {
            const schreibe = (patch: Record<string, unknown>) => bewertungSchreiben(database, neu(patch) as never);
            expect(await grund(() => schreibe({ sterne: 7 }))).toBe("sterne");
            expect(await grund(() => schreibe({ text: "t".repeat(201) }))).toBe("text_zu_lang");
            expect(await grund(() => schreibe({ name: "n".repeat(81) }))).toBe("name_zu_lang");
            expect(await grund(() => schreibe({ datum: "d".repeat(61) }))).toBe("datum_zu_lang");
            expect(await grund(() => schreibe({ ort: randomUUID() }))).toBe("ort_unbekannt");
        });

        it("„Gefällt mir“: ein falscher Schritt und eine fehlende Bewertung", async () => {
            expect(await grund(() => bewertungGefaellt(database, randomUUID(), 2 as never))).toBe("gefaellt_schritt");
            expect(await grund(() => bewertungGefaellt(database, randomUUID(), 1))).toBe("bewertung_unbekannt");
        });

        it("melden: Grund fehlt, Beschreibung zu lang, Bewertung weg", async () => {
            const meldung = (patch: Record<string, unknown>) =>
                bewertungMelden(database, {
                    operationId: randomUUID(),
                    bewertung: randomUUID(),
                    schluessel: SCHLUESSEL,
                    grund: "spam",
                    ...patch,
                } as never);
            expect(await grund(() => meldung({ grund: "" }))).toBe("grund_fehlt");
            expect(await grund(() => meldung({ text: "b".repeat(2001) }))).toBe("beschreibung_zu_lang");
            expect(await grund(() => meldung({}))).toBe("bewertung_unbekannt");
        });

        it("🔴 Route: ein ungültiges aventurisches Datum trägt details.reason datum_ungueltig (Satz des Servers unverändert)", async () => {
            const antwort = await app.inject({
                method: "POST",
                url: "/api/community/bewertungen",
                payload: {
                    operationId: randomUUID(),
                    ort: ORT,
                    sterne: 4,
                    datum: "gestern",
                    falle: { feld: "", dauerMs: 8000 },
                },
                remoteAddress: neueAdresse(),
                headers: { origin: TEST_ORIGIN },
            });
            expect(antwort.statusCode).toBe(422);
            expect(antwort.json()).toMatchObject({
                error: {
                    code: "community_invalid",
                    message: expect.stringContaining("aventurische Datum") as unknown,
                    details: { reason: "datum_ungueltig" },
                },
            });
        });
    });
});
