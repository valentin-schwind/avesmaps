import {
    COMMUNITY_URL,
    type AbschliessenBody,
    type AlsMeldungAntwort,
    type AlsMeldungBody,
    type AnKanalAntwort,
    type AnKanalBody,
    type CommunityPerson,
    type CommunityPrioritaet,
    type GesendetListe,
    type KorrekturKandidaten,
    type ListenAnfrageSegment,
    type MailWeg,
    type NeueMailAntwort,
    type NeueMailBody,
    type VorgangDetail,
    type VorgangListe,
    type VorgangQuittung,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import { withConfirmation } from "../auth/bestaetigen";
import type { MessageKey } from "../i18n/de";
import { FEHLER_SATZ, fehlerArt, type FehlerArt } from "./api";

/**
 * Die Redaktion der Meldungen an der Leitung (WI-0268 C3; Server: `apps/server/src/routes/community.ts`, Vertrag `packages/shared/src/community.ts`). Lesen: die Liste, ein Vorgang, die Personen.
 * Schritte: je ein Aufruf mit der Revision, die die Person gesehen hat (`baseRevision`); der Server lehnt einen veralteten Stand mit `community_conflict` ab, nie ein stilles Überschreiben.
 *
 * - 🔴 **Eine Kennung je Handlung** (ADR-0019): `kennung` gibt für denselben Schritt dieselbe `operationId` zurück, bis er gelungen ist oder der Server ihn abgelehnt hat; ein erneutes Senden nach einem
 *   Netzfehler legt nie zwei Einträge an.
 * - Der Fehler kommt als Fachcode, die Oberfläche wählt ihren Satz (`redaktionFehler`), nie den Text des Servers.
 */

export interface ListenFrage {
    readonly segment: ListenAnfrageSegment;
    readonly q?: string | undefined;
    /** Die Art der Vorgänge: Meldungen (Vorgabe) oder Anfragen (Reiter Mails, nur mit `read_mailbox`). */
    readonly art?: "meldung" | "anfrage" | undefined;
}

export function ladeListe(frage: ListenFrage, fetcher?: Fetcher): Promise<VorgangListe> {
    const parameter = new URLSearchParams({ segment: frage.segment, art: frage.art ?? "meldung" });
    const q = frage.q?.trim();
    if (q !== undefined && q !== "") parameter.set("q", q.slice(0, 100));
    return getJson<VorgangListe>(`${COMMUNITY_URL}/vorgaenge?${parameter.toString()}`, fetcher);
}

export const ladeVorgang = (nummer: string, fetcher?: Fetcher): Promise<VorgangDetail> =>
    getJson<VorgangDetail>(`${COMMUNITY_URL}/vorgaenge/${encodeURIComponent(nummer)}`, fetcher);

/** Wer zuständig sein kann; für eine Anfrage nur, wer Anfragen lesen darf (`mails`). */
export const ladePersonen = (mails = false, fetcher?: Fetcher): Promise<CommunityPerson[]> =>
    getJson<CommunityPerson[]>(`${COMMUNITY_URL}/personen${mails ? "?mails=true" : ""}`, fetcher);

/** Die ausgehenden Nachrichten der Anfragen (Reiter Mails › Gesendet, nur mit `read_mailbox`). */
export function ladeGesendet(q?: string, fetcher?: Fetcher): Promise<GesendetListe> {
    const suche = q?.trim();
    const parameter = suche === undefined || suche === "" ? "" : `?q=${encodeURIComponent(suche.slice(0, 100))}`;
    return getJson<GesendetListe>(`${COMMUNITY_URL}/gesendet${parameter}`, fetcher);
}

// --- Schritte --------------------------------------------------------------------------------------------------------------

/** Die Schritte ohne weitere Angabe und die mit einer (Adresse hinter `/vorgaenge/:com/`). */
export type Schritt =
    | "sichten"
    | "uebernehmen"
    | "archivieren"
    | "papierkorb"
    | "wiederherstellen"
    | "prioritaet"
    | "zustaendig"
    | "rollen"
    | "notiz"
    | "rueckfrage"
    | "abschliessen"
    | "wiedereroeffnen"
    | "personenbezug-loeschen"
    | "antworten"
    | "ins-archiv"
    | "zurueck-in-eingang"
    | "erneut-senden"
    | "als-meldung"
    | "korrektur"
    | "an-kanal";

const adresse = (nummer: string, schritt: Schritt): string =>
    `${COMMUNITY_URL}/vorgaenge/${encodeURIComponent(nummer)}/${schritt}`;

/** Die Kennungen der Handlungen, die noch keinen Abschluss haben: derselbe Schritt am selben Vorgang schickt dieselbe. */
const offeneKennungen = new Map<string, string>();

export function kennung(nummer: string, schritt: Schritt): string {
    const schluessel = `${nummer}/${schritt}`;
    let id = offeneKennungen.get(schluessel);
    if (id === undefined) {
        id = newOperationId();
        offeneKennungen.set(schluessel, id);
    }
    return id;
}

/** Die Handlung ist durch (gelungen oder vom Server abgelehnt): Die nächste bekommt eine neue Kennung. */
export const kennungFrei = (nummer: string, schritt: Schritt): void => {
    offeneKennungen.delete(`${nummer}/${schritt}`);
};

/**
 * Führt einen Schritt aus. Ein Netzfehler lässt die Kennung stehen (das erneute Senden ist gefahrlos), jede andere Antwort gibt sie frei.
 * `bestaetigen`: „Personenbezug löschen“ verlangt einen frischen Passkey; der Server sagt es, und die Oberfläche fragt nach und wiederholt einmal (`withConfirmation`).
 */
export async function fuehreAus<T = VorgangQuittung>(
    nummer: string,
    schritt: Schritt,
    body: Record<string, unknown>,
    optionen: { fetcher?: Fetcher; bestaetigen?: boolean } = {},
): Promise<T> {
    const sende = (): Promise<T> =>
        postJson<T>(adresse(nummer, schritt), { operationId: kennung(nummer, schritt), ...body }, optionen.fetcher);
    try {
        const antwort = optionen.bestaetigen === true ? await withConfirmation(sende) : await sende();
        kennungFrei(nummer, schritt);
        return antwort;
    } catch (fehler) {
        if (fehlerArt(fehler) !== "netz") kennungFrei(nummer, schritt);
        throw fehler;
    }
}

export const sichten = (nummer: string, baseRevision: number): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "sichten", { baseRevision });
export const uebernehmen = (nummer: string, baseRevision: number): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "uebernehmen", { baseRevision });
export const archivieren = (nummer: string, baseRevision: number): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "archivieren", { baseRevision });
export const papierkorb = (nummer: string, baseRevision: number): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "papierkorb", { baseRevision });
export const wiederherstellen = (nummer: string, baseRevision: number): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "wiederherstellen", { baseRevision });
export const setzePrioritaet = (
    nummer: string,
    baseRevision: number,
    prioritaet: CommunityPrioritaet,
): Promise<VorgangQuittung> => fuehreAus(nummer, "prioritaet", { baseRevision, prioritaet });
export const setzeZustaendig = (
    nummer: string,
    baseRevision: number,
    person: string | null,
): Promise<VorgangQuittung> => fuehreAus(nummer, "zustaendig", { baseRevision, person });
/** Die ganze Menge der Sonderrollen einer Meldung (WI-0279): hinzu und heraus in einem Schritt. */
export const setzeRollen = (
    nummer: string,
    baseRevision: number,
    rollen: readonly string[],
): Promise<VorgangQuittung> => fuehreAus(nummer, "rollen", { baseRevision, rollen: [...rollen] });
/** Notizen prüfen keine Revision: Sie hängen nur an. */
export const schreibeNotiz = (nummer: string, text: string): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "notiz", { text });
export const sendeRueckfrage = (nummer: string, baseRevision: number, text: string): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "rueckfrage", { baseRevision, text });
export const schliesseAb = (
    nummer: string,
    baseRevision: number,
    abschluss: Omit<AbschliessenBody, "operationId" | "baseRevision">,
): Promise<VorgangQuittung> => fuehreAus(nummer, "abschliessen", { baseRevision, ...abschluss });
export const oeffneWieder = (nummer: string, baseRevision: number, grund: string): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "wiedereroeffnen", { baseRevision, grund });
// --- Mails (WI-0268 C4) ---------------------------------------------------------------------------------------------------

