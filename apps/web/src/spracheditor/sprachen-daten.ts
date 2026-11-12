import {
    EDITOR_SPRACHEN_ARTIKEL_URL,
    EDITOR_SPRACHEN_AUS_LANDSCHAFT_URL,
    EDITOR_SPRACHEN_URL,
    SPRACHE_ARTIKEL_MAX,
    editorSpracheAendernUrl,
    editorSpracheFlaecheBooleanUrl,
    editorSpracheFlaecheBooleanVorschauUrl,
    editorSpracheFlaecheKopierenUrl,
    editorSpracheFlaecheSchneidenUrl,
    editorSpracheFlaecheTeileUrl,
    editorSpracheFlaecheStilllegenUrl,
    editorSpracheFlaecheUmformenUrl,
    editorSpracheFlaechePinselUrl,
    editorSpracheFlaecheUrl,
    editorSpracheFlaecheZurueckholenUrl,
    editorSpracheFlaechenUrl,
    editorSpracheStilllegenUrl,
    editorSpracheTrefferUrl,
    editorSpracheUrl,
    editorSpracheWikiUrl,
    editorSpracheZurueckholenUrl,
    type OperationReceipt,
    type PinselErgebnis,
    type PinselStrich,
    type SpracheAendernBody,
    type SpracheAngelegt,
    type SpracheAnlegenBody,
    type SpracheAusLandschaftBody,
    type SpracheEditorArtikelListe,
    type SpracheEditorDetail,
    type SpracheEditorFlaecheForm,
    type SpracheEditorListe,
    type SpracheFlaecheAngelegt,
    type SpracheFlaecheAnlegenBody,
    type SpracheFlaecheBooleanBody,
    type SpracheFlaecheBooleanVorschau,
    type SpracheFlaecheBooleanVorschauBody,
    type SpracheFlaecheKopierenBody,
    type SpracheFlaecheNeuQuittung,
    type SpracheFlaecheSchneidenBody,
    type SpracheFlaecheTeileBody,
    type SpracheFlaecheTeileQuittung,
    type SpracheFlaecheUmformenBody,
    type SpracheStandBody,
    type SpracheTrefferAuftrag,
    type SpracheWikiBody,
} from "@avesmaps3d/shared";
import { ApiFailure, type Fetcher } from "../auth/api";
import { sende, type SchreibAntwort } from "../fenster/entwurf-senden";

/**
 * Der Weg des Spracheditors zum Server (WI-0261 S5d2; Vertrag `packages/shared/src/sprachen-editor.ts`, Routen
 * `apps/server/src/routes/editor-sprachen.ts`). Lesen wirft `ApiFailure` (wie die Listen der übrigen Editoren), Schreiben antwortet im
 * Umschlag (`entwurf-senden.ts`), damit ein Entwurf bei 409 und 423 stehen bleibt.
 *
 * - Die Liste kommt immer MIT den stillgelegten Sprachen (`?stillgelegt=true`): Der Trichter zeigt sie unter „Stand“, und ein Zurückholen
 *   braucht ihre Zeile. Sie sind wenige (eine Zeile je Kartengruppe, O1), das lohnt keinen zweiten Weg.
 * - Die Liste mit `no-cache` (schwaches ETag, 304 aus dem Browser), alles Übrige `no-store` wie die Formen der anderen Editoren.
 */

