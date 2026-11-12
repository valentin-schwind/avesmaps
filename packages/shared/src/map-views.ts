/**
 * Die Ansichten der Karte und die Ebenen der Landschaftsansicht (WI-0009, „Kartenfächer").
 *
 * 🔴 Eine Ansicht ist keine Sammlung von Häkchen, sondern eine ENTSCHEIDUNG darüber, was die Karte
 * gerade erzählt. Vorher lag bei uns alles gleichzeitig übereinander — Gelände, Landschaftsflächen,
 * Klimabänder, Orte, Namen —, und keine dieser Schichten konnte für sich gestaltet werden: eine
 * Farbe, die über dem Gelände wirkt, ist zu blass ohne, und umgekehrt.
 *
 * Legacy trennt genau hier (`js/ui/map-layer-picker.js`). Seit WI-0024 steht der Fächer 1:1 wie
 * dort, mit allen fünf Ansichten (Betreiber 2026-09-23: „bau den fächer 1:1 nach und grau aus was
 * es noch nicht bei uns gibt“). `political` war ausgegraut, solange die Gebiete nicht migriert waren (MCS-019);
 * seit WI-0062 (Betreiber 2026-09-29, F1 bis F10) ist sie freigeschaltet. `powerlines` ist seit WI-0025
 * freigeschaltet (Betreiberfreigabe 2026-09-23: „kraftlinien übernehmen, freigegeben“).
 */

/** Was die Karte zeigt - die wählbaren Ansichten. */
export const MAP_VIEWS = ["none", "political", "standard", "powerlines", "landscapes"] as const;
export type MapView = (typeof MAP_VIEWS)[number];

/**
 * Die Ansichten des Fächers in Legacys Reihenfolge (`#mapLayerModeSelect`), die gesperrten mit.
 *
 * 🔴 Die Reihenfolge ist Legacys, nicht alphabetisch und nicht nach Verfügbarkeit: der Fächer stellt
 * die aktive Ansicht ans Ende und die übrigen davor in genau dieser Folge.
 */
export const FAN_VIEWS = ["none", "political", "standard", "powerlines", "landscapes"] as const;
export type FanView = (typeof FAN_VIEWS)[number];

/** Ist diese Ansicht bei uns schon da? Die übrigen stehen ausgegraut im Fächer. */
export function isAvailableView(view: FanView): view is MapView {
    return (MAP_VIEWS as readonly string[]).includes(view);
}

/**
 * Die Ebenen der Landschaftsansicht.
 *
 * 🪤 `alle` ist KEINE Ebene, sondern ein Anzeige-Flag daneben — Legacy warnt an derselben Stelle
 * ausdrücklich davor, es als fünften Wert zu führen: der Ebenenzustand reist zum Server, und ein
 * unbekannter Wert fiele dort still auf die Vorgabe zurück. Bei uns gibt es diesen Weg nicht, aber
 * der Grund gilt genauso: `alle` beantwortet eine andere Frage als `vegetation`.
 */
export const LANDSCAPE_LAYERS = ["derographisch", "vegetation", "topographie", "klima", "sprachen"] as const;
export type LandscapeLayer = (typeof LANDSCAPE_LAYERS)[number];

/** Die Auswahl in der zweiten Stufe: eine Ebene oder alle zusammen. */
export const LANDSCAPE_SELECTIONS = ["alle", ...LANDSCAPE_LAYERS] as const;
export type LandscapeSelection = (typeof LANDSCAPE_SELECTIONS)[number];

/**
 * Die Unterwahl der Topographie (WI-0055, Betreiber 2026-09-28, Blatt 3 „A“): Ihr Eselsohr öffnet eine
 * dritte Reihe mit „Höhenlinien“ (das Landschaftsbild wie bisher, dazu Linien) und „Höhenstufen“ (farbig
 * nach Höhe wie im Schulatlas, mit Legende). Sie wirkt nur bei `topographie`, bleibt aber gemerkt.
 */
