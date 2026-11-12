import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    AVENTURIA,
    MAIL_WIEDER_GEOEFFNET,
    VorgangDetail,
    type Role,
    type VorgangDetail as Detail,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { communityAufbewahrung } from "../src/community/aufbewahrung.ts";
import { dateiAblage } from "../src/community/mail/ablage.ts";
import { verarbeiteMail, istGesperrt, saubererDateiname, GESPERRTE_ENDUNGEN } from "../src/community/mail/eingang.ts";
import {
    ABRUF_VARIABLEN,
    COMMUNITY_MAIL_ABRUF_KIND,
    MAIL_VARIABLEN,
    abrufAn,
    leseAblage,
    leseAbrufKonfiguration,
} from "../src/community/mail/konfiguration.ts";
import {
    AbrufStoerung,
    GRENZE_MAIL_BYTES,
    MAX_MAILS_JE_LAUF,
    abrufFehler,
    imapQuelle,
    type ImapLeser,
    type PostfachMail,
    type PostfachQuelle,
    type PostfachStand,
} from "../src/community/mail/postfach.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { JOB_HANDLERS, JobFailure, type JobContext } from "../src/jobs/handlers.ts";
import { LEICHTE_ARTEN } from "../src/jobs/dirigent/plan.ts";
import { JOB_KIND_CATALOG, knowsKind } from "../src/jobs/kinds.ts";
import { runCommunityMailAbrufJob } from "../src/jobs/community-mail-abruf-job.ts";
import { insertJob } from "../src/jobs/store.ts";
import { JobWorker } from "../src/jobs/worker.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { fakeMemory, fakeSpawner, testJobsConfig, uniqueScope } from "./support/jobs-support.ts";

/**
 * Der Mailabruf des Community-Moduls (WI-0268 C6b; Fachkonzept §3.4, §10.2, Bedienkonzept §3.1, §3.2, §3.4; Migration 0281) mit gestellter Quelle: es wird NIE ein echtes Postfach abgefragt. Die Mails sind
 * Roh-MIME aus Fixtures, im Test gebaut.
 *
 * - Konfiguration: fehlt eine Angabe, ist der Abruf aus; die Zugangsdaten tauchen nirgends auf.
 * - Die Quelle über IMAP liest NUR (schreibgeschützter Ordner, kein Flag, kein Verschieben, kein Löschen) - mit einem aufzeichnenden Client geprüft.
 * - Verarbeitung: Sperrliste, Grenze, Bild neu kodiert (ohne EXIF), Dateinamen gesäubert, Rohmail und Dateien in der Ablage.
 * - Datenbank: neue Mail wird eine Anfrage; Antwort im Faden hängt an und öffnet aus dem Archiv; `[COM-…]` nur vom Melder; dieselbe Message-ID zweimal legt nichts an; UIDVALIDITY.
 * - Aufbewahrung (Fachkonzept §10.2): Kontaktdaten und Rohmail gehen nach 90 Tagen, Anhänge bleiben; sie gehen mit dem Personenbezug oder dem Papierkorb; der Abruf räumt die Ablage auf.
 * - Route der Anhänge: Recht, Kopfzeilen, kein Pfad aus der Anfrage.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const KENNWORT = "geheim-kennwort-4711";
const NUTZER = "redaktion-konto@example.org";
const HOST = "imap.example.invalid";
const ABRUF_ENV = {
    COMMUNITY_MAIL_IMAP_HOST: HOST,
    COMMUNITY_MAIL_USER: NUTZER,
    COMMUNITY_MAIL_PASSWORD: KENNWORT,
    COMMUNITY_MAIL_ABLAGE: join(tmpdir(), "avesmaps-ablage-konfig"),
} as const;
const SMTP_ENV: Record<(typeof MAIL_VARIABLEN)[number], string> = {
    COMMUNITY_MAIL_SMTP_HOST: "smtp.example.invalid",
    COMMUNITY_MAIL_SMTP_PORT: "587",
    COMMUNITY_MAIL_USER: NUTZER,
    COMMUNITY_MAIL_PASSWORD: KENNWORT,
    COMMUNITY_MAIL_FROM: "Avesmaps-Redaktion <info@avesmaps.de>",
};
const MAIL = "Alrike.Fischer@example.org";
const KB = 1024;
const MB = 1024 * 1024;

// --- Roh-MIME aus Fixtures ----------------------------------------------------------------------------------------------------------------------------------------------------------

interface Teil {
    name: string;
    mime: string;
    inhalt: Buffer;
    cid?: string;
}

interface MailOptionen {
    /** `null`: keine Message-ID. */
    messageId?: string | null;
    von?: string;
    betreff?: string;
    inReplyTo?: string;
    references?: string[];
    text?: string | null;
    html?: string | null;
    anhaenge?: Teil[];
    kopfzeilen?: string[];
}

let zaehler = 0;
const neueId = (): string => `<fixture-${String(++zaehler)}.${randomUUID()}@mail.example.org>`;
const base64 = (inhalt: Buffer | string): string =>
    (Buffer.isBuffer(inhalt) ? inhalt : Buffer.from(inhalt, "utf8")).toString("base64").replace(/.{1,76}/gu, "$&\r\n");
