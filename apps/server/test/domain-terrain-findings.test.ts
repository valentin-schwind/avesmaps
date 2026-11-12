import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFindings, settleChecks } from "../src/blocking-checks.ts";
import { formatFindings } from "../src/findings.ts";
import { constraintFindings, constraintLines, riverGateFinding } from "../src/terrain/domain/constraint-findings.ts";
import { generateDomainTerrain } from "../src/terrain/domain/generate.ts";
import type { DomainInputs } from "../src/terrain/domain/inputs.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../src/terrain/domain/recipes.ts";

/**
 * Betreiber 2026-10-03 („A auch für die Prüfungen“): Seen eben, Gipfel exakt, Meer 0, Flüsse nicht bergauf und der Gipfelkern im
 * Meer halten die Ableitung des Höhenmodells nicht mehr an. Sie stehen als Befunde mit Zahlen und Objekten im Bericht
 * (`report.findings`), und das Raster wird trotzdem fertig.
 */

function polygon(x0: number, y0: number, x1: number, y1: number) {
    return {
        type: "Polygon",
        coordinates: [
            [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
                [x0, y0],
            ],
        ],
    };
}

function input(): DomainInputs {
    const continent = polygon(256, 256, 896, 896);
    return {
        continent: { id: "continent", fingerprint: "fixture", geometry: continent },
        land: [continent],
        water: [{ kind: "meer", geometry: polygon(0, 0, 256, 1024) }],
        seeds: [],
        peaks: [],
        landscapes: [],
        rivers: { rivers: [], lakes: [], fingerprint: "no-rivers" },
        fingerprint: "fixture",
    };
}

describe("Randbedingungen des Höhenmodells melden nur (Betreiber 2026-10-03)", () => {
    it("🔴 ein Gipfelkern im Meer hielt die Ableitung an („operator decision needed“): jetzt Befund, das Raster entsteht", () => {
        const source = input();
        // Das Land beginnt bei x = 256; die vier Kernzellen eines Gipfels bei x = 257 reichen in die erste Meerzelle.
        source.peaks = [{ id: "coast-peak", name: "Küstengipfel", x: 257, y: 500, h: 1200 }];
        const result = generateDomainTerrain(source, AVENTURIA_TERRAIN_RECIPE, 64);

        expect(result.raster.samples.length).toBe(64 * 64);
        const findings = result.report.findings ?? [];
        const core = findings.find((finding) => finding.code === "gelaende/gipfelkern_im_meer");
        expect(core, JSON.stringify(findings.map((f) => f.code))).toBeDefined();
        expect(core?.objects).toEqual([{ table: "terrain_peak", publicId: "coast-peak", name: "Küstengipfel" }]);
        // Die Endprüfung nennt das Ergebnis: Die Gipfelprojektion setzt die Kernzellen exakt, zwei davon liegen im Meer.
        const sea = findings.find((finding) => finding.code === "gelaende/meer_nicht_null");
        expect(sea?.numbers).toEqual({ zellen: 2 });
        expect(formatFindings(findings).join("\n")).toContain("terrain_peak coast-peak Küstengipfel");
    });

    it("🔴 ein Gipfel außerhalb des Rasters hielt als „Domain final constraint gate“ an: jetzt Befund mit Zahl und Namen", () => {
        const source = input();
        source.peaks = [{ id: "far-peak", name: "Ferngipfel", x: 5000, y: 5000, h: 900 }];
        const result = generateDomainTerrain(source, AVENTURIA_TERRAIN_RECIPE, 64);

        const exact = (result.report.findings ?? []).find((finding) => finding.code === "gelaende/gipfel_nicht_exakt");
        expect(exact?.numbers).toEqual({ gipfel: 1 });
        expect(exact?.objects).toEqual([{ table: "terrain_peak", publicId: "far-peak", name: "Ferngipfel" }]);
        expect(exact?.notes.join("\n")).toContain("Ferngipfel (far-peak): Soll 900 Schritt");
    });

    it("ohne Verstoß gibt es keine Befunde, und das Ergebnis bleibt bytegleich zum Lauf ohne Gipfel", () => {
        const result = generateDomainTerrain(input(), AVENTURIA_TERRAIN_RECIPE, 64);
        expect(result.report.findings).toEqual([]);
    });
});

