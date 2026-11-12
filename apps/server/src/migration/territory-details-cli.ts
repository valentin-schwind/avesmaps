import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { MigrationAborted } from "./places.ts";
import { TERRITORY_DETAIL_TABLES, importTerritoryDetails } from "./territory-details-import.ts";
import { DETAIL_FIELDS } from "./territory-details.ts";

/**
 * Importiert die Gebietsdetails (17 Felder mit Herkunft je Feld) aus der gespeicherten Gebietsantwort (WI-0063 P3, Vertrag
 * `territory-details.yaml`, Legacy-Export E4). Quelle ist dieselbe Datei wie bei `migrate:territories`
 * (`legacy-political-territories.json`), kein neuer Abruf.
 *
 * Die Datei wird bewusst geholt (`legacy:update`); dieses Werkzeug ruft von sich aus keinen Endpunkt (Legacys Export ist teuer: auch ein
 * 304 kostet einen vollen Lesevorgang). 🔴 Eine Kartendatenübernahme: nur mit dem Zuruf des Betreibers für genau diese Datenbank (Map
 * Mutation Guard). OHNE `--operator-said` oder `--auftrag` rechnet das Werkzeug nur: Es zählt alles, meldet die Befunde und rollt dann zurück, auch das
 * Journal. `--dry-run` rechnet auch MIT Zitat nur.
 *
 * Der Wappenzustand wird nicht geschrieben: das Werkzeug rechnet die Abbildung auf den Media Core nur durch und meldet sie; die
 * Medienzeilen schreibt der Medienimport.
 *
 * Beispiele:
 *   npm run migrate:territory-details -- --source C:\avesmaps3d-data\legacy-snapshots\aktuell\legacy-political-territories.json
 *   npm run migrate:territory-details -- --source <datei> --operator-said "<Zitat des Betreibers>"
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
    console.error(
        'usage: --source <legacy-political-territories.json> [--operator-said "<Zitat>" | --auftrag <Job>] [--dry-run]',
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
    const report = await importTerritoryDetails(database, payload, { dryRun });
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log(`source     ${report.sourceRef}`);
    console.log(
        `gebiete    ${String(report.territories)}, mit detail ${String(report.withDetail)}, mit coat ${String(report.withCoat)}`,
    );
    if (report.skipped) {
        console.log(
            "übersprungen: kein Gebiet trägt das Objekt detail (älterer Export); nichts geschrieben, nichts stillgelegt",
        );
    } else {
        console.log(`${"tabelle".padEnd(32)} neu  geändert  unverändert  stillgelegt  geschützt  wieder aktiv`);
        for (const name of TERRITORY_DETAIL_TABLES) {
            const table = report.tables[name];
            console.log(
                `${name.padEnd(32)} ${String(table.created).padStart(5)} ${String(table.updated).padStart(9)} ${String(table.unchanged).padStart(12)} ${String(table.retired).padStart(12)} ${String(table.protectedRows).padStart(10)} ${String(table.reappeared).padStart(13)}`,
            );
        }
        console.log(`gespeichert ${String(report.stored)} Detailzeilen; je Feld Werte / bewusste Leerwerte / fehlend:`);
        for (const field of DETAIL_FIELDS) {
            const count = report.fieldCounts[field];
            console.log(
                `  ${field.padEnd(20)} ${String(count.values).padStart(5)} ${String(count.empty).padStart(5)} ${String(count.missing).padStart(5)}`,
            );
        }
    }
    if (report.coatPart === "planned") {
        const coat = report.coatSummary;
        console.log(
            `wappenzustand (nur durchgerechnet, nichts geschrieben): gesetzt ${String(coat.set)} (custom ${String(coat.setCustom)}, wiki_localized ${String(coat.setWikiLocalized)}, wiki_staging ${String(coat.setWikiStaging)}), ` +
                `ausdrücklich keins ${String(coat.none)}, ohne Entscheid ${String(coat.undecided)}; Unterdrückung ${String(coat.suppressions)}, Bindung ${String(coat.bindings)}, keine Zeile ${String(coat.omitted)}`,
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
