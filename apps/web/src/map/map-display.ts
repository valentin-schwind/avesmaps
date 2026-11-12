import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    AVENTURIA_ZOOM_BANDS,
    composeView,
    DEFAULT_LANDSCAPE_SELECTION,
    type LandscapeLayer,
    type LandscapeSelection,
    type MapView,
    type ViewComposition,
} from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";

/**
 * Das Anzeige-Menü (WI-0028, Legacys Auge `#map-display-menu`): was der Mensch auf der Karte sehen
 * will - getrennt von dem, was eine Ansicht zeigt (`composeView`).
 *
 * 🔴 DIE ANSICHT GEWINNT (Legacy, Owner 12.08.2026). Jeder Wechsel der Ansicht setzt die Schalter
 * auf ihre Vorgaben zurück (`displayDefaults`); danach entscheiden die Schalter. Was eine Ansicht gar
 * nicht zeigen kann, SPERRT sie (`lockedSwitches`): der Schalter wird ausgegraut und nennt den Grund,
 * statt sich umlegen zu lassen und sichtbar nichts zu tun (Legacy `GESPERRT`). Eine Ebene der Landschaften
 * kann eine eigene Vorgabe haben (Klimazonen); was der Mensch dort selbst umlegt, bleibt (`display-choices.ts`).
 */

/** Die sechs Ortsklassen des Menüs, in Legacys Kaskade (`LOCATION_TYPE_VISIBILITY_ORDER`). */
export const PLACE_TIERS = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"] as const;
export type PlaceTier = (typeof PLACE_TIERS)[number];

export interface MapDisplay {
    /**
     * Wie viele Stufen der Kaskade von oben sichtbar sind: 0 keine, 6 alle. Legacy kennt keine
     * einzelnen Ortsklassen, sondern eine Kaskade: Stufe n zeigt die Stufen 1 bis n.
     */
    placeLevel: number;
    /** Landschaftsflächen und deren Auswahl; unabhängig von der fachlichen Höhe. */
    layers: boolean;
    /** „Wege“: alle Wegarten außer Flüssen, samt ihren Namen. Seewege zeigt die Karte gar nicht. */
    paths: boolean;
    /**
     * „Labels“: die freien Beschriftungen (Landschaftsnamen) und die Flussnamen, nicht Orts- oder Wegnamen. Die Flussnamen
     * hängen seit 2026-11-09 daran (Betreiber: „flusslabels werden angezeigt, obwohl die option "labels" im anzeigemenü
     * (beim auge) deaktiviert ist“); vorher folgten sie allein der Ansicht und ließen sich mit keinem Schalter ausblenden.
     */
    labels: boolean;
    /** „Flüsse“ bzw. „Flüsse und Seen“: die Flusslinien; in den Landschaften auch die Seeflächen. */
    rivers: boolean;
    /**
     * „Grenzen“ (WI-0062, F3 B): die Außen- und Innengrenzen der Herrschaftsgebiete. In der politischen Ansicht sind
     * sie Teil des Bildes und an; über Standard und Landschaften legt sie der Schalter (Legacy `toggleTerritoryBorders`),
     * dort in Legacys schwachem Modus. Aus, wo die Ansicht keine Gebiete kennt (Nur Karte, Kraftlinien).
     */
    borders: boolean;
    /**
     * „Strömungsrichtungen“, nur für Editoren: die Pfeile auf den Flüssen und die weiße Flusskontur
     * (Betreiber 2026-09-28: „wenn die option strömungsrichtungen aus ist soll keine kontur und keine pfeile
     * mehr zu sehen sein. strömungsrichtungen sollen für editoren sichtbar sein, nicht für front end nutzer“).
     * Wirkt nur mit „Flüsse“; ein Besucher sieht den Schalter nicht, für ihn ist er immer aus.
     */
    flow: boolean;
}

