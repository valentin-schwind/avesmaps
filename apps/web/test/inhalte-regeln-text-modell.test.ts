import { beforeEach, describe, expect, it } from "vitest";
import type {
    InhalteRegelTextErgebnis,
    InhalteRegelTextProblem,
    InhalteRegelTextUebernommen,
} from "@avesmaps3d/shared";
import { locale } from "../src/i18n/i18n.ts";
import {
    TEXT_BEISPIEL,
    alleProbleme,
    haengeBlockAn,
    istAktuell,
    istUnberuehrt,
    planLeer,
    planZusaetze,
    uebernehmenText,
    uebernommenSatz,
    wendeErsatzAn,
    zeilenBereich,
    zeilenMarken,
    zeilenText,
} from "../src/inhalte/inhalte-regeln-text-modell.ts";

/**
 * Die Rechnung von „Regeln als Text“ im Reiter „Vorkommen“ (WI-0254 §13), ohne Vue: der Ersatz im Text, wann eine Vorschau „aktuell“ ist, die Zeichen hinter „Z. n“, das Anhängen des Blocks von „Als Text“, die Marken
 * der Zeilennummern und die Sätze zum Plan des Übernehmens. Gelesen und aufgelöst wird allein auf dem Server; die Steuerung prüft `inhalte-regeln-text-steuerung.test.ts`.
 *
 * - **Soll:** Ein Ersatz trifft genau die Stelle seiner Zeile, ein Block hängt hinter einer Leerzeile an (ein unberührter Text weicht), Fehler färben die Nummer vor einer Rückfrage.
 * - **Problemfälle:** ein Ersatz ins Leere (der Text ist seither anders) ändert nichts; Zeilen hinter dem Ende des Texts; ein Block mit nachlaufendem Leerraum.
 */
beforeEach(() => {
    locale.value = "de";
});

const problem = (teil: Partial<InhalteRegelTextProblem> = {}): InhalteRegelTextProblem => ({
    art: "rueckfrage",
    zeile: 0,
    von: 0,
    bis: 1,
    text: "Frage",
    optionen: [],
    ...teil,
});

const ergebnis = (teil: Partial<InhalteRegelTextErgebnis> = {}): InhalteRegelTextErgebnis => ({
    zahlen: { eintraege: 0, neu: 0, schon: 0, rueckfragen: 0, fehler: 0 },
    plan: { regeln: 0, eintraege: 0, quellen: 0, anlegen: 0 },
    eintraege: [],
    lose: [],
    rest: "",
    ...teil,
});

describe("Ersatz im Text", () => {
    it("ersetzt genau die Stelle seiner Zeile", () => {
        const text = "Alprute (Flora)\n| Verbreitung = [[Aeltikan]]\nAal";
        expect(wendeErsatzAn(text, { zeile: 1, von: 16, bis: 28, text: "[[#269be9c7|Aeltikan]]" })).toBe(
            "Alprute (Flora)\n| Verbreitung = [[#269be9c7|Aeltikan]]\nAal",
        );
    });

    it("lässt die anderen Zeilen unberührt, auch leere", () => {
        expect(wendeErsatzAn("a\n\nbcd", { zeile: 2, von: 1, bis: 2, text: "XY" })).toBe("a\n\nbXYd");
    });

    it("löscht mit leerem Ersatz und fügt mit leerer Stelle ein", () => {
        expect(wendeErsatzAn("abc", { zeile: 0, von: 1, bis: 2, text: "" })).toBe("ac");
        expect(wendeErsatzAn("abc", { zeile: 0, von: 3, bis: 3, text: " (wartet)" })).toBe("abc (wartet)");
    });

    it("🔴 ändert nichts, wo die Stelle nicht mehr passt (der Text ist seither anders)", () => {
        expect(wendeErsatzAn("abc", { zeile: 1, von: 0, bis: 1, text: "x" })).toBeUndefined();
        expect(wendeErsatzAn("abc", { zeile: 0, von: 2, bis: 9, text: "x" })).toBeUndefined();
        expect(wendeErsatzAn("abc", { zeile: 0, von: 2, bis: 1, text: "x" })).toBeUndefined();
    });
});

describe("Aktuell", () => {
    it("die Vorschau gehört nur zum Text, der geprüft wurde", () => {
        const erg = ergebnis();
        expect(istAktuell(erg, "abc", "abc")).toBe(true);
        expect(istAktuell(erg, "abc", "abcd")).toBe(false);
        expect(istAktuell(undefined, undefined, "")).toBe(false);
        expect(istAktuell(erg, undefined, "")).toBe(false);
    });
});

