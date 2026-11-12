import { Type, type Static } from "@sinclair/typebox";
import { WIKISYNC_ARTIKEL_TITEL_MAX, WIKISYNC_ARTIKEL_TITEL_VERBOTEN } from "../system/wikisync.ts";
import { WIKI_ART_WIND, type WetterSymbolArt, type WetterSymbolTyp } from "./arten.ts";

/**
 * Der Wiki-Artikel eines Wetter-Icons (WI-0288 Stufe 6; Betreiber 2026-11-08: „Leicht, Derographie“): Winde, Meeresströmungen und Mahlströme stehen als Wiki-Einträge
 * im Derographie-Zug; ein Icon trägt höchstens einen Verweis auf seinen Artikel, den ein Editor von Hand setzt.
 *
 * - **Der Schlüssel ist der Artikeltitel**, so wie die Wiki-Einträge der Derographie ihn führen (`EditorWikiEintrag.titel`; der Abgleich vergleicht über die Vergleichsform des
 *   Titels). Ein Titel löst beide Tafeln auf, in denen die Artikel stehen: die Wiki-Einträge (`wiki_region_snapshot`) und die Landmarken-Artikel (`wiki_landmarke_artikel`), wo die
 *   Mahlströme bis zum nächsten Abgleich noch als Strudel stehen (seit 2026-11-11 sind sie Wiki-Einträge wie die Winde).
 * - **Welche Artikel:** die Arten in `WETTER_WIKI_ARTEN` (die erste Art eines Eintrags, `Art=Mahlstrom (Strömung)|Mahlstrom` gilt als „Mahlstrom (Strömung)“; an einem Landmarken-Artikel die
 *   Wiki-Art, die die Landmarke traf).
 * - 🔴 Nie andersherum: Kein Abgleich legt ein Icon an oder setzt einen Verweis.
 * - Die Art der Wind-Artikel (`WIKI_ART_WIND`) und die Typen eines Icons (`WETTER_SYMBOL_TYPEN`) stehen in `arten.ts`, für das Startpaket des Browsers.
 */

/** Die Arten der Artikel, auf die ein Wetter-Icon verweisen kann. */
export const WETTER_WIKI_ARTEN = [WIKI_ART_WIND, "Meeresströmung", "Mahlstrom (Strömung)", "Mahlstrom"] as const;

/** Ist das die Art eines Mahlstrom-Artikels? Ein Wiki-Eintrag trägt „Mahlstrom (Strömung)“, ein Landmarken-Artikel „Mahlstrom“. */
export const istMahlstromArt = (art: string | null | undefined): boolean =>
    art === "Mahlstrom (Strömung)" || art === "Mahlstrom";

export const wetterSymbolTyp = (art: WetterSymbolArt, artikelArt: string | null | undefined): WetterSymbolTyp =>
    istMahlstromArt(artikelArt) ? "mahlstrom" : art;

/** Die Artikel, auf die ein Icon verweisen kann (Editor, `edit_weather`); wenige Dutzend, der Editor sucht darin selbst. */
export const WETTER_WIKI_URL = "/api/editor/wetter/wiki-artikel";

export const WETTER_WIKI_TITEL_MAX = WIKISYNC_ARTIKEL_TITEL_MAX;

/**
 * Der Titel, wie er am Icon gespeichert wird: Ränder gekürzt, Leerraum einfach, leer heißt ohne Verweis (`null`). `undefined`, wenn er kein Titel sein kann (zu lang, ein Zeichen, das in keinem
 * MediaWiki-Titel steht, ein Steuerzeichen).
 */
export function wetterWikiTitel(eingabe: string | null): string | null | undefined {
    if (eingabe === null) return null;
    const titel = eingabe.replace(/\s+/gu, " ").trim();
    if (titel === "") return null;
    if ([...titel].length > WETTER_WIKI_TITEL_MAX || WIKISYNC_ARTIKEL_TITEL_VERBOTEN.test(titel)) return undefined;
    // eslint-disable-next-line no-control-regex -- genau darum geht es: Steuerzeichen stehen in keinem Titel
    return /[\u0000-\u001f\u007f]/u.test(titel) ? undefined : titel;
}

/** Die Adresse eines Artikels im Wiki, aus seinem Titel (wie die Landmarken-Artikel des Abgleichs sie bilden). */
export const wetterWikiAdresse = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

export const WetterWikiArtikel = Type.Object(
    {
        titel: Type.String({ minLength: 1 }),
        /** Die Art, wie das Wiki sie nennt („Wind“, „Meeresströmung“, „Mahlstrom (Strömung)“). */
        art: Type.String(),
        region: Type.Optional(Type.String()),
        wikiUrl: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
);
export type WetterWikiArtikel = Static<typeof WetterWikiArtikel>;

/** `GET /api/editor/wetter/wiki-artikel`: nach Titel geordnet, jeder Titel einmal. */
export const WetterWikiArtikelAntwort = Type.Object(
    { artikel: Type.Array(WetterWikiArtikel) },
    { additionalProperties: false },
);
export type WetterWikiArtikelAntwort = Static<typeof WetterWikiArtikelAntwort>;
