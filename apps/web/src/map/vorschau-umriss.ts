import type { FilterSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Outline } from "./area-lookup";

/**
 * Die gestrichelte Vorschau beim Zeigen (Fläche, See, Gebiet, Weg) als kleine eigene GeoJSON-Quelle, gefüllt aus den Kacheln, die
 * die Karte ohnehin geladen hat (WI-0266).
 *
 * 💣 **Warum nicht mehr per Feature-State an der Kachelquelle** (gemessen 2026-10-31 auf der Stage, 2560 × 1271 bei Pixelverhältnis 1,5):
 * Eine Ebene mit `line-opacity` aus dem Feature-State zeichnet MapLibre in JEDEM Bild ganz, auch mit Deckkraft 0 - es kann sie nicht
 * überspringen. Die drei Vorschau-Ebenen (Flächen, Wege, Seen) waren damit 58 bis 67 % aller gezeichneten Indizes; mit der Suche
 * „Wolf“ bei Zoom 2,3 kostete das Bild 74 ms auf der Grafikkarte, ohne sie 42 ms. In der Sprachen-Ansicht lud die Flächen-Vorschau
 * die Landschaftskacheln sogar nur für sich selbst. Ein Filter statt des Zustands geht auch nicht: Er lädt jede Kachel der Quelle neu
 * (Betreiber 2026-10-09: die Strichelung „läuft hinter allen Objekten her“), ebenso ein Wechsel der Sichtbarkeit (`_updateLayer`).
 *
 * Die Form kommt deshalb beim Zeigen aus `querySourceFeatures` und steht als Linien in einer eigenen Quelle. 🪤 Eine Kachel trägt ihre
 * Polygone samt Puffer über den Rand hinaus und dort beschnitten; als Linie gezeichnet, stünde jeder Schnitt als Strich im Bild, und
 * im Puffer lägen zwei Kacheln doppelt. Jede Linie wird darum auf das eigene Quadrat ihrer Kachel zugeschnitten (`linienInKachel`).
 */

/** Eine Kachelform, wie MapLibre sie bei `querySourceFeatures` liefert: die Rohform der Kachel und ihre Lage im Kachelgitter. */
interface KachelMerkmal {
    readonly properties: Readonly<Record<string, unknown>> | null;
    readonly geometry: { type: string; coordinates: unknown };
    /** 🪤 Innenleben von MapLibre (`GeoJSONFeature`, 6.10): die Form in Kachelpunkten und ihre Kachel. Fehlt es, gilt die Form wie geliefert. */
    readonly _vectorTileFeature?: { extent: number; loadGeometry(): { x: number; y: number }[][] };
    readonly _x?: number;
    readonly _y?: number;
    readonly _z?: number;
}

type Position = [number, number];

export interface Umriss {
    type: "FeatureCollection";
    features: {
        type: "Feature";
        properties: Record<string, unknown>;
        geometry: { type: "MultiLineString"; coordinates: Position[][] };
    }[];
}

export const KEIN_UMRISS: Umriss = { type: "FeatureCollection", features: [] };

/** Was eine Vorschau-Quelle trägt: Linien aus den Kacheln oder den Umriss vom Server. */
type UmrissDaten = Umriss | Outline;

/**
 * Was eine Vorschau aus den Kacheln liest: Quelle, Ebene darin, Filter und die Eigenschaften, die die Linie behält. Ein Filter als
 * Funktion wird bei jedem Lesen neu bestimmt (das Band der Gebiete folgt dem Zoom).
 */
export interface UmrissAbfrage {
    readonly source: string;
    readonly sourceLayer: string;
    readonly filter: FilterSpecification | (() => FilterSpecification);
    readonly behalte?: readonly string[];
}

/**
 * Zuschnitt einer Strecke auf das Quadrat `0 … e` (Liang-Barsky): die Anteile `[t0, t1]`, die darin liegen, oder `undefined`.
 */
