import {
    AREA_LOOKUP_LAYERS,
    AREA_LOOKUP_LIMITS,
    AREA_LOOKUP_URL,
    AREA_OUTLINE_URL,
    AVENTURIA,
    toRenderLngLat,
    type AreaAtResponse,
    type AreaLookupLayer,
    type AreaOutlineResponse,
    type MapPoint,
    type ViewComposition,
} from "@avesmaps3d/shared";

/**
 * Die Kartenauswahl fragt den Server, wo die Karte keine Landschaftsflächen zeichnet (WI-0058, Betreiber
 * 2026-09-28: Landschaftsflächen „nur bei Bedarf“ laden). Heute sind das die Höhenstufen der Topographie: Dort
 * färbt die Höhe das Land, und die Landschaftskacheln (443 KB in der Übersicht) luden nur fürs Anklicken.
 *
 * 🔴 Wo Flächen gezeichnet werden, bleibt die Auswahl bei den Kacheln (sofort, ohne Anfrage). Eine Regel für
 * beide Wege: Reihenfolge und Namen rechnen `areaCandidates` und `riverCandidates` aus denselben Feldern.
 */

type Position = [number, number];
type OutlineGeometry =
    { type: "Polygon"; coordinates: Position[][] } | { type: "MultiPolygon"; coordinates: Position[][][] };

/** Umrisse in Renderkoordinaten, fertig für eine GeoJSON-Quelle der Karte. */
export interface Outline {
    type: "FeatureCollection";
    features: {
        type: "Feature";
        properties: { region_public_id: string; region_type: string };
        geometry: OutlineGeometry;
    }[];
}

/** Was die Auswahl vom Server braucht: die Ebenen der Ansicht und ob Seen mitzählen. */
export interface AreaLookup {
    layers: AreaLookupLayer[];
    lakes: boolean;
    /** See und Meer so geglättet, wie die Topographie sie zeigt. */
    smooth: boolean;
}

/**
 * Zeichnet die Karte in dieser Ansicht Landschaftsflächen? In den Höhenstufen nicht, sobald das geglättete
 * Wasser da ist (`place-layers.ts`, WI-0055): Dann färbt die Höhe das Land.
 */
export function drawsLandscapeFills(composition: ViewComposition, water: boolean): boolean {
    return !(water && composition.heightTints);
}

/** Fragt die Auswahl hier den Server? Nur, wo die Ansicht Landschaftsebenen hat, aber keine Flächen zeichnet. */
export function usesServerAreaLookup(composition: ViewComposition, water: boolean): boolean {
    return composition.landscapeLayers.length > 0 && !drawsLandscapeFills(composition, water);
}

/** Die Abfrage selbst: Ebenen der Ansicht, Seen, Glättung; `undefined`, wo die Kacheln genügen. */
export function serverAreaLookup(composition: ViewComposition, water: boolean, lakes: boolean): AreaLookup | undefined {
    if (!usesServerAreaLookup(composition, water)) return undefined;
    const layers = composition.landscapeLayers.filter((layer): layer is AreaLookupLayer =>
        (AREA_LOOKUP_LAYERS as readonly string[]).includes(layer),
    );
    return layers.length > 0 ? { layers, lakes, smooth: water } : undefined;
}

