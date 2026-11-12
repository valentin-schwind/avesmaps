/**
 * Das Vokabular des SVG-Abzugs (WI-0280 K2): was die Datei über sich selbst sagt.
 *
 * 🔴 DIE DATEI ERKLÄRT JEDE VOKABEL, DIE SIE BENUTZT (Vertrag, `docs/svg-export-semantik-uebergabe.md` im Legacy-Mirror). Wer sie als
 * semantische Quelle liest, muss weder Avesmaps kennen noch Namen aus ids parsen. Ein Test erzwingt es (`karten-svg.test.ts`).
 *
 * 🔴 NUR FAKTEN, KEINE DEUTUNG (Owner-Entscheid 16.08.2026). Was „Wald × tropisch“ BEDEUTET, steht nicht in der Datei: Das ist die
 * Aufgabe des Prompt-Bauers. Sonst wäre die SVG ein Art-Direction-Dokument, und jede Änderung an der Bildsprache verlangte einen
 * neuen Export.
 *
 * ⚠️ Die englischen Begriffe der Legacy-Arten sind aus den Kommentaren in Legacys `css/base/tokens.css` abgeschrieben
 * („dense forest“, „swamp and moor“, „wadi, sand with an olive cast“ …). Sie stehen hier, weil CSS-Kommentare zur Laufzeit nicht
 * lesbar sind. Neu in Avesmaps3D sind `urwald` und die Landmarkenarten; deren Begriffe sind nach demselben Muster gesetzt.
 */

export interface Begriff {
    readonly de: string;
    readonly en: string;
}

export const TYP_VOKABULAR: Readonly<Record<string, Begriff>> = {
    // Vegetation
    wald: { de: "Wald", en: "dense forest" },
    urwald: { de: "Urwald", en: "primeval forest" },
    suempfe_moore: { de: "Sümpfe & Moore", en: "swamp and moor" },
    steppe: { de: "Steppe", en: "steppe" },
    tundra: { de: "Tundra", en: "tundra" },
    schneelandschaft: { de: "Schneelandschaft", en: "snow landscape" },
    eislandschaft: { de: "Eislandschaft", en: "ice landscape" },
    auenlandschaft: { de: "Auenlandschaft", en: "floodplain" },
    wueste: { de: "Wüste", en: "desert" },
    graslandschaft: { de: "Graslandschaft", en: "grassland" },
    flussland_flusstal: { de: "Flussland & Flusstal", en: "river land and valley" },
    dschungel: { de: "Dschungel", en: "jungle" },
    wuestenoase: { de: "Wüstenoase", en: "desert oasis" },
    kulturlandschaft: { de: "Kulturlandschaft", en: "cultivated land" },
    // Topographie
    gebirge: { de: "Gebirge", en: "mountains" },
    huegelland: { de: "Hügelland", en: "hills" },
    see: { de: "See", en: "lake" },
    meer: { de: "Meer", en: "sea" },
    kueste: { de: "Küste", en: "coast" },
    wadi: { de: "Wadi", en: "wadi, dry river bed" },
    schlucht: { de: "Schlucht", en: "gorge" },
    hochebene: { de: "Hochebene", en: "plateau" },
    tiefebene: { de: "Tiefebene", en: "lowland" },
    tal: { de: "Tal", en: "valley" },
    flussdelta: { de: "Flussdelta", en: "river delta" },
    insel: { de: "Insel", en: "island" },
    gletscher: { de: "Gletscher", en: "glacier" },
    flachkueste: { de: "Flachküste", en: "flat coast" },
    steilkueste: { de: "Steilküste", en: "cliff coast" },
    // Klima
    polar: { de: "Polar", en: "polar" },
    subpolar: { de: "Subpolar", en: "subpolar" },
    boreal: { de: "Boreal", en: "boreal" },
    gemaessigt: { de: "Gemäßigt", en: "temperate" },
    subtropen_winterfeucht: { de: "Subtropen, winterfeucht", en: "winter-wet subtropics" },
    trockene_subtropen: { de: "Trockene Subtropen", en: "dry subtropics" },
    subtropisch: { de: "Subtropisch", en: "subtropical" },
    tropisch: { de: "Tropisch", en: "tropical" },
    // Derographische Behälter
    kontinent: { de: "Kontinent", en: "continent" },
    inselgruppe: { de: "Inselgruppe", en: "archipelago" },
    region: { de: "Region", en: "region" },
    ohne_typ: { de: "ohne Typ", en: "untyped area" },
    // Wegarten
    Reichsstrasse: { de: "Reichsstraße", en: "imperial road" },
    Strasse: { de: "Straße", en: "road" },
    Weg: { de: "Weg", en: "track" },
    Pfad: { de: "Pfad", en: "footpath" },
    Gebirgspass: { de: "Gebirgspass", en: "mountain pass" },
    Wuestenpfad: { de: "Wüstenpfad", en: "desert trail" },
    Flussweg: { de: "Flussweg", en: "river" },
    Bach: { de: "Bach", en: "brook" },
    Seeweg: { de: "Seeweg", en: "sea route" },
    // Ortsarten
    metropole: { de: "Metropole", en: "metropolis" },
    grossstadt: { de: "Großstadt", en: "large city" },
    stadt: { de: "Stadt", en: "city" },
    kleinstadt: { de: "Kleinstadt", en: "small town" },
    dorf: { de: "Dorf", en: "village" },
    gebaeude: { de: "Gebäude", en: "building" },
    stadtviertel: { de: "Stadtviertel", en: "city quarter" },
    // Landmarkenarten (neu in Avesmaps3D, `packages/shared/src/landmarken.ts`); Schlucht steht oben und gilt für beide
    berggipfel: { de: "Berggipfel", en: "mountain peak" },
    vulkan: { de: "Vulkan", en: "volcano" },
    huegel: { de: "Hügel", en: "hill" },
    hoehle: { de: "Höhle", en: "cave" },
    grotte: { de: "Grotte", en: "grotto" },
    krater: { de: "Krater", en: "crater" },
    wasserfall: { de: "Wasserfall", en: "waterfall" },
    quelle: { de: "Quelle", en: "spring" },
    geysir: { de: "Geysir", en: "geyser" },
    furt: { de: "Furt", en: "ford" },
    strudel: { de: "Strudel", en: "whirlpool" },
    fels: { de: "Fels", en: "rock" },
    klippe: { de: "Klippe", en: "cliff" },
    riff: { de: "Riff", en: "reef" },
};

