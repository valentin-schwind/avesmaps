import { randomBytes, randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    AlsMeldungAntwort,
    COMMUNITY_GRENZEN,
    GesendetListe,
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
 * Kontaktformular und Reiter Mails (WI-0268 C4; Fachkonzept WI-0263 §3.1, §3.4, §9, Bedienkonzept §3) gegen echtes PostgreSQL, über die Routen.
 *
 * - Öffentlich: das Kontaktformular legt eine Anfrage an (Priorität hoch bei `rechte` und `datenschutz`), Idempotenz über die Kennung, dieselbe Grenze, derselbe Honigtopf und dieselbe Zeitfalle
 *   wie bei der Meldung (EIN Zähler), die Glocke meldet nur an die, die Anfragen lesen.
 * - 🔴 **Anfragen nur mit `read_mailbox`:** Ein Reviewer bekommt 403 auf Liste, Detail und JEDES Schreiben an einer Anfrage; die Liste der Meldungen und ihre Zähler enthalten nie Anfragen; die Adresse
 *   des Melders und seine früheren Vorgänge liefert das Detail nur mit dem Recht.
 * - Antworten nur mit `answer_community`; Ins Archiv (`beantwortet` oder `erledigt`), Zurück in den Eingang, Als Meldung weiterführen (Verknüpfung, Eingang Redaktion, keine Melderdaten,
 *   Anfrage im Archiv); veraltete Revision gibt den Konflikt; das Protokoll trägt nie Adresse oder Text.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const ORT = "11111111-2222-4333-8444-555555555555";
const MAIL = "Alrike.Fischer@example.org";
const TEXT =
    "Darf die Karte für ein Spielleiterhandbuch verwendet werden? Wir würden gern einen Ausschnitt drucken.\nVielen Dank!";

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "community-mails-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Community: Kontaktformular und Mails (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let lena: { id: string; cookie: string };
    let adrian: { id: string; cookie: string };
    let olaf: { id: string; cookie: string };
    let alle: string[];
    let adresse = 10;
    const neueAdresse = (): string => `10.40.0.${String(adresse++)}`;

    async function leeren(): Promise<void> {
        await database`DELETE FROM avesmaps_community.vorgang`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE action LIKE 'system.community_%'`;
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;
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
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { id: created.id, cookie };
        };
        lena = await person("reviewer", "Lena");
        adrian = await person("admin", "Adrian");
        olaf = await person("operator", "Olaf");
        alle = [lena.id, adrian.id, olaf.id];
    });

    beforeEach(leeren);

    afterAll(async () => {
        await app?.close();
        await leeren().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const kontakt = (patch: Record<string, unknown> = {}) => ({
        operationId: randomUUID(),
        schluessel: randomBytes(32).toString("base64url"),
        kategorie: "frage",
        text: TEXT,
        name: "Alrike",
        mail: MAIL,
        falle: { feld: "", dauerMs: 8000 },
        ...patch,
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
    const anzahl = async (art?: string): Promise<number> =>
        (
            await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM avesmaps_community.vorgang WHERE (${art ?? null}::text IS NULL OR art = ${art ?? null})`
        )[0]!.n;
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
    /** Reicht eine Anfrage ein und gibt Nummer, Schlüssel und Kennung zurück. */
    const frage = async (patch: Record<string, unknown> = {}) => {
        const body = kontakt(patch);
        const antwort = await postOeffentlich("/api/community/anfragen", body);
        expect(code(antwort)).toBe("201");
        const nummer = (antwort.json() as { nummer: string }).nummer;
        return { nummer, schluessel: body.schluessel as string, id: Number(nummer.slice(4)) };
    };
    const melde = async () => {
        const body = meldung();
        const antwort = await postOeffentlich("/api/community/meldungen", body);
        expect(code(antwort)).toBe("201");
        return (antwort.json() as { nummer: string }).nummer;
    };
    const detail = async (nummer: string, cookie = olaf.cookie): Promise<VorgangDetail> => {
        const antwort = await get(`/api/community/vorgaenge/${nummer}`, cookie);
        expect(code(antwort)).toBe("200");
        const body = antwort.json() as VorgangDetail;
        expect(Value.Check(VorgangDetail, body)).toBe(true);
        return body;
    };
    const revisionVon = async (nummer: string, cookie = olaf.cookie): Promise<number> =>
        (await detail(nummer, cookie)).zeile.revision;
    const schritt = (nummer: string, was: string, payload: Record<string, unknown>, cookie = olaf.cookie) =>
        post(`/api/community/vorgaenge/${nummer}/${was}`, { operationId: randomUUID(), ...payload }, cookie);
    const protokoll = async (action: string) =>
        database<{ target_ref: string | null; details: Record<string, unknown> }[]>`
            SELECT target_ref, details FROM avesmaps_auth.security_event WHERE action = ${action} ORDER BY id
        `;
    const liste = async (url: string, cookie = olaf.cookie): Promise<VorgangListe> => {
        const antwort = await get(url, cookie);
        expect(code(antwort)).toBe("200");
        const body = antwort.json() as VorgangListe;
        expect(Value.Check(VorgangListe, body)).toBe(true);
        return body;
    };

    it("🔴 Kontaktformular: 201 mit COM-Nummer; Anfrage, Absender, Nachricht und Eingang in der Datenbank; dieselbe Kennung legt nichts zweites an", async () => {
        const body = kontakt();
        const antwort = await postOeffentlich("/api/community/anfragen", body);
        expect(code(antwort)).toBe("201");
        expect(Value.Check(MeldungAntwort, antwort.json())).toBe(true);
        expect(antwort.headers["cache-control"]).toBe("no-store");
        const { nummer } = antwort.json() as { nummer: string };
        expect(nummer).toMatch(/^COM-\d{6}$/u);
        const d = await detail(nummer);
        expect(d.zeile).toMatchObject({
            art: "anfrage",
            kategorie: "frage",
            eingang: "kontakt",
            zustand: "neu",
            prioritaet: "normal",
            absender: "Alrike",
            betreff:
                "Darf die Karte für ein Spielleiterhandbuch verwendet werden? Wir würden gern einen Ausschnitt drucken.",
            beantwortet: false,
        });
        expect(d.melder).toMatchObject({
            name: "Alrike",
            rueckwege: ["statusseite", "mail"],
            mail: MAIL,
            entfernt: false,
        });
        expect(d.bezug).toBeNull();
        expect(d.verlauf.filter((e) => e.art === "nachricht")).toEqual([
            expect.objectContaining({ richtung: "ein", weg: "formular", text: TEXT }),
        ]);
        // Dieselbe Kennung: dieselbe Nummer, kein zweiter Vorgang.
        const nochmal = await postOeffentlich("/api/community/anfragen", body);
        expect((nochmal.json() as { nummer: string }).nummer).toBe(nummer);
        expect(await anzahl()).toBe(1);
        // Ohne Name und Adresse geht es auch; die Statusseite ist der Rückweg.
        const ohne = await frage({ name: undefined, mail: undefined });
        const dOhne = await detail(ohne.nummer);
        expect(dOhne.melder).toMatchObject({ name: null, rueckwege: ["statusseite"], mail: null });
        expect(dOhne.zeile.absender).toBeNull();
    });

    it("Priorität: `rechte` und `datenschutz` kommen mit hoch, alles andere mit normal", async () => {
        for (const [kategorie, prioritaet] of [
            ["rechte", "hoch"],
            ["datenschutz", "hoch"],
            ["frage", "normal"],
            ["hinweis", "normal"],
            ["mitmachen", "normal"],
            ["lob", "normal"],
            ["allgemein", "normal"],
            ["problem", "normal"],
            ["sonstiges", "normal"],
        ] as const) {
            const { nummer } = await frage({ kategorie });
            expect((await detail(nummer)).zeile.prioritaet, kategorie).toBe(prioritaet);
        }
    });

    it("Ungültig: zu kurzer Text, falsche Adresse, Kategorie einer Meldung, zu langer Name; nichts entsteht", async () => {
        const url = "/api/community/anfragen";
        expect(code(await postOeffentlich(url, kontakt({ text: "kurz" })))).toBe("400 validation_failed");
        expect(code(await postOeffentlich(url, kontakt({ mail: "keine-adresse" })))).toBe("400 validation_failed");
        expect(code(await postOeffentlich(url, kontakt({ mail: "a b@example.org" })))).toBe("400 validation_failed");
        expect(code(await postOeffentlich(url, kontakt({ kategorie: "lage" })))).toBe("400 validation_failed");
        expect(code(await postOeffentlich(url, kontakt({ name: "x".repeat(81) })))).toBe("400 validation_failed");
        expect(await anzahl()).toBe(0);
    });

    it("🔴 nur von der eigenen Seite; Honigtopf und Zeitfalle verwerfen still (201, kein Vorgang); EIN Zähler mit den Meldungen", async () => {
        const ohne = await app.inject({
            method: "POST",
            url: "/api/community/anfragen",
            payload: kontakt(),
            remoteAddress: neueAdresse(),
        });
        expect(code(ohne)).toBe("403 forbidden_origin");
        const honig = await postOeffentlich(
            "/api/community/anfragen",
            kontakt({ falle: { feld: "x", dauerMs: 9000 } }),
        );
        expect(code(honig)).toBe("201");
        const schnell = await postOeffentlich(
            "/api/community/anfragen",
            kontakt({ falle: { feld: "", dauerMs: COMMUNITY_GRENZEN.mindestDauerMs - 1 } }),
        );
        expect(code(schnell)).toBe("201");
        expect(await anzahl()).toBe(0);
        // Dieselbe Adresse: Meldungen und Anfragen zählen zusammen auf die fünf je Stunde.
        const ip = neueAdresse();
        for (let n = 0; n < 3; n += 1)
            expect(code(await postOeffentlich("/api/community/anfragen", kontakt(), ip))).toBe("201");
        for (let n = 0; n < 2; n += 1)
            expect(code(await postOeffentlich("/api/community/meldungen", meldung(), ip))).toBe("201");
        const zuViele = await postOeffentlich("/api/community/anfragen", kontakt(), ip);
        expect(code(zuViele)).toBe("429 community_rate");
        expect(code(await postOeffentlich("/api/community/meldungen", meldung(), ip))).toBe("429 community_rate");
        expect(await anzahl()).toBe(COMMUNITY_GRENZEN.jeAdresseJeStunde);
    });

    it("🔴 Glocke: „Neue Nachricht“ geht nur an die mit `read_mailbox`, mit der Nummer und ohne Inhalt; die Meldung bleibt bei den Bearbeitenden", async () => {
        const { nummer } = await frage({ text: "Geheimer Inhalt der Anfrage, den die Glocke nie zeigt." });
        const zeilen = await database<{ an_person: string; art: string; text: string | null }[]>`
            SELECT an_person::text, art, text FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[]) ORDER BY an_person
        `;
        expect(zeilen).toEqual([{ an_person: olaf.id, art: "community_nachricht", text: nummer }]);
        const meldungNummer = await melde();
        const danach = await database<{ an_person: string; art: string }[]>`
            SELECT an_person::text, art FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[]) AND art = 'community_neu'
        `;
        expect(danach.map((z) => z.an_person).sort()).toEqual([lena.id, adrian.id, olaf.id].sort());
        expect(meldungNummer).not.toBe(nummer);
    });

    it("🔴 Anfragen nur mit `read_mailbox`: ein Reviewer bekommt 403 auf Liste, Detail und Schreiben; ein Admin ebenfalls", async () => {
        const { nummer } = await frage();
        const rev = await revisionVon(nummer);
        for (const cookie of [lena.cookie, adrian.cookie]) {
            expect(code(await get("/api/community/vorgaenge?art=anfrage&segment=eingang", cookie))).toBe(
                "403 community_forbidden",
            );
            expect(code(await get("/api/community/vorgaenge?segment=eingang", cookie))).toBe("403 community_forbidden");
            expect(code(await get(`/api/community/vorgaenge/${nummer}`, cookie))).toBe("403 community_forbidden");
            expect(code(await get("/api/community/gesendet", cookie))).toBe("403 forbidden");
            expect(code(await get("/api/community/personen?mails=true", cookie))).toBe("403 community_forbidden");
            for (const [was, payload] of [
                ["sichten", { baseRevision: rev }],
                ["uebernehmen", { baseRevision: rev }],
                ["prioritaet", { baseRevision: rev, prioritaet: "hoch" }],
                ["notiz", { text: "Intern" }],
                ["rueckfrage", { baseRevision: rev, text: "Welche Seite?" }],
                ["abschliessen", { baseRevision: rev, ergebnis: "erledigt", begruendung: "weil" }],
                ["ins-archiv", { baseRevision: rev }],
                ["zurueck-in-eingang", { baseRevision: rev }],
                ["archivieren", { baseRevision: rev }],
                [
                    "als-meldung",
                    {
                        baseRevision: rev,
                        kategorie: "sonstiges",
                        text: "Ein Kartenfehler, aus der Anfrage entstanden.",
                        bezug: { art: "stelle", lage: { x: 10, y: 20 } },
                    },
                ],
            ] as const) {
                expect(
                    code(await schritt(nummer, was, payload, cookie)),
                    `${was} ${cookie === lena.cookie ? "Lena" : "Adrian"}`,
                ).toBe("403 community_forbidden");
            }
            expect(
                code(
                    await schritt(nummer, "antworten", { baseRevision: rev, text: "Ja.", archivieren: false }, cookie),
                ),
            ).toBe("403 forbidden");
            // Der Admin darf moderieren, aber nicht an Anfragen: Papierkorb 403.
            expect(code(await schritt(nummer, "papierkorb", { baseRevision: rev }, cookie))).toMatch(/^403 /u);
        }
        // Nichts davon hat etwas getan.
        const d = await detail(nummer);
        expect(d.zeile.revision).toBe(rev);
        expect(d.zeile.zustand).toBe("neu");
        expect(d.verlauf.filter((e) => e.art === "notiz")).toHaveLength(0);
        // Der Betreiber darf.
        expect(code(await schritt(nummer, "sichten", { baseRevision: rev }))).toBe("200");
    });

    it("🔴 Meldungen und Anfragen bleiben getrennt: die Liste der Meldungen, ihre Zähler und ihre Suche enthalten nie Anfragen; die Adresse steht nur mit dem Recht", async () => {
        const anfrage = await frage({ text: "Spielleiterhandbuch Anfrage mit dem Suchwort Gallys-Sonderling." });
        const meldungNummer = await melde();
        for (const cookie of [lena.cookie, olaf.cookie]) {
            const offen = await liste("/api/community/vorgaenge", cookie);
            expect(offen.zeilen.map((z) => z.nummer)).toEqual([meldungNummer]);
            expect(offen.zaehler.offen).toBe(1);
            expect(offen.zaehler.eingang).toBe(1);
            const suche = await liste("/api/community/vorgaenge?q=Gallys-Sonderling", cookie);
            expect(suche.zeilen).toEqual([]);
        }
        const mails = await liste("/api/community/vorgaenge?art=anfrage&segment=eingang");
        expect(mails.zeilen.map((z) => z.nummer)).toEqual([anfrage.nummer]);
        expect(mails.zaehler).toMatchObject({ offen: 1, eingang: 1, neu: 1 });
        expect(mails.zeilen[0]).toMatchObject({ absender: "Alrike", beantwortet: false });
        const gefunden = await liste("/api/community/vorgaenge?art=anfrage&segment=eingang&q=Gallys-Sonderling");
        expect(gefunden.zeilen).toHaveLength(1);
        // Die Suche kennt den Absender und die Adresse (nur in der Liste der Anfragen).
        expect(
            (
                await liste(
                    `/api/community/vorgaenge?art=anfrage&segment=eingang&q=${encodeURIComponent("alrike.fischer")}`,
                )
            ).zeilen,
        ).toHaveLength(1);
        // Ein Reviewer liest Meldungen: ohne Adresse und ohne frühere Vorgänge im Melder. Der Betreiber bekommt die Felder (bei einer Meldung leer).
        const reviewer = await detail(meldungNummer, lena.cookie);
        expect(reviewer.melder).not.toHaveProperty("mail");
        expect(reviewer.melder).not.toHaveProperty("fruehere");
        const betreiber = await detail(meldungNummer, olaf.cookie);
        expect(betreiber.melder).toMatchObject({ mail: null, fruehere: [] });
        expect(betreiber.zeile).not.toHaveProperty("absender");
    });

    it("Frühere Vorgänge: dieselbe Adresse (ohne Groß und Klein), ohne sich selbst, höchstens zehn, neueste zuerst; eine andere Adresse zählt nicht", async () => {
        const ersterNummern: string[] = [];
        for (let n = 0; n < 12; n += 1)
            ersterNummern.push((await frage({ mail: n % 2 === 0 ? MAIL : MAIL.toUpperCase() })).nummer);
        const fremd = await frage({ mail: "jemand.anders@example.org" });
        const letzte = await frage({ mail: MAIL.toLowerCase() });
        const d = await detail(letzte.nummer);
        const fruehere = d.melder.fruehere ?? [];
        expect(fruehere).toHaveLength(10);
        expect(fruehere.map((f) => f.nummer)).toEqual([...ersterNummern].reverse().slice(0, 10));
        expect(fruehere.map((f) => f.nummer)).not.toContain(letzte.nummer);
        expect(fruehere.map((f) => f.nummer)).not.toContain(fremd.nummer);
        expect((await detail(fremd.nummer)).melder.fruehere).toEqual([]);
    });

    it("🔴 Antworten: nur mit `answer_community`; Zustand „wartet auf Antwort“, die antwortende Person ist dran, die Antwort steht auf der Statusseite", async () => {
        const { nummer, schluessel } = await frage();
        const rev = await revisionVon(nummer);
        const antwort = await schritt(nummer, "antworten", {
            baseRevision: rev,
            text: "Ja, mit Quellenangabe gern.",
            archivieren: false,
        });
        expect(code(antwort)).toBe("200");
        expect(Value.Check(VorgangQuittung, antwort.json())).toBe(true);
        const d = await detail(nummer);
        expect(d.zeile).toMatchObject({ zustand: "rueckfrage", beantwortet: true, zustaendig: { id: olaf.id } });
        expect(d.zeile.ergebnis).toBeNull();
        const nachrichten = d.verlauf.filter((e) => e.art === "nachricht");
        expect(nachrichten).toHaveLength(2);
        expect(nachrichten[1]).toMatchObject({
            richtung: "aus",
            weg: "statusseite",
            text: "Ja, mit Quellenangabe gern.",
        });
        const status = await postOeffentlich("/api/community/status", { schluessel });
        expect(Value.Check(StatusSicht, status.json())).toBe(true);
        const sicht = status.json() as StatusSicht;
        expect(sicht).toMatchObject({ art: "anfrage", zustand: "rueckfrage" });
        expect(sicht.nachrichten.map((n) => n.text)).toContain("Ja, mit Quellenangabe gern.");
        expect(JSON.stringify(sicht)).not.toContain("Olaf");
        // Mit der Antwort des Absenders geht es zurück in Arbeit.
        const antwortDesAbsenders = await postOeffentlich("/api/community/status/antwort", {
            operationId: randomUUID(),
            schluessel,
            text: "Danke, genau so machen wir es.",
        });
        expect(code(antwortDesAbsenders)).toBe("200");
        expect((await detail(nummer)).zeile.zustand).toBe("in_arbeit");
        // Protokoll: genau ein Eintrag, ohne Adresse und Text.
        const eintraege = await protokoll("system.community_antwort_gesendet");
        expect(eintraege).toEqual([{ target_ref: nummer, details: { com: nummer } }]);
        // Die Antwort des Absenders meldet sich bei den Betreibern, nicht bei den Bearbeitenden von Meldungen.
        const glocke = await database<{ an_person: string; art: string }[]>`
            SELECT an_person::text, art FROM public.benachrichtigung WHERE art = 'community_antwort' AND an_person = ANY(${alle}::uuid[])
        `;
        expect(glocke).toEqual([{ an_person: olaf.id, art: "community_antwort" }]);
    });

    it("Antworten: leere Antwort ungültig, veraltete Revision 409 `community_conflict`, Wiederholung derselben Kennung wirkt nur einmal, im Archiv gesperrt", async () => {
        const { nummer } = await frage();
        const rev = await revisionVon(nummer);
        expect(code(await schritt(nummer, "antworten", { baseRevision: rev, text: "", archivieren: false }))).toBe(
            "400 validation_failed",
        );
        expect(code(await schritt(nummer, "antworten", { baseRevision: rev, text: "   ", archivieren: false }))).toBe(
            "422 community_invalid",
        );
        const kennung = randomUUID();
        const erste = await post(
            `/api/community/vorgaenge/${nummer}/antworten`,
            { operationId: kennung, baseRevision: rev, text: "Einmal.", archivieren: false },
            olaf.cookie,
        );
        expect(code(erste)).toBe("200");
        const zweite = await post(
            `/api/community/vorgaenge/${nummer}/antworten`,
            { operationId: kennung, baseRevision: rev, text: "Einmal.", archivieren: false },
            olaf.cookie,
        );
        expect(code(zweite)).toBe("200");
        const d = await detail(nummer);
        expect(d.verlauf.filter((e) => e.art === "nachricht" && e.richtung === "aus")).toHaveLength(1);
        expect(await protokoll("system.community_antwort_gesendet")).toHaveLength(1);
        // Veraltet: noch einmal mit der alten Revision.
        expect(
            code(await schritt(nummer, "antworten", { baseRevision: rev, text: "Zweite.", archivieren: false })),
        ).toBe("409 community_conflict");
        // Im Archiv: erst zurück in den Eingang holen.
        await schritt(nummer, "ins-archiv", { baseRevision: await revisionVon(nummer) });
        expect(
            code(
                await schritt(nummer, "antworten", {
                    baseRevision: await revisionVon(nummer),
                    text: "Zu spät.",
                    archivieren: false,
                }),
            ),
        ).toBe("409 community_transition");
    });

    it("Antworten und ins Archiv: ein Schritt, Ergebnis `beantwortet`, archiviert; das Protokoll nennt das Ergebnis", async () => {
        const { nummer } = await frage();
        const rev = await revisionVon(nummer);
        expect(
            code(
                await schritt(nummer, "antworten", {
                    baseRevision: rev,
                    text: "Gern, viel Erfolg damit.",
                    archivieren: true,
                }),
            ),
        ).toBe("200");
        const d = await detail(nummer);
        expect(d.zeile).toMatchObject({ zustand: "abgeschlossen", ergebnis: "beantwortet", beantwortet: true });
        expect(d.archiviertAt).not.toBeNull();
        expect(d.verlauf.filter((e) => e.art === "ereignis").map((e) => (e as { ereignis: string }).ereignis)).toEqual([
            "eingang",
            "abgeschlossen",
            "archiviert",
        ]);
        const archiv = await liste("/api/community/vorgaenge?art=anfrage&segment=archiv");
        expect(archiv.zeilen.map((z) => z.nummer)).toEqual([nummer]);
        expect(archiv.zaehler).toMatchObject({ archiv: 1, eingang: 0 });
        expect((await liste("/api/community/vorgaenge?art=anfrage&segment=eingang")).zeilen).toEqual([]);
        expect(await protokoll("system.community_antwort_gesendet")).toEqual([
            { target_ref: nummer, details: { com: nummer, ergebnis: "beantwortet" } },
        ]);
    });

    it("Ins Archiv: ohne Antwort `erledigt`, nach einer Antwort `beantwortet`; zweimal gibt 409; Zurück in den Eingang öffnet wieder (in Arbeit, ohne Ergebnis, ohne Grund)", async () => {
        const ohneAntwort = await frage();
        expect(
            code(
                await schritt(ohneAntwort.nummer, "ins-archiv", {
                    baseRevision: await revisionVon(ohneAntwort.nummer),
                }),
            ),
        ).toBe("200");
        const d = await detail(ohneAntwort.nummer);
        expect(d.zeile).toMatchObject({ zustand: "abgeschlossen", ergebnis: "erledigt", beantwortet: false });
        expect(d.archiviertAt).not.toBeNull();
        expect(
            code(
                await schritt(ohneAntwort.nummer, "ins-archiv", {
                    baseRevision: await revisionVon(ohneAntwort.nummer),
                }),
            ),
        ).toBe("409 community_transition");

        const mitAntwort = await frage();
        await schritt(mitAntwort.nummer, "antworten", {
            baseRevision: await revisionVon(mitAntwort.nummer),
            text: "Kurze Antwort.",
            archivieren: false,
        });
        await schritt(mitAntwort.nummer, "ins-archiv", { baseRevision: await revisionVon(mitAntwort.nummer) });
        expect((await detail(mitAntwort.nummer)).zeile).toMatchObject({
            zustand: "abgeschlossen",
            ergebnis: "beantwortet",
        });

        expect(await protokoll("system.community_archiviert")).toEqual([
            { target_ref: ohneAntwort.nummer, details: { com: ohneAntwort.nummer, ergebnis: "erledigt" } },
            { target_ref: mitAntwort.nummer, details: { com: mitAntwort.nummer, ergebnis: "beantwortet" } },
        ]);

        // Zurück in den Eingang.
        const zurueck = await schritt(ohneAntwort.nummer, "zurueck-in-eingang", {
            baseRevision: await revisionVon(ohneAntwort.nummer),
        });
        expect(code(zurueck)).toBe("200");
        const wieder = await detail(ohneAntwort.nummer);
        expect(wieder.zeile).toMatchObject({ zustand: "in_arbeit", ergebnis: null });
        expect(wieder.archiviertAt).toBeNull();
        expect(
            (await liste("/api/community/vorgaenge?art=anfrage&segment=eingang")).zeilen.map((z) => z.nummer),
        ).toContain(ohneAntwort.nummer);
        // Eine offene Anfrage holt man nicht zurück.
        expect(
            code(
                await schritt(ohneAntwort.nummer, "zurueck-in-eingang", {
                    baseRevision: await revisionVon(ohneAntwort.nummer),
                }),
            ),
        ).toBe("409 community_transition");
        expect(await protokoll("system.community_wiedereroeffnet")).toEqual([
            { target_ref: ohneAntwort.nummer, details: { com: ohneAntwort.nummer } },
        ]);
    });

    it("🔴 Als Meldung weiterführen: Meldung mit Bezug, Eingang Redaktion, ohne Melderdaten, verknüpft; die Anfrage kommt beantwortet ins Archiv; eine Wiederholung legt nichts zweites an", async () => {
        const { nummer, schluessel } = await frage({
            kategorie: "hinweis",
            text: "Wehrheim liegt falsch auf der Karte, bitte nachsehen.",
        });
        const kennung = randomUUID();
        const body = {
            operationId: kennung,
            baseRevision: await revisionVon(nummer),
            kategorie: "lage",
            text: "Wehrheim liegt falsch auf der Karte (aus der Anfrage).",
            quelle: "Herz des Reiches, S. 112",
            bezug: {
                art: "objekt",
                objektArt: "place",
                objektId: ORT,
                name: "Wehrheim",
                typ: "Stadt",
                lage: { x: 500, y: 400 },
            },
            antwort: "Danke, wir haben es als Meldung aufgenommen.",
        };
        const antwort = await post(`/api/community/vorgaenge/${nummer}/als-meldung`, body, olaf.cookie);
        expect(code(antwort)).toBe("200");
        expect(Value.Check(AlsMeldungAntwort, antwort.json())).toBe(true);
        const { meldung: meldungNummer } = antwort.json() as { meldung: string };
        expect(meldungNummer).not.toBe(nummer);
        // Die Meldung: Eingang Redaktion, angelegt von der Person, Bezug, keine Melderdaten, verknüpft mit der Anfrage.
        const m = await detail(meldungNummer, lena.cookie);
        expect(m.zeile).toMatchObject({
            art: "meldung",
            kategorie: "lage",
            eingang: "redaktion",
            zustand: "neu",
            bezugName: "Wehrheim",
        });
        expect(m.bezug).toMatchObject({ art: "objekt", objektArt: "place", objektId: ORT, name: "Wehrheim" });
        expect(m.quelle).toBe("Herz des Reiches, S. 112");
        expect(m.melder).toEqual({ name: null, rueckwege: [], entfernt: false });
        expect(m.verknuepft).toEqual([{ art: "gehoert_zu", richtung: "von", nummer }]);
        expect(m.verlauf.filter((e) => e.art === "nachricht")).toEqual([
            expect.objectContaining({ richtung: "ein", weg: "redaktion", text: body.text }),
        ]);
        const zeilenMelder = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_community.melder WHERE vorgang_id = ${Number(meldungNummer.slice(4))}
        `;
        expect(zeilenMelder[0]!.n).toBe(0);
        const angelegt = await database<{ angelegt_von: string }[]>`
            SELECT angelegt_von::text FROM avesmaps_community.vorgang WHERE id = ${Number(meldungNummer.slice(4))}
        `;
        expect(angelegt[0]!.angelegt_von).toBe(olaf.id);
        // Die Anfrage: beantwortet, im Archiv, die Antwort auf der Statusseite, der Verweis auf die Meldung im Verlauf.
        const a = await detail(nummer);
        expect(a.zeile).toMatchObject({ zustand: "abgeschlossen", ergebnis: "beantwortet" });
        expect(a.archiviertAt).not.toBeNull();
        expect(a.verknuepft).toEqual([{ art: "gehoert_zu", richtung: "zu", nummer: meldungNummer }]);
        expect(JSON.stringify(a.verlauf)).toContain(`als Meldung weitergeführt: ${meldungNummer}`);
        const status = (await postOeffentlich("/api/community/status", { schluessel })).json() as StatusSicht;
        expect(status.nachrichten.map((n) => n.text)).toContain("Danke, wir haben es als Meldung aufgenommen.");
        // Wiederholung: dieselbe Nummer, nichts zweites, ein Protokolleintrag.
        const nochmal = await post(`/api/community/vorgaenge/${nummer}/als-meldung`, body, olaf.cookie);
        expect(code(nochmal)).toBe("200");
        expect((nochmal.json() as { meldung: string }).meldung).toBe(meldungNummer);
        expect(await anzahl("meldung")).toBe(1);
        expect(await protokoll("system.community_als_meldung")).toEqual([
            { target_ref: nummer, details: { com: nummer, meldung: meldungNummer } },
        ]);
        // Die Meldung steht in der Liste der Meldungen, die Anfrage nicht.
        const offen = await liste("/api/community/vorgaenge", lena.cookie);
        expect(offen.zeilen.map((z) => z.nummer)).toEqual([meldungNummer]);
    });

    it("Als Meldung weiterführen ohne Antwort: die Anfrage ist `erledigt`; eine Antwort verlangt `answer_community`; eine Stelle als Bezug geht auch; veraltete Revision 409", async () => {
        const { nummer } = await frage();
        const rev = await revisionVon(nummer);
        const basis = {
            kategorie: "fehlt",
            fehltArt: "ort",
            text: "Hier fehlt ein Ort, aus der Anfrage entstanden.",
            bezug: { art: "stelle", lage: { x: 123.4, y: 456.7 }, naechsterOrt: "Gallys" },
        };
        // Veraltete Revision.
        expect(code(await schritt(nummer, "als-meldung", { baseRevision: rev + 5, ...basis }))).toBe(
            "409 community_conflict",
        );
        expect(await anzahl("meldung")).toBe(0);
        const ok = await schritt(nummer, "als-meldung", { baseRevision: rev, ...basis });
        expect(code(ok)).toBe("200");
        const { meldung: meldungNummer } = ok.json() as { meldung: string };
        const m = await detail(meldungNummer, lena.cookie);
        expect(m.bezug).toMatchObject({ art: "stelle", naechsterOrt: "Gallys" });
        expect(m.fehltArt).toBe("ort");
        expect((await detail(nummer)).zeile).toMatchObject({ zustand: "abgeschlossen", ergebnis: "erledigt" });
        // Eine zweite Weiterführung derselben (jetzt archivierten) Anfrage geht noch (sie legt eine weitere Meldung an), aber nicht aus dem Papierkorb.
        await schritt(nummer, "papierkorb", { baseRevision: await revisionVon(nummer) });
        expect(code(await schritt(nummer, "als-meldung", { baseRevision: await revisionVon(nummer), ...basis }))).toBe(
            "409 community_transition",
        );
    });

    it("Als Meldung: eine Meldung ist keine Anfrage (409), die Kategorie muss eine der Meldungen sein, der Bezug ist Pflicht", async () => {
        const meldungNummer = await melde();
        const rev = await revisionVon(meldungNummer);
        const basis = {
            kategorie: "sonstiges",
            text: "Noch eine Meldung daraus machen.",
            bezug: { art: "stelle", lage: { x: 1, y: 2 } },
        };
        expect(code(await schritt(meldungNummer, "als-meldung", { baseRevision: rev, ...basis }))).toBe(
            "409 community_transition",
        );
        expect(code(await schritt(meldungNummer, "ins-archiv", { baseRevision: rev }))).toBe(
            "409 community_transition",
        );
        expect(code(await schritt(meldungNummer, "zurueck-in-eingang", { baseRevision: rev }))).toBe(
            "409 community_transition",
        );
        expect(
            code(await schritt(meldungNummer, "antworten", { baseRevision: rev, text: "Hallo.", archivieren: false })),
        ).toBe("409 community_transition");
        const { nummer } = await frage();
        const r = await revisionVon(nummer);
        expect(code(await schritt(nummer, "als-meldung", { baseRevision: r, ...basis, kategorie: "frage" }))).toBe(
            "400 validation_failed",
        );
        expect(code(await schritt(nummer, "als-meldung", { baseRevision: r, ...basis, bezug: { art: "unfug" } }))).toBe(
            "400 validation_failed",
        );
        expect(code(await schritt(nummer, "als-meldung", { baseRevision: r, ...basis, text: "kurz" }))).toBe(
            "400 validation_failed",
        );
    });

    it("Gesendet: die ausgehenden Nachrichten der Anfragen, neueste zuerst, ohne Papierkorb; die Adresse nur bei einer Mail (bis zum Mailweg nie); Suche; nur mit `read_mailbox`", async () => {
        const erste = await frage({ text: "Erste Anfrage zum Thema Reisezeiten.\nMit zweiter Zeile." });
        const zweite = await frage({ text: "Zweite Anfrage zum Thema Kartenrechte.", kategorie: "rechte" });
        await schritt(erste.nummer, "antworten", {
            baseRevision: await revisionVon(erste.nummer),
            text: "Antwort eins.",
            archivieren: false,
        });
        await schritt(zweite.nummer, "antworten", {
            baseRevision: await revisionVon(zweite.nummer),
            text: "Antwort zwei.",
            archivieren: true,
        });
        const antwort = await get("/api/community/gesendet", olaf.cookie);
        expect(code(antwort)).toBe("200");
        expect(Value.Check(GesendetListe, antwort.json())).toBe(true);
        const zeilen = (antwort.json() as GesendetListe).zeilen;
        expect(zeilen.map((z) => z.nummer)).toEqual([zweite.nummer, erste.nummer]);
        expect(zeilen[0]).toMatchObject({
            an: null,
            betreff: "Zweite Anfrage zum Thema Kartenrechte.",
            text: "Antwort zwei.",
            weg: "statusseite",
            von: { id: olaf.id },
        });
        expect(zeilen[1]!.betreff).toBe("Erste Anfrage zum Thema Reisezeiten.");
        const suche = (await get("/api/community/gesendet?q=Antwort%20eins", olaf.cookie)).json() as GesendetListe;
        expect(suche.zeilen.map((z) => z.nummer)).toEqual([erste.nummer]);
        const nachNummer = (
            await get(`/api/community/gesendet?q=${zweite.nummer}`, olaf.cookie)
        ).json() as GesendetListe;
        expect(nachNummer.zeilen.map((z) => z.nummer)).toEqual([zweite.nummer]);
        // Der Papierkorb gehört nicht dazu.
        await schritt(erste.nummer, "papierkorb", { baseRevision: await revisionVon(erste.nummer) });
        expect(
            ((await get("/api/community/gesendet", olaf.cookie)).json() as GesendetListe).zeilen.map((z) => z.nummer),
        ).toEqual([zweite.nummer]);
        expect((await get("/api/community/gesendet")).statusCode).toBe(401);
    });

    it("Papierkorb für Anfragen: Spam (nur Betreiber mit `moderate_community` und `read_mailbox`), Liste und Wiederherstellen", async () => {
        const { nummer } = await frage({ text: "Kaufen Sie jetzt billige Uhren auf unserer Seite!" });
        expect(code(await schritt(nummer, "papierkorb", { baseRevision: await revisionVon(nummer) }))).toBe("200");
        const korb = await liste("/api/community/vorgaenge?art=anfrage&segment=papierkorb");
        expect(korb.zeilen.map((z) => z.nummer)).toEqual([nummer]);
        expect(korb.zaehler).toMatchObject({ papierkorb: 1, eingang: 0 });
        expect((await liste("/api/community/vorgaenge?art=anfrage&segment=eingang")).zeilen).toEqual([]);
        // Wiederherstellen.
        expect(code(await schritt(nummer, "wiederherstellen", { baseRevision: await revisionVon(nummer) }))).toBe(
            "200",
        );
        expect(
            (await liste("/api/community/vorgaenge?art=anfrage&segment=eingang")).zeilen.map((z) => z.nummer),
        ).toEqual([nummer]);
    });

    it("Zuständig: bei einer Anfrage nur Personen mit `read_mailbox`; das Menü der Personen kennt sie", async () => {
        const { nummer } = await frage();
        const personen = await get("/api/community/personen?mails=true", olaf.cookie);
        expect(code(personen)).toBe("200");
        const ids = (personen.json() as { id: string }[]).map((p) => p.id);
        expect(ids).toContain(olaf.id);
        expect(ids).not.toContain(lena.id);
        expect(ids).not.toContain(adrian.id);
        const rev = await revisionVon(nummer);
        expect(code(await schritt(nummer, "zustaendig", { baseRevision: rev, person: lena.id }))).toBe(
            "422 community_invalid",
        );
        expect(code(await schritt(nummer, "zustaendig", { baseRevision: rev, person: olaf.id }))).toBe("200");
        expect((await detail(nummer)).zeile.zustaendig).toEqual({ id: olaf.id, name: "Olaf" });
    });

    it("🔴 Das Protokoll der Mails trägt nie Adresse, Name oder Text", async () => {
        const { nummer } = await frage({ text: "Ein Text mit Inhalt, der nicht ins Protokoll gehört." });
        await schritt(nummer, "antworten", {
            baseRevision: await revisionVon(nummer),
            text: "Geheime Antwort.",
            archivieren: true,
        });
        await schritt(nummer, "zurueck-in-eingang", { baseRevision: await revisionVon(nummer) });
        await schritt(nummer, "als-meldung", {
            baseRevision: await revisionVon(nummer),
            kategorie: "sonstiges",
            text: "Meldung mit geheimem Inhalt zum Test.",
            bezug: { art: "stelle", lage: { x: 5, y: 6 } },
        });
        const alles = await database<{ details: unknown; target_ref: string | null }[]>`
            SELECT details, target_ref FROM avesmaps_auth.security_event WHERE action LIKE 'system.community_%'
        `;
        expect(alles.length).toBeGreaterThanOrEqual(3);
        const text = JSON.stringify(alles);
        for (const geheim of [
            MAIL,
            MAIL.toLowerCase(),
            "Alrike",
            "Geheime Antwort",
            "geheimem Inhalt",
            "Ein Text mit Inhalt",
        ]) {
            expect(text, geheim).not.toContain(geheim);
        }
    });
});
