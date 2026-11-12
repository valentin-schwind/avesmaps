import { describe, expect, it } from "vitest";
import {
    HEADER_GRAPHICS,
    HEADER_GRAPHIC_LABELS,
    headerGraphicKeys,
    headerGraphicOf,
    headerGraphicOfLandmarke,
    headerGraphicOfLore,
    headerGraphicOfWetterSymbol,
} from "../src/header-graphics.ts";
import { istMahlstromArt, wetterSymbolTyp } from "../src/wetter/wiki.ts";

/**
 * Die Typbilder der Vorkommen (WI-0260; Betreiber 2026-10-30: „waren, fauna, flora, spezies headergrafiken. die sollen verwendet werden“): vier neue Kategorien neben den 38 der Kartenobjekte. Die Dateien selbst prüft
 * `apps/web/test/header-graphic.test.ts` (jede Kategorie ist eine Datei, keine Datei ohne Kategorie); hier steht die Zuordnung Art -> Kategorie.
 *
 * Problemfälle: eine Art, die es nicht gibt, darf nie das Bild einer anderen Art zeigen (Rückfall auf das allgemeine); die Kategorie `ware` darf nicht mit einem Wort der Orte oder Wege zusammenfallen;
 * der Medien-Trichter („Objektart“) kennt für sie keinen eigenen Wert und führt sie unter „übrige“.
 */
describe("Typbilder der Vorkommen", () => {
    it("die vier Kategorien stehen in der Liste, jede einmal, und tragen ein deutsches Wort", () => {
        for (const kategorie of ["flora", "fauna", "ware", "spezies"] as const) {
            expect(
                HEADER_GRAPHICS.filter((name) => name === kategorie),
                kategorie,
            ).toHaveLength(1);
        }
        expect(HEADER_GRAPHIC_LABELS.flora).toBe("Flora");
        expect(HEADER_GRAPHIC_LABELS.fauna).toBe("Fauna");
        expect(HEADER_GRAPHIC_LABELS.ware).toBe("Ware");
        expect(HEADER_GRAPHIC_LABELS.spezies).toBe("Spezies");
        // Jede Kategorie der Liste hat ihr Wort und keine Doppelung (die Medienverwaltung listet beide Tafeln nebeneinander).
        expect(new Set(HEADER_GRAPHICS).size).toBe(HEADER_GRAPHICS.length);
        expect(Object.keys(HEADER_GRAPHIC_LABELS).sort()).toEqual([...HEADER_GRAPHICS].sort());
        // 38 Kategorien der Kartenobjekte, die vier der Vorkommen, das Sammelbild „Vorkommen“ (WI-0257 S5), die Sprachen (WI-0261 S5b), elf
        // Landmarkenarten (WI-0271 L6; Berggipfel und Hügel hatten ihr Bild schon, Geysir und Klippe leihen eins), die vier der Wetter-Icons (WI-0288)
        // und die vier Vegetationsarten aus WI-0301 (Bergtundra, Heideland, Ödland, Savanne; eigene Bilder seit 2026-11-10).
        expect(HEADER_GRAPHICS).toHaveLength(38 + 4 + 1 + 1 + 11 + 4 + 4);
    });

    it("🔴 ein Eintrag zeigt das Typbild seiner Art; eine unbekannte Art das allgemeine, nie das einer anderen", () => {
        expect(["flora", "fauna", "ware", "spezies"].map((art) => headerGraphicOf("loreEntry", art))).toEqual([
            "flora",
            "fauna",
            "ware",
            "spezies",
        ]);
        expect(["flora", "fauna", "ware", "spezies"].map(headerGraphicOfLore)).toEqual([
            "flora",
            "fauna",
            "ware",
            "spezies",
        ]);
        expect(headerGraphicOf("loreEntry", undefined)).toBe("region");
        expect(headerGraphicOf("loreEntry", "pilz")).toBe("region");
        expect(headerGraphicOfLore("")).toBe("region");
    });

    it("die Zuordnung der Kartenobjekte bleibt, wie sie war", () => {
        expect(headerGraphicOf("place", "dorf")).toBe("dorf");
        expect(headerGraphicOf("area", "wald")).toBe("wald");
        expect(headerGraphicOf("path", "Weg")).toBe("weg");
        expect(headerGraphicOf("territory", undefined)).toBe("gebiet");
        expect(headerGraphicOf("climate", undefined)).toBe("region");
        expect(headerGraphicOf("mapPoint", undefined)).toBe("region");
        expect(headerGraphicOf("powerline", undefined)).toBe("kraftlinien");
    });

    it("🔴 `headerGraphicKeys`: die vier zählen zu „übrige“ und nennen ihre Art; die übrigen Objektarten ändern sich nicht", () => {
        expect(headerGraphicKeys("flora")).toEqual({ objects: "other", keys: ["flora"] });
        expect(headerGraphicKeys("fauna")).toEqual({ objects: "other", keys: ["fauna"] });
        expect(headerGraphicKeys("ware")).toEqual({ objects: "other", keys: ["ware"] });
        expect(headerGraphicKeys("spezies")).toEqual({ objects: "other", keys: ["spezies"] });
        expect(headerGraphicKeys("dorf")).toEqual({ objects: "place", keys: ["dorf"] });
        expect(headerGraphicKeys("weg")).toEqual({ objects: "path", keys: ["Weg"] });
        expect(headerGraphicKeys("wald").objects).toBe("landscape");
        // Gebiet, Kraftlinien und das allgemeine Bild haben keinen Schlüssel.
        expect(headerGraphicKeys("gebiet")).toEqual({ objects: "other", keys: [] });
        expect(headerGraphicKeys("kraftlinien")).toEqual({ objects: "other", keys: [] });
        expect(headerGraphicKeys("region")).toEqual({ objects: "other", keys: [] });
    });
});

