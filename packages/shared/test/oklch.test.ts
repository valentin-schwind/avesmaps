import { describe, expect, it } from "vitest";
import { oklchOf, oklchToHex, withOklchLightness } from "../src/oklch.ts";

/** OKLCH nach Björn Ottosson: die Bezugswerte sind seine (und die von CSS Color 4 für `oklch()`). */
describe("OKLCH", () => {
    it("Weiß, Schwarz und Rot wie in der Bezugsrechnung", () => {
        expect(oklchOf("#ffffff").l).toBeCloseTo(1, 4);
        expect(oklchOf("#ffffff").c).toBeCloseTo(0, 4);
        expect(oklchOf("#000000").l).toBeCloseTo(0, 6);
        const red = oklchOf("#ff0000");
        expect(red.l).toBeCloseTo(0.628, 3);
        expect(red.c).toBeCloseTo(0.2577, 3);
        expect(red.h).toBeCloseTo(29.23, 1);
    });

    it("hin und zurück ergibt dieselbe Farbe", () => {
        for (const hex of ["#7fa8c4", "#d9a978", "#c65e2e", "#f4efe4", "#4c89c6"]) {
            expect(oklchToHex(oklchOf(hex))).toBe(hex);
        }
    });

    it("eine Farbe außerhalb von sRGB verliert Buntheit, nicht Helligkeit oder Farbton", () => {
        const hex = oklchToHex({ l: 0.78, c: 0.4, h: 66 });
        const back = oklchOf(hex);
        expect(back.l).toBeCloseTo(0.78, 2);
        expect(back.h).toBeCloseTo(66, 0);
        expect(back.c).toBeLessThan(0.2);
    });

    it("withOklchLightness behält den Farbton und setzt die Helligkeit", () => {
        const name = oklchOf(withOklchLightness("#a7c563", 0.85));
        expect(name.l).toBeCloseTo(0.85, 2);
        expect(name.h).toBeCloseTo(oklchOf("#a7c563").h, 0);
    });

    it("lehnt alles ab, was keine Hexfarbe ist", () => {
        expect(() => oklchOf("rgb(1, 2, 3)")).toThrow();
    });
});
