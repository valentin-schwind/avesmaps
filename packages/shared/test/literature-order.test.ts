import { describe, expect, it } from "vitest";
import { compareRecency, editionSortKey } from "../src/index.ts";

/** Legacys Reihenfolge der Spielliteratur (`avesmapsGameLiteratureEditionSortKey`, `avesmapsCompareGameLiteratureRecency`). */

describe("Der Sortierschlüssel der Edition", () => {
    it("DSA5 vor DSA4.1 vor DSA4 vor DSA1, ein Nicht-DSA-Regelwerk danach, ohne Edition zuletzt", () => {
        const keys = ["DSA5", "DSA4.1", "DSA4", "DSA1", "Aventuria 2.0", null].map(editionSortKey);
        expect(keys).toEqual([-5, -4.1, -4, -1, 1000, 1001]);
    });

    it("gerechnet wird mit der ERSTEN Zahl im Text", () => {
        expect(editionSortKey("DSA4.1 Basis")).toBe(-4.1);
        expect(editionSortKey("DSA1-Ausbau")).toBe(-1);
        expect(editionSortKey("DSA4/DSA5")).toBe(-4);
        expect(editionSortKey("   ")).toBe(1001);
        expect(editionSortKey(undefined)).toBe(1001);
    });
});

describe("„Neueste zuerst“", () => {
    it("Edition, dann Jahr absteigend, dann Titel - die Rolle ist nicht Teil des Schlüssels", () => {
        const works = [
            { title: "B", edition: "DSA4", year: 1000 },
            { title: "A", edition: "DSA4", year: 1021 },
            { title: "C", edition: "DSA5" },
            { title: "Ä", edition: "DSA4", year: 1021 },
            { title: "Z" },
        ];
        expect([...works].sort(compareRecency).map((work) => work.title)).toEqual(["C", "A", "Ä", "B", "Z"]);
    });
});
