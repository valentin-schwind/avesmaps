import type {
    FilterSpecification,
    GeoJSONSourceSpecification,
    LayerSpecification,
    Map as MapLibreMap,
    StyleSpecification,
} from "maplibre-gl";
import {
    AIR_EDGE_PREFIX,
    roundCorners,
    AIR_TYPE,
    AVENTURIA,
    AVENTURIA_FLIGHT_CARTOGRAPHY,
    canonColour,
    catmullRomLine,
    DESIGN_CANON,
    FREE_SEA_EDGE_PREFIX,
    OFFROAD_TYPE,
    toRenderLngLat,
    type CurvePoint,
    type RouteResponse,
    type RouteSegment,
    type RouteStage,
} from "@avesmaps3d/shared";
import { WAYPOINT_MARK } from "../route-planner/waypoint-mark-shape";

/**
 * Die Route auf der Karte (WI-0017, Schritt 2; Design Guide §17.10, Legacy route-render.js).
 *
 * - **Linie** in `--color-route`, 7 px, mit einem weißen Saum von 2 px je Seite in einer EIGENEN
 *   Ebene darunter - sonst überdeckte der Saum des nächsten Abschnitts die Farbe des vorigen.
 * - **Gewählte Etappe** in Gold, **veraltete Route** mit 40 % ihrer eigenen Deckkraft (Owner
 *   14.09.2026: „gedimmt" statt weg), **Querfeldein** als Kette kurzer Pillen, in derselben Farbe und
 *   Deckkraft wie die übrige Route (Betreiber 2026-09-24; Legacy gestrichelt mit 0,7).
 * - 🔴 **Die Pillen zeichnet eine eigene Ebene** (`route-pills.ts`), in jedem Bild neu gelegt und als
 *   Kapsel gerechnet. Ein Strichmuster streckte MapLibre zwischen zwei Zoomstufen mit der Kachel, Bilder in
 *   fester Größe lasen sich gedrückt und sprangen nach jedem Zoom (Betreiber 2026-09-24). Hier stehen nur
 *   die Stücke, die sie zeichnet (`offroadShapes`).
 * - **Wegpunkte**: Scheibe, das Ziel ein Tropfen, ein einzelner Wegpunkt ebenfalls ein Tropfen - Legacys
 *   Vektorzeichnung, Pfad für Pfad.
 * - **Grenzübertritte** (WI-0065 Z3 C): auf Wunsch je Übertritt eine kleine Scheibe an seiner Stelle, wie die des
 *   Wegpunkts gebaut (dunkler Rand, goldener Ring, dunkles Auge), im Körper Pergament statt Rot. REINE ANZEIGE: Keine
 *   dieser Ebenen ist Ziel eines Klicks oder Zeigens, keine wird je abgefragt; die Kamera bewegt sich nicht.
 *
 * 🔴 Die Quellen stehen IM STIL (`withRoute`), nicht daneben: `setStyle(…, { diff: true })` entfernt
 * alles, was der neue Stil nicht nennt. Zwischen zwei Stilen tauscht `updateRouteData` nur die Daten.
 *
 * ⭐ Die Linie ist geglättet wie die gezeichneten Wege (Catmull-Rom, Legacy): sonst liefe die Route
 * neben ihrem Weg her.
 *
 * - **Die Reisenden** (Playmode, WI-0031): ein Pfeil in Bronze, flach auf der Karte, in Fahrtrichtung
 *   gedreht - über allem anderen der Route. Er hat seine eigene Quelle, weil er Bild für Bild
 *   wandert und die Linie dabei nicht neu gebaut werden darf.
 * - **Der Flug** (WI-0051 F3): flach die Linie der Route, rot (`FLIGHT_COLOUR`), seine
 *   Ecken gerundet (`roundCorners`). Geneigt zeichnet `flight-arcs.ts` die Flugbahn im Raum samt Bodenspur,
 *   und die Linie tritt zurück: Ihr Filter fragt den globalen Zustand `ROUTE_FLIGHT_IN_SPACE`, den nur
 *   die Flugbahn setzt. Getroffen wird die Linie weiter, auch geneigt.
 */