/** Die Objektarten (`avm:kind`). */
export const ART_VOKABULAR: Readonly<Record<string, Begriff>> = {
    landschaft: { de: "Landschaftsfläche", en: "landscape area" },
    herrschaftsgebiet: { de: "Herrschaftsgebiet", en: "territory" },
    weg: { de: "Weg", en: "path" },
    kraftlinie: { de: "Kraftlinie", en: "ley line" },
    ort: { de: "Ort", en: "place" },
    landmarke: { de: "Landmarke", en: "landmark" },
};

/** Die Landschaftsebenen (`avm:ebene`, nur an Flächen). */
export const EBENEN_VOKABULAR: Readonly<Record<string, Begriff>> = {
    klima: { de: "Klimazone", en: "climate zone" },
    derographisch: { de: "Derographisch", en: "derographic container" },
    vegetation: { de: "Vegetation", en: "vegetation" },
    topographie: { de: "Topographie", en: "topography" },
};

/**
 * Jedes `avm:`-Attribut, das die Datei schreibt, mit einem Satz. Neu gegenüber Legacy sind `landschaft` und `eigene_hoehe`; alles
 * andere heißt und bedeutet, was es dort tat.
 */
export const FELDER_VOKABULAR: Readonly<Record<string, string>> = {
    kind: "Objektart",
    type: "Gelaende- bzw. Wegart",
    klima: "Klimazone am Ort",
    relief: "Relief am Ort",
    ebene: "Landschaftsebene",
    name: "Eigenname",
    id: "dauerhafte Kennung (public_id der Datenbank), überlebt Umbenennung und Neuexport",
    hoehe: "höchster Gipfel im Relief am Ort, Meter; fehlt, wenn das Relief keinen benannten Gipfel mit Höhe trägt",
    breite: "gezeichnete Kernbreite eines Weges in viewBox-Einheiten dieses Abzugs",
    mantel_breite: "Mantelbreite eines Weges in viewBox-Einheiten; die der Karte, nicht die eines Kachel-Renderers",
    radius: "halbe geschätzte Ortsausdehnung in viewBox-Einheiten (1 Einheit = 3 Meilen); hängt an der Ortsklasse, nicht am Ort",
    landschaft: "Kennung der Landschaft, zu der eine Teilfläche gehört (id ist die der Teilfläche)",
    eigene_hoehe: "Höhe der Landmarke selbst in Metern (nur Berggipfel und Vulkan, wo erfasst)",
};

/** Die Landmarkenarten in der Reihenfolge des Katalogs (`packages/shared/src/landmarken.ts`, Gruppe, dann Art); ein Test hält beide gleich. */
export const LANDMARKENARTEN_REIHE = [
    "berggipfel",
    "vulkan",
    "huegel",
    "hoehle",
    "grotte",
    "krater",
    "schlucht",
    "wasserfall",
    "quelle",
    "geysir",
    "furt",
    "strudel",
    "fels",
    "klippe",
    "riff",
] as const;
