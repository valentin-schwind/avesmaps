import { dateiAblage, type Ablage } from "../community/mail/ablage.ts";
import { mailEingegangen } from "../community/glocke.ts";
import {
    COMMUNITY_MAIL_ABRUF_KIND,
    MAIL_ABRUF_DAUERHAFT,
    MAIL_ABRUF_GESTOERT,
    leseAbrufKonfiguration,
    type AbrufZugang,
} from "../community/mail/konfiguration.ts";
import { verarbeiteMail, type VerarbeiteteMail } from "../community/mail/eingang.ts";
import {
    AbrufStoerung,
    abrufFehler,
    imapQuelle,
    type AbrufLauf,
    type PostfachMail,
    type PostfachQuelle,
    type PostfachStand,
} from "../community/mail/postfach.ts";
import {
    leseSchalterOderAn,
    sqlstateVon,
    stderrWarnung,
    trageLaufEin,
    type Warnung,
} from "../community/mail/routine.ts";
import type { Queryable } from "../database.ts";
import { benachrichtigungUmgebung } from "./benachrichtigung-job.ts";
import { JobCancelled, JobFailure, JobStopped, type JobContext } from "./handlers.ts";
import { asJson } from "./store.ts";
import { withJobDatabase } from "./job-database.ts";

/**
 * Die Jobart `community_mail_abruf` (WI-0268 C6b; Fachkonzept WI-0263 §3.4, Bedienkonzept §3.1): das bestehende Postfach **lesend** abholen. Jede neue Mail wird ein Vorgang (Anfrage) oder hängt sich an einen
 * vorhandenen; HTML bereinigt, Anhänge nach der Sperrliste, alles in der Ablage (`community/mail/ablage.ts`). Die Pflege der Jobs-Rolle reiht ihn alle fünf Minuten ein, aber nur, wenn der Abruf
 * konfiguriert ist (`COMMUNITY_MAIL_IMAP_HOST`, `_USER`, `_PASSWORD`, `_ABLAGE`) und kein anderer läuft oder wartet (dieselbe `external_ref`). Eingabe: keine.
 *
 * - **Ablauf:** Stand lesen (`community_mail_abruf_stand`) · höchstens 50 Mails holen, älteste zuerst (`PostfachQuelle.lies`) · jede Mail verarbeiten (`verarbeiteMail`: Ablage, Bereinigung, Sperrliste) und aufnehmen
 *   (`community_mail_eingang`: Faden, Vorgang, Nachricht, Anhänge) · Glocke · Stand eintragen · die Ablage mit der Datenbank abgleichen (verwaiste Dateien löschen).
 * - 🔴 **Nur lesend am Postfach** (Ordner schreibgeschützt, kein Flag, kein Verschieben, kein Löschen). Die Datenbank überspringt bekannte Message-IDs: Wird eine Mail zweimal geholt (Absturz zwischen Aufnahme und
 *   Stand, Wechsel von `UIDVALIDITY`), entsteht nichts Neues.
 * - **Der Stand rückt Mail für Mail vor:** Scheitert die Datenbank bei der fünften Mail, steht die vierte im Stand; der nächste Lauf beginnt bei der fünften. Eine Mail, die der Parser nicht versteht, ist kein Fehler
 *   des Abrufs: Sie wird als „nicht lesbar“ eingetragen.
 * - 🔴 **Nie Zugangsdaten, Adresse oder Inhalt in Ergebnis, Fehlertext oder Protokoll:** Das Ergebnis trägt nur Zahlen; ein Fehler des Postfachs wird auf einen Satz aus festem Wortschatz abgebildet.
 * - **Ohne Konfiguration** (die Umgebung des Ausführers hat die Angaben nicht) tut der Job nichts und endet ohne Fehler.
 * - 🔴 **Der Schalter des Panels „Mailpostfach“** (WI-0268 C6c, `mail_routine`, Migration 0289) gilt zusätzlich zur Konfiguration: Steht der Abruf auf aus, endet der Job beim Start OHNE Verbindung zum Postfach mit
 *   `ergebnis: "ausgeschaltet"`. Kann der Schalter nicht gelesen werden (Funktion oder Recht fehlt), gilt „an“ wie bisher und eine Warnung nennt den SQLSTATE. Jeder Lauf trägt sein Ergebnis als Wort aus
 *   einer festen Liste ein (`community_mail_lauf`: `gelesen` mit den Zahlen, `anmeldung_abgelehnt`, `ordner_fehlt`, `gestoert`, `zugang_fehlt`, `ausgeschaltet`); scheitert das Eintragen, scheitert der Job nicht.
 * - Ein Fehler wiederholt der Job nicht selbst (`retryable: false`): Die Pflege reiht den nächsten Lauf ein. Nach „Anmeldung abgelehnt“ wartet sie sechs Stunden, um das Konto nicht zu sperren.
 */