/**
 * Antworten, als Mail oder auf die Statusseite (`weg`; ohne Angabe wählt der Server: Mail, wenn der Mailweg an ist und der Absender eine Adresse hat); mit `archivieren` kommt die Anfrage ins Archiv, bei einer
 * Mail erst nach der Annahme durch den Mailserver. Braucht `answer_community`.
 */
export const antworteAnfrage = (
    nummer: string,
    baseRevision: number,
    text: string,
    archivieren: boolean,
    weg?: MailWeg,
): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "antworten", { baseRevision, text, archivieren, ...(weg === undefined ? {} : { weg }) });

/** Erneut senden (WI-0268 C6a): eine nicht zugestellte Mail noch einmal in den Versand. Braucht `answer_community`. */
export async function sendeErneut(nummer: string, nachricht: number, fetcher?: Fetcher): Promise<VorgangQuittung> {
    const schluessel = `${nummer}#${String(nachricht)}`;
    try {
        const antwort = await postJson<VorgangQuittung>(
            `${COMMUNITY_URL}/vorgaenge/${encodeURIComponent(nummer)}/nachrichten/${String(nachricht)}/erneut-senden`,
            { operationId: kennung(schluessel, "erneut-senden") },
            fetcher,
        );
        kennungFrei(schluessel, "erneut-senden");
        return antwort;
    } catch (fehler) {
        if (fehlerArt(fehler) !== "netz") kennungFrei(schluessel, "erneut-senden");
        throw fehler;
    }
}

