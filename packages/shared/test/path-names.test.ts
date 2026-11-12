import { describe, expect, it } from "vitest";
import { isInPathChain, isPathHandle, pathReaderName, pathSearchHandlePattern } from "../src/path-names.ts";

/**
 * Die Griff-Erkennung der Wege (WI-0105). Gemessen am aktiven Bestand: 5.092 von 9.506 Wegen tragen einen
 * Griff, 4.414 einen echten Namen. Die Griffe unten stehen wirklich so in den Daten, die echten Namen sind,
 * wo vorhanden, ebenfalls gemessen.
 */
describe("Griffe der Wege erkennen", () => {
    // Jede der acht Arten einmal: Griff erkannt, echter Name unberührt. Die Zahl ist die gemessene Menge der
    // Griffe dieser Art im aktiven Bestand (Flussweg = Fluss 158 + Bach 161).
    const arten: [subtype: string, griff: string, name: string, griffe: number][] = [
        ["Pfad", "Pfad-3443", "Falkenstieg", 1989],
        ["Strasse", "Strasse-5097", "Falsche Reichsstraße", 727],
        ["Weg", "Weg-5118", "Gauweg", 577],
        ["Flussweg", "Flussweg-4487", "Retogauer Nebenfluss des Gardel 1", 319],
        ["Seeweg", "Meer-9281", "Hjölmrfjord", 1328],
        ["Reichsstrasse", "Reichsstrasse-115", "Reichsstraße 2", 12],
        ["Gebirgspass", "Gebirgspass-7449", "Wolfskopfpass", 126],
        ["Wuestenpfad", "Wueste-7", "Khôm-Pfad", 14],
    ];
    for (const [subtype, griff, name] of arten) {
        it(`${subtype}: „${griff}“ ist ein Griff, „${name}“ ein Name`, () => {
            expect(isPathHandle(griff, subtype)).toBe(true);
            expect(pathReaderName(griff, subtype)).toBeNull();
            expect(isPathHandle(name, subtype)).toBe(false);
            expect(pathReaderName(name, subtype)).toBe(name);
        });
    }

    it("die blanke Wegart ist kein Name - aber nur die EIGENE", () => {
        // 26 aktive Wege heißen blank wie ihre Art: 19 „Weg“, 4 „Pfad“, 3 „Gebirgspass“.
        expect(pathReaderName("Weg", "Weg")).toBeNull();
        expect(pathReaderName("Pfad", "Pfad")).toBeNull();
        expect(pathReaderName("Gebirgspass", "Gebirgspass")).toBeNull();
        // 🪤 Legacys Regel, absichtlich: Gegen SEINE Art ist „Weg“ an einem Pfad ein Name.
        expect(pathReaderName("Weg", "Pfad")).toBe("Weg");
    });

    it("der Griff einer FREMDEN Art ist auch einer: 38 aktive Wege tragen ihren alten", () => {
        // Gemessen: „Strasse-…“ an 7 Pfaden, „Flussweg-6029“ an einem Seeweg, „Reichsstrasse-5463“ an einem Weg.
        expect(pathReaderName("Strasse-6267", "Pfad")).toBeNull();
        expect(pathReaderName("Flussweg-6029", "Seeweg")).toBeNull();
        expect(pathReaderName("Reichsstrasse-5463", "Weg")).toBeNull();
        // Legacys eigener Fall: das Präfix „Meer“ an 1.095 Seewegen, das keine Wegart ist (der Name stammt aus
        // dem `inkscape:label` der gezeichneten Karte, Legacy `route-node.js` nennt „Meer-835“ wörtlich).
        expect(pathReaderName("Meer-9281", "Seeweg")).toBeNull();
        expect(pathReaderName("Wueste-7", "Wuestenpfad")).toBeNull();
    });

    it("leer und nur Leerzeichen sind kein Name; der Name wird getrimmt", () => {
        expect(pathReaderName("", "Weg")).toBeNull();
        expect(pathReaderName("   ", "Weg")).toBeNull();
        expect(pathReaderName("  Gauweg  ", "Weg")).toBe("Gauweg");
    });

    it("Groß- und Kleinschreibung: „pfad-1“ kommt im Bestand vor", () => {
        expect(pathReaderName("pfad-1", "Pfad")).toBeNull();
    });

    /**
     * 🔴 DIE GEFÄHRLICHE STELLE, gemessen statt vermutet: Ein Name, der WIE ein Griff aussieht, aber keiner
     * ist. Im aktiven Bestand gibt es ihn NICHT - kein einziger der 9.506 Wege endet auf `-<Zahl>`, ohne ein
     * bekannter Griff zu sein. Der Fall, den der Betreiber nennt („Reichsstraße-2“), steht in den Daten mit
     * LEERZEICHEN: „Reichsstraße 2“, 105 Abschnitte, dazu „Reichsstraße 1/3/6“.
     */
    it("ein Name mit Zahl am Ende bleibt ein Name, solange kein Bindestrich davor steht", () => {
        for (const name of [
            "Reichsstraße 1",
            "Reichsstraße 2",
            "Reichsstraße 3",
            "Reichsstraße 6",
            "Euplinger Stieg 2",
            "Nordauer Pfad 2",
            "Retogauer Nebenfluss des Gardel 1",
            "Schratentannstieg 2",
            "Zweifelsloher Salzstieg 2",
        ]) {
            expect(pathReaderName(name, "Reichsstrasse")).toBe(name);
        }
    });

    it("ein Bindestrich im Namen allein macht keinen Griff - die Zahl muss am Ende stehen", () => {
        for (const name of [
            "Bärenau-Eisingen-Reichsstrasse",
            "Pfad Fiskenau-Reichsstraße",
            "Weg Kronbrunn - Reichsstrasse",
            "Rudesruh-Ruhenstein",
            "Pfeffersbrunn - Dachsenau",
        ]) {
            expect(pathReaderName(name, "Pfad")).toBe(name);
        }
    });

    it("ein mehrteiliger Name mit Zahl am Ende ist kein Griff: der Griff ist EIN Wort", () => {
        // `^\S+-\d+$` verlangt ein Wort ohne Leerzeichen vor dem Bindestrich.
        expect(pathReaderName("Alter Weg-12", "Weg")).toBe("Alter Weg-12");
    });
});

