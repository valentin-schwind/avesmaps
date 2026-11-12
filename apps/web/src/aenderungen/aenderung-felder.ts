import type { MapHistoryObjectKind } from "@avesmaps3d/shared";
import { DETAIL_NAMEN, istDetailfeld } from "../gebietseditor/gebiet-detailfelder";
import { formatDecimal, formatNumber, isMessageKey, t, tPlural, type MessageKey } from "../i18n/i18n";
import { gefahrenText } from "../gefahren/gefahr-texte";
import { artName as landschaftArtName } from "../landschaftseditor/landschaften-liste";
import { verlaufFeldName as ortFeldName, verlaufWert as ortWert } from "../ortseditor/ortseditor-texte";
import { sprachVerlaufFeldName, sprachVerlaufWert } from "../spracheditor/sprache-verlauf";
import { artName as wegArtName } from "../wegeditor/wege-liste";
import { weitereNamenText } from "../wegeditor/wegeditor-texte";
import { gebietName, knotenName } from "./aenderung-namen";
import { GEBIRGE_PRAEFIX } from "./aenderung-modell";
import { istGrundFeld } from "./aenderung-detail-modell";
import { bereinigtesFeld, istKennung, istRohNeben, kuerzen, lesbar, punkteIn, wertText } from "./aenderung-text";
/**
 * Feldnamen und Werte in „Änderungen“, je Art des Gegenstands (WI-0265 B5a2, Betreiber: keine rohen Schlüssel und kein rohes JSON vor
 * Vali). Die Namen und Wertdarstellungen gibt es schon, je Art im Verlauf ihres Editors (`feldName` und `wert` am `EntwurfVerlauf` im
 * Fenster des Wegs, des Gebiets, der Landschaft, des Gipfels, der Kraftlinie, der Sprache; der Ort in `ortseditor-texte.ts`). Hier stehen
 * dieselben Texte für die Liste aller Änderungen, die den Editor ihrer Art nicht kennt.
 *
 * 🪤 **Die Fenster halten ihre Tafeln in der Script-Setup-Datei**, von wo sich nichts ausführen lässt; hier steht darum die Zuordnung
 * Schlüssel → Text noch einmal, und zwar nur als Schlüssel der Sprachtafeln (`MessageKey`): kein Wort wird hier geschrieben, und eine umbenannte
 * Tafelzeile bricht den Typcheck. Wer ein Feld im Fenster neu benennt, trägt es hier nach (Test `aenderungen.test.ts` hält die Familien an
 * ihren Beispielen). Wo ein Editor ein Wort aus seinem Zustand holt (der Name des Obergebiets, eines Knotens), kennt die Liste nur die Kennung und
 * sagt „anderer Eintrag“.
 *
 * Für ein Feld ohne Namen steht ein lesbarer Rückfall (`lesbar`), der Schlüssel selbst nur im `title` (`Bezeichnung.schluessel`).
 *
 * 🔴 **Der Rückfall ist ein Notbehelf, kein Name** (WI-0265 B6i; Betreiber: „Wiki settlement class“, „Roh schrift“ im Reiter): Jeder Schlüssel der Positivliste `MAP_AUDIT_FIELDS` (Server,
 * `editor/map-operation.ts`) hat einen Namen, und `aenderung-audit-felder.test.ts` liest die Liste selbst und wird rot, wenn ein neuer Schlüssel keinen hat. Drei Wege zum Namen:
 * - die Tafel der Art (oder `ALLGEMEIN`), wie bisher;
 * - **der Wiki-Stand `wiki<Feld>`** (der Wert hinter ↺, nur der WikiSync schreibt ihn; `…Unbekannt` ist seine Marke) heißt „<Feld> im Wiki“, mit dem Namen des Felds aus dem Bericht des
 *   WikiSync (`admin.wikisync.feld.*`, dort stehen alle Felder des Wiki-Plans) oder der Tafel der Art;
 * - **der Wiki-Quelltext `roh<Feld>`** heißt „<Feld> (Wiki-Quelltext)“. Neben seiner bereinigten Fassung zeigt ihn die Oberfläche nicht (`istRohNeben`).
 */

export interface Bezeichnung {
    readonly text: string;
    /** Der Schlüssel des Protokolls, wenn `text` nur ein Rückfall ist (für den Hinweis beim Überfahren). */
    readonly schluessel?: string | undefined;
}

type Tafel = Readonly<Record<string, MessageKey>>;
type Familie =
    | "ort"
    | "nodix"
    | "weg"
    | "kraftlinie"
    | "landschaft"
    | "gipfel"
    | "gebiet"
    | "sprache"
    | "sprachartikel"
    | "landmarkenartikel"
    | "wikieintrag"
    | "ortseintrag"
    | "inhalte";

const FAMILIE: Partial<Record<MapHistoryObjectKind, Familie>> = {
    place: "ort",
    nodix: "nodix",
    path: "weg",
    powerline: "kraftlinie",
    landscape: "landschaft",
    area: "landschaft",
    label: "landschaft",
    peak: "gipfel",
    territory: "gebiet",
    territory_area: "gebiet",
    sprache: "sprache",
    sprache_flaeche: "sprache",
    sprache_artikel: "sprachartikel",
    landmarke_artikel: "landmarkenartikel",
    region_artikel: "wikieintrag",
    ort_artikel: "ortseintrag",
    source: "inhalte",
    work: "inhalte",
    lore: "inhalte",
    corpus: "inhalte",
};

