import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    currentToast,
    hideToast,
    holdToast,
    LINK_NOTICE_MS,
    releaseToast,
    ROUTE_NOTICE_MS,
    showLinkToast,
    showToast,
} from "../src/feedback/toast.ts";

/**
 * Der Toast (Guide §15.1) mit einem Link darin (WI-0034, Betreiber 2026-09-24: „kanns nicht rauskopieren“):
 * Wer einen Link mitnehmen soll, braucht länger als zum Lesen, und er darf nicht unter dem Zeiger verschwinden.
 */
describe("Der Toast mit Link", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        hideToast();
    });
    afterEach(() => {
        hideToast();
        vi.useRealTimers();
    });

    it("steht 12 s statt 5 und trägt den Link", () => {
        showLinkToast("Kurzlink: https://karte.test/?s=Ab3dEf7h", "https://karte.test/?s=Ab3dEf7h", "warning");
        expect(currentToast.value).toMatchObject({ tone: "warning", link: "https://karte.test/?s=Ab3dEf7h" });
        vi.advanceTimersByTime(ROUTE_NOTICE_MS + 1);
        expect(currentToast.value).not.toBeNull();
        vi.advanceTimersByTime(LINK_NOTICE_MS - ROUTE_NOTICE_MS);
        expect(currentToast.value).toBeNull();
    });

    it("🔴 bleibt, solange Zeiger oder Fokus auf dem Link liegen, und danach noch einmal die volle Zeit", () => {
        showLinkToast("Kurzlink kopiert: https://karte.test/?s=Ab3dEf7h", "https://karte.test/?s=Ab3dEf7h");
        vi.advanceTimersByTime(LINK_NOTICE_MS - 100);
        holdToast();
        vi.advanceTimersByTime(60_000);
        expect(currentToast.value).not.toBeNull();
        releaseToast();
        vi.advanceTimersByTime(LINK_NOTICE_MS - 100);
        expect(currentToast.value).not.toBeNull();
        vi.advanceTimersByTime(100);
        expect(currentToast.value).toBeNull();
    });

    it("an einen Link wird nichts angehängt; eine neue Meldung ersetzt ihn und steht ihre 5 s", () => {
        showLinkToast("Kurzlink: https://karte.test/?s=Ab3dEf7h", "https://karte.test/?s=Ab3dEf7h", "warning");
        holdToast();
        showToast("Keine Route gefunden", "warning");
        expect(currentToast.value?.text).toBe("Keine Route gefunden");
        expect(currentToast.value?.link).toBeUndefined();
        // Der Link ist fort; ein spätes Verlassen verlängert die neue Meldung nicht.
        releaseToast();
        vi.advanceTimersByTime(ROUTE_NOTICE_MS);
        expect(currentToast.value).toBeNull();
    });

    it("Meldungen ohne Link reihen sich wie bisher", () => {
        showToast("Orte nicht gefunden: Nirgendwo", "warning");
        showToast("Keine Route gefunden", "warning");
        showToast("Keine Route gefunden", "warning");
        expect(currentToast.value?.text).toBe("Orte nicht gefunden: Nirgendwo · Keine Route gefunden");
    });
});
