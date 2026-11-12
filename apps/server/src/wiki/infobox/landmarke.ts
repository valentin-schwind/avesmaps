import type { LandmarkenArt } from "@avesmaps3d/shared";
import { ersterAbsatz } from "./beschreibung.ts";
import { gipfelHoehe } from "./hoehe.ts";
import { sprachSchluessel } from "./sprache.ts";
import { feld, type Infoboxseite } from "./seite.ts";
import { LEER, kuerze, phpTrim, schluesselform } from "./text.ts";

/**
 * Die Landmarken-Artikel des Wikis (WI-0271 L7, §4.2): eine Seite mit `{{Infobox Region}}`, deren Art die FESTE Abbildung Wiki-Art → Landmarkenart trifft (§2.2, Spalte 1), dazu jede Seite der
 * `Kategorie:Süßwasserquelle`. REIN, ohne Datenbank.
 *
 * - **Art:** `Art=` (oder `Typ=`) kann mehrere Arten tragen (`Berg|Hügel`, 20 Artikel); es gilt der erste Bestandteil, den die Abbildung kennt. Eine Art außerhalb der Abbildung macht die Seite zu
 *   keinem Landmarken-Artikel (Wälder, Gebirge, Täler, Berggruppen bleiben Landschaften): Der Bereich liest sie nicht, er rät nie. Ein Komma trennt nicht (`Hügelland, Klippe` an der Beilunker
 *   Spitze, die schon als Fläche auf der Karte liegt).
 * - **Schreibweise des Wikis** (OPS-000110): Die Abbildung führt auch die Lemmata mit Klammerzusatz, die eine Landmarke meinen (`Quelle (Gewässer)` an Levthanquelle, Selsenquelle, Yakushi-Quellen;
 *   `Stein (Mineral)` am Weinenden Stein), und die Mehrzahl einer Art, die EINEN Ort benennt (`Klippen`, `Felssäulen`, `Wasserfälle`). Die Wiki-Art steht dann ohne Klammerzusatz. Nicht dabei:
 *   `Berg (unter Wasser)`, `Berge` (eine Berggruppe).
 * - 🔴 **Kein Mahlstrom** (Betreiber 2026-11-11: „mach das icon aber so wie winde - nicht wie landmarken“): `Mahlstrom` und `Mahlstrom (Strömung)` in jeder Schreibweise sind Wiki-Einträge
 *   wie die Winde, auf die ein Wetter-Icon „Mahlstrom“ verweist (`wetter/wiki.ts`), nie Landmarken der Art Strudel (`wikisync-wind.test.ts`).
 * - **Felder:** die, die ein Mensch zum Setzen braucht: Name, Art (abgebildet und roh), Region, Höhe (nur Berg und Vulkan tragen eine, CHECK an `terrain_peak`) und die Kurzbeschreibung (erster
 *   Absatz, wie der Wiki-Stand einer Landschaft).
 */

/**
 * Die Wiki-Arten in Schlüsselform (`schluesselform`: klein, Umlaute gefaltet, Klammern weg) → Landmarkenart, mit der Mehrzahl, wo sie einen Ort benennt, und den Lemmata mit Klammerzusatz, die eine
 * Landmarke meinen. Pässe sind Wegtypen (Vali 2026-10-31), Steinkreis, Oase, Gletscher und Eisberg keine Landmarken; `berge`, `mahlstrom` und `mahlstromstromung` fehlen mit Absicht (siehe oben).
 */
export const LANDMARKEN_WIKI_ARTEN: Readonly<Record<string, LandmarkenArt>> = {
    berg: "berggipfel",
    berggipfel: "berggipfel",
    gipfel: "berggipfel",
    vulkan: "vulkan",
    hugel: "huegel",
    hohle: "hoehle",
    hohlen: "hoehle",
    hohlensystem: "hoehle",
    grotte: "grotte",
    grotten: "grotte",
    krater: "krater",
    sumpfloch: "krater",
    schlucht: "schlucht",
    schluchten: "schlucht",
    klamm: "schlucht",
    wasserfall: "wasserfall",
    wasserfalle: "wasserfall",
    quelle: "quelle",
    quellen: "quelle",
    quellegewasser: "quelle",
    susswasserquelle: "quelle",
    heilquelle: "quelle",
    heilquellen: "quelle",
    thermalquelle: "quelle",
    thermalquellen: "quelle",
    geysir: "geysir",
    furt: "furt",
    strudel: "strudel",
    fels: "fels",
    felsen: "fels",
    stein: "fels",
    steinmineral: "fels",
    saule: "fels",
    saulen: "fels",
    felssaule: "fels",
    felssaulen: "fels",
    felslabyrinth: "fels",
    klippe: "klippe",
    klippen: "klippe",
    kap: "klippe",
    riff: "riff",
    riffe: "riff",
    sandbank: "riff",
    sandbanke: "riff",
};