/** `wegeditor-fenster.vue`, `verlaufFeldName`. */
const WEG: Tafel = {
    name: "wegeditor.fenster.feld.name",
    subtype: "wegeditor.fenster.feld.wegtyp",
    labelVisible: "wegeditor.fenster.feld.nameAufKarte",
    tunnel: "wegeditor.fenster.feld.tunnel",
    reisen: "wegeditor.reisemittel.titel",
    weitere: "wegeditor.weitere.name",
    mark: "wegeditor.fenster.feld.kennzeichen",
    isBach: "wegeditor.art.bach",
    flowDirection: "wegeditor.tafel.richtung",
    active: "verlauf.aktiv",
    offMap: "kraftlinieneditor.verlauf.offMap",
    stand: "kraftlinieneditor.verlauf.stand",
    geometry: "entwurf.form",
    wiki: "kraftlinieneditor.abschnitt.wiki",
    wasserHoehen: "wegeditor.verlauf.wasserHoehen",
};

/** `kraftlinieneditor-fenster.vue`, `verlaufFeldName` und `teilName`. */
const KRAFTLINIE: Tafel = {
    name: "kraftlinieneditor.feld.name",
    beschriftung: "kraftlinieneditor.feld.beschriftung",
    description: "kraftlinieneditor.feld.beschreibung",
    beschreibung: "kraftlinieneditor.feld.beschreibung",
    labelVisible: "kraftlinieneditor.feld.beschriftungAn",
    curve: "kraftlinieneditor.verlauf.bogen",
    from: "kraftlinieneditor.verlauf.von",
    to: "kraftlinieneditor.verlauf.bis",
    active: "verlauf.aktiv",
    offMap: "kraftlinieneditor.verlauf.offMap",
    stand: "kraftlinieneditor.verlauf.stand",
    wiki: "kraftlinieneditor.abschnitt.wiki",
    geometry: "entwurf.form",
};

/** `landschaftseditor-fenster.vue`, `VERLAUF_FELDER`. */
const LANDSCHAFT: Tafel = {
    name: "landschaftseditor.feld.name",
    layer: "landschaftseditor.feld.ebene",
    type: "landschaftseditor.feld.art",
    locked: "landschaftseditor.feld.klick",
    hidden: "landschaftseditor.feld.besucher",
    hazards: "landschaftseditor.feld.gefahrenlage",
    curve: "landschaftseditor.feld.kurve",
    order: "landschaftseditor.feld.platz",
    size: "landschaftseditor.feld.groesse",
    priority: "landschaftseditor.feld.prioritaet",
    zoom: "landschaftseditor.feld.zoom",
    showName: "landschaftseditor.feld.anzeigen",
    text: "landschaftseditor.feld.text",
    geometry: "entwurf.form",
    position: "landschaftseditor.feld.lage",
    active: "verlauf.aktiv",
    offMap: "editorListe.stand.nichtAufDerKarte",
    gebirge: "landschaftseditor.teil.gebirge",
    // Die Beschriftung (`label`) und die Region (`region`) führen im Protokoll mehr, als das Fenster als Zeile zeigt (WI-0265 B6i).
    curveCount: "landschaftseditor.feld.laeufe",
    curveDegree: "aenderungen.feld.kurvengrad",
    textFollowsName: "aenderungen.feld.textFolgtName",
    placement: "aenderungen.feld.platzierung",
    affectsPaths: "aenderungen.feld.wegeBetroffen",
};

/** `gipfel-eigenschaften.vue`, `verlaufFeldName`. */
const GIPFEL: Tafel = {
    name: "landschaftseditor.feld.name",
    height: "landschaftseditor.gipfel.feld.hoehe",
    showName: "landschaftseditor.feld.anzeigen",
    position: "landschaftseditor.gipfel.feld.lage",
    active: "verlauf.aktiv",
    // Art und Merkmale einer Landmarke (WI-0271 L3).
    subtype: "landschaftseditor.feld.art",
    merkmale: "ortseditor.feld.merkmale",
};

/** `gebietseditor-fenster.vue`, `verlaufFeldName` (die 17 Detailfelder dazu über `DETAIL_NAMEN`). */
const GEBIET: Tafel = {
    name: "gebietseditor.feld.name",
    shortName: "gebietseditor.feld.kurzname",
    type: "infoPanel.field.art",
    status: "infoPanel.field.status",
    capital: "infoPanel.field.capital",
    parent: "gebietseditor.feld.obergebiet",
    color: "gebietseditor.feld.farbe",
    minZoom: "gebietseditor.verlauf.zoomVon",
    maxZoom: "gebietseditor.verlauf.zoomBis",
    geometry: "entwurf.form",
};

/**
 * Die Inhalte (WI-0265 B6f; Quelle, Werk, Vorkommen, Korpus): die Namen aus dem Fenster „Inhalte bearbeiten“ (`inhalte.feld.*`, `inhalte.literatur.feld.*`, `inhalte.vorkommen.feld.*`,
 * `inhalte.korpora.feld.*`). Die Schlüssel sind die des Fachprotokolls (`MAP_AUDIT_FIELDS`). Ein deutsches Wort als Schlüssel (`gruppe`, `lebensraum`) braucht keinen Eintrag: Der lesbare
 * Rückfall ist dasselbe Wort. Die Wiki-Stände (`wiki<Feld>`) und die Zahlen der Komplexität haben keine eigene Zeile im Fenster und bleiben im Rückfall.
 */
