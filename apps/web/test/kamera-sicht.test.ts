import { describe, expect, it } from "vitest";
import { trifftFlaeche, type Rechteck } from "../src/map/geometrie/kamera";

/**
 * Wann ein Objekt eines Formmodus „frei zu sehen“ ist (`map/geometrie/kamera.ts`, „formmodus A“): an der Form gemessen, nicht an den
 * Ecken. Fund der Kraftlinien-Sitzung auf der Stage (2026-10-19): Beim Start von „Fläche vereinfachen“ an Vorderkosch ging die Kamera von
 * 6,35 auf 5,35, weil keine Ecke der großen Fläche im Bild lag, obwohl die Fläche das Bild ganz deckte.
 */
const FREI: Rechteck = { links: 300, oben: 100, rechts: 900, unten: 700 };
const ring = (...punkte: [number, number][]) => ({ art: "ring" as const, punkte: punkte.map(([x, y]) => ({ x, y })) });
const linie = (...punkte: [number, number][]) => ({
    art: "linie" as const,
    punkte: punkte.map(([x, y]) => ({ x, y })),
});

describe("trifftFlaeche", () => {
    it("🔴 Vorderkosch: eine Fläche deckt die freie Fläche ganz, alle Ecken liegen draußen - sie ist zu sehen", () => {
        expect(trifftFlaeche(FREI, [ring([-2000, -2000], [3000, -2000], [3000, 3000], [-2000, 3000])])).toBe(true);
    });

    it("eine Ecke in der freien Fläche genügt", () => {
        expect(trifftFlaeche(FREI, [ring([500, 400], [5000, 400], [5000, 5000])])).toBe(true);
    });

    it("eine Kante, die durch die freie Fläche läuft, genügt, auch ohne Ecke darin", () => {
        expect(trifftFlaeche(FREI, [ring([0, 400], [1200, 400], [1200, -500], [0, -500])])).toBe(true);
        expect(trifftFlaeche(FREI, [linie([0, 0], [1200, 800])])).toBe(true);
    });

    it("die schließende Kante eines Rings zählt, die eines Linienzugs nicht", () => {
        // Erste und letzte Ecke links und rechts der freien Fläche, der Rest weit unten.
        const um: [number, number][] = [
            [0, 400],
            [0, 5000],
            [1200, 5000],
            [1200, 400],
        ];
        expect(trifftFlaeche(FREI, [ring(...um)])).toBe(true);
        expect(trifftFlaeche(FREI, [linie(...um)])).toBe(false);
    });

    it("eine Fläche ganz daneben ist nicht zu sehen", () => {
        expect(trifftFlaeche(FREI, [ring([1000, 100], [1500, 100], [1500, 700], [1000, 700])])).toBe(false);
    });

    it("liegt die freie Fläche ganz in einem Loch, ist von der Fläche nichts zu sehen", () => {
        const aussen = ring([-2000, -2000], [3000, -2000], [3000, 3000], [-2000, 3000]);
        const loch = ring([200, 0], [1000, 0], [1000, 800], [200, 800]);
        expect(trifftFlaeche(FREI, [aussen, loch])).toBe(false);
    });

    it("🔴 zwei Teile links und rechts der freien Fläche: kein Sprung zwischen ihnen zählt als Kante", () => {
        expect(trifftFlaeche(FREI, [linie([0, 400], [100, 450]), linie([1100, 400], [1200, 450])])).toBe(false);
        expect(
            trifftFlaeche(FREI, [ring([0, 300], [100, 300], [100, 500]), ring([1100, 300], [1200, 300], [1200, 500])]),
        ).toBe(false);
    });

    it("ein einzelner Punkt zählt nur, wenn er in der freien Fläche liegt", () => {
        expect(trifftFlaeche(FREI, [{ art: "punkt", punkte: [{ x: 600, y: 400 }] }])).toBe(true);
        expect(trifftFlaeche(FREI, [{ art: "punkt", punkte: [{ x: 50, y: 400 }] }])).toBe(false);
    });
});
