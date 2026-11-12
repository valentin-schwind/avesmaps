import type { Map as MapLibreMap } from "maplibre-gl";
import { drawFlowArrowImage, FLOW_ARROW_IMAGE_ID } from "./path-layers";
import {
    APPROXIMATE_BADGE_IMAGE_ID,
    APPROXIMATE_BADGE_STRUCTURE_IMAGE_ID,
    APPROXIMATE_BADGE_STRUCTURE_UNOFFICIAL_IMAGE_ID,
    APPROXIMATE_BADGE_UNOFFICIAL_IMAGE_ID,
    drawApproximateBadgeImage,
    drawMarkerCollisionImage,
    drawStructureMarkerImage,
    PLACE_COLLISION_IMAGE_ID,
    STRUCTURE_HAIRLINE_IMAGE_ID,
    STRUCTURE_MARKER_ACTIVE_IMAGE_ID,
    STRUCTURE_MARKER_IMAGE_ID,
    STRUCTURE_MARKER_UNOFFICIAL_IMAGE_ID,
} from "./place-layers";
import { drawMapPinImage, MAP_PIN_IMAGE_ID } from "./map-pin-layer";
import { drawRouteMarkerImage, ROUTE_DISC_IMAGE_ID, ROUTE_DROP_IMAGE_ID } from "./route-layers";
import { drawPeakTriangleImage, PEAK_TRIANGLE_IMAGE_ID } from "./topography-layers";
import { ARTEN_MIT_BILD, drawLandmarkenZeichen, landmarkenBildId } from "./landmarken-zeichen";
import { drawGefahrMuster, GEFAHR_MUSTER } from "./gefahr-schicht";

/** Ein Bild, das die Karte zur Laufzeit zeichnet: sein Name im Stil und wie es entsteht. */
export type RuntimeImage = readonly [id: string, draw: () => ImageData];

/**
 * Die Laufzeitbilder: das Dreieck der Strömungspfeile (V11), die Rauten der Bauwerke (WI-0011), die durchsichtige
 * Sperrfläche der Ortsmarkierungen (WI-0135), die Routenmarker, der Tropfen von „Was ist hier?“, das Dreieck der Gipfel und je Landmarkenart
 * ihr Zeichen (WI-0271 L5, `landmarken-zeichen.ts`).
 */
export const RUNTIME_IMAGES: readonly RuntimeImage[] = [
    [FLOW_ARROW_IMAGE_ID, (): ImageData => drawFlowArrowImage()],
    [STRUCTURE_MARKER_IMAGE_ID, (): ImageData => drawStructureMarkerImage()],
    [STRUCTURE_MARKER_UNOFFICIAL_IMAGE_ID, (): ImageData => drawStructureMarkerImage(2, "inoffiziell")],
    [STRUCTURE_HAIRLINE_IMAGE_ID, (): ImageData => drawStructureMarkerImage(2, "haarlinie")],
    [STRUCTURE_MARKER_ACTIVE_IMAGE_ID, (): ImageData => drawStructureMarkerImage(2, "aktiv")],
    [PLACE_COLLISION_IMAGE_ID, (): ImageData => drawMarkerCollisionImage()],
    // Das Fragezeichen der ungefähren Lage (WI-0267), je Farbe der Marke.
    [APPROXIMATE_BADGE_IMAGE_ID, (): ImageData => drawApproximateBadgeImage(2, "siedlung")],
    [APPROXIMATE_BADGE_STRUCTURE_IMAGE_ID, (): ImageData => drawApproximateBadgeImage(2, "bauwerk")],
    [APPROXIMATE_BADGE_UNOFFICIAL_IMAGE_ID, (): ImageData => drawApproximateBadgeImage(2, "siedlung", true)],
    [APPROXIMATE_BADGE_STRUCTURE_UNOFFICIAL_IMAGE_ID, (): ImageData => drawApproximateBadgeImage(2, "bauwerk", true)],
    [ROUTE_DISC_IMAGE_ID, (): ImageData => drawRouteMarkerImage("disc")],
    [ROUTE_DROP_IMAGE_ID, (): ImageData => drawRouteMarkerImage("drop")],
    [MAP_PIN_IMAGE_ID, (): ImageData => drawMapPinImage()],
    [PEAK_TRIANGLE_IMAGE_ID, (): ImageData => drawPeakTriangleImage()],
    // Die Striche der gefährlichen Gebiete (WI-0308, `gefahr-schicht.ts`).
    [GEFAHR_MUSTER, (): ImageData => drawGefahrMuster()],
    ...ARTEN_MIT_BILD.map((art): RuntimeImage => [landmarkenBildId(art), (): ImageData => drawLandmarkenZeichen(art)]),
];

/**
 * Meldet die Laufzeitbilder beim Renderer an, die dem Stil noch fehlen.
 *
 * 💣 MapLibre kennt keine Formen. Fehlt das Bild, zeichnet die Symbolebene NICHTS und meldet höchstens eine Warnung
 * in der Konsole - kein Fehler, keine leere Stelle, einfach keine Pfeile. Deshalb wird es angemeldet, BEVOR die Ebene
 * es braucht, und bei jedem Stilwechsel erneut: ein neuer Stil bringt seine eigene Bildsammlung mit. `addImage`
 * braucht dafür keinen fertig geladenen Stil.
 *
 * 🪤 MapLibre meldet jedes neue Bild mit `styledata`, und was ein Zuhörer dort wirft, kommt bei `addImage` an.
 * „Nicht angemeldet“ heißt deshalb nur: Das Bild fehlt danach wirklich (2026-10-04: siebenmal gemeldet, obwohl jedes
 * Bild stand; geworfen hatte die Ebene der Reisenden, `style-ready.ts`).
 */
export function registerRuntimeImages(map: MapLibreMap, images: readonly RuntimeImage[] = RUNTIME_IMAGES): void {
    for (const [id, draw] of images) {
        if (map.hasImage(id)) {
            continue;
        }
        try {
            map.addImage(id, draw(), { pixelRatio: 2 });
        } catch (error) {
            if (map.hasImage(id)) {
                console.error(`Laufzeitbild ${id} angemeldet, ein styledata-Zuhörer warf danach`, error);
            } else {
                console.error(`Laufzeitbild ${id} nicht angemeldet`, error);
            }
        }
    }
}
