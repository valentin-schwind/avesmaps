import { nebelDeckkraft, type KulissenWerte } from "./kulisse-werte";

/**
 * Wie dicht der Dunst an einer Stelle der Welt steht, je Bild: dieselbe Rechnung wie MapLibres Nebel auf dem Gelände und die Kulisse (WI-0290,
 * `kulisse-shader.ts`). Ausgelagert für das Wetter (WI-0288, Betreiber 2026-11-08: „inkonsistent, dass labels z.b. ‚Orkland‘ im Dunst verschwindet
 * und die Wind-Icons wie ‚Firunsatem‘ nicht … vielleicht wärs sinnvoll auf distanz aus- und den dunst einzublenden“): Wetter-Icons und die
 * Wolken in der Ferne weichen demselben Dunst wie das Gelände.
 *
 * - Weltkoordinaten wie Wetter und Kulisse: x und z in Karteneinheiten, y nach oben (`AUF_WELT`).
 * - Tiefe ist der Abstand längs der Blickachse (die w-Zeile der Matrix), `nah` der Abstand zur Meereshöhe auf der Achse, mindestens die halbe
 *   Entfernung zur Mitte, `fern` MapLibres `farZ`. Ab `beginn` steigt der Dunst quadratisch, mal der Deckkraft aus der Neigung.
 * - 🔴 Ändert sich die Formel des Dunsts, ändert sie sich hier und im Kulisse-Shader zugleich; sonst stehen Icons und Wolken in anderem Dunst als
 *   das Gelände.
 */
export interface DunstLage {
    /** Die w-Zeile der Matrix (Welt nach Clip): `w = zeile · (x, y, z, 1)`. */
    readonly zeile: readonly [number, number, number, number];
    readonly nah: number;
    readonly fern: number;
    readonly beginn: number;
    /** Die Deckkraft aus der Neigung (`nebelDeckkraft`), 0 bis `staerke`. */
    readonly deckkraft: number;
    /** Der Höchstwert der Deckkraft (`staerke`): Wolken und Icons messen ihren Dunst daran. */
    readonly staerke: number;
}

export interface DunstKamera {
    /** Die Matrix Welt nach Clip (MapLibres `mainMatrix` mal `AUF_WELT`), spaltenweise. */
    readonly vp: ArrayLike<number>;
    /** Ihre Umkehrung: daraus der Standort der Kamera. */
    readonly inv: ArrayLike<number>;
    /** Senkrechtes Sichtfeld im Bogenmaß (`args.fov`). */
    readonly sichtfeld: number;
    /** MapLibres `farZ`. */
    readonly fern: number;
    /** Höhe der Karte in Bildpunkten. */
    readonly hoehe: number;
    /** Neigung in Grad. */
    readonly neigung: number;
}

/** Die Lage des Dunsts in diesem Bild (wie `kulisse.ts` sie dem Shader gibt); `undefined` ohne Kamera. */
export function dunstLage(kamera: DunstKamera, werte: KulissenWerte): DunstLage | undefined {
    const { vp, inv } = kamera;
    const e3 = inv[11]!;
    if (Math.abs(e3) < 1e-30) return undefined;
    const augeY = inv[9]! / e3;
    const zeile = [vp[3]!, vp[7]!, vp[11]!, vp[15]!] as const;
    const proEinheit = Math.hypot(zeile[0], zeile[1], zeile[2]) || 1;
    const vorY = zeile[1] / proEinheit;
    const zurMitte = (0.5 / Math.tan(kamera.sichtfeld / 2)) * kamera.hoehe;
    const zurMeereshoehe = vorY < -1e-6 ? (-augeY / vorY) * proEinheit : Number.POSITIVE_INFINITY;
    const nah = Math.max(zurMitte / 2, Math.min(zurMeereshoehe, kamera.fern * 0.999));
    return {
        zeile,
        nah,
        fern: kamera.fern,
        beginn: werte.beginn,
        deckkraft: nebelDeckkraft(werte, kamera.neigung),
        staerke: werte.staerke,
    };
}

/** Der Dunst an einer Stelle der Welt, 0 bis 1: der Anteil des Dunsttons, wie ihn das Gelände dort trägt. */
export function dunstAnteil(lage: DunstLage, x: number, y: number, z: number): number {
    if (lage.deckkraft <= 0) return 0;
    const [a, b, c, d] = lage.zeile;
    const w = a * x + b * y + c * z + d;
    const tiefe = (lage.fern / (lage.fern - lage.nah)) * (1 - lage.nah / Math.max(w, 1e-3));
    const k = Math.max(tiefe - lage.beginn, 0) / (1 - lage.beginn);
    return Math.min(k * k * lage.deckkraft, 1);
}
