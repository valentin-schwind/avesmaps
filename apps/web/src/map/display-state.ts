import type { ShareDisplay } from "@avesmaps3d/shared";
import { hexrasterMeilen } from "./hexraster";
import {
    contextDefaults,
    lockedSwitches,
    PLACE_TIERS,
    type DisplayContext,
    type MapDisplay,
    type PlaceTier,
} from "./map-display";

/**
 * Die Schalter des Auge-Menüs in der Adresse (WI-0072).
 *
 * 🔴 **Nur Abweichungen von der Vorgabe der Ansicht** stehen in der Adresse (kurze Links, wie Legacy und wie `topo`,
 * `b`, `p`): Wer nichts umlegt, hat dieselbe Adresse wie vorher. Was die Ansicht sperrt, steht nie darin. Ein Wert, der
 * nicht lesbar ist, wird still überlesen (Kap. 9.57 gilt für Ziele, nicht für Einstellungen), und die Schalter der
 * Editoren wirken nur für Editoren.
 *
 * 🔴 **Legacys Namen haben Vorrang** (AGENTS.md „Links von Legacy bleiben gültig“). Legacys Konvention ist
 * Parameter = Kennung des Schalters (`togglePaths` ist beides). Wo Legacy einen Schalter hat, steht sein Name hier -
 * auch dort, wo Legacy ihn nie in eine Adresse schrieb (`toggleMapLabels`, `toggleTerritoryBorders`, `toggleRivers`).
 * Neue, kurze Namen tragen nur die Schalter, die Avesmaps3D allein hat: `areas`, `flow`, `grid`, `gradnetz`, dazu `hex`
 * mit der Feldgröße des Hexrasters in Meilen statt eines Schalterwerts (`hex=10`).
 *
 * Die Schreibweise der Werte ist Legacys (`parseBooleanQueryParam`): gelesen `1`/`true`/`yes`/`on` und
 * `0`/`false`/`no`/`off` in jeder Schreibung, geschrieben `1` und `0`.
 */

/** Legacys Parameter je Ortsklasse (`LOCATION_TYPE_CONFIG`, `js/config.js`). */
export const PLACE_PARAMS: Record<PlaceTier, string> = {
    metropole: "toggleMetropolen",
    grossstadt: "toggleGrossstaedte",
    stadt: "toggleStaedte",
    kleinstadt: "toggleKleinstaedte",
    dorf: "toggleDoerfer",
    gebaeude: "toggleGebaeude",
};

/** Legacys alter Sammelschalter für alle Ortsklassen; er gibt jeder Klasse ihre Vorgabe, die eigenen Parameter gehen vor. */
export const ALL_PLACES_PARAM = "toggleLocations";

/** Die Parameter der übrigen Schalter: Legacys Kennungen, dazu drei eigene, kurze Namen. */
export const SWITCH_PARAMS = {
    paths: "togglePaths",
    labels: "toggleMapLabels",
    borders: "toggleTerritoryBorders",
    rivers: "toggleRivers",
    /** Eigen: die Landschaftsflächen („Ebenen“, nur in den Landschaften). `layer` ist schon die Wahl der Ebene. */
    layers: "areas",
    /** Eigen, Editor: Strömungsrichtungen. */
    flow: "flow",
    /** Eigen, Editor: Kachelraster des Höhenmodells. */
    tileGrid: "grid",
    /** Eigen, für alle: das Gradnetz (WI-0273). */
    gradnetz: "gradnetz",
} as const satisfies Record<Exclude<keyof ShareDisplay, "placeLevel" | "hexraster">, string>;

/** Eigen, für alle: das Hexraster (WI-0273), der Wert ist die Feldgröße in Meilen. */
export const HEX_PARAM = "hex";

type SwitchKey = keyof typeof SWITCH_PARAMS;

/** Reihenfolge, in der die Schalter in die Adresse kommen. */
const SWITCH_ORDER: readonly SwitchKey[] = [
    "paths",
    "labels",
    "borders",
    "rivers",
    "layers",
    "flow",
    "tileGrid",
    "gradnetz",
];

