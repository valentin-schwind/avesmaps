import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { importLandscapeDisplay, landscapeDisplayFromBytes, summarizeLandscapeDisplay } from "./landscape-display.ts";

/**
 * Importiert die Darstellungstafel der Landschaften aus der gespeicherten Antwort (WI-0064).
 *
 * Die Datei wird bewusst geholt (`legacy:update`, auf Zuruf des Betreibers, oder auf Stage der Zug der Kette); dieses Werkzeug ruft
 * von sich aus keinen Endpunkt. Es setzt Legacys Uebersteuerungen und die Vorgaben aus Legacys Code (`config/landscape-display/`)
 * zur wirksamen Tafel zusammen und schreibt `landscape_display_art`. Die Tabelle ist abgeleitet, keine redaktionelle Wahrheit, aber
 * sie wirkt auf die Karte: die Freigabe steht wie bei den anderen Importern ausserhalb dieses Werkzeugs (lokal der Zuruf der Sitzung,
 * auf Stage die Freigabezeile der Kette). `--operator-said` traegt das Zitat, wenn es vorliegt, in die Ausgabe.
 *
 * Beispiel:
 *   npm run migrate:landscape-display -- \
 *     --source C:/avesmaps3d-data/legacy-snapshots/aktuell/legacy-ecosystem-display.json \
 *     --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        "operator-said": { type: "string" },
    },
});

if (!values.source) {
    console.error("usage: --source <legacy-ecosystem-display.json> [--operator-said <Zitat>]");
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const input = landscapeDisplayFromBytes(await readFile(values.source));

const database = createDatabase(config.databaseUrl);
try {
    if (values["operator-said"]) console.warn(`Freigabe (Betreiberzitat): „${values["operator-said"]}“`);
    const report = await importLandscapeDisplay(database, input);
    console.warn(summarizeLandscapeDisplay(report));
    console.warn(JSON.stringify(report, null, 2));
} finally {
    await database.end({ timeout: 5 });
}
