import { describe, expect, it } from "vitest";
import { LANDMARKEN_ARTEN } from "@avesmaps3d/shared";
import { ARTEN_MIT_BILD, LANDMARKEN_ZEICHEN, landmarkenBild, landmarkenBildId } from "../src/map/landmarken-zeichen.ts";
import { RUNTIME_IMAGES } from "../src/map/runtime-images.ts";
import { buildPeakLayer, PEAK_TRIANGLE_IMAGE_ID } from "../src/map/topography-layers.ts";

/**
 * Die Kartenzeichen der Landmarken (WI-0271 L5, Symbolkonzept §6): jede Art des Katalogs hat eine Form und ein eigenes Laufzeitbild, auch der
 * Berggipfel (seit 2026-11-01 so groß wie die übrigen), und die Ebene der Gipfel wählt es nach der Art der Kachel. Ohne Browser (das Zeichnen selbst prüft der Browserfall).
 *
 * Problemfälle: Eine neue Art im Katalog hat kein Zeichen (die Karte zeigte dann gar nichts, MapLibre meldet ein fehlendes Bild nur leise); eine
 * Höhle sähe aus wie ein Berg; der Berggipfel verlöre sein Dreieck.
 */
describe("Kartenzeichen der Landmarken (WI-0271 L5)", () => {
    it("🔴 jede Art des Katalogs hat eine Form und ein eigenes Laufzeitbild, auch der Berggipfel (Vali 2026-11-01: „Gleich groß“)", () => {
        expect(Object.keys(LANDMARKEN_ZEICHEN).sort()).toEqual([...LANDMARKEN_ARTEN].sort());
        for (const art of LANDMARKEN_ARTEN) expect(LANDMARKEN_ZEICHEN[art].length, art).toBeGreaterThan(0);
        expect([...ARTEN_MIT_BILD]).toEqual([...LANDMARKEN_ARTEN]);
        const angemeldet = RUNTIME_IMAGES.map(([id]) => id);
        for (const art of ARTEN_MIT_BILD) expect(angemeldet).toContain(landmarkenBildId(art));
        expect(angemeldet).toContain(PEAK_TRIANGLE_IMAGE_ID);
    });

    it("🔴 die Ebene der Gipfel wählt das Bild nach `subtype`, der Berggipfel sein großes; nur eine unbekannte Art zeigt das kleine Dreieck", () => {
        const ausdruck = landmarkenBild(PEAK_TRIANGLE_IMAGE_ID) as unknown as unknown[];
        expect(ausdruck.slice(0, 2)).toEqual(["match", ["get", "subtype"]]);
        expect(ausdruck.at(-1)).toBe(PEAK_TRIANGLE_IMAGE_ID);
        expect(ausdruck).toContain("hoehle");
        expect(ausdruck).toContain(landmarkenBildId("hoehle"));
        expect(ausdruck).toContain(landmarkenBildId("berggipfel"));
        const ebene = buildPeakLayer("Test", "heights", "de");
        expect(JSON.stringify(ebene.layout?.["icon-image"])).toContain(landmarkenBildId("quelle"));
    });
});
