import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import type { LegacyTerritoryPayload } from "./territories.ts";
import { verifyTerritories } from "./verify-territories.ts";

/**
 * Paritätsprüfung der Herrschaftsgebiete gegen dieselbe Datei, aus der importiert wurde (WI-0062).
 *
 *   npm run verify:territories -- --source <legacy-political-territories.json>
 *
 * Endet mit Code 1, wenn eine Prüfung scheitert. Die Befunde stehen darunter und ändern das Urteil nicht.
 */
const { values } = parseArgs({ options: { source: { type: "string" } } });

if (!values.source) {
    console.error("usage: --source <legacy-political-territories.json>");
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const payload = JSON.parse(await readFile(values.source, "utf8")) as LegacyTerritoryPayload;

const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyTerritories(database, payload);
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(22)} ${entry.detail}`,
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
