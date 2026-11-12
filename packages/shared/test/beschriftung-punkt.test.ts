import { describe, expect, it } from "vitest";
import { beschriftungsPunkt, freierPunkt, polygonPunkt, type Ring } from "../src/beschriftung-punkt.ts";

/**
 * Der Punkt für „Position zurücksetzen“ (WI-0232). Problemfälle: der Schwerpunkt einer U-Form liegt außerhalb der Fläche; ein Loch in der
 * Mitte zieht den Punkt hinein; bei mehreren Teilen gewinnt der falsche; eine entartete Fläche liefert NaN statt nichts (Legacy: „ein NaN
 * reiste bis in `move_label` durch“); zwei Beschriftungen landen auf demselben Punkt.
 */

const quadrat = (x: number, y: number, k: number): Ring => [
    [x, y],
    [x + k, y],
    [x + k, y + k],
    [x, y + k],
    [x, y],
];

const innen = (ring: Ring, x: number, y: number): boolean => {
    let drin = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[i]!;
        const [bx, by] = ring[j]!;
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) drin = !drin;
    }
    return drin;
};

describe("Punkt einer Fläche (WI-0232)", () => {
    it("Quadrat: die Mitte, Abstand die halbe Kante", () => {
        const p = polygonPunkt([quadrat(100, 200, 40)], 0.1)!;
        expect(p.x).toBeCloseTo(120, 0);
        expect(p.y).toBeCloseTo(220, 0);
        expect(p.abstand).toBeCloseTo(20, 0);
    });

    it("U-Form: der Punkt liegt in der Fläche, nicht im leeren Bogen (wo der Schwerpunkt läge)", () => {
        const u: Ring = [
            [0, 0],
            [90, 0],
            [90, 90],
            [60, 90],
            [60, 30],
            [30, 30],
            [30, 90],
            [0, 90],
            [0, 0],
        ];
        const p = polygonPunkt([u], 0.1)!;
        expect(innen(u, p.x, p.y)).toBe(true);
        expect(p.abstand).toBeGreaterThan(10);
    });

    it("mit Loch: der Punkt meidet das Loch", () => {
        const loch = quadrat(40, 40, 20);
        const p = polygonPunkt([quadrat(0, 0, 100), loch], 0.1)!;
        expect(innen(loch, p.x, p.y)).toBe(false);
        expect(p.abstand).toBeGreaterThan(15);
    });

    it("mehrere Teile: der mit dem größten Abstand gewinnt, wie Legacy", () => {
        const p = beschriftungsPunkt([[quadrat(0, 0, 10)], [quadrat(500, 500, 80)]], 0.1)!;
        expect(p.x).toBeGreaterThan(500);
        expect(p.y).toBeGreaterThan(500);
    });

    it("entartet: nichts statt NaN", () => {
        expect(polygonPunkt([[]])).toBeNull();
        expect(
            polygonPunkt([
                [
                    [1, 1],
                    [2, 2],
                ],
            ]),
        ).toBeNull();
        expect(beschriftungsPunkt([])).toBeNull();
        const linie = polygonPunkt([
            [
                [5, 5],
                [5, 5],
                [5, 5],
            ],
        ])!;
        expect(Number.isFinite(linie.x) && Number.isFinite(linie.y)).toBe(true);
    });

    it("Legacys Genauigkeit 1,0 reicht für eine große Fläche (unter einer Karteneinheit neben dem genauen Punkt)", () => {
        const grob = polygonPunkt([quadrat(0, 0, 400)])!;
        expect(Math.hypot(grob.x - 200, grob.y - 200)).toBeLessThan(1.5);
    });
});

describe("freier Platz neben anderen Beschriftungen (WI-0232)", () => {
    it("frei: der Punkt selbst", () => {
        expect(freierPunkt([10, 10], [[100, 100]], 20)).toEqual([10, 10]);
    });

    it("belegt: ein Schritt nach rechts unten, bei zwei Nachbarn notfalls zwei", () => {
        expect(freierPunkt([10, 10], [[10, 10]], 20)).toEqual([30, 30]);
        expect(
            freierPunkt(
                [10, 10],
                [
                    [10, 10],
                    [30, 30],
                ],
                20,
            ),
        ).toEqual([50, 50]);
    });

    it("in Karteneinheiten: „rechts unten“ ist +x und −y (y wächst nach Norden)", () => {
        expect(freierPunkt([10, 10], [[10, 10]], 2, [1, -1])).toEqual([12, 8]);
    });

    it("gedeckelt: endet immer, auch wenn alles belegt scheint", () => {
        const belegte: [number, number][] = Array.from({ length: 50 }, (_, i) => [10 + i * 20, 10 + i * 20]);
        const p = freierPunkt([10, 10], belegte, 20);
        expect(p).toHaveLength(2);
    });
});
