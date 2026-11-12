import { WIKI_ART_WIND, type WetterSymbolArt, type WetterWikiArtikel } from "@avesmaps3d/shared";

/**
 * Der Wiki-Artikel am Wetter-Icon (WI-0288 Stufe 6; Betreiber 2026-11-08: „Leicht, Derographie“): die Rechnung hinter dem Feld „Wiki-Artikel“ (`wetter-wiki-feld.vue`), ohne Vue und ohne Server.
 *
 * - **Suche** über die Winde, Meeresströmungen und Mahlströme des Derographie-Zugs (`GET /api/editor/wetter/wiki-artikel`, wenige Dutzend): ohne Groß- und Kleinschreibung und ohne Akzente, Treffer am
 *   Wortanfang zuerst, dann die Artikel der Art, die zum Icon passt (Wind zu Wind, Strömung zu Meeresströmung, Wirbel und Mahlstrom zu Mahlstrom).
 * - **Name aus dem Titel:** nur ein Vorschlag, den der Editor annimmt; nie überschreibt der Verweis einen Namen von selbst. Der Klammerzusatz des Wikis („Katla (Wind)“) fällt weg.
 */

export const WIKI_TREFFER_HOECHSTENS = 8;

const gefaltet = (text: string): string =>
    text
        .normalize("NFD")
        .replace(/\p{M}+/gu, "")
        .toLowerCase()
        .replace(/\s+/gu, " ")
        .trim();

/** Passt die Art des Artikels zur Art des Icons? */
export function passtZumIcon(artikel: Pick<WetterWikiArtikel, "art">, art: WetterSymbolArt): boolean {
    const wiki = gefaltet(artikel.art);
    if (art === "wind") return wiki === gefaltet(WIKI_ART_WIND);
    if (art === "stroemung") return wiki.startsWith("meeresstromung");
    return wiki.startsWith("mahlstrom");
}

/** Die Treffer zur Suche: leer heißt die passenden zuerst; höchstens `hoechstens`. */
export function wikiTreffer(
    artikel: readonly WetterWikiArtikel[],
    suche: string,
    art: WetterSymbolArt,
    hoechstens = WIKI_TREFFER_HOECHSTENS,
): WetterWikiArtikel[] {
    const frage = gefaltet(suche);
    const rang = (eintrag: WetterWikiArtikel): number | undefined => {
        const titel = gefaltet(eintrag.titel);
        const passt = passtZumIcon(eintrag, art) ? 0 : 1;
        if (frage === "") return passt;
        if (titel.startsWith(frage) || titel.split(/[\s(-]+/u).some((wort) => wort.startsWith(frage))) return passt;
        return titel.includes(frage) || gefaltet(eintrag.region ?? "").includes(frage) ? 2 + passt : undefined;
    };
    return artikel
        .flatMap((eintrag) => {
            const r = rang(eintrag);
            return r === undefined ? [] : [{ eintrag, r }];
        })
        .sort((a, b) => a.r - b.r || a.eintrag.titel.localeCompare(b.eintrag.titel, "de"))
        .slice(0, hoechstens)
        .map(({ eintrag }) => eintrag);
}

/** Der Artikel zum gespeicherten Titel (Vergleich ohne Groß- und Kleinschreibung), wenn die Liste ihn kennt. */
export function wikiArtikelZu(
    artikel: readonly WetterWikiArtikel[] | undefined,
    titel: string | null | undefined,
): WetterWikiArtikel | undefined {
    if (artikel === undefined || titel === null || titel === undefined) return undefined;
    const gesucht = gefaltet(titel);
    return artikel.find((eintrag) => gefaltet(eintrag.titel) === gesucht);
}

/** Der Name aus dem Titel steht im Startpaket (`map/wetter/wetter-wiki-name.ts`): Zeiger-Schild und Titel des Infopanels auf der Karte nennen ihn. */
export { wikiNamensvorschlag } from "../map/wetter/wetter-wiki-name";
