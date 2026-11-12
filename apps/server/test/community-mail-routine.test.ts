import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    AVENTURIA,
    MAIL_ABRUF_ERGEBNISSE,
    MAIL_ADMIN_URL,
    MAIL_VERSAND_ERGEBNISSE,
    MailStand,
    type MailRoutineArt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import {
    COMMUNITY_MAIL_ABRUF_KIND,
    MAIL_ABRUF_DAUERHAFT,
    MAIL_ABRUF_GESTOERT,
} from "../src/community/mail/konfiguration.ts";
import { AbrufStoerung, abrufFehler, type PostfachQuelle } from "../src/community/mail/postfach.ts";
import { leseSchalterOderAn, trageLaufEin, type MailUebersicht } from "../src/community/mail/routine.ts";
import { baueMailStand, ordnerAus } from "../src/community/mail/stand.ts";
import type { ImapAblage, ImapAblageFabrik } from "../src/community/mail/gesendet-kopie.ts";
import type { MailNachricht, MailTransport, TransportFabrik } from "../src/community/mail/versand.ts";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import { runCommunityMailAbrufJob } from "../src/jobs/community-mail-abruf-job.ts";
import { COMMUNITY_MAIL_VERSAND_KIND, runCommunityMailVersandJob } from "../src/jobs/community-mail-job.ts";
import { JobWorker, type WorkerLogger } from "../src/jobs/worker.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { fakeMemory, fakeSpawner, testJobsConfig, uniqueScope } from "./support/jobs-support.ts";

