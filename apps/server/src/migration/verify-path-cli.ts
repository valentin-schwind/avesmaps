import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { verifyPaths } from "./verify-paths.ts";
import type { LegacyPayload } from "./paths.ts";

/**
 * Prüft die migrierten Wege gegen den Snapshot (Contract `paths.yaml`).
 *
 * Beispiel:
 *   npm run verify:paths -- --source C:\avesmaps3d-data\legacy-snapshots\map-features.json
 */
const { values } = parseArgs({ options: { source: { type: "string" } } });

if (!values.source) {
    console.error("usage: --source <map-features.json>");
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const quelle: string = values.source;
const payload = JSON.parse(await readFile(quelle, "utf8")) as LegacyPayload;
const database = createDatabase(config.databaseUrl);

try {
    const report = await verifyPaths(database, payload);
    console.log(`source ${report.sourceRef}\n`);
    for (const check of report.checks) {
        console.log(
            `${checkWord(check.passed, check.blocking !== false, "PASS")}  ${check.name.padEnd(32)} ${check.detail}`,
        );
        for (const offender of check.offenders ?? []) {
            console.log(`        ${offender}`);
        }
    }
    const befunde = befundSummary(report.checks, (check) => check.passed);
    if (befunde) console.log(`\n${befunde}`);
    console.log(`\n${report.passed ? "alle Gates bestanden" : "FEHLGESCHLAGEN"}`);
    if (!report.passed) {
        await database.end({ timeout: 5 });
        process.exit(1);
    }
} finally {
    await database.end({ timeout: 5 });
}
