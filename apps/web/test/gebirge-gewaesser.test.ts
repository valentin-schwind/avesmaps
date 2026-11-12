import { describe, expect, it } from "vitest";
import type { V12Geometry } from "@avesmaps3d/shared";
import {
    anteilDrin,
    durchquert,
    flaechenRahmen,
    flussZahlen,
    ganzDrin,
    lagenEntlang,
    passZahlen,
    rahmen,
} from "../src/landschaftseditor/gebirge-gewaesser";

/**
 * Flüsse, Seen und Pässe im Reiter „Gebirge“ (WI-0245, Lücke e). Problemfälle: Der Anteil zählt Stützpunkte statt Länge (ein langer
 * Abschnitt draußen mit wenigen Punkten wöge zu wenig); ein See, der über den Rand ragt, gilt als „ganz drin“; ein Fluss, der den See
 * zwischen zwei Stützpunkten quert, gilt als „durchquert keinen See“.
 */
const quadrat = (x0: number, y0: number, x1: number, y1: number): V12Geometry => ({
    type: "Polygon",
    coordinates: [
        [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
            [x0, y0],
        ],
    ],
});
const FLAECHE = quadrat(0, 0, 10, 10);

describe("Flüsse, Seen und Pässe im Reiter (WI-0245)", () => {
    it("🔴 Anteil nach Länge: 10 von 20 E in der Fläche sind die Hälfte, auch mit nur zwei Stützpunkten", () => {
        expect(
            anteilDrin(
                [
                    [-10, 5],
                    [10, 5],
                ],
                FLAECHE,
            ),
        ).toBeCloseTo(0.5, 1);
        expect(
            anteilDrin(
                [
                    [1, 1],
                    [9, 9],
                ],
                FLAECHE,
            ),
        ).toBe(1);
    });

    it("🔴 ein See über den Rand ist nicht „ganz drin“; ein Fluss quert den See auch zwischen zwei Stützpunkten", () => {
        expect(ganzDrin(quadrat(2, 2, 4, 4), FLAECHE)).toBe(true);
        expect(ganzDrin(quadrat(8, 8, 12, 12), FLAECHE)).toBe(false);
        expect(
            durchquert(
                [
                    [0, 3],
                    [10, 3],
                ],
                quadrat(4, 2, 6, 4),
            ),
        ).toBe(true);
        expect(
            durchquert(
                [
                    [0, 8],
                    [10, 8],
                ],
                quadrat(4, 2, 6, 4),
            ),
        ).toBe(false);
    });

    it("Rahmen für ⌖", () => {
        expect(
            rahmen([
                [3, 7],
                [1, 9],
            ]),
        ).toEqual([1, 7, 3, 9]);
        expect(flaechenRahmen(quadrat(2, 3, 4, 5))).toEqual([2, 3, 4, 5]);
    });

    it("🔴 Fluss: das höhere Ende ist die Quelle, auch wenn die Linie an der Mündung beginnt; Lücken ohne Höhe zählen nicht", () => {
        expect(flussZahlen({ at: [0, 1, 2], h: [300, null, 900] })).toEqual({
            quelle: 900,
            muendung: 300,
            gefaelle: 600,
            umgedreht: true,
        });
        expect(flussZahlen({ at: [0, 1], h: [null, 500] })).toBeUndefined();
    });

    it("🔴 Pass: Anstieg und Abstieg getrennt, Steigung je Abtastschritt in Prozent (1 E = 3.000 Schritt)", () => {
        const zahlen = passZahlen({ at: [0, 0.25, 0.5], h: [1000, 1150, 1100] })!;
        expect(zahlen.hoechster).toBe(1150);
        expect(zahlen.anstieg).toBe(150);
        expect(zahlen.abstieg).toBe(50);
        expect(zahlen.steigung).toBeCloseTo(20, 5);
    });

    it("Lagen entlang der Linie an den Abständen", () => {
        expect(
            lagenEntlang(
                [
                    [0, 0],
                    [10, 0],
                    [10, 10],
                ],
                [0, 5, 15],
            ),
        ).toEqual([
            [0, 0],
            [5, 0],
            [10, 5],
        ]);
    });
});
