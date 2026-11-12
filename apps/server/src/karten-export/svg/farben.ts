/**
 * Farben und Strichstärken des SVG-Abzugs (WI-0280 K2): die EINE Stelle, an der steht, in welcher Farbe und Stärke ein Ding aus der
 * Karte in die Datei geht. Portierung aus Legacys `js/pages/svg-export-build.js` und `js/pages/svg-export-farben.js`.
 *
 * 🔴 DER ABZUG IST EIN EIGENES GESTALTUNGSSTÜCK (Owner 15.08.2026, 08.09.2026). Er übernimmt die REGEL der Karte („ein Gewässer, ein
 * Ton“), nicht ihren Wert, und er füllt DECKEND: Die Flächen der Karte (`config/map-cartography/aventuria.json`) sind Lasur über dem
 * Rasterbild, in dieser Datei liegt nichts darunter. Deshalb gilt hier nicht die Kartentafel der Flächen, sondern Legacys Vorgabe:
 * die Owner-Töne unten und sonst die Token des Programms (`css/base/tokens.css`, Mirror `master`), als Tafel abgeschrieben, weil der
 * Bauer weder CSS noch Dateien lesen darf.
 *
 * Wo die Karte dasselbe MEINT, ist sie die Quelle, und `karten-svg.test.ts` hält die Abschrift gegen sie:
 *   Ortsfarbe       = `colour.markerWaypoint` im Kanon (`config/design-canon/avesmaps.json`)
 *   Landmarkenfarbe = `colour.markerSettlementSite` (das Violett der Bauwerke, aus denen die natürlichen Landmarken wurden)
 *
 * 💣 Ändert jemand einen Ton in den Quellen, folgt der Abzug NICHT von selbst: Die Zahlen hier gleicht man von Hand ab.
 */

// ---- Orte, Linien, Beschriftung -----------------------------------------------------------------------------------------

/** Der Ton der Kartenmarkierung (heraldisches Rot). Owner 16.08.2026: „gib orten die farben aus der markierung“. */
export const ORTSFARBE = "#e33b35";
/** Landmarken tragen das Violett der Bauwerke und sind damit von Orten (Rot) klar getrennt. Eigener Ton, kein Karten-Rot. */
export const LANDMARKENFARBE = "#635497";
export const KRAFTLINIENFARBE = "#7a5ea8";
export const GEBIETSFARBE = "#8a6a3f";
export const BESCHRIFTUNGSFARBE = "#3b2a18";
/** Radius, in dem eine Landmarke gezeichnet wird. Landmarken haben keine geschätzte Ausdehnung, `avm:radius` fehlt darum. */
export const LANDMARKEN_RADIUS = 0.05;

/** Strichstärken in Einheiten bei 100 %: wie eine Straße, wie die Mittelstärke der Gebietsgrenzen. */
export const KRAFTLINIEN_BREITE = 0.078;
/** Die Karte staffelt die Grenzen nach Stufe (Reich 4 px, 2. Ebene 3, Grafschaft 2); EINE Stärke muss reichen, und das ist die mittlere. */
export const GEBIETSGRENZE_BREITE = 0.094;
export const WEG_BREITE_RUECKFALL = 0.078;
export const MANTEL_BREITE_RUECKFALL = 0.125;

// ---- Wege ---------------------------------------------------------------------------------------------------------------

/**
 * Wegarten in ZEICHENREIHENFOLGE, von unten nach oben: Wasser zuunterst, die Reichsstraße zuoberst, wie die Karte sie zeichnet
 * (`config/map-cartography/aventuria-paths.json`, `order`). Die Vokabular-Zusage lautet „Dokumentordnung, was später steht, liegt
 * oben“; sie gälte sonst für ein Bild, das die Karte nicht zeigt. Legacy führte hier die Reihenfolge seines Katalogs (Reichsstraße
 * zuerst, also zuunterst): eine Abweichung, die niemand bestellt hatte, und ein Pfad lag am Kreuz über der Reichsstraße.
 * Der Bach ist ein Flussweg mit Merkmal und liegt beim Fluss (die Flüsse ziehen ohnehin in die Landschaften-Ebene).
 */
export const WEGARTEN_ZEICHENREIHENFOLGE = [
    "Seeweg",
    "Flussweg",
    "Bach",
    "Wuestenpfad",
    "Gebirgspass",
    "Pfad",
    "Weg",
    "Strasse",
    "Reichsstrasse",
] as const;

