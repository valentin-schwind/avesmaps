import type {
    GeoJSONSource,
    GeoJSONSourceSpecification,
    LayerSpecification,
    Map as MapLibreMap,
    StyleSpecification,
} from "maplibre-gl";
import { AVENTURIA, canonColour, toRenderLngLat, type MapPoint } from "@avesmaps3d/shared";
import { drawRouteMarkerImage } from "./route-layers";

/**
 * Der Tropfen einer freien Kartenstelle (WI-0063 4.9, P5): Wer „Was ist hier?“ fragt - mit dem langen Druck am Finger, mit
 * dem Kontextmenü oder über `?pin=` -, sieht an der Stelle einen klaren, vorübergehenden Marker: den Tropfen des Routenziels
 * (`WAYPOINT_MARK.drop`, dieselbe Gestalt, {@link MAP_PIN_SCALE}-mal so groß), mit seiner Spitze genau auf der Stelle, aber mit einem großen dunklen
 * FRAGEZEICHEN statt des Auges. 🔴 Betreiber 2026-10-09: „Der Tropfen zur Markierung sieht identsich zum wegpunkt tropfen
 * aus, aber die leute wünschen sich eine unterscheidung. mein ansatz wäre den schwarzen punkt im roten tropfen durch ein
 * großes schwarzes fragezeichen zu ersetzen.“ Vorher war es derselbe Tropfen wie das Ziel einer Route (WI-0063 P5: „kein
 * zweites Zeichen“); auf der Karte ließ sich die Frage dann nicht von einem Reiseziel unterscheiden. Am Bild nachgeschärft
 * (Betreiber 2026-10-09: „kannst du das fragezeichen fett machen, etwas weiter runtersetzen und dem tropfen einen gelben
 * hintergrund geben?“): Die Füllung ist die Auswahlfarbe des Kanons (`colour.mapSelection`, dasselbe Gelb wie ein gewähltes
 * Gebiet oder sein Name, kein eigenes), Rand und Fragezeichen bleiben im Dunkel des Kerns. Zwischen Füllung und Rand liegt
 * eine weiße Innenkontur (Betreiber 2026-10-09: „perfekt und jetzt noch zwischen gelber füllung und schwarzem hand eine weiße
 * innenkontur“): das Weiß der Ortsmarken (`colour.markerSettlementContour`), {@link PIN_INNER_LINE} Einheiten breit, rund
 * 1,6 px beim 1,25-fachen Tropfen; das Außenmaß bleibt, die gelbe Fläche wird um diese Breite schmaler.
 *
 * REINE ANZEIGE wie die Route: Er wird nie abgefragt und nie angeklickt. Er steht nur, solange die Kartenstelle der gewählte
 * Subject ist; mit der Auswahl geht er (`PresentedSelection.pin`).
 *
 * 🔴 Die Quelle steht IM STIL (`withMapPin`), nicht daneben: `setStyle(…, { diff: true })` entfernt, was der neue Stil nicht
 * nennt. Zwischen zwei Stilen tauscht `updateMapPin` nur die Daten.
 */

export const MAP_PIN_SOURCE_ID = "map-pin";
export const MAP_PIN_LAYER_ID = "map-pin";
export const MAP_PIN_IMAGE_ID = "map-pin-query";

/**
 * 🔴 Der Tropfen steht 1,25-mal so groß wie der Zieltropfen der Route (Betreiber 2026-10-09: zuerst „du kannst den "was ist
 * hier?" tropfen um 150% größer machen“, gebaut als 1,5-fach, am Blatt dann „mach 1,25 so groß“). Gezeichnet wird
 * er dafür mit der größeren Pixeldichte, nicht hochskaliert (`icon-size`), damit Rand, Kontur und Fragezeichen scharf
 * bleiben; Gestalt und Verhältnisse sind dieselben, die Spitze steht weiter genau auf der Stelle.
 */
export const MAP_PIN_SCALE = 1.25;

/** Die Breite der weißen Innenkontur in Einheiten des viewBox (der dunkle Rand ist 3,5 breit). */
const PIN_INNER_LINE = 1.4;