describe("Zeilen im Feld markieren", () => {
    const text = "eins\nzwei\ndrei\nvier";

    it("eine Zeile: vom Anfang bis zum Ende, ohne Zeilenumbruch", () => {
        expect(zeilenBereich(text, 1, 1)).toEqual({ anfang: 5, ende: 9 });
        expect(text.slice(5, 9)).toBe("zwei");
    });

    it("mehrere Zeilen schließen die Umbrüche dazwischen ein, nicht den letzten", () => {
        const { anfang, ende } = zeilenBereich(text, 1, 2);
        expect(text.slice(anfang, ende)).toBe("zwei\ndrei");
        expect(zeilenBereich(text, 0, 3)).toEqual({ anfang: 0, ende: text.length });
    });

    it("🪤 Zeilen hinter dem Ende zählen nicht; liegt der Anfang dahinter, ist der Bereich leer am Ende", () => {
        expect(zeilenBereich(text, 3, 9)).toEqual({ anfang: 15, ende: text.length });
        expect(zeilenBereich(text, 9, 9)).toEqual({ anfang: text.length, ende: text.length });
    });

    it("eine leere Zeile ist ein leerer Bereich an ihrer Stelle", () => {
        expect(zeilenBereich("a\n\nb", 1, 1)).toEqual({ anfang: 2, ende: 2 });
    });
});

describe("Als Text: der Block kommt in den Text", () => {
    const block = "Aal (Fauna)\n| Vorkommen = [[See]] oder [[Meer]]";

    it("ein leerer Text bekommt den Block, der Block beginnt in Zeile 0", () => {
        expect(haengeBlockAn("", block)).toEqual({ text: block, von: 0, bis: 1 });
        expect(haengeBlockAn("  \n", block).text).toBe(block);
    });

    it("das unberührte Beispiel weicht dem Block", () => {
        expect(istUnberuehrt(TEXT_BEISPIEL)).toBe(true);
        expect(haengeBlockAn(TEXT_BEISPIEL, block)).toEqual({ text: block, von: 0, bis: 1 });
    });

    it("eigener Text bleibt: der Block hängt hinter einer Leerzeile an, die Zeilen stimmen", () => {
        const eigener = "Quelle: [[Titel]]\nAlprute (Flora)\n";
        const neu = haengeBlockAn(eigener, `${block}\n\n`);
        expect(neu.text).toBe(`Quelle: [[Titel]]\nAlprute (Flora)\n\n${block}`);
        expect(neu.von).toBe(3);
        expect(neu.bis).toBe(4);
        expect(neu.text.split("\n").slice(neu.von, neu.bis + 1)).toEqual(block.split("\n"));
    });

    it("ein geänderter Beispieltext gilt als eigener Text", () => {
        expect(istUnberuehrt(`${TEXT_BEISPIEL}\nx`)).toBe(false);
    });
});

describe("Marken der Zeilennummern", () => {
    it("ohne Vorschau keine Marken", () => {
        expect(zeilenMarken(undefined).size).toBe(0);
    });

    it("sammelt die Befunde der Einträge, Regeln und der losen Zeilen; ein Fehler geht vor", () => {
        const erg = ergebnis({
            lose: [problem({ zeile: 0, art: "rueckfrage" })],
            eintraege: [
                {
                    zeile: 2,
                    name: "Aal",
                    neuAnlegen: false,
                    status: "rueckfrage",
                    probleme: [problem({ zeile: 2 })],
                    regeln: [
                        {
                            zeile: 3,
                            zeileBis: 3,
                            status: "fehler",
                            text: "x",
                            probleme: [problem({ zeile: 3, art: "fehler" }), problem({ zeile: 2, art: "fehler" })],
                        },
                        {
                            zeile: 4,
                            zeileBis: 4,
                            status: "rueckfrage",
                            text: "y",
                            probleme: [problem({ zeile: 4 }), problem({ zeile: 3, art: "rueckfrage" })],
                        },
                    ],
                },
            ],
        });
        expect(alleProbleme(erg)).toHaveLength(6);
        const marken = zeilenMarken(erg);
        expect([...marken.entries()].sort(([a], [b]) => a - b)).toEqual([
            [0, "frage"],
            [2, "fehler"],
            [3, "fehler"],
            [4, "frage"],
        ]);
    });
});

