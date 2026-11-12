import { KONTINENT_VORGABE } from "./konstanten.ts";
import { LEER, normalisiereTitel, phpTrim, schluesselform } from "../infobox/text.ts";

/**
 * Die Werte aus den Kategorien einer Seite rechnen (WI-0253 C-2, seit WI-0294 aus der Kategorien-Datei statt aus Antworten der API). REIN: keine Anfrage, keine Datenbank, keine Uhr. Zeichen für Zeichen nach Legacy
 * (`api/_internal/wiki/dump-category-layer.php`, `sync.php`, `sync-monitor-parsing.php`, Stand a7f2dac86); das Legacy-Orakel (`scripts/dev/wiki-kategorien-orakel.php`)
 * misst die Kontinent-Erkennung gegen die echte PHP-Funktion.
 *
 */

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Titel
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Der Schlüssel, unter dem ein Titel einer Kategorie dem Titel einer Adresse zugeordnet wird: der normalisierte Titel (Legacy `avesmapsWikiSyncMonitorNormalizeTitle`),
 * dazu der erste Buchstabe klein – MediaWiki stellt ihn frei (`first-letter`), die Adresse darf ihn klein tragen, die Kategorie führt ihn immer groß.
 */
export function titelSchluessel(titel: string): string {
    const norm = normalisiereTitel(titel);
    const [erster] = Array.from(norm);
    return erster === undefined ? "" : erster.toLowerCase() + norm.slice(erster.length);
}

/** Das Präfix `Kategorie:` beziehungsweise `Category:` abstreifen (Legacy `avesmapsWikiSyncStripCategoryPrefix`). */
export const ohneKategoriePraefix = (titel: string): string => titel.replace(/^(?:Kategorie|Category):/u, "");

/** Ist dieser Name der Art eine lineare Anlage, die nicht als Punkt gilt (Legacy `avesmapsWikiSettlementIsExcludedBuildingType`)? */
export function istAusgeschlossenerBauwerkTyp(art: string, ausgeschlossen: ReadonlySet<string>): boolean {
    const gefaltet = phpTrim(art)
        .toLowerCase()
        .replaceAll("ß", "ss")
        .replaceAll("ä", "ae")
        .replaceAll("ö", "oe")
        .replaceAll("ü", "ue");
    return ausgeschlossen.has(gefaltet);
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Kontinent
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// PCRE2 mit UCP (PHP `/u`): `\s` ist das Unicode-Leerzeichen (`LEER`), `\b` die Grenze zu Buchstaben, Ziffern und Unterstrich.
const NICHT_LEER = LEER.replace("[", "[^");
const WORT_VOR = "(?<![\\p{L}\\p{N}_])";
const WORT_NACH = "(?![\\p{L}\\p{N}_])";

/**
 * Ein Kolonie-Stichwort samt unmittelbar folgendem Fremd-Kontinent (höchstens zwei Zwischenwörter) fällt vor der Suche weg: „Geographisch: Meridiana; Kolonien: Uthuria“ gehört
 * Aventurien, nicht Uthuria (Legacy `avesmapsWikiSyncMonitorDetectContinent`, der Fall Al’Anfa).
 */
const KOLONIE = new RegExp(
    `${WORT_VOR}(?:kolonien?|kolonialbesitz|protektorat|au[ßs]enposten|exklave|dependance)${WORT_NACH}` +
        `(?:${LEER}|[:,])*(?:${NICHT_LEER}+${LEER}+){0,2}?` +
        `(?:uthuria|myranor|g[üu]ldenland|gueldenland|rakshazar|riesland|tharun|lahmaria)${WORT_NACH}`,
    "giu",
);

/** Die Kontinente und ihre Suchwörter in der Schlüsselform; der ERSTE Treffer gewinnt, die Reihenfolge ist tragend. */
const KONTINENTE: readonly (readonly [string, readonly string[]])[] = [
    ["Myranor / Güldenland", ["myranor", "guldenland", "gueldenland", "rastabor", "vesayama"]],
    ["Rakshazar / Riesland", ["rakshazar", "riesland"]],
    ["Uthuria", ["uthuria"]],
    ["Tharun", ["tharun"]],
    ["Lahmaria", ["lahmaria"]],
    ["Aventurien", ["aventurien"]],
];

/** Der Kontinent aus Titel und Kategorien (Legacy `avesmapsWikiSyncMonitorDetectContinent`, Zeichen für Zeichen). */
export function erkenneKontinent(kontext: string): string {
    const ohneKolonien = kontext.replace(KOLONIE, " ");
    const schluessel = schluesselform(ohneKolonien);
    // Ein ausdrücklicher Aventurien-Wegweiser ({{Nav Staaten Aventurien}}) ist das stärkste Signal und gewinnt vor der losen Suche.
    if (schluessel.includes("navstaatenaventurien")) return KONTINENT_VORGABE;
    for (const [kontinent, woerter] of KONTINENTE) {
        for (const wort of woerter) if (schluessel.includes(wort)) return kontinent;
    }
    return KONTINENT_VORGABE;
}

const ABGELEITET = new RegExp(`^${LEER}*abgeleitet von${WORT_NACH}`, "iu");

/**
 * Der Kontinent einer Seite: Titel und Kategorien, ohne die Ableitungs-Kategorien („Abgeleitet von Horas (Myranor)“ nennt einen Namen, keinen Kontinent; Legacy
 * `avesmapsWikiDumpCategoryStripNonContinentCategories`).
 */
export function kontinentVonSeite(angefragterTitel: string, kategorien: readonly string[]): string {
    const brauchbar = kategorien.filter((kategorie) => !ABGELEITET.test(kategorie));
    return erkenneKontinent(`${normalisiereTitel(angefragterTitel)} ${brauchbar.join(" ")}`);
}