/**
 * Eine neue Mail an eine freie Adresse (WI-0268 C6a, `send_new_mail`). Die Kennung gehört dem Fenster, nicht dem Aufruf: Sendet jemand nach einem Netzfehler noch einmal, trägt es dieselbe und legt nie zwei
 * Mails an (ADR-0019).
 */
export const sendeNeueMail = (body: NeueMailBody, fetcher?: Fetcher): Promise<NeueMailAntwort> =>
    postJson<NeueMailAntwort>(`${COMMUNITY_URL}/mails`, body, fetcher);
/** Ins Archiv: ein Klick, ohne Begründung. */
export const insArchiv = (nummer: string, baseRevision: number): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "ins-archiv", { baseRevision });
/** Zurück in den Eingang: aus dem Archiv, ohne Grund. */
export const zurueckInEingang = (nummer: string, baseRevision: number): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "zurueck-in-eingang", { baseRevision });
/** Als Meldung weiterführen: legt die Meldung an und beendet die Anfrage; die Antwort nennt die neue Nummer. */
export const fuehreAlsMeldungWeiter = (
    nummer: string,
    baseRevision: number,
    body: Omit<AlsMeldungBody, "operationId" | "baseRevision">,
): Promise<AlsMeldungAntwort> => fuehreAus<AlsMeldungAntwort>(nummer, "als-meldung", { baseRevision, ...body });

// --- Verknüpfungen (WI-0268 C7) -------------------------------------------------------------------------------------------

/** Die Änderungen an der Karte, aus denen „Korrektur verknüpfen“ wählt: am Bezugsobjekt, sonst die eigenen. */
export const ladeKorrekturKandidaten = (nummer: string, fetcher?: Fetcher): Promise<KorrekturKandidaten> =>
    getJson<KorrekturKandidaten>(
        `${COMMUNITY_URL}/vorgaenge/${encodeURIComponent(nummer)}/korrektur-kandidaten`,
        fetcher,
    );
/** Eine Änderung aus „Änderungen“ (Kennung der Operation) gehört zu diesem Vorgang. Wiederholen ändert nichts; der Vorgang behält Zustand und Revision. */
export const verknuepfeKorrektur = (nummer: string, ziel: string): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "korrektur", { ziel });
/** Im Betreiber-Kanal der eigenen Umgebung einen Vorgang anlegen und als OPS-Nummer verknüpfen (braucht `use_operator_channel`). */
export const reicheAnKanalWeiter = (nummer: string, body: Omit<AnKanalBody, "operationId">): Promise<AnKanalAntwort> =>
    fuehreAus<AnKanalAntwort>(nummer, "an-kanal", { ...body });

/** Datenschutzanfrage (Fachkonzept §10.4): braucht keinen Rumpf außer der Kennung, aber einen frischen Passkey. */
export const loeschePersonenbezug = (nummer: string): Promise<VorgangQuittung> =>
    fuehreAus(nummer, "personenbezug-loeschen", {}, { bestaetigen: true });

// --- Fehler in der Sprache der Oberfläche ----------------------------------------------------------------------------------

/**
 * Was bei einem Schritt oder Laden schiefging:
 * - `konflikt`: 409 `community_conflict`, jemand hat den Vorgang inzwischen geändert; er wird neu geladen, die Eingabe bleibt.
 * - `uebergang`: 409 `community_transition`, dieser Schritt geht in diesem Zustand nicht (mehr).
 * - `verboten`: 403, das Recht fehlt.
 * - sonst wie bei den Besuchern (`api.ts`): Netz, Drossel, nicht eingerichtet, ungültig, nicht gefunden.
 * Den genauen Satz dazu sagt `redaktionSatz` (`redaktion-ablehnung.ts`); `REDAKTION_FEHLER_SATZ` ist der Rückfall, wenn der Server keinen Grund nennt.
 */
export type RedaktionFehler = FehlerArt | "konflikt" | "uebergang" | "verboten" | "mail_grenze";

export function redaktionFehler(fehler: unknown): RedaktionFehler {
    if (fehler instanceof ApiFailure) {
        if (fehler.code === "community_conflict") return "konflikt";
        if (fehler.code === "community_transition") return "uebergang";
        if (fehler.code === "community_mail_grenze") return "mail_grenze";
        if (fehler.code === "community_forbidden" || fehler.status === 403) return "verboten";
    }
    return fehlerArt(fehler);
}

export const REDAKTION_FEHLER_SATZ: Readonly<Record<RedaktionFehler, MessageKey>> = {
    ...FEHLER_SATZ,
    // WI-0291: Der Sammelsatz der Besucher („Beschreibung, Quelle und Name prüfen“) nennt Felder, die es in der Redaktion nicht gibt.
    ungueltig: "community.redaktion.ablehnung.ungueltig",
    nicht_gefunden: "community.redaktion.fehler.nichtGefunden",
    konflikt: "community.redaktion.fehler.konflikt",
    uebergang: "community.redaktion.fehler.uebergang",
    verboten: "community.redaktion.fehler.verboten",
    mail_grenze: "community.redaktion.fehler.mailGrenze",
};
