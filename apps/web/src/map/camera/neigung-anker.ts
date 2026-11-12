/**
 * Die Neigung kippt um den Punkt, an dem man zoomt (WI-0016; Betreiber 2026-11-09: „das zoomtarget bleibt und verschiebt sich nicht
 * immer weiter vor, sondern die kamera neigt sich so, dass auch bei der zielneigung und höchste zoomstufe noch im mittelpunkt ist“).
 *
 * MapLibre hält beim Zoomen den Ort unter dem Zeiger fest; danach neigt der Haken in `camera.ts` (`neigungBeimZoom`). Eine Neigung
 * dreht um die Bildmitte, der Ort unter dem Zeiger wanderte so mit jedem Schritt Richtung Horizont (gemessen 2026-11-09: 307 Bildpunkte
 * von Zoom 4 bis 9,5, bei fester Neigung 0). Hier kommt er nach dem Neigen an seine Stelle zurück, wie MapLibre es beim Zoomen tut:
 * Ort des Geländes unter dem Ankerpunkt, auf seiner Höhe (`setLocationAtPoint`).
 *
 * 🪤 Liegt der Anker nicht auf der Karte (Himmel) oder fast auf Augenhöhe, kippt die Neigung um die Bildmitte, wie MapLibre in diesem
 * Fall auch zoomt (`_resolveAround`, `_terrainGestureElevation`).
 */

export interface Bildpunkt {
    x: number;
    y: number;
}

/** Der Teil von MapLibres Transformation, den der Haken bekommt (`setTransformCameraUpdate`, eine Kopie des gewünschten Stands). */
export interface AnkerTransform<Ort> {
    readonly center: Ort;
    readonly elevation?: number;
    clone(): AnkerTransform<Ort>;
    setPitch(pitch: number): void;
    setLocationAtPoint(ort: Ort, punkt: Bildpunkt, hoehe?: number): void;
    screenPointToLocation(punkt: Bildpunkt): Ort | undefined;
    screenTerrainPointToMercatorCoordinate?(punkt: Bildpunkt, gelaende: unknown): { z: number; toLngLat(): Ort } | null;
    isPointOnMapSurface?(punkt: Bildpunkt, gelaende?: unknown): boolean;
    getCameraAltitude?(): number;
}

/** Ab diesem Anteil der Augenhöhe über der Mitte ist ein Ankerpunkt zu nah am Auge (MapLibres TERRAIN_ANCHOR_MAX_CAMERA_ALTITUDE_FRACTION). */
const ZU_NAH_AM_AUGE = 0.9;

/** Der Ort unter dem Ankerpunkt, mit seiner Höhe, wenn MapLibre auf ihr rechnet. */
export interface AnkerOrt<Ort> {
    ort: Ort;
    hoehe: number | undefined;
}

/** Was unter `anker` liegt; `undefined`: kein Anker, Anker im Himmel oder eine Attrappe ohne Transformation. */
export function ortUnterAnker<Ort>(
    tr: Partial<AnkerTransform<Ort>>,
    anker: Bildpunkt | undefined,
    gelaende?: unknown,
): AnkerOrt<Ort> | undefined {
    if (anker === undefined || typeof tr.clone !== "function" || typeof tr.screenPointToLocation !== "function")
        return undefined;
    const voll = tr as AnkerTransform<Ort>;
    let ort: Ort | undefined;
    let hoehe: number | undefined;
    if (gelaende && typeof voll.screenTerrainPointToMercatorCoordinate === "function") {
        const treffer = voll.screenTerrainPointToMercatorCoordinate(anker, gelaende);
        if (!treffer) return undefined;
        const mitte = voll.elevation ?? 0;
        const auge = voll.getCameraAltitude?.();
        // Zu nah am Auge rechnet MapLibre auf der Höhe der Mitte; dann hier auch.
        if (auge === undefined || treffer.z - mitte < ZU_NAH_AM_AUGE * (auge - mitte)) {
            ort = treffer.toLngLat();
            hoehe = treffer.z;
        } else ort = voll.screenPointToLocation(anker);
    } else {
        if (voll.isPointOnMapSurface?.(anker) === false) return undefined;
        ort = voll.screenPointToLocation(anker);
    }
    return ort === undefined ? undefined : { ort, hoehe };
}

/** Die Mitte, bei der `ziel` nach dem Neigen von `tr` auf `neigung` unter `anker` steht. `tr` selbst bleibt, wie es ist. */
export function mitteFuer<Ort>(tr: AnkerTransform<Ort>, neigung: number, ziel: AnkerOrt<Ort>, anker: Bildpunkt): Ort {
    const neu = tr.clone();
    // Kamera-Sprung erlaubt (gesture): keiner - eine Kopie der Transformation, gerechnet für den Haken der laufenden Geste.
    neu.setPitch(neigung);
    neu.setLocationAtPoint(ziel.ort, anker, ziel.hoehe);
    return neu.center;
}

/**
 * Die Mitte, bei der der Ort unter `anker` nach dem Neigen auf `neigung` an derselben Stelle im Bild steht; `undefined`: um die
 * Bildmitte kippen (kein Anker, Anker im Himmel, Attrappe ohne Transformation).
 */
export function mitteUmAnker<Ort>(
    tr: Partial<AnkerTransform<Ort>>,
    neigung: number,
    anker: Bildpunkt | undefined,
    gelaende?: unknown,
): Ort | undefined {
    const ziel = ortUnterAnker(tr, anker, gelaende);
    return ziel === undefined || anker === undefined
        ? undefined
        : mitteFuer(tr as AnkerTransform<Ort>, neigung, ziel, anker);
}
