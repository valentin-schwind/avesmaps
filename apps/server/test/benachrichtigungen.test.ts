import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BenachrichtigungListe, type Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { aenderung, eintragen, nachweis, status, wiederherstellungBeantragen } from "../src/kanal/db.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Benachrichtigungen gegen echtes PostgreSQL (WI-0136 N2 und N3, NACHRICHT-0001 §3 und §4).
 *
 * - 🔴 Der Kanal als Absender, in derselben Transaktion: Rückfrage und Antwort an die meldende Person, „übernommen“ an sie, „Fix ist live“
 *   an sie mit „Gelöst?“ und an die übrigen Betreiber zur Info, „zur Abnahme“ ohne Fix und ein Wiederherstellungsantrag an alle Betreiber.
 *   Ein Admin bekommt nichts; dieselbe Ursache nie zweimal.
 * - 🔴 Jede Person sieht nur die eigenen; „gelesen“ nur an den eigenen; ETag, sonst 304.
 * - 🔴 „Gelöst“ nimmt ab, „Noch nicht gelöst“ öffnet mit Kommentar wieder (W2); nur die Empfängerin der Frage; danach sehen die anderen den
 *   Stand („abgenommen von …“).
 * - Aufbewahrung und Kontoauflösung löschen über ihre Funktionen.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const SHA = "b7e2d41c9a3f5e08d2a6b7c44f09e3d1a5c8b621";