export type DisplaySwitch = "places" | "paths" | "labels" | "borders" | "rivers" | "flow" | "layers";

/**
 * Die Gründe stehen im Titel der gesperrten Zeile (Legacy `GRUND`) - ein Riegel ohne Grund liest sich
 * wie ein Fehler. Als Schlüssel der Sprachtafeln (WI-0032); das Menü setzt sie in Wörter.
 */
export const LOCK_REASONS = {
    // Legacy sperrt „Grenzen“ nur, wo keine Gebietsdaten geladen sind (WI-0062: bei uns in „Nur Karte“ und
    // „Kraftlinien“, wo die Ansicht selbst die Karte leer räumt).
    borders: "display.lock.bordersView",
    // Legacys Wortlaut (map-display-menu.js). Die Nodices zeigt die Ansicht seit WI-0025.
    powerlines: "display.lock.powerlines",
} as const satisfies Record<string, MessageKey>;

/** Der Hinweis der Flusszeile außerhalb der Landschaften (Legacy, Fall #129, Owner 15.09.2026). */
export const LAKES_IN_TILES_HINT: MessageKey = "display.lakesInTiles";

/** Welche Schalter eine Ansicht sperrt, mit Grund (als Schlüssel). */
export function lockedSwitches(view: MapView): ReadonlyMap<DisplaySwitch, MessageKey> {
    const locks = new Map<DisplaySwitch, MessageKey>();
    // „Grenzen“ gibt es in Standard, Landschaften und Politisch. „Nur Karte“ und „Kraftlinien“ räumen die Karte leer.
    if (view === "none" || view === "powerlines") {
        locks.set("borders", LOCK_REASONS.borders);
    }
    if (view === "powerlines") {
        // Legacy: `shouldShowPathOnMap` steigt für die Kraftlinien VOR jeder Haken-Prüfung aus, und
        // `shouldShowLocationMarker` zeigt dort nur Nodices.
        for (const schalter of ["places", "paths", "rivers", "flow"] as const) {
            locks.set(schalter, LOCK_REASONS.powerlines);
        }
    }
    return locks;
}

/**
 * Nur in den Landschaften ist ein See eine Fläche, die sich ausblenden lässt; sonst ist er ins
 * Kachelbild gemalt (Legacy `SEEN_ALS_FLAECHE`). Danach heißt die Flusszeile.
 */
export function lakesAreAreas(view: MapView): boolean {
    return view === "landscapes";
}

/**
 * Die Vorgaben je Ansicht: Legacys Besucherprofil (`FRONTEND_LAYER_MODE_DEFAULTS` und das Profil der
 * Landschaften), vom Betreiber übernommen (2026-09-23: „standardansicht kein fluss passt, landschaft
 * mit orten und wegen passt“).
 *
 *   • Standard: alle Orte, Wege und Labels. Die Flusslinien sind AUS - die Kachel malt die Flüsse
 *     schon; ihre NAMEN stehen trotzdem, solange „Labels“ an ist (Legacy `flussnamen`, siehe `effectiveDisplay`).
 *     Das gilt nur noch für Besucher: Editoren bekommen die Flusslinien hier an (`EDITOR_DEFAULTS`, Betreiber 2026-11-11).
 *   • Landschaften (Legacy, Owner 09.09.2026): alles an - Wege, Labels, Flüsse und Seen. Orte nur
 *     Metropolen und Großstädte (Betreiber 2026-09-28: „in den landschaftsansichten standardmäßig (es sei
 *     denn der nutzer stellt etwas anderes ein) nur Metropolen und Großstädte“; Legacy zeigt alle).
 *   • Nur Karte: alles aus. Kraftlinien: die Ansicht sperrt, was sie nicht zeigt.
 *
 * Seewege gibt es auf der Karte nicht mehr, auch nicht für Editoren (Betreiber 2026-09-27).
 */