export const ROUTE_SOURCE_ID = "route";
export const ROUTE_WAYPOINT_SOURCE_ID = "route-waypoints";
export const ROUTE_HALO_LAYER_ID = "route-halo";
export const ROUTE_LINE_LAYER_ID = "route-line";
export const ROUTE_MARKER_LAYER_ID = "route-markers";
/** Die Marken der Grenzübertritte: eine eigene Quelle, drei Ebenen (Rand, Körper mit Ring, Auge). */
export const ROUTE_BORDER_SOURCE_ID = "route-borders";
export const ROUTE_BORDER_LAYER_IDS = ["route-border-rim", "route-border-body", "route-border-eye"] as const;
/** Die unsichtbare, breite Trefferfläche der Linie - nur zum Antippen und Anklicken. */
export const ROUTE_HIT_LAYER_ID = "route-hit";
export const ROUTE_DISC_IMAGE_ID = "route-marker-disc";
export const ROUTE_DROP_IMAGE_ID = "route-marker-drop";
/**
 * Die Ebene, auf die man klickt, um eine Etappe zu wählen: breiter als die gezeichnete Linie
 * (Betreiber 2026-09-24: „der Touchbereich … könnte mit dem Finger etwas breiter sein“).
 */
export const ROUTE_CLICK_LAYERS = [ROUTE_HIT_LAYER_ID];

/** Wie breit die Trefferfläche ist: am Finger eine Fingerkuppe, an der Maus knapp das Doppelte der Linie. */
export const ROUTE_HIT_WIDTH = { touch: 28, pointer: 14 } as const;

/**
 * Der globale Zustand des Stils (MapLibre `global-state`): Steht die Flugbahn gerade im Raum? Dann zeichnen
 * Saum und Linie keinen Flugabschnitt, sonst stünde der Flug doppelt da. Vorgabe `false`, also flach wie
 * vorher; setzen darf ihn nur `flight-arcs.ts`.
 */
export const ROUTE_FLIGHT_IN_SPACE = "routeFlightInSpace";

export interface RouteMapWaypoint {
    x: number;
    y: number;
    name: string;
    /** Die Zeile im Planer - damit eine gezogene Marke weiß, wer sie ist. */
    key?: number;
}

/** Wo die Route eine Landesgrenze überschreitet (`travel_costs.borders.crossings`), in Kartenkoordinaten. */
export interface RouteMapBorder {
    x: number;
    y: number;
    from?: string;
    to?: string;
}

export interface RouteLayerData {
    route: RouteResponse | null;
    /** Die Route wird gerade neu gerechnet: Sie bleibt gedimmt stehen und ist nicht klickbar. */
    stale: boolean;
    selectedStage: number | null;
    /** Die gesetzten Wegpunkte - sie tragen ihre Marke auch schon, bevor es eine Route gibt. */
    waypoints: readonly RouteMapWaypoint[];
    /** Die Übertrittsstellen samt Namen für den Hinweis (Vorgabe: keine). */
    borders?: readonly RouteMapBorder[];
}

export const EMPTY_ROUTE_LAYER: RouteLayerData = {
    route: null,
    stale: false,
    selectedStage: null,
    waypoints: [],
    borders: [],
};

/** Wo die Reisenden gerade sind: Lage in Kartenkoordinaten, Richtung im Uhrzeigersinn ab Kartennorden. */
export interface RouteTraveler {
    x: number;
    y: number;
    heading: number;
}

type Position = [number, number];
/** Die Farbe der Linie eines Abschnitts, ein Name im Kanon: blau wie die Route oder rot für ein Fluggerät. */
export type RouteLineColour = "route" | "routeFlight";
interface LineFeature {
    type: "Feature";
    properties: {
        stage: number;
        offroad: boolean;
        selected: boolean;
        stale: boolean;
        /** Ein Flugabschnitt (WI-0051): geneigt zeichnet ihn die Flugbahn, nicht die Linie. */
        flight: boolean;
        /** Die Farbe der Linie, solange sie nicht gewählt ist. */
        colour: RouteLineColour;
    };
    geometry: { type: "LineString"; coordinates: Position[] };
}
interface PointFeature {
    type: "Feature";
    properties: { icon: string; name: string; order: number; key: number };
    geometry: { type: "Point"; coordinates: Position };
}

const space = AVENTURIA.coordinateSpace;
const render = (x: number, y: number): Position => {
    const lngLat = toRenderLngLat(space, { x, y });
    return [lngLat.lng, lngLat.lat];
};

