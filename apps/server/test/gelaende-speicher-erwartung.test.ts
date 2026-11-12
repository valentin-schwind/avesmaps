import { getJobsConfig } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import { decideAdmission, type AdmissionCandidate } from "../src/jobs/admission.ts";
import { expectedMemoryMb, JOB_KIND_CATALOG } from "../src/jobs/kinds.ts";

/**
 * Speicher des Geländes auf der Stage (Claudio 2026-10-19, Wahl A, `2026-10-19-gelaende-speicher-budget-antwort-an-claudia.md`; Messung
 * `2026-10-19-gelaende-speicher-je-kachel-antwort-an-claudio.md`: rund 1727 MiB, unabhängig von der Zahl der Rechenkacheln).
 *
 * - Problemfall: Eine Erwartung über dem Budget (1850 bei 1600, oder eine gelernte Spitze über 2000) ließe das Gelände für immer mit
 *   `waits_memory` warten; der Boden von 2048 hielte es an, sobald nebenher ein Prüflauf läuft, und auch 1536 noch bei 3038 MB frei (Stage-Job
 *   1993, Claudio `2026-10-19-gelaende-speicherboden-1024-an-claudia.md`).
 * - Soll: Erwartung 1850, Budget 2000, Boden 560 (Entscheidung Vali 2026-11-06, WI-0283 §5, `5cde1331b`; vorher 1024: Start ab 2874 MB); das Gelernte höchstens bis zum Budget.
 */

const staging = getJobsConfig("staging");
const gelaende = JOB_KIND_CATALOG["terrain_local"]!;

function kandidat(memExpectedMb: number): AdmissionCandidate {
    return {
        id: 1,
        kind: "terrain_local",
        mapDomainId: "staging:aventuria",
        scopeKind: "tiles",
        scopeTiles: [19, 20, 27, 28],
        priority: 50,
        queuedAtMs: 0,
        notBeforeMs: null,
        dependenciesDone: true,
        memExpectedMb,
        threads: 3,
        editor: true,
    };
}

describe("Gelände und Speicherbudget der Stage", () => {
    it("🔴 die Erwartung folgt der Messung, und das Gelernte hebt sie höchstens bis zum Budget", () => {
        expect(expectedMemoryMb(gelaende, {}, null, staging, null)).toBe(1850);
        expect(expectedMemoryMb(gelaende, {}, null, staging, 1500)).toBe(1850);
        expect(expectedMemoryMb(gelaende, {}, null, staging, 1930)).toBe(1930);
        expect(expectedMemoryMb(gelaende, {}, null, staging, 2600)).toBe(2000);
    });

    it("🔴 allein startet ein Gelände ab 2410 MB frei (Stage-Job 1993 wartete bei 3038, das Gelände am Abend des 05.11. bei unter 3024); mit der höchsten gelernten Erwartung nie für immer", () => {
        const entscheide = (frei: number, erwartet: number) =>
            decideAdmission({
                config: staging,
                nowMs: 0,
                queued: [kandidat(erwartet)],
                running: [],
                memAvailableMb: frei,
                rolloutActive: false,
            });
        expect(entscheide(3038, 1850).admitted).toHaveLength(1);
        expect(entscheide(2560, 1850).admitted).toHaveLength(1);
        expect(entscheide(2410, 1850).admitted).toHaveLength(1);
        expect(entscheide(2409, 1850).waiting.get(1)).toBe("waits_memory");
        expect(entscheide(4000, expectedMemoryMb(gelaende, {}, null, staging, 2600)!).admitted).toHaveLength(1);
    });
});