export interface SprachenDaten {
    liste(signal: AbortSignal): Promise<SpracheEditorListe>;
    /** `null`: Die Sprache gibt es nicht. `run`: der Lauf der Sperre, damit `sperre.own` stimmt. */
    sprache(id: string, signal: AbortSignal, run?: string): Promise<SpracheEditorDetail | null>;
    form(id: string, flaeche: string, signal: AbortSignal): Promise<SpracheEditorFlaecheForm | null>;
    artikel(q: string, signal: AbortSignal): Promise<SpracheEditorArtikelListe>;
    legeAn(body: SpracheAnlegenBody): Promise<SchreibAntwort<SpracheAngelegt>>;
    aendere(id: string, body: SpracheAendernBody): Promise<SchreibAntwort>;
    setzeWiki(id: string, body: SpracheWikiBody): Promise<SchreibAntwort>;
    stilllegen(id: string, body: SpracheStandBody): Promise<SchreibAntwort>;
    zurueckholen(id: string, body: SpracheStandBody): Promise<SchreibAntwort>;
    neuRechnen(id: string): Promise<SchreibAntwort<SpracheTrefferAuftrag>>;
    flaecheAnlegen(id: string, body: SpracheFlaecheAnlegenBody): Promise<SchreibAntwort<SpracheFlaecheAngelegt>>;
    flaecheUmformen(id: string, flaeche: string, body: SpracheFlaecheUmformenBody): Promise<SchreibAntwort>;
    /** Ein Strich des Pinsels an der Teilfläche (WI-0261 Stufe 2): gerechnet, nichts geschrieben; im Umschlag wie das Schreiben. */
    flaechePinsel(id: string, flaeche: string, body: PinselStrich): Promise<SchreibAntwort<PinselErgebnis>>;
    flaecheStilllegen(id: string, flaeche: string, body: SpracheStandBody): Promise<SchreibAntwort>;
    flaecheZurueckholen(id: string, flaeche: string, body: SpracheStandBody): Promise<SchreibAntwort>;
    /** „Unterflächen ›“ an der Teilfläche (WI-0261 Stufe 3): vereinigen, herauslösen, löschen; sofort geschrieben. */
    flaecheTeile(
        id: string,
        flaeche: string,
        body: SpracheFlaecheTeileBody,
    ): Promise<SchreibAntwort<SpracheFlaecheTeileQuittung>>;
    /** „Zerschneiden“ (Stufe 3): sofort geschrieben; die Quittung nennt die neue Teilfläche. */
    flaecheSchneiden(
        id: string,
        flaeche: string,
        body: SpracheFlaecheSchneidenBody,
    ): Promise<SchreibAntwort<SpracheFlaecheNeuQuittung>>;
    /** „Mit anderer Fläche“ rechnen (Stufe 3), nichts geschrieben; abgebrochen kommt es wie ohne Verbindung zurück (Status 0). */
    flaecheVorschau(
        id: string,
        flaeche: string,
        body: SpracheFlaecheBooleanVorschauBody,
        signal: AbortSignal,
    ): Promise<SchreibAntwort<SpracheFlaecheBooleanVorschau>>;
    /** „Mit anderer Fläche“ (Stufe 3): sofort geschrieben. */
    flaecheVerknuepfen(id: string, flaeche: string, body: SpracheFlaecheBooleanBody): Promise<SchreibAntwort>;
    /** „Kopieren …“ einer Fläche der Derographie in eine Sprache (`sprache.flaeche_aus_landschaft`): die Quittung nennt die neue Teilfläche und ihre Sprache. */
    ausLandschaft(body: SpracheAusLandschaftBody): Promise<SchreibAntwort<SpracheFlaecheNeuQuittung>>;
    /** „Kopieren …“ (Stufe 3): die Kopie in einer anderen Sprache; die Quittung nennt sie. */
    flaecheKopieren(
        id: string,
        flaeche: string,
        body: SpracheFlaecheKopierenBody,
    ): Promise<SchreibAntwort<SpracheFlaecheNeuQuittung>>;
}

