import { describe, expect, it } from "vitest";
import type { EditorPlaceRow } from "@avesmaps3d/shared";
import { ORTS_AUSWAHL_GRENZE, ortsAuswahl } from "../src/editor-liste/orts-auswahl";

/**
 * Die Ortsauswahl beim Verlagern einer Stätte (WI-0128 E10b). Problemfälle: Ein Wiki-Eintrag und ein Ort ohne Lage stehen in der
 * Ortsliste, sind aber kein Ziel (der Server lehnt beides ab); der Ort, an dem die Stätte schon liegt, ist keine Wahl; bei vielen
 * Treffern zählt die Zahl alle, gezeigt werden nur die ersten.
 */
const zeile = (ueber: Partial<EditorPlaceRow>): EditorPlaceRow => ({
    key: "e10e10e1-0000-4000-8000-000000000001",
    origin: "karte",
    name: "Gratenfels",
    circle: "voll",
    assignment: "assigned",
    ...ueber,
});

describe("ortsAuswahl", () => {
    const rows: EditorPlaceRow[] = [
        zeile({ key: "a", name: "Gratenfels", subtype: "stadt", region: "Kosch" }),
        zeile({ key: "b", name: "Gratenfelser Mühle", kind: "Mühle" }),
        zeile({ key: "wiki:gratenfelser-tor", origin: "wiki", name: "Gratenfelser Tor", circle: "leer" }),
        zeile({ key: "c", origin: "ohne-lage", name: "Gratenfels-Neu", circle: "leer" }),
        zeile({ key: "d", name: "Ferdok" }),
    ];

    it("🔴 nur Orte mit Kartenzeile, nie der eigene Ort", () => {
        const { zeilen, treffer } = ortsAuswahl(rows, "gratenfels", new Set(["a"]));
        expect(zeilen.map((z) => z.id)).toEqual(["b"]);
        expect(treffer).toBe(1);
    });

    it("die Unterzeile nennt Art oder Ortsgröße und die Lage, soweit bekannt", () => {
        const { zeilen } = ortsAuswahl(rows, "");
        expect(zeilen.find((z) => z.id === "a")?.unterzeile).toBe("stadt · Kosch");
        expect(zeilen.find((z) => z.id === "b")?.unterzeile).toBe("Mühle");
        expect(zeilen.find((z) => z.id === "d")?.unterzeile).toBe("");
    });

    it("die Suche ist unabhängig von Groß- und Kleinschreibung und schneidet Leerraum ab", () => {
        expect(ortsAuswahl(rows, "  FERDOK ").zeilen.map((z) => z.id)).toEqual(["d"]);
    });

    it("viele Treffer: gezeigt bis zur Grenze, gezählt alle", () => {
        const viele = Array.from({ length: ORTS_AUSWAHL_GRENZE + 7 }, (_, i) =>
            zeile({ key: `k${String(i)}`, name: `Ort ${String(i)}` }),
        );
        const { zeilen, treffer } = ortsAuswahl(viele, "ort");
        expect(zeilen).toHaveLength(ORTS_AUSWAHL_GRENZE);
        expect(treffer).toBe(ORTS_AUSWAHL_GRENZE + 7);
    });
});
