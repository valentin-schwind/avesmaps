import { AVENTURIA, DESIGN_CANON } from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";

/**
 * Die Rechnung der Maßstabsleiste (WI-0096), ohne Browser und ohne MapLibre.
 *
 * Legacy zeigte eine FESTE Meilenzahl aus einer Tafel je ganzer Zoomstufe und ändert nur die Breite
 * (Finding MCS-029: `MAP_SCALE_BAND_MILES_BY_ZOOM = [100, 100, 100, 100, 10, 10, 10]`, Zeilenzugriff über
 * `Math.round(map.getZoom())`, neu gerechnet nur bei `zoomend`). Diese Tafel setzt Leaflets Rasten auf
 * ganze Stufen voraus (`zoomSnap: 1`). 🔴 **Unser Zoom rastet nicht** — MapLibre kennt kein `zoomSnap`,
 * Rad und Pinch liefern beliebige Fließkommawerte. Eine Tafel je Stufe gibt es hier also nicht.
 *
 * Deshalb die umgekehrte Regel: **die Breite ist gedeckelt, die Zahl folgt.** Gesucht ist die größte
 * schöne Zahl, die noch in den Deckel passt. Das ist dieselbe Mechanik, die jede Karte mit stufenlosem
 * Zoom benutzt, und sie flackert nicht: Zwischen zwei schönen Zahlen wächst nur die Breite, die ZAHL
 * wechselt erst an einer Sprosse der Leiter — über eine ganze Zoomstufe genau einmal.
 *
 * 🔴 Der Umrechnungsfaktor kommt aus der EINEN Quelle (`config/map-domains/aventuria.json`,
 * `coordinateSpace.distance`), nicht aus dem Reisemodell: Eine Maßstabsleiste misst Raum, keine Reise
 * (`map-domain.ts`, Kap. 5.2.2). Gerechnet wird in Schritt, weil das die kleinere der beiden Einheiten
 * des Raums ist; die Anzeige wechselt bei 1.000 Schritt auf Meilen.
 */

const SPACE = AVENTURIA.coordinateSpace;

/**
 * Schritt je Meile, aus dem Koordinatenraum abgeleitet statt gesetzt: 3.000 Schritt und 3 Meilen je
 * Karteneinheit ergeben 1.000. Steht nirgends als eigene Zahl.
 */
export const SCHRITT_PER_MILE = SPACE.distance.schrittPerUnit / SPACE.distance.milesPerUnit;

/**
 * Die Leiter der schönen Zahlen: 1, 2 und 5 je Zehnerpotenz. 🪤 Der größte Sprung der Leiter ist 2 → 5,
 * also Faktor 2,5 — daraus folgt die Mindestbreite der Leiste (siehe {@link MIN_WIDTH_SHARE}).
 */
const LADDER = [1, 2, 5] as const;

/** Der größte Sprung der Leiter (2 → 5). */
const LARGEST_STEP = 5 / 2;

/**
 * Die Leiste wird nie schmaler als dieser Anteil ihres Deckels — das ist keine gesetzte Schranke,
 * sondern die Folge der Leiter: Wer die größte schöne Zahl unter dem Deckel nimmt, liegt höchstens um
 * den größten Sprung darunter.
 */
export const MIN_WIDTH_SHARE = 1 / LARGEST_STEP;

/**
 * Der Deckel der Breite in Bildpunkten. Abgeleitet aus `control.labelWidth` des Kanons (130) — die eine
 * Zahl, die dort sagt, wie breit ein beschriftetes Stück Bedienelement sein darf. Keine neue Zahl.
 */
export const MAX_WIDTH = DESIGN_CANON.control.labelWidth;

/**
 * Höchstens dieser Anteil der freien Kartenbreite. 🪤 Am Telefon (360 px, davon rund 336 px frei) ist
 * `MAX_WIDTH` schon der kleinere Wert; die Regel greift erst unter rund 325 px freier Breite und hält
 * die Leiste dann aus dem Weg. Derselbe Anteil, mit dem die sichtbare Fläche eine Seitenleiste von einem
 * deckenden Panel unterscheidet (`SIDEBAR_SHARE`, `map/camera/visible-area.ts`) — abgeleitet, nicht neu.
 */
export const MAX_WIDTH_SHARE = 0.4;

export interface ScaleReading {
    /** Die gezeigte Länge in Schritt — immer eine Sprosse der Leiter. */
    schritt: number;
    /** Die Breite der Leiste in Bildpunkten, auf ganze Punkte gerundet wie in Legacy. */
    width: number;
    /** Die Einheit, in der die Zahl unter der Leiste steht. */
    unit: "miles" | "schritt";
    /** Die Zahl selbst, in dieser Einheit. */
    value: number;
}

/** Die größte Sprosse der Leiter, die `limit` nicht überschreitet; `undefined` unter einem Schritt. */
export function niceSchritt(limit: number): number | undefined {
    if (!Number.isFinite(limit) || limit < 1) return undefined;
    const decade = Math.floor(Math.log10(limit));
    for (let power = decade + 1; power >= 0; power -= 1) {
        const base = 10 ** power;
        for (let index = LADDER.length - 1; index >= 0; index -= 1) {
            const rung = LADDER[index];
            if (rung !== undefined && rung * base <= limit) return rung * base;
        }
    }
    return undefined;
}

/**
 * Die Leiste für einen gemessenen Maßstab.
 *
 * @param schrittPerPixel wie viele Schritt Karte auf einen Bildpunkt gehen, an der Zeile der Leiste gemessen
 * @param maxWidth der Deckel der Breite in Bildpunkten (siehe {@link scaleBarMaxWidth})
 */
export function readScale(schrittPerPixel: number, maxWidth: number = MAX_WIDTH): ScaleReading | undefined {
    if (!(schrittPerPixel > 0) || !Number.isFinite(schrittPerPixel) || !(maxWidth >= 1)) return undefined;
    const schritt = niceSchritt(schrittPerPixel * maxWidth);
    if (schritt === undefined) return undefined;
    const width = Math.round(schritt / schrittPerPixel);
    return schritt >= SCHRITT_PER_MILE
        ? { schritt, width, unit: "miles", value: schritt / SCHRITT_PER_MILE }
        : { schritt, width, unit: "schritt", value: schritt };
}

/** Der Deckel der Breite für eine freie Kartenbreite: der Kanonwert, am Telefon die 40 % davon. */
export function scaleBarMaxWidth(freeWidth: number): number {
    if (!Number.isFinite(freeWidth) || freeWidth <= 0) return MAX_WIDTH;
    return Math.min(MAX_WIDTH, Math.floor(freeWidth * MAX_WIDTH_SHARE));
}

/**
 * Die Beschriftung der Leiste: Meilen, unter einer Meile Schritt. „1 Meile“ steht in der Einzahl (WI-0129 R2: auf Stufe 8 zeigt die
 * Leiste am Rechner eine Meile, dort stand „1 Meilen“). Die Leiter kennt nur ganze Meilen, also gilt die Einzahl nur für die 1.
 */
export function scaleLabel(reading: ScaleReading): string {
    const amount = formatNumber(reading.value, 0);
    if (reading.unit === "schritt") return t("scale.schritt", { n: amount });
    return reading.value === 1 ? t("scale.mile", { n: amount }) : t("unit.miles", { n: amount });
}