const INHALTE: Tafel = {
    url: "inhalte.feld.adresse",
    title: "inhalte.feld.titel",
    sourceType: "inhalte.feld.typ",
    isOfficial: "inhalte.feld.offiziell",
    licenseStatement: "inhalte.feld.lizenz",
    licenseKey: "inhalte.feld.lizenz",
    attribution: "inhalte.feld.nennung",
    editorNote: "inhalte.literatur.feld.notiz",
    active: "verlauf.aktiv",
    productType: "inhalte.literatur.feld.art",
    edition: "inhalte.literatur.feld.regelsystem",
    series: "inhalte.literatur.feld.serie",
    bfYear: "inhalte.literatur.feld.jahr",
    bfLabel: "inhalte.literatur.feld.jahr",
    genre: "inhalte.literatur.feld.genre",
    authors: "eintrag.lizenz.autoren",
    places: "inhalte.literatur.feld.orte",
    name: "inhalte.vorkommen.feld.name",
    art: "inhalte.vorkommen.feld.kategorie",
    gruppe: "inhalte.vorkommen.feld.gruppe",
    lebensraum: "inhalte.vorkommen.feld.lebensraum",
    synonyme: "inhalte.vorkommen.feld.synonyme",
    continent: "inhalte.vorkommen.kontinent",
    kurzbeschreibung: "admin.wikisync.feld.kurzbeschreibung",
    sources: "inhalte.quellen.titel",
    quellen: "inhalte.quellen.titel",
    // Die Verwendungen einer Quelle an Orten, Gebieten, Landschaften, Gipfeln und Wegen (`source.update`, WI-0265 B6g3: gehen mit zurück).
    links: "inhalte.verwendungen.titel",
    rules: "inhalte.vorkommen.regeln.titel",
    key: "inhalte.korpora.feld.schluessel",
    label: "inhalte.korpora.feld.name",
    form: "inhalte.korpora.feld.form",
    // Was nur die Übernahme des WikiSync schreibt: Schwierigkeit und F-Shop-Nummer eines Werks, der Typ eines Vorkommens, die Marke der angelegten Quelle (WI-0265 B6i).
    complexityGm: "admin.wikisync.feld.complexity_gm",
    complexityPl: "admin.wikisync.feld.complexity_pl",
    fshopCode: "admin.wikisync.feld.fshop_code",
    typ: "admin.wikisync.feld.typ",
    created: "aenderungen.feld.angelegt",
};

/** Der Wiki-Stand eines Sprachartikels (WI-0261 S3; `sprache_artikel`): die Namen aus dem Bericht des WikiSync (`admin.wikisync.feld.*`), die Felder der Infobox in der Schreibweise des Protokolls. */
const SPRACHARTIKEL: Tafel = {
    artikel: "admin.wikisync.feld.artikel",
    name: "admin.wikisync.feld.name",
    sprachfamilie: "admin.wikisync.feld.sprachfamilie",
    vorstufen: "admin.wikisync.feld.vorstufen",
    schrift: "admin.wikisync.feld.schrift",
    sprecheranzahl: "admin.wikisync.feld.sprecheranzahl",
    offizielleSprache: "admin.wikisync.feld.offizielle_sprache",
    weitereVerbreitung: "admin.wikisync.feld.weitere_verbreitung",
    kurzbeschreibung: "admin.wikisync.feld.kurzbeschreibung",
    navigation: "admin.wikisync.feld.navigation",
};

/** Der Wiki-Stand eines Landmarken-Artikels ohne Landmarke auf der Karte (WI-0271 L7; `landmarke_artikel`): die Namen aus dem Bericht des WikiSync, dazu der Stand „Unterdrückt“ der Redaktion. */
const LANDMARKENARTIKEL: Tafel = {
    artikel: "admin.wikisync.feld.artikel",
    name: "admin.wikisync.feld.name",
    art: "admin.wikisync.feld.art",
    wikiArt: "admin.wikisync.feld.wiki_art",
    region: "admin.wikisync.feld.region",
    height: "admin.wikisync.feld.height",
    kurzbeschreibung: "admin.wikisync.feld.kurzbeschreibung",
    unterdrueckt: "editorListe.stand.unterdrueckt",
};

/** Ein Wiki-Eintrag ohne Fläche (WI-0284; `region_artikel`): die Namen aus dem Bericht des WikiSync. */
const WIKIEINTRAG: Tafel = {
    artikel: "admin.wikisync.feld.artikel",
    name: "admin.wikisync.feld.name",
    art: "admin.wikisync.feld.art",
    region_parent: "admin.wikisync.feld.region_parent",
    affiliation_staat: "admin.wikisync.feld.affiliation_staat",
    einwohner: "admin.wikisync.feld.einwohner",
    sprache: "admin.wikisync.feld.sprache",
    vegetation: "admin.wikisync.feld.vegetation",
    verkehrswege: "admin.wikisync.feld.verkehrswege",
    nachbar_n: "admin.wikisync.feld.nachbar_n",
    nachbar_no: "admin.wikisync.feld.nachbar_no",
    nachbar_o: "admin.wikisync.feld.nachbar_o",
    nachbar_so: "admin.wikisync.feld.nachbar_so",
    nachbar_s: "admin.wikisync.feld.nachbar_s",
    nachbar_sw: "admin.wikisync.feld.nachbar_sw",
    nachbar_w: "admin.wikisync.feld.nachbar_w",
    nachbar_nw: "admin.wikisync.feld.nachbar_nw",
    description: "admin.wikisync.feld.description",
};

