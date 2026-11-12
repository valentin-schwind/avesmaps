import type {
    CircleLayerSpecification,
    DataDrivenPropertyValueSpecification,
    ExpressionSpecification,
    FilterSpecification,
    GeoJSONSourceSpecification,
    LayerSpecification,
    LineLayerSpecification,
    StyleSpecification,
    SymbolLayerSpecification,
} from "maplibre-gl";
import {
    AVENTURIA,
    canonColour,
    toRenderLngLat,
    type FormFehlerArt,
    type InvalidAreasResult,
} from "@avesmaps3d/shared";
import { t, type MessageKey } from "../i18n/i18n";
import { MEASURE_HANDLE_SOURCE_ID, MEASURE_LINE_SOURCE_ID } from "../measure/measure-layers";
import type { MapCheckResults } from "./map-checks";
import { MARKE_FEHLER_PX } from "./geometrie/bild";
import { MAP_PIN_SOURCE_ID } from "./map-pin-layer";
import { PATH_SOURCE_ID } from "./path-layers";
import {
    HAIRLINE_LAYER_ID,
    LABEL_FONT,
    PLACE_MARKER_LAYER_ID,
    STRUCTURE_HAIRLINE_LAYER_ID,
    STRUCTURE_MARKER_LAYER_ID,
} from "./place-layers";
import { ROUTE_BORDER_SOURCE_ID, ROUTE_SOURCE_ID, ROUTE_WAYPOINT_SOURCE_ID } from "./route-layers";

/**
 * Die Markierungen der Prüfhaken auf der Karte (WI-0131 Stufe 1), wie auf Blatt 1 abgenommen (Betreiber 2026-10-10: „sehr gut das
 * wollen wir“). Legacys Formen und Töne für die drei Legacy-Haken, Orange für „Flüsse bergaufwärts“; die Töne stehen im Kanon
 * (`mapCheck*`), die Maße hier.
 *
 * Zwei Arten, und der Unterschied ist Legacys Regel:
 * - **Eigene Quelle mit Geometrie vom Server** für „Flüsse bergaufwärts“, „Offene Wegenden“, „Unverbunden“ und „Wege treffen sich
 *   nicht“ (WI-0132 P2): Sie zeigen ihre Funde unabhängig von Zoom, Ortsklasse und Wegart (Owner Legacy 2026-08-14), auch wo die
 *   Karte den Weg oder Ort gerade nicht zeichnet.
 * - **Auf den vorhandenen Ebenen** für „Keine Wiki-Zuweisung“: Sie färbt nur, was die Karte gerade zeigt, und blendet nichts ein
 *   (Legacy `wiki-zuweisung.js`). Die Markierung übernimmt dafür Filter, `minzoom` und Größe der Ebene, die sie umrandet; ein Ort, den
 *   das Auge ausblendet, bekommt also auch keinen Ring.
 *
 * „Flächen kreuzen sich“ (2026-11-10) zeigt die Stelle, an der sich eine Fläche kreuzt oder berührt, im Zeichen, mit dem „Ecken bearbeiten“
 * eine abgelehnte Form markiert (`geometrie/schicht.ts`, Art `fehler`: rot durchgezogen, zart gefüllt, `MARKE_FEHLER_PX`), dazu den Namen
 * des Gebiets bzw. der Landschaft und in einer zweiten Zeile, was falsch ist. Die Beschriftung steht immer und verdrängt keinen Ortsnamen.
 *
 * Wie Route, Messung und Tropfen hängen sie an jedem Stil (`setStyle` mit `diff` entfernt, was der neue Stil nicht nennt). Die LINIEN
 * liegen über den Wegen und unter der Route; die RINGE liegen über den Ortsmarken und unter den Ortsnamen, sonst deckte eine Marke
 * ihren eigenen Ring zu (die Route steht unter den Marken, `route-layers.ts`).
 */

/** Was über den Markierungen liegt: die Ebenen von Route, Messung und Tropfen, erkannt an ihrer Quelle. */
const ABOVE_CHECKS: ReadonlySet<string> = new Set([
    ROUTE_SOURCE_ID,
    ROUTE_WAYPOINT_SOURCE_ID,
    ROUTE_BORDER_SOURCE_ID,
    MEASURE_LINE_SOURCE_ID,
    MEASURE_HANDLE_SOURCE_ID,
    MAP_PIN_SOURCE_ID,
]);

