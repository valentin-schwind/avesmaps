import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import type { MapFeaturesPayload } from "./map-features.ts";
import { MigrationAborted } from "./places.ts";
import { SOURCE_TABLES, importSources } from "./sources-import.ts";

/**
 * Importiert Quellenkatalog, Korpus, Verknüpfungen und Kanon aus einem gespeicherten Satz (WI-0063 P3, Vertrag `sources.yaml`,
 * D1). Die Quelle ist dieselbe `map-features.json` wie bei Orten und Wegen (vier globale Blöcke).
 *
 * 🔴 Eine Kartendatenübernahme: nur mit dem Zuruf des Betreibers für genau diese Datenbank (Map Mutation Guard).
 * OHNE `--operator-said` oder `--auftrag` rechnet das Werkzeug nur: Es zählt alles, meldet die Befunde und rollt dann zurück, auch das Journal.
 * `--dry-run` rechnet auch MIT Zitat nur. Fehlt ein Block der Quelle oder ist der Katalog leer, schreibt es nichts.
 *
 * Beispiele:
 *   npm run migrate:sources -- --source C:\avesmaps3d-data\legacy-snapshots\aktuell\map-features.json
 *   npm run migrate:sources -- --source <datei> --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        "operator-said": { type: "string" },
        // Ein Auftrag aus der Verwaltung („Abgleiche“, WI-0127 SYS-14b) statt des Zurufs; schließt --operator-said aus.
        auftrag: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        // Wirkungslos seit 2026-10-03 (Betreiber): die Stilllegequote wird als Befund gemeldet, der Lauf geht weiter.
        "allow-shrink": { type: "boolean", default: false },
    },
});

if (!values.source) {
    console.error('usage: --source <map-features.json> [--operator-said "<Zitat>" | --auftrag <Job>] [--dry-run]');
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
const payload = JSON.parse(await readFile(values.source, "utf8")) as MapFeaturesPayload;
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
    const report = await importSources(database, payload, { dryRun });
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log(`source     ${report.sourceRef}`);
    if (report.skipped) {
        console.log(
            "übersprungen: ein Block der Quelle fehlt oder der Katalog ist leer; nichts geschrieben, nichts stillgelegt",
        );
    } else {
        console.log(`${"tabelle".padEnd(24)} neu  geändert  unverändert  stillgelegt  geschützt  wieder aktiv`);
        for (const name of SOURCE_TABLES) {
            const table = report.tables[name];
            console.log(
                `${name.padEnd(24)} ${String(table.created).padStart(5)} ${String(table.updated).padStart(9)} ${String(table.unchanged).padStart(12)} ${String(table.retired).padStart(12)} ${String(table.protectedRows).padStart(10)} ${String(table.reappeared).padStart(13)}`,
            );
        }
        console.log(
            `identität  wiedergefunden ${String(report.identity.rematched)}, nicht wiederzufinden ${String(report.identity.lost)}, endgültig ${String(report.identity.resolved)}`,
        );
        console.log(
            report.tombstones.block === "absent"
                ? "tombstones nicht im Export (E1+ noch nicht gebaut)"
                : `tombstones Block ${report.tombstones.block}: neu ${String(report.tombstones.created)}, geändert ${String(report.tombstones.updated)}, unverändert ${String(report.tombstones.unchanged)}`,
        );
        console.log(
            `korpus-vorgabe  ${String(report.korpusVorgabe.korpora)} Belegstellen-Korpora mit Vorgabe, ${String(report.korpusVorgabe.quellen)} Quellen nach dem Abgleich angepasst`,
        );
    }
    for (const text of formatFindings(report.findings, 20)) {
        console.log(text);
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const peak = (process.resourceUsage().maxRSS / 1024).toFixed(0);
    console.log(`laufzeit   ${seconds} s, Spitzen-RSS ${peak} MB`);
    console.log(report.changed ? "geändert   ja" : "geändert   nein (nichts zu schreiben)");
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
