import type { Map as MapLibreMap } from "maplibre-gl";

/** Markierung am Transform, damit derselbe nicht zweimal geklemmt wird. */
const GEKLEMMT = "__avesmapsHorizonFix";

/**
 * Trefferabfragen über dem Horizont retten (WI-0142, MapLibre-Issue
 * [#2994](https://github.com/maplibre/maplibre-gl-js/issues/2994), offen seit 2023, vom Maintainer bestätigt).
 *
 * 💣 **Der Fehler.** Vor jeder Trefferabfrage rechnet MapLibre einen Maßstabsfaktor aus der **oberen linken Bildecke**:
 *
 * ```js
 * maxPitchScaleFactor() {
 *     const coord = this.screenPointToMercatorCoordinate(new Point(0, 0));
 *     …
 *     return transformMat4(p, p, this._pixelMatrix)[3] / cameraToCenterDistance;
 * }
 * ```
 *
 * Liegt diese Ecke über dem Horizont, trifft ihr Strahl den Boden nicht; die Rückrechnung kippt hinter die Kamera, und
 * der Faktor wird NEGATIV (gemessen mit MapLibres Sichtfeld von 36,87°: 71° → +31,3, 72° → −38,6, 80° → −1,1). In
 * `SourceCache.tilesIn` erweitert er den Suchbereich jeder Kachel (`tileSpaceBounds.expandBy(…)`) - negativ schrumpft er
 * ihn, bis keine Kachel mehr übrig ist. Ergebnis: kein Treffer mehr auf Ortskreise (`circle`) und Wege (`line`), egal
 * wohin man klickt. Beschriftungen und Bauwerke überleben, weil Symbole über den Platzierungsindex laufen.
 *
 * ⭐ **Die Rettung.** Der Faktor darf nie unter 1 fallen - 1 heißt „kein zusätzlicher Puffer", so verhält sich die
 * Abfrage auch flach. Gemessen am nackten MapLibre: mit der Klemmung treffen Punkt- und Kastenabfragen wieder bis 85°.
 *
 * 🪤 **Die Abfrage ÜBER DAS GANZE BILD** (`queryRenderedFeatures()` ohne Punkt) bleibt kaputt, weil dort die Bildecken
 * selbst die Suchgeometrie sind. Beim Klicken fragt niemand so (`interaction/coordinator.ts` nimmt immer einen Punkt
 * oder einen kleinen Kasten); wer es doch tut, muss über dem Horizont mit Lücken rechnen.
 *
 * 🪤 **Der Transform wird ausgetauscht**, sobald Gelände dazukommt oder der Stil wechselt. Der Eingriff hängt deshalb
 * nicht an einem Objekt, sondern wird bei jeder Bewegung und jedem Stilereignis nachgezogen - die Markierung hält ihn
 * billig. Findet sich kein Transform (andere MapLibre-Version, umbenannt), passiert nichts, und
 * `e2e/camera-horizont.spec.ts` wird rot.
 */
export function installHorizonQueryFix(map: MapLibreMap): void {
    const klemmen = (): void => {
        const transform = (map as unknown as { painter?: { transform?: Record<string, unknown> } }).painter?.transform;
        if (!transform || transform[GEKLEMMT] === true) return;
        const original = transform["maxPitchScaleFactor"];
        if (typeof original !== "function") return;
        const gebunden = original.bind(transform) as () => number;
        transform["maxPitchScaleFactor"] = (): number => {
            const wert = gebunden();
            return Number.isFinite(wert) && wert > 1 ? wert : 1;
        };
        transform[GEKLEMMT] = true;
    };
    klemmen();
    map.on("move", klemmen);
    map.on("styledata", klemmen);
    map.on("terrain", klemmen);
}
