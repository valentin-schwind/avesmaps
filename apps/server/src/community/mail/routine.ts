import type { MailAbrufErgebnis, MailRoutineArt, MailVersandErgebnis } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";

/**
 * Die Schalter des Mailwegs und der letzte Lauf (WI-0268 C6c, Migration 0289, `avesmaps_community.mail_routine`). Hier steht nur SQL und die Brücke zu den Jobs; was der Stand für das Panel heißt, rechnet `stand.ts`.
 *
 * - **Die Jobs-Rolle** liest beide Schalter (`community_mail_routinen`) und trägt jeden Lauf ein (`community_mail_lauf`): die Pflege (Abruf), der Abrufjob und der Versandjob. Kein Tafelrecht.
 * - **Die App** liest alles für das Panel in einer Antwort (`community_mail_uebersicht`), legt den Schalter um (`community_mail_routine_setzen`) und holt die Kennungen der wartenden Mails (`community_mail_wartende`).
 * - 🔴 **Die `.env` bleibt das erste Tor.** Der Schalter gilt zusätzlich; kann er nicht gelesen werden (Funktion fehlt 42883, Recht fehlt 42501, Tafel fehlt), gilt „an“ wie vor dieser Migration, und eine Warnung nennt NUR den
 *   SQLSTATE. Scheitert das Eintragen eines Laufs, scheitert der Job deshalb nicht.
 * - 🔴 Nie ein Text eines Servers, nie Adresse, Nutzer oder Kennwort: Ein Lauf ist ein Wort aus einer festen Liste (`MAIL_ABRUF_ERGEBNISSE`, `MAIL_VERSAND_ERGEBNISSE`), dazu ganze Zahlen.
 */

/** Wohin eine Warnung geht: Die Jobs schreiben auf stderr (der Ausführer sammelt es), die Pflege in ihr Log, Tests in eine Liste. */
export type Warnung = (text: string) => void;

export const stderrWarnung: Warnung = (text) => void process.stderr.write(`${text}\n`);

/** Der SQLSTATE eines Fehlers als Text, sonst „unbekannt“; nie der Text des Fehlers. */
export function sqlstateVon(fehler: unknown): string {
    const code = (fehler as { code?: unknown } | null | undefined)?.code;
    return typeof code === "string" ? code : "unbekannt";
}

export interface MailSchalter {
    abruf: boolean;
    versand: boolean;
}

/** Beide Schalter, wie die Jobs sie brauchen. Wirft den Fehler der Datenbank. */
export async function leseSchalter(db: Queryable): Promise<MailSchalter> {
    const [row] = await db<
        { s: { abruf?: unknown; versand?: unknown } | null }[]
    >`SELECT avesmaps_community.community_mail_routinen() AS s`;
    // Ein fehlender Wert ist „an“: Das ist der Normalzustand, ausgeschaltet wird im Panel.
    return { abruf: row?.s?.abruf !== false, versand: row?.s?.versand !== false };
}

/**
 * Wie `leseSchalter`, wirft aber nie: Kann der Schalter nicht gelesen werden, gilt „an“ (die `.env` ist das erste Tor, das Verhalten bleibt wie vor der Migration) und `warne` bekommt den SQLSTATE.
 */
export async function leseSchalterOderAn(db: Queryable, warne: Warnung, wo: string): Promise<MailSchalter> {
    try {
        return await leseSchalter(db);
    } catch (fehler) {
        warne(
            `${wo}: Schalter des Mailwegs nicht lesbar (Migration 0289 oder Recht der Jobs-Rolle?), SQLSTATE ${sqlstateVon(fehler)}; es gilt „an“`,
        );
        return { abruf: true, versand: true };
    }
}

/** Das Wort, das einen gelungenen Lauf kennzeichnet. */
const ERFOLG: Record<MailRoutineArt, string> = { abruf: "gelesen", versand: "gesendet" };

/**
 * Trägt einen Lauf ein: das Wort, bei Erfolg zusätzlich die Zahlen. Wirft nie: Fehlt die Funktion oder das Recht (Release vor der Migration), bekommt `warne` den SQLSTATE, und der Job läuft weiter.
 */
export async function trageLaufEin(
    db: Queryable,
    art: MailRoutineArt,
    ergebnis: MailAbrufErgebnis | MailVersandErgebnis,
    zahlen: Record<string, number> | undefined,
    warne: Warnung,
): Promise<void> {
    try {
        await db`
            SELECT avesmaps_community.community_mail_lauf(${art}, ${ergebnis}, ${db.json((zahlen ?? {}) as never)}::jsonb, ${ergebnis === ERFOLG[art]})
        `;
    } catch (fehler) {
        warne(`community_mail_lauf (${art}): Lauf nicht eingetragen, SQLSTATE ${sqlstateVon(fehler)}`);
    }
}

// --- Das Panel ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface RohRoutine {
    aktiv: boolean;
    geaendertAt: string | null;
    geaendertVon: string | null;
    letzterLauf: { at: string; ergebnis: string } | null;
    letzterErfolg: { at: string; zahlen: Record<string, number> } | null;
}

/** Was `community_mail_uebersicht` liefert (Zeiten als Text der Datenbank; `stand.ts` macht ISO daraus). */
export interface MailUebersicht {
    routinen: Partial<Record<MailRoutineArt, RohRoutine>>;
    startpunkt: { uidValidity: number; letzteUid: number } | null;
    wartend: number;
    fehler7Tage: number;
    letzteMailAt: string | null;
}

/** Alles für das Panel; `ordner` ist der Ordner, dessen Startpunkt gesucht wird. Wirft den Fehler der Datenbank. */
export async function leseUebersicht(db: Queryable, ordner: string): Promise<MailUebersicht> {
    const [row] = await db<
        { u: MailUebersicht }[]
    >`SELECT avesmaps_community.community_mail_uebersicht(${ordner}) AS u`;
    if (row === undefined) throw new Error("community_mail_uebersicht lieferte nichts");
    return row.u;
}

export interface SchalterErgebnis {
    art: MailRoutineArt;
    vorher: boolean;
    nachher: boolean;
    geaendert: boolean;
}

/** Legt den Schalter um (Recht und Passkey prüft die Route). Gleicher Zustand wie schon ändert nichts. */
export async function setzeSchalter(
    db: Queryable,
    art: MailRoutineArt,
    aktiv: boolean,
    person: string,
): Promise<SchalterErgebnis> {
    const [row] = await db<
        { r: SchalterErgebnis }[]
    >`SELECT avesmaps_community.community_mail_routine_setzen(${art}, ${aktiv}, ${person}::uuid) AS r`;
    if (row === undefined) throw new Error("community_mail_routine_setzen lieferte nichts");
    return row.r;
}

/** Die Kennungen der wartenden Mails, älteste zuerst (höchstens 1000). */
export async function wartendeMails(db: Queryable): Promise<number[]> {
    const [row] = await db<{ ids: unknown }[]>`SELECT avesmaps_community.community_mail_wartende() AS ids`;
    return Array.isArray(row?.ids) ? row.ids.map(Number) : [];
}
