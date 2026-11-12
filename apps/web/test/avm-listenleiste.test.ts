import { describe, expect, it } from "vitest";
import { suchStufe, suchtreffer } from "../src/controls/avm-listenleiste.ts";

/** Die Regeln der Leiste jeder Liste ohne Vue (`avm-listenleiste.ts`, Design Guide §13.45). */
describe("Leiste jeder Liste", () => {
    it("die Suche: jedes Wort, gleich in welcher Schreibweise; leer trifft alles", () => {
        expect(suchtreffer("Tal der Finsternis", "FINSTER tal")).toBe(true);
        expect(suchtreffer("Tal der Finsternis", "tal gareth")).toBe(false);
        expect(suchtreffer("Tal der Finsternis", "")).toBe(true);
    });

    it("🔴 der Platz entscheidet: voller Platzhalter, sonst „Suchen …“, sonst der Lupen-Knopf; nie abgeschnitten", () => {
        // Freie Breite für Text, Breite des vollen und des kurzen Platzhalters.
        expect(suchStufe(200, 150, 60)).toBe("voll");
        expect(suchStufe(150, 150, 60)).toBe("voll");
        expect(suchStufe(149, 150, 60)).toBe("kurz");
        expect(suchStufe(60, 150, 60)).toBe("kurz");
        expect(suchStufe(59, 150, 60)).toBe("knopf");
        expect(suchStufe(-20, 150, 60)).toBe("knopf");
    });
});
