import { describe, expect, it } from "vitest";
import { landschaftSofort } from "../src/landschaftseditor/landschaft-flaechen";

/**
 * Der Fehlersatz der Flächenwerkzeuge der Derographie (Unterflächen, Zerschneiden, Mit anderer Fläche): Der Server antwortet mit `{ error: { message } }`.
 * Vorher las der Helfer nur `message` oben und zeigte „HTTP 400“ statt des Satzes (Befund WI-0261 Stufe 3, Editor-Orchestrierung 2026-10-31).
 */
describe("Fehlersatz der Flächenwerkzeuge", () => {
    const antwort = (status: number, body: unknown): typeof fetch =>
        (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

    it("🔴 der Satz aus `error.message` des Servers, nicht der Status", async () => {
        const quelle = landschaftSofort({
            fetcher: antwort(400, { error: { code: "invalid", message: "Die Flächen berühren einander nicht." } }),
        });
        expect(await quelle.lies("region", "flaeche")).toEqual({
            ok: false,
            satz: "Die Flächen berühren einander nicht.",
        });
    });

    it("ohne Satz im Körper: der Status", async () => {
        const quelle = landschaftSofort({ fetcher: antwort(503, {}) });
        expect(await quelle.lies("region", "flaeche")).toEqual({ ok: false, satz: "HTTP 503" });
    });
});
