import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { derivePathVisuals } from "./path-visual.ts";

/** Leitet die gezeichnete Wegkurve ab (WI-0010). Derived Data, jederzeit wiederholbar. */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    const report = await derivePathVisuals(database);
    console.log(`Wege           ${String(report.wege)}`);
    console.log(`geschrieben    ${String(report.geschrieben)}`);
    console.log(`unveraendert   ${String(report.unveraendert)}`);
    console.log(`Stuetzpunkte   ${String(report.punkteVorher)} -> ${String(report.punkteNachher)}`);
} finally {
    await database.end({ timeout: 5 });
}
