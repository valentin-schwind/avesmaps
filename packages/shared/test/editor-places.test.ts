import { describe, expect, it } from "vitest";
import { editorPlaceCircle, editorPlacePublicId } from "../src/index.ts";

/** Der Kreis der Ortsliste (WI-0128 E4, Legacy `avesmapsStatuskreisOrt`, `js/ui/listen-statuskreis.js:83-90`). */
describe("Kreis einer Zeile der Ortsliste", () => {
    it("🔴 nicht auf der Karte ○, auf der Karte ● mit Artikel, sonst ◐ - eine bloße Adresse zählt wie keine", () => {
        expect(editorPlaceCircle(false, "assigned")).toBe("leer");
        expect(editorPlaceCircle(true, "assigned")).toBe("voll");
        expect(editorPlaceCircle(true, "address_only")).toBe("halb");
        expect(editorPlaceCircle(true, "none")).toBe("halb");
        expect(editorPlaceCircle(true, "separated")).toBe("halb");
    });

    it("eine Wiki-Siedlung ohne Kartenpunkt hat keine Kennung eines Orts", () => {
        expect(editorPlacePublicId({ key: "wiki:gareth", origin: "wiki" })).toBeUndefined();
        expect(editorPlacePublicId({ key: "e4e4e4e4-0000-4000-8000-000000000001", origin: "karte" })).toBe(
            "e4e4e4e4-0000-4000-8000-000000000001",
        );
    });
});
