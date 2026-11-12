import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster.ts";
import { installAblageHinweis } from "../src/fenster/ablage-hinweis.ts";

/**
 * „Entwurf liegt unter Offene Bearbeitungen“ (Orchestrierung 2026-10-18, Betreiber bestätigt; Fund „Tal am Donnerkessel“).
 * Problemfälle: ✕ legt einen Entwurf still ab; der Hinweis kommt bei jedem Hin und Her wieder; ein Fenster ohne Entwurf meldet sich.
 */
describe("Hinweis beim Ablegen eines Entwurfs", () => {
    it("🔴 ✕ mit Entwurf: einmal; ohne Entwurf und nach dem Speichern neu", async () => {
        const fenster = createWerkzeugfenster(undefined);
        const melde = vi.fn();
        const stop = installAblageHinweis(fenster, melde);
        const id = fenster.oeffne({ werkzeug: "landschaftseditor", gegenstand: "tal", titel: "Tal", nurLesen: false });
        fenster.markiere(id, { ungespeichert: true });
        await nextTick();
        fenster.schliesse(id);
        await nextTick();
        expect(fenster.stand.value.fenster.find((f) => f.id === id)?.lage).toBe("versenkt");
        expect(melde).toHaveBeenCalledTimes(1);
        // Hervorholen und wieder ablegen: derselbe Entwurf, kein zweiter Hinweis.
        fenster.hervorholen(id);
        await nextTick();
        fenster.schliesse(id);
        await nextTick();
        expect(melde).toHaveBeenCalledTimes(1);
        // Gespeichert, dann ein neuer Entwurf: wieder einmal.
        fenster.hervorholen(id);
        fenster.markiere(id, { ungespeichert: false });
        await nextTick();
        fenster.markiere(id, { ungespeichert: true });
        await nextTick();
        fenster.schliesse(id);
        await nextTick();
        expect(melde).toHaveBeenCalledTimes(2);
        // Ohne Entwurf geht das Fenster zu, ohne Hinweis.
        const leer = fenster.oeffne({
            werkzeug: "landschaftseditor",
            gegenstand: "wald",
            titel: "Wald",
            nurLesen: false,
        });
        await nextTick();
        fenster.schliesse(leer);
        await nextTick();
        expect(melde).toHaveBeenCalledTimes(2);
        stop();
    });
});
