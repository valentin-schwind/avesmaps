import { createHash } from "node:crypto";
import { klassifiziere, leseSeitenFelder } from "../infobox/lesen.ts";
import { nenntAnderenKontinent } from "../infobox/region-artikel.ts";
import { feldRoh, type Infoboxseite } from "../infobox/seite.ts";
import { vorlagenNamen } from "../infobox/sprache.ts";
import { kuerze, normalisiereTitel, phpTrim, schluesselform } from "../infobox/text.ts";
import {
    bauwerkartAusInfobox,
    istBauwerkInfobox,
    nenntLineareAnlage,
    waehleArt,
    waehleKlasse,
} from "../kategorien/waehlen.ts";
import { weiterleitungsZiel, wikiSchluesselFuerTitel } from "../schluessel.ts";
import { normTitel, zielKlasse, type ZielWissen } from "./ortsrolle.ts";
import { ARTIKEL_FELD } from "./sprachen.ts";

/**
 * Die neuen Orts- und Bauwerk-Artikel im Abgleich (WI-0295 Teil 2, Bereich `ort`): die Wörter und Regeln, die Plan, Lader und Schreiber teilen. REIN, ohne Datenbank.
 *
 * ARTIKELZENTRIERT wie die Wiki-Einträge ohne Fläche (WI-0284, `region-artikel.ts`): Das Objekt ist eine Zeile der Registry `wiki_settlement_registry` mit `source_system = 'wikisync'`, dazu ihre genannten Orte
 * (`…_named_place`, die Standort-Kette) und ihr Wiki-Stand (`wiki_settlement_snapshot`, dieselbe Seite; die Wiki-Box sucht darin). Der WikiSync führt ihren Lebenslauf (Feld `artikel`): anlegen, Felder
 * nachführen, still legen, beleben. Legacys Zeilen (`source_system = 'legacy'`) fasst er nie an. Weist ein Editor den Artikel einem Ort zu, gehört der Wiki-Stand dem Ort und seinem Abgleich; der Lader nimmt die
 * Zeile dann nicht mehr (`ladeOrtArtikel`). 🔴 Der WikiSync setzt nie einen Ort auf die Karte und ändert keine Zuordnung.
 *
 * Welche Seiten dazugehören: die erste Infobox ist eine der Bauwerke oder der Siedlungen (`klassifiziere`, dasselbe Tor wie Legacys Klassifikator), die Seite ist aventurisch (Kategorie „Aventurien-Artikel“,
 * sonst die Regel der Wiki-Einträge ohne Fläche samt Elternkette) und nennt keine lineare Anlage (Straße, Mauer …), und weder die Karte noch Legacys Registry kennt den Titel.
 */

/** Die Art des Objekts in den Zeilen des Plans, im Protokoll der Übernahme und im Fachprotokoll. */
export const ORT_ARTIKEL_ART = "ort_artikel";

/** Die Felder eines Orts-Artikels im Plan, in der Reihenfolge des Berichts (ohne den Lebenslauf). */
export const ORT_ARTIKEL_FELDER: readonly string[] = [
    "name",
    "settlement_class",
    "building_type",
    "lage",
    "standort",
    "standort_orte",
    "ruine",
    "einwohner",
    "oberhaupt",
    "region_text",
    "staat_text",
    "handelszone",
    "verkehrswege",
    "bevoelkerung",
    "tempel",
    "description",
];

/** Alle Felder im Plan: zuerst der Lebenslauf (derselbe wie bei Sprachen, Landmarken und Wiki-Einträgen), dann die Felder. */
export const ORT_ARTIKEL_PLANFELDER: readonly string[] = [ARTIKEL_FELD, ...ORT_ARTIKEL_FELDER];

/** Die Kategorie, mit der das Wiki einen aventurischen Artikel kennzeichnet (auch ohne `{{Aventurien}}` im Text, Burg Wandleth). */
export const KATEGORIE_AVENTURIEN = "Aventurien-Artikel";

