import type { CurvePoint } from "./catmull-rom.ts";

/**
 * Die gezeichnete Bahn einer Kraftlinie (WI-0025) — Legacys Rechnung, Ziffer für Ziffer.
 *
 * Quelle: `js/map-features/powerline-topology.js` (avesmaps@770c80e, Entwurf
 * `2026-08-29-kraftlinien-kurvenform-design.md`). Eine Kraftlinie liegt als Strecke zwischen zwei
 * Knoten; ihre „Kurvenform" `curve` ist ein Versatz entlang der Normalen der Sehne, als PARABEL
 * 4·h·t·(1−t) mit dem Scheitel h = curve % der Sehne (Owner-Entscheid 29.08.2026, bewusst kein
 * Kreisbogen).
 *
 * 🔴 DIES IST DARSTELLUNG, NICHT GEOMETRIE. Die fachliche Aussage einer Kraftlinie ist „verbindet
 * Knoten A mit Knoten B, mit diesem Bogen"; was hier entsteht, ist die abgeleitete Bahn, die die
 * Karte zeichnet. Sie wird bei jedem Import neu gerechnet und nie redaktionell bearbeitet.
 *
 * 💣 KEINE ZWEITE FORMEL. Legacy hat vier Erzeuger derselben Kurve (Stränge, Klicklinie,
 * Namenslinie, Editor-Vorschau) auf eine Rechnung gezwungen: „Eine Regel, die einen von vier
 * Erzeugern bindet, ist keine Regel." Bei uns ist diese Datei die eine Rechnung. Die Reihenfolge der
 * Rechenschritte ist Legacys, damit auch die letzte Nachkommastelle dieselbe ist.
 */

/** Der Wert ist ein Prozentsatz der Sehne, nie Karteneinheiten. Legacy klemmt auf ±45. */
export const POWERLINE_CURVE_MAX = 45;

/** Stützpunkte bei vollem Ausschlag (`AVESMAPS_POWERLINE_CURVE_STEPS_MAX`). */
export const POWERLINE_CURVE_STEPS_MAX = 24;

/**
 * Legacys Grundzahl der Stützpunkte (`POWERLINE_RENDER_CONFIG.segmentCount`, js/config.js).
 *
 * 🪤 Als EVIDENZ übernommen: sie steht in Legacy in der Animationstafel, und ein Regler
 * (`?powerlinetune=1`) kann sie dort verstellen. Die ausgelieferte Zahl ist 8.
 */
export const LEGACY_POWERLINE_SEGMENT_COUNT = 8;

/** Geklemmt auf ±45; alles, was keine endliche Zahl ist, heißt gerade (Legacy `Number(curve)`). */
export function clampPowerlineCurve(curve: unknown): number {
    const zahl = Number(curve);
    if (!Number.isFinite(zahl)) {
        return 0;
    }
    return Math.max(-POWERLINE_CURVE_MAX, Math.min(POWERLINE_CURVE_MAX, zahl));
}

/**
 * Die kanonische Richtung: West → Ost, bei gleichem x Süd → Nord.
 *
 * 🔴 Das Vorzeichen hängt an der GEOMETRIE, nicht an der Speicherrichtung `from → to`. In Legacy
 * lassen sich die Knoten im Editor umsortieren, und dabei tauschen Segmente ihre Richtung; an
 * `from → to` gebunden klappte jeder Bogen still auf die andere Seite.
 */
export function powerlineCurveSign(ax: number, ay: number, bx: number, by: number): 1 | -1 {
    if (bx !== ax) {
        return bx > ax ? 1 : -1;
    }
    return by >= ay ? 1 : -1;
}

/**
 * Der vorzeichenrichtige Normalenversatz an der Stelle t (0..1 entlang der Sehne), in
 * Karteneinheiten, entlang n = (−ty, tx).
 */
export function powerlineCurveNormalOffset(
    curve: unknown,
    t: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): number {
    const c = clampPowerlineCurve(curve);
    if (c === 0) {
        return 0;
    }
    const dx = bx - ax;
    const dy = by - ay;
    const sehne = Math.sqrt(dx * dx + dy * dy);
    // 🪤 Fängt auch eine unbrauchbare Koordinate ab: NaN > 0 ist falsch, und ein NaN wanderte sonst in
    // die Geometrie.
    if (!(sehne > 0)) {
        return 0;
    }
    const h = (c / 100) * sehne;
    return 4 * h * t * (1 - t) * powerlineCurveSign(ax, ay, bx, by);
}

/**
 * Wie viele Stützpunkte ein Segment braucht. `curve = 0` ergibt EXAKT die Grundzahl; ein voller
 * Ausschlag 24. Eine hochgedrehte Grundzahl wird nie nach unten gezogen.
 */
export function powerlineCurveSteps(curve: unknown, basis: number = LEGACY_POWERLINE_SEGMENT_COUNT): number {
    const grund = Math.max(2, Math.round(Number(basis) || LEGACY_POWERLINE_SEGMENT_COUNT));
    const staerke = Math.abs(clampPowerlineCurve(curve)) / POWERLINE_CURVE_MAX;
    if (staerke === 0) {
        return grund;
    }
    const ziel = Math.max(grund, POWERLINE_CURVE_STEPS_MAX);
    return Math.round(grund + staerke * (ziel - grund));
}

/** Die gebogene Bahn zwischen zwei Punkten: `steps + 1` Punkte, erster und letzter auf den Enden. */
export function powerlineCurvedPoints(a: CurvePoint, b: CurvePoint, curve: unknown, steps: number): CurvePoint[] {
    const n = Math.max(1, Math.round(Number(steps) || 1));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const sehne = Math.sqrt(dx * dx + dy * dy);
    const tx = sehne > 0 ? dx / sehne : 0;
    const ty = sehne > 0 ? dy / sehne : 0;
    const nx = -ty;
    const ny = tx;
    const punkte: CurvePoint[] = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const off = powerlineCurveNormalOffset(curve, t, a.x, a.y, b.x, b.y);
        punkte.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off });
    }
    return punkte;
}

/**
 * Die Bahn, die die Karte zeichnet (Legacy `getPowerlineCurvedLatLngs`).
 *
 * Ohne Bogen ist sie die Linie selbst — Legacy gibt dann die Punkte unverändert zurück, bei einer
 * Kraftlinie also genau ihre zwei Enden. Mit Bogen zählen nur erster und letzter Punkt.
 */
export function powerlineDrawnPath(points: readonly CurvePoint[], curve: unknown): CurvePoint[] {
    const c = clampPowerlineCurve(curve);
    const first = points[0];
    const last = points[points.length - 1];
    if (points.length < 2 || c === 0 || !first || !last) {
        return points.map((punkt) => ({ x: punkt.x, y: punkt.y }));
    }
    return powerlineCurvedPoints(first, last, c, powerlineCurveSteps(c));
}
