import { describe, expect, it } from "vitest";
import { swapFinding } from "../src/jobs/findings.ts";
import { parseMeminfo, parseVmstatSwapIn } from "../src/jobs/memory.ts";

/**
 * Der Befund `swap_in_use` (MS9) misst, was WÄHREND eines Auftrags aus dem Swap eingelagert wird (Claudio 2026-10-19,
 * `2026-10-19-befund-swap-in-use-nach-mehr-swap-an-claudia.md`). Problemfall: Seit dem Swap von 4 GB liegen dauernd 1 bis 2 GB ruhender
 * Seiten dort (Foundry), und der alte Befund auf den Bestand stand an jedem Auftrag („Swap 1403 MB benutzt“, Stage-Job 2117).
 */
describe("Befund Swap", () => {
    it("🔴 der Bestand im Swap allein ist kein Befund mehr, nur das Eingelagerte über dem Rauschen", () => {
        expect(swapFinding(0, 60, 64, 21)).toBeNull();
        expect(swapFinding(64, 60, 64, 21)).toBeNull();
        expect(swapFinding(null, 60, 64, 21)).toBeNull();
        expect(swapFinding(80, 60, 64, 21)).toEqual({
            code: "swap_in_use",
            detail: "80 MB aus dem Swap eingelagert in 1 min (80 MB je Minute, Rauschen des Hosts bis 21)",
        });
    });

    it("🔴 das Grundrauschen des Hosts über einen langen Lauf ist kein Befund (Rollout 87 MB, Prüflauf 90 MB am 19.10.)", () => {
        // Prüflauf 2242: 90 MB in gut 8 Minuten, gut 10 MB je Minute: Rauschen.
        expect(swapFinding(90, 514, 64, 21)).toBeNull();
        // Rollout 2222: 87 MB in 2 Minuten, 43 MB je Minute: über dem Dreifachen des Rauschens, ein Befund.
        expect(swapFinding(87, 120, 64, 21)?.detail).toBe(
            "87 MB aus dem Swap eingelagert in 2 min (44 MB je Minute, Rauschen des Hosts bis 21)",
        );
        // Ein kurzer Lauf zählt als eine Minute.
        expect(swapFinding(70, 5, 64, 21)?.code).toBe("swap_in_use");
    });

    it("liest pswpin als MB (Seiten zu 4 KiB) und den Bestand aus meminfo wie bisher", () => {
        expect(parseVmstatSwapIn("pgpgin 12\npswpin 25600\npswpout 3\n")).toBe(100);
        expect(parseVmstatSwapIn("pgpgin 12\n")).toBeNull();
        expect(
            parseMeminfo(
                "MemTotal: 8000000 kB\nMemAvailable: 3000000 kB\nSwapTotal: 4194304 kB\nSwapFree: 2757632 kB\n",
            ),
        ).toEqual({ availableMb: 2929, totalMb: 7812, swapUsedMb: 1403 });
    });
});