/**
 * Das Panel „Mailpostfach“ (WI-0268 C6c, Migration 0289): der Stand ohne Geheimnisse, der Schalter von Abruf und Versand mit Passkey, und was er in den Jobs bewirkt.
 *
 * - Ohne Datenbank: der Stand (Rangfolge der Gründe, `wartenBis`, `nicht_eingerichtet` als Vorbehalt), nie ein Geheimnis darin; ein nicht lesbarer Schalter gilt als „an“, ein nicht eintragbarer Lauf bricht nichts ab.
 * - Mit Datenbank: die Funktionen (festes Wortschatz, Idempotenz), die Route (Rechte, Passkey, Protokoll, Wiedereinschalten reiht nach), die Pflege (Abruf aus: nichts eingereiht), der Abrufjob (aus: keine
 *   Verbindung) und der Versandjob (aus: zurückgehalten, kein Versuch gezählt).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

// Erfundene Werte: Jeder davon darf in keiner Antwort, keinem Protokoll und keiner Zeile von `mail_routine` stehen.
const NUTZER = "redaktion-konto@example.org";
const KENNWORT = "geheim-kennwort-4711";
const ABSENDER_ADRESSE = "info-panel@avesmaps.example";
const ABSENDER = `Avesmaps-Redaktion <${ABSENDER_ADRESSE}>`;
const IMAP_HOST = "imap.example.invalid";
const SMTP_HOST = "smtp.example.invalid";
const ORDNER = "Panel-Test";
const ABLAGE_MARKE = "geheime-ablage-marke";
const GEHEIMNISSE = [NUTZER, KENNWORT, ABSENDER_ADRESSE, ABLAGE_MARKE];

const umgebung = (ablage: string, teil: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
    COMMUNITY_MAIL_IMAP_HOST: IMAP_HOST,
    COMMUNITY_MAIL_ORDNER: ORDNER,
    COMMUNITY_MAIL_SMTP_HOST: SMTP_HOST,
    COMMUNITY_MAIL_SMTP_PORT: "587",
    COMMUNITY_MAIL_USER: NUTZER,
    COMMUNITY_MAIL_PASSWORD: KENNWORT,
    COMMUNITY_MAIL_FROM: ABSENDER,
    COMMUNITY_MAIL_ABLAGE: ablage,
    ...teil,
});
const ABLAGE_PFAD = join(tmpdir(), `${ABLAGE_MARKE}-stand`);

const JETZT = new Date("2026-11-01T12:00:00.000Z");
const vor = (stunden: number): string => new Date(JETZT.getTime() - stunden * 3_600_000).toISOString();

const routine = (aktiv = true) => ({
    aktiv,
    geaendertAt: aktiv ? null : vor(2),
    geaendertVon: aktiv ? null : "Rondrikan",
    letzterLauf: null,
    letzterErfolg: null,
});
const uebersicht = (teil: Partial<MailUebersicht> = {}): MailUebersicht => ({
    routinen: { abruf: routine(), versand: routine() },
    startpunkt: { uidValidity: 1782729528, letzteUid: 275 },
    wartend: 0,
    fehler7Tage: 0,
    letzteMailAt: null,
    ...teil,
});
const stand = (teil: Partial<MailUebersicht> = {}, env: NodeJS.ProcessEnv = umgebung(ABLAGE_PFAD)) =>
    baueMailStand({ umgebung: env, uebersicht: uebersicht(teil), jetzt: JETZT });

describe("Panel Mailpostfach: der Stand (ohne Datenbank)", () => {
    it("🔴 der Stand sagt nur, OB der Zugang da ist, und nennt Server und Ordner; nie Nutzer, Kennwort, Absenderadresse oder Ablagepfad", () => {
        const s = stand();
        expect(Value.Check(MailStand, s)).toBe(true);
        const text = JSON.stringify(s);
        for (const geheimnis of GEHEIMNISSE) expect(text).not.toContain(geheimnis);
        expect(s.abruf).toMatchObject({
            betrieb: "holt_ab",
            grund: null,
            wartenBis: null,
            zugang: "hinterlegt",
            server: IMAP_HOST,
            ordner: ORDNER,
            startpunkt: { uidValidity: 1782729528, letzteUid: 275 },
        });
        expect(s.versand).toMatchObject({ betrieb: "sendet", grund: null, zugang: "hinterlegt", server: SMTP_HOST });
    });

    it("🔴 fehlt eine Angabe, ist der Zugang „fehlt“ und der Grund zuerst „zugang_fehlt“, auch bei ausgeschalteter Routine; ein kaputter Host wird nie ausgeliefert", () => {
        for (const name of ["COMMUNITY_MAIL_USER", "COMMUNITY_MAIL_PASSWORD"]) {
            const s = stand(
                { routinen: { abruf: routine(false), versand: routine(false) } },
                umgebung(ABLAGE_PFAD, { [name]: undefined }),
            );
            expect(s.abruf, name).toMatchObject({ betrieb: "holt_nicht_ab", grund: "zugang_fehlt", zugang: "fehlt" });
            expect(s.versand, name).toMatchObject({ betrieb: "sendet_nicht", grund: "zugang_fehlt", zugang: "fehlt" });
        }
        // Jeder Weg hat eigene Angaben: Die Ablage gehört nur zum Abruf, der SMTP-Host nur zum Versand.
        const ohneAblage = stand({}, umgebung(ABLAGE_PFAD, { COMMUNITY_MAIL_ABLAGE: undefined }));
        expect(ohneAblage.abruf).toMatchObject({ betrieb: "holt_nicht_ab", grund: "zugang_fehlt" });
        expect(ohneAblage.versand).toMatchObject({ betrieb: "sendet", zugang: "hinterlegt" });
        const ohneSmtp = stand({}, umgebung(ABLAGE_PFAD, { COMMUNITY_MAIL_SMTP_HOST: undefined }));
        expect(ohneSmtp.versand).toMatchObject({ betrieb: "sendet_nicht", grund: "zugang_fehlt", server: null });
        expect(ohneSmtp.abruf.zugang).toBe("hinterlegt");
        const ohneHost = stand({}, umgebung(ABLAGE_PFAD, { COMMUNITY_MAIL_IMAP_HOST: "imap.example.org/../x" }));
        expect(ohneHost.abruf.server).toBeNull();
        expect(ohneHost.abruf.grund).toBe("zugang_fehlt");
        const ohneAlles = stand({}, {});
        expect(ohneAlles.abruf).toMatchObject({ zugang: "fehlt", server: null, ordner: "INBOX" });
        expect(ohneAlles.versand).toMatchObject({ zugang: "fehlt", server: null });
        // Ein Ordner mit Steuerzeichen oder über 200 Zeichen wird nie ausgeliefert, es gilt die Vorgabe.
        expect(ordnerAus({ COMMUNITY_MAIL_ORDNER: "In\nbox" })).toBe("INBOX");
        expect(ordnerAus({ COMMUNITY_MAIL_ORDNER: "x".repeat(201) })).toBe("INBOX");
        expect(ordnerAus({ COMMUNITY_MAIL_ORDNER: " Eingang " })).toBe("Eingang");
    });

    it("ausgeschaltet: der Schalter stellt den Betrieb auf „holt nicht ab“ bzw. „sendet nicht“", () => {
        const s = stand({ routinen: { abruf: routine(false), versand: routine(false) } });
        expect(s.abruf).toMatchObject({
            betrieb: "holt_nicht_ab",
            grund: "ausgeschaltet",
            routine: { aktiv: false, geaendertVon: "Rondrikan" },
        });
        expect(s.versand).toMatchObject({ betrieb: "sendet_nicht", grund: "ausgeschaltet" });
        // Ohne Zeilen (vor der Migration) gilt die Vorgabe: an.
        const ohneZeilen = stand({ routinen: {} });
        expect(ohneZeilen.abruf.routine).toEqual({ aktiv: true, geaendertAt: null, geaendertVon: null });
        expect(ohneZeilen.versand.betrieb).toBe("sendet");
    });

    it("Anmeldung abgelehnt: sechs Stunden Wartezeit nach dem Lauf, solange sie in der Zukunft liegt; auch „ordner_fehlt“ zählt dazu", () => {
        const mit = (ergebnis: string, stunden: number) =>
            stand({
                routinen: {
                    abruf: { ...routine(), letzterLauf: { at: vor(stunden), ergebnis } },
                    versand: routine(),
                },
            }).abruf;
        const frisch = mit("anmeldung_abgelehnt", 1);
        expect(frisch).toMatchObject({
            betrieb: "holt_nicht_ab",
            grund: "anmeldung_abgelehnt",
            wartenBis: new Date(JETZT.getTime() + 5 * 3_600_000).toISOString(),
            letzterLauf: { ergebnis: "anmeldung_abgelehnt" },
        });
        expect(mit("ordner_fehlt", 2)).toMatchObject({ betrieb: "holt_nicht_ab", grund: "anmeldung_abgelehnt" });
        // Nach den sechs Stunden fragt die Pflege wieder; der letzte Lauf bleibt als Auskunft stehen.
        expect(mit("anmeldung_abgelehnt", 6)).toMatchObject({ betrieb: "holt_ab", grund: null, wartenBis: null });
        expect(mit("anmeldung_abgelehnt", 7).letzterLauf).toMatchObject({ ergebnis: "anmeldung_abgelehnt" });
        // Eine vorübergehende Störung wartet nicht (die Pflege fragt im nächsten Takt).
        expect(mit("gestoert", 0)).toMatchObject({ betrieb: "holt_ab", grund: null });
    });

    it("🔴 „nicht eingerichtet“ heißt: Zugang da, aber kein Startpunkt. Der Abruf holt dann trotzdem ab (die Pflege reiht nur nach der Umgebung ein): ein Vorbehalt, kein Stillstand", () => {
        const s = stand({ startpunkt: null });
        expect(s.abruf).toMatchObject({ betrieb: "holt_ab", grund: "nicht_eingerichtet", startpunkt: null });
        // Ohne Zugang oder mit ausgeschalteter Routine bleibt der härtere Grund.
        expect(stand({ startpunkt: null }, {}).abruf.grund).toBe("zugang_fehlt");
        expect(stand({ startpunkt: null, routinen: { abruf: routine(false) } }).abruf.grund).toBe("ausgeschaltet");
    });

    it("der letzte Lauf und Erfolg kommen aus der festen Liste: Zahlen als ganze Zahlen, ein fremdes Wort wird nie ausgeliefert; der Versand zählt wartende Mails und Fehler", () => {
        const s = stand({
            routinen: {
                abruf: {
                    ...routine(),
                    letzterLauf: { at: vor(0.1), ergebnis: "gelesen" },
                    letzterErfolg: { at: vor(0.1), zahlen: { neu: 2, angehaengt: 1, unlesbar: 0, zu_gross: 3 } },
                },
                versand: {
                    ...routine(),
                    letzterLauf: { at: vor(1), ergebnis: "Server sagt: nutzer@example.org abgelehnt" },
                    letzterErfolg: { at: vor(3), zahlen: {} },
                },
            },
            wartend: 4,
            fehler7Tage: 2,
            letzteMailAt: vor(5),
        });
        expect(s.abruf.letzterErfolg).toEqual({ at: vor(0.1), neu: 2, angehaengt: 1, unlesbar: 0, zuGross: 3 });
        expect(s.abruf.letzteMailAt).toBe(vor(5));
        // Ein Wort außerhalb der Liste gelangt nicht in die Antwort (die Datenbank lässt es ohnehin nicht zu).
        expect(s.versand.letzterLauf).toBeNull();
        expect(s.versand).toMatchObject({ letzterErfolg: { at: vor(3) }, wartend: 4, fehler7Tage: 2 });
        expect(s.versand.letzterErfolg).not.toHaveProperty("kopieFehlt");
        expect(Value.Check(MailStand, s)).toBe(true);
        // Die Mail ging hinaus, die Kopie in „Gesendet“ nicht (C6d).
        const ohneKopie = stand({
            routinen: { versand: { ...routine(), letzterErfolg: { at: vor(3), zahlen: { kopie_fehlt: 1 } } } },
        });
        expect(ohneKopie.versand.letzterErfolg).toEqual({ at: vor(3), kopieFehlt: true });
        expect(Value.Check(MailStand, ohneKopie)).toBe(true);
        for (const wort of MAIL_ABRUF_ERGEBNISSE) {
            const lauf = stand({ routinen: { abruf: { ...routine(), letzterLauf: { at: vor(9), ergebnis: wort } } } });
            expect(lauf.abruf.letzterLauf?.ergebnis).toBe(wort);
        }
        for (const wort of MAIL_VERSAND_ERGEBNISSE) {
            const lauf = stand({
                routinen: { versand: { ...routine(), letzterLauf: { at: vor(9), ergebnis: wort } } },
            });
            expect(lauf.versand.letzterLauf?.ergebnis).toBe(wort);
        }
    });
});

describe("Panel Mailpostfach: Schalter und Lauf der Jobs, wenn die Datenbank sie nicht kennt", () => {
    const fehlt = (code: string): Queryable => {
        const aufruf = (): Promise<never> =>
            Promise.reject(Object.assign(new Error(`Text mit ${KENNWORT} und ${NUTZER}`), { code }));
        return Object.assign(aufruf, { json: (wert: unknown) => wert }) as unknown as Queryable;
    };

    it("🔴 ein nicht lesbarer Schalter gilt als „an“ (die .env ist das erste Tor), und die Warnung nennt nur den SQLSTATE", async () => {
        for (const code of ["42883", "42501", "42P01"]) {
            const warnungen: string[] = [];
            const schalter = await leseSchalterOderAn(fehlt(code), (text) => warnungen.push(text), "Mailabruf");
            expect(schalter).toEqual({ abruf: true, versand: true });
            expect(warnungen).toHaveLength(1);
            expect(warnungen[0]).toContain(`SQLSTATE ${code}`);
            for (const geheimnis of [KENNWORT, NUTZER]) expect(warnungen[0]).not.toContain(geheimnis);
        }
    });

    it("🔴 ein Lauf, der sich nicht eintragen lässt, bricht nichts ab: nur eine Warnung mit dem SQLSTATE", async () => {
        const warnungen: string[] = [];
        await expect(
            trageLaufEin(fehlt("42883"), "abruf", "gelesen", { neu: 1 }, (text) => warnungen.push(text)),
        ).resolves.toBeUndefined();
        expect(warnungen).toHaveLength(1);
        expect(warnungen[0]).toContain("SQLSTATE 42883");
        for (const geheimnis of [KENNWORT, NUTZER]) expect(warnungen[0]).not.toContain(geheimnis);
    });
});

// --- Mit Datenbank ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

function serverConfig(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "community-mail-routine-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

const kontext = (input: Record<string, unknown> = {}): JobContext => ({
    input,
    attempt: 1,
    job: { id: 1, publicId: randomUUID(), leaseNo: 1, mapDomainId: AVENTURIA.mapDomain },
    beginPhase: () => Promise.resolve(),
    checkpoint: () => undefined,
});

/** Eine Datenbank, die die Funktionen des Schalters nicht kennt (Release vor der Migration): jeder Aufruf scheitert mit 42883, alles andere läuft. */
function ohneSchalter(db: Database): Database {
    return new Proxy(db, {
        apply(ziel, dies, args: unknown[]) {
            const texte = args[0];
            const sql = Array.isArray(texte) ? (texte as string[]).join("?") : "";
            if (sql.includes("community_mail_routinen") || sql.includes("community_mail_lauf"))
                return Promise.reject(Object.assign(new Error("function does not exist"), { code: "42883" }));
            return Reflect.apply(ziel as unknown as (...a: unknown[]) => unknown, dies, args);
        },
    });
}

