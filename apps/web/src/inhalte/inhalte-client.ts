import {
    INHALTE_KORPORA_URL,
    INHALTE_LITERATUR_URL,
    INHALTE_QUELLEN_ADRESSE_URL,
    INHALTE_QUELLEN_URL,
    INHALTE_REGELTEXT_PRUEFEN_URL,
    INHALTE_REGELTEXT_UEBERNEHMEN_URL,
    INHALTE_VORKOMMEN_FLAECHEN_URL,
    INHALTE_VORKOMMEN_ORTE_URL,
    INHALTE_VORKOMMEN_UMRISS_URL,
    INHALTE_VORKOMMEN_URL,
    INHALTE_VORKOMMEN_ZIELE_URL,
    INHALTE_ZIELE_URL,
    inhalteKorpusAendernUrl,
    inhalteKorpusUrl,
    inhalteKorpusWirkungUrl,
    inhalteQuelleAendernUrl,
    inhalteQuelleUrl,
    inhalteVorkommenAendernUrl,
    inhalteVorkommenAlsTextUrl,
    inhalteVorkommenUrl,
    inhalteWerkAendernUrl,
    inhalteWerkUrl,
    type InhalteKorporaAnfrage,
    type InhalteKorporaListe,
    type InhalteKorpusAendernBody,
    type InhalteKorpusAngelegt,
    type InhalteKorpusAnlegenBody,
    type InhalteKorpusEintrag,
    type InhalteKorpusWirkung,
    type InhalteKorpusWirkungBody,
    type InhalteQuelle,
    type InhalteQuelleAendernBody,
    type InhalteQuelleAngelegt,
    type InhalteAdressAuskunft,
    type InhalteQuelleAnlegenBody,
    type InhalteQuellenAnfrage,
    type InhalteQuellenListe,
    type InhalteRegelTextAlsText,
    type InhalteRegelTextErgebnis,
    type InhalteRegelTextPruefenBody,
    type InhalteRegelTextUebernehmenBody,
    type InhalteRegelTextUebernommen,
    type InhalteVorkommen,
    type InhalteVorkommenAendernBody,
    type InhalteVorkommenAngelegt,
    type InhalteVorkommenAnfrage,
    type InhalteVorkommenAnlegenBody,
    type InhalteVorkommenFlaechen,
    type InhalteVorkommenLageOrte,
    type InhalteVorkommenListe,
    type InhalteVorkommenUmriss,
    type InhalteVorkommenZiele,
    type InhalteWerk,
    type InhalteWerkAendernBody,
    type InhalteWerkAngelegt,
    type InhalteWerkAnlegenBody,
    type InhalteWerkListe,
    type InhalteWerkeAnfrage,
    type InhalteZiele,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { getJson, type Fetcher } from "../auth/api";
import { sende, type SchreibAntwort } from "../fenster/entwurf-senden";

/**
 * Der Weg des Fensters „Inhalte bearbeiten“ zum Server, Reiter „Quellen“, „Literatur“, „Vorkommen“ und „Korpora“ (WI-0254; Routen in `apps/server/src/routes/editor-inhalte.ts`).
 * Lesen mit `AbortSignal`: Ein jüngerer Wunsch (andere Suche, andere Quelle) bricht den älteren ab, statt dass eine späte Antwort ihn
 * überschreibt. Schreiben als `SchreibAntwort` (Quittung oder Fehler im Umschlag), wie jeder Entwurf der Editoren (`entwurf-senden.ts`).
 */
export interface InhalteClient {
    liste(anfrage: InhalteQuellenAnfrage, signal: AbortSignal): Promise<InhalteQuellenListe>;
    quelle(id: string, signal: AbortSignal): Promise<InhalteQuelle>;
    /** Träger zum Anhängen; mit `wege` auch Wege (je Straße ein Treffer, der Reiter „Quellen“). */
    ziele(text: string, signal: AbortSignal, optionen?: { wege?: boolean }): Promise<InhalteZiele>;
    /** Die Auskunft zu einem Link: Gibt es die Seite schon, welcher Korpus, welcher Titel (WI-0277)? */
    adresse(url: string, signal: AbortSignal): Promise<InhalteAdressAuskunft>;
    anlegen(body: InhalteQuelleAnlegenBody): Promise<SchreibAntwort<InhalteQuelleAngelegt>>;
    aendern(id: string, body: InhalteQuelleAendernBody): Promise<SchreibAntwort<OperationReceipt>>;
    werke(anfrage: InhalteWerkeAnfrage, signal: AbortSignal): Promise<InhalteWerkListe>;
    werk(id: string, signal: AbortSignal): Promise<InhalteWerk>;
    werkAnlegen(body: InhalteWerkAnlegenBody): Promise<SchreibAntwort<InhalteWerkAngelegt>>;
    werkAendern(id: string, body: InhalteWerkAendernBody): Promise<SchreibAntwort<OperationReceipt>>;
    vorkommen(anfrage: InhalteVorkommenAnfrage, signal: AbortSignal): Promise<InhalteVorkommenListe>;
    vorkommenEintrag(id: string, signal: AbortSignal): Promise<InhalteVorkommen>;
    vorkommenZiele(text: string, signal: AbortSignal): Promise<InhalteVorkommenZiele>;
    /** Flächen für die Bedingung einer Regel (Regeleditor): aktive Landschaften außerhalb der Klima-Ebene, nach Name. */
    vorkommenFlaechen(text: string, signal: AbortSignal): Promise<InhalteVorkommenFlaechen>;
    /** Orte (Siedlungen) für die Lage zu einer Linie in einer Bedingung; ohne Text die Metropolen und Großstädte. */
    vorkommenOrte(text: string, signal: AbortSignal): Promise<InhalteVorkommenLageOrte>;
    /** Der Umriss Aventuriens für die Skizze der Lage; der Server antwortet 404, wo es die Fläche „Aventurien“ nicht gibt. */
    vorkommenUmriss(signal: AbortSignal): Promise<InhalteVorkommenUmriss>;
    vorkommenAnlegen(body: InhalteVorkommenAnlegenBody): Promise<SchreibAntwort<InhalteVorkommenAngelegt>>;
    vorkommenAendern(id: string, body: InhalteVorkommenAendernBody): Promise<SchreibAntwort<OperationReceipt>>;
    /** „Regeln als Text“ (WI-0254 §13): den Text lesen und gegen den Katalog auflösen; schreibt nichts. */
    regelTextPruefen(body: InhalteRegelTextPruefenBody): Promise<SchreibAntwort<InhalteRegelTextErgebnis>>;
    /** „Regeln als Text“: was im Text „neu“ ist, in EINER Operation über alle Einträge anlegen; die Quittung trägt den Text, der stehen bleibt (`rest`). */
    regelTextUebernehmen(body: InhalteRegelTextUebernehmenBody): Promise<SchreibAntwort<InhalteRegelTextUebernommen>>;
    /** Der Rückweg „Als Text“: die aktiven Regeln eines Eintrags als Block der Kurzschrift. */
    vorkommenAlsText(id: string, signal: AbortSignal): Promise<InhalteRegelTextAlsText>;
    korpora(anfrage: InhalteKorporaAnfrage, signal: AbortSignal): Promise<InhalteKorporaListe>;
    korpus(id: string, signal: AbortSignal): Promise<InhalteKorpusEintrag>;
    korpusAnlegen(body: InhalteKorpusAnlegenBody): Promise<SchreibAntwort<InhalteKorpusAngelegt>>;
    /** „Wirkung prüfen“: rechnet, was die Felder bei den Quellen täten; schreibt nichts. */
    korpusWirkung(id: string, body: InhalteKorpusWirkungBody): Promise<SchreibAntwort<InhalteKorpusWirkung>>;
    korpusAendern(id: string, body: InhalteKorpusAendernBody): Promise<SchreibAntwort<OperationReceipt>>;
}

/** Wie viele Flächen die Suche für eine Bedingung höchstens holt; ist die Liste so lang, gibt es vermutlich weitere (der Server begrenzt auf 20). */
export const FLAECHEN_LIMIT = 12;

/** Wie viele Orte die Suche für die Lage höchstens holt; ist die Liste so lang, gibt es vermutlich weitere (der Server begrenzt auf 20). */
export const ORTE_LIMIT = 8;

/** Die Adresse der Ortssuche der Lage: ohne Text nur die Grenze, dann liefert der Server die Metropolen und Großstädte. */
export function orteAdresse(text: string): string {
    const q = text.trim();
    const parameter = new URLSearchParams();
    if (q !== "") parameter.set("q", q);
    parameter.set("limit", String(ORTE_LIMIT));
    return `${INHALTE_VORKOMMEN_ORTE_URL}?${parameter.toString()}`;
}

/** Die Adresse der Liste: nur gesetzte Werte, damit die Adresse kurz und die Vorgabe des Servers die Vorgabe bleibt. */
export function listenAdresse(anfrage: InhalteQuellenAnfrage): string {
    const parameter = new URLSearchParams();
    if (anfrage.q !== undefined && anfrage.q.trim() !== "") parameter.set("q", anfrage.q.trim());
    if (anfrage.offset !== undefined && anfrage.offset > 0) parameter.set("offset", String(anfrage.offset));
    if (anfrage.limit !== undefined) parameter.set("limit", String(anfrage.limit));
    if (anfrage.sort !== undefined && anfrage.sort !== "title") parameter.set("sort", anfrage.sort);
    if (anfrage.herkunft !== undefined) parameter.set("herkunft", anfrage.herkunft);
    if (anfrage.stand !== undefined && anfrage.stand !== "aktiv") parameter.set("stand", anfrage.stand);
    // WI-0287: das Umschlagbild je Treffer (die Suche der Publikationen einer Karte).
    if (anfrage.umschlag === true) parameter.set("umschlag", "true");
    const text = parameter.toString();
    return text === "" ? INHALTE_QUELLEN_URL : `${INHALTE_QUELLEN_URL}?${text}`;
}

/** Die Adresse der Liste der Werke: nur gesetzte Werte, wie bei den Quellen. */
export function werkeAdresse(anfrage: InhalteWerkeAnfrage): string {
    const parameter = new URLSearchParams();
    if (anfrage.q !== undefined && anfrage.q.trim() !== "") parameter.set("q", anfrage.q.trim());
    if (anfrage.offset !== undefined && anfrage.offset > 0) parameter.set("offset", String(anfrage.offset));
    if (anfrage.limit !== undefined) parameter.set("limit", String(anfrage.limit));
    if (anfrage.sort !== undefined && anfrage.sort !== "title") parameter.set("sort", anfrage.sort);
    if (anfrage.herkunft !== undefined) parameter.set("herkunft", anfrage.herkunft);
    if (anfrage.stand !== undefined && anfrage.stand !== "aktiv") parameter.set("stand", anfrage.stand);
    const text = parameter.toString();
    return text === "" ? INHALTE_LITERATUR_URL : `${INHALTE_LITERATUR_URL}?${text}`;
}

/** Die Adresse der Liste der Vorkommen: nur gesetzte Werte, wie bei den Quellen. */
export function vorkommenAdresse(anfrage: InhalteVorkommenAnfrage): string {
    const parameter = new URLSearchParams();
    if (anfrage.q !== undefined && anfrage.q.trim() !== "") parameter.set("q", anfrage.q.trim());
    if (anfrage.offset !== undefined && anfrage.offset > 0) parameter.set("offset", String(anfrage.offset));
    if (anfrage.limit !== undefined) parameter.set("limit", String(anfrage.limit));
    if (anfrage.sort !== undefined && anfrage.sort !== "title") parameter.set("sort", anfrage.sort);
    if (anfrage.herkunft !== undefined) parameter.set("herkunft", anfrage.herkunft);
    if (anfrage.stand !== undefined && anfrage.stand !== "aktiv") parameter.set("stand", anfrage.stand);
    if (anfrage.art !== undefined) parameter.set("art", anfrage.art);
    const text = parameter.toString();
    return text === "" ? INHALTE_VORKOMMEN_URL : `${INHALTE_VORKOMMEN_URL}?${text}`;
}

/** Die Adresse der Liste der Korpora: nur gesetzte Werte, wie bei den Quellen. */
export function korporaAdresse(anfrage: InhalteKorporaAnfrage): string {
    const parameter = new URLSearchParams();
    if (anfrage.q !== undefined && anfrage.q.trim() !== "") parameter.set("q", anfrage.q.trim());
    if (anfrage.offset !== undefined && anfrage.offset > 0) parameter.set("offset", String(anfrage.offset));
    if (anfrage.limit !== undefined) parameter.set("limit", String(anfrage.limit));
    if (anfrage.sort !== undefined && anfrage.sort !== "title") parameter.set("sort", anfrage.sort);
    if (anfrage.form !== undefined) parameter.set("form", anfrage.form);
    if (anfrage.herkunft !== undefined) parameter.set("herkunft", anfrage.herkunft);
    const text = parameter.toString();
    return text === "" ? INHALTE_KORPORA_URL : `${INHALTE_KORPORA_URL}?${text}`;
}

export function createInhalteClient(fetcher: Fetcher = (url, init) => fetch(url, init)): InhalteClient {
    const holen = <T>(url: string, signal: AbortSignal): Promise<T> =>
        getJson<T>(url, (ziel, init) => fetcher(ziel, { ...init, signal }));
    return {
        liste: (anfrage, signal) => holen(listenAdresse(anfrage), signal),
        quelle: (id, signal) => holen(inhalteQuelleUrl(id), signal),
        adresse: (url, signal) => holen(`${INHALTE_QUELLEN_ADRESSE_URL}?url=${encodeURIComponent(url)}`, signal),
        ziele: (text, signal, optionen) =>
            holen(
                `${INHALTE_ZIELE_URL}?q=${encodeURIComponent(text.trim())}&limit=8${optionen?.wege === true ? "&wege=true" : ""}`,
                signal,
            ),
        anlegen: (body) => sende<InhalteQuelleAngelegt>(INHALTE_QUELLEN_URL, body, "POST", fetcher),
        aendern: (id, body) => sende<OperationReceipt>(inhalteQuelleAendernUrl(id), body, "POST", fetcher),
        werke: (anfrage, signal) => holen(werkeAdresse(anfrage), signal),
        werk: (id, signal) => holen(inhalteWerkUrl(id), signal),
        werkAnlegen: (body) => sende<InhalteWerkAngelegt>(INHALTE_LITERATUR_URL, body, "POST", fetcher),
        werkAendern: (id, body) => sende<OperationReceipt>(inhalteWerkAendernUrl(id), body, "POST", fetcher),
        vorkommen: (anfrage, signal) => holen(vorkommenAdresse(anfrage), signal),
        vorkommenEintrag: (id, signal) => holen(inhalteVorkommenUrl(id), signal),
        vorkommenZiele: (text, signal) =>
            holen(`${INHALTE_VORKOMMEN_ZIELE_URL}?q=${encodeURIComponent(text.trim())}&limit=8`, signal),
        vorkommenFlaechen: (text, signal) =>
            holen(
                `${INHALTE_VORKOMMEN_FLAECHEN_URL}?q=${encodeURIComponent(text.trim())}&limit=${String(FLAECHEN_LIMIT)}`,
                signal,
            ),
        vorkommenOrte: (text, signal) => holen(orteAdresse(text), signal),
        vorkommenUmriss: (signal) => holen(INHALTE_VORKOMMEN_UMRISS_URL, signal),
        vorkommenAnlegen: (body) => sende<InhalteVorkommenAngelegt>(INHALTE_VORKOMMEN_URL, body, "POST", fetcher),
        vorkommenAendern: (id, body) => sende<OperationReceipt>(inhalteVorkommenAendernUrl(id), body, "POST", fetcher),
        regelTextPruefen: (body) =>
            sende<InhalteRegelTextErgebnis>(INHALTE_REGELTEXT_PRUEFEN_URL, body, "POST", fetcher),
        regelTextUebernehmen: (body) =>
            sende<InhalteRegelTextUebernommen>(INHALTE_REGELTEXT_UEBERNEHMEN_URL, body, "POST", fetcher),
        vorkommenAlsText: (id, signal) => holen(inhalteVorkommenAlsTextUrl(id), signal),
        korpora: (anfrage, signal) => holen(korporaAdresse(anfrage), signal),
        korpus: (id, signal) => holen(inhalteKorpusUrl(id), signal),
        korpusAnlegen: (body) => sende<InhalteKorpusAngelegt>(INHALTE_KORPORA_URL, body, "POST", fetcher),
        korpusWirkung: (id, body) => sende<InhalteKorpusWirkung>(inhalteKorpusWirkungUrl(id), body, "POST", fetcher),
        korpusAendern: (id, body) => sende<OperationReceipt>(inhalteKorpusAendernUrl(id), body, "POST", fetcher),
    };
}