/** Kategorien, die einen Artikel einer anderen Welt kennzeichnen. */
const FREMDE_ARTIKEL_KATEGORIEN: ReadonlySet<string> = new Set(
    ["Myranor", "Uthuria", "Tharun", "Rakshazar", "Riesland"].map((welt) => `${welt}-Artikel`),
);

/** Der Schlüssel eines Orts-Artikels: Legacys Key der Registry (`wiki:` + Slug des Titels, dieselbe Rechnung wie X1/X2, `wikiSchluesselFuerTitel`). */
export const ortArtikelSchluessel = (titel: string): string => wikiSchluesselFuerTitel(normalisiereTitel(titel));

/** Der Schlüssel desselben Artikels im Wiki-Stand der Orte (`wiki_settlement_snapshot.wiki_key`): der Slug ohne `wiki:`, wie Legacy ihn dort führt. */
export const ortArtikelStandSchluessel = (schluessel: string): string =>
    schluessel.startsWith("wiki:") ? schluessel.slice("wiki:".length) : schluessel;

/** Die Platzhalter-Kennung eines Artikels, den der Bestand noch nicht hat: eine UUID aus seinem Schlüssel (dieselbe in Vorschau und Übernahme; anderes Salz als Sprachen, Landmarken und Wiki-Einträge). */
export function neueOrtArtikelId(schluessel: string): string {
    const hash = createHash("sha256").update(`wikisync|ort-artikel-neu|${schluessel}`, "utf8").digest("hex");
    const hex = hash.slice(0, 32).split("");
    hex[12] = "5";
    hex[16] = "8";
    const roh = hex.join("");
    return `${roh.slice(0, 8)}-${roh.slice(8, 12)}-${roh.slice(12, 16)}-${roh.slice(16, 20)}-${roh.slice(20, 32)}`;
}

/** Gehört die Zeile zu einem Artikel, den der Bestand noch nicht hat? Ihre Kennung ist dann der Platzhalter ihres Artikels. */
export function istNeuerOrtArtikel(zeile: { objektId: string | null; artikel: string | null }): boolean {
    return (
        zeile.objektId !== null &&
        zeile.artikel !== null &&
        zeile.objektId === neueOrtArtikelId(ortArtikelSchluessel(zeile.artikel))
    );
}

/** Gründe im Bericht (`grund`, höchstens 200 Zeichen). */
export const GRUND_ORT_ARTIKEL_NEU = "Neuer Orts- oder Bauwerk-Artikel: kommt als Eintrag ohne Ort in die Ortsliste";
export const GRUND_ORT_ARTIKEL_WIEDER = "Wieder ein Orts- oder Bauwerk-Artikel im Dump: lebt wieder auf";
export const GRUND_ORT_ARTIKEL_NICHT_IM_DUMP = "Nicht mehr im Dump: wird still gelegt";
export const GRUND_ORT_ARTIKEL_KEINER =
    "Gehört nicht mehr dazu (keine Infobox Bauwerk oder Siedlung, anderer Kontinent, lineare Anlage): wird still gelegt";
export const GRUND_ORT_ARTIKEL_BEKANNT = "Die Karte oder Legacys Registry kennt den Artikel: wird still gelegt";

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die genannten Orte (Standort-Kette)
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ein Linkziel der Standort-Kette: das Ziel wörtlich und Legacys Key (`null`: keiner). */
export interface GenannterOrt {
    ziel: string;
    schluessel: string | null;
}

