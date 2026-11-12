import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { deriveDisplayHeights } from "../terrain/display-height/derive.ts";

/**
 * Leitet die Anzeigehöhen ab (WI-0055): Höhenkacheln der Höhenstufen und Höhenlinien der Topographie.
 * Nur Anzeige, keine Rechengrundlage. Läuft nach der Ableitung des Reliefs (WI-0054), weil es dessen Kacheln liest.
 *
 *   npm run derive:display-heights                 nur bei geänderten Eingaben
 *   npm run derive:display-heights -- --force      auch ohne Änderung neu rechnen
 *   npm run derive:display-heights -- --dry-run    nur rechnen und messen, nichts schreiben
 *
 * Aufräumen wie das Relief: ohne Schalter die aktuelle und einen Tag die vorige Revision (Stage), das
 * npm-Skript setzt `--only-current` (lokal nur die aktuelle). Danach Martin neu starten: Er cacht Kacheln.
 */
const { values } = parseArgs({
    options: {
        force: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        "only-current": { type: "boolean", default: false },
    },
});

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl, { max: 2 });
try {
    // Die Ableitung nimmt selbst die Sperre (derive-lock.ts): Läuft schon eine, bricht sie mit Meldung ab.
    const report = await deriveDisplayHeights(database, {
        force: values.force,
        dryRun: values["dry-run"],
        onlyCurrent: values["only-current"],
        onProgress: (message) => console.warn(message),
    });
    console.warn(JSON.stringify(report, null, 2));
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    console.warn(`Spitze RSS: ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);
    await database.end({ timeout: 5 });
}