/**
 * Die Ausprägung eines umgelegten Schalters für die Besucherstatistik (`display_toggle`, WI-0159): `togglePaths:on`.
 *
 * 🔴 **Legacys Schlüssel, Zeichen für Zeichen.** Legacys Abzug vom 2026-10-12 trägt `toggleRivers:on` (6.853),
 * `togglePaths:on` (4.899), `toggleTerritoryBorders:on` (3.149) und `toggleRivers:off` (3.068). Legacys importierte Zeilen und
 * unsere eigenen müssen auf **demselben** Schlüssel summieren, sonst stünde jeder Balken der Liste „Schalter“ zweimal halb
 * hoch da. Weil `SWITCH_PARAMS` schon Legacys Namen trägt („Legacys Namen haben Vorrang“, oben), ist die Zählkennung aus den
 * vorhandenen Werten abgeleitet - keine zweite Wertetabelle, die auseinanderlaufen kann.
 *
 * 🪤 Die drei eigenen Schalter (`areas`, `flow`, `grid`) tragen hier ihre kurzen Namen: Legacy hat sie nicht, es gibt also
 * nichts zusammenzuführen.
 */
export function schalterKennung(schalter: SwitchKey, an: boolean): string {
    return `${SWITCH_PARAMS[schalter]}:${an ? "on" : "off"}`;
}

/**
 * Dieselbe Ausprägung für die Ortsklassen, aus dem Zustand **nach** dem Klick: Legacy nannte die höchste sichtbare Klasse
 * (`gebaeude:on` 2.786, `metropole:on` 2.052, `dorf:on` 1.878, `grossstadt:on` 1.614) und den Sammelschalter, wo keine Orte
 * mehr stehen. Die Kaskade entscheidet die Stufe (`cascade`), nicht der angeklickte Knopf.
 */
export function ortsStufenKennung(stufe: number): string {
    const klasse = PLACE_TIERS[stufe - 1];
    return stufe === 0 || klasse === undefined ? `${ALL_PLACES_PARAM}:off` : `${klasse}:on`;
}

/** Jeder Parameter dieser Datei, für das Aufräumen der Query. */
export const DISPLAY_PARAMS: readonly string[] = [
    ALL_PLACES_PARAM,
    ...PLACE_TIERS.map((tier) => PLACE_PARAMS[tier]),
    ...SWITCH_ORDER.map((key) => SWITCH_PARAMS[key]),
    HEX_PARAM,
];

/** Legacys `parseBooleanQueryParam`: `undefined` heißt „nicht lesbar“, der Schalter bleibt dann bei seiner Vorgabe. */
export function parseSwitchValue(raw: string | null): boolean | undefined {
    if (raw === null) return undefined;
    const value = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off"].includes(value)) return false;
    return undefined;
}

/**
 * Liest die Schalter aus Parametern, ohne Ansicht und Rechte: nur was dasteht und lesbar ist.
 *
 * Die Ortsklassen sind Legacys Kaskade (`applyPlannerStateFromUrl`): jede Klasse hat ihren Parameter, `toggleLocations`
 * ist die Vorgabe der Klassen ohne eigenen, und die höchste wahre Klasse bestimmt die Stufe.
 */
export function readDisplayParams(params: URLSearchParams): ShareDisplay {
    const found: ShareDisplay = {};
    const all = parseSwitchValue(params.get(ALL_PLACES_PARAM));
    let named = all !== undefined;
    let highest = -1;
    PLACE_TIERS.forEach((tier, index) => {
        const own = parseSwitchValue(params.get(PLACE_PARAMS[tier]));
        if (own !== undefined) named = true;
        if (own ?? all ?? false) highest = index;
    });
    if (named) found.placeLevel = highest + 1;
    for (const key of SWITCH_ORDER) {
        const value = parseSwitchValue(params.get(SWITCH_PARAMS[key]));
        if (value !== undefined) found[key] = value;
    }
    const hex = params.get(HEX_PARAM);
    // Eine Zahl wird die nächste Feldgröße des Reglers; was keine ist, wird überlesen.
    if (hex !== null && Number(hex) > 0) found.hexraster = hexrasterMeilen(Number(hex));
    return found;
}

