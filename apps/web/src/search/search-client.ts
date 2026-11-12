import {
    SEARCH_BEISPIELE_URL,
    SEARCH_EINTRAG_URL,
    SEARCH_LEUCHTEN_URL,
    SEARCH_MIN_LENGTH,
    SEARCH_ZAHLEN_URL,
    type SearchBeispiel,
    type SearchBeispiele,
    type SearchEintrag,
    type SearchHit,
    type SearchLeuchtAnfrage,
    type SearchLeuchten,
    type SearchResponse,
    type SearchZahl,
    type SearchZahlen,
} from "@avesmaps3d/shared";
import { isMessageKey, t } from "../i18n/i18n";
import { climateZoneKeysMatching, climateZoneName } from "../map/climate-zones";

/**
 * Die Oberflächenseite des Search Core (WI-0013): Anfrage, Beschriftung, Trefferliste. Welche Taste die
 * Suche öffnet, steht seit WI-0016 in der Tastaturtafel der Karte (`keyboard/shortcuts.ts`).
 *
 * 🪤 Hier steht nichts, was die Vue-Komponente zum Leben braucht — nur, was sich ohne Browser
 * prüfen lässt. Die Komponente zeigt, diese Datei entscheidet.
 */

/**
 * Fragt den Endpunkt. Unter der Mindestlänge wird gar nicht gefragt: der Server antwortete mit
 * einer leeren Liste, und eine Netzwerkrunde für eine bekannte Antwort ist keine.
 *
 * Mit der Capability `search_sea_route_names` (`@avesmaps3d/shared`, M9) findet die Suche zusätzlich
 * einen Seeweg über seinen genauen Namen (`editor`-Query-Flag, WI-0046). Der Server behält diesen
 * Namen für das Flag - er liest ihn vorerst weiter direkt, statt aus einer Session (M9, kleinster
 * Eingriff).
 *
 * 🔴 **Die Klimazonen nennt der Browser mit** (`climate=`, WI-0171): Ihre acht Namen stehen in der Sprachtafel, und
 * eine serverseitige Suche kann dort nicht nachschlagen (`map/climate-zones.ts` sagt, warum nicht die Sprache statt
 * der Schlüssel mitgeht). Deutsch findet der Server zusätzlich selbst; steht die Seite auf Deutsch, nennt die Liste
 * deshalb genau die Zonen, die er ohnehin fände.
 */
export async function fetchSearch(
    query: string,
    signal?: AbortSignal,
    canSearchSeaRouteNames = false,
): Promise<SearchResponse> {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_LENGTH) {
        return { query: trimmed, hits: [], truncated: false };
    }
    const zonen = climateZoneKeysMatching(trimmed);
    const url =
        `/api/search?q=${encodeURIComponent(trimmed)}` +
        `${canSearchSeaRouteNames ? "&editor=true" : ""}` +
        `${zonen.length === 0 ? "" : `&climate=${zonen.join(",")}`}`;
    const response = await fetch(url, signal ? { signal } : {});
    if (!response.ok) {
        throw new Error(`Suche antwortete ${response.status}`);
    }
    return (await response.json()) as SearchResponse;
}

/** Ein Name aus der Sprachtafel, wenn es ihn gibt; sonst die Rückfallangabe. */
function labelOr(key: string, fallback: string): string {
    return isMessageKey(key) ? t(key) : fallback;
}

/**
 * Die Typangabe rechts im Treffer (Legacy: 11 px VERSALIEN).
 *
 * Landschaften nennen ihre Art (WI-0047, Legacy „Tannwald · Wald · Vegetation“): Seit auch Flächen ohne
 * Beschriftung Treffer sind, stehen sonst zwei „Große Öde“ (Tiefebene und Steppe) ununterscheidbar
 * untereinander. Die Namen der Arten stehen schon für den Planer in den Sprachtafeln (`landscape.type.*`);
 * ein unbekannter Subtyp fällt auf „Landschaft“ zurück, nie auf den rohen Schlüssel.
 */
export function hitTypeLabel(hit: SearchHit): string {
    switch (hit.kind) {
        case "ort":
            return labelOr(`place.${hit.subtype ?? ""}`, t("search.kind.place"));
        case "weg":
            return labelOr(`path.${hit.subtype ?? ""}`, t("search.kind.path"));
        case "klima":
            return t("search.kind.climate");
        default:
            return labelOr(`landscape.type.${hit.subtype ?? ""}`, t("search.kind.landscape"));
    }
}

/**
 * Der Name im Treffer.
 *
 * 🔴 Eine Klimazone heißt, wie die Sprachtafel sie nennt (WI-0171): Der Server schickt mit `name` seinen deutschen
 * Stamm und mit `id` den Schlüssel; angezeigt wird derselbe Name, der auf der Karte und im Panel steht. Jeder andere
 * Treffer trägt einen Namen aus den Kartendaten, und der wird nie übersetzt.
 *
 * 🪤 Nur die ANZEIGE geht hier durch die Tafel. Was die Besucherstatistik als Ausprägung meldet, bleibt `hit.name`
 * (`spotlight-search.vue`) - sonst zerfiele eine Zone in der Auswertung in eine Zeile je Sprache.
 */