export { COMMUNITY_MAIL_ABRUF_KIND, MAIL_ABRUF_DAUERHAFT, MAIL_ABRUF_GESTOERT };

export interface MailAbrufAbhaengigkeiten {
    /** Die Datenbank des Auftrags (Jobs-Rolle); Tests geben ihre Verbindung. */
    database?: Queryable;
    environment?: NodeJS.ProcessEnv;
    /** Die Quelle der Mails; Tests stellen sie, damit nie ein echtes Postfach abgefragt wird. */
    quelle?: (zugang: AbrufZugang) => PostfachQuelle;
    /** Die Ablage; Tests nehmen ein Verzeichnis in ihrem Temp. */
    ablage?: Ablage;
    /** Mindestalter einer Datei für den Abgleich der Ablage (Tests setzen 0). */
    abgleichMindestalterMs?: number;
    /** Wohin eine Warnung geht (Schalter oder Lauf nicht lesbar bzw. eintragbar, Glocke nicht gemeldet; nur der SQLSTATE); ohne Angabe stderr. */
    warnung?: Warnung;
}

export interface AbrufErgebnis {
    ergebnis: "aus" | "gelesen" | "ausgeschaltet";
    /** Wie viele Mails die Quelle lieferte. */
    gelesen: number;
    /** Neue Vorgänge. */
    neu: number;
    /** Mails, die sich an einen vorhandenen Vorgang hängten. */
    angehaengt: number;
    /** Davon: Vorgänge, die sich wieder öffneten. */
    wiedergeoeffnet: number;
    /** Die Datenbank kannte die Mail schon. */
    doppelt: number;
    /** Über der Grenze, nicht übernommen. */
    zuGross: number;
    /** Nicht lesbar, als solche eingetragen. */
    unlesbar: number;
    /** Gelöschte verwaiste Dateien in der Ablage. */
    dateienGeloescht: number;
}

function leer(ergebnis: AbrufErgebnis["ergebnis"]): AbrufErgebnis {
    return {
        ergebnis,
        gelesen: 0,
        neu: 0,
        angehaengt: 0,
        wiedergeoeffnet: 0,
        doppelt: 0,
        zuGross: 0,
        unlesbar: 0,
        dateienGeloescht: 0,
    };
}

interface Aufgenommen {
    id: number;
    nummer: string;
    nachricht: number;
    ergebnis: "neu" | "angehaengt" | "doppelt";
    vorgangNeu: boolean;
    wiedergeoeffnet: boolean;
    zustaendig: string | null;
    papierkorb: boolean;
}

async function leseStand(db: Queryable, ordner: string): Promise<PostfachStand> {
    const [row] = await db<
        { stand: { uidValidity: number | string; letzteUid: number | string } | null }[]
    >`SELECT avesmaps_community.community_mail_abruf_stand(${ordner}) AS stand`;
    return row?.stand == null
        ? { uidValidity: null, letzteUid: 0 }
        : { uidValidity: Number(row.stand.uidValidity), letzteUid: Number(row.stand.letzteUid) };
}