export const CHECK_SOURCE = {
    uphill: "check-uphill-rivers",
    loosePaths: "check-loose-paths",
    looseEnds: "check-loose-ends",
    unconnected: "check-unconnected",
    apart: "check-paths-apart",
    invalid: "check-invalid-areas",
} as const;

/**
 * Die Maße aus Blatt 1 in Pixeln: Linie und weiße Unterlage, Ringradius und Strichstärke. „Wege treffen sich nicht“ (WI-0132 P2) nach
 * seinem Blatt, abgenommen 2026-10-11 („ja passt“, „ja B“): blaugrüner Ring auf weißer Unterlage, „knapp verfehlt“ als ganz
 * ausgefüllte Scheibe derselben Größe.
 */
const SIZE = {
    uphill: { line: 4.5, halo: 8 },
    loosePath: { line: 3.5, halo: 7 },
    looseEnd: { radius: 13, ring: 4, halo: 7 },
    unconnected: { radius: 11, ring: 6, edge: 8 },
    apart: { radius: 10, ring: 3.5, halo: 6.5 },
    noWikiPlace: { ring: 4.5 },
    noWikiPath: { line: 2.5 },
    invalid: { radius: MARKE_FEHLER_PX, ring: 3, fill: 0.14, halo: 6.5, text: 13 },
} as const;

const TRANSPARENT = "rgba(0, 0, 0, 0)";
const ROUND = { "line-cap": "round", "line-join": "round" } as const;

type Position = [number, number];
const render = ([x, y]: Position): Position => {
    const at = toRenderLngLat(AVENTURIA.coordinateSpace, { x, y });
    return [at.lng, at.lat];
};

function lineSource(lines: { id: string; lines: Position[][] }[]): GeoJSONSourceSpecification {
    return {
        type: "geojson",
        data: {
            type: "FeatureCollection",
            features: lines.flatMap((entry) =>
                entry.lines.map((line) => ({
                    type: "Feature" as const,
                    properties: { id: entry.id },
                    geometry: { type: "LineString" as const, coordinates: line.map(render) },
                })),
            ),
        },
    };
}

function pointSource(points: { id: string; x: number; y: number; nearMiss?: boolean }[]): GeoJSONSourceSpecification {
    return {
        type: "geojson",
        data: {
            type: "FeatureCollection",
            features: points.map((point) => ({
                type: "Feature" as const,
                properties: point.nearMiss === undefined ? { id: point.id } : { id: point.id, near: point.nearMiss },
                geometry: { type: "Point" as const, coordinates: render([point.x, point.y]) },
            })),
        },
    };
}

/** Was an der Fläche falsch ist, in der Sprache der Oberfläche; ohne Fachwörter (Vali 2026-11-10 zu den Editoren). */
const INVALID_TEXT: Record<FormFehlerArt, MessageKey> = {
    schneidet_sich: "display.check.invalid-areas.schneidetSich",
    beruehrt_sich: "display.check.invalid-areas.beruehrtSich",
    loch_ueber_rand: "display.check.invalid-areas.lochUeberRand",
    zu_wenig_ecken: "display.check.invalid-areas.zuWenigEcken",
    sonst: "display.check.invalid-areas.sonst",
};

function invalidSource(spots: InvalidAreasResult["spots"]): GeoJSONSourceSpecification {
    return {
        type: "geojson",
        data: {
            type: "FeatureCollection",
            features: spots.map((spot) => ({
                type: "Feature" as const,
                properties: {
                    id: spot.area,
                    owner: spot.owner,
                    kind: spot.kind,
                    name: spot.name,
                    grund: t(INVALID_TEXT[spot.art]),
                },
                geometry: { type: "Point" as const, coordinates: render([spot.x, spot.y]) },
            })),
        },
    };
}

/** Name und Grund rechts neben dem Ring, eine Zeile je Angabe; rot auf weißem Saum wie die Ringe. */
function invalidLabel(): SymbolLayerSpecification {
    const size = SIZE.invalid;
    return {
        id: "check-invalid-area-label",
        type: "symbol",
        source: CHECK_SOURCE.invalid,
        layout: {
            "text-field": ["format", ["get", "name"], {}, "\n", {}, ["get", "grund"], { "font-scale": 0.85 }],
            "text-font": [LABEL_FONT],
            "text-size": size.text,
            "text-anchor": "left",
            "text-justify": "left",
            // Rechts vom Ring, mit dem Abstand eines halben Rings: Radius und Strich in Bildpunkten, umgerechnet in em der Schrift.
            "text-offset": [(size.radius + size.ring + 4) / size.text, 0],
            "text-max-width": 1000,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
        },
        paint: {
            "text-color": canonColour("danger"),
            "text-halo-color": canonColour("mapCheckHalo"),
            "text-halo-width": 1.6,
        },
    };
}