export function hitName(hit: SearchHit): string {
    return hit.kind === "klima" ? climateZoneName(hit.id, hit.name) : hit.name;
}

/** Pfeiltasten wandern im Kreis — vom letzten Treffer weiter nach unten landet man wieder oben. */
export function moveActive(active: number, count: number, step: 1 | -1): number {
    if (count === 0) {
        return -1;
    }
    return (active + step + count) % count;
}

// ---------------------------------------------------------------------------------------------------------------------
// Die Wege der Vorkommen (WI-0257 S3b)
// ---------------------------------------------------------------------------------------------------------------------

/** So oft und so lange wartet ein Abruf, wenn der Server meldet, dass seine Rechnung gerade überlastet ist (503 `busy`, `Retry-After`). */
const BUSY_VERSUCHE = 3;
const BUSY_WARTE_MS = 1000;

/** Wartet; ein Abbruch beendet das Warten sofort (und der Aufrufer bricht ohnehin ab). */
function warte(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((fertig) => {
        const timer = setTimeout(fertig, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                fertig();
            },
            { once: true },
        );
    });
}

/**
 * Ein Abruf einer der teureren Routen unter `/api/search/` (Leuchten, Zahlen, Eintrag): Bei 503 `busy` fragt er nach kurzer Pause noch einmal, höchstens dreimal – der Server meldet damit „gerade
 * überlastet“, nicht „kaputt“. `404` ist `null` („gibt es nicht [mehr]“), jeder andere Fehler wirft.
 */
async function leseVorkommenRoute<T>(url: string, signal?: AbortSignal): Promise<T | null> {
    for (let versuch = 1; ; versuch += 1) {
        const response = await fetch(url, signal ? { signal } : {});
        if (response.status === 404) return null;
        if (response.status === 503 && versuch < BUSY_VERSUCHE) {
            await warte(BUSY_WARTE_MS, signal);
            if (signal?.aborted === true) throw new DOMException("abgebrochen", "AbortError");
            continue;
        }
        if (!response.ok) throw new Error(`${url} antwortete ${String(response.status)}`);
        return (await response.json()) as T;
    }
}

/** Die flache Adresse einer Leuchtanfrage (Listen mit Komma), wie die Route sie liest. */
export function leuchtenUrl(anfrage: SearchLeuchtAnfrage): string {
    const teile: string[] = [];
    if (anfrage.eintrag !== undefined) teile.push(`eintrag=${anfrage.eintrag}`);
    if (anfrage.art !== undefined) teile.push(`art=${encodeURIComponent(anfrage.art)}`);
    if (anfrage.landschaften !== undefined) teile.push(`landschaften=${anfrage.landschaften.join(",")}`);
    if (anfrage.gebiet !== undefined) teile.push(`gebiet=${anfrage.gebiet}`);
    if (anfrage.lage !== undefined) teile.push(`lage=${anfrage.lage}`);
    if (anfrage.orte !== undefined) teile.push(`orte=${anfrage.orte.join(",")}`);
    return `${SEARCH_LEUCHTEN_URL}?${teile.join("&")}`;
}

/** Was für die Anfrage auf der Karte leuchtet; `null`, wo der Eintrag oder ein Ziel nicht (mehr) da ist. */
export const fetchLeuchten = (anfrage: SearchLeuchtAnfrage, signal?: AbortSignal): Promise<SearchLeuchten | null> =>
    leseVorkommenRoute<SearchLeuchten>(leuchtenUrl(anfrage), signal);

/** Die Zahlen der leuchtenden Gegenden für bis zu acht Einträge, je Kennung; fehlt eine, hat der Server sie nicht genannt (ausgeblendete Art). */
export async function fetchZahlen(
    ids: readonly string[],
    signal?: AbortSignal,
): Promise<ReadonlyMap<string, SearchZahl>> {
    if (ids.length === 0) return new Map();
    const antwort = await leseVorkommenRoute<SearchZahlen>(`${SEARCH_ZAHLEN_URL}?ids=${ids.join(",")}`, signal);
    return new Map((antwort?.zahlen ?? []).map((zahl) => [zahl.id, zahl]));
}

/** Die Beispiele für den wechselnden Platzhalter; ohne Antwort keine (die Suche braucht sie nicht). */
export async function fetchBeispiele(signal?: AbortSignal): Promise<readonly SearchBeispiel[]> {
    const antwort = await leseVorkommenRoute<SearchBeispiele>(SEARCH_BEISPIELE_URL, signal);
    return antwort?.beispiele ?? [];
}

/** Ein Eintrag für sein Panel; `null`, wo es ihn nicht (mehr) gibt oder seine Art ausgeblendet ist. */
export const fetchEintrag = (id: string, signal?: AbortSignal): Promise<SearchEintrag | null> =>
    leseVorkommenRoute<SearchEintrag>(`${SEARCH_EINTRAG_URL}?id=${id}`, signal);
