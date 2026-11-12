import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { deriveAll, refreshLabelCurve } from "./refresh-label-curve.ts";

/**
 * Leitet die Schriftläufe der kurvenbeschrifteten Regionen ab (WI-0004).
 *
 *   npm run derive:runs                            # nur veraltete
 *   npm run derive:runs -- --all                   # alle neu rechnen
 *   npm run derive:runs -- --region <public_id>    # „Labelkurve aktualisieren“ für eine Region (WI-0018)
 *
 * Der Lauf liest nichts von Legacy. Er rechnet aus dem, was im Ziel liegt, und schreibt abgeleitete
 * Geometrie — ein Verlust kostet nichts als einen erneuten Aufruf. Geschrieben wird nur über
 * `storeRuns`, dieselbe Stelle, die später das Kontextmenü des Editors benutzt.
 */
const { values } = parseArgs({
    options: { all: { type: "boolean", default: false }, region: { type: "string" } },
});

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    if (values.region !== undefined) {
        const outcome = await refreshLabelCurve(database, values.region);
        console.warn(JSON.stringify(outcome, null, 2));
        if (outcome.status === "not-found") {
            process.exitCode = 1;
        }
    } else {
        const report = await deriveAll(database, { all: values.all });
        console.warn(JSON.stringify({ ...report, written: report.written.length }, null, 2));
    }
} finally {
    await database.end({ timeout: 5 });
}
