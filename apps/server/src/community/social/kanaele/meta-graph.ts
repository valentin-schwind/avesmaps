import type { MetaZugang } from "./konfiguration.ts";

/**
 * Der gemeinsame Aufruf der Graph-Schnittstelle von Meta für Facebook und Instagram (WI-0268 C12b; Fachkonzept §15.7). Nur `facebook.ts` und `instagram.ts` rufen ihn; er kennt keine Datenbank.
 *
 * - 🔴 **Nie ein echter Aufruf im Test:** Alles geht durch `deps.fetch`; Tests stellen die Schnittstelle (`apps/server/test/support/meta-graph.ts`).
 * - 🔴 **Grenzen des Aufrufs (wie Mastodon):** Zeitgrenze je Aufruf (15 s), kein Folgen von Weiterleitungen (`redirect: "manual"`), Antwort höchstens 1 MB, Pfade nur in der Form, die `MetaZugang.adresse` zulässt.
 * - 🔴 **Fehlertexte ohne Zugangsschlüssel:** Jeder Text ist ein fester Satz mit dem Code der Antwort und dem Code von Meta; nur bei einer Ablehnung des Beitrags (HTTP 400) kommt ein gekürzter, bereinigter Auszug
 *   der Meldung von Meta dazu (`entschaerfe` nimmt den Schlüssel heraus). Der Schlüssel geht als Kopfzeile `Authorization: Bearer`, nie in die Adresse.
 * - 🔴 **Meta kennt keinen Idempotenz-Kopf.** Wiederholungen schützt der Auftrag (Reservierung der Sendung, Kennung `extern_id`, bei Instagram die Kennung des Containers), nicht dieser Aufruf.
 */

export interface GraphDeps {
    /** Der Aufruf; Tests stellen die Schnittstelle, damit nie ein echter Aufruf hinausgeht. */
    fetch?: typeof globalThis.fetch;
    /** Zeitgrenze je Aufruf in Millisekunden. */
    timeoutMs?: number;
    /** Wartet; Tests ersetzen es. */
    warte?: (ms: number) => Promise<void>;
}

export const GRAPH_ZEITGRENZE_MS = 15_000;
const ANTWORT_MAX = 1_000_000;

/** Ein Fehler eines Meta-Kanals mit kurzem Satz. `dauerhaft` heißt: ein neuer Versuch ändert nichts (Schlüssel abgelehnt, Beitrag abgelehnt); sonst lohnt es sich später noch einmal. */
export class MetaFehler extends Error {
    readonly dauerhaft: boolean;
    readonly status: number | undefined;
    /** Der Fehlercode von Meta (`error.code`), falls die Antwort einen nannte. */
    readonly code: number | undefined;

    constructor(satz: string, dauerhaft: boolean, status?: number, code?: number) {
        super(satz);
        this.name = "MetaFehler";
        this.dauerhaft = dauerhaft;
        this.status = status;
        this.code = code;
    }
}

export interface GraphAntwort {
    readonly status: number;
    readonly json: unknown;
}

export interface GraphAufruf {
    readonly methode: "GET" | "POST" | "DELETE";
    readonly pfad: string;
    readonly abfrage?: Readonly<Record<string, string>>;
    /** Felder eines POST: als Formular (`application/x-www-form-urlencoded`) oder, mit einer Datei, als `FormData`. */
    readonly felder?: Readonly<Record<string, string>> | FormData;
}

// eslint-disable-next-line no-control-regex
const STEUERZEICHEN = /[\u0000-\u001f\u007f]/gu;

export const istObjekt = (wert: unknown): wert is Record<string, unknown> =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert);

const zahl = (wert: unknown): number | undefined =>
    typeof wert === "number" && Number.isSafeInteger(wert) ? wert : undefined;

/** Das Fehlerobjekt von Meta (`{ error: { message, code, error_subcode } }`), soweit lesbar. */
function metaFehlerObjekt(json: unknown): { message: string; code: number | undefined; sub: number | undefined } {
    const roh = istObjekt(json) && istObjekt(json["error"]) ? json["error"] : {};
    return {
        message: typeof roh["message"] === "string" ? roh["message"] : "",
        code: zahl(roh["code"]),
        sub: zahl(roh["error_subcode"]),
    };
}

/** Ein Auszug der Meldung von Meta: eine Zeile, ohne Steuerzeichen und Schlüssel, höchstens 140 Zeichen. */
function auszug(meldung: string, zugang: MetaZugang): string {
    const rein = zugang.entschaerfe(meldung).replace(STEUERZEICHEN, " ").replace(/\s+/gu, " ").trim();
    return rein.length > 140 ? `${rein.slice(0, 139)}…` : rein;
}