const VIEW_DEFAULTS: Record<MapView, MapDisplay> = {
    none: { placeLevel: 0, paths: false, labels: false, borders: false, rivers: false, flow: false, layers: true },
    // 🔴 Politisch (WI-0062, F6, Legacy `FRONTEND_LAYER_MODE_DEFAULTS.political`): Orte aus - die Hauptstädte der
    // gezeigten Gebiete bleiben (`composeView`) -, Straßen aus (Owner 05.08.2026), Flüsse aus. Die Grenzen gehören zum
    // Bild und sind an.
    // 🔴 „Labels“ ist hier AUS und heißt dasselbe wie überall (Betreiber 2026-11-09, Wahl „Aus, wie überall“): Ab Werk
    // stehen keine Flussnamen, eingeschaltet kommen Fluss- und Landschaftsnamen wie in jeder anderen Ansicht.
    political: { placeLevel: 0, paths: false, labels: false, borders: true, rivers: false, flow: false, layers: true },
    // 🪤 „Grenzen“ ist in Standard und Landschaften AUS, obwohl Legacy Standard mit Grenzen im schwachen Modus öffnet
    // (`BOUNDARY_OVERLAY_MODES`): Der Schalter ist entsperrt, die Vorgabe ist die alte Karte. Eine Zeile, falls der
    // Betreiber Legacys Vorgabe will.
    standard: {
        placeLevel: PLACE_TIERS.length,
        paths: true,
        labels: true,
        borders: true,
        rivers: false,
        flow: false,
        layers: true,
    },
    powerlines: {
        placeLevel: 0,
        paths: false,
        labels: false,
        borders: false,
        rivers: false,
        flow: false,
        layers: true,
    },
    landscapes: {
        placeLevel: PLACE_TIERS.indexOf("grossstadt") + 1,
        paths: true,
        labels: true,
        borders: false,
        rivers: true,
        flow: false,
        layers: true,
    },
};

/**
 * Die Ebenen der Landschaften mit EIGENER Vorgabe; jede andere Ebene hat die der Landschaften.
 *
 * 🔴 Klimazonen (Betreiber 2026-10-05, wörtlich: „standardeinstellung, wenn man auf klimazonen klickt (sofern nicht
 * anders vom nutzer eingestellt): nur metropolen, wege an, ebenen an, labels an, grenzen aus, flüsse und seen an,
 * strömungsrichtung aus (editoren an), kachelraster aus“). „Ebenen“ ist die Zeile des Menüs (`layers`), in den
 * Klimazonen also die Bänder; das Kachelraster ist überall aus und kein Schalter dieser Tafel (`tileGrid`).
 * 🪤 Bewusste Abweichung von Legacy: dort gilt EIN Profil für alle Ebenen (`ECOSYSTEM_FRONTEND_PROFIL`, Owner 09.09.2026).
 */
const LAYER_DEFAULTS: Partial<Record<LandscapeSelection, MapDisplay>> = {
    klima: {
        placeLevel: PLACE_TIERS.indexOf("metropole") + 1,
        paths: true,
        layers: true,
        labels: true,
        borders: false,
        rivers: true,
        flow: false,
    },
};

/** Was ein Editor davon anders vorgegeben bekommt, je Ansicht oder Ebene. Ein Besucher sieht diese Schalter nie. */
const EDITOR_DEFAULTS: Partial<Record<MapView | LandscapeSelection, Partial<MapDisplay>>> = {
    // 🔴 Flusslinien in der Standardansicht (OPS-000117, Betreiber 2026-11-11, Wahl A: „sie haben sich geeinigt A“): Wer
    // Flüsse bearbeitet, braucht die Linie und schaltete sie bei jedem Besuch selbst ein. Löst die Festlegung vom
    // 2026-09-23 („standardansicht kein fluss“) nur für Editoren ab; Besucher und geteilte Links bleiben ohne.
    standard: { rivers: true },
    klima: { flow: true },
};