function imQuadrat(ax: number, ay: number, bx: number, by: number, e: number): [number, number] | undefined {
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    for (const [p, q] of [
        [-dx, ax],
        [dx, e - ax],
        [-dy, ay],
        [dy, e - ay],
    ] as const) {
        if (p === 0) {
            if (q < 0) return undefined;
            continue;
        }
        const r = q / p;
        if (p < 0) {
            if (r > t1) return undefined;
            if (r > t0) t0 = r;
        } else {
            if (r < t0) return undefined;
            if (r < t1) t1 = r;
        }
    }
    return t0 < t1 ? [t0, t1] : undefined;
}

/**
 * Die Linien einer Kachelform, zugeschnitten auf das Quadrat ihrer Kachel (`0 … extent` in Kachelpunkten). Ringe sind geschlossen
 * (der letzte Punkt wiederholt den ersten) und werden wie Linien behandelt. Was außerhalb liegt - der Puffer samt Schnittkante -, fällt weg.
 */
export function linienInKachel(linien: readonly { x: number; y: number }[][], extent: number): Position[][] {
    const aus: Position[][] = [];
    for (const linie of linien) {
        let laufend: Position[] | undefined;
        for (let i = 0; i + 1 < linie.length; i++) {
            const a = linie[i]!;
            const b = linie[i + 1]!;
            const t = a.x === b.x && a.y === b.y ? undefined : imQuadrat(a.x, a.y, b.x, b.y, extent);
            if (t === undefined) {
                laufend = undefined;
                continue;
            }
            const [t0, t1] = t;
            const punkt = (s: number): Position => [a.x + s * (b.x - a.x), a.y + s * (b.y - a.y)];
            if (laufend === undefined || t0 > 0) {
                laufend = [punkt(t0)];
                aus.push(laufend);
            }
            laufend.push(punkt(t1));
            if (t1 < 1) laufend = undefined;
        }
    }
    return aus.filter((linie) => linie.length >= 2);
}

/** Kachelpunkte in Längen und Breiten, wie MapLibre selbst umrechnet (`GeoJSONFeature.projectPoint`). */
function nachLngLat(linie: Position[], z: number, x: number, y: number, extent: number): Position[] {
    const size = extent * 2 ** z;
    const x0 = extent * x;
    const y0 = extent * y;
    return linie.map(([px, py]) => [
        ((px + x0) * 360) / size - 180,
        (360 / Math.PI) * Math.atan(Math.exp((1 - ((py + y0) * 2) / size) * Math.PI)) - 90,
    ]);
}

/** Die Linien einer Form, wie sie geliefert wurde (ohne Kachel): Ringe als Linien. */
function linienDerForm(geometry: { type: string; coordinates: unknown }): Position[][] {
    switch (geometry.type) {
        case "LineString":
            return [geometry.coordinates as Position[]];
        case "MultiLineString":
        case "Polygon":
            return geometry.coordinates as Position[][];
        case "MultiPolygon":
            return (geometry.coordinates as Position[][][]).flat();
        default:
            return [];
    }
}

/** Die Vorschau aus Kachelformen: je Form ihre Linien im eigenen Kachelquadrat, mit den Eigenschaften aus `behalte`. */
export function umrissAusKacheln(merkmale: readonly KachelMerkmal[], behalte: readonly string[] = []): Umriss {
    const features: Umriss["features"] = [];
    for (const merkmal of merkmale) {
        const roh = merkmal._vectorTileFeature;
        const { _x: x, _y: y, _z: z } = merkmal;
        const coordinates =
            roh !== undefined && x !== undefined && y !== undefined && z !== undefined
                ? linienInKachel(roh.loadGeometry(), roh.extent).map((linie) => nachLngLat(linie, z, x, y, roh.extent))
                : linienDerForm(merkmal.geometry);
        if (coordinates.length === 0) continue;
        const properties: Record<string, unknown> = {};
        for (const name of behalte) properties[name] = merkmal.properties?.[name];
        features.push({ type: "Feature", properties, geometry: { type: "MultiLineString", coordinates } });
    }
    return { type: "FeatureCollection", features };
}

