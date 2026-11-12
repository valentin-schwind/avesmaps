import { DESIGN_CANON } from "@avesmaps3d/shared";

/**
 * Die Werte von Himmel, Dunst und Kulisse (WI-0290), vom Betreiber am 2026-11-08 im klickbaren Entwurf eingestellt („das war extrem
 * schlau mir die slider zu geben“, Werte aus „Werte kopieren“). Die Farben stehen im Designkanon (`atmosphere`), hier nur die Zahlen.
 * Die Namen sind die des Entwurfs, damit seine kopierten Werte im Entwicklungsbuild direkt passen (`avesmapsHimmel.setze({...})`).
 */
export interface KulissenWerte {
    /** Ab dieser Neigung (Grad) kommt der Dunst … */
    ab: number;
    /** … und ist bei dieser voll. */
    voll: number;
    /** Deckkraft des vollen Dunsts (0 bis 1). */
    staerke: number;
    /** Ab welcher Nebeltiefe (0 bis 1) der Dunst beginnt: MapLibres `fog-ground-blend`. */
    beginn: number;
    /** Farbe von Dunst und Horizont. */
    dunst: string;
    /** Farbe des Himmels oben. */
    zenit: string;
    /** Über wie viel Grad über dem Horizont der Himmel vom Dunst ins Blau läuft. */
    verlauf: number;
    /** Die Fläche hinter der Karte. */
    meer: string;
    /** Über wie viele Kilometer die Karte am Rand in diese Fläche ausläuft (0: keine Blende). */
    rand: number;
}

export const KULISSEN_VORGABE: KulissenWerte = {
    // Betreiber 2026-11-08, nach dem Neigen auf der Stage: „kannst du den dunst ab neigung 55° kommen lassen?“ (vorher 30°).
    ab: 55,
    voll: 75,
    staerke: 0.8,
    beginn: 0.1,
    dunst: DESIGN_CANON.atmosphere.skyHorizon,
    zenit: DESIGN_CANON.atmosphere.sky,
    verlauf: 15,
    meer: DESIGN_CANON.atmosphere.sea,
    rand: 30,
};

/** Kilometer je Karteneinheit (1 Einheit sind 3.000 Schritt). */
export const KM_JE_EINHEIT = 3;

/**
 * Die Deckkraft des Dunsts aus der Neigung: weich von `ab` bis `voll`, dann `staerke`. Ersetzt MapLibres feste Kurve (erst ab 60°, voll
 * ab 70°), damit der Dunst wie bei Google Maps mit dem Neigen kommt; die Kulisse rechnet mit derselben.
 */
export function nebelDeckkraft(werte: Pick<KulissenWerte, "ab" | "voll" | "staerke">, neigung: number): number {
    const t = Math.min(1, Math.max(0, (neigung - werte.ab) / Math.max(werte.voll - werte.ab, 1e-3)));
    return werte.staerke * t * t * (3 - 2 * t);
}
