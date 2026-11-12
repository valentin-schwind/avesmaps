import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
    baueRohmail,
    findeGesendetOrdner,
    kopiereInGesendet,
    legeInGesendetAb,
    type ImapAblage,
    type ImapOrdner,
} from "../src/community/mail/gesendet-kopie.ts";
import {
    leseAbrufKonfiguration,
    leseGesendetOrdner,
    leseMailKonfiguration,
} from "../src/community/mail/konfiguration.ts";
import type { AusgehendeMail } from "../src/community/mail/versand.ts";

/**
 * Die Kopie gesendeter Mails im Ordner „Gesendet“ (WI-0268 C6d; Vali 2026-11-04). Ohne Datenbank und ohne Netz: Der Client ist gestellt, die Rohmail entsteht echt, sendet aber nichts. Der Lauf im
 * Versandjob steht in `community-mail-versand.test.ts`.
 */

const KENNWORT = "geheim-kennwort-4711";
const NUTZER = "redaktion-konto@example.org";
const ENV = {
    COMMUNITY_MAIL_SMTP_HOST: "smtp.example.invalid",
    COMMUNITY_MAIL_SMTP_PORT: "465",
    COMMUNITY_MAIL_USER: NUTZER,
    COMMUNITY_MAIL_PASSWORD: KENNWORT,
    COMMUNITY_MAIL_FROM: "Avesmaps <info@avesmaps.de>",
    COMMUNITY_MAIL_IMAP_HOST: "imap.example.invalid",
    COMMUNITY_MAIL_ABLAGE: tmpdir(),
};
const postfach = leseAbrufKonfiguration(ENV)!;
const zugang = leseMailKonfiguration(ENV)!;
const DATUM = new Date("2026-11-04T10:00:00.000Z");
const MAIL: AusgehendeMail = {
    an: "thamor@example.org",
    betreff: "Darf die Karte die Modelle zeigen?",
    text: "Hallo Welt, äöü.",
    messageId: "<com-000123.abc@avesmaps.de>",
    inReplyTo: null,
    references: [],
    datum: DATUM,
};

function falscherClient(ordner: ImapOrdner[], fehler?: { bei: "connect" | "list" | "append"; wert: unknown }) {
    const aufrufe: string[] = [];
    const abgelegt: { pfad: string; roh: Buffer; flags: string[]; datum: Date }[] = [];
    const scheitern = (wo: string): Promise<never> | undefined =>
        fehler?.bei === wo ? Promise.reject(fehler.wert) : undefined;
    const client: ImapAblage = {
        connect() {
            aufrufe.push("connect");
            return scheitern("connect") ?? Promise.resolve();
        },
        list() {
            aufrufe.push("list");
            return scheitern("list") ?? Promise.resolve(ordner);
        },
        append(pfad, roh, flags, datum) {
            aufrufe.push("append");
            abgelegt.push({ pfad, roh, flags, datum });
            return scheitern("append") ?? Promise.resolve({ destination: pfad });
        },
        logout() {
            aufrufe.push("logout");
            return Promise.resolve();
        },
        on() {
            return client;
        },
    };
    return { client, aufrufe, abgelegt };
}

describe("Mailversand: der Ordner „Gesendet“", () => {
    it("nimmt die Kennzeichnung vor dem Namen und findet sonst übliche Namen, auch in einem Unterordner", () => {
        expect(
            findeGesendetOrdner([
                { path: "Sent", name: "Sent" },
                { path: "Ablage/Raus", name: "Raus", specialUse: "\\Sent" },
            ]),
        ).toBe("Ablage/Raus");
        expect(findeGesendetOrdner([{ path: "INBOX" }, { path: "INBOX.Gesendet", name: "Gesendet" }])).toBe(
            "INBOX.Gesendet",
        );
        expect(findeGesendetOrdner([{ path: "Gesendete Objekte" }])).toBe("Gesendete Objekte");
    });

    it("🔴 eine Vorgabe gilt nur, wenn es den Ordner gibt; ohne Treffer gibt es keinen Ordner, und angelegt wird nie einer", async () => {
        const ordner = [{ path: "Sent", name: "Sent", specialUse: "\\Sent" }];
        expect(findeGesendetOrdner(ordner, "Eigene")).toBeUndefined();
        expect(findeGesendetOrdner([...ordner, { path: "Eigene" }], "Eigene")).toBe("Eigene");
        expect(findeGesendetOrdner([{ path: "INBOX" }, { path: "Entwürfe" }])).toBeUndefined();

        const { client, aufrufe } = falscherClient([{ path: "INBOX" }]);
        const ablage = await legeInGesendetAb(postfach, Buffer.from("x"), DATUM, undefined, () => client);
        expect(ablage).toEqual({ ok: false, grund: "ordner_fehlt" });
        expect(aufrufe).toEqual(["connect", "list", "logout"]);
    });

    it("🔴 nie der Ordner, den der Abruf liest: Die eigene Kopie käme sonst als neue Anfrage zurück", async () => {
        const liest = leseAbrufKonfiguration({ ...ENV, COMMUNITY_MAIL_ORDNER: "Sent" })!;
        const { client, abgelegt } = falscherClient([{ path: "Sent", name: "Sent", specialUse: "\\Sent" }]);
        const ablage = await legeInGesendetAb(liest, Buffer.from("x"), DATUM, undefined, () => client);
        expect(ablage).toEqual({ ok: false, grund: "ordner_fehlt" });
        expect(abgelegt).toEqual([]);
    });

    it("die Vorgabe der Umgebung: leer oder mit Steuerzeichen zählt nicht", () => {
        expect(leseGesendetOrdner({ COMMUNITY_MAIL_GESENDET: " Gesendet " })).toBe("Gesendet");
        expect(leseGesendetOrdner({ COMMUNITY_MAIL_GESENDET: " " })).toBeUndefined();
        expect(leseGesendetOrdner({ COMMUNITY_MAIL_GESENDET: "Sent\r\nX" })).toBeUndefined();
        expect(leseGesendetOrdner({})).toBeUndefined();
    });
});

