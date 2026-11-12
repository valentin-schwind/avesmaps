import type { WikisyncBereich } from "@avesmaps3d/shared";
import { ersterAbsatz, verlaufsstationen } from "./beschreibung.ts";
import { GEBIET_FELDER, istGebietsInfobox, leseGebiet } from "./gebiet.ts";
import { gipfelHoehe } from "./hoehe.ts";
import { LITERATUR_FELDER, leseProdukt } from "./literatur.ts";
import { SPRACHE_FELDER, leseSprache } from "./sprache.ts";
import { VORKOMMEN_FELDER, leseVorkommen, type VorkommenOrt } from "./vorkommen.ts";
import { istWindArtikel, leseWind } from "./wind.ts";
import { feld, feldRoh, type Infoboxseite } from "./seite.ts";
import { LEER, kuerze, phpTrim, schluesselform } from "./text.ts";

/**
 * Die Infobox-Leser der Bereiche des WikiSync (WI-0253 C): aus dem Wikitext einer Dump-Seite die Felder, die Legacys Dump-Lauf für diese Art
 * speichert, in denselben Grenzen und mit derselben Bereinigung. Das Vorbild je Bereich (Legacy-Mirror a7f2dac86):
 *
 * - Ort: `avesmapsWikiSettlementParseInfobox` (`settlements.php`), auch für Bauwerke (der Bauwerks-Lauf nimmt dieselben Felder, `dump-entity-scan.php`)
 * - Weg: `avesmapsWikiPathParsePage` (`paths.php`), Fluss und Straße
 * - Landschaft und Gipfel: `avesmapsWikiRegionParsePage` (`regions.php`) samt Wadi-Regel (`watercourse-landform.php`); der Gipfel liest dieselben Felder wie die Landschaft
 * - Kraftlinie: `avesmapsWikiPowerlineParsePage` (`powerlines.php`)
 * - Herrschaftsgebiet: `gebiet.ts`
 * - Literatur (ein Werk): `literatur.ts` (`{{Infobox Produkt}}`, Legacy `avesmapsWikiParseProductInfobox`)
 * - Vorkommen (Ware, Fauna, Flora, Spezies): `vorkommen.ts` (`{{Infobox Gegenstandsgruppe | Tierart | Pflanzenart | Spezies}}`, Legacy `avesmapsLoreParsePage`)
 * - Sprachartikel: `sprache.ts` (`{{Infobox Sprache}}`, WI-0261 S3; Legacy führt keine Sprachen)
 * - Wind-Artikel als Wiki-Eintrag der Landschaften: `wind.ts` (`{{Infobox Wind}}` oder Kategorie `Wind`, WI-0288 Stufe 6; Legacy führt keine Winde)
 *
 * 🔴 Ein Feld, das die Seite nicht oder leer nennt, fehlt im Ergebnis: „das Wiki kennt nichts“, nie ein Leerstring. Was nur eine Vorlage im Wiki setzt
 * (Ortsgröße, Bauwerkart, Kontinent einer Landschaft aus den Kategorien), steht nicht im Dump-Text und ist Sache der Kategorie-Abfragen (C-2).
 */

export type WikiBereich = WikisyncBereich;

export type FeldWerte = Readonly<Record<string, string>>;

/** Die Felder einer Landschafts-Infobox (`{{Infobox Region}}`): Landschaft und Gipfel lesen dieselben. */
const LANDSCHAFT_FELDER: readonly string[] = [
    "name",
    "art",
    "region_parent",
    "affiliation_staat",
    "einwohner",
    "sprache",
    "vegetation",
    "verkehrswege",
    "nachbar_n",
    "nachbar_no",
    "nachbar_o",
    "nachbar_so",
    "nachbar_s",
    "nachbar_sw",
    "nachbar_w",
    "nachbar_nw",
    "description",
];