describe("Sätze zum Plan", () => {
    it("planLeer: nichts anzulegen, nichts an Quellen, nichts Neues", () => {
        expect(planLeer({ regeln: 0, eintraege: 0, quellen: 0, anlegen: 0 })).toBe(true);
        expect(planLeer({ regeln: 0, eintraege: 1, quellen: 1, anlegen: 0 })).toBe(false);
        expect(planLeer({ regeln: 0, eintraege: 1, quellen: 0, anlegen: 1 })).toBe(false);
    });

    it("die Aufschrift des Knopfs nennt Regeln und Einträge, in der Einzahl und Mehrzahl", () => {
        expect(uebernehmenText({ regeln: 3, eintraege: 3, quellen: 0, anlegen: 0 })).toBe(
            "Übernehmen (3 Regeln an 3 Einträgen)",
        );
        expect(uebernehmenText({ regeln: 1, eintraege: 1, quellen: 1, anlegen: 0 })).toBe(
            "Übernehmen (1 Regel an 1 Eintrag)",
        );
    });

    it("ohne Regeln nennt sie die Quelle, dann neue Einträge, sonst „nichts Neues“", () => {
        expect(uebernehmenText({ regeln: 0, eintraege: 2, quellen: 2, anlegen: 0 })).toBe(
            "Übernehmen (Quelle an 2 Einträgen)",
        );
        expect(uebernehmenText({ regeln: 0, eintraege: 1, quellen: 0, anlegen: 1 })).toBe(
            "Übernehmen (1 Eintrag anlegen)",
        );
        expect(uebernehmenText({ regeln: 0, eintraege: 0, quellen: 0, anlegen: 0 })).toBe("Übernehmen (nichts Neues)");
    });

    it("Zusätze unter dem Knopf nur dort, wo er sie nicht schon nennt", () => {
        expect(planZusaetze({ regeln: 3, eintraege: 3, quellen: 2, anlegen: 1 })).toEqual([
            "Dazu die Quelle an 2 Einträgen.",
            "Dazu 1 Eintrag neu anlegen.",
        ]);
        expect(planZusaetze({ regeln: 0, eintraege: 2, quellen: 2, anlegen: 0 })).toEqual([]);
    });

    it("die Pillen und der Knopf folgen der Sprache", () => {
        locale.value = "en";
        expect(uebernehmenText({ regeln: 2, eintraege: 1, quellen: 0, anlegen: 0 })).toBe("Apply (2 rules to 1 entry)");
        locale.value = "pl";
        expect(uebernehmenText({ regeln: 3, eintraege: 22, quellen: 0, anlegen: 0 })).toBe(
            "Przejmij (3 reguły przy 22 wpisach)",
        );
    });
});

describe("Der Satz nach dem Übernehmen", () => {
    const quittung = (teil: Partial<InhalteRegelTextUebernommen> = {}): InhalteRegelTextUebernommen => ({
        operationId: "00000000-0000-4000-8000-000000000001",
        status: "applied",
        environment: "test",
        affected: [],
        derivedWork: [],
        warnings: [],
        regeln: 3,
        eintraege: 2,
        quellen: 1,
        angelegt: 1,
        schon: 4,
        rest: "",
        ...teil,
    });

    it("nennt Regeln, Quellen, neue Einträge und was übersprungen wurde", () => {
        expect(uebernommenSatz(quittung(), false)).toBe(
            "3 Regeln an 2 Einträgen übernommen; Quelle an 1 Eintrag angehängt; 1 Eintrag neu angelegt; 4 gibt es schon, übersprungen.",
        );
    });

    it("ohne Regeln beginnt der Satz mit der Quelle, ohne alles mit „Nichts Neues“", () => {
        expect(uebernommenSatz(quittung({ regeln: 0, angelegt: 0, schon: 0 }), false)).toBe(
            "Quelle an 1 Eintrag angehängt.",
        );
        expect(uebernommenSatz(quittung({ regeln: 0, quellen: 0, angelegt: 0, schon: 0 }), false)).toBe(
            "Nichts Neues übernommen.",
        );
    });

    it("🪤 der erste Teil beginnt groß, auch wo die Sprache ihn klein schreibt", () => {
        locale.value = "en";
        expect(uebernommenSatz(quittung({ regeln: 0, angelegt: 0, schon: 0 }), false)).toBe(
            "Source attached to 1 entry.",
        );
    });

    it("ein offener Entwurf des gewählten Eintrags wird angekündigt", () => {
        const satz = uebernommenSatz(quittung({ schon: 0, angelegt: 0, quellen: 0 }), true);
        expect(satz.startsWith("3 Regeln an 2 Einträgen übernommen. ")).toBe(true);
        expect(satz).toContain("Konflikt");
    });
});

describe("Zeilen im Text zählen von 1 an", () => {
    it("eine Zeile oder ein Bereich", () => {
        expect(zeilenText(3, 3)).toBe("Z. 4");
        expect(zeilenText(4, 5)).toBe("Z. 5–6");
    });
});
