import { isDatabaseUnavailable, type Queryable } from "../database.ts";
import { mailFehler } from "../community/glocke.ts";
import {
    COMMUNITY_MAIL_VERSAND_KIND,
    leseMailKonfiguration,
    type MailZugang,
} from "../community/mail/konfiguration.ts";
import { kopiereInGesendet, type GesendetKopie, type ImapAblageFabrik } from "../community/mail/gesendet-kopie.ts";
import { leseSchalterOderAn, stderrWarnung, trageLaufEin, type Warnung } from "../community/mail/routine.ts";
import {
    echterTransport,
    sendeMail,
    type AusgehendeMail,
    type TransportFabrik,
    type VersandLauf,
} from "../community/mail/versand.ts";
import { benachrichtigungUmgebung } from "./benachrichtigung-job.ts";
import { JobCancelled, JobFailure, JobStopped, type JobContext } from "./handlers.ts";
import { withJobDatabase } from "./job-database.ts";

/**
 * Die Jobart `community_mail_versand` (WI-0268 C6a; Fachkonzept WI-0263 §3.4, Bedienkonzept §3.3 bis §3.5): EINE ausgehende Mail senden. Die App reiht sie beim Anlegen einer Antwort per Mail oder einer neuen
 * Mail ein (`job_enqueue`, in derselben Transaktion), „Erneut senden“ reiht sie noch einmal ein. Eingabe `{ ausgang }`, die Kennung in `avesmaps_community.mail_ausgang`; sonst nichts, damit weder Empfänger noch Text
 * in der Tafel der Aufträge landen.
 *
 * - **Ablauf:** `community_mail_holen` reserviert die Mail (nur wenn sie wartet und gerade kein anderer Versuch läuft) und liefert, was zum Senden nötig ist; der Versand läuft über den Transport
 *   (`sendeMail`, in Tests ersetzt); `community_mail_zustellung` trägt den Ausgang ein. Die Jobs-Rolle hat an der Tafel kein Recht (`db/community-grants.psql`), nur an diesen zwei Funktionen.
 * - 🔴 **Nie doppelt senden:** Eine Mail, die nicht (mehr) wartet, wird übersprungen, der Job endet ohne Fehler. Zwei gleichzeitige Jobs für dieselbe Mail: Nur einer bekommt die Reservierung. Stirbt der Job
 *   nach dem Versand und vor dem Eintrag, sendet der nächste nach Ablauf der Reservierung noch einmal - dieselbe `Message-ID`, die der Empfänger als dieselbe Mail erkennt.
 * - **Vorübergehender Fehler:** höchstens drei Versuche mit Abstand (1 Minute, 5 Minuten): Der Job trägt den Fehlversuch ein und reiht sich mit `not_before` neu ein. Der dritte Fehlversuch und jeder dauerhafte
 *   Fehler (Anmeldung abgelehnt, Adresse abgelehnt) machen die Mail `fehler`, mit kurzem Grund ohne Geheimnis; die Glocke meldet es der Person, die sie schrieb.
 * - 🔴 **Nie Nutzer oder Kennwort in Ergebnis, Grund oder Protokoll:** Das Ergebnis des Jobs trägt Kennung, Zustand und Versuche, nie Adresse, Betreff oder Text.
 * - **Ohne Konfiguration** (die Umgebung des Ausführers hat die Angaben nicht) endet die Mail als `fehler` mit einem Satz, statt für immer zu warten.
 * - 🔴 **Der Schalter des Panels „Mailpostfach“** (WI-0268 C6c, `mail_routine`, Migration 0289) gilt zusätzlich zur Konfiguration und wird VOR `community_mail_holen` gelesen: Steht der Versand auf aus, reserviert der Job
 *   nichts, zählt keinen Versuch, die Mail bleibt `wartet`, und der Job endet ohne Fehler mit `{ ausgang, zurueckgehalten: true }`. Das Wiedereinschalten reiht jede wartende Mail neu ein (die Route). Kann der Schalter
 *   nicht gelesen werden (Funktion oder Recht fehlt), gilt „an“ wie bisher und eine Warnung nennt den SQLSTATE.
 * - Jeder Lauf, der etwas tat, trägt sein Ergebnis als Wort aus einer festen Liste ein (`community_mail_lauf`: `gesendet`, `anmeldung_abgelehnt`, `adresse_abgelehnt`, `gestoert`, `zugang_fehlt`, `zurueckgehalten`); ein
 *   übersprungener oder reservierter Lauf trägt nichts ein, weil nichts geschah. Scheitert das Eintragen, scheitert der Job nicht.
 * - **Die Kopie in „Gesendet“** (WI-0268 C6d, `community/mail/gesendet-kopie.ts`): nach dem Eintrag des Zustellstands und nur bei „gesendet“; ein Lauf, der nach dem Versand stirbt, legt deshalb keine zweite Kopie an. Scheitert sie,
 *   bleibt die Mail zugestellt: Der Lauf trägt `kopie_fehlt` bei seinen Zahlen, das Panel zeigt es. Ohne IMAP-Zugang gibt es keine Kopie und keinen Eintrag.
 */

