import { istMailAdresse } from "@avesmaps3d/shared";
import nodemailer from "nodemailer";
import type { MailZugang } from "./konfiguration.ts";

/**
 * Der Versand EINER Mail über SMTP (WI-0268 C6a). Rein: kennt weder die Datenbank noch die Warteschlange; der Job (`jobs/community-mail-job.ts`) holt die Mail, ruft `sendeMail` und trägt den Ausgang ein.
 *
 * - **Nur Text, kein HTML** (Fachkonzept §3.4: „Antworten und neue Mails als Text mit Absender „Avesmaps-Redaktion““). Keine Anhänge in diesem Schnitt; der Transport darf weder Dateien noch Adressen im Netz
 *   in die Mail ziehen (`disableFileAccess`, `disableUrlAccess`).
 * - 🔴 **Genau ein Empfänger.** Die Adresse geht als Objekt an den Transport (nie als Text, den er an Kommas aufteilte) und zusätzlich als Umschlag (`envelope`); eine Adresse, die nicht genau eine ist
 *   (`istMailAdresse`), wird gar nicht erst gesendet.
 * - 🔴 **Nie ein Geheimnis im Ergebnis.** Ein Fehler des Transports wird auf einen Satz aus festem Wortschatz abgebildet (`zustellFehler`), nie auf seinen Text: Der könnte Nutzer, Kennwort oder die Antwort des
 *   Mailservers mit der Adresse tragen. Das Ergebnis trägt außerdem nur, ob es dauerhaft ist.
 * - **Der Transport ist ersetzbar** (`TransportFabrik`): Die Tests stellen ihn, es geht NIE eine echte Mail hinaus. Der echte kommt aus `echterTransport`.
 */

export interface MailNachricht {
    from: { name: string; address: string };
    replyTo: { name: string; address: string };
    to: { name: string; address: string };
    subject: string;
    text: string;
    messageId: string;
    date?: Date;
    inReplyTo?: string;
    references?: string[];
    envelope: { from: string; to: string[] };
    disableFileAccess: true;
    disableUrlAccess: true;
}

/** Was der Versand vom Transport braucht: eine Mail senden, danach schließen. */
export interface MailTransport {
    sendMail(nachricht: MailNachricht): Promise<unknown>;
    close?(): void;
}

export type TransportFabrik = (zugang: MailZugang) => MailTransport;

/** Der echte Transport: nodemailer über SMTP mit den Zugangsdaten der Umgebung. */
export const echterTransport: TransportFabrik = (zugang) => nodemailer.createTransport(zugang.transportOptionen());

/** Was der Job für eine Mail wissen muss (aus `community_mail_holen`). */
export interface AusgehendeMail {
    an: string;
    betreff: string;
    text: string;
    messageId: string;
    inReplyTo: string | null;
    references: readonly string[];
    /** Das Datum der Mail; der Versand und die Kopie in „Gesendet“ (`gesendet-kopie.ts`) tragen dasselbe. Ohne Angabe setzt es der Transport. */
    datum?: Date;
}

/** Absenderadresse und Anzeigename aus der Konfiguration (`Name <adresse>` oder nur die Adresse). */
function absenderAus(zugang: MailZugang): { name: string; address: string } {
    const klammer = /^(.*?)\s*<[^<>]+>$/u.exec(zugang.absender);
    return { name: klammer?.[1]?.trim() ?? "", address: zugang.absenderAdresse };
}

const MESSAGE_ID = /^<[A-Za-z0-9._-]{1,120}@[A-Za-z0-9.-]{1,253}>$/u;

/** Baut die Nachricht für den Transport. Wirft, wo die Mail nicht gesendet werden darf (keine einzelne Adresse, Betreff oder Text leer, Kennung kaputt). */
export function baueNachricht(zugang: MailZugang, mail: AusgehendeMail): MailNachricht {
    if (!istMailAdresse(mail.an))
        throw new MailAblehnung("Die Empfängeradresse ist keine einzelne gültige Adresse", "adresse_abgelehnt");
    // Eine Zeile, keine Steuerzeichen: Aus dem Betreff darf nie eine zweite Kopfzeile werden.
    // eslint-disable-next-line no-control-regex
    const betreff = mail.betreff.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim();
    if (betreff === "") throw new MailAblehnung("Der Betreff fehlt");
    if (mail.text.trim() === "") throw new MailAblehnung("Der Text fehlt");
    if (!MESSAGE_ID.test(mail.messageId)) throw new MailAblehnung("Die Kennung der Mail ist ungültig");
    const absender = absenderAus(zugang);
    const referenzen = mail.references.filter((kennung) => MESSAGE_ID.test(kennung));
    return {
        from: absender,
        // Antworten gehen an dieselbe Adresse: Der Abruf (C6b) liest dasselbe Postfach.
        replyTo: absender,
        to: { name: "", address: mail.an },
        subject: betreff,
        text: mail.text,
        messageId: mail.messageId,
        ...(mail.datum === undefined ? {} : { date: mail.datum }),
        ...(mail.inReplyTo !== null && MESSAGE_ID.test(mail.inReplyTo) ? { inReplyTo: mail.inReplyTo } : {}),
        ...(referenzen.length === 0 ? {} : { references: referenzen }),
        envelope: { from: zugang.absenderAdresse, to: [mail.an] },
        disableFileAccess: true,
        disableUrlAccess: true,
    };
}