/**
 * Die Form, in der ein Abschnitt gezeichnet wird - und die der Pfeil im Playmode abfährt, damit er
 * auf der Linie bleibt statt ihre Kurven zu schneiden.
 *
 * Geglättet wie die gezeichneten Wege (Catmull-Rom, Legacy), auch ein gebogener Gang querfeldein
 * (Betreiber 2026-09-24: „kann diese auch mit catmull rom glätten“). Eine Sehne aus zwei Punkten
 * bleibt gerade. 🔴 Gemessen wird weiter an der ausgelieferten, ungeglätteten Linie: Meilen und
 * Stunden kommen vom Server.
 *
 * 🔴 Liefert der Server `display`, wird das gezeichnet (WI-0030 R7-Nachtrag p): bei einem an einem
 * Anker geteilten Wegstück genau das befahrene Stück der gezeichneten Wegkurve, bei einem Gang der
 * Endpunkt auf dieser Kurve. Sonst glättete das Wegstück für sich allein mit anderen Stützpunkten als
 * die Karte, und der Gang schien die Straße zu überqueren (Betreiber: „die leute glauben, man
 * überquert die straße“, Befund A, `?s=kaHjKVsP`).
 *
 * 🔴 Die freie Seefahrt (WI-0046) kommt schon geglättet und gegen Land geprüft: Ihre Linie wird gezeichnet,
 * wie sie ist. Ein zweites Glätten über ungleich lange Stücke schlüge an den Übergängen Schleifen.
 *
 * 🔴 Ein Flug um die Gebirge (WI-0051 F2) wird an seinen Ecken abgeschnitten (`roundCorners`), nicht mit
 * Catmull-Rom geglättet: Seine Knicke liegen oft dicht beieinander zwischen langen Strecken, und dort schlug
 * die Kurve Schleifen (Punin → Perricum mit dem Hippogriff, Baburin → Gareth mit dem Hexenbesen). Dieselbe
 * Form trägt geneigt die Flugbahn im Raum (`flight-arcs.ts`); Betreiber 2026-09-28: „3. ja“, Ecken auch
 * in 2D rund. Eine Luftlinie aus zwei Punkten bleibt gerade.
 *
 * 💣 **Ein Anschlussstück an einen Knoten (`joints`) wird vor dem Glätten abgetrennt und danach gerade
 * angehängt** (WI-0147, Messung 2026-10-15, `discovery/seegraph-kehren-2026-10-14.md` Nachtrag 2): Die
 * Catmull-Rom-Tangente am vorletzten Stützpunkt ist `(nächster − vorheriger) × 0,5`, behält also bei einem
 * kurzen Endstück die Länge der langen Strecke davor — die Kurve schoss darüber hinaus, über 3.802 Stellen des
 * Netzes um im Mittel ein Sechzehntel dieser Strecke und bis zu 0,71 Einheiten. **Unabhängig davon, wie kurz
 * das Anschlussstück ist.** Abgetrennt bleibt die Glättung über den Rohpunkten genau die der Karte, und die
 * Linie endet weiter exakt auf dem Knoten.
 */
export function segmentShape(
    segment: Pick<RouteSegment, "geometry" | "display" | "joints"> & { edge_id?: string },
): CurvePoint[] {
    const anfang = segment.joints?.start === true ? ende(segment.geometry.coordinates, "erster") : null;
    const schluss = segment.joints?.end === true ? ende(segment.geometry.coordinates, "letzter") : null;
    const kern = withoutJoints((segment.display ?? segment.geometry).coordinates, anfang, schluss);
    const geglaettet = smoothCore(kern, segment);
    return [...(anfang ? [anfang] : []), ...geglaettet, ...(schluss ? [schluss] : [])];
}

/** Der erste oder letzte Punkt einer Linie als `CurvePoint`; null bei einer leeren Linie. */
function ende(coordinates: readonly [number, number][], welcher: "erster" | "letzter"): CurvePoint | null {
    const punkt = welcher === "erster" ? coordinates[0] : coordinates[coordinates.length - 1];
    return punkt ? { x: punkt[0], y: punkt[1] } : null;
}

/** Zwei Punkte auf Zeichengenauigkeit gleich (fünfte Stelle, wie die Wegenden der Karte). */
const gleich = (a: CurvePoint, b: readonly [number, number]): boolean =>
    Math.abs(a.x - b[0]) < 1e-5 && Math.abs(a.y - b[1]) < 1e-5;

