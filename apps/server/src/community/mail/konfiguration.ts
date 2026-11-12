import { isAbsolute } from "node:path";
import { inspect } from "node:util";

/**
 * Die Konfiguration des Mailwegs (WI-0268 C6a; Handover `project-control/handovers/2026-10-31-wi0268-c6-mailweg-an-claudio.md`). Sie kommt aus der Umgebung des Prozesses, als Geheimnis außerhalb
 * der Datenbank (Umgebungsdatei der Unit), nie aus einer Tafel:
 *
 *     COMMUNITY_MAIL_SMTP_HOST      der Mailserver
 *     COMMUNITY_MAIL_SMTP_PORT      465 (TLS von Beginn an) oder 587 (STARTTLS, erzwungen)
 *     COMMUNITY_MAIL_USER           Anmeldename
 *     COMMUNITY_MAIL_PASSWORD       Kennwort
 *     COMMUNITY_MAIL_FROM           Absender, etwa `Avesmaps-Redaktion <info@avesmaps.de>`; auch Antwortadresse (`Reply-To`) und Domäne der `Message-ID`
 *
 * 🔴 **Fehlt auch nur eine (oder ist eine unbrauchbar), ist der Versand aus** (`leseMailKonfiguration` gibt `undefined`): Antworten gehen wie vor dem Mailweg auf die Statusseite, es entsteht kein Job.
 * So bleibt jede Umgebung ohne Konfiguration unverändert (Stage und lokal: kein Personenbezug, Fachkonzept §10.3).
 *
 * 🔴 **Nutzer und Kennwort stehen nie in Logs, Fehlertexten oder Antworten.** Die Konfiguration trägt beide als nicht aufzählbare Eigenschaften (kein Spread, kein `JSON.stringify`, kein `console.log` und keine
 * Fehlerausgabe zeigt sie) und liefert sie nur dem Transport (`transportOptionen`). Das Protokoll sieht allein Server, Port und Absender.
 */

export interface MailKonfiguration {
    readonly host: string;
    readonly port: number;
    /** Der Absender, wie er in `From` und `Reply-To` steht (mit Anzeigename, falls angegeben). */
    readonly absender: string;
    /** Nur die Adresse des Absenders (für den Umschlag des Versands). */
    readonly absenderAdresse: string;
    /** Die Domäne der Absenderadresse: der Teil hinter dem @ der `Message-ID`. */
    readonly domaene: string;
}

/** Eine Konfiguration samt der Zugangsdaten, die nur der Transport sieht. */
export interface MailZugang extends MailKonfiguration {
    /** Die Optionen für `nodemailer.createTransport`. 🔴 Enthalten das Kennwort: nie loggen. */
    transportOptionen(): MailTransportOptionen;
}

export interface MailTransportOptionen {
    host: string;
    port: number;
    /** 465: TLS von Beginn an. */
    secure: boolean;
    /** Alles andere: STARTTLS ist Pflicht, ein Server ohne bricht ab, statt im Klartext zu senden. */
    requireTLS: boolean;
    auth: { user: string; pass: string };
    connectionTimeout: number;
    greetingTimeout: number;
    socketTimeout: number;
    /** Kein Pool: ein Job, eine Verbindung. */
    pool: false;
}

/** Die Jobart des Versands (WI-0268 C6a, `jobs/community-mail-job.ts`). Hier, damit die Routen sie kennen, ohne den Job und nodemailer zu laden. */
export const COMMUNITY_MAIL_VERSAND_KIND = "community_mail_versand";

/** Die fünf Variablen, in fester Reihenfolge. */
export const MAIL_VARIABLEN = [
    "COMMUNITY_MAIL_SMTP_HOST",
    "COMMUNITY_MAIL_SMTP_PORT",
    "COMMUNITY_MAIL_USER",
    "COMMUNITY_MAIL_PASSWORD",
    "COMMUNITY_MAIL_FROM",
] as const;

const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/u;
const ADRESSE =
    /^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64})@((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63})$/u;

