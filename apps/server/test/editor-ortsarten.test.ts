import { describe, expect, it } from "vitest";
import { ORTSARTEN_VERBORGEN, ortsartenMitZahl, waehlbareOrtsarten } from "../src/editor/ortsarten.ts";
import { BAUWERK_ARTEN_LEGACY } from "../src/wiki/kategorien/bauwerkarten.ts";

/**
 * Die Ortsarten zur Wahl im Feld „Art“ (WI-0295; Discord 2026-11-09: „Burg/Festung und Gut/Gutshof seh ich nimmie“). Problemfälle: Festung, Gut oder Gutshof
 * fehlen in der Liste; Ruine (ein Merkmal) oder eine lineare Anlage steht zur Wahl; die Liste folgt der Reihenfolge des WikiSync statt dem Alphabet; die Zahl
 * zählt anders als der Art-Filter der Ortsliste.
 */
describe("Ortsarten zur Wahl (WI-0295)", () => {
    it("🔴 Festung, Gut und Gutshof stehen zur Wahl, Ruine, Bauwerk und die linearen Anlagen nicht", () => {
        const arten = waehlbareOrtsarten();
        expect(arten).toEqual(expect.arrayContaining(["Festung", "Gut", "Gutshof", "Tempel", "Kloster", "Brücke"]));
        for (const nicht of [...ORTSARTEN_VERBORGEN, "Mauer", "Damm", "Deich", "Kanalisation", "Äquadukt"])
            expect(arten).not.toContain(nicht);
        // Alles Übrige des Katalogs bleibt: 108 Einträge, 2 verborgen, 5 linear.
        expect(BAUWERK_ARTEN_LEGACY).toHaveLength(108);
        expect(arten).toHaveLength(101);
        expect(new Set(arten).size).toBe(arten.length);
    });

    it("🔴 alphabetisch, nicht in der Reihenfolge des WikiSync (Legacy Fall #64), Umlaute an ihrem Platz", () => {
        const arten = waehlbareOrtsarten();
        expect(arten.slice(0, 4)).toEqual(["Akademie", "Amphitheater", "Archiv", "Arena"]);
        expect(arten.indexOf("Fährstation")).toBeLessThan(arten.indexOf("Fakultät"));
        expect(arten.indexOf("Hof")).toBeLessThan(arten.indexOf("Hof (Thorwal)"));
        expect(arten.indexOf("Höhle")).toBeGreaterThan(arten.indexOf("Hof (Thorwal)"));
    });

    it("🔴 die Zahl zählt genau wie der Art-Filter der Ortsliste; eine Art außerhalb des Katalogs zählt nicht mit, eine unbenutzte steht mit 0", () => {
        const { kinds } = ortsartenMitZahl([
            { kind: "Festung" },
            { kind: "Festung" },
            { kind: " Gutshof " },
            { kind: "Gasthaus" },
            {},
            { kind: "festung" },
        ]);
        const zahl = (art: string) => kinds.find((eintrag) => eintrag.kind === art)?.count;
        expect(zahl("Festung")).toBe(2);
        expect(zahl("Gutshof")).toBe(1);
        expect(zahl("Gut")).toBe(0);
        expect(kinds.map((eintrag) => eintrag.kind)).not.toContain("Gasthaus");
        expect(kinds).toHaveLength(101);
    });
});
