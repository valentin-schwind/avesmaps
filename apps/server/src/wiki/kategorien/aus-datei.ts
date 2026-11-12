import { kandidatenTitel, type PlanObjekt } from "../abgleich/plan.ts";
import type { GelesenerDumpArtikel, SeiteImDump } from "../dump/seiten-sammler.ts";
import { analysiere } from "../infobox/seite.ts";
import { normalisiereTitel } from "../infobox/text.ts";
import { titelAusWikiAdresse } from "../vorschau/adresse.ts";
import { kontinentVonSeite, ohneKategoriePraefix, titelSchluessel } from "./auswerten.ts";
import { schliesseArtenAb } from "./bauwerkarten.ts";
import { leseKategorienZeilen } from "./datei.ts";
import { BAUWERK_OBERKATEGORIE, istWikiTeilBereich, type Ergebnisse, type WikiTeilBereich } from "./konstanten.ts";
import { bauwerkartAusInfobox, waehleArt, waehleKlasse } from "./waehlen.ts";

export { bauwerkartAusInfobox, waehleArt, waehleKlasse };

/**
 * Ortsgröße, Bauwerkart und Kontinent aus der Datei `dump_categorylinks.sql.gz` (WI-0294). Dieselben Ergebnisse (Titel → Klasse, Art, Kontinent) wie die Kategorie-Abfragen der API, gerechnet aus den
 * Kategorien JEDER gesuchten Seite statt aus den Mitgliedern jeder Kategorie:
 *
 *   - **Ortsgröße:** die erste Kategorie der Liste `ORTSGROESSE_KATEGORIEN`, in der die Seite steht (Legacy-Reihenfolge, der erste Treffer gewinnt). Nur Seiten des Hauptraums, wie `cmnamespace=0`.
 *   - **Bauwerkart:** die erste Art der Artenliste, in der die Seite steht. Die Liste sind die lebenden Unterkategorien von „Bauwerk nach Art“ in der Reihenfolge der API (Sortierschlüssel, dann
 *     Seitennummer), dann Legacys Liste, soweit sie fehlt, ohne die linearen Anlagen (`schliesseArtenAb`). Nur Seiten des Hauptraums.
 *   - **Kontinent:** `kontinentVonSeite` über Titel und Kategorien der Seite, in jedem Namensraum, wie `prop=categories`.
 *
 * REIN, soweit nicht ausdrücklich gelesen wird: `leseArtSeiten` und `leseKategorienJeSeite` lesen die Datei (Strom), `baueErgebnisse` und `ordneArten` rechnen nur. „Die Seite steht in keiner Klasse“
 * ist kein Wert (kein Eintrag), nicht „keine Klasse“: Die Klasse eines Ortes kann aus dem Text stammen (`kategorien/plan.ts`).
 */

/** `cl_to` der Oberkategorie der Arten, mit Unterstrichen wie im Wiki. */
const OBERKATEGORIE_NAME = BAUWERK_OBERKATEGORIE.replaceAll(" ", "_");

/** Der Name einer Kategorie, wie die API ihn nennt: mit Leerzeichen statt Unterstrichen. */
export const alsKategorienName = (nach: string): string => nach.replaceAll("_", " ");

/** Die Kategorien je Seitennummer, mit Leerzeichen, in der Reihenfolge der Datei. */
export type KategorienJeSeite = ReadonlyMap<number, readonly string[]>;

/** Eine Unterkategorie von „Bauwerk nach Art“: die Nummer ihrer Kategorieseite und ihr Sortierschlüssel (`cl_sortkey`). */
export interface ArtSeite {
    id: number;
    sortierschluessel: string;
}

/** Durchgang 1: die Kategorieseiten der Arten, also die Unterkategorien von „Bauwerk nach Art“. Ihre Namen stehen erst im XML-Dump (Namensraum 14). */
export async function leseArtSeiten(pfad: string): Promise<ArtSeite[]> {
    const seiten: ArtSeite[] = [];
    for await (const zeile of leseKategorienZeilen(pfad)) {
        if (zeile.art === "subcat" && zeile.nach === OBERKATEGORIE_NAME) {
            seiten.push({ id: zeile.von, sortierschluessel: zeile.sortierschluessel });
        }
    }
    return seiten;
}

/** Bytes eines Sortierschlüssels: das Wiki sortiert `cl_sortkey` als Bytes (`varbinary`), nicht nach Zeichen. */
const alsBytes = (text: string): Buffer => Buffer.from(text, "utf8");

