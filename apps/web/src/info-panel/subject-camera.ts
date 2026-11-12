import {
    AVENTURIA,
    PLACE_ZOOM_FLOOR,
    FLY_MAX_BAND,
    SEARCH_FIT_MAX_ZOOM,
    renderZoomForBand,
    toRenderLngLat,
    type MapBounds,
    type SubjectRef,
    type SubjectTarget,
} from "@avesmaps3d/shared";
import type { Camera } from "../map/camera/camera";
import { territoryBandLead } from "../map/territory-band";

/**
 * Wohin die Kamera fliegt, wenn ein Subject geöffnet wird und nicht von der Karte kam (Objektlink, Planer; WI-0063 4.6).
 *
 * 🔴 Nur über `camera.ts`, nur fliegen: Die Absicht ist dieselbe wie bei der Suche - ein Punkt in die sichtbare Mitte, heran nur
 * bis zur Mindestnähe und nie heraus; ein Umriss wird eingepasst. Das Ziel kommt aus `detail.target` (Server, `aventuria-v1`);
 * die Umrechnung in Renderkoordinaten geschieht hier, an derselben Stelle wie für die Suche (ADR-0003).
 */

const space = AVENTURIA.coordinateSpace;

const renderPosition = (point: { x: number; y: number }): [number, number] => {
    const lngLat = toRenderLngLat(space, point);
    return [lngLat.lng, lngLat.lat];
};

/** Ein Ausschnitt in Kartenkoordinaten als Grenzen in Renderkoordinaten: Südwest, Nordost. */
function renderBox([minX, minY, maxX, maxY]: MapBounds): [[number, number], [number, number]] {
    const a = toRenderLngLat(space, { x: minX, y: minY });
    const b = toRenderLngLat(space, { x: maxX, y: maxY });
    return [
        [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat)],
        [Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)],
    ];
}

export function flyToSubject(
    camera: Pick<Camera, "showPoint" | "showBounds" | "showView">,
    ref: SubjectRef,
    target: SubjectTarget | undefined,
): void {
    // Eine Kartenstelle hat kein Ziel in der Antwort: Sie liegt, wo man hinzeigte (Legacy `?pin`: Zoom mindestens 4,
    // bei uns eine Stufe mehr).
    if (ref.kind === "mapPoint") {
        camera.showPoint(renderPosition(ref), renderZoomForBand(PLACE_ZOOM_FLOOR));
        return;
    }
    if (target === undefined) return;
    const center = renderPosition(target);
    switch (ref.kind) {
        case "place":
        case "peak":
            camera.showPoint(center, target.zoom);
            return;
        case "area":
            if (target.bounds === undefined) camera.showView(center, target.zoom);
            else camera.showBounds(renderBox(target.bounds), { maxZoom: SEARCH_FIT_MAX_ZOOM.landschaft });
            return;
        case "path":
            if (target.bounds === undefined) camera.showView(center, target.zoom);
            else camera.showBounds(renderBox(target.bounds), { maxZoom: SEARCH_FIT_MAX_ZOOM.weg });
            return;
        case "powerline":
            if (target.bounds === undefined) camera.showView(center, target.zoom);
            // Höchstens Stufe 7 (WI-0129 R2): Eine kurze Linie füllte sonst Stufe 8 aus.
            else camera.showBounds(renderBox(target.bounds), { maxZoom: renderZoomForBand(FLY_MAX_BAND) });
            return;
        case "climate":
            // Wie der Sprung der Suche zu einer Klimazone (`jumpTo`): ein Band reicht von Rand zu Rand, es bleibt bei seiner Mitte und ihrem Zoom.
            camera.showView(center, target.zoom);
            return;
        case "territory":
            // Wie ein Gebiet aus dem Planer (`showTerritory`): das Band, in dem es als Fläche vor einem liegt.
            camera.showView(center, target.zoom - territoryBandLead() + 0.5);
            return;
        case "sprache":
            // Die Hülle der Teile, die zusammen 85 % der Fläche tragen (WI-0261 S5b, Bauvorlage `hauptBBox`); höchstens so nah wie eine Landschaft.
            if (target.bounds === undefined) camera.showView(center, target.zoom);
            else camera.showBounds(renderBox(target.bounds), { maxZoom: SEARCH_FIT_MAX_ZOOM.landschaft });
            return;
        case "wetterSymbol":
            // Ein Wetter-Icon (WI-0288): seine Reichweite eingepasst, höchstens so nah wie eine Landschaft.
            if (target.bounds === undefined) camera.showView(center, target.zoom);
            else camera.showBounds(renderBox(target.bounds), { maxZoom: SEARCH_FIT_MAX_ZOOM.landschaft });
            return;
        default:
            return;
    }
}