/**
 * Die zu glättende Linie ohne ihre Anschlussstücke.
 *
 * 🪤 Die Markierungen beschreiben `geometry`; eine mitgelieferte Zeichenlinie kann denselben Knoten tragen (ein
 * begradigter Gang querfeldein) oder nicht (ein an einem Anker geteilter Weg, dessen Stück aus der Rohlinie
 * gerechnet ist). Darum wird nur abgetrennt, was wirklich dort steht — sonst erschiene der Knoten doppelt
 * beziehungsweise fehlte am Ende ganz.
 */
function withoutJoints(
    coordinates: readonly [number, number][],
    anfang: CurvePoint | null,
    schluss: CurvePoint | null,
): CurvePoint[] {
    let von = 0;
    let bis = coordinates.length;
    if (anfang && bis - von > 1 && gleich(anfang, coordinates[von] as [number, number])) von += 1;
    if (schluss && bis - von > 1 && gleich(schluss, coordinates[bis - 1] as [number, number])) bis -= 1;
    return coordinates.slice(von, bis).map(([x, y]) => ({ x, y }));
}

/** Die Glättung des Kerns, je Abschnittsart - der Teil, der vor den Anschlussstücken schon galt. */
function smoothCore(
    kern: readonly CurvePoint[],
    segment: Pick<RouteSegment, "display"> & { edge_id?: string },
): CurvePoint[] {
    if (segment.display && segment.edge_id?.startsWith(FREE_SEA_EDGE_PREFIX)) return [...kern];
    if (segment.edge_id?.startsWith(AIR_EDGE_PREFIX)) {
        if (segment.display) return [...kern];
        return roundCorners(kern, AVENTURIA_FLIGHT_CARTOGRAPHY.form.eckenRunden);
    }
    return kern.length > 2 ? catmullRomLine(kern) : [...kern];
}

/**
 * Rundet die Ecken eines Zugs durch Abschneiden (Chaikin): Jede Strecke gibt ihre Punkte bei einem und drei
 * Vierteln weiter, `times`-mal. Anfang und Ende bleiben stehen. Die Kurve bleibt in der Hülle des Zugs und
 * schlägt keine Schleife, auch nicht zwischen ungleich langen Strecken.
 */
export { roundCorners } from "@avesmaps3d/shared";

/** Ist dieser Abschnitt ein Flug (WI-0051)? */
export function isFlightSegment(segment: Pick<RouteSegment, "subtype">): boolean {
    return segment.subtype === AIR_TYPE;
}

/**
 * Die Farbe eines Flugs, flach als Linie wie geneigt als Bahn: rot, für jedes Flugmittel (Betreiber
 * 2026-09-28: „alle flüge sollen eine rote flugbahn bekommen“; davor nur die Gruppe Fluggeräte, „ein rote
 * flugbahn für fluggeräte“).
 */
export const FLIGHT_COLOUR: RouteLineColour = "routeFlight";

/**
 * Je Abschnitt eine Linie, mit ihrer Etappe - daran hängen Gold, Klick und Querfeldein.
 *
 * 🔴 Querfeldein (Pillen) ist ein Stück nur in einer Querfeldein-Etappe: Die Karte zeigt, was der Reiseplan zeigt. Ein
 * Stück querfeldein von 0,00 Meilen ist dort keine Etappe (`mergeStageEntries`, Betreiber 2026-10-11) und wird hier mit
 * seiner Etappe als Linie gezeichnet; sonst setzte die Pillenebene in seine Mitte eine Pille, die immer steht.
 */
export function routeLineFeatures(data: RouteLayerData): { type: "FeatureCollection"; features: LineFeature[] } {
    const route = data.route;
    if (!route?.found) return { type: "FeatureCollection", features: [] };
    const stageOf = new Map<number, RouteStage>();
    for (const stage of route.stages) {
        for (let index = 0; index < stage.segment_count; index += 1) stageOf.set(stage.segment_start + index, stage);
    }
    const features = route.segments.map((segment): LineFeature => {
        const own = stageOf.get(segment.index);
        const stage = own?.index ?? 0;
        const shape = segmentShape(segment);
        const flight = isFlightSegment(segment);
        const offroad = segment.synthetic || segment.subtype === OFFROAD_TYPE;
        return {
            type: "Feature",
            properties: {
                stage,
                offroad: offroad && (own === undefined || own.type === OFFROAD_TYPE),
                selected: !data.stale && data.selectedStage === stage,
                stale: data.stale,
                flight,
                colour: flight ? FLIGHT_COLOUR : "route",
            },
            geometry: { type: "LineString", coordinates: shape.map((point) => render(point.x, point.y)) },
        };
    });
    return { type: "FeatureCollection", features };
}