/** Der Klammerzusatz eines Wiki-Lemmas am Ende („Quelle (Gewässer)“ → „Quelle“). */
const KLAMMERZUSATZ = new RegExp(`${LEER}*\\([^()]*\\)${LEER}*$`, "u");

/** Die Landmarkenart EINER Wiki-Art und die Wiki-Art ohne Klammerzusatz (das Fenster zeigt sie in Klammern); `null` außerhalb der Abbildung. */
function landmarkenArtDesTeils(teil: string): { art: LandmarkenArt; wikiArt: string } | null {
    const art = LANDMARKEN_WIKI_ARTEN[schluesselform(teil)];
    if (art === undefined) return null;
    const ohneZusatz = teil.replace(KLAMMERZUSATZ, "").trim();
    return { art, wikiArt: ohneZusatz === "" ? teil : ohneZusatz };
}

/** Die Felder eines Landmarken-Artikels im Plan (ohne den Lebenslauf `artikel`). */
export const LANDMARKE_FELDER: readonly string[] = ["name", "art", "wiki_art", "region", "height", "kurzbeschreibung"];

/** Die Kategorie, die eine Seite auch ohne passende Art zur Quelle macht (§4.2). */
const KATEGORIE_QUELLE = new RegExp(
    `\\[\\[${LEER}*(?:Kategorie|Category)${LEER}*:${LEER}*Süßwasserquelle${LEER}*(?:\\||\\]\\])`,
    "iu",
);

/** Der Schlüssel eines Landmarken-Artikels: der Titel in Vergleichsform, wie bei den Sprachartikeln. */
export const landmarkeSchluessel = sprachSchluessel;

/** Gehört die Seite zur Infobox Region (die Landmarken teilen sie mit den Landschaften)? */
const istRegion = (seite: Infoboxseite): boolean => seite.infoboxSchluessel.includes("region");

/**
 * Die Landmarkenart einer Seite und die Wiki-Art, die sie traf; `null`, wenn die Seite kein Landmarken-Artikel ist. Nur `{{Infobox Region}}` (mit geschlossenem Block) oder die Kategorie
 * Süßwasserquelle.
 */
export function landmarkenArtDerSeite(seite: Infoboxseite): { art: LandmarkenArt; wikiArt: string } | null {
    if (istRegion(seite) && seite.block.geschlossen) {
        const teile = phpTrim(feld(seite, ["art", "typ"]))
            .split(new RegExp(`${LEER}*\\|${LEER}*`, "u"))
            .map((teil) => teil.trim())
            .filter((teil) => teil !== "");
        for (const teil of teile) {
            const treffer = landmarkenArtDesTeils(teil);
            if (treffer !== null) return treffer;
        }
    }
    if (KATEGORIE_QUELLE.test(seite.wikitext)) return { art: "quelle", wikiArt: "Süßwasserquelle" };
    return null;
}

export type LandmarkeLesen =
    | { ok: true; infobox: string; felder: Record<string, string>; art: LandmarkenArt }
    | { ok: false; grund: "keine_landmarke" | "name_fehlt"; infobox: string };

/** Liest einen Landmarken-Artikel. Ohne passende Art ist die Seite keiner (ein Befund, nie ein Raten). */
export function leseLandmarke(seite: Infoboxseite): LandmarkeLesen {
    const treffer = landmarkenArtDerSeite(seite);
    if (treffer === null) return { ok: false, grund: "keine_landmarke", infobox: seite.infobox };
    const felder: Record<string, string> = {};
    const setze = (name: string, wert: string): void => {
        const sauber = phpTrim(wert);
        if (sauber !== "") felder[name] = sauber;
    };
    const mitKasten = istRegion(seite);
    setze("name", kuerze((mitKasten ? feld(seite, ["name"]) : "") || seite.titel, 255));
    setze("art", treffer.art);
    setze("wiki_art", kuerze(treffer.wikiArt, 120));
    if (mitKasten) {
        setze("region", kuerze(feld(seite, ["region", "regionen"]), 255));
        // Die Höhe nur, wo die Landmarke eine trägt (Berg und Vulkan formen Gelände).
        if (treffer.art === "berggipfel" || treffer.art === "vulkan") {
            const hoehe = gipfelHoehe(feld(seite, ["hohe", "hoehe"]));
            if (hoehe !== null) felder["height"] = String(hoehe);
        }
    }
    setze("kurzbeschreibung", kuerze(ersterAbsatz(seite.wikitext, seite.block), 2000));
    if ((felder["name"] ?? "") === "") return { ok: false, grund: "name_fehlt", infobox: seite.infobox };
    return { ok: true, infobox: seite.infobox, felder, art: treffer.art };
}
