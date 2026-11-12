import { kurzbeschreibungVon } from "./kurzbeschreibung.ts";
import { feld, feldRoh, type Infoboxseite } from "./seite.ts";
import { LEER_FOLGE, entschluesseleHtml, kuerze, normalisiereTitel, phpTrim, schluesselform } from "./text.ts";

/**
 * Ein Sprachartikel aus dem Wiki (WI-0261 S3; Betreiber 2026-10-30: „die dinger müssten auch mit wikisync und diese liste verlinkt werden“). Gelesen wird `{{Infobox Sprache}}` mit
 * ihren sieben Feldern (Name, Sprachfamilie, Vorstufen, Schrift, Sprecheranzahl, Offizielle Sprache, Weitere Verbreitung), dazu die Kurzbeschreibung aus dem Text (wie bei den Vorkommen,
 * `kurzbeschreibung.ts`) und die Navigationsleisten der Sprachfamilie. Legacy führt keine Sprachen; ein Vorbild in Legacy gibt es nicht.
 *
 * - **Aventurisch** ist ein Artikel, der die Vorlage `{{Aventurien}}` ODER die Navigationsleiste `{{Nav Sprachen}}` trägt (Befund am Dump vom 2026-10-11: 90 Artikel im Hauptraum;
 *   die Liste „Sprache/Liste“ nennt 89, sie ist eine DPL-Liste und im Dump leer). Myranische und uthurische Artikel tragen `{{Myranor}}`, `{{Uthuria}}` oder ihre eigenen Leisten und bleiben
 *   draußen; ein Artikel mit beiden Zeichen (`Mholurisch`: `{{Nav Sprachen}}` und `{{Myranor}}`, `Bansumitisch`: `{{Aventurien}}` und `{{Nav Myranische Sprachen}}`) gehört dazu.
 * - **Familien:** die eingebundenen Navigationsleisten, deren Name „Sprachfamilie“ enthält oder auf „dialekte“ endet (`Nav Sprachfamilie Garethi`, `Nav Waldmenschendialekte`,
 *   `Nav Bansumitische Sprachfamilie`), in der Reihenfolge des Texts. Die Sammelleisten (`Nav Sprachen`, `Nav Myranische Sprachen`) und fremde Leisten
 *   (`Nav Allgemeine Sonderfertigkeiten`) gehören nicht dazu.
 * - **Bereinigt und roh:** Jedes Feld steht bereinigt (Links zu ihrem Text, Vorlagen und Auszeichnung weg, `bereinige`); die Listenfelder (Vorstufen, Schrift, Offizielle Sprache, Weitere
 *   Verbreitung) zusätzlich roh mit allen Links (Zeichenverweise GENAU EINMAL aufgelöst, Leerraum an den Rändern weg), damit eine spätere Zuordnung zu Herrschaftsgebieten und Regionen
 *   die Linkziele liest, nie den Anzeigetext.
 *
 * 🔴 Ein Feld, das der Artikel nicht oder leer nennt, fehlt im Ergebnis: „das Wiki kennt nichts“, nie ein Leerstring (wie `lesen.ts`). Eine Infobox ohne schließende Klammer ist ein Befund.
 */

/**
 * Die Felder eines Sprachartikels im Abgleich, in der Reihenfolge, in der der Bericht sie zeigt: die sieben der Infobox, die Kurzbeschreibung, die Navigationsleisten (`navigation`, im Plan
 * mit ` | ` verbunden) und die vier Rohtexte. Jedes steht in einer Spalte von `wiki_sprache_artikel` (Migration 0255).
 */
export const SPRACHE_FELDER: readonly string[] = [
    "name",
    "sprachfamilie",
    "vorstufen",
    "schrift",
    "sprecheranzahl",
    "offizielle_sprache",
    "weitere_verbreitung",
    "kurzbeschreibung",
    "navigation",
    "roh_vorstufen",
    "roh_schrift",
    "roh_offizielle_sprache",
    "roh_weitere_verbreitung",
];

/** Wie der Plan die Navigationsleisten in EINEM Wert führt: Der Name einer Vorlage kann keinen senkrechten Strich tragen (er trennt ihre Parameter). */
export const NAVIGATION_TRENNER = " | ";

/** Höchstlänge eines Werts (Zeichen): weit über allem, was die Infoboxen im Dump führen (höchstens 377), und unter dem Schnitt der Vorschau (4.000), damit kein Wert gekürzt ankommt. */
const WERT_MAX = 2000;

/** Der Schlüssel eines Sprachartikels: der Titel in Vergleichsform (Unterstriche wie Leerzeichen, Leerraum einfach, klein; MediaWiki stellt den Anfangsbuchstaben frei). */
export function sprachSchluessel(titel: string): string {
    return phpTrim(normalisiereTitel(titel).replace(LEER_FOLGE, " ")).toLowerCase();
}

/** Ist das der Name der Sprach-Infobox (`Sprache`, in jeder Schreibung)? */
export const istSprachInfobox = (infoboxName: string): boolean => schluesselform(infoboxName) === "sprache";

