import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { MigrationAborted } from "./places.ts";
import { STAETTEN_TABLES, importStaetten } from "./staetten-import.ts";
import {
    SITE_TABLES,
    importStaettenRohquellen,
    onlyNamesFinding,
    summarizeStaettenRohquellen,
} from "./staetten-rohquellen-import.ts";

/**
 * Importiert die Stätten der Orte aus einer gespeicherten `map-features.json` (WI-0109, Vertrag `staetten.yaml`, D7) und, mit
 * `--rohquellen`, die Stätten über Kennungen aus Legacys Rohquellen-Export X4 (WI-0134, Vertrag Version 2, Migration 0099).
 *
 * 🔴 Zwei Teile in dieser Reihenfolge: (1) X4 nach `site`, `site_settlement`, `site_named_place` (Objekt, Beziehung aus der Kennung,
 * genannte Orte), (2) `settlement_place` wie bisher aus `in_settlement_places` - die Quelle der heutigen Leser, bis sie umgestellt
 * sind. Ohne `--rohquellen` läuft nur (2), mit dem Befund `staetten_nur_namen` (kein Tor). Die Ausgabe von (2) bleibt Zeile für
 * Zeile, wie sie war (der Stage-Korridor liest `geliefert` und `Siedlungen:`).
 *
 * 🔴 **Kein eigener Abruf.** `in_settlement_places` reist in derselben Datei mit, die I1, I5, I8, I10 und I17 schon lesen; dieses
 * Werkzeug ruft von sich aus keinen Endpunkt. 🔴 Eine Kartendatenübernahme: nur mit dem Zuruf des Betreibers für genau diese
 * Datenbank (Map Mutation Guard). OHNE `--operator-said` oder `--auftrag` rechnet das Werkzeug nur - es zählt alles, meldet die Befunde und rollt
 * dann zurück, auch das Journal. `--dry-run` rechnet auch MIT Zitat nur.
 *
 * Beispiele:
 *   npm run migrate:staetten -- --source C:\avesmaps3d-data\legacy-snapshots\aktuell\map-features.json
 *   npm run migrate:staetten -- --source <datei> --operator-said "<Zitat des Betreibers>"
 *   npm run migrate:staetten -- --source <datei> --rohquellen <legacy-staetten-rohquellen.json> --operator-said "<Zitat>"
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        // WI-0134: Legacys Rohquellen-Export X4 als gespeicherte Antwort (nie ein Abruf: der gehört zu `legacy:update`).
        rohquellen: { type: "string" },
        "operator-said": { type: "string" },
        // Ein Auftrag aus der Verwaltung („Abgleiche“, WI-0127 SYS-14b) statt des Zurufs; schließt --operator-said aus.
        auftrag: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        // Wirkungslos seit 2026-10-03 (Betreiber): die Stilllegequote wird als Befund gemeldet, der Lauf geht weiter.
        "allow-shrink": { type: "boolean", default: false },
    },
});

if (!values.source) {
    console.error(
        'usage: --source <map-features.json> [--rohquellen <legacy-staetten-rohquellen.json>] [--operator-said "<Zitat>" | --auftrag <Job>] [--dry-run]',
    );
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

// Zuruf (`--operator-said`) oder Auftrag aus der Verwaltung (`--auftrag`, auf Stage über Claudios Korridor), nie beides
// (`abgleiche/freigabe.ts`); die Freigabezeile liest Claudios `detail_cli`.
const freigabe = freigabeOderEnde({ "operator-said": values["operator-said"], auftrag: values.auftrag });
const dryRun = values["dry-run"] || !freigabe.apply;
const payload = JSON.parse(await readFile(values.source, "utf8")) as unknown;
const rohquellen =
    values.rohquellen === undefined ? undefined : (JSON.parse(await readFile(values.rohquellen, "utf8")) as unknown);
const database = createDatabase(config.databaseUrl);
const started = Date.now();

try {
    if (freigabe.zeile !== null) console.log(freigabe.zeile);
    if (dryRun) {
        console.log(
            !freigabe.apply
                ? "PROBELAUF - ohne --operator-said oder --auftrag wird nichts geschrieben, auch kein Journal\n"
                : "PROBELAUF (--dry-run) - nichts geschrieben, auch kein Journal\n",
        );
    }
    // (1) Die Stätten über Kennungen (X4), vor dem bisherigen Teil, damit dessen Ausgabe am Ende steht wie bisher.
    let changedV2 = false;
    if (rohquellen === undefined) {
        for (const line of formatFindings([onlyNamesFinding("kein --rohquellen")], 20)) console.log(line);
    } else {
        const v2 = await importStaettenRohquellen(database, rohquellen, { dryRun });
        changedV2 = v2.changed;
        console.log(`run        ${v2.runId}${v2.dryRun ? " (verworfen)" : ""} (Kennungen)`);
        console.log(`source     ${v2.sourceRef}`);
        if (!v2.skipped) {
            console.log(`${"tabelle".padEnd(18)} neu  geändert  unverändert  stillgelegt  geschützt  zurück`);
            for (const name of SITE_TABLES) {
                const table = v2.tables[name];
                console.log(
                    `${name.padEnd(18)} ${String(table.created).padStart(5)} ${String(table.updated).padStart(9)} ${String(table.unchanged).padStart(12)} ${String(table.retired).padStart(12)} ${String(table.protectedRows).padStart(10)} ${String(table.reappeared).padStart(7)}`,
                );
            }
        }
        console.log(summarizeStaettenRohquellen(v2));
        for (const line of formatFindings(v2.findings, 20)) console.log(line);
        console.log("");
    }
    // (2) Wie bisher: settlement_place aus in_settlement_places.
    const report = await importStaetten(database, payload, { dryRun });
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log(`source     ${report.sourceRef}`);
    if (report.skipped) {
        console.log(
            "übersprungen: der Block `in_settlement_places` fehlt oder ist leer; nichts geschrieben, nichts stillgelegt",
        );
    } else {
        console.log(`${"tabelle".padEnd(18)} neu  geändert  unverändert  stillgelegt  geschützt  zurück`);
        for (const name of STAETTEN_TABLES) {
            const table = report.tables[name];
            console.log(
                `${name.padEnd(18)} ${String(table.created).padStart(5)} ${String(table.updated).padStart(9)} ${String(table.unchanged).padStart(12)} ${String(table.retired).padStart(12)} ${String(table.protectedRows).padStart(10)} ${String(table.reappeared).padStart(7)}`,
            );
        }
        const counts = report.counts;
        console.log(
            `geliefert ${String(counts.delivered)}, gespeichert ${String(report.stored)}, ${String(counts.types)} Arten, ` +
                `${String(counts.settlements)} Siedlungen, ${String(counts.withId)} mit Kennung, ${String(counts.onMap)} auf der Karte`,
        );
        const resolution = report.resolution;
        console.log(
            `Siedlungen: ${String(resolution.resolved)} treffen genau einen Ort, ${String(resolution.ambiguous)} mehrere, ` +
                `${String(resolution.unmatched)} keinen (${String(resolution.unmatchedRows)} Stätten)`,
        );
        for (const [code, number] of Object.entries(report.notStored)) {
            console.log(`  nicht gespeichert: ${code} ${String(number)}`);
        }
    }
    for (const line of formatFindings(report.findings, 20)) {
        console.log(line);
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const peak = (process.resourceUsage().maxRSS / 1024).toFixed(0);
    console.log(`laufzeit   ${seconds} s, Spitzen-RSS ${peak} MB`);
    console.log(report.changed || changedV2 ? "geändert   ja" : "geändert   nein (nichts zu schreiben)");
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
