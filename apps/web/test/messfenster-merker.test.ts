import { describe, expect, it } from "vitest";
import type { Speicher } from "../src/editor-panel/editor-panel-nav.ts";
import {
    MESSFENSTER_OFFEN_SCHLUESSEL,
    merkeMessfensterOffen,
    messfensterOeffnetBeimLaden,
} from "../src/system/messfenster-merker.ts";

/**
 * Das Messfenster bleibt offen, bis es jemand zumacht (WI-0150, Kanal OPS-000002, Thomas: „Links unten immer sichtbar (im
 * Editormodus) ein Informationsfenster"). Reine Logik ohne Browser, wie `editor-panel-nav.ts` sie für das Panel hat.
 */

function tafel(werte: Record<string, string> = {}): Speicher & { werte: Record<string, string> } {
    return {
        werte,
        getItem: (schluessel: string) => werte[schluessel] ?? null,
        setItem: (schluessel: string, wert: string) => void (werte[schluessel] = wert),
        removeItem: (schluessel: string) => void delete werte[schluessel],
    };
}

/** Ein Speicher, dessen Zugriff wirft (gesperrte Website-Daten, privates Fenster). */
const wirft: Speicher = {
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

describe("Das Messfenster kommt wieder, wenn es offen war (WI-0150)", () => {
    it("beim ersten Besuch bleibt es zu - niemand hat es je geöffnet", () => {
        expect(messfensterOeffnetBeimLaden(tafel(), false)).toBe(false);
        expect(messfensterOeffnetBeimLaden(undefined, false)).toBe(false);
    });

    it("war es offen, geht es beim Laden wieder auf", () => {
        expect(messfensterOeffnetBeimLaden(tafel({ [MESSFENSTER_OFFEN_SCHLUESSEL]: "offen" }), false)).toBe(true);
    });

    it("🔴 ein eigenes Zumachen hält es zu", () => {
        expect(messfensterOeffnetBeimLaden(tafel({ [MESSFENSTER_OFFEN_SCHLUESSEL]: "zu" }), false)).toBe(false);
    });

    it("🔴 am Telefon nie - dort deckt ein Fenster die ganze Karte (EDIT-0001 §7.1 E3)", () => {
        expect(messfensterOeffnetBeimLaden(tafel({ [MESSFENSTER_OFFEN_SCHLUESSEL]: "offen" }), true)).toBe(false);
    });

    it("💣 Unsinn im Speicher zählt als nichts Gemerktes, nicht als offen", () => {
        expect(messfensterOeffnetBeimLaden(tafel({ [MESSFENSTER_OFFEN_SCHLUESSEL]: "vielleicht" }), false)).toBe(false);
    });

    it("ein werfender Speicher nimmt dem Editor nichts - zu, ohne Fehler", () => {
        expect(messfensterOeffnetBeimLaden(wirft, false)).toBe(false);
        expect(() => merkeMessfensterOffen(wirft, true)).not.toThrow();
    });

    it("merkt beides unter dem Schlüssel des Werkzeugs", () => {
        const speicher = tafel();
        merkeMessfensterOffen(speicher, true);
        expect(speicher.werte[MESSFENSTER_OFFEN_SCHLUESSEL]).toBe("offen");
        merkeMessfensterOffen(speicher, false);
        expect(speicher.werte[MESSFENSTER_OFFEN_SCHLUESSEL]).toBe("zu");
    });

    it("🔴 der Schlüssel liegt bei der gemerkten Lage desselben Werkzeugs", () => {
        // `werkzeugfenster.ts` merkt Lage und Box unter `avesmaps3d.fenster.messwerte`; der Offen-Zustand gehört dazu.
        expect(MESSFENSTER_OFFEN_SCHLUESSEL).toBe("avesmaps3d.fenster.messwerte.offen");
    });
});
