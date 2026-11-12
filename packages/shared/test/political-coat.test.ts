import { describe, expect, it } from "vitest";
import { AVENTURIA_POLITICAL_CARTOGRAPHY, coatLabelGeometry, labelScaleForBand } from "../src/index.ts";

/**
 * Das Wappen am Gebietsnamen (WI-0121): Legacys Rechnung, nicht ungefähr.
 *
 * 🔴 Quelle ist Legacys Code und CSS im Mirror `cbe278210` (`createRegionLabelMarkup`, `.region-label__content`,
 * `renderMapLabelToImage`). Die Zahlen unten sind von Hand aus diesem Code gerechnet, nicht aus `coatLabelGeometry`
 * abgeschrieben: Der Block ist eine Spalte aus Polster 2, Wappen, Abstand 2, Namensbild (27 px bei Größe 13,3), Polster 5 und
 * sitzt mit seiner Mitte auf dem Anker.
 */

const LABEL = AVENTURIA_POLITICAL_CARTOGRAPHY.label;
const COAT = LABEL.coat;
/**
 * Legacys Schrift des Gebietsnamens (16 px abzüglich 2 pt: `.region-label`), mit der seine Zahlen gerechnet sind. Unser Name steht
 * größer (`label.sizePx`, Betreiber 2026-10-09); die Zahlen unten sind Legacys und gelten für Legacys Schrift.
 */
const LEGACY_SIZE_PX = 13.3;
const LEGACY = { ...LABEL, sizePx: LEGACY_SIZE_PX };

describe("Faktor je Band", () => {
    it("🔴 Band 0 0,75 · 1 0,83 · 2 0,91 · ab 3 voll (Legacy: Zoom 0 bis 2 verkleinert, ab 3 voll)", () => {
        expect(LABEL.scaleByBand).toEqual([0.75, 0.83, 0.91, 1]);
        expect([0, 1, 2, 3, 4, 5, 6].map((band) => labelScaleForBand(LABEL.scaleByBand, band))).toEqual([
            0.75, 0.83, 0.91, 1, 1, 1, 1,
        ]);
        // Ein Band unter 0 oder eine Kommazahl geht nicht aus der Tafel hinaus.
        expect(labelScaleForBand(LABEL.scaleByBand, -1)).toBe(0.75);
        expect(labelScaleForBand(LABEL.scaleByBand, 2.9)).toBe(0.91);
    });
});

