import type { ContextLandscape, SubjectKind } from "./subject.ts";

/**
 * Die Kopfgrafik der Art (WI-0063 P6, Guide §16.1; Legacy `js/ui/popups.js`: `INFO_HEADER_IMAGE_BY_ART`,
 * `INFO_HEADER_IMAGE_BY_PATH`, `INFO_HEADER_IMAGE_BY_SETTLEMENT`, Mirror `b9657635a`).
 *
 * Der Kopf zeigt IMMER ein 16:9-Bild: die eigenen Bilder des Objekts als Folge (`media.header`), sonst die Grafik nach Art. Welche
 * Grafik zu welcher Art gehört, ist die Zuordnung Legacys - übernommen, nicht neu erfunden - nur in den Schlüsseln UNSERER Daten:
 * Legacy schlägt die Wiki-Art als Freitext nach (`Bucht`, `Marschland`), wir die Art der Region (`region_type`).
 *
 * 🔴 Eine unbekannte Art fällt auf `region` zurück (ein Landschaftsbild), nie auf ein Stadtbild: Der Rückfall ist nach Legacys
 * Tafel je Objektart ein anderer (Ort `metropole`, Weg und Landschaft `region`), und genau diese Tafel hält `header-graphic.test.ts`.
 *
 * Die Dateien liegen unter `apps/web/public/icons/header/<name>.webp` (`scripts/dev/build-info-icons.py`, 800 × 450).
 *
 * Seit WI-0068 Typbilder (Betreiber 2026-10-11/12) in `shared`: Der Server zählt je Kategorie die Objekte (Medienverwaltung „Typbilder“),
 * das Infopanel wählt danach die Grafik. Die Zuordnung ist dieselbe, nur an EINER Stelle.
 */

/** Alle Namen, zu denen es eine Datei gibt - der Test legt die Liste neben den Ordner. */
export const HEADER_GRAPHICS = [
    "auenlandschaft",
    "berggipfel",
    "bergtundra",
    "dorf",
    "dschungel",
    "ebene",
    "fauna",
    "fels",
    "flora",
    "fluss",
    "flussweg",
    "furt",
    "gebaeude",
    "gebiet",
    "gebirge",
    "gebirgspass",
    "graslandschaft",
    "grossstadt",
    "grotte",
    "heideland",
    "hoehle",
    "huegel",
    "insel",
    "kleinstadt",
    "kraftlinien",
    "krater",
    "kueste",
    "kulturlandschaft",
    "mahlstrom",
    "meer",
    "meeresstroemung",
    "metropole",
    "oedland",
    "pfad",
    "quelle",
    "region",
    "reichsstrasse",
    "riff",
    "savanne",
    "schlucht",
    "see",
    "seeweg",
    "spezies",
    "sprachen",
    "stadt",
    "steppe",
    "strasse",
    "strudel",
    "sumpfmoor",
    "tundra",
    "urwald",
    "vorkommen",
    "vulkan",
    "wadi",
    "wald",
    "ware",
    "wasserfall",
    "weg",
    "wind",
    "wirbelsturm",
    "wueste",
    "wuestenoase",
    "wuestenpfad",
] as const;
export type HeaderGraphic = (typeof HEADER_GRAPHICS)[number];

/** Art der Region (`region_type`) -> Grafik, nach Legacys `INFO_HEADER_IMAGE_BY_ART`. */
const BY_LANDSCAPE: Readonly<Record<string, HeaderGraphic>> = {
    gebirge: "gebirge",
    schlucht: "gebirge",
    vulkan: "gebirge",
    berggipfel: "berggipfel",
    wald: "wald",
    urwald: "urwald",
    dschungel: "dschungel",
    wuestenoase: "wuestenoase",
    kulturlandschaft: "kulturlandschaft",
    wadi: "wadi",
    flussland_flusstal: "fluss",
    flussdelta: "fluss",
    meer: "meer",
    see: "see",
    kueste: "kueste",
    insel: "insel",
    inselgruppe: "insel",
    suempfe_moore: "sumpfmoor",
    wueste: "wueste",
    steppe: "steppe",
    huegelland: "huegel",
    graslandschaft: "graslandschaft",
    auenlandschaft: "auenlandschaft",
    tundra: "tundra",
    tal: "ebene",
    tiefebene: "ebene",
    hochebene: "ebene",
    // Die vier Arten aus WI-0301 haben seit 2026-11-10 eigene KI-Typbilder (Betreiber: Bergtundra.png, Savanne.png, Heide.png und
    // Oedland.png aus `avesmaps-map-processing/icons/info_header_graphics`); vorher liehen sie Steppe, Graslandschaft, Wüste und Tundra.
    savanne: "savanne",
    heideland: "heideland",
    oedland: "oedland",
    bergtundra: "bergtundra",
};