/** Die Parameter eines Fragments (`#a=b`) oder einer Query (`?a=b`). */
function paramsOf(text: string): URLSearchParams {
    return new URLSearchParams(text.replace(/^[#?]/, ""));
}

/**
 * Die Schalter einer geöffneten Adresse: Der Hash geht vor, die Query ist der Rückfall für Legacys Links
 * (`?togglePaths=0`). Je Schalter, die Ortsstufe zählt als einer.
 */
export function readAddressDisplay(search: string, hash: string): ShareDisplay {
    return { ...readDisplayParams(paramsOf(search)), ...readDisplayParams(paramsOf(hash)) };
}

/**
 * Was von den Schaltern die Vorgabe der Ansicht verlässt - und überhaupt etwas bedeuten kann. Eine Ansicht, die einen
 * Schalter sperrt, schreibt ihn nicht; „Ebenen“ gibt es nur in den Landschaften. Die Vorgabe ist die des Kontexts:
 * In den Klimazonen sind Metropolen keine Abweichung, für einen Editor dort auch die Strömungsrichtungen nicht.
 */
export function displayDeviation(
    context: DisplayContext,
    display: MapDisplay,
    tileGrid: boolean,
    gradnetz = false,
    hexraster?: number,
): ShareDisplay {
    const { view } = context;
    const defaults = contextDefaults(context);
    const locks = lockedSwitches(view);
    const deviation: ShareDisplay = {};
    if (!locks.has("places") && display.placeLevel !== defaults.placeLevel) deviation.placeLevel = display.placeLevel;
    if (!locks.has("paths") && display.paths !== defaults.paths) deviation.paths = display.paths;
    if (display.labels !== defaults.labels) deviation.labels = display.labels;
    if (!locks.has("borders") && display.borders !== defaults.borders) deviation.borders = display.borders;
    if (!locks.has("rivers") && display.rivers !== defaults.rivers) deviation.rivers = display.rivers;
    if (view === "landscapes" && display.layers !== defaults.layers) deviation.layers = display.layers;
    if (!locks.has("flow") && display.flow !== defaults.flow) deviation.flow = display.flow;
    if (tileGrid) deviation.tileGrid = true;
    if (gradnetz) deviation.gradnetz = true;
    if (hexraster !== undefined) deviation.hexraster = hexraster;
    return deviation;
}

/**
 * Sind die Schalter gleich? Wer sie aus einem Link setzt, fasst `display` nur an, wenn sich etwas ändert: Jede neue
 * Belegung baut den Stil neu auf, und ein Kurzlink trifft die Karte oft noch beim Laden des Stils.
 */
export function sameDisplay(a: MapDisplay, b: MapDisplay): boolean {
    return (Object.keys(a) as (keyof MapDisplay)[]).every((key) => a[key] === b[key]);
}

/** Ist keine Abweichung gesetzt? */
export function isDefaultDisplay(deviation: ShareDisplay | undefined): boolean {
    return deviation === undefined || Object.keys(deviation).length === 0;
}

/**
 * Die Schalter einer Ansicht aus einer Abweichung: die Vorgaben des Kontexts, darüber das, was ein Link sagt (oder
 * was der Mensch selbst umgelegt hat, `display-choices.ts`).
 *
 * 🔴 Es wirkt nur, was die Ansicht zulässt (Sperren, „Ebenen“ nur in den Landschaften) und was der Betrachter darf:
 * Strömungsrichtungen und Kachelraster sind Editorwerkzeuge (`editor`), für Besucher bleiben sie aus, ohne Meldung. Das
 * Gradnetz gilt für alle und in jeder Ansicht, ebenso das Hexraster; nennt ein Link beide, gilt das Hexraster (es schließt das
 * Gradnetz aus, WI-0273).
 */
export function applyDisplayDeviation(
    context: DisplayContext,
    deviation: ShareDisplay | undefined,
): { display: MapDisplay; tileGrid: boolean; gradnetz: boolean; hexraster: number | undefined } {
    const { view, editor } = context;
    const display = contextDefaults(context);
    const locks = lockedSwitches(view);
    if (!deviation) return { display, tileGrid: false, gradnetz: false, hexraster: undefined };
    if (deviation.placeLevel !== undefined && !locks.has("places") && isPlaceLevel(deviation.placeLevel)) {
        display.placeLevel = deviation.placeLevel;
    }
    if (deviation.paths !== undefined && !locks.has("paths")) display.paths = deviation.paths;
    if (deviation.labels !== undefined) display.labels = deviation.labels;
    if (deviation.borders !== undefined && !locks.has("borders")) display.borders = deviation.borders;
    if (deviation.rivers !== undefined && !locks.has("rivers")) display.rivers = deviation.rivers;
    if (deviation.layers !== undefined && view === "landscapes") display.layers = deviation.layers;
    if (editor && deviation.flow !== undefined && !locks.has("flow")) display.flow = deviation.flow;
    const hexraster = deviation.hexraster === undefined ? undefined : hexrasterMeilen(deviation.hexraster);
    return {
        display,
        tileGrid: editor && deviation.tileGrid === true,
        gradnetz: hexraster === undefined && deviation.gradnetz === true,
        hexraster,
    };
}

function isPlaceLevel(level: number): boolean {
    return Number.isInteger(level) && level >= 0 && level <= PLACE_TIERS.length;
}

/**
 * Die Abweichung als Adressparameter, in fester Folge. Die Ortsstufe schreibt sich in Legacys Kaskade: Stufe n ist der
 * Parameter der n-ten Klasse auf `1`, keine Orte `toggleLocations=0` - Legacy liest beides genauso.
 */
export function displayParams(deviation: ShareDisplay | undefined): [string, string][] {
    const pairs: [string, string][] = [];
    if (!deviation) return pairs;
    const level = deviation.placeLevel;
    if (level !== undefined && isPlaceLevel(level)) {
        const tier = PLACE_TIERS[level - 1];
        pairs.push(level === 0 || tier === undefined ? [ALL_PLACES_PARAM, "0"] : [PLACE_PARAMS[tier], "1"]);
    }
    for (const key of SWITCH_ORDER) {
        const value = deviation[key];
        if (value !== undefined) pairs.push([SWITCH_PARAMS[key], value ? "1" : "0"]);
    }
    if (deviation.hexraster !== undefined) pairs.push([HEX_PARAM, String(deviation.hexraster)]);
    return pairs;
}

/**
 * Eine Query ohne die Parameter der Schalter und die genannten weiteren (Legacys Ansichtsparameter). Beim Öffnen
 * gelesene Werte wandern in den Hash (`formatViewState`): Blieben sie in der Query stehen, gälten sie bei jedem
 * Neuladen wieder, auch wenn man den Schalter längst zurückgelegt hat.
 *
 * 🪤 Die übrigen Parameter bleiben Zeichen für Zeichen stehen, nicht über `URLSearchParams` neu geschrieben: Das
 * kodierte das `~` der Reise (`?route=Gareth~Perricum`) zu `%7E`.
 */
export function queryWithoutDisplayParams(search: string, extra: readonly string[] = []): string {
    const drop = new Set([...DISPLAY_PARAMS, ...extra]);
    const parts = search.replace(/^\?/, "").split("&");
    const kept = parts.filter((part) => !drop.has(decodedName(part)));
    // Nichts zu entfernen: die Adresse bleibt, wie sie geöffnet wurde.
    if (kept.length === parts.length) return search;
    const rest = kept.filter((part) => part !== "");
    return rest.length === 0 ? "" : `?${rest.join("&")}`;
}

function decodedName(part: string): string {
    const name = part.split("=", 1)[0] ?? "";
    try {
        return decodeURIComponent(name.replace(/\+/g, " "));
    } catch {
        return name;
    }
}
