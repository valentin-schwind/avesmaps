import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import type { LegacyAreaPayload, LegacyMapPayload } from "./regions.ts";
import { readTerrainSources } from "./terrain.ts";
import { verifyTerrain } from "./verify-terrain.ts";

/**
 * Prüft die Gelände-Eingaben gegen einen Satz, ohne zu schreiben (WI-0049 S2).
 *
 *   npm run verify:terrain -- --areas <ecosystem-areas.json> --features <map-features.json>
 *
 * Endet mit Code 1, wenn eine Prüfung scheitert.
 */
const { values } = parseArgs({
    options: {
        areas: { type: "string" },
        features: { type: "string" },
    },
});

if (!values.areas || !values.features) {
    console.error("usage: --areas <ecosystem-areas.json> --features <map-features.json>");
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const sources = readTerrainSources(
    JSON.parse(await readFile(values.areas, "utf8")) as LegacyAreaPayload,
    JSON.parse(await readFile(values.features, "utf8")) as LegacyMapPayload,
);
const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyTerrain(database, sources);
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(38)} ${entry.detail}`,
        );
        for (const offender of entry.offenders ?? []) {
            console.warn(`        ${offender}`);
        }
    }
    const passedCount = report.checks.filter((entry) => entry.passed).length;
    console.warn(`verify:terrain: ${String(passedCount)} von ${String(report.checks.length)} bestanden`);
    if (!report.passed) {
        process.exitCode = 1;
    }
} finally {
    await database.end({ timeout: 5 });
}
