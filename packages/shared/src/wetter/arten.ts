/**
 * Die Arten der Wetter-Icons (WI-0288 Stufe 2), die Grenzen ihrer Felder und die Typen eines Icons mit Wiki-Verweis (Stufe 6): der kleine Teil des Wetters, den auch das
 * Startpaket des Browsers braucht (Zeiger-Schild und Infopanel eines Icons, die Liste der Derographie). Eigenes Modul, damit `symbole.ts` und `wiki.ts` mit ihren Vorgaben,
 * Prüfungen und Schemata erst mit dem Wetter nachladen (Besucherpaket, WI-0235); fachlich gehört alles hier dorthin.
 */

export const WETTER_SYMBOL_ARTEN = ["wind", "wirbel", "stroemung", "mahlstrom"] as const;
export type WetterSymbolArt = (typeof WETTER_SYMBOL_ARTEN)[number];

export const istWetterSymbolArt = (art: unknown): art is WetterSymbolArt =>
    typeof art === "string" && (WETTER_SYMBOL_ARTEN as readonly string[]).includes(art);

/** Die Grenzen der Felder (Regler der Probierseite: Reichweite 10 bis 600, Stärke 0,5 bis 40). */
export const WETTER_SYMBOL_GRENZEN = {
    x: { min: 0, max: 1024 },
    z: { min: 0, max: 1024 },
    reichweite: { min: 10, max: 600 },
    staerke: { min: 0.5, max: 40 },
    /** Halboffen: 360 ist wieder 0. */
    richtung: { min: 0, max: 360 },
    /** Zeichen des Namens, nach dem Kürzen der Ränder. */
    name: { max: 120 },
} as const;

/** Die Art, die der Leser der Wind-Artikel einem Wiki-Eintrag gibt (`apps/server/src/wiki/infobox/wind.ts`). */
export const WIKI_ART_WIND = "Wind";

/**
 * Der Typ eines Wetter-Icons mit Wiki-Verweis: seine Art, bei einem Mahlstrom-Artikel `mahlstrom` (WI-0288, Auftrag 2026-11-08). Er bestimmt das Typbild im Kopf des
 * Infopanels (`headerGraphicOf("wetterSymbol", typ)`) und das Wort der Art darunter; der Server nennt ihn im Untertitel (`part: "type"`).
 */
export const WETTER_SYMBOL_TYPEN = WETTER_SYMBOL_ARTEN;
export type WetterSymbolTyp = (typeof WETTER_SYMBOL_TYPEN)[number];
