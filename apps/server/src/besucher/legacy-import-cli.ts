import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { importiereLegacyAbzug } from "./legacy-import.ts";

/**
 * Übernimmt Legacys Messreihe als Vorgeschichte der eigenen Statistik (WI-0138 V14).
 *
 * Die Abzüge liegen versioniert im Repository (`project-control/discovery/legacy-nutzung-2026-10-12/`), ein Lauf ist beliebig oft
 * wiederholbar (`ON CONFLICT DO NOTHING`) und überschreibt nie, was die eigene Zählung schon geschrieben hat. Keine Kartendaten,
 * keine Personendaten: nur anonyme Tagessummen.
 *
 * Beispiele:
 *   npm run import:besucher-legacy -- --quelle ../../project-control/discovery/legacy-nutzung-2026-10-12/visitor-metrics-besucher.json
 *   npm run import:besucher-legacy -- --quelle <datei> --trocken
 */
const { values } = parseArgs({
    options: {
        quelle: { type: "string", multiple: true },
        trocken: { type: "boolean", default: false },
    },
});

const quellen = values.quelle ?? [];
if (quellen.length === 0) {
    console.error("usage: --quelle <abzug.json> [--quelle <weiterer.json>] [--trocken]");
    process.exit(2);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL fehlt");
    process.exit(2);
}

const sql = createDatabase(config.databaseUrl);
try {
    for (const quelle of quellen) {
        if (values.trocken) {
            const { zeilenAusAbzug } = await import("./legacy-import.ts");
            const { readFile } = await import("node:fs/promises");
            const zeilen = zeilenAusAbzug(JSON.parse(await readFile(quelle, "utf8")));
            console.log(`${quelle}: ${zeilen.length} Zeilen (trocken, nichts geschrieben)`);
            continue;
        }
        const ergebnis = await importiereLegacyAbzug(sql, quelle);
        console.log(
            `${quelle}: Sorte ${ergebnis.sorte}, ${ergebnis.tage} Tage (${ergebnis.von} bis ${ergebnis.bis}), ` +
                `${ergebnis.zeilen} Zeilen angeboten, ${ergebnis.geschrieben} neu geschrieben`,
        );
    }
} finally {
    await sql.end();
}
