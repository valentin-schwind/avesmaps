import { klassifiziere } from "../infobox/lesen.ts";
import { feld, type Infoboxseite } from "../infobox/seite.ts";
import { kuerze, LEER, phpTrim } from "../infobox/text.ts";
import { istAusgeschlossenerBauwerkTyp } from "./auswerten.ts";
import { BAUWERK_AUSGESCHLOSSEN, ORTSGROESSE_KATEGORIEN } from "./konstanten.ts";

/**
 * Die Wahl von Ortsgröße und Bauwerkart für EINE Seite (WI-0253 C-2, WI-0294; der Rückfall auf die Infobox WI-0295 T1). REIN und ohne den Plan: Der Abgleich der zugewiesenen Orte (`aus-datei.ts`) und der
 * artikelzentrierte Zweig der neuen Orts-Artikel (`abgleich/ort-artikel.ts`) wählen mit denselben Funktionen.
 */

/** Die Klasse einer Seite: die erste Siedlungsgröße in der Reihenfolge von Legacy, in deren Kategorie sie steht; `undefined`: in keiner. */
export function waehleKlasse(kategorien: readonly string[]): string | undefined {
    return ORTSGROESSE_KATEGORIEN.find((eintrag) => kategorien.includes(eintrag.kategorie))?.klasse;
}

/** Die Art einer Seite: die erste Art der (fertigen, geordneten) Liste, in deren Kategorie sie steht; `undefined`: in keiner. */
export function waehleArt(kategorien: readonly string[], arten: readonly string[]): string | undefined {
    return arten.find((name) => kategorien.includes(name));
}

/** Was Legacys Infobox-Leser bei leerem `Art=` als Art einsetzt (das Wort der Klasse `gebaeude`): kein Wert des Wikis (`avesmapsWikiSettlementClassLabel`). */
const KLASSENWORT_GEBAEUDE = "Gebäude";

/** Ist die erste Infobox eine der Bauwerke (dasselbe Tor wie der Klassifikator: Bauwerk, Festung, Burg, Lehreinrichtung, Geschäft) und geschlossen? */
export const istBauwerkInfobox = (seite: Infoboxseite): boolean =>
    klassifiziere(seite.infoboxSchluessel) === "bauwerk" && seite.block.geschlossen;

/** Der erste Wert von `Art=` (sonst `Typ=`) der Infobox, bereinigt (`[[Burg (Architektur)|Burg]]` wird „Burg“), vor einem `|`; `""`, wenn keiner. */
function ersteArtDerInfobox(seite: Infoboxseite): string {
    const roh = phpTrim(feld(seite, ["art", "typ"]));
    return phpTrim(roh.split(new RegExp(`${LEER}*\\|${LEER}*`, "u"))[0] ?? "");
}

/**
 * Die Bauwerkart aus der Infobox einer Seite (WI-0295 T1), Legacys Rückfall im Dump-Pfad (`avesmapsWikiDumpParseBuildingPage`, Mirror 96dda99b4): Steht die Seite in keiner Art-Kategorie, gilt `Art=` (sonst
 * `Typ=`) der Infobox Bauwerk, davon der erste Wert. Eine lineare Anlage (Straße, Mauer, Damm …) ist keine Art eines Punkts (`istAusgeschlossenerBauwerkTyp`), ebenso das Wort der Klasse („Gebäude“).
 * `undefined`: die Seite nennt keine.
 */
export function bauwerkartAusInfobox(seite: Infoboxseite): string | undefined {
    if (!istBauwerkInfobox(seite)) return undefined;
    const erster = ersteArtDerInfobox(seite);
    if (erster === "" || erster === KLASSENWORT_GEBAEUDE) return undefined;
    if (istAusgeschlossenerBauwerkTyp(erster, BAUWERK_AUSGESCHLOSSEN)) return undefined;
    return kuerze(erster, 120);
}

/**
 * Nennt die Seite eine lineare Anlage (eine Kategorie oder die Art der Infobox Bauwerk ist Straße, Mauer, Damm, Deich, Kanalisation oder Äquadukt)? Legacy blendet solche Zeilen in der Ortsliste aus
 * (`building_type_excluded`); als neuer Orts-Artikel wird eine solche Seite nicht geführt (WI-0295).
 */
export function nenntLineareAnlage(seite: Infoboxseite, kategorien: readonly string[]): boolean {
    if (kategorien.some((kategorie) => istAusgeschlossenerBauwerkTyp(kategorie, BAUWERK_AUSGESCHLOSSEN))) return true;
    return istBauwerkInfobox(seite) && istAusgeschlossenerBauwerkTyp(ersteArtDerInfobox(seite), BAUWERK_AUSGESCHLOSSEN);
}
