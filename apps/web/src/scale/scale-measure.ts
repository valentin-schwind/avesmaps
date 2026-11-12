import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, distanceInUnits, fromRenderLngLat } from "@avesmaps3d/shared";

/**
 * Den Maßstab an einer Bildzeile messen (WI-0096).
 *
 * 🔴 **Gemessen, nicht gerechnet.** `2^(zoom-1)` Bildpunkte je Karteneinheit (`zoom-bands.ts`) gilt nur
 * für die ungeneigte Kamera. Geneigt ist der Grund am unteren Bildrand näher an der Kamera als am oberen,
 * der Maßstab also über das Bild hinweg verschieden — eine Leiste, die ihre Breite aus dem Zoom rechnet,
 * wäre dort überall falsch außer auf einer Zeile. Legacy hatte das Problem nicht (`L.CRS.Simple`, keine
 * Neigung, kein Mercator) und misst trotzdem: `map.latLngToContainerPoint` (Finding MCS-029).
 *
 * Gemessen wird deshalb an der Zeile, auf der die Leiste wirklich steht, über ihre eigene Spanne:
 * `unproject` auf beiden Enden, zurück in den Koordinatenraum, Abstand in Karteneinheiten. Beide Punkte
 * liegen auf derselben Bildzeile, die Perspektive bildet eine Gerade auf eine Gerade ab — der Quotient
 * ist der mittlere Maßstab über genau dieser Strecke.
 *
 * 🪤 Nahe am Horizont läuft `unproject` ins Unendliche. Die Leiste steht am UNTEREN Rand, also auf dem
 * kameranächsten Grund; trotzdem prüft jede Messung ihr Ergebnis, statt eine NaN-Breite ins Stilblatt zu
 * schreiben.
 */

const SPACE = AVENTURIA.coordinateSpace;

/**
 * Wie viele Schritt Karte auf einen Bildpunkt gehen — gemessen an der Stelle, an der die Leiste steht.
 *
 * @param at linke Kante der Leiste in Bildpunkten, relativ zum Canvas
 * @param y die Bildzeile der Leiste
 * @param span die Spanne, über die gemessen wird (die Breite, die die Leiste höchstens einnimmt)
 */
export function measureSchrittPerPixel(map: MapLibreMap, at: number, y: number, span: number): number | undefined {
    if (!(span > 0)) return undefined;
    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    if (!(width > 0)) return undefined;
    const row = Math.min(Math.max(y, 0), canvas.clientHeight);
    const left = Math.max(0, Math.min(width - span, at));
    try {
        const from = fromRenderLngLat(SPACE, map.unproject([left, row]));
        const to = fromRenderLngLat(SPACE, map.unproject([left + span, row]));
        const units = distanceInUnits(from, to);
        if (!Number.isFinite(units) || units <= 0) return undefined;
        return (units * SPACE.distance.schrittPerUnit) / span;
    } catch {
        // Eine Kamera, die noch nicht steht, ist kein Fehler - die nächste Messung kommt im nächsten Bild.
        return undefined;
    }
}