describe("Mailversand: die Kopie", () => {
    it("🔴 die Rohmail ist die gesendete Mail: Absender, Empfänger, Betreff, Message-ID und Datum, ohne Zugangsdaten", async () => {
        const roh = (await baueRohmail(zugang, MAIL)).toString("utf8");
        expect(roh).toContain("Message-ID: <com-000123.abc@avesmaps.de>");
        expect(roh).toContain("thamor@example.org");
        expect(roh).toContain("info@avesmaps.de");
        expect(roh).toContain("Date: Wed, 04 Nov 2026 10:00:00 +0000");
        expect(roh).toContain("\r\n\r\n");
        expect(roh).not.toContain(KENNWORT);
        expect(roh).not.toContain(NUTZER);
    });

    it("🔴 legt genau einmal ab, als gelesen, mit dem Datum des Versands; schreibt sonst nichts und meldet sich ab", async () => {
        const { client, aufrufe, abgelegt } = falscherClient([
            { path: "INBOX" },
            { path: "Gesendet", name: "Gesendet" },
        ]);
        const warnungen: string[] = [];
        const ergebnis = await kopiereInGesendet({
            umgebung: ENV,
            zugang,
            mail: MAIL,
            datum: DATUM,
            fabrik: () => client,
            warne: (text) => warnungen.push(text),
        });
        expect(ergebnis).toBe("abgelegt");
        expect(aufrufe).toEqual(["connect", "list", "append", "logout"]);
        expect(abgelegt).toHaveLength(1);
        expect(abgelegt[0]).toMatchObject({ pfad: "Gesendet", flags: ["\\Seen"], datum: DATUM });
        expect(abgelegt[0]?.roh.toString("utf8")).toContain("Message-ID: <com-000123.abc@avesmaps.de>");
        expect(warnungen).toEqual([]);
        for (const verb of ["mailboxCreate", "mailboxDelete", "messageFlagsAdd", "messageDelete", "messageMove"])
            expect(Object.keys(client), verb).not.toContain(verb);
    });

    it("ohne IMAP-Zugang (Stage, lokal) gibt es keine Kopie, keinen Client und keine Warnung", async () => {
        let gefragt = 0;
        const warnungen: string[] = [];
        const ohne = { ...ENV, COMMUNITY_MAIL_IMAP_HOST: "" };
        const ergebnis = await kopiereInGesendet({
            umgebung: ohne,
            zugang,
            mail: MAIL,
            datum: DATUM,
            fabrik: () => {
                gefragt += 1;
                return falscherClient([]).client;
            },
            warne: (text) => warnungen.push(text),
        });
        expect(ergebnis).toBe("aus");
        expect(gefragt).toBe(0);
        expect(warnungen).toEqual([]);
    });

    it("🔴 scheitert die Ablage, wirft nichts, und die Warnung trägt nur ein Wort: nie den Text des Servers, nie ein Geheimnis", async () => {
        const fehlerfaelle = [
            {
                bei: "connect" as const,
                wert: Object.assign(new Error(`login ${NUTZER} ${KENNWORT} failed`), { authenticationFailed: true }),
                wort: "anmeldung_abgelehnt",
            },
            {
                bei: "append" as const,
                wert: Object.assign(new Error(`NO ${KENNWORT}`), { code: "TRYCREATE" }),
                wort: "ordner_fehlt",
            },
            { bei: "list" as const, wert: new Error(`Server sagt ${NUTZER}`), wort: "gestoert" },
        ];
        for (const fall of fehlerfaelle) {
            const { client, aufrufe } = falscherClient([{ path: "Sent", specialUse: "\\Sent" }], {
                bei: fall.bei,
                wert: fall.wert,
            });
            const warnungen: string[] = [];
            const ergebnis = await kopiereInGesendet({
                umgebung: ENV,
                zugang,
                mail: MAIL,
                datum: DATUM,
                fabrik: () => client,
                warne: (text) => warnungen.push(text),
            });
            expect(ergebnis, fall.wort).toBe("fehlt");
            expect(warnungen, fall.wort).toEqual([`Mailversand: Kopie in „Gesendet“ nicht abgelegt (${fall.wort})`]);
            expect(warnungen.join(" ")).not.toContain(KENNWORT);
            expect(warnungen.join(" ")).not.toContain(NUTZER);
            expect(aufrufe.at(-1)).toBe("logout");
        }
    });

    it("die Antwort `false` des Clients gilt als gescheitert", async () => {
        const { client } = falscherClient([{ path: "Sent", specialUse: "\\Sent" }]);
        client.append = () => Promise.resolve(false);
        expect(await legeInGesendetAb(postfach, Buffer.from("x"), DATUM, undefined, () => client)).toEqual({
            ok: false,
            grund: "gestoert",
        });
    });
});