/** Die Wegpunktmarken: Scheibe, das Ziel ein Tropfen; ein Wegpunkt allein ist ebenfalls ein Tropfen. */
export function routeWaypointFeatures(data: RouteLayerData): { type: "FeatureCollection"; features: PointFeature[] } {
    const count = data.waypoints.length;
    const features = data.waypoints.map((waypoint, index): PointFeature => ({
        type: "Feature",
        properties: {
            icon: index === count - 1 ? ROUTE_DROP_IMAGE_ID : ROUTE_DISC_IMAGE_ID,
            name: waypoint.name,
            // Das Ziel oben, dann rückwärts: Marken, die sich decken, liegen in Reiserichtung.
            order: index,
            key: waypoint.key ?? -1,
        },
        geometry: { type: "Point", coordinates: render(waypoint.x, waypoint.y) },
    }));
    return { type: "FeatureCollection", features };
}

/** Die Marken der Grenzübertritte: ein Punkt je Stelle, in der Reihenfolge der Reise. */
export function routeBorderFeatures(data: RouteLayerData): {
    type: "FeatureCollection";
    features: {
        type: "Feature";
        properties: { order: number; from: string; to: string };
        geometry: { type: "Point"; coordinates: Position };
    }[];
} {
    return {
        type: "FeatureCollection",
        features: (data.borders ?? []).map((border, order) => ({
            type: "Feature",
            properties: { order, from: border.from ?? "", to: border.to ?? "" },
            geometry: { type: "Point", coordinates: render(border.x, border.y) },
        })),
    };
}

/**
 * Die Ausdehnung der Route - oder einer ihrer Etappen - in Renderkoordinaten, zum Einpassen der
 * Kamera (Legacy `getCurrentRouteBounds`, `getRouteEntryBounds`). Ohne Geometrie: undefined.
 */
export function routeRenderBounds(
    response: RouteResponse,
    stage?: number,
): [[number, number], [number, number]] | undefined {
    const chosen = stage === undefined ? undefined : response.stages[stage];
    const inStage = (index: number): boolean =>
        chosen === undefined || (index >= chosen.segment_start && index < chosen.segment_start + chosen.segment_count);
    let west = Number.POSITIVE_INFINITY;
    let south = Number.POSITIVE_INFINITY;
    let east = Number.NEGATIVE_INFINITY;
    let north = Number.NEGATIVE_INFINITY;
    for (const segment of response.segments) {
        if (!inStage(segment.index)) continue;
        for (const [x, y] of segment.geometry.coordinates) {
            const [lng, lat] = render(x, y);
            west = Math.min(west, lng);
            east = Math.max(east, lng);
            south = Math.min(south, lat);
            north = Math.max(north, lat);
        }
    }
    if (!Number.isFinite(west)) return undefined;
    return [
        [west, south],
        [east, north],
    ];
}

const route = DESIGN_CANON.route;
const haloWidth = route.width + 2 * route.haloWidth;

/** Deckkraft: veraltet × 0,4 - der Faktor wirkt auf die EIGENE Deckkraft (Guide §17.10). */
const staleOpacity = ["case", ["get", "stale"], route.staleFactor, 1];

/**
 * Querfeldein zeichnen die Pillen, nicht die Linie, und einen Flug im Raum die Flugbahn (WI-0051 F3);
 * getroffen wird trotzdem die ganze Route.
 */
const isDrawn: FilterSpecification = [
    "all",
    ["!=", ["get", "offroad"], true],
    ["!", ["all", ["==", ["get", "flight"], true], ["==", ["global-state", ROUTE_FLIGHT_IN_SPACE], true]]],
];

/**
 * Die Ebenen der Linie, von unten nach oben: Saum, Linie und darüber die unsichtbare Trefferfläche.
 * Querfeldein liegen die Pillen direkt darüber (`route-pills.ts`).
 */
