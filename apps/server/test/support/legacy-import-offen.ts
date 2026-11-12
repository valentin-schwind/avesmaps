import { vi } from "vitest";
import * as schalter from "../../src/wiki/abgleich/schalter-lesen.ts";

/**
 * Seit dem Cutoff 2026-11-02 gehört jeder angeschlossene Bereich fest dem WikiSync (`schalter-lesen.ts`); der Legacy-Import lässt ihn aus (`bereich_wikisync`).
 * Tests, die NICHT den Import prüfen, sondern nur Daten brauchen (Prüfer, Lesen, Bearbeiten, Rücknahme), legen sie mit dem Schreibweg des Imports an. Dafür
 * meldet dieser Aufruf bis zum Aufräumen (`vi.restoreAllMocks()`, im Test mit `afterEach`) KEINEN Bereich als WikiSync-eigen. Der Zustand gilt nur im Testprozess.
 */
export function legacyImportOffen(): void {
    vi.spyOn(schalter, "wikisyncBereiche").mockResolvedValue(new Set());
}
