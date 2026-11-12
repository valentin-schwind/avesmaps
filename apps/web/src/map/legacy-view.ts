import { isMapView, type MapView } from "@avesmaps3d/shared";
import { parseSwitchValue } from "./display-state";
import { readViewChoices, type ViewState } from "./view-state";

/**
 * Legacys Parameter für Ansicht und Untergrund, gelesen (WI-0072; WI-0029, L9). Geschrieben werden weiter unsere
 * Namen `view` und `series` im Hash: Sie stehen schon in Adressen, die jemand verschickt hat, und ein Wechsel der
 * Namen machte diese Links unlesbar. Ein Link mit Legacys Namen öffnet dieselbe Ansicht wie in Legacy.
 *
 * - `mapLayerMode`: `none`, `political`, `deregraphic` (Standard), `powerlines`, `ecosystem` (Landschaften); das alte
 *   `original` ist KEINE Ansicht mehr, sondern „Nur Karte“ auf dem Untergrund `original` (Legacy `setSelectedMapLayerMode`).
 * - `toggleBorders=1` (alte Links): die politische Ansicht, solange `mapLayerMode` nichts sagt.
 * - `mapstyle`: `stylized` (unsere Serie `modern`), `original`, `old`. 🔴 `old` öffnet Besuchern „Nur Karte“, wenn die Adresse
 *   keine Ansicht nennt (Betreiber 2026-11-10, `nurKarte` unten); nennt sie eine andere, bleibt die Ansicht, und die Serie ist die
 *   Vorgabe. Editoren öffnet sie jede Ansicht.
 *
 * Unbekanntes wird überlesen: Die Karte öffnet dann mit der Vorgabe.
 */

export const LEGACY_VIEW_PARAMS = ["mapLayerMode", "toggleBorders", "mapstyle"] as const;

const LAYER_MODES: Record<string, { view: MapView; series?: string }> = {
    none: { view: "none" },
    political: { view: "political" },
    deregraphic: { view: "standard" },
    powerlines: { view: "powerlines" },
    ecosystem: { view: "landscapes" },
    original: { view: "none", series: "original" },
};

const MAP_STYLES: Record<string, string> = { stylized: "modern", original: "original", old: "old" };

export interface LegacyView {
    view?: MapView;
    series?: string;
}

/** Was Legacys Parameter für Ansicht und Untergrund sagen (ohne die Frage, ob unsere Adresse selbst etwas sagt). */
export function readLegacyView(params: URLSearchParams, knownSeries: readonly string[]): LegacyView {
    const result: LegacyView = {};
    const mode = (params.get("mapLayerMode") ?? "").trim().toLowerCase();
    const named = Object.hasOwn(LAYER_MODES, mode) ? LAYER_MODES[mode] : undefined;
    if (named) {
        result.view = named.view;
    } else if (mode === "" && parseSwitchValue(params.get("toggleBorders")) === true) {
        result.view = "political";
    }
    // `mapLayerMode=original` wählt den Untergrund selbst und gilt vor `mapstyle` (Legacy setzt ihn danach).
    const style = (params.get("mapstyle") ?? "").trim().toLowerCase();
    const series = named?.series ?? (Object.hasOwn(MAP_STYLES, style) ? MAP_STYLES[style] : undefined);
    if (series !== undefined && knownSeries.includes(series)) result.series = series;
    return result;
}

/**
 * Die Ansicht, mit der die Karte öffnet: unser Link, sonst die Vorgabe - und dazu Legacys Parameter, wo unsere Adresse
 * nichts sagt. Was der Hash selbst benennt (`view`, eine gültige `series` samt Ausschnitt), geht vor. Nennt der Hash nur eine
 * Wahl ohne Ausschnitt (`#view=political`, Fund des Betreibers 2026-10-19), öffnet sie an der Startlage (`readViewChoices`).
 *
 * `nurKarte`: die Serien, die dieser Betrachter nur unter „Nur Karte“ sieht (Beschriftung im Bild, Betreiber 2026-11-10, „wär super,
 * wenn die karte dann per link erreichbar ist“). Ein Link auf so eine Serie ohne Ansicht (`#series=old`, `?mapstyle=old`) öffnet
 * „Nur Karte“; nennt er eine andere Ansicht, gilt die Ansicht mit der Vorgabe-Serie.
 */
export function openingView(
    linked: ViewState | undefined,
    fallback: ViewState,
    search: string,
    hash: string,
    knownSeries: readonly string[],
    nurKarte: readonly string[] = [],
): ViewState {
    const base = linked ?? fallback;
    // Legacys Namen stehen nur in der Query (`avesmaps.de/?mapLayerMode=ecosystem`), nie im Hash.
    const legacy = readLegacyView(new URLSearchParams(search), knownSeries);
    const hashNamesView = isMapView(new URLSearchParams(hash.replace(/^#/, "")).get("view"));
    const choices = linked === undefined ? readViewChoices(hash, knownSeries) : {};
    const opening: ViewState = {
        ...base,
        ...(legacy.view !== undefined && !hashNamesView ? { view: legacy.view } : {}),
        ...(legacy.series !== undefined && linked === undefined ? { series: legacy.series } : {}),
        ...choices,
    };
    if (opening.view === "none" || !nurKarte.includes(opening.series)) return opening;
    const viewNamed = hashNamesView || legacy.view !== undefined;
    return viewNamed ? { ...opening, series: fallback.series } : { ...opening, view: "none" };
}
