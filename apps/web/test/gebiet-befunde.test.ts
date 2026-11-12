import { describe, expect, it } from "vitest";
import type { EditorTerritoryFindings } from "@avesmaps3d/shared";
import { befundText, befundZahlen, befundeDes } from "../src/gebietseditor/befunde.ts";

/**
 * „Prüfen“ im Gebietseditor (WI-0209 D6; EDIT-0005 §7 D6: „jeder Befund einmal, keiner sperrt“): die Befunde eines Gebiets in fester
 * Folge und als Satz. Gerechnet werden sie am Server (`apps/server/test/territory-findings.test.ts`).
 *
 * Problemfälle: Die Befunde eines anderen Gebiets stehen beim gewählten; ein Satz fehlt für eine Art; Sitz und Hauptstadt sind nicht zu
 * unterscheiden; eine kleine Überlappung steht als 0 E² da.
 */

const A = "d6000000-0000-4000-8000-000000000001";
const B = "d6000000-0000-4000-8000-000000000002";
const P = "d6000000-0000-4000-8000-0000000000c1";

const BEFUNDE: EditorTerritoryFindings = {
    yearBf: 1049,
    findings: [
        { territory: A, kind: "hauptstadt", place: P },
        { territory: B, kind: "platzhalter" },
        { territory: A, kind: "ueberlappung", other: { id: B, name: "Fremdland" }, size: 0.004 },
        { territory: A, kind: "luecke", bands: [4, 5] },
        { territory: A, kind: "verweis", field: "seat", place: P },
        { territory: A, kind: "n2", area: P, bands: [4] },
        { territory: B, kind: "ungueltig", area: P },
    ],
};

describe("Prüfen: die Befunde eines Gebiets", () => {
    it("🔴 nur die eigenen, in fester Folge; die Zahl je Gebiet für die Liste", () => {
        expect(befundeDes(BEFUNDE, A).map((b) => b.kind)).toEqual([
            "n2",
            "luecke",
            "ueberlappung",
            "verweis",
            "hauptstadt",
        ]);
        expect(befundeDes(BEFUNDE, B).map((b) => b.kind)).toEqual(["platzhalter", "ungueltig"]);
        expect(befundeDes(undefined, A)).toEqual([]);
        expect([...befundZahlen(BEFUNDE)]).toEqual([
            [A, 5],
            [B, 2],
        ]);
    });

    it("🔴 je Art ein Satz: Bänder, das andere Gebiet mit Größe, Sitz und Hauptstadt getrennt", () => {
        const saetze = befundeDes(BEFUNDE, A).map(befundText);
        expect(saetze[0]).toContain("Band 4");
        expect(saetze[1]).toBe("Lücke: In Band 4, 5 zeigt eine eigene Fläche nichts.");
        expect(saetze[2]).toBe("Überlappt „Fremdland“ (0,004 E²); ausgeschnitten wird nicht.");
        expect(saetze[3]).toBe("Der Herrschaftssitz zeigt auf einen Ort, den es nicht mehr gibt.");
        expect(saetze[4]).toBe("Die Hauptstadt liegt außerhalb des Gebiets.");
        expect(befundeDes(BEFUNDE, B).map(befundText)).toEqual([
            "Der Name ist Legacys Platzhalter beim Anlegen („Neues Herrschaftsgebiet“).",
            "Eine Fläche ist ungültig (sie schneidet sich selbst); die Ableitung repariert sie beim Lesen.",
        ]);
    });
});