/** Ein Orts- oder Bauwerk-Artikel ohne Ort (WI-0295; `ort_artikel`): die Namen aus dem Bericht des WikiSync. */
const ORTSEINTRAG: Tafel = {
    artikel: "admin.wikisync.feld.artikel",
    name: "admin.wikisync.feld.name",
    settlement_class: "admin.wikisync.feld.settlement_class",
    building_type: "admin.wikisync.feld.building_type",
    lage: "admin.wikisync.feld.lage",
    standort: "admin.wikisync.feld.standort",
    standort_orte: "admin.wikisync.feld.standort_orte",
    ruine: "admin.wikisync.feld.ruine",
    einwohner: "admin.wikisync.feld.einwohner",
    oberhaupt: "admin.wikisync.feld.oberhaupt",
    region_text: "admin.wikisync.feld.region_text",
    staat_text: "admin.wikisync.feld.staat_text",
    handelszone: "admin.wikisync.feld.handelszone",
    verkehrswege: "admin.wikisync.feld.verkehrswege",
    bevoelkerung: "admin.wikisync.feld.bevoelkerung",
    tempel: "admin.wikisync.feld.tempel",
    description: "admin.wikisync.feld.description",
};

/** Der Kraftlinienpunkt (`nodix`): Lage und Art wie am Ort. */
const NODIX: Tafel = {
    position: "ortseditor.feld.position",
    kind: "ortseditor.feld.art",
    active: "verlauf.aktiv",
};

/** Was eine Sprache führt und ihr Verlauf nicht benennt: ihr Schlüssel (nur beim Anlegen). */
const SPRACHE: Tafel = { schluessel: "spracheditor.feld.schluessel" };

const TAFELN: Readonly<Record<Exclude<Familie, "ort">, Tafel>> = {
    nodix: NODIX,
    weg: WEG,
    kraftlinie: KRAFTLINIE,
    landschaft: LANDSCHAFT,
    gipfel: GIPFEL,
    gebiet: GEBIET,
    sprache: SPRACHE,
    sprachartikel: SPRACHARTIKEL,
    landmarkenartikel: LANDMARKENARTIKEL,
    wikieintrag: WIKIEINTRAG,
    ortseintrag: ORTSEINTRAG,
    inhalte: INHALTE,
};

/**
 * Felder, die in jeder Art dasselbe heißen: die Form, Aktiv, die Quellen des Trägers (`traeger.sources`), die Wiki-Zuordnung, und am Ort die Innerorts-Beziehungen, die mit ihm
 * stillgelegt wurden (`staetten`).
 */
const ALLGEMEIN: Tafel = {
    geometry: "entwurf.form",
    active: "verlauf.aktiv",
    quellen: "inhalte.quellen.titel",
    wiki: "kraftlinieneditor.abschnitt.wiki",
    // Die Herkunft der Wiki-Zuordnung, die die Wiki-Box vor und nach dem Schreiben festhält (WI-0265 B8d).
    zuordnung: "aenderungen.feld.zuordnung",
    wikiWeitere: "aenderungen.feld.wikiWeitere",
    staetten: "ortseditor.reiter.innerorts",
    // „In Landmarke umwandeln …“ (WI-0271 L8): der Verweis in beide Richtungen und die Bezüge, die mitgingen.
    landmarke: "aenderungen.feld.landmarke",
    ausOrt: "aenderungen.feld.ausOrt",
    vorkommen: "aenderungen.feld.vorkommen",
    kraftlinien: "aenderungen.feld.kraftlinien",
    abenteuer: "aenderungen.feld.abenteuer",
};
const ALLGEMEIN_ORT: ReadonlySet<string> = new Set(["name", "hidden", "active", "description"]);

// --- Gebirge ---------------------------------------------------------------------------------------------------------------

/** Eine Spalte des Gebirges, wie `gebirgeText` im Fenster der Landschaft sie nennt (`area.gebirge`). */
function gebirgeSpaltenName(spalte: string): Bezeichnung {
    if (spalte === "netz") return { text: t("aenderungen.feld.netz") };
    if (spalte === "gebirgstyp") return { text: t("landschaftseditor.gebirge.typ.titel") };
    if (spalte === "muster") return { text: t("landschaftseditor.gebirge.muster.titel") };
    if (spalte === "maximalhoehe") return { text: t("landschaftseditor.gebirge.hoehe.kamm") };
    const schluessel = `landschaftseditor.gebirge.wert.${spalte}`;
    return isMessageKey(schluessel) ? { text: t(schluessel) } : { text: lesbar(spalte), schluessel: spalte };
}

