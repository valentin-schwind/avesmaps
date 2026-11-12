import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { meldeErgebnis } from "../abgleiche/protokoll.ts";
import { formatFindings } from "../findings.ts";
import { MEDIA_TABLES, importMedia } from "./media-import.ts";
import { MEDIA_CLASSES } from "./media-legacy.ts";

/**
 * Importiert die METADATEN der Legacy-Medien aus dem Medien-Manifest (Export E5, `media-export.php`) in Avesmaps3D (WI-0063
 * MEDIA-M8, Vertrag `media.yaml`, `umsetzung_m8_m10`): Assets, Rechte, Erzeugungsnotizen, Legacy-Herkunft, Galerien der Ortsbilder,
 * Bindungen von Wappen, Covern und Karten, Unterdrückungen und die Freigaberegeln mit Betreiberzitat. Keine Datei, kein Byte: die
 * Dateien kommen mit `migrate:media-files` (M9/M10).
 *
 * Die Quelle ist eine gespeicherte Antwort, die dieses Werkzeug NIE abruft (ein Abruf braucht den Zuruf des Betreibers):
 *   --source        das öffentliche Manifest A (`GET /api/app/media-export.php`): nur, was Legacy heute jedem zeigt; keine Unterdrückung,
 *                   keine Notiz, kein Stempel, nichts Nichtöffentliches. Zieht nie etwas zurück.
 *   --private-file  das private Manifest B (`GET /api/edit/migration/media-export.php`, nur Admin, gibt der Betreiber als Datei): alles,
 *                   samt Rechtenotizen, Urhebern, Stempeln, Unterdrückungen. Nur B zieht zurück, was Legacy nicht mehr nennt. Mit B
 *                   allein genügt der Lauf; liegt A dabei, vergleicht er A mit B (Befund bei Abweichung, B gilt).
 *
 * 🔴 Medien sind keine redaktionellen Kartendaten, aber der Import schreibt in die Zieldatenbank: nur mit dem Zuruf des Betreibers
 * (`--operator-said`). OHNE ihn rechnet das Werkzeug nur: Es zählt alles, meldet die Befunde und rollt dann zurück, auch das Journal.
 * `--dry-run` rechnet auch MIT Zitat nur. Ein unbrauchbares oder leeres Manifest schreibt nichts und zieht nichts zurück.
 *
 * Beispiele:
 *   npm run migrate:media -- --private-file C:\avesmaps3d-data\legacy-snapshots\aktuell\media-export-migration.json
 *   npm run migrate:media -- --source <media-export.json> --private-file <datei> --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        "private-file": { type: "string" },
        "operator-said": { type: "string" },
        // Ein Auftrag aus der Verwaltung („Abgleiche“, WI-0127 SYS-14) statt des Zurufs; schließt --operator-said aus.
        auftrag: { type: "string" },
        "dry-run": { type: "boolean", default: false },
    },
});

if (!values.source && !values["private-file"]) {
    console.error(
        'usage: [--source <media-export.json>] [--private-file <media-export-migration.json>] [--operator-said "<Zitat>"] [--dry-run]',
    );
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

// Zuruf (`--operator-said`) oder Auftrag aus der Verwaltung (`--auftrag`), nie beides (`abgleiche/freigabe.ts`).
const freigabe = freigabeOderEnde({ "operator-said": values["operator-said"], auftrag: values.auftrag });
const dryRun = values["dry-run"] || !freigabe.apply;
const read = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8")) as unknown;
const privatePayload = values["private-file"] === undefined ? undefined : await read(values["private-file"]);
const publicPayload = values.source === undefined ? undefined : await read(values.source);
// B trägt alles; A allein ist eine Teilmenge. Beide: B ist die Quelle, A nur der Vergleich.
const payload = privatePayload ?? publicPayload;
const database = createDatabase(config.databaseUrl);
const started = Date.now();

try {
    if (freigabe.zeile !== null) console.log(freigabe.zeile);
    if (dryRun) {
        console.log(
            !freigabe.apply
                ? "PROBELAUF - ohne --operator-said wird nichts geschrieben, auch kein Journal\n"
                : "PROBELAUF (--dry-run) - nichts geschrieben, auch kein Journal\n",
        );
    }
    const report = await importMedia(database, payload, {
        dryRun,
        publicPayload: privatePayload === undefined ? undefined : publicPayload,
    });
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log(
        `source     ${report.sourceRef}; ${report.kind === null ? "unbrauchbar" : report.kind === "private" ? "Export B (privat)" : "Export A (öffentlich)"}; media_revision ${report.mediaRevision}`,
    );
    if (report.skipped) {
        console.log("übersprungen: das Manifest ist unbrauchbar oder leer; nichts geschrieben, nichts zurückgezogen");
    } else {
        console.log(`${"tabelle".padEnd(28)} neu  geändert  unverändert  zurückgezogen  wieder aktiv  geschützt`);
        for (const name of MEDIA_TABLES) {
            const table = report.tables[name];
            console.log(
                `${name.padEnd(28)} ${String(table.created).padStart(4)} ${String(table.updated).padStart(9)} ${String(table.unchanged).padStart(12)} ${String(table.retired).padStart(14)} ${String(table.reappeared).padStart(13)} ${String(table.protectedRows).padStart(10)}`,
            );
        }
        if (report.byClass !== null) {
            console.log(
                `${"klasse".padEnd(18)} Einträge  Assets  Fachobjekt unbekannt  nur fremde Adresse  Unterdrückungen`,
            );
            for (const cls of MEDIA_CLASSES) {
                const row = report.byClass[cls];
                console.log(
                    `${cls.padEnd(18)} ${String(row.items).padStart(8)} ${String(row.assets).padStart(7)} ${String(row.orphans).padStart(20)} ${String(row.external).padStart(19)} ${String(row.suppressions).padStart(16)}`,
                );
            }
        }
        console.log(
            `regeln     ${String(report.rules.created)} neu, ${String(report.rules.superseded)} abgelöst, ${String(report.rules.present)} schon da, ${String(report.rules.evidence)} Belege neu${report.rules.held.length === 0 ? "" : `; nicht angelegt (Vorgängerin widerrufen): ${report.rules.held.join(", ")}`}`,
        );
        console.log(
            `titel      ${String(report.titles.named)} Assets benannt, ${String(report.titles.keptHuman)} mit Titel eines Menschen gelassen`,
        );
    }
    for (const text of formatFindings(report.findings, 20)) {
        console.log(text);
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const peak = (process.resourceUsage().maxRSS / 1024).toFixed(0);
    console.log(`laufzeit   ${seconds} s, Spitzen-RSS ${peak} MB`);
    console.log(report.changed ? "geändert   ja" : "geändert   nein (nichts zu schreiben)");
    meldeErgebnis(freigabe.auftrag, { luecken: report.skipped ? ["metadaten"] : [], befunde: report.findings.length });
} finally {
    await database.end({ timeout: 5 });
}
