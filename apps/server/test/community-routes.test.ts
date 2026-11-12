import { randomBytes, randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    COMMUNITY_GRENZEN,
    CommunityStand,
    MeldungAntwort,
    StatusSicht,
    VorgangDetail,
    VorgangListe,
    VorgangQuittung,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Routen des Community-Moduls (WI-0268, Fachkonzept WI-0263) gegen echtes PostgreSQL. Die Regeln der Übergänge prüft
 * `community-datenmodell.test.ts`; hier zählt, was die Leitung davon macht.
 *
 * - Öffentlich: Meldung (201 mit COM-Nummer), 🔴 Honigtopf und Zeitfalle legen NICHTS an, Drossel 429 `community_rate`, Statusseite mit Schlüssel
 *   (falscher und abgelaufener Schlüssel geben denselben 404-Satz), Antwort und Zurückziehen, fremde Herkunft 403.
 * - Redaktion: Liste und Detail nur mit `moderate_submissions` (Tester 403, ohne Anmeldung 401), veraltete Revision 409, Papierkorb und Personenbezug
 *   nur mit `moderate_community` (der Personenbezug zusätzlich mit frischem Passkey); andere zuständig setzen darf seit WI-0279 jeder, der Meldungen bearbeitet.
 * - Protokoll: Abschließen, Wiedereröffnen, Papierkorb und Personenbezug schreiben genau einen Eintrag (nur COM-Nummer und Ergebnis); eine Wiederholung
 *   derselben Kennung schreibt keinen zweiten.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const ORT = "11111111-2222-4333-8444-555555555555";
const STATUS_FEHLT = "Zu diesem Link gibt es keine Meldung (mehr).";

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "community-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Community: Routen (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let tester: { id: string; cookie: string };
    let lena: { id: string; cookie: string };
    let admin: { id: string; cookie: string };
    let adminFrisch: { id: string; cookie: string };
    let adminOhneFaktor: { id: string; cookie: string };
    /** Jede Gruppe von Anfragen kommt von einer eigenen Adresse, damit die Drossel (5 je Stunde) nicht über Tests hinweg zählt. */
    let adresse = 10;
    const neueAdresse = (): string => `10.20.0.${String(adresse++)}`;

    async function leeren(): Promise<void> {
        await database`DELETE FROM avesmaps_community.vorgang`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE action LIKE 'system.community_%'`;
    }

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
        const person = async (
            role: Role,
            name: string,
            optionen: { assurance?: "strong" | "basic"; passkeyMinutesAgo?: number | null } = {},
        ) => {
            const created = await fixture.person(role, { name });
            const assurance = optionen.assurance ?? "strong";
            const { cookie } = await fixture.session(created.id, {
                assurance,
                passkeyMinutesAgo: assurance === "strong" ? (optionen.passkeyMinutesAgo ?? 60) : null,
            });
            return { id: created.id, cookie };
        };
        tester = await person("tester", "Tessa");
        lena = await person("reviewer", "Lena");
        admin = await person("admin", "Adrian");
        adminFrisch = await person("admin", "Frida", { passkeyMinutesAgo: 1 });
        adminOhneFaktor = await person("admin", "Ohne Faktor", { assurance: "basic" });
    });

    beforeEach(leeren);

    afterAll(async () => {
        await app?.close();
        await leeren().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const meldung = (patch: Record<string, unknown> = {}) => ({
        operationId: randomUUID(),
        schluessel: randomBytes(32).toString("base64url"),
        kategorie: "lage",
        text: "Wehrheim liegt zu weit im Westen, laut Regionalband näher an der Reichsstraße.",
        quelle: "Herz des Reiches, S. 112",
        name: "Alrike",
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
    const anzahl = async (): Promise<number> =>
        (await database<{ n: number }[]>`SELECT count(*)::int AS n FROM avesmaps_community.vorgang`)[0]!.n;
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
    /** Legt eine Meldung an und gibt Nummer, Schlüssel und Id zurück. */
    const melde = async (patch: Record<string, unknown> = {}) => {
        const body = meldung(patch);
        const antwort = await postOeffentlich("/api/community/meldungen", body);
        expect(code(antwort)).toBe("201");
        const nummer = (antwort.json() as { nummer: string }).nummer;
        return { nummer, schluessel: body.schluessel as string, id: Number(nummer.slice(4)) };
    };
    const detail = async (nummer: string, cookie = lena.cookie): Promise<VorgangDetail> => {
        const antwort = await get(`/api/community/vorgaenge/${nummer}`, cookie);
        expect(code(antwort)).toBe("200");
        const body = antwort.json() as VorgangDetail;
        expect(Value.Check(VorgangDetail, body)).toBe(true);
        return body;
    };
    const revisionVon = async (nummer: string): Promise<number> => (await detail(nummer)).zeile.revision;
    const schritt = (nummer: string, was: string, payload: Record<string, unknown>, cookie = lena.cookie) =>
        post(`/api/community/vorgaenge/${nummer}/${was}`, { operationId: randomUUID(), ...payload }, cookie);
    const protokoll = async (action: string) =>
        database<{ target_ref: string | null; details: Record<string, unknown>; actor_person_id: string | null }[]>`
            SELECT target_ref, details, actor_person_id FROM avesmaps_auth.security_event WHERE action = ${action} ORDER BY id
        `;

    it("stand: das Formular geht, wenn Schema und Rechte da sind (ohne Anmeldung, no-store)", async () => {
        // Ohne die Angaben des Mailwegs in der Umgebung ist er aus (WI-0268 C6a); eine lokale `.env` darf den Fall nicht kippen.
        const angaben = Object.keys(process.env).filter((name) => name.startsWith("COMMUNITY_MAIL_"));
        const gesichert = angaben.map((name) => [name, process.env[name]] as const);
        for (const name of angaben) delete process.env[name];
        try {
            const antwort = await get("/api/community/stand");
            expect(code(antwort)).toBe("200");
            expect(Value.Check(CommunityStand, antwort.json())).toBe(true);
            expect(antwort.json()).toEqual({ meldungen: true, mailweg: false, discord: true });
            expect(antwort.headers["cache-control"]).toBe("no-store");
        } finally {
            for (const [name, wert] of gesichert) if (wert !== undefined) process.env[name] = wert;
        }
    });

    it("🔴 Meldung abgeben: 201 mit COM-Nummer, Vorgang und Melder in der Datenbank; derselbe Aufruf noch einmal legt nichts zweites an", async () => {
        const body = meldung();
        const antwort = await postOeffentlich("/api/community/meldungen", body);
        expect(code(antwort)).toBe("201");
        expect(Value.Check(MeldungAntwort, antwort.json())).toBe(true);
        const { nummer } = antwort.json() as { nummer: string };
        expect(nummer).toMatch(/^COM-\d{6}$/u);
        expect(antwort.headers["cache-control"]).toBe("no-store");
        expect(await anzahl()).toBe(1);
        const d = await detail(nummer);
        expect(d.zeile).toMatchObject({ art: "meldung", kategorie: "lage", zustand: "neu", bezugName: "Wehrheim" });
        expect(d.melder).toEqual({ name: "Alrike", rueckwege: ["statusseite"], entfernt: false });
        // Dieselbe Kennung: dieselbe Nummer, kein zweiter Vorgang.
        const nochmal = await postOeffentlich("/api/community/meldungen", body);
        expect((nochmal.json() as { nummer: string }).nummer).toBe(nummer);
        expect(await anzahl()).toBe(1);
        // Ungültig: zu kurzer Text (Schema), unbekannte Kategorie.
        expect(code(await postOeffentlich("/api/community/meldungen", meldung({ text: "kurz" })))).toBe(
            "400 validation_failed",
        );
        expect(code(await postOeffentlich("/api/community/meldungen", meldung({ kategorie: "unfug" })))).toBe(
            "400 validation_failed",
        );
    });

    it("🔴 nur von der eigenen Seite: ohne Origin und mit fremdem Origin 403, es entsteht nichts", async () => {
        const url = "/api/community/meldungen";
        const ohne = await app.inject({ method: "POST", url, payload: meldung(), remoteAddress: neueAdresse() });
        expect(code(ohne)).toBe("403 forbidden_origin");
        const fremd = await app.inject({
            method: "POST",
            url,
            payload: meldung(),
            remoteAddress: neueAdresse(),
            headers: { origin: "https://boese.example" },
        });
        expect(code(fremd)).toBe("403 forbidden_origin");
        expect(await anzahl()).toBe(0);
    });

    it("🔴 Honigtopf und Zeitfalle verwerfen still: 201 mit plausibler Nummer, aber KEIN Vorgang", async () => {
        const honigtopf = await postOeffentlich(
            "/api/community/meldungen",
            meldung({ falle: { feld: "http://spam.example", dauerMs: 9000 } }),
        );
        expect(code(honigtopf)).toBe("201");
        expect((honigtopf.json() as { nummer: string }).nummer).toMatch(/^COM-\d{6}$/u);
        const zuSchnell = await postOeffentlich(
            "/api/community/meldungen",
            meldung({ falle: { feld: "", dauerMs: COMMUNITY_GRENZEN.mindestDauerMs - 1 } }),
        );
        expect(code(zuSchnell)).toBe("201");
        expect((zuSchnell.json() as { nummer: string }).nummer).toMatch(/^COM-\d{6}$/u);
        expect(await anzahl()).toBe(0);
        // Gegenprobe: genau an der Grenze ist es ein Mensch.
        const gerade = await postOeffentlich(
            "/api/community/meldungen",
            meldung({ falle: { feld: "", dauerMs: COMMUNITY_GRENZEN.mindestDauerMs } }),
        );
        expect(code(gerade)).toBe("201");
        expect(await anzahl()).toBe(1);
    });

    it("🔴 Drossel je Adresse und Stunde: die sechste Meldung 429 `community_rate`, eine andere Adresse bleibt frei", async () => {
        const ip = neueAdresse();
        for (let n = 0; n < COMMUNITY_GRENZEN.jeAdresseJeStunde; n += 1) {
            expect(code(await postOeffentlich("/api/community/meldungen", meldung(), ip))).toBe("201");
        }
        const zuViele = await postOeffentlich("/api/community/meldungen", meldung(), ip);
        expect(code(zuViele)).toBe("429 community_rate");
        expect(zuViele.headers["retry-after"]).toBeDefined();
        expect(await anzahl()).toBe(COMMUNITY_GRENZEN.jeAdresseJeStunde);
        expect(code(await postOeffentlich("/api/community/meldungen", meldung(), neueAdresse()))).toBe("201");
    });

    it("🔴 Statusseite: mit dem Schlüssel 200, mit einem falschen 404 im selben Satz; Notizen und Namen der Redaktion stehen nie darin", async () => {
        const { nummer, schluessel } = await melde();
        const antwort = await postOeffentlich("/api/community/status", { schluessel });
        expect(code(antwort)).toBe("200");
        const sicht = antwort.json() as StatusSicht;
        expect(Value.Check(StatusSicht, sicht)).toBe(true);
        expect(sicht).toMatchObject({ nummer, zustand: "neu", ergebnis: null, bezugName: "Wehrheim" });
        expect(sicht.nachrichten).toHaveLength(1);
        expect(antwort.headers["cache-control"]).toBe("no-store");

        // Eine interne Notiz und eine Rückfrage: die Notiz bleibt innen, die Rückfrage geht hinaus (ohne Namen).
        expect(code(await schritt(nummer, "notiz", { text: "Intern: Quelle prüfen, klingt nach Ulisses." }))).toBe(
            "200",
        );
        const rev = await revisionVon(nummer);
        expect(code(await schritt(nummer, "rueckfrage", { baseRevision: rev, text: "Welche Seite genau?" }))).toBe(
            "200",
        );
        const danach = await postOeffentlich("/api/community/status", { schluessel });
        const text = JSON.stringify(danach.json());
        expect(text).not.toContain("Intern: Quelle prüfen");
        expect(text).not.toContain("Lena");
        expect(text).toContain("Welche Seite genau?");

        const falsch = await postOeffentlich("/api/community/status", {
            schluessel: randomBytes(32).toString("base64url"),
        });
        expect(code(falsch)).toBe("404 community_not_found");
        expect((falsch.json() as { error: { message: string } }).error.message).toBe(STATUS_FEHLT);
        // Ein Schlüssel, der nicht einmal die Form hat, ist ein Fehler der Anfrage, kein Hinweis auf den Vorgang.
        expect(code(await postOeffentlich("/api/community/status", { schluessel: "zu-kurz" }))).toBe(
            "400 validation_failed",
        );
    });

    it("🔴 Antwort des Melders: aus der Rückfrage zurück in Arbeit; Zurückziehen schließt, danach nichts mehr; ein falscher Schlüssel sagt dasselbe wie ein unbekannter", async () => {
        const { nummer, schluessel } = await melde();
        await schritt(nummer, "sichten", { baseRevision: await revisionVon(nummer) });
        await schritt(nummer, "rueckfrage", { baseRevision: await revisionVon(nummer), text: "Welche Seite genau?" });
        expect((await detail(nummer)).zeile.zustand).toBe("rueckfrage");

        const antwort = await postOeffentlich("/api/community/status/antwort", {
            operationId: randomUUID(),
            schluessel,
            text: "Seite 112, zweiter Absatz.",
        });
        expect(code(antwort)).toBe("200");
        expect(Value.Check(VorgangQuittung, antwort.json())).toBe(true);
        expect((antwort.json() as { nummer: string }).nummer).toBe(nummer);
        expect((await detail(nummer)).zeile.zustand).toBe("in_arbeit");

        const unbekannt = await postOeffentlich("/api/community/status/antwort", {
            operationId: randomUUID(),
            schluessel: randomBytes(32).toString("base64url"),
            text: "Hallo?",
        });
        expect(code(unbekannt)).toBe("404 community_not_found");
        expect((unbekannt.json() as { error: { message: string } }).error.message).toBe(STATUS_FEHLT);

        const zurueck = await postOeffentlich("/api/community/status/zurueckziehen", {
            operationId: randomUUID(),
            schluessel,
        });
        expect(code(zurueck)).toBe("200");
        const zeile = (await detail(nummer)).zeile;
        expect(zeile).toMatchObject({ zustand: "abgeschlossen", ergebnis: "zurueckgezogen" });
        const nochmal = await postOeffentlich("/api/community/status/zurueckziehen", {
            operationId: randomUUID(),
            schluessel,
        });
        expect(code(nochmal)).toBe("409 community_transition");
    });

    it("🔴 Liste und Detail nur mit `moderate_submissions`: Tester 403, ohne Anmeldung 401; die Liste trägt Zähler", async () => {
        const { nummer } = await melde();
        expect(code(await get("/api/community/vorgaenge", tester.cookie))).toBe("403 forbidden");
        expect(code(await get(`/api/community/vorgaenge/${nummer}`, tester.cookie))).toBe("403 forbidden");
        expect(code(await get("/api/community/personen", tester.cookie))).toBe("403 forbidden");
        expect((await get("/api/community/vorgaenge")).statusCode).toBe(401);

        const antwort = await get("/api/community/vorgaenge", lena.cookie);
        expect(code(antwort)).toBe("200");
        const liste = antwort.json() as VorgangListe;
        expect(Value.Check(VorgangListe, liste)).toBe(true);
        expect(liste.zeilen.map((zeile) => zeile.nummer)).toEqual([nummer]);
        expect(liste.zaehler).toMatchObject({ offen: 1, neu: 1, meine: 1, erledigt: 0, papierkorb: 0 });
        expect(antwort.headers["cache-control"]).toBe("no-store");

        // Die Suche läuft über die Nummer und über die Texte; Vorgabe ist die Art „meldung“.
        expect(
            ((await get(`/api/community/vorgaenge?q=${nummer}`, lena.cookie)).json() as VorgangListe).zeilen,
        ).toHaveLength(1);
        expect(
            ((await get("/api/community/vorgaenge?q=Zwergenstadt", lena.cookie)).json() as VorgangListe).zeilen,
        ).toHaveLength(0);
        // Anfragen liest nur, wer `read_mailbox` hat (WI-0268 C4, `community-mails.test.ts`): ein Reviewer bekommt 403 statt einer leeren Liste.
        expect(code(await get("/api/community/vorgaenge?art=anfrage", lena.cookie))).toBe("403 community_forbidden");
        // Unbekannt: 404; keine Nummer: 400 vom Schema.
        expect(code(await get("/api/community/vorgaenge/COM-999999", lena.cookie))).toBe("404 community_not_found");
        expect(code(await get("/api/community/vorgaenge/gibt-es-nicht", lena.cookie))).toBe("400 validation_failed");
    });

    it("🔴 sichten mit veralteter Revision 409 `community_conflict`, mit der aktuellen 200 und die nächste Revision; nochmal derselbe Aufruf ändert nichts", async () => {
        const { nummer } = await melde();
        const rev = await revisionVon(nummer);
        const veraltet = await schritt(nummer, "sichten", { baseRevision: rev + 5 });
        expect(code(veraltet)).toBe("409 community_conflict");
        const operationId = randomUUID();
        const gut = await post(
            `/api/community/vorgaenge/${nummer}/sichten`,
            { operationId, baseRevision: rev },
            lena.cookie,
        );
        expect(code(gut)).toBe("200");
        expect(Value.Check(VorgangQuittung, gut.json())).toBe(true);
        expect(gut.json()).toEqual({ nummer, revision: rev + 1 });
        // Dieselbe Kennung noch einmal: dieselbe Antwort, kein weiterer Schritt.
        const wieder = await post(
            `/api/community/vorgaenge/${nummer}/sichten`,
            { operationId, baseRevision: rev },
            lena.cookie,
        );
        expect(wieder.json()).toEqual({ nummer, revision: rev + 1 });
        expect(await revisionVon(nummer)).toBe(rev + 1);
        // Ein zweites Sichten mit neuer Kennung ist kein Übergang mehr.
        expect(code(await schritt(nummer, "sichten", { baseRevision: rev + 1 }))).toBe("409 community_transition");
        // Notizen prüfen keine Revision, die Quittung trägt die aktuelle.
        const notiz = await schritt(nummer, "notiz", { text: "Wehrheim liegt laut Karte bei 500/400." });
        expect(notiz.json()).toMatchObject({ nummer });
        expect(notiz.statusCode).toBe(200);
    });

    it("🔴 Papierkorb und Wiederherstellen nur mit `moderate_community`; Segment und Detail des Papierkorbs ebenso; genau ein Protokolleintrag", async () => {
        const { nummer } = await melde();
        const rev = await revisionVon(nummer);
        expect(code(await schritt(nummer, "papierkorb", { baseRevision: rev }, lena.cookie))).toBe("403 forbidden");
        expect(code(await schritt(nummer, "papierkorb", { baseRevision: rev }, adminOhneFaktor.cookie))).toBe(
            "403 assurance_required",
        );
        expect((await protokoll("system.community_papierkorb")).length).toBe(0);

        const operationId = randomUUID();
        const weg = await post(
            `/api/community/vorgaenge/${nummer}/papierkorb`,
            { operationId, baseRevision: rev },
            admin.cookie,
        );
        expect(code(weg)).toBe("200");
        expect(Value.Check(VorgangQuittung, weg.json())).toBe(true);
        // Dieselbe Kennung noch einmal: Wiederholung, kein zweiter Eintrag im Protokoll.
        const wiederholt = await post(
            `/api/community/vorgaenge/${nummer}/papierkorb`,
            { operationId, baseRevision: rev },
            admin.cookie,
        );
        expect(code(wiederholt)).toBe("200");
        const eintraege = await protokoll("system.community_papierkorb");
        expect(eintraege).toHaveLength(1);
        expect(eintraege[0]).toMatchObject({ target_ref: nummer, details: { com: nummer }, actor_person_id: admin.id });

        // Der Papierkorb ist Sache der Moderation: Liste und Detail verlangen das Recht, und die Statusseite kennt den Vorgang nicht mehr.
        expect(code(await get("/api/community/vorgaenge?segment=papierkorb", lena.cookie))).toBe(
            "403 community_forbidden",
        );
        expect(code(await get(`/api/community/vorgaenge/${nummer}`, lena.cookie))).toBe("403 community_forbidden");
        const liste = (await get("/api/community/vorgaenge?segment=papierkorb", admin.cookie)).json() as VorgangListe;
        expect(liste.zeilen.map((zeile) => zeile.nummer)).toEqual([nummer]);
        expect((await detail(nummer, admin.cookie)).papierkorbAt).not.toBeNull();
        // Offen zählt der Vorgang nicht mehr.
        expect(((await get("/api/community/vorgaenge", lena.cookie)).json() as VorgangListe).zeilen).toHaveLength(0);

        const wiederRev = (await detail(nummer, admin.cookie)).zeile.revision;
        expect(code(await schritt(nummer, "wiederherstellen", { baseRevision: wiederRev }, lena.cookie))).toBe(
            "403 forbidden",
        );
        expect(code(await schritt(nummer, "wiederherstellen", { baseRevision: wiederRev }, admin.cookie))).toBe("200");
        expect((await detail(nummer)).papierkorbAt).toBeNull();
    });

    it("🔴 Zuständigkeit: jeder, der Meldungen bearbeitet, setzt jede Person ein und leert jede Zuständigkeit (WI-0279, Vali 2026-11-11)", async () => {
        const { nummer } = await melde();
        // Lena nimmt sich selbst.
        let rev = await revisionVon(nummer);
        expect(code(await schritt(nummer, "zustaendig", { baseRevision: rev, person: lena.id }))).toBe("200");
        expect((await detail(nummer)).zeile.zustaendig).toEqual({ id: lena.id, name: "Lena" });
        // Lena setzt eine andere Person ein: ohne die Moderation seit WI-0279 erlaubt (vorher 403).
        rev = await revisionVon(nummer);
        expect(code(await schritt(nummer, "zustaendig", { baseRevision: rev, person: admin.id }))).toBe("200");
        expect((await detail(nummer)).zeile.zustaendig).toEqual({ id: admin.id, name: "Adrian" });
        expect((await detail(nummer)).zustaendigSeit?.von).toEqual({ id: lena.id, name: "Lena" });
        // Und sie leert eine fremde Zuständigkeit.
        rev = await revisionVon(nummer);
        expect(code(await schritt(nummer, "zustaendig", { baseRevision: rev, person: null }))).toBe("200");
        expect((await detail(nummer)).zeile.zustaendig).toBeNull();
        expect((await detail(nummer)).zustaendigSeit).toBeUndefined();
        // Wer nicht zuständig sein kann (Tester, unbekannte Kennung): 422 statt eines Fremdschlüsselfehlers.
        rev = await revisionVon(nummer);
        expect(code(await schritt(nummer, "zustaendig", { baseRevision: rev, person: tester.id }, admin.cookie))).toBe(
            "422 community_invalid",
        );
        expect(
            code(await schritt(nummer, "zustaendig", { baseRevision: rev, person: randomUUID() }, admin.cookie)),
        ).toBe("422 community_invalid");
    });

    it("personen: aktive Personen ab Reviewer für das Menü „Zuständig“, nie ein Tester", async () => {
        const antwort = await get("/api/community/personen", lena.cookie);
        expect(code(antwort)).toBe("200");
        const namen = (antwort.json() as { id: string; name: string }[]).map((person) => person.name);
        expect(namen).toEqual(expect.arrayContaining(["Lena", "Adrian", "Frida"]));
        expect(namen).not.toContain("Tessa");
    });

    it("🔴 Abschließen und Wiedereröffnen: Begründung Pflicht, eine Dublette nennt ihr Ziel; je genau ein Protokolleintrag mit COM-Nummer und Ergebnis", async () => {
        const erste = await melde();
        const zweite = await melde();
        const rev = await revisionVon(erste.nummer);
        expect(code(await schritt(erste.nummer, "abschliessen", { baseRevision: rev, ergebnis: "umgesetzt" }))).toBe(
            "400 validation_failed",
        );
        expect(
            code(
                await schritt(erste.nummer, "abschliessen", {
                    baseRevision: rev,
                    ergebnis: "dublette",
                    begruendung: "gleiche Stelle",
                }),
            ),
        ).toBe("422 community_invalid");
        expect(
            code(
                await schritt(erste.nummer, "abschliessen", {
                    baseRevision: rev,
                    ergebnis: "dublette",
                    begruendung: "gleiche Stelle",
                    dubletteVon: "unfug",
                }),
            ),
        ).toBe("400 validation_failed");
        expect((await protokoll("system.community_abgeschlossen")).length).toBe(0);

        const operationId = randomUUID();
        const body = {
            operationId,
            baseRevision: rev,
            ergebnis: "dublette",
            begruendung: "gleiche Stelle wie die andere Meldung",
            nachricht: "Danke, die Stelle ist schon gemeldet.",
            dubletteVon: zweite.nummer,
        };
        const zu = await post(`/api/community/vorgaenge/${erste.nummer}/abschliessen`, body, lena.cookie);
        expect(code(zu)).toBe("200");
        // Wiederholung derselben Kennung: ein einziger Eintrag.
        expect(code(await post(`/api/community/vorgaenge/${erste.nummer}/abschliessen`, body, lena.cookie))).toBe(
            "200",
        );
        const abgeschlossen = await protokoll("system.community_abgeschlossen");
        expect(abgeschlossen).toHaveLength(1);
        expect(abgeschlossen[0]).toMatchObject({
            target_ref: erste.nummer,
            details: { com: erste.nummer, ergebnis: "dublette" },
            actor_person_id: lena.id,
        });
        // Nie Text oder Begründung im Protokoll.
        expect(JSON.stringify(abgeschlossen[0])).not.toContain("gleiche Stelle");
        const d = await detail(erste.nummer);
        expect(d.zeile).toMatchObject({ zustand: "abgeschlossen", ergebnis: "dublette" });
        expect(d.dubletteVon).toBe(zweite.nummer);

        // Wiedereröffnen: Grund Pflicht, ein Eintrag.
        const neueRev = d.zeile.revision;
        expect(code(await schritt(erste.nummer, "wiedereroeffnen", { baseRevision: neueRev }))).toBe(
            "400 validation_failed",
        );
        expect(
            code(
                await schritt(erste.nummer, "wiedereroeffnen", {
                    baseRevision: neueRev,
                    grund: "Doch keine Dublette.",
                }),
            ),
        ).toBe("200");
        const offen = await protokoll("system.community_wiedereroeffnet");
        expect(offen).toHaveLength(1);
        expect(offen[0]).toMatchObject({ target_ref: erste.nummer, details: { com: erste.nummer } });
        expect((await detail(erste.nummer)).zeile.zustand).toBe("in_arbeit");
    });

    it("🔴 Personenbezug löschen: nur Moderation mit frischem Passkey; danach ohne Name und Statuslink, der Sachinhalt bleibt; ein Protokolleintrag ohne Inhalt", async () => {
        const { nummer, schluessel } = await melde();
        const url = `/api/community/vorgaenge/${nummer}/personenbezug-loeschen`;
        expect(code(await post(url, { operationId: randomUUID() }, lena.cookie))).toBe("403 forbidden");
        // Ein zweiter Faktor ohne frischen Passkey genügt für Stufe V, aber nicht für diese Handlung.
        expect(code(await post(url, { operationId: randomUUID() }, admin.cookie))).toBe("403 reauth_required");
        expect((await protokoll("system.community_personenbezug_geloescht")).length).toBe(0);

        const operationId = randomUUID();
        const weg = await post(url, { operationId }, adminFrisch.cookie);
        expect(code(weg)).toBe("200");
        expect(Value.Check(VorgangQuittung, weg.json())).toBe(true);
        expect(code(await post(url, { operationId }, adminFrisch.cookie))).toBe("200");
        const eintraege = await protokoll("system.community_personenbezug_geloescht");
        expect(eintraege).toHaveLength(1);
        expect(eintraege[0]).toMatchObject({
            target_ref: nummer,
            details: { com: nummer },
            actor_person_id: adminFrisch.id,
        });

        const d = await detail(nummer, adminFrisch.cookie);
        expect(d.melder).toMatchObject({ name: null, rueckwege: [], entfernt: true });
        expect(d.zeile.bezugName).toBe("Wehrheim");
        expect(
            d.verlauf.filter((e) => e.art === "nachricht").every((e) => e.art === "nachricht" && e.text === null),
        ).toBe(true);
        // Der Statuslink gilt nicht mehr, und die Antwort sagt nichts darüber, ob es den Vorgang gab.
        const status = await postOeffentlich("/api/community/status", { schluessel });
        expect(code(status)).toBe("404 community_not_found");
        expect((status.json() as { error: { message: string } }).error.message).toBe(STATUS_FEHLT);
    });
});
