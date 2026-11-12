import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    LOADING_MIN_VISIBLE_MS,
    LOADING_SHOW_DELAY_MS,
    loadingBar,
    startLoading,
} from "../src/feedback/loading-bar.ts";

/**
 * Legacys Ladebalken (MCS-020, D2): erst nach 160 ms, dann mindestens 450 ms, mehrere Aufträge
 * teilen sich einen Balken.
 */

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    // Den Balken für den nächsten Fall ganz zurücklaufen lassen.
    vi.runAllTimers();
    vi.useRealTimers();
});

describe("Der Ladebalken", () => {
    it("🪤 eine schnelle Antwort zeigt ihn gar nicht - sonst blinkte er nur", () => {
        const done = startLoading();
        vi.advanceTimersByTime(LOADING_SHOW_DELAY_MS - 1);
        done();
        vi.advanceTimersByTime(1000);
        expect(loadingBar.visible).toBe(false);
    });

    it("erscheint nach 160 ms und kriecht auf 90 % zu, ohne voll zu werden", () => {
        const done = startLoading();
        vi.advanceTimersByTime(LOADING_SHOW_DELAY_MS);
        expect(loadingBar.visible).toBe(true);
        const start = loadingBar.progress;
        vi.advanceTimersByTime(10_000);
        expect(loadingBar.progress).toBeGreaterThan(start);
        // Legacys Schritt legt 0,4 Prozentpunkte drauf und endet damit knapp über 90 %, nie bei 100.
        expect(loadingBar.progress).toBeLessThan(0.91);
        done();
    });

    it("einmal sichtbar, bleibt er mindestens 450 ms, läuft voll und geht dann", () => {
        const done = startLoading();
        vi.advanceTimersByTime(LOADING_SHOW_DELAY_MS);
        done();
        vi.advanceTimersByTime(LOADING_MIN_VISIBLE_MS - 1);
        expect(loadingBar.visible).toBe(true);
        expect(loadingBar.progress).toBeLessThan(1);
        vi.advanceTimersByTime(1);
        expect(loadingBar.progress).toBe(1);
        vi.advanceTimersByTime(400);
        expect(loadingBar.visible).toBe(false);
        expect(loadingBar.progress).toBe(0);
    });

    it("mehrere Aufträge teilen sich einen Balken: er geht mit dem letzten", () => {
        const first = startLoading();
        const second = startLoading();
        vi.advanceTimersByTime(LOADING_SHOW_DELAY_MS + LOADING_MIN_VISIBLE_MS);
        first();
        vi.advanceTimersByTime(1000);
        expect(loadingBar.visible).toBe(true);
        second();
        // Ein zweiter Aufruf derselben Meldung tut nichts.
        second();
        vi.advanceTimersByTime(1000);
        expect(loadingBar.visible).toBe(false);
    });
});