/** Das gezeichnete Netz als Satz: „Kämme 3 · Nebengipfel 4“, dazu Täler und Mulden, wenn es sie gibt. */
function netzText(wert: unknown): string {
    if (typeof wert !== "object" || wert === null) return wertText("netz", wert) ?? "–";
    const netz = wert as { kaemme?: { rang?: string }[]; nebengipfel?: unknown[]; mulden?: unknown[] };
    const taeler = netz.kaemme?.filter((kamm) => kamm.rang === "tal").length ?? 0;
    const kaemme = (netz.kaemme?.length ?? 0) - taeler;
    return [
        t("landschaftseditor.verlauf.netz", {
            kaemme: formatNumber(kaemme, 0),
            gipfel: formatNumber(netz.nebengipfel?.length ?? 0, 0),
        }),
        ...(taeler > 0 ? [`${t("landschaftseditor.kaemme.rang.tal")} ${formatNumber(taeler, 0)}`] : []),
        ...((netz.mulden?.length ?? 0) > 0
            ? [`${t("landschaftseditor.kaemme.werkzeug.mulde")} ${formatNumber(netz.mulden!.length, 0)}`]
            : []),
    ].join(" · ");
}

/**
 * Der Wert einer Spalte mit der Einheit, die der Reiter „Gebirge“ ihr gibt: die Höhe des Kamms in Schritt, die Erosionsfestigkeit in Prozent;
 * ohne Wert „Vorgabe“; Typ und Grundmuster mit ihrem Namen.
 */
function gebirgeSpaltenWert(spalte: string, wert: unknown): string {
    if (spalte === "netz") return netzText(wert);
    if (wert === null) return t("landschaftseditor.gebirge.wert.vorgabe");
    if (typeof wert === "number") {
        const zahl = formatNumber(wert, Number.isInteger(wert) ? 0 : 2);
        if (spalte === "maximalhoehe") return `${zahl} ${t("landschaftseditor.gebirge.hoehe.einheit")}`;
        return spalte === "erosionsfestigkeit" ? `${zahl} %` : zahl;
    }
    if (spalte === "gebirgstyp" || spalte === "muster") {
        const schluessel = `landschaftseditor.gebirge.${spalte === "muster" ? "muster" : "typ"}.${String(wert)}`;
        return isMessageKey(schluessel) ? t(schluessel) : lesbar(String(wert));
    }
    return wertText(spalte, wert) ?? "–";
}

/** Das Gebirge als Ganzes (ein Protokoll ohne zerlegbare Tafel): „Gratbreite 18 · Höhe des Kamms 3.200 Schritt“, nie JSON. */
function gebirgeText(tafel: Readonly<Record<string, unknown>>): string {
    const teile = Object.entries(tafel).map(
        ([spalte, wert]) => `${gebirgeSpaltenName(spalte).text} ${gebirgeSpaltenWert(spalte, wert)}`,
    );
    return teile.length === 0 ? "–" : kuerzen(teile.join(" · "));
}

/** Lauten Vorher und Nachher als Text gleich, obwohl die Werte verschieden sind (ein Netz mit anderer Form, gleicher Zahl der Kämme)? */
export function nurFormGeaendert(
    vorherText: string | undefined,
    nachherText: string | undefined,
    vorher: unknown,
    nachher: unknown,
): boolean {
    return (
        vorherText !== undefined &&
        vorherText === nachherText &&
        vorher !== undefined &&
        nachher !== undefined &&
        !istKennung(vorher) &&
        !istKennung(nachher) &&
        JSON.stringify(vorher) !== JSON.stringify(nachher)
    );
}

// --- Namen -----------------------------------------------------------------------------------------------------------------

const kleinAnfang = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
/** `settlementClass` → `settlement_class`: so heißen die Felder des Wiki-Plans (`admin.wikisync.feld.*`) und die Detailfelder des Gebiets. */
const schlangenSchrift = (feld: string): string => feld.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();

/** Der Name eines Felds aus den Tafeln seiner Art; `undefined`, wo es keinen gibt (kein Rückfall). */
function tafelName(kind: MapHistoryObjectKind | undefined, feld: string): string | undefined {
    const familie = kind === undefined ? undefined : FAMILIE[kind];
    if (familie === "sprache") {
        const text = sprachVerlaufFeldName(feld);
        if (text !== feld) return text;
    }
    if (familie === "gebiet" && istDetailfeld(feld)) return t(DETAIL_NAMEN[feld]);
    if (familie !== undefined && familie !== "ort") {
        const schluessel = TAFELN[familie][feld];
        if (schluessel !== undefined) return t(schluessel);
    }
    if (familie === "ort" || ALLGEMEIN_ORT.has(feld)) {
        const text = ortFeldName(feld);
        if (text !== feld) return text;
    }
    const allgemein = ALLGEMEIN[feld];
    return allgemein === undefined ? undefined : t(allgemein);
}

/**
 * Der Name des Felds hinter einem Wiki-Stand oder Quelltext (`settlementClass` in `wikiSettlementClass`): erst der Name im Bericht des WikiSync, der alle Felder des Wiki-Plans kennt
 * (`admin.wikisync.feld.settlement_class`, dazu die Beziehungen der Vorkommen), dann die Tafeln der Art, dann die 17 Detailfelder des Gebiets (`trade_zone` und `political` stehen nur dort).
 */
function wikiFeldName(kind: MapHistoryObjectKind | undefined, feld: string): string | undefined {
    const schlange = schlangenSchrift(feld);
    for (const schluessel of [`admin.wikisync.feld.${schlange}`, `admin.wikisync.beziehung.${schlange}`]) {
        if (isMessageKey(schluessel)) return t(schluessel);
    }
    return tafelName(kind, feld) ?? (istDetailfeld(schlange) ? t(DETAIL_NAMEN[schlange]) : undefined);
}

