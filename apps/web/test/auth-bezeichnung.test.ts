import { describe, expect, it } from "vitest";
import { BEZEICHNUNGEN, ROLES, SONDERROLLEN_NAMEN } from "@avesmaps3d/shared";
import { bezeichnungsWahlen, rollenName, sonderrollenName, sonderrollenZeilen } from "../src/auth/bezeichnung";
import { isMessageKey } from "../src/i18n/i18n";

/** Die Rollen in der Wortform der Person (WI-0279 E10). */
describe("Bezeichnung", () => {
    it("🔴 jede Rolle hat alle drei Wortformen in der Tafel", () => {
        for (const form of BEZEICHNUNGEN) {
            for (const rolle of ROLES) expect(isMessageKey(`auth.role.${rolle}.${form}`), rolle).toBe(true);
            for (const rolle of SONDERROLLEN_NAMEN)
                expect(isMessageKey(`auth.sonderrolle.${rolle}.${form}`), rolle).toBe(true);
        }
    });

    it("🔴 ohne Wahl steht die neutrale Form", () => {
        expect(rollenName("editor")).toBe("Editor:in");
        expect(rollenName("editor", null)).toBe("Editor:in");
        expect(rollenName("editor", "feminin")).toBe("Editorin");
        expect(rollenName("editor", "maskulin")).toBe("Editor");
        expect(sonderrollenName("ortskundiger", "feminin")).toBe("Ortskundige");
        expect(sonderrollenName("ortskundiger")).toBe("Ortskundige:r");
    });

    it("eine unbekannte Rolle steht als Wert da, statt zu verschwinden", () => {
        expect(rollenName("neu")).toBe("neu");
        expect(sonderrollenName("neu", "feminin")).toBe("neu");
    });

    it("🔴 die Regionen einer Rolle stehen zusammen, die Rollen in der Reihenfolge des Katalogs", () => {
        const zeilen = sonderrollenZeilen(
            [
                { sonderrolle: "kurator", region: null },
                { sonderrolle: "ortskundiger", region: "Greifenfurt" },
                { sonderrolle: "ortskundiger", region: "Weiden" },
                { sonderrolle: "unbekannt", region: null },
            ],
            "feminin",
        );
        expect(zeilen.map((zeile) => zeile.text)).toEqual(["Ortskundige (Greifenfurt, Weiden)", "Kuratorin"]);
        expect(sonderrollenZeilen(undefined, null)).toEqual([]);
    });

    it("🔴 die drei Knöpfe zeigen die eigene Wortform; wo die eigene Rolle nur eine hat, ein Beispiel", () => {
        expect(bezeichnungsWahlen("editor", []).map((wahl) => wahl.label)).toEqual(["Editor", "Editorin", "Editor:in"]);
        expect(bezeichnungsWahlen("admin", []).map((wahl) => wahl.label)).toEqual(["Editor", "Editorin", "Editor:in"]);
        expect(
            bezeichnungsWahlen("admin", [{ sonderrolle: "kurator", region: null }]).map((wahl) => wahl.label),
        ).toEqual(["Kurator", "Kuratorin", "Kurator:in"]);
        expect(bezeichnungsWahlen("editor", []).map((wahl) => wahl.value)).toEqual([...BEZEICHNUNGEN]);
    });
});