/** Trennt `Name <adresse>` oder `adresse` in Anzeigename und Adresse; `undefined`, wenn keine einzelne, gültige Adresse darin steht. */
export function leseAbsender(roh: string): { anzeigename: string; adresse: string; domaene: string } | undefined {
    const text = roh.trim();
    // Kein Zeilenumbruch und kein Steuerzeichen: Aus einem Absender darf nie eine zweite Kopfzeile werden.
    // eslint-disable-next-line no-control-regex
    if (text === "" || /[\u0000-\u001f\u007f]/u.test(text)) return undefined;
    const klammer = /^(.*?)<([^<>]+)>$/u.exec(text);
    const adresse = (klammer === null ? text : (klammer[2] ?? "")).trim();
    const anzeigename = (klammer === null ? "" : (klammer[1] ?? ""))
        .trim()
        .replace(/^"(.*)"$/u, "$1")
        .trim();
    const treffer = ADRESSE.exec(adresse);
    if (treffer === null) return undefined;
    // Ein Anzeigename mit Anführungszeichen, Klammern oder Kommata brächte den Absender durcheinander; die Betreiber wählen schlichte Namen.
    if (/["<>@,;:\\()[\]]/u.test(anzeigename)) return undefined;
    return { anzeigename, adresse, domaene: (treffer[2] ?? "").toLowerCase() };
}

/**
 * Liest die Konfiguration. `undefined`, wenn eine Variable fehlt, leer oder unbrauchbar ist (Port keine Zahl, Absender keine einzelne Adresse): Der Mailweg ist dann aus. Der Aufrufer erfährt nicht, WELCHE
 * fehlt - das Protokoll des Servers nennt beim Start nur den Stand.
 */
export function leseMailKonfiguration(umgebung: NodeJS.ProcessEnv = process.env): MailZugang | undefined {
    const wert = (name: (typeof MAIL_VARIABLEN)[number]): string | undefined => {
        const roh = umgebung[name];
        return roh === undefined || roh.trim() === "" ? undefined : roh;
    };
    const host = wert("COMMUNITY_MAIL_SMTP_HOST")?.trim();
    const portText = wert("COMMUNITY_MAIL_SMTP_PORT")?.trim();
    const nutzer = wert("COMMUNITY_MAIL_USER");
    const kennwort = wert("COMMUNITY_MAIL_PASSWORD");
    const von = wert("COMMUNITY_MAIL_FROM");
    if (
        host === undefined ||
        portText === undefined ||
        nutzer === undefined ||
        kennwort === undefined ||
        von === undefined
    )
        return undefined;
    if (!HOST.test(host) || !/^\d{1,5}$/u.test(portText)) return undefined;
    const port = Number(portText);
    if (port < 1 || port > 65535) return undefined;
    const absender = leseAbsender(von);
    if (absender === undefined) return undefined;
    const sichtbar: MailKonfiguration = {
        host,
        port,
        absender: absender.anzeigename === "" ? absender.adresse : `${absender.anzeigename} <${absender.adresse}>`,
        absenderAdresse: absender.adresse,
        domaene: absender.domaene,
    };
    const zugang = { ...sichtbar } as MailZugang;
    // Die Zugangsdaten leben in einer Schließung, nicht im Objekt: Spread, Aufzählung, JSON und Fehlerausgabe finden sie nicht.
    Object.defineProperty(zugang, "transportOptionen", {
        enumerable: false,
        value: (): MailTransportOptionen => ({
            host,
            port,
            secure: port === 465,
            requireTLS: port !== 465,
            auth: { user: nutzer, pass: kennwort },
            connectionTimeout: 15_000,
            greetingTimeout: 15_000,
            socketTimeout: 30_000,
            pool: false,
        }),
    });
    Object.defineProperty(zugang, "toJSON", { enumerable: false, value: (): MailKonfiguration => sichtbar });
    Object.defineProperty(zugang, inspect.custom, { enumerable: false, value: (): MailKonfiguration => sichtbar });
    return Object.freeze(zugang);
}

/** Ist der Mailweg an? Alle fünf Angaben da und brauchbar. */
export const mailwegAn = (umgebung: NodeJS.ProcessEnv = process.env): boolean =>
    leseMailKonfiguration(umgebung) !== undefined;

// --- Der Abruf (WI-0268 C6b) ---------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Die Konfiguration des Mailabrufs (C6b). Aus derselben Umgebung wie der Versand; Nutzer und Kennwort teilt er mit ihm:
 *
 *     COMMUNITY_MAIL_IMAP_HOST      der Mailserver (Pflicht)
 *     COMMUNITY_MAIL_IMAP_PORT      993 (TLS von Beginn an; Vorgabe) oder ein anderer Port (STARTTLS, erzwungen)
 *     COMMUNITY_MAIL_USER           Anmeldename (Pflicht, wie beim Versand)
 *     COMMUNITY_MAIL_PASSWORD       Kennwort (Pflicht, wie beim Versand)
 *     COMMUNITY_MAIL_ORDNER         der Ordner, der gelesen wird (Vorgabe `INBOX`)
 *     COMMUNITY_MAIL_ABLAGE         Verzeichnis für Rohmails und Anhänge (Pflicht; absoluter Pfad)
 *     COMMUNITY_MAIL_GESENDET       der Ordner für die Kopie gesendeter Mails (freiwillig; sonst sucht `gesendet-kopie.ts` ihn, C6d)
 *
 * 🔴 **Fehlt Host, Nutzer, Kennwort oder Ablage (oder ist eine Angabe unbrauchbar), ist der Abruf aus** (`leseAbrufKonfiguration` gibt `undefined`): Es entsteht kein Auftrag, nichts liest ein Postfach.
 * 🔴 **Nutzer und Kennwort stehen nie in Logs, Fehlern oder Antworten**; sie leben in einer Schließung (`imapOptionen`), nicht im Objekt (wie beim Versand).
 */
export interface AbrufKonfiguration {
    readonly host: string;
    readonly port: number;
    readonly ordner: string;
    /** Das Verzeichnis der Ablage. */
    readonly ablage: string;
}

export interface AbrufZugang extends AbrufKonfiguration {
    /** Die Optionen für `new ImapFlow`. 🔴 Enthalten das Kennwort: nie loggen. */
    imapOptionen(): ImapOptionen;
}

export interface ImapOptionen {
    host: string;
    port: number;
    /** 993: TLS von Beginn an. */
    secure: boolean;
    /** Alles andere: STARTTLS ist Pflicht, ein Server ohne bricht ab, statt im Klartext anzumelden. */
    doSTARTTLS: boolean;
    auth: { user: string; pass: string };
    /** Kein Protokoll der Sitzung: Es enthielte Anmeldung und Kopfzeilen. */
    logger: false;
    emitLogs: false;
    disableAutoIdle: true;
    connectionTimeout: number;
    greetingTimeout: number;
    socketTimeout: number;
    tls: { minVersion: "TLSv1.2" };
}

/** Die Jobart des Abrufs (WI-0268 C6b, `jobs/community-mail-abruf-job.ts`). Hier, damit die Pflege sie kennt, ohne den Job und imapflow zu laden. */
export const COMMUNITY_MAIL_ABRUF_KIND = "community_mail_abruf";

/** Der Code eines dauerhaften Fehlers des Abrufs (Anmeldung abgelehnt, Ordner fehlt): Die Pflege wartet danach sechs Stunden (Wiederholen sperrte höchstens das Konto). */
export const MAIL_ABRUF_DAUERHAFT = "mail_abruf_dauerhaft";
/** Der Code eines vorübergehenden Fehlers (Netz, Server, Datenbank, Ablage): Die Pflege reiht im gewohnten Takt den nächsten Lauf ein. */
export const MAIL_ABRUF_GESTOERT = "mail_abruf_gestoert";

/** Die Angaben, ohne die der Abruf aus ist (Port und Ordner haben Vorgaben). */
export const ABRUF_VARIABLEN = [
    "COMMUNITY_MAIL_IMAP_HOST",
    "COMMUNITY_MAIL_USER",
    "COMMUNITY_MAIL_PASSWORD",
    "COMMUNITY_MAIL_ABLAGE",
] as const;

/** Die Vorgaben: 993 mit TLS von Beginn an, der Ordner `INBOX`. */
export const ABRUF_VORGABE = { port: 993, ordner: "INBOX" } as const;

/** Der Ordner für die Kopie gesendeter Mails, wenn die Umgebung einen brauchbaren nennt (WI-0268 C6d); sonst sucht `gesendet-kopie.ts` ihn. */
export function leseGesendetOrdner(umgebung: NodeJS.ProcessEnv = process.env): string | undefined {
    const roh = umgebung["COMMUNITY_MAIL_GESENDET"]?.trim();
    // eslint-disable-next-line no-control-regex
    if (roh === undefined || roh === "" || roh.length > 200 || /[\u0000-\u001f\u007f]/u.test(roh)) return undefined;
    return roh;
}

/** Das Verzeichnis der Ablage, wenn die Angabe brauchbar ist (absolut, ohne Steuerzeichen); die App liest damit die Anhänge, der Ausführer schreibt sie. */
export function leseAblage(umgebung: NodeJS.ProcessEnv = process.env): string | undefined {
    const roh = umgebung["COMMUNITY_MAIL_ABLAGE"]?.trim();
    // eslint-disable-next-line no-control-regex
    if (roh === undefined || roh === "" || /[\u0000-\u001f\u007f]/u.test(roh) || roh.length > 1000) return undefined;
    return isAbsolute(roh) ? roh : undefined;
}

/** Liest die Konfiguration des Abrufs. `undefined`, wenn eine Pflichtangabe fehlt oder unbrauchbar ist: Der Abruf ist dann aus. */
export function leseAbrufKonfiguration(umgebung: NodeJS.ProcessEnv = process.env): AbrufZugang | undefined {
    const wert = (name: string): string | undefined => {
        const roh = umgebung[name];
        return roh === undefined || roh.trim() === "" ? undefined : roh;
    };
    const host = wert("COMMUNITY_MAIL_IMAP_HOST")?.trim();
    const nutzer = wert("COMMUNITY_MAIL_USER");
    const kennwort = wert("COMMUNITY_MAIL_PASSWORD");
    const ablage = leseAblage(umgebung);
    if (host === undefined || nutzer === undefined || kennwort === undefined || ablage === undefined) return undefined;
    if (!HOST.test(host)) return undefined;
    const portText = wert("COMMUNITY_MAIL_IMAP_PORT")?.trim();
    if (portText !== undefined && !/^\d{1,5}$/u.test(portText)) return undefined;
    const port = portText === undefined ? ABRUF_VORGABE.port : Number(portText);
    if (port < 1 || port > 65535) return undefined;
    const ordner = wert("COMMUNITY_MAIL_ORDNER")?.trim() ?? ABRUF_VORGABE.ordner;
    // eslint-disable-next-line no-control-regex
    if (ordner.length > 200 || /[\u0000-\u001f\u007f]/u.test(ordner)) return undefined;
    const sichtbar: AbrufKonfiguration = { host, port, ordner, ablage };
    const zugang = { ...sichtbar } as AbrufZugang;
    Object.defineProperty(zugang, "imapOptionen", {
        enumerable: false,
        value: (): ImapOptionen => ({
            host,
            port,
            secure: port === 993,
            doSTARTTLS: port !== 993,
            auth: { user: nutzer, pass: kennwort },
            logger: false,
            emitLogs: false,
            disableAutoIdle: true,
            connectionTimeout: 20_000,
            greetingTimeout: 20_000,
            socketTimeout: 90_000,
            tls: { minVersion: "TLSv1.2" },
        }),
    });
    Object.defineProperty(zugang, "toJSON", { enumerable: false, value: (): AbrufKonfiguration => sichtbar });
    Object.defineProperty(zugang, inspect.custom, { enumerable: false, value: (): AbrufKonfiguration => sichtbar });
    return Object.freeze(zugang);
}

/** Ist der Abruf an? Alle Pflichtangaben da und brauchbar. */
export const abrufAn = (umgebung: NodeJS.ProcessEnv = process.env): boolean =>
    leseAbrufKonfiguration(umgebung) !== undefined;
