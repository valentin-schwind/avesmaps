import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { verifyDisplayHeights } from "../terrain/display-height/verify.ts";

/**
 * Prüft die Anzeigehöhen (WI-0055), ohne zu schreiben.
 *
 *   npm run verify:display-heights
 *
 * Endet mit Code 1, wenn eine Prüfung scheitert.
 */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl, { max: 2 });
try {
    const report = await verifyDisplayHeights(database);
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(28)} ${entry.detail}`,
        );
        for (const offender of entry.offenders ?? []) console.warn(`        ${offender}`);
    }
    const passed = report.checks.filter((entry) => entry.passed).length;
    const befunde = befundSummary(report.checks, (entry) => entry.passed);
    if (befunde) console.warn(befunde);
    console.warn(`verify:display-heights: ${String(passed)} von ${String(report.checks.length)} bestanden`);
    if (!report.passed) {
        process.exitCode = 1;
    }
} finally {
    await database.end({ timeout: 5 });
}
