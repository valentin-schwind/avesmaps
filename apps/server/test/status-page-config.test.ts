import { describe, expect, it } from "vitest";

import { loadConfig, statusPageEnabled } from "../src/config.ts";

/**
 * 🔴 Die Statusseite der Queue ist nur lokal an, bis Auth und Rollen geklärt sind (Betreiber 2026-10-04: „ich würde mit der
 * statusseite noch abwarten, bis auth geklärt ist“). Ein Release hat immer eine `RELEASE_ID`; vergisst der Betrieb
 * `STATUS_PAGE`, bleibt die Seite dort trotzdem aus.
 */
describe("Statusseite: Schalter", () => {
    it("lokal ohne RELEASE_ID oder mit dev an", () => {
        expect(statusPageEnabled({})).toBe(true);
        expect(statusPageEnabled({ RELEASE_ID: "dev" })).toBe(true);
    });

    it("in jedem Release (Stage, Production) ohne Schalter aus", () => {
        expect(statusPageEnabled({ RELEASE_ID: "20261004T102523Z-ea2512a" })).toBe(false);
        expect(loadConfig({ RELEASE_ID: "20261004T102523Z-ea2512a" }).statusPage).toBe(false);
    });

    it("STATUS_PAGE=on oder off überstimmt", () => {
        expect(statusPageEnabled({ RELEASE_ID: "20261004T102523Z-ea2512a", STATUS_PAGE: "on" })).toBe(true);
        expect(statusPageEnabled({ STATUS_PAGE: "off" })).toBe(false);
    });
});
