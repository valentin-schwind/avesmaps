import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import type { LegacyAreaPayload, LegacyMapPayload, LegacyRegionPayload } from "./regions.ts";
import { verifyRegions } from "./verify-regions.ts";

/**
 * Paritaetspruefung der Regionsdomaene gegen dieselben Snapshots, aus denen importiert wurde.
 *
 *   npm run verify:regions -- --regions <...> --areas <...> --labels <...>
 *
 * Endet mit Code 1, wenn eine Pruefung scheitert - damit ein Lauf nicht als gruen gilt, nur weil
 * niemand die Ausgabe gelesen hat.
 */
const { values } = parseArgs({
    options: {
        regions: { type: "string" },
        areas: { type: "string" },
        labels: { type: "string" },
    },
});

if (!values.regions || !values.areas || !values.labels) {
    console.error("usage: --regions <list-regions.json> --areas <ecosystem-areas.json> --labels <map-features.json>");
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const regionPayload = JSON.parse(await readFile(values.regions, "utf8")) as LegacyRegionPayload;
const areaPayload = JSON.parse(await readFile(values.areas, "utf8")) as LegacyAreaPayload;
const labelPayload = JSON.parse(await readFile(values.labels, "utf8")) as LegacyMapPayload;

const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyRegions(database, regionPayload, areaPayload, labelPayload);
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(26)} ${entry.detail}`,
        );
        for (const offender of entry.offenders ?? []) {
            console.warn(`        ${offender}`);
        }
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
