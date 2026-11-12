import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 🔴 JEDES KARTENSCHILD IST DIE HÜLLE (Design Guide §15.3, Rezept „Einen Kartentooltip bauen“).
 *
 * Der Betreiber, 2026-10-03: erst Legacys Zettel statt des Gebiets-Kastens („deins hässlich, alt schön“), dann alle
 * Kartenschilder in einer Fassung. Ein Schild an einer Stelle der Karte, das etwas benennt, entsteht nur als
 * `<MapTooltip>` (`src/map/map-tooltip.vue`). Wer den Tooltipschatten (`--shadow-tooltip`), eines der Maße
 * (`--avm-tooltip-*`) oder die Hüllenklasse (`.map-tooltip`) außerhalb der Hülle benutzt, schreibt ein zweites Schild und
 * bekommt diesen Test rot.
 *
 * ⭐ Eine absichtlich falsche Probe steht mit im Test („💣 …“): Sie beweist, dass der Wächter rot werden KANN.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const webRoot = join(repositoryRoot, "apps", "web");
const HUELLE = "apps/web/src/map/map-tooltip.vue";

/** Die Schilder der Karte, die die Hülle benutzen müssen. */
const SCHILDER = [
    "apps/web/src/map/route-border-label.vue",
    "apps/web/src/controls/area-hover-chip.vue",
    "apps/web/src/map/waypoint-snap-label.vue",
] as const;

/** Woran man ein selbstgebautes Kartenschild erkennt: die Verwendung der Tokens, nicht ihre Definition (`canon.css`). */
const MERKMALE: readonly [string, RegExp][] = [
    ["var(--shadow-tooltip)", /var\(\s*--shadow-tooltip\b/],
    ["var(--avm-tooltip-…)", /var\(\s*--avm-tooltip-/],
    [".map-tooltip (Hüllenklasse)", /\.map-tooltip(?![\w-]*--leave)\b/],
];

/** Ein Quelltext ohne Kommentare: Ein Kommentar darf das Verbotene nennen, um es zu begründen. */
function ohneKommentare(inhalt: string): string {
    return inhalt
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function merkmale(inhalt: string): string[] {
    const code = ohneKommentare(inhalt);
    return MERKMALE.filter(([, muster]) => muster.test(code)).map(([name]) => name);
}

function dateien(wurzel: string): string[] {
    return readdirSync(wurzel, { recursive: true, encoding: "utf8" })
        .filter((pfad) => /\.(vue|ts)$/.test(pfad) && !/(^|[\\/])(node_modules|dist)[\\/]/.test(pfad))
        .map((pfad) => relative(repositoryRoot, join(wurzel, pfad)).replace(/\\/g, "/"))
        .sort();
}

const QUELLEN = dateien(join(webRoot, "src"));
const lesen = (datei: string): string => readFileSync(join(repositoryRoot, datei), "utf8");

describe("🔴 Jedes Kartenschild ist die Hülle (Guide §15.3)", () => {
    it("🔴 kein eigenes Kartenschild außerhalb von src/map/map-tooltip.vue", () => {
        const verstoesse = QUELLEN.filter((datei) => datei !== HUELLE)
            .map((datei) => [datei, merkmale(lesen(datei))] as const)
            .filter(([, funde]) => funde.length > 0)
            .map(([datei, funde]) => `${datei}: ${funde.join(", ")} - baue das Schild als <MapTooltip> (Guide §15.3)`);
        expect(verstoesse).toEqual([]);
    });

    it("die Hülle selbst trägt, was sie allen abnimmt", () => {
        expect(merkmale(lesen(HUELLE))).toEqual([
            "var(--shadow-tooltip)",
            "var(--avm-tooltip-…)",
            ".map-tooltip (Hüllenklasse)",
        ]);
    });

    it("🔴 die Schilder der Karte benutzen die Hülle", () => {
        for (const datei of SCHILDER) {
            const code = ohneKommentare(lesen(datei));
            expect(code, `${datei} muss MapTooltip importieren`).toMatch(
                /import\s+MapTooltip\s+from\s+["'][^"']*map-tooltip\.vue["']/,
            );
            expect(code, `${datei} muss <MapTooltip> verwenden`).toMatch(/<MapTooltip\b/);
        }
    });

    it("🔴 die Hülle gibt es nur einmal: kein zweites Schild mit Pfeil aus einer Randdreieck-Rezeptur", () => {
        // Ein selbstgebauter Pfeil wäre `border: … solid transparent` mit `content: ""` in einer anderen Datei.
        const pfeile = QUELLEN.filter((datei) => datei !== HUELLE)
            .filter((datei) => /::after[\s\S]{0,200}solid\s+transparent/.test(ohneKommentare(lesen(datei))))
            .filter((datei) => /tooltip|schild|label/i.test(datei));
        expect(pfeile).toEqual([]);
    });

    it("💣 die Probe: ein selbstgebautes Schild wird erkannt", () => {
        const falsch = `<style scoped>.chip { box-shadow: var(--shadow-tooltip); padding: var(--avm-tooltip-pad); }</style>`;
        expect(merkmale(falsch)).toEqual(["var(--shadow-tooltip)", "var(--avm-tooltip-…)"]);
        // Ein Kommentar darf es nennen.
        expect(merkmale("/* der Schatten `var(--shadow-tooltip)` gehört der Hülle */ .x { color: red }")).toEqual([]);
    });
});
