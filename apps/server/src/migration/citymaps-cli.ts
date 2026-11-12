import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { parseCitymapOverlay } from "./citymaps.ts";
import { CITYMAP_TABLES, importCitymaps } from "./citymaps-import.ts";
import { MigrationAborted } from "./places.ts";

/**
 * Importiert die Kartensammlung (Karten, Typen, Beziehungen, Ortsbezug, Fundstellen, Quellenverknüpfung) aus der gespeicherten Antwort
 * von `citymaps.php` (WI-0063 P3, Vertrag `citymaps.yaml`, D2). Die Quelle ist die Antwortdatei des öffentlichen Endpunkts
 * (`citymaps.json`); sie wird hier NIE abgerufen (ein Abruf braucht den Zuruf des Betreibers und gehört zu `legacy:update`; `citymaps.php`
 * schreibt beim GET heute sogar in Legacy: Schemaheilung und die Rückfüllung color_mode).
 *
 * `--features` ist optional: die `map-features.json` desselben Zuges, aus der die Quellenverknüpfung der Karten kommt (Träger
 * `citymap:<public_id>` in `feature_sources`). Ohne sie entfällt nur dieser Teil, mit Befund. Der Quellenkatalog (D1, `migrate:sources`)
 * muss vorher importiert sein.
 *
 * `--private-file` ist optional: die privaten Felder aus E5/E5+ (Herkunft, Bauschlüssel, Zuordnung des eigenen Wiki-Artikels,
 * unterdrückte Orte und Links). Ohne die Datei bleiben sie NULL beziehungsweise `unknown`; das Format ist eine Annahme, die der
 * Legacy-Export noch bestätigen muss (siehe `parseCitymapOverlay`).
 *
 * 🔴 Eine Kartendatenübernahme: nur mit dem Zuruf des Betreibers für genau diese Datenbank (Map Mutation Guard). OHNE `--operator-said` oder `--auftrag`
 * rechnet das Werkzeug nur: Es zählt alles, meldet die Befunde und rollt dann zurück, auch das Journal. `--dry-run` rechnet auch MIT
 * Zitat nur. Ist die Antwort unbrauchbar, leer oder abgeschaltet, schreibt es nichts.
 *
 * Beispiele:
 *   npm run migrate:citymaps -- --source C:\avesmaps3d-data\legacy-snapshots\aktuell\citymaps.json --features C:\avesmaps3d-data\legacy-snapshots\aktuell\map-features.json
 *   npm run migrate:citymaps -- --source <datei> --features <datei> --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        features: { type: "string" },
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
        'usage: --source <citymaps.json> [--features <map-features.json>] [--private-file <datei>] [--operator-said "<Zitat>" | --auftrag <Job>] [--dry-run]',
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
const features =
    values.features === undefined ? undefined : (JSON.parse(await readFile(values.features, "utf8")) as unknown);
const overlay =
    values["private-file"] === undefined
        ? undefined
        : parseCitymapOverlay(JSON.parse(await readFile(values["private-file"], "utf8")) as unknown);
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
    const report = await importCitymaps(database, payload, { dryRun, features, overlay });
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log(`source     ${report.sourceRef}`);
    if (report.skipped) {
        console.log(
            "übersprungen: die Antwort ist unbrauchbar, leer oder abgeschaltet; nichts geschrieben, nichts stillgelegt",
        );
    } else {
        console.log(`${"tabelle".padEnd(26)} neu  geändert  unverändert  stillgelegt  geschützt  wieder aktiv`);
        for (const name of CITYMAP_TABLES) {
            const table = report.tables[name];
            console.log(
                `${name.padEnd(26)} ${String(table.created).padStart(5)} ${String(table.updated).padStart(9)} ${String(table.unchanged).padStart(12)} ${String(table.retired).padStart(12)} ${String(table.protectedRows).padStart(10)} ${String(table.reappeared).padStart(13)}`,
            );
        }
        console.log(`übergeordnet  Elter geändert bei ${String(report.parentsChanged)} Karten`);
        console.log(
            `auflösung  aufgelöst ${String(report.resolution.resolved)}, ohne Ziel in Legacy ${String(report.resolution.unresolved)}, nicht gefunden ${String(report.resolution.unmatched)}`,
        );
        for (const [kind, counts] of Object.entries(report.resolution.byKind).sort()) {
            console.log(
                `           ${kind.padEnd(12)} aufgelöst ${String(counts.resolved)}, nicht gefunden ${String(counts.unmatched)}`,
            );
        }
        console.log(
            report.sourcesPart === "applied"
                ? "quellen    citymap_source geschrieben (D1-Katalog und feature_sources desselben Zuges)"
                : `quellen    citymap_source entfällt (${report.sourcesPart}): siehe Befund`,
        );
        console.log(
            report.privateFields.file
                ? `private    Karten ${String(report.privateFields.maps)}, Orte ${String(report.privateFields.places)}, Links ${String(report.privateFields.links)}, Tombstones Orte ${String(report.privateFields.tombstonePlaces.created)} neu/${String(report.privateFields.tombstonePlaces.converted)} umgewandelt, Links ${String(report.privateFields.tombstoneLinks.created)} neu/${String(report.privateFields.tombstoneLinks.converted)} umgewandelt, Karten ${String(report.privateFields.tombstoneMaps)}`
                : "private    keine Datei mit den privaten Feldern (E5/E5+): legacy_origin unknown, keine Artikelzuordnung",
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