interface Gezeigt {
    abfrage: UmrissAbfrage | undefined;
    daten: UmrissDaten;
    quelle: GeoJSONSource | undefined;
    zug: number;
}

const gezeigt = new WeakMap<MapLibreMap, Map<string, Gezeigt>>();

/**
 * Zeigt in der Vorschau-Quelle `quelleId` die Form, die `abfrage` in den geladenen Kacheln findet; `undefined` leert sie. Die Form folgt
 * neuen Kacheln (Zoom, Verschieben) und einem neuen Stil, der die Quelle leert - beides einmal je Bild, und nur, solange etwas gezeigt wird.
 */
export function zeigeUmriss(map: MapLibreMap, quelleId: string, abfrage: UmrissAbfrage | undefined): void {
    let jeQuelle = gezeigt.get(map);
    if (jeQuelle === undefined) {
        jeQuelle = new Map();
        gezeigt.set(map, jeQuelle);
        installiereNachfuehren(map, jeQuelle);
    }
    const stand = jeQuelle.get(quelleId) ?? { abfrage: undefined, daten: KEIN_UMRISS, quelle: undefined, zug: 0 };
    stand.abfrage = abfrage;
    jeQuelle.set(quelleId, stand);
    lies(map, quelleId, stand);
}

/** Setzt eine Form, die nicht aus den Kacheln kommt (der Umriss vom Server, WI-0058); sie folgt keinen Kacheln. */
export function setzeUmriss(map: MapLibreMap, quelleId: string, daten: UmrissDaten): void {
    zeigeUmriss(map, quelleId, undefined);
    const stand = gezeigt.get(map)?.get(quelleId);
    if (stand === undefined) return;
    stand.daten = daten;
    stand.quelle?.setData(daten);
}

function lies(map: MapLibreMap, quelleId: string, stand: Gezeigt): void {
    const quelle = map.getSource(quelleId) as GeoJSONSource | undefined;
    stand.quelle = quelle;
    const abfrage = stand.abfrage;
    const daten =
        abfrage === undefined || quelle === undefined || map.getSource(abfrage.source) === undefined
            ? KEIN_UMRISS
            : umrissAusKacheln(
                  map.querySourceFeatures(abfrage.source, {
                      sourceLayer: abfrage.sourceLayer,
                      filter: typeof abfrage.filter === "function" ? abfrage.filter() : abfrage.filter,
                  }) as unknown as KachelMerkmal[],
                  abfrage.behalte,
              );
    if (daten === KEIN_UMRISS && stand.daten === KEIN_UMRISS) return;
    stand.daten = daten;
    quelle?.setData(daten);
}

function installiereNachfuehren(map: MapLibreMap, jeQuelle: Map<string, Gezeigt>): void {
    const plane = (quelleId: string, stand: Gezeigt): void => {
        if (stand.zug !== 0) return;
        stand.zug = requestAnimationFrame(() => {
            stand.zug = 0;
            lies(map, quelleId, stand);
        });
    };
    map.on("sourcedata", (event: { sourceId?: string; tile?: unknown }) => {
        if (event.tile === undefined) return;
        for (const [quelleId, stand] of jeQuelle) {
            if (stand.abfrage?.source === event.sourceId) plane(quelleId, stand);
        }
    });
    map.on("moveend", () => {
        for (const [quelleId, stand] of jeQuelle) if (stand.abfrage !== undefined) plane(quelleId, stand);
    });
    // Ein neuer Stil bringt die Quelle leer zurück (`setStyle` gleicht ihre Daten an die Beschreibung an): die gezeigte Form wieder hinein.
    map.on("styledata", () => {
        for (const [quelleId, stand] of jeQuelle) {
            const quelle = map.getSource(quelleId) as GeoJSONSource | undefined;
            if (stand.daten === KEIN_UMRISS || quelle === undefined) continue;
            if (quelle !== stand.quelle || quelle.serialize().data !== stand.daten) {
                stand.quelle = quelle;
                quelle.setData(stand.daten);
            }
        }
    });
}