describeWithDatabase("Panel Mailpostfach: Funktionen, Route und Jobs (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let betreiber: { id: string; cookie: string; frisch: string };
    let admin: { cookie: string };
    let editor: { cookie: string };
    let ablage: string;
    const gesichert: Record<string, string | undefined> = {};
    const env = umgebung("");

    async function zuruecksetzen(): Promise<void> {
        await database`
            UPDATE avesmaps_community.mail_routine
               SET aktiv = true, geaendert_at = NULL, geaendert_von = NULL, letzter_lauf = NULL, letzter_lauf_at = NULL,
                   letzter_erfolg = NULL, letzter_erfolg_at = NULL
        `;
        await database`DELETE FROM job WHERE kind = ANY(${[COMMUNITY_MAIL_ABRUF_KIND, COMMUNITY_MAIL_VERSAND_KIND]})`;
        await database`DELETE FROM avesmaps_community.vorgang`;
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ${betreiber.id}::uuid`;
        await database`DELETE FROM avesmaps_community.mail_abruf_stand WHERE ordner = ${ORDNER}`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE action = 'system.community_mail_routine'`;
    }

    beforeAll(async () => {
        ablage = await mkdtemp(join(tmpdir(), `${ABLAGE_MARKE}-`));
        env["COMMUNITY_MAIL_ABLAGE"] = ablage;
        for (const name of Object.keys(env)) gesichert[name] = process.env[name];
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        app = buildApp({
            config: serverConfig(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const op = await fixture.person("operator", { name: "Rondrikan" });
        const alt = await fixture.session(op.id, { assurance: "strong", passkeyMinutesAgo: 60 });
        const frisch = await fixture.session(op.id, { assurance: "strong", passkeyMinutesAgo: 0 });
        betreiber = { id: op.id, cookie: alt.cookie, frisch: frisch.cookie };
        const ad = await fixture.person("admin", { name: "Adrian" });
        admin = { cookie: (await fixture.session(ad.id, { assurance: "strong", passkeyMinutesAgo: 0 })).cookie };
        const ed = await fixture.person("editor", { name: "Editha" });
        editor = { cookie: (await fixture.session(ed.id, { assurance: "strong", passkeyMinutesAgo: 0 })).cookie };
    });

    beforeEach(async () => {
        for (const [name, wert] of Object.entries(env)) {
            if (wert === undefined) delete process.env[name];
            else process.env[name] = wert;
        }
        await zuruecksetzen();
    });

    afterAll(async () => {
        for (const [name, wert] of Object.entries(gesichert)) {
            if (wert === undefined) delete process.env[name];
            else process.env[name] = wert;
        }
        await app?.close();
        // 🔴 Die Schalter stehen danach wieder auf „an“: Die Tests der Jobs und der Pflege teilen sich die Tafel.
        await zuruecksetzen().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (ablage !== undefined) await rm(ablage, { recursive: true, force: true });
    });

    // --- Hilfen -----------------------------------------------------------------------------------------------------------

    const get = (cookie?: string) =>
        app.inject({ method: "GET", url: MAIL_ADMIN_URL, headers: cookie === undefined ? {} : { cookie } });
    const schalte = (cookie: string, art: string, aktiv: boolean, operationId: string = randomUUID()) =>
        app.inject({
            method: "POST",
            url: `${MAIL_ADMIN_URL}/routine`,
            payload: { operationId, art, aktiv },
            headers: { cookie, origin: TEST_ORIGIN },
        });
    const zeile = async (art: MailRoutineArt) => {
        const [row] = await database<
            {
                aktiv: boolean;
                geaendert_at: Date | null;
                geaendert_von: string | null;
                letzter_lauf: string | null;
                letzter_erfolg: Record<string, number> | null;
            }[]
        >`SELECT aktiv, geaendert_at, geaendert_von, letzter_lauf, letzter_erfolg FROM avesmaps_community.mail_routine WHERE art = ${art}`;
        return row!;
    };
    const versandJobs = () =>
        database<
            { state: string; input_ref: { ausgang: number } }[]
        >`SELECT state, input_ref FROM job WHERE kind = ${COMMUNITY_MAIL_VERSAND_KIND} ORDER BY id`;
    const abrufJobs = () =>
        database<{ state: string }[]>`SELECT state FROM job WHERE kind = ${COMMUNITY_MAIL_ABRUF_KIND}`;
    const ereignisse = () =>
        database<{ details: Record<string, unknown>; target_ref: string }[]>`
            SELECT details, target_ref FROM avesmaps_auth.security_event WHERE action = 'system.community_mail_routine' ORDER BY id
        `;

    /** Eine wartende Mail über die Funktionen der App (wie die Route): Anfrage, Antwort per Mail. */
    async function wartendeMail(): Promise<number> {
        const [angelegt] = await database<{ id: string }[]>`
            SELECT avesmaps_community.community_anfragen(
                ${randomUUID()}::uuid, 'frage', 'Eine Frage zur Karte, bitte um Antwort.', 'Alrike', ${"alrike@example.org"}, ${randomBytes(32)}
            )::text AS id
        `;
        const id = Number(angelegt!.id);
        const [v] = await database<
            { revision: number }[]
        >`SELECT revision FROM avesmaps_community.vorgang WHERE id = ${id}::bigint`;
        const [antwort] = await database<{ ergebnis: { ausgang: number } }[]>`
            SELECT avesmaps_community.community_anfrage_antworten_mail(
                ${randomUUID()}::uuid, ${id}::bigint, ${betreiber.id}::uuid, ${v!.revision}::int, 'Antwort per Mail.', false, 'avesmaps.example'
            ) AS ergebnis
        `;
        return Number(antwort!.ergebnis.ausgang);
    }
    const ausgangZeile = async (id: number) => {
        const [row] = await database<
            { zustand: string; versuche: number; reserviert_bis: Date | null }[]
        >`SELECT zustand, versuche, reserviert_bis FROM avesmaps_community.mail_ausgang WHERE id = ${id}::bigint`;
        return row!;
    };

    // --- Die Funktionen -----------------------------------------------------------------------------------------------------

    it("🔴 beide Schalter entstehen AN (Production läuft schon); die Funktionen nehmen nur Wörter der festen Liste und ganze Zahlen", async () => {
        const [schalter] = await database<
            { s: { abruf: boolean; versand: boolean } }[]
        >`SELECT avesmaps_community.community_mail_routinen() AS s`;
        expect(schalter!.s).toEqual({ abruf: true, versand: true });
        const lauf = (art: string, ergebnis: string, zahlen: unknown, erfolg: boolean) =>
            database`SELECT avesmaps_community.community_mail_lauf(${art}, ${ergebnis}, ${database.json(zahlen as never)}::jsonb, ${erfolg})`;
        await lauf("abruf", "gelesen", { neu: 2, angehaengt: 1, unlesbar: 0, zu_gross: 0 }, true);
        expect(await zeile("abruf")).toMatchObject({
            letzter_lauf: "gelesen",
            letzter_erfolg: { neu: 2, angehaengt: 1, unlesbar: 0, zu_gross: 0 },
        });
        // Ein Fehler überschreibt den letzten Lauf, nicht den letzten Erfolg.
        await lauf("abruf", "gestoert", {}, false);
        expect(await zeile("abruf")).toMatchObject({ letzter_lauf: "gestoert", letzter_erfolg: { neu: 2 } });
        for (const [art, ergebnis, zahlen, erfolg] of [
            ["post", "gelesen", {}, true],
            ["abruf", "Der Server sagt: nutzer@example.org gesperrt", {}, false],
            ["abruf", "gesendet", {}, true],
            ["versand", "gelesen", {}, true],
            ["abruf", "gelesen", {}, false],
            ["abruf", "gestoert", {}, true],
            ["abruf", "gelesen", { neu: "viele" }, true],
            ["abruf", "gelesen", { neu: { tief: 1 } }, true],
            ["abruf", "gelesen", { Neu: 1 }, true],
            ["abruf", "gelesen", [1, 2], true],
        ] as const) {
            await expect(
                lauf(art, ergebnis, zahlen, erfolg),
                `${art} ${ergebnis} ${JSON.stringify(zahlen)}`,
            ).rejects.toMatchObject({ code: "KC422" });
        }
        await lauf("versand", "gesendet", {}, true);
        expect(await zeile("versand")).toMatchObject({ letzter_lauf: "gesendet" });
    });

    it("🔴 der Schalter ist idempotent: derselbe Zustand ändert „seit“ nicht; eine unbekannte Art oder Person ist KC422 bzw. KC404", async () => {
        const setze = (art: string, aktiv: boolean, person: string = betreiber.id) =>
            database<{ r: { vorher: boolean; nachher: boolean; geaendert: boolean } }[]>`
                SELECT avesmaps_community.community_mail_routine_setzen(${art}, ${aktiv}, ${person}::uuid) AS r
            `;
        expect((await setze("versand", false))[0]!.r).toMatchObject({ vorher: true, nachher: false, geaendert: true });
        const erste = await zeile("versand");
        expect(erste).toMatchObject({ aktiv: false, geaendert_von: betreiber.id });
        await new Promise((r) => setTimeout(r, 15));
        expect((await setze("versand", false))[0]!.r).toMatchObject({
            vorher: false,
            nachher: false,
            geaendert: false,
        });
        expect((await zeile("versand")).geaendert_at).toEqual(erste.geaendert_at);
        await expect(setze("post", true)).rejects.toMatchObject({ code: "KC422" });
        await expect(setze("abruf", true, randomUUID())).rejects.toMatchObject({ code: "KC404" });
        expect((await zeile("abruf")).aktiv).toBe(true);
    });

    it("die Übersicht zählt wartende Mails und Fehler der letzten sieben Tage und nennt Person und Startpunkt; die Liste der Wartenden gibt nur Kennungen", async () => {
        const a = await wartendeMail();
        const b = await wartendeMail();
        const c = await wartendeMail();
        const d = await wartendeMail();
        await database`UPDATE avesmaps_community.mail_ausgang SET zustand = 'fehler', fehler = 'Der Mailserver ist nicht erreichbar' WHERE id = ${c}::bigint`;
        await database`UPDATE avesmaps_community.mail_ausgang SET zustand = 'fehler', fehler = 'alt', angelegt_at = now() - interval '8 days' WHERE id = ${d}::bigint`;
        await database`SELECT avesmaps_community.community_mail_abruf_setzen(${ORDNER}, 7, 42)`;
        await database`SELECT avesmaps_community.community_mail_routine_setzen('abruf', false, ${betreiber.id}::uuid)`;
        const [u] = await database<
            { u: MailUebersicht }[]
        >`SELECT avesmaps_community.community_mail_uebersicht(${ORDNER}) AS u`;
        expect(u!.u).toMatchObject({
            wartend: 2,
            fehler7Tage: 1,
            startpunkt: { uidValidity: 7, letzteUid: 42 },
            routinen: {
                abruf: { aktiv: false, geaendertVon: "Rondrikan" },
                versand: { aktiv: true, geaendertVon: null },
            },
        });
        const [ohne] = await database<
            { u: MailUebersicht }[]
        >`SELECT avesmaps_community.community_mail_uebersicht('Gibt-es-nicht') AS u`;
        expect(ohne!.u.startpunkt).toBeNull();
        const [wartende] = await database<
            { ids: number[] }[]
        >`SELECT avesmaps_community.community_mail_wartende() AS ids`;
        expect(wartende!.ids).toEqual([a, b]);
        expect(JSON.stringify(u!.u)).not.toContain("example.org");
    });

    // --- Die Route ----------------------------------------------------------------------------------------------------------

    it("🔴 der Stand braucht den Betrieb, ist schema-treu und enthält nie Nutzer, Kennwort, Absenderadresse oder Ablagepfad", async () => {
        expect((await get()).statusCode).toBe(401);
        expect((await get(editor.cookie)).statusCode).toBe(403);
        const antwort = await get(admin.cookie);
        expect(antwort.statusCode).toBe(200);
        expect(Value.Check(MailStand, antwort.json())).toBe(true);
        for (const geheimnis of GEHEIMNISSE) expect(antwort.body).not.toContain(geheimnis);
        expect(antwort.json()).toMatchObject({
            abruf: {
                betrieb: "holt_ab",
                zugang: "hinterlegt",
                server: IMAP_HOST,
                ordner: ORDNER,
                grund: "nicht_eingerichtet",
            },
            versand: { betrieb: "sendet", zugang: "hinterlegt", server: SMTP_HOST, wartend: 0, fehler7Tage: 0 },
        });
        // Fehlt eine Angabe der Umgebung, sagt der Stand es, ohne zu verraten, welche.
        delete process.env["COMMUNITY_MAIL_PASSWORD"];
        const ohne = await get(betreiber.cookie);
        expect(ohne.json()).toMatchObject({
            abruf: { betrieb: "holt_nicht_ab", grund: "zugang_fehlt", zugang: "fehlt" },
            versand: { betrieb: "sendet_nicht", grund: "zugang_fehlt", zugang: "fehlt" },
        });
        for (const geheimnis of GEHEIMNISSE) expect(ohne.body).not.toContain(geheimnis);
    });

    it("🔴 der Schalter braucht `manage_system_settings` und einen frischen Passkey, schreibt genau ein Protokoll ohne Person und Adresse; dieselbe Anfrage noch einmal quittiert nur", async () => {
        const kennung = randomUUID();
        expect((await schalte("", "abruf", false)).statusCode).toBe(401);
        expect((await schalte(editor.cookie, "abruf", false)).statusCode).toBe(403);
        // Sehen darf der Admin, schalten nur der Betreiber.
        expect((await schalte(admin.cookie, "abruf", false)).statusCode).toBe(403);
        const alt = await schalte(betreiber.cookie, "abruf", false);
        expect(alt.statusCode).toBe(403);
        expect((alt.json() as { error: { code: string } }).error.code).toBe("reauth_required");
        expect((await schalte(betreiber.frisch, "post", false)).statusCode).toBe(400);
        expect((await zeile("abruf")).aktiv).toBe(true);

        const ok = await schalte(betreiber.frisch, "abruf", false, kennung);
        expect(ok.statusCode).toBe(200);
        expect(ok.json()).toMatchObject({ status: "applied" });
        expect(await zeile("abruf")).toMatchObject({ aktiv: false, geaendert_von: betreiber.id });
        expect(await ereignisse()).toEqual([
            { target_ref: "mail:abruf", details: { art: "abruf", von: "an", nach: "aus", nachgereiht: 0 } },
        ]);
        const noch = await schalte(betreiber.frisch, "abruf", false, kennung);
        expect(noch.json()).toMatchObject({ status: "replayed" });
        expect(await ereignisse()).toHaveLength(1);
        const stand1 = (await get(admin.cookie)).json() as {
            abruf: { betrieb: string; grund: string; routine: Record<string, unknown> };
        };
        expect(stand1.abruf).toMatchObject({
            betrieb: "holt_nicht_ab",
            grund: "ausgeschaltet",
            routine: { aktiv: false, geaendertVon: "Rondrikan" },
        });
        // Der Versand blieb an, und keine Mail ist ins Protokoll gelangt.
        expect((await zeile("versand")).aktiv).toBe(true);
        expect(JSON.stringify(await ereignisse())).not.toContain("example.org");
    });

    it("🔴 den Versand wieder einzuschalten reiht für jede wartende Mail einen Auftrag nach, in derselben Transaktion; Ausschalten, Abruf und Einschalten ohne Wechsel reihen nichts ein", async () => {
        const a = await wartendeMail();
        const b = await wartendeMail();
        const vorher = (await versandJobs()).length;
        // Ausschalten und den Abruf schalten reiht nichts nach.
        expect((await schalte(betreiber.frisch, "versand", false)).statusCode).toBe(200);
        expect((await schalte(betreiber.frisch, "abruf", false)).statusCode).toBe(200);
        expect((await schalte(betreiber.frisch, "abruf", true)).statusCode).toBe(200);
        expect(await versandJobs()).toHaveLength(vorher);
        const stand2 = (await get(admin.cookie)).json() as { versand: { betrieb: string; wartend: number } };
        expect(stand2.versand).toMatchObject({ betrieb: "sendet_nicht", wartend: 2 });
        // Einschalten: zwei Aufträge, einer je wartender Mail, mit nur der Kennung als Eingabe.
        const kennung = randomUUID();
        const an = await schalte(betreiber.frisch, "versand", true, kennung);
        expect(an.statusCode).toBe(200);
        expect(an.json()).toMatchObject({ derivedWork: [{ kind: COMMUNITY_MAIL_VERSAND_KIND, state: "queued" }] });
        const jobs = (await versandJobs()).slice(vorher);
        expect(jobs.map((job) => job.input_ref)).toEqual([{ ausgang: a }, { ausgang: b }]);
        expect(jobs.every((job) => job.state === "QUEUED")).toBe(true);
        expect((await ereignisse()).at(-1)).toMatchObject({
            details: { art: "versand", von: "aus", nach: "an", nachgereiht: 2 },
        });
        // Dieselbe Anfrage noch einmal und ein Einschalten ohne Wechsel reihen nichts ein.
        await schalte(betreiber.frisch, "versand", true, kennung);
        await schalte(betreiber.frisch, "versand", true);
        expect(await versandJobs()).toHaveLength(vorher + 2);
    });

    // --- Die Pflege ---------------------------------------------------------------------------------------------------------

    const pflegeWorker = (db: Database, log?: WorkerLogger) =>
        new JobWorker({
            database: db,
            config: testJobsConfig(),
            mapDomainId: AVENTURIA.mapDomain,
            release: "community-mail-routine-test",
            deriveScope: uniqueScope("derive"),
            spawnChild: fakeSpawner().spawn,
            memory: fakeMemory().probe,
            communityMailAbrufEveryMs: 300_000,
            communityMailAbrufAn: () => true,
            ...(log === undefined ? {} : { log }),
        });

    it("🔴 die Pflege reiht keinen Abruf ein, solange der Schalter aus ist, und danach wieder", async () => {
        await database`SELECT avesmaps_community.community_mail_routine_setzen('abruf', false, ${betreiber.id}::uuid)`;
        expect(await pflegeWorker(database).pflege()).toMatchObject({ communityMailAbruf: false });
        expect(await abrufJobs()).toEqual([]);
        // Der Schalter des Versands gilt dem Abruf nicht.
        await database`SELECT avesmaps_community.community_mail_routine_setzen('abruf', true, ${betreiber.id}::uuid)`;
        await database`SELECT avesmaps_community.community_mail_routine_setzen('versand', false, ${betreiber.id}::uuid)`;
        expect(await pflegeWorker(database).pflege()).toMatchObject({ communityMailAbruf: true });
        expect(await abrufJobs()).toHaveLength(1);
    });

    it("🔴 kann die Pflege den Schalter nicht lesen (Funktion oder Recht fehlt), verhält sie sich wie bisher und warnt mit dem SQLSTATE", async () => {
        const warnungen: string[] = [];
        const log: WorkerLogger = {
            info: () => undefined,
            warn: (_felder, text) => void warnungen.push(text),
            error: () => undefined,
        };
        await database`SELECT avesmaps_community.community_mail_routine_setzen('abruf', false, ${betreiber.id}::uuid)`;
        // Der Schalter steht in der Datenbank auf aus, die Pflege sieht ihn aber nicht: Die .env ist das erste Tor, es gilt „an“.
        expect(await pflegeWorker(ohneSchalter(database), log).pflege()).toMatchObject({ communityMailAbruf: true });
        expect(warnungen.some((text) => text.includes("SQLSTATE 42883"))).toBe(true);
        expect(await abrufJobs()).toHaveLength(1);
    });

    // --- Der Abrufjob -------------------------------------------------------------------------------------------------------

    const rohMail = (): Buffer =>
        Buffer.from(
            [
                `Message-ID: <panel-${randomUUID()}@mail.example.org>`,
                "From: Alrike <alrike@example.org>",
                "To: Avesmaps <info@avesmaps.example>",
                "Subject: Frage zur Karte",
                "Date: Sat, 31 Oct 2026 10:00:00 +0100",
                "MIME-Version: 1.0",
                "Content-Type: text/plain; charset=utf-8",
                "",
                "Darf die Karte fuer ein Spielleiterhandbuch verwendet werden? Vielen Dank!",
            ].join("\r\n"),
            "utf8",
        );
    /** Eine gestellte Quelle: zählt, wie oft das Postfach gefragt wurde (ein Aufruf wäre eine Verbindung). */
    function quelle(mails: Buffer[] = [], fehler?: unknown) {
        let aufrufe = 0;
        let uid = 0;
        const q: PostfachQuelle = {
            lies() {
                aufrufe += 1;
                if (fehler !== undefined) return Promise.reject(fehler);
                return Promise.resolve({ uidValidity: 1, nachrichten: mails.map((roh) => ({ uid: ++uid, roh })) });
            },
        };
        return { quelle: q, aufrufe: () => aufrufe };
    }
    const abruf = (q: PostfachQuelle, warnungen: string[] = []) =>
        runCommunityMailAbrufJob(kontext(), {
            database,
            environment: env,
            quelle: () => q,
            warnung: (text) => void warnungen.push(text),
        });

    it("🔴 Abruf aus: der Job endet beim Start OHNE Verbindung zum Postfach mit „ausgeschaltet“ und trägt es ein; wieder an, liest er und trägt „gelesen“ mit den Zahlen ein", async () => {
        await database`SELECT avesmaps_community.community_mail_routine_setzen('abruf', false, ${betreiber.id}::uuid)`;
        const aus = quelle([rohMail()]);
        expect(await abruf(aus.quelle)).toMatchObject({ ergebnis: "ausgeschaltet", gelesen: 0, neu: 0 });
        expect(aus.aufrufe()).toBe(0);
        expect(await zeile("abruf")).toMatchObject({ letzter_lauf: "ausgeschaltet" });
        // Weder Stand noch Mail: Der Job hat das Postfach nicht berührt.
        expect(await database`SELECT 1 FROM avesmaps_community.mail_abruf_stand WHERE ordner = ${ORDNER}`).toHaveLength(
            0,
        );

        await database`SELECT avesmaps_community.community_mail_routine_setzen('abruf', true, ${betreiber.id}::uuid)`;
        const an = quelle([rohMail()]);
        expect(await abruf(an.quelle)).toMatchObject({ ergebnis: "gelesen", gelesen: 1, neu: 1 });
        expect(an.aufrufe()).toBe(1);
        expect(await zeile("abruf")).toMatchObject({
            letzter_lauf: "gelesen",
            letzter_erfolg: { neu: 1, angehaengt: 0, unlesbar: 0, zu_gross: 0 },
        });
    });

    it("🔴 ohne Zugang trägt der Abrufjob „zugang_fehlt“ ein und öffnet nichts; ein Fehler des Postfachs wird ein Wort aus der Liste, nie ein Text", async () => {
        const leer = quelle();
        const ohneZugang = await runCommunityMailAbrufJob(kontext(), {
            database,
            environment: umgebung(ablage, { COMMUNITY_MAIL_PASSWORD: undefined }),
            quelle: () => leer.quelle,
        });
        expect(ohneZugang).toMatchObject({ ergebnis: "aus" });
        expect(leer.aufrufe()).toBe(0);
        expect(await zeile("abruf")).toMatchObject({ letzter_lauf: "zugang_fehlt" });

        const faelle: [Record<string, unknown>, string, string][] = [
            [{ authenticationFailed: true }, "anmeldung_abgelehnt", MAIL_ABRUF_DAUERHAFT],
            [{ code: "NONEXISTENT" }, "ordner_fehlt", MAIL_ABRUF_DAUERHAFT],
            [{ code: "ECONNREFUSED" }, "gestoert", MAIL_ABRUF_GESTOERT],
            [{}, "gestoert", MAIL_ABRUF_GESTOERT],
        ];
        for (const [extra, wort, code] of faelle) {
            const mitGeheimnis = Object.assign(new Error(`LOGIN ${NUTZER} ${KENNWORT} failed at ${IMAP_HOST}`), extra);
            const fehler = await abruf(quelle([], abrufFehler(mitGeheimnis)).quelle).catch((f: unknown) => f);
            expect(fehler, JSON.stringify(extra)).toMatchObject({ code });
            const roh = await zeile("abruf");
            expect(roh.letzter_lauf, JSON.stringify(extra)).toBe(wort);
            for (const geheimnis of [NUTZER, KENNWORT, IMAP_HOST]) expect(JSON.stringify(roh)).not.toContain(geheimnis);
        }
        // Ein Postfach ohne UIDVALIDITY ist dauerhaft wie ein fehlender Ordner.
        await abruf(quelle([], new AbrufStoerung("Das Postfach nennt keine UIDVALIDITY", false)).quelle).catch(
            () => undefined,
        );
        expect((await zeile("abruf")).letzter_lauf).toBe("ordner_fehlt");
    });

    it("🔴 kann der Abrufjob den Schalter nicht lesen oder den Lauf nicht eintragen, läuft er wie bisher und warnt nur mit dem SQLSTATE", async () => {
        await database`SELECT avesmaps_community.community_mail_routine_setzen('abruf', false, ${betreiber.id}::uuid)`;
        const warnungen: string[] = [];
        const q = quelle([rohMail()]);
        const ergebnis = await runCommunityMailAbrufJob(kontext(), {
            database: ohneSchalter(database),
            environment: env,
            quelle: () => q.quelle,
            warnung: (text) => void warnungen.push(text),
        });
        expect(ergebnis).toMatchObject({ ergebnis: "gelesen", neu: 1 });
        expect(q.aufrufe()).toBe(1);
        expect(warnungen).toHaveLength(2);
        for (const text of warnungen) expect(text).toContain("SQLSTATE 42883");
        // Nichts wurde eingetragen.
        expect((await zeile("abruf")).letzter_lauf).toBeNull();
    });

    // --- Der Versandjob -----------------------------------------------------------------------------------------------------

    function transport(fehler?: Record<string, unknown>) {
        const gesendet: MailNachricht[] = [];
        const fabrik: TransportFabrik = () =>
            ({
                sendMail(nachricht: MailNachricht) {
                    if (fehler !== undefined)
                        return Promise.reject(Object.assign(new Error(`535 ${KENNWORT} ${NUTZER}`), fehler));
                    gesendet.push(nachricht);
                    return Promise.resolve({});
                },
            }) satisfies MailTransport;
        return { fabrik, gesendet };
    }
    /** Ein gestellter IMAP-Client der Kopie in „Gesendet“; zeichnet auf, was abgelegt wird. */
    function postfachMitGesendet(fehler?: unknown) {
        const abgelegt: string[] = [];
        const fabrik: ImapAblageFabrik = () =>
            ({
                connect: () => Promise.resolve(),
                list: () => Promise.resolve([{ path: "Gesendet", name: "Gesendet", specialUse: "\\Sent" }]),
                append: (pfad) => {
                    if (fehler !== undefined) return Promise.reject(fehler as Error);
                    abgelegt.push(pfad);
                    return Promise.resolve({ destination: pfad });
                },
                logout: () => Promise.resolve(),
            }) satisfies ImapAblage;
        return { fabrik, abgelegt };
    }
    const versand = (
        ausgang: number,
        fabrik: TransportFabrik,
        teil: {
            database?: Database;
            environment?: NodeJS.ProcessEnv;
            warnung?: string[];
            kopie?: ImapAblageFabrik;
        } = {},
    ) =>
        runCommunityMailVersandJob(kontext({ ausgang }), {
            database: teil.database ?? database,
            environment: { ...(teil.environment ?? env), AVESMAPS_ENV: TEST_AUTH.environment ?? "development" },
            transport: fabrik,
            // Die Umgebung trägt einen IMAP-Host: Ohne gestellten Client ginge die Kopie ins Netz.
            kopie: teil.kopie ?? postfachMitGesendet().fabrik,
            ...(teil.warnung === undefined ? {} : { warnung: (text: string) => void teil.warnung!.push(text) }),
        });

    it("🔴 Versand aus: der Job reserviert nichts, zählt keinen Versuch, sendet nichts und endet ohne Fehler; die Mail bleibt „wartet“ und geht nach dem Einschalten hinaus", async () => {
        const id = await wartendeMail();
        await database`SELECT avesmaps_community.community_mail_routine_setzen('versand', false, ${betreiber.id}::uuid)`;
        const t = transport();
        expect(await versand(id, t.fabrik)).toEqual({ ausgang: id, zurueckgehalten: true });
        expect(t.gesendet).toHaveLength(0);
        expect(await ausgangZeile(id)).toEqual({ zustand: "wartet", versuche: 0, reserviert_bis: null });
        expect(await zeile("versand")).toMatchObject({ letzter_lauf: "zurueckgehalten" });
        // Noch einmal: weiter nichts (kein Versuch, keine Reservierung).
        await versand(id, t.fabrik);
        expect(await ausgangZeile(id)).toEqual({ zustand: "wartet", versuche: 0, reserviert_bis: null });

        await database`SELECT avesmaps_community.community_mail_routine_setzen('versand', true, ${betreiber.id}::uuid)`;
        expect(await versand(id, t.fabrik)).toMatchObject({ ausgang: id, zustand: "gesendet" });
        expect(t.gesendet).toHaveLength(1);
        expect(await ausgangZeile(id)).toMatchObject({ zustand: "gesendet", versuche: 1 });
        const erfolg = await database<
            { letzter_erfolg_at: Date | null }[]
        >`SELECT letzter_erfolg_at FROM avesmaps_community.mail_routine WHERE art = 'versand'`;
        expect(await zeile("versand")).toMatchObject({ letzter_lauf: "gesendet" });
        expect(erfolg[0]!.letzter_erfolg_at).not.toBeNull();
    });

    it("🔴 Kopie in „Gesendet“: genau eine nach der Annahme, keine ohne Annahme, und scheitert sie, bleibt die Mail zugestellt und das Panel zeigt es", async () => {
        const erfolgZahlen = async (): Promise<unknown> => {
            const [row] = await database<
                { letzter_erfolg: unknown }[]
            >`SELECT letzter_erfolg FROM avesmaps_community.mail_routine WHERE art = 'versand'`;
            return row?.letzter_erfolg;
        };
        const gut = postfachMitGesendet();
        const erste = await wartendeMail();
        expect(await versand(erste, transport().fabrik, { kopie: gut.fabrik })).toMatchObject({
            zustand: "gesendet",
            kopie: "abgelegt",
        });
        expect(gut.abgelegt).toEqual(["Gesendet"]);
        expect(await erfolgZahlen()).toEqual({});
        // Dieselbe Mail noch einmal: Sie wartet nicht mehr, also weder Versand noch zweite Kopie.
        expect(await versand(erste, transport().fabrik, { kopie: gut.fabrik })).toEqual({
            ausgang: erste,
            ergebnis: "uebersprungen",
        });
        expect(gut.abgelegt).toHaveLength(1);

        // Der Mailserver lehnt ab: keine Kopie einer Mail, die nicht hinausging.
        const abgelehnt = await wartendeMail();
        const unberuehrt = postfachMitGesendet();
        await versand(abgelehnt, transport({ code: "EAUTH", responseCode: 535 }).fabrik, { kopie: unberuehrt.fabrik });
        expect(unberuehrt.abgelegt).toEqual([]);

        // Die Ablage scheitert: Die Mail bleibt zugestellt, der Lauf ein Erfolg, nur die Warnung nennt ein Wort.
        const warnungen: string[] = [];
        const dritte = await wartendeMail();
        const schlecht = postfachMitGesendet(Object.assign(new Error(`NO ${KENNWORT}`), { code: "TRYCREATE" }));
        expect(await versand(dritte, transport().fabrik, { kopie: schlecht.fabrik, warnung: warnungen })).toMatchObject(
            {
                zustand: "gesendet",
                kopie: "fehlt",
            },
        );
        expect(await ausgangZeile(dritte)).toMatchObject({ zustand: "gesendet", versuche: 1 });
        expect(await zeile("versand")).toMatchObject({ letzter_lauf: "gesendet" });
        expect(await erfolgZahlen()).toEqual({ kopie_fehlt: 1 });
        expect(warnungen).toEqual(["Mailversand: Kopie in „Gesendet“ nicht abgelegt (ordner_fehlt)"]);
        expect(warnungen.join(" ")).not.toContain(KENNWORT);

        // Die nächste Mail mit Kopie räumt den Hinweis ab.
        await versand(await wartendeMail(), transport().fabrik);
        expect(await erfolgZahlen()).toEqual({});

        // Ohne IMAP-Zugang (Stage, lokal): keine Kopie, kein Hinweis.
        const ohne = await wartendeMail();
        const ergebnis = await versand(ohne, transport().fabrik, {
            environment: { ...env, COMMUNITY_MAIL_IMAP_HOST: "" },
            kopie: schlecht.fabrik,
        });
        expect(ergebnis).toMatchObject({ zustand: "gesendet" });
        expect(ergebnis).not.toHaveProperty("kopie");
        expect(await erfolgZahlen()).toEqual({});
    });

    it("🔴 der Versandjob trägt jeden Fehlversuch als Wort aus der Liste ein: Anmeldung, Adresse, Störung, fehlender Zugang; nie ein Text", async () => {
        const faelle: [Record<string, unknown>, string, string][] = [
            [{ code: "EAUTH", responseCode: 535 }, "anmeldung_abgelehnt", "fehler"],
            [{ code: "EENVELOPE" }, "adresse_abgelehnt", "fehler"],
            [{ responseCode: 550 }, "adresse_abgelehnt", "fehler"],
            [{ responseCode: 554 }, "gestoert", "fehler"],
            // Vorübergehend: Die Mail wartet auf den nächsten Versuch.
            [{ code: "ECONNECTION" }, "gestoert", "wartet"],
        ];
        for (const [extra, wort, zustand] of faelle) {
            await database`DELETE FROM avesmaps_community.vorgang`;
            const id = await wartendeMail();
            await versand(id, transport(extra).fabrik);
            expect(await ausgangZeile(id), JSON.stringify(extra)).toMatchObject({ zustand });
            const roh = await zeile("versand");
            expect(roh.letzter_lauf, JSON.stringify(extra)).toBe(wort);
            for (const geheimnis of [NUTZER, KENNWORT]) expect(JSON.stringify(roh)).not.toContain(geheimnis);
        }
        // Ohne Zugang in der Umgebung des Ausführers endet die Mail als Fehler, und der Lauf heißt „zugang_fehlt“.
        await database`DELETE FROM avesmaps_community.vorgang`;
        const id = await wartendeMail();
        const t = transport();
        await versand(id, t.fabrik, { environment: umgebung(ablage, { COMMUNITY_MAIL_PASSWORD: undefined }) });
        expect(t.gesendet).toHaveLength(0);
        expect(await ausgangZeile(id)).toMatchObject({ zustand: "fehler" });
        expect((await zeile("versand")).letzter_lauf).toBe("zugang_fehlt");
    });

    it("🔴 kann der Versandjob den Schalter nicht lesen oder den Lauf nicht eintragen, sendet er wie bisher und warnt nur mit dem SQLSTATE", async () => {
        const id = await wartendeMail();
        await database`SELECT avesmaps_community.community_mail_routine_setzen('versand', false, ${betreiber.id}::uuid)`;
        const warnungen: string[] = [];
        const t = transport();
        const ergebnis = await versand(id, t.fabrik, { database: ohneSchalter(database), warnung: warnungen });
        expect(ergebnis).toMatchObject({ ausgang: id, zustand: "gesendet" });
        expect(t.gesendet).toHaveLength(1);
        expect(warnungen).toHaveLength(2);
        for (const text of warnungen) expect(text).toContain("SQLSTATE 42883");
        expect((await zeile("versand")).letzter_lauf).toBeNull();
    });
});
