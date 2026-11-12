import { AVENTURIA } from "@avesmaps3d/shared";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { verifyCurrentDomain } from "../terrain/domain/verify-current.ts";

const config = loadConfig();
if (!config.databaseUrl) throw new Error("DATABASE_URL is not configured");
const database = createDatabase(config.databaseUrl, { max: 2 });
try {
    const report = await database.begin("read only", (tx) => verifyCurrentDomain(tx, AVENTURIA.mapDomain));
    for (const check of report.checks) {
        console.warn(`${checkWord(check.passed, check.blocking !== false, "OK")} ${check.name}: ${check.detail}`);
        for (const offender of check.offenders ?? []) console.warn(`        ${offender}`);
    }
    const befunde = befundSummary(report.checks, (check) => check.passed);
    if (befunde) console.warn(befunde);
    console.warn(
        `verify:domain-terrain: ${report.checks.filter((check) => check.passed).length} von ${report.checks.length} bestanden`,
    );
    if (!report.passed) process.exitCode = 1;
} finally {
    await database.end({ timeout: 5 });
}