/**
 * Die Typbilder der Wetter-Icons mit Wiki-Verweis (WI-0288; Valis Bilder vom 2026-11-08): Wind, Wirbelsturm, Meeresströmung und Mahlstrom. Der Typ eines Icons ist seine Art,
 * bei einem Mahlstrom-Artikel „mahlstrom“ (`wetterSymbolTyp`); der Server nennt ihn im Untertitel, der Kopf wählt danach das Bild.
 *
 * Problemfälle: Ein Wirbel mit Mahlstrom-Artikel zeigt den Wirbelsturm; ein Mahlstrom als Landmarke (Strudel) verliert sein Bild an die neue Kategorie; eine fremde Art
 * zeigt das Bild einer anderen; ein Artikel, der „Mahlstrom“ nur im Titel trägt, gilt als Mahlstrom.
 */
describe("Typbilder der Wetter-Icons", () => {
    it("die vier Kategorien stehen in der Liste, jede einmal, und tragen ihr deutsches Wort", () => {
        for (const kategorie of ["wind", "wirbelsturm", "meeresstroemung", "mahlstrom"] as const) {
            expect(
                HEADER_GRAPHICS.filter((name) => name === kategorie),
                kategorie,
            ).toHaveLength(1);
        }
        expect(HEADER_GRAPHIC_LABELS.wind).toBe("Wind");
        expect(HEADER_GRAPHIC_LABELS.wirbelsturm).toBe("Wirbelsturm");
        expect(HEADER_GRAPHIC_LABELS.meeresstroemung).toBe("Meeresströmung");
        expect(HEADER_GRAPHIC_LABELS.mahlstrom).toBe("Mahlstrom");
        // Die Liste bleibt nach dem Alphabet geordnet: Die Medienverwaltung zeigt sie in dieser Folge.
        expect([...HEADER_GRAPHICS]).toEqual([...HEADER_GRAPHICS].sort());
    });

    it("🔴 die Art des Icons wählt das Bild, ein Mahlstrom-Artikel den Mahlstrom", () => {
        expect(["wind", "wirbel", "stroemung"].map((art) => headerGraphicOf("wetterSymbol", art))).toEqual([
            "wind",
            "wirbelsturm",
            "meeresstroemung",
        ]);
        expect(wetterSymbolTyp("wind", "Wind")).toBe("wind");
        expect(wetterSymbolTyp("stroemung", "Meeresströmung")).toBe("stroemung");
        expect(wetterSymbolTyp("wirbel", "Mahlstrom (Strömung)")).toBe("mahlstrom");
        expect(wetterSymbolTyp("stroemung", "Mahlstrom")).toBe("mahlstrom");
        expect(wetterSymbolTyp("wirbel", undefined)).toBe("wirbel");
        // Die Art „mahlstrom“ (0327) hat ihr Typbild immer, auch ohne Artikel.
        expect(wetterSymbolTyp("mahlstrom", undefined)).toBe("mahlstrom");
        expect(headerGraphicOf("wetterSymbol", wetterSymbolTyp("mahlstrom", "Wind"))).toBe("mahlstrom");
        expect(headerGraphicOf("wetterSymbol", wetterSymbolTyp("wirbel", "Mahlstrom (Strömung)"))).toBe("mahlstrom");
        // Nur die Art zählt, nie der Titel oder ein Teil davon.
        expect(istMahlstromArt("Mahlstromkunde")).toBe(false);
        expect(istMahlstromArt(null)).toBe(false);
    });

    it("eine unbekannte Art zeigt das allgemeine Bild; die Landmarke Strudel behält ihres", () => {
        expect(headerGraphicOf("wetterSymbol", undefined)).toBe("region");
        expect(headerGraphicOfWetterSymbol("hagel")).toBe("region");
        expect(headerGraphicOf("peak", "strudel")).toBe("strudel");
        expect(headerGraphicOfLandmarke("strudel")).toBe("strudel");
    });

    it("`headerGraphicKeys`: die vier zählen zu „übrige“ und nennen ihren Typ", () => {
        expect(headerGraphicKeys("wind")).toEqual({ objects: "other", keys: ["wind"] });
        expect(headerGraphicKeys("wirbelsturm")).toEqual({ objects: "other", keys: ["wirbel"] });
        expect(headerGraphicKeys("meeresstroemung")).toEqual({ objects: "other", keys: ["stroemung"] });
        expect(headerGraphicKeys("mahlstrom")).toEqual({ objects: "other", keys: ["mahlstrom"] });
        expect(headerGraphicKeys("strudel")).toEqual({ objects: "other", keys: [] });
    });
});
