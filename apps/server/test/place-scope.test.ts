import { describe, expect, it } from "vitest";
import { hatUmlandHinweis, lageAus, linksMitUmfeld, verknuepfe, type LageIndex } from "../src/editor/place-scope.ts";

/**
 * Legacys Innerorts-Regel über Wiki-Keys (WI-0128, Betreiber 2026-10-11; Legacy `api/_internal/wiki/__tests__/place-scope-test.php`, Mirror
 * `13d0183ab`). Die Fälle sind Legacys eigene, mit Keys statt Namen: Hier liefert „Legacy“ zu jedem Linkziel den Key `wiki:<ziel klein>`,
 * und der Index nennt Siedlungen und Gebiete über ihren Key.
 *
 * Problemfälle: Die gröbste Siedlung gewinnt nicht; ein Umland-Hinweis kippt die ganze Kette statt nur seinen Link; ein Stadtstaat
 * (Siedlung und Gebiet) verschwindet ganz oder wird nie unklar; ein Stadtviertel, das auf seine Stadt weiterleitet, macht die Stadt unklar.
 */

const SIEDLUNGEN = [
    "gareth",
    "elenvina",
    "albenhus",
    "h'rabaal",
    "yol-ghurmak",
    "mendlicum",
    "andergast",
    "punin",
    "fairnhain",
    "vinsalt",
    "beilunk",
    "abagund",
    "greifenfurt",
    "drôl",
    "ragath",
    "mengbilla",
    "khunchom",
    "paavi",
];
const GEBIETE = [
    "koschberge",
    "eisenwald",
    "grenzmark",
    "yaquirbruch",
    "almada",
    "bornland (region)",
    "festenland",
    "streitende königreiche",
    "albernia",
    "abagund",
    "greifenfurt",
    "königreich garetien",
    "fürstentum kosch",
    "brydia",
    "paavi",
    "drôl",
    "mittelaventurien",
    "trollzacken",
];
const keyVon = (ziel: string): string => `wiki:${ziel.trim().toLowerCase()}`;
const INDEX: LageIndex = {
    istSiedlung: (key) => SIEDLUNGEN.map(keyVon).includes(key),
    istGebiet: (key) => GEBIETE.map(keyVon).includes(key),
};
/** Wie die Kette mit Legacys Keys ankommt: je Link des Textes einer, in Reihenfolge. */
const geliefert = (raw: string) => linksMitUmfeld(raw).map((link) => ({ ziel: link.ziel, key: keyVon(link.ziel) }));
const urteil = (raw: string) => lageAus(verknuepfe(raw, geliefert(raw)), INDEX);
const lage = (raw: string) => urteil(raw).lage;

