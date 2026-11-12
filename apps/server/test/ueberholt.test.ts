import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_UEBERHOLT, ueberholtZeile } from "../../../scripts/dev/ueberholt.ts";

/**
 * „Überholt“ beim Drankommen an der Prüfbank (`scripts/dev/ueberholt.ts`, Hauptorchestrierung 2026-10-18). Problemfall: Acht von 19 Tickets
 * prüften einen Commit, der nicht mehr der HEAD ihrer Arbeitskopie war, und einige Sitzungen konnten diese Läufe nicht beenden.
 */
const ALT = "1562e7acf0000000000000000000000000000000";
const NEU = "15c3acd700000000000000000000000000000000";

describe("überholter Prüflauf", () => {
    it("🔴 der HEAD ist weitergegangen: eine Zeile ÜBERHOLT mit beiden Ständen, kein Rot", () => {
        const zeile = ueberholtZeile({
            sha: ALT,
            genannt: false,
            headJetzt: () => ({ sha: NEU, betreff: "docs(WI-0177): Karawanenroute gebaut" }),
        });
        expect(zeile).toMatch(
            /^ {2}ÜBERHOLT {2}Dieser Lauf prüft 1562e7ac, der HEAD deiner Arbeitskopie ist jetzt 15c3acd7/,
        );
        expect(zeile).toContain("„docs(WI-0177): Karawanenroute gebaut“");
        expect(zeile).not.toMatch(/ROT/);
    });

    it("🔴 ausdrücklich genannter Commit (`vor-dem-push -- <commit>`): nie überholt, auch wenn der HEAD weiter ist", () => {
        let gefragt = false;
        const zeile = ueberholtZeile({
            sha: ALT,
            genannt: true,
            headJetzt: () => {
                gefragt = true;
                return { sha: NEU, betreff: "x" };
            },
        });
        expect(zeile).toBeUndefined();
        expect(gefragt, "ohne Grund nicht einmal nachfragen").toBe(false);
    });

    it("der HEAD ist noch derselbe, oder Git gibt ihn nicht her: prüfen wie bisher", () => {
        expect(
            ueberholtZeile({ sha: ALT, genannt: false, headJetzt: () => ({ sha: ALT, betreff: "x" }) }),
        ).toBeUndefined();
        expect(ueberholtZeile({ sha: ALT, genannt: false, headJetzt: () => undefined })).toBeUndefined();
    });

    it("eigener Exit-Code: weder grün (0) noch rot (1) noch die Fehler der Aufrufe (2, 127)", () => {
        expect(EXIT_UEBERHOLT).toBe(3);
    });

    it("🔴 vor-dem-push fragt nach dem Drankommen nach und nimmt Lint, Bau und Typcheck an den Vorlauf mit zwei Plätzen", () => {
        // Wortlaut-Kopplung: Die Logik steht in den Modulen; dies hält fest, dass `vor-dem-push` sie wirklich aufruft.
        const quelle = readFileSync(
            join(import.meta.dirname, "..", "..", "..", "scripts", "dev", "vor-dem-push.ts"),
            "utf8",
        );
        const bank = quelle.indexOf('art: "vor-dem-push --tests"');
        const frage = quelle.indexOf("ueberholtZeile({", bank);
        expect(bank).toBeGreaterThan(0);
        expect(frage, "die Frage folgt dem Drankommen").toBeGreaterThan(bank);
        expect(quelle).toMatch(/genannt: ref !== "HEAD"/);
        expect(quelle).toMatch(/process\.exit\(EXIT_UEBERHOLT\)/);
        expect(quelle).toMatch(/plaetze: VORLAUF_PLAETZE/);
        expect(quelle).toMatch(/const VORLAUF_PLAETZE = 2;/);
    });
});