async function setzeStand(db: Queryable, ordner: string, uidValidity: number, letzteUid: number): Promise<void> {
    await db`SELECT avesmaps_community.community_mail_abruf_setzen(${ordner}, ${uidValidity}::bigint, ${letzteUid}::bigint)`;
}

async function nimmAuf(db: Queryable, verarbeitet: VerarbeiteteMail): Promise<Aufgenommen> {
    const [row] = await db<{ ergebnis: Aufgenommen }[]>`
        SELECT avesmaps_community.community_mail_eingang(${asJson(db, verarbeitet.mail)}::jsonb, ${asJson(db, verarbeitet.anhaenge)}::jsonb) AS ergebnis
    `;
    if (row === undefined) throw new Error("community_mail_eingang lieferte nichts");
    return row.ergebnis;
}

/** Ein Fehler der Daten dieser einen Mail (Bedingung der Tafel verletzt, Angabe unbrauchbar), nicht der Verbindung. */
const istDatenfehler = (fehler: unknown): boolean => {
    const code = (fehler as { code?: unknown }).code;
    return typeof code === "string" && (code.startsWith("22") || code.startsWith("23") || code === "KC422");
};

/**
 * Nimmt die Mail auf; verletzt sie eine Bedingung der Tafel (ein Fund, den der Parser nicht ahnte), wird sie als „nicht lesbar“ mit Kopfzeilen und Rohmail eingetragen, statt den Abruf an ihr hängen zu lassen.
 */
async function nimmAufOderNotfall(db: Queryable, verarbeitet: VerarbeiteteMail): Promise<Aufgenommen> {
    try {
        return await nimmAuf(db, verarbeitet);
    } catch (fehler) {
        if (!istDatenfehler(fehler)) throw fehler;
        const notfall: VerarbeiteteMail = {
            mail: {
                ...verarbeitet.mail,
                text: null,
                html: null,
                externBilder: 0,
                vonName: null,
                betreff: "",
                hinweis: "unlesbar",
            },
            anhaenge: [],
        };
        return nimmAuf(db, notfall);
    }
}

/** Ein Fehler des Abrufs mit dem Wort, unter dem das Panel ihn als letzten Lauf zeigt. */
class AbrufJobFehler extends JobFailure {
    readonly lauf: AbrufLauf;
    constructor(code: string, message: string, lauf: AbrufLauf) {
        super(code, message, false);
        this.lauf = lauf;
    }
}

function stoerung(fehler: unknown): JobFailure {
    const s = abrufFehler(fehler);
    return new AbrufJobFehler(
        s.wiederholbar ? MAIL_ABRUF_GESTOERT : MAIL_ABRUF_DAUERHAFT,
        `Mailabruf: ${s.message}`,
        s.lauf,
    );
}

/** Das Wort des Panels zu einem Fehler des Laufs; `undefined`, wenn nichts einzutragen ist (Abbruch oder Ablösen des Auftrags). */
function lauftypVon(fehler: unknown): AbrufLauf | undefined {
    if (fehler instanceof JobCancelled || fehler instanceof JobStopped) return undefined;
    return fehler instanceof AbrufJobFehler ? fehler.lauf : "gestoert";
}

