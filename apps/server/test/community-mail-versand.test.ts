import { randomBytes, randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    AVENTURIA,
    COMMUNITY_GLOCKEN_ARTEN,
    COMMUNITY_GRENZEN,
    CommunityStand,
    GesendetListe,
    VorgangDetail,
    type Role,
    type VorgangDetail as Detail,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { communityAufbewahrung } from "../src/community/aufbewahrung.ts";
import { leseAbsender, leseMailKonfiguration, mailwegAn, MAIL_VARIABLEN } from "../src/community/mail/konfiguration.ts";
import {
    baueNachricht,
    zustellFehler,
    type MailNachricht,
    type MailTransport,
    type TransportFabrik,
} from "../src/community/mail/versand.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { JOB_HANDLERS, JobFailure, type JobContext } from "../src/jobs/handlers.ts";
import { LEICHTE_ARTEN, istSchwer } from "../src/jobs/dirigent/plan.ts";
import { JOB_KIND_CATALOG, knowsKind } from "../src/jobs/kinds.ts";
import { BENACHRICHTIGUNG_JOB_ARTEN } from "../src/jobs/benachrichtigung-job.ts";
import {
    COMMUNITY_MAIL_VERSAND_KIND,
    MAIL_ABSTAENDE_MS,
    runCommunityMailVersandJob,
} from "../src/jobs/community-mail-job.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Der Mailweg des Community-Moduls (WI-0268 C6a; Fachkonzept WI-0263 §3.4, §9, §10.2, Bedienkonzept §3.3 bis §3.5; Migration 0279) gegen echtes PostgreSQL, mit gestelltem Transport: es geht NIE eine echte Mail
 * hinaus.
 *
 * - Konfiguration: fehlt eine Angabe, ist der Mailweg aus; Nutzer und Kennwort tauchen nirgends auf.
 * - Antwort per Mail legt Nachricht, Ausgang und einen Versandauftrag an; der Auftrag sendet an die Adresse des Vorgangs (nie an eine andere), mit Betreff und Nummer, Message-ID, In-Reply-To.
 * - Vorübergehender Fehler: Wiederholung mit Abstand, nach dem dritten Mal `fehler` mit Grund ohne Geheimnis und Glocke; Erneut senden; dieselbe Kennung sendet einmal.
 * - Ohne Konfiguration geht die Antwort auf die Statusseite, ohne Auftrag.
 * - Neue Mail: nur mit `send_new_mail`, Tagesgrenze, Protokoll ohne Klartextadresse. Kein offenes Relay.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const MAIL = "Alrike.Fischer@example.org";
const KENNWORT = "geheim-kennwort-4711";
const NUTZER = "redaktion-konto@example.org";
const TEXT =
    "Darf die Karte für ein Spielleiterhandbuch verwendet werden? Wir würden gern einen Ausschnitt drucken.\nVielen Dank!";
const ENV: Record<(typeof MAIL_VARIABLEN)[number], string> = {
    COMMUNITY_MAIL_SMTP_HOST: "smtp.example.invalid",
    COMMUNITY_MAIL_SMTP_PORT: "587",
    COMMUNITY_MAIL_USER: NUTZER,
    COMMUNITY_MAIL_PASSWORD: KENNWORT,
    COMMUNITY_MAIL_FROM: "Avesmaps-Redaktion <info@avesmaps.de>",
};

describe("Mailweg: Konfiguration", () => {
    it("🔴 fehlt eine Angabe (oder ist sie leer oder unbrauchbar), ist der Mailweg aus", () => {
        expect(mailwegAn({ ...ENV })).toBe(true);
        for (const name of MAIL_VARIABLEN) {
            expect(mailwegAn({ ...ENV, [name]: undefined }), name).toBe(false);
            expect(mailwegAn({ ...ENV, [name]: "  " }), name).toBe(false);
        }
        expect(mailwegAn({})).toBe(false);
        expect(mailwegAn({ ...ENV, COMMUNITY_MAIL_SMTP_PORT: "abc" })).toBe(false);
        expect(mailwegAn({ ...ENV, COMMUNITY_MAIL_SMTP_PORT: "70000" })).toBe(false);
        expect(mailwegAn({ ...ENV, COMMUNITY_MAIL_SMTP_PORT: "0" })).toBe(false);
        expect(mailwegAn({ ...ENV, COMMUNITY_MAIL_SMTP_HOST: "smtp.example.org/../x" })).toBe(false);
        // Ein Absender, der keine einzelne Adresse ist, schaltet den Mailweg ebenfalls aus.
        for (const von of [
            "keine-adresse",
            "a@b.de, c@d.de",
            "A <a@b.de> <c@d.de>",
            "Name\r\nBcc: x@y.de <a@b.de>",
            "a@b",
            '"Na,me" <a@b.de>',
        ])
            expect(mailwegAn({ ...ENV, COMMUNITY_MAIL_FROM: von }), von).toBe(false);
    });

    it("liest Absender, Domäne und Transportoptionen: 465 mit TLS von Beginn an, alles andere mit erzwungenem STARTTLS", () => {
        const zugang = leseMailKonfiguration({ ...ENV });
        expect(zugang).toMatchObject({
            host: "smtp.example.invalid",
            port: 587,
            absender: "Avesmaps-Redaktion <info@avesmaps.de>",
            absenderAdresse: "info@avesmaps.de",
            domaene: "avesmaps.de",
        });
        expect(zugang?.transportOptionen()).toMatchObject({ secure: false, requireTLS: true, pool: false });
        const tls = leseMailKonfiguration({ ...ENV, COMMUNITY_MAIL_SMTP_PORT: "465" });
        expect(tls?.transportOptionen()).toMatchObject({ secure: true, requireTLS: false });
        expect(leseMailKonfiguration({ ...ENV, COMMUNITY_MAIL_FROM: "Info@Avesmaps.DE" })?.domaene).toBe("avesmaps.de");
        expect(leseAbsender("Avesmaps-Redaktion <info@avesmaps.de>")).toEqual({
            anzeigename: "Avesmaps-Redaktion",
            adresse: "info@avesmaps.de",
            domaene: "avesmaps.de",
        });
    });

    it("🔴 Nutzer und Kennwort stehen nie in JSON, Aufzählung, Fehlerausgabe oder Spread; nur der Transport bekommt sie", () => {
        const zugang = leseMailKonfiguration({ ...ENV });
        expect(zugang).toBeDefined();
        const sichtbar = [
            JSON.stringify(zugang),
            inspect(zugang, { depth: 5, showHidden: false }),
            JSON.stringify({ ...zugang }),
            JSON.stringify(Object.entries(zugang ?? {})),
            String(Object.keys(zugang ?? {})),
        ].join("\n");
        expect(sichtbar).not.toContain(KENNWORT);
        expect(sichtbar).not.toContain(NUTZER);
        expect(zugang?.transportOptionen().auth).toEqual({ user: NUTZER, pass: KENNWORT });
    });
});

describe("Mailweg: Nachricht und Fehler", () => {
    const zugang = leseMailKonfiguration({ ...ENV })!;
    const mail = {
        an: MAIL,
        betreff: "Re: Frage zur Karte [COM-000123]",
        text: "Gern.",
        messageId: "<com-000123.2a6c9b7e-1111-4222-8333-444455556666@avesmaps.de>",
        inReplyTo: null,
        references: [] as string[],
    };

    it("🔴 genau EIN Empfänger: als Objekt und als Umschlag; eine Adresse mit Komma, Strichpunkt oder Klammern wird nie gebaut", () => {
        const nachricht = baueNachricht(zugang, mail);
        expect(nachricht.to).toEqual({ name: "", address: MAIL });
        expect(nachricht.envelope).toEqual({ from: "info@avesmaps.de", to: [MAIL] });
        expect(nachricht.from).toEqual({ name: "Avesmaps-Redaktion", address: "info@avesmaps.de" });
        expect(nachricht.replyTo).toEqual(nachricht.from);
        expect(nachricht).not.toHaveProperty("html");
        expect(nachricht).not.toHaveProperty("bcc");
        expect(nachricht).not.toHaveProperty("cc");
        for (const an of [
            "a@b.de,c@d.de",
            "a@b.de;c@d.de",
            "a@b.de, c.de",
            "Alrike <a@b.de>",
            '"a"@b.de',
            "a@b.de\r\nBcc: x@y.de",
            "a b@c.de",
            "",
        ])
            expect(() => baueNachricht(zugang, { ...mail, an }), an).toThrow();
    });

    it("Betreff in einer Zeile, In-Reply-To und References nur in der Form einer Message-ID", () => {
        const nachricht = baueNachricht(zugang, {
            ...mail,
            betreff: "Re: Frage\r\nBcc: x@y.de [COM-000123]",
            inReplyTo: "<com-000123.aaaa@avesmaps.de>",
            references: ["<com-000123.aaaa@avesmaps.de>", "kein-id", "<x@y\nz>"],
        });
        expect(nachricht.subject).toBe("Re: Frage Bcc: x@y.de [COM-000123]");
        expect(nachricht.inReplyTo).toBe("<com-000123.aaaa@avesmaps.de>");
        expect(nachricht.references).toEqual(["<com-000123.aaaa@avesmaps.de>"]);
        expect(baueNachricht(zugang, mail)).not.toHaveProperty("inReplyTo");
        expect(baueNachricht(zugang, mail)).not.toHaveProperty("references");
    });

    it("🔴 ein Fehler des Transports wird zu einem Satz aus festem Wortschatz: nie sein Text, nie ein Geheimnis", () => {
        const mitGeheimnis = (extra: Record<string, unknown>) =>
            Object.assign(new Error(`535 Authentication failed for ${NUTZER} / ${KENNWORT} <${MAIL}>`), extra);
        const faelle: [Record<string, unknown>, boolean][] = [
            [{ code: "EAUTH", responseCode: 535 }, true],
            [{ code: "EENVELOPE" }, true],
            [{ responseCode: 550 }, true],
            [{ responseCode: 552 }, true],
            [{ responseCode: 554 }, true],
            [{ responseCode: 451 }, false],
            [{ code: "ECONNECTION" }, false],
            [{ code: "ETIMEDOUT" }, false],
            [{ code: "ESOCKET" }, false],
            [{}, false],
        ];
        for (const [extra, dauerhaft] of faelle) {
            const ergebnis = zustellFehler(mitGeheimnis(extra));
            expect(ergebnis.dauerhaft, JSON.stringify(extra)).toBe(dauerhaft);
            expect(ergebnis.grund).not.toContain(KENNWORT);
            expect(ergebnis.grund).not.toContain(NUTZER);
            expect(ergebnis.grund).not.toContain(MAIL);
            expect(ergebnis.grund.length).toBeLessThanOrEqual(120);
        }
        expect(zustellFehler(mitGeheimnis({ responseCode: 550 })).grund).toContain("550");
        expect(zustellFehler(null).dauerhaft).toBe(false);
    });
});

describe("Mailweg: die Jobart", () => {
    it("🔴 im Katalog (queued, leicht, ohne Sperre der Kartendomäne), mit Handler, und nicht über die Warteschlange der Benachrichtigungen", () => {
        expect(JOB_KIND_CATALOG[COMMUNITY_MAIL_VERSAND_KIND]).toMatchObject({
            kind: "community_mail_versand",
            version: 1,
            origin: "queued",
            holdsSharedDomainLock: false,
        });
        expect(knowsKind(COMMUNITY_MAIL_VERSAND_KIND, 1)).toBe(true);
        expect(LEICHTE_ARTEN.has(COMMUNITY_MAIL_VERSAND_KIND)).toBe(true);
        expect(istSchwer(COMMUNITY_MAIL_VERSAND_KIND)).toBe(false);
        expect(Object.keys(JOB_HANDLERS)).toContain(COMMUNITY_MAIL_VERSAND_KIND);
        // Die Glockenart der Mailfehler meldet nur der Versandjob selbst, nie ein Auftrag der Benachrichtigungen.
        expect(COMMUNITY_GLOCKEN_ARTEN).toContain("community_mail_fehler");
        expect(BENACHRICHTIGUNG_JOB_ARTEN as readonly string[]).not.toContain("community_mail_fehler");
    });
});

function serverConfig(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "community-mail-versand-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

interface Gesendet {
    nachricht: MailNachricht;
}

describeWithDatabase("Community: Mailweg Versand (PostgreSQL, gestellter Transport)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let lena: { id: string; cookie: string };
    let adrian: { id: string; cookie: string };
    let olaf: { id: string; cookie: string };
    let olga: { id: string; cookie: string };
    let alle: string[];
    let adresse = 10;
    const neueAdresse = (): string => `10.41.0.${String(adresse++)}`;
    const gesichert: Record<string, string | undefined> = {};

    async function leeren(): Promise<void> {
        await database`DELETE FROM job WHERE kind = ${COMMUNITY_MAIL_VERSAND_KIND}`;
        await database`DELETE FROM avesmaps_community.vorgang`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE action LIKE 'system.community_%'`;
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;
    }

    function mailwegAnschalten(): void {
        for (const name of MAIL_VARIABLEN) process.env[name] = ENV[name];
    }
    function mailwegAbschalten(): void {
        for (const name of MAIL_VARIABLEN) delete process.env[name];
    }

    beforeAll(async () => {
        for (const name of MAIL_VARIABLEN) gesichert[name] = process.env[name];
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
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { id: created.id, cookie };
        };
        lena = await person("reviewer", "Lena");
        adrian = await person("admin", "Adrian");
        olaf = await person("operator", "Olaf");
        olga = await person("operator", "Olga");
        alle = [lena.id, adrian.id, olaf.id, olga.id];
    });

    beforeEach(async () => {
        mailwegAnschalten();
        await leeren();
    });

    afterAll(async () => {
        for (const name of MAIL_VARIABLEN) {
            const alt = gesichert[name];
            if (alt === undefined) delete process.env[name];
            else process.env[name] = alt;
        }
        await app?.close();
        await leeren().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    // --- Hilfen -----------------------------------------------------------------------------------------------------------

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
    const frage = async (patch: Record<string, unknown> = {}) => {
        const body = kontakt(patch);
        const antwort = await postOeffentlich("/api/community/anfragen", body);
        expect(code(antwort)).toBe("201");
        const nummer = (antwort.json() as { nummer: string }).nummer;
        return { nummer, id: Number(nummer.slice(4)) };
    };
    const detail = async (nummer: string, cookie = olaf.cookie): Promise<Detail> => {
        const antwort = await get(`/api/community/vorgaenge/${nummer}`, cookie);
        expect(code(antwort)).toBe("200");
        const body = antwort.json() as Detail;
        expect(Value.Check(VorgangDetail, body)).toBe(true);
        return body;
    };
    const revisionVon = async (nummer: string): Promise<number> => (await detail(nummer)).zeile.revision;
    const antworten = async (nummer: string, patch: Record<string, unknown> = {}, cookie = olaf.cookie) =>
        post(
            `/api/community/vorgaenge/${nummer}/antworten`,
            {
                operationId: randomUUID(),
                baseRevision: await revisionVon(nummer),
                text: "Ja, gern: Bitte nennen Sie die Quelle.",
                archivieren: false,
                ...patch,
            },
            cookie,
        );
    const neueMail = (patch: Record<string, unknown> = {}, cookie = olaf.cookie) =>
        post(
            "/api/community/mails",
            {
                operationId: randomUUID(),
                an: "fremde.person@example.net",
                betreff: "Zusammenarbeit an einer Karte",
                text: "Guten Tag, wir würden uns über eine Zusammenarbeit freuen.",
                ...patch,
            },
            cookie,
        );
    const ausgaenge = async () =>
        database<
            {
                id: string;
                an: string | null;
                betreff: string;
                message_id: string;
                in_reply_to: string | null;
                zustand: string;
                fehler: string | null;
                versuche: number;
                serie: number;
                danach_archiv: boolean;
                weg: string;
                nummer: string;
            }[]
        >`
            SELECT a.id::text, a.an, a.betreff, a.message_id, a.in_reply_to, a.zustand, a.fehler, a.versuche, a.serie, a.danach_archiv,
                   n.weg, 'COM-' || lpad(n.vorgang_id::text, 6, '0') AS nummer
              FROM avesmaps_community.mail_ausgang a JOIN avesmaps_community.nachricht n ON n.id = a.nachricht_id
             ORDER BY a.id
        `;
    const auftraege = async () =>
        database<
            { input_ref: { ausgang: number }; state: string; actor_ref: string | null; not_before: Date | null }[]
        >`
            SELECT input_ref, state, actor_ref, not_before FROM job WHERE kind = ${COMMUNITY_MAIL_VERSAND_KIND} ORDER BY id
        `;
    const protokoll = async (action: string) =>
        database<{ target_ref: string | null; details: Record<string, unknown> }[]>`
            SELECT target_ref, details FROM avesmaps_auth.security_event WHERE action = ${action} ORDER BY id
        `;
    const glocke = async (art: string) =>
        database<{ an_person: string; text: string | null; quelle: string }[]>`
            SELECT an_person::text, text, quelle FROM public.benachrichtigung WHERE art = ${art} AND an_person = ANY(${alle}::uuid[]) ORDER BY id
        `;

    /** Ein gestellter Transport: schreibt die Mails mit statt zu senden; `fehler` lässt die ersten Aufrufe scheitern. */
    function stelle(fehler: (nr: number) => unknown = () => undefined) {
        const gesendet: Gesendet[] = [];
        let aufrufe = 0;
        const fabrik: TransportFabrik = () =>
            ({
                async sendMail(nachricht: MailNachricht) {
                    aufrufe += 1;
                    const f = fehler(aufrufe);
                    if (f !== undefined) throw f;
                    gesendet.push({ nachricht });
                    return {};
                },
                close() {
                    return undefined;
                },
            }) satisfies MailTransport;
        return { fabrik, gesendet, aufrufe: () => aufrufe };
    }
    const kontext = (ausgang: number): JobContext => ({
        input: { ausgang },
        attempt: 1,
        job: { id: 1, publicId: randomUUID(), leaseNo: 1, mapDomainId: AVENTURIA.mapDomain },
        beginPhase: () => Promise.resolve(),
        checkpoint: () => undefined,
    });
    const lauf = (
        ausgang: number,
        transport: TransportFabrik,
        zusatz: { jetzt?: () => Date; environment?: NodeJS.ProcessEnv } = {},
    ) =>
        runCommunityMailVersandJob(kontext(ausgang), {
            database,
            environment: { ...ENV, AVESMAPS_ENV: TEST_AUTH.environment ?? "development", ...zusatz.environment },
            transport,
            ...(zusatz.jetzt === undefined ? {} : { jetzt: zusatz.jetzt }),
        });

    // --- Stand ------------------------------------------------------------------------------------------------------------

    it("`GET /stand` meldet `mailweg`: an mit allen Angaben, aus ohne eine; verrät nichts von den Angaben", async () => {
        const an = await get("/api/community/stand");
        expect(Value.Check(CommunityStand, an.json())).toBe(true);
        expect(an.json()).toEqual({ meldungen: true, mailweg: true, discord: true });
        expect(an.body).not.toContain(KENNWORT);
        expect(an.body).not.toContain(NUTZER);
        delete process.env["COMMUNITY_MAIL_PASSWORD"];
        expect((await get("/api/community/stand")).json()).toEqual({ meldungen: true, mailweg: false, discord: true });
    });

    // --- Antwort per Mail -------------------------------------------------------------------------------------------------

    it("🔴 Antwort per Mail: Nachricht (Weg mail), Ausgang und EIN Auftrag entstehen; Zustand „wartet auf Antwort“; Betreff mit Nummer; der Auftrag trägt nur die Kennung", async () => {
        const { nummer, id } = await frage();
        const antwort = await antworten(nummer);
        expect(code(antwort)).toBe("200");
        const eintraege = await ausgaenge();
        expect(eintraege).toHaveLength(1);
        const [eintrag] = eintraege;
        expect(eintrag).toMatchObject({
            an: MAIL,
            zustand: "wartet",
            versuche: 0,
            serie: 1,
            danach_archiv: false,
            weg: "mail",
            nummer,
        });
        expect(eintrag?.betreff).toBe(
            `Re: Darf die Karte für ein Spielleiterhandbuch verwendet werden? Wir würden gern einen Ausschnitt drucken. [${nummer}]`,
        );
        expect(eintrag?.message_id).toMatch(
            new RegExp(`^<com-${String(id).padStart(6, "0")}\\.[0-9a-f-]{36}@avesmaps\\.de>$`, "u"),
        );
        expect(eintrag?.in_reply_to).toBeNull();
        const jobs = await auftraege();
        expect(jobs).toEqual([
            { input_ref: { ausgang: Number(eintrag?.id) }, state: "QUEUED", actor_ref: "community", not_before: null },
        ]);
        const d = await detail(nummer);
        expect(d.zeile.zustand).toBe("rueckfrage");
        const aus = d.verlauf.find((e) => e.art === "nachricht" && e.richtung === "aus");
        expect(aus).toMatchObject({
            weg: "mail",
            id: expect.any(Number),
            zustellung: { zustand: "wartet", grund: null, an: MAIL, betreff: eintrag?.betreff },
        });
        expect(await protokoll("system.community_antwort_gesendet")).toEqual([
            { target_ref: nummer, details: { com: nummer, weg: "mail" } },
        ]);
    });

    it("🔴 der Auftrag sendet an die Adresse des Vorgangs und an keine andere; Betreff, Message-ID, Absender, nur Text; danach „gesendet“", async () => {
        const { nummer } = await frage();
        await antworten(nummer);
        const [eintrag] = await ausgaenge();
        const transport = stelle();
        const ergebnis = await lauf(Number(eintrag?.id), transport.fabrik);
        expect(ergebnis).toEqual({ ausgang: Number(eintrag?.id), zustand: "gesendet", versuche: 1 });
        expect(transport.gesendet).toHaveLength(1);
        const { nachricht } = transport.gesendet[0]!;
        expect(nachricht.to).toEqual({ name: "", address: MAIL });
        expect(nachricht.envelope).toEqual({ from: "info@avesmaps.de", to: [MAIL] });
        expect(nachricht.subject).toBe(eintrag?.betreff);
        expect(nachricht.messageId).toBe(eintrag?.message_id);
        expect(nachricht.from).toEqual({ name: "Avesmaps-Redaktion", address: "info@avesmaps.de" });
        expect(nachricht.replyTo).toEqual({ name: "Avesmaps-Redaktion", address: "info@avesmaps.de" });
        expect(nachricht.text).toBe("Ja, gern: Bitte nennen Sie die Quelle.");
        expect(nachricht).not.toHaveProperty("html");
        expect(nachricht).not.toHaveProperty("inReplyTo");
        // Das Ergebnis des Auftrags trägt weder Adresse noch Betreff noch Text.
        expect(JSON.stringify(ergebnis)).not.toContain(MAIL);
        const [danach] = await ausgaenge();
        expect(danach).toMatchObject({ zustand: "gesendet", fehler: null, versuche: 1 });
        const d = await detail(nummer);
        expect(d.verlauf.find((e) => e.art === "nachricht" && e.richtung === "aus")).toMatchObject({
            zustellung: { zustand: "gesendet", grund: null },
        });
        expect(await glocke("community_mail_fehler")).toEqual([]);
    });

    it("die zweite Antwort derselben Anfrage antwortet auf die erste: In-Reply-To und References tragen die Message-ID der ersten", async () => {
        const { nummer } = await frage();
        await antworten(nummer);
        const transport = stelle();
        const [erste] = await ausgaenge();
        await lauf(Number(erste?.id), transport.fabrik);
        expect(code(await antworten(nummer, { text: "Noch eine Rückfrage zur Quelle." }))).toBe("200");
        const zwei = await ausgaenge();
        expect(zwei).toHaveLength(2);
        expect(zwei[1]?.in_reply_to).toBe(erste?.message_id);
        await lauf(Number(zwei[1]?.id), transport.fabrik);
        expect(transport.gesendet).toHaveLength(2);
        expect(transport.gesendet[1]?.nachricht.inReplyTo).toBe(erste?.message_id);
        expect(transport.gesendet[1]?.nachricht.references).toEqual([erste?.message_id]);
        expect(transport.gesendet[1]?.nachricht.messageId).not.toBe(erste?.message_id);
    });

    it("🔴 „Antworten und ins Archiv“: die Anfrage bleibt im Eingang, bis die Mail angenommen ist, und wandert dann ins Archiv (beantwortet)", async () => {
        const { nummer } = await frage();
        expect(code(await antworten(nummer, { archivieren: true }))).toBe("200");
        const vorher = await detail(nummer);
        expect(vorher.zeile.zustand).toBe("rueckfrage");
        expect(vorher.archiviertAt).toBeNull();
        const [eintrag] = await ausgaenge();
        expect(eintrag?.danach_archiv).toBe(true);
        await lauf(Number(eintrag?.id), stelle().fabrik);
        const danach = await detail(nummer);
        expect(danach.zeile).toMatchObject({ zustand: "abgeschlossen", ergebnis: "beantwortet" });
        expect(danach.archiviertAt).not.toBeNull();
        expect(await protokoll("system.community_antwort_gesendet")).toEqual([
            { target_ref: nummer, details: { com: nummer, ergebnis: "beantwortet", weg: "mail" } },
        ]);
    });

    it("🔴 scheitert der Versand, bleibt die Anfrage im Eingang - auch bei „ins Archiv“ - und die Glocke meldet es der Person, die schrieb", async () => {
        const { nummer } = await frage();
        await antworten(nummer, { archivieren: true });
        const [eintrag] = await ausgaenge();
        const transport = stelle(() =>
            Object.assign(new Error(`535 ${KENNWORT}`), { code: "EAUTH", responseCode: 535 }),
        );
        const ergebnis = await lauf(Number(eintrag?.id), transport.fabrik);
        expect(ergebnis).toMatchObject({ zustand: "fehler", versuche: 1, glocke: true });
        const d = await detail(nummer);
        expect(d.zeile.zustand).toBe("rueckfrage");
        expect(d.archiviertAt).toBeNull();
        const aus = d.verlauf.find((e) => e.art === "nachricht" && e.richtung === "aus");
        expect(aus).toMatchObject({
            zustellung: { zustand: "fehler", grund: "Der Mailserver hat die Anmeldung abgelehnt" },
        });
        expect(JSON.stringify(d)).not.toContain(KENNWORT);
        expect(JSON.stringify(d)).not.toContain(NUTZER);
        expect(await glocke("community_mail_fehler")).toEqual([
            { an_person: olaf.id, text: nummer, quelle: `community_mail_fehler:${nummer}:${eintrag?.id}:1` },
        ]);
        // Dieselbe Mail meldet sich nicht noch einmal (der Auftrag läuft nicht mehr: sie wartet nicht).
        expect(await lauf(Number(eintrag?.id), transport.fabrik)).toEqual({
            ausgang: Number(eintrag?.id),
            ergebnis: "uebersprungen",
        });
        expect(await glocke("community_mail_fehler")).toHaveLength(1);
    });

    // --- Wiederholung -----------------------------------------------------------------------------------------------------

    it("🔴 vorübergehender Fehler: bis zu drei Versuche mit Abstand, dann `fehler` mit Grund ohne Geheimnis; der Nachfolger kommt mit `not_before`", async () => {
        const { nummer } = await frage();
        await antworten(nummer);
        const [eintrag] = await ausgaenge();
        const id = Number(eintrag?.id);
        const jetzt = new Date("2026-11-01T10:00:00.000Z");
        const transport = stelle(() =>
            Object.assign(new Error(`connect failed ${NUTZER} ${KENNWORT}`), { code: "ECONNECTION" }),
        );
        const eins = await lauf(id, transport.fabrik, { jetzt: () => jetzt });
        expect(eins).toMatchObject({ zustand: "wartet", versuche: 1, naechsterVersuchInMs: MAIL_ABSTAENDE_MS[0] });
        let jobs = await auftraege();
        expect(jobs).toHaveLength(2);
        expect(jobs[1]).toMatchObject({ input_ref: { ausgang: id }, state: "QUEUED", actor_ref: "community" });
        expect(jobs[1]?.not_before?.toISOString()).toBe(new Date(jetzt.getTime() + 60_000).toISOString());
        expect((await ausgaenge())[0]).toMatchObject({
            zustand: "wartet",
            versuche: 1,
            fehler: "Der Mailserver ist nicht erreichbar oder die Verbindung brach ab",
        });
        const zwei = await lauf(id, transport.fabrik, { jetzt: () => jetzt });
        expect(zwei).toMatchObject({ zustand: "wartet", versuche: 2, naechsterVersuchInMs: MAIL_ABSTAENDE_MS[1] });
        jobs = await auftraege();
        expect(jobs).toHaveLength(3);
        expect(jobs[2]?.not_before?.toISOString()).toBe(new Date(jetzt.getTime() + 300_000).toISOString());
        // Der dritte Versuch: Schluss. Kein weiterer Auftrag, die Glocke meldet es.
        const drei = await lauf(id, transport.fabrik, { jetzt: () => jetzt });
        expect(drei).toMatchObject({ zustand: "fehler", versuche: 3, glocke: true });
        expect(await auftraege()).toHaveLength(3);
        expect(transport.aufrufe()).toBe(3);
        const [danach] = await ausgaenge();
        expect(danach).toMatchObject({ zustand: "fehler", versuche: 3 });
        expect(danach?.fehler).not.toContain(KENNWORT);
        expect(danach?.fehler).not.toContain(NUTZER);
        expect(await glocke("community_mail_fehler")).toHaveLength(1);
        // Ein weiterer Lauf tut nichts mehr.
        expect(await lauf(id, transport.fabrik)).toEqual({ ausgang: id, ergebnis: "uebersprungen" });
        expect(transport.aufrufe()).toBe(3);
    });

    it("ein vorübergehender Fehler, dann Erfolg: die Mail geht beim zweiten Versuch hinaus", async () => {
        const { nummer } = await frage();
        await antworten(nummer);
        const [eintrag] = await ausgaenge();
        const id = Number(eintrag?.id);
        const transport = stelle((nr) => (nr === 1 ? Object.assign(new Error("x"), { responseCode: 451 }) : undefined));
        expect(await lauf(id, transport.fabrik)).toMatchObject({ zustand: "wartet", versuche: 1 });
        expect(await lauf(id, transport.fabrik)).toMatchObject({ zustand: "gesendet", versuche: 2 });
        expect(transport.gesendet).toHaveLength(1);
        expect(await glocke("community_mail_fehler")).toEqual([]);
    });

    it("🔴 Erneut senden: aus `fehler` zurück auf „wartet“ (neue Serie, Versuche von vorn), ein neuer Auftrag, ein Protokolleintrag; in jedem anderen Zustand tut es nichts", async () => {
        const { nummer } = await frage();
        await antworten(nummer);
        const [eintrag] = await ausgaenge();
        const id = Number(eintrag?.id);
        const nachrichtId = (await detail(nummer)).verlauf.find((e) => e.art === "nachricht" && e.richtung === "aus");
        const nachricht = nachrichtId?.art === "nachricht" ? nachrichtId.id : undefined;
        expect(nachricht).toEqual(expect.any(Number));
        const erneut = (operationId = randomUUID()) =>
            post(
                `/api/community/vorgaenge/${nummer}/nachrichten/${String(nachricht)}/erneut-senden`,
                { operationId },
                olaf.cookie,
            );
        // Wartet sie noch: nichts zu tun.
        expect(code(await erneut())).toBe("200");
        expect(await auftraege()).toHaveLength(1);
        expect(await protokoll("system.community_mail_erneut")).toEqual([]);
        // Scheitert sie dauerhaft: `fehler`.
        const kaputt = stelle(() => Object.assign(new Error("x"), { responseCode: 550 }));
        await lauf(id, kaputt.fabrik);
        expect((await ausgaenge())[0]).toMatchObject({ zustand: "fehler", serie: 1 });
        const operationId = randomUUID();
        expect(code(await erneut(operationId))).toBe("200");
        expect((await ausgaenge())[0]).toMatchObject({ zustand: "wartet", versuche: 0, serie: 2, fehler: null });
        expect(await auftraege()).toHaveLength(2);
        expect(await protokoll("system.community_mail_erneut")).toEqual([
            { target_ref: nummer, details: { com: nummer } },
        ]);
        // Dieselbe Kennung noch einmal: kein zweiter Auftrag, kein zweiter Eintrag.
        expect(code(await erneut(operationId))).toBe("200");
        expect(await auftraege()).toHaveLength(2);
        expect(await protokoll("system.community_mail_erneut")).toHaveLength(1);
        // Jetzt geht es.
        const gut = stelle();
        expect(await lauf(id, gut.fabrik)).toMatchObject({ zustand: "gesendet", versuche: 1 });
        expect(gut.gesendet).toHaveLength(1);
        // Gesendet: Erneut senden tut nichts mehr.
        expect(code(await erneut())).toBe("200");
        expect(await auftraege()).toHaveLength(2);
        // Eine fremde oder erfundene Nachricht: 404.
        expect(
            code(
                await post(
                    `/api/community/vorgaenge/${nummer}/nachrichten/999999/erneut-senden`,
                    { operationId: randomUUID() },
                    olaf.cookie,
                ),
            ),
        ).toBe("404 community_not_found");
    });

    it("🔴 dieselbe Kennung sendet nie doppelt: eine Mail, ein Auftrag; ein zweiter Lauf und eine gleichzeitige Reservierung senden nichts", async () => {
        const { nummer } = await frage();
        const body = {
            operationId: randomUUID(),
            baseRevision: await revisionVon(nummer),
            text: "Eine Antwort, die zweimal abgeschickt wird.",
            archivieren: false,
        };
        const url = `/api/community/vorgaenge/${nummer}/antworten`;
        expect(code(await post(url, body, olaf.cookie))).toBe("200");
        expect(code(await post(url, body, olaf.cookie))).toBe("200");
        expect(await ausgaenge()).toHaveLength(1);
        expect(await auftraege()).toHaveLength(1);
        expect(
            (await detail(nummer)).verlauf.filter((e) => e.art === "nachricht" && e.richtung === "aus"),
        ).toHaveLength(1);
        expect(await protokoll("system.community_antwort_gesendet")).toHaveLength(1);
        const [eintrag] = await ausgaenge();
        const id = Number(eintrag?.id);
        // Die Reservierung hält einen zweiten Versuch fern.
        const erste = await database<
            { mail: Record<string, unknown> | null }[]
        >`SELECT avesmaps_community.community_mail_holen(${id}::bigint) AS mail`;
        expect(erste[0]?.mail).toMatchObject({ ausgang: id, an: MAIL });
        const zweite = await database<
            { mail: Record<string, unknown> | null }[]
        >`SELECT avesmaps_community.community_mail_holen(${id}::bigint) AS mail`;
        expect(zweite[0]?.mail).toEqual({ reserviert: true });
        const transport = stelle();
        const waehrend = await lauf(id, transport.fabrik);
        expect(waehrend).toEqual({ ausgang: id, ergebnis: "reserviert" });
        expect(transport.aufrufe()).toBe(0);
        // Der Nachfolger sieht später nach (nach Ablauf der Reservierung).
        expect(await auftraege()).toHaveLength(2);
        // Läuft die Reservierung ab (der Job starb), sendet der nächste - einmal.
        await database`UPDATE avesmaps_community.mail_ausgang SET reserviert_bis = now() - interval '1 second' WHERE id = ${id}`;
        expect(await lauf(id, transport.fabrik)).toMatchObject({ zustand: "gesendet" });
        expect(await lauf(id, transport.fabrik)).toEqual({ ausgang: id, ergebnis: "uebersprungen" });
        expect(transport.aufrufe()).toBe(1);
    });

    it("🔴 eine Mail ohne Mailweg in der Umgebung des Ausführers endet als `fehler` mit einem Satz (sie wartet nicht für immer)", async () => {
        const { nummer } = await frage();
        await antworten(nummer);
        const [eintrag] = await ausgaenge();
        const transport = stelle();
        const ergebnis = await runCommunityMailVersandJob(kontext(Number(eintrag?.id)), {
            database,
            environment: { AVESMAPS_ENV: TEST_AUTH.environment ?? "development" },
            transport: transport.fabrik,
        });
        expect(ergebnis).toMatchObject({ zustand: "fehler" });
        expect(transport.aufrufe()).toBe(0);
        expect((await ausgaenge())[0]).toMatchObject({
            zustand: "fehler",
            fehler: "Der Mailweg ist in dieser Umgebung nicht eingerichtet",
        });
    });

    it("die Eingabe des Auftrags ist streng: nur `{ ausgang }`, eine positive ganze Zahl", async () => {
        for (const input of [
            {},
            { ausgang: 0 },
            { ausgang: "1" },
            { ausgang: 1.5 },
            { ausgang: 1, an: MAIL },
            { ausgang: 1, text: "x" },
        ]) {
            await expect(
                runCommunityMailVersandJob(
                    { ...kontext(1), input },
                    { database, environment: { ...ENV }, transport: stelle().fabrik },
                ),
            ).rejects.toBeInstanceOf(JobFailure);
        }
    });

    // --- Ohne Mailweg -----------------------------------------------------------------------------------------------------

    it("🔴 ohne Konfiguration geht die Antwort wie bisher auf die Statusseite, ohne Ausgang und ohne Auftrag; ausdrücklich `mail` geht nicht", async () => {
        mailwegAbschalten();
        const { nummer } = await frage();
        expect(code(await antworten(nummer))).toBe("200");
        expect(await ausgaenge()).toEqual([]);
        expect(await auftraege()).toEqual([]);
        const d = await detail(nummer);
        const aus = d.verlauf.find((e) => e.art === "nachricht" && e.richtung === "aus");
        expect(aus).toMatchObject({ weg: "statusseite" });
        expect(aus).not.toHaveProperty("zustellung");
        expect(await protokoll("system.community_antwort_gesendet")).toEqual([
            { target_ref: nummer, details: { com: nummer } },
        ]);
        expect(code(await antworten(nummer, { weg: "mail", text: "Noch eine." }))).toBe("409 community_transition");
        expect(await ausgaenge()).toEqual([]);
        // Auch Erneut senden und eine neue Mail brauchen den Mailweg.
        expect(code(await neueMail())).toBe("503 community_unavailable");
        expect(
            code(
                await post(
                    `/api/community/vorgaenge/${nummer}/nachrichten/1/erneut-senden`,
                    { operationId: randomUUID() },
                    olaf.cookie,
                ),
            ),
        ).toBe("409 community_transition");
    });

    it("ohne Adresse des Absenders (oder mit einer, die nicht genau eine ist) geht die Antwort auf die Statusseite; ausdrücklich `mail` gibt 409", async () => {
        const ohne = await frage({ mail: undefined });
        expect(code(await antworten(ohne.nummer))).toBe("200");
        expect(
            (await detail(ohne.nummer)).verlauf.find((e) => e.art === "nachricht" && e.richtung === "aus"),
        ).toMatchObject({ weg: "statusseite" });
        expect(code(await antworten(ohne.nummer, { weg: "mail" }))).toBe("409 community_transition");
        // Das Kontaktformular nimmt `a@b.de,c.de` an (schlichtes Muster); der Mailweg sendet daran nie.
        const zwei = await frage({ mail: "a@b.de,c.de" });
        expect(code(await antworten(zwei.nummer))).toBe("200");
        expect(
            (await detail(zwei.nummer)).verlauf.find((e) => e.art === "nachricht" && e.richtung === "aus"),
        ).toMatchObject({ weg: "statusseite" });
        expect(code(await antworten(zwei.nummer, { weg: "mail" }))).toBe("409 community_transition");
        expect(await ausgaenge()).toEqual([]);
        expect(await auftraege()).toEqual([]);
    });

    it("🔴 kein offenes Relay: der Rumpf einer Antwort kennt keine Adresse (Zusätze werden verworfen), und der Empfänger ist immer die Adresse des Vorgangs", async () => {
        const { nummer } = await frage();
        const fremd = "fremd@example.net";
        // Fastify entfernt Felder, die das Schema nicht kennt: Ein mitgeschickter Empfänger kommt nie an der Route vorbei.
        const zusaetze = [
            { an: fremd },
            { to: fremd },
            { empfaenger: fremd },
            { bcc: fremd },
            { envelope: { to: [fremd] } },
        ];
        for (const [nr, extra] of zusaetze.entries()) {
            expect(code(await antworten(nummer, { ...extra, text: `Antwort Nummer ${String(nr + 1)}` }))).toBe("200");
        }
        const alle = await ausgaenge();
        expect(alle).toHaveLength(5);
        expect(alle.map((eintrag) => eintrag.an)).toEqual([MAIL, MAIL, MAIL, MAIL, MAIL]);
        const transport = stelle();
        for (const eintrag of alle) await lauf(Number(eintrag.id), transport.fabrik);
        expect(transport.gesendet).toHaveLength(5);
        for (const { nachricht } of transport.gesendet) {
            expect(nachricht.to.address).toBe(MAIL);
            expect(nachricht.envelope.to).toEqual([MAIL]);
            expect(JSON.stringify(nachricht)).not.toContain(fremd);
        }
        const kennung = alle[0]!.id;
        // Die Datenbank hat die Tür zu: eine Funktion für die Adresse gibt es nicht, und die Tafel verlangt genau eine Adresse.
        await expect(
            database`UPDATE avesmaps_community.mail_ausgang SET an = 'a@b.de,c@d.de' WHERE id = ${kennung}::bigint`,
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
            database`UPDATE avesmaps_community.mail_ausgang SET betreff = E'Zeile\nBcc: x@y.de' WHERE id = ${kennung}::bigint`,
        ).rejects.toMatchObject({ code: "23514" });
    });

    // --- Rechte -----------------------------------------------------------------------------------------------------------

    it("🔴 Reviewer und Admin haben kein `read_mailbox`: 403 auf Antworten und Erneut senden; Erneut senden braucht `answer_community`", async () => {
        const { nummer } = await frage();
        const rev = await revisionVon(nummer);
        for (const cookie of [lena.cookie, adrian.cookie]) {
            expect(
                code(
                    await post(
                        `/api/community/vorgaenge/${nummer}/antworten`,
                        { operationId: randomUUID(), baseRevision: rev, text: "Antwort", archivieren: false },
                        cookie,
                    ),
                ),
            ).toBe("403 forbidden");
            expect(
                code(
                    await post(
                        `/api/community/vorgaenge/${nummer}/nachrichten/1/erneut-senden`,
                        { operationId: randomUUID() },
                        cookie,
                    ),
                ),
            ).toBe("403 forbidden");
            expect(code(await get("/api/community/gesendet", cookie))).toBe("403 forbidden");
        }
        expect(await ausgaenge()).toEqual([]);
        expect(await auftraege()).toEqual([]);
    });

    // --- Neue Mail --------------------------------------------------------------------------------------------------------

    it("🔴 Neue Mail: nur mit `send_new_mail` (Betreiber); Reviewer und Admin bekommen 403, nichts entsteht", async () => {
        for (const cookie of [lena.cookie, adrian.cookie])
            expect(code(await neueMail({}, cookie))).toBe("403 forbidden");
        expect(await ausgaenge()).toEqual([]);
        expect(await auftraege()).toEqual([]);
        expect(
            code(
                await post(
                    "/api/community/mails",
                    { operationId: randomUUID(), an: "x@example.net", betreff: "A", text: "B" },
                    "",
                ),
            ),
        ).toMatch(/^401/u);
    });

    it("🔴 Neue Mail: Vorgang im Eingang („von Avesmaps begonnen“, wartet auf Antwort, zuständig die schreibende Person), Absender mit der Zieladresse, Ausgang und Auftrag; der Versand geht an genau diese Adresse", async () => {
        const antwort = await neueMail();
        expect(code(antwort)).toBe("201");
        const { nummer } = antwort.json() as { nummer: string };
        expect(nummer).toMatch(/^COM-\d{6}$/u);
        const d = await detail(nummer);
        expect(d.zeile).toMatchObject({
            art: "anfrage",
            kategorie: "sonstiges",
            eingang: "redaktion",
            zustand: "rueckfrage",
            zustaendig: { id: olaf.id, name: "Olaf" },
            absender: "fremde.person@example.net",
            betreff: "Zusammenarbeit an einer Karte",
            beantwortet: true,
        });
        expect(d.melder).toMatchObject({
            name: null,
            mail: "fremde.person@example.net",
            rueckwege: ["mail"],
            entfernt: false,
        });
        const [eintrag] = await ausgaenge();
        expect(eintrag).toMatchObject({
            an: "fremde.person@example.net",
            zustand: "wartet",
            weg: "mail",
            in_reply_to: null,
        });
        expect(eintrag?.betreff).toBe(`Zusammenarbeit an einer Karte [${nummer}]`);
        expect(await auftraege()).toEqual([
            { input_ref: { ausgang: Number(eintrag?.id) }, state: "QUEUED", actor_ref: "community", not_before: null },
        ]);
        const transport = stelle();
        await lauf(Number(eintrag?.id), transport.fabrik);
        const { nachricht } = transport.gesendet[0]!;
        expect(nachricht.to).toEqual({ name: "", address: "fremde.person@example.net" });
        expect(nachricht.subject).toBe(`Zusammenarbeit an einer Karte [${nummer}]`);
        expect(nachricht.text).toBe("Guten Tag, wir würden uns über eine Zusammenarbeit freuen.");
        // Eine Antwort darauf bekommt den Betreff der ersten Mail: „Re: <Betreff> [COM-…]“.
        expect(code(await antworten(nummer, { text: "Nachtrag." }))).toBe("200");
        const zwei = await ausgaenge();
        expect(zwei[1]?.betreff).toBe(`Re: Zusammenarbeit an einer Karte [${nummer}]`);
        expect(zwei[1]?.in_reply_to).toBe(eintrag?.message_id);
        // Er steht im Eingang der Mails und in Gesendet, mit dem Zustellstand.
        const liste = await get("/api/community/vorgaenge?art=anfrage&segment=eingang", olaf.cookie);
        expect((liste.json() as { zeilen: { nummer: string; betreff: string | null }[] }).zeilen).toEqual([
            expect.objectContaining({ nummer, betreff: "Zusammenarbeit an einer Karte" }),
        ]);
        const gesendet = await get("/api/community/gesendet", olaf.cookie);
        expect(Value.Check(GesendetListe, gesendet.json())).toBe(true);
        const zeilen = (gesendet.json() as GesendetListe).zeilen;
        expect(zeilen).toHaveLength(2);
        const erste = zeilen.find((z) => z.zustellung?.betreff === `Zusammenarbeit an einer Karte [${nummer}]`);
        expect(erste).toMatchObject({
            nummer,
            an: "fremde.person@example.net",
            weg: "mail",
            zustellung: { zustand: "gesendet", grund: null },
        });
        expect(zeilen.find((z) => z.zustellung?.zustand === "wartet")).toBeDefined();
    });

    it("Gesendet zeigt den Zustellstand nur bei Mails, nicht bei Antworten auf die Statusseite", async () => {
        const { nummer } = await frage();
        await antworten(nummer);
        mailwegAbschalten();
        const zwei = await frage();
        await antworten(zwei.nummer);
        const zeilen = ((await get("/api/community/gesendet", olaf.cookie)).json() as GesendetListe).zeilen;
        expect(zeilen).toHaveLength(2);
        const mail = zeilen.find((z) => z.nummer === nummer);
        const status = zeilen.find((z) => z.nummer === zwei.nummer);
        expect(mail).toMatchObject({ weg: "mail", an: MAIL, zustellung: { zustand: "wartet", an: MAIL } });
        expect(status).toMatchObject({ weg: "statusseite", an: null });
        expect(status).not.toHaveProperty("zustellung");
    });

    it("🔴 Neue Mail: ungültige Adresse (mehrere, Komma, Name, Umbruch), leerer Betreff oder Text, zu lang: 400, nichts entsteht", async () => {
        for (const patch of [
            { an: "a@b.de,c@d.de" },
            { an: "a@b.de;c@d.de" },
            { an: "Name <a@b.de>" },
            { an: "a@b.de\r\nBcc: x@y.de" },
            { an: "keine-adresse" },
            { an: "" },
            { betreff: "" },
            { betreff: "x".repeat(COMMUNITY_GRENZEN.betreffNeuMax + 1) },
            { text: "" },
            { text: "x".repeat(COMMUNITY_GRENZEN.nachrichtMax + 1) },
        ])
            expect(code(await neueMail(patch)), JSON.stringify(patch).slice(0, 60)).toBe("400 validation_failed");
        // Ein Feld, das das Schema nicht kennt, wird verworfen (kein Bcc, kein Empfänger neben der Adresse).
        expect(code(await neueMail({ bcc: "x@y.de" }))).toBe("201");
        const [mit] = await ausgaenge();
        expect(mit?.an).toBe("fremde.person@example.net");
        await leeren();
        // Ein Betreff mit Umbruch geht durch das Schema (eine Zeichenkette), nicht durch die Datenbank.
        expect(code(await neueMail({ betreff: "Zeile 1\nBcc: x@y.de" }))).toBe("422 community_invalid");
        expect(await ausgaenge()).toEqual([]);
        expect(await auftraege()).toEqual([]);
        expect(await database`SELECT 1 FROM avesmaps_community.vorgang`).toHaveLength(0);
    });

    it("🔴 Neue Mail: dieselbe Kennung legt nichts zweites an (ein Vorgang, ein Auftrag, ein Protokolleintrag)", async () => {
        const body = {
            operationId: randomUUID(),
            an: "fremde.person@example.net",
            betreff: "Hallo",
            text: "Guten Tag.",
        };
        const a = await post("/api/community/mails", body, olaf.cookie);
        const b = await post("/api/community/mails", body, olaf.cookie);
        expect(code(a)).toBe("201");
        expect(code(b)).toBe("201");
        expect((b.json() as { nummer: string }).nummer).toBe((a.json() as { nummer: string }).nummer);
        expect(await ausgaenge()).toHaveLength(1);
        expect(await auftraege()).toHaveLength(1);
        expect(await protokoll("system.community_mail_neu")).toHaveLength(1);
    });

    it("🔴 Neue Mail: höchstens 20 je Person und Tag (429 `community_mail_grenze`); eine andere Person ist davon nicht betroffen", async () => {
        for (let n = 0; n < COMMUNITY_GRENZEN.neueMailsJeTag; n += 1)
            expect(code(await neueMail({ betreff: `Nr. ${String(n)}` })), String(n)).toBe("201");
        const zuviel = await neueMail({ betreff: "Eine zu viel" });
        expect(code(zuviel)).toBe("429 community_mail_grenze");
        expect(await ausgaenge()).toHaveLength(COMMUNITY_GRENZEN.neueMailsJeTag);
        expect(await auftraege()).toHaveLength(COMMUNITY_GRENZEN.neueMailsJeTag);
        expect(code(await neueMail({ betreff: "Olga schreibt" }, olga.cookie))).toBe("201");
        // Nach einem Tag zählt die alte Mail nicht mehr.
        await database`UPDATE avesmaps_community.vorgang SET eingegangen_at = now() - interval '25 hours' WHERE angelegt_von = ${olaf.id}::uuid`;
        expect(code(await neueMail({ betreff: "Neuer Tag" }))).toBe("201");
    });

    it("🔴 Protokoll der neuen Mail: feste Schlüssel, der Empfänger nur als Hash; in keiner Zeile steht Adresse, Betreff, Text oder ein Geheimnis", async () => {
        const an = "Fremde.Person@Example.NET";
        expect(code(await neueMail({ an, betreff: "Vertraulicher Betreff", text: "Vertraulicher Text." }))).toBe("201");
        const eintraege = await protokoll("system.community_mail_neu");
        expect(eintraege).toHaveLength(1);
        expect(Object.keys(eintraege[0]!.details).sort()).toEqual(["com", "empfaenger"]);
        expect(eintraege[0]!.details["empfaenger"]).toMatch(/^[0-9a-f]{16}$/u);
        const alles = JSON.stringify(
            await database`SELECT * FROM avesmaps_auth.security_event WHERE action LIKE 'system.community_%'`,
        );
        for (const verboten of ["fremde.person", "Fremde.Person", "example.net", "Vertraulich", KENNWORT, NUTZER])
            expect(alles).not.toContain(verboten);
        // Dieselbe Adresse in anderer Schreibweise gibt denselben Hash.
        expect(code(await neueMail({ an: "fremde.person@example.net", betreff: "Zwei" }))).toBe("201");
        const zwei = await protokoll("system.community_mail_neu");
        expect(zwei[1]!.details["empfaenger"]).toBe(zwei[0]!.details["empfaenger"]);
    });

    // --- Aufbewahrung -----------------------------------------------------------------------------------------------------

    it("🔴 Aufbewahrung: die Adresse der ausgehenden Mails fällt mit den Kontaktdaten nach 90 Tagen weg; Betreff, Text und Zustand bleiben; eine wartende Mail ohne Adresse wird `fehler`", async () => {
        const { nummer, id } = await frage();
        await antworten(nummer, { archivieren: true });
        const [eintrag] = await ausgaenge();
        await lauf(Number(eintrag?.id), stelle().fabrik);
        // Zwei Mails: Die zweite wartet noch, wenn die Frist abläuft.
        const zwei = await frage({ mail: "zweite@example.org" });
        await antworten(zwei.nummer);
        await database`UPDATE avesmaps_community.vorgang SET abgeschlossen_at = now() - interval '91 days' WHERE id = ${id}::bigint`;
        const ergebnis = await communityAufbewahrung(database);
        expect(ergebnis.kontakt).toBe(1);
        const alle = await ausgaenge();
        expect(alle[0]).toMatchObject({ an: null, zustand: "gesendet" });
        expect(alle[0]?.betreff).toContain(nummer);
        expect(alle[1]).toMatchObject({ an: "zweite@example.org", zustand: "wartet" });
        const d = await detail(nummer);
        expect(d.melder.entfernt).toBe(true);
        expect(d.verlauf.find((e) => e.art === "nachricht" && e.richtung === "aus")).toMatchObject({
            text: expect.any(String),
            zustellung: { zustand: "gesendet", an: null },
        });
        // Personenbezug löschen (Datenschutzanfrage): die Adresse der zweiten Anfrage fällt ebenfalls weg, eine wartende Mail endet als `fehler`.
        await database`SELECT avesmaps_community.community_personenbezug_loeschen(${randomUUID()}::uuid, ${zwei.id}::bigint, ${olaf.id}::uuid)`;
        const [, zweite] = await ausgaenge();
        expect(zweite?.an).toBeNull();
        const transport = stelle();
        expect(await lauf(Number(zweite?.id), transport.fabrik)).toMatchObject({ zustand: "fehler" });
        expect(transport.aufrufe()).toBe(0);
        expect((await ausgaenge())[1]).toMatchObject({
            zustand: "fehler",
            fehler: "Die Adresse ist nicht mehr gespeichert",
        });
    });

    it("der Papierkorb löscht die Ausgänge mit dem Vorgang", async () => {
        const { nummer, id } = await frage();
        await antworten(nummer);
        expect(await ausgaenge()).toHaveLength(1);
        await database`UPDATE avesmaps_community.vorgang SET zustand = 'abgeschlossen', ergebnis = 'spam', abgeschlossen_at = now() - interval '40 days', papierkorb_at = now() - interval '31 days' WHERE id = ${id}::bigint`;
        expect((await communityAufbewahrung(database)).geloescht).toBe(1);
        expect(await ausgaenge()).toEqual([]);
    });
});
