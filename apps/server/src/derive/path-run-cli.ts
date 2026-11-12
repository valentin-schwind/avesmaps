import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { derivePathRuns } from "./path-runs.ts";

/**
 * Leitet die Schriftläufe der Wegnamen ab (WI-0010 P5).
 *
 * Derived Data: ein Lauf dieses Werkzeugs stellt sie jederzeit wieder her.
 *
 *   npm run derive:path-runs
 */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    const report = await derivePathRuns(database);
    console.log(`Ketten        ${String(report.chains)}`);
    console.log(`Teilstuecke   ${String(report.parts)}`);
    console.log(`Laeufe        ${String(report.runs)}`);
    console.log(`zu kurz       ${String(report.skippedTooShort)} Teilstuecke tragen keinen Namen`);
} finally {
    await database.end({ timeout: 5 });
}
