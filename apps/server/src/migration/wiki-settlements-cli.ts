import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { WIKI_SETTLEMENT_TABLES, importWikiSettlements, summarizeWikiSettlements } from "./wiki-settlements-import.ts";

/**
 * Importiert die Wiki-Siedlungsregistry aus der gespeicherten Antwort von Legacys `wiki-siedlungen-export.php` (X3, WI-0128 E4, Migration
 * 0089). Die Quelle ist die Antwortdatei; sie wird hier NIE abgerufen (ein Abruf braucht den Zuruf des Betreibers und gehört zu
 * `legacy:update`, Schritt I28).
 *
 * 🔴 Eine Kartendatenübernahme: nur mit dem Zuruf des Betreibers für genau diese Datenbank (Map Mutation Guard) oder mit einem Auftrag aus
 * der Verwaltung (`--auftrag`, der Orte-Zug, WI-0199). OHNE `--operator-said` oder `--auftrag` rechnet das Werkzeug nur: Es zählt alles,
 * meldet die Befunde und rollt dann zurück, auch das Journal. `--dry-run` rechnet auch MIT Freigabe nur. Ist die Antwort unbrauchbar oder
 * leer, schreibt es nichts und legt nichts still. `--zuordnung` (X2 desselben Zuges) dient nur dem Abgleich der Stände.
 *
 * Beispiele:
 *   npm run migrate:wiki-settlements -- --source C:\avesmaps3d-data\legacy-snapshots\aktuell\legacy-wiki-siedlungen.json
 *   npm run migrate:wiki-settlements -- --source <datei> --zuordnung <legacy-wiki-zuordnung.json> --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        zuordnung: { type: "string" },
        "operator-said": { type: "string" },
        // Ein Auftrag aus der Verwaltung („Abgleiche“, WI-0127 SYS-14b) statt des Zurufs; schließt --operator-said aus.
        auftrag: { type: "string" },
        "dry-run": { type: "boolean", default: false },
    },
});

if (!values.source) {
    console.error(
        'usage: --source <legacy-wiki-siedlungen.json> [--zuordnung <legacy-wiki-zuordnung.json>] [--operator-said "<Zitat>" | --auftrag <Job>] [--dry-run]',
    );
    process.exit(1);
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
const zuordnung =
    values.zuordnung === undefined ? undefined : (JSON.parse(await readFile(values.zuordnung, "utf8")) as unknown);
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
    const report = await importWikiSettlements(database, payload, { dryRun, zuordnung });
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log(`source     ${report.sourceRef}`);
    if (!report.skipped) {
        console.log(`${"tabelle".padEnd(38)} neu  geändert  unverändert  stillgelegt  zurück`);
        for (const name of WIKI_SETTLEMENT_TABLES) {
            const table = report.tables[name];
            console.log(
                `${name.padEnd(38)} ${String(table.created).padStart(5)} ${String(table.updated).padStart(9)} ${String(table.unchanged).padStart(12)} ${String(table.retired).padStart(12)} ${String(table.reappeared).padStart(7)}`,
            );
        }
    }
    console.log(summarizeWikiSettlements(report));
    for (const text of formatFindings(report.findings, 20)) {
        console.log(text);
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const peak = (process.resourceUsage().maxRSS / 1024).toFixed(0);
    console.log(`laufzeit   ${seconds} s, Spitzen-RSS ${peak} MB`);
    console.log(report.changed ? "geändert   ja" : "geändert   nein (nichts zu schreiben)");
} finally {
    await database.end({ timeout: 5 });
}
