import { describe, expect, it } from "vitest";
import type { Speicher } from "../src/editor-panel/editor-panel-nav.ts";
import { LISTEN_SCHLUESSEL, createListenSchalter } from "../src/fenster/listen-schalter.ts";

/**
 * Der Schalter der Ortsliste (WI-0128 P1, Betreiber 2026-10-13): je Fenster einer, die zuletzt gelegte Stellung ist die Vorgabe des
 * nächsten Fensters, und ohne Speicher geht alles weiter. Die Geometrie prüft `e2e/ortseditor-liste-einklappen.spec.ts`.
 */

function tafel(anfang: Record<string, string> = {}): Speicher & { werte: Map<string, string> } {
    const werte = new Map(Object.entries(anfang));
    return {
        werte,
        getItem: (schluessel) => werte.get(schluessel) ?? null,
        setItem: (schluessel, wert) => void werte.set(schluessel, wert),
        removeItem: (schluessel) => void werte.delete(schluessel),
    };
}

/** Ein Speicher, der bei jedem Zugriff wirft (gesperrte Website-Daten). */
const gesperrt: Speicher = {
    getItem: () => {
        throw new Error("gesperrt");
    },
    setItem: () => {
        throw new Error("gesperrt");
    },
    removeItem: () => {
        throw new Error("gesperrt");
    },
};

describe("Schalter der Ortsliste", () => {
    it("steht ohne Gemerktes offen", () => {
        const schalter = createListenSchalter(tafel());
        expect(schalter.zu("fenster-1")).toBe(false);
        expect(schalter.einzug("fenster-1")).toBe(0);
    });

    it("merkt die Stellung und gibt sie dem NÄCHSTEN Fenster, nicht den offenen", () => {
        const speicher = tafel();
        const schalter = createListenSchalter(speicher);
        schalter.melde("fenster-1");
        schalter.melde("fenster-2");

        schalter.schalte("fenster-1", true);
        expect(schalter.zu("fenster-1")).toBe(true);
        // 🔴 Das zweite Fenster war schon da: Es bleibt offen.
        expect(schalter.zu("fenster-2")).toBe(false);
        // Ein neues Fenster erbt die Stellung.
        schalter.melde("fenster-3");
        expect(schalter.zu("fenster-3")).toBe(true);
        expect(speicher.werte.get(LISTEN_SCHLUESSEL)).toBe("zu");
    });

    it("nimmt die gemerkte Stellung beim nächsten Laden auf", () => {
        expect(createListenSchalter(tafel({ [LISTEN_SCHLUESSEL]: "zu" })).zu("fenster-1")).toBe(true);
        expect(createListenSchalter(tafel({ [LISTEN_SCHLUESSEL]: "offen" })).zu("fenster-1")).toBe(false);
        // Alles, was nicht passt, gilt als nicht gemerkt.
        expect(createListenSchalter(tafel({ [LISTEN_SCHLUESSEL]: "vielleicht" })).zu("fenster-1")).toBe(false);
    });

    it("geht ohne Speicher und mit werfendem Speicher weiter", () => {
        for (const speicher of [undefined, gesperrt]) {
            const schalter = createListenSchalter(speicher);
            expect(schalter.zu("fenster-1")).toBe(false);
            expect(() => schalter.schalte("fenster-1", true)).not.toThrow();
            expect(schalter.zu("fenster-1")).toBe(true);
        }
    });

    it("`melde` überschreibt eine schon gelegte Stellung nicht", () => {
        const schalter = createListenSchalter(tafel());
        schalter.schalte("fenster-1", true);
        schalter.schalte("fenster-1", false);
        schalter.melde("fenster-1");
        expect(schalter.zu("fenster-1")).toBe(false);
    });

    it("antwortet ohne Fenster mit der Vorgabe (ein Flug zielt auf das Fenster, das noch nicht offen ist)", () => {
        const schalter = createListenSchalter(tafel({ [LISTEN_SCHLUESSEL]: "zu" }));
        expect(schalter.zu(undefined)).toBe(true);
    });
});
