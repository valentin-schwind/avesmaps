import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { leseAbrufKonfiguration, leseGesendetOrdner, type AbrufZugang, type MailZugang } from "./konfiguration.ts";
import { abrufFehler } from "./postfach.ts";
import { baueNachricht, type AusgehendeMail } from "./versand.ts";

/**
 * Die Kopie einer gesendeten Mail im Ordner „Gesendet“ des Postfachs (WI-0268 C6d; Vali 2026-11-04: „Ja, mit Kopie“). Der Versand geht über SMTP, das legt nirgends etwas ab; ohne diese Kopie sähe
 * das Postfach nur die eine Hälfte des Schriftverkehrs.
 *
 * - **Der einzige Schreibweg ins Postfach.** Der Abruf (`postfach.ts`) bleibt nur lesend, seine Schnittstelle kennt keinen schreibenden Aufruf. Hier gibt es genau `append`: kein Anlegen eines
 *   Ordners, kein Flag an einer vorhandenen Mail, kein Löschen. Die Schnittstelle hat nicht einmal einen Aufruf dafür.
 * - 🔴 **Die Mail ist schon zugestellt.** Der Job ruft das erst, nachdem der Zustellstand eingetragen ist; scheitert die Kopie, bleibt die Mail „gesendet“, und das Panel „Mailpostfach“ zeigt es. Deshalb
 *   wirft hier nichts, und einen zweiten Versuch gibt es nicht: Die Mail steht ohnehin in Avesmaps unter Gesendet.
 * - **Dieselbe Mail:** Die Rohmail entsteht aus derselben Nachricht wie der Versand (`baueNachricht`, gleiche `Message-ID`, gleiches Datum), über einen Transport, der nur Text erzeugt und nichts sendet.
 * - **Aus ohne Zugang:** Fehlt der IMAP-Zugang (`leseAbrufKonfiguration`; Stage und lokal), gibt es keine Kopie und keinen Fehler. Der Schalter des Abrufs zählt hier nicht, nur der des Versands: Ohne
 *   Versand keine Kopie.
 * - **Der Ordner:** `COMMUNITY_MAIL_GESENDET`, wenn gesetzt (`leseGesendetOrdner`); sonst der Ordner mit der Kennzeichnung `\Sent`; sonst ein üblicher Name. 🔴 Nie der Ordner, den der Abruf liest:
 *   Die eigene Kopie käme sonst als neue Anfrage zurück.
 * - 🔴 **Nie ein Geheimnis:** Nach außen geht nur ein Wort aus festem Wortschatz (`abrufFehler`), nie der Text eines Servers, nie Adresse, Nutzer oder Kennwort.
 */

/** Ein Ordner, wie ihn der IMAP-Client aufzählt. */
export interface ImapOrdner {
    path: string;
    name?: string;
    specialUse?: string;
}

/** Was die Kopie vom IMAP-Client braucht - und nicht mehr. */
export interface ImapAblage {
    connect(): Promise<unknown>;
    list(): Promise<ImapOrdner[]>;
    append(path: string, content: Buffer, flags: string[], idate: Date): Promise<unknown>;
    logout(): Promise<unknown>;
    close?(): void;
    on?(event: "error", listener: (fehler: unknown) => void): unknown;
}

export type ImapAblageFabrik = (zugang: AbrufZugang) => ImapAblage;

/** Der echte Client: imapflow mit den Zugangsdaten der Umgebung. */
export const echteImapAblage: ImapAblageFabrik = (zugang) =>
    new ImapFlow(zugang.imapOptionen()) as unknown as ImapAblage;

const UEBLICHE_NAMEN = [
    "gesendet",
    "gesendete objekte",
    "gesendete elemente",
    "sent",
    "sent items",
    "sent messages",
    "sent mail",
];

