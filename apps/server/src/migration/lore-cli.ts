import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { LORE_TABLES, importLore } from "./lore-import.ts";
import { MigrationAborted } from "./places.ts";

/**
 * Importiert Lore und Vorkommen (Einträge, Ortszeilen mit Zielen, Regeln, Quellenverknüpfungen) aus der gespeicherten Antwort von
 * `lore-export.php` (WI-0063 P3, Vertrag `lore.yaml`, D5; Legacy E2 und E2+). Die Quelle ist die Antwortdatei des Endpunkts
 * (`lore-export.json`); sie wird hier NIE abgerufen (der Export ist gross und teuer für Legacy, ein Abruf braucht den Zuruf des
 * Betreibers und gehört zu `legacy:update`, je Zug höchstens einer).
 *
 * Die Quellen der Verknüpfungen löst der Import über den Katalog von D1 auf (`migrate:sources`, Schritt I18, mit dem Satz des
 * gleichen Zuges), die Orte über die Wiki-Zuordnung von D6 (`migrate:subject-details`, I17): beide müssen vorher gelaufen sein, sonst
 * bleiben Verknüpfungen unaufgelöst und Ortszeilen `unmatched` (Befund, kein Abbruch).
 *
 * 🔴 Eine Kartendatenübernahme: nur mit dem Zuruf des Betreibers für genau diese Datenbank (Map Mutation Guard). OHNE `--operator-said` oder `--auftrag`
 * rechnet das Werkzeug nur: Es zählt alles, meldet die Befunde und rollt dann zurück, auch das Journal. `--dry-run` rechnet auch MIT
 * Zitat nur. Ist die Antwort unbrauchbar, leer, abgeschaltet oder passen ihre Kopfzähler nicht, schreibt es nichts.
 *
 * Beispiele:
 *   npm run migrate:lore -- --source C:\avesmaps3d-data\legacy-snapshots\aktuell\lore-export.json
 *   npm run migrate:lore -- --source <datei> --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        "map-revision": { type: "string" },
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
        'usage: --source <lore-export.json> [--map-revision <n>] [--operator-said "<Zitat>" | --auftrag <Job>] [--dry-run]',
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
const mapRevision = values["map-revision"] === undefined ? undefined : Number(values["map-revision"]);
if (mapRevision !== undefined && !Number.isInteger(mapRevision)) {
    console.error("--map-revision erwartet eine ganze Zahl");
    process.exit(1);
}
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
    const report = await importLore(database, payload, { dryRun, mapRevision });
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log(`source     ${report.sourceRef}`);
    if (report.skipped) {
        console.log(
            "übersprungen: die Antwort ist unbrauchbar, leer, abgeschaltet oder widerspricht ihren Kopfzählern; nichts geschrieben, nichts stillgelegt",
        );
    } else {
        console.log(`${"tabelle".padEnd(26)} neu  geändert  unverändert  stillgelegt  geschützt  wieder aktiv`);
        for (const name of LORE_TABLES) {
            const table = report.tables[name];
            console.log(
                `${name.padEnd(26)} ${String(table.created).padStart(5)} ${String(table.updated).padStart(9)} ${String(table.unchanged).padStart(12)} ${String(table.retired).padStart(12)} ${String(table.protectedRows).padStart(10)} ${String(table.reappeared).padStart(13)}`,
            );
        }
        const places = report.resolution.places;
        console.log(
            `auflösung  Ortszeilen: aufgelöst ${String(places.resolved)}, mehrdeutig ${String(places.ambiguous)}, ohne Träger (Kontinentbegriff) ${String(places.unresolved)}, nicht gefunden ${String(places.unmatched)}; ${String(report.resolution.targets)} Ziele`,
        );
        if (report.withheldKinds.length > 0) {
            console.log(
                `notaus     von Legacy abgeschaltet: ${report.withheldKinds.join(", ")} (die Zeilen dieser Art bleiben unberührt)`,
            );
        }
    }
    for (const line of formatFindings(report.findings, 20)) {
        console.log(line);
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