/** Die Felder je Bereich, in der Reihenfolge, in der der Bericht sie zeigt. */
export const BEREICH_FELDER: Readonly<Record<WikiBereich, readonly string[]>> = {
    ort: [
        "name",
        "einwohner",
        "lage",
        "oberhaupt",
        "region_text",
        "staat_text",
        "handelszone",
        "verkehrswege",
        "bevoelkerung",
        "tempel",
        "description",
    ],
    weg: ["name", "kind", "art", "lage", "laenge", "verlauf", "description"],
    gebiet: GEBIET_FELDER,
    region: LANDSCHAFT_FELDER,
    // Gipfel und Vulkane tragen dieselbe Infobox wie die Landschaft (`{{Infobox Region}}`, Art „Berg“ oder „Vulkan“), und Legacy hängte ihnen denselben Wiki-Stand an
    // (`avesmapsWikiRegionBuildAssignObject`, `regions.php`): dieselben Felder, im Wiki-Stand (`wiki_region_snapshot`), dazu die Höhe (`Höhe=`, `height`, ganze Schritt; Legacy
    // `region-heights.php`). Sie ist das einzige Feld, das am Gipfel selbst folgt (`terrain_peak.height_schritt`) und das Gelände im Umkreis neu rechnen lässt (WI-0253 §21).
    gipfel: [...LANDSCHAFT_FELDER, "height"],
    kraftlinie: ["name", "staerke", "affinitaet", "laenge", "regionen", "verlauf", "description"],
    // Ein Werk der Spielliteratur: die Spalten von `adventure`, die Legacys Literatur-Abgleich aus `{{Infobox Produkt}}` setzt (WI-0253, Scheibe Literatur).
    literatur: LITERATUR_FELDER,
    // Eine Katalogquelle (WI-0253, Scheibe Quellen): nur der Titel steht im Plan als Feld; die Verwendungen sind Zeilen eigener Art (`abgleich/quellen.ts`), kein Infobox-Feld der Karte.
    quelle: ["title"],
    // Ein Vorkommen (WI-0253, Scheibe Vorkommen): die sechs Felder des Eintrags (`lore_entry`) und die vier Rohtexte der Infobox, die nur im Wiki-Stand stehen (`wiki_lore_snapshot`).
    vorkommen: VORKOMMEN_FELDER,
    // Ein Sprachartikel (WI-0261 S3): die sieben Felder der Infobox, die Kurzbeschreibung, die Navigationsleisten der Sprachfamilie und die vier Rohtexte (`wiki_sprache_artikel`).
    sprachen: SPRACHE_FELDER,
};

export type LeseGrund =
    "keine_infobox" | "nicht_geschlossen" | "fremde_infobox" | "reine_siedlung" | "name_fehlt" | "keine_literatur";

export type LeseErgebnis =
    | {
          ok: true;
          infobox: string;
          felder: FeldWerte;
          /** Nur ein Werk der Literatur: die Ortsliste (`Ort` oder `Thema`, Linkziele in ihrer Reihenfolge), WI-0253 Scheibe Ortslisten. */
          orte?: readonly string[];
          /** Nur ein Vorkommen: seine Art (fauna, flora, spezies, ware), Legacys Schlüssel und die Ortsverknüpfungen seines Artikels (WI-0253 Scheibe Vorkommen). */
          vorkommen?: { art: string; wikiKey: string; orte: readonly VorkommenOrt[] };
          /** Nur ein Sprachartikel: ob er aventurisch ist und welche Navigationsleisten der Sprachfamilie er trägt (WI-0261 S3). */
          sprache?: { aventurisch: boolean; familien: readonly string[] };
      }
    | { ok: false; grund: LeseGrund; infobox: string };

/** Die Art, die Legacys Klassifikator (`avesmapsWikiDumpClassifyEntityKind`) aus dem Infobox-Namen liest. Nur über den Namen, nie über Kategorien. */
export type Entitaet = "kraftlinie" | "weg" | "gebiet" | "bauwerk" | "ort" | "region" | "";

export function klassifiziere(infoboxSchluessel: string): Entitaet {
    const schluessel = infoboxSchluessel;
    if (schluessel === "") return "";
    if (schluessel.includes("kraftlinie")) return "kraftlinie";
    if (schluessel.includes("fluss") || schluessel.includes("strasse")) return "weg";
    if (istGebietsInfobox(schluessel)) return "gebiet";
    if (
        schluessel.includes("bauwerk") ||
        schluessel.includes("festung") ||
        schluessel.includes("burg") ||
        schluessel.includes("lehreinrichtung") ||
        schluessel.includes("geschaft")
    ) {
        return "bauwerk";
    }
    if (schluessel.includes("siedlung") || schluessel.includes("stadt") || schluessel.includes("ort")) return "ort";
    if (schluessel.includes("region") || schluessel.includes("landschaft")) return "region";
    return "";
}