describe("Legacys Innerorts-Regel über Keys", () => {
    it("liest nur das Linkziel, nie die Anzeige, und behält die Reihenfolge", () => {
        expect(linksMitUmfeld("[[Koschberge]]: [[Greings Klamm]]").map((l) => l.ziel)).toEqual([
            "Koschberge",
            "Greings Klamm",
        ]);
        expect(linksMitUmfeld("[[Bornland (Region)|Bornland]]").map((l) => l.ziel)).toEqual(["Bornland (Region)"]);
        expect(linksMitUmfeld("[[Gareth]] ([[Alt-Gareth]])").map((l) => l.ziel)).toEqual(["Gareth", "Alt-Gareth"]);
    });

    it("🔴 eine Siedlung der Karte in der Kette heißt innerorts, und die gröbste gewinnt", () => {
        expect(urteil("[[Gareth]]: [[Arenaviertel (Alt-Gareth)|Arenaviertel]]")).toEqual({
            lage: "innerorts",
            siedlung: "wiki:gareth",
        });
        expect(urteil("[[Elenvina]]: [[Gülden]]: [[Akademie der Herrschaft]]").siedlung).toBe("wiki:elenvina");
        for (const raw of [
            "[[Albenhus]]: [[Oberstadt (Albenhus)|Oberstadt]]",
            "[[H'Rabaal]]",
            "[[Yol-Ghurmak]]",
            "[[Mendlicum]]",
        ]) {
            expect(lage(raw), raw).toBe("innerorts");
        }
    });

    it("ohne Siedlung in der Kette oder ohne Feld: außerorts", () => {
        for (const raw of [
            "[[Koschberge]]: [[Greings Klamm]]",
            "[[Eisenwald]]",
            "[[Bornland (Region)|Bornland]]: [[Festenland]]",
            "[[Ehernes Schwert]]",
            "[[Mittelaventurien]]: [[Trollzacken]]",
            "",
            "   ",
        ]) {
            expect(lage(raw), raw).toBe("ausserorts");
        }
    });

    it("🔴 ein Umland-Hinweis überspringt nur seinen Link", () => {
        expect(lage("[[Fairnhain]] (Umland)")).toBe("ausserorts");
        expect(lage("[[Streitende Königreiche]]: östlich von [[Andergast]]: südlich des [[Ingval]]")).toBe(
            "ausserorts",
        );
        expect(lage("[[Gareth]], unweit der Stadt")).toBe("ausserorts");
        expect(lage("bei [[Punin]]")).toBe("ausserorts");
        expect(lage("[[Vinsalt]] (außerhalb)")).toBe("ausserorts");
        expect(lage("[[Brydia]]: Umland von [[Paavi]]")).toBe("ausserorts");
        // Nur Punin fällt weg; Gareth danach zählt.
        expect(urteil("bei [[Punin]]: [[Gareth]]")).toEqual({ lage: "innerorts", siedlung: "wiki:gareth" });
        // „Beilunk“ beginnt mit „bei“, ein Hinweis im Stadtteil-Satz danach gilt nicht für Gareth.
        expect(lage("[[Beilunk]]")).toBe("innerorts");
        expect(lage("[[Gareth]]: [[Nordquartier]], im nördlichen Stadtteil")).toBe("innerorts");
        expect(hatUmlandHinweis("Rabei ", "")).toBe(false);
        expect(hatUmlandHinweis("", " bei Nacht")).toBe(false);
    });

    it("🔴 Siedlung UND Gebiet: vorn ohne folgendes Gebiet innerorts, sonst unklar", () => {
        expect(urteil("[[Albernia]]: [[Abagund]]")).toEqual({ lage: "unklar", siedlung: "wiki:abagund" });
        expect(lage("[[Albernia]]: [[Abagund]]: [[Irgendwo]]")).toBe("unklar");
        expect(urteil("[[Greifenfurt]]")).toEqual({ lage: "innerorts", siedlung: "wiki:greifenfurt" });
        expect(lage("[[Drôl]]")).toBe("innerorts");
        expect(lage("[[Greifenfurt]], [[Königreich Garetien]], [[Fürstentum Kosch]]")).toBe("unklar");
        expect(lage("[[Greifenfurt]], [[Albernia]]")).toBe("unklar");
        expect(lage("[[Greifenfurt]] ([[Marktviertel]])")).toBe("innerorts");
        expect(lage("bei [[Abagund]]")).toBe("ausserorts");
    });

    it("die gemessenen Problemzeilen (Straßen und Gassen)", () => {
        expect(lage("[[Gareth]] ([[Alt-Gareth]])")).toBe("innerorts");
        expect(urteil("[[Punin]] ([[Goldacker]])").siedlung).toBe("wiki:punin");
        expect(lage("[[Ragath]] <small>(Marktviertel)</small>")).toBe("innerorts");
        expect(lage("[[Mengbilla]] (Quad Basari)")).toBe("innerorts");
        expect(lage("[[Khunchom]]")).toBe("innerorts");
        expect(lage("[[Andergast]]")).toBe("innerorts");
        expect(lage("[[gareth]]")).toBe("innerorts");
        expect(lage("[[  Gareth  ]]")).toBe("innerorts");
    });

    it("🔴 ein Stadtviertel mit dem Key seiner Stadt (Weiterleitung) macht einen Stadtstaat nicht unklar", () => {
        const raw = "[[Paavi]]: [[Unterstadt]]";
        // Legacy liefert für „Unterstadt“ den Key der Stadt, weil der Artikel auf sie weiterleitet.
        const kette = verknuepfe(raw, [
            { ziel: "Paavi", key: "wiki:paavi" },
            { ziel: "Unterstadt", key: "wiki:paavi" },
        ]);
        expect(lageAus(kette, INDEX)).toEqual({ lage: "innerorts", siedlung: "wiki:paavi" });
        // Ein anderes Gebiet dahinter bleibt unklar wie bei Legacy.
        expect(lage("[[Paavi]]: [[Brydia]]")).toBe("unklar");
    });

    it("ordnet Legacys Keys den Links des Textes in Reihenfolge zu; was mehr kommt, wird übersprungen, ohne Key zählt ein Link nicht", () => {
        const raw = "[[Kosch (Region)|Kosch]]: [[Angbar]]:<br>{{Reg|Angbarer See}}";
        const kette = verknuepfe(raw, [
            { ziel: "Kosch (Region)", key: "wiki:kosch-region" },
            { ziel: "Angbarer See", key: "wiki:angbarer-see" },
            { ziel: "angbar", key: "wiki:angbar" },
        ]);
        expect(kette.map((link) => link.key)).toEqual(["wiki:kosch-region", "wiki:angbar"]);
        const ohneKey = verknuepfe("[[Gareth]]", [{ ziel: "Gareth", key: null }]);
        expect(lageAus(ohneKey, INDEX)).toEqual({ lage: "ausserorts" });
        // Ein Name allein macht nichts: ohne gelieferten Link kein Key, auch wenn „Gareth“ eine Siedlung ist.
        expect(lageAus(verknuepfe("[[Gareth]]", []), INDEX)).toEqual({ lage: "ausserorts" });
    });
});