/** Legacys Linkziele eines Feldwerts (`avesmapsWikiLinkZielePaareMitPosition`, `link-ziele.php`): je `[[Ziel|Text]]` das Ziel ohne Abschnitt, in der Reihenfolge des Quelltexts. */
const LINKZIEL = /\[\[\s*([^\]|#<>[]+?)\s*(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/gu;

/**
 * Die genannten Orte einer Standort-Kette mit Legacys Key (`avesmapsExportLinkziele`, `wiki-siedlungen-export.php`): Ist das Ziel eine Weiterleitung, gilt der Key ihres Ziels (Legacys Tafel der Aliase,
 * `weiterleitungsZiel`), sonst der Key des Titels. „Gülden“ wird so `wiki:elenvina`, „Schlossviertel“ `wiki:alt-gareth`. Ohne das Wissen des Dumps (`wissen`) bleibt es beim Key des Titels.
 */
export function genannteOrte(standort: string, wissen: ZielWissen | undefined): GenannterOrt[] {
    if (phpTrim(standort) === "" || !standort.includes("[[")) return [];
    const aus: GenannterOrt[] = [];
    for (const treffer of standort.matchAll(LINKZIEL)) {
        const ziel = (treffer[1] ?? "").trim();
        if (ziel === "") continue;
        const weiterleitung = wissen?.info(normTitel(normalisiereTitel(ziel)))?.weiterleitung;
        const umgeleitet = weiterleitung === undefined ? "" : weiterleitungsZiel(weiterleitung);
        const schluessel = umgeleitet !== "" ? `wiki:${umgeleitet}` : wikiSchluesselFuerTitel(normalisiereTitel(ziel));
        aus.push({ ziel, schluessel: schluessel === "" ? null : schluessel });
    }
    return aus;
}

/** Der Trenner zwischen Ziel und Key im Wert des Felds `standort_orte` (eine Zeile je Ort). */
const PFEIL = " → ";

/** Der Wert des Felds `standort_orte` im Plan: je Ort eine Zeile „Ziel → Key“ (ohne Key nur das Ziel). */
export const standortOrteWert = (orte: readonly GenannterOrt[]): string =>
    orte.map((ort) => (ort.schluessel === null ? ort.ziel : `${ort.ziel}${PFEIL}${ort.schluessel}`)).join("\n");

/** Liest den Wert des Felds `standort_orte` zurück (die Übernahme schreibt daraus die genannten Orte). Ein Key beginnt immer mit `wiki:`. */
export function leseStandortOrte(wert: string | null): GenannterOrt[] {
    if (wert === null || wert.trim() === "") return [];
    return wert
        .split("\n")
        .map((zeile) => zeile.trim())
        .filter((zeile) => zeile !== "")
        .map((zeile) => {
            const stelle = zeile.lastIndexOf(`${PFEIL}wiki:`);
            return stelle < 0
                ? { ziel: zeile, schluessel: null }
                : { ziel: zeile.slice(0, stelle), schluessel: zeile.slice(stelle + PFEIL.length) };
        });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Welche Seiten dazugehören, und ihre Felder
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Bauwerk oder Siedlung: die Art der ersten Infobox (Legacys Klassifikator); `null` sonst. */
export function ortArtikelArtDerSeite(seite: Infoboxseite): "bauwerk" | "ort" | null {
    if (seite.infobox === "" || !seite.block.geschlossen) return null;
    const art = klassifiziere(seite.infoboxSchluessel);
    return art === "bauwerk" || art === "ort" ? art : null;
}

/**
 * Ist die Seite aventurisch? Die Kategorie „Aventurien-Artikel“ entscheidet zuerst, die eines anderen Kontinents ebenso. Sonst gilt die Regel der Wiki-Einträge ohne Fläche (WI-0284): `{{Aventurien}}` oder keine
 * Vorlage eines anderen Kontinents, und die Elternkette (`Region=`) führt nicht in eine andere Welt (`zielKlasse`). Ohne jede Aussage gehört die Seite dazu: lieber einer zu viel.
 */
export function istAventurischerOrtArtikel(
    seite: Infoboxseite,
    kategorien: readonly string[],
    wissen: ZielWissen | undefined,
): boolean {
    if (kategorien.includes(KATEGORIE_AVENTURIEN)) return true;
    if (kategorien.some((kategorie) => FREMDE_ARTIKEL_KATEGORIEN.has(kategorie))) return false;
    const vorlagen = vorlagenNamen(seite.wikitext);
    if (!vorlagen.includes("Aventurien") && vorlagen.some(nenntAnderenKontinent)) return false;
    return wissen === undefined || zielKlasse(seite.titel, wissen) !== "fremd";
}

/** Gehört die Seite zu den Orts-Artikeln (ohne die Frage, ob die Karte sie kennt)? */
export function gehoertZuDenOrtArtikeln(
    seite: Infoboxseite,
    kategorien: readonly string[],
    wissen: ZielWissen | undefined,
): boolean {
    if (ortArtikelArtDerSeite(seite) === null) return false;
    if (nenntLineareAnlage(seite, kategorien)) return false;
    return istAventurischerOrtArtikel(seite, kategorien, wissen);
}

/** Wie Legacy einen Artikel als Ruine erkennt: die Art der Infobox nennt „Ruine“ oder „zerstört“, oder die Bauwerkart nennt „Ruine“ (`avesmapsWikiSettlementBuildEnrichment`, `dump-entity-scan.php`). */
function istRuine(seite: Infoboxseite, bauwerkart: string | undefined): boolean {
    const art = schluesselform(feldRoh(seite, ["siedlungsart", "art", "typ"]));
    if (art !== "" && (art.includes("ruine") || art.includes("zerstor"))) return true;
    return bauwerkart !== undefined && bauwerkart.toLowerCase().includes("ruine");
}

/**
 * Liest die Felder eines Orts-Artikels: die Felder der Infobox wie bei einem Ort (`leseSeitenFelder("ort")`), dazu
 * - **Ortsklasse:** ein Bauwerk ist `gebaeude`; eine Siedlung die Größe aus den Kategorien (nur der Hauptraum, wie bei den zugewiesenen Orten). Ohne sie fehlt das Feld: Die Registry führt dann „dorf“ als
 *   geraten, der Wiki-Stand keine Klasse (Legacys Regel „geraten heißt unbekannt“).
 * - **Bauwerkart:** die erste Art aus den Kategorien (nur der Hauptraum), sonst `Art=` der Infobox Bauwerk (`bauwerkartAusInfobox`, T1).
 * - **Standort** (nur Bauwerke): `Standort=` (sonst `Lage=`, `Ort=`) roh mit Links, und seine Linkziele mit Key (`standort_orte`).
 * - **Ruine:** „ja“, wenn Legacy sie als Ruine erkannte.
 */
export function leseOrtArtikel(
    seite: Infoboxseite,
    ns: number,
    kategorien: readonly string[],
    arten: readonly string[],
    wissen: ZielWissen | undefined,
): { ok: true; felder: Readonly<Record<string, string>> } | { ok: false; grund: string } {
    const gelesen = leseSeitenFelder("ort", seite);
    if (!gelesen.ok) return { ok: false, grund: gelesen.grund };
    const felder: Record<string, string> = {};
    for (const feld of ORT_ARTIKEL_FELDER) {
        const wert = gelesen.felder[feld];
        if (wert !== undefined) felder[feld] = wert;
    }
    const bauwerk = istBauwerkInfobox(seite);
    const klasse = bauwerk ? "gebaeude" : ns === 0 ? waehleKlasse(kategorien) : undefined;
    if (klasse !== undefined) felder["settlement_class"] = klasse;
    const art = (ns === 0 ? waehleArt(kategorien, arten) : undefined) ?? bauwerkartAusInfobox(seite);
    if (art !== undefined) felder["building_type"] = art;
    if (bauwerk) {
        const standort = kuerze(phpTrim(feldRoh(seite, ["standort", "lage", "ort"])), 1000);
        if (standort !== "") {
            felder["standort"] = standort;
            const orte = genannteOrte(standort, wissen);
            if (orte.length > 0) felder["standort_orte"] = standortOrteWert(orte);
        }
    }
    if (istRuine(seite, art)) felder["ruine"] = "ja";
    return { ok: true, felder };
}
