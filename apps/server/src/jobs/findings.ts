import type { JobFinding } from "@avesmaps3d/shared";

/**
 * Befunde der Queue (JOBS-0001 4.7): Sie MELDEN, sie halten nie an (AGENTS.md „Blockierende Prüfungen im Betrieb“, D7a). Die
 * Queue beendet keinen Job, auch nicht bei Überschreitung; den harten Rückhalt bei echter Speichernot geben die cgroup der
 * Worker-Unit und `choom`, beides in Claudios Korridor.
 */

/**
 * Was WÄHREND des Auftrags aus dem Swap eingelagert wurde, über dem Rauschen (MS9), ist ein Befund mit Job-Kennung: Dann wartete
 * jemand auf die Platte. Der Bestand im Swap ist es nicht mehr (Claudio 2026-10-19: Seit dem größeren Swap liegen dort dauernd
 * 1 bis 2 GB ruhender Seiten, etwa von Foundry, und der alte Befund stand an jedem Auftrag). Der Swap ist nie Kapazität.
 */
export function swapFinding(
    swapInMb: number | null,
    laufS: number,
    noiseMb: number,
    rateMbPerMin: number,
): JobFinding | null {
    if (swapInMb === null || swapInMb <= noiseMb) return null;
    // `pswpin` zählt den ganzen Host: Ein langer Lauf sieht auch das Grundrauschen der anderen (Claudio 2026-10-19, rund 7 MB je Minute).
    // Darum zählt das Eingelagerte je Laufminute, und ein kurzer Lauf mindestens als eine Minute.
    const minuten = Math.max(1, laufS / 60);
    const rate = swapInMb / minuten;
    if (rate <= rateMbPerMin) return null;
    return {
        code: "swap_in_use",
        detail: `${String(swapInMb)} MB aus dem Swap eingelagert in ${String(Math.round(minuten))} min (${String(Math.round(rate))} MB je Minute, Rauschen des Hosts bis ${String(rateMbPerMin)})`,
    };
}

/** Spitze RSS über der Erwartung oder der Meldegrenze (MS8): gemeldet, nicht beendet. */
export function budgetFinding(
    rssPeakMb: number | null,
    expectedMb: number | null,
    warnMb: number | undefined,
): JobFinding | null {
    if (rssPeakMb === null) return null;
    const limits = [expectedMb, warnMb].filter((value): value is number => typeof value === "number");
    if (limits.length === 0) return null;
    const limit = Math.min(...limits);
    if (rssPeakMb <= limit) return null;
    return {
        code: "budget_exceeded",
        detail: `Spitze RSS ${String(rssPeakMb)} MB über der Erwartung ${String(limit)} MB (gemeldet, nicht beendet)`,
    };
}
