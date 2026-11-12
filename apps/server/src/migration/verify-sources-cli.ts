import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import type { MapFeaturesPayload } from "./map-features.ts";
import { verifySources } from "./verify-sources.ts";

/**
 * Paritätsprüfung der Feature-Quellen gegen denselben Satz, aus dem importiert wurde (WI-0063 P3, D1).
 *
 *   npm run verify:sources -- --source <map-features.json>
 *
 * Nur lesend. Endet mit Code 1 nur, wenn eine Prüfung aus `BLOCKING_CHECKS` ausfällt (Betreiber 2026-10-03: keine fremden Tore);
 * alle anderen Ausfälle stehen als Befund darunter. Fehlen die Quellenblöcke oder ist der Katalog leer, gibt es nichts zu prüfen.
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

const payload = JSON.parse(await readFile(values.source, "utf8")) as MapFeaturesPayload;
const database = createDatabase(config.databaseUrl);
try {
    const report = await verifySources(database, payload);
    if (report.skipped) {
        console.warn(
            "übersprungen: ein Block der Quelle fehlt oder der Katalog ist leer; der Schritt hat nichts geschrieben",
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
