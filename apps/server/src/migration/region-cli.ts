import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { MigrationAborted } from "./places.ts";
import { importRegions } from "./region-import.ts";
import type { LegacyAreaPayload, LegacyMapPayload, LegacyRegionPayload } from "./regions.ts";

/**
 * Importiert die Regionsdomaene aus drei gespeicherten Snapshots (WI-0003).
 *
 * Die Dateien werden getrennt und bewusst geholt; dieses Werkzeug ruft von sich aus keinen Endpunkt
 * (Kapitel 3.2.3). --regions kommt aus dem Editor-Lesepfad list_regions und ist die einzige
 * vollstaendige Regionsquelle: der oeffentliche Flaechenendpunkt verschweigt jede Region ohne
 * aktive Flaeche.
 *
 * Beispiel:
 *   npm run migrate:regions -- \
 *     --regions C:/avesmaps3d-data/legacy-snapshots/legacy-list-regions.json \
 *     --areas   C:/avesmaps3d-data/legacy-snapshots/ecosystem-areas.json \
 *     --labels  C:/avesmaps3d-data/legacy-snapshots/map-features.json
 *
 * `--dry-run` (WI-0129): rechnet in einer Transaktion, nennt jede geänderte Spalte eines Labels und rollt alles zurück,
 * auch das Journal. Legacys Obergrenze 7 schreibt der Import als Ziel 8 (Vertrag regions.yaml, `label_bands`).
 */
const { values } = parseArgs({
    options: {
        regions: { type: "string" },
        areas: { type: "string" },
        labels: { type: "string" },
        "allow-shrink": { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
    },
});

if (!values.regions || !values.areas || !values.labels) {
    console.error("usage: --regions <list-regions.json> --areas <ecosystem-areas.json> --labels <map-features.json>");
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
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const regionPayload = JSON.parse(await readFile(values.regions, "utf8")) as LegacyRegionPayload;
const areaPayload = JSON.parse(await readFile(values.areas, "utf8")) as LegacyAreaPayload;
const labelPayload = JSON.parse(await readFile(values.labels, "utf8")) as LegacyMapPayload;

const database = createDatabase(config.databaseUrl);
try {
    const dryRun = values["dry-run"] === true;
    const report = await importRegions(database, regionPayload, areaPayload, labelPayload, { dryRun });
    console.warn(JSON.stringify(report, null, 2));
    // Die Änderungen je Feld zusammengefasst: Der Halt im Probelauf (WI-0129 R1-8) liest genau diese Zeilen.
    const byField = new Map<string, number>();
    for (const change of report.labelChanges) {
        const key = `${change.field}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`;
        byField.set(key, (byField.get(key) ?? 0) + 1);
    }
    console.warn(dryRun ? "Probelauf, nichts geschrieben. Labeländerungen:" : "Labeländerungen:");
    for (const [key, count] of [...byField].sort()) console.warn(`  ${String(count)} x ${key}`);
    for (const text of formatFindings(report.findings)) {
        console.warn(text);
    }
} catch (error) {
    if (error instanceof MigrationAborted) {
        console.error(`abgebrochen: ${error.message}`);
        console.error(JSON.stringify(error.detail, null, 2));
        process.exit(2);
    }
    throw error;
} finally {
    await database.end({ timeout: 5 });
}