describe("der Griff-Riegel der Suche", () => {
    const griff = new RegExp(pathSearchHandlePattern(), "iu");

    it("verbirgt den Griff JEDER Art, ohne Rücksicht auf die Schreibweise", () => {
        for (const name of ["Pfad-3443", " Strasse-5097 ", "Meer-9281", "pfad-1", "Wueste-7", "Flussweg-6029"]) {
            expect(griff.test(name)).toBe(true);
        }
    });

    it("lässt echte Namen stehen, auch die mit Zahl am Ende", () => {
        for (const name of [
            "Reichsstraße 2",
            "Gauweg",
            "Falkenstieg",
            "Bärenau-Eisingen-Reichsstrasse",
            "Alter Weg-12",
        ]) {
            expect(griff.test(name)).toBe(false);
        }
    });

    it("trifft den blanken Artnamen NICHT - der hängt an der Zeile, nicht am Muster", () => {
        expect(griff.test("Weg")).toBe(false);
        expect(isPathHandle("Weg", "Weg")).toBe(true);
    });
});

describe("wer zur Kette seines Namens gehört (Betreiber 2026-11-09: „Unbezeichneter Weg“ von Angbar bis Caldaia)", () => {
    it("🔴 der blanke Artname ist der Griff jedes Abschnitts dieser Art, keine Straße", () => {
        expect(isInPathChain("Weg", "Weg")).toBe(false);
        expect(isInPathChain("Strasse", "Strasse")).toBe(false);
        expect(isInPathChain(" Weg ", "Weg")).toBe(false);
        expect(isInPathChain("", "Weg")).toBe(false);
    });

    it("🪤 ein Pfad, der „Weg“ heißt, bleibt in seiner Kette, ebenso ein echter Name und ein alter Griff mit Zahl", () => {
        expect(isInPathChain("Weg", "Pfad")).toBe(true);
        expect(isInPathChain("Gauweg", "Weg")).toBe(true);
        // Ein Griff „Pfad-3443“ nennt meist genau einen Abschnitt (nach dem Teilen beide Hälften): Alte Links auf ihn tragen weiter.
        expect(isInPathChain("Pfad-3443", "Pfad")).toBe(true);
    });
});
