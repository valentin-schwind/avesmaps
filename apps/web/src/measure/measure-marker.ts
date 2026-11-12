import { Marker, type Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, toRenderLngLat } from "@avesmaps3d/shared";
import { h, render } from "vue";
import MeasureValue from "./measure-value.vue";
import { measureMidpoint, measureText, type Measurement } from "./measure-state";

/**
 * Die Wertkapsel an ihrer Stelle auf der Karte (WI-0095).
 *
 * 🔴 **Ein MapLibre-Marker trägt sie**, wie bei den Namensschildern der Grenzübertritte
 * (`map/route-border-labels.ts`): Er folgt Kamera, Neigung UND Gelände selbst. Eine eigene Rechnung mit
 * `map.project` je Bild kennt die Höhe des Geländes nicht - auf der geneigten Karte stünde die Kapsel dann
 * neben ihrer Linie. Deshalb ist das die eine Stelle, an der Legacys Leaflet-Marker bei uns ein
 * MapLibre-Marker wird.
 *
 * Sie sitzt MITTEN auf der Strecke (Anker `center`), wie Legacys `labelLatLng` am arithmetischen Mittel.
 */

const space = AVENTURIA.coordinateSpace;

export interface MeasureMarker {
    /** Die Kapsel an die Mitte der Messung setzen, oder mit `undefined` wegnehmen. */
    show(measurement: Measurement | undefined): void;
    destroy(): void;
}

export function createMeasureMarker(map: MapLibreMap): MeasureMarker {
    const element = document.createElement("div");
    // Der Marker ist ein Punkt ohne Ausdehnung; die Kapsel hängt an ihm und wird selbst nicht angefasst.
    element.style.pointerEvents = "none";
    let marker: Marker | undefined;

    const clear = (): void => {
        marker?.remove();
        marker = undefined;
        render(null, element);
    };

    return {
        show(measurement) {
            const at = measureMidpoint(measurement);
            const text = measureText(measurement);
            if (at === undefined || text === undefined) {
                clear();
                return;
            }
            render(h(MeasureValue, { text }), element);
            const { lng, lat } = toRenderLngLat(space, at);
            marker ??= new Marker({ element, anchor: "center" }).setLngLat([lng, lat]).addTo(map);
            marker.setLngLat([lng, lat]);
        },
        destroy: clear,
    };
}
