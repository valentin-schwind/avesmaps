import { afterEach, describe, expect, it } from "vitest";
import type { ContextTerritories } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import { STAIR_LID_FROM, liesInOf } from "../src/info-panel/panel-staircase.ts";
import {
    namedParts,
    partsOfLinked,
    partsOfListValue,
    percentOf,
    stationsOf,
    typeLabel,
    withTrailingPunctuation,
} from "../src/info-panel/panel-text.ts";
import { territory } from "./panel-fixtures.ts";

/** Die kleinen Helfer des Panelmodells: Art als Wort, Satzvorlage mit Link, Text mit Verweisen, Anteil, die Treppe. */

afterEach(() => setLocale("de"));

describe("Texthelfer", () => {
    it("die Art aus der Sprachtafel; ein Gipfel hat seine eigene; unbekannt: der Schlüssel", () => {
        expect(typeLabel("place", "dorf")).toBe("Dorf");
        expect(typeLabel("area", "urwald")).toBe("Urwald");
        expect(typeLabel("path", "Reichsstrasse")).toBe("Reichsstraße");
        expect(typeLabel("peak", "berggipfel")).toBe("Berggipfel");
        expect(typeLabel("peak", "vulkan")).toBe("Vulkan");
        expect(typeLabel("place", "etwas-neues")).toBe("etwas-neues");
    });

    it("eine Satzvorlage lässt den Namen ein eigener Link bleiben - in beiden Sprachen", () => {
        const ref = territory("x", "Garetien").ref;
        expect(namedParts("infoPanel.capitalOf", "Garetien", ref)).toEqual([
            { text: "Hauptstadt von " },
            { text: "Garetien", ref },
        ]);
        setLocale("en");
        expect(namedParts("infoPanel.capitalOf", "Garetien", ref)).toEqual([
            { text: "Capital of " },
            { text: "Garetien", ref },
        ]);
        expect(namedParts("infoPanel.inTerritory", "Garetien", ref)).toEqual([
            { text: "in " },
            { text: "Garetien", ref },
        ]);
    });

    it("Verweise im Text: in der Reihenfolge ihres Vorkommens; einer, der nicht darin steht, fällt weg", () => {
        const path = { kind: "path" as const, chain: "Gardel:Flussweg" };
        expect(partsOfLinked("Reichsstraßen 2 und 3, Gardel", [{ text: "Gardel", ref: path }])).toEqual([
            { text: "Reichsstraßen 2 und 3, " },
            { text: "Gardel", ref: path },
        ]);
        expect(partsOfLinked("Gardel", [{ text: "Silk", ref: path }])).toEqual([{ text: "Gardel" }]);
        expect(
            partsOfLinked("A, B, A", [
                { text: "A", ref: path },
                { text: "A", ref: path },
            ]),
        ).toEqual([{ text: "A", ref: path }, { text: ", B, " }, { text: "A", ref: path }]);
    });

    it("🔴 das Satzzeichen hinter einem Link wandert in seinen Kasten, bis zum Leerraum; der Rest bleibt Text (Gareth, Bildbezug)", () => {
        const a = territory("a", "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth").ref;
        const b = territory("b", "Königreich Garetien").ref;
        const c = territory("c", "Kaisermark Gareth").ref;
        const parts = [
            { text: "Hauptstadt von " },
            { text: "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth", ref: a },
            { text: ", " },
            { text: "Königreich Garetien", ref: b },
            { text: ", " },
            { text: "Kaisermark Gareth", ref: c },
        ];
        expect(withTrailingPunctuation(parts)).toEqual([
            { text: "Hauptstadt von " },
            { text: "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth", ref: a, tail: "," },
            { text: " " },
            { text: "Königreich Garetien", ref: b, tail: "," },
            { text: " " },
            { text: "Kaisermark Gareth", ref: c },
        ]);
        // Das Modell bleibt, wie es war: Das Zeichen hängt nur beim Zeichnen am Link.
        expect(parts[2]).toEqual({ text: ", " });
        // Bis zum ersten Leerraum, auch über zwei Teile; ohne Satzzeichen, nach Text oder nach einem Zeilenumbruch nichts.
        expect(withTrailingPunctuation([{ text: "A", ref: a }, { text: "). Danach" }])).toEqual([
            { text: "A", ref: a, tail: ")." },
            { text: " Danach" },
        ]);
        expect(withTrailingPunctuation([{ text: "A", ref: a }, { text: "," }, { text: ";" }])).toEqual([
            { text: "A", ref: a, tail: ",;" },
        ]);
        expect(withTrailingPunctuation([{ text: "A", ref: a }, { text: " und " }, { text: "B", ref: b }])).toEqual([
            { text: "A", ref: a },
            { text: " und " },
            { text: "B", ref: b },
        ]);
        expect(withTrailingPunctuation([{ text: "A" }, { text: ", B" }])).toEqual([{ text: "A" }, { text: ", B" }]);
        expect(
            withTrailingPunctuation([
                { text: "A", ref: a },
                { text: ", B", breakBefore: true },
            ]),
        ).toEqual([
            { text: "A", ref: a },
            { text: ", B", breakBefore: true },
        ]);
    });

    it("🔴 Verweise mit Stelle (Wiki-Texte): der Link sitzt an SEINER Stelle, nie an der ersten gleichen Buchstabenfolge davor", () => {
        const ref = { kind: "place" as const, id: "80558060-4299-54aa-b520-814b10819885" };
        expect(partsOfLinked("Alt-Gareth · Gareth", [{ text: "Gareth", ref, at: 13 }])).toEqual([
            { text: "Alt-Gareth · " },
            { text: "Gareth", ref },
        ]);
        // Eine Stelle, an der der Text nicht steht, oder die hinter einem früheren Verweis liegt, ergibt keinen Link.
        expect(partsOfLinked("Alt-Gareth", [{ text: "Gareth", ref, at: 0 }])).toEqual([{ text: "Alt-Gareth" }]);
        expect(
            partsOfLinked("Gareth Gareth", [
                { text: "Gareth", ref, at: 7 },
                { text: "Gareth", ref, at: 0 },
            ]),
        ).toEqual([{ text: "Gareth Gareth".slice(0, 7) }, { text: "Gareth", ref }]);
    });

    it("ein Wert einer Liste: nur die Verweise SEINER Stelle, der Rest bleibt Text; ohne Verweise ein Stück Text", () => {
        const ref = { kind: "area" as const, id: "9188801c-92e6-4fbf-a6d5-794b7433f846" };
        const links = [
            { value: 1, text: "Svalltermoor", ref, at: 0 },
            { value: 2, text: "Ostmark", ref, at: 0 },
        ];
        expect(partsOfListValue("Nordland", 0, links)).toEqual([{ text: "Nordland" }]);
        expect(partsOfListValue("Svalltermoor (Region)", 1, links)).toEqual([
            { text: "Svalltermoor", ref },
            { text: " (Region)" },
        ]);
        expect(partsOfListValue("Nordland", 0, undefined)).toEqual([{ text: "Nordland" }]);
    });

    it("Anteil: ganz gerundet, ohne Anteil leer; Stationen am Pfeil getrennt", () => {
        expect(percentOf(0.837)).toBe(" (84 %)");
        expect(percentOf(undefined)).toBe("");
        expect(stationsOf("A → B →  C → ")).toEqual(["A", "B", "C"]);
    });
});

