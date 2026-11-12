import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { verifyTerritoryDetails } from "./verify-territory-details.ts";

/**
 * Paritätsprüfung der Gebietsdetails gegen dieselbe Gebietsdatei, aus der importiert wurde (WI-0063 P3, E4).
 *
 *   npm run verify:territory-details -- --source <legacy-political-territories.json>
 *
 * Nur lesend. Endet mit Code 1 nur, wenn eine Prüfung aus `BLOCKING_CHECKS` ausfällt (Betreiber 2026-10-03: keine fremden Tore; die
 * Liste ist leer); alle anderen Ausfälle stehen als Befund darunter. Trägt kein Gebiet das Objekt `detail` (älterer Export), gibt es nichts
 * zu prüfen. Der Wappenzustand wird nur durchgerechnet (Abbildung auf den Media Core), nie geschrieben.
 */
const { values } = parseArgs({ options: { source: { type: "string" } } });

if (!values.source) {
    console.error("usage: --source <legacy-political-territories.json>");
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const payload = JSON.parse(await readFile(values.source, "utf8")) as unknown;
const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyTerritoryDetails(database, payload);
    if (report.skipped) {
        console.warn(
            "übersprungen: kein Gebiet trägt das Objekt detail (älterer Export); der Schritt hat nichts geschrieben",
        );
    }
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(18)} ${entry.detail}`,
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
