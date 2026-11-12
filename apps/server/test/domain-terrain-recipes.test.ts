import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { TREFFEN } from "@avesmaps3d/shared";
import {
    AVENTURIA_TERRAIN_RECIPE,
    AVENTURIA_TERRAIN_RECIPES,
    AVENTURIA_TERRAIN_SELECTION,
    loadTerrainRecipes,
    parseTerrainRecipe,
    selectTerrainRecipe,
} from "../src/terrain/domain/recipes.ts";
import { flusstal } from "../src/terrain/domain/generate.ts";

/**
 * Jede ABGENOMMENE Fassung (`accepted` in `config/terrain/aventuria.json`) mit dem Fingerabdruck ihres Inhalts (so, wie ihn der
 * Eingabe-Fingerabdruck der Ableitung liest: `JSON.stringify` des geprüften Rezepts). Eine abgenommene Fassung wird nie geändert; der
 * Rückweg auf eine vorige Fassung rechnet nur dann dasselbe Gelände wie vorher. Wird eine Fassung abgenommen, bekommt sie hier ihre Zeile.
 *
 * 🔴 Die jüngste Fassung darf offen sein und ändert sich bis zur Abnahme in sich (WI-0239; Betreiber 2026-10-19: „wir testen noch 19.
 * kannst du alle änderungen in die 19 tun ohne neue versionen zu generieren bis wir sie abnehmen?“). 19 ist seit 2026-11-07 abgenommen;
 * die nächste offene Fassung wäre 20.
 */
const FROZEN: Record<number, string> = {
    // Bis 2026-10-10 aktiv, damals `config/terrain/aventuria.json`; Rückweg aus Fassung 18.
    17: "44627b53b0769391ffdde122ad072d036126fa897f93e4c90ceac1d28594ef85",
    // Prototyp D, Radius 16 E, Sättigung 10 (Betreiber 2026-10-10).
    18: "39b69a7f9fee79760ceab38e9ddfd43b43d2fe664ce9b81a6e1af6a07718a491",
    // Gebirgs-Presets, Flusstäler, Seebecken, gemeinsame Grenzen; auf Stage abgenommen 2026-11-07 (Vali), ohne Testwerte.
    19: "a8e4a1bf9cbc0a9196726da79d9bbcd44adad3b06f17f3d988afee1be1cee82c",
};

const contentHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("WI-0067: versioned terrain recipe", () => {
    it("loads the central recipe with the agreed initial continental shape", () => {
        expect(AVENTURIA_TERRAIN_RECIPE.generator.continentalHeight).toBe(300);
        expect(AVENTURIA_TERRAIN_RECIPE.generator.continentalRadius).toBe(100);
        expect(AVENTURIA_TERRAIN_RECIPE.version).toBe(18);
        expect(AVENTURIA_TERRAIN_RECIPE.riverValley.flankGrade).toBe(0.1);
    });

    it("keeps every accepted version unchanged, the active one among them", () => {
        expect([...AVENTURIA_TERRAIN_SELECTION.accepted].sort((a, b) => a - b)).toEqual(
            Object.keys(FROZEN).map(Number),
        );
        for (const version of AVENTURIA_TERRAIN_SELECTION.accepted)
            expect(contentHash(AVENTURIA_TERRAIN_RECIPES.get(version)), `Fassung ${String(version)}`).toBe(
                FROZEN[version],
            );
        expect(AVENTURIA_TERRAIN_RECIPE).toBe(AVENTURIA_TERRAIN_RECIPES.get(18));
    });

    it("🔴 über einer offenen Fassung entsteht keine neue: jede Fassung außer der jüngsten ist abgenommen (WI-0239)", () => {
        const fassungen = [...AVENTURIA_TERRAIN_RECIPES.keys()];
        const offen = fassungen.filter((version) => !AVENTURIA_TERRAIN_SELECTION.accepted.includes(version));
        // Der Wächter: Eine neue Datei (etwa 20.json), solange 19 nicht unter `accepted` steht, wird hier rot. Abgenommen heißt: der Knopf
        // „Abnehmen“ im Höhenmodell der Systemsteuerung, danach trägt Claudia die Fassung unter `accepted` ein und hier unter FROZEN.
        for (const version of offen)
            expect(
                version,
                `Fassung ${String(version)} ist noch offen (nicht unter accepted in config/terrain/aventuria.json): ` +
                    "Änderungen gehören in sie, keine neue Fassung, bis sie abgenommen ist (Betreiber 2026-10-19)",
            ).toBe(Math.max(...fassungen));
        expect(offen.length).toBeLessThanOrEqual(1);
    });

    it("version 18 is version 17 with the regional, saturated uplift and nothing else", () => {
        const previous = structuredClone(AVENTURIA_TERRAIN_RECIPES.get(17)!);
        const current = structuredClone(AVENTURIA_TERRAIN_RECIPES.get(18)!);
        expect(previous.generator).not.toHaveProperty("uplift");
        expect(current.generator.uplift).toEqual({ kind: "regional", radius: 16, saturation: 10 });
        delete current.generator.uplift;
        expect({ ...current, version: 17 }).toEqual(previous);
    });

    it("version 19 carries the mountain presets per type (WI-0226)", () => {
        expect(AVENTURIA_TERRAIN_RECIPES.get(18)).not.toHaveProperty("gebirgsPresets");
        expect(Object.keys(AVENTURIA_TERRAIN_RECIPES.get(19)!.gebirgsPresets!.typen)).toHaveLength(11);
    });

    it("only version 19 lifts lake inlets (WI-0249 P7); 17 and 18 keep the hollow and its finding", () => {
        expect(AVENTURIA_TERRAIN_RECIPES.get(19)!.generator.lakes.inletDepth).toBe(100);
        // Das Becken der Seen (OPS-000086): im Gelände dieselbe Breite wie in der Saat, abgenommene Fassungen ohne.
        expect(AVENTURIA_TERRAIN_RECIPES.get(19)!.generator.lakes.randBreite).toBe(TREFFEN.seeRandE);
        for (const version of [17, 18])
            expect(AVENTURIA_TERRAIN_RECIPES.get(version)!.generator.lakes).not.toHaveProperty("randBreite");
        for (const version of [17, 18])
            expect(AVENTURIA_TERRAIN_RECIPES.get(version)!.generator.lakes).not.toHaveProperty("inletDepth");
        const negative = structuredClone(AVENTURIA_TERRAIN_RECIPES.get(19)!);
        negative.generator.lakes.inletDepth = -1;
        expect(() => parseTerrainRecipe(negative)).toThrow(/recipe/);
    });

    it("only version 19 steepens river valleys in high mountains (WI-0249), from existing values; 17 and 18 keep one flank", () => {
        const f19 = AVENTURIA_TERRAIN_RECIPES.get(19)!;
        expect(f19.riverValley.mountainShare).toBe(1);
        expect(flusstal(f19)).toEqual({
            flankGrade: 0.1,
            gebirge: {
                grade: f19.mountainMorphology.interior.maximumGrade,
                from: f19.mountainMorphology.interior.alpine.from,
                to: f19.mountainMorphology.interior.alpine.to,
            },
        });
        for (const version of [17, 18]) {
            const recipe = AVENTURIA_TERRAIN_RECIPES.get(version)!;
            expect(recipe.riverValley).not.toHaveProperty("mountainShare");
            expect(flusstal(recipe)).toBe(recipe.riverValley);
        }
        for (const share of [-0.1, 1.1]) {
            const invalid = structuredClone(f19);
            invalid.riverValley.mountainShare = share;
            expect(() => parseTerrainRecipe(invalid)).toThrow(/recipe/);
        }
    });

    it("selects exactly the named version and rejects anything else", () => {
        expect(selectTerrainRecipe(AVENTURIA_TERRAIN_RECIPES, { active: 17 }).version).toBe(17);
        expect(() => selectTerrainRecipe(AVENTURIA_TERRAIN_RECIPES, { active: 16 })).toThrow(/missing/);
        expect(() => selectTerrainRecipe(AVENTURIA_TERRAIN_RECIPES, { active: "18" })).toThrow(/selection/);
        expect(() => selectTerrainRecipe(AVENTURIA_TERRAIN_RECIPES, { active: 18, radius: 16 })).toThrow(/selection/);
        // Die abgenommenen Fassungen (WI-0127 SYS-13): nur eingetragene, ohne Doppel.
        expect(selectTerrainRecipe(AVENTURIA_TERRAIN_RECIPES, { active: 18, accepted: [17, 18] }).version).toBe(18);
        expect(() => selectTerrainRecipe(AVENTURIA_TERRAIN_RECIPES, { active: 18, accepted: [16] })).toThrow(
            /accepted/,
        );
        expect(() => selectTerrainRecipe(AVENTURIA_TERRAIN_RECIPES, { active: 18, accepted: [17, 17] })).toThrow(
            /selection/,
        );
    });

    it("rejects a version file whose name is not its version", () => {
        const directory = mkdtempSync(join(tmpdir(), "terrain-recipes-"));
        try {
            const recipe = structuredClone(AVENTURIA_TERRAIN_RECIPES.get(17)!);
            writeFileSync(join(directory, "19.json"), JSON.stringify(recipe));
            expect(() => loadTerrainRecipes(pathToFileURL(directory + "/"))).toThrow(/19\.json carries version 17/);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it("carries the lake level rule and rejects a lake without a mouth reach", () => {
        // Seen (Betreiber 2026-10-04): niedrigste Landstelle unter dem See (5-%-Quantil), tiefster Zufluss 2 E vor der Mündung.
        expect(AVENTURIA_TERRAIN_RECIPE.generator.lakes).toEqual({ bedQuantile: 0.05, mouthReach: 2 });
        const empty = structuredClone(AVENTURIA_TERRAIN_RECIPE);
        empty.generator.lakes.mouthReach = 0;
        expect(() => parseTerrainRecipe(empty)).toThrow(/recipe/);
        const beyond = structuredClone(AVENTURIA_TERRAIN_RECIPE);
        beyond.generator.lakes.bedQuantile = 1.5;
        expect(() => parseTerrainRecipe(beyond)).toThrow(/recipe/);
    });

    it("does not give vegetation a tectonic uplift weight", () => {
        for (const recipe of Object.values(AVENTURIA_TERRAIN_RECIPE.vegetation)) expect(recipe.upliftWeight).toBe(1);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid factor %s", (erodibility) => {
        const value = structuredClone(AVENTURIA_TERRAIN_RECIPE);
        value.topographie.huegelland!.erodibility = erodibility;
        expect(() => parseTerrainRecipe(value)).toThrow(/recipe/);
    });

    it("rejects a mountain interior halo that cannot hold the fragment reach", () => {
        const value = structuredClone(AVENTURIA_TERRAIN_RECIPE);
        value.mountainMorphology.interior.halo = 2;
        expect(() => parseTerrainRecipe(value)).toThrow(/halo/);
    });

    it("rejects direct landscape heights", () => {
        const value = structuredClone(AVENTURIA_TERRAIN_RECIPE);
        Object.assign(value.topographie.hochebene!, { baseHeight: 150 });
        expect(() => parseTerrainRecipe(value)).toThrow(/recipe/);
    });

    it.each([0, -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid valley grade %s", (flankGrade) => {
        const value = structuredClone(AVENTURIA_TERRAIN_RECIPE);
        value.riverValley.flankGrade = flankGrade;
        expect(() => parseTerrainRecipe(value)).toThrow(/recipe/);
    });

    it("rejects tectonic forms on vegetation and reversed relative form ranges", () => {
        const value = structuredClone(AVENTURIA_TERRAIN_RECIPE);
        value.vegetation.wald!.landform = { kind: "hills", minimum: 100, maximum: 500, wavelength: 4 };
        expect(() => parseTerrainRecipe(value)).toThrow(/vegetation/);
        delete value.vegetation.wald!.landform;
        value.topographie.huegelland!.landform!.maximum = 49;
        expect(() => parseTerrainRecipe(value)).toThrow(/range/);
    });
});
