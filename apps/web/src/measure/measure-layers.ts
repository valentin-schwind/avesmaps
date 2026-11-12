import type {
    GeoJSONSource,
    GeoJSONSourceSpecification,
    LayerSpecification,
    Map as MapLibreMap,
    StyleSpecification,
} from "maplibre-gl";
import { AVENTURIA, canonColour, canonIcon, DESIGN_CANON, toRenderLngLat } from "@avesmaps3d/shared";
import type { Measurement } from "./measure-state";

/**
 * Die Messung auf der Karte: eine weiße gestrichelte Linie und zwei Griffe (WI-0095, Guide §17.13,
 * Finding MCS-030).
 *
 * 🔴 **Die Maße sind abgeleitet, nicht erfunden.** Legacys Werte stehen im Kanon schon unter anderen
 * Namen; nur die Strichelung musste dazu (`DESIGN_CANON.measure.lineDash`, Begründung im `$measureComment`):
 *
 * | Teil | Legacy | bei uns |
 * |---|---|---|
 * | Linie weiß | `#FFFFFF` | `colour.routeHalo` — dasselbe Weiß, das jede Linie der Karte saumt |
 * | Linienbreite | 4 px | `mapSelection.lineWidth` (4) |
 * | Strichelung | 10 px / 8 px | `measure.lineDash` (2,5 / 2 Vielfache der Breite) |
 * | Griff außen | 24 px, weiß | `icon.lg` (24) in `colour.routeHalo` |
 * | Griffsaum | 2 px `#8a6644` | `route.haloWidth` (2) in `colour.accentBrown` |
 * | Griffkern | 8 px `#8a6644` | ein Drittel des Griffs, in `colour.accentBrown` |
 *
 * 🔴 **Die Reihenfolge ist Legacys** (`js/app/bootstrap.js` L202/203): Die Linie liegt über der Route
 * (Panes 450 < 460) und unter den Ortsmarken (500), die Griffe liegen über den Marken (520). Deshalb
 * geht die Linie an dieselbe Stelle wie die Routenlinie und die Griffe oben an den Stapel.
 *
 * 🔴 **Kein Dunkelwert**: Was auf der Karte liegt, bleibt hell (WI-0032, Guide §23.1).
 *
 * 🪤 **Legacys Deckkraft 0,95 ist nicht übernommen.** Sie wäre eine neue Zahl im Kanon für einen
 * Unterschied, den niemand sieht; die Linie steht hier deckend, wie jede andere Linie der Karte.
 *
 * 🪤 Quelle und Ebenen stehen IM STIL (`withMeasure`), nicht daneben: `setStyle(…, { diff: true })`
 * entfernt, was der neue Stil nicht nennt. Zwischen zwei Stilen tauscht `updateMeasure` nur die Daten.
 */

export const MEASURE_LINE_SOURCE_ID = "measure-line";
export const MEASURE_HANDLE_SOURCE_ID = "measure-handles";
export const MEASURE_LINE_LAYER_ID = "measure-line";
export const MEASURE_HANDLE_RING_LAYER_ID = "measure-handle-ring";
export const MEASURE_HANDLE_CORE_LAYER_ID = "measure-handle-core";

/** Die Trefferebene der Griffe: die EINE Ebene, die der Besitzer `measure` abfragt. */
export const MEASURE_HANDLE_LAYERS = [MEASURE_HANDLE_RING_LAYER_ID] as const;

const space = AVENTURIA.coordinateSpace;

/**
 * Der Griff: außen `icon.lg` breit SAMT Saum (MapLibre zeichnet `circle-stroke-width` außerhalb des
 * Radius), der Saum `route.haloWidth`, der Kern ein Drittel des Ganzen - Legacys 24, 2 und 8 px.
 */
export const HANDLE_SIZE = canonIcon("lg");
const HANDLE_RING_RADIUS = (HANDLE_SIZE - 2 * DESIGN_CANON.route.haloWidth) / 2;
const HANDLE_CORE_RADIUS = HANDLE_SIZE / 3 / 2;

const EMPTY = { type: "FeatureCollection", features: [] } as const;
const empty = (): GeoJSONSourceSpecification["data"] => EMPTY as unknown as GeoJSONSourceSpecification["data"];