export function buildRouteLineLayers(hitWidth: number = ROUTE_HIT_WIDTH.pointer): LayerSpecification[] {
    const lineColour = [
        "case",
        ["get", "selected"],
        canonColour("routeSelected"),
        ["==", ["get", "colour"], "routeFlight"],
        canonColour("routeFlight"),
        canonColour("route"),
    ];
    return [
        {
            id: ROUTE_HALO_LAYER_ID,
            type: "line",
            source: ROUTE_SOURCE_ID,
            filter: isDrawn,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": canonColour("routeHalo"),
                "line-width": haloWidth,
                "line-opacity": staleOpacity as unknown as number,
            },
        },
        {
            id: ROUTE_LINE_LAYER_ID,
            type: "line",
            source: ROUTE_SOURCE_ID,
            filter: isDrawn,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": lineColour as unknown as string,
                "line-width": route.width,
                "line-opacity": staleOpacity as unknown as number,
            },
        },
        {
            // Unsichtbar, aber abfragbar: MapLibre prüft Treffer gegen die Breite, nicht die Deckkraft.
            id: ROUTE_HIT_LAYER_ID,
            type: "line",
            source: ROUTE_SOURCE_ID,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": canonColour("route"),
                "line-width": hitWidth,
                "line-opacity": 0,
            },
        },
    ];
}

export function buildRouteMarkerLayer(): LayerSpecification {
    return {
        id: ROUTE_MARKER_LAYER_ID,
        type: "symbol",
        source: ROUTE_WAYPOINT_SOURCE_ID,
        layout: {
            "icon-image": ["get", "icon"],
            // Die Scheibe sitzt mittig auf dem Ort, der Tropfen mit seiner Spitze (Legacy).
            "icon-anchor": ["case", ["==", ["get", "icon"], ROUTE_DROP_IMAGE_ID], "bottom", "center"],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "symbol-sort-key": ["get", "order"],
        },
    };
}

/**
 * Die Marke eines Grenzübertritts (WI-0065 Z3 C): dieselbe Sprache wie die Scheibe des Wegpunkts - dunkler Rand, goldener
 * Ring, dunkles Auge -, kleiner, und im Körper Pergament statt Rot (Rot heißt Wegpunkt, Gold gewählt; Guide §17.4). Die
 * Maße stehen im Kanon (`route.crossingMarker`), die Farben unter `colour`; die Karte bleibt hell und bekommt keinen
 * Dunkelwert. Fest in Pixeln, bei jedem Zoom gleich, und in Blickrichtung des Betrachters ausgerichtet.
 */
export function buildRouteBorderLayers(): LayerSpecification[] {
    const size = route.crossingMarker;
    const common = { type: "circle", source: ROUTE_BORDER_SOURCE_ID } as const;
    return [
        {
            ...common,
            id: ROUTE_BORDER_LAYER_IDS[0],
            paint: { "circle-radius": size.rim, "circle-color": canonColour("markerWaypointCore") },
        },
        {
            ...common,
            id: ROUTE_BORDER_LAYER_IDS[1],
            paint: {
                "circle-radius": size.body,
                "circle-color": canonColour("markerCrossing"),
                "circle-stroke-width": size.ring,
                "circle-stroke-color": canonColour("markerWaypointRing"),
            },
        },
        {
            ...common,
            id: ROUTE_BORDER_LAYER_IDS[2],
            paint: {
                "circle-radius": size.eye,
                "circle-color": canonColour("markerWaypointCore"),
                "circle-stroke-width": size.ring / 2,
                "circle-stroke-color": canonColour("markerWaypointRing"),
            },
        },
    ];
}

/** Ein Querfeldein-Stück, wie die Pillen es zeichnen: die geglättete Linie in Renderkoordinaten. */
export interface OffroadShape {
    coordinates: Position[];
    selected: boolean;
    stale: boolean;
}

/** Die Querfeldein-Stücke der Route - dieselben Linien, die auch getroffen werden (`routeLineFeatures`). */
export function offroadShapes(data: RouteLayerData): OffroadShape[] {
    return routeLineFeatures(data)
        .features.filter((feature) => feature.properties.offroad)
        .map((feature) => ({
            coordinates: feature.geometry.coordinates,
            selected: feature.properties.selected,
            stale: feature.properties.stale,
        }));
}

/**
 * Hängt die Route an einen Stil: die Linien über Wegen und Kraftlinien, unter Ortsmarken und Namen -
 * Legacys Ebenen (Route 450, Orte 500) -, und die Wegpunktmarken. Der Pfeil des Playmodes ist eine
 * eigene Ebene darüber (`traveler-layer.ts`).
 */