describeWithDatabase("Benachrichtigungen (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let rondrikan: { id: string; cookie: string };
    let thomas: { id: string; cookie: string };
    let admin: { id: string; cookie: string };

    async function leeren(): Promise<void> {
        await database`DELETE FROM public.benachrichtigung WHERE environment = 'test'`;
        await database`DELETE FROM avesmaps_kanal.nachweis`;
        await database`DELETE FROM avesmaps_kanal.beobachtung`;
        await database`DELETE FROM avesmaps_kanal.aenderung`;
        await database`DELETE FROM avesmaps_kanal.bild`;
        await database`DELETE FROM avesmaps_kanal.eintrag`;
        await database`UPDATE avesmaps_kanal.vorgang SET folgt_auf = NULL`;
        await database`DELETE FROM avesmaps_kanal.vorgang`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        app = buildApp({
            config: {
                port: 0,
                host: "127.0.0.1",
                releaseId: "n2-test",
                databaseUrl: undefined,
                tileRoot: undefined,
                statusPage: true,
                auth: TEST_AUTH,
            },
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { ...created, cookie };
        };
        rondrikan = await person("operator", "Rondrikan");
        thomas = await person("operator", "Thomas");
        admin = await person("admin", "Admina");
    });

    beforeEach(leeren);

    afterAll(async () => {
        await app?.close();
        await leeren().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const get = (cookie: string, etag?: string) =>
        app.inject({
            method: "GET",
            url: "/api/benachrichtigungen",
            headers: { cookie, ...(etag === undefined ? {} : { "if-none-match": etag }) },
        });
    const liste = async (cookie: string): Promise<BenachrichtigungListe> => {
        const antwort = await get(cookie);
        expect(antwort.statusCode).toBe(200);
        const body = antwort.json() as BenachrichtigungListe;
        expect(Value.Check(BenachrichtigungListe, body)).toBe(true);
        return body;
    };
    const post = (url: string, payload: Record<string, unknown>, cookie: string) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const melde = async (): Promise<{ ops: string; id: number }> => {
        const antwort = await post(
            "/api/kanal/vorgaenge",
            {
                operationId: randomUUID(),
                kategorie: "bug",
                prioritaet: "hoch",
                titel: "See-321 wird sichtbar",
                nachricht: "Im Infopanel steht See-321.",
            },
            rondrikan.cookie,
        );
        expect(code(antwort)).toBe("200");
        const ops = (antwort.json() as { affected: { id: string }[] }).affected[0]!.id;
        return { ops, id: Number(ops.slice(4)) };
    };
    const zurAbnahmeMitFix = async (id: number): Promise<void> => {
        await status(database, id, "in_arbeit", { als: "claudio" });
        await aenderung(
            database,
            { vorgang: id, klasse: "A", art: "code", was: "Infopanel ohne Titel", commit: SHA },
            { als: "claudio" },
        );
        await nachweis(database, id, "fix_committed", { commit: SHA, als: "claudio" });
        await nachweis(database, id, "auf_stage", { release: "r1", als: "claudio" });
        await status(database, id, "auf_stage", { als: "claudio" });
        await status(database, id, "zur_abnahme", { als: "claudio", kurztitel: "Platzhaltername im Infopanel" });
    };
    const arten = (l: BenachrichtigungListe) => l.eintraege.map((e) => [e.art, e.ops, e.frageGeloest]);

    it("🔴 Rückfrage und „übernommen“ gehen an die meldende Person, sonst an niemanden; ein Admin bekommt nie etwas", async () => {
        const { ops, id } = await melde();
        await status(database, id, "in_arbeit", { als: "claudio" });
        await eintragen(database, id, "rueckfrage", "Welches Telefon?", { als: "claudio" });
        await status(database, id, "bei_claudia", { als: "claudio", text: "zu groß für einen kleinen Fix" });
        expect(arten(await liste(rondrikan.cookie))).toEqual([
            ["kanal_uebernommen", ops, false],
            ["kanal_rueckfrage", ops, false],
        ]);
        const eintraege = (await liste(rondrikan.cookie)).eintraege;
        // Kein Meldungstext in der Benachrichtigung; der Absender ist der Agent.
        expect(eintraege.map((e) => [e.von.art, e.text])).toEqual([
            ["claudio", null],
            ["claudio", null],
        ]);
        expect((await liste(thomas.cookie)).eintraege).toEqual([]);
        expect((await liste(admin.cookie)).eintraege).toEqual([]);
    });

    it("🔴 „Fix ist live“: die meldende Person mit „Gelöst?“, die übrigen Betreiber zur Info, mit Kurztitel; ohne Fix „zur Abnahme“ an alle", async () => {
        const { ops, id } = await melde();
        await zurAbnahmeMitFix(id);
        const meine = await liste(rondrikan.cookie);
        expect(arten(meine)).toEqual([["kanal_fix_live", ops, true]]);
        expect(meine.eintraege[0]).toMatchObject({
            text: "Platzhaltername im Infopanel",
            vorgang: { status: "zur_abnahme" },
        });
        expect(arten(await liste(thomas.cookie))).toEqual([["kanal_fix_live", ops, false]]);
        expect((await liste(admin.cookie)).eintraege).toEqual([]);

        const zweiter = await melde();
        await status(database, zweiter.id, "in_arbeit", { als: "claudio" });
        await status(database, zweiter.id, "beantwortet", { als: "claudio", text: "So ist es gedacht." });
        await status(database, zweiter.id, "zur_abnahme", { als: "claudio", kurztitel: "Frage zur Anzeige" });
        expect(arten(await liste(thomas.cookie))[0]).toEqual(["kanal_zur_abnahme", zweiter.ops, false]);
        expect(arten(await liste(rondrikan.cookie))[0]).toEqual(["kanal_zur_abnahme", zweiter.ops, false]);
    });

    it("ein Wiederherstellungsantrag geht an alle Betreiber, mit der beantragenden Person als Absenderin", async () => {
        const id = await wiederherstellungBeantragen(database, {
            environment: "test",
            person: rondrikan.id,
            sicherung: "aelter",
            umfang: "datenbank",
            grund: "Stand von gestern",
        });
        for (const cookie of [rondrikan.cookie, thomas.cookie]) {
            const [eintrag] = (await liste(cookie)).eintraege;
            expect(eintrag).toMatchObject({
                art: "kanal_wiederherstellung",
                ops: `OPS-${String(id).padStart(6, "0")}`,
            });
            expect(eintrag!.von).toEqual({ art: "person", id: rondrikan.id, name: "Rondrikan" });
        }
        expect((await liste(admin.cookie)).eintraege).toEqual([]);
    });

    it("🔴 nur die eigenen; „gelesen“ zählt herunter; ETag, sonst 304; ohne Anmeldung 401", async () => {
        const { id } = await melde();
        await status(database, id, "in_arbeit", { als: "claudio" });
        await eintragen(database, id, "rueckfrage", "Welches Telefon?", { als: "claudio" });
        await eintragen(database, id, "antwort", "Danke, ist notiert.", { als: "claudio" });
        const vorher = await get(rondrikan.cookie);
        const etag = vorher.headers["etag"] as string;
        expect((vorher.json() as BenachrichtigungListe).ungelesen).toBe(2);
        expect((await get(rondrikan.cookie, etag)).statusCode).toBe(304);
        const [neueste, aeltere] = (vorher.json() as BenachrichtigungListe).eintraege;
        // Thomas markiert nichts an fremden Zeilen.
        expect(code(await post("/api/benachrichtigungen/gelesen", { bis: neueste!.id }, thomas.cookie))).toBe("200");
        expect((await liste(rondrikan.cookie)).ungelesen).toBe(2);
        const gelesen = await post("/api/benachrichtigungen/gelesen", { bis: aeltere!.id }, rondrikan.cookie);
        expect(gelesen.json()).toEqual({ ungelesen: 1 });
        expect((await get(rondrikan.cookie, etag)).statusCode).toBe(200);
        expect((await app.inject({ method: "GET", url: "/api/benachrichtigungen" })).statusCode).toBe(401);
    });

    it("🔴 „Gelöst“ nimmt ab, nur die Empfängerin der Frage; danach zeigen alle den Stand; zweimal geht nicht", async () => {
        const { id } = await melde();
        await zurAbnahmeMitFix(id);
        const [frage] = (await liste(rondrikan.cookie)).eintraege;
        const [info] = (await liste(thomas.cookie)).eintraege;
        const url = (n: number) => `/api/benachrichtigungen/${String(n)}/antwort`;
        expect(code(await post(url(frage!.id), { operationId: randomUUID(), antwort: "geloest" }, thomas.cookie))).toBe(
            "404 not_found",
        );
        expect(code(await post(url(info!.id), { operationId: randomUUID(), antwort: "geloest" }, thomas.cookie))).toBe(
            "409 benachrichtigung_ohne_frage",
        );
        expect(code(await post(url(frage!.id), { operationId: randomUUID(), antwort: "geloest" }, admin.cookie))).toBe(
            "403 forbidden",
        );
        expect(
            code(await post(url(frage!.id), { operationId: randomUUID(), antwort: "geloest" }, rondrikan.cookie)),
        ).toBe("200");
        const [vorgang] = await database<
            { status: string }[]
        >`SELECT status FROM avesmaps_kanal.vorgang WHERE id = ${id}`;
        expect(vorgang!.status).toBe("abgenommen");
        expect((await liste(rondrikan.cookie)).eintraege[0]).toMatchObject({
            antwort: "geloest",
            vorgang: { status: "abgenommen" },
        });
        expect((await liste(thomas.cookie)).eintraege[0]!.vorgang).toMatchObject({
            status: "abgenommen",
            abgenommenVon: "Rondrikan",
        });
        expect(
            code(await post(url(frage!.id), { operationId: randomUUID(), antwort: "geloest" }, rondrikan.cookie)),
        ).toBe("409 benachrichtigung_beantwortet");
    });

    it("„Noch nicht gelöst“ braucht einen Kommentar und öffnet in Runde 2; nach einer Abnahme im Kanal 409", async () => {
        const { id } = await melde();
        await zurAbnahmeMitFix(id);
        const [frage] = (await liste(rondrikan.cookie)).eintraege;
        const url = `/api/benachrichtigungen/${String(frage!.id)}/antwort`;
        expect(
            (await post(url, { operationId: randomUUID(), antwort: "nicht_geloest" }, rondrikan.cookie)).statusCode,
        ).toBe(400);
        expect(
            code(
                await post(
                    url,
                    { operationId: randomUUID(), antwort: "nicht_geloest", kommentar: "Am Telefon noch da." },
                    rondrikan.cookie,
                ),
            ),
        ).toBe("200");
        const [vorgang] = await database<{ status: string; runde: number }[]>`
            SELECT status, runde FROM avesmaps_kanal.vorgang WHERE id = ${id}
        `;
        expect(vorgang).toEqual({ status: "in_arbeit", runde: 2 });

        // Nimmt jemand im Kanal ab, bevor die meldende Person antwortet: 409, die Benachrichtigung zeigt den Stand.
        const zweiter = await melde();
        await zurAbnahmeMitFix(zweiter.id);
        const [neue] = (await liste(rondrikan.cookie)).eintraege;
        const [stand] = await database<
            { revision: number }[]
        >`SELECT revision FROM avesmaps_kanal.vorgang WHERE id = ${zweiter.id}`;
        const revision = stand!.revision;
        expect(
            code(
                await post(
                    `/api/kanal/vorgaenge/${zweiter.ops}/abnehmen`,
                    { operationId: randomUUID(), baseRevision: revision },
                    thomas.cookie,
                ),
            ),
        ).toBe("200");
        expect(
            (
                await post(
                    `/api/benachrichtigungen/${String(neue!.id)}/antwort`,
                    { operationId: randomUUID(), antwort: "geloest" },
                    rondrikan.cookie,
                )
            ).statusCode,
        ).toBe(409);
        expect((await liste(rondrikan.cookie)).eintraege[0]!.vorgang).toMatchObject({
            status: "abgenommen",
            abgenommenVon: "Thomas",
        });
    });

    it("Aufbewahrung und Kontoauflösung löschen über ihre Funktionen", async () => {
        const { id } = await melde();
        await status(database, id, "in_arbeit", { als: "claudio" });
        await eintragen(database, id, "rueckfrage", "Welches Telefon?", { als: "claudio" });
        await eintragen(database, id, "antwort", "Danke.", { als: "claudio" });
        await database`
            UPDATE public.benachrichtigung SET gelesen_at = now() - interval '91 days'
             WHERE an_person = ${rondrikan.id} AND art = 'kanal_rueckfrage'
        `;
        const [purge] = await database<{ n: number }[]>`SELECT public.benachrichtigung_purge_expired() AS n`;
        expect(purge!.n).toBe(1);
        expect(arten(await liste(rondrikan.cookie)).map(([art]) => art)).toEqual(["kanal_antwort"]);
        const [aufgeloest] = await database<
            { r: number }[]
        >`SELECT public.redact_person_benachrichtigung(${rondrikan.id}) AS r`;
        expect(aufgeloest!.r).toBe(1);
        expect((await liste(rondrikan.cookie)).eintraege).toEqual([]);
    });

    /**
     * Neue Stände (Migration 0118, Claudio 2026-10-13): `stage_neu` nach einem grünen automatischen Stage-Rollout, `production_neu`
     * nach einer Freigabe. Beide trägt Claudios Korridor ein, deshalb hier direkt über die Funktion.
     */
    it("🔴 das Ziel „alle“ erreicht jede Person mit Zugang zu dieser Umgebung, nicht nur eine Rolle", async () => {
        const [n] = await database<{ n: number }[]>`
            SELECT public.benachrichtige(
                'test', '{"alle": true}'::jsonb, 'claudio', NULL, 'production_neu', NULL,
                'Orte zeigen jetzt ein passendes Titelbild.', 'production:20261013T120000Z-abc1234'
            ) AS n
        `;
        // Die Testdatenbank trägt die Personen früherer Läufe; geprüft wird die Regel, nicht ihr Füllstand: mindestens unsere drei,
        // und keine Rolle bleibt außen vor (der Admin bekam vorher nur, was an seine Rolle ging).
        expect(n!.n).toBeGreaterThanOrEqual(3);
        for (const wer of [rondrikan, thomas, admin]) {
            const eintraege = (await liste(wer.cookie)).eintraege;
            expect(eintraege.map((e) => e.art)).toEqual(["production_neu"]);
            expect(eintraege[0]!.text).toBe("Orte zeigen jetzt ein passendes Titelbild.");
            expect(eintraege[0]!.ops).toBeNull();
        }
    });

    it("🔴 dieselbe Quelle legt nichts doppelt an — ein zweiter Lauf desselben Stands bleibt folgenlos", async () => {
        const melde = async () =>
            (
                await database<{ n: number }[]>`
                    SELECT public.benachrichtige(
                        'test', '{"alle": true}'::jsonb, 'claudio', NULL, 'stage_neu', NULL, 'Neu auf der Stage: Ortseditor',
                        'stage:e2f28dd'
                    ) AS n
                `
            )[0]!.n;
        const erster = await melde();
        expect(erster).toBeGreaterThanOrEqual(3);
        expect(await melde()).toBe(0);
        expect((await liste(rondrikan.cookie)).eintraege).toHaveLength(1);
    });

    it("🔴 `an` ohne Ziel wird abgelehnt; die Art prüft seit 0118 der Katalog, nicht die Datenbank", async () => {
        await expect(
            database`SELECT public.benachrichtige('test', '{}'::jsonb, 'claudio', NULL, 'stage_neu', NULL, 'x', 'q:2')`,
        ).rejects.toThrow();
        // Kein CHECK mehr auf `art` (0118, wie bei den Jobarten): Die Datenbank nimmt auch einen unbekannten Namen an. Die Wahrheit ist
        // `BENACHRICHTIGUNG_ARTEN`; die Oberfläche zeigt für alles andere den unbekannten Satz, statt zu brechen.
        const [erfunden] = await database<{ n: number }[]>`
            SELECT public.benachrichtige('test', '{"rolle": "admin"}'::jsonb, 'claudio', NULL, 'erfunden', NULL, 'x', 'q:1') AS n
        `;
        expect(erfunden!.n).toBeGreaterThanOrEqual(1);
    });

    /**
     * WI-0181: Ein älteres Release liest eine Art, die erst ein neueres schreibt (Blue/Green-Wechsel, Rücksprung der Stage,
     * Production vor der Freigabe). 0118 verspricht dafür den unbekannten Satz der Oberfläche; vorher warf das Antwortschema 500.
     */
    it("🔴 eine Art, die dieses Release nicht kennt, kommt mit 200 an, zählt als ungelesen und lässt sich als gelesen markieren", async () => {
        const melde = (art: string, quelle: string) => database`
            SELECT public.benachrichtige(
                'test', jsonb_build_object('person', ${rondrikan.id}::text), 'claudio', NULL, ${art}, NULL, 'Befund', ${quelle}
            )
        `;
        await melde("stage_neu", "wi-0181:bekannt");
        await melde("erst_im_naechsten_release", "wi-0181:unbekannt");
        const body = await liste(rondrikan.cookie);
        expect(body.ungelesen).toBe(2);
        expect(body.eintraege.map((e) => [e.art, e.text, e.von.art])).toEqual([
            ["erst_im_naechsten_release", "Befund", "claudio"],
            ["stage_neu", "Befund", "claudio"],
        ]);
        const gelesen = await post("/api/benachrichtigungen/gelesen", { bis: body.eintraege[0]!.id }, rondrikan.cookie);
        expect(gelesen.json()).toEqual({ ungelesen: 0 });
    });
});
