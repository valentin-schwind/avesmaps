import type { EditorGebirge, EditorLandscapePeak } from "@avesmaps3d/shared";
import type { VorschauErgebnis } from "../gebirge-vorschau/auftrag";

/**
 * Das Bild der Gebirge-Vorschau (WI-0178 P6; Fassung 16, `vorschauBild`): Höhe je Zelle aus dem Worker (WI-0226) → Schummerung und
 * Tönung, Norden oben, außerhalb der Fläche durchsichtig (so steht sie auf der Karte nur im Umriss). Rein bis auf `alsDatenUrl`, das eine
 * Leinwand braucht.
 *
 * 🪤 Überhöht wird NUR die Schummerung (Fassung 16, abgenommen): Ein Gebirge mit 500 Schritt Kammhöhe wäre sonst fast eben, und alle
 * Typen sähen gleich aus. Der Faktor macht die höchste Stelle so schattig wie 4.000 Schritt; Höhen und Tönung bleiben maßstäblich, und
 * der Satz unter der Vorschau nennt den Faktor.
 */

/** Ab dieser Höhe tönt die Vorschau ganz hell; darunter wächst die Tönung mit der Höhe. */
const TOENUNG_MIN = 1500;
/** So schattig wie ein Gebirge dieser Höhe (Fassung 16). */
const SCHATTEN_WIE = 4000;
/** Schritt je Karteneinheit (`SCHRITT_JE_EINHEIT`, `packages/shared/src/gebirge/constants.ts`). */
const SCHRITT_JE_EINHEIT = 3000;

export interface VorschauPixel {
    readonly breite: number;
    readonly hoehe: number;
    readonly rgba: Uint8ClampedArray<ArrayBuffer>;
    /** Wie stark die Schummerung überhöht ist (1 = gar nicht). */
    readonly ueberhoehung: number;
    /** Die Höhe der hellsten Tönung in Schritt: die höchste Stelle der Fläche, mindestens `TOENUNG_MIN` (Ende der Höhenskala). */
    readonly hoechste: number;
}

/** Die Tönung eines Höhenanteils (0 … 1 von `hoechste`), ohne Schummerung: auch die Farben der Höhenskala unter der Vorschau. */
export function toenung(anteil: number): readonly [number, number, number] {
    return anteil < 0.5
        ? [150 + 120 * anteil, 160 + 40 * anteil, 110 + 20 * anteil]
        : [210 + 70 * (anteil - 0.5), 180 + 110 * (anteil - 0.5), 120 + 230 * (anteil - 0.5)];
}

/** Die höchste Stelle in der Fläche in Schritt (der Satz unter der Vorschau); 0 ohne Zelle. */
export function hoechsteStelle(r: VorschauErgebnis): number {
    let hoechste = 0;
    for (let i = 0; i < r.h.length; i++) if (r.eigen[i] === 1 && r.h[i]! > hoechste) hoechste = r.h[i]!;
    return hoechste;
}

/** Die Pixel der Vorschau: Zeile 0 ist der Norden (die Rechnung zählt vom Süden). */
export function vorschauPixel(r: VorschauErgebnis, hoechsteFest?: number): VorschauPixel {
    const rgba = new Uint8ClampedArray(r.w * r.hh * 4);
    // Ein Ausschnitt tönt wie das ganze Bild darunter (`hoechsteFest`), sonst passten die Farben am Rand nicht.
    let hoechste = hoechsteFest ?? TOENUNG_MIN;
    if (hoechsteFest === undefined)
        for (let i = 0; i < r.h.length; i++) if (r.eigen[i] === 1 && r.h[i]! > hoechste) hoechste = r.h[i]!;
    const ueberhoehung = Math.min(8, Math.max(1, SCHATTEN_WIE / hoechste));
    const zs = (r.cell * SCHRITT_JE_EINHEIT) / ueberhoehung;
    const licht = [-1, -1, 1.2] as const;
    const lichtLaenge = Math.hypot(...licht);
    const h = (i: number, j: number): number =>
        r.h[Math.max(0, Math.min(r.hh - 1, j)) * r.w + Math.max(0, Math.min(r.w - 1, i))]!;
    for (let j = 0; j < r.hh; j++)
        for (let i = 0; i < r.w; i++) {
            const k = j * r.w + i;
            const o = ((r.hh - 1 - j) * r.w + i) * 4;
            if (r.eigen[k] !== 1) continue;
            const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * zs);
            const dyNord = (h(i, j + 1) - h(i, j - 1)) / (2 * zs);
            const schatten = Math.max(
                0,
                (-dx * licht[0] + dyNord * licht[1] + licht[2]) / (Math.hypot(dx, dyNord, 1) * lichtLaenge),
            );
            const anteil = Math.min(1, Math.max(0, r.h[k]! / hoechste));
            const ton = toenung(anteil);
            const f = 0.3 + 0.9 * schatten;
            rgba[o] = ton[0]! * f;
            rgba[o + 1] = ton[1]! * f;
            rgba[o + 2] = ton[2]! * f;
            rgba[o + 3] = 255;
        }
    return { breite: r.w, hoehe: r.hh, rgba, ueberhoehung, hoechste };
}

/** Die vier Ecken des Bilds in Kartenkoordinaten (oben links, oben rechts, unten rechts, unten links), je eine halbe Zelle nach außen. */
export function vorschauEcken(
    r: VorschauErgebnis,
): [[number, number], [number, number], [number, number], [number, number]] {
    const links = r.bounds.min_x - r.cell / 2;
    const unten = r.bounds.min_y - r.cell / 2;
    const rechts = links + r.w * r.cell;
    const oben = unten + r.hh * r.cell;
    return [
        [links, oben],
        [rechts, oben],
        [rechts, unten],
        [links, unten],
    ];
}

/** Die Eingabe der Vorschau mit den Gipfelhöhen des Entwurfs (P5): ein Gipfel der Eingabe ist der des Gebirges an derselben Stelle. */
export function eingabeMitGipfeln(
    eingabe: EditorGebirge["eingabe"],
    peaks: readonly EditorLandscapePeak[],
    hoehen: Readonly<Record<string, number>>,
): EditorGebirge["eingabe"] {
    if (Object.keys(hoehen).length === 0) return eingabe;
    const nah = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
    return {
        ...eingabe,
        peaks: eingabe.peaks.map((peak) => {
            const gipfel = peaks.find((p) => nah(p.position[0], peak.x) && nah(p.position[1], peak.y));
            const hoehe = gipfel === undefined ? undefined : hoehen[gipfel.id];
            return hoehe === undefined ? peak : { ...peak, h: hoehe };
        }),
    };
}

/** Das Bild als Daten-Adresse für die Karte (braucht eine Leinwand). */
export function alsDatenUrl(pixel: VorschauPixel): string {
    const leinwand = document.createElement("canvas");
    leinwand.width = pixel.breite;
    leinwand.height = pixel.hoehe;
    const zeichnung = leinwand.getContext("2d");
    if (zeichnung === null) return "";
    zeichnung.putImageData(new ImageData(pixel.rgba, pixel.breite, pixel.hoehe), 0, 0);
    return leinwand.toDataURL();
}
