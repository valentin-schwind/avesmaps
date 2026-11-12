import { describe, expect, it } from "vitest";
import {
    auswahlOptionen,
    bereichVon,
    eintragName,
    naechsterFokus,
    unterzeile,
    verweise,
    type SchienenBereich,
} from "../src/fenster/fenster-schiene.ts";

/**
 * Was die Schiene eines Fensters rechnet (Guide §13.12, WI-0127 SYS-1): Beschriftung mit Zählung, Unterzeile eines zugeklappten
 * Bereichs, die Auswahl am Telefon (Blatt WI-0119 Fassung 2, A4) und die Pfeiltasten.
 */
const BEREICHE: SchienenBereich[] = [
    {
        id: "personen",
        name: "Personen & Sicherheit",
        eintraege: [
            { id: "personen", name: "Personen", art: "ansicht", zahl: 7 },
            { id: "protokoll", name: "Protokoll", art: "ansicht" },
        ],
    },
    {
        id: "system",
        name: "System & Betrieb",
        eintraege: [
            { id: "backup", name: "Backups", art: "ansicht" },
            { id: "statusseite", name: "Statusseite", art: "verweis", href: "/status.html" },
            { id: "claudio", name: "Claudio", art: "spaeter", wert: "später" },
        ],
    },
];

describe("Schiene", () => {
    it("eine Zählung steht in Klammern in der Beschriftung, die Unterzeile nennt die Einträge ohne Zählung", () => {
        expect(eintragName({ id: "personen", name: "Personen", art: "ansicht", zahl: 7 })).toBe("Personen (7)");
        expect(eintragName({ id: "protokoll", name: "Protokoll", art: "ansicht" })).toBe("Protokoll");
        expect(unterzeile(BEREICHE[0]!)).toBe("Personen, Protokoll");
        expect(unterzeile(BEREICHE[1]!)).toBe("Backups, Statusseite, Claudio");
    });

    it("aufgeklappt ist der Bereich des gewählten Eintrags", () => {
        expect(bereichVon(BEREICHE, "backup")).toBe("system");
        expect(bereichVon(BEREICHE, "protokoll")).toBe("personen");
        expect(bereichVon(BEREICHE, "unbekannt")).toBeUndefined();
    });

    it("🔴 am Telefon „Bereich › Eintrag“, ein späterer Eintrag gesperrt, ein Verweis daneben statt darin", () => {
        expect(auswahlOptionen(BEREICHE)).toEqual([
            { wert: "personen", text: "Personen & Sicherheit › Personen (7)" },
            { wert: "protokoll", text: "Personen & Sicherheit › Protokoll" },
            { wert: "backup", text: "System & Betrieb › Backups" },
            { wert: "claudio", text: "System & Betrieb › Claudio (später)", gesperrt: true },
        ]);
        expect(verweise(BEREICHE).map((eintrag) => eintrag.href)).toEqual(["/status.html"]);
    });

    it("↓ ↑ wandern im Kreis, Pos1 und Ende springen, andere Tasten bleiben dem Knopf", () => {
        expect(naechsterFokus("ArrowDown", 0, 4)).toBe(1);
        expect(naechsterFokus("ArrowDown", 3, 4)).toBe(0);
        expect(naechsterFokus("ArrowUp", 0, 4)).toBe(3);
        expect(naechsterFokus("ArrowDown", -1, 4)).toBe(0);
        expect(naechsterFokus("ArrowUp", -1, 4)).toBe(3);
        expect(naechsterFokus("Home", 2, 4)).toBe(0);
        expect(naechsterFokus("End", 0, 4)).toBe(3);
        expect(naechsterFokus("Enter", 1, 4)).toBeNull();
        expect(naechsterFokus("ArrowDown", 0, 0)).toBeNull();
    });
});
