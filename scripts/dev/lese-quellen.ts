import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { TestDatei } from "./pruef-auswahl.ts";

export function leseQuellen(wurzel: string): TestDatei[] {
    const ergebnis: TestDatei[] = [];
    const offen = [wurzel];
    const ignoriert = new Set([
        "node_modules",
        ".release-runs",
        ".test-tmp",
        ".git",
        ".claude",
        "dist",
        "coverage",
        "test-results",
        "playwright-report",
    ]);
    for (let ordner = offen.pop(); ordner !== undefined; ordner = offen.pop()) {
        for (const d of readdirSync(ordner, { withFileTypes: true })) {
            const pfad = join(ordner, d.name);
            if (d.isDirectory() && !ignoriert.has(d.name)) offen.push(pfad);
            else if (d.isFile() && /\.(ts|vue|js|mjs)$/.test(d.name)) {
                ergebnis.push({ pfad: relative(wurzel, pfad).replace(/\\/g, "/"), text: readFileSync(pfad, "utf8") });
            }
        }
    }
    return ergebnis;
}