/**
 * Wo eine Vorgabe gilt: die Ansicht, ihre Landschaftsebene (sie zählt nur in den Landschaften) und ob ein Editor schaut
 * (`view_flow_directions`, dieselbe Frage wie im Menü).
 */
export interface DisplayContext {
    view: MapView;
    layer: LandscapeSelection;
    editor: boolean;
}

/** Die Vorgaben einer Ansicht, in den Landschaften die ihrer Ebene, für einen Editor samt seinen. */
export function displayDefaults(
    view: MapView,
    layer: LandscapeSelection = DEFAULT_LANDSCAPE_SELECTION,
    editor = false,
): MapDisplay {
    const ownLayer = view === "landscapes" ? LAYER_DEFAULTS[layer] : undefined;
    const editorPart = editor ? EDITOR_DEFAULTS[ownLayer ? layer : view] : undefined;
    return { ...(ownLayer ?? VIEW_DEFAULTS[view]), ...editorPart };
}

/** Die Vorgaben eines Kontexts. */
export function contextDefaults(context: DisplayContext): MapDisplay {
    return displayDefaults(context.view, context.layer, context.editor);
}

/**
 * Legacys Kaskade (`setVisibleLocationTypesThrough`): ein Klick auf Stufe n zeigt die Stufen 1 bis n.
 * Ein Klick auf die Stufe, die schon die höchste sichtbare ist, blendet ALLE Orte aus.
 */
export function cascade(level: number, clicked: number): number {
    return clicked === level ? 0 : clicked;
}

/** Was die Karte nach Ansicht UND Schaltern zeichnet - die eine Eingabe des Stils. */
export interface EffectiveDisplay {
    landscapeAreas: boolean;
    /** Welche `subtype`-Werte als Ort erscheinen; `undefined` heißt alle. */
    placeClasses: readonly string[] | undefined;
    landPaths: boolean;
    rivers: boolean;
    /** Strömungspfeile und weiße Flusskontur: nur mit Flüssen, und nur ein Editor bekommt sie gezeichnet. */
    flow: boolean;
    /** Die Flussnamen folgen der Ansicht und „Labels“, nicht dem Flussschalter (Legacy `flussnamen`). */
    riverNames: boolean;
    /** Die Herrschaftsgebiete als Fläche mit Namen (WI-0062): die politische Ansicht. */
    territories: boolean;
    /** Die Hauptstädte der gezeigten Gebiete stehen, auch wo die Orte aus sind (WI-0062, F6). */
    territoryCapitals: boolean;
    /**
     * Die Grenzlinien der Gebiete (WI-0062): `strong` in der politischen Ansicht, `weak` über Standard und Landschaften
     * (Legacys schwacher Modus), `undefined` ohne. Der Schalter „Grenzen“ entscheidet, gesperrt entscheidet die Ansicht.
     */
    borders: "strong" | "weak" | undefined;
    /**
     * Die Gebietsnamen ENTLANG der Außengrenzen (Nachtrag WI-0062): nur mit gezeichneten Grenzen und nur in den Ansichten
     * der Tafel (`borderName.views`, Legacy: Standard; in „Politisch“ stehen die Namen in der Fläche).
     */
    borderNames: boolean;
    /**
     * Die Schraffur umstrittener Gebiete (Nachtrag WI-0062 2026-09-30): nur mit der Fläche und nur in den Ansichten der Tafel
     * (`claimHatch.views`, Legacy: nur „Politisch“).
     */
    claimHatch: boolean;
    /** Die freien Beschriftungen („Labels“) … */
    mapLabels: boolean;
    /** … und aus welchen Ebenen sie kommen. Leer heißt: die Ansicht hat Namen, aber keine aus `map_label` (Klima). */
    labelLayers: readonly LandscapeLayer[];
    /** Die Seeflächen der Topographie weglassen (nur in den Landschaften, wo sie eine Fläche sind). */
    hideLakes: boolean;
}

