import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { MigrationAborted } from "./places.ts";
import type { LegacyTerritoryPayload } from "./territories.ts";
import { importTerritories } from "./territory-import.ts";

/**
 * Importiert die Herrschaftsgebiete aus dem gespeicherten Export (WI-0062, ADR-0014).
 *
 * Die Datei wird bewusst geholt; dieses Werkzeug ruft von sich aus keinen Endpunkt (Legacys Export ist teuer: auch ein
 * 304 kostet einen vollen Lesevorgang, nur auf Zuruf holen). Der Import ändert Kartendaten und braucht den Zuruf des
 * Betreibers (Map Mutation Guard, AGENTS.md). Wie bei den anderen Importern (`migrate:regions`) steht die Freigabe
 * außerhalb dieses Werkzeugs: lokal der Zuruf der Sitzung, auf Stage die Freigabezeile der Kette. `--operator-said`
 * trägt das Zitat, wenn es vorliegt, in die Ausgabe.
 *
 * Beispiel:
 *   npm run migrate:territories -- \
 *     --source C:/avesmaps3d-data/legacy-snapshots/aktuell/legacy-political-territories.json \
 *     --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        etag: { type: "string" },
        "operator-said": { type: "string" },
        "allow-shrink": { type: "boolean", default: false },
    },
});

if (!values.source) {
    console.error("usage: --source <legacy-political-territories.json> [--operator-said <Zitat>] [--etag <ETag>]");
    process.exit(1);
}
// Wirkungslos seit 2026-10-03 (Betreiber): die Stilllegequote wird als Befund gemeldet, der Lauf geht weiter.
if (values["allow-shrink"]) {
    console.warn(
        "Hinweis: --allow-shrink ist wirkungslos; die Stilllegequote wird nur gemeldet (Betreiber 2026-10-03).",
    );
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const payload = JSON.parse(await readFile(values.source, "utf8")) as LegacyTerritoryPayload;

const database = createDatabase(config.databaseUrl);
try {
    if (values["operator-said"]) console.warn(`Freigabe (Betreiberzitat): „${values["operator-said"]}“`);
    const report = await importTerritories(database, payload, { sourceEtag: values.etag ?? null });
    console.warn(JSON.stringify(report, null, 2));
    for (const text of formatFindings(report.findings)) {
        console.warn(text);
    }
} catch (error) {
    if (error instanceof MigrationAborted) {
        console.error(`abgebrochen: ${error.message}`);
        console.error(JSON.stringify(error.detail, null, 2));
        process.exit(2);
    }
    throw error;
} finally {
    await database.end({ timeout: 5 });
}
