import { describe, expect, it } from "vitest";
import {
    filterZahl,
    gesetzteFilter,
    istLang,
    LANGER_ABSCHNITT,
    neueWahl,
    sichtbareAbschnitte,
    zahlEingabe,
    type FilterAbschnitt,
} from "../src/controls/avm-filterknopf.ts";

/**
 * Die Regeln des Filterknopfs (Betreiber 2026-10-11: „generell will ich immer allein das sortierung-symbol und das filter-symbol,
 * um platz zu sparen. beim draufklicken öffnet sich das menü mit den optionen.“), ohne Vue und ohne Browser.
 */

const ART: FilterAbschnitt = {
    id: "art",
    titel: "Art",
    art: "mehrere",
    werte: [
        { wert: "stadt", text: "Stadt", zahl: 12 },
        { wert: "dorf", text: "Dorf", zahl: 40 },
        { wert: "burg", text: "Burg", zahl: 3 },
    ],
};
const ROLLE: FilterAbschnitt = {
    id: "rolle",
    titel: "Rolle",
    art: "eins",
    werte: [
        { wert: "wappen", text: "Wappen" },
        { wert: "bild", text: "Bild" },
    ],
};

describe("Filterknopf", () => {
    it("🔴 die Zahl im Knopf zählt die gesetzten Werte über alle Abschnitte", () => {
        expect(filterZahl({})).toBe(0);
        expect(filterZahl({ art: [], rolle: [] })).toBe(0);
        expect(filterZahl({ art: ["stadt", "burg"], rolle: ["bild"] })).toBe(3);
    });

    it("🔴 ein Abschnitt mit EINER Wahl: ein Wert ersetzt den vorigen, „alle“ leert ihn", () => {
        expect(neueWahl(ROLLE, [], "bild", true)).toEqual(["bild"]);
        expect(neueWahl(ROLLE, ["bild"], "wappen", true)).toEqual(["wappen"]);
        expect(neueWahl(ROLLE, ["wappen"], undefined, true)).toEqual([]);
    });

    it("🔴 ein Abschnitt mit MEHREREN Werten: Kästchen setzen und lösen, in der Reihenfolge des Abschnitts", () => {
        expect(neueWahl(ART, [], "burg", true)).toEqual(["burg"]);
        expect(neueWahl(ART, ["burg"], "stadt", true)).toEqual(["stadt", "burg"]);
        expect(neueWahl(ART, ["stadt", "burg"], "stadt", false)).toEqual(["burg"]);
        expect(neueWahl(ART, ["burg"], "burg", true), "doppelt setzen ändert nichts").toEqual(["burg"]);
        expect(neueWahl(ART, ["stadt"], undefined, true), "„alle“ leert auch hier").toEqual([]);
    });

    it("ein Abschnitt ohne Werte erscheint nicht (Legacy `filter-menu.js`, Ortsliste)", () => {
        const leer: FilterAbschnitt = { id: "kontinent", titel: "Kontinent", art: "mehrere", werte: [] };
        expect(sichtbareAbschnitte([ART, leer, ROLLE]).map((abschnitt) => abschnitt.id)).toEqual(["art", "rolle"]);
    });
});

describe("Filterknopf: Abschnitt „bereich“ (von–bis)", () => {
    // Koordination 2026-10-11: der Zeitraum der Kataloge als eigene Art Abschnitt im Bauteil, nicht als Sonderfall einer Liste.
    const ZEITRAUM: FilterAbschnitt = {
        id: "jahre",
        titel: "Zeitraum",
        art: "bereich",
        werte: [],
        bereich: { min: 1003, max: 1043, von: null, bis: null },
    };

    it("🔴 erscheint auch ohne Werte, solange er einen Bereich hat", () => {
        expect(sichtbareAbschnitte([ZEITRAUM]).map((abschnitt) => abschnitt.id)).toEqual(["jahre"]);
        expect(sichtbareAbschnitte([{ ...ZEITRAUM, bereich: undefined }])).toEqual([]);
    });

    it("🔴 zählt als EIN gesetzter Filter, sobald eine Kante steht", () => {
        expect(gesetzteFilter([ZEITRAUM], {})).toBe(0);
        expect(gesetzteFilter([{ ...ZEITRAUM, bereich: { ...ZEITRAUM.bereich!, von: 1020 } }], {})).toBe(1);
        expect(
            gesetzteFilter([{ ...ZEITRAUM, bereich: { ...ZEITRAUM.bereich!, von: 1020, bis: 1030 } }], {
                art: ["a", "b"],
            }),
        ).toBe(3);
    });

    it("🔴 eine Eingabe ist eine ganze Zahl oder leer", () => {
        expect(zahlEingabe("1027")).toBe(1027);
        expect(zahlEingabe(" -5 ")).toBe(-5);
        expect(zahlEingabe("")).toBeNull();
        expect(zahlEingabe("abc")).toBeNull();
        expect(zahlEingabe("10.5")).toBe(10);
    });
});

describe("Filterknopf: Abschnitte verteilen sich gleichmäßig (WI-0206, EDIT-0003 T36)", () => {
    const werte = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ wert: `w${String(i)}`, text: `Wert ${String(i)}` }));

    it("🔴 ein Abschnitt mit mehr als zwölf Werten darf in die nächste Spalte weiterlaufen, ein kurzer nicht", () => {
        // Betreiber 2026-10-16: „eine zelle mit den gebäuden ist riesengroß“ - in der Ortsliste hat „Art“ 302 Werte.
        expect(istLang({ ...ART, werte: werte(302) })).toBe(true);
        expect(istLang({ ...ART, werte: werte(LANGER_ABSCHNITT + 1) })).toBe(true);
        expect(istLang({ ...ART, werte: werte(LANGER_ABSCHNITT) })).toBe(false);
        expect(istLang(ART)).toBe(false);
        expect(istLang({ ...ROLLE, werte: werte(40) })).toBe(true);
    });

    it("ein Bereich bleibt immer ganz: seine zwei Felder stehen auf einer Zeile", () => {
        expect(
            istLang({
                id: "zeit",
                titel: "Zeitraum",
                art: "bereich",
                werte: werte(40),
                bereich: { min: 0, max: 1, von: null, bis: null },
            }),
        ).toBe(false);
    });
});