const kodiertesWort = (text: string): string => `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;

function baueMime(o: MailOptionen = {}): Buffer {
    const kopf = [
        ...(o.messageId === null ? [] : [`Message-ID: ${o.messageId ?? neueId()}`]),
        `From: ${o.von ?? `${kodiertesWort("Alrike Fischer")} <${MAIL}>`}`,
        "To: Avesmaps-Redaktion <info@avesmaps.de>",
        `Subject: ${o.betreff ?? "Frage zur Karte"}`,
        "Date: Sat, 31 Oct 2026 10:00:00 +0100",
        "MIME-Version: 1.0",
        ...(o.inReplyTo === undefined ? [] : [`In-Reply-To: ${o.inReplyTo}`]),
        ...(o.references === undefined ? [] : [`References: ${o.references.join(" ")}`]),
        ...(o.kopfzeilen ?? []),
    ];
    const text =
        o.text === undefined ? "Darf die Karte für ein Spielleiterhandbuch verwendet werden?\nVielen Dank!" : o.text;
    const anhaenge = o.anhaenge ?? [];
    const eingebettet = anhaenge.filter((teil) => teil.cid !== undefined);
    const angehaengt = anhaenge.filter((teil) => teil.cid === undefined);
    const textTeil = (inhalt: string, art: "plain" | "html"): string =>
        `Content-Type: text/${art}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(inhalt)}`;
    if (o.html === undefined || o.html === null) {
        if (anhaenge.length === 0) return Buffer.from([...kopf, textTeil(text ?? "", "plain")].join("\r\n"), "utf8");
    }
    const teileVon = (grenze: string, teile: string[]): string =>
        `${teile.map((teil) => `--${grenze}\r\n${teil}`).join("\r\n")}\r\n--${grenze}--\r\n`;
    // Namen als RFC 2231 (prozentkodiert), damit auch ein Name mit Anführungszeichen oder Zeilenumbruch die Kopfzeilen der Fixture nicht zerbricht.
    const prozent = (name: string): string =>
        encodeURIComponent(name).replace(/['()*!]/gu, (z) => `%${z.charCodeAt(0).toString(16).toUpperCase()}`);
    const dateiTeil = (teil: Teil): string =>
        `Content-Type: ${teil.mime}; name*=UTF-8''${prozent(teil.name)}\r\n` +
        (teil.cid === undefined ? "" : `Content-ID: <${teil.cid}>\r\n`) +
        `Content-Disposition: ${teil.cid === undefined ? "attachment" : "inline"}; filename*=UTF-8''${prozent(teil.name)}\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n${base64(teil.inhalt)}`;
    const htmlTeil =
        o.html === undefined || o.html === null
            ? undefined
            : eingebettet.length === 0
              ? textTeil(o.html, "html")
              : `Content-Type: multipart/related; boundary="rel"\r\n\r\n${teileVon("rel", [textTeil(o.html, "html"), ...eingebettet.map(dateiTeil)])}`;
    const alternativ =
        htmlTeil === undefined
            ? textTeil(text ?? "", "plain")
            : `Content-Type: multipart/alternative; boundary="alt"\r\n\r\n${teileVon("alt", [...(text === null ? [] : [textTeil(text, "plain")]), htmlTeil])}`;
    const gemischt = `Content-Type: multipart/mixed; boundary="mix"\r\n\r\n${teileVon("mix", [alternativ, ...angehaengt.map(dateiTeil)])}`;
    return Buffer.from([...kopf, gemischt].join("\r\n"), "utf8");
}

const idVon = (mime: Buffer): string => /^Message-ID: (.+)$/mu.exec(mime.toString("latin1"))![1]!.trim();

async function bild(format: "jpeg" | "png" | "gif" | "webp", mitExif = false, drehung?: number): Promise<Buffer> {
    let pipeline = sharp({ create: { width: 40, height: 30, channels: 3, background: "#cc0000" } });
    if (mitExif) pipeline = pipeline.withExif({ IFD0: { Copyright: "Geheim-Rechte", Artist: "Max Mustermann" } });
    if (drehung !== undefined) pipeline = pipeline.withMetadata({ orientation: drehung });
    return pipeline[format]().toBuffer();
}

// --- Konfiguration --------------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("Mailabruf: Konfiguration", () => {
    it("🔴 fehlt eine Pflichtangabe (oder ist sie unbrauchbar), ist der Abruf aus; Port und Ordner haben Vorgaben", () => {
        expect(abrufAn({ ...ABRUF_ENV })).toBe(true);
        for (const name of ABRUF_VARIABLEN) {
            expect(abrufAn({ ...ABRUF_ENV, [name]: undefined }), name).toBe(false);
            expect(abrufAn({ ...ABRUF_ENV, [name]: "  " }), name).toBe(false);
        }
        expect(abrufAn({})).toBe(false);
        expect(abrufAn({ ...ABRUF_ENV, COMMUNITY_MAIL_IMAP_PORT: "abc" })).toBe(false);
        expect(abrufAn({ ...ABRUF_ENV, COMMUNITY_MAIL_IMAP_PORT: "0" })).toBe(false);
        expect(abrufAn({ ...ABRUF_ENV, COMMUNITY_MAIL_IMAP_PORT: "70000" })).toBe(false);
        expect(abrufAn({ ...ABRUF_ENV, COMMUNITY_MAIL_IMAP_HOST: "imap.example.org/../x" })).toBe(false);
        // Die Ablage muss ein absoluter Pfad sein; ein relativer oder einer mit Steuerzeichen schaltet den Abruf aus.
        expect(abrufAn({ ...ABRUF_ENV, COMMUNITY_MAIL_ABLAGE: "relativ/ablage" })).toBe(false);
        expect(abrufAn({ ...ABRUF_ENV, COMMUNITY_MAIL_ABLAGE: `${ABRUF_ENV.COMMUNITY_MAIL_ABLAGE}\u0000x` })).toBe(
            false,
        );
        expect(abrufAn({ ...ABRUF_ENV, COMMUNITY_MAIL_ORDNER: "In\nbox" })).toBe(false);
        const zugang = leseAbrufKonfiguration({ ...ABRUF_ENV });
        expect(zugang).toMatchObject({
            host: HOST,
            port: 993,
            ordner: "INBOX",
            ablage: ABRUF_ENV.COMMUNITY_MAIL_ABLAGE,
        });
        expect(zugang?.imapOptionen()).toMatchObject({
            secure: true,
            doSTARTTLS: false,
            logger: false,
            emitLogs: false,
        });
        expect(
            leseAbrufKonfiguration({
                ...ABRUF_ENV,
                COMMUNITY_MAIL_IMAP_PORT: "143",
                COMMUNITY_MAIL_ORDNER: "Redaktion",
            }),
        ).toMatchObject({
            port: 143,
            ordner: "Redaktion",
        });
        expect(leseAbrufKonfiguration({ ...ABRUF_ENV, COMMUNITY_MAIL_IMAP_PORT: "143" })?.imapOptionen()).toMatchObject(
            { secure: false, doSTARTTLS: true },
        );
        expect(leseAblage({ COMMUNITY_MAIL_ABLAGE: ABRUF_ENV.COMMUNITY_MAIL_ABLAGE })).toBe(
            ABRUF_ENV.COMMUNITY_MAIL_ABLAGE,
        );
        expect(leseAblage({})).toBeUndefined();
    });

    it("🔴 Nutzer und Kennwort stehen nie in JSON, Aufzählung, Fehlerausgabe oder Spread; nur der Client bekommt sie", () => {
        const zugang = leseAbrufKonfiguration({ ...ABRUF_ENV });
        expect(zugang).toBeDefined();
        const sichtbar = [
            JSON.stringify(zugang),
            inspect(zugang, { depth: 5 }),
            JSON.stringify({ ...zugang }),
            String(Object.keys(zugang ?? {})),
        ].join("\n");
        expect(sichtbar).not.toContain(KENNWORT);
        expect(sichtbar).not.toContain(NUTZER);
        expect(zugang?.imapOptionen().auth).toEqual({ user: NUTZER, pass: KENNWORT });
    });

    it("die Jobart steht im Katalog (queued, leicht, ohne Sperre der Kartendomäne) und hat einen Handler", () => {
        expect(JOB_KIND_CATALOG[COMMUNITY_MAIL_ABRUF_KIND]).toMatchObject({
            kind: "community_mail_abruf",
            version: 1,
            origin: "queued",
            holdsSharedDomainLock: false,
        });
        expect(knowsKind(COMMUNITY_MAIL_ABRUF_KIND, 1)).toBe(true);
        expect(LEICHTE_ARTEN.has(COMMUNITY_MAIL_ABRUF_KIND)).toBe(true);
        expect(Object.keys(JOB_HANDLERS)).toContain(COMMUNITY_MAIL_ABRUF_KIND);
    });
});

// --- Die Quelle über IMAP: nur lesend ---------------------------------------------------------------------------------------------------------------------------------------

interface FalscheMail {
    uid: number;
    groesse: number;
    source?: Buffer;
    headers?: Buffer;
}

/** Ein Client, der jeden Aufruf aufzeichnet und nur kann, was ein Leser können muss: Alles Weitere wäre ein Typfehler und, zur Laufzeit, ein Absturz des Tests. */
function falscherClient(optionen: { uidValidity: bigint; mails: FalscheMail[]; fehler?: unknown }) {
    const aufrufe: string[] = [];
    const client: ImapLeser = {
        connect() {
            aufrufe.push("connect");
            if (optionen.fehler !== undefined) return Promise.reject(optionen.fehler);
            return Promise.resolve();
        },
        getMailboxLock(pfad, optionenLock) {
            aufrufe.push(`lock:${pfad}:${JSON.stringify(optionenLock)}`);
            return Promise.resolve({ release: () => void aufrufe.push("release") });
        },
        get mailbox() {
            return { uidValidity: optionen.uidValidity };
        },
        search(abfrage) {
            aufrufe.push(`search:${abfrage.uid}`);
            const ab = Number(abfrage.uid.split(":")[0]);
            const alle = optionen.mails.map((mail) => mail.uid);
            // Wie ein echter Server: `n:*` enthält immer auch die jüngste UID.
            return Promise.resolve(alle.filter((uid) => uid >= ab || uid === Math.max(...alle)));
        },
        fetchOne(seq, abfrage) {
            aufrufe.push(`fetch:${seq}:${Object.keys(abfrage).join("+")}`);
            const mail = optionen.mails.find((m) => String(m.uid) === seq);
            if (mail === undefined) return Promise.resolve(false);
            return Promise.resolve({
                uid: mail.uid,
                ...(abfrage.size === true ? { size: mail.groesse } : {}),
                ...(abfrage.source === true && mail.source !== undefined ? { source: mail.source } : {}),
                ...(abfrage.headers === true && mail.headers !== undefined ? { headers: mail.headers } : {}),
            });
        },
        logout() {
            aufrufe.push("logout");
            return Promise.resolve();
        },
        on() {
            aufrufe.push("on");
            return client;
        },
    };
    return { client, aufrufe };
}

describe("Mailabruf: die Quelle über IMAP liest nur", () => {
    const zugang = leseAbrufKonfiguration({ ...ABRUF_ENV, COMMUNITY_MAIL_ORDNER: "Redaktion" })!;
    const kurz = (uid: number): FalscheMail => ({
        uid,
        groesse: 100,
        source: Buffer.from(`Message-ID: <m${String(uid)}@x>\r\n\r\ntext`),
    });

    it("🔴 der Ordner wird schreibgeschützt geöffnet; erlaubt sind nur connect, lock, search, fetch (source und headers), logout - nichts schreibt", async () => {
        const { client, aufrufe } = falscherClient({ uidValidity: 7n, mails: [kurz(1), kurz(2), kurz(3)] });
        const lauf = await imapQuelle(zugang, () => client).lies({ uidValidity: 7, letzteUid: 1 });
        expect(lauf.uidValidity).toBe(7);
        expect(lauf.nachrichten.map((mail) => mail.uid)).toEqual([2, 3]);
        expect(aufrufe).toContain('lock:Redaktion:{"readOnly":true}');
        // Jeder Aufruf gehört zu den lesenden.
        for (const aufruf of aufrufe)
            expect(aufruf, aufruf).toMatch(
                /^(?:on|connect|lock:|release|search:|fetch:\d+:(?:uid\+size|uid\+source|uid\+headers)$|logout)/u,
            );
        // Der Client kennt nicht einmal einen Aufruf zum Schreiben.
        for (const verb of [
            "messageFlagsAdd",
            "messageFlagsSet",
            "messageFlagsRemove",
            "messageMove",
            "messageCopy",
            "messageDelete",
            "append",
            "mailboxCreate",
            "mailboxDelete",
            "mailboxRename",
            "idle",
        ])
            expect(Object.keys(client), verb).not.toContain(verb);
        expect(aufrufe.at(-1)).toBe("logout");
        expect(aufrufe.indexOf("release")).toBeLessThan(aufrufe.indexOf("logout"));
    });

    it("liest ab der Stelle nach der letzten UID, älteste zuerst, höchstens 50 je Lauf", async () => {
        const viele = Array.from({ length: 120 }, (_, i) => kurz(i + 1));
        const { client } = falscherClient({ uidValidity: 1n, mails: viele });
        const quelle = imapQuelle(zugang, () => client);
        const erster = await quelle.lies({ uidValidity: null, letzteUid: 0 });
        expect(erster.nachrichten).toHaveLength(MAX_MAILS_JE_LAUF);
        expect(erster.nachrichten.map((mail) => mail.uid)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
        const zweiter = await quelle.lies({ uidValidity: 1, letzteUid: 50 });
        expect(zweiter.nachrichten[0]?.uid).toBe(51);
        expect(zweiter.nachrichten).toHaveLength(50);
        // Hinter der jüngsten UID gibt es nichts, auch wenn der Server die jüngste noch einmal nennt.
        const leer = await quelle.lies({ uidValidity: 1, letzteUid: 120 });
        expect(leer.nachrichten).toEqual([]);
    });

    it("🔴 wechselt UIDVALIDITY, liest die Quelle ab UID 1 neu", async () => {
        const { client, aufrufe } = falscherClient({ uidValidity: 99n, mails: [kurz(1), kurz(2)] });
        const lauf = await imapQuelle(zugang, () => client).lies({ uidValidity: 7, letzteUid: 2 });
        expect(lauf.uidValidity).toBe(99);
        expect(lauf.nachrichten.map((mail) => mail.uid)).toEqual([1, 2]);
        expect(aufrufe).toContain("search:1:*");
    });

    it("🔴 eine Mail über 30 MB wird nicht geholt: nur ihre Kopfzeilen, mit der Größe", async () => {
        const gross: FalscheMail = {
            uid: 5,
            groesse: GRENZE_MAIL_BYTES + 1,
            headers: Buffer.from("Message-ID: <gross@x>\r\nSubject: Riesig\r\n\r\n"),
        };
        const { client, aufrufe } = falscherClient({ uidValidity: 1n, mails: [gross, kurz(6)] });
        const lauf = await imapQuelle(zugang, () => client).lies({ uidValidity: null, letzteUid: 0 });
        expect(lauf.nachrichten[0]).toMatchObject({ uid: 5, zuGross: GRENZE_MAIL_BYTES + 1 });
        expect(lauf.nachrichten[0]?.roh.toString()).toContain("Subject: Riesig");
        expect(aufrufe).not.toContain("fetch:5:uid+source");
        expect(aufrufe).toContain("fetch:5:uid+headers");
        expect(lauf.nachrichten[1]?.uid).toBe(6);
    });

    it("🔴 ein Fehler der Verbindung wird ein Satz aus festem Wortschatz: nie sein Text, nie ein Geheimnis; die Anmeldung gilt als dauerhaft", async () => {
        const mitGeheimnis = (extra: Record<string, unknown>) =>
            Object.assign(new Error(`LOGIN ${NUTZER} ${KENNWORT} failed at ${HOST}`), extra);
        const faelle: [Record<string, unknown>, boolean][] = [
            [{ authenticationFailed: true }, false],
            [{ name: "AuthenticationFailure" }, false],
            [{ code: "NONEXISTENT" }, false],
            [{ code: "ECONNREFUSED" }, true],
            [{ code: "ETIMEDOUT" }, true],
            [{ code: "NoConnection" }, true],
            [{}, true],
        ];
        for (const [extra, wiederholbar] of faelle) {
            const stoerung = abrufFehler(mitGeheimnis(extra));
            expect(stoerung, JSON.stringify(extra)).toBeInstanceOf(AbrufStoerung);
            expect(stoerung.wiederholbar, JSON.stringify(extra)).toBe(wiederholbar);
            for (const geheim of [KENNWORT, NUTZER, HOST]) expect(stoerung.message).not.toContain(geheim);
        }
        const { client } = falscherClient({
            uidValidity: 1n,
            mails: [],
            fehler: mitGeheimnis({ authenticationFailed: true }),
        });
        const fehler = await imapQuelle(zugang, () => client)
            .lies({ uidValidity: null, letzteUid: 0 })
            .catch((f: unknown) => f);
        expect(fehler).toBeInstanceOf(AbrufStoerung);
        expect((fehler as Error).message).not.toContain(KENNWORT);
    });
});

// --- Verarbeitung einer Mail ----------------------------------------------------------------------------------------------------------------------------------------------------

describe("Mailabruf: Verarbeitung einer Mail", () => {
    let ordner: string;
    beforeAll(async () => {
        ordner = await mkdtemp(join(tmpdir(), "avesmaps-mail-"));
    });
    afterAll(async () => {
        await rm(ordner, { recursive: true, force: true });
    });

    const verarbeite = async (mime: Buffer, extra: Partial<PostfachMail> = {}) =>
        verarbeiteMail({ uid: 1, roh: mime, ...extra }, { ablage: dateiAblage(ordner), uid: 1, uidValidity: 5 });

    it("Text, HTML, Absender, Betreff, Kennungen und Rohmail in der Ablage (Name = SHA-256, nur der Inhalt)", async () => {
        const id = neueId();
        const antwortAuf = "<com-000007.2a6c9b7e-1111-4222-8333-444455556666@avesmaps.de>";
        const mime = baueMime({
            messageId: id,
            betreff: "Re: Frage [COM-000007]",
            inReplyTo: antwortAuf,
            references: ["<alt@x.example>", antwortAuf],
            text: "Hallo\nWelt",
            html: "<p>Hallo <b>Welt</b></p><script>boese()</script>",
        });
        const ergebnis = await verarbeite(mime);
        expect(ergebnis.mail).toMatchObject({
            messageId: id.toLowerCase(),
            inReplyTo: antwortAuf,
            verweise: ["<alt@x.example>", antwortAuf],
            vonAdresse: MAIL,
            vonName: "Alrike Fischer",
            betreff: "Re: Frage [COM-000007]",
            hinweis: null,
            externBilder: 0,
            uid: 1,
            uidvalidity: 5,
            groesse: mime.length,
        });
        expect(ergebnis.mail.text).toContain("Hallo");
        expect(ergebnis.mail.html).toContain("<b>Welt</b>");
        expect(ergebnis.mail.html).not.toContain("boese");
        expect(ergebnis.mail.rohDatei).toMatch(/^[0-9a-f]{64}$/u);
        const roh = await readFile(join(ordner, ergebnis.mail.rohDatei!));
        expect(roh.equals(mime)).toBe(true);
    });

    it("ohne Message-ID wird eine aus dem Inhalt abgeleitet: dieselbe Mail ergibt dieselbe Kennung", async () => {
        const mime = baueMime({ messageId: null });
        const a = await verarbeite(mime);
        const b = await verarbeite(mime);
        expect(a.mail.messageId).toMatch(/^<[0-9a-f]{64}@eingang\.invalid>$/u);
        expect(b.mail.messageId).toBe(a.mail.messageId);
    });

    it("🔴 Sperrliste nach Endung und MIME: ausführbare Dateien, Skripte, Makro-Dokumente, Archive und aktive Seiten werden nicht übernommen; Name und Größe bleiben", async () => {
        const inhalt = Buffer.from("MZ harmlos genug für den Test");
        const gesperrt: [string, string][] = [
            ["setup.exe", "application/octet-stream"],
            ["tool.com", "application/octet-stream"],
            ["skript.bat", "text/plain"],
            ["a.cmd", "text/plain"],
            ["b.scr", "application/octet-stream"],
            ["c.msi", "application/octet-stream"],
            ["d.dll", "application/octet-stream"],
            ["e.jar", "application/java-archive"],
            ["f.js", "application/javascript"],
            ["g.vbs", "text/plain"],
            ["h.ps1", "text/plain"],
            ["i.hta", "text/html"],
            ["j.lnk", "application/octet-stream"],
            ["k.reg", "text/plain"],
            ["l.iso", "application/octet-stream"],
            ["m.apk", "application/octet-stream"],
            ["n.sh", "text/x-shellscript"],
            ["makro.docm", "application/octet-stream"],
            ["makro.xlsm", "application/octet-stream"],
            ["makro.pptm", "application/octet-stream"],
            ["vorlage.dotm", "application/octet-stream"],
            ["archiv.zip", "application/zip"],
            ["archiv.rar", "application/octet-stream"],
            ["seite.html", "text/html"],
            ["bild.svg", "image/svg+xml"],
            // Doppelendung und falsche Art: Die Sperre greift auf beide Angaben.
            ["rechnung.pdf.exe", "application/pdf"],
            ["harmlos.txt", "application/x-msdownload"],
            ["harmlos2.txt", "application/vnd.ms-word.document.macroEnabled.12"],
            ["harmlos3.txt", "application/x-ms-shortcut"],
            ["GROSS.EXE", "application/octet-stream"],
        ];
        const ergebnis = await verarbeite(
            baueMime({ anhaenge: gesperrt.map(([name, mime]) => ({ name, mime, inhalt })) }),
        );
        expect(ergebnis.anhaenge).toHaveLength(gesperrt.length);
        for (const [i, [name]] of gesperrt.entries()) {
            expect(ergebnis.anhaenge[i], name).toMatchObject({
                dateiname: name,
                groesse: inhalt.length,
                datei: null,
                grund: "typ",
            });
            expect(istGesperrt(name, gesperrt[i]![1]), name).toBe(true);
        }
        // Die Sperrliste kennt mindestens alle Endungen der Vorgabe.
        for (const endung of [
            "exe",
            "com",
            "bat",
            "cmd",
            "cpl",
            "scr",
            "pif",
            "msi",
            "msp",
            "dll",
            "sys",
            "jar",
            "js",
            "jse",
            "vbs",
            "vbe",
            "wsf",
            "wsh",
            "ps1",
            "psm1",
            "hta",
            "lnk",
            "reg",
            "iso",
            "img",
            "apk",
            "app",
            "sh",
            "docm",
            "dotm",
            "xlsm",
            "xltm",
            "pptm",
            "potm",
            "zip",
        ])
            expect(GESPERRTE_ENDUNGEN.has(endung), endung).toBe(true);
    });

    it("erlaubt bleiben PDF, Text und Tabellen: unverändert abgelegt, mit Name, Art und Größe", async () => {
        const pdf = Buffer.from("%PDF-1.4\n%Test\n");
        const csv = Buffer.from("a;b\n1;2\n");
        const ergebnis = await verarbeite(
            baueMime({
                anhaenge: [
                    { name: "Beleg.pdf", mime: "application/pdf", inhalt: pdf },
                    { name: "Tabelle.csv", mime: "text/csv", inhalt: csv },
                    { name: "Notiz.txt", mime: "text/plain", inhalt: Buffer.from("Hallo") },
                ],
            }),
        );
        expect(ergebnis.anhaenge).toHaveLength(3);
        expect(ergebnis.anhaenge[0]).toMatchObject({
            dateiname: "Beleg.pdf",
            mime: "application/pdf",
            groesse: pdf.length,
            grund: null,
            cid: null,
        });
        const datei = ergebnis.anhaenge[0]!.datei!;
        expect((await readFile(join(ordner, datei))).equals(pdf)).toBe(true);
        expect(ergebnis.anhaenge[1]).toMatchObject({ mime: "text/csv", grund: null });
    });

    it("🔴 Grenze von 25 MB je Mail: was darüber liegt, steht mit Name und Größe da und wird nicht übernommen; kleinere danach schon", async () => {
        const ergebnis = await verarbeite(
            baueMime({
                anhaenge: [
                    { name: "eins.txt", mime: "text/plain", inhalt: Buffer.alloc(14 * MB, 97) },
                    { name: "zwei.txt", mime: "text/plain", inhalt: Buffer.alloc(12 * MB, 98) },
                    { name: "drei.txt", mime: "text/plain", inhalt: Buffer.alloc(KB, 99) },
                ],
            }),
        );
        expect(ergebnis.anhaenge[0]).toMatchObject({ dateiname: "eins.txt", grund: null, groesse: 14 * MB });
        expect(ergebnis.anhaenge[0]?.datei).toMatch(/^[0-9a-f]{64}$/u);
        expect(ergebnis.anhaenge[1]).toMatchObject({
            dateiname: "zwei.txt",
            grund: "grenze",
            groesse: 12 * MB,
            datei: null,
        });
        expect(ergebnis.anhaenge[2]).toMatchObject({ dateiname: "drei.txt", grund: null, groesse: KB });
    }, 60_000);

    it("🔴 Bilder werden mit sharp neu kodiert, ohne Metadaten (EXIF weg), in der Ausrichtung angewandt; die Art folgt dem Inhalt, nicht dem Namen", async () => {
        const jpeg = await bild("jpeg", true);
        expect((await sharp(jpeg).metadata()).exif).toBeDefined();
        expect(jpeg.includes(Buffer.from("Max Mustermann"))).toBe(true);
        const gedreht = await bild("jpeg", false, 6);
        const png = await bild("png");
        const gif = await bild("gif");
        const webp = await bild("webp");
        const ergebnis = await verarbeite(
            baueMime({
                anhaenge: [
                    { name: "foto.jpg", mime: "image/jpeg", inhalt: jpeg },
                    { name: "gedreht.jpg", mime: "image/jpeg", inhalt: gedreht },
                    { name: "unbenannt.jpg", mime: "application/octet-stream", inhalt: png },
                    { name: "tuer.png", mime: "image/png", inhalt: png },
                    { name: "bewegt.gif", mime: "image/gif", inhalt: gif },
                    { name: "neu.webp", mime: "image/webp", inhalt: webp },
                    { name: "falsch.png", mime: "image/jpeg", inhalt: png },
                ],
            }),
        );
        const geladen = async (i: number) => readFile(join(ordner, ergebnis.anhaenge[i]!.datei!));
        const foto = await geladen(0);
        expect(foto.equals(jpeg)).toBe(false);
        expect(foto.includes(Buffer.from("Max Mustermann"))).toBe(false);
        expect(foto.includes(Buffer.from("Geheim-Rechte"))).toBe(false);
        expect((await sharp(foto).metadata()).exif).toBeUndefined();
        expect(ergebnis.anhaenge[0]).toMatchObject({ mime: "image/jpeg", grund: null });
        const meta = await sharp(await geladen(1)).metadata();
        expect([meta.width, meta.height]).toEqual([30, 40]);
        expect(meta.orientation).toBeUndefined();
        // Die Art folgt dem Bild, nicht dem Namen oder der Angabe des Absenders.
        expect(ergebnis.anhaenge[2]).toMatchObject({ mime: "image/png", grund: null });
        expect(ergebnis.anhaenge[3]).toMatchObject({ mime: "image/png" });
        expect(ergebnis.anhaenge[4]).toMatchObject({ mime: "image/gif" });
        expect(ergebnis.anhaenge[5]).toMatchObject({ mime: "image/webp" });
        expect(ergebnis.anhaenge[6]).toMatchObject({ mime: "image/png" });
        for (const i of [0, 1, 2, 3, 4, 5, 6])
            expect((await sharp(await geladen(i)).metadata()).format, String(i)).toBeDefined();
    });

    it("🔴 ein Bild, das sharp nicht lesen kann, ist gesperrt (kein Bild, das wir zeigen)", async () => {
        const kaputt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("das ist kein Bild")]);
        const ergebnis = await verarbeite(
            baueMime({ anhaenge: [{ name: "kaputt.jpg", mime: "image/jpeg", inhalt: kaputt }] }),
        );
        expect(ergebnis.anhaenge[0]).toMatchObject({ dateiname: "kaputt.jpg", datei: null, grund: "typ" });
    });

    it("eingebettete Bilder (cid) werden Anhänge mit Content-ID; das HTML zeigt auf cid:<Token>, wo es einen Anhang gibt, sonst fällt das Bild weg", async () => {
        const logo = await bild("png");
        const ergebnis = await verarbeite(
            baueMime({
                html: '<p>Mit Logo</p><img src="cid:logo@avesmaps.de" alt="Logo"><img src="cid:fehlt@x"><img src="https://tracker.example/p.gif">',
                anhaenge: [{ name: "logo.png", mime: "image/png", inhalt: logo, cid: "logo@avesmaps.de" }],
            }),
        );
        expect(ergebnis.anhaenge[0]).toMatchObject({ cid: "logo@avesmaps.de", grund: null });
        expect(ergebnis.mail.html).toContain('src="cid:logo@avesmaps.de"');
        expect(ergebnis.mail.html).not.toContain("fehlt");
        expect(ergebnis.mail.externBilder).toBe(1);
        expect(ergebnis.mail.html).toContain('data-extern="https://tracker.example/p.gif"');
    });

    it("🔴 eine Mail über der Grenze: nur Kopfzeilen, Hinweis, keine Anhänge", async () => {
        const kopf = Buffer.from(
            `Message-ID: <gross@x.example>\r\nFrom: Max <max@example.org>\r\nSubject: Riesig\r\n\r\n`,
        );
        const ergebnis = await verarbeite(kopf, { zuGross: 31 * MB });
        expect(ergebnis.mail).toMatchObject({
            messageId: "<gross@x.example>",
            vonAdresse: "max@example.org",
            betreff: "Riesig",
            hinweis: "zu_gross",
            text: null,
            html: null,
            groesse: 31 * MB,
        });
        expect(ergebnis.anhaenge).toEqual([]);
    });

    it("Dateinamen werden gesäubert: kein Pfad, keine Steuerzeichen, höchstens 120 Zeichen, die Endung bleibt", () => {
        expect(saubererDateiname("../../etc/passwd")).toBe("passwd");
        expect(saubererDateiname("C:\\Windows\\system32\\evil.txt")).toBe("evil.txt");
        expect(saubererDateiname('a"b\r\nX-Header: y.txt')).toBe("a_b X-Header_ y.txt");
        expect(saubererDateiname("\u202etxt.exe")).toBe("txt.exe");
        expect(saubererDateiname("")).toBe("Anhang");
        expect(saubererDateiname(undefined)).toBe("Anhang");
        expect(saubererDateiname("...")).toBe("Anhang");
        expect(saubererDateiname(".bashrc")).toBe("bashrc");
        const lang = saubererDateiname(`${"a".repeat(300)}.pdf`);
        expect(lang).toHaveLength(120);
        expect(lang.endsWith(".pdf")).toBe(true);
    });

    it("🔴 die Ablage legt Dateien privat unter dem SHA-256 ab, legt Gleiches nur einmal ab und löscht im Abgleich, was die Datenbank nicht kennt", async () => {
        const dir = await mkdtemp(join(tmpdir(), "avesmaps-ablage-"));
        try {
            const ablage = dateiAblage(join(dir, "neu"));
            const a = await ablage.schreibe(Buffer.from("eins"));
            const a2 = await ablage.schreibe(Buffer.from("eins"));
            const b = await ablage.schreibe(Buffer.from("zwei"));
            expect(a2).toBe(a);
            expect(a).toMatch(/^[0-9a-f]{64}$/u);
            expect((await readdir(join(dir, "neu"))).sort()).toEqual([a, b].sort());
            // Ein Name, der keiner ist, öffnet nie etwas.
            for (const schlecht of ["../x", "a/b", a.slice(1), `${a}.tmp`, a.toUpperCase(), ""])
                await expect(ablage.oeffne(schlecht), schlecht).rejects.toThrow();
            expect(await ablage.oeffne("0".repeat(64))).toBeUndefined();
            const offen = await ablage.oeffne(a);
            expect(offen?.groesse).toBe(4);
            offen?.stream.destroy();
            // Fremde Dateien und junge Dateien fasst der Abgleich nie an.
            await writeFile(join(dir, "neu", "notiz.txt"), "bleibt");
            const behalten = (namen: string[]) => Promise.resolve(namen.filter((name) => name === a));
            expect(await ablage.gleicheAb(behalten)).toEqual({ geprueft: 0, geloescht: 0 });
            expect(await ablage.gleicheAb(behalten, { mindestAlterMs: 0 })).toEqual({ geprueft: 2, geloescht: 1 });
            expect((await readdir(join(dir, "neu"))).sort()).toEqual([a, "notiz.txt"].sort());
            await mkdir(join(dir, "leer"));
            expect(await dateiAblage(join(dir, "nirgends")).gleicheAb(behalten)).toEqual({ geprueft: 0, geloescht: 0 });
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

// --- Datenbank ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------

function serverConfig(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "community-mail-abruf-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Community: Mailabruf (PostgreSQL, gestellte Quelle)", { timeout: 180_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let lena: { id: string; cookie: string };
    let olaf: { id: string; cookie: string };
    let olga: { id: string; cookie: string };
    let alle: string[];
    let ablageDir: string;
    let adresse = 10;
    const neueAdresse = (): string => `10.42.0.${String(adresse++)}`;
    const gesichert: Record<string, string | undefined> = {};
    const UMGEBUNG = { ...ABRUF_ENV, AVESMAPS_ENV: TEST_AUTH.environment ?? "development" };
    let uidNummer = 0;

    async function leeren(): Promise<void> {
        await database`DELETE FROM job WHERE kind = ANY(${["community_mail_versand", COMMUNITY_MAIL_ABRUF_KIND]}::text[])`;
        await database`DELETE FROM avesmaps_community.vorgang`;
        await database`DELETE FROM avesmaps_community.mail_abruf_stand`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE action LIKE 'system.community_%'`;
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;
    }

    beforeAll(async () => {
        for (const name of [...MAIL_VARIABLEN, "COMMUNITY_MAIL_ABLAGE"]) gesichert[name] = process.env[name];
        ablageDir = await mkdtemp(join(tmpdir(), "avesmaps-abruf-"));
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
        olaf = await person("operator", "Olaf");
        olga = await person("operator", "Olga");
        alle = [lena.id, olaf.id, olga.id];
    });

    beforeEach(async () => {
        for (const name of MAIL_VARIABLEN) process.env[name] = SMTP_ENV[name];
        process.env["COMMUNITY_MAIL_ABLAGE"] = ablageDir;
        await leeren();
        await rm(ablageDir, { recursive: true, force: true });
        await mkdir(ablageDir, { recursive: true });
        uidNummer = 0;
    });

    afterAll(async () => {
        for (const name of [...MAIL_VARIABLEN, "COMMUNITY_MAIL_ABLAGE"]) {
            const alt = gesichert[name];
            if (alt === undefined) delete process.env[name];
            else process.env[name] = alt;
        }
        await app?.close();
        await leeren().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        await rm(ablageDir, { recursive: true, force: true });
    });

    // --- Hilfen -----------------------------------------------------------------------------------------------------------

    const postOeffentlich = (url: string, payload: Record<string, unknown>) =>
        app.inject({ method: "POST", url, payload, remoteAddress: neueAdresse(), headers: { origin: TEST_ORIGIN } });
    const get = (url: string, cookie?: string) =>
        app.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });
    const post = (url: string, payload: Record<string, unknown>, cookie: string) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const frage = async () => {
        const antwort = await postOeffentlich("/api/community/anfragen", {
            operationId: randomUUID(),
            schluessel: randomBytes(32).toString("base64url"),
            kategorie: "frage",
            text: "Darf die Karte für ein Spielleiterhandbuch verwendet werden? Wir würden gern einen Ausschnitt drucken.",
            name: "Alrike",
            mail: MAIL,
            falle: { feld: "", dauerMs: 8000 },
        });
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
    const antworten = async (nummer: string) =>
        post(
            `/api/community/vorgaenge/${nummer}/antworten`,
            {
                operationId: randomUUID(),
                baseRevision: await revisionVon(nummer),
                text: "Ja, gern: Bitte nennen Sie die Quelle.",
                archivieren: false,
            },
            olaf.cookie,
        );
    const insArchiv = async (nummer: string) =>
        post(
            `/api/community/vorgaenge/${nummer}/ins-archiv`,
            { operationId: randomUUID(), baseRevision: await revisionVon(nummer) },
            olaf.cookie,
        );
    const kontext = (): JobContext => ({
        input: {},
        attempt: 1,
        job: { id: 1, publicId: randomUUID(), leaseNo: 1, mapDomainId: AVENTURIA.mapDomain },
        beginPhase: () => Promise.resolve(),
        checkpoint: () => undefined,
    });

    /** Eine gestellte Quelle wie die echte: ab der letzten UID, höchstens 50, bei Wechsel von UIDVALIDITY von vorn. Sie schreibt sich auf, was sie gefragt wurde. */
    function quelle(mails: { roh: Buffer; uid?: number; zuGross?: number }[], uidValidity = 1) {
        const liste = mails.map((mail) => ({ ...mail, uid: mail.uid ?? ++uidNummer }));
        const staende: PostfachStand[] = [];
        const q: PostfachQuelle = {
            lies(stand) {
                staende.push({ ...stand });
                const ab = stand.uidValidity !== null && stand.uidValidity !== uidValidity ? 0 : stand.letzteUid;
                return Promise.resolve({
                    uidValidity,
                    nachrichten: liste
                        .filter((mail) => mail.uid > ab)
                        .slice(0, 50)
                        .map((mail) => ({
                            uid: mail.uid,
                            roh: mail.roh,
                            ...(mail.zuGross === undefined ? {} : { zuGross: mail.zuGross }),
                        })),
                });
            },
        };
        return { quelle: q, staende, uids: liste.map((mail) => mail.uid) };
    }
    const abruf = (q: PostfachQuelle, zusatz: { environment?: NodeJS.ProcessEnv; mindestalter?: number } = {}) =>
        runCommunityMailAbrufJob(kontext(), {
            database,
            environment: { ...UMGEBUNG, COMMUNITY_MAIL_ABLAGE: ablageDir, ...zusatz.environment },
            quelle: () => q,
            ...(zusatz.mindestalter === undefined ? {} : { abgleichMindestalterMs: zusatz.mindestalter }),
        });
    const vorgaenge = () =>
        database<
            {
                id: string;
                art: string;
                kategorie: string;
                eingang: string;
                zustand: string;
                ergebnis: string | null;
                zustaendig: string | null;
                archiviert_at: Date | null;
                name: string | null;
                mail: string | null;
            }[]
        >`
            SELECT v.id::text, v.art, v.kategorie, v.eingang, v.zustand, v.ergebnis, v.zustaendig::text, v.archiviert_at, m.name, m.mail
              FROM avesmaps_community.vorgang v LEFT JOIN avesmaps_community.melder m ON m.vorgang_id = v.id ORDER BY v.id
        `;
    const eingaenge = () =>
        database<
            {
                vorgang: string;
                message_id: string;
                von_adresse: string | null;
                von_name: string | null;
                betreff: string;
                text: string | null;
                html: string | null;
                extern_bilder: number;
                hinweis: string | null;
                roh_datei: string | null;
                uid: string;
                uidvalidity: string;
            }[]
        >`
            SELECT n.vorgang_id::text AS vorgang, e.message_id, e.von_adresse, e.von_name, e.betreff, e.text, e.html, e.extern_bilder, e.hinweis, e.roh_datei, e.uid::text, e.uidvalidity::text
              FROM avesmaps_community.mail_eingang e JOIN avesmaps_community.nachricht n ON n.id = e.nachricht_id ORDER BY e.id
        `;
    const anhaenge = () =>
        database<
            {
                id: string;
                vorgang: string;
                dateiname: string;
                mime: string;
                groesse: string;
                datei: string | null;
                cid: string | null;
                gesperrt: boolean;
                grund: string | null;
            }[]
        >`
            SELECT x.id::text, n.vorgang_id::text AS vorgang, x.dateiname, x.mime, x.groesse::text, x.datei, x.cid, x.gesperrt, x.grund
              FROM avesmaps_community.mail_anhang x JOIN avesmaps_community.nachricht n ON n.id = x.nachricht_id ORDER BY x.id
        `;
    const ereignisse = (id: number) =>
        database<{ art: string; vom_melder: boolean; text: string | null; neu: string | null }[]>`
            SELECT art, vom_melder, text, neu FROM avesmaps_community.ereignis WHERE vorgang_id = ${id}::bigint ORDER BY seq
        `;
    const glocke = async (art: string) =>
        database<{ an_person: string; text: string | null; quelle: string }[]>`
            SELECT an_person::text, text, quelle FROM public.benachrichtigung WHERE art = ${art} AND an_person = ANY(${alle}::uuid[]) ORDER BY id
        `;
    const ablageNamen = async (): Promise<string[]> => (await readdir(ablageDir)).sort();
    const nummerVon = (id: string | number): string => `COM-${String(id).padStart(6, "0")}`;
    const ausgangsId = async (id: number): Promise<string> =>
        (
            await database<{ message_id: string }[]>`
                SELECT a.message_id FROM avesmaps_community.mail_ausgang a JOIN avesmaps_community.nachricht n ON n.id = a.nachricht_id
                 WHERE n.vorgang_id = ${id}::bigint ORDER BY a.id DESC LIMIT 1
            `
        )[0]!.message_id;

    // --- Neue Mail ----------------------------------------------------------------------------------------------------------------

    it("🔴 eine neue Mail wird eine Anfrage: Melder mit Name und Adresse, Eingang Mail, Kategorie sonstiges, Zustand neu; die Glocke meldet es allen mit `read_mailbox`, ohne Inhalt", async () => {
        const html = `<p>Hallo <b>Redaktion</b></p><img src="https://tracker.example/p.gif"><script>boese()</script>`;
        const { quelle: q, uids } = quelle([
            { roh: baueMime({ betreff: "Karte für unser Spielleiterhandbuch", html }) },
        ]);
        const ergebnis = await abruf(q);
        expect(ergebnis).toMatchObject({ ergebnis: "gelesen", gelesen: 1, neu: 1, angehaengt: 0, doppelt: 0 });
        const alleVorgaenge = await vorgaenge();
        expect(alleVorgaenge).toHaveLength(1);
        expect(alleVorgaenge[0]).toMatchObject({
            art: "anfrage",
            kategorie: "sonstiges",
            eingang: "mail",
            zustand: "neu",
            name: "Alrike Fischer",
            mail: MAIL,
            zustaendig: null,
        });
        const [eingang] = await eingaenge();
        expect(eingang).toMatchObject({
            von_adresse: MAIL,
            von_name: "Alrike Fischer",
            betreff: "Karte für unser Spielleiterhandbuch",
            extern_bilder: 1,
            hinweis: null,
            uid: String(uids[0]),
            uidvalidity: "1",
        });
        expect(eingang!.html).toContain("<b>Redaktion</b>");
        expect(eingang!.html).not.toContain("boese");
        expect(eingang!.html).toContain('data-extern="https://tracker.example/p.gif"');
        expect(eingang!.text).toContain("Darf die Karte");
        // Der Stand rückt vor.
        expect(
            (
                await database`SELECT ordner, uidvalidity::int, letzte_uid::int FROM avesmaps_community.mail_abruf_stand`
            )[0],
        ).toMatchObject({ ordner: "INBOX", uidvalidity: 1, letzte_uid: uids[0] });
        // Die Glocke: Betreiber ja, Reviewer nein; der Text ist allein die Nummer.
        const nummer = nummerVon(alleVorgaenge[0]!.id);
        const hinweise = await glocke("community_nachricht");
        expect(hinweise.map((h) => h.an_person).sort()).toEqual([olaf.id, olga.id].sort());
        for (const hinweis of hinweise) {
            expect(hinweis.text).toBe(nummer);
            expect(hinweis.quelle).toBe(`community_nachricht:${nummer}`);
        }
        // Die Redaktion sieht die Mail im Detail: bereinigtes HTML, Betreff, blockiertes Bild.
        const d = await detail(nummer);
        expect(d.zeile).toMatchObject({ art: "anfrage", eingang: "mail", absender: "Alrike Fischer" });
        expect(d.melder.mail).toBe(MAIL);
        const nachricht = d.verlauf.find((e) => e.art === "nachricht");
        expect(nachricht).toMatchObject({
            richtung: "ein",
            weg: "mail",
            mail: { betreff: "Karte für unser Spielleiterhandbuch", externBilder: 1, hinweis: null, anhaenge: [] },
        });
        expect(nachricht?.art === "nachricht" ? nachricht.mail?.html : "").toContain("<b>Redaktion</b>");
        // In der Liste der Mails steht sie.
        const liste = await get("/api/community/vorgaenge?art=anfrage&segment=eingang", olaf.cookie);
        expect(code(liste)).toBe("200");
        expect((liste.json() as { zeilen: { nummer: string }[] }).zeilen.map((z) => z.nummer)).toContain(nummer);
    });

    it("🔴 die Anfrage und ihre Mail liest nur, wer `read_mailbox` hat: ein Reviewer bekommt 403 für Detail und Anhang", async () => {
        const { quelle: q } = quelle([
            {
                roh: baueMime({
                    anhaenge: [{ name: "Beleg.pdf", mime: "application/pdf", inhalt: Buffer.from("%PDF-1.4") }],
                }),
            },
        ]);
        await abruf(q);
        const [vorgang] = await vorgaenge();
        const nummer = nummerVon(vorgang!.id);
        expect(code(await get(`/api/community/vorgaenge/${nummer}`, lena.cookie))).toBe("403 community_forbidden");
        const [anhang] = await anhaenge();
        expect(code(await get(`/api/community/vorgaenge/${nummer}/anhaenge/${anhang!.id}`, lena.cookie))).toBe(
            "403 community_forbidden",
        );
        expect(code(await get(`/api/community/vorgaenge/${nummer}/anhaenge/${anhang!.id}`))).toMatch(/^401/u);
    });

    // --- Faden --------------------------------------------------------------------------------------------------------------------

    it("🔴 eine Antwort im Faden (In-Reply-To auf unsere Mail) hängt sich an den Vorgang: aus „wartet auf Antwort“ in Arbeit, Ereignis, Glocke an die zuständige Person; im Archiv öffnet eine weitere sie von selbst wieder", async () => {
        const { nummer, id } = await frage();
        expect(code(await antworten(nummer))).toBe("200");
        const unsere = await ausgangsId(id);
        expect((await detail(nummer)).zeile.zustand).toBe("rueckfrage");

        const antwort1 = baueMime({
            betreff: `Re: Frage [${nummer}]`,
            inReplyTo: unsere,
            references: [unsere],
            text: "Danke, die Quelle ist die Karte von 1012.",
            html: "<p>Danke!</p>",
        });
        const { quelle: q1 } = quelle([{ roh: antwort1 }]);
        expect(await abruf(q1)).toMatchObject({ gelesen: 1, neu: 0, angehaengt: 1, wiedergeoeffnet: 0 });
        expect(await vorgaenge()).toHaveLength(1);
        const d1 = await detail(nummer);
        expect(d1.zeile.zustand).toBe("in_arbeit");
        const mails = d1.verlauf.filter((e) => e.art === "nachricht" && e.weg === "mail" && e.richtung === "ein");
        expect(mails).toHaveLength(1);
        expect((await ereignisse(id)).map((e) => e.art)).toContain("antwort");
        // Die zuständige Person (Olaf, der geantwortet hat) bekommt „Antwort“, nicht die ganze Redaktion; der Text ist die Nummer.
        const antworten1 = await glocke("community_antwort");
        expect(antworten1).toHaveLength(1);
        expect(antworten1[0]).toMatchObject({ an_person: olaf.id, text: nummer });

        // Ins Archiv, dann eine weitere Mail im selben Faden (nur über References zur ersten Mail der Gegenseite): Der Vorgang öffnet sich von selbst.
        expect(code(await insArchiv(nummer))).toBe("200");
        const archiviert = await vorgaenge();
        expect(archiviert[0]).toMatchObject({ zustand: "abgeschlossen" });
        expect(archiviert[0]!.archiviert_at).not.toBeNull();
        const antwort2 = baueMime({
            betreff: "Noch eine Frage",
            references: ["<unbekannt@x.example>", idVon(antwort1)],
            text: "Und noch etwas.",
        });
        const { quelle: q2 } = quelle([{ roh: antwort2 }]);
        expect(await abruf(q2)).toMatchObject({ gelesen: 1, angehaengt: 1, wiedergeoeffnet: 1 });
        const nach = await vorgaenge();
        expect(nach).toHaveLength(1);
        expect(nach[0]).toMatchObject({ zustand: "in_arbeit", ergebnis: null, archiviert_at: null });
        const ev = await ereignisse(id);
        const wieder = ev.filter((e) => e.art === "wiedereroeffnet");
        expect(wieder).toHaveLength(1);
        expect(wieder[0]).toMatchObject({ vom_melder: true, text: MAIL_WIEDER_GEOEFFNET, neu: "in_arbeit" });
        expect(MAIL_WIEDER_GEOEFFNET).toBe("durch neue Nachricht wieder geöffnet");
        const antworten2 = await glocke("community_antwort");
        expect(antworten2).toHaveLength(2);
        expect(antworten2.every((a) => a.an_person === olaf.id && a.text === nummer)).toBe(true);
        expect(
            (await detail(nummer)).verlauf.filter(
                (e) => e.art === "nachricht" && e.weg === "mail" && e.richtung === "ein",
            ),
        ).toHaveLength(2);
    });

    it("🔴 `[COM-…]` im Betreff hängt an, aber nur von der Adresse des Melders; von einer fremden Adresse entsteht ein neuer Vorgang", async () => {
        const { nummer, id } = await frage();
        const vonMelder = baueMime({
            von: `"Alrike" <${MAIL.toUpperCase()}>`,
            betreff: `Re: Frage [${nummer}]`,
            text: "Nachtrag.",
        });
        const fremd = baueMime({
            von: "Fremder <fremder@example.net>",
            betreff: `Re: Frage [${nummer}]`,
            text: "Ich möchte mich einmischen.",
        });
        const unbekannt = baueMime({ betreff: "Frage [COM-999999]", text: "Gibt es nicht." });
        const { quelle: q } = quelle([{ roh: vonMelder }, { roh: fremd }, { roh: unbekannt }]);
        expect(await abruf(q)).toMatchObject({ gelesen: 3, neu: 2, angehaengt: 1 });
        const alleVorgaenge = await vorgaenge();
        expect(alleVorgaenge).toHaveLength(3);
        const ein = await eingaenge();
        expect(ein[0]!.vorgang).toBe(String(id));
        expect(ein[1]!.vorgang).not.toBe(String(id));
        expect(ein[2]!.vorgang).not.toBe(String(id));
        // Die Mail von der Adresse des Melders steht im Faden der Anfrage.
        expect(
            (await detail(nummer)).verlauf.filter(
                (e) => e.art === "nachricht" && e.weg === "mail" && e.richtung === "ein",
            ),
        ).toHaveLength(1);
    });

    it("🔴 dieselbe Message-ID zweimal legt nichts Neues an: kein Vorgang, keine Nachricht, keine zweite Meldung in der Glocke", async () => {
        const roh = baueMime({ text: "Einmal ist genug." });
        const { quelle: q1 } = quelle([{ roh }]);
        expect(await abruf(q1)).toMatchObject({ neu: 1, doppelt: 0 });
        // Dieselbe Mail unter einer anderen UID (etwa nach dem Verschieben im Postfach).
        const { quelle: q2 } = quelle([{ roh, uid: 77 }]);
        expect(await abruf(q2)).toMatchObject({ gelesen: 1, neu: 0, angehaengt: 0, doppelt: 1 });
        expect(await vorgaenge()).toHaveLength(1);
        expect(await eingaenge()).toHaveLength(1);
        expect(await glocke("community_nachricht")).toHaveLength(2);
        expect((await database`SELECT count(*)::int AS n FROM avesmaps_community.nachricht`)[0]!.n).toBe(1);
    });

    it("🔴 UIDVALIDITY: bei gleichem Wert liest der Abruf weiter, wo er aufhörte; wechselt er, beginnt er von vorn, und die Message-ID überspringt Bekanntes", async () => {
        const mails = Array.from({ length: 3 }, (_, i) => ({ roh: baueMime({ text: `Mail ${String(i + 1)}` }) }));
        const erste = quelle(mails, 1);
        expect(await abruf(erste.quelle)).toMatchObject({ gelesen: 3, neu: 3 });
        expect(erste.staende[0]).toEqual({ uidValidity: null, letzteUid: 0 });
        // Nichts Neues: die Quelle fragt ab der letzten UID und liefert nichts.
        expect(await abruf(erste.quelle)).toMatchObject({ gelesen: 0 });
        expect(erste.staende[1]).toEqual({ uidValidity: 1, letzteUid: 3 });
        // Der Server hat die Nummern neu vergeben (UIDVALIDITY 2): dieselben Mails, dieselben UIDs, von vorn gelesen.
        const neuVergeben = quelle(
            mails.map((mail, i) => ({ roh: mail.roh, uid: i + 1 })),
            2,
        );
        expect(await abruf(neuVergeben.quelle)).toMatchObject({ gelesen: 3, neu: 0, doppelt: 3 });
        expect(neuVergeben.staende[0]).toEqual({ uidValidity: 1, letzteUid: 3 });
        expect(await vorgaenge()).toHaveLength(3);
        expect(
            (
                await database`SELECT uidvalidity::int AS v, letzte_uid::int AS u FROM avesmaps_community.mail_abruf_stand`
            )[0],
        ).toEqual({ v: 2, u: 3 });
        // Und danach geht es ab dem neuen Zähler weiter.
        expect(await abruf(neuVergeben.quelle)).toMatchObject({ gelesen: 0 });
        expect(neuVergeben.staende[1]).toEqual({ uidValidity: 2, letzteUid: 3 });
    });

    it("🔴 der Stand rückt Mail für Mail vor: scheitert die Ablage bei der zweiten Mail, steht die erste im Stand und der nächste Lauf beginnt bei der zweiten", async () => {
        const mails = [
            { roh: baueMime({ text: "eins" }) },
            { roh: baueMime({ text: "zwei" }) },
            { roh: baueMime({ text: "drei" }) },
        ];
        const { quelle: q, uids } = quelle(mails);
        let aufrufe = 0;
        const echte = dateiAblage(ablageDir);
        const kaputt = {
            ...echte,
            schreibe: (inhalt: Buffer) => {
                aufrufe += 1;
                if (aufrufe === 2) return Promise.reject(new Error(`Platte voll ${KENNWORT}`));
                return echte.schreibe(inhalt);
            },
        };
        const fehler = await runCommunityMailAbrufJob(kontext(), {
            database,
            environment: { ...UMGEBUNG, COMMUNITY_MAIL_ABLAGE: ablageDir },
            quelle: () => q,
            ablage: kaputt,
        }).catch((f: unknown) => f);
        expect(fehler).toBeInstanceOf(JobFailure);
        expect((fehler as JobFailure).retryable).toBe(false);
        expect((fehler as JobFailure).message).not.toContain(KENNWORT);
        expect(await vorgaenge()).toHaveLength(1);
        expect((await database`SELECT letzte_uid::int AS u FROM avesmaps_community.mail_abruf_stand`)[0]).toEqual({
            u: uids[0],
        });
        expect(await abruf(q)).toMatchObject({ gelesen: 2, neu: 2 });
        expect(await vorgaenge()).toHaveLength(3);
    });

    // --- Grenzen und Dateien --------------------------------------------------------------------------------------------------------

    it("🔴 eine Mail über 30 MB wird als „zu groß, nicht übernommen“ eingetragen: Vorgang mit Absender, Betreff und Hinweis, ohne Text und Dateien", async () => {
        const kopf = Buffer.from(
            "Message-ID: <riesig@x.example>\r\nFrom: Max <max@example.org>\r\nSubject: Alle Karten als Bild\r\n\r\n",
        );
        const { quelle: q } = quelle([{ roh: kopf, zuGross: 31 * MB }]);
        expect(await abruf(q)).toMatchObject({ gelesen: 1, neu: 1, zuGross: 1 });
        const [eingang] = await eingaenge();
        expect(eingang).toMatchObject({
            hinweis: "zu_gross",
            text: null,
            html: null,
            von_adresse: "max@example.org",
            betreff: "Alle Karten als Bild",
        });
        const nummer = nummerVon((await vorgaenge())[0]!.id);
        const d = await detail(nummer);
        const nachricht = d.verlauf.find((e) => e.art === "nachricht");
        expect(nachricht).toMatchObject({ mail: { hinweis: "zu_gross", html: null, anhaenge: [] } });
        expect(d.melder.mail).toBe("max@example.org");
    });

    it("🔴 Anhänge: gesperrte stehen mit Grund da, ohne Datei; übernommene haben eine Datei in der Ablage; im Detail steht nie ein Dateiname der Ablage", async () => {
        const roh = baueMime({
            anhaenge: [
                { name: "Beleg.pdf", mime: "application/pdf", inhalt: Buffer.from("%PDF-1.4 Beleg") },
                { name: "setup.exe", mime: "application/octet-stream", inhalt: Buffer.from("MZ") },
                { name: "Rechte.docm", mime: "application/octet-stream", inhalt: Buffer.from("PK") },
            ],
        });
        const { quelle: q } = quelle([{ roh }]);
        await abruf(q);
        const liste = await anhaenge();
        expect(liste.map((a) => [a.dateiname, a.gesperrt, a.grund, a.datei === null])).toEqual([
            ["Beleg.pdf", false, null, false],
            ["setup.exe", true, "typ", true],
            ["Rechte.docm", true, "typ", true],
        ]);
        // In der Ablage liegen die Rohmail und der PDF-Anhang, sonst nichts (die gesperrten Dateien wurden nie gespeichert).
        expect(await ablageNamen()).toHaveLength(2);
        const d = await detail(nummerVon((await vorgaenge())[0]!.id));
        const nachricht = d.verlauf.find((e) => e.art === "nachricht");
        expect(nachricht?.art === "nachricht" ? nachricht.mail?.anhaenge : []).toEqual([
            {
                id: Number(liste[0]!.id),
                name: "Beleg.pdf",
                groesse: 14,
                mime: "application/pdf",
                gesperrt: false,
                grund: null,
                vorschau: true,
            },
            {
                id: Number(liste[1]!.id),
                name: "setup.exe",
                groesse: 2,
                mime: expect.any(String),
                gesperrt: true,
                grund: "typ",
                vorschau: false,
            },
            {
                id: Number(liste[2]!.id),
                name: "Rechte.docm",
                groesse: 2,
                mime: expect.any(String),
                gesperrt: true,
                grund: "typ",
                vorschau: false,
            },
        ]);
        expect(JSON.stringify(d)).not.toContain(liste[0]!.datei!);
    });

    it("🔴 ein eingebettetes Bild: neu kodiert (kein EXIF), das HTML zeigt auf die Adresse der App, die Route liefert es mit allen Schutz-Kopfzeilen", async () => {
        const original = await bild("jpeg", true);
        const roh = baueMime({
            html: '<p>Mit Bild</p><img src="cid:foto@x.example" alt="Foto">',
            anhaenge: [{ name: "foto.jpg", mime: "image/jpeg", inhalt: original, cid: "foto@x.example" }],
        });
        const { quelle: q } = quelle([{ roh }]);
        await abruf(q);
        const [anhang] = await anhaenge();
        const [vorgang] = await vorgaenge();
        const nummer = nummerVon(vorgang!.id);
        expect(anhang).toMatchObject({ mime: "image/jpeg", cid: "foto@x.example" });
        const [eingang] = await eingaenge();
        expect(eingang!.html).toContain(`src="/api/community/vorgaenge/${nummer}/anhaenge/${anhang!.id}"`);
        expect(eingang!.html).not.toContain("cid:");
        const url = `/api/community/vorgaenge/${nummer}/anhaenge/${anhang!.id}`;
        const inline = await get(`${url}?ansehen=1`, olaf.cookie);
        expect(inline.statusCode).toBe(200);
        expect(inline.headers["content-type"]).toBe("image/jpeg");
        expect(inline.headers["x-content-type-options"]).toBe("nosniff");
        expect(inline.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
        expect(inline.headers["cache-control"]).toBe("private, no-store");
        expect(inline.headers["content-disposition"]).toMatch(
            /^inline; filename="foto\.jpg"; filename\*=UTF-8''foto\.jpg$/u,
        );
        expect((await sharp(inline.rawPayload).metadata()).exif).toBeUndefined();
        expect(inline.rawPayload.includes(Buffer.from("Max Mustermann"))).toBe(false);
        // Ohne `ansehen` ist es ein Download.
        const laden = await get(url, olaf.cookie);
        expect(laden.headers["content-disposition"]).toMatch(/^attachment; /u);
        expect(laden.rawPayload.equals(inline.rawPayload)).toBe(true);
        // Das Detail liefert das HTML mit derselben Adresse.
        const d = await detail(nummer);
        const nachricht = d.verlauf.find((e) => e.art === "nachricht");
        expect(nachricht?.art === "nachricht" ? nachricht.mail?.html : "").toContain(url);
    });

    it("🔴 Route der Anhänge: ohne Datei, fremder Vorgang, gesperrt, Ablage leer und Pfadversuche geben 404 bzw. 422; Text kommt nie inline; der Name steht sicher in der Kopfzeile", async () => {
        const erste = baueMime({
            anhaenge: [
                { name: 'a"b\r\nX-Evil: 1 äöü.txt', mime: "text/plain", inhalt: Buffer.from("Hallo Text") },
                { name: "setup.exe", mime: "application/octet-stream", inhalt: Buffer.from("MZ") },
                { name: "Beleg.pdf", mime: "application/pdf", inhalt: Buffer.from("%PDF-1.4") },
            ],
        });
        const zweite = baueMime({
            von: "Fremder <fremder@example.net>",
            betreff: "Etwas ganz anderes",
            anhaenge: [{ name: "fremd.txt", mime: "text/plain", inhalt: Buffer.from("fremd") }],
        });
        const { quelle: q } = quelle([{ roh: erste }, { roh: zweite }]);
        await abruf(q);
        const [v1, v2] = await vorgaenge();
        const [text, exe, pdf, fremd] = await anhaenge();
        const n1 = nummerVon(v1!.id);
        const n2 = nummerVon(v2!.id);
        const hole = (nummer: string, id: string, abfrage = "") =>
            get(`/api/community/vorgaenge/${nummer}/anhaenge/${id}${abfrage}`, olaf.cookie);

        const ok = await hole(n1, text!.id, "?ansehen=1");
        expect(ok.statusCode).toBe(200);
        // Text lässt sich nie „ansehen“: immer Download, sicher kodiert.
        const disposition = String(ok.headers["content-disposition"]);
        expect(disposition).toMatch(/^attachment; filename="[A-Za-z0-9._-]+"; filename\*=UTF-8''[A-Za-z0-9%._-]+$/u);
        expect(disposition).not.toMatch(/[\r\n"]\s*X-Evil/u);
        expect(ok.headers["x-evil"]).toBeUndefined();
        expect(ok.body).toBe("Hallo Text");
        // PDF darf inline.
        expect(String((await hole(n1, pdf!.id, "?ansehen=1")).headers["content-disposition"])).toMatch(/^inline; /u);
        // Gesperrt: keine Datei, 404.
        expect(code(await hole(n1, exe!.id))).toBe("404 community_not_found");
        // Der Anhang eines anderen Vorgangs unter dieser Nummer: 404.
        expect(code(await hole(n1, fremd!.id))).toBe("404 community_not_found");
        expect(code(await hole(n2, fremd!.id))).toBe("200");
        expect(code(await hole(n1, "999999"))).toBe("404 community_not_found");
        // Pfadversuche aus der Anfrage: die Form der Kennung lässt sie gar nicht erst zu.
        for (const schlecht of ["../x", "1/../2", "abc", "1;2", "-1", "1.5"]) {
            const antwort = await get(
                `/api/community/vorgaenge/${n1}/anhaenge/${encodeURIComponent(schlecht)}`,
                olaf.cookie,
            );
            expect([400, 404, 422], schlecht).toContain(antwort.statusCode);
            expect(antwort.statusCode === 200, schlecht).toBe(false);
        }
        expect(
            (await get(`/api/community/vorgaenge/${n1}/anhaenge/${text!.id}?ansehen=2`, olaf.cookie)).statusCode,
        ).not.toBe(200);
        // Die Datei fehlt in der Ablage (etwa nach einem Fehler des Betriebs): 404, kein Absturz.
        await rm(join(ablageDir, text!.datei!));
        expect(code(await hole(n1, text!.id))).toBe("404 community_not_found");
        // Ist die Ablage nicht eingerichtet, gibt es keine Datei.
        delete process.env["COMMUNITY_MAIL_ABLAGE"];
        expect(code(await hole(n1, pdf!.id))).toBe("404 community_not_found");
    });

    // --- Aufbewahrung -------------------------------------------------------------------------------------------------------------

    it("🔴 Aufbewahrung nach Fachkonzept §10.2: mit den Kontaktdaten (90 Tage nach Abschluss) fallen Absender und Rohmail weg; Text, HTML und Anhänge bleiben im Archiv; der Abruf löscht nur die Datei der Rohmail", async () => {
        const roh = baueMime({
            html: "<p>Rechtefrage</p>",
            anhaenge: [{ name: "Beleg.pdf", mime: "application/pdf", inhalt: Buffer.from("%PDF-1.4 Beleg") }],
        });
        const { quelle: q } = quelle([{ roh }]);
        await abruf(q);
        const [vorgang] = await vorgaenge();
        const nummer = nummerVon(vorgang!.id);
        const vorher = await ablageNamen();
        expect(vorher).toHaveLength(2);
        expect(code(await insArchiv(nummer))).toBe("200");
        // 60 Tage nach dem Abschluss: noch nichts.
        await database`UPDATE avesmaps_community.vorgang SET abgeschlossen_at = now() - interval '60 days' WHERE id = ${vorgang!.id}::bigint`;
        expect(await communityAufbewahrung(database)).toMatchObject({ kontakt: 0 });
        expect((await eingaenge())[0]!.von_adresse).toBe(MAIL);
        // 91 Tage: die Kontaktdaten gehen.
        await database`UPDATE avesmaps_community.vorgang SET abgeschlossen_at = now() - interval '91 days' WHERE id = ${vorgang!.id}::bigint`;
        expect(await communityAufbewahrung(database)).toMatchObject({ kontakt: 1 });
        const [eingang] = await eingaenge();
        expect(eingang).toMatchObject({ von_adresse: null, von_name: null, roh_datei: null });
        expect(eingang!.text).toContain("Darf die Karte");
        expect(eingang!.html).toContain("Rechtefrage");
        // 🔴 Der Anhang bleibt: Datei, Name und Art unverändert (Fachkonzept §10.2: Anhänge bleiben im Archiv, nur Kontaktdaten und Rohmail gehen).
        const [anhang] = await anhaenge();
        expect(anhang).toMatchObject({ gesperrt: false, grund: null, dateiname: "Beleg.pdf", mime: "application/pdf" });
        expect(anhang!.datei).toMatch(/^[0-9a-f]{64}$/u);
        // Die Rohmail-Datei liegt noch, bis der Abruf aufräumt; junge Dateien fasst er nie an.
        expect(await ablageNamen()).toEqual(vorher);
        expect(await abruf(quelle([]).quelle)).toMatchObject({ dateienGeloescht: 0 });
        expect(await ablageNamen()).toEqual(vorher);
        // Danach ist nur die Rohmail weg; der Abgleich löscht nie, was die Datenbank noch kennt.
        expect(await abruf(quelle([]).quelle, { mindestalter: 0 })).toMatchObject({ dateienGeloescht: 1 });
        expect(await ablageNamen()).toEqual([anhang!.datei]);
        // Das Detail zeigt den Anhang weiter mit "Ansehen" und die Route liefert ihn.
        const d = await detail(nummer);
        const nachricht = d.verlauf.find((e) => e.art === "nachricht");
        expect(nachricht?.art === "nachricht" ? nachricht.mail?.anhaenge[0] : undefined).toMatchObject({
            name: "Beleg.pdf",
            grund: null,
            gesperrt: false,
            vorschau: true,
        });
        const geholt = await get(`/api/community/vorgaenge/${nummer}/anhaenge/${anhang!.id}`, olaf.cookie);
        expect(geholt.statusCode).toBe(200);
        expect(geholt.body).toBe("%PDF-1.4 Beleg");
        // Auch ein zweiter Lauf der Aufbewahrung lässt den Anhang stehen.
        await database`UPDATE avesmaps_community.vorgang SET abgeschlossen_at = now() - interval '400 days' WHERE id = ${vorgang!.id}::bigint`;
        await communityAufbewahrung(database);
        expect((await anhaenge())[0]!.datei).toBe(anhang!.datei);
    });

    it("🔴 „Personenbezug löschen“ nimmt Absender, Betreff, Text, HTML, Rohmail und die Namen und Dateien der Anhänge sofort mit; eine Datei, die ein anderer Vorgang noch braucht, bleibt", async () => {
        const gemeinsam = Buffer.from("%PDF-1.4 gleicher Inhalt");
        const eins = baueMime({
            anhaenge: [{ name: "Vertrag_Max_Mustermann.pdf", mime: "application/pdf", inhalt: gemeinsam }],
            html: "<p>Max Mustermann hier</p>",
        });
        const zwei = baueMime({
            von: "Anderer <anderer@example.net>",
            betreff: "Anderes",
            anhaenge: [{ name: "auch.pdf", mime: "application/pdf", inhalt: gemeinsam }],
        });
        const { quelle: q } = quelle([{ roh: eins }, { roh: zwei }]);
        await abruf(q);
        const [v1] = await vorgaenge();
        await database`SELECT avesmaps_community.community_personenbezug_loeschen(${randomUUID()}::uuid, ${v1!.id}::bigint, ${olaf.id}::uuid)`;
        const [e1, e2] = await eingaenge();
        expect(e1).toMatchObject({
            von_adresse: null,
            von_name: null,
            betreff: "",
            text: null,
            html: null,
            roh_datei: null,
        });
        expect(e2!.von_adresse).toBe("anderer@example.net");
        const [a1, a2] = await anhaenge();
        expect(a1).toMatchObject({ dateiname: "Anhang", datei: null, cid: null, grund: "entfernt" });
        expect(a2).toMatchObject({ dateiname: "auch.pdf", grund: null });
        // Beide Vorgänge teilten die Datei (gleicher Inhalt, gleicher Name); sie bleibt, solange einer sie braucht.
        expect(await abruf(quelle([]).quelle, { mindestalter: 0 })).toMatchObject({ dateienGeloescht: 1 });
        const bleibt = await ablageNamen();
        expect(bleibt).toContain(a2!.datei);
        expect(bleibt).toHaveLength(2);
    });

    it("🔴 ein Vorgang im Papierkorb bekommt die Mail angehängt, bleibt aber im Papierkorb und meldet nichts; löscht der Papierkorb ihn, räumt der Abruf die Dateien weg", async () => {
        const erste = baueMime({
            betreff: "Werbung",
            anhaenge: [{ name: "a.txt", mime: "text/plain", inhalt: Buffer.from("Werbung") }],
        });
        const { quelle: q1 } = quelle([{ roh: erste }]);
        await abruf(q1);
        const [vorgang] = await vorgaenge();
        const nummer = nummerVon(vorgang!.id);
        const papierkorb = await post(
            `/api/community/vorgaenge/${nummer}/papierkorb`,
            { operationId: randomUUID(), baseRevision: await revisionVon(nummer) },
            olaf.cookie,
        );
        expect(code(papierkorb)).toBe("200");
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;
        const folge = baueMime({ betreff: "Noch mehr Werbung", inReplyTo: idVon(erste) });
        const { quelle: q2 } = quelle([{ roh: folge }]);
        expect(await abruf(q2)).toMatchObject({ angehaengt: 1, wiedergeoeffnet: 0 });
        const [danach] = await vorgaenge();
        expect(danach).toMatchObject({ zustand: "abgeschlossen", ergebnis: "spam" });
        expect((await database`SELECT papierkorb_at IS NOT NULL AS im FROM avesmaps_community.vorgang`)[0]!.im).toBe(
            true,
        );
        expect(await eingaenge()).toHaveLength(2);
        expect(await glocke("community_antwort")).toHaveLength(0);
        expect(await glocke("community_nachricht")).toHaveLength(0);
        // Nach 31 Tagen im Papierkorb löscht ihn die Aufbewahrung samt Mails und Anhängen (Kaskade); der Abruf räumt die Dateien.
        await database`UPDATE avesmaps_community.vorgang SET papierkorb_at = now() - interval '31 days'`;
        expect(await communityAufbewahrung(database)).toMatchObject({ geloescht: 1 });
        expect(await anhaenge()).toEqual([]);
        expect((await ablageNamen()).length).toBeGreaterThan(0);
        await abruf(quelle([]).quelle, { mindestalter: 0 });
        expect(await ablageNamen()).toEqual([]);
    });

    // --- Abruf ohne Konfiguration, Fehler, Pflege ------------------------------------------------------------------------------------

    it("🔴 ohne Konfiguration tut der Abruf nichts: keine Quelle gefragt, kein Stand, kein Vorgang, kein Fehler", async () => {
        let gefragt = 0;
        const spaeh: PostfachQuelle = {
            lies() {
                gefragt += 1;
                return Promise.reject(new Error("darf nicht gefragt werden"));
            },
        };
        for (const fehlt of ABRUF_VARIABLEN) {
            const umgebung: NodeJS.ProcessEnv = { ...UMGEBUNG, COMMUNITY_MAIL_ABLAGE: ablageDir, [fehlt]: undefined };
            const ergebnis = await runCommunityMailAbrufJob(kontext(), {
                database,
                environment: umgebung,
                quelle: () => spaeh,
            });
            expect(ergebnis, fehlt).toMatchObject({ ergebnis: "aus", gelesen: 0 });
        }
        expect(gefragt).toBe(0);
        expect(await vorgaenge()).toEqual([]);
        expect(await database`SELECT 1 FROM avesmaps_community.mail_abruf_stand`).toHaveLength(0);
    });

    it("🔴 ein Fehler der Quelle wird ein Satz ohne Geheimnis und kein Wiederholen im Job (die Pflege reiht den nächsten Lauf ein); die Anmeldung gilt als dauerhaft", async () => {
        const werfe = (stoerung: AbrufStoerung): PostfachQuelle => ({ lies: () => Promise.reject(stoerung) });
        const dauerhaft = await abruf(werfe(abrufFehler({ authenticationFailed: true }))).catch((f: unknown) => f);
        expect(dauerhaft).toBeInstanceOf(JobFailure);
        expect(dauerhaft).toMatchObject({ code: "mail_abruf_dauerhaft", retryable: false });
        const netz = await abruf(werfe(abrufFehler({ code: "ECONNREFUSED" }))).catch((f: unknown) => f);
        expect(netz).toMatchObject({ code: "mail_abruf_gestoert", retryable: false });
        for (const f of [dauerhaft, netz]) {
            for (const geheim of [KENNWORT, NUTZER, HOST]) expect((f as Error).message).not.toContain(geheim);
        }
        // Eine rohe Ausnahme mit Geheimnis (unerwartet) schlüpft nicht durch.
        const roh = await abruf({
            lies: () => Promise.reject(Object.assign(new Error(`LOGIN ${NUTZER} ${KENNWORT}`), { code: "ECONNRESET" })),
        }).catch((f: unknown) => f);
        expect(roh).toBeInstanceOf(JobFailure);
        expect((roh as Error).message).not.toContain(KENNWORT);
        expect((roh as Error).message).not.toContain(NUTZER);
    });

    it("das Ergebnis des Jobs trägt nur Zahlen: nie Adresse, Betreff, Text oder Zugangsdaten", async () => {
        const { quelle: q } = quelle([
            { roh: baueMime({ betreff: "Geheimer Betreff Mustermann", text: "Geheimer Text" }) },
        ]);
        const ergebnis = await abruf(q);
        const text = JSON.stringify(ergebnis);
        for (const geheim of [KENNWORT, NUTZER, HOST, MAIL, "Geheimer", "Mustermann", "Alrike"])
            expect(text).not.toContain(geheim);
        expect(Object.values(ergebnis).filter((wert) => typeof wert !== "number" && wert !== "gelesen")).toEqual([]);
    });

    it("eine Mail, die der Parser nicht versteht, geht nicht verloren: die Funktion nimmt „nicht lesbar“ mit Kopfzeilen an", async () => {
        const [row] = await database<{ ergebnis: { ergebnis: string; nummer: string } }[]>`
            SELECT avesmaps_community.community_mail_eingang(${database.json({
                messageId: "<unlesbar@x.example>",
                inReplyTo: null,
                verweise: [],
                vonAdresse: "max@example.org",
                vonName: "Max",
                betreff: "Kaputt",
                text: null,
                html: null,
                externBilder: 0,
                hinweis: "unlesbar",
                rohDatei: null,
                groesse: 10,
                uid: 1,
                uidvalidity: 1,
            } as never)}::jsonb, '[]'::jsonb) AS ergebnis
        `;
        expect(row!.ergebnis.ergebnis).toBe("neu");
        const d = await detail(row!.ergebnis.nummer);
        expect(d.verlauf.find((e) => e.art === "nachricht")).toMatchObject({
            mail: { hinweis: "unlesbar", html: null },
        });
    });

    it("🔴 die Funktion lehnt Unbrauchbares ab (keine Message-ID, zu viele Anhänge, falsche Dateinamen) und die Bedingungen der Tafel halten", async () => {
        const aufruf = (mail: Record<string, unknown>, anhang: unknown = []) =>
            database`SELECT avesmaps_community.community_mail_eingang(${database.json({ messageId: "<ok@x.example>", betreff: "x", uid: 1, uidvalidity: 1, ...mail } as never)}::jsonb, ${database.json(anhang as never)}::jsonb)`;
        await expect(aufruf({ messageId: "" })).rejects.toMatchObject({ code: "KC422" });
        await expect(aufruf({ messageId: "<a\nb@x>" })).rejects.toMatchObject({ code: "KC422" });
        await expect(
            aufruf(
                {},
                Array.from({ length: 201 }, () => ({ dateiname: "a.txt", mime: "text/plain", groesse: 1 })),
            ),
        ).rejects.toMatchObject({ code: "KC422" });
        // Ein Dateiname der Ablage muss ein SHA-256 sein; ein gesperrter Anhang hat nie eine Datei.
        await expect(
            aufruf({ messageId: "<b@x.example>" }, [
                { dateiname: "a.txt", mime: "text/plain", groesse: 1, datei: "../../etc/passwd" },
            ]),
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
            aufruf({ messageId: "<c@x.example>" }, [
                { dateiname: "a.exe", mime: "text/plain", groesse: 1, datei: "a".repeat(64), grund: "typ" },
            ]),
        ).rejects.toMatchObject({ code: "23514" });
        await expect(aufruf({ messageId: "<d@x.example>", rohDatei: "nicht-hex" })).rejects.toMatchObject({
            code: "23514",
        });
        await expect(aufruf({ messageId: "<e@x.example>", hinweis: "boese" })).rejects.toMatchObject({ code: "23514" });
        // Nach all dem Scheitern ist nichts halb angelegt.
        expect(await vorgaenge()).toEqual([]);
    });

    it("🔴 die Pflege reiht den Abruf nur ein, wenn er konfiguriert ist, einmal je Abstand und nie doppelt; nach „Anmeldung abgelehnt“ wartet sie sechs Stunden", async () => {
        const worker = (an: boolean, abstandMs = 300_000) =>
            new JobWorker({
                database,
                config: testJobsConfig(),
                mapDomainId: AVENTURIA.mapDomain,
                release: "community-mail-abruf-test",
                deriveScope: uniqueScope("derive"),
                spawnChild: fakeSpawner().spawn,
                memory: fakeMemory().probe,
                communityMailAbrufEveryMs: abstandMs,
                communityMailAbrufAn: () => an,
            });
        // Die Pflege reiht über `job_insert` ein; die App hat dafür keine Tür (`job_enqueue` kennt die Art nicht).
        const einreihen = () =>
            insertJob(database, {
                kind: COMMUNITY_MAIL_ABRUF_KIND,
                mapDomainId: AVENTURIA.mapDomain,
                origin: "queued",
                actorRef: "community",
                externalRef: COMMUNITY_MAIL_ABRUF_KIND,
                scopeKind: "tiles",
                scopeTiles: [],
            });
        const jobs = () =>
            database<
                { state: string; origin: string; actor_ref: string | null; input_ref: unknown }[]
            >`SELECT state, origin, actor_ref, input_ref FROM job WHERE kind = ${COMMUNITY_MAIL_ABRUF_KIND}`;
        // Nicht konfiguriert: nichts.
        expect(await worker(false).pflege()).toMatchObject({ communityMailAbruf: false });
        expect(await jobs()).toEqual([]);
        // Ohne Abstand (kein Wert) ebenfalls nichts, auch mit Konfiguration.
        const ohneAbstand = new JobWorker({
            database,
            config: testJobsConfig(),
            mapDomainId: AVENTURIA.mapDomain,
            deriveScope: uniqueScope("derive"),
            spawnChild: fakeSpawner().spawn,
            memory: fakeMemory().probe,
            communityMailAbrufAn: () => true,
        });
        expect(await ohneAbstand.pflege()).toMatchObject({ communityMailAbruf: false });
        expect(await jobs()).toEqual([]);
        // Konfiguriert: ein Auftrag der Warteschlange, Akteur community, ohne Eingabe.
        expect(await worker(true).pflege()).toMatchObject({ communityMailAbruf: true });
        expect(await jobs()).toEqual([{ state: "QUEUED", origin: "queued", actor_ref: "community", input_ref: {} }]);
        // Ein zweiter Lauf der Pflege (anderer Prozess) reiht nichts nach, solange einer wartet oder im Abstand lief.
        expect(await worker(true).pflege()).toMatchObject({ communityMailAbruf: false });
        expect(await worker(true, 1).pflege()).toMatchObject({ communityMailAbruf: false });
        expect(await jobs()).toHaveLength(1);
        // Dauerhafter Fehler (Anmeldung abgelehnt) vor 10 Minuten: auch nach dem Abstand keine neue Anfrage.
        await database`DELETE FROM job WHERE kind = ${COMMUNITY_MAIL_ABRUF_KIND}`;
        const alt = [{ public_id: (await einreihen()).publicId }];
        await database`
            UPDATE job SET state = 'FAILED', error_code = 'mail_abruf_dauerhaft', started_at = now() - interval '11 minutes', finished_at = now() - interval '10 minutes', queued_at = now() - interval '12 minutes'
             WHERE public_id = ${alt[0]!.public_id}::uuid
        `;
        expect(await worker(true).pflege()).toMatchObject({ communityMailAbruf: false });
        // Nach sieben Stunden darf sie wieder fragen.
        await database`UPDATE job SET started_at = now() - interval '421 minutes', finished_at = now() - interval '420 minutes', queued_at = now() - interval '422 minutes' WHERE public_id = ${alt[0]!.public_id}::uuid`;
        expect(await worker(true).pflege()).toMatchObject({ communityMailAbruf: true });
        // Ein vorübergehender Fehler bremst nicht länger als der Abstand.
        await database`DELETE FROM job WHERE kind = ${COMMUNITY_MAIL_ABRUF_KIND}`;
        const alt2 = [{ public_id: (await einreihen()).publicId }];
        await database`
            UPDATE job SET state = 'FAILED', error_code = 'mail_abruf_gestoert', started_at = now() - interval '11 minutes', finished_at = now() - interval '10 minutes', queued_at = now() - interval '12 minutes'
             WHERE public_id = ${alt2[0]!.public_id}::uuid
        `;
        expect(await worker(true).pflege()).toMatchObject({ communityMailAbruf: true });
    });
});
