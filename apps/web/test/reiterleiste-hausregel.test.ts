import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Hausregel „Eine Reiterleiste“ (Design Guide §9, WI-0256). Der Betreiber fand die Leisten uneinheitlich und wollte sie im Guide fest
 * vorgeschrieben (2026-10-26: „vielleicht kann man da mal drüber und im designguide fest vorschreiben wie die auszusehen hat“); die
 * Gestalt hat er an der Probierseite abgenommen („A Lasche ist exakt das was ich wollte“). Sie wohnt in EINEM Bauteil,
 * `fenster/fenster-reiter.vue`. Dieser Test wird rot, sobald ein anderes Bauteil unter `apps/web/src` wieder eine eigene Leiste mit
 * `role="tablist"` oder eigene Reiter mit `role="tab"` baut, wie es die Statusseite bis WI-0256 tat.
 */

const WEB_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
const DAS_BAUTEIL = "fenster/fenster-reiter.vue";

function vueDateien(ordner: string): string[] {
    return readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) => {
        const pfad = join(ordner, eintrag.name);
        if (eintrag.isDirectory()) return vueDateien(pfad);
        return eintrag.name.endsWith(".vue") ? [pfad] : [];
    });
}

describe("Hausregel: eine Reiterleiste (Guide §9)", () => {
    it("nur FensterReiter baut Reiter mit role=tablist oder role=tab", () => {
        const fremde = vueDateien(WEB_SRC)
            .map((pfad) => relative(WEB_SRC, pfad).replaceAll("\\", "/"))
            .filter((datei) => datei !== DAS_BAUTEIL)
            .filter((datei) => /role\s*=\s*["'](tablist|tab)["']/.test(readFileSync(join(WEB_SRC, datei), "utf8")));
        expect(fremde, "eigene Reiterleiste statt FensterReiter (fenster/fenster-reiter.vue)").toEqual([]);
    });

    it("das Bauteil selbst trägt die Rollen noch", () => {
        const quelle = readFileSync(join(WEB_SRC, DAS_BAUTEIL), "utf8");
        expect(quelle).toContain('role="tablist"');
        expect(quelle).toContain('role="tab"');
    });
});
