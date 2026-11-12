import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { MigrationAborted } from "./places.ts";
import type { LegacyAreaPayload, LegacyMapPayload } from "./regions.ts";
import { importTerrain, readTerrainSources } from "./terrain.ts";
import { verifyTerrain } from "./verify-terrain.ts";

/**
 * Übernimmt die Gelände-Eingaben aus einem Legacy-Satz (WI-0049 S2) und prüft sie gleich danach.
 *
 *   npm run migrate:terrain -- --areas <ecosystem-areas.json> --features <map-features.json>
 *   npm run migrate:terrain -- --areas <...> --features <...> --dry-run
 *
 * 🔴 Schreibt Kartendaten: nur mit Freigabe des Betreibers für genau diesen Satz (Map Mutation Guard).
 * Die Regionen desselben Satzes müssen vorher importiert sein. Endet mit Code 1, wenn eine Prüfung
 * scheitert, mit Code 2 bei einem Abbruch vor dem Schreiben.
 *
 * 🔴 Die Stilllegequote (`MAX_RETIRE_FRACTION`, 5 %) hält den Import nicht mehr an (Betreiber 2026-10-03). Legt der Lauf
 * mehr still, steht danach der Befund `stilllegequote` im Bericht (JSON `findings` und Klartext `BEFUND …`), mit den
 * Zahlen und allen betroffenen Gebirgen und Gipfeln; der Lauf geht weiter. `--allow-shrink` bleibt als wirkungsloser
 * Schalter angenommen, damit vorhandene Aufrufe nicht an einer unbekannten Option scheitern.
 */
const { values } = parseArgs({
    options: {
        areas: { type: "string" },
        features: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        "allow-shrink": { type: "boolean", default: false },
    },
});

if (!values.areas || !values.features) {
    console.error("usage: --areas <ecosystem-areas.json> --features <map-features.json> [--dry-run]");
    process.exit(1);
}
if (values["allow-shrink"]) {
    console.warn(
        "Hinweis: --allow-shrink ist wirkungslos; die Stilllegequote wird nur gemeldet (Betreiber 2026-10-03).",
    );
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
const count = (predicate: (value: (typeof sources.controls)[number]) => boolean): number =>
    sources.controls.filter(predicate).length;
console.warn(
    `Satz ${sources.sourceRef}: ${String(sources.controls.length)} Gebirgsflächen ` +
        `(${String(count((c) => c.kammlinie !== null))} mit Kammlinie, ` +
        `${String(count((c) => c.beschriftungskurve !== null))} mit Beschriftungskurve, ` +
        `${String(count((c) => c.maximalhoehe !== null))} mit Maximalhöhe), ` +
        `${String(sources.peaks.length)} Gipfel und Vulkane ` +
        `(${String(sources.peaks.filter((p) => p.heightSchritt !== null).length)} mit Höhe), ` +
        `${String(sources.rejected.length)} zurückgewiesen`,
);
for (const entry of sources.rejected) {
    console.warn(`  zurückgewiesen ${entry.publicId}: ${entry.reason}`);
}

if (values["dry-run"]) {
    console.warn("\nTrockenlauf: nichts geschrieben, keine Zielprüfung.");
    process.exit(0);
}

const database = createDatabase(config.databaseUrl);
try {
    const report = await importTerrain(database, sources);
    console.warn(JSON.stringify({ ...report, rejected: report.rejected.length }, null, 2));
    for (const text of formatFindings(report.findings)) {
        console.warn(text);
    }

    const verified = await verifyTerrain(database, sources);
    console.warn("");
    for (const entry of verified.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(38)} ${entry.detail}`,
        );
        for (const offender of entry.offenders ?? []) {
            console.warn(`        ${offender}`);
        }
    }
    console.warn(verified.passed ? "\nGelände-Eingaben: bestanden" : "\nGelände-Eingaben: GESCHEITERT");
    if (!verified.passed) {
        process.exitCode = 1;
    }
} catch (error) {
    if (error instanceof MigrationAborted) {
        console.error(`abgebrochen: ${error.message}`);
        console.error(JSON.stringify(error.detail, null, 2));
        process.exitCode = 2;
    } else {
        throw error;
    }
} finally {
    await database.end({ timeout: 5 });
}
