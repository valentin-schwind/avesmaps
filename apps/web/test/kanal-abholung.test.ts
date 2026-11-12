import { describe, expect, it } from "vitest";
import { ABHOLUNG_FRISCH_MS, abholSatz, abholung, schienenWert } from "../src/auth/kanal.ts";

/**
 * Ehrliche Erwartung im Kanal (Arbeitsanweisung WI-0124 §6; Koordination 2026-10-11, Go für A): Holt die Routine seit über einer Stunde
 * nicht ab, verspricht keine Stelle den 30-Minuten-Takt.
 */
const JETZT = new Date("2026-10-11T20:00:00Z");
const vor = (ms: number): string => new Date(JETZT.getTime() - ms).toISOString();

describe("Abholung der Routine", () => {
    it("🔴 bis eine Stunde läuft sie, danach nicht mehr; nie heißt nie, unbekannt heißt nichts sagen", () => {
        expect(abholung(vor(59 * 60_000), JETZT)?.laeuft).toBe(true);
        expect(abholung(vor(ABHOLUNG_FRISCH_MS), JETZT)?.laeuft).toBe(true);
        expect(abholung(vor(61 * 60_000), JETZT)?.laeuft).toBe(false);
        expect(abholung(null, JETZT)).toEqual({ laeuft: false, zuletzt: null });
        expect(abholung(undefined, JETZT)).toBeNull();
    });

    it("der Satz: zuletzt mit Abstand und einem Punkt, nie eigens", () => {
        expect(abholSatz({ laeuft: false, zuletzt: vor(3 * 3_600_000) }, JETZT)).toBe(
            "Claudio holt gerade nicht ab, zuletzt vor 3 Std.",
        );
        expect(abholSatz({ laeuft: false, zuletzt: null }, JETZT)).toBe("Claudio hat noch nie abgeholt.");
    });
});

describe("Wert in der Schiene", () => {
    it("nur die Zahl, damit „Claudia & Claudio“ daneben nicht gekürzt wird; keine: nichts", () => {
        expect(schienenWert(4)).toBe("4");
        expect(schienenWert(0)).toBeUndefined();
        expect(schienenWert(null)).toBeUndefined();
    });
});