/** Die Wasserwege: Sie liegen in der Landschaften-Ebene unter den Wasserflächen (siehe `bauer.ts`). */
export const FLUSSARTEN = ["Flussweg", "Bach"] as const;

/**
 * Kern- und Mantelbreite je Wegart in Bildpunkten bei voller Zoomstufe (1024 × 2⁵ = 32768 Bildpunkte). Ein Bildpunkt dort ist 1/32
 * Einheit: `Einheit = Bildpunkte / 32`, auf drei Stellen gerundet. HERGELEITET statt geschätzt (Legacy 15.08.2026, nachdem der erste
 * Satz 7,2× zu dick war): Legacys `PATH_CENTER_WEIGHTS` und `PATH_OUTLINE_WEIGHTS`.
 *
 * ⚠️ Die Karte von Avesmaps3D zeichnet die Straße seit 2026-10-18 bewusst dicker (3 und 5 Bildpunkte statt 2,5 und 4) und staffelt
 * alle Breiten nach Zoom (`widthScale`). Der Abzug folgt dem NICHT: Er ist die Fassung, die Legacy ausgeliefert hat, und `avm:breite`
 * ist ausdrücklich „die Breite dieses Abzugs“. Wer sie nachziehen will, ändert hier die zwei Zahlen der Straße.
 */
/** Der Fluss steht einmal da: Seeweg und Bach rechnen mit ihm. */
const FLUSS_PIXEL = { kern: 3, mantel: 5 } as const;
export const WEG_PIXEL: Readonly<Record<string, { readonly kern: number; readonly mantel: number }>> = {
    Reichsstrasse: { kern: 4, mantel: 6.5 },
    Strasse: { kern: 2.5, mantel: 4 },
    Weg: { kern: 2.5, mantel: 4 },
    Pfad: { kern: 1.5, mantel: 3 },
    Gebirgspass: { kern: 1.5, mantel: 3 },
    Wuestenpfad: { kern: 1.5, mantel: 3 },
    Flussweg: FLUSS_PIXEL,
    Seeweg: FLUSS_PIXEL,
};

/**
 * 🔴 EIN BACH IST EIN HALBER FLUSS (Owner 31.08.2026, wörtlich: „bach is halb so breit wie n fluss“). Die Karte kennt die Zahl
 * (`widthScale.bach`: 0,5 ab der höchsten Stufen); hier wird sie GERECHNET und nicht abgeschrieben, damit Fluss und Bach nicht
 * auseinanderlaufen. 💣 Die Halbierung trifft BEIDE Breiten, sonst bliebe vom Saum ein halber Bildpunkt je Seite.
 */
export const BACH_FAKTOR = 0.5;

function einheiten(pixel: number): number {
    return Math.round((pixel / 32) * 1000) / 1000;
}

/** Kernbreite einer Wegart in Einheiten bei 100 %. */
export function wegBreite(art: string): number {
    if (art === "Bach") return einheiten(FLUSS_PIXEL.kern) * BACH_FAKTOR;
    const pixel = WEG_PIXEL[art];
    return pixel ? einheiten(pixel.kern) : WEG_BREITE_RUECKFALL;
}

/** Mantelbreite (die der Karte, nicht die eines Kachel-Renderers) einer Wegart in Einheiten bei 100 %. */
export function mantelBreite(art: string): number {
    if (art === "Bach") return einheiten(FLUSS_PIXEL.mantel) * BACH_FAKTOR;
    const pixel = WEG_PIXEL[art];
    return pixel ? einheiten(pixel.mantel) : MANTEL_BREITE_RUECKFALL;
}

/**
 * Die Mittellinienfarbe je Wegart. 🔴 Die Owner-Vorgabe (15.08.2026: „wege f5ffe9, flüsse 4c89c6“) schlägt die Kartenfarbe:
 * „wege“ sind die sechs LANDwege; der Seeweg bleibt bei seinem Kartenton (eine Schiffsroute, kein Landweg), der Fluss hat seinen
 * eigenen Wert, und der Bach trägt die Flussfarbe (er wird über die BREITE unterschieden, nicht über die Farbe).
 * 💣 See, Flussweg und Bach sind EIN Satz: Sie müssen gleich sein, sonst zerfällt das Gewässernetz in zwei oder drei Blautöne.
 */