export const TOPOGRAPHY_VARIANTS = ["hoehenlinien", "hoehenstufen"] as const;
export type TopographyVariant = (typeof TOPOGRAPHY_VARIANTS)[number];
export const DEFAULT_TOPOGRAPHY_VARIANT: TopographyVariant = "hoehenlinien";

export function isTopographyVariant(value: unknown): value is TopographyVariant {
    return typeof value === "string" && (TOPOGRAPHY_VARIANTS as readonly string[]).includes(value);
}

/**
 * Gipfel und Vulkane als Namen mit Dreieck (WI-0055, wie Legacy V10): `names` ohne, `heights` mit
 * Höhenzahl (nur in der Topographie, Betreiber 2026-09-28), `none` gar nicht.
 */
export type PeakLabels = "none" | "names" | "heights";

// Die Namen der Ansichten und Ebenen stehen in den Sprachtafeln der Oberfläche (apps/web/src/i18n, WI-0032).

/** Die Vorgabe: die Karte öffnet als Standardkarte über der Originalserie. */
export const DEFAULT_MAP_VIEW: MapView = "standard";

/**
 * Die Vorgabe der zweiten Stufe ist `alle`, nicht `vegetation`.
 *
 * Legacy startet auf `vegetation` — „that is where most of the drawing work is", also aus der Sicht
 * eines Editors, der zeichnen will. Für einen Besucher ist `alle` die sinnvolle Startansicht; der
 * Betreiber hat genau das in Legacy nachträglich freigeschaltet.
 */
export const DEFAULT_LANDSCAPE_SELECTION: LandscapeSelection = "alle";

export function isMapView(value: unknown): value is MapView {
    return typeof value === "string" && (MAP_VIEWS as readonly string[]).includes(value);
}

export function isLandscapeSelection(value: unknown): value is LandscapeSelection {
    return typeof value === "string" && (LANDSCAPE_SELECTIONS as readonly string[]).includes(value);
}

/**
 * Die Ebenen, die „Alle“ zeichnet: alle außer den Klimazonen (Betreiber 2026-10-05, wörtlich: „Wenn ich auf "Alle" klick, sollen
 * keine klimazonen mehr angezeigt werden“). Legacy hält es ebenso (`ECOSYSTEM_SHOWALL_VERBORGEN = ["klima"]`,
 * `js/map-features/map-features-ecosystem-layer-switch.js`, Owner 27.08.2026). Klimazonen gibt es nur in ihrer eigenen Ebene.
 *
 * Die Sprachen ebenso (WI-0261 S5a, E1: Derographie › Sprachen; Bauvorlage der Probierseite 2026-10-30: in den übrigen Chips nur die
 * Grundkarte). Ihre Flächen überlappen sich und die der übrigen Ebenen; in „Alle“ wären sie eine dritte Bildsprache über der Derographie.
 */
const ONLY_ALONE: readonly LandscapeLayer[] = ["klima", "sprachen"];
const LAYERS_OF_ALL: readonly LandscapeLayer[] = LANDSCAPE_LAYERS.filter((layer) => !ONLY_ALONE.includes(layer));

/** Welche Landschaftsebenen sind bei dieser Auswahl zu zeichnen? */
export function layersOfSelection(selection: LandscapeSelection): readonly LandscapeLayer[] {
    return selection === "alle" ? LAYERS_OF_ALL : [selection];
}

/**
 * Was eine Ansicht zeigt — die Tabelle aus WI-0009, als Code statt als Prosa.
 *
 * 💣 Diese Funktion ist der einzige Ort, an dem „was gehört zu welcher Ansicht" entschieden wird.
 * Verteilt auf die Layerdateien wäre dieselbe Frage viermal beantwortet, und beim nächsten Layer
 * ein fünftes Mal anders.
 */