/** Wegart (`path.subtype`) -> Grafik, nach Legacys `INFO_HEADER_IMAGE_BY_PATH` (Dateiname = Schlüssel der Wegart). */
const BY_PATH: Readonly<Record<string, HeaderGraphic>> = {
    Reichsstrasse: "reichsstrasse",
    Strasse: "strasse",
    Weg: "weg",
    Pfad: "pfad",
    Gebirgspass: "gebirgspass",
    Wuestenpfad: "wuestenpfad",
    Flussweg: "flussweg",
    Seeweg: "seeweg",
};

/** Ortsklasse (`place.subtype`) -> Grafik, nach Legacys `INFO_HEADER_IMAGE_BY_SETTLEMENT`; das Stadtviertel leiht das Gebäude. */
const BY_PLACE: Readonly<Record<string, HeaderGraphic>> = {
    metropole: "metropole",
    grossstadt: "grossstadt",
    stadt: "stadt",
    kleinstadt: "kleinstadt",
    dorf: "dorf",
    gebaeude: "gebaeude",
    stadtviertel: "gebaeude",
};

/**
 * Art eines Eintrags im Wiki (`lore_entry.kind`: Flora, Fauna, Ware, Spezies) -> Grafik (WI-0260, Betreiber 2026-10-30: „waren, fauna,
 * flora, spezies headergrafiken. die sollen verwendet werden - format ist das von der standardinfobox“). Ein Eintrag zeigt im Kopf das
 * Typbild seiner Art. Die allgemeine Grafik „Vorkommen“ trägt nur der Sammelscreen „Ausgewählte Vorkommen“ (WI-0257 S5, Vali 2026-10-30):
 * Er zeigt mehrere Einträge verschiedener Art zugleich und ist kein Subject; keine Art führt auf sie.
 */
const BY_LORE: Readonly<Record<string, HeaderGraphic>> = {
    flora: "flora",
    fauna: "fauna",
    ware: "ware",
    spezies: "spezies",
};

/**
 * Typ eines Wetter-Icons mit Wiki-Verweis (`wetterSymbolTyp`: die Art des Icons, bei einem Mahlstrom-Artikel `mahlstrom`) -> Grafik (WI-0288; Valis
 * Bilder vom 2026-11-08). Ein Icon ohne Verweis hat kein Panel und damit kein Bild. Die Landmarke `strudel` behält ihr eigenes Bild.
 */
const BY_WETTER: Readonly<Record<string, HeaderGraphic>> = {
    wind: "wind",
    wirbel: "wirbelsturm",
    stroemung: "meeresstroemung",
    mahlstrom: "mahlstrom",
};

export const headerGraphicOfLandscape = (type: string | undefined): HeaderGraphic =>
    BY_LANDSCAPE[type ?? ""] ?? "region";

/** Eine unbekannte Art fällt wie die Landschaft auf das allgemeine Bild zurück, nie auf das einer anderen Art. */
export const headerGraphicOfWetterSymbol = (typ: string | undefined): HeaderGraphic => BY_WETTER[typ ?? ""] ?? "region";

/**
 * Landmarkenart (`terrain_peak.subtype`, WI-0271 L6) -> Grafik: Valis Bilder vom 2026-10-31. Geysir hat keins und nimmt das der Quelle, Klippe
 * das der Küste. Eine unbekannte Art zeigt den Berggipfel (wie vorher jeder Gipfel ohne Art).
 */