/**
 * Die fertige Artenliste aus den Kategorieseiten und ihren Titeln: die Unterkategorien in der Reihenfolge, in der die API sie liefert (`list=categorymembers&cmtype=subcat`: Sortierschlüssel,
 * dann Seitennummer), dann Legacys Liste, soweit sie fehlt (`schliesseArtenAb`). `ohneTitel` zählt die Kategorieseiten, die der XML-Dump nicht kennt (die Kategorie ist neuer als der Dump);
 * ihre Art fehlt dann in der Liste, bis Legacys Liste sie nennt.
 */
export function ordneArten(
    seiten: readonly ArtSeite[],
    titelJeId: ReadonlyMap<number, string>,
): { arten: string[]; ohneTitel: number } {
    const geordnet = [...seiten].sort(
        (a, b) => Buffer.compare(alsBytes(a.sortierschluessel), alsBytes(b.sortierschluessel)) || a.id - b.id,
    );
    const lebende: string[] = [];
    let ohneTitel = 0;
    for (const seite of geordnet) {
        const titel = titelJeId.get(seite.id);
        if (titel === undefined) {
            ohneTitel += 1;
            continue;
        }
        const art = ohneKategoriePraefix(titel).trim();
        if (art !== "" && !lebende.includes(art)) lebende.push(art);
    }
    return { arten: schliesseArtenAb(lebende), ohneTitel };
}

/** Durchgang 2: die Kategorien der verlangten Seiten. Eine Seite ohne Zeile in der Datei fehlt in der Karte (sie hat keine Kategorie). */
export async function leseKategorienJeSeite(pfad: string, ids: ReadonlySet<number>): Promise<KategorienJeSeite> {
    const jeSeite = new Map<number, string[]>();
    if (ids.size === 0) return jeSeite;
    for await (const zeile of leseKategorienZeilen(pfad)) {
        if (!ids.has(zeile.von)) continue;
        const liste = jeSeite.get(zeile.von);
        if (liste === undefined) jeSeite.set(zeile.von, [alsKategorienName(zeile.nach)]);
        else liste.push(alsKategorienName(zeile.nach));
    }
    return jeSeite;
}

/** Wer in den Wiki-Teil gehört: ein Objekt der Bereiche mit Kategorien, dessen Zuordnung nicht getrennt oder unterdrückt ist. */
function istKandidat(objekt: PlanObjekt): boolean {
    return istWikiTeilBereich(objekt.bereich) && objekt.zustand !== "getrennt" && objekt.zustand !== "unterdrueckt";
}

/**
 * Der Titel, unter dem ein Objekt in der Titelliste der Abfrage stand: der Titel der Adresse, normalisiert; `null` bei einem Titel, der im Wiki ungültig ist (ein „|“ oder Zeilenwechsel sprengte
 * als Teil der Abfrage den Stapel und steht auch in keiner Datei).
 */
function abfrageTitel(objekt: PlanObjekt): string | null {
    const roh = titelAusWikiAdresse(objekt.adresse);
    if (roh === null) return null;
    const titel = normalisiereTitel(roh);
    return titel === "" || /[|\n\r]/u.test(titel) ? null : titel;
}

/** Die Seite im Dump zu einer Adresse: die erste der Titel-Kandidaten (wörtlich, mit großem Anfangsbuchstaben), die der Dump kennt. Eine Weiterleitung hat keine eigenen Kategorien. */
function seiteZu(objekt: PlanObjekt, seiteJeTitel: ReadonlyMap<string, SeiteImDump>): SeiteImDump | undefined {
    for (const titel of kandidatenTitel(objekt.adresse)) {
        const seite = seiteJeTitel.get(titel);
        if (seite !== undefined) return seite.weiterleitung ? undefined : seite;
    }
    return undefined;
}

/** Die Seitennummern, deren Kategorien der Wiki-Teil braucht: die Seiten der Objekte der drei Bereiche. */
export function seitenFuerKategorien(
    objekte: readonly PlanObjekt[],
    seiteJeTitel: ReadonlyMap<string, SeiteImDump>,
): Set<number> {
    const ids = new Set<number>();
    for (const objekt of objekte) {
        if (!istKandidat(objekt) || abfrageTitel(objekt) === null) continue;
        const seite = seiteZu(objekt, seiteJeTitel);
        if (seite !== undefined) ids.add(seite.id);
    }
    return ids;
}

export interface ErgebnisEingabe {
    objekte: readonly PlanObjekt[];
    /** Die gesuchten Titel, wie der Dump sie führt, mit ihrer Seite. */
    seiteJeTitel: ReadonlyMap<string, SeiteImDump>;
    kategorienJeSeite: KategorienJeSeite;
    /** Die fertige Artenliste (`ordneArten`). */
    arten: readonly string[];
}