export interface ViewComposition {
    /**
     * Das Geländeraster. In der Landschaftsansicht für Besucher AUS, nicht nur schwächer (Legacy: 0 %); Editoren blenden es dort mit
     * dem Regler „Untergrund“ ein (WI-0178 T47), bei 0 % ist es ebenso aus.
     */
    basemap: boolean;
    /** Die Deckkraft des Geländerasters, 0 bis 1; fehlt sie, ist es ganz da. Nur der Regler „Untergrund“ setzt sie (T47). */
    basemapOpacity?: number;
    /**
     * Das Geländeraster entsättigt und abgedunkelt — Legacys „Magiersicht" in der Kraftlinien-Ansicht
     * (`syncPowerlineMapTint`). Die Werte stehen in der Kraftlinien-Kartografie.
     */
    basemapDesaturated: boolean;
    /**
     * Die Kraftlinien samt ihren Namen (WI-0025).
     *
     * 🔴 Nur in ihrer eigenen Ansicht. Legacy nimmt sie in jeder anderen ganz von der Karte
     * (`syncPowerlineVisibility`) — sie sind eine Ansicht, keine Ebene über der Standardkarte.
     */
    powerlines: boolean;
    /**
     * Die Nodices als leuchtende „Ley-Knoten“ samt Namen, auf jeder Zoomstufe (WI-0025).
     *
     * 🔴 NICHT dasselbe wie `places`: Legacy zeigt in der Kraftlinien-Ansicht nur die Orte mit
     * `is_nodix`, unabhängig von Ortsklasse und Zoomband (`shouldShowLocationMarker`), und zeichnet sie
     * anders als einen Ort. Zwei Fragen, zwei Felder.
     */
    nodices: boolean;
    /** Ortsmarker und Ortsnamen. */
    places: boolean;
    /**
     * Die Herrschaftsgebiete als Fläche mit Namen (WI-0062, ADR-0014): die Ansicht „Politisch“. Die Linien der
     * Gebiete („Grenzen“) hängen NICHT daran, sondern am Schalter des Anzeige-Menüs: Er legt sie auch über Standard
     * und Landschaften.
     */
    territories: boolean;
    /**
     * Die Hauptstädte der gezeigten Gebiete bleiben stehen, auch wo `places` die Orte ausblendet (Legacy
     * `shouldShowLocationMarker`: „Hauptstädte der angezeigten Gebiete“, Betreiber 2026-09-29, F6).
     */
    territoryCapitals: boolean;
    /**
     * Die Wege (WI-0010).
     *
     * 🪤 Sie hängen an derselben Frage wie die Orte, nicht an der Landschaftsauswahl: beide
     * gehören zur Standardkarte. In der Landschaftsansicht wären sie ein zweites Liniennetz über
     * einer Ansicht, die von Flächen lebt.
     */
    paths: boolean;
    /** Die Namen der Landschaften, auf Schriftlauf oder als Punktlabel. */
    landscapeNames: boolean;
    /** Die Flächen, in der Reihenfolge von unten nach oben. */
    landscapeLayers: readonly LandscapeLayer[];
    /**
     * Von welchen Ebenen die NAMEN gezeigt werden.
     *
     * 💣 Diese Liste gibt es, weil Fläche und Beschriftung auseinandergelaufen sind: der
     * Kartenfächer schaltete die Flächen um, die Landschaftsnamen blieben alle stehen. „Herz des
     * Kontinents" ist eine derographische Region und stand trotzdem über der Vegetationsansicht
     * (Betreiberbefund an der Stage-Abnahme, 2026-09-22).
     *
     * 🪤 Sie ist NICHT immer gleich `landscapeLayers`. In der Standardansicht liegt keine Fläche,
     * aber alle Namen stehen — das ist die abgenommene Standardkarte. Zwei Fragen, zwei Felder.
     */
    landscapeNameLayers: readonly LandscapeLayer[];
    /** Die Höhenlinien (WI-0055): nur in der Topographie, in beiden Unterwahlen. */
    contours: boolean;
    /**
     * Die Höhenstufen (WI-0055): Farben nach Höhe statt nach Landschaftsart. Die Flächen der Topographie
     * zeichnen dann nur noch das Meer; Seen, Flüsse, Wege und Namen bleiben.
     */
    heightTints: boolean;
    /** Gipfel und Vulkane (WI-0055): in Standard und Landschaften wie Legacy, in der Topographie mit Höhe. */
    peaks: PeakLabels;
}