const BY_LANDMARKE: Readonly<Record<string, HeaderGraphic>> = {
    berggipfel: "berggipfel",
    vulkan: "vulkan",
    huegel: "huegel",
    hoehle: "hoehle",
    grotte: "grotte",
    krater: "krater",
    schlucht: "schlucht",
    wasserfall: "wasserfall",
    quelle: "quelle",
    geysir: "quelle",
    furt: "furt",
    strudel: "strudel",
    fels: "fels",
    klippe: "kueste",
    riff: "riff",
};
export const headerGraphicOfLandmarke = (art: string | undefined): HeaderGraphic =>
    BY_LANDMARKE[art ?? ""] ?? "berggipfel";
export const headerGraphicOfPath = (subtype: string | undefined): HeaderGraphic => BY_PATH[subtype ?? ""] ?? "region";
/** Eine unbekannte Art eines Eintrags fällt wie die Landschaft auf das allgemeine Bild zurück, nie auf das einer anderen Art. */
export const headerGraphicOfLore = (kind: string | undefined): HeaderGraphic => BY_LORE[kind ?? ""] ?? "region";
/** Legacy: eine unbekannte Ortsklasse zeigt das große Stadtbild. */
export const headerGraphicOfPlace = (subtype: string | undefined): HeaderGraphic =>
    BY_PLACE[subtype ?? ""] ?? "metropole";

/**
 * Das Bild einer freien Kartenstelle: der ERSTE Treffer, der wirklich ein Bild ergibt - erst Vegetation, dann Topographie, dann
 * `region` (Legacy `avesmapsWhatIsHereHeaderImageBasename`). Ein Treffer ohne Art (die Derographie) ergibt kein Bild: Legacy
 * sucht weiter, statt den ersten blind zu nehmen.
 */
export function headerGraphicOfPoint(landscapes: readonly ContextLandscape[] | undefined): HeaderGraphic {
    for (const layer of ["vegetation", "topographie"]) {
        for (const item of landscapes ?? []) {
            if (item.layer !== layer) continue;
            const graphic = headerGraphicOfLandscape(item.type);
            if (graphic !== "region") return graphic;
        }
    }
    return "region";
}

/** Die Grafik eines Subjects nach Art und Schlüssel der Art (Ortsklasse, Region- oder Wegart); der Kartenpunkt rechnet über `headerGraphicOfPoint`. */
export function headerGraphicOf(kind: SubjectKind, typeKey: string | undefined): HeaderGraphic {
    switch (kind) {
        case "place":
            return headerGraphicOfPlace(typeKey);
        case "area":
            return headerGraphicOfLandscape(typeKey);
        case "peak":
            return headerGraphicOfLandmarke(typeKey);
        case "path":
        case "routeStage":
            return headerGraphicOfPath(typeKey);
        case "powerline":
            return "kraftlinien";
        /*
         * Ein Gebiet trägt eine politische Art (Baronie, Grafschaft, Herzogtum, Sultanat …), keine Landschaftsart. Legacy zeigte
         * dafür das allgemeine Bild; seit dem Betreiberentscheid vom 2026-10-13 („ja zu allen drei“, Matrix
         * `project-control/discovery/typbildabdeckung-matrix-2026-10-13.md` §5) hat es ein eigenes — EINE Kategorie für alle 1.676
         * Gebiete, ausdrücklich nicht eine je Adelsrang.
         */
        case "territory":
            return "gebiet";
        // Klimabänder und freie Kartenstellen bleiben beim allgemeinen Bild: dort war die Empfehlung nein, und er hat sie getragen.
        case "mapPoint":
        case "climate":
            return "region";
        // Ein Eintrag eines Vorkommens zeigt das Typbild seiner Art (Flora, Fauna, Ware, Spezies; WI-0260); `typeKey` ist `lore_entry.kind`.
        case "loreEntry":
            return headerGraphicOfLore(typeKey);
        // Eine Sprache (WI-0261 S5b): ein Bild für alle, `Sprachen.png` des Betreibers (2026-10-30).
        case "sprache":
            return "sprachen";
        // Ein Wetter-Icon mit Wiki-Verweis (WI-0288): `typeKey` ist sein Typ (`wetterSymbolTyp`), die Art des Icons oder `mahlstrom`.
        case "wetterSymbol":
            return headerGraphicOfWetterSymbol(typeKey);
    }
}