/**
 * Die Namen aller Vorlagen, die der Text einbindet (`{{Name|…}}`, `{{Name}}`), in der Reihenfolge des Texts und je Name einmal: Unterstriche wie Leerzeichen, Leerraum einfach, der Präfix
 * `Vorlage:` fällt weg, der Anfangsbuchstabe groß (MediaWiki stellt ihn frei). Parserfunktionen (`{{#if:…}}`) und Variablen zählen nicht.
 */
export function vorlagenNamen(wikitext: string): string[] {
    const namen: string[] = [];
    const gesehen = new Set<string>();
    for (const treffer of wikitext.matchAll(/\{\{([^{}|\n]+)/gu)) {
        let name = phpTrim((treffer[1] ?? "").replaceAll("_", " ").replace(LEER_FOLGE, " "));
        name = name.replace(/^(?:vorlage|template)\s*:\s*/iu, "");
        if (name === "" || name.startsWith("#") || name.includes(":")) continue;
        name = name.charAt(0).toUpperCase() + name.slice(1);
        if (gesehen.has(name)) continue;
        gesehen.add(name);
        namen.push(name);
    }
    return namen;
}

/** Trägt der Text die Vorlage `{{Aventurien}}` oder die Navigationsleiste `{{Nav Sprachen}}`? Dann ist der Artikel ein aventurischer Sprachartikel (siehe oben). */
export function istAventurisch(wikitext: string): boolean {
    return vorlagenNamen(wikitext).some((name) => name === "Aventurien" || name === "Nav Sprachen");
}

/** Die Navigationsleisten der Sprachfamilie, die der Text einbindet (siehe oben), in seiner Reihenfolge. */
export function familienNavigation(wikitext: string): string[] {
    return vorlagenNamen(wikitext).filter(
        (name) => name.startsWith("Nav ") && (/sprachfamilie/iu.test(name) || /dialekte$/iu.test(name)),
    );
}

export type SpracheGrund = "keine_infobox" | "nicht_geschlossen" | "fremde_infobox";

export type SpracheErgebnis =
    | {
          ok: true;
          infobox: string;
          felder: Readonly<Record<string, string>>;
          /** Trägt der Artikel `{{Aventurien}}` oder `{{Nav Sprachen}}`? */
          aventurisch: boolean;
          familien: readonly string[];
      }
    | { ok: false; grund: SpracheGrund; infobox: string };

function setze(felder: Record<string, string>, name: string, wert: string): void {
    const gekuerzt = kuerze(phpTrim(wert), WERT_MAX);
    if (gekuerzt !== "") felder[name] = gekuerzt;
}

/** Ein Feld roh: wie das Wiki es führt, Zeichenverweise einmal aufgelöst, Leerraum an den Rändern weg. */
const roh = (seite: Infoboxseite, schluessel: readonly string[]): string =>
    phpTrim(entschluesseleHtml(feldRoh(seite, schluessel)));

/** Liest einen Sprachartikel. Ohne Infobox, mit einer anderen Infobox oder mit offener Klammer ist die Seite kein lesbarer Sprachartikel; das ist ein Befund, nie ein Raten. */
export function leseSprache(seite: Infoboxseite): SpracheErgebnis {
    const infobox = seite.infobox;
    if (infobox === "") return { ok: false, grund: "keine_infobox", infobox };
    if (!istSprachInfobox(infobox)) return { ok: false, grund: "fremde_infobox", infobox };
    if (!seite.block.geschlossen) return { ok: false, grund: "nicht_geschlossen", infobox };

    const familien = familienNavigation(seite.wikitext);
    const felder: Record<string, string> = {};
    setze(felder, "name", feld(seite, ["name"]) || seite.titel);
    setze(felder, "sprachfamilie", feld(seite, ["sprachfamilie"]));
    setze(felder, "vorstufen", feld(seite, ["vorstufen"]));
    setze(felder, "schrift", feld(seite, ["schrift"]));
    setze(felder, "sprecheranzahl", feld(seite, ["sprecheranzahl"]));
    setze(felder, "offizielle_sprache", feld(seite, ["offiziellesprache"]));
    setze(felder, "weitere_verbreitung", feld(seite, ["weitereverbreitung"]));
    // Nicht aus der Infobox, sondern aus dem Text des Artikels (wie bei den Vorkommen, WI-0260): Zitate und Ulisses-Inhalte fallen weg; fehlt sie, fehlt das Feld.
    setze(felder, "kurzbeschreibung", kurzbeschreibungVon(seite.wikitext) ?? "");
    setze(felder, "navigation", familien.join(NAVIGATION_TRENNER));
    setze(felder, "roh_vorstufen", roh(seite, ["vorstufen"]));
    setze(felder, "roh_schrift", roh(seite, ["schrift"]));
    setze(felder, "roh_offizielle_sprache", roh(seite, ["offiziellesprache"]));
    setze(felder, "roh_weitere_verbreitung", roh(seite, ["weitereverbreitung"]));
    return { ok: true, infobox, felder, aventurisch: istAventurisch(seite.wikitext), familien };
}
