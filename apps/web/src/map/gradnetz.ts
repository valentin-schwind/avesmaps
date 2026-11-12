import type { ExpressionSpecification, GeoJSONSourceSpecification, LineLayerSpecification } from "maplibre-gl";
import { AVENTURIA, GRADNETZ_STUFEN, canonColour, gradnetzLinien, toRenderLngLat } from "@avesmaps3d/shared";

/**
 * Die Linien des Gradnetzes (WI-0273, OPS-069; Auge › Ebenen › Gradnetz). Die Rechnung steht in `@avesmaps3d/shared`
 * (`gradnetz.ts`), den Rahmen mit der Gradleiste zeichnet `gradnetz-rahmen.ts`.
 *
 * Je Stufe eine Ebene mit eigenem `minzoom`: Der Ebenenzoom gilt stufenlos, `["zoom"]` im Filter dagegen nur am ganzen
 * Kachelzoom. Eine Linie steht ab ihrer gröbsten Stufe, blendet dort ein und wird zur Hauptlinie, sobald die nächste,
 * feinere Stufe erscheint. Sie liegen über den Flächen und unter den Wegen, wie die Höhenlinien einer topographischen Karte.
 */
export const GRADNETZ_SOURCE_ID = "gradnetz";
export const GRADNETZ_LAYER_PREFIX = "gradnetz-";

const EINBLENDEN = 0.25;
// Kräftiger als im Entwurf: Über dem dunklen Wald der modernen Serie verschwinden feinere Linien.
const NEBEN = { deckkraft: 0.6, breite: 1 };
const HAUPT = { deckkraft: 0.85, breite: 1.5 };

export function buildGradnetzSource(): GeoJSONSourceSpecification {
    const punkt = (p: { x: number; y: number }): [number, number] => {
        const at = toRenderLngLat(AVENTURIA.coordinateSpace, p);
        return [at.lng, at.lat];
    };
    return {
        type: "geojson",
        data: {
            type: "FeatureCollection",
            features: gradnetzLinien().map((linie) => ({
                type: "Feature" as const,
                properties: { stufe: linie.stufe },
                geometry: { type: "LineString" as const, coordinates: [punkt(linie.von), punkt(linie.bis)] },
            })),
        },
    };
}

/** Wert je Zoom: unsichtbar bis zum Erscheinen, dann Nebenlinie, ab der nächsten Stufe Hauptlinie. */
function verlauf(
    ein: number,
    naechste: number | undefined,
    wert: (s: typeof NEBEN) => number,
): number | ExpressionSpecification {
    const stopps: number[] = ein > 0 ? [ein, 0, ein + EINBLENDEN, wert(NEBEN)] : [];
    if (naechste !== undefined) stopps.push(naechste, wert(NEBEN), naechste + EINBLENDEN, wert(HAUPT));
    return stopps.length === 0
        ? wert(NEBEN)
        : (["interpolate", ["linear"], ["zoom"], ...stopps] as ExpressionSpecification);
}

export function buildGradnetzLayers(): LineLayerSpecification[] {
    const tinte = canonColour("text");
    return GRADNETZ_STUFEN.map((stufe, index) => {
        const naechste = GRADNETZ_STUFEN[index + 1]?.abZoom;
        return {
            id: `${GRADNETZ_LAYER_PREFIX}${String(index)}`,
            type: "line",
            source: GRADNETZ_SOURCE_ID,
            ...(stufe.abZoom > 0 ? { minzoom: stufe.abZoom } : {}),
            filter: ["==", ["get", "stufe"], index],
            layout: { "line-cap": "butt" },
            paint: {
                "line-color": tinte,
                "line-opacity": verlauf(stufe.abZoom, naechste, (s) => s.deckkraft),
                "line-width": verlauf(stufe.abZoom, naechste, (s) => s.breite),
            },
        };
    });
}
