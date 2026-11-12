import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { verifyPathVisuals } from "./verify-path-visual.ts";

/** Prüft die gezeichnete Wegkurve (WI-0010, Migration 0024). */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyPathVisuals(database);
    for (const check of report.checks) {
        console.log(
            `${checkWord(check.passed, check.blocking !== false, "PASS")}  ${check.name.padEnd(30)} ${check.detail}`,
        );
        for (const offender of check.offenders ?? []) {
            console.log(`        ${offender}`);
        }
    }
    const befunde = befundSummary(report.checks, (check) => check.passed);
    if (befunde) console.log(`\n${befunde}`);
    console.log(`\n${report.passed ? "alle Zusicherungen erfuellt" : "FEHLGESCHLAGEN"}`);
    if (!report.passed) {
        await database.end({ timeout: 5 });
        process.exit(1);
    }
} finally {
    await database.end({ timeout: 5 });
}