/**
 * Ebenen, deren Namen aus `map_label` kommen.
 *
 * 🔴 `klima` fehlt hier — aber NICHT, weil Klimazonen namenlos wären. Sie tragen ihren Namen auf
 * einem ganz anderen Weg: er ist der Regionsname der Fläche selbst, kein Label-Objekt. Deshalb
 * zählt eine Abfrage auf `map_label` dort null, und deshalb wäre ein Filter auf `region_layer`
 * für sie das falsche Werkzeug.
 *
 * 🪤 Dieser Kommentar hat hier zwei Tage lang das Gegenteil behauptet („Klimazonen haben keine
 * Labels und hatten nie welche"). Das war ein Fehlschluss aus zwei Messungen, die etwas anderes
 * sagten: null Zeilen in `map_label` heißt „nicht dort", nicht „nicht vorhanden", und Legacys
 * Ausschluss von `kind === "klima"` betrifft das AUSWAHLFELD der Landschaftsarten im Editor, nicht
 * die Karte. Der Betreiber hat widersprochen, und die laufende Legacy-Karte gibt ihm recht.
 *
 * Die Klimabeschriftung ist deshalb ihr eigener Layer (WI-0012), nicht ein Fall dieser Liste. Die Sprachen ebenso (WI-0261 S5a, E5):
 * Ihr Name kommt aus der Kachel der Sprachfläche und wird wie der einer Klimazone gesetzt.
 */
const LAYERS_WITH_LABELS: readonly LandscapeLayer[] = ["derographisch", "vegetation", "topographie"];

function labelLayersOf(selection: LandscapeSelection): readonly LandscapeLayer[] {
    return layersOfSelection(selection).filter((layer) => LAYERS_WITH_LABELS.includes(layer));
}

/**
 * Wo Legacy die Gipfel in den Landschaften zeigt: bei Alle, Topographie und Derographie, nicht bei
 * Vegetation und Klima (`ecosystem-access.test.js`, `map-features-labels.js#L1216-L1254`). Bei den Sprachen auch nicht (wie Klima).
 */
const SELECTIONS_WITH_PEAKS: readonly LandscapeSelection[] = ["alle", "topographie", "derographisch"];

