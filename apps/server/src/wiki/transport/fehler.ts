/**
 * Der Fehler des Wiki-Transports (WI-0253 B-1). Jede Absage trägt einen festen `code`, damit Aufrufer entscheiden können, ohne den Text zu
 * lesen, und sagt, ob ein späterer Versuch Sinn hat. 🔴 Weder Text noch Felder tragen je Zugangsdaten, Cookies oder die Antwort des Wikis im
 * Ganzen; `apiCode` und `apiInfo` sind die kurzen Angaben aus dem `error`-Objekt der API.
 */

export const WIKI_TRANSPORT_CODES = [
    /** Die harte Sperre (`wikiAbrufErlaubt`): Umgebung, Release oder Takt-Ordner stimmen nicht, ein echter Client entsteht nicht. */
    "abruf_gesperrt",
    /** Der Ort des Takts ist nicht eingerichtet oder nicht beschreibbar: nichts geht hinaus. */
    "takt_nicht_nutzbar",
    /** Die Sperre um den Takt war nicht zu bekommen (anderer Prozess hängt). */
    "takt_sperre",
    /** Nicht wartender Zweig: der Platz ist belegt. */
    "belegt",
    /** Eine Pause gilt (403, 429, Unterbrecher); `bis` nennt das Ende. */
    "pausiert",
    "http_403",
    "http_429",
    "http_fehler",
    "verbindung",
    "antwort_ungueltig",
    "api_fehler",
    "api_zu_viele_werte",
    "anmeldung_verloren",
    "url_zu_lang",
    "abgebrochen",
] as const;
export type WikiTransportCode = (typeof WIKI_TRANSPORT_CODES)[number];

export interface WikiTransportFehlerAngaben {
    /** Der HTTP-Status, wenn es einen gab. */
    status?: number | undefined;
    apiCode?: string | undefined;
    apiInfo?: string | undefined;
    /** Ende der Pause oder des Wartens (Unix-Millisekunden). */
    bis?: number | undefined;
    wiederholbar?: boolean | undefined;
}

export class WikiTransportFehler extends Error {
    readonly code: WikiTransportCode;
    readonly status: number | undefined;
    readonly apiCode: string | undefined;
    readonly apiInfo: string | undefined;
    readonly bis: number | undefined;
    /** Lohnt ein späterer Versuch (Pause vorbei, Platz frei, Wiki wieder da)? */
    readonly wiederholbar: boolean;

    constructor(code: WikiTransportCode, message: string, angaben: WikiTransportFehlerAngaben = {}) {
        super(message);
        this.name = "WikiTransportFehler";
        this.code = code;
        this.status = angaben.status;
        this.apiCode = angaben.apiCode;
        this.apiInfo = angaben.apiInfo;
        this.bis = angaben.bis;
        this.wiederholbar = angaben.wiederholbar ?? false;
    }
}