const nachId = (a: PlanObjekt, b: PlanObjekt): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Die Ergebnisse je Bereich und Form, nach dem Schlüssel des Titels (`titelSchluessel`), für die Objekte der Karte: derselbe Schlüssel, unter dem `berechneKategorienZeilen` sie sucht. Ein Objekt,
 * dessen Artikel der Dump nicht kennt (oder eine Weiterleitung ist), bekommt keinen Wert; der Plan nimmt es ohnehin aus (Befund zum Artikel).
 */
export function baueErgebnisse(eingabe: ErgebnisEingabe): Record<WikiTeilBereich, Ergebnisse> {
    const karten: Record<WikiTeilBereich, Record<string, Map<string, string>>> = {
        ort: { ortsgroesse: new Map(), bauwerkart: new Map() },
        gebiet: { kontinent: new Map() },
        region: { kontinent: new Map() },
    };
    const setze = (karte: Map<string, string> | undefined, schluessel: string, wert: string): void => {
        if (karte !== undefined && !karte.has(schluessel)) karte.set(schluessel, wert);
    };
    for (const objekt of [...eingabe.objekte].sort(nachId)) {
        if (!istKandidat(objekt)) continue;
        const bereich = objekt.bereich as WikiTeilBereich;
        const titel = abfrageTitel(objekt);
        if (titel === null) continue;
        const seite = seiteZu(objekt, eingabe.seiteJeTitel);
        if (seite === undefined) continue;
        const kategorien = eingabe.kategorienJeSeite.get(seite.id) ?? [];
        const schluessel = titelSchluessel(titel);
        const karte = karten[bereich];
        if (bereich === "ort") {
            // Nur der Hauptraum, wie `cmnamespace=0` der Mitglieder-Abfragen.
            if (seite.ns !== 0) continue;
            const klasse = waehleKlasse(kategorien);
            if (klasse !== undefined) setze(karte["ortsgroesse"], schluessel, klasse);
            const art = waehleArt(kategorien, eingabe.arten);
            if (art !== undefined) setze(karte["bauwerkart"], schluessel, art);
        } else {
            setze(karte["kontinent"], schluessel, kontinentVonSeite(titel, kategorien));
        }
    }
    return { ort: karten.ort, gebiet: karten.gebiet, region: karten.region };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Der Rückfall der Bauwerkart auf `Art=` (WI-0295 T1)
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Die eine Seite einer Adresse im Dump, wie der Plan sie findet (wörtlich oder mit großem Anfangsbuchstaben); `undefined` bei keiner, mehreren oder einer Weiterleitung. */
function artikelZu(
    objekt: PlanObjekt,
    gefunden: ReadonlyMap<string, readonly GelesenerDumpArtikel[]>,
): GelesenerDumpArtikel | undefined {
    const seiten = kandidatenTitel(objekt.adresse).flatMap((titel) => gefunden.get(titel) ?? []);
    const [seite] = seiten;
    return seiten.length === 1 && seite !== undefined && seite.weiterleitung === null ? seite : undefined;
}

/**
 * Ergänzt die Bauwerkarten der Orte um den Rückfall auf die Infobox (WI-0295 T1), nach `baueErgebnisse`: Wer aus den Kategorien eine Art hat, behält sie (`waehleArt`, unverändert); jeder andere Ort mit Wiki-Adresse,
 * dessen Artikel der Dump genau einmal und als Artikel führt, bekommt `bauwerkartAusInfobox`. Derselbe Schlüssel (`titelSchluessel`), damit `berechneKategorienZeilen` den Wert findet. Gibt eine neue Karte
 * zurück und lässt die alte unberührt; REIN.
 */
export function ergaenzeBauwerkart(
    bauwerkart: ReadonlyMap<string, string> | undefined,
    objekte: readonly PlanObjekt[],
    gefunden: ReadonlyMap<string, readonly GelesenerDumpArtikel[]>,
): Map<string, string> {
    const ergebnis = new Map(bauwerkart ?? []);
    for (const objekt of [...objekte].sort(nachId)) {
        if (objekt.bereich !== "ort" || !istKandidat(objekt)) continue;
        const titel = abfrageTitel(objekt);
        if (titel === null) continue;
        const schluessel = titelSchluessel(titel);
        if (ergebnis.has(schluessel)) continue;
        const seite = artikelZu(objekt, gefunden);
        if (seite === undefined) continue;
        const art = bauwerkartAusInfobox(analysiere(seite.titel, seite.text));
        if (art !== undefined) ergebnis.set(schluessel, art);
    }
    return ergebnis;
}
