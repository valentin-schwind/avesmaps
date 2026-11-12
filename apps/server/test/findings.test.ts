import { describe, expect, it } from "vitest";
import { createFinding, formatFinding, formatShare, MAX_FINDING_OBJECTS } from "../src/findings.ts";
import { MAX_RETIRE_FRACTION, retireFinding } from "../src/migration/retire-findings.ts";

/**
 * Befunde statt Abbruch (Betreiber 2026-10-03): Grenzwert und Berechnung der Stilllegequote bleiben, sie melden nur noch.
 * Das Verhalten je Importer steht in dessen Test (Orte, Wege, Kraftlinien, Regionen, Gelände, Gebiete).
 */
describe("Stilllegequote als Befund", () => {
    const objects = async (): Promise<{ table: string; publicId: string; name: string | null }[]> => [
        { table: "place", publicId: "00000000-0000-4000-8000-000000000001", name: "Angbar" },
    ];

    it("der Grenzwert bleibt 5 %", () => {
        expect(MAX_RETIRE_FRACTION).toBe(0.05);
    });

    it("meldet nichts bis einschließlich 5 % und bei leerem Bestand", async () => {
        expect(await retireFinding("place", { active: 100, retiring: 5 }, objects)).toBeUndefined();
        expect(await retireFinding("place", { active: 100, retiring: 0 }, objects)).toBeUndefined();
        expect(await retireFinding("place", { active: 0, retiring: 0 }, objects)).toBeUndefined();
        expect(await retireFinding("place", undefined, objects)).toBeUndefined();
    });

    it("meldet über 5 % mit Zahlen und Objekten, ohne zu werfen", async () => {
        const finding = await retireFinding("place", { active: 130, retiring: 7 }, objects);
        expect(finding).toBeDefined();
        expect(finding?.code).toBe("stilllegequote");
        expect(finding?.numbers).toEqual({ table: "place", active: 130, retiring: 7, share: 0.0538, limit: 0.05 });
        expect(finding?.message).toContain("7 von 130");
        expect(finding?.message).toContain("5,4 %");
        expect(finding?.objectCount).toBe(7);
        expect(finding?.objects).toEqual([
            { table: "place", publicId: "00000000-0000-4000-8000-000000000001", name: "Angbar" },
        ]);
    });

    it("fragt die Objekte nur im Befundfall ab", async () => {
        let calls = 0;
        const counting = async (): Promise<never[]> => {
            calls += 1;
            return [];
        };
        await retireFinding("place", { active: 100, retiring: 5 }, counting);
        expect(calls).toBe(0);
        await retireFinding("place", { active: 100, retiring: 6 }, counting);
        expect(calls).toBe(1);
    });
});

describe("Befund formatieren", () => {
    it("nennt Prozent mit Komma und eine Nachkommastelle", () => {
        expect(formatShare(0.054)).toBe("5,4 %");
        expect(formatShare(1)).toBe("100,0 %");
    });

    it("kürzt die Namensliste, behält aber die Gesamtzahl", () => {
        const many = Array.from({ length: MAX_FINDING_OBJECTS + 30 }, (_, index) => ({
            table: "place",
            publicId: `id-${String(index)}`,
            name: null,
        }));
        const finding = createFinding("stilllegequote", "viele", { retiring: many.length }, many);
        expect(finding.objects).toHaveLength(MAX_FINDING_OBJECTS);
        expect(finding.objectCount).toBe(MAX_FINDING_OBJECTS + 30);
        const lines = formatFinding(finding, 3);
        expect(lines).toHaveLength(1 + 3 + 1);
        expect(lines[1]).toBe("  place id-0 (ohne Namen)");
        expect(lines.at(-1)).toBe(`  … und ${String(MAX_FINDING_OBJECTS + 30 - 3)} weitere`);
    });
});
