import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { parseLiteratureOverlay } from "./literature.ts";
import { LITERATURE_TABLES, importLiterature } from "./literature-import.ts";
import { MigrationAborted } from "./places.ts";

/**
 * Importiert die Spielliteratur (Werke, Ortsbezug, weitere Links) aus der gespeicherten Antwort von `game-literature.php` (WI-0063 P3,
 * Vertrag `literature.yaml`, D3). Die Quelle ist die Antwortdatei des öffentlichen Endpunkts (`game-literature.json`); sie wird hier NIE
 * abgerufen (ein Abruf braucht den Zuruf des Betreibers und gehört zu `legacy:update`).
 *
 * `--private-file` ist optional: die privaten Felder aus E5/E5+ (Wiki-Schlüssel, Autoren, Herkunft, Herkunftsvermerke je Feld,
 * unterdrückte Orte). Ohne die Datei bleiben sie NULL beziehungsweise `unknown`. Die Datei ist Legacys privater Export B
 * (`media-export-migration.json`, Block `game_literature`); `parseLiteratureOverlay` liest ihn und das früher angenommene Format (`adventures`).
 * Ein Lauf ohne die Datei löscht die eingespielten privaten Felder nicht.
 *
 * 🔴 Eine Kartendatenübernahme: nur mit dem Zuruf des Betreibers für genau diese Datenbank (Map Mutation Guard). OHNE `--operator-said` oder `--auftrag`
 * rechnet das Werkzeug nur: Es zählt alles, meldet die Befunde und rollt dann zurück, auch das Journal. `--dry-run` rechnet auch MIT
 * Zitat nur. Ist die Antwort unbrauchbar, leer oder abgeschaltet, schreibt es nichts.
 *
 * Beispiele:
 *   npm run migrate:literature -- --source C:\avesmaps3d-data\legacy-snapshots\aktuell\game-literature.json
 *   npm run migrate:literature -- --source <datei> --operator-said "<Zitat des Betreibers>"
 *   npm run migrate:literature -- --source <game-literature.json> --private-file <media-export-migration.json>   (Probelauf: rechnet nur)
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        "private-file": { type: "string" },
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
        'usage: --source <game-literature.json> [--private-file <datei>] [--operator-said "<Zitat>" | --auftrag <Job>] [--dry-run]',
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
const overlay =
    values["private-file"] === undefined
        ? undefined
        : parseLiteratureOverlay(JSON.parse(await readFile(values["private-file"], "utf8")) as unknown);
const overlayForm =
    overlay?.format === "export_b" ? "Export B" : overlay?.format === "angenommen" ? "angenommenes Format" : "unlesbar";
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
    const report = await importLiterature(database, payload, { dryRun, overlay });
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log(`source     ${report.sourceRef}`);
    if (report.skipped) {
        console.log(
            "übersprungen: die Antwort ist unbrauchbar, leer oder abgeschaltet; nichts geschrieben, nichts stillgelegt",
        );
    } else {
        console.log(`${"tabelle".padEnd(24)} neu  geändert  unverändert  stillgelegt  geschützt  wieder aktiv`);
        for (const name of LITERATURE_TABLES) {
            const table = report.tables[name];
            console.log(
                `${name.padEnd(24)} ${String(table.created).padStart(5)} ${String(table.updated).padStart(9)} ${String(table.unchanged).padStart(12)} ${String(table.retired).padStart(12)} ${String(table.protectedRows).padStart(10)} ${String(table.reappeared).padStart(13)}`,
            );
        }
        console.log(
            `auflösung  aufgelöst ${String(report.resolution.resolved)}, ohne Ziel in Legacy ${String(report.resolution.unresolved)}, nicht gefunden ${String(report.resolution.unmatched)}`,
        );
        for (const [kind, counts] of Object.entries(report.resolution.byKind).sort()) {
            console.log(
                `           ${kind.padEnd(12)} aufgelöst ${String(counts.resolved)}, nicht gefunden ${String(counts.unmatched)}`,
            );
        }
        console.log(
            report.privateFields.file
                ? `private    Datei ${overlayForm}, Werke ${String(report.privateFields.works)}, Orte ${String(report.privateFields.places)}, Herkunftsvermerke +${String(report.privateFields.fieldOrigins.created)}/-${String(report.privateFields.fieldOrigins.retired)}, Tombstones Orte ${String(report.privateFields.tombstonePlaces.created)} neu/${String(report.privateFields.tombstonePlaces.converted)} umgewandelt, Werke ${String(report.privateFields.tombstoneWorks)}`
                : "private    keine Datei mit den privaten Feldern (E5/E5+): legacy_origin unknown",
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
