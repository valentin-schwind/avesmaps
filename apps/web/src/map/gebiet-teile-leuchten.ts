import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { DESIGN_CANON, canonColour } from "@avesmaps3d/shared";
import { renderPunkt } from "./leuchten-formen";

/**
 * Der Teil einer Gebietsfläche, der im Untermenü von „Unterpolygone löschen …“ gerade gezeigt wird (OPS-000075; Melder: „markierst die betroffenen
 * in dem augenblick rot“): Füllung und Kontur in Signalrot (`editEdge`, „Knallrot heißt: wird gerade bearbeitet“) auf weißem Saum. Zeigen oder
 * Fokus auf eine Zeile ruft `zeige` mit genau diesem Teil; ohne Teil (Untermenü zu, Zeiger weg) verschwindet alles.
 *
 * Gezeichnet wird aus dem, was der Server für das Menü las (`gebietseditor/gebiet-teile.ts`), nicht aus den Kacheln: Die Kachel der Gebiete trägt
 * die abgeleitete Form, und ein Teil, den die Ableitung noch nicht kennt oder schon verschluckt hat, ließe sich dort nicht zeigen. Eine eigene
 * GeoJSON-Quelle mit drei Ebenen, die nur während des Zeigens im Stil stehen (wie `flaechen-leuchten.ts`).
 */

const QUELLE = "gebiet-teile-quelle";
const EBENEN = { fuellung: "gebiet-teile-fuellung", saum: "gebiet-teile-saum", kontur: "gebiet-teile-kontur" } as const;

type Position = [number, number];
type Ring = readonly (readonly [number, number])[];

/** Die Daten der Quelle: höchstens ein Feature, ein Polygon in Renderkoordinaten. */
export interface TeilFeatures {
    type: "FeatureCollection";
    features: {
        type: "Feature";
        properties: Record<string, never>;
        geometry: { type: "Polygon"; coordinates: Position[][] };
    }[];
}

/** Das Polygon als GeoJSON in Renderkoordinaten (geschlossene Ringe, außen zuerst, dann die Löcher). */
export function teilAlsFeatures(polygon: readonly Ring[] | undefined): TeilFeatures {
    return {
        type: "FeatureCollection" as const,
        features:
            polygon === undefined || polygon.length === 0
                ? []
                : [
                      {
                          type: "Feature" as const,
                          properties: {},
                          geometry: {
                              type: "Polygon" as const,
                              coordinates: polygon.map((ring): Position[] => {
                                  const punkte = ring.map(([x, y]) => renderPunkt([x, y]));
                                  return punkte.length > 0 ? [...punkte, punkte[0]!] : punkte;
                              }),
                          },
                      },
                  ],
    };
}

function ebenen(): LayerSpecification[] {
    const look = DESIGN_CANON.mapSelection;
    return [
        {
            id: EBENEN.fuellung,
            type: "fill",
            source: QUELLE,
            paint: { "fill-color": canonColour("editEdge"), "fill-opacity": look.fillOpacity },
        },
        {
            id: EBENEN.saum,
            type: "line",
            source: QUELLE,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
                "line-color": canonColour("routeHalo"),
                // Der Saum ist doppelt so breit wie die Kontur und weich, beides aus der Linienbreite der Auswahl (Designkanon `mapSelection`).
                "line-width": look.lineWidth * 2,
                "line-blur": look.lineWidth / 2,
                "line-opacity": look.pathOpacity,
            },
        },
        {
            id: EBENEN.kontur,
            type: "line",
            source: QUELLE,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": canonColour("editEdge"), "line-width": look.lineWidth },
        },
    ];
}

export interface GebietTeileLeuchten {
    /** Lässt diesen Teil rot leuchten; `undefined` nimmt das Leuchten weg. */
    zeige(polygon: readonly Ring[] | undefined): void;
}

export function createGebietTeileLeuchten(karte: () => MapLibreMap | undefined): GebietTeileLeuchten {
    const weg = (map: MapLibreMap): void => {
        for (const id of Object.values(EBENEN)) if (map.getLayer(id) !== undefined) map.removeLayer(id);
        if (map.getSource(QUELLE) !== undefined) map.removeSource(QUELLE);
    };
    return {
        zeige(polygon) {
            const map = karte();
            if (map === undefined) return;
            if (polygon === undefined || polygon.length === 0) {
                weg(map);
                return;
            }
            const daten = teilAlsFeatures(polygon);
            const quelle = map.getSource(QUELLE) as GeoJSONSource | undefined;
            if (quelle === undefined) map.addSource(QUELLE, { type: "geojson", data: daten });
            else quelle.setData(daten);
            for (const ebene of ebenen()) if (map.getLayer(ebene.id) === undefined) map.addLayer(ebene);
        },
    };
}