export { COMMUNITY_MAIL_VERSAND_KIND };

/** Wie lange zwischen dem 1. und 2. und dem 2. und 3. Versuch gewartet wird (Millisekunden). */
export const MAIL_ABSTAENDE_MS: readonly number[] = [60_000, 300_000];

function ungueltig(grund: string): JobFailure {
    return new JobFailure("input_invalid", `Mailversand: ${grund}`, false);
}

/** Prüft die Eingabe streng: genau `{ ausgang: <positive ganze Zahl> }`. */
export function leseMailVersandAuftrag(input: Record<string, unknown>): { ausgang: number } {
    const unbekannt = Object.keys(input).filter((key) => key !== "ausgang");
    if (unbekannt.length > 0) throw ungueltig(`unbekanntes Feld ${unbekannt.join(", ")}`);
    const ausgang = input["ausgang"];
    if (typeof ausgang !== "number" || !Number.isSafeInteger(ausgang) || ausgang < 1)
        throw ungueltig('"ausgang" ist keine Kennung');
    return { ausgang };
}

interface Geholt {
    /** Die Mail wartet, aber ein anderer Versuch hält gerade die Reservierung (oder starb mitten im Versand): später noch einmal nachsehen. */
    reserviert?: true;
    ausgang: number;
    nummer: string;
    an: string | null;
    betreff: string;
    text: string | null;
    messageId: string;
    inReplyTo: string | null;
    references: string[];
    person: string | null;
    versuche: number;
    serie: number;
}

interface Zustellstand {
    zustand: "wartet" | "gesendet" | "fehler";
    versuche: number;
    serie: number;
    person: string | null;
    nummer: string;
}

export interface MailVersandAbhaengigkeiten {
    /** Die Datenbank des Auftrags (Jobs-Rolle); Tests geben ihre Verbindung. */
    database?: Queryable;
    environment?: NodeJS.ProcessEnv;
    /** Der Transport; Tests stellen ihn, damit nie eine echte Mail hinausgeht. */
    transport?: TransportFabrik;
    /** Der IMAP-Client der Kopie in „Gesendet“; Tests stellen ihn. Ohne Angabe der echte, und nur, wenn die Umgebung einen IMAP-Zugang hat. */
    kopie?: ImapAblageFabrik;
    /** Die Zeit; Tests frieren sie ein. */
    jetzt?: () => Date;
    /** Wohin eine Warnung geht (Schalter oder Lauf nicht lesbar bzw. eintragbar, nur der SQLSTATE); ohne Angabe stderr. */
    warnung?: Warnung;
}

async function holen(db: Queryable, ausgang: number): Promise<Geholt | null> {
    const [row] = await db<
        { mail: Geholt | null }[]
    >`SELECT avesmaps_community.community_mail_holen(${ausgang}::bigint) AS mail`;
    return row?.mail ?? null;
}

async function eintragen(
    db: Queryable,
    ausgang: number,
    ergebnis: "gesendet" | "vorlaeufig" | "fehler",
    grund: string | null,
): Promise<Zustellstand | null> {
    const [row] = await db<{ stand: Zustellstand | null }[]>`
        SELECT avesmaps_community.community_mail_zustellung(${ausgang}::bigint, ${ergebnis}, ${grund}) AS stand
    `;
    return row?.stand ?? null;
}

/** Reiht den nächsten Versuch ein (`job_enqueue`, SECURITY DEFINER; ohne Fußabdruck auf der Karte). */
async function reiheNachfolgerEin(db: Queryable, kontext: JobContext, ausgang: number, notBefore: Date): Promise<void> {
    const domain = kontext.job.mapDomainId;
    if (domain === null) throw new JobFailure("domain_missing", "Der Job nennt keine Kartendomäne", false);
    try {
        await db`
            SELECT public_id::text AS public_id
              FROM job_enqueue(
                       ${COMMUNITY_MAIL_VERSAND_KIND}, 1::smallint, ${domain}, 'community', ${db.json({ ausgang })}::jsonb, 50::smallint,
                       ${notBefore}::timestamptz, 'tiles', '{}'::smallint[]
                   )
        `;
    } catch (fehler) {
        // Das Einreihen scheiterte: Die Mail steht auf „wartet“, der Job läuft noch einmal (die Reservierung ist frei).
        void fehler;
        throw new JobFailure("einreihen_fehlgeschlagen", "Der nächste Versuch konnte nicht eingereiht werden", true);
    }
}

