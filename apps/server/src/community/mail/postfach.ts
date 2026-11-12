import { ImapFlow } from "imapflow";
import type { AbrufZugang } from "./konfiguration.ts";

/**
 * Die Quelle der eingehenden Mails (WI-0268 C6b): das Postfach, **nur lesend**. Der Abruf (`jobs/community-mail-abruf-job.ts`) kennt allein diese Schnittstelle; die Tests stellen eine eigene Quelle
 * mit Roh-MIME aus Fixtures, es wird NIE ein echtes Postfach abgefragt.
 *
 * - `lies` bekommt den Stand (`UIDVALIDITY` des Ordners beim letzten Mal, letzte gelesene UID) und liefert die nächsten Mails, älteste zuerst, höchstens `MAX_MAILS_JE_LAUF`.
 *   Wechselt `UIDVALIDITY` (der Server hat die Nummern neu vergeben), liest die Quelle ab UID 1 neu; doppelte Message-IDs überspringt die Datenbank.
 * - Eine Mail über `GRENZE_MAIL_BYTES` holt die Quelle gar nicht (`zuGross`): nur ihre Kopfzeilen, damit sie als „zu groß, nicht übernommen“ eingetragen werden kann.
 * - 🔴 **Nur lesend, an jeder Stelle:** Der Ordner wird schreibgeschützt geöffnet (`readOnly`, IMAP `EXAMINE`), der Inhalt mit `BODY.PEEK` geholt. Kein Flag, kein Verschieben, kein Löschen, kein Anlegen.
 *   Die Schnittstelle hat nicht einmal einen Aufruf dafür. Der einzige Schreibweg ins Postfach ist die Kopie gesendeter Mails (`gesendet-kopie.ts`, C6d), getrennt von diesem Leser.
 * - 🔴 Die Zugangsdaten verlassen `AbrufZugang.imapOptionen` nie in einen Fehlertext: Ein Fehler der Verbindung wird auf einen Satz aus festem Wortschatz abgebildet (`abrufFehler`).
 */

/** Höchstens so viele Mails je Lauf (die älteste zuerst); der Rest folgt im nächsten Lauf. */
export const MAX_MAILS_JE_LAUF = 50;
/** Über dieser Größe wird die Mail nicht geholt, sondern nur ihre Kopfzeilen (Bytes). */
export const GRENZE_MAIL_BYTES = 30 * 1024 * 1024;
/** Mehr als das hält ein Lauf nicht im Speicher: Ist die Summe der geholten Mails erreicht, endet der Lauf (der Rest folgt). */
export const MAX_BYTES_JE_LAUF = 128 * 1024 * 1024;

export interface PostfachStand {
    /** `UIDVALIDITY` beim letzten Lauf; `null`, wenn dieser Ordner noch nie gelesen wurde. */
    uidValidity: number | null;
    /** Die letzte UID, die verarbeitet ist (0: noch keine). */
    letzteUid: number;
}

export interface PostfachMail {
    uid: number;
    /** Die Rohmail (MIME); bei `zuGross` nur ihre Kopfzeilen. */
    roh: Buffer;
    /** Gesetzt, wenn die Mail über der Grenze liegt: ihre Größe in Bytes. `roh` trägt dann nur die Kopfzeilen. */
    zuGross?: number;
}

export interface PostfachLauf {
    uidValidity: number;
    nachrichten: PostfachMail[];
}

export interface PostfachQuelle {
    lies(stand: PostfachStand): Promise<PostfachLauf>;
}

/** Das Wort, unter dem das Panel `Mailpostfach` den Fehler als letzten Lauf zeigt (WI-0268 C6c, `MAIL_ABRUF_ERGEBNISSE`). */
export type AbrufLauf = "anmeldung_abgelehnt" | "ordner_fehlt" | "gestoert";

/**
 * Ein Fehler beim Abholen, mit einem Satz ohne Geheimnis und der Auskunft, ob Wiederholen hilft. `lauf` ist dasselbe als Wort für das Panel; ohne Angabe: wiederholbar `gestoert`, sonst `ordner_fehlt`
 * (ein dauerhafter Fehler außer der Anmeldung betrifft den Ordner).
 */
export class AbrufStoerung extends Error {
    readonly wiederholbar: boolean;
    readonly lauf: AbrufLauf;
    constructor(message: string, wiederholbar: boolean, lauf?: AbrufLauf) {
        super(message);
        this.name = "AbrufStoerung";
        this.wiederholbar = wiederholbar;
        this.lauf = lauf ?? (wiederholbar ? "gestoert" : "ordner_fehlt");
    }
}

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
    "NoConnection",
    "ETIMEOUT",
]);

/**
 * Bildet einen Fehler der Verbindung auf einen Satz aus festem Wortschatz ab - nie auf seinen Text (der könnte Nutzer, Kennwort oder die Antwort des Servers tragen).
 * Anmeldung abgelehnt: nicht wiederholbar (Wiederholen sperrte höchstens das Konto); alles andere: wiederholbar.
 */
