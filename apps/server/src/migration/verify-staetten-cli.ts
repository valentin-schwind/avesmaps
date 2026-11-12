import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { verifyStaetten } from "./verify-staetten.ts";

/**
 * Paritätsprüfung der Stätten gegen dieselbe `map-features.json`, aus der importiert wurde (WI-0109, D7).
 *
 *   npm run verify:staetten -- --source <map-features.json>
 *   npm run verify:staetten -- --source <map-features.json> --rohquellen <legacy-staetten-rohquellen.json>   (WI-0134, Kennungen)
 *
 * Nur lesend. Endet mit Code 1 nur, wenn eine Prüfung aus `BLOCKING_CHECKS` ausfällt (Betreiber 2026-10-03: keine fremden Tore; die
 * Liste ist leer); alle anderen Ausfälle stehen als Befund darunter. Fehlt der Block `in_settlement_places` oder ist er leer, hat der
 * Schritt nichts geschrieben und es gibt nichts zu prüfen.
 */
const { values } = parseArgs({ options: { source: { type: "string" }, rohquellen: { type: "string" } } });

if (!values.source) {
    console.error("usage: --source <map-features.json> [--rohquellen <legacy-staetten-rohquellen.json>]");
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const payload = JSON.parse(await readFile(values.source, "utf8")) as unknown;
const rohquellen =
    values.rohquellen === undefined ? undefined : (JSON.parse(await readFile(values.rohquellen, "utf8")) as unknown);
const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyStaetten(database, payload, { rohquellen });
    if (report.skipped) {
        console.warn(
            "übersprungen: der Block `in_settlement_places` fehlt oder ist leer; der Schritt hat nichts geschrieben",
        );
    }
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(22)} ${entry.detail}`,
        );
        for (const offender of entry.offenders ?? []) {
            console.warn(`        ${offender}`);
        }
    }
    for (const text of formatFindings(report.findings, 20)) {
        console.warn(text);
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
