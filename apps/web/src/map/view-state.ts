import {
    AVENTURIA,
    DEFAULT_LANDSCAPE_SELECTION,
    DEFAULT_MAP_VIEW,
    DEFAULT_TOPOGRAPHY_VARIANT,
    isTopographyVariant,
    isLandscapeSelection,
    isMapView,
    isWithinBounds,
    type LandscapeSelection,
    type MapPoint,
    type MapView,
    type ShareDisplay,
    type TopographyVariant,
} from "@avesmaps3d/shared";
import { normalizeBearing, PITCH_CEILING } from "./camera/camera-math";
import { displayParams } from "./display-state";

/**
 * The view in the address bar.
 *
 * A shared link has to survive a change of renderer, so it carries map coordinates in
 * `aventuria-v1` - never the derived render coordinates, which are an implementation detail of the
 * current rendering path (ADR-0003). Legacy shares a pin the same way, as map units with three
 * decimals; this keeps that precision so the two stay comparable.
 *
 * It lives in the fragment, so moving the map never reaches the server and never reloads the page.
 */

export interface ViewState {
    center: MapPoint;
    zoom: number;
    series: string;
    /** Die Ansicht aus dem Kartenfächer (WI-0009). */
    view: MapView;
    /** Die Ebenenwahl der zweiten Stufe; steht auch in der Standardansicht, damit ein Wechsel hin und zurück nichts vergisst. */
    landscape: LandscapeSelection;
    /**
     * Die Unterwahl der Topographie (WI-0055): Höhenlinien oder Höhenstufen. Fehlt sie, gilt die Vorgabe
     * (Höhenlinien); sie steht nur in der Adresse, wenn sie davon abweicht.
     */
    topography?: TopographyVariant;
    /** Drehung in Grad, (−180, 180] (WI-0016). Fehlt sie, ist Norden oben. */
    bearing?: number;
    /** Neigung in Grad (WI-0016). Fehlt sie, ist die Karte flach. */
    pitch?: number;
    /**
     * Die Schalter des Auge-Menüs, die von der Vorgabe der Ansicht abweichen (WI-0072, `displayDeviation`). Fehlt sie
     * oder ist sie leer, steht nichts davon in der Adresse. Gelesen wird sie nicht hier, sondern mit `readAddressDisplay`:
     * Legacys Links tragen sie in der Query.
     */
    display?: ShareDisplay;
}

/** Three decimals in map units is about a pixel at the deepest zoom, and matches legacy. */
const COORDINATE_DECIMALS = 3;
const ZOOM_DECIMALS = 2;
/** Eine Nachkommastelle: ein Zehntelgrad ist mit keiner Geste gezielt einstellbar. */
const ANGLE_DECIMALS = 1;

/** Auf die Genauigkeit der Adresse runden; aus `-0` wird `0`. */
function roundAngle(value: number): number {
    const factor = 10 ** ANGLE_DECIMALS;
    return Math.round(value * factor) / factor + 0;
}

export function formatViewState(view: ViewState): string {
    const parameters = new URLSearchParams({
        x: view.center.x.toFixed(COORDINATE_DECIMALS),
        y: view.center.y.toFixed(COORDINATE_DECIMALS),
        z: view.zoom.toFixed(ZOOM_DECIMALS),
        series: view.series,
        view: view.view,
        layer: view.landscape,
    });
    // 🔴 Drehung und Neigung nur, wenn sie nicht 0 sind (WI-0016, Spez. § 7): ein flacher, genordeter
    // Blick erzeugt dieselbe Adresse wie vor der 3D-Navigation, und alte Links bleiben gleich.
    const bearing = roundAngle(normalizeBearing(view.bearing ?? 0));
    const pitch = roundAngle(Math.min(Math.max(view.pitch ?? 0, 0), PITCH_CEILING));
    // Wie Drehung und Neigung nur, wenn es nicht die Vorgabe ist: alte Links bleiben dieselbe Adresse.
    if (view.topography !== undefined && view.topography !== DEFAULT_TOPOGRAPHY_VARIANT) {
        parameters.set("topo", view.topography);
    }
    if (bearing !== 0) {
        parameters.set("b", bearing.toFixed(ANGLE_DECIMALS));
    }
    if (pitch !== 0) {
        parameters.set("p", pitch.toFixed(ANGLE_DECIMALS));
    }
    // Zuletzt, nur Abweichungen (WI-0072): Der Anfang der Adresse bleibt, wie er war.
    for (const [name, value] of displayParams(view.display)) {
        parameters.set(name, value);
    }
    return `#${parameters.toString()}`;
}

