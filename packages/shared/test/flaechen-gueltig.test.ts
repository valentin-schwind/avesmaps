import { describe, expect, it } from "vitest";
import { formMangel, imKartenraum, type RingPunkt } from "../src/index.ts";

/**
 * Kreuzt oder berührt sich eine Fläche (`flaechen-gueltig.ts`, Vali 2026-11-10)? Problemfälle: Eine Kreuzung oder eine Einschnürung bleibt
 * unerkannt, und der Server lehnt erst beim Speichern ab; eine gültige Form gilt als falsch, und der Editor verweigert einen erlaubten Schritt.
 * Der Abgleich mit PostGIS steht im Zufallstest (`apps/web/test/ecken-zufall.test.ts`).
 */

const P = (x: number, y: number): RingPunkt => [x, y];
const QUADRAT = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];

describe("formMangel", () => {
    it("🟢 ein einfaches Viereck und ein Loch darin sind in Ordnung", () => {
        expect(formMangel([QUADRAT])).toBeUndefined();
        expect(formMangel([QUADRAT, [P(2, 2), P(4, 2), P(4, 4)]])).toBeUndefined();
    });

    it("🔴 eine Acht kreuzt sich, die Stelle ist der Schnittpunkt", () => {
        expect(formMangel([[P(0, 0), P(10, 10), P(10, 0), P(0, 10)]])).toEqual({
            art: "schneidet_sich",
            stelle: [5, 5],
            ring: 0,
        });
    });

    it("🔴 eine Ecke auf einer Ecke desselben Rings schnürt ihn ein", () => {
        // Ein schmaler Streifen, dessen untere Mitte auf die obere gezogen ist.
        const streifen = [P(0, 0), P(5, 4), P(10, 0), P(10, 4), P(5, 4), P(0, 4)];
        expect(formMangel([streifen])?.art).toBe("beruehrt_sich");
    });

    it("🔴 eine Ecke auf einer fremden Kante desselben Rings berührt ihn, auch knapp daneben wie nach dem Einrasten", () => {
        expect(formMangel([[P(0, 0), P(5, 10 - 1e-12), P(10, 0), P(10, 10), P(0, 10)]])?.art).toBe("beruehrt_sich");
    });

    it("🔴 eine Kante, die auf ihrer Nachbarin zurückläuft, ist ein Sporn", () => {
        expect(formMangel([[P(0, 0), P(10, 0), P(5, 0), P(5, 5)]])?.art).toBe("beruehrt_sich");
    });

    it("🔴 ein Loch, das den Rand kreuzt, kreuzt die Fläche", () => {
        expect(formMangel([QUADRAT, [P(8, 2), P(12, 2), P(12, 4), P(8, 4)]])?.art).toBe("schneidet_sich");
    });

    it("🟢 zwei Ringe dürfen sich in einem Punkt berühren, nicht aber ein Stück weit aufeinanderliegen", () => {
        expect(formMangel([QUADRAT, [P(10, 0), P(12, 0), P(12, 2)]])).toBeUndefined();
        expect(formMangel([QUADRAT, [P(10, 2), P(14, 2), P(14, 6), P(10, 6)]])?.art).toBe("schneidet_sich");
    });

    it("🟢 geprüft wird nur, woran ein geänderter Ring beteiligt ist", () => {
        const acht = [P(0, 0), P(10, 10), P(10, 0), P(0, 10)];
        expect(formMangel([acht, [P(20, 0), P(30, 0), P(30, 10)]], (ring) => ring === 1)).toBeUndefined();
    });
});

describe("imKartenraum", () => {
    it("🔴 wie der Server: innen ja, auf dem Rand und außerhalb nein", () => {
        const grenzen = { minX: 0, minY: 0, maxX: 1024, maxY: 1024 };
        expect(imKartenraum([1, 1], grenzen)).toBe(true);
        expect(imKartenraum([0, 5], grenzen)).toBe(false);
        expect(imKartenraum([1025, 5], grenzen)).toBe(false);
    });
});
