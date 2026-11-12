import { describe, expect, it } from "vitest";
import { ROT_LINT, inStuecken, planeLintUndFormat } from "../../../scripts/dev/lint-auswahl.ts";

/**
 * Lint und Format in `vor-dem-push` (`scripts/dev/lint-auswahl.ts`, Hauptorchestrierung 2026-10-18). Problemfälle: ein Push mit Code fährt ESLint
 * über genau die geänderten Code-Dateien, nicht über alles; gelöschte Dateien gibt es nicht zu prüfen; `--voll` und eine unbestimmbare Änderung
 * prüfen alles; eine reine Doku-Änderung braucht keinen ESLint.
 */
const da = (): boolean => true;

describe("planeLintUndFormat", () => {
    it("🔴 ESLint nur über geänderte Code-Dateien, Prettier über alle geänderten, sortiert und ohne Doppelte", () => {
        const plan = planeLintUndFormat({
            geaendert: [
                "apps/web/src/b.vue",
                "scripts/dev/a.ts",
                "docs/regeln/x.md",
                "config/design-canon/avesmaps.json",
                "scripts/dev/a.ts",
                "ops/deploy/x.sh",
                "tools\\y.mjs",
            ],
            voll: false,
            vorhanden: da,
        });
        expect(plan.lint).toEqual({
            modus: "geaendert",
            dateien: ["apps/web/src/b.vue", "scripts/dev/a.ts", "tools/y.mjs"],
        });
        expect(plan.format.modus).toBe("geaendert");
        expect(plan.format.dateien).toEqual([
            "apps/web/src/b.vue",
            "config/design-canon/avesmaps.json",
            "docs/regeln/x.md",
            "ops/deploy/x.sh",
            "scripts/dev/a.ts",
            "tools/y.mjs",
        ]);
    });

    it("🔴 gelöschte Dateien gibt es nicht zu prüfen", () => {
        const plan = planeLintUndFormat({
            geaendert: ["scripts/dev/weg.ts", "scripts/dev/bleibt.ts"],
            voll: false,
            vorhanden: (pfad) => pfad !== "scripts/dev/weg.ts",
        });
        expect(plan.lint.dateien).toEqual(["scripts/dev/bleibt.ts"]);
        expect(plan.format.dateien).toEqual(["scripts/dev/bleibt.ts"]);
        const nurWeg = planeLintUndFormat({ geaendert: ["scripts/dev/weg.ts"], voll: false, vorhanden: () => false });
        expect(nurWeg.lint.modus).toBe("keine");
        expect(nurWeg.format.modus).toBe("keine");
    });

    it("🔴 eine reine Doku-Änderung: kein ESLint, Prettier nur über die Datei (er lässt Markdown selbst aus)", () => {
        const plan = planeLintUndFormat({ geaendert: ["docs/regeln/x.md", "AGENTS.md"], voll: false, vorhanden: da });
        expect(plan.lint.modus).toBe("keine");
        expect(plan.format.dateien).toEqual(["AGENTS.md", "docs/regeln/x.md"]);
    });

    it("🔴 `--voll` und eine unbestimmbare Änderung prüfen alles", () => {
        expect(planeLintUndFormat({ geaendert: ["docs/x.md"], voll: true, vorhanden: da })).toEqual({
            lint: { modus: "alles", dateien: [] },
            format: { modus: "alles", dateien: [] },
        });
        expect(planeLintUndFormat({ geaendert: undefined, voll: false, vorhanden: da }).lint.modus).toBe("alles");
    });

    it("eine leere Änderung prüft nichts", () => {
        const plan = planeLintUndFormat({ geaendert: [], voll: false, vorhanden: da });
        expect(plan.lint.modus).toBe("keine");
        expect(plan.format.modus).toBe("keine");
    });
});

describe("inStuecken", () => {
    it("teilt in Stücke fester Größe, der Rest bleibt; leer bleibt leer", () => {
        expect(inStuecken([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(inStuecken([1, 2], 5)).toEqual([[1, 2]]);
        expect(inStuecken([], 3)).toEqual([]);
    });
});

describe("ROT_LINT", () => {
    const zeigt = (zeile: string): boolean => ROT_LINT.test(zeile);

    it("🔴 zeigt von ESLint die Datei, jeden Fund und die Summe, von Prettier die Dateien", () => {
        expect(zeigt("C:\\x\\apps\\web\\src\\a.vue")).toBe(true);
        expect(zeigt('  257:59  error  Unexpected mutation of "baender" prop  vue/no-mutating-props')).toBe(true);
        expect(zeigt("  40:9  warning  Prop 'testid' requires default value  vue/require-default-prop")).toBe(true);
        expect(zeigt("✖ 22 problems (11 errors, 11 warnings)")).toBe(true);
        expect(zeigt("[warn] scripts/dev/x.ts")).toBe(true);
        expect(zeigt("[warn] Code style issues found in the above file. Run Prettier with --write to fix.")).toBe(true);
    });

    it("zeigt keine Protokollzeilen", () => {
        expect(zeigt("Checking formatting...")).toBe(false);
        expect(zeigt("> avesmaps3d@0.0.0 lint")).toBe(false);
        expect(zeigt("")).toBe(false);
    });
});
