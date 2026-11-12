import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { verifyTerrainDem } from "../terrain/verify-dem.ts";

/**
 * Prüft das abgeleitete Gelände (WI-0049 S3), ohne zu schreiben.
 *
 *   npm run verify:terrain-dem
 *
 * Endet mit Code 1, wenn eine Prüfung scheitert.
 */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyTerrainDem(database);
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(28)} ${entry.detail}`,
        );
        for (const offender of entry.offenders ?? []) {
            console.warn(`        ${offender}`);
        }
    }
    const passed = report.checks.filter((entry) => entry.passed).length;
    const befunde = befundSummary(report.checks, (entry) => entry.passed);
    if (befunde) console.warn(befunde);
    console.warn(`verify:terrain-dem: ${String(passed)} von ${String(report.checks.length)} bestanden`);
    if (!report.passed) {
        process.exitCode = 1;
    }
} finally {
    await database.end({ timeout: 5 });
}
