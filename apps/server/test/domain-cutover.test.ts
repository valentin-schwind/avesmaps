import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Domain-Cutover: produktive Leser", () => {
    it("lädt im Router keine alten Raster, Gipfelkegel oder Kontinentalsockel aus der Datenbank", () => {
        const source = readFileSync(new URL("../src/routing/relief.ts", import.meta.url), "utf8");
        const loader = source.slice(source.indexOf("export async function loadTerrainHeights"));
        expect(loader).not.toMatch(/FROM terrain_raster|FROM terrain_peak|loadContinentalBase/);
    });

    it("leitet in der Importpipeline kein getrenntes visuelles Höhenprodukt mehr ab", () => {
        const source = readFileSync(new URL("../src/migration/legacy-update-cli.ts", import.meta.url), "utf8");
        expect(source).not.toMatch(/import \{ deriveVisualRelief|await deriveVisualRelief|await verifyVisualRelief/);
    });
});
