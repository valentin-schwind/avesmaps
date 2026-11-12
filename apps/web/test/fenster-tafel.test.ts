import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 🔴 EINE Tafel, EIN Ort für ihre Regeln (WI-0076, Betreiber 2026-10-04: „Tabelle B“; Guide §12.6, §17.9, §17.12).
 *
 * Kopfband, Zebra, Achsen, Ausrichtung und Ampel stehen in `src/fenster/fenster-tafel.vue`. Eine Datei, die eine Tafel
 * in `FensterTafel` setzt, gestaltet Tabellenelemente nicht selbst - sonst entsteht wieder je Tafel ein eigenes Design
 * (vorher: Flugmittel ohne Linien, Geldtafel mittig, Tempotafel mit goldener Ecke).
 *
 * ⭐ Die Probe „💣“ beweist, dass der Wächter anschlagen kann.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = join(repositoryRoot, "apps", "web", "src");
const TAFEL = "apps/web/src/fenster/fenster-tafel.vue";

/** Der Stilblock einer Vue-Datei ohne Kommentare - ein Kommentar darf die Regel nennen, um sie zu begründen. */
function stil(inhalt: string): string {
    return [...inhalt.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)]
        .map((treffer) => treffer[1] ?? "")
        .join("\n")
        .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Selektoren, die ein Tabellenelement gestalten (`table`, `thead`, `tbody`, `tr`, `th`, `td`). */
function tabellenregeln(css: string): string[] {
    const selektoren = [...css.matchAll(/([^{}]+)\{/g)].map((treffer) => (treffer[1] ?? "").trim());
    return selektoren.filter((selektor) => /(^|[\s>+~,(])(table|thead|tbody|tr|th|td)\b(?![-\w])/.test(selektor));
}

const NUTZER = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((pfad) => pfad.endsWith(".vue"))
    .map((pfad) => relative(repositoryRoot, join(SRC, pfad)).replace(/\\/g, "/"))
    .filter((datei) => datei !== TAFEL)
    .filter((datei) => readFileSync(join(repositoryRoot, datei), "utf8").includes("<FensterTafel"))
    .sort();

describe("🔴 Eine Tafel, ein Ort für ihre Regeln (FensterTafel)", () => {
    it("die Tafeln der Erklärfenster und der Hinweise stehen in FensterTafel", () => {
        expect(NUTZER).toEqual([
            // WI-0120 A10: die Matrix der Rechte und das Protokoll der Verwaltung - beides liest man nur.
            // WI-0127 SYS-13 und SYS-8: die Tafel je Landschaftsart, die Komponenten und die größten Tabellen.
            // KANAL-0001 K3: die Gruppe „Fix-Berichte“ im Protokoll der Systemsteuerung, nur lesend.
            "apps/web/src/auth/kanal-berichte.vue",
            "apps/web/src/auth/versionen-liste.vue",
            "apps/web/src/auth/verwaltung-hoehenmodell.vue",
            "apps/web/src/auth/verwaltung-inhalte.vue",
            "apps/web/src/auth/verwaltung-protokoll.vue",
            "apps/web/src/auth/verwaltung-rollen.vue",
            // WI-0279: die Zuteilungen einer Sonderrolle.
            "apps/web/src/auth/verwaltung-sonderrollen.vue",
            "apps/web/src/auth/verwaltung-systemzustand.vue",
            "apps/web/src/legal/hinweise-bedienung.vue",
            "apps/web/src/route-planner/route-options-info-fenster.vue",
            "apps/web/src/route-planner/transport-info-fenster.vue",
            "apps/web/src/route-planner/transport-info-flug.vue",
        ]);
    });

    it("🔴 keine Datei mit FensterTafel gestaltet Tabellenelemente selbst", () => {
        const verstoesse = NUTZER.flatMap((datei) =>
            tabellenregeln(stil(readFileSync(join(repositoryRoot, datei), "utf8"))).map(
                (regel) => `${datei}: ${regel}`,
            ),
        );
        expect(verstoesse).toEqual([]);
    });

    it("💣 Probe: eine eigene Zellregel schlägt an", () => {
        expect(tabellenregeln(".flugmittel td {\n color: red;\n}\n.legende {\n gap: 0;\n}")).toEqual([
            ".flugmittel td",
        ]);
        expect(tabellenregeln(".tasten__zeile {\n white-space: nowrap;\n}")).toEqual([]);
    });

    it("das Kopfband, das Zebra und die Ampel stehen in FensterTafel", () => {
        const css = stil(readFileSync(join(repositoryRoot, TAFEL), "utf8"));
        expect(css).toContain("var(--color-disclosure-bg)");
        expect(css).toMatch(/nth-child\(even of :not\(:has\(> th\[scope="rowgroup"\]\)\)\)/);
        for (const stufe of ["fast", "mid", "slow"]) {
            expect(css).toContain(`var(--color-tier-${stufe}-bg)`);
            expect(css).toContain(`var(--color-tier-${stufe}-text)`);
        }
    });
});