/** Der Ordner für die Kopie: die Vorgabe der Umgebung (nur wenn es sie gibt), die Kennzeichnung `\Sent`, ein üblicher Name. `undefined`: keiner da, und angelegt wird nie einer. */
export function findeGesendetOrdner(ordner: readonly ImapOrdner[], vorgabe?: string): string | undefined {
    if (vorgabe !== undefined) return ordner.find((eintrag) => eintrag.path === vorgabe)?.path;
    const gekennzeichnet = ordner.find((eintrag) => eintrag.specialUse === "\\Sent");
    if (gekennzeichnet !== undefined) return gekennzeichnet.path;
    for (const name of UEBLICHE_NAMEN) {
        const treffer = ordner.find((eintrag) => (eintrag.name ?? eintrag.path).toLowerCase() === name);
        if (treffer !== undefined) return treffer.path;
    }
    return undefined;
}

/** Die Rohmail: dieselbe Nachricht wie im Versand, als Bytes. Der Transport erzeugt nur Text und öffnet keine Verbindung. */
export async function baueRohmail(zugang: MailZugang, mail: AusgehendeMail): Promise<Buffer> {
    const erzeuger = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
    const info = await erzeuger.sendMail(baueNachricht(zugang, mail));
    return info.message as unknown as Buffer;
}

export type GesendetGrund = "anmeldung_abgelehnt" | "ordner_fehlt" | "gestoert";

export type GesendetAblage = { readonly ok: true } | { readonly ok: false; readonly grund: GesendetGrund };

/** Legt die Rohmail als gelesen in den Ordner „Gesendet“. Wirft nie: Ein Fehler ist ein Ergebnis, ohne Text eines Servers. */
export async function legeInGesendetAb(
    zugang: AbrufZugang,
    roh: Buffer,
    datum: Date,
    vorgabe: string | undefined,
    fabrik: ImapAblageFabrik = echteImapAblage,
): Promise<GesendetAblage> {
    let client: ImapAblage | undefined;
    try {
        client = fabrik(zugang);
        // Ein Fehler der Verbindung kommt als Ereignis; ohne Hörer wäre er ein Absturz des Prozesses.
        client.on?.("error", () => undefined);
        await client.connect();
        const pfad = findeGesendetOrdner(await client.list(), vorgabe);
        if (pfad === undefined || pfad === zugang.ordner) return { ok: false, grund: "ordner_fehlt" };
        const antwort = await client.append(pfad, roh, ["\\Seen"], datum);
        return antwort === false ? { ok: false, grund: "gestoert" } : { ok: true };
    } catch (fehler) {
        return { ok: false, grund: abrufFehler(fehler).lauf };
    } finally {
        try {
            await client?.logout();
        } catch {
            // Ein Fehler beim Abmelden ändert am Ergebnis nichts; die Verbindung wird geschlossen.
            try {
                client?.close?.();
            } catch {
                // nichts mehr zu tun
            }
        }
    }
}

/** `aus`: kein IMAP-Zugang in dieser Umgebung. `abgelegt`: Die Kopie liegt im Ordner. `fehlt`: Sie sollte, aber es ging nicht. */
export type GesendetKopie = "aus" | "abgelegt" | "fehlt";

export interface GesendetKopieAuftrag {
    umgebung: NodeJS.ProcessEnv;
    zugang: MailZugang;
    mail: AusgehendeMail;
    datum: Date;
    fabrik?: ImapAblageFabrik | undefined;
    warne: (text: string) => void;
}

/** Die Kopie einer zugestellten Mail. Wirft nie; `warne` bekommt nur das Wort, nie einen Text des Servers. */
export async function kopiereInGesendet(auftrag: GesendetKopieAuftrag): Promise<GesendetKopie> {
    const postfach = leseAbrufKonfiguration(auftrag.umgebung);
    if (postfach === undefined) return "aus";
    try {
        const roh = await baueRohmail(auftrag.zugang, auftrag.mail);
        const ablage = await legeInGesendetAb(
            postfach,
            roh,
            auftrag.datum,
            leseGesendetOrdner(auftrag.umgebung),
            auftrag.fabrik,
        );
        if (ablage.ok) return "abgelegt";
        auftrag.warne(`Mailversand: Kopie in „Gesendet“ nicht abgelegt (${ablage.grund})`);
    } catch {
        auftrag.warne("Mailversand: Kopie in „Gesendet“ nicht abgelegt (gestoert)");
    }
    return "fehlt";
}
