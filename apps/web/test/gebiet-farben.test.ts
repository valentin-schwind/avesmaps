import { describe, expect, it } from "vitest";
import {
    abweichungVorgabe,
    farbVariante,
    farbhierarchie,
    hsvVon,
    verschiebe,
    type FarbGebiet,
} from "../src/gebietseditor/farben.ts";

/**
 * Die Farben der Herrschaftsgebiete (WI-0209 D4; EDIT-0005 §7 D4, H2). Problemfälle: „Farbhierarchie erstellen“ ergibt mit festem Seed
 * andere Farben als Legacys `territory-editor-inheritance.js`; eine Farbe kommt zweimal vor; die Abweichung 0 ändert doch etwas; das
 * Mitziehen verliert die Abweichungen der Untergebiete untereinander oder dreht eine unveränderte Farbe.
 *
 * Die Sollwerte hat Legacys Code selbst gerechnet (Mirror `a7f2dac86`, `buildColorUpdates` und `ensureUniqueColors` mit festem Seed).
 */
const G = (n: number): string => `c1c1c1c1-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const BAUM: FarbGebiet[] = (
    [
        [2, 1, "Nordmarken"],
        [3, 1, "Kosch"],
        [4, 1, "Albernia"],
        [5, 2, "Grafschaft Albenhus"],
        [6, 2, "Grafschaft Gratenfels"],
        [7, 3, "Baronie Ferdok"],
        [8, 5, "Baronie Firnholz"],
        [9, 5, "Baronie Ost"],
        [10, 5, "Baronie West"],
    ] as const
).map(([n, e, name]) => ({ id: G(n), eltern: G(e), name }));

describe("Farbhierarchie erstellen (Legacys Verfahren)", () => {
    it("🔴 mit festem Seed dieselben Farben wie Legacy, in der Folge der Tiefe und des Namens", () => {
        expect(
            farbhierarchie({ id: G(1), farbe: "#5fb068", ebene: 1 }, BAUM, [38, 33, 28, 25, 25, 25], 12345).map((x) => [
                x.id,
                x.farbe,
            ]),
        ).toEqual([
            [G(4), "#5cadb0"],
            [G(3), "#a1ae62"],
            [G(2), "#5dac60"],
            [G(7), "#9fac61"],
            [G(5), "#96a85a"],
            [G(6), "#5eac98"],
            [G(8), "#60a75a"],
            [G(9), "#99a858"],
            [G(10), "#a5865b"],
        ]);
    });

    it("🔴 Abweichung 0 einer Ebene: die Kinder nähmen die Farbe ihres Obergebiets, Legacy dreht die doppelte weiter", () => {
        const plan = farbhierarchie({ id: G(1), farbe: "#385d72", ebene: 1 }, BAUM, [38, 0, 28, 25, 25, 25], 777);
        expect(plan.map((x) => [x.id, x.farbe])).toEqual([
            [G(4), "#3b7254"],
            [G(3), "#3d6276"],
            [G(2), "#4b3874"],
            [G(7), "#3d6076"],
            [G(5), "#4e3874"],
            [G(6), "#563e81"],
            [G(8), "#4f3874"],
            [G(9), "#3a5275"],
            [G(10), "#733777"],
        ]);
        expect(new Set(plan.map((x) => x.farbe)).size).toBe(plan.length);
    });

    it("🔴 überall 0: keine Farbe zweimal, keine wie die Wurzel", () => {
        const plan = farbhierarchie({ id: G(1), farbe: "#5fb068", ebene: 1 }, BAUM, [0, 0, 0, 0, 0, 0], 1);
        expect(plan.map((x) => x.farbe)).toEqual([
            "#5fb06b",
            "#66bd73",
            "#58a364",
            "#6dca7b",
            "#51975c",
            "#5fb065",
            "#66bd6c",
            "#58a35d",
            "#6dca73",
        ]);
        expect(plan.map((x) => x.farbe)).not.toContain("#5fb068");
    });

    it("die Variante: 0 heißt die Farbe des Obergebiets, ein Gebiet allein bleibt in der Mitte der Spanne", () => {
        expect(farbVariante("#5FB068", { index: 0, anzahl: 3, hellIndex: 0, seed: "x", abweichung: 0 })).toBe(
            "#5fb068",
        );
        expect(farbVariante("#5fb068", { index: 0, anzahl: 1, hellIndex: 0, seed: "x", abweichung: 40 })).toMatch(
            /^#[0-9a-f]{6}$/u,
        );
    });

    it("die Vorgabe der Abweichung liegt in Legacys Bereichen", () => {
        expect(abweichungVorgabe(() => 0)).toEqual([35, 30, 25, 20, 20, 20]);
        expect(abweichungVorgabe(() => 1)).toEqual([40, 35, 30, 30, 30, 30]);
    });
});

describe("Mitziehen (H2)", () => {
    it("🔴 die Untergebiete verschieben sich um dieselbe Differenz, ihre Abstände untereinander bleiben", () => {
        const von = "#5fb068";
        const nach = "#b0685f";
        const kinder = ["#5dac60", "#a1ae62", "#5cadb0"];
        const neu = kinder.map((k) => verschiebe(k, von, nach));
        const dh = hsvVon(nach).h - hsvVon(von).h;
        for (const [i, k] of kinder.entries()) {
            const vorher = hsvVon(k);
            const jetzt = hsvVon(neu[i]!);
            expect((jetzt.h - vorher.h - dh + 720) % 360).toBeCloseTo(0, 0);
        }
        expect(new Set(neu).size).toBe(3);
    });

    it("🔴 unverändert bleibt unverändert, auch ohne Rundungsschritt", () => {
        expect(verschiebe("#5DAC60", "#5fb068", "#5fb068")).toBe("#5dac60");
    });

    it("Sättigung und Helligkeit bleiben zwischen 0 und 1", () => {
        const hell = verschiebe("#f0f0ff", "#808080", "#ffffff");
        expect(hell).toMatch(/^#[0-9a-f]{6}$/u);
        expect(hsvVon(hell).v).toBeLessThanOrEqual(1);
    });
});