/** Der deutsche Name je Kategorie (Medienverwaltung „Typbilder“). */
export const HEADER_GRAPHIC_LABELS: Readonly<Record<HeaderGraphic, string>> = {
    auenlandschaft: "Auenlandschaft",
    berggipfel: "Berggipfel",
    bergtundra: "Bergtundra",
    dorf: "Dorf",
    dschungel: "Dschungel",
    ebene: "Ebene",
    fauna: "Fauna",
    fels: "Fels",
    flora: "Flora",
    fluss: "Fluss",
    flussweg: "Flussweg",
    furt: "Furt",
    gebaeude: "Gebäude",
    gebiet: "Gebiet",
    gebirge: "Gebirge",
    gebirgspass: "Gebirgspass",
    graslandschaft: "Graslandschaft",
    grossstadt: "Großstadt",
    grotte: "Grotte",
    heideland: "Heideland",
    hoehle: "Höhle",
    huegel: "Hügel",
    insel: "Insel",
    kleinstadt: "Kleinstadt",
    kraftlinien: "Kraftlinien",
    krater: "Krater",
    kueste: "Küste",
    kulturlandschaft: "Kulturlandschaft",
    mahlstrom: "Mahlstrom",
    meer: "Meer",
    meeresstroemung: "Meeresströmung",
    metropole: "Metropole",
    oedland: "Ödland",
    pfad: "Pfad",
    quelle: "Quelle",
    region: "Region",
    reichsstrasse: "Reichsstraße",
    riff: "Riff, Sandbank",
    savanne: "Savanne",
    schlucht: "Schlucht",
    see: "See",
    seeweg: "Seeweg",
    spezies: "Spezies",
    sprachen: "Sprachen",
    stadt: "Stadt",
    steppe: "Steppe",
    strasse: "Straße",
    strudel: "Strudel",
    sumpfmoor: "Sumpf und Moor",
    tundra: "Tundra",
    urwald: "Urwald",
    vorkommen: "Vorkommen",
    vulkan: "Vulkan",
    wadi: "Wadi",
    wald: "Wald",
    ware: "Ware",
    wasserfall: "Wasserfall",
    weg: "Weg",
    wind: "Wind",
    wirbelsturm: "Wirbelsturm",
    wueste: "Wüste",
    wuestenoase: "Wüstenoase",
    wuestenpfad: "Wüstenpfad",
};

/**
 * Welche Objekte eine Kategorie zeigen: Orte, Landschaften, Wege oder übrige (Kraftlinien, Gebiete, freie Kartenstellen, die Einträge
 * der Vorkommen: Flora, Fauna, Ware, Spezies, und die Wetter-Icons mit Wiki-Verweis). Die Einträge sind keine Kartenobjekte; ein eigener Wert für sie (und sein Wort im Trichter
 * der Typbilder) ist dem Betreiber nicht vorgelegt.
 */
export type HeaderGraphicObjects = "place" | "landscape" | "path" | "other";

/**
 * Die Schlüssel je Objektart, die auf eine Kategorie führen (aus denselben Tafeln wie die Wahl der Grafik). Bei den Einträgen der Vorkommen
 * ist der Schlüssel ihre Art (`lore_entry.kind`), bei den Wetter-Icons ihr Typ (`wetterSymbolTyp`); beide zählen zu „übrige“.
 */
export function headerGraphicKeys(graphic: HeaderGraphic): { objects: HeaderGraphicObjects; keys: string[] } {
    const of = (table: Readonly<Record<string, HeaderGraphic>>): string[] =>
        Object.entries(table)
            .filter(([, value]) => value === graphic)
            .map(([key]) => key);
    const place = of(BY_PLACE);
    if (place.length > 0) return { objects: "place", keys: place };
    const path = of(BY_PATH);
    if (path.length > 0) return { objects: "path", keys: path };
    const landscape = of(BY_LANDSCAPE);
    if (landscape.length > 0) return { objects: "landscape", keys: landscape };
    return { objects: "other", keys: [...of(BY_LORE), ...of(BY_WETTER)] };
}