/** `rohSchrift` → „Schrift (Wiki-Quelltext)“; kein Rohfeld oder ohne Namen des Felds dahinter: `undefined`. */
function rohName(kind: MapHistoryObjectKind | undefined, feld: string): string | undefined {
    const bereinigt = bereinigtesFeld(feld);
    if (bereinigt === undefined || feld.startsWith("wiki")) return undefined;
    const name = wikiFeldName(kind, bereinigt);
    return name === undefined ? undefined : t("aenderungen.feld.roh", { feld: name });
}

/**
 * Der Name eines zusammengesetzten Schlüssels (WI-0265 B6i): der Wiki-Stand `wiki<Feld>` („Ortsgröße im Wiki“), seine Marke `wiki<Feld>Unbekannt` („Ortsgröße im Wiki unbekannt“) und das Rohfeld
 * `roh<Feld>` („Schrift (Wiki-Quelltext)“, auch als Wiki-Stand). `undefined`, wenn der Schlüssel keine dieser Formen hat oder das Feld dahinter keinen Namen.
 */
function zusammengesetztName(kind: MapHistoryObjectKind | undefined, feld: string): string | undefined {
    const unbekannt = feld.endsWith("Unbekannt") && feld.length > "Unbekannt".length;
    const kern = unbekannt ? feld.slice(0, -"Unbekannt".length) : feld;
    const wiki = /^wiki([A-Z]\w*)$/u.exec(kern)?.[1];
    if (wiki === undefined) return unbekannt ? undefined : rohName(kind, feld);
    const inneres = kleinAnfang(wiki);
    const name = rohName(kind, inneres) ?? wikiFeldName(kind, inneres);
    if (name === undefined) return undefined;
    return t(unbekannt ? "aenderungen.feld.wikiUnbekannt" : "aenderungen.feld.wikiStand", { feld: name });
}

/** Der Name eines Felds; für ein Feld ohne Namen ein lesbarer Rückfall mit dem Schlüssel für den Hinweis. */
export function feldBezeichnung(kind: MapHistoryObjectKind | undefined, feld: string): Bezeichnung {
    if (feld.startsWith(GEBIRGE_PRAEFIX)) return gebirgeSpaltenName(feld.slice(GEBIRGE_PRAEFIX.length));
    const text = tafelName(kind, feld) ?? zusammengesetztName(kind, feld);
    return text === undefined ? { text: lesbar(feld), schluessel: feld } : { text };
}

export const feldNameFuer = (kind: MapHistoryObjectKind | undefined, feld: string): string =>
    feldBezeichnung(kind, feld).text;

/**
 * Die Namen der Felder, die eine Zeile der Liste unter dem Titel nennt: ohne den Grund einer Rücknahme, ohne Herkunftsfelder (`…Origin`) und ohne den Wiki-Quelltext neben seiner
 * bereinigten Fassung (`rohSchrift` neben `schrift`, WI-0265 B6i). Ein Rohfeld allein steht da, als „<Feld> (Wiki-Quelltext)“.
 */
export const zeilenFeldNamen = (kind: MapHistoryObjectKind | undefined, felder: readonly string[]): string[] =>
    felder
        .filter((feld) => !feld.endsWith("Origin") && !istGrundFeld(feld) && !istRohNeben(feld, felder))
        .map((feld) => feldNameFuer(kind, feld));

/** Die Spalten des Gebirges, wie der Server sie in `area.gebirge` nennt (`terrain_control`): Typ, Grundmuster, Kammhöhe, das Netz und die Werte der Reiter. */
const GEBIRGE_FESTE_SPALTEN: ReadonlySet<string> = new Set(["gebirgstyp", "muster", "maximalhoehe", "netz"]);
const istGebirgsSpalte = (feld: string): boolean =>
    GEBIRGE_FESTE_SPALTEN.has(feld) || isMessageKey(`landschaftseditor.gebirge.wert.${feld}`);

/**
 * Der Name eines Felds in einer Konfliktmeldung der Rücknahme (WI-0265 B5d): An einer Teilfläche (`area`) nennt der Server die Spalten des Gebirges ohne Vorsilbe
 * (`maximalhoehe`, `netz`); sie heißen wie im Reiter „Gebirge“ („Höhe des Kamms“, „Gezeichnete Kämme“). Alles andere benennt `feldNameFuer`.
 */
export const konfliktFeldName = (kind: MapHistoryObjectKind | undefined, feld: string): string =>
    kind === "area" && istGebirgsSpalte(feld) ? gebirgeSpaltenName(feld).text : feldNameFuer(kind, feld);

/**
 * Der Name, den der Editor einer Art liefert (`feldName` am Verlauf), oder, wo er den Schlüssel unverändert zurückgibt, der lesbare Rückfall;
 * so steht auch im Verlauf eines Objekts nie ein roher Schlüssel da.
 */
export function bezeichneMit(feldName: (feld: string) => string, feld: string): Bezeichnung {
    if (feld.startsWith(GEBIRGE_PRAEFIX)) return gebirgeSpaltenName(feld.slice(GEBIRGE_PRAEFIX.length));
    const text = feldName(feld);
    return text === feld ? { text: lesbar(feld), schluessel: feld } : { text };
}

// --- Werte -----------------------------------------------------------------------------------------------------------------

const istObjekt = (wert: unknown): wert is Record<string, unknown> =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert);