/** Die letzten Antworten: Zeigen und Klicken fragen oft dieselbe Stelle, und der Server soll das nicht spüren. */
class Recent<T> {
    readonly #entries = new Map<string, T>();
    readonly #size: number;
    constructor(size: number) {
        this.#size = size;
    }
    get(key: string): T | undefined {
        const value = this.#entries.get(key);
        if (value !== undefined) {
            this.#entries.delete(key);
            this.#entries.set(key, value);
        }
        return value;
    }
    set(key: string, value: T): void {
        this.#entries.delete(key);
        this.#entries.set(key, value);
        if (this.#entries.size > this.#size) this.#entries.delete(this.#entries.keys().next().value as string);
    }
}

const areasCache = new Recent<AreaAtResponse["areas"]>(64);
const outlineCache = new Recent<Outline>(32);

/**
 * Die Kachelrevision der Karte (`map.changed`), mit der Auswahl und Umrisse fragen (WI-0178 B3; EDIT-0004 §6): Nach einer Änderung an
 * einer Landschaft und nach ihrem Runden ist die Adresse neu, und weder dieser Speicher noch der des Browsers liefert die Fläche von
 * vorher. 0, solange niemand etwas geändert hat; dann fragt die Adresse ohne `r`, wie bisher.
 */
let revision: () => number = () => 0;

/** Die Karte nennt einmal, woher die Revision kommt (`editRevision` in `app.vue`). */
export function useAreaRevision(current: () => number): void {
    revision = current;
}

function withRevision(query: URLSearchParams): URLSearchParams {
    const r = revision();
    if (Number.isInteger(r) && r > 0) query.set("r", String(r));
    return query;
}

/** Auf ein Tausendstel E gerundet (unter einem Bildpunkt bis Zoom 10): gleiche Stelle, gleiche Adresse, Cache. */
const round = (value: number): string => value.toFixed(3);

/** Die Flächen unter dem Punkt, als Zeilen mit denselben Feldern wie die Kacheln. */
export async function fetchAreasAt(
    point: MapPoint,
    lookup: AreaLookup,
    signal?: AbortSignal,
): Promise<AreaAtResponse["areas"]> {
    const query = withRevision(
        new URLSearchParams({
            x: round(Math.min(1024, Math.max(0, point.x))),
            y: round(Math.min(1024, Math.max(0, point.y))),
            layers: lookup.layers.join(","),
            lakes: String(lookup.lakes),
        }),
    );
    const url = `${AREA_LOOKUP_URL}?${query.toString()}`;
    const known = areasCache.get(url);
    if (known) return known;
    const response = await fetch(url, signal ? { signal } : {});
    if (!response.ok) throw new Error(`Flächenabfrage: HTTP ${String(response.status)}`);
    const { areas } = (await response.json()) as AreaAtResponse;
    areasCache.set(url, areas);
    return areas;
}

/** Die Zoomstufe, für die ein Umriss geholt wird: eine Stufe feiner als das Bild, damit Heranzoomen reicht. */
export function outlineZoom(zoom: number): number {
    return Math.min(AREA_LOOKUP_LIMITS.outlineZoomMax, Math.max(0, Math.ceil(zoom) + 1));
}

const space = AVENTURIA.coordinateSpace;

function toRender(ring: Position[]): Position[] {
    return ring.map(([x, y]) => {
        const { lng, lat } = toRenderLngLat(space, { x, y });
        return [lng, lat];
    });
}

/** Die Umrisse der Regionen `ids` in Renderkoordinaten, fertig für eine GeoJSON-Quelle der Karte. */
export async function fetchOutline(
    ids: readonly string[],
    zoom: number,
    smooth: boolean,
    signal?: AbortSignal,
): Promise<Outline> {
    signal?.throwIfAborted();
    const query = withRevision(
        new URLSearchParams({
            ids: [...ids].slice(0, AREA_LOOKUP_LIMITS.outlineIds).join(","),
            z: String(outlineZoom(zoom)),
            ...(smooth ? { smooth: "true" } : {}),
        }),
    );
    const url = `${AREA_OUTLINE_URL}?${query.toString()}`;
    const known = outlineCache.get(url);
    if (known) return known;
    const response = await fetch(url, signal ? { signal } : {});
    if (!response.ok) throw new Error(`Umrissabfrage: HTTP ${String(response.status)}`);
    const body = (await response.json()) as AreaOutlineResponse;
    signal?.throwIfAborted();
    const collection: Outline = {
        type: "FeatureCollection",
        features: body.features.map((feature) => ({
            type: "Feature",
            properties: feature.properties,
            geometry:
                feature.geometry.type === "Polygon"
                    ? { type: "Polygon", coordinates: (feature.geometry.coordinates as Position[][]).map(toRender) }
                    : {
                          type: "MultiPolygon",
                          coordinates: (feature.geometry.coordinates as Position[][][]).map((polygon) =>
                              polygon.map(toRender),
                          ),
                      },
        })),
    };
    outlineCache.set(url, collection);
    return collection;
}

/** Eine leere Sammlung: Vorschau ohne Fläche. */
export const NO_OUTLINE: Outline = { type: "FeatureCollection", features: [] };
