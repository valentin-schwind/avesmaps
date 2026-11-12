import { randomBytes, randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    BEWERTUNG_GRENZEN,
    BewertungAntwort,
    BewertungDetail,
    BewertungListe,
    BewertungQuittung,
    GefaelltAntwort,
    MeldungAntwort,
    VorgangDetail,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { bewertungVerdacht } from "../src/community/bewertung-verdacht.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { listReviews } from "../src/subjects/sections/reviews.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Bewertungen im Community-Modul (WI-0269 C10, Fachkonzept §14) gegen echtes PostgreSQL: schreiben, Zustände, „Gefällt mir“, melden, die
 * Handgriffe der Redaktion und was die öffentliche Sektion davon zeigt.
 *
 * - 🔴 Öffentlich: eine Bewertung steht sofort (`neu`); Adresse oder Wort aus der Liste halten sie zurück (nie still verwerfen); Honigtopf und
 *   Zeitfalle legen NICHTS an; die Drossel zählt nur im Speicher (429); ein ungültiges aventurisches Datum sagt, was nicht stimmt.
 * - 🔴 Die öffentliche Sektion (`listReviews`) zeigt nur `neu` und `gesichtet`; Anzahl, Durchschnitt und Verteilung zählen nur diese, und
 *   zurückgehaltene und verborgene Bewertungen verlassen die Datenbank dort nie.
 * - Redaktion: Liste und Fenster nur mit `moderate_submissions`, veraltete Revision 409, Übergänge geprüft; „Inhalt löschen“ nur mit
 *   `moderate_community` und frischem Passkey; Protokoll ohne Name, Text, Datum und Sterne, eine Wiederholung derselben Kennung schreibt nichts
 *   zweites. Das Verbergen schließt auf Wunsch die offenen Meldungen zur Bewertung mit „umgesetzt“.
 * Die Rechte der App-Rolle wie auf dem VPS prüft `community-grants.test.ts`, den Import `reviews.test.ts`.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const ORT = "69690000-0000-4000-8000-000000000001";
const ANDERER_ORT = "69690000-0000-4000-8000-000000000002";
const GEMEINSAM = "R69T";

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "bewertungen-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describe("Spamverdacht: ganze Wörter und Adressen, nie Teilzeichenketten", () => {
    it.each([
        ["Besuche http://billig.example jetzt", "adresse"],
        ["Schau auf www.beispiel.de", "adresse"],
        ["Schreib an mich@beispiel.org", "adresse"],
        ["Mehr unter firma.com", "adresse"],
        ["Das beste Casino der Stadt", "wortliste"],
        ["SEO für alle", "wortliste"],
        ["viagra, crypto und loan", "wortliste"],
    ])("hält zurück: %s (%s)", (text, grund) => {
        expect(bewertungVerdacht(text)).toEqual({ zustand: "zurueckgehalten", grund });
    });

    it.each([
        "Das Museo am Markt ist hübsch.",
        "Gloanna die Wirtin war freundlich.",
        "Ein Sexton läutet hier die Glocken, bei Crypta Boronis.",
        "Gareth.Es gibt viel zu sehen.",
        "Gutes Bier, schlechtes Wetter, 5 Sterne.",
        "",
    ])("lässt durch: %s", (text) => {
        expect(bewertungVerdacht(text)).toEqual({ zustand: "neu", grund: null });
    });

    it("eine Adresse zählt vor der Wortliste; auch der Name wird geprüft", () => {
        expect(bewertungVerdacht("casino www.x.de")).toMatchObject({ grund: "adresse" });
        expect(bewertungVerdacht("Hübsch", "Casino-Karl")).toMatchObject({ grund: "wortliste" });
        expect(bewertungVerdacht(undefined, undefined)).toEqual({ zustand: "neu", grund: null });
    });
});