describe("die Treppe „Liegt in“", () => {
    const chains = (list: [string, string][][]): ContextTerritories => ({
        relation: "lies_in",
        chains: list.map((chain) => chain.map(([id, name]) => territory(id, name))) as ContextTerritories["chains"],
    });

    it("keine Ketten, keine Treppe", () => {
        expect(liesInOf(undefined)).toBeUndefined();
        expect(liesInOf({ relation: "lies_in", chains: [] })).toBeUndefined();
    });

    it("🔴 mehrere Ketten werden EIN Baum: gemeinsame Vorfahren stehen einmal, die Kinder unter ihrem Elternteil", () => {
        const model = liesInOf(
            chains([
                [
                    ["a", "A"],
                    ["b", "B"],
                ],
                [
                    ["d", "D"],
                    ["e", "E"],
                ],
                [
                    ["a", "A"],
                    ["c", "C"],
                ],
            ]),
        );
        expect(model?.rows.map((row) => [row.depth, row.name])).toEqual([
            [0, "A"],
            [1, "B"],
            [1, "C"],
            [0, "D"],
            [1, "E"],
        ]);
    });

    it("eine lange Treppe wird ein Deckel mit der Zahl; eine kurze nicht", () => {
        const long = liesInOf(
            chains(
                Array.from({ length: STAIR_LID_FROM + 1 }, (_, index) => [
                    ["r", "Reich"],
                    [`k${String(index)}`, `K${String(index)}`],
                ]),
            ),
        );
        expect(long?.lid?.summary).toBe(`Liegt in ${String(STAIR_LID_FROM + 2)} politischen Gebieten`);
        expect(
            liesInOf(
                chains([
                    [
                        ["a", "A"],
                        ["b", "B"],
                    ],
                ]),
            )?.lid,
        ).toBeUndefined();
    });

    it("🔴 der Deckel kommt ab mehr als vier Zeilen (Betreiber 2026-10-04: „Klappbox erscheint schon bei >4“)", () => {
        expect(STAIR_LID_FROM).toBe(4);
        const rows = (count: number): [string, string][][] =>
            Array.from({ length: count }, (_, index) => [[`g${String(index)}`, `G${String(index)}`]]);
        expect(liesInOf(chains(rows(4)))?.lid).toBeUndefined();
        expect(liesInOf(chains(rows(5)))?.lid).toBeDefined();
    });

    it("🔴 der Deckelkopf nennt die Beziehung samt Zahl: „Erstreckt sich über 19 politische Gebiete“", () => {
        const overlap: ContextTerritories = {
            relation: "overlaps",
            chains: Array.from({ length: 19 }, (_, index) => [
                { ...territory(`g${String(index)}`, `G${String(index)}`), share: 0.05 },
            ]) as ContextTerritories["chains"],
        };
        expect(liesInOf(overlap)?.lid?.summary).toBe("Erstreckt sich über 19 politische Gebiete");
        setLocale("en");
        expect(liesInOf(overlap)?.lid?.summary).toBe("Extends across 19 political territories");
    });

    /**
     * Die Wappen der Treppe (WI-0094, Betreiber 2026-10-06: „in legacy sind die wappen als kleine thumbs immer vor den
     * territorien oder siedlungen, die ein wappen haben, kannst du das auch so machen?“). Gemessen an Legacy
     * (`settlementTerritoryCoatThumbMarkup`, `js/ui/popups.js`): ohne `coat_url` entsteht KEIN Bild und kein Platzhalter.
     */
    describe("Wappen in der Treppe", () => {
        const coat = (url: string): NonNullable<ContextTerritories["chains"][number][number]["coat"]> => ({
            id: "b2c4d6e8-1111-4222-8333-444455556666",
            role: "coat",
            url,
            width: 512,
            height: 640,
            mimeType: "image/webp",
        });

        it("ein Gebiet MIT Wappen trägt es in seiner Zeile - Adresse und Maße, sonst nichts", () => {
            const model = liesInOf({
                relation: "lies_in",
                chains: [[{ ...territory("a", "Garetien"), coat: coat("/media/aa/bb/wappen.webp") }]],
            });
            expect(model?.rows[0]?.coat).toEqual({ url: "/media/aa/bb/wappen.webp", width: 512, height: 640 });
        });

        it("🔴 ein Gebiet OHNE Wappen hat KEIN Feld - kein Loch, kein Platzhalter (wie Legacy)", () => {
            const model = liesInOf(chains([[["a", "A"]]]));
            expect(model?.rows[0]?.coat).toBeUndefined();
            expect(Object.keys(model?.rows[0] ?? {})).not.toContain("coat");
        });

        it("in einer gemischten Kette trägt nur die Zeile mit Wappen eines; die Reihenfolge bleibt", () => {
            const model = liesInOf({
                relation: "lies_in",
                chains: [
                    [
                        { ...territory("r", "Reich"), coat: coat("/media/11/22/reich.webp") },
                        territory("k", "Grafschaft"),
                        { ...territory("b", "Baronie"), coat: coat("/media/33/44/baronie.webp") },
                    ],
                ],
            });
            expect(model?.rows.map((row) => [row.name, row.coat?.url])).toEqual([
                ["Reich", "/media/11/22/reich.webp"],
                ["Grafschaft", undefined],
                ["Baronie", "/media/33/44/baronie.webp"],
            ]);
        });

        it("🔴 eine lange Treppe im Deckel behält ihre Wappen - der Deckel verdeckt nur, er kürzt nicht", () => {
            const model = liesInOf({
                relation: "lies_in",
                chains: Array.from({ length: STAIR_LID_FROM + 2 }, (_, index) => [
                    {
                        ...territory(`g${String(index)}`, `G${String(index)}`),
                        coat: coat(`/media/aa/bb/${index}.webp`),
                    },
                ]) as ContextTerritories["chains"],
            });
            expect(model?.lid).toBeDefined();
            expect(model?.rows).toHaveLength(STAIR_LID_FROM + 2);
            expect(model?.rows.every((row) => row.coat !== undefined)).toBe(true);
        });
    });

    it("die Überschrift trägt die Beziehung; der Anteil steht nur bei einer Überlappung", () => {
        const overlap: ContextTerritories = {
            relation: "overlaps",
            chains: [[{ ...territory("a", "A"), share: 0.5 }]],
        };
        expect(liesInOf(overlap)?.heading).toBe("Erstreckt sich über");
        expect(liesInOf(overlap)?.rows[0]?.share).toBe(" (50 %)");
        expect(liesInOf({ relation: "at_point", chains: [[{ ...territory("a", "A"), share: 0.5 }]] })?.heading).toBe(
            "An dieser Stelle",
        );
        expect(
            liesInOf({ relation: "lies_in", chains: [[{ ...territory("a", "A"), share: 1 }]] })?.rows[0]?.share,
        ).toBeUndefined();
    });
});
