import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { deriveTerritories } from "../territories/derive.ts";

/**
 * Leitet Flächen, Grenzen, Namensanker und Hauptstadtzeiger der Herrschaftsgebiete ab (WI-0062, ADR-0014). Derived Data,
 * jederzeit wiederholbar; ohne Änderung der Eingaben rechnet der Lauf nichts. `--force` rechnet trotzdem.
 * Danach Martin neu starten (er cacht Katalog und Kacheln).
 */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    const report = await deriveTerritories(database, { force: process.argv.includes("--force") });
    console.log(`Revision       ${report.revision} (neu: ${report.revisionChanged ? "ja" : "nein"})`);
    console.log(`Anzeigejahr    ${String(report.yearBf)} BF`);
    console.log(`gerechnet      ${report.computed ? "ja" : "nein, Eingaben unveraendert"}`);
    console.log(
        `Gebiete        ${String(report.territories)}, Flaechen ${String(report.areas)} (davon repariert ${String(report.repairedAreas)})`,
    );
    console.log(`nicht geltend  ${String(report.notCurrent)} Flaechen im Anzeigejahr`);
    for (const band of report.bands) {
        console.log(
            `Band ${String(band.band)}        ${String(band.shapes).padStart(4)} Formen, ${String(band.outer).padStart(4)} Aussen-, ${String(band.inner).padStart(4)} Innengrenzen; ` +
                `nicht gezeigt: ${String(band.notShownNoBand)} ohne Band, ${String(band.notShownOwnBand)} durch eigenes Band`,
        );
    }
    console.log(`Hauptstaedte   ${String(report.capitals)}`);
    console.log(`Zeit           ${(report.ms / 1000).toFixed(1)} s, Speicher ${String(report.rssMb)} MB`);
    console.log(
        `Abschnitte     ${Object.entries(report.phasesMs)
            .map(([name, ms]) => `${name} ${(ms / 1000).toFixed(1)} s`)
            .join(", ")}`,
    );
    console.log(`je Band        ${report.bands.map((band) => (band.ms / 1000).toFixed(1)).join(" / ")} s`);
} finally {
    await database.end({ timeout: 5 });
}
