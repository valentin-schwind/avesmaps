import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { MigrationAborted } from "./places.ts";
import { REVIEW_TABLES, importReviews } from "./reviews-import.ts";

/**
 * Importiert die sichtbaren Bewertungen von Orten aus einer gespeicherten Antwort von `location-reviews-export.php` (WI-0063 P3, Vertrag
 * `reviews.yaml`, D4, Export E3).
 *
 * Die Datei wird bewusst geholt (`legacy:update`, EIN Abruf je Zug, nur mit dem Zuruf des Betreibers); dieses Werkzeug ruft von sich aus
 * keinen Endpunkt. 🔴 Eine Kartendatenübernahme: nur mit dem Zuruf des Betreibers für genau diese Datenbank (Map Mutation Guard). OHNE
 * `--operator-said` oder `--auftrag` rechnet das Werkzeug nur: Es zählt alles, meldet die Befunde und rollt dann zurück, auch das Journal. `--dry-run`
 * rechnet auch MIT Zitat nur.
 *
 * 🔴 Datenschutz: Die Datei trägt Autorennamen und Texte; sie bleibt im lokalen Download-Fach. Weder die Ausgabe dieses Werkzeugs noch ein
 * Befund nennt einen Text oder Autor, nur Kennungen und Zahlen. Was in Legacy verborgen, gelöscht oder Spam wird, wird beim nächsten Lauf
 * hier GELÖSCHT.
 *
 * Beispiele:
 *   npm run migrate:reviews -- --source C:\avesmaps3d-data\legacy-snapshots\aktuell\location-reviews.json
 *   npm run migrate:reviews -- --source <datei> --operator-said "<Zitat des Betreibers>"
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
    console.error('usage: --source <location-reviews.json> [--operator-said "<Zitat>" | --auftrag <Job>] [--dry-run]');
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
    const report = await importReviews(database, payload, { dryRun });
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log(`source     ${report.sourceRef}`);
    if (report.skipped) {
        console.log(
            "übersprungen: die Antwort ist unbrauchbar, widersprüchlich oder leer ohne Beleg; nichts geschrieben, nichts gelöscht",
        );
    } else {
        console.log(`${"tabelle".padEnd(16)} neu  geändert  unverändert  gelöscht  geschützt`);
        for (const name of REVIEW_TABLES) {
            const table = report.tables[name];
            console.log(
                `${name.padEnd(16)} ${String(table.created).padStart(5)} ${String(table.updated).padStart(9)} ${String(table.unchanged).padStart(12)} ${String(table.retired).padStart(9)} ${String(table.protectedRows).padStart(10)}`,
            );
        }
        console.log(`gelieferte Zeilen ${String(report.delivered)}, gespeichert ${String(report.stored)}`);
        for (const [code, number] of Object.entries(report.notStored)) {
            console.log(`  nicht gespeichert: ${code} ${String(number)}`);
        }
    }
    if (report.counts !== null) {
        const counts = report.counts;
        console.log(
            `Zahlen der Antwort: gesamt ${String(counts.total)}, sichtbar ${String(counts.visible)}, verborgen ${String(counts.hidden)}, Spam ${String(counts.spam)}` +
                (counts.orphanedReviews === null
                    ? ""
                    : `, ohne aktiven Ort ${String(counts.orphanedReviews)} Bewertungen an ${String(counts.orphanedLocationIds ?? 0)} Orten`),
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
