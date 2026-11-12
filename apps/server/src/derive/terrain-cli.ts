import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { deriveTerrain } from "../terrain/derive.ts";
import { AVENTURIA } from "@avesmaps3d/shared";
import { readTerrainChoice } from "../terrain/auswahl.ts";

/** Canonical V12-seed → domain master → DEM/profile publication → verified activation. */
const { values } = parseArgs({
    options: {
        workers: { type: "string" },
        only: { type: "string" },
        force: { type: "boolean", default: false },
        "only-current": { type: "boolean", default: false },
    },
});

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
// Welche Fassung des Geländerezepts gilt: die Auswahl dieser Umgebung (Systemsteuerung, WI-0127 SYS-13), sonst die Vorgabe der Datei.
const choice = await readTerrainChoice(database, AVENTURIA.mapDomain);
console.warn(
    `Geländerezept: Fassung ${String(choice.version)} (${choice.quelle === "auswahl" ? "Auswahl dieser Umgebung" : "Vorgabe der Datei"})`,
);
try {
    // Die Ableitung nimmt selbst die Sperre (derive-lock.ts): Läuft schon eine, bricht sie mit Meldung ab.
    const report = await deriveTerrain(database, {
        workers: values.workers ? Number(values.workers) : Math.max(1, Math.min(2, availableParallelism() - 1)),
        only: values.only ? values.only.split(",").map((entry) => entry.trim()) : [],
        force: values.force,
        onlyCurrent: values["only-current"],
        onProgress: (message) => console.warn(message),
    });
    console.warn(JSON.stringify(report, null, 2));
    // Betreiber 2026-10-03: Seen eben, Gipfel exakt, Meer 0, Flüsse nicht bergauf halten die Ableitung nicht an, sie stehen als Befunde da.
    for (const text of formatFindings(report.domain?.constraints.findings ?? [])) console.warn(text);
    // Für den Betrieb (Claudio): Spitze des Prozesses samt Worker-Threads.
    console.warn(`Spitze RSS: ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);
    if (report.failed.length > 0) {
        process.exitCode = 1;
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await database.end({ timeout: 5 });
}
