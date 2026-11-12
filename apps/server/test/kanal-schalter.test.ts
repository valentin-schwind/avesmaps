import { describe, expect, it } from "vitest";
import { capabilitiesFor } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { loadAuthConfig } from "../src/auth/config.ts";
import { KANAL_CAPABILITY, kanalSchalter, rechteHier } from "../src/kanal/schalter.ts";
import { TEST_AUTH } from "./support/auth-fixture.ts";

/**
 * `KANAL=aus`: Der Betreiber-Kanal lebt nur dort, wo ihn jemand liest (Betreiber 2026-10-13, wörtlich: „dann deaktiviert noch "Claudia und
 * Claudio" für production“). Ohne Datenbank: Der Schalter wirkt vor jeder Abfrage.
 *
 * - 🔴 Ohne Wert bleibt der Kanal **an**. Vergisst eine Umgebung den Wert, ändert sich nichts; abschalten ist die Ausnahme.
 * - 🔴 Ein Tippfehler hält den Start an, statt still „an“ zu bedeuten.
 * - Bei `aus` fällt `use_operator_channel` aus den Rechten — davon leben Eintrag und Glocke, ohne den Schalter zu kennen.
 * - Die Routen antworten dann 410 `kanal_unavailable` mit Satz, nicht 403 „Dafür fehlt das Recht“: Das Recht fehlt ja nicht.
 */

function config(kanal: "an" | "aus"): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "kanal-schalter-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        kanal,
        auth: { ...TEST_AUTH, kanal },
    };
}

describe("KANAL: der Schalter der Umgebung", () => {
    it("liest `an` ohne Wert, beide Werte ausdrücklich, und hält bei einem Tippfehler an", () => {
        expect(kanalSchalter({})).toBe("an");
        expect(kanalSchalter({ KANAL: "" })).toBe("an");
        expect(kanalSchalter({ KANAL: "an" })).toBe("an");
        expect(kanalSchalter({ KANAL: "aus" })).toBe("aus");
        expect(() => kanalSchalter({ KANAL: "off" })).toThrow(/KANAL/u);
        expect(() => kanalSchalter({ KANAL: "AUS" })).toThrow(/KANAL/u);
    });

    it("trägt den Wert aus der Umgebung in die Konfiguration der Anmeldung", () => {
        expect(loadAuthConfig({ AVESMAPS_ENV: "production", PUBLIC_ORIGIN: "https://avesmaps.de" }).kanal).toBe("an");
        expect(
            loadAuthConfig({ AVESMAPS_ENV: "production", PUBLIC_ORIGIN: "https://avesmaps.de", KANAL: "aus" }).kanal,
        ).toBe("aus");
    });

    it("nimmt bei `aus` genau eine Capability weg und lässt sonst alles stehen", () => {
        const betreiber = capabilitiesFor("operator");
        expect(betreiber.has(KANAL_CAPABILITY)).toBe(true);

        const an = rechteHier(betreiber, "an");
        expect(an).toBe(betreiber);

        const aus = rechteHier(betreiber, "aus");
        expect(aus.has(KANAL_CAPABILITY)).toBe(false);
        expect(aus.size).toBe(betreiber.size - 1);
        for (const recht of betreiber) if (recht !== KANAL_CAPABILITY) expect(aus.has(recht)).toBe(true);
    });

    it("lässt die Rechte eines Editors unberührt, der die Capability ohnehin nicht hat", () => {
        const editor = capabilitiesFor("editor");
        expect(editor.has(KANAL_CAPABILITY)).toBe(false);
        expect(rechteHier(editor, "aus")).toBe(editor);
    });

    it("antwortet auf jede Kanal-Route 410 `kanal_unavailable`, auch ohne Anmeldung", async () => {
        const app = buildApp({ config: config("aus"), logStream: { write: () => undefined } });
        await app.ready();
        try {
            for (const url of ["/api/kanal/vorgaenge", "/api/kanal/zaehler", "/api/kanal/aenderungen"]) {
                const response = await app.inject({ method: "GET", url });
                expect(response.statusCode, url).toBe(410);
                expect((response.json() as { error: { code: string } }).error.code).toBe("kanal_unavailable");
            }
        } finally {
            await app.close();
        }
    });

    it("lässt die Routen bei `an` weiterlaufen: der Schalter greift nicht, es entscheidet der übliche Weg", async () => {
        const app = buildApp({ config: config("an"), logStream: { write: () => undefined } });
        await app.ready();
        try {
            const response = await app.inject({ method: "GET", url: "/api/kanal/vorgaenge" });
            // Ohne Datenbank kommt die Sitzung nicht zustande: 503 `auth_unavailable` (der Korridor startet Fastify vor `migrate`).
            // Entscheidend ist, dass es NICHT der Schalter ist.
            expect(response.statusCode).toBe(503);
            expect((response.json() as { error: { code: string } }).error.code).not.toBe("kanal_unavailable");
        } finally {
            await app.close();
        }
    });
});
