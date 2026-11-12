import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { WIKI_LINK_TABLES, importWikiLinkTargets } from "./wiki-link-targets-import.ts";

/**
 * Importiert die Zuordnungstafel (X2) und die Linkziele (X1) aus den gespeicherten Antworten von Legacys `wiki-zuordnung-export.php` und
 * `wiki-linkziele-export.php` (WI-0063 27.12, Migration 0073, Vertrag `wiki-link-targets.yaml`). Die Quelle sind die Antwortdateien; sie werden
 * hier NIE abgerufen (ein Abruf braucht den Zuruf des Betreibers und gehört zu `legacy:update`).
 *
 * 🔴 Eine Kartendatenübernahme: nur mit dem Zuruf des Betreibers für genau diese Datenbank (Map Mutation Guard). OHNE `--operator-said` oder `--auftrag` rechnet das
 * Werkzeug nur: Es zählt alles, meldet die Befunde und rollt dann zurück, auch das Journal. `--dry-run` rechnet auch MIT Zitat nur. Ist eine Antwort
 * unbrauchbar oder leer, schreibt dieser Teil nichts und legt nichts still.
 *
 * Beispiele:
 *   npm run migrate:wiki-links -- --zuordnung C:\avesmaps3d-data\legacy-snapshots\aktuell\legacy-wiki-zuordnung.json --linkziele <datei>
 *   npm run migrate:wiki-links -- --zuordnung <datei> --linkziele <datei> --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        linkziele: { type: "string" },
        zuordnung: { type: "string" },
        "operator-said": { type: "string" },
        // Ein Auftrag aus der Verwaltung („Abgleiche“, WI-0127 SYS-14b) statt des Zurufs; schließt --operator-said aus.
        auftrag: { type: "string" },
        "dry-run": { type: "boolean", default: false },
    },
});

if (!values.linkziele && !values.zuordnung) {
    console.error(
        'usage: --zuordnung <wiki-zuordnung.json> --linkziele <wiki-linkziele.json> [--operator-said "<Zitat>" | --auftrag <Job>] [--dry-run]',
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
const read = async (path: string | undefined): Promise<unknown> =>
    path === undefined ? null : (JSON.parse(await readFile(path, "utf8")) as unknown);
const input = { linkziele: await read(values.linkziele), zuordnung: await read(values.zuordnung) };
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
    const report = await importWikiLinkTargets(database, input, { dryRun });
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log(`source     ${report.sourceRef}`);
    if (report.skipped.zuordnung) console.log("übersprungen: Zuordnung (X2) fehlt, ist unbrauchbar oder leer");
    if (report.skipped.linkziele) console.log("übersprungen: Linkziele (X1) fehlen, sind unbrauchbar oder leer");
    console.log(`${"tabelle".padEnd(22)} neu  geändert  unverändert  stillgelegt`);
    for (const name of WIKI_LINK_TABLES) {
        const table = report.tables[name];
        console.log(
            `${name.padEnd(22)} ${String(table.created).padStart(5)} ${String(table.updated).padStart(9)} ${String(table.unchanged).padStart(12)} ${String(table.retired).padStart(12)}`,
        );
    }
    console.log(
        `zahlen     ${String(report.stats.assignments)} zugewiesene Objekte, ${String(report.stats.distinctKeys)} verschiedene Keys, ${String(report.stats.pages)} Artikel, ${String(report.stats.links)} Links`,
    );
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
