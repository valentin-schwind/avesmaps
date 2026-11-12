import { describe, expect, it, vi } from "vitest";
import { lokalErreichbar } from "../src/auth/lokal-probe";

/** Die eine Probe ins Tailnet (WI-0180 §7, §9, §11): Menü und „Prüfen“ im Reiter „Umgebungen“ nehmen dieselbe Funktion. */
describe("lokalErreichbar", () => {
    it("🔴 fragt die Wurzel ohne Cookies und ohne CORS; jede Antwort zählt als erreichbar", async () => {
        const abrufen = vi.fn<typeof fetch>(async () => new Response(null, { status: 502 }));
        expect(await lokalErreichbar("https://rechner.tailnet.ts.net:8443", { abrufen })).toBe(true);
        const [ziel, optionen] = abrufen.mock.calls[0]!;
        expect(String(ziel)).toBe("https://rechner.tailnet.ts.net:8443/");
        expect(optionen).toMatchObject({ mode: "no-cors", credentials: "omit", cache: "no-store" });
    });

    it("🔴 scheitert der Abruf oder klemmt er über die Frist, ist Lokal nicht erreichbar", async () => {
        expect(
            await lokalErreichbar("https://rechner.tailnet.ts.net", {
                abrufen: async () => {
                    throw new TypeError("Failed to fetch");
                },
            }),
        ).toBe(false);
        const haengt: typeof fetch = (_ziel, init) =>
            new Promise((_fertig, fehler) => init?.signal?.addEventListener("abort", () => fehler(new Error("abort"))));
        const beginn = Date.now();
        expect(await lokalErreichbar("https://rechner.tailnet.ts.net", { abrufen: haengt, fristMs: 50 })).toBe(false);
        expect(Date.now() - beginn).toBeLessThan(1_000);
    });

    it("🔴 nur HTTPS; eine http-Adresse oder Unsinn wird gar nicht erst gefragt", async () => {
        const abrufen = vi.fn<typeof fetch>();
        expect(await lokalErreichbar("http://100.102.26.41:5174", { abrufen })).toBe(false);
        expect(await lokalErreichbar("kaputt", { abrufen })).toBe(false);
        expect(abrufen).not.toHaveBeenCalled();
    });
});
