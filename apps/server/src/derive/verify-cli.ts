import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { verifyRuns } from "./verify-runs.ts";

/**
 * Prüft die Invarianten der abgeleiteten Schriftläufe gegen den echten Bestand (WI-0004).
 *
 *   npm run verify:runs
 *
 * Endet mit Code 1, wenn eine Prüfung scheitert - damit ein Lauf nicht als grün gilt, nur weil
 * niemand die Ausgabe gelesen hat.
 */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyRuns(database);
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(32)} ${entry.detail}`,
        );
        for (const offender of entry.offenders ?? []) {
            console.warn(`        ${offender}`);
        }
        for (const finding of entry.findings ?? []) {
            console.warn(`        Befund: ${finding}`);
        }
    }
    const befunde = befundSummary(report.checks, (entry) => entry.passed);
    if (befunde) console.warn(`\n${befunde}`);
    console.warn(report.passed ? "\nInvarianten: bestanden" : "\nInvarianten: GESCHEITERT");
    if (!report.passed) {
        process.exit(1);
    }
} finally {
    await database.end({ timeout: 5 });
}