export const WEGFARBEN: Readonly<Record<string, string>> = {
    Reichsstrasse: "#f5ffe9",
    Strasse: "#f5ffe9",
    Weg: "#f5ffe9",
    Pfad: "#f5ffe9",
    Gebirgspass: "#f5ffe9",
    Wuestenpfad: "#f5ffe9",
    Flussweg: "#4c89c6",
    Bach: "#4c89c6",
    Seeweg: "#2f7dd3",
};
export const WEGFARBE_RUECKFALL = "#888888";

// ---- Landschaften -------------------------------------------------------------------------------------------------------

/** Ein Ton, den niemand gesetzt hat: Rückfall wie in Legacy. */
export const FLAECHENFARBE_RUECKFALL = "#dfd6bd";

/** Die Owner-Töne (15.08.2026, 08.09.2026): „seen sind 82befe, flüsse 4c89c6, wälder 589a64, gebirge acaea2, der rest wie aus dem programm.“ */
const FLAECHEN_VORGABEN: Readonly<Record<string, string>> = {
    see: "#4c89c6",
    wald: "#589a64",
    gebirge: "#acaea2",
};

/** Die Töne des Programms je Geländeart (`--color-ecosystem-<ebene>-<art>`), abgeschrieben aus Legacys `tokens.css`. */
const FLAECHEN_TOKEN: Readonly<Record<string, string>> = {
    // Vegetation
    wald: "#3f6b2c",
    suempfe_moore: "#2f4a2a",
    steppe: "#a8bd8a",
    tundra: "#6f9d94",
    schneelandschaft: "#edf3f7",
    eislandschaft: "#8ec3e0",
    auenlandschaft: "#4f9e35",
    wueste: "#e0c74e",
    graslandschaft: "#8fbf6a",
    flussland_flusstal: "#4a8f6b",
    dschungel: "#1e7d32",
    wuestenoase: "#2fa88c",
    kulturlandschaft: "#a9a14c",
    // Neu in Avesmaps3D: Legacy hält dafür nur die Übersteuerung der Fläche (`flaeche.vegetation:urwald`), übernommen in der Kartentafel
    urwald: "#3f6605",
    // Topographie
    gebirge: "#7a6c5e",
    huegelland: "#7d8f6e",
    see: "#4c89c6",
    meer: "#2d5f8a",
    kueste: "#3f9e9a",
    wadi: "#9b8a5c",
    schlucht: "#5c5148",
    hochebene: "#9a9b82",
    tiefebene: "#6f7a55",
    tal: "#6b7266",
    flussdelta: "#5e8f86",
    insel: "#b2a273",
    gletscher: "#bcd6e0",
    flachkueste: "#77b3a5",
    steilkueste: "#3d6e73",
    // Klima
    polar: "#cfe0eb",
    subpolar: "#a2c3d1",
    boreal: "#7aada9",
    gemaessigt: "#bfc888",
    subtropen_winterfeucht: "#dcb857",
    trockene_subtropen: "#cdb083",
    subtropisch: "#d98f3c",
    tropisch: "#c65e2e",
};

/** Der Ton der Ebene, wenn die Art keinen eigenen hat (`--color-ecosystem-<ebene>`): Legacys Zwischenstufe vor dem Rückfall. */
const EBENEN_TOKEN: Readonly<Record<string, string>> = {
    klima: "#bfc888",
    derographisch: "#575757",
    vegetation: "#5f7d33",
    topographie: "#7a6c5e",
};

/** Die Füllfarbe einer Geländeart: erst die Owner-Vorgabe, dann der Ton der Art, dann der der Ebene, dann der Rückfall. */
export function flaechenFarbe(typ: string, ebene: string): string {
    return FLAECHEN_VORGABEN[typ] ?? FLAECHEN_TOKEN[typ] ?? EBENEN_TOKEN[ebene] ?? FLAECHENFARBE_RUECKFALL;
}

/** Was als WASSER gilt und deshalb zuletzt gezeichnet wird; `wadi` (ein trockenes Bett) und `flussland_flusstal` (Bewuchs) gehören NICHT dazu. */
export const WASSERARTEN = ["see", "meer", "kueste", "flussdelta"] as const;

/** Die vier Landschaftsebenen in Zeichenreihenfolge: Die acht Klimabänder decken die GANZE Karte und müssen zuerst kommen. */
export const LANDSCHAFTSEBENEN = ["klima", "derographisch", "vegetation", "topographie"] as const;