export function withRoute(
    style: StyleSpecification,
    data: RouteLayerData,
    hitWidth: number = ROUTE_HIT_WIDTH.pointer,
): StyleSpecification {
    const sources = {
        ...style.sources,
        [ROUTE_SOURCE_ID]: { type: "geojson", data: routeLineFeatures(data) } as GeoJSONSourceSpecification,
        [ROUTE_WAYPOINT_SOURCE_ID]: {
            type: "geojson",
            data: routeWaypointFeatures(data),
        } as GeoJSONSourceSpecification,
        [ROUTE_BORDER_SOURCE_ID]: { type: "geojson", data: routeBorderFeatures(data) } as GeoJSONSourceSpecification,
    };
    const firstAbove = style.layers.findIndex((layer) => layer.type === "symbol" || layer.type === "circle");
    const at = firstAbove < 0 ? style.layers.length : firstAbove;
    const layers = [
        ...style.layers.slice(0, at),
        ...buildRouteLineLayers(hitWidth),
        ...style.layers.slice(at),
        // Die Übertrittsmarken unter den Wegpunkten: Wer beides sieht, sieht zuerst den Wegpunkt.
        ...buildRouteBorderLayers(),
        buildRouteMarkerLayer(),
    ];
    // 🪤 Jeder Stil nennt dieselbe Vorgabe. `setStyle` mit `diff` sieht so keine Änderung und lässt den
    // Wert stehen, den die Flugbahn gerade gesetzt hat.
    const state = { ...style.state, [ROUTE_FLIGHT_IN_SPACE]: { default: false } };
    return { ...style, sources, layers, state };
}

/** Tauscht nur die Daten - der Stil bleibt, wie er ist. */
export function updateRouteData(map: MapLibreMap, data: RouteLayerData): void {
    const lines = map.getSource(ROUTE_SOURCE_ID);
    const points = map.getSource(ROUTE_WAYPOINT_SOURCE_ID);
    const borders = map.getSource(ROUTE_BORDER_SOURCE_ID);
    if (borders && "setData" in borders && typeof borders.setData === "function") {
        borders.setData(routeBorderFeatures(data));
    }
    if (lines && "setData" in lines && typeof lines.setData === "function") lines.setData(routeLineFeatures(data));
    if (points && "setData" in points && typeof points.setData === "function") {
        points.setData(routeWaypointFeatures(data));
    }
}

/**
 * Der Pfeil der Reisenden, nach Norden zeigend: die Navigationsspitze aus der Vorlage des Betreibers
 * (2026-09-24), links hell, rechts dunkel, mit einem weißen Saum wie die Linie - sonst verschwände
 * er im Wald. Die Form ist an der Vorlage abgemessen: Die Flügel liegen 0,455 der Höhe neben der
 * Achse, die Kerbe 0,353 unter der Mitte.
 *
 * In Bronze metallisch (Betreiber 2026-09-24: „bronze metallisch“, nach Skizzen in Grün, Gold und
 * Bronze): Jede Hälfte hat einen Verlauf vom Scheitel zum Fuß, und ein feiner dunkler Rand trennt
 * den Pfeil von der goldenen Linie der laufenden Etappe, auf der er beim Abspielen meistens liegt.
 */
