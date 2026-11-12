import { describe, expect, it } from "vitest";
import { nextTick, shallowRef } from "vue";
import type { AuthSnapshot } from "../src/auth/session-state.ts";
import { folgeSeitentitel, seitentitel } from "../src/auth/seitentitel.ts";

/**
 * Der Browsertitel folgt der Sitzung UND der Umgebung (Betreiber 2026-10-12: „die seite stage.avesmaps.de → Avesmaps · Stage,
 * avesmaps.de → Avesmaps; wenn man im editor ist Avesmaps · Stage · Editor bzw. Avesmaps · Editor“). Das ersetzt die Fassung vom
 * 2026-10-11, die die Umgebung bewusst wegließ — seit Production öffentlich steht, hat man beide Tabs offen.
 */
function sitzung(angemeldet: boolean, environment = "staging"): AuthSnapshot {
    return {
        known: true,
        authEnabled: true,
        environment,
        person: angemeldet ? ({ id: "p1", displayName: "Rondrikan", role: "editor" } as AuthSnapshot["person"]) : null,
        capabilities: angemeldet ? ["use_editor_menu"] : [],
    };
}

describe("Seitentitel", () => {
    it("🔴 die vier Fälle des Betreibers, wörtlich", () => {
        expect(seitentitel(sitzung(false, "production"))).toBe("Avesmaps");
        expect(seitentitel(sitzung(true, "production"))).toBe("Avesmaps · Editor");
        expect(seitentitel(sitzung(false, "staging"))).toBe("Avesmaps · Stage");
        expect(seitentitel(sitzung(true, "staging"))).toBe("Avesmaps · Stage · Editor");
    });

    it("🔴 nur die Stage trägt ihre Umgebung; lokal und ohne Sitzung bleibt es die blanke Marke", () => {
        expect(seitentitel(sitzung(false, "development"))).toBe("Avesmaps");
        expect(seitentitel(sitzung(true, "development"))).toBe("Avesmaps · Editor");
        // Ohne Antwort des Servers oder ohne eingerichtete Anmeldung gibt es keine Sitzung.
        expect(seitentitel({ ...sitzung(false, "production"), known: false, authEnabled: false })).toBe("Avesmaps");
    });

    it("🔴 folgt der Sitzung, nicht nur beim Laden: anmelden setzt, abmelden nimmt den Zusatz wieder weg", async () => {
        const stand = shallowRef(sitzung(false));
        const seite = { title: "" };
        const stop = folgeSeitentitel(stand, seite);
        expect(seite.title).toBe("Avesmaps · Stage");
        stand.value = sitzung(true);
        await nextTick();
        expect(seite.title).toBe("Avesmaps · Stage · Editor");
        stand.value = sitzung(false);
        await nextTick();
        expect(seite.title).toBe("Avesmaps · Stage");
        stop();
        stand.value = sitzung(true);
        await nextTick();
        expect(seite.title, "nach stop() rührt er den Titel nicht mehr an").toBe("Avesmaps · Stage");
    });

    it("🔴 folgt auch der Umgebung: dieselbe Sitzung auf Production trägt kein „Stage“", async () => {
        const stand = shallowRef(sitzung(true, "staging"));
        const seite = { title: "" };
        const stop = folgeSeitentitel(stand, seite);
        expect(seite.title).toBe("Avesmaps · Stage · Editor");
        stand.value = sitzung(true, "production");
        await nextTick();
        expect(seite.title).toBe("Avesmaps · Editor");
        stop();
    });
});
