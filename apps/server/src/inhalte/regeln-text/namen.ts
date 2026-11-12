import {
    INHALTE_VORKOMMEN_ARTEN,
    INHALTE_VORKOMMEN_BEZIEHUNGEN,
    WIKISYNC_KLIMAZONEN,
    WIKISYNC_LAGE_ORTSARTEN,
    WIKISYNC_LAGE_RICHTUNGEN,
    WIKISYNC_LANDSCHAFTSARTEN,
} from "@avesmaps3d/shared";

/**
 * Die deutschen Anzeigenamen für „Regeln als Text“ (WI-0254 §13): Der Text schreibt die Landschaftsarten, Klimazonen, Richtungen, Beziehungen und Kategorien mit den Wörtern, die die Oberfläche zeigt.
 * Die Tafel der Oberfläche (`apps/web/src/i18n/de.ts`) darf der Server nicht einlesen; darum steht hier eine kleine Kopie, und `test/regeln-text-namen.test.ts` hält jeden Wert gegen die Schlüssel in `de.ts`
 * (`DE_SCHLUESSEL`), damit beide nicht auseinanderlaufen. Die Folge der Schlüssel kommt aus den Wortlisten des Vertrags (`WIKISYNC_*`, `INHALTE_VORKOMMEN_*`), nicht von hier.
 */

/** Die Landschaftsarten (`landscape.type.<art>`): 33 Stück, Ebene und Art stehen in `WIKISYNC_LANDSCHAFTSARTEN`. */
export const ARTEN_NAMEN: Readonly<Record<string, string>> = {
    region: "Region",
    inselgruppe: "Inselgruppe",
    kontinent: "Kontinent",
    sonstiges: "Sonstiges",
    gebirge: "Gebirge",
    see: "See",
    meer: "Meer",
    kueste: "Küste",
    huegelland: "Hügelland",
    wadi: "Wadi",
    schlucht: "Schlucht",
    hochebene: "Hochebene",
    tiefebene: "Tiefebene",
    tal: "Tal",
    flussdelta: "Flussdelta",
    insel: "Insel",
    gletscher: "Gletscher",
    flachkueste: "Flachküste",
    steilkueste: "Steilküste",
    schneelandschaft: "Schneelandschaft",
    eislandschaft: "Eislandschaft",
    wald: "Wald",
    urwald: "Urwald",
    suempfe_moore: "Sümpfe und Moore",
    steppe: "Steppe",
    tundra: "Tundra",
    auenlandschaft: "Auenlandschaft",
    wueste: "Wüste",
    graslandschaft: "Graslandschaft",
    flussland_flusstal: "Flussland/Flusstal",
    dschungel: "Dschungel",
    wuestenoase: "Wüstenoase",
    kulturlandschaft: "Kulturlandschaft",
};

/** Die Klimazonen (`climate.zone.<zone>`). */
export const ZONEN_NAMEN: Readonly<Record<string, string>> = {
    polar: "Polare Zone",
    subpolar: "Subpolare Zone",
    boreal: "Boreale Zone",
    gemaessigt: "Gemäßigte Zone",
    subtropen_winterfeucht: "Winterfeuchte Subtropen",
    trockene_subtropen: "Subtropische Steppenzone",
    subtropisch: "Subtropische Wüstenzone",
    tropisch: "Tropische Zone",
};

/** Die Ebenen (`layer.<ebene>`); `klima` kommt vor, weil eine Fläche der Klima-Ebene in einer Rückfrage stehen kann. */
export const EBENEN_NAMEN: Readonly<Record<string, string>> = {
    derographisch: "Regionen",
    vegetation: "Vegetation",
    topographie: "Topographie",
    klima: "Klimazonen",
};

/** Die vier Richtungen der Lage (`admin.wikisync.regeln.richtung.<richtung>`). */
export const RICHTUNG_NAMEN: Readonly<Record<string, string>> = {
    nord: "nördlich",
    sued: "südlich",
    ost: "östlich",
    west: "westlich",
};

/** Die vier Beziehungen einer Regel (`inhalte.vorkommen.beziehung.<beziehung>`). */
export const BEZIEHUNGS_NAMEN: Readonly<Record<string, string>> = {
    verbreitung: "Verbreitung",
    herkunft: "Herkunft",
    regionen: "Regionen",
    vorkommen: "Vorkommen",
};

/** Die Kategorien eines Eintrags (`infoPanel.lore.<art>`): „Waren“ im Plural, wie die Oberfläche sie nennt. */
export const KATEGORIE_NAMEN: Readonly<Record<string, string>> = {
    fauna: "Fauna",
    flora: "Flora",
    ware: "Waren",
    spezies: "Spezies",
};

/** Die Größen der Orte (`place.<art>`), für die Zeile unter einer Rückfrage nach einem Ort. */
export const ORTSARTEN_NAMEN: Readonly<Record<string, string>> = {
    metropole: "Metropole",
    grossstadt: "Großstadt",
    stadt: "Stadt",
    kleinstadt: "Kleinstadt",
    dorf: "Dorf",
};

/**
 * Zu jeder Tafel der Schlüsselanfang in `de.ts`; `test/regeln-text-namen.test.ts` liest die Datei und vergleicht jeden Wert. Fehlt in der Oberfläche ein Wort oder ändert es sich, wird der Test rot,
 * statt dass der Text still ein anderes Wort schreibt als die Oberfläche zeigt.
 */
export const DE_SCHLUESSEL: readonly {
    tafel: Readonly<Record<string, string>>;
    anfang: string;
    schluessel: readonly string[];
}[] = [
    { tafel: ARTEN_NAMEN, anfang: "landscape.type.", schluessel: WIKISYNC_LANDSCHAFTSARTEN.map((eine) => eine.art) },
    { tafel: ZONEN_NAMEN, anfang: "climate.zone.", schluessel: WIKISYNC_KLIMAZONEN },
    { tafel: EBENEN_NAMEN, anfang: "layer.", schluessel: ["derographisch", "vegetation", "topographie", "klima"] },
    { tafel: RICHTUNG_NAMEN, anfang: "admin.wikisync.regeln.richtung.", schluessel: WIKISYNC_LAGE_RICHTUNGEN },
    { tafel: BEZIEHUNGS_NAMEN, anfang: "inhalte.vorkommen.beziehung.", schluessel: INHALTE_VORKOMMEN_BEZIEHUNGEN },
    { tafel: KATEGORIE_NAMEN, anfang: "infoPanel.lore.", schluessel: INHALTE_VORKOMMEN_ARTEN },
    { tafel: ORTSARTEN_NAMEN, anfang: "place.", schluessel: WIKISYNC_LAGE_ORTSARTEN },
];
