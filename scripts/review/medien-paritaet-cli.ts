import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../../apps/server/src/config.ts";
import { createDatabase } from "../../apps/server/src/database.ts";
import { baueBlatt } from "./medien-paritaet-blatt.ts";
import { formatBericht, vergleicheMedien } from "./medien-paritaet.ts";

/**
 * MEDIA-M11, das Paritätsreview der Medien-Referenzfälle: ein Lauf, zwei Ergebnisse — die Tafel der Paritätsklassen auf
 * der Konsole und das Blatt für den Betreiber (hell und dunkel, echte Größe).
 *
 *   npm run review:medien-paritaet
 *   npm run review:medien-paritaet -- --source <media-export.json> --media-root <ordner>
 *   npm run review:medien-paritaet -- --nur-tabelle
 *
 * 🔴 Nur lesend, und KEIN Tor: der Lauf endet immer mit 0 (AGENTS.md, „Blockierende Prüfungen im Betrieb"). `--streng`
 * ist ein ausdrücklich angeforderter Rückgabewert 1 bei einem Befund, für einen Aufrufer, der selbst bewerten will.
 *
 * 🔴 Es wird NICHTS abgerufen: die Legacy-Seite ist Legacys lokal abgelegter Export A, die eigene Seite die
 * Entwicklungsdatenbank und `MEDIA_ROOT`.
 */
const { values } = parseArgs({
    options: {
        source: { type: "string", default: "C:/avesmaps3d-data/legacy-snapshots/aktuell/media-export.json" },
        "media-root": { type: "string" },
        "nur-tabelle": { type: "boolean", default: false },
        streng: { type: "boolean", default: false },
        json: { type: "string" },
        blatt: { type: "string", default: "review/wi-0063/medien-paritaet/blatt.png" },
    },
});

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const mediaRoot = values["media-root"] ?? process.env["MEDIA_ROOT"];

const database = createDatabase(config.databaseUrl, { max: 4 });
let befunde: number;
try {
    const bericht = await vergleicheMedien(database, values.source);
    befunde = bericht.befunde.length;
    console.log(formatBericht(bericht));

    if (values.json !== undefined) {
        await mkdir(dirname(resolve(values.json)), { recursive: true });
        await writeFile(resolve(values.json), `${JSON.stringify(bericht, null, 2)}\n`, "utf8");
        console.log(`\nZahlen       ${values.json}`);
    }

    if (values["nur-tabelle"]) {
        console.log("\n--nur-tabelle: kein Blatt gezeichnet.");
    } else if (mediaRoot === undefined || mediaRoot === "") {
        console.warn(
            "\nKein MEDIA_ROOT: das Blatt braucht die veröffentlichten Dateien auf der Platte (--media-root <ordner>).",
        );
    } else {
        const pfad = await baueBlatt(bericht, mediaRoot, values.blatt);
        console.log(`\nBlatt        ${pfad}`);
    }
} finally {
    await database.end();
}

// Ein Befund ist ein Befund, kein Abbruch — es sei denn, der Aufrufer hat ausdrücklich darum gebeten.
if (values.streng && befunde > 0) process.exit(1);
