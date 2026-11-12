import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { importPaths, MigrationAborted, type LegacyPayload } from "./paths.ts";

/**
 * Importiert Wege aus einer gespeicherten Snapshot-Datei (WI-0010, seit WI-0017 R1 mit den Routingdaten;
 * Contract `paths.yaml` Version 3: Legacys Kreuzungen werden seit WI-0132 Release N nur gezählt, nicht übernommen).
 *
 * Die Datei wird getrennt und absichtlich geholt: ein Lauf liest Dateien, nie den Endpunkt
 * (Kapitel 3.2.3). Es ist dieselbe Datei wie beim Ortsimport — `map-features.json` trägt alle
 * Objektarten nebeneinander, unterschieden durch `feature_type`.
 *
 * Mehr als 5 % Stilllegung (`MAX_RETIRE_FRACTION`) halten den Lauf nicht an (Betreiber 2026-10-03): Er meldet sie am
 * Ende als `BEFUND stilllegequote` mit Zahlen und allen betroffenen Wegen. `--allow-shrink` ist
 * wirkungslos und nur noch angenommen, damit vorhandene Aufrufe nicht an einer unbekannten Option scheitern.
 *
 * Beispiel:
 *   npm run migrate:paths -- --source C:\avesmaps3d-data\legacy-snapshots\map-features.json
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        "allow-shrink": { type: "boolean", default: false },
    },
});

if (!values.source) {
    console.error("usage: --source <map-features.json>");
    process.exit(1);
}
if (values["allow-shrink"]) {
    console.warn(
        "Hinweis: --allow-shrink ist wirkungslos; die Stilllegequote wird nur gemeldet (Betreiber 2026-10-03).",
    );
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const quelle: string = values.source;
const payload = JSON.parse(await readFile(quelle, "utf8")) as LegacyPayload;
const database = createDatabase(config.databaseUrl);

try {
    const report = await importPaths(database, payload);
    console.log(`run        ${report.runId}`);
    console.log(`source     ${report.sourceRef}`);
    console.log(`created    ${String(report.created)}`);
    console.log(`updated    ${String(report.updated)}`);
    console.log(`unchanged  ${String(report.unchanged)}`);
    console.log(`retired    ${String(report.retired)}`);
    // Version 3 (WI-0132 Release N): Legacys Kreuzungen werden nur gezählt. Die Zeile beginnt weiter mit `crossings`,
    // der Stage-Korridor zitiert sie (`staging-import.sh`, I5).
    console.log(
        `crossings  ${String(report.crossingsIgnored)} Legacy-Kreuzungen gezählt, nicht übernommen ` +
            "(Netz ohne Kreuzungen, WI-0132)",
    );
    console.log(`andere     ${String(report.skippedOtherTypes)} Objekte anderer Art übergangen`);
    if (report.rejected.length > 0) {
        console.log(`rejected   ${String(report.rejected.length)}`);
        for (const entry of report.rejected.slice(0, 20)) {
            console.log(`  ${entry.publicId}: ${entry.reason}`);
        }
    }
    for (const text of formatFindings(report.findings)) {
        console.log(text);
    }
} catch (error) {
    if (error instanceof MigrationAborted) {
        console.error(`abgebrochen: ${error.message}`);
        console.error(JSON.stringify(error.detail, null, 2));
        await database.end({ timeout: 5 });
        process.exit(2);
    }
    throw error;
} finally {
    await database.end({ timeout: 5 });
}
