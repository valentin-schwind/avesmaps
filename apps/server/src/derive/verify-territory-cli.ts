import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { verifyTerritoryShapes } from "../territories/verify-derived.ts";

/**
 * Prüft die abgeleiteten Herrschaftsgebiete gegen ihre Quellen (WI-0062, ADR-0014). Endet mit Code 1, wenn eine harte
 * Prüfung scheitert; die Befunde darunter (Lücken im Zoombereich, Überlappungen) ändern das Urteil nicht.
 */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyTerritoryShapes(database);
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(24)} ${entry.detail}`,
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
    console.warn(report.passed ? "\nPruefung: bestanden" : "\nPruefung: GESCHEITERT");
    if (!report.passed) {
        process.exit(1);
    }
} finally {
    await database.end({ timeout: 5 });
}