/** Die Linie zwischen beiden Punkten; solange der zweite fehlt, ist nichts zu zeichnen (Legacy: erst beim zweiten Klick). */
export function measureLineFeatures(measurement: Measurement | undefined): GeoJSONSourceSpecification["data"] {
    if (measurement?.end === undefined) return empty();
    const from = toRenderLngLat(space, measurement.start);
    const to = toRenderLngLat(space, measurement.end);
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [from.lng, from.lat],
                        [to.lng, to.lat],
                    ],
                },
            },
        ],
    };
}

/** Die Griffe: der Startpunkt immer, der Zielpunkt sobald er steht. */
export function measureHandleFeatures(measurement: Measurement | undefined): GeoJSONSourceSpecification["data"] {
    if (measurement === undefined) return empty();
    const points: { handle: "start" | "end"; at: { lng: number; lat: number } }[] = [
        { handle: "start", at: toRenderLngLat(space, measurement.start) },
    ];
    if (measurement.end !== undefined) {
        points.push({ handle: "end", at: toRenderLngLat(space, measurement.end) });
    }
    return {
        type: "FeatureCollection",
        features: points.map(({ handle, at }) => ({
            type: "Feature",
            properties: { handle },
            geometry: { type: "Point", coordinates: [at.lng, at.lat] },
        })),
    };
}

/** Die gestrichelte Linie - reine Anzeige, sie wird nie abgefragt (Legacy `interactive: false`). */
export function buildMeasureLineLayer(): LayerSpecification {
    return {
        id: MEASURE_LINE_LAYER_ID,
        type: "line",
        source: MEASURE_LINE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
            "line-color": canonColour("routeHalo"),
            "line-width": DESIGN_CANON.mapSelection.lineWidth,
            "line-dasharray": [...DESIGN_CANON.measure.lineDash],
        },
    };
}

/** Ring und Kern: dieselbe Bauweise wie die Wegpunktmarke (Guide §17.4) - heller Saum, farbiger Punkt. */
export function buildMeasureHandleLayers(): LayerSpecification[] {
    return [
        {
            id: MEASURE_HANDLE_RING_LAYER_ID,
            type: "circle",
            source: MEASURE_HANDLE_SOURCE_ID,
            paint: {
                "circle-radius": HANDLE_RING_RADIUS,
                "circle-color": canonColour("routeHalo"),
                "circle-stroke-width": DESIGN_CANON.route.haloWidth,
                "circle-stroke-color": canonColour("accentBrown"),
            },
        },
        {
            id: MEASURE_HANDLE_CORE_LAYER_ID,
            type: "circle",
            source: MEASURE_HANDLE_SOURCE_ID,
            paint: { "circle-radius": HANDLE_CORE_RADIUS, "circle-color": canonColour("accentBrown") },
        },
    ];
}

/**
 * Hängt die Messung an einen Stil: die Linie dorthin, wo die Routenlinie liegt (über Wegen und
 * Flächen, unter Ortsmarken und Namen), die Griffe oben an den Stapel.
 */
export function withMeasure(style: StyleSpecification, measurement: Measurement | undefined): StyleSpecification {
    const firstAbove = style.layers.findIndex((layer) => layer.type === "symbol" || layer.type === "circle");
    const at = firstAbove < 0 ? style.layers.length : firstAbove;
    return {
        ...style,
        sources: {
            ...style.sources,
            [MEASURE_LINE_SOURCE_ID]: {
                type: "geojson",
                data: measureLineFeatures(measurement),
            } as GeoJSONSourceSpecification,
            [MEASURE_HANDLE_SOURCE_ID]: {
                type: "geojson",
                data: measureHandleFeatures(measurement),
            } as GeoJSONSourceSpecification,
        },
        layers: [
            ...style.layers.slice(0, at),
            buildMeasureLineLayer(),
            ...style.layers.slice(at),
            ...buildMeasureHandleLayers(),
        ],
    };
}

/** Tauscht nur die Daten - der Stil bleibt, wie er ist. */
export function updateMeasure(map: MapLibreMap, measurement: Measurement | undefined): void {
    const line = map.getSource(MEASURE_LINE_SOURCE_ID) as GeoJSONSource | undefined;
    const handles = map.getSource(MEASURE_HANDLE_SOURCE_ID) as GeoJSONSource | undefined;
    line?.setData(measureLineFeatures(measurement));
    handles?.setData(measureHandleFeatures(measurement));
}