export function abrufFehler(fehler: unknown): AbrufStoerung {
    if (fehler instanceof AbrufStoerung) return fehler;
    const roh = (typeof fehler === "object" && fehler !== null ? fehler : {}) as {
        code?: unknown;
        authenticationFailed?: unknown;
        name?: unknown;
    };
    const code = typeof roh.code === "string" ? roh.code : undefined;
    if (roh.authenticationFailed === true || roh.name === "AuthenticationFailure" || code === "AUTHENTICATIONFAILED")
        return new AbrufStoerung("Der Mailserver hat die Anmeldung abgelehnt", false, "anmeldung_abgelehnt");
    if (code === "NONEXISTENT" || code === "TRYCREATE")
        return new AbrufStoerung("Der Ordner des Postfachs gibt es nicht", false);
    if (code !== undefined && NETZ.has(code))
        return new AbrufStoerung("Der Mailserver ist nicht erreichbar oder die Verbindung brach ab", true);
    return new AbrufStoerung("Das Postfach konnte nicht gelesen werden", true);
}

// --- Die Umsetzung mit imapflow ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** Was der Abruf vom IMAP-Client braucht - und nicht mehr. Wer diese Schnittstelle erfüllt, kann nichts schreiben. */
export interface ImapLeser {
    connect(): Promise<unknown>;
    getMailboxLock(path: string, options: { readOnly: true }): Promise<{ release(): void }>;
    readonly mailbox: { uidValidity?: bigint | number | undefined } | false;
    search(query: { uid: string }, options: { uid: true }): Promise<number[] | false | undefined>;
    fetchOne(
        seq: string,
        query: { uid?: true; size?: true; source?: true; headers?: true },
        options: { uid: true },
    ): Promise<{ uid?: number; size?: number; source?: Buffer; headers?: Buffer } | false | undefined>;
    logout(): Promise<unknown>;
    close?(): void;
    on?(event: "error", listener: (fehler: unknown) => void): unknown;
}

export type ImapFabrik = (zugang: AbrufZugang) => ImapLeser;

/** Der echte Client: imapflow mit den Zugangsdaten der Umgebung. */
export const echterImapLeser: ImapFabrik = (zugang) => new ImapFlow(zugang.imapOptionen()) as unknown as ImapLeser;

/**
 * Die Quelle über IMAP. `ordner` und Zugang stammen aus der Konfiguration; der Client kommt aus der Fabrik (Tests geben einen gestellten, der jeden Aufruf aufzeichnet).
 */
export function imapQuelle(zugang: AbrufZugang, fabrik: ImapFabrik = echterImapLeser): PostfachQuelle {
    return {
        async lies(stand) {
            const client = fabrik(zugang);
            // Ein Fehler der Verbindung kommt als Ereignis; ohne Hörer wäre er ein Absturz des Prozesses.
            client.on?.("error", () => undefined);
            try {
                await client.connect();
                const sperre = await client.getMailboxLock(zugang.ordner, { readOnly: true });
                try {
                    const offen = client.mailbox;
                    const gueltigkeit = offen === false ? undefined : offen.uidValidity;
                    if (gueltigkeit === undefined)
                        throw new AbrufStoerung("Das Postfach nennt keine UIDVALIDITY", false);
                    const uidValidity = Number(gueltigkeit);
                    // Wechselt UIDVALIDITY, sind die alten UIDs wertlos: von vorn lesen (die Message-ID überspringt Bekanntes).
                    const ab = stand.uidValidity !== null && stand.uidValidity !== uidValidity ? 0 : stand.letzteUid;
                    const treffer = (await client.search({ uid: `${String(ab + 1)}:*` }, { uid: true })) || [];
                    // `n:*` liefert immer auch die jüngste UID, selbst wenn sie kleiner als n ist.
                    const uids = [...new Set(treffer)]
                        .filter((uid) => uid > ab)
                        .sort((a, b) => a - b)
                        .slice(0, MAX_MAILS_JE_LAUF);
                    const nachrichten: PostfachMail[] = [];
                    let summe = 0;
                    for (const uid of uids) {
                        const kopf = await client.fetchOne(String(uid), { uid: true, size: true }, { uid: true });
                        if (kopf === false || kopf === undefined) continue;
                        const groesse = kopf.size ?? 0;
                        if (groesse > GRENZE_MAIL_BYTES) {
                            const kopfzeilen = await client.fetchOne(
                                String(uid),
                                { uid: true, headers: true },
                                { uid: true },
                            );
                            nachrichten.push({
                                uid,
                                roh:
                                    kopfzeilen === false || kopfzeilen === undefined
                                        ? Buffer.alloc(0)
                                        : (kopfzeilen.headers ?? Buffer.alloc(0)),
                                zuGross: groesse,
                            });
                            continue;
                        }
                        if (nachrichten.length > 0 && summe + groesse > MAX_BYTES_JE_LAUF) break;
                        const voll = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
                        if (voll === false || voll === undefined || voll.source === undefined) continue;
                        summe += voll.source.length;
                        nachrichten.push({ uid, roh: voll.source });
                    }
                    return { uidValidity, nachrichten };
                } finally {
                    sperre.release();
                }
            } catch (fehler) {
                throw abrufFehler(fehler);
            } finally {
                try {
                    await client.logout();
                } catch {
                    // Ein Fehler beim Abmelden ändert am Ergebnis nichts; die Verbindung wird geschlossen.
                    try {
                        client.close?.();
                    } catch {
                        // nichts mehr zu tun
                    }
                }
            }
        },
    };
}
