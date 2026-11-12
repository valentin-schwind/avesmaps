import { randomBytes, randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BENACHRICHTIGUNG_ARTEN, BenachrichtigungListe, COMMUNITY_GLOCKEN_ARTEN, type Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { communityFristen } from "../src/community/aufbewahrung.ts";
import { rollenMit } from "../src/community/glocke.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Glocke des Community-Moduls (WI-0268 C5; Fachkonzept WI-0263 §7, Bedienkonzept §2.2 Nr. 1, §2.3 Nr. 3 und 4) gegen echtes PostgreSQL, über die
 * Routen: Was die Leitung an die Glocke gibt, nicht die Sätze (die prüft `apps/web/test/benachrichtigungen.test.ts`).
 *
 * - `community_neu`: eine je bearbeitende Person (Rolle ab Reviewer, aktiv), **gebündelt** (die Zahl wächst, bis die Glocke geöffnet wurde); die Falle
 *   (Honigtopf, Zeitfalle) und die Wiederholung einer Kennung melden nichts.
 * - `community_zugewiesen`: nur an eine ANDERE Person; sich selbst übernehmen, dieselbe Person nochmals und die Wiederholung melden nichts.
 * - `community_antwort`: an die zuständige Person, ohne Zuständigkeit an die Bearbeitenden; solange der Eintrag zum Vorgang ungelesen ist, kein zweiter.
 * - `community_frist`: nach 30 Tagen in der Rückfrage, einmal.
 * - 🔴 Kein Meldetext, kein Name des Melders in irgendeinem `text`: nur die COM-Nummer (oder die Zahl der Bündelung).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const ORT = "11111111-2222-4333-8444-555555555555";
const MELDETEXT = "Wehrheim liegt zu weit im Westen, laut Regionalband näher an der Reichsstraße.";
const MELDER = "Alrike";

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "community-glocke-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

interface Zeile {
    an_person: string;
    art: string;
    text: string | null;
    quelle: string;
    von_art: string;
    von_person: string | null;
    bezug_ops: string | null;
    gelesen_at: Date | null;
    erstellt_at: Date;
}

describeWithDatabase("Community: Glocke (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let lena: { id: string; cookie: string };
    let emil: { id: string; cookie: string };
    let adrian: { id: string; cookie: string };
    let olaf: { id: string; cookie: string };
    let tessa: { id: string; cookie: string };
    let gesperrt: { id: string };
    let alle: string[];
    let bearbeitende: string[];
    let adresse = 10;
    const neueAdresse = (): string => `10.30.0.${String(adresse++)}`;

    const raeumen = async (): Promise<void> => {
        await database`DELETE FROM avesmaps_community.vorgang`;
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { id: created.id, cookie };
        };
        lena = await person("reviewer", "Lena");
        emil = await person("editor", "Emil");
        adrian = await person("admin", "Adrian");
        olaf = await person("operator", "Olaf");
        tessa = await person("tester", "Tessa");
        gesperrt = await fixture.person("reviewer", { name: "Gesperrt", status: "locked" });
        alle = [lena.id, emil.id, adrian.id, olaf.id, tessa.id, gesperrt.id];
        bearbeitende = [lena.id, emil.id, adrian.id, olaf.id];
    });

    beforeEach(raeumen);

    afterAll(async () => {
        await app?.close();
        await raeumen().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const meldung = (patch: Record<string, unknown> = {}) => ({
        operationId: randomUUID(),
        schluessel: randomBytes(32).toString("base64url"),
        kategorie: "lage",
        text: MELDETEXT,
        quelle: "Herz des Reiches, S. 112",
        name: MELDER,
        bezug: {
            art: "objekt",
            objektArt: "place",
            objektId: ORT,
            name: "Wehrheim",
            typ: "Stadt",
            lage: { x: 500, y: 400 },
        },
        falle: { feld: "", dauerMs: 8000 },
        ...patch,
    });
    const postOeffentlich = (url: string, payload: Record<string, unknown>) =>
        app.inject({ method: "POST", url, payload, remoteAddress: neueAdresse(), headers: { origin: TEST_ORIGIN } });
    const post = (url: string, payload: Record<string, unknown>, cookie: string) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
    /** Eine Meldung von der Website; gibt Nummer und Schlüssel der Statusseite zurück. */
    const melde = async (patch: Record<string, unknown> = {}) => {
        const body = meldung(patch);
        const antwort = await postOeffentlich("/api/community/meldungen", body);
        expect(antwort.statusCode).toBe(201);
        return { nummer: (antwort.json() as { nummer: string }).nummer, schluessel: body.schluessel as string, body };
    };
    const revisionVon = async (nummer: string): Promise<number> =>
        (
            await database<{ revision: number }[]>`
                SELECT revision FROM avesmaps_community.vorgang WHERE id = ${Number(nummer.slice(4))}::bigint
            `
        )[0]!.revision;
    const schritt = (nummer: string, was: string, payload: Record<string, unknown>, cookie: string) =>
        post(`/api/community/vorgaenge/${nummer}/${was}`, { operationId: randomUUID(), ...payload }, cookie);
    const antworte = (schluessel: string, text = "Seite 112, zweiter Absatz.") =>
        postOeffentlich("/api/community/status/antwort", { operationId: randomUUID(), schluessel, text });
    /** Alle Zeilen der Community-Arten an die Personen dieses Tests, in der Reihenfolge ihrer Entstehung. */
    const glocke = (art?: string): Promise<Zeile[]> =>
        database<Zeile[]>`
            SELECT an_person::text, art, text, quelle, von_art, von_person::text, bezug_ops::text, gelesen_at, erstellt_at
              FROM public.benachrichtigung
             WHERE an_person = ANY(${alle}::uuid[]) AND starts_with(art, 'community_') AND (${art ?? null}::text IS NULL OR art = ${art ?? null})
             ORDER BY id
        `;
    const personen = (zeilen: readonly Zeile[]): string[] => zeilen.map((zeile) => zeile.an_person).sort();
    const lies = (cookie: string) => app.inject({ method: "GET", url: "/api/benachrichtigungen", headers: { cookie } });
    const alsGelesen = async (person: string): Promise<void> => {
        await database`UPDATE public.benachrichtigung SET gelesen_at = now() WHERE an_person = ${person}::uuid AND gelesen_at IS NULL`;
    };

    it("die Arten stehen im Katalog, und die Rollen der Bearbeitenden sind genau die ab Reviewer", () => {
        for (const art of COMMUNITY_GLOCKEN_ARTEN) expect(BENACHRICHTIGUNG_ARTEN as readonly string[]).toContain(art);
        expect(rollenMit("moderate_submissions")).toEqual(["reviewer", "editor", "admin", "operator"]);
    });

    it("🔴 neue Meldung: genau eine community_neu je bearbeitende aktive Person, mit der COM-Nummer und sonst nichts", async () => {
        const { nummer } = await melde();
        const zeilen = await glocke();
        // Reviewer, Editor, Admin, Operator je eine; nicht der Tester, nicht die gesperrte Person.
        expect(personen(zeilen)).toEqual([...bearbeitende].sort());
        for (const zeile of zeilen) {
            expect(zeile).toMatchObject({
                art: "community_neu",
                text: nummer,
                quelle: `community_neu:${nummer}`,
                von_art: "system",
                von_person: null,
                bezug_ops: null,
                gelesen_at: null,
            });
        }
    });

    it("🔴 bündelt: solange eine ungelesene da ist, entsteht keine zweite, sondern die Zahl wächst; nach dem Lesen beginnt die nächste", async () => {
        const erste = await melde();
        const zweite = await melde();
        expect((await glocke()).map((zeile) => zeile.text)).toEqual(["2", "2", "2", "2"]);
        const dritte = await melde();
        const gebuendelt = await glocke();
        expect(gebuendelt).toHaveLength(4);
        expect(gebuendelt.map((zeile) => zeile.text)).toEqual(["3", "3", "3", "3"]);
        // Die Quelle bleibt die der ersten: Sie ist der Schlüssel gegen Doppelte, nicht der Inhalt.
        expect(new Set(gebuendelt.map((zeile) => zeile.quelle))).toEqual(new Set([`community_neu:${erste.nummer}`]));
        expect([zweite.nummer, dritte.nummer]).not.toContain(erste.nummer);

        // Die Liste der Glocke zeigt eine Zeile, ungelesen 1; die Zahl steht im Text.
        const liste = await lies(lena.cookie);
        expect(liste.statusCode).toBe(200);
        expect(Value.Check(BenachrichtigungListe, liste.json())).toBe(true);
        expect(liste.json()).toMatchObject({
            ungelesen: 1,
            eintraege: [{ art: "community_neu", text: "3", ops: null }],
        });

        // Lena öffnet die Glocke (alles gelesen): Die nächste Meldung beginnt für sie eine neue, für die anderen wächst die alte.
        await alsGelesen(lena.id);
        const vierte = await melde();
        const nachLesen = await glocke();
        const lenas = nachLesen.filter((zeile) => zeile.an_person === lena.id);
        expect(lenas.map((zeile) => [zeile.text, zeile.gelesen_at === null])).toEqual([
            ["3", false],
            [vierte.nummer, true],
        ]);
        for (const zeile of nachLesen.filter((z) => z.an_person !== lena.id)) expect(zeile.text).toBe("4");
    });

    it("die Wiederholung derselben Kennung zählt nicht doppelt (der Vorgang ist schon da)", async () => {
        const body = meldung();
        for (let i = 0; i < 3; i++)
            expect((await postOeffentlich("/api/community/meldungen", body)).statusCode).toBe(201);
        const zeilen = await glocke();
        expect(zeilen).toHaveLength(4);
        for (const zeile of zeilen) expect(zeile.text).toMatch(/^COM-\d{6}$/u);
        // Eine zweite, andere Meldung macht daraus zwei, nicht vier.
        await melde();
        expect((await glocke()).map((zeile) => zeile.text)).toEqual(["2", "2", "2", "2"]);
    });

    it("🔴 die Falle (Honigtopf, Zeitfalle) legt keinen Vorgang und keine Benachrichtigung an", async () => {
        const honig = await postOeffentlich(
            "/api/community/meldungen",
            meldung({ falle: { feld: "http://spam", dauerMs: 8000 } }),
        );
        const schnell = await postOeffentlich(
            "/api/community/meldungen",
            meldung({ falle: { feld: "", dauerMs: 50 } }),
        );
        expect([honig.statusCode, schnell.statusCode]).toEqual([201, 201]);
        expect(await glocke()).toEqual([]);
        expect(await database`SELECT 1 FROM avesmaps_community.vorgang`).toHaveLength(0);
    });

    it("🔴 Zuweisung: eine ANDERE Person bekommt community_zugewiesen mit Absender und Nummer; sich selbst, dieselbe nochmals und die Wiederholung nichts", async () => {
        const { nummer } = await melde();
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;

        // Adrian setzt Lena ein.
        const operationId = randomUUID();
        const rev = await revisionVon(nummer);
        expect(
            (await schritt(nummer, "zustaendig", { operationId, baseRevision: rev, person: lena.id }, adrian.cookie))
                .statusCode,
        ).toBe(200);
        const zeilen = await glocke("community_zugewiesen");
        expect(zeilen).toHaveLength(1);
        expect(zeilen[0]).toMatchObject({
            an_person: lena.id,
            text: nummer,
            von_art: "person",
            von_person: adrian.id,
            bezug_ops: null,
            gelesen_at: null,
        });
        expect(zeilen[0]!.quelle).toBe(`community_zugewiesen:${nummer}:${operationId}`);

        // Dieselbe Handlung noch einmal (die Funktion erkennt sie am Verlauf): nichts Neues.
        await schritt(nummer, "zustaendig", { operationId, baseRevision: rev, person: lena.id }, adrian.cookie);
        // Dieselbe Person nochmals, mit neuer Kennung: war schon zuständig, also keine Änderung.
        await schritt(
            nummer,
            "zustaendig",
            { baseRevision: await revisionVon(nummer), person: lena.id },
            adrian.cookie,
        );
        // Lena übernimmt selbst (Übernehmen und „Zuständig: ich“), Adrian setzt sich selbst ein: nichts.
        await schritt(nummer, "uebernehmen", { baseRevision: await revisionVon(nummer) }, lena.cookie);
        await schritt(
            nummer,
            "zustaendig",
            { baseRevision: await revisionVon(nummer), person: adrian.id },
            adrian.cookie,
        );
        await schritt(nummer, "zustaendig", { baseRevision: await revisionVon(nummer), person: lena.id }, lena.cookie);
        expect(await glocke("community_zugewiesen")).toHaveLength(1);
        // Eine echte neue Zuweisung an eine andere Person meldet sich wieder.
        await schritt(
            nummer,
            "zustaendig",
            { baseRevision: await revisionVon(nummer), person: emil.id },
            adrian.cookie,
        );
        expect((await glocke("community_zugewiesen")).map((zeile) => zeile.an_person)).toEqual([lena.id, emil.id]);
    });

    it("🔴 Antwort des Melders: an die zuständige Person, sonst an die Bearbeitenden; solange der Eintrag zum Vorgang ungelesen ist, kein zweiter", async () => {
        const mit = await melde();
        await schritt(mit.nummer, "uebernehmen", { baseRevision: await revisionVon(mit.nummer) }, lena.cookie);
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;

        expect((await antworte(mit.schluessel)).statusCode).toBe(200);
        const erste = await glocke();
        expect(erste).toHaveLength(1);
        expect(erste[0]).toMatchObject({
            an_person: lena.id,
            art: "community_antwort",
            text: mit.nummer,
            von_art: "system",
            von_person: null,
            bezug_ops: null,
        });
        // Eine zweite Antwort, solange die erste ungelesen ist: kein zweiter Eintrag (so flutet niemand die Glocke).
        expect((await antworte(mit.schluessel, "Und die Reichsstraße verläuft nördlich.")).statusCode).toBe(200);
        expect(await glocke()).toHaveLength(1);
        // Gelesen: die nächste Antwort meldet sich wieder.
        await alsGelesen(lena.id);
        expect((await antworte(mit.schluessel, "Noch eine Ergänzung zur Lage.")).statusCode).toBe(200);
        expect(await glocke()).toHaveLength(2);

        // Ohne Zuständigkeit gehen sie an die Bearbeitenden, wie bei einer neuen Meldung.
        const ohne = await melde();
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;
        expect((await antworte(ohne.schluessel)).statusCode).toBe(200);
        const alleAntworten = await glocke("community_antwort");
        expect(personen(alleAntworten)).toEqual([...bearbeitende].sort());
        for (const zeile of alleAntworten) expect(zeile.text).toBe(ohne.nummer);
    });

    it("das Zurückziehen durch den Melder meldet nichts", async () => {
        const { schluessel } = await melde();
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;
        const antwort = await postOeffentlich("/api/community/status/zurueckziehen", {
            operationId: randomUUID(),
            schluessel,
        });
        expect(antwort.statusCode).toBe(200);
        expect(await glocke()).toEqual([]);
    });

    it("🔴 Frist: nach 30 Tagen in der Rückfrage meldet sich der Vorgang bei der zuständigen Person, genau einmal; ohne Zuständigkeit bei den Bearbeitenden", async () => {
        const zugeteilt = await melde();
        await schritt(
            zugeteilt.nummer,
            "uebernehmen",
            { baseRevision: await revisionVon(zugeteilt.nummer) },
            lena.cookie,
        );
        await schritt(
            zugeteilt.nummer,
            "rueckfrage",
            { baseRevision: await revisionVon(zugeteilt.nummer), text: "Welche Seite genau?" },
            lena.cookie,
        );
        const frei = await melde();
        await schritt(frei.nummer, "sichten", { baseRevision: await revisionVon(frei.nummer) }, lena.cookie);
        await schritt(
            frei.nummer,
            "rueckfrage",
            { baseRevision: await revisionVon(frei.nummer), text: "Welche Seite?" },
            lena.cookie,
        );
        const jung = await melde();
        await schritt(jung.nummer, "sichten", { baseRevision: await revisionVon(jung.nummer) }, lena.cookie);
        await schritt(
            jung.nummer,
            "rueckfrage",
            { baseRevision: await revisionVon(jung.nummer), text: "Und die Quelle?" },
            lena.cookie,
        );
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;
        const setze = (nummer: string, tage: number) =>
            database`UPDATE avesmaps_community.vorgang SET rueckfrage_at = now() - make_interval(days => ${tage}::int)
                      WHERE id = ${Number(nummer.slice(4))}::bigint`;

        // 29 Tage: noch nichts.
        await setze(zugeteilt.nummer, 29);
        await setze(frei.nummer, 29);
        await setze(jung.nummer, 5);
        expect(await communityFristen(database, "test")).toEqual({ faellig: 0, gemeldet: 0 });
        expect(await glocke()).toEqual([]);

        // 31 Tage: die zugeteilte an Lena, die freie an alle vier Bearbeitenden, die junge nicht.
        await setze(zugeteilt.nummer, 31);
        await setze(frei.nummer, 31);
        const erster = await communityFristen(database, "test");
        expect(erster.faellig).toBe(2);
        expect(erster.gemeldet).toBeGreaterThanOrEqual(5);
        const zeilen = await glocke("community_frist");
        expect(zeilen.filter((zeile) => zeile.text === zugeteilt.nummer).map((zeile) => zeile.an_person)).toEqual([
            lena.id,
        ]);
        expect(personen(zeilen.filter((zeile) => zeile.text === frei.nummer))).toEqual([...bearbeitende].sort());
        expect(zeilen.filter((zeile) => zeile.text === jung.nummer)).toEqual([]);
        for (const zeile of zeilen)
            expect(zeile).toMatchObject({ von_art: "system", von_person: null, bezug_ops: null });

        // Jeder weitere Lauf meldet nichts mehr (feste Quelle je Rückfrage), auch wenn die Person schon gelesen hat.
        await alsGelesen(lena.id);
        expect(await communityFristen(database, "test")).toEqual({ faellig: 2, gemeldet: 0 });
        expect(await glocke("community_frist")).toHaveLength(5);

        // Ein abgeschlossener Vorgang erinnert nicht mehr.
        await database`UPDATE avesmaps_community.vorgang SET zustand = 'abgeschlossen', ergebnis = 'bereits_richtig', abgeschlossen_at = now(), rueckfrage_at = NULL
                        WHERE id = ${Number(frei.nummer.slice(4))}::bigint`;
        expect((await communityFristen(database, "test")).faellig).toBe(1);
    });

    it("🔴 kein Meldetext und kein Name des Melders in irgendeinem text: nur COM-Nummer oder Zahl; die Liste der Glocke trägt ebenso nichts davon", async () => {
        const a = await melde();
        const b = await melde();
        await schritt(
            a.nummer,
            "zustaendig",
            { baseRevision: await revisionVon(a.nummer), person: lena.id },
            adrian.cookie,
        );
        await antworte(a.schluessel, "Hier steht ein ganz eigener Satz des Melders zur Lage.");
        await schritt(b.nummer, "sichten", { baseRevision: await revisionVon(b.nummer) }, lena.cookie);
        await schritt(
            b.nummer,
            "rueckfrage",
            { baseRevision: await revisionVon(b.nummer), text: "Noch ein eigener Satz der Redaktion." },
            lena.cookie,
        );
        await database`UPDATE avesmaps_community.vorgang SET rueckfrage_at = now() - interval '40 days' WHERE id = ${Number(b.nummer.slice(4))}::bigint`;
        await communityFristen(database, "test");

        const zeilen = await glocke();
        // Die Arten `community_nachricht` (eine neue Anfrage, WI-0268 C4) und `community_mail_fehler` (eine Mail, die nicht zugestellt wurde, C6a) kommen nur mit Mails vor und haben ihren Fall in
        // `community-mails.test.ts` bzw. `community-mail-versand.test.ts`; `community_rolle` (WI-0279) trägt Rolle und Nummern und hat ihren Fall in `community-rollen.test.ts`.
        expect(new Set(zeilen.map((zeile) => zeile.art))).toEqual(
            new Set(
                COMMUNITY_GLOCKEN_ARTEN.filter(
                    (art) =>
                        art !== "community_nachricht" && art !== "community_mail_fehler" && art !== "community_rolle",
                ),
            ),
        );
        for (const zeile of zeilen) {
            expect(zeile.text, zeile.art).toMatch(/^(COM-\d{6}|\d{1,6})$/u);
            for (const feld of [zeile.text, zeile.quelle]) {
                expect(feld ?? "").not.toContain(MELDER);
                expect(feld ?? "").not.toContain("Wehrheim");
                expect(feld ?? "").not.toContain("Satz");
            }
        }
        const liste = (await lies(lena.cookie)).json() as {
            eintraege: { text: string | null; von: { name: string | null } }[];
        };
        expect(liste.eintraege.length).toBeGreaterThan(0);
        for (const eintrag of liste.eintraege) expect(JSON.stringify(eintrag)).not.toContain(MELDER);
    });
});