/**
 * Der Satz zu einer Antwort, die nicht in Ordnung war. Meta meldet fast alles mit HTTP 400 und dem Code im Rumpf; vorübergehend sind die Drosselungen (Codes 4, 17, 32, 341, 613 und HTTP 429), die Fehler
 * des Dienstes (Codes 1, 2, HTTP 5xx) und bei Instagram „Medium noch nicht bereit“ (Code 9007, Unterfehler 2207027). Ein abgelaufener oder abgelehnter Schlüssel (Code 190) ist dauerhaft: Er will ein Mensch erneuern.
 */
export function graphFehlerZu(name: string, status: number, json: unknown, zugang: MetaZugang): MetaFehler {
    const { message, code, sub } = metaFehlerObjekt(json);
    const stelle = `${String(status)}${code === undefined ? "" : `, Code ${String(code)}`}${sub === undefined ? "" : `/${String(sub)}`}`;
    if (code === 190 || status === 401) {
        return new MetaFehler(
            `${name}: Der Zugangsschlüssel ist abgelaufen oder wurde abgelehnt (${stelle})`,
            true,
            status,
            code,
        );
    }
    if (status === 429 || (code !== undefined && [4, 17, 32, 341, 613].includes(code))) {
        return new MetaFehler(`${name}: Meta bremst gerade (${stelle})`, false, status, code);
    }
    if (code === 9007 || sub === 2207027) {
        return new MetaFehler(`${name}: Das Bild ist bei Meta noch nicht bereit (${stelle})`, false, status, code);
    }
    if (status >= 500 || code === 1 || code === 2) {
        return new MetaFehler(`${name}: Meta meldet einen Fehler (${stelle})`, false, status, code);
    }
    if (status >= 300 && status < 400) {
        return new MetaFehler(`${name}: Meta leitet weiter, der Hub folgt nicht (${stelle})`, true, status, code);
    }
    if (status === 403 || code === 10 || (code !== undefined && code >= 200 && code <= 299)) {
        return new MetaFehler(
            `${name}: Das Konto oder die App darf das bei Meta nicht (${stelle})`,
            true,
            status,
            code,
        );
    }
    const text = auszug(message, zugang);
    return new MetaFehler(
        `${name}: Meta lehnt die Anfrage ab (${stelle})${text === "" ? "" : `: ${text}`}`,
        true,
        status,
        code,
    );
}

/** Der JSON-Rumpf einer Antwort; eine Antwort, die keiner ist (oder nicht zu lesen war), zählt als leer: Dann entscheidet der Status. */
async function leseJson(antwort: Response): Promise<unknown> {
    try {
        const text = (await antwort.text()).slice(0, ANTWORT_MAX);
        return text === "" ? null : (JSON.parse(text) as unknown);
    } catch {
        return null;
    }
}

/** Ein Aufruf mit Zeitgrenze, ohne Weiterleitung. Gibt Status und gelesenes JSON zurück; wirft nur, wenn keine Antwort kam. */
export async function graphAufruf(
    name: string,
    zugang: MetaZugang,
    deps: GraphDeps,
    a: GraphAufruf,
): Promise<GraphAntwort> {
    const hole = deps.fetch ?? globalThis.fetch;
    const body =
        a.felder === undefined
            ? undefined
            : a.felder instanceof FormData
              ? a.felder
              : new URLSearchParams(a.felder as Record<string, string>);
    let antwort: Response;
    try {
        antwort = await hole(zugang.adresse(a.pfad, a.abfrage), {
            method: a.methode,
            redirect: "manual",
            headers: { Accept: "application/json", ...zugang.anmeldeKopf() },
            ...(body === undefined ? {} : { body }),
            signal: AbortSignal.timeout(deps.timeoutMs ?? GRAPH_ZEITGRENZE_MS),
        });
    } catch (fehler) {
        // Nie der Text des Fehlers: Er enthielte die Adresse.
        const zeit =
            (fehler as { name?: unknown }).name === "TimeoutError" ||
            (fehler as { name?: unknown }).name === "AbortError";
        throw new MetaFehler(
            zeit ? `${name}: Meta hat nicht rechtzeitig geantwortet` : `${name}: Meta war nicht erreichbar`,
            false,
        );
    }
    return { status: antwort.status, json: await leseJson(antwort) };
}

/** Eine Kennung, wie Meta sie nennt (Ziffern, bei Beiträgen von Facebook mit Unterstrich); nur sie kommt je in einen Pfad. */
export const META_KENNUNG = /^[0-9][0-9_]{4,60}$/u;

/** Liest eine Kennung aus einer Antwort; wirft, wenn Meta keine nannte. */
export function leseKennung(name: string, json: unknown, feld: string, was: string): string {
    const wert = istObjekt(json) ? json[feld] : undefined;
    if (typeof wert !== "string" || !META_KENNUNG.test(wert)) {
        // Der Aufruf ging durch: Meta hat den Beitrag womöglich angelegt. Ein neuer Versuch könnte ihn doppeln, also nicht wiederholen; der Satz sagt, dass dort nachzusehen ist.
        throw new MetaFehler(`${name}: Meta nannte keine Kennung ${was}; bitte dort nachsehen`, true);
    }
    return wert;
}
