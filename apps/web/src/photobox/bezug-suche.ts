import type { SearchHit, SearchHitKind, SearchResponse } from "@avesmaps3d/shared";
import { fetchSearch, hitTypeLabel } from "../search/search-client";

/**
 * Der Bezug eines Reisebilds aus der mitlaufenden Suche (WI-0272 S2b, Aufgabe 13; Vali 2026-10-31: „Bezug auf Wege und Gebiete -> wenn man tippt, kann man ja die suche zur autocompletion
 * mitlaufen lassen“; WI §4: „Bezug zuerst automatisch (Ort, wenn die Stelle auf ihm liegt), sonst per Treffer der mitlaufenden Suche“).
 *
 * - **Das Wort, das gerade getippt wird**, ab drei Zeichen, nach 250 ms Ruhe, höchstens fünf Treffer: die Suche der Karte (`fetchSearch`: Orte, Wege, Landschaften, Klimazonen) als Autovervollständigung
 *   der Bildbeschreibung. Gesucht wird das LETZTE Wort der Beschreibung, nicht jedes: Jeder Tastendruck ein neues Wort zu suchen kostete eine Runde ohne Nutzen.
 * - **Ein Treffer wird mit einem Klick zum Bezug** (`BezugWahl`); die Anzeige zeigt ihn als Chip „Zeigt …“ mit ✕. Ein Treffer der Art `ort` ist zugleich der Ort des Bildes
 *   (`placeId`, wenn seine Kennung eine öffentliche Kennung ist), jede andere Art geht als `bezug` (`PhotoboxEinreichung`).
 */

export const BEZUG_MIN_ZEICHEN = 3;
export const BEZUG_RUHE_MS = 250;
export const BEZUG_MAX = 5;

/** Was gewählt ist: die Art und der Schlüssel des Treffers, dazu Name und Art in Worten für die Anzeige. */
export interface BezugWahl {
    readonly art: SearchHitKind;
    readonly id: string;
    readonly name: string;
    readonly typ: string;
}

/** Das letzte Wort (Buchstaben und Ziffern) des Textes, wenn es lang genug ist. */
export function letztesWort(text: string): string | undefined {
    const woerter = text.split(/[^\p{L}\p{N}]+/u).filter((wort) => wort !== "");
    const wort = woerter.at(-1);
    return wort !== undefined && [...wort].length >= BEZUG_MIN_ZEICHEN ? wort : undefined;
}

export const bezugAusTreffer = (treffer: SearchHit): BezugWahl => ({
    art: treffer.kind,
    id: treffer.id,
    name: treffer.name,
    typ: hitTypeLabel(treffer),
});

/** Die Treffer zu einem Wort: höchstens fünf, ohne den, der schon gewählt ist. */
export async function sucheBezuege(
    wort: string,
    signal?: AbortSignal,
    gewaehlt?: BezugWahl,
    suche: (anfrage: string, signal?: AbortSignal) => Promise<SearchResponse> = fetchSearch,
): Promise<BezugWahl[]> {
    const antwort = await suche(wort, signal);
    return antwort.hits
        .map(bezugAusTreffer)
        .filter((wahl) => !(wahl.art === gewaehlt?.art && wahl.id === gewaehlt.id))
        .slice(0, BEZUG_MAX);
}
