import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { truncatedAddress } from "../src/log-address.ts";

/**
 * WI-0085, Folgeschritt (Betreiber 2026-10-06, über Claudio: „Die gekürzte IP in Fastify/Pino bitte zusätzlich als Folgeschritt
 * vorsehen; Nginx darf die vollständige IP für maximal 14 Tage behalten.“): Das Protokoll des Servers führt die Adresse eines
 * Besuchers nur gekürzt, IPv4 auf /24 und IPv6 auf /48 (`handovers/2026-10-05-wi0085-logaufbewahrung-antwort.md`).
 */
describe("gekürzte Adresse im Protokoll (WI-0085)", () => {
    it.each([
        ["203.0.113.77", "203.0.113.0"],
        ["10.77.0.1", "10.77.0.0"],
        ["::ffff:203.0.113.77", "::ffff:203.0.113.0"],
        ["2001:db8:abcd:12:34:56:78:9a", "2001:db8:abcd::"],
        ["2001:db8::1", "2001:db8:0::"],
        ["::1", "0:0:0::"],
        ["fe80::1%eth0", "fe80:0:0::"],
    ])("%s → %s", (address, expected) => {
        expect(truncatedAddress(address)).toBe(expected);
    });

    it("kein oder ein unlesbarer Wert bleibt keine Adresse", () => {
        expect(truncatedAddress(undefined)).toBeUndefined();
        expect(truncatedAddress("")).toBeUndefined();
        expect(truncatedAddress("kein-host")).toBeUndefined();
    });

    it("🔴 die Anfragezeile des Servers trägt die gekürzte Adresse, nie die volle", async () => {
        const log: string[] = [];
        const app = buildApp({
            config: { ...loadConfig(), databaseUrl: undefined },
            logStream: { write: (line) => void log.push(line) },
        });
        try {
            // Hinter Nginx: `trustProxy: "loopback"` nimmt die Adresse aus `X-Forwarded-For`, wie auf Stage und Production.
            await app.inject({
                method: "GET",
                url: "/health",
                headers: { "x-forwarded-for": "198.51.100.23" },
                remoteAddress: "127.0.0.1",
            });
        } finally {
            await app.close();
        }
        const incoming = log.map((line) => JSON.parse(line) as { msg?: string; req?: { remoteAddress?: string } });
        const request = incoming.find((entry) => entry.msg === "incoming request");
        expect(request?.req?.remoteAddress).toBe("198.51.100.0");
        expect(log.join("\n")).not.toContain("198.51.100.23");
    });
});
