import type { TravelModel } from "./travel-model.ts";

/**
 * Die Steigungsfamilien je Abtastschritt (WI-0049 S5c, Gutachten MCS-026 Punkt 2; Betreiber 2026-09-27
 * zu E1–E4: „alles klar, alle empfehlungen: go“).
 *
 * 🔴 EIN RECHNER FÜR ZWEI ORTE: der Router (`apps/server/src/routing/slope.ts`, `relief.ts`) und das
 * Kurvenbild im ⓘ Transportmittel. Legacys Owner verlangte für sein Kurvenbild dasselbe: „was die Kurve
 * zeigt, ist das, was die Route rechnet“. Eine zweite Formel im Frontend liefe nach dem nächsten
 * Feinschliff auseinander.
 *
 * - FOOT: der Leistungskilometer (J+S), 1 + Anstieg/100 je Meile, steil bergab 1 + Abstieg/150.
 * - EQUID: p(s) = max(1, e^(exponent · (|s + versatz| − versatz))), ohne Bonus bergab.
 * - WHEEL: 1 + quadrat · s² bergauf, bergab 1 + quadrat · max(0, −s − rollgrenze)².
 * - Kehrenregel (E1): EQUID und WHEEL gehen steiler als der Knick G* in Kehren, der Faktor wächst dann
 *   linear.
 */

/** 1 Meile = 1.000 Schritt. */
const SCHRITT_PER_MILE = 1000;

export const SLOPE_FAMILIES = ["FOOT", "EQUID", "WHEEL"] as const;
export type SlopeFamily = (typeof SLOPE_FAMILIES)[number];

/** Die Familie eines Reisemittels nach dem Reisemodell; ein Mittel ohne Eintrag geht wie FOOT. */
export function slopeFamily(model: TravelModel, transport: string): SlopeFamily {
    const families = model.steigung.wert.familien;
    if (families.EQUID.reisemittel.includes(transport)) return "EQUID";
    if (families.WHEEL.reisemittel.includes(transport)) return "WHEEL";
    return "FOOT";
}

/** Die Formel der Familie ohne Kehren. Nie unter 1. */
function directStepFactor(family: SlopeFamily, s: number, model: TravelModel): number {
    const rule = model.steigung.wert;
    if (family === "EQUID") {
        const { exponent, versatz } = rule.familien.EQUID;
        return Math.max(1, Math.exp(exponent * (Math.abs(s + versatz) - versatz)));
    }
    if (family === "WHEEL") {
        const { quadrat, rollgrenze } = rule.familien.WHEEL;
        const x = s >= 0 ? s : Math.max(0, -s - rollgrenze);
        return 1 + quadrat * x * x;
    }
    if (s > 0) return 1 + (s * SCHRITT_PER_MILE) / rule.anstiegSchrittJeMeile;
    if (-s > rule.steilAb) return 1 + (-s * SCHRITT_PER_MILE) / rule.steilerAbstiegSchrittJeMeile;
    return 1;
}

/**
 * Der Knick G* der Kehrenregel (E1) als Betrag, bergauf oder bergab; null ohne Kehren. G* ist, wo p(G) / G
 * am kleinsten ist: Steiler kommt man mit G* in Kehren schneller voran als geradeaus. Geschlossen gerechnet:
 * - EQUID: bergauf 1 / exponent; bergab max(1 / exponent, 2 · versatz), denn bis 2 · versatz ist p = 1.
 * - WHEEL: bergauf 1 / √quadrat; bergab √(1 / quadrat + rollgrenze²).
 * FOOT ist linear und kennt keinen Knick.
 */
export function switchbackGrade(family: SlopeFamily, uphill: boolean, model: TravelModel): number | null {
    const families = model.steigung.wert.familien;
    if (family === "EQUID" && families.EQUID.kehren) {
        const { exponent, versatz } = families.EQUID;
        return uphill ? 1 / exponent : Math.max(1 / exponent, 2 * versatz);
    }
    if (family === "WHEEL" && families.WHEEL.kehren) {
        const { quadrat, rollgrenze } = families.WHEEL;
        return uphill ? 1 / Math.sqrt(quadrat) : Math.sqrt(1 / quadrat + rollgrenze * rollgrenze);
    }
    return null;
}

/**
 * Der Faktor eines Abtastschritts mit Steigung `s` (Anstieg/Strecke) in Fahrtrichtung. Nie unter 1.
 * Steiler als der Knick G* geht es in Kehren: |s| / G* · p(G*), stetig am Knick.
 */
export function familyStepFactor(family: SlopeFamily, s: number, model: TravelModel): number {
    const knick = switchbackGrade(family, s >= 0, model);
    if (knick === null || Math.abs(s) <= knick) return directStepFactor(family, s, model);
    return (Math.abs(s) / knick) * directStepFactor(family, s >= 0 ? knick : -knick, model);
}
