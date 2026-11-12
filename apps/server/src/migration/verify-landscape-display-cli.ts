import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { landscapeDisplayFromBytes } from "./landscape-display.ts";
import { verifyLandscapeDisplay } from "./verify-landscape-display.ts";

/**
 * Paritaetspruefung der Darstellungstafel gegen dieselbe Datei, aus der importiert wurde (WI-0064).
 *
 *   npm run verify:landscape-display -- --source <legacy-ecosystem-display.json>
 *
 * Endet mit Code 1, wenn eine Pruefung scheitert. Die Befunde stehen darunter und aendern das Urteil nicht.
 */
const { values } = parseArgs({ options: { source: { type: "string" } } });

if (!values.source) {
    console.error("usage: --source <legacy-ecosystem-display.json>");
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const input = landscapeDisplayFromBytes(await readFile(values.source));

const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyLandscapeDisplay(database, input);
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(12)} ${entry.detail}`,
        );
        for (const offender of entry.offenders ?? []) {
            console.warn(`        ${offender}`);
        }
    }
    for (const finding of report.findings) {
        console.warn(`Befund  ${finding}`);
    }
    const befunde = befundSummary(report.checks, (entry) => entry.passed);
    if (befunde) console.warn(`\n${befunde}`);
    console.warn(report.passed ? "\nParitaet: bestanden" : "\nParitaet: GESCHEITERT");
    if (!report.passed) {
        process.exit(1);
    }
} finally {
    await database.end({ timeout: 5 });
}