async function laufe(
    db: Queryable,
    kontext: JobContext,
    deps: MailAbrufAbhaengigkeiten,
): Promise<Record<string, unknown>> {
    const umgebung = deps.environment ?? process.env;
    const warne = deps.warnung ?? stderrWarnung;
    const zugang = leseAbrufKonfiguration(umgebung);
    if (zugang === undefined) {
        await trageLaufEin(db, "abruf", "zugang_fehlt", undefined, warne);
        return { ...leer("aus") };
    }
    // Der Schalter des Panels (Migration 0289): aus heißt, nicht einmal eine Verbindung zum Postfach zu öffnen.
    if (!(await leseSchalterOderAn(db, warne, "Mailabruf")).abruf) {
        await trageLaufEin(db, "abruf", "ausgeschaltet", undefined, warne);
        return { ...leer("ausgeschaltet") };
    }
    try {
        const bilanz = await holeAb(db, kontext, deps, zugang, umgebung);
        await trageLaufEin(
            db,
            "abruf",
            "gelesen",
            { neu: bilanz.neu, angehaengt: bilanz.angehaengt, unlesbar: bilanz.unlesbar, zu_gross: bilanz.zuGross },
            warne,
        );
        return { ...bilanz };
    } catch (fehler) {
        const lauf = lauftypVon(fehler);
        if (lauf !== undefined) await trageLaufEin(db, "abruf", lauf, undefined, warne);
        throw fehler;
    }
}

async function holeAb(
    db: Queryable,
    kontext: JobContext,
    deps: MailAbrufAbhaengigkeiten,
    zugang: AbrufZugang,
    umgebung: NodeJS.ProcessEnv,
): Promise<AbrufErgebnis> {
    const ablage = deps.ablage ?? dateiAblage(zugang.ablage);
    const warne = deps.warnung ?? stderrWarnung;
    const bilanz = leer("gelesen");

    await kontext.beginPhase("lesen", 0.1);
    const stand = await leseStand(db, zugang.ordner);
    let lauf;
    try {
        lauf = await (deps.quelle ?? imapQuelle)(zugang).lies(stand);
    } catch (fehler) {
        throw stoerung(fehler);
    }
    bilanz.gelesen = lauf.nachrichten.length;

    // Wechselt UIDVALIDITY, beginnt der Ordner von vorn: Der alte Stand gilt nicht mehr.
    const neuBeginn = stand.uidValidity !== null && stand.uidValidity !== lauf.uidValidity;
    let letzte = neuBeginn || stand.uidValidity === null ? 0 : stand.letzteUid;
    await setzeStandWennNoetig(db, zugang.ordner, lauf.uidValidity, letzte, stand, neuBeginn);

    let glockeUmgebung: string | undefined;
    try {
        glockeUmgebung = benachrichtigungUmgebung(umgebung);
    } catch {
        // Die Umgebung der Glocke ist unklar (AVESMAPS_ENV fehlt oder falsch): Die Liste der Redaktion bleibt die Wahrheit.
        glockeUmgebung = undefined;
    }

    await kontext.beginPhase("aufnehmen", 0.3);
    for (const mail of lauf.nachrichten) {
        const verarbeitet = await verarbeiteEine(mail, ablage, lauf.uidValidity);
        const aufgenommen = await nimmAufOderNotfall(db, verarbeitet);
        zaehle(bilanz, verarbeitet, aufgenommen);
        if (aufgenommen.ergebnis !== "doppelt" && glockeUmgebung !== undefined) {
            try {
                await mailEingegangen(db, glockeUmgebung, {
                    nummer: aufgenommen.nummer,
                    nachricht: aufgenommen.nachricht,
                    vorgangNeu: aufgenommen.vorgangNeu,
                    zustaendig: aufgenommen.zustaendig,
                    papierkorb: aufgenommen.papierkorb,
                });
            } catch (fehler) {
                // Die Glocke ist ein Hinweis, kein Protokoll: Scheitert sie, steht die Mail trotzdem im Eingang. 🔴 Die Zeile nennt nur Nummer und SQLSTATE, nie Absender, Betreff oder Inhalt.
                warne(
                    `Mailabruf: Glocke zu ${aufgenommen.nummer} nicht gemeldet, SQLSTATE ${sqlstateVon(fehler)}; die Mail steht im Eingang`,
                );
            }
        }
        // Der Stand rückt Mail für Mail vor: Stirbt der Job hier, beginnt der nächste bei der folgenden Mail.
        letzte = Math.max(letzte, mail.uid);
        await setzeStand(db, zugang.ordner, lauf.uidValidity, letzte);
    }

    await kontext.beginPhase("aufraeumen", 0.9);
    try {
        const abgleich = await ablage.gleicheAb(
            async (namen) => {
                const [row] = await db<
                    { behalten: string[] }[]
                >`SELECT avesmaps_community.community_mail_dateien_behalten(${db.array(namen, 1009)}::text[]) AS behalten`;
                return row?.behalten ?? [];
            },
            deps.abgleichMindestalterMs === undefined ? {} : { mindestAlterMs: deps.abgleichMindestalterMs },
        );
        bilanz.dateienGeloescht = abgleich.geloescht;
    } catch {
        // Das Aufräumen ist ein Nebengeschäft: Scheitert es (Rechte an der Ablage), holt der nächste Lauf es nach; die Mails sind aufgenommen.
    }
    return bilanz;
}

