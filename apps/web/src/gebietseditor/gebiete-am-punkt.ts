import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import { areaCandidates, type AreaCandidate } from "../map/area-candidates";
import { TERRITORY_CLAIM_LAYER_ID, TERRITORY_FILL_LAYER_ID } from "../map/territory-layers";

/**
 * Welche Herrschaftsgebiete an einer Stelle der Karte Klicks annehmen (WI-0209 Paket A4; EDIT-0003 T23 Frage 2, T25; EDIT-0005 §3
 * „Ebene der Karte“): die Gebiete, die die Karte im Band ihres Zooms dort ZEIGT, kleinste zuerst. In Band 2 ist das die Provinz oder das
 * Reich, in Band 6 die Baronie; ein Gebiet, das dieses Band nicht zeigt, nimmt hier nichts an.
 *
 * 🔴 Gezeichnet, nicht nur in der Kachel: Die Kachel trägt alle Bänder ab ihrem Zoom, der Stil zeichnet nur das der Ansicht
 * (`inBand`). Darum fragt das nur die gezeichneten Ebenen, wie der Linksklick (`area-selection-input.ts`, Füllung und Schraffur, die das
 * Gebiet darunter trägt). Wo die Ansicht keine Gebiete zeichnet, gibt es keine.
 */
export const GEBIET_EBENEN: readonly string[] = [TERRITORY_FILL_LAYER_ID, TERRITORY_CLAIM_LAYER_ID];

/** Die Gebiete aus schon gefragten Merkmalen (der Doppelklick bekommt sie vom Koordinator), je Gebiet einmal, kleinste zuerst. */
export function gebieteAus(features: readonly Pick<MapGeoJSONFeature, "properties">[]): AreaCandidate[] {
    return areaCandidates(features).filter((kandidat) => kandidat.kind === "territory");
}

/** Die Gebiete unter einem Punkt der Karte (Kartenmenü), wie ein Klick sie nähme. */
export function gebieteAm(map: MapLibreMap, lngLat: { lng: number; lat: number }): AreaCandidate[] {
    const layers = GEBIET_EBENEN.filter((id) => map.getLayer(id) !== undefined);
    if (layers.length === 0) return [];
    return gebieteAus(map.queryRenderedFeatures(map.project([lngLat.lng, lngLat.lat]), { layers }));
}