async function meldeFehler(db: Queryable, umgebung: string, stand: Zustellstand, ausgang: number): Promise<boolean> {
    try {
        await mailFehler(db, umgebung, { nummer: stand.nummer, ausgang, serie: stand.serie, person: stand.person });
        return true;
    } catch {
        // Die Glocke ist ein Hinweis, kein Protokoll: Scheitert sie, bleibt der Zustellstand die Wahrheit (der Verlauf zeigt „nicht zugestellt“).
        return false;
    }
}

/** Wie lange nach einer fremden Reservierung noch einmal nachgesehen wird: knapp nach ihrem Ablauf (3 Minuten). */
const NACHSEHEN_MS = 4 * 60_000;

async function laufe(
    db: Queryable,
    kontext: JobContext,
    deps: MailVersandAbhaengigkeiten,
): Promise<Record<string, unknown>> {
    const { ausgang } = leseMailVersandAuftrag(kontext.input);
    const warne = deps.warnung ?? stderrWarnung;
    await kontext.beginPhase("reservieren", 0);
    // Der Schalter des Panels (Migration 0289) vor der Reservierung: Aus heißt, dass die Mail unberührt wartet (kein Versuch, keine Reservierung).
    if (!(await leseSchalterOderAn(db, warne, "Mailversand")).versand) {
        await trageLaufEin(db, "versand", "zurueckgehalten", undefined, warne);
        return { ausgang, zurueckgehalten: true };
    }
    try {
        return await versende(db, kontext, deps, ausgang, warne);
    } catch (fehler) {
        // Ein Fehler der Datenbank mitten im Lauf; ein Fehler des Auftrags (Eingabe, Einreihen) und ein Abbruch tragen nichts ein.
        if (!(fehler instanceof JobFailure || fehler instanceof JobCancelled || fehler instanceof JobStopped))
            await trageLaufEin(db, "versand", "gestoert", undefined, warne);
        throw fehler;
    }
}

/** Das Wort des Panels zu einem Versuch, der nicht gesendet hat. */
function lauftypVorab(zugang: MailZugang | undefined, mail: Geholt): VersandLauf | "zugang_fehlt" {
    if (zugang === undefined) return "zugang_fehlt";
    return mail.an === null ? "adresse_abgelehnt" : "gestoert";
}