async function setzeStandWennNoetig(
    db: Queryable,
    ordner: string,
    uidValidity: number,
    letzte: number,
    stand: PostfachStand,
    neuBeginn: boolean,
): Promise<void> {
    // Der erste Lauf und ein Wechsel von UIDVALIDITY schreiben den Stand sofort (auch ohne Mails), damit der nächste Lauf den neuen Zähler kennt.
    if (stand.uidValidity === null || neuBeginn) await setzeStand(db, ordner, uidValidity, letzte);
}

async function verarbeiteEine(mail: PostfachMail, ablage: Ablage, uidValidity: number): Promise<VerarbeiteteMail> {
    try {
        return await verarbeiteMail(mail, { ablage, uid: mail.uid, uidValidity });
    } catch (fehler) {
        // Ein Fehler der Ablage (Platte voll, Rechte) ist ein Fehler des Betriebs, kein Fehler der Mail: Der Lauf endet, der Stand bleibt vor dieser Mail.
        void fehler;
        throw new JobFailure(MAIL_ABRUF_GESTOERT, "Mailabruf: Die Ablage ist nicht beschreibbar", false);
    }
}

function zaehle(bilanz: AbrufErgebnis, verarbeitet: VerarbeiteteMail, aufgenommen: Aufgenommen): void {
    if (aufgenommen.ergebnis === "doppelt") bilanz.doppelt += 1;
    else if (aufgenommen.ergebnis === "neu") bilanz.neu += 1;
    else bilanz.angehaengt += 1;
    if (aufgenommen.wiedergeoeffnet) bilanz.wiedergeoeffnet += 1;
    if (verarbeitet.mail.hinweis === "zu_gross") bilanz.zuGross += 1;
    if (verarbeitet.mail.hinweis === "unlesbar") bilanz.unlesbar += 1;
}

/** Der Handler im Job-Prozess. `deps` nur für Tests: die Testdatenbank, eine eigene Umgebung, eine gestellte Quelle und Ablage. */
export async function runCommunityMailAbrufJob(
    kontext: JobContext,
    deps: MailAbrufAbhaengigkeiten = {},
): Promise<Record<string, unknown>> {
    try {
        if (deps.database !== undefined) return await laufe(deps.database, kontext, deps);
        return await withJobDatabase((database) => laufe(database, kontext, deps));
    } catch (fehler) {
        if (fehler instanceof JobFailure) throw fehler;
        if (fehler instanceof AbrufStoerung) throw stoerung(fehler);
        const code = (fehler as { code?: unknown }).code;
        // Nur der SQLSTATE geht auf die Statusseite, nie ein Text. Eine verlorene Verbindung zur Datenbank ist vorübergehend; die Pflege reiht den nächsten Lauf ein.
        throw new JobFailure(
            MAIL_ABRUF_GESTOERT,
            `Mailabruf gescheitert, SQLSTATE ${typeof code === "string" ? code : "unbekannt"}`,
            false,
        );
    }
}
