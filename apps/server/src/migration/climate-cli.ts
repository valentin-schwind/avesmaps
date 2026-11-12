import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { createDatabase } from "../database.ts";
import { formatFinding } from "../findings.ts";
import {
    importClimate,
    losslessFinding,
    readLegacyBands,
    reconstructDividers,
    verifyReconstruction,
} from "./climate.ts";
import { readLegacyPlaceZones, verifyClimate } from "./verify-climate.ts";

/**
 * Migriert die Klimazonen (WI-0005): sieben Trennlinien aus dem Snapshot, acht Bänder daraus.
 *
 *   npm run migrate:climate -- --areas <ecosystem-areas.json>
 *   npm run migrate:climate -- --areas <...> --dry-run
 *
 * 🔴 Die Quelle ist eine DATEI, nie ein Endpunkt. Legacy wird von diesem Lauf nicht berührt -
 * `climate_get` wäre ein Schreibpfad gewesen (Betreiberentscheidung 2026-09-21, Option 2).
 *
 * 🔴 Seit 2026-10-03 hält keine Prüfung den Lauf an (Betreiber: „B“, nur melden). Die Verlustfreiheit der Rekonstruktion und
 * die fünfzehn Prüfungen stehen als BEFUND mit Zahlen und den betroffenen Zonen und Linien da, der Lauf schreibt weiter und
 * endet mit Code 0. Technische Abbrüche bleiben: Datenbank, Datei, Pflichtargument, eine Grenze, die sich nicht zu einer Linie
 * gewinnen lässt.
 */
const { values } = parseArgs({
    options: {
        areas: { type: "string" },
        features: { type: "string" },
        "dry-run": { type: "boolean", default: false },
    },
});

if (!values.areas || !values.features) {
    // 🪤 `--features` ist NICHT optional. Ohne den Snapshot faellt `zugehoerigkeit_ort` aus, und
    // das ist die einzige Pruefung gegen eine unabhaengige Quelle. Ein Lauf ohne sie waere gruen
    // und haette weniger bewiesen, als er behauptet.
    console.error("usage: --areas <ecosystem-areas.json> --features <map-features.json> [--dry-run]");
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const payload = JSON.parse(await readFile(values.areas, "utf8")) as unknown;
const bands = readLegacyBands(payload);
const places = readLegacyPlaceZones(JSON.parse(await readFile(values.features, "utf8")));
console.warn(`Snapshot: ${String(bands.length)} Klimaflaechen, ${String(places.length)} Orte mit Zone`);

const database = createDatabase(config.databaseUrl);
try {
    const dividers = await reconstructDividers(database, bands);
    console.warn(
        `Rekonstruiert: ${String(dividers.length)} Trennlinien [${dividers.map((d) => String(d.pointCount)).join(", ")}]`,
    );

    // 🪤 Die Verlustfreiheit wird VOR dem Schreiben geprueft. Danach waere sie eine Ausrede.
    const lossless = await verifyReconstruction(database, bands, dividers);
    console.warn(`${checkWord(lossless.passed, false, "OK  ")}  ${lossless.name.padEnd(30)} ${lossless.detail}`);
    for (const offender of lossless.offenders ?? []) {
        console.warn(`        ${offender}`);
    }
    // Betreiber 2026-10-03 („B“): Eine Rekonstruktion, die Punkte verliert, ist ein Befund, kein Abbruch.
    const losslessProblem = losslessFinding(lossless);
    if (losslessProblem) {
        for (const text of formatFinding(losslessProblem)) console.warn(text);
        console.warn("\nDie Rekonstruktion verliert Punkte. Der Lauf geht weiter.");
    }

    if (values["dry-run"]) {
        // 🪤 Ohne diesen Ausstieg prueft der Trockenlauf die noch leeren Zieltabellen und meldet
        // Fehler, die keine sind. Ein Lauf, der erwartbar rot ist, wird nicht mehr gelesen.
        console.warn("\nTrockenlauf: nichts geschrieben, keine Zielpruefung.");
        await database.end({ timeout: 5 });
        process.exit(0);
    } else {
        const result = await importClimate(database, bands);
        console.warn(
            `Import: ${String(result.dividers)} Linien, ${String(result.bands)} Baender, ` +
                `${result.written ? "geschrieben" : "unveraendert"} (Fingerabdruck ${result.fingerprint.slice(0, 12)})`,
        );
    }

    const report = await verifyClimate(database, bands, places);
    console.warn("");
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(30)} ${entry.detail}`,
        );
        for (const offender of entry.offenders ?? []) {
            console.warn(`        ${offender}`);
        }
    }
    const befunde = befundSummary(report.checks, (entry) => entry.passed);
    if (befunde) console.warn(`\n${befunde}`);
    console.warn(report.passed ? "\nKlimazonen: bestanden" : "\nKlimazonen: GESCHEITERT");
    if (!report.passed) {
        process.exit(1);
    }
} finally {
    await database.end({ timeout: 5 });
}
