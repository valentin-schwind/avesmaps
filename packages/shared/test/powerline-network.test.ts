import { describe, expect, it } from "vitest";
import { powerlineArcHeight, powerlineArcLift } from "../src/index.ts";

/**
 * Die Bögen der Kraftlinien (WI-0025).
 *
 * 🔴 Jedes Stück ist ein Bogen von Knoten zu Knoten und landet an beiden Enden, auch an einem
 * Kraftlinienpunkt (Betreiber 2026-09-26: „richtig, dort landen, wie bei knoten“).
 */

const BOGEN = { share: 0.18, maxPx: 180 };

describe("Höhe der Bögen", () => {
    it("🔴 null an beiden Enden - dort landet der Bogen -, am höchsten in der Mitte, nie über der Grenze", () => {
        expect(powerlineArcHeight(BOGEN, 400, 0)).toBe(0);
        expect(powerlineArcHeight(BOGEN, 400, 400)).toBeCloseTo(0, 9);
        const mitte = powerlineArcHeight(BOGEN, 400, 200);
        expect(mitte).toBeGreaterThan(powerlineArcHeight(BOGEN, 400, 100));
        expect(powerlineArcHeight(BOGEN, 100_000, 50_000)).toBeLessThanOrEqual(BOGEN.maxPx);
    });

    it("kurze Stücke sind ein reiner Sinusbogen, lange werden flach oben (Himmelsstraße)", () => {
        // 200 px lang: 18 % davon sind 36 px, weit unter der Grenze - tanh ändert fast nichts.
        const kurz = powerlineArcHeight(BOGEN, 200, 100);
        expect(kurz).toBeGreaterThan(35);
        expect(kurz).toBeLessThanOrEqual(36);
        // 5000 px lang: auf dem ganzen mittleren Drittel beinahe an der Grenze.
        for (const anteil of [0.34, 0.5, 0.66]) {
            expect(powerlineArcHeight(BOGEN, 5000, 5000 * anteil)).toBeGreaterThan(BOGEN.maxPx * 0.98);
        }
    });

    it("symmetrisch: von beiden Enden aus gleich hoch", () => {
        expect(powerlineArcHeight(BOGEN, 900, 250)).toBeCloseTo(powerlineArcHeight(BOGEN, 900, 650), 12);
    });
});

describe("Aufsteigen mit der Neigung", () => {
    it("🔴 flach liegen die Bögen auf der Legacy-Bahn, ab der vollen Neigung stehen sie ganz", () => {
        expect(powerlineArcLift(0, 40)).toBe(0);
        expect(powerlineArcLift(40, 40)).toBe(1);
        expect(powerlineArcLift(60, 40)).toBe(1);
        expect(powerlineArcLift(20, 40)).toBeCloseTo(0.5, 12);
        let vorher = -1;
        for (let neigung = 0; neigung <= 45; neigung += 5) {
            const jetzt = powerlineArcLift(neigung, 40);
            expect(jetzt).toBeGreaterThanOrEqual(vorher);
            vorher = jetzt;
        }
    });
});