describe("die Aktivierung verweigert nicht mehr wegen der Randbedingungen", () => {
    it("🔴 activate.ts prüft nur noch Eingaben und Kacheln, nicht mehr Seen, Gipfel, Meer und Flüsse", () => {
        const text = readFileSync(
            resolve(import.meta.dirname, "..", "src", "terrain", "domain", "activate.ts"),
            "utf8",
        );
        expect(text).not.toContain("verifyDomainRaster");
        expect(text).not.toContain("ignoredMarinePeaks");
        // Was bleibt: Eingaben aktuell und die Kacheln bytegleich zum Master (ein Zeiger geht nie auf etwas anderes).
        expect(text).toContain("verifyDomainPublication");
        expect(text).toContain("stale inputs or recipe");
    });

    it("🔴 generate.ts wirft für die Randbedingungen nicht mehr (kein „constraint gate“, kein „operator decision needed“)", () => {
        const text = readFileSync(
            resolve(import.meta.dirname, "..", "src", "terrain", "domain", "generate.ts"),
            "utf8",
        );
        expect(text).not.toContain("final constraint gate");
        expect(text).not.toContain("river constraint gate");
        expect(text).not.toContain("operator decision needed");
        expect(text).not.toContain("did not converge");
    });
});

describe("constraintFindings: die Fehlerzeilen der Endprüfung als Befunde", () => {
    const source = input();
    source.peaks = [{ id: "peak-1", name: "Gipfel Eins", x: 400, y: 400, h: 1500 }];
    source.water = [
        { kind: "meer", geometry: polygon(0, 0, 256, 1024) },
        { kind: "see", geometry: polygon(512, 512, 640, 640) },
    ];
    source.rivers = {
        rivers: [
            {
                id: "17",
                publicId: "0b6f6a52-6a0e-4f43-9d3a-6f1d6c2f0a17",
                name: "Aufwärtsbach",
                bach: true,
                direction: null,
                coordinates: [],
                coast: null,
            },
        ],
        lakes: [],
        fingerprint: "river",
    };

    it("nennt je Art Zahl und Objekte mit Tabelle, Kennung und Name", () => {
        const findings = constraintFindings(["sea:3", "lake:1:60..5000", "peak:peak-1", "river:17:829"], source);
        expect(findings.map((finding) => finding.code)).toEqual([
            "gelaende/meer_nicht_null",
            "gelaende/see_nicht_eben",
            "gelaende/gipfel_nicht_exakt",
            "gelaende/fluss_steigt",
        ]);
        expect(findings[0]?.numbers).toEqual({ zellen: 3 });
        expect(findings[1]?.objects).toEqual([
            { table: "region_area (See)", publicId: "Eingabe-Nr. 1", name: "Höhen 60..5000 Schritt" },
        ]);
        expect(findings[1]?.notes.join("\n")).toContain("erster Stützpunkt 512/512");
        expect(findings[2]?.objects).toEqual([{ table: "terrain_peak", publicId: "peak-1", name: "Gipfel Eins" }]);
        // 🔴 Die öffentliche Kennung des Weges, nie die interne `path.id` (WI-0131 §5.2): Der Prüfhaken „Flüsse bergaufwärts“
        // liest diesen Befund, und er gibt nur öffentliche Kennungen hinaus.
        expect(findings[3]?.objects).toEqual([
            { table: "path", publicId: "0b6f6a52-6a0e-4f43-9d3a-6f1d6c2f0a17", name: "Aufwärtsbach" },
        ]);
        expect(findings[3]?.notes).toEqual([
            "Aufwärtsbach (0b6f6a52-6a0e-4f43-9d3a-6f1d6c2f0a17): Anstieg 829 Schritt",
        ]);
        expect(constraintLines(["lake:1:60..5000"], source).join("\n")).toContain("See Nr. 1");
    });

    it("das Einbrennen, das nicht fertig wurde, nennt die ungelösten Flüsse", () => {
        const finding = riverGateFinding(
            {
                converged: false,
                unresolved: [{ id: "17", name: "Aufwärtsbach", value: 12 }],
                peakRises: [],
            },
            source,
        );
        expect(finding.code).toBe("gelaende/fluss_bergauf_ungeloest");
        expect(finding.objects).toEqual([
            { table: "path", publicId: "0b6f6a52-6a0e-4f43-9d3a-6f1d6c2f0a17", name: "Aufwärtsbach" },
        ]);
        expect(finding.message).toContain("NICHT abgeschlossen");
    });

    it("🔴 die Sammelprüfung Domain-Constraints kippt das Urteil des Prüfers nicht mehr, sie ist ein Befund mit Namen", () => {
        const errors = ["lake:1:60..5000", "peak:peak-1"];
        const settled = settleChecks("verify:domain-terrain", [
            {
                name: "Domain-Constraints",
                passed: false,
                detail: JSON.stringify({ errors }),
                offenders: constraintLines(errors, source),
            },
            { name: "Published DEM bytegleich", passed: true, detail: "[]" },
        ]);
        expect(settled.passed).toBe(true);
        const befunde = checkFindings("verify:domain-terrain", settled.checks, (check) => check.passed);
        expect(befunde.map((befund) => befund.code)).toEqual(["verify:domain-terrain/Domain-Constraints"]);
        expect(befunde[0]?.notes.join("\n")).toContain("Gipfel Eins (peak-1)");
    });
});