/** Wahr an einer Stelle „knapp verfehlt“ und an einem Ring, der eine solche Stelle mit zusammenfasst. */
const NEAR_MISS: ExpressionSpecification = ["==", ["get", "near"], true];

/**
 * Die Stellen von „Wege treffen sich nicht“. Liegt eine Stelle im Rund des Rings einer anderen (näher als der Ringradius, gemessen in
 * Bildpunkten der ganzen Zoomstufe), zeichnet die Karte EINEN Ring statt eines Doppelrands (Blatt WI-0132, Gareth und Schloss
 * Dryadenstein). Die Anzeige fasst zusammen, nicht der Server: Ob zwei Ringe sich decken, hängt am Zoom, und beim Hineinzoomen stehen
 * sie wieder einzeln. Die Funde bleiben, wie der Server sie liefert, jede Stelle zählt. „Knapp verfehlt“ geht auf den Ring über,
 * sobald eine seiner Stellen es ist.
 */
function apartSource(
    spots: readonly { path: string; x: number; y: number; near_miss: boolean }[],
): GeoJSONSourceSpecification {
    return {
        ...pointSource(spots.map((spot) => ({ id: spot.path, x: spot.x, y: spot.y, nearMiss: spot.near_miss }))),
        cluster: true,
        clusterRadius: SIZE.apart.radius,
        clusterProperties: { near: ["any", NEAR_MISS] },
    };
}

function haloedLine(
    id: string,
    source: string,
    colour: string,
    size: { line: number; halo: number },
): LineLayerSpecification[] {
    return [
        {
            id: `${id}-halo`,
            type: "line",
            source,
            layout: ROUND,
            paint: { "line-color": canonColour("mapCheckHalo"), "line-width": size.halo },
        },
        { id, type: "line", source, layout: ROUND, paint: { "line-color": colour, "line-width": size.line } },
    ];
}

/** `true` für genau diese Kennungen; MapLibre baut aus den Etiketten von `match` eine Nachschlagetafel. */
function idIn(ids: readonly string[]): unknown {
    return ["match", ["get", "public_id"], [...ids], true, false];
}

/**
 * „Keine Wiki-Zuweisung“ an Orten: ein Ring außen um die Haarlinie jeder sichtbaren Marke, Kreis und Raute. Filter und Radius kommen
 * von den Haarlinien-Ebenen (`place-layers.ts`), die Raute trägt dort ein `minzoom`, das hier in den Filter wandert.
 */
function noWikiPlaceLayer(
    layers: readonly LayerSpecification[],
    ids: readonly string[],
): CircleLayerSpecification | undefined {
    const circle = layers.find((layer) => layer.id === HAIRLINE_LAYER_ID);
    if (circle?.type !== "circle" || ids.length === 0) return undefined;
    const diamond = layers.find((layer) => layer.id === STRUCTURE_HAIRLINE_LAYER_ID);
    const visible =
        diamond?.type !== "symbol" || diamond.filter === undefined
            ? circle.filter
            : ["any", circle.filter, ["all", diamond.filter, [">=", ["zoom"], diamond.minzoom ?? 0]]];
    return {
        id: "check-no-wiki-place",
        type: "circle",
        source: circle.source,
        ...(circle["source-layer"] === undefined ? {} : { "source-layer": circle["source-layer"] }),
        filter: ["all", visible, idIn(ids)] as FilterSpecification,
        paint: {
            ...(circle.paint?.["circle-radius"] === undefined
                ? {}
                : { "circle-radius": circle.paint["circle-radius"] }),
            "circle-color": TRANSPARENT,
            "circle-stroke-color": canonColour("mapCheckNoWiki"),
            "circle-stroke-width": SIZE.noWikiPlace.ring,
        },
    };
}

/**
 * „Keine Wiki-Zuweisung“ an Wegen: ein Saum zu beiden Seiten jeder sichtbaren Wegart. Die Lücke ist die Breite der Kontur (sonst des
 * Kerns), also liegt der Saum außen an, bei jedem Zoom; Filter und `minzoom` sind die des gezeichneten Kerns.
 */
