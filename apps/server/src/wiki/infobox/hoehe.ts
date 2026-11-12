import { LEER } from "./text.ts";

/**
 * Die Höhe eines Gipfels aus `Höhe=` der `{{Infobox Region}}` (WI-0253 §14 und §21), Zeichen für Zeichen nach Legacy (Mirror a7f2dac86):
 *
 * - `parseHoehe` ← `avesmapsWikiRegionParseHeight` (`region-heights.php`): kein Minuszeichen vor einer Ziffer, GENAU eine Zahl im Text (`1.100 Schritt` ja,
 *   `1.100 – 2.000` nein), ein Punkt vor genau drei Ziffern ist ein Tausenderpunkt, ein Komma ein Dezimalkomma, höchstens 20.000.
 * - `gipfelHoehe` ← `avesmapsWikiRegionHeightFromRow`: Legacy liest den Wert ZWEIMAL (erst beim Einlesen der Seite, dann aus der Zeile, deren Zahl schon ein Float ist). Das bleibt so
 *   (`100,123` ergibt beim zweiten Lesen `100.123`, einen Tausenderpunkt, und fällt als zu groß heraus); gespeichert wird in Avesmaps3D auf ganze Schritt gerundet, denn die Spalte
 *   `terrain_peak.height_schritt` ist eine Ganzzahl (Legacy hielt einen Float).
 *
 * 🪤 PHPs `\s` und `\d` mit dem Modifikator `u` sind Unicode-Klassen (PCRE2_UCP): `LEER` und `\p{Nd}`.
 */

const MINUS = new RegExp(`[-\\u2212]${LEER}*\\p{Nd}`, "u");
const ZAHLEN = /\p{Nd}+(?:[.,]\p{Nd}+)*/gu;
const MIT_TAUSENDERPUNKT = /^\p{Nd}{1,3}(?:\.\p{Nd}{3})+$/u;
const GUELTIG = /^\p{Nd}+(?:[,.]\p{Nd}+)?$/u;

/** PHPs `(float) $text`: der ASCII-Zahlenanfang des Texts, sonst 0. */
const phpFloat = (text: string): number => {
    const zahl = Number.parseFloat(text);
    return Number.isNaN(zahl) ? 0 : zahl;
};

/** PHPs `(string) $float` (14 gültige Stellen). */
const phpText = (zahl: number): string => String(Number.parseFloat(zahl.toPrecision(14)));

/** Legacy `avesmapsWikiRegionParseHeight`: die Höhe in Schritt aus einem Text, oder `null`. */
export function parseHoehe(wert: string): number | null {
    if (MINUS.test(wert)) return null;
    const treffer = wert.match(ZAHLEN);
    if (treffer === null || treffer.length !== 1) return null;
    let zahl = treffer[0] as string;
    if (MIT_TAUSENDERPUNKT.test(zahl)) zahl = zahl.replaceAll(".", "");
    if (!GUELTIG.test(zahl)) return null;
    const hoehe = phpFloat(zahl.replace(",", "."));
    return hoehe <= 20000 ? hoehe : null;
}

/** Die Höhe, die das Wiki dem Gipfel gibt: Legacys zweifach gelesener Wert, auf ganze Schritt gerundet; `null`, wenn die Seite keine nennt. */
export function gipfelHoehe(feldwert: string): number | null {
    const erste = parseHoehe(feldwert);
    if (erste === null) return null;
    const zweite = parseHoehe(phpText(erste));
    return zweite === null ? null : Math.round(zweite);
}