export function composeView(
    view: MapView,
    selection: LandscapeSelection,
    topography: TopographyVariant = DEFAULT_TOPOGRAPHY_VARIANT,
    /** Der Regler „Untergrund“ der Editoren in Prozent (WI-0178 T47); nur in der Landschaftsansicht, für Besucher nie. */
    untergrund?: number,
): ViewComposition {
    const keineHoehe = { contours: false, heightTints: false } as const;
    if (view === "none") {
        // „Nur Karte“ (Legacy `none`): der Untergrund allein. Legacys Fächer zeigt dafür ein LEERES
        // Vektorbild, „und das ist die Aussage: hier liegt nichts über dem Untergrund“.
        return {
            basemap: true,
            basemapDesaturated: false,
            powerlines: false,
            nodices: false,
            places: false,
            territories: false,
            territoryCapitals: false,
            paths: false,
            landscapeNames: false,
            landscapeLayers: [],
            landscapeNameLayers: [],
            ...keineHoehe,
            peaks: "none",
        };
    }
    if (view === "political") {
        // „Politisch“ (Legacy `political`, WI-0062 F6): die Gebiete stehen im Vordergrund. Orte aus - die
        // Hauptstädte der gezeigten Gebiete bleiben -, Straßen aus (Owner 05.08.2026). Keine Landschaftsflächen und eigenen
        // Landschaftsnamen (Legacy `MAP_LABEL_MODES` kennt `political` nicht); Gewässer- und Landschaftsnamen bringt dort
        // nur der Schalter „Labels“, ab Werk aus (Betreiber 2026-11-09, `apps/web/src/map/map-display.ts`).
        return {
            basemap: true,
            basemapDesaturated: false,
            powerlines: false,
            nodices: false,
            places: false,
            territories: true,
            territoryCapitals: true,
            paths: false,
            landscapeNames: false,
            landscapeLayers: [],
            landscapeNameLayers: [],
            ...keineHoehe,
            peaks: "none",
        };
    }
    if (view === "powerlines") {
        // „Kraftlinien“ (Legacy `powerlines`): die Linien samt Namen über dem entsättigten Untergrund.
        //
        // Dazu wie in Legacy nur die Nodices als leuchtende Knoten, keine Wege, keine Flussnamen,
        // keine Landschaftsnamen (`FRONTEND_LAYER_MODE_DEFAULTS.powerlines`, `MAP_LABEL_MODES`;
        // Betreiber 2026-09-23: „ortsmarkierungen von nodices fehlen noch wie in legacy“).
        return {
            basemap: true,
            basemapDesaturated: true,
            powerlines: true,
            nodices: true,
            places: false,
            territories: false,
            territoryCapitals: false,
            paths: false,
            landscapeNames: false,
            landscapeLayers: [],
            landscapeNameLayers: [],
            ...keineHoehe,
            peaks: "none",
        };
    }
    if (view === "standard") {
        // 🔴 Keine Flächen und keine Bänder: sie gehören in die Landschaftsansicht. Vorher lagen
        // sie hier mit, und die Standardkarte trug zwei Bildsprachen gleichzeitig.
        //
        // Die NAMEN bleiben dagegen vollständig — die Standardkarte zeigt alle Landschaftsnamen,
        // auch ohne die zugehörigen Flächen. Vom Betreiber so abgenommen.
        return {
            basemap: true,
            basemapDesaturated: false,
            powerlines: false,
            nodices: false,
            places: true,
            territories: false,
            territoryCapitals: false,
            paths: true,
            landscapeNames: true,
            landscapeLayers: [],
            landscapeNameLayers: LAYERS_WITH_LABELS,
            ...keineHoehe,
            peaks: "names",
        };
    }
    const topographie = selection === "topographie";
    // Der Untergrund der Editoren (T47): bei 0 % weggelassen wie für Besucher, nicht nur durchsichtig (siehe `basemap`).
    const untergrundDa = untergrund !== undefined && untergrund > 0;
    return {
        basemap: untergrundDa,
        ...(untergrundDa ? { basemapOpacity: Math.min(untergrund, 100) / 100 } : {}),
        basemapDesaturated: false,
        powerlines: false,
        nodices: false,
        places: false,
        territories: false,
        territoryCapitals: false,
        paths: false,
        // 🪤 Abweichung von Legacy, bewusst: dort sind in dieser Ansicht ALLE Namen aus, weil sie
        // ein Zeichenwerkzeug ist und der Editor seine Flächen kennt. Für einen Besucher wären
        // bunte Flächen ohne ein einziges Wort wertlos.
        landscapeNames: true,
        landscapeLayers: layersOfSelection(selection),
        // 💣 Dieselbe Auswahl wie die Flächen. Genau hier liefen die beiden auseinander.
        landscapeNameLayers: labelLayersOf(selection),
        contours: topographie,
        heightTints: topographie && topography === "hoehenstufen",
        peaks: topographie ? "heights" : SELECTIONS_WITH_PEAKS.includes(selection) ? "names" : "none",
    };
}