function noWikiPathLayers(layers: readonly LayerSpecification[], ids: readonly string[]): LineLayerSpecification[] {
    if (ids.length === 0) return [];
    return layers.flatMap((layer): LineLayerSpecification[] => {
        if (layer.type !== "line" || layer.source !== PATH_SOURCE_ID || !layer.id.startsWith("path-center-")) return [];
        const kind = layer.id.slice("path-center-".length);
        const outline = layers.find((candidate) => candidate.id === `path-outline-${kind}`);
        const gap = outline?.type === "line" ? outline.paint?.["line-width"] : layer.paint?.["line-width"];
        return [
            {
                id: `check-no-wiki-path-${kind}`,
                type: "line",
                source: layer.source,
                ...(layer["source-layer"] === undefined ? {} : { "source-layer": layer["source-layer"] }),
                ...(layer.minzoom === undefined ? {} : { minzoom: layer.minzoom }),
                filter: ["all", layer.filter ?? true, idIn(ids)] as FilterSpecification,
                layout: ROUND,
                paint: {
                    "line-color": canonColour("mapCheckNoWiki"),
                    "line-width": SIZE.noWikiPath.line,
                    ...(gap === undefined ? {} : { "line-gap-width": gap }),
                },
            },
        ];
    });
}

/** Fügt `extra` hinter der letzten der genannten Ebenen ein (oder vor der ersten, `before`), sonst ans Ende. */
function insertNear(
    layers: LayerSpecification[],
    extra: LayerSpecification[],
    anchors: readonly string[],
    where: "after" | "before",
): LayerSpecification[] {
    if (extra.length === 0) return layers;
    const indices = layers.flatMap((layer, index) => (anchors.some((a) => layer.id.startsWith(a)) ? [index] : []));
    if (indices.length === 0) return [...layers, ...extra];
    const at = where === "after" ? Math.max(...indices) + 1 : Math.min(...indices);
    return [...layers.slice(0, at), ...extra, ...layers.slice(at)];
}

