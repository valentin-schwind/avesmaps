import type { MapOptions } from "maplibre-gl";
import { clampPitch, normalizeBearing, NORTH_SNAP, PITCH_CEILING } from "./camera-math";

/**
 * Die Kameraoptionen der Karte (WI-0016). `app.vue` baut die Karte, die Kamera-Regeln stehen hier.
 *
 * - Drehen und Neigen per Touch sind MapLibres Zwei-Finger-Gesten (Spez. § 4).
 * - Mit der Maus dreht und neigt `pointer-controls.ts`; MapLibres `dragRotate` bleibt aus, weil er die
 *   rechte Taste belegt (D1).
 * - 🔴 Die Neigungsgrenze nach Zoom (D3) gilt für JEDE Bewegung: Gesten, Fahrten, Tasten und Links.
 *   `transformCameraUpdate` läuft vor jeder Kameraänderung; zoomt man mit starker Neigung heraus,
 *   wird die Neigung dabei sanft mitgeführt, statt am Ende zu springen.
 */
export function cameraMapOptions(initial: {
    zoom: number;
    bearing?: number | undefined;
    pitch?: number | undefined;
}): Partial<MapOptions> {
    return {
        bearing: normalizeBearing(initial.bearing ?? 0),
        pitch: clampPitch(initial.pitch ?? 0, initial.zoom),
        maxPitch: PITCH_CEILING,
        dragRotate: false,
        pitchWithRotate: false,
        rollEnabled: false,
        bearingSnap: NORTH_SNAP,
        touchZoomRotate: true,
        touchPitch: true,
        // Die Tasten gehören der Tastaturtafel (`keyboard/`): sie wirkt ohne Kartenfokus, und MapLibres
        // eigene Tastatur machte jeden Schritt doppelt.
        keyboard: false,
        transformCameraUpdate: ({ pitch, zoom }) => ({ pitch: clampPitch(pitch, zoom) }),
    };
}
