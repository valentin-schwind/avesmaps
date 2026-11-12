import { createHash } from "node:crypto";
import { LANDMARKE_FELDER, landmarkeSchluessel } from "../infobox/landmarke.ts";
import { ARTIKEL_FELD } from "./sprachen.ts";

/**
 * Die Kandidaten der Landmarken im Abgleich (WI-0271 L7, Bereich `gipfel`): die Wörter, die Plan, Lader und Schreiber teilen. REIN, ohne Datenbank.
 *
 * ARTIKELZENTRIERT wie die Sprachen (`sprachen.ts`, derselbe Planzweig `planeArtikelBereich`): Das Objekt ist der Wiki-Stand eines Landmarken-Artikels ohne Landmarke auf der Karte
 * (`wiki_landmarke_artikel`, Migration 0290), ein Kandidat ◐. Der WikiSync führt seinen Lebenslauf (Feld `artikel`): anlegen, still legen (der Artikel verschwand, ist keine Landmarke
 * mehr oder hängt inzwischen an einer Landmarke der Karte), beleben. 🔴 Er legt nie eine Landmarke auf die Karte und setzt nie eine Lage; die Unterdrückung („nicht auf die Karte“) schreibt nur
 * die Redaktion.
 */

/** Die Art des Objekts in den Zeilen des Plans, im Protokoll der Übernahme und im Fachprotokoll. */
export const LANDMARKE_ARTIKEL_ART = "landmarke_artikel";

/** Alle Felder eines Landmarken-Artikels im Plan, in der Reihenfolge des Berichts: zuerst der Lebenslauf (derselbe wie bei den Sprachen), dann die Felder des Wiki-Stands. */
export const LANDMARKEN_PLANFELDER: readonly string[] = [ARTIKEL_FELD, ...LANDMARKE_FELDER];

/** Feld des Plans → Spalte in `wiki_landmarke_artikel`. `artikel` ist keine Spalte: Der Schreiber setzt daraus Titel und Zustand. */
export const LANDMARKE_SPALTEN: Readonly<Record<string, string>> = {
    [ARTIKEL_FELD]: ARTIKEL_FELD,
    name: "name",
    art: "art",
    wiki_art: "wiki_art",
    region: "region",
    height: "hoehe_schritt",
    kurzbeschreibung: "kurzbeschreibung",
};

/** Die Adresse eines Landmarken-Artikels im Wiki. */
export const landmarkeAdresse = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

/** Die Platzhalter-Kennung eines Artikels, den der Bestand noch nicht hat: eine UUID aus seinem Schlüssel (dieselbe in Vorschau und Übernahme; anderer Salz als die Sprachen). */
export function neueLandmarkeId(schluessel: string): string {
    const hash = createHash("sha256").update(`wikisync|landmarke-neu|${schluessel}`, "utf8").digest("hex");
    const hex = hash.slice(0, 32).split("");
    hex[12] = "5";
    hex[16] = "8";
    const roh = hex.join("");
    return `${roh.slice(0, 8)}-${roh.slice(8, 12)}-${roh.slice(12, 16)}-${roh.slice(16, 20)}-${roh.slice(20, 32)}`;
}

/** Gehört die Zeile zu einem Artikel, den der Bestand noch nicht hat? Ihre Kennung ist dann der Platzhalter ihres Artikels. */
export function istNeueLandmarke(zeile: { objektId: string | null; artikel: string | null }): boolean {
    return (
        zeile.objektId !== null &&
        zeile.artikel !== null &&
        zeile.objektId === neueLandmarkeId(landmarkeSchluessel(zeile.artikel))
    );
}

/** Gründe im Bericht (`grund`, höchstens 200 Zeichen). */
export const GRUND_LANDMARKE_NEU = "Landmarken-Artikel ohne Landmarke auf der Karte: wird Kandidat";
export const GRUND_LANDMARKE_WIEDER = "Wieder ein Landmarken-Artikel ohne Landmarke im Dump: lebt wieder auf";
export const GRUND_LANDMARKE_NICHT_IM_DUMP = "Nicht mehr im Dump: wird still gelegt";
/** Die Seite steht noch im Dump, ist aber keine Landmarke mehr (Infobox oder Art außerhalb der Abbildung): Der Sammler nimmt sie dann nicht, der Grund ist derselbe. */
export const GRUND_LANDMARKE_KEINE =
    "Keine Landmarke mehr (Infobox Region mit einer Art der Abbildung): wird still gelegt";
export const GRUND_LANDMARKE_AUF_DER_KARTE = "Hängt an einer Landmarke der Karte: wird still gelegt";