export function drawTravelerImage(pixelRatio = 2): ImageData {
    // In der großen Fassung gezeichnet; die Ebene verkleinert ihn je nach Zoom (`travelerScale`).
    // Saum und Rand wachsen mit, damit er verkleinert genau so aussieht wie in `travelerSize`.
    const halo = route.haloWidth * (route.travelerSizeClose / route.travelerSize);
    const size = (route.travelerSizeClose + 2 * halo) * pixelRatio;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(size);
    canvas.height = Math.ceil(size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Pfeil der Reisenden: kein 2D-Kontext");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    const scale = route.travelerSizeClose * pixelRatio;
    const tip: Position = [0, -0.5 * scale];
    const left: Position = [-0.455 * scale, 0.5 * scale];
    const right: Position = [0.455 * scale, 0.5 * scale];
    const notch: Position = [0, 0.353 * scale];
    const shape = (points: Position[]): Path2D => {
        const path = new Path2D();
        points.forEach(([x, y], index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
        path.closePath();
        return path;
    };
    const metal = (tipColour: string, baseColour: string): CanvasGradient => {
        const gradient = ctx.createLinearGradient(0, tip[1], 0, left[1]);
        gradient.addColorStop(0, canonColour(tipColour));
        gradient.addColorStop(1, canonColour(baseColour));
        return gradient;
    };
    const outline = shape([tip, right, notch, left]);
    ctx.lineJoin = "round";
    ctx.strokeStyle = canonColour("routeHalo");
    ctx.lineWidth = 2 * halo * pixelRatio;
    ctx.stroke(outline);
    ctx.fillStyle = metal("travelerLightTip", "travelerLightBase");
    ctx.fill(shape([tip, notch, left]));
    ctx.fillStyle = metal("travelerDarkTip", "travelerDarkBase");
    ctx.fill(shape([tip, right, notch]));
    ctx.strokeStyle = canonColour("travelerRim");
    ctx.lineWidth = (halo / 2) * pixelRatio;
    ctx.stroke(outline);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Die Wegpunktmarken als Bild für MapLibre (es nimmt für `icon-image` kein SVG).
 *
 * 🔴 **EINE Gestalt** (WI-0087 P6, Betreiber 2026-10-05: „übernimm doch nicht die bilder sondern direkt die symbole
 * von oben"): Formen und Maße stehen in `route-planner/waypoint-mark-shape.ts` und werden hier nur gerastert - dasselbe
 * Zeichen, das die Wegpunkteingabe und die Etappenliste als Inline-SVG zeigen. Die Farben kommen aus dem Kanon.
 *
 * 🪤 **Vorher stand hier eine zweite, von Hand gepflegte Fassung**, und sie war auseinandergelaufen: Sie zog um die
 * Füllung des Rings und um das Auge zusätzlich eine goldene Kontur (`markerWaypointRing`), die das SVG nie kannte.
 * Karte und Panel zeigten damit nicht dasselbe Zeichen. Die Kontur ist mit der Zusammenführung entfallen;
 * `markerWaypointRing` führt weiter die Marke des Grenzübertritts.
 *
 * `look` gilt nur für den Tropfen von „Was ist hier?“ (`map-pin-layer.ts`): `fill` ersetzt die Farbe der Füllung,
 * `innerLine` legt eine Kontur INNEN an den dunklen Rand (die Füllung wird um ihre Breite schmaler, das Außenmaß bleibt),
 * `head` ersetzt das Auge; es zeichnet in den Einheiten des viewBox, der Ursprung auf der Spitze, in der Farbe des Kerns.
 */
export function drawRouteMarkerImage(
    kind: "disc" | "drop",
    pixelRatio = 2,
    look: {
        fill?: string;
        innerLine?: { colour: string; width: number };
        head?: (ctx: CanvasRenderingContext2D, core: string) => void;
    } = {},
): ImageData {
    const { head } = look;
    const disc = kind === "disc";
    const width = (disc ? route.markerDisc : route.markerDropWidth) * pixelRatio;
    const height = (disc ? route.markerDisc : route.markerDropHeight) * pixelRatio;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width);
    canvas.height = Math.ceil(height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Wegpunktmarke: kein 2D-Kontext");
    const core = canonColour("markerWaypointCore");
    const fill = look.fill ?? canonColour("markerWaypoint");
    const circle = (radius: number, colour: string): void => {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
    };
    if (disc) {
        const shape = WAYPOINT_MARK.disc;
        ctx.scale(width / shape.units, height / shape.units);
        ctx.translate(shape.units / 2, shape.units / 2);
        circle(shape.core, core);
        circle(shape.fill, fill);
    } else {
        const shape = WAYPOINT_MARK.drop;
        // Die Spitze liegt genau auf der Unterkante des viewBox, dem Ankerpunkt auf der Karte.
        ctx.scale(width / shape.width, height / shape.height);
        ctx.translate(shape.width / 2, shape.height);
        ctx.fillStyle = core;
        ctx.fill(new Path2D(shape.outer));
        const inner = new Path2D(shape.inner);
        ctx.fillStyle = fill;
        ctx.fill(inner);
        if (look.innerLine !== undefined) {
            // Nur die innere Hälfte des Strichs steht: Er wird auf die Füllung geschnitten.
            ctx.save();
            ctx.clip(inner);
            ctx.strokeStyle = look.innerLine.colour;
            ctx.lineWidth = look.innerLine.width * 2;
            ctx.lineJoin = "round";
            ctx.stroke(inner);
            ctx.restore();
        }
        if (head !== undefined) {
            head(ctx, core);
            return ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
        ctx.translate(shape.eye.cx, shape.eye.cy);
    }
    circle(disc ? WAYPOINT_MARK.disc.eye : WAYPOINT_MARK.drop.eye.r, core);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
