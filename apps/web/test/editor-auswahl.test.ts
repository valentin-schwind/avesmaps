import { describe, expect, it } from "vitest";
import { auswahlEndetMitFenster, auswahlEndetMitKachel, zugegangen } from "../src/editor-panel/editor-auswahl";

/** Die gelbe Auswahl eines Editors endet mit seinem letzten Fenster und seiner Kachel (`editor-panel/editor-auswahl.ts`). */
describe("Auswahl eines Editors", () => {
    it("🔴 das letzte Fenster der Derographie geht zu: eine Fläche endet, ein Gebiet nicht", () => {
        const zu = zugegangen(["landschaftseditor", "gebietseditor"], ["gebietseditor"]);
        expect(zu).toEqual(["landschaftseditor"]);
        expect(auswahlEndetMitFenster("area", zu)).toBe(true);
        expect(auswahlEndetMitFenster("peak", zu)).toBe(true);
        expect(auswahlEndetMitFenster("territory", zu)).toBe(false);
    });

    it("ein zweites Fenster desselben Editors bleibt offen: nichts endet", () => {
        expect(zugegangen(["landschaftseditor", "landschaftseditor"], ["landschaftseditor"])).toEqual([]);
    });

    it("🔴 die Kachel „Regionen“ wird verlassen: eine Fläche endet; ein gesuchtes Gebiet, dem die Kachel folgt, bleibt", () => {
        expect(auswahlEndetMitKachel("area", "regionen")).toBe(true);
        expect(auswahlEndetMitKachel("territory", "regionen")).toBe(false);
        expect(auswahlEndetMitKachel("place", "orte")).toBe(true);
        expect(auswahlEndetMitKachel("mapPoint", "regionen")).toBe(false);
        expect(auswahlEndetMitKachel(undefined, "regionen")).toBe(false);
    });
});
