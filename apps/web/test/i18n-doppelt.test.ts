import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Kein Schlüssel steht zweimal in einer Sprachtafel.
 *
 * 🔴 **Warum dieser Test und nicht nur der Typcheck.** `tsc` meldet TS1117 — aber erst im Bau, und bis dahin steht die
 * automatische Stage. Am 13. und 14.10.2026 ist genau das dreimal passiert (Claudios Befunde: 19 Galerie-Schlüssel, dann
 * 18 des Unterreiters „Server“): Zwei Sitzungen fügen dieselben Zeilen hinzu, ein Merge nimmt beide Seiten, und niemand
 * sieht es, weil die Werte gleich sind und der Diff groß ist. Dieser Fall braucht keine Sekunde und nennt den Schlüssel.
 *
 * 🪤 Gelesen wird die Datei als Text, nicht importiert: Ein Objektliteral verliert das Duplikat beim Auswerten — die
 * zweite Zeile überschreibt still die erste, und genau danach suchen wir.
 */

const TAFELN = ["de", "en", "fr", "nl", "it", "es", "pl"] as const;

function schluessel(inhalt: string): string[] {
    return [...inhalt.matchAll(/^\s*"([^"]+)":/gmu)].map((treffer) => treffer[1] as string);
}

describe("Die Sprachtafeln", () => {
    for (const sprache of TAFELN) {
        it(`${sprache}.ts trägt jeden Schlüssel genau einmal`, () => {
            const pfad = new URL(`../src/i18n/${sprache}.ts`, import.meta.url);
            const alle = schluessel(readFileSync(pfad, "utf8"));
            const gesehen = new Set<string>();
            const doppelt = alle.filter((key) => (gesehen.has(key) ? true : (gesehen.add(key), false)));
            expect(doppelt, `doppelt in ${sprache}.ts: ${doppelt.join(", ")}`).toEqual([]);
        });
    }

    it("🔴 beide Tafeln kennen dieselben Schlüssel", () => {
        const [de, en] = TAFELN.map((sprache) =>
            schluessel(readFileSync(new URL(`../src/i18n/${sprache}.ts`, import.meta.url), "utf8")),
        ) as [string[], string[]];
        const fehltInEn = de.filter((key) => !en.includes(key));
        const fehltInDe = en.filter((key) => !de.includes(key));
        expect({ fehltInEn, fehltInDe }).toEqual({ fehltInEn: [], fehltInDe: [] });
    });
});
