import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { verifyPathRuns } from "./verify-path-runs.ts";

/** Prüft die abgeleiteten Wegnamen-Schriftläufe (WI-0010 P5). */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyPathRuns(database);
    for (const check of report.checks) {
        console.log(
            `${checkWord(check.passed, check.blocking !== false, "PASS")}  ${check.name.padEnd(34)} ${check.detail}`,
        );
        for (const offender of check.offenders ?? []) {
            console.log(`        ${offender}`);
        }
        // 💣 Ohne diese Schleife bleibt der Befund der Prüfung `abgeleitet` unsichtbar: Er steht im
        // Bericht, aber die einzige Ausgabe dieses Werkzeugs ist diese Konsole (MCS-028).
        for (const finding of check.findings ?? []) {
            console.log(`        Befund: ${finding}`);
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