/**
 * Reads a view from a fragment. Returns undefined for anything that is not a complete, valid view:
 * a half-typed or stale link opens the default view instead of an empty map somewhere outside the
 * domain (chapter 2.16 - no silent nonsense).
 *
 * `defaultSeries`: A link without `series` opens in it, like a missing view or layer (WI-0218 follow-up, operator 2026-10-17 on the
 * stage link `/edit#x=518.750&y=504.000&z=4.5&view=powerlines`: „ich weiss was du öffnen willst, er aber tuts nicht.“). An unknown
 * series is still refused: it would leave the map without a base map.
 */
export function parseViewState(
    hash: string,
    knownSeries: readonly string[],
    defaultSeries?: string,
): ViewState | undefined {
    const parameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const x = Number.parseFloat(parameters.get("x") ?? "");
    const y = Number.parseFloat(parameters.get("y") ?? "");
    const zoom = Number.parseFloat(parameters.get("z") ?? "");
    const series = parameters.get("series") ?? defaultSeries ?? "";
    // 🪤 Ansicht und Ebene fallen auf die Vorgabe zurück, statt den ganzen Link zu verwerfen: ein
    // Link aus der Zeit vor dem Kartenfächer trägt sie nicht, und er soll weiter die Karte an der
    // gemerkten Stelle öffnen - nur eben in der Standardansicht.
    const rawView = parameters.get("view");
    const rawLayer = parameters.get("layer");
    const view = isMapView(rawView) ? rawView : DEFAULT_MAP_VIEW;
    const landscape = isLandscapeSelection(rawLayer) ? rawLayer : DEFAULT_LANDSCAPE_SELECTION;

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) {
        return undefined;
    }
    if (!isWithinBounds(AVENTURIA.coordinateSpace, { x, y })) {
        return undefined;
    }
    if (!knownSeries.includes(series)) {
        return undefined;
    }
    const parsed: ViewState = { center: { x, y }, zoom, series, view, landscape };
    // Eine unbekannte Unterwahl kostet nur sie, nicht den Link.
    const topography = parameters.get("topo");
    if (isTopographyVariant(topography) && topography !== DEFAULT_TOPOGRAPHY_VARIANT) {
        parsed.topography = topography;
    }
    // Drehung und Neigung sind Zugaben: ein unlesbarer Wert kostet nur sie, nicht den ganzen Link.
    // Die Grenze nach Zoom legt die Karte selbst an (`cameraMapOptions`).
    const bearing = roundAngle(normalizeBearing(Number.parseFloat(parameters.get("b") ?? "")));
    const pitch = roundAngle(Math.min(Number.parseFloat(parameters.get("p") ?? ""), PITCH_CEILING));
    if (Number.isFinite(bearing) && bearing !== 0) {
        parsed.bearing = bearing;
    }
    if (Number.isFinite(pitch) && pitch > 0) {
        parsed.pitch = pitch;
    }
    return parsed;
}

/** Was ein Hash an Wahl nennt, ohne Ausschnitt: Ansicht, Ebene, Unterwahl der Topographie und Serie. */
export type ViewChoices = Partial<Pick<ViewState, "view" | "landscape" | "topography" | "series">>;

/**
 * Die Wahl eines Hashs ohne vollständigen Ausschnitt (Fund des Betreibers 2026-10-19 an `/edit#view=political`: „ich glaub du willst
 * damit die politische ansicht öffnen, aber das klappt nicht, insgesamt hats noch nie geklappt, wenn du ein link gepostet hat“): Ohne
 * x/y/z verwirft `parseViewState` den Hash, und die Karte öffnete in der Vorgabe. Jede Wahl gilt nur, wenn sie gültig ist; sie öffnet
 * dann an der Startlage (`openingView`), wie ein fehlendes `series` in einem vollen Link.
 */
export function readViewChoices(hash: string, knownSeries: readonly string[]): ViewChoices {
    const parameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const choices: ViewChoices = {};
    const view = parameters.get("view");
    if (isMapView(view)) choices.view = view;
    const layer = parameters.get("layer");
    if (isLandscapeSelection(layer)) choices.landscape = layer;
    const topography = parameters.get("topo");
    if (isTopographyVariant(topography)) choices.topography = topography;
    const series = parameters.get("series");
    if (series !== null && knownSeries.includes(series)) choices.series = series;
    return choices;
}

/** True when the two views would produce the same address, so unchanged views cause no history write. */
export function sameViewState(a: ViewState | undefined, b: ViewState): boolean {
    return a !== undefined && formatViewState(a) === formatViewState(b);
}