async function versende(
    db: Queryable,
    kontext: JobContext,
    deps: MailVersandAbhaengigkeiten,
    ausgang: number,
    warne: Warnung,
): Promise<Record<string, unknown>> {
    const jetzt = deps.jetzt ?? (() => new Date());
    const mail = await holen(db, ausgang);
    if (mail === null) return { ausgang, ergebnis: "uebersprungen" };
    if (mail.reserviert === true) {
        // Ein anderer Versuch hält die Mail (oder starb nach dem Versand, vor dem Eintrag): Nach Ablauf der Reservierung nachsehen. Ist sie dann erledigt, endet der nächste Job ohne Folgen.
        await reiheNachfolgerEin(db, kontext, ausgang, new Date(jetzt().getTime() + NACHSEHEN_MS));
        return { ausgang, ergebnis: "reserviert" };
    }

    const zugang: MailZugang | undefined = leseMailKonfiguration(deps.environment ?? process.env);
    let vorab: string | null = null;
    if (zugang === undefined) vorab = "Der Mailweg ist in dieser Umgebung nicht eingerichtet";
    else if (mail.an === null) vorab = "Die Adresse ist nicht mehr gespeichert";
    else if (mail.text === null || mail.text.trim() === "") vorab = "Der Text der Mail fehlt";
    let ergebnis: "gesendet" | "vorlaeufig" | "fehler";
    let grund: string | null = null;
    // Das Wort für das Panel, wenn dieser Versuch nicht gesendet hat.
    let lauf: VersandLauf | "zugang_fehlt" = "gestoert";
    // Die zugestellte Mail und das, womit sie ging: für die Kopie in „Gesendet“ nach dem Eintrag.
    let zugestellt: { zugang: MailZugang; mail: AusgehendeMail; datum: Date } | undefined;
    if (vorab !== null || zugang === undefined || mail.an === null || mail.text === null) {
        ergebnis = "fehler";
        grund = vorab ?? "Die Mail konnte nicht gesendet werden";
        lauf = lauftypVorab(zugang, mail);
    } else {
        await kontext.beginPhase("senden", 0.4);
        const transport = (deps.transport ?? echterTransport)(zugang);
        const datum = jetzt();
        const ausgehend: AusgehendeMail = {
            an: mail.an,
            betreff: mail.betreff,
            text: mail.text,
            messageId: mail.messageId,
            inReplyTo: mail.inReplyTo,
            references: mail.references,
            datum,
        };
        const zustellung = await sendeMail(transport, zugang, ausgehend);
        if (zustellung.ok) {
            ergebnis = "gesendet";
            zugestellt = { zugang, mail: ausgehend, datum };
        } else {
            ergebnis = zustellung.dauerhaft ? "fehler" : "vorlaeufig";
            grund = zustellung.grund;
            lauf = zustellung.lauf;
        }
    }
    await kontext.beginPhase("eintragen", 0.8);
    const ausgangStand = await eintragen(db, ausgang, ergebnis, grund);
    if (ausgangStand === null) return { ausgang, ergebnis: "uebersprungen" };
    // Erst nach dem Zustellstand: Die Mail ist zugestellt, was hier auch geschieht (WI-0268 C6d).
    let kopie: GesendetKopie = "aus";
    if (zugestellt !== undefined && ausgangStand.zustand === "gesendet") {
        await kontext.beginPhase("kopie", 0.9);
        kopie = await kopiereInGesendet({
            ...zugestellt,
            umgebung: deps.environment ?? process.env,
            fabrik: deps.kopie,
            warne,
        });
    }
    // Der Versuch hat etwas getan (gesendet oder nicht): als letzter Lauf eintragen, nach dem Zustellstand, damit ein Fehler dort den Eintrag nicht vorwegnimmt.
    await trageLaufEin(
        db,
        "versand",
        ergebnis === "gesendet" ? "gesendet" : lauf,
        kopie === "fehlt" ? { kopie_fehlt: 1 } : undefined,
        warne,
    );

    if (ausgangStand.zustand === "wartet") {
        // Ein vorübergehender Fehler mit Versuchen übrig: später noch einmal, mit Abstand.
        const abstand = MAIL_ABSTAENDE_MS[Math.min(ausgangStand.versuche - 1, MAIL_ABSTAENDE_MS.length - 1)] ?? 300_000;
        await reiheNachfolgerEin(db, kontext, ausgang, new Date(jetzt().getTime() + abstand));
        return { ausgang, zustand: "wartet", versuche: ausgangStand.versuche, naechsterVersuchInMs: abstand };
    }
    let gemeldet = false;
    if (ausgangStand.zustand === "fehler") {
        try {
            gemeldet = await meldeFehler(
                db,
                benachrichtigungUmgebung(deps.environment ?? process.env),
                ausgangStand,
                ausgang,
            );
        } catch {
            // Die Umgebung der Glocke ist unklar (AVESMAPS_ENV fehlt oder falsch): Der Zustellstand zeigt den Fehler trotzdem.
        }
    }
    return {
        ausgang,
        zustand: ausgangStand.zustand,
        versuche: ausgangStand.versuche,
        ...(kopie === "aus" ? {} : { kopie }),
        ...(ausgangStand.zustand === "fehler" ? { glocke: gemeldet } : {}),
    };
}

/** Der Handler im Job-Prozess. `deps` nur für Tests: die Testdatenbank, eine eigene Umgebung, ein gestellter Transport. */
export async function runCommunityMailVersandJob(
    kontext: JobContext,
    deps: MailVersandAbhaengigkeiten = {},
): Promise<Record<string, unknown>> {
    try {
        if (deps.database !== undefined) return await laufe(deps.database, kontext, deps);
        return await withJobDatabase((database) => laufe(database, kontext, deps));
    } catch (fehler) {
        if (fehler instanceof JobFailure) throw fehler;
        const code = (fehler as { code?: unknown }).code;
        // Nur der SQLSTATE geht auf die Statusseite, nie ein Text. Eine verlorene Verbindung ist wiederholbar, ein fehlendes Recht nicht.
        throw new JobFailure(
            "mail_versand_failed",
            `Mailversand gescheitert, SQLSTATE ${typeof code === "string" ? code : "unbekannt"}`,
            isDatabaseUnavailable(fehler),
        );
    }
}
