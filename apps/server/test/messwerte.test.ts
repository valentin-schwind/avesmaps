import { describe, expect, it } from "vitest";
import { cpuAnteil } from "../src/routes/messwerte.ts";

/**
 * Die CPU-Zahl des Messfensters ist eine DIFFERENZ (WI-0138 V15): Sie entsteht erst zwischen zwei Fragen, und die erste
 * Antwort nach dem Start muss „unbekannt“ sagen statt 0 - eine erfundene Null sähe aus wie Ruhe.
 */
const stand = (user: number, system: number, sekunden: number) => ({
    cpu: { user, system },
    zeit: BigInt(Math.round(sekunden * 1e9)),
});

describe("CPU-Anteil", () => {
    it("ohne vorherigen Stand ist er unbekannt, nicht null", () => {
        expect(cpuAnteil(undefined, stand(0, 0, 1), 4).anteil).toBeNull();
    });

    it("eine halbe Kernzeit auf vier Kernen sind 12,5 Prozent", () => {
        const vorher = stand(0, 0, 10);
        const jetzt = stand(500_000, 0, 11); // 0,5 s Rechenzeit in 1 s auf 4 Kernen
        expect(cpuAnteil(vorher, jetzt, 4).anteil).toBeCloseTo(0.125, 5);
    });

    it("zählt Nutzer- und Systemzeit zusammen und bleibt zwischen 0 und 1", () => {
        const vorher = stand(0, 0, 0);
        const jetzt = stand(900_000, 900_000, 1);
        expect(cpuAnteil(vorher, jetzt, 1).anteil).toBe(1);
    });

    it("eine Uhr, die nicht weitergegangen ist, ergibt keine Zahl", () => {
        const gleich = stand(5, 5, 7);
        expect(cpuAnteil(gleich, gleich, 2).anteil).toBeNull();
    });
});