/** Ein Lesen mit dem Fehler im Umschlag als `ApiFailure`; 404 ist `null`, wo der Aufrufer es erlaubt. */
async function lies<T>(
    url: string,
    signal: AbortSignal,
    fetcher: Fetcher,
    cache: RequestCache,
    fehlt: "null" | "fehler",
): Promise<T | null> {
    let antwort: Response;
    try {
        antwort = await fetcher(url, {
            method: "GET",
            headers: { accept: "application/json" },
            credentials: "same-origin",
            cache,
            signal,
        });
    } catch (error) {
        if (signal.aborted) throw error;
        throw new ApiFailure(0, "network", "Keine Verbindung zum Server.");
    }
    if (antwort.status === 404 && fehlt === "null") return null;
    const body = (await antwort.json().catch(() => undefined)) as unknown;
    if (antwort.ok) return body as T;
    const fehler = (body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
    throw new ApiFailure(
        antwort.status,
        typeof fehler?.code === "string" ? fehler.code : antwort.status >= 500 ? "unavailable" : "failed",
        typeof fehler?.message === "string" ? fehler.message : antwort.statusText,
    );
}

/** Die Liste vom Server, mit den stillgelegten Sprachen. */
export async function ladeSprachen(
    signal: AbortSignal,
    fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<SpracheEditorListe> {
    const liste = await lies<SpracheEditorListe>(
        `${EDITOR_SPRACHEN_URL}?stillgelegt=true`,
        signal,
        fetcher,
        "no-cache",
        "fehler",
    );
    return liste!;
}

export function createSprachenDaten(fetcher: Fetcher = (url, init) => fetch(url, init)): SprachenDaten {
    const schreib = <Q = OperationReceipt>(url: string, body: unknown): Promise<SchreibAntwort<Q>> =>
        sende<Q>(url, body, "POST", (eingabe, init) => fetcher(eingabe, init));
    return {
        liste: (signal) => ladeSprachen(signal, fetcher),
        sprache: (id, signal, run) =>
            lies<SpracheEditorDetail>(
                run === undefined ? editorSpracheUrl(id) : `${editorSpracheUrl(id)}?run=${encodeURIComponent(run)}`,
                signal,
                fetcher,
                "no-store",
                "null",
            ),
        form: (id, flaeche, signal) =>
            lies<SpracheEditorFlaecheForm>(editorSpracheFlaecheUrl(id, flaeche), signal, fetcher, "no-store", "null"),
        async artikel(q, signal) {
            const suche = new URLSearchParams({ limit: String(SPRACHE_ARTIKEL_MAX) });
            if (q.trim() !== "") suche.set("q", q.trim().slice(0, 100));
            const liste = await lies<SpracheEditorArtikelListe>(
                `${EDITOR_SPRACHEN_ARTIKEL_URL}?${suche.toString()}`,
                signal,
                fetcher,
                "no-store",
                "fehler",
            );
            return liste!;
        },
        legeAn: (body) => schreib<SpracheAngelegt>(EDITOR_SPRACHEN_URL, body),
        aendere: (id, body) => schreib(editorSpracheAendernUrl(id), body),
        setzeWiki: (id, body) => schreib(editorSpracheWikiUrl(id), body),
        stilllegen: (id, body) => schreib(editorSpracheStilllegenUrl(id), body),
        zurueckholen: (id, body) => schreib(editorSpracheZurueckholenUrl(id), body),
        neuRechnen: (id) => schreib<SpracheTrefferAuftrag>(editorSpracheTrefferUrl(id), {}),
        flaecheAnlegen: (id, body) => schreib<SpracheFlaecheAngelegt>(editorSpracheFlaechenUrl(id), body),
        flaecheUmformen: (id, flaeche, body) => schreib(editorSpracheFlaecheUmformenUrl(id, flaeche), body),
        flaechePinsel: (id, flaeche, body) => schreib<PinselErgebnis>(editorSpracheFlaechePinselUrl(id, flaeche), body),
        flaecheStilllegen: (id, flaeche, body) => schreib(editorSpracheFlaecheStilllegenUrl(id, flaeche), body),
        flaecheZurueckholen: (id, flaeche, body) => schreib(editorSpracheFlaecheZurueckholenUrl(id, flaeche), body),
        flaecheTeile: (id, flaeche, body) =>
            schreib<SpracheFlaecheTeileQuittung>(editorSpracheFlaecheTeileUrl(id, flaeche), body),
        flaecheSchneiden: (id, flaeche, body) =>
            schreib<SpracheFlaecheNeuQuittung>(editorSpracheFlaecheSchneidenUrl(id, flaeche), body),
        flaecheVorschau: (id, flaeche, body, signal) =>
            sende<SpracheFlaecheBooleanVorschau>(
                editorSpracheFlaecheBooleanVorschauUrl(id, flaeche),
                body,
                "POST",
                (eingabe, init) => fetcher(eingabe, init),
                signal,
            ),
        flaecheVerknuepfen: (id, flaeche, body) => schreib(editorSpracheFlaecheBooleanUrl(id, flaeche), body),
        ausLandschaft: (body) => schreib<SpracheFlaecheNeuQuittung>(EDITOR_SPRACHEN_AUS_LANDSCHAFT_URL, body),
        flaecheKopieren: (id, flaeche, body) =>
            schreib<SpracheFlaecheNeuQuittung>(editorSpracheFlaecheKopierenUrl(id, flaeche), body),
    };
}

/** Die Revision der Sprache aus einer Quittung (`affected`), damit ein zweiter Schreibweg gegen sie geht. */
export function revisionDerSprache(quittung: OperationReceipt, id: string): number | undefined {
    return quittung.affected.find((eines) => eines.kind === "sprache" && eines.id === id)?.revision;
}