/** Die Landformen unter {{Infobox Fluss}}: Legacy zeichnet sie als Landschaft, nie als Weg. */
const LANDFORM_WASSERLAEUFE: readonly string[] = ["wadi"];

/** Die Art der Infobox, auf den ersten Bestandteil gekürzt (`Art=Tal|Grube` ist für MediaWiki „Tal“). */
function infoboxArt(seite: Infoboxseite): string {
    return (phpTrim(feld(seite, ["art", "typ"])).split(new RegExp(`${LEER}*\\|${LEER}*`, "u"))[0] ?? "").trim();
}

function istLandformWasserlauf(seite: Infoboxseite): boolean {
    if (!seite.infoboxSchluessel.includes("fluss")) return false;
    const art = schluesselform(infoboxArt(seite));
    return art !== "" && LANDFORM_WASSERLAEUFE.includes(art);
}

/** Welche Art ein Seite für den Abgleich ist: so wie Legacy sie einsortiert, einschließlich der Wadi-Ausnahme. */
export function entitaetDerSeite(seite: Infoboxseite): Entitaet {
    const art = klassifiziere(seite.infoboxSchluessel);
    return art === "weg" && istLandformWasserlauf(seite) ? "region" : art;
}

function setze(felder: Record<string, string>, name: string, wert: string): void {
    if (wert !== "") felder[name] = wert;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ort
// ---------------------------------------------------------------------------------------------------------------------

function leseOrt(seite: Infoboxseite): FeldWerte {
    const name = feld(seite, ["name"]) || seite.titel;
    const region = feld(seite, ["region"]);
    const staat = feld(seite, ["staat"]);
    const lageTeile = [region, staat].filter((teil) => phpTrim(teil) !== "");
    const lage = [...new Set(lageTeile)].join(" · ");
    const felder: Record<string, string> = {};
    setze(felder, "name", kuerze(name, 255));
    setze(felder, "einwohner", kuerze(feld(seite, ["einwohnerzahl", "einwohner"]), 200));
    setze(
        felder,
        "bevoelkerung",
        kuerze(feld(seite, ["bevolkerungsmehrheit", "bevoelkerungsmehrheit", "bevolkerung", "bevoelkerung"]), 200),
    );
    setze(felder, "oberhaupt", kuerze(feld(seite, ["oberhaupt", "herrscher", "herrschaft"]), 200));
    setze(felder, "region_text", kuerze(region, 200));
    setze(felder, "staat_text", kuerze(staat, 200));
    setze(felder, "lage", kuerze(lage, 300));
    setze(felder, "handelszone", kuerze(feld(seite, ["handelszone"]), 200));
    setze(felder, "verkehrswege", kuerze(feld(seite, ["verkehrswege", "verkehr"]), 300));
    setze(felder, "tempel", kuerze(feld(seite, ["tempel", "geweihte", "geweihtenschaft"]), 300));
    setze(felder, "description", ersterAbsatz(seite.wikitext, seite.block));
    return felder;
}

// ---------------------------------------------------------------------------------------------------------------------
// Weg
// ---------------------------------------------------------------------------------------------------------------------

function leseWeg(seite: Infoboxseite): FeldWerte {
    const name = feld(seite, ["name"]) || seite.titel;
    const stationen = verlaufsstationen(feldRoh(seite, ["verlauf"])).slice(0, 60);
    const felder: Record<string, string> = {};
    setze(felder, "name", kuerze(name, 255));
    setze(felder, "kind", seite.infoboxSchluessel.includes("fluss") ? "fluss" : "strasse");
    setze(felder, "art", kuerze(feld(seite, ["art", "typ"]), 120));
    setze(felder, "lage", kuerze(feld(seite, ["regionen", "region", "lage"]), 500));
    setze(felder, "laenge", kuerze(feld(seite, ["lange", "langen", "lenge"]), 120));
    setze(felder, "verlauf", kuerze(stationen.join(" → "), 4000));
    setze(felder, "description", ersterAbsatz(seite.wikitext, seite.block));
    return felder;
}

// ---------------------------------------------------------------------------------------------------------------------
// Landschaft und Gipfel
// ---------------------------------------------------------------------------------------------------------------------

const NACHBARN: readonly (readonly [string, string])[] = [
    ["nord", "nachbar_n"],
    ["nordost", "nachbar_no"],
    ["ost", "nachbar_o"],
    ["sudost", "nachbar_so"],
    ["sud", "nachbar_s"],
    ["sudwest", "nachbar_sw"],
    ["west", "nachbar_w"],
    ["nordwest", "nachbar_nw"],
];

function leseRegion(seite: Infoboxseite, mitHoehe = false): FeldWerte {
    const name = feld(seite, ["name"]) || seite.titel;
    let art = infoboxArt(seite);
    // Berge heißen bei Avesmaps „Berggipfel“ (gleiche Bezeichnung wie die Beschriftungen).
    if (art.toLowerCase() === "berg") art = "Berggipfel";
    const felder: Record<string, string> = {};
    setze(felder, "name", kuerze(name, 255));
    setze(felder, "art", kuerze(art, 120));
    setze(felder, "region_parent", kuerze(feld(seite, ["region", "regionen"]), 255));
    setze(felder, "affiliation_staat", kuerze(feld(seite, ["staat"]), 255));
    setze(felder, "einwohner", kuerze(feld(seite, ["einwohnerzahl", "einwohner"]), 255));
    setze(felder, "sprache", kuerze(feld(seite, ["sprache"]), 255));
    setze(felder, "vegetation", kuerze(feld(seite, ["vegetationszonen", "vegetation"]), 500));
    setze(felder, "verkehrswege", kuerze(feld(seite, ["verkehrswege", "verkehr"]), 500));
    for (const [schluessel, feldName] of NACHBARN) {
        const roh = feld(seite, [schluessel]);
        if (phpTrim(roh) === "") continue;
        const teile = roh
            .split(new RegExp(`${LEER}*,${LEER}*`, "u"))
            .map((teil) => phpTrim(teil))
            .filter((teil) => teil !== "");
        setze(felder, feldName, teile.join(", "));
    }
    setze(felder, "description", ersterAbsatz(seite.wikitext, seite.block));
    // Die Höhe eines Gipfels (`Höhe=`): nur der Gipfel liest sie, die Landschaft nicht.
    if (mitHoehe) {
        const hoehe = gipfelHoehe(feld(seite, ["hohe", "hoehe"]));
        if (hoehe !== null) felder["height"] = String(hoehe);
    }
    return felder;
}

// ---------------------------------------------------------------------------------------------------------------------
// Kraftlinie
// ---------------------------------------------------------------------------------------------------------------------

function leseKraftlinie(seite: Infoboxseite): FeldWerte {
    // „(unbenannte Kraftlinie)“ ist ein echter Wert im Wiki; dann trägt der Titel den Namen.
    let name = feld(seite, ["name"]);
    if (name === "" || /^\(.*unbenannt.*\)$/iu.test(name)) name = seite.titel;
    const stationen = verlaufsstationen(feldRoh(seite, ["verlauf"])).slice(0, 60);
    const felder: Record<string, string> = {};
    setze(felder, "name", kuerze(name, 255));
    setze(felder, "staerke", kuerze(feld(seite, ["starke", "starken"]), 120));
    setze(felder, "affinitaet", kuerze(feld(seite, ["affinitat", "affinitaet"]), 120));
    setze(felder, "laenge", kuerze(feld(seite, ["lange", "langen", "lenge"]), 120));
    setze(felder, "regionen", kuerze(feld(seite, ["regionen", "region", "lage"]), 500));
    setze(felder, "verlauf", kuerze(stationen.join(" → "), 4000));
    setze(felder, "description", ersterAbsatz(seite.wikitext, seite.block));
    return felder;
}

// ---------------------------------------------------------------------------------------------------------------------
// Verteiler
// ---------------------------------------------------------------------------------------------------------------------

const ENTITAET_JE_BEREICH: Readonly<Record<WikiBereich, readonly Entitaet[]>> = {
    ort: ["ort", "bauwerk"],
    weg: ["weg"],
    gebiet: ["gebiet", "ort"],
    region: ["region"],
    gipfel: ["region"],
    kraftlinie: ["kraftlinie"],
    // Ein Werk erkennt nicht der Klassifikator der Karte, sondern der Name des Kastens (`{{Infobox Produkt}}`, `literatur.ts`).
    literatur: [],
    // Die Quellen lesen keine Infobox der Karte, sondern die Publikationen und die Produktseiten (`publikationen.ts`).
    quelle: [],
    // Ein Vorkommen erkennt allein der Name des Kastens (`Tierart`, `Pflanzenart`, `Spezies`, `Gegenstandsgruppe`, `vorkommen.ts`).
    vorkommen: [],
    // Ein Sprachartikel erkennt allein der Name des Kastens (`Sprache`, `sprache.ts`).
    sprachen: [],
};

/**
 * Liest eine Seite für einen Bereich. Ohne Infobox, mit offener Klammer, mit einer Infobox der falschen Art oder ohne Namen ist die Seite kein
 * lesbarer Artikel dieses Bereichs; das ist ein Befund, nie ein Raten.
 */
export function leseSeitenFelder(bereich: WikiBereich, seite: Infoboxseite): LeseErgebnis {
    if (bereich === "literatur") {
        const werk = leseProdukt(seite);
        return werk.ok
            ? { ok: true, infobox: werk.infobox, felder: werk.felder, orte: werk.orte }
            : { ok: false, grund: werk.grund, infobox: werk.infobox };
    }
    if (bereich === "vorkommen") {
        const eintrag = leseVorkommen(seite);
        return eintrag.ok
            ? {
                  ok: true,
                  infobox: eintrag.infobox,
                  felder: eintrag.felder,
                  vorkommen: { art: eintrag.art, wikiKey: eintrag.wikiKey, orte: eintrag.orte },
              }
            : { ok: false, grund: eintrag.grund, infobox: eintrag.infobox };
    }
    if (bereich === "sprachen") {
        const artikel = leseSprache(seite);
        return artikel.ok
            ? {
                  ok: true,
                  infobox: artikel.infobox,
                  felder: artikel.felder,
                  sprache: { aventurisch: artikel.aventurisch, familien: artikel.familien },
              }
            : { ok: false, grund: artikel.grund, infobox: artikel.infobox };
    }
    // Ein Wind-Artikel (WI-0288 Stufe 6) trägt keine `{{Infobox Region}}` und oft gar keine Infobox: Er hat seinen eigenen Leser, mit den Feldern der Landschaft, die er füllen kann.
    if (bereich === "region" && istWindArtikel(seite)) {
        const wind = leseWind(seite);
        return wind.ok ? { ok: true, infobox: wind.infobox, felder: wind.felder } : wind;
    }
    const infobox = seite.infobox;
    if (infobox === "") return { ok: false, grund: "keine_infobox", infobox };
    if (!seite.block.geschlossen) return { ok: false, grund: "nicht_geschlossen", infobox };
    const entitaet = entitaetDerSeite(seite);
    if (!ENTITAET_JE_BEREICH[bereich].includes(entitaet)) return { ok: false, grund: "fremde_infobox", infobox };
    // 🪤 Legacys Landschafts-Leser nimmt NUR {{Infobox Region}} (und die Wadi-Wasserläufe): Eine Seite mit {{Infobox Landschaft}} gilt dem Klassifikator
    // als Landschaft, ergibt aber nie einen Datensatz – dazu hat keine Landschaft einen Schnappschuss. Gleiches Tor, kein gelockertes.
    if (
        (bereich === "region" || bereich === "gipfel") &&
        !seite.infoboxSchluessel.includes("region") &&
        !istLandformWasserlauf(seite)
    ) {
        return { ok: false, grund: "fremde_infobox", infobox };
    }

    if (bereich === "gebiet") {
        const gebiet = leseGebiet(seite);
        return gebiet.ok ? { ok: true, infobox, felder: gebiet.felder } : { ok: false, grund: gebiet.grund, infobox };
    }

    const felder =
        bereich === "ort"
            ? leseOrt(seite)
            : bereich === "weg"
              ? leseWeg(seite)
              : bereich === "region" || bereich === "gipfel"
                ? leseRegion(seite, bereich === "gipfel")
                : leseKraftlinie(seite);
    if ((felder["name"] ?? "") === "") return { ok: false, grund: "name_fehlt", infobox };
    return { ok: true, infobox, felder };
}
