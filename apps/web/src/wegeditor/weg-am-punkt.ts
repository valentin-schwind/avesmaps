import { editorPathGroupKey } from "@avesmaps3d/shared";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { WegAmPunkt } from "../editor-menu/handgriffe-weg";
import { PATH_HIT_LAYER_IDS } from "../map/path-layers";

/**
 * Der Abschnitt eines Wegs unter einem Kartenpunkt (WI-0177 W2), für den Rechtsklick: die Trefferflächen der Wege
 * (`PATH_HIT_LAYER_IDS`, so breit wie die der Route), oberster zuerst. Oben liegt, was man oben sieht (die Reichsstraße über dem Pfad);
 * die Ordnung kommt aus der Kartografie-Tafel, nicht von hier. Die Kennung ist die des Abschnitts (`public_id`, `promoteId` der Quelle).
 */
export function wegAm(map: MapLibreMap, lngLat: { lng: number; lat: number }): WegAmPunkt | undefined {
    return wegeAm(map, lngLat)[0];
}

/**
 * Alle Wege unter einem Kartenpunkt, oberster zuerst, je Straße einer (EDIT-0003 T25, „Hier laufen N Wege“): Treffen sich zwei
 * Abschnitte derselben Straße an einem Knoten, ist das EIN Weg (der obere Abschnitt); ein Weg ohne echten Namen ist sein Abschnitt. Ein
 * Weg ist sein Name, über Wegtypen und Kennzeichen hinweg (WI-0177 Schritt 2; `editorPathGroupKey`).
 */
export function wegeAm(map: MapLibreMap, lngLat: { lng: number; lat: number }): WegAmPunkt[] {
    const layers = PATH_HIT_LAYER_IDS.filter((id) => map.getLayer(id) !== undefined);
    if (layers.length === 0) return [];
    const raus: WegAmPunkt[] = [];
    const gesehen = new Set<string>();
    for (const feature of map.queryRenderedFeatures(map.project([lngLat.lng, lngLat.lat]), { layers })) {
        const p = feature.properties;
        const id =
            typeof p["public_id"] === "string" ? p["public_id"] : typeof feature.id === "string" ? feature.id : "";
        const subtype = typeof p["subtype"] === "string" ? p["subtype"] : "";
        if (id === "" || subtype === "") continue;
        const name = typeof p["name"] === "string" ? p["name"] : "";
        const strasse = editorPathGroupKey({ publicId: id, name, subtype });
        if (gesehen.has(strasse)) continue;
        gesehen.add(strasse);
        raus.push({ publicId: id, name, subtype, isBach: p["is_bach"] === true });
    }
    return raus;
}