/** Das Wort, unter dem das Panel `Mailpostfach` den Fehler als letzten Lauf zeigt (WI-0268 C6c, `MAIL_VERSAND_ERGEBNISSE`). */
export type VersandLauf = "anmeldung_abgelehnt" | "adresse_abgelehnt" | "gestoert";

/** Die Mail darf nicht gesendet werden (vor dem Transport): dauerhaft, mit einem Satz ohne Geheimnis. `lauf`: `adresse_abgelehnt`, wenn es an der Empfängeradresse liegt, sonst `gestoert`. */
export class MailAblehnung extends Error {
    readonly lauf: VersandLauf;
    constructor(message: string, lauf: VersandLauf = "gestoert") {
        super(message);
        this.name = "MailAblehnung";
        this.lauf = lauf;
    }
}

export type Zustellung =
    | { readonly ok: true }
    | { readonly ok: false; readonly dauerhaft: boolean; readonly grund: string; readonly lauf: VersandLauf };

const NETZ = new Set([
    "ECONNECTION",
    "ECONNREFUSED",
    "ECONNRESET",
    "EDNS",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "EPIPE",
    "ESOCKET",
    "ETIMEDOUT",
    "ETLS",
    "EAI_AGAIN",
]);

/**
 * Bildet einen Fehler des Transports auf einen kurzen Satz ohne Geheimnis ab und sagt, ob Wiederholen hilft. Nur der Code und der dreistellige SMTP-Code gehen ein, nie der Text des Fehlers.
 * - Anmeldung abgelehnt (`EAUTH`) oder eine Antwort 5xx: dauerhaft (die Zugangsdaten oder die Adresse stimmen nicht; Wiederholen sperrte höchstens das Konto).
 * - Verbindung, Zeitüberschreitung, Namensauflösung und eine Antwort 4xx: vorübergehend.
 * - Alles andere: vorübergehend (im Zweifel noch einmal), bis die Versuche aufgebraucht sind.
 * - `lauf` ist dasselbe als Wort für das Panel Mailpostfach (WI-0268 C6c): Anmeldung abgelehnt, Adresse abgelehnt (EENVELOPE, 550/551/553) oder gestört (alles andere).
 */
export function zustellFehler(fehler: unknown): { dauerhaft: boolean; grund: string; lauf: VersandLauf } {
    if (fehler instanceof MailAblehnung) return { dauerhaft: true, grund: fehler.message, lauf: fehler.lauf };
    const roh = (typeof fehler === "object" && fehler !== null ? fehler : {}) as {
        code?: unknown;
        responseCode?: unknown;
    };
    const code = typeof roh.code === "string" ? roh.code : undefined;
    const smtp =
        typeof roh.responseCode === "number" && roh.responseCode >= 100 && roh.responseCode <= 599
            ? roh.responseCode
            : undefined;
    if (code === "EAUTH")
        return { dauerhaft: true, grund: "Der Mailserver hat die Anmeldung abgelehnt", lauf: "anmeldung_abgelehnt" };
    if (code === "EENVELOPE")
        return { dauerhaft: true, grund: "Die Empfängeradresse wurde nicht angenommen", lauf: "adresse_abgelehnt" };
    if (smtp !== undefined && smtp >= 500) {
        if (smtp === 552)
            return {
                dauerhaft: true,
                grund: `Der Mailserver hat die Mail als zu groß abgelehnt (${String(smtp)})`,
                lauf: "gestoert",
            };
        if (smtp === 550 || smtp === 551 || smtp === 553)
            return {
                dauerhaft: true,
                grund: `Der Mailserver hat die Empfängeradresse abgelehnt (${String(smtp)})`,
                lauf: "adresse_abgelehnt",
            };
        return { dauerhaft: true, grund: `Der Mailserver hat die Mail abgelehnt (${String(smtp)})`, lauf: "gestoert" };
    }
    if (smtp !== undefined && smtp >= 400)
        return {
            dauerhaft: false,
            grund: `Der Mailserver nimmt die Mail gerade nicht an (${String(smtp)})`,
            lauf: "gestoert",
        };
    if (code !== undefined && NETZ.has(code))
        return {
            dauerhaft: false,
            grund: "Der Mailserver ist nicht erreichbar oder die Verbindung brach ab",
            lauf: "gestoert",
        };
    return { dauerhaft: false, grund: "Die Mail konnte nicht gesendet werden", lauf: "gestoert" };
}

/** Sendet eine Mail über den Transport. Wirft nie: Ein Fehler ist ein Ergebnis. Der Transport wird danach geschlossen. */
export async function sendeMail(
    transport: MailTransport,
    zugang: MailZugang,
    mail: AusgehendeMail,
): Promise<Zustellung> {
    try {
        await transport.sendMail(baueNachricht(zugang, mail));
        return { ok: true };
    } catch (fehler) {
        return { ok: false, ...zustellFehler(fehler) };
    } finally {
        try {
            transport.close?.();
        } catch {
            // Ein Fehler beim Schließen ändert am Ergebnis nichts.
        }
    }
}
