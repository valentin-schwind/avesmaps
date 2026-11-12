import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { importiereRohabzug, ZIELE } from "./legacy-roh-import.ts";

/**
 * Legacys Ausprägungen einspielen (WI-0151). Quelle ist Claudios Rohabzug der Legacy-Tabelle `visitor_metric` im Format
 * `day hour actor_type metric dimension count` (Kopfzeile, `NULL` wie `mysql --batch`), als `.tsv` oder `.tsv.gz`.
 *
 * 🔴 **Die Datei liegt nicht im Repository**: `dimension` trägt Suchbegriffe von Besuchern. Sie bleibt auf dem VPS und beim
 * Betreiber (Handover `2026-10-14-legacy-rohexport-da-an-claudia.md`).
 *
 * Der Lauf ist beliebig oft wiederholbar (`ON CONFLICT DO NOTHING`) und überschreibt nie, was schon da ist. Erst trocken:
 *
 *   node apps/server/src/besucher/legacy-roh-import-cli.ts --quelle <datei.tsv.gz> --trocken
 *   node apps/server/src/besucher/legacy-roh-import-cli.ts --quelle <datei.tsv.gz>
 *
 * Im Release (dort gibt es kein `src/`):
 *
 *   node --env-file=<.env> apps/server/dist/besucher/legacy-roh-import-cli.js --quelle <datei.tsv.gz>
 */
const { values } = parseArgs({
    options: {
        quelle: { type: "string", multiple: true },
        trocken: { type: "boolean", default: false },
    },
});

const quellen = values.quelle ?? [];
if (quellen.length === 0) {
    console.error("usage: --quelle <abzug.tsv|.tsv.gz> [--quelle <weiterer>] [--trocken]");
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
        const ergebnis = await importiereRohabzug(sql, quelle, { trocken: values.trocken });
        const wie = values.trocken ? "trocken, nichts geschrieben" : `${ergebnis.geschrieben} neu geschrieben`;
        console.log(
            `${quelle}: ${ergebnis.gelesen} Zeilen gelesen (${ergebnis.kaputt} kaputt), ${ergebnis.von} bis ${ergebnis.bis}, ` +
                `${ergebnis.kartenNamen} Kartennamen zum Abgleich`,
        );
        console.log("  Legacy-Metrik        gelesen  übernommen  verworfen  Ziel");
        for (const [metrik, zahl] of [...ergebnis.jeMetrik].sort((a, b) => b[1].gelesen - a[1].gelesen)) {
            const ziel = ZIELE[metrik]?.metrik ?? "—";
            console.log(
                `  ${metrik.padEnd(20)} ${String(zahl.gelesen).padStart(7)}  ${String(zahl.uebernommen).padStart(10)}  ` +
                    `${String(zahl.verworfen).padStart(9)}  ${ziel}`,
            );
        }
        console.log(`  verdichtet auf ${ergebnis.zeilen} Zeilen, Summe ${ergebnis.angeboten} (${wie}):`);
        for (const [metrik, zahl] of [...ergebnis.jeZiel].sort((a, b) => b[1].summe - a[1].summe)) {
            console.log(`  ${metrik.padEnd(20)} ${String(zahl.zeilen).padStart(7)} Zeilen  Summe ${zahl.summe}`);
        }
    }
} finally {
    await sql.end();
}