/** `wegeditor-fenster.vue`, `verlaufWert`: die Wegart mit Namen, die Kurve als Zahl der Stützpunkte, Höhen und Reisemittel als Satz. */
function wegWert(feld: string, wert: unknown): string | undefined {
    if (feld === "subtype" && typeof wert === "string") return wegArtName(wert);
    if (feld === "mark") return typeof wert === "string" ? wegArtName(wert) : t("editorListe.nein");
    if (feld === "isBach") return wert === true ? t("editorListe.ja") : t("editorListe.nein");
    if (feld === "flowDirection") {
        const richtung = wert === "forward" || wert === "reverse" ? wert : "offen";
        return t(`wegeditor.tafel.richtung.${richtung}` as MessageKey);
    }
    if (feld === "geometry" && Array.isArray(wert))
        return t("wegeditor.fenster.stuetzpunkte", { n: formatNumber(wert.length, 0) });
    if (feld === "wasserHoehen" && Array.isArray(wert))
        return wert
            .flatMap((eintrag: unknown) => {
                const { h, x, y } = (eintrag ?? {}) as { h?: unknown; x?: unknown; y?: unknown };
                return typeof h === "number" && typeof x === "number" && typeof y === "number"
                    ? [
                          t("wegeditor.verlauf.wasserHoehe", {
                              h: formatNumber(h, 0),
                              einheit: t("planner.slope.unit"),
                              ort: `${formatDecimal(x, 2)}/${formatDecimal(y, 2)}`,
                          }),
                      ]
                    : [];
            })
            .join(" · ");
    if (feld === "wiki" && istObjekt(wert)) {
        const { titel, url } = wert as { titel?: unknown; url?: unknown };
        return typeof titel === "string" ? titel : typeof url === "string" ? url : t("editorListe.ja");
    }
    // Die weiteren Straßennamen (WI-0302): vorher und nachher als Liste `[{ key, name }]`, die Namen mit Komma.
    if (feld === "weitere" && Array.isArray(wert)) return weitereNamenText(wert);
    if (feld === "reisen" && istObjekt(wert)) {
        const { liste: mittel, fenster: zeiten } = wert as { liste?: unknown; fenster?: unknown };
        const fenster = istObjekt(zeiten) ? Object.keys(zeiten).length : 0;
        const liste = Array.isArray(mittel)
            ? mittel.length === 0
                ? t("wegeditor.reisemittel.keine")
                : mittel
                      .map((m) => {
                          const schluessel = `planner.transport.opt.${String(m)}`;
                          return isMessageKey(schluessel) ? t(schluessel) : lesbar(String(m));
                      })
                      .join(", ")
            : t("wegeditor.reisemittel.vorgabe");
        return fenster === 0
            ? liste
            : `${liste} · ${tPlural("wegeditor.reisemittel.fensterZahl", fenster, { n: formatNumber(fenster, 0) })}`;
    }
    return undefined;
}

/** `kraftlinieneditor-fenster.vue`, `bogenText`: der Bogen in Prozent der Länge. */
function bogenText(bogen: number | null): string {
    const wert = Math.round(bogen ?? 0);
    return `⌒ ${wert > 0 ? "+" : wert < 0 ? "−" : "±"}${formatNumber(Math.abs(wert), 0)} %`;
}

/** `landschaftseditor-fenster.vue`, `verlaufWert`: Ebene und Art mit Namen, die Kurve und die Spanne als Satz, die Form als Zahl der Ecken. */
function landschaftWert(feld: string, wert: unknown): string | undefined {
    if (feld === "layer" && typeof wert === "string") {
        const schluessel = `layer.${wert}`;
        return isMessageKey(schluessel) ? t(schluessel) : lesbar(wert);
    }
    if (feld === "type" && (typeof wert === "string" || wert === null)) return landschaftArtName(wert ?? undefined);
    // Die Gefahrenlage (WI-0308): die Arten mit Namen, leer „ungefährlich“.
    if (feld === "hazards" && Array.isArray(wert)) return gefahrenText(wert as string[]);
    if (feld === "curve" && istObjekt(wert)) {
        const kurve = wert as { enabled?: boolean | null; max?: number | null };
        return kurve.enabled === true
            ? t("landschaftseditor.beschriftung.entlang", { n: formatNumber(kurve.max ?? 1, 0) })
            : t("editorListe.nein");
    }
    if (feld === "zoom" && Array.isArray(wert)) {
        const [von, bis] = wert as [number | null, number | null];
        return von === null || bis === null || von === undefined || bis === undefined
            ? t("landschaftseditor.beschriftung.vorgabe")
            : t("landschaftseditor.beschriftung.zoomEigen", { von, bis });
    }
    if (feld === "position" && Array.isArray(wert) && wert.length === 2) {
        const [x, y] = wert as [number, number];
        return `${formatNumber(x, 1)} · ${formatNumber(y, 1)}`;
    }
    if (feld === "geometry") {
        const ecken = punkteIn(wert);
        if (ecken !== undefined) return t("landschaftseditor.verlauf.ecken", { n: formatNumber(ecken, 0) });
    }
    return undefined;
}

/** Die Felder, in denen die Inhalte (und die Quellen eines Trägers, `quellen`) Listen von Zeilen führen: Quellen, Ortszeilen, Regeln, Verweise. */
const LISTEN_FELDER: ReadonlySet<string> = new Set(["quellen", "sources", "places", "rules", "links"]);

