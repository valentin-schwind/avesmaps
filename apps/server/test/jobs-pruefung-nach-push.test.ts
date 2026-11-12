import { describe, expect, it } from "vitest";
import { getJobsConfig, leaseSecondsFor } from "@avesmaps3d/shared";
import {
    JOB_KIND_CATALOG,
    PRUEFUNG_NACH_PUSH_KIND,
    PRUEFUNG_NACH_PUSH_PHASES,
    claimsSlot,
    expectedMemoryMb,
    phaseProgress,
} from "../src/jobs/kinds.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Prüfung nach dem Push als aufgezeichneter Job (Andock-Frage aus `handovers/2026-10-17-pruefung-nach-push-gebaut-an-claudia.md`).
 * Melden tut Claudios Korridor über `jobs-cli record`; hier steht, was die Warteschlange von der Art wissen muss.
 */
describe("pruefung_nach_push: die Jobart", () => {
    it("ist aufgezeichnet und belegt keinen Platz: sie rechnet außerhalb der Warteschlange und darf nichts anhalten", () => {
        const spec = JOB_KIND_CATALOG[PRUEFUNG_NACH_PUSH_KIND];
        expect(spec?.origin).toBe("recorded");
        expect(spec?.threads).toBe(0);
        expect(spec?.holdsSharedDomainLock).toBe(false);
        expect(claimsSlot(PRUEFUNG_NACH_PUSH_KIND)).toBe(false);
        expect(expectedMemoryMb(spec!, {}, null, testJobsConfig(), null)).toBe(0);
    });

    it("die Schritte stehen in der Reihenfolge des Skripts, der Fortschritt steigt und erreicht 1 erst mit dem Ende", () => {
        expect(PRUEFUNG_NACH_PUSH_PHASES.map((phase) => phase.name)).toEqual([
            "bauen",
            "format",
            "lint",
            "typecheck",
            "tests",
        ]);
        const anteile = PRUEFUNG_NACH_PUSH_PHASES.map((phase) => phase.progress);
        expect(anteile).toEqual([...anteile].sort((a, b) => a - b));
        expect(anteile.at(-1)).toBeLessThan(1);
        expect(phaseProgress(PRUEFUNG_NACH_PUSH_KIND, "tests")).toBe(0.5);
        expect(phaseProgress(PRUEFUNG_NACH_PUSH_KIND, "proben")).toBeNull();
    });

    it("die Lease trägt den längsten Schritt ohne Lebenszeichen (die Tests, rund 20 min für den ganzen Lauf)", () => {
        for (const profile of ["local", "staging"] as const) {
            expect(
                leaseSecondsFor(getJobsConfig(profile), PRUEFUNG_NACH_PUSH_KIND, true),
                profile,
            ).toBeGreaterThanOrEqual(1800);
        }
    });
});
