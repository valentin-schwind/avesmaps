import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { parseLiteratureOverlay } from "./literature.ts";
import { verifyLiterature } from "./verify-literature.ts";

/**
 * Paritätsprüfung der Spielliteratur gegen dieselbe Antwortdatei, aus der importiert wurde (WI-0063 P3, D3).
 *
 *   npm run verify:literature -- --source <game-literature.json> [--private-file <datei>]
 *
 * Nur lesend. Endet mit Code 1 nur, wenn eine Prüfung aus `BLOCKING_CHECKS` ausfällt (Betreiber 2026-10-03: keine fremden Tore; die
 * Liste ist leer); alle anderen Ausfälle stehen als Befund darunter. Ist die Antwort unbrauchbar, leer oder abgeschaltet, gibt es
 * nichts zu prüfen.
 */
const { values } = parseArgs({ options: { source: { type: "string" }, "private-file": { type: "string" } } });

if (!values.source) {
    console.error("usage: --source <game-literature.json> [--private-file <datei>]");
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const payload = JSON.parse(await readFile(values.source, "utf8")) as unknown;
const overlay =
    values["private-file"] === undefined
        ? null
        : parseLiteratureOverlay(JSON.parse(await readFile(values["private-file"], "utf8")) as unknown);
const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyLiterature(database, payload, overlay);
    if (report.skipped) {
        console.warn(
            "übersprungen: die Antwort ist unbrauchbar, leer oder abgeschaltet; der Schritt hat nichts geschrieben",
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