describe("Lage von Wappen und Name vom Anker (Legacys Schrift)", () => {
    it("🔴 bei Faktor 1 und einer Zeile: Wappen-Unterkante +4 px, Mitte der Namenszeile +19,5 px (Block 76 px hoch)", () => {
        const lage = coatLabelGeometry(COAT, LEGACY, 3, 1);
        expect(lage.coatPx).toBe(40);
        expect(lage.nameImagePx).toBe(27);
        expect(lage.blockPx).toBeCloseTo(76, 9);
        expect(lage.coatBottomPx).toBeCloseTo(4, 9);
        expect(lage.firstLineCenterPx).toBeCloseTo(19.5, 9);
        // Von der Unterkante des Wappens bis zur Oberkante der Schrift: Legacys Lücke, rund 8,8 px.
        expect(lage.gapToEmTopPx).toBeCloseTo(8.85, 2);
    });

    it("🔴 Wappen 30 / 33 / 36 / 40 px, und DERSELBE Faktor gilt für die Schrift des Namens", () => {
        const lagen = [0, 1, 2, 3].map((band) => coatLabelGeometry(COAT, LEGACY, band, 1));
        expect(lagen.map((lage) => lage.coatPx)).toEqual([30, 33, 36, 40]);
        [0.75, 0.83, 0.91, 1].forEach((faktor, index) => {
            expect((lagen[index] as { fontPx: number }).fontPx / LEGACY_SIZE_PX).toBeCloseTo(faktor, 10);
        });
        // Das Namensbild und der Zeilenabstand folgen der Schrift (Legacy: ceil(Größe × 1,96), round(Größe × 1,18)).
        expect(lagen.map((lage) => lage.nameImagePx)).toEqual([20, 22, 24, 27]);
        expect(lagen.map((lage) => lage.lineStepPx)).toEqual([12, 13, 14, 16]);
    });

    it("🔴 jede weitere Zeile schiebt den ganzen Block um den halben Zeilenabstand nach oben, die Lücke bleibt", () => {
        const eine = coatLabelGeometry(COAT, LEGACY, 3, 1);
        const zwei = coatLabelGeometry(COAT, LEGACY, 3, 2);
        const drei = coatLabelGeometry(COAT, LEGACY, 3, 3);
        // Legacy: Block 76 + 16 · (Zeilen − 1), Mitte auf dem Anker.
        expect([eine.blockPx, zwei.blockPx, drei.blockPx].map((px) => Math.round(px * 1e9) / 1e9)).toEqual([
            76, 92, 108,
        ]);
        expect(zwei.coatBottomPx).toBeCloseTo(-4, 9);
        expect(zwei.firstLineCenterPx).toBeCloseTo(11.5, 9);
        expect(drei.coatBottomPx).toBeCloseTo(-12, 9);
        expect(zwei.gapToEmTopPx).toBeCloseTo(eine.gapToEmTopPx, 10);
        expect(drei.gapToEmTopPx).toBeCloseTo(eine.gapToEmTopPx, 10);
    });

    it("die Tafel kalibriert auf zwei Zeilen: die häufigste Zeilenzahl der Gebiete mit Wappen", () => {
        expect(COAT.calibratedLines).toBe(2);
    });
});

describe("Der Name steht größer als bei Legacy (Betreiber 2026-10-09: „du kannst die schriftart der territorien größer machen“)", () => {
    it("🔴 die Lücke vom Wappen zur Schrift bleibt Legacys 8,85 px, auch wenn die Schrift wächst", () => {
        for (const sizePx of [13.3, 14.5, 16, 17.5]) {
            const lage = coatLabelGeometry(COAT, { ...LABEL, sizePx }, 3, 2);
            expect(lage.gapToEmTopPx, `Schrift ${String(sizePx)}`).toBeCloseTo(8.85, 9);
            expect(lage.fontPx).toBe(sizePx);
        }
        // Und in den dichten Bändern im Verhältnis des Faktors (Legacy: 7,0 / 7,5 / 8,0 bei kleinerer Schrift).
        const lagen = [0, 1, 2].map((band) => coatLabelGeometry(COAT, LABEL, band, 2).gapToEmTopPx);
        lagen.forEach((luecke, band) => {
            expect(luecke).toBeCloseTo(8.85 * (LABEL.scaleByBand[band] as number), 9);
        });
    });

    it("🔴 der Block bleibt auf dem Anker zentriert: das größere Namensbild und die größere Zeilenhöhe machen ihn höher, nicht schief", () => {
        for (const sizePx of [13.3, 16, 17.5]) {
            for (const zeilen of [1, 2, 3]) {
                const lage = coatLabelGeometry(COAT, { ...LABEL, sizePx }, 3, zeilen);
                const oben = lage.coatBottomPx - lage.coatPx - COAT.paddingTopPx;
                expect(oben + lage.blockPx / 2, `Schrift ${String(sizePx)}, ${String(zeilen)} Zeilen`).toBeCloseTo(
                    0,
                    9,
                );
            }
        }
        // Schrift 16 px, zwei Zeilen: Namensbild ceil(16 × 1,7 + 2 × 2,08) = 32, Zeilenabstand round(16 × 1,18) = 19.
        const lage = coatLabelGeometry(COAT, { ...LABEL, sizePx: 16 }, 3, 2);
        expect(lage.nameImagePx).toBe(32);
        expect(lage.lineStepPx).toBe(19);
        expect(lage.blockPx).toBeCloseTo(2 + 40 + (8.85 - (32 - 16) / 2) + 32 + 19 + 5, 9);
    });
});
