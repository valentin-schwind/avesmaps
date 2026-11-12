import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, toRenderLngLat } from "@avesmaps3d/shared";

/**
 * Ein Gipfel der Gipfelliste auf der Karte hervorgehoben (WI-0178 P5, Fassung 16: „Hover hebt auf der Karte hervor“): ein Ring um sein
 * ▲, solange die Zeile überfahren oder fokussiert ist. Eine eigene kleine Quelle über allem, ohne Treffer (der Ring nimmt keinen Klick);
 * ein Stilwechsel nimmt sie mit, sie kommt mit `styledata` wieder (wie `map/entwurfs-flaechen.ts`).
 */
export const GIPFEL_RING_QUELLE = "editor-gipfel-ring";
export const GIPFEL_RING_EBENE = "editor-gipfel-ring";

export interface GipfelHervorhebung {
    /** Den Ring an diese Lage (Kartenkoordinaten) setzen; `undefined` nimmt ihn weg. */
    zeige(lage: readonly [number, number] | undefined): void;
    entferne(): void;
}

export function installGipfelHervorhebung(map: MapLibreMap, farbe: string): GipfelHervorhebung {
    const space = AVENTURIA.coordinateSpace;
    let lage: readonly [number, number] | undefined;

    const daten = () => ({
        type: "FeatureCollection" as const,
        features:
            lage === undefined
                ? []
                : [
                      {
                          type: "Feature" as const,
                          properties: {},
                          geometry: {
                              type: "Point" as const,
                              coordinates: (({ lng, lat }) => [lng, lat])(
                                  toRenderLngLat(space, { x: lage[0], y: lage[1] }),
                              ),
                          },
                      },
                  ],
    });

    // Nur auf den Stil warten, nicht auf alle Kacheln (wie `map/entwurfs-flaechen.ts`).
    const anlegen = (mitDaten: boolean): void => {
        try {
            zeichne(mitDaten);
        } catch {
            map.once("styledata", () => anlegen(mitDaten));
        }
    };
    const zeichne = (mitDaten: boolean): void => {
        const quelle = map.getSource(GIPFEL_RING_QUELLE) as GeoJSONSource | undefined;
        if (quelle === undefined) map.addSource(GIPFEL_RING_QUELLE, { type: "geojson", data: daten() });
        else if (mitDaten) quelle.setData(daten());
        if (map.getLayer(GIPFEL_RING_EBENE) === undefined)
            map.addLayer({
                id: GIPFEL_RING_EBENE,
                type: "circle",
                source: GIPFEL_RING_QUELLE,
                paint: {
                    "circle-radius": 13,
                    "circle-color": "rgba(0, 0, 0, 0)",
                    "circle-stroke-color": farbe,
                    "circle-stroke-width": 2.5,
                },
            });
    };

    const nachStil = (): void => anlegen(false);
    map.on("styledata", nachStil);

    return {
        zeige(neu) {
            if (neu === undefined && lage === undefined) return;
            lage = neu;
            anlegen(true);
        },
        entferne() {
            map.off("styledata", nachStil);
            lage = undefined;
            if (map.getLayer(GIPFEL_RING_EBENE)) map.removeLayer(GIPFEL_RING_EBENE);
            if (map.getSource(GIPFEL_RING_QUELLE)) map.removeSource(GIPFEL_RING_QUELLE);
        },
    };
}
