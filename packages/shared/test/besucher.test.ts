import { describe, expect, it } from "vitest";
import { BESUCH_METRIKEN, heutigeDimension, LEGACY_DIMENSIONEN, MAP_VIEWS } from "../src/index.ts";

/**
 * Legacys Werte auf die heutigen umgeschrieben (WI-0138; Betreiber 2026-10-13: „coole idee - so bauen“).
 *
 * Die Fälle sind die Zusagen der Tafel: jeder Zielwert existiert heute wirklich, jede Metrik ist eine gezählte, und was
 * Legacy gleich nannte, bleibt unangetastet.
 */
describe("Legacy-Ausprägungen", () => {
    it("schreibt Legacys Ansichtsnamen auf unsere um", () => {
        expect(heutigeDimension("map_mode", "deregraphic")).toBe("standard");
        expect(heutigeDimension("map_mode", "ecosystem")).toBe("landscapes");
    });

    it("lässt gleich benannte Werte unberührt", () => {
        expect(heutigeDimension("map_mode", "political")).toBe("political");
        expect(heutigeDimension("map_mode", "powerlines")).toBe("powerlines");
        expect(heutigeDimension("map_mode", "none")).toBe("none");
    });

    it("rührt eine Metrik ohne Altwerte nicht an", () => {
        // 🪤 Die Dauerkörbe sind Zahlen; eine Umschrift je Metrik darf sie nie treffen.
        expect(heutigeDimension("dauer", "40")).toBe("40");
        expect(heutigeDimension("geraet", "telefon")).toBe("telefon");
    });

    it("trifft bei den Ansichten nur heutige Schlüssel", () => {
        for (const ziel of Object.values(LEGACY_DIMENSIONEN["map_mode"] ?? {})) {
            expect(MAP_VIEWS).toContain(ziel);
        }
    });

    it("nennt nur Metriken, die wir auch zählen", () => {
        for (const metrik of Object.keys(LEGACY_DIMENSIONEN)) {
            expect(BESUCH_METRIKEN as readonly string[]).toContain(metrik);
        }
    });
});
