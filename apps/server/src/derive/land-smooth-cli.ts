import { areaIdsOf, deriveLandSmooth, landSmoothFallbacks } from "../areas/smooth.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";

/**
 * Leitet alle Flächen nahtlos geglättet ab, dazu die Klimabänder mit geglätteten Übergängen (WI-0055, WI-0077, Migrationen
 * 0067 und 0072). Derived Data, nur Anzeige, jederzeit wiederholbar; ohne Änderung der Eingaben rechnet der Lauf nichts.
 *
 *   --force                      das ganze Netz neu, auch ohne Änderung
 *   --areas <public_id>[,<…>]    nur diese Flächen und ihre Nachbarn (die Funktion für einen Editor, der eine Fläche geändert hat)
 *
 * Danach Martin neu starten (er cacht Katalog und Kacheln).
 */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const argv = process.argv.slice(2);
const areasArgument = argv.indexOf("--areas");
const publicIds =
    areasArgument >= 0
        ? (argv[areasArgument + 1] ?? "")
              .split(",")
              .map((value) => value.trim())
              .filter((value) => value !== "")
        : undefined;
if (publicIds !== undefined && publicIds.length === 0) {
    console.error("--areas braucht mindestens eine oeffentliche ID einer Flaeche (region_area.public_id)");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl, { max: 2 });
try {
    let areaIds: number[] | undefined;
    if (publicIds) {
        const found = await areaIdsOf(database, publicIds);
        const missing = publicIds.filter((id) => !found.some((row) => row.publicId === id));
        if (missing.length > 0) {
            console.error(`unbekannte Flaechen: ${missing.join(", ")}`);
            process.exit(1);
        }
        areaIds = found.map((row) => row.id);
    }
    const report = await deriveLandSmooth(database, {
        force: argv.includes("--force"),
        ...(areaIds ? { areaIds } : {}),
    });
    console.log(
        `gerechnet      ${report.computed ? `ja, ${report.mode === "voll" ? "das ganze Netz" : "geaenderte Flaechen und ihre Nachbarn"}` : "nein, Eingaben unveraendert"} (Rezept ${report.recipe})`,
    );
    console.log(`Flaechen       ${String(report.areas)}, davon geglaettet ${String(report.smoothed)}`);
    if (report.computed) {
        console.log(
            `Lauf           ${String(report.computedAreas)} Flaechen gerechnet, ${String(report.written)} geschrieben`,
        );
        console.log(
            `Kanten         ${String(report.edges)}, davon gemeinsam ${String(report.sharedEdges)} (je einmal geglaettet), ueber Ebenen ${String(report.crossLayerEdges)}`,
        );
        console.log(
            `Punkte         ${String(report.mergedPoints)} Gruppen fast gleicher Punkte zusammengefuehrt, ${String(report.insertedPoints)} T-Stoesse eingefuegt`,
        );
    }
    for (const fallback of await landSmoothFallbacks(database)) {
        console.log(`Rueckfall      ${fallback.status} ${fallback.publicId} ${fallback.name}`);
    }
    if (report.climate) {
        const climate = report.climate;
        console.log(
            `Klima          ${climate.computed ? "gerechnet" : "unveraendert"}, ${String(climate.smoothed)} von ${String(climate.bands)} Baendern geglaettet` +
                (climate.area === null ? "" : `, Flaeche ${String(climate.area)} von 1048576 E²`),
        );
    }
    console.log(
        `Schritte       ${report.phases.map((phase) => `${phase.name} ${(phase.ms / 1000).toFixed(1)} s`).join(", ")}`,
    );
    console.log(`Zeit           ${(report.ms / 1000).toFixed(1)} s`);
    console.log(`Speicher       MaxRSS ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB (dieser Prozess)`);
} finally {
    await database.end({ timeout: 5 });
}
