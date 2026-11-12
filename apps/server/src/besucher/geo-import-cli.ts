import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { importiereGeoDaten } from "./geo-import.ts";

/**
 * Spielt das Nachschlagewerk „Netz → Land“ ein (WI-0138 V6): die CSV von **DB-IP lite** (CC BY 4.0) nach
 * `visitor_geo_range`.
 *
 * Die Datei liegt NICHT im Repository — sie wiegt hunderte Megabyte und erneuert sich monatlich. Sie wird bei
 * `db-ip.com/db/download/ip-to-city-lite` geholt, entpackt und von hier eingespielt:
 *
 *   npm run import:besucher-geo -- --quelle /srv/geo/dbip-city-lite-2026-10.csv
 *
 * Der Lauf ersetzt den Bestand. Ohne die Daten zählt die Statistik weiter, nur ohne Herkunft: Jede Zeile ohne Treffer
 * trägt ein leeres Land, und die Karte bleibt leer.
 *
 * 🔴 Die Lizenz verlangt die Namensnennung. Sie steht in der Oberfläche unter der Herkunftskarte, nicht nur hier.
 */
const { values } = parseArgs({
    options: {
        quelle: { type: "string" },
    },
});

const quelle = values.quelle;
if (quelle === undefined) {
    console.error("Aufruf: npm run import:besucher-geo -- --quelle <dbip-city-lite.csv>");
    process.exit(2);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL fehlt");
    process.exit(2);
}

const sql = createDatabase(config.databaseUrl);
try {
    const anfang = Date.now();
    const { gelesen, geschrieben } = await importiereGeoDaten(sql, quelle, (satz) => console.log(satz));
    console.log(
        `Fertig: ${gelesen} Zeilen gelesen, ${geschrieben} Netze geschrieben (${Math.round((Date.now() - anfang) / 1000)} s)`,
    );
} finally {
    await sql.end({ timeout: 5 });
}