/** Die Bauwerksstufe umfasst jede Bauwerksklasse der Tafel: `stadtviertel` folgt ihr (Legacy `folgtSchalter`). */
const STRUCTURE_CLASSES = AVENTURIA_ZOOM_BANDS.structure.classes;

function placeClassesUpTo(level: number): readonly string[] | undefined {
    if (level >= PLACE_TIERS.length) {
        return undefined;
    }
    return PLACE_TIERS.slice(0, level).flatMap((stufe) => (stufe === "gebaeude" ? STRUCTURE_CLASSES : [stufe]));
}

/** Alle Ebenen mit Namen: so viel zeigt „Labels“ in einer Ansicht, die selbst keine Namen trägt. */
const ALL_LABEL_LAYERS = composeView("standard", DEFAULT_LANDSCAPE_SELECTION).landscapeNameLayers;

export function effectiveDisplay(view: MapView, composition: ViewComposition, display: MapDisplay): EffectiveDisplay {
    const locks = lockedSwitches(view);
    // Gesperrt entscheidet die Ansicht, sonst der Schalter.
    const pick = (schalter: DisplaySwitch, wert: boolean, ansicht: boolean): boolean =>
        locks.has(schalter) ? ansicht : wert;
    // Die Flussnamen folgen der Ansicht (Legacy `flussnamen`): an in Standard, Landschaften und Politisch (F6). Dort nimmt
    // sie „Labels“ weg (Betreiber 2026-11-09; Legacy kannte dafür keinen Schalter).
    const flussnamen = (view === "standard" || view === "landscapes" || view === "political") && display.labels;
    const orte = locks.has("places") ? (composition.places ? PLACE_TIERS.length : 0) : display.placeLevel;
    const rivers = pick("rivers", display.rivers, composition.paths);
    const bordersOn = pick("borders", display.borders, false);
    return {
        landscapeAreas: display.layers,
        placeClasses: orte === 0 ? [] : placeClassesUpTo(orte),
        landPaths: pick("paths", display.paths, composition.paths),
        rivers,
        flow: rivers && pick("flow", display.flow, false),
        riverNames: flussnamen,
        territories: composition.territories,
        territoryCapitals: composition.territoryCapitals,
        borders: bordersOn ? (composition.territories ? "strong" : "weak") : undefined,
        borderNames: bordersOn && AVENTURIA_POLITICAL_CARTOGRAPHY.borderName.views.includes(view),
        claimHatch: composition.territories && AVENTURIA_POLITICAL_CARTOGRAPHY.claimHatch.views.includes(view),
        mapLabels: display.labels,
        // Eine Ansicht ohne eigene Namen („Nur Karte“) zeigt eingeschaltet alle.
        labelLayers: composition.landscapeNames ? composition.landscapeNameLayers : ALL_LABEL_LAYERS,
        hideLakes: lakesAreAreas(view) && !display.rivers,
    };
}

/** Was die Ansicht allein zeigte - für einen Stil ohne Menü (Tests, Vorschauen). */
export function displayOfComposition(composition: ViewComposition): EffectiveDisplay {
    return {
        landscapeAreas: true,
        placeClasses: composition.places ? undefined : [],
        landPaths: composition.paths,
        rivers: composition.paths,
        flow: false,
        riverNames: composition.paths || composition.territories,
        territories: composition.territories,
        territoryCapitals: composition.territoryCapitals,
        borders: composition.territories ? "strong" : undefined,
        // Ohne Anzeige-Menü gibt es keinen Schalter „Grenzen“ und keine Ansicht: nur die politische zeichnet Grenzen.
        borderNames: false,
        // Wo die Fläche gezeichnet wird, ist es die politische Ansicht: dort schraffiert Legacy.
        claimHatch: composition.territories,
        mapLabels: composition.landscapeNames,
        labelLayers: composition.landscapeNameLayers,
        hideLakes: false,
    };
}