/**
 * Das Fragezeichen im Kopf des Tropfens, in den Einheiten von `WAYPOINT_MARK.drop` (viewBox -15 -51 30 51, Kopf ein Kreis
 * um 0/-36, innen r 11,5). Ein Strich mit runden Enden, kein Schriftzeichen: Die Hausschrift ist beim Zeichnen des Bildes
 * nicht sicher geladen, und ein Ersatz sähe auf jedem Gerät anders aus. Bogen um 0/-37,5 mit r 4,2 von links über oben bis
 * schräg rechts unten, dann zur Mitte und senkrecht hinab; darunter der Punkt. Fett (Strich 4,2 statt 3,2, Punkt r 2,5) und
 * am Bild zweimal tiefer gesetzt (Betreiber 2026-10-09: „etwas weiter runtersetzen“, dann „noch etwas weiter runter setzen“),
 * zusammen 3,2 Einheiten gegenüber der ersten Fassung: Das Zeichen reicht von -43,8 bis -21,2, seine Mitte liegt bei -32,5,
 * unter der Mitte des Kopfs (-36); der Punkt sitzt schon im Ansatz der Spitze, die dort noch rund 16 Einheiten breit ist.
 */
const QUESTION = {
    cx: 0,
    cy: -37.5,
    r: 4.2,
    stem: -30.7,
    stemEnd: -29.7,
    dotY: -23.7,
    dotR: 2.5,
    stroke: 4.2,
} as const;

function drawQuestionMark(ctx: CanvasRenderingContext2D, core: string): void {
    const q = QUESTION;
    ctx.strokeStyle = core;
    ctx.fillStyle = core;
    ctx.lineWidth = q.stroke;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.arc(q.cx, q.cy, q.r, Math.PI, Math.PI * 2.25);
    const end = { x: q.cx + q.r * Math.cos(Math.PI * 0.25), y: q.cy + q.r * Math.sin(Math.PI * 0.25) };
    ctx.quadraticCurveTo(q.cx, end.y + 1.2, q.cx, q.stem);
    ctx.lineTo(q.cx, q.stemEnd);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(q.cx, q.dotY, q.dotR, 0, Math.PI * 2);
    ctx.fill();
}

/**
 * Das Bild des Tropfens mit Fragezeichen: der Tropfen des Routenziels, gelb gefüllt mit weißer Innenkontur, das Auge durch
 * das Fragezeichen ersetzt.
 */
export function drawMapPinImage(pixelRatio = 2): ImageData {
    // Angemeldet wird mit `pixelRatio` 2 (`runtime-images.ts`): Ein Bild mit der 1,25-fachen Dichte steht 1,25-mal so groß da.
    return drawRouteMarkerImage("drop", pixelRatio * MAP_PIN_SCALE, {
        fill: canonColour("mapSelection"),
        innerLine: { colour: canonColour("markerSettlementContour"), width: PIN_INNER_LINE },
        head: drawQuestionMark,
    });
}

const space = AVENTURIA.coordinateSpace;

const NO_PIN = { type: "FeatureCollection", features: [] } as const;

/** Die Daten der Quelle: ein Punkt in Renderkoordinaten oder nichts. */
export function mapPinFeatures(point: MapPoint | undefined): GeoJSONSourceSpecification["data"] {
    if (point === undefined) return NO_PIN as unknown as GeoJSONSourceSpecification["data"];
    const { lng, lat } = toRenderLngLat(space, point);
    return {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lng, lat] } }],
    };
}

export function buildMapPinLayer(): LayerSpecification {
    return {
        id: MAP_PIN_LAYER_ID,
        type: "symbol",
        source: MAP_PIN_SOURCE_ID,
        layout: {
            "icon-image": MAP_PIN_IMAGE_ID,
            // Die Spitze des Tropfens liegt auf der Unterkante: Sie steht genau auf der Stelle.
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
        },
    };
}

/** Hängt Quelle und Ebene ganz oben an: Der Tropfen liegt über allem, auch über der Route. */
export function withMapPin(style: StyleSpecification, point: MapPoint | undefined): StyleSpecification {
    return {
        ...style,
        sources: {
            ...style.sources,
            [MAP_PIN_SOURCE_ID]: { type: "geojson", data: mapPinFeatures(point) } as GeoJSONSourceSpecification,
        },
        layers: [...style.layers, buildMapPinLayer()],
    };
}

/** Tauscht nur die Daten - der Stil bleibt, wie er ist. */
export function updateMapPin(map: MapLibreMap, point: MapPoint | undefined): void {
    const source = map.getSource(MAP_PIN_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(mapPinFeatures(point));
}