describeWithDatabase("Bewertungen: Routen und Datenbank (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let tester: { id: string; cookie: string };
    let lena: { id: string; cookie: string };
    let admin: { id: string; cookie: string };
    let adminFrisch: { id: string; cookie: string };
    /** Jede Gruppe von Anfragen kommt von einer eigenen Adresse, damit die Drossel nicht über Tests hinweg zählt. */
    let adresse = 10;
    const neueAdresse = (): string => `10.69.0.${String(adresse++)}`;

    async function leeren(): Promise<void> {
        await database`DELETE FROM avesmaps_community.vorgang`;
        await database`DELETE FROM avesmaps_community.bewertung_ereignis`;
        await database`DELETE FROM place_review WHERE place_id IN (SELECT id FROM place WHERE name LIKE ${`${GEMEINSAM} %`})`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE action LIKE 'system.community_%'`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        await database`DELETE FROM avesmaps_community.vorgang`;
        await database`DELETE FROM place_review WHERE place_id IN (SELECT id FROM place WHERE name LIKE ${`${GEMEINSAM} %`})`;
        await database`DELETE FROM place WHERE name LIKE ${`${GEMEINSAM} %`}`;
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT}, 'aventuria', ${`${GEMEINSAM} Gareth`}, 'stadt', ST_SetSRID(ST_MakePoint(500, 400), 0), 'test', TRUE),
                   (${ANDERER_ORT}, 'aventuria', ${`${GEMEINSAM} Wehrheim`}, 'dorf', ST_SetSRID(ST_MakePoint(510, 410), 0), 'test', TRUE)
        `;
        fixture = authFixture(database);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: Role, name: string, optionen: { passkeyMinutesAgo?: number } = {}) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, {
                assurance: "strong",
                passkeyMinutesAgo: optionen.passkeyMinutesAgo ?? 60,
            });
            return { id: created.id, cookie };
        };
        tester = await person("tester", "Tessa");
        lena = await person("reviewer", "Lena");
        admin = await person("admin", "Adrian");
        adminFrisch = await person("admin", "Frida", { passkeyMinutesAgo: 1 });
    });

    beforeEach(leeren);

    afterAll(async () => {
        await app?.close();
        await leeren().catch(() => undefined);
        await database`DELETE FROM place WHERE name LIKE ${`${GEMEINSAM} %`}`.catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const bewertung = (patch: Record<string, unknown> = {}) => ({
        operationId: randomUUID(),
        ort: ORT,
        sterne: 4,
        text: "Gutes Bier,   freundliche Wirtin.",
        name: "Alrike",
        datum: "7. Rahja 1049 BF",
        falle: { feld: "", dauerMs: 8000 },
        ...patch,
    });
    const postOeffentlich = (url: string, payload: Record<string, unknown>, ip: string = neueAdresse()) =>
        app.inject({ method: "POST", url, payload, remoteAddress: ip, headers: { origin: TEST_ORIGIN } });
    const get = (url: string, cookie?: string) =>
        app.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });
    const post = (url: string, payload: Record<string, unknown>, cookie: string) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const anzahl = async (): Promise<number> =>
        (
            await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM place_review WHERE place_id IN (SELECT id FROM place WHERE name LIKE ${`${GEMEINSAM} %`})`
        )[0]!.n;
    const protokoll = async (action: string) =>
        database<{ target_ref: string | null; details: Record<string, unknown>; actor_person_id: string | null }[]>`
            SELECT target_ref, details, actor_person_id FROM avesmaps_auth.security_event WHERE action = ${action} ORDER BY id
        `;

    /** Schreibt eine Bewertung über die Leitung und gibt Kennung und Zustand zurück. */
    const schreibe = async (patch: Record<string, unknown> = {}) => {
        const antwort = await postOeffentlich("/api/community/bewertungen", bewertung(patch));
        expect(code(antwort)).toBe("201");
        expect(Value.Check(BewertungAntwort, antwort.json())).toBe(true);
        return antwort.json() as { id: string; zustand: "neu" | "zurueckgehalten" };
    };
    const detail = async (id: string, cookie = lena.cookie): Promise<BewertungDetail> => {
        const antwort = await get(`/api/community/bewertungen/${id}`, cookie);
        expect(code(antwort)).toBe("200");
        const body = antwort.json() as BewertungDetail;
        expect(Value.Check(BewertungDetail, body)).toBe(true);
        return body;
    };
    const schritt = (id: string, was: string, payload: Record<string, unknown>, cookie = lena.cookie) =>
        post(`/api/community/bewertungen/${id}/${was}`, { operationId: randomUUID(), ...payload }, cookie);
    const verbirg = (id: string, revision: number, patch: Record<string, unknown> = {}, cookie = lena.cookie) =>
        schritt(
            id,
            "verbergen",
            { baseRevision: revision, grund: "beleidigend", vorgaengeAbschliessen: false, ...patch },
            cookie,
        );

    describe("schreiben", () => {
        it("🔴 201 mit Kennung, sofort öffentlich; Text und Name bereinigt; aventurisches Datum; Herkunft Website; keine Personenspalte", async () => {
            const { id, zustand } = await schreibe();
            expect(zustand).toBe("neu");
            const d = await detail(id);
            expect(d.zeile).toMatchObject({
                sterne: 4,
                text: "Gutes Bier, freundliche Wirtin.",
                name: "Alrike",
                datum: "7. Rahja 1049 BF",
                zustand: "neu",
                herkunft: "website",
                gemeldet: [],
                gefaellt: 0,
                inhaltGeloescht: false,
                revision: 1,
            });
            expect(d.ort).toMatchObject({ name: `${GEMEINSAM} Gareth`, art: "stadt", lage: { x: 500, y: 400 } });
            expect(d.verlauf).toMatchObject([{ art: "eingang", text: "website" }]);
            // Die Tafel hat keine Spalte für Adresse oder Browser; eine Zeile aus dem Netz trägt auch keine Legacy-Nummer.
            const [zeile] = await database<
                Record<string, unknown>[]
            >`SELECT * FROM place_review WHERE public_id = ${id}::uuid`;
            expect(
                Object.keys(zeile!).filter((k) =>
                    /(^|_)(ip|agent|origin|session|token|user|account|mail)(_|$)/u.test(k),
                ),
            ).toEqual([]);
            expect(zeile).toMatchObject({
                legacy_review_id: null,
                legacy_created_at: null,
                source_system: "website",
                statuslink_hash: null,
            });
        });

        it("ohne Datum gilt der heutige Tag im aventurischen Kalender; ein ungültiges Datum sagt es ehrlich", async () => {
            const { id } = await schreibe({ datum: undefined });
            expect((await detail(id)).zeile.datum).toMatch(
                /^\d{1,2}\. (Praios|Rondra|Efferd|Travia|Boron|Hesinde|Firun|Tsa|Phex|Peraine|Ingerimm|Rahja) \d{4} BF$/u,
            );
            const falsch = await postOeffentlich("/api/community/bewertungen", bewertung({ datum: "gestern" }));
            expect(code(falsch)).toBe("422 community_invalid");
            expect(await anzahl()).toBe(1);
        });

        it("🔴 eine neue Bewertung läutet: die erste nennt ihre Kennung, ab der zweiten die Zahl; die Wiederholung zählt nicht; nie Text oder Name", async () => {
            const zeilen = (person: string) =>
                database<{ text: string | null; quelle: string }[]>`
                    SELECT text, quelle FROM public.benachrichtigung
                     WHERE an_person = ${person}::uuid AND art = 'bewertung_neu' ORDER BY id
                `;
            await database`DELETE FROM public.benachrichtigung WHERE art = 'bewertung_neu'`;
            const erste = bewertung();
            const antwort = await postOeffentlich("/api/community/bewertungen", erste);
            expect(code(antwort)).toBe("201");
            const { id } = antwort.json() as { id: string };
            expect(await zeilen(lena.id)).toEqual([{ text: id, quelle: `bewertung_neu:${id}` }]);
            expect(await zeilen(tester.id)).toEqual([]);

            expect(code(await postOeffentlich("/api/community/bewertungen", erste))).toBe("201");
            expect(await zeilen(lena.id)).toEqual([{ text: id, quelle: `bewertung_neu:${id}` }]);

            await schreibe();
            await schreibe({ text: "Hier kann man mich erreichen: mail@example.org" });
            expect(await zeilen(lena.id)).toEqual([{ text: "3", quelle: `bewertung_neu:${id}` }]);
            await database`DELETE FROM public.benachrichtigung WHERE art = 'bewertung_neu'`;
        });

        it("🔴 ohne Text und ohne Namen: NULL gespeichert (der Leser schreibt „Anonym“), nie eine leere Zeichenkette", async () => {
            const { id } = await schreibe({ text: "   ", name: "" });
            const d = await detail(id);
            expect(d.zeile.text).toBeNull();
            expect(d.zeile.name).toBeNull();
        });

        it("Pflicht und Längen: Sterne 1 bis 5, Text höchstens 200, Name höchstens 80, unbekannter Ort 404; dieselbe Kennung legt nichts zweites an", async () => {
            for (const sterne of [0, 6]) {
                expect(code(await postOeffentlich("/api/community/bewertungen", bewertung({ sterne })))).toBe(
                    "400 validation_failed",
                );
            }
            expect(
                code(await postOeffentlich("/api/community/bewertungen", bewertung({ text: "x".repeat(201) }))),
            ).toBe("400 validation_failed");
            expect(code(await postOeffentlich("/api/community/bewertungen", bewertung({ name: "n".repeat(81) })))).toBe(
                "400 validation_failed",
            );
            expect(
                code(
                    await postOeffentlich(
                        "/api/community/bewertungen",
                        bewertung({ ort: "69690000-0000-4000-8000-0000000000ff" }),
                    ),
                ),
            ).toBe("404 community_not_found");
            // Leerraum zählt nach dem Zusammenziehen: 201 Zeichen mit vielen Blanks sind kein Text über 200.
            expect(await anzahl()).toBe(0);
            const body = bewertung();
            const erste = await postOeffentlich("/api/community/bewertungen", body);
            const zweite = await postOeffentlich("/api/community/bewertungen", body);
            expect((zweite.json() as { id: string }).id).toBe((erste.json() as { id: string }).id);
            expect(await anzahl()).toBe(1);
        });

        it("🔴 Adresse im Text oder Wort aus der Liste: zurückgehalten, nicht öffentlich, der Verfasser erfährt es ehrlich (Zustand), nichts geht verloren", async () => {
            const a = await schreibe({ text: "Besuche www.billig.example" });
            const b = await schreibe({ text: "Das beste Casino in Gareth" });
            expect([a.zustand, b.zustand]).toEqual(["zurueckgehalten", "zurueckgehalten"]);
            expect((await detail(a.id)).zeile).toMatchObject({ zustand: "zurueckgehalten", grund: "adresse" });
            expect((await detail(b.id)).zeile).toMatchObject({ zustand: "zurueckgehalten", grund: "wortliste" });
            // Ganze Wörter: „Museo“ ist kein „seo“.
            const c = await schreibe({ text: "Das Museo am Markt." });
            expect(c.zustand).toBe("neu");
            const oeffentlich = await listReviews(database, ORT);
            expect(oeffentlich.count).toBe(1);
            expect(oeffentlich.reviews.map((r) => r.id)).toEqual([c.id]);
        });

        it("🔴 Honigtopf und Zeitfalle: 201 mit erfundener Kennung, NICHTS gespeichert", async () => {
            const honig = await postOeffentlich(
                "/api/community/bewertungen",
                bewertung({ falle: { feld: "http://spam", dauerMs: 9000 } }),
            );
            expect(code(honig)).toBe("201");
            const schnell = await postOeffentlich(
                "/api/community/bewertungen",
                bewertung({ falle: { feld: "", dauerMs: BEWERTUNG_GRENZEN.mindestDauerMs - 1 } }),
            );
            expect(code(schnell)).toBe("201");
            expect(await anzahl()).toBe(0);
        });

        it("🔴 Drossel: die sechste Bewertung einer Adresse in der Stunde sagt ehrlich 429 und legt nichts an; eine andere Adresse darf", async () => {
            const ip = neueAdresse();
            for (let n = 0; n < BEWERTUNG_GRENZEN.jeAdresseJeStunde; n++) {
                expect(code(await postOeffentlich("/api/community/bewertungen", bewertung(), ip))).toBe("201");
            }
            const zuviel = await postOeffentlich("/api/community/bewertungen", bewertung(), ip);
            expect(code(zuviel)).toBe("429 community_rate");
            expect((zuviel.json() as { error: { message: string } }).error.message).toContain("mehrere Bewertungen");
            expect(await anzahl()).toBe(BEWERTUNG_GRENZEN.jeAdresseJeStunde);
            expect(code(await postOeffentlich("/api/community/bewertungen", bewertung(), neueAdresse()))).toBe("201");
        });

        it("🔴 nur von der eigenen Seite: ohne und mit fremdem Origin 403", async () => {
            const url = "/api/community/bewertungen";
            const ohne = await app.inject({ method: "POST", url, payload: bewertung(), remoteAddress: neueAdresse() });
            expect(code(ohne)).toBe("403 forbidden_origin");
            const fremd = await app.inject({
                method: "POST",
                url,
                payload: bewertung(),
                remoteAddress: neueAdresse(),
                headers: { origin: "https://fremd.example" },
            });
            expect(code(fremd)).toBe("403 forbidden_origin");
            expect(await anzahl()).toBe(0);
        });
    });

    describe("die öffentliche Sektion zeigt nur Öffentliches", () => {
        it("🔴 Schnitt, Anzahl und Verteilung zählen nur neu und gesichtet; zurückgehaltene und verborgene stehen nie darin", async () => {
            const a = await schreibe({ sterne: 5, text: "Prima." });
            const b = await schreibe({ sterne: 3, text: "Geht so." });
            const c = await schreibe({ sterne: 1, text: "Besuche www.billig.example" });
            const d = await schreibe({ sterne: 1, text: "Mies." });
            // b wird gesichtet, d verborgen; c ist zurückgehalten.
            expect(code(await schritt(b.id, "sichten", { baseRevision: 1 }))).toBe("200");
            expect(code(await verbirg(d.id, 1))).toBe("200");
            const sektion = await listReviews(database, ORT);
            expect(sektion.count).toBe(2);
            expect(sektion.average).toBe(4);
            expect(sektion.distribution).toEqual([1, 0, 1, 0, 0]);
            const ids = sektion.reviews.map((r) => r.id);
            expect(ids).toEqual([b.id, a.id]);
            expect(ids).not.toContain(c.id);
            expect(ids).not.toContain(d.id);
            // Auch die Texte der nicht öffentlichen stehen nirgends in der Antwort.
            const roh = JSON.stringify(sektion);
            expect(roh).not.toContain("billig");
            expect(roh).not.toContain("Mies");
        });

        it("ein Ort ohne öffentliche Bewertung: leere Sektion; ein anderer Ort sieht fremde Bewertungen nicht", async () => {
            await schreibe();
            expect(await listReviews(database, ANDERER_ORT)).toEqual({ count: 0, reviews: [] });
        });

        it("ein entfernter Ort zeigt keine Bewertungen mehr; kehrt er zurück, kommen sie mit", async () => {
            await schreibe();
            await database`UPDATE place SET is_active = FALSE WHERE public_id = ${ORT}`;
            expect((await listReviews(database, ORT)).count).toBe(0);
            await database`UPDATE place SET is_active = TRUE WHERE public_id = ${ORT}`;
            expect((await listReviews(database, ORT)).count).toBe(1);
        });
    });

    describe("Gefällt mir", () => {
        it("🔴 setzen, zählen, zurücknehmen; nie unter null; die Antwort ist nur die Zahl", async () => {
            const { id } = await schreibe();
            const url = `/api/community/bewertungen/${id}/gefaellt`;
            const eins = await postOeffentlich(url, { delta: 1 });
            expect(code(eins)).toBe("200");
            expect(Value.Check(GefaelltAntwort, eins.json())).toBe(true);
            expect(eins.json()).toEqual({ gefaellt: 1 });
            expect((await postOeffentlich(url, { delta: 1 })).json()).toEqual({ gefaellt: 2 });
            expect((await postOeffentlich(url, { delta: -1 })).json()).toEqual({ gefaellt: 1 });
            expect((await postOeffentlich(url, { delta: -1 })).json()).toEqual({ gefaellt: 0 });
            expect((await postOeffentlich(url, { delta: -1 })).json()).toEqual({ gefaellt: 0 });
            expect(code(await postOeffentlich(url, { delta: 2 }))).toBe("400 validation_failed");
            // Die Zahl steht an der Bewertung in der öffentlichen Sektion (ab 1) und im Fenster der Redaktion.
            await postOeffentlich(url, { delta: 1 });
            expect((await listReviews(database, ORT)).reviews[0]?.likes).toBe(1);
            expect((await detail(id)).zeile.gefaellt).toBe(1);
            // „Gefällt mir“ ändert die Revision nicht: Wer gerade moderiert, sieht keinen Konflikt.
            expect((await detail(id)).zeile.revision).toBe(1);
        });

        it("🔴 nur an öffentlichen Bewertungen; eine zurückgehaltene oder verborgene gibt es für Besucher nicht", async () => {
            const zurueck = await schreibe({ text: "www.billig.example" });
            const verborgen = await schreibe();
            expect(code(await verbirg(verborgen.id, 1))).toBe("200");
            for (const id of [zurueck.id, verborgen.id, randomUUID()]) {
                expect(code(await postOeffentlich(`/api/community/bewertungen/${id}/gefaellt`, { delta: 1 }))).toBe(
                    "404 community_not_found",
                );
            }
        });

        it("🔴 die Drossel je Adresse lebt nur im Speicher: 429 über der Grenze", async () => {
            const { id } = await schreibe();
            const ip = neueAdresse();
            for (let n = 0; n < BEWERTUNG_GRENZEN.gefaelltJeAdresseJeStunde; n++) {
                const antwort = await postOeffentlich(
                    `/api/community/bewertungen/${id}/gefaellt`,
                    { delta: n % 2 === 0 ? 1 : -1 },
                    ip,
                );
                expect(antwort.statusCode).toBe(200);
            }
            expect(code(await postOeffentlich(`/api/community/bewertungen/${id}/gefaellt`, { delta: 1 }, ip))).toBe(
                "429 community_rate",
            );
        });
    });

    describe("melden", () => {
        const melde = (id: string, patch: Record<string, unknown> = {}) =>
            postOeffentlich(`/api/community/bewertungen/${id}/melden`, {
                operationId: randomUUID(),
                schluessel: randomBytes(32).toString("base64url"),
                grund: "beleidigend",
                text: "Das beleidigt alle in Gareth.",
                falle: { feld: "", dauerMs: 8000 },
                ...patch,
            });

        it("🔴 daraus wird ein Vorgang der Kategorie „bewertung“ mit Bezug auf den Ort und die Bewertung; die Bewertung steht wieder unter „Zu sichten“", async () => {
            const { id } = await schreibe();
            expect(code(await schritt(id, "sichten", { baseRevision: 1 }))).toBe("200");
            const antwort = await melde(id);
            expect(code(antwort)).toBe("201");
            expect(Value.Check(MeldungAntwort, antwort.json())).toBe(true);
            const { nummer } = antwort.json() as { nummer: string };
            expect(nummer).toMatch(/^COM-\d{6}$/u);

            const vorgang = (await get(`/api/community/vorgaenge/${nummer}`, lena.cookie)).json() as VorgangDetail;
            expect(Value.Check(VorgangDetail, vorgang)).toBe(true);
            expect(vorgang.zeile).toMatchObject({
                art: "meldung",
                kategorie: "bewertung",
                zustand: "neu",
                bezugName: `${GEMEINSAM} Gareth`,
                ohneQuelle: false,
            });
            expect(vorgang.bezug).toMatchObject({
                art: "objekt",
                objektArt: "place",
                objektId: ORT,
                lage: { x: 500, y: 400 },
            });
            expect(vorgang.melder.rueckwege).toEqual(["statusseite"]);
            expect(vorgang.verlauf.find((e) => e.art === "nachricht")).toMatchObject({
                text: "Das beleidigt alle in Gareth.",
            });

            const d = await detail(id);
            expect(d.zeile.gemeldet).toEqual([nummer]);
            expect(d.meldungen).toEqual([{ nummer, grund: "beleidigend", zustand: "neu", ergebnis: null }]);
            expect(d.verlauf.at(-1)).toMatchObject({ art: "gemeldet", text: nummer });
            // „Zu sichten“, obwohl schon gesichtet.
            const liste = (
                await get("/api/community/bewertungen?segment=sichten", lena.cookie)
            ).json() as BewertungListe;
            expect(liste.zeilen.map((z) => z.id)).toEqual([id]);
            expect(liste.zaehler).toMatchObject({ sichten: 1, sichtbar: 0 });
            // Die Beschreibung ist freiwillig; dieselbe Kennung legt nichts zweites an.
            const ohneText = await melde(id, { text: undefined, grund: "spam" });
            expect(code(ohneText)).toBe("201");
            const gleich = { operationId: randomUUID() };
            const n1 = (await melde(id, gleich)).json() as { nummer: string };
            const n2 = (await melde(id, gleich)).json() as { nummer: string };
            expect(n2.nummer).toBe(n1.nummer);
        });

        it("🔴 eine nicht öffentliche Bewertung kann niemand melden; Honigtopf legt nichts an; Grund Pflicht", async () => {
            const verborgen = await schreibe();
            expect(code(await verbirg(verborgen.id, 1))).toBe("200");
            expect(code(await melde(verborgen.id))).toBe("404 community_not_found");
            const offen = await schreibe();
            expect(code(await melde(offen.id, { falle: { feld: "x", dauerMs: 9000 } }))).toBe("201");
            expect(code(await melde(offen.id, { grund: "unfug" }))).toBe("400 validation_failed");
            expect(code(await melde(offen.id, { schluessel: "kurz" }))).toBe("400 validation_failed");
            expect(
                (await database<{ n: number }[]>`SELECT count(*)::int AS n FROM avesmaps_community.vorgang`)[0]!.n,
            ).toBe(0);
        });
    });

    describe("Redaktion", () => {
        it("🔴 Liste und Fenster nur mit moderate_submissions: ohne Anmeldung 401, Tester 403", async () => {
            const { id } = await schreibe();
            expect(code(await get("/api/community/bewertungen"))).toBe("401 unauthenticated");
            expect(code(await get(`/api/community/bewertungen/${id}`))).toBe("401 unauthenticated");
            expect(code(await get("/api/community/bewertungen", tester.cookie))).toBe("403 forbidden");
            expect(code(await get(`/api/community/bewertungen/${id}`, tester.cookie))).toBe("403 forbidden");
            for (const was of ["sichten", "freigeben", "einblenden", "verbergen", "inhalt-loeschen"]) {
                expect(
                    code(
                        await schritt(
                            id,
                            was,
                            { baseRevision: 1, grund: "spam", vorgaengeAbschliessen: false },
                            tester.cookie,
                        ),
                    ),
                    was,
                ).toBe("403 forbidden");
            }
            expect(code(await get("/api/community/bewertungen", lena.cookie))).toBe("200");
        });

        it("Liste: Segmente, Zähler, Suche, Trichter und Sortierung", async () => {
            const a = await schreibe({ sterne: 5, text: "Prima Tavernen", name: "Alrik" });
            const b = await schreibe({ sterne: 2, text: "Besuche www.billig.example", name: "Spam" });
            const c = await schreibe({ sterne: 3, ort: ANDERER_ORT, text: "Ruhig hier" });
            const d = await schreibe({ sterne: 1, text: "Mies" });
            expect(code(await schritt(c.id, "sichten", { baseRevision: 1 }))).toBe("200");
            expect(code(await verbirg(d.id, 1, { grund: "spam" }))).toBe("200");
            const liste = async (query = ""): Promise<BewertungListe> => {
                const antwort = await get(`/api/community/bewertungen${query}`, lena.cookie);
                expect(code(antwort)).toBe("200");
                expect(Value.Check(BewertungListe, antwort.json())).toBe(true);
                return antwort.json() as BewertungListe;
            };
            const standard = await liste();
            // Zu sichten: neu (a) und zurückgehalten (b), neueste zuerst.
            expect(standard.zeilen.map((z) => z.id)).toEqual([b.id, a.id]);
            expect(standard.zaehler).toEqual({
                sichten: 2,
                sichtbar: 1,
                verborgen: 1,
                neu: 1,
                zurueckgehalten: 1,
                gesichtet: 1,
            });
            expect((await liste("?segment=sichtbar")).zeilen.map((z) => z.id)).toEqual([c.id]);
            expect((await liste("?segment=verborgen")).zeilen.map((z) => z.id)).toEqual([d.id]);
            expect((await liste("?segment=sichten&zurueckgehalten=true")).zeilen.map((z) => z.id)).toEqual([b.id]);
            expect((await liste("?segment=sichten&sterne=5")).zeilen.map((z) => z.id)).toEqual([a.id]);
            expect((await liste("?segment=sichten&q=tavern")).zeilen.map((z) => z.id)).toEqual([a.id]);
            expect((await liste("?segment=sichten&q=Alrik")).zeilen.map((z) => z.id)).toEqual([a.id]);
            expect((await liste("?segment=sichtbar&q=Wehrheim")).zeilen.map((z) => z.id)).toEqual([c.id]);
            expect((await liste("?segment=sichten&herkunft=legacy")).zeilen).toEqual([]);
            expect((await liste("?segment=sichten&sortierung=aelteste")).zeilen.map((z) => z.id)).toEqual([a.id, b.id]);
            expect((await liste("?segment=sichten&sortierung=wenigste")).zeilen.map((z) => z.id)).toEqual([b.id, a.id]);
            expect((await liste("?segment=sichten&q=%25")).zeilen).toEqual([]);
        });

        it("🔴 Sichten: aus „neu“ zu „gesichtet“, bleibt öffentlich; zweimal 409; veraltete Revision 409; Protokoll nur Kennung und Zustand", async () => {
            const { id } = await schreibe();
            expect(code(await schritt(id, "sichten", { baseRevision: 7 }))).toBe("409 community_conflict");
            const operationId = randomUUID();
            const ok = await post(
                `/api/community/bewertungen/${id}/sichten`,
                { operationId, baseRevision: 1 },
                lena.cookie,
            );
            expect(code(ok)).toBe("200");
            expect(Value.Check(BewertungQuittung, ok.json())).toBe(true);
            expect((ok.json() as { revision: number }).revision).toBe(2);
            // Dieselbe Kennung noch einmal: dieselbe Revision, kein zweites Ereignis, kein zweiter Protokolleintrag.
            const nochmal = await post(
                `/api/community/bewertungen/${id}/sichten`,
                { operationId, baseRevision: 1 },
                lena.cookie,
            );
            expect(code(nochmal)).toBe("200");
            expect((nochmal.json() as { revision: number }).revision).toBe(2);
            expect(code(await schritt(id, "sichten", { baseRevision: 2 }))).toBe("409 community_transition");
            const eintraege = await protokoll("system.community_bewertung_gesichtet");
            expect(eintraege).toHaveLength(1);
            expect(eintraege[0]).toMatchObject({
                target_ref: id,
                details: { bewertung: id, zustand: "gesichtet" },
                actor_person_id: lena.id,
            });
            expect(JSON.stringify(eintraege)).not.toMatch(/Alrike|Gutes Bier|Rahja/u);
            const d = await detail(id);
            expect(d.zeile.zustand).toBe("gesichtet");
            expect(d.verlauf.map((e) => e.art)).toEqual(["eingang", "gesichtet"]);
            expect((await listReviews(database, ORT)).count).toBe(1);
        });

        it("🔴 Freigeben: nur aus „zurückgehalten“; danach öffentlich und gesichtet", async () => {
            const { id } = await schreibe({ text: "Casino Royal" });
            const normal = await schreibe();
            expect(code(await schritt(normal.id, "freigeben", { baseRevision: 1 }))).toBe("409 community_transition");
            expect((await listReviews(database, ORT)).count).toBe(1);
            expect(code(await schritt(id, "freigeben", { baseRevision: 1 }))).toBe("200");
            const d = await detail(id);
            expect(d.zeile).toMatchObject({ zustand: "gesichtet", grund: null });
            expect(d.verlauf.at(-1)).toMatchObject({ art: "freigegeben", text: "wortliste" });
            expect((await listReviews(database, ORT)).count).toBe(2);
            expect(await protokoll("system.community_bewertung_freigegeben")).toHaveLength(1);
        });

        it("🔴 Verbergen: Grund Pflicht aus dem Katalog; danach nicht öffentlich und nicht im Schnitt; Ort jetzt und danach; Einblenden bringt sie zurück", async () => {
            const gut = await schreibe({ sterne: 5 });
            const schlecht = await schreibe({ sterne: 1, text: "Nicht schön." });
            const vorher = await detail(schlecht.id);
            expect(vorher.ort.jetzt).toEqual({ n: 2, wert: 3 });
            // Nach dem Verbergen blieben 5 Sterne aus 1 Bewertung.
            expect(vorher.ort.danach).toEqual({ n: 1, wert: 5 });
            expect(code(await verbirg(schlecht.id, 1, { grund: "unfug" }))).toBe("400 validation_failed");
            expect(code(await verbirg(schlecht.id, 1, { grund: "person" }))).toBe("200");
            const d = await detail(schlecht.id);
            expect(d.zeile).toMatchObject({ zustand: "verborgen", grund: "person" });
            expect(d.ort.jetzt).toEqual({ n: 1, wert: 5 });
            // Danach (nach dem Einblenden): wieder beide.
            expect(d.ort.danach).toEqual({ n: 2, wert: 3 });
            const sektion = await listReviews(database, ORT);
            expect(sektion.count).toBe(1);
            expect(sektion.reviews.map((r) => r.id)).toEqual([gut.id]);
            expect(code(await verbirg(schlecht.id, 2))).toBe("409 community_transition");
            const eintraege = await protokoll("system.community_bewertung_verborgen");
            expect(eintraege).toHaveLength(1);
            expect(eintraege[0]).toMatchObject({
                details: { bewertung: schlecht.id, zustand: "verborgen", grund: "person" },
            });
            // Einblenden
            expect(code(await schritt(schlecht.id, "einblenden", { baseRevision: 2 }))).toBe("200");
            expect((await detail(schlecht.id)).zeile).toMatchObject({ zustand: "gesichtet", grund: null });
            expect((await listReviews(database, ORT)).count).toBe(2);
            expect(code(await schritt(schlecht.id, "einblenden", { baseRevision: 3 }))).toBe(
                "409 community_transition",
            );
        });

        it("🔴 Verbergen aus der Meldung heraus: die offenen Meldungen werden mit „umgesetzt“ abgeschlossen, jede mit ihrem Protokolleintrag; ohne Haken bleiben sie offen", async () => {
            const a = await schreibe();
            const b = await schreibe({ text: "Zweite." });
            const meldeAn = async (id: string) =>
                (
                    (
                        await postOeffentlich(`/api/community/bewertungen/${id}/melden`, {
                            operationId: randomUUID(),
                            schluessel: randomBytes(32).toString("base64url"),
                            grund: "beleidigend",
                            falle: { feld: "", dauerMs: 8000 },
                        })
                    ).json() as { nummer: string }
                ).nummer;
            const n1 = await meldeAn(a.id);
            const n2 = await meldeAn(a.id);
            const n3 = await meldeAn(b.id);
            const revA = (await detail(a.id)).zeile.revision;
            expect(revA).toBe(3);
            const antwort = await verbirg(a.id, revA, { vorgaengeAbschliessen: true });
            expect(code(antwort)).toBe("200");
            expect((antwort.json() as { abgeschlossen: string[] }).abgeschlossen).toEqual([n1, n2]);
            for (const nummer of [n1, n2]) {
                const v = (await get(`/api/community/vorgaenge/${nummer}`, lena.cookie)).json() as VorgangDetail;
                expect(v.zeile).toMatchObject({ zustand: "abgeschlossen", ergebnis: "umgesetzt" });
                expect(v.verlauf.at(-1)).toMatchObject({
                    art: "ereignis",
                    ereignis: "abgeschlossen",
                    text: "Bewertung verborgen: Beleidigend",
                });
            }
            expect((await get(`/api/community/vorgaenge/${n3}`, lena.cookie)).json()).toMatchObject({
                zeile: { zustand: "neu" },
            });
            const abgeschlossen = await protokoll("system.community_abgeschlossen");
            expect(abgeschlossen.map((e) => e.target_ref)).toEqual([n1, n2]);
            expect(abgeschlossen[0]).toMatchObject({ details: { com: n1, ergebnis: "umgesetzt" } });
            // Ohne Haken: b wird verborgen, ihre Meldung bleibt offen.
            const revB = (await detail(b.id)).zeile.revision;
            expect((await verbirg(b.id, revB, { vorgaengeAbschliessen: false })).statusCode).toBe(200);
            expect((await get(`/api/community/vorgaenge/${n3}`, lena.cookie)).json()).toMatchObject({
                zeile: { zustand: "neu" },
            });
        });

        it("🔴 Inhalt löschen: nur Moderation mit frischem Passkey, nur aus „verborgen“; danach ohne Name, Text, Datum; Einblenden geht nicht mehr; Protokoll ohne Inhalt", async () => {
            const { id } = await schreibe();
            const url = `/api/community/bewertungen/${id}/inhalt-loeschen`;
            // Nicht verborgen: Übergang verboten (auch mit allen Rechten).
            expect(code(await post(url, { operationId: randomUUID(), baseRevision: 1 }, adminFrisch.cookie))).toBe(
                "409 community_transition",
            );
            expect(code(await verbirg(id, 1))).toBe("200");
            expect(code(await post(url, { operationId: randomUUID(), baseRevision: 2 }, lena.cookie))).toBe(
                "403 forbidden",
            );
            expect(code(await post(url, { operationId: randomUUID(), baseRevision: 2 }, admin.cookie))).toBe(
                "403 reauth_required",
            );
            expect((await protokoll("system.community_bewertung_geloescht")).length).toBe(0);
            const operationId = randomUUID();
            const weg = await post(url, { operationId, baseRevision: 2 }, adminFrisch.cookie);
            expect(code(weg)).toBe("200");
            expect(code(await post(url, { operationId, baseRevision: 2 }, adminFrisch.cookie))).toBe("200");
            const eintraege = await protokoll("system.community_bewertung_geloescht");
            expect(eintraege).toHaveLength(1);
            expect(eintraege[0]).toMatchObject({
                target_ref: id,
                details: { bewertung: id, zustand: "verborgen" },
                actor_person_id: adminFrisch.id,
            });
            const d = await detail(id);
            expect(d.zeile).toMatchObject({
                text: null,
                name: null,
                datum: null,
                inhaltGeloescht: true,
                zustand: "verborgen",
                sterne: 4,
            });
            expect(d.verlauf.at(-1)).toMatchObject({ art: "inhalt_geloescht", text: null });
            expect(code(await schritt(id, "einblenden", { baseRevision: 3 }))).toBe("409 community_transition");
            const [zeile] = await database<
                { author_name: string | null; body: string | null; dsa_date: string | null }[]
            >`
                SELECT author_name, body, dsa_date FROM place_review WHERE public_id = ${id}::uuid
            `;
            expect(zeile).toEqual({ author_name: null, body: null, dsa_date: null });
        });

        it("Konflikt: wer mit einem alten Stand verbirgt, bekommt 409 und die Bewertung bleibt öffentlich", async () => {
            const { id } = await schreibe();
            expect(code(await schritt(id, "sichten", { baseRevision: 1 }))).toBe("200");
            expect(code(await verbirg(id, 1))).toBe("409 community_conflict");
            expect((await listReviews(database, ORT)).count).toBe(1);
            expect(code(await get(`/api/community/bewertungen/${randomUUID()}`, lena.cookie))).toBe(
                "404 community_not_found",
            );
            expect(code(await schritt(randomUUID(), "sichten", { baseRevision: 1 }))).toBe("404 community_not_found");
        });
    });
});