export function withMapChecks(style: StyleSpecification, results: MapCheckResults): StyleSpecification {
    const {
        "uphill-rivers": uphill,
        "loose-ends": loose,
        unconnected,
        "paths-apart": apart,
        "no-wiki": noWiki,
        "invalid-areas": invalid,
    } = results;
    if (!uphill && !loose && !unconnected && !apart && !noWiki && !invalid) return style;

    let layers = [...style.layers];
    if (noWiki) {
        const place = noWikiPlaceLayer(layers, noWiki.places);
        layers = insertNear(layers, place ? [place] : [], [PLACE_MARKER_LAYER_ID, STRUCTURE_MARKER_LAYER_ID], "after");
        layers = insertNear(layers, noWikiPathLayers(layers, noWiki.paths), ["path-center-"], "before");
    }

    const sources: StyleSpecification["sources"] = { ...style.sources };
    const lines: LayerSpecification[] = [];
    const rings: LayerSpecification[] = [];
    if (uphill) {
        sources[CHECK_SOURCE.uphill] = lineSource(uphill.rivers);
        lines.push(
            ...haloedLine("check-uphill-river", CHECK_SOURCE.uphill, canonColour("mapCheckUphill"), SIZE.uphill),
        );
    }
    if (loose) {
        sources[CHECK_SOURCE.loosePaths] = lineSource(loose.paths);
        sources[CHECK_SOURCE.looseEnds] = pointSource(loose.ends.map((end) => ({ id: end.path, x: end.x, y: end.y })));
        const ring = (id: string, colour: string, width: number, opacity = 1): CircleLayerSpecification => ({
            id,
            type: "circle",
            source: CHECK_SOURCE.looseEnds,
            paint: {
                "circle-radius": SIZE.looseEnd.radius,
                "circle-color": TRANSPARENT,
                "circle-stroke-color": colour,
                "circle-stroke-width": width,
                "circle-stroke-opacity": opacity,
            },
        });
        lines.push(
            ...haloedLine(
                "check-loose-path",
                CHECK_SOURCE.loosePaths,
                canonColour("mapCheckLoosePath"),
                SIZE.loosePath,
            ),
        );
        rings.push(
            ring("check-loose-end-halo", canonColour("mapCheckHalo"), SIZE.looseEnd.halo, 0.85),
            ring("check-loose-end", canonColour("mapCheckLoosePath"), SIZE.looseEnd.ring),
        );
    }
    if (unconnected) {
        sources[CHECK_SOURCE.unconnected] = pointSource(unconnected.nodes);
        const ring = (id: string, colour: string, width: number): CircleLayerSpecification => ({
            id,
            type: "circle",
            source: CHECK_SOURCE.unconnected,
            paint: {
                "circle-radius": SIZE.unconnected.radius,
                "circle-color": TRANSPARENT,
                "circle-stroke-color": colour,
                "circle-stroke-width": width,
            },
        });
        // Legacy: pinker Ring mit schwarzen Kanten; die Kante ist die Haarlinie der Ortsmarken.
        rings.push(
            ring("check-unconnected-edge", canonColour("markerHairline"), SIZE.unconnected.edge),
            ring("check-unconnected", canonColour("mapCheckUnconnected"), SIZE.unconnected.ring),
        );
    }
    if (apart) {
        // Je Stelle ein Ring auf weißer Unterlage; „knapp verfehlt“ (unter 0,001 E, der Server entscheidet) füllt ihn ganz aus.
        // Fast deckungsgleiche Stellen zeigt die Karte als einen Ring (`apartSource`). Nur Anzeige: Der Haken verbindet nichts.
        sources[CHECK_SOURCE.apart] = apartSource(apart.spots);
        const colour = canonColour("mapCheckApart");
        const ring = (
            id: string,
            fill: DataDrivenPropertyValueSpecification<string>,
            stroke: string,
            width: number,
            opacity = 1,
        ): CircleLayerSpecification => ({
            id,
            type: "circle",
            source: CHECK_SOURCE.apart,
            paint: {
                "circle-radius": SIZE.apart.radius,
                "circle-color": fill,
                "circle-stroke-color": stroke,
                "circle-stroke-width": width,
                "circle-stroke-opacity": opacity,
            },
        });
        rings.push(
            ring("check-paths-apart-halo", TRANSPARENT, canonColour("mapCheckHalo"), SIZE.apart.halo, 0.85),
            ring("check-paths-apart", ["case", NEAR_MISS, colour, TRANSPARENT], colour, SIZE.apart.ring),
        );
    }
    const labels: LayerSpecification[] = [];
    if (invalid) {
        // Das Zeichen von „Ecken bearbeiten“ für eine abgelehnte Form, auf weißer Unterlage wie die übrigen Ringe.
        sources[CHECK_SOURCE.invalid] = invalidSource(invalid.spots);
        const size = SIZE.invalid;
        rings.push(
            {
                id: "check-invalid-area-halo",
                type: "circle",
                source: CHECK_SOURCE.invalid,
                paint: {
                    "circle-radius": size.radius,
                    "circle-color": TRANSPARENT,
                    "circle-stroke-color": canonColour("mapCheckHalo"),
                    "circle-stroke-width": size.halo,
                    "circle-stroke-opacity": 0.85,
                },
            },
            {
                id: "check-invalid-area",
                type: "circle",
                source: CHECK_SOURCE.invalid,
                paint: {
                    "circle-radius": size.radius,
                    "circle-color": canonColour("danger"),
                    "circle-opacity": size.fill,
                    "circle-stroke-color": canonColour("danger"),
                    "circle-stroke-width": size.ring,
                },
            },
        );
        labels.push(invalidLabel());
    }
    const above = layers.findIndex((layer) => "source" in layer && ABOVE_CHECKS.has(layer.source));
    const at = above < 0 ? layers.length : above;
    layers = [...layers.slice(0, at), ...lines, ...layers.slice(at)];
    // Ohne Ortsmarken (alle Klassen aus) gehen die Ringe dorthin, wo die Linien stehen.
    const markers = layers.some((layer) => layer.id.startsWith(PLACE_MARKER_LAYER_ID));
    layers = markers
        ? insertNear(layers, rings, [PLACE_MARKER_LAYER_ID, "check-no-wiki-place"], "after")
        : [...layers.slice(0, at + lines.length), ...rings, ...layers.slice(at + lines.length)];
    // Die Beschriftung zuoberst: Sie verdrängt nichts (`text-ignore-placement`) und wird von keinem Ortsnamen verdeckt.
    return { ...style, sources, layers: [...layers, ...labels] };
}