/**
 * Eine Liste solcher Zeilen als Satz aus ihren Namen („Wiki Aventurica, Regelwerk“), wenn JEDE Zeile einen Titel oder Namen führt; sonst `undefined` (dann zählt `wertText` sie:
 * „3 Einträge“). Nie JSON (WI-0265 B6f).
 */
function listenText(wert: unknown): string | undefined {
    if (!Array.isArray(wert) || wert.length === 0) return undefined;
    const namen = wert.map((zeile: unknown) => {
        if (!istObjekt(zeile)) return undefined;
        const name = zeile["title"] ?? zeile["name"];
        return typeof name === "string" && name !== "" ? name : undefined;
    });
    return namen.every((name) => name !== undefined) ? kuerzen(namen.join(", ")) : undefined;
}

/**
 * Ein Wert aus einer festen Reihe von Codes mit dem Namen, den die Oberfläche ihm gibt (WI-0265 B6i): die Herkunft einer Sprache und ihrer Teilfläche („Redaktion“, „Referenzkarte“), die
 * Herkunft eines Felds (`…Origin`: „aus dem Wiki“, „von der Redaktion“), der Typ einer Quelle („Regelbuch“). `undefined`, wo das Web für den Wert keinen Namen hat.
 */
function codeWert(familie: Familie | undefined, feld: string, wert: unknown): string | undefined {
    if (typeof wert !== "string") return undefined;
    if (familie === "sprache" && feld === "herkunft") {
        if (wert === "sprachenkarte") return t("spracheditor.herkunft.sprachenkarte");
        if (wert === "redaktion") return t("spracheditor.herkunft.redaktion");
    }
    if (feld.endsWith("Origin")) {
        if (wert === "wiki") return t("ortseditor.herkunft.wiki");
        if (wert === "manual" || wert === "override" || wert === "redaktion") return t("ortseditor.herkunft.redaktion");
    }
    if (familie === "inhalte" && feld === "sourceType") {
        const schluessel = `infoPanel.sourceType.${wert}`;
        if (isMessageKey(schluessel)) return t(schluessel);
    }
    return undefined;
}

/**
 * Der Wert eines Felds in Worten der Art: Wegart, Ebene, Gebirgswerte mit Einheit, Kennungen als „anderer Eintrag“, ein Objekt als Satz.
 * `undefined` nur, wenn das Protokoll den Wert nicht führt.
 */
export function feldWert(kind: MapHistoryObjectKind | undefined, feld: string, wert: unknown): string | undefined {
    if (wert === undefined) return undefined;
    if (feld.startsWith(GEBIRGE_PRAEFIX)) return gebirgeSpaltenWert(feld.slice(GEBIRGE_PRAEFIX.length), wert);
    if (feld === "gebirge" && istObjekt(wert)) return gebirgeText(wert);
    // Die Herkunft der Zuordnung (Zustand, Herkunft, System): in Worten die Herkunft, nie die Schlüssel.
    if (feld === "zuordnung" && istObjekt(wert)) {
        const herkunft = wert["herkunft"];
        if (herkunft === "editor") return t("ortseditor.herkunft.redaktion");
        if (herkunft === "wiki_sync") return t("ortseditor.herkunft.wiki");
        return t("aenderungen.zuordnung.herkunft.import");
    }
    const code = codeWert(kind === undefined ? undefined : FAMILIE[kind], feld, wert);
    if (code !== undefined) return code;
    // Die angelegte Quelle (`source.created`, die Marke der Rücknahme): ihr Titel, nicht ihre Schlüssel.
    if (feld === "created" && kind === "source" && istObjekt(wert) && typeof wert["title"] === "string")
        return kuerzen(wert["title"]);
    if (LISTEN_FELDER.has(feld) && ((kind !== undefined && FAMILIE[kind] === "inhalte") || feld === "quellen")) {
        const liste = listenText(wert);
        if (liste !== undefined) return liste;
    }
    const familie = kind === undefined ? undefined : FAMILIE[kind];
    let eigen: string | undefined;
    if (familie === "weg") eigen = wegWert(feld, wert);
    else if (familie === "landschaft") eigen = landschaftWert(feld, wert);
    else if (familie === "sprache") eigen = sprachVerlaufWert(feld, wert);
    else if (familie === "kraftlinie" && feld === "curve" && (typeof wert === "number" || wert === null))
        eigen = bogenText(wert);
    else if (familie === "kraftlinie" && (feld === "from" || feld === "to") && istKennung(wert))
        eigen = knotenName(wert);
    else if (familie === "gipfel" && feld === "height" && typeof wert === "number")
        eigen = t("scale.schritt", { n: formatNumber(wert, 0) });
    else if (familie === "gebiet") {
        if (feld === "parent" && wert === null) eigen = t("gebietseditor.obergebiet.keins");
        else if (feld === "parent" && istKennung(wert)) eigen = gebietName(wert);
        else if (feld === "geometry" && wert !== null) eigen = t("gebietseditor.verlauf.form");
    } else if (
        familie === "ort" &&
        (feld === "position" || (!Array.isArray(wert) && !istObjekt(wert) && !istKennung(wert)))
    )
        eigen = ortWert(feld, wert);
    if (eigen !== undefined) return kuerzen(eigen);
    return wertText(feld, wert);
}
