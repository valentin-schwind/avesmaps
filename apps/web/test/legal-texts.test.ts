import { describe, expect, it } from "vitest";
import { AVENTURIA_SERIES, getMapSeries } from "@avesmaps3d/shared";
import { licenseTexts, seriesTexts } from "../src/legal/legal-texts.ts";

/**
 * Lizenz und Herkunft der Kartenserien in der Sprache des Lesers (WI-0032 Stufe 3). Die Hinweise selbst prüfen `hinweise-dokument.test.ts` und `hinweise-sprachen.test.ts`.
 */

describe("Die Rechtstexte der Kartenserien", () => {
    it("Deutsch liest die bisherigen Felder", () => {
        expect(licenseTexts(AVENTURIA_SERIES.license, "de").name).toBe("Lizenzvereinbarung zum Ulisses-Kartenpaket");
        expect(seriesTexts(getMapSeries("original"), "de").permission).toContain("Die Verwendung für Avesmaps");
    });

    it("Englisch liest `en`, eine Sprache ohne eigene Fassung die englische", () => {
        expect(licenseTexts(AVENTURIA_SERIES.license, "en").name).toBe("Licence agreement for the Ulisses Kartenpaket");
        expect(seriesTexts(getMapSeries("original"), "en").attribution).toContain("Original map: Ina Kramer");
        expect(licenseTexts(AVENTURIA_SERIES.license, "fr")).toEqual(licenseTexts(AVENTURIA_SERIES.license, "en"));
    });
});
