import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `legacy:update` läuft nur als Programm, nie beim bloßen `import()` (Koordination 2026-09-29): Ein Probeladen
 * unter Type-Stripping holte live Legacys Satz und schrieb ihn ins Fach, während ein Zug startete.
 */
describe("legacy-update-cli beim Import", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("🔴 holt nichts und liest keine fremde Befehlszeile", async () => {
        const geholt: string[] = [];
        vi.stubGlobal("fetch", (url: string) => {
            geholt.push(String(url));
            return Promise.reject(new Error("kein Netz im Test"));
        });
        await import("../src/migration/legacy-update-cli.ts");
        expect(geholt).toEqual([]);
        expect(process.exitCode ?? 0).toBe(0);
    });
});
