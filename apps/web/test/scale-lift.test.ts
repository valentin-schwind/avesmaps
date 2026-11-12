import { describe, expect, it } from "vitest";
import { massstabHub, type HubLage } from "../src/scale/scale-lift.ts";

/**
 * Der Hub der Maßstabsleiste (WI-0096), ohne Browser. Anlass: Am Telefon verrutschte die Leiste ständig und lag mal über den
 * Knöpfen am unteren Rand, mal mitten in der Karte (Vali 2026-11-10, Production, Telefon hochkant).
 */

/** Telefon hochkant, 390 × 844, Knopfreihe unten über die ganze Breite (Reisebilder, Neuigkeiten, Hinweise). */
const TELEFON: HubLage = {
    mitte: 195,
    breite: 140,
    fensterHoehe: 844,
    leisteUnten: 0,
    hindernisse: [{ left: 60, right: 380, top: 800 }],
    luft: 6,
};

describe("Maßstabsleiste: Hub über dem unteren Rand", () => {
    it("steigt über die Knopfreihe, wenn sie ihren Platz schneidet", () => {
        expect(massstabHub(TELEFON)).toBe(844 - 800 + 6);
    });

    it("springt beim Zoomen nicht: gerechnet wird mit dem Deckel, nicht mit der heutigen Breite", () => {
        // Ein Knopf am Rand des Platzes. Deckel 160 px um die Mitte 195: 115 bis 275, er schneidet.
        const amRand = { ...TELEFON, hindernisse: [{ left: 260, right: 380, top: 800 }] };
        expect(massstabHub({ ...amRand, breite: 160 })).toBe(50);
        // Mit der heutigen Breite gerechnet (eine 60 px kurze Zahl: 165 bis 225) fiele der Hub weg, und beim nächsten
        // Zoomschritt käme er wieder: genau das Springen. Die Leiste reicht darum ihren Deckel herein (`scale-bar.vue`).
        expect(massstabHub({ ...amRand, breite: 60 })).toBe(0);
    });

    it("bleibt unten, wo nichts ihren Platz schneidet (am Rechner steht der Eckbund weit rechts)", () => {
        const rechner = {
            ...TELEFON,
            mitte: 960,
            breite: 280,
            fensterHoehe: 1080,
            hindernisse: [{ left: 1600, right: 1900, top: 1030 }],
        };
        expect(massstabHub(rechner)).toBe(0);
    });

    it("🔴 eine zugeklappte Reisebilder-Leiste hebt sie nicht", () => {
        expect(massstabHub({ ...TELEFON, hindernisse: [], leisteUnten: 0 })).toBe(0);
    });

    it("eine offene Reisebilder-Leiste hebt sie um ihre gemeldete Höhe plus Luft", () => {
        expect(massstabHub({ ...TELEFON, hindernisse: [], leisteUnten: 92 })).toBe(98);
    });

    it("über Leiste und Knöpfen zählt, was höher steht", () => {
        const beides = { ...TELEFON, leisteUnten: 92, hindernisse: [{ left: 60, right: 380, top: 844 - 92 - 44 }] };
        expect(massstabHub(beides)).toBe(92 + 44 + 6);
    });
});
