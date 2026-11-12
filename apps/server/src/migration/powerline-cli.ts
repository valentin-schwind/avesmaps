import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { MigrationAborted, type LegacyPayload } from "./paths.ts";
import { importPowerlines } from "./powerlines.ts";

/**
 * Importiert die Kraftlinien aus einer gespeicherten Snapshot-Datei (WI-0025, Contract
 * `powerlines.yaml`).
 *
 * 🔴 Ein Kartendatenlauf: nur mit Betreiberfreigabe für genau diese Datenbank (Map Mutation Guard).
 * Zuerst `--dry-run`: er rechnet und zählt alles und rollt dann zurück, auch das Journal.
 *
 * Beispiel:
 *   npm run migrate:powerlines -- --source C:\avesmaps3d-data\legacy-snapshots\map-features.json --dry-run
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        "allow-shrink": { type: "boolean", default: false },
    },
});

if (!values.source) {
    console.error("usage: --source <map-features.json> [--dry-run]");
    process.exit(1);
}
// Wirkungslos seit 2026-10-03 (Betreiber): die Stilllegequote wird als Befund gemeldet, der Lauf geht weiter.
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
    const report = await importPowerlines(database, payload, { dryRun: values["dry-run"] });
    if (report.dryRun) {
        console.log("PROBELAUF - nichts geschrieben, auch kein Journal\n");
    }
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log(`source     ${report.sourceRef}`);
    console.log(`created    ${String(report.created)}`);
    console.log(`updated    ${String(report.updated)}`);
    console.log(`unchanged  ${String(report.unchanged)}`);
    console.log(`retired    ${String(report.retired)}`);
    console.log(
        `bahn       ${String(report.drawnFromNodes)} von den Knoten, ${String(report.drawnFromLine)} von der gespeicherten Linie`,
    );
    console.log(`andere     ${String(report.skippedOtherTypes)} Objekte anderer Art übergangen`);
    // Befund, keine Korrektur: der Knoten fehlt im Snapshot, die Linie zeichnet ihre gespeicherte Lage.
    console.log(`knoten     ${String(report.missingNodes.length)} Verweise auf unbekannte Knoten`);
    // Die Kraftlinienpunkte (Nodix-Objekte), eigener Objekttyp seit Contract Version 2.
    const punkte = report.nodices;
    console.log(
        `nodix      ${String(punkte.total)} Kraftlinienpunkte: created ${String(punkte.created)}, updated ${String(punkte.updated)}, unchanged ${String(punkte.unchanged)}, retired ${String(punkte.retired)}`,
    );
    for (const missing of report.missingNodes) {
        console.log(`  ${missing.powerlinePublicId} ${missing.side} -> ${missing.nodePublicId} (${missing.name})`);
    }
    if (report.rejected.length > 0) {
        console.log(`rejected   ${String(report.rejected.length)}`);
        for (const entry of report.rejected.slice(0, 20)) {
            console.log(`  ${entry.publicId}: ${entry.reason}`);
        }
    }
    // Was der Lauf stilllegt (Kraftlinien, Kraftlinienpunkte) und die Stilllegequote: Befund, kein Abbruch.
    for (const text of formatFindings(report.findings)) {
        console.log(text);
    }
    if (report.retiredObjects.length > 0) {
        console.log(`stillgelegt ${String(report.retiredObjects.length)}`);
        for (const object of report.retiredObjects.slice(0, 20)) {
            console.log(`  ${object.table} ${object.publicId} ${object.name ?? "(ohne Namen)"}`);
        }
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
