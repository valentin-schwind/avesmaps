import { WETTER_SYMBOL_GRENZEN } from "@avesmaps3d/shared";

// Der Namensvorschlag des Felds „Wiki-Artikel“ (`wetter-wiki.ts`, WI-0288 Stufe 6), allein: Die Karte nennt ihn im Startpaket (`map/wetter/wetter-schalter.ts`,
// `wetterIconName`), die Suche des Felds lädt mit dem Wetter-Editor nach.

/** Der Name, den der Titel vorschlägt: ohne Klammerzusatz am Ende, höchstens so lang, wie ein Name sein darf. */
export function wikiNamensvorschlag(titel: string): string {
    const ohneZusatz = titel.replace(/\s*\([^()]*\)\s*$/u, "").trim();
    const name = ohneZusatz === "" ? titel.trim() : ohneZusatz;
    return [...name].slice(0, WETTER_SYMBOL_GRENZEN.name.max).join("");
}
