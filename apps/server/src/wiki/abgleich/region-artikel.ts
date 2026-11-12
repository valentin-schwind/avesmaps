import { createHash } from "node:crypto";
import { BEREICH_FELDER } from "../infobox/lesen.ts";
import { ARTIKEL_FELD } from "./sprachen.ts";

/**
 * Die Wiki-Einträge ohne Fläche im Abgleich (WI-0284, Bereich `region`): die Wörter, die Plan, Lader und Schreiber teilen. REIN, ohne Datenbank.
 *
 * ARTIKELZENTRIERT wie Sprachen und Landmarken (Planzweig `planeArtikelBereich`): Das Objekt ist die Zeile in `wiki_region_snapshot` eines Artikels, an dem keine Fläche hängt. Der WikiSync führt
 * ihren Lebenslauf (Feld `artikel`): anlegen, still legen, beleben. Hängt ein Editor den Artikel an eine Fläche, ist dieselbe Zeile der Wiki-Stand der Fläche und gehört zum gewöhnlichen Abgleich der Landschaften.
 * 🔴 Der WikiSync legt nie eine Fläche an und ändert nie eine Zuordnung.
 */

/** Die Art des Objekts in den Zeilen des Plans, im Protokoll der Übernahme und im Fachprotokoll. */
export const REGION_ARTIKEL_ART = "region_artikel";

/** Alle Felder im Plan: zuerst der Lebenslauf, dann die Felder der Infobox wie bei einer Landschaft. */
export const REGION_ARTIKEL_PLANFELDER: readonly string[] = [ARTIKEL_FELD, ...BEREICH_FELDER.region];

/** Die Platzhalter-Kennung eines Artikels, den der Bestand noch nicht hat: eine UUID aus seinem Schlüssel (dieselbe in Vorschau und Übernahme; anderes Salz als Sprachen und Landmarken). */
export function neueRegionArtikelId(schluessel: string): string {
    const hash = createHash("sha256").update(`wikisync|region-artikel-neu|${schluessel}`, "utf8").digest("hex");
    const hex = hash.slice(0, 32).split("");
    hex[12] = "5";
    hex[16] = "8";
    const roh = hex.join("");
    return `${roh.slice(0, 8)}-${roh.slice(8, 12)}-${roh.slice(12, 16)}-${roh.slice(16, 20)}-${roh.slice(20, 32)}`;
}

/** Gründe im Bericht (`grund`, höchstens 200 Zeichen). */
export const GRUND_REGION_ARTIKEL_NEU = "Wiki-Eintrag ohne Fläche: kommt in die Liste";
export const GRUND_REGION_ARTIKEL_WIEDER = "Wieder ein Eintrag ohne Fläche im Dump: lebt wieder auf";
export const GRUND_REGION_ARTIKEL_NICHT_IM_DUMP = "Nicht mehr im Dump: wird still gelegt";
export const GRUND_REGION_ARTIKEL_KEINER =
    "Gehört nicht mehr in die Liste (Landmarke, anderer Kontinent, weder Infobox Region noch Wind): wird still gelegt";
export const GRUND_REGION_ARTIKEL_BELEGT = "Hängt an einer Fläche der Karte: wird dort abgeglichen";
