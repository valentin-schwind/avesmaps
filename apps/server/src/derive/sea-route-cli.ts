import { AVENTURIA, AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { deriveSeaRoutes, landlessSettings } from "../routing/sea-derive.ts";
import { describeLandless } from "../routing/sea-landless.ts";

/**
 * Leitet den Seegraphen des freien Seeroutings ab (WI-0046). Derived Data, jederzeit wiederholbar;
 * `--force` rechnet auch bei unveränderten Quellen.
 */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    const report = await deriveSeaRoutes(database, AVENTURIA.mapDomain, AVENTURIA_TRAVEL_MODEL, {
        force: process.argv.includes("--force"),
    });
    console.log(`geschrieben    ${report.written ? "ja" : "nein, Quellen unveraendert"}`);
    console.log(`Fingerabdruck  ${report.fingerprint}`);
    console.log(`Haefen         ${String(report.ports)}`);
    console.log(`Knoten         ${String(report.nodes)}`);
    console.log(`Kanten         ${String(report.edges)} (davon Bruecken ${String(report.bridges)})`);
    console.log(`Speicher       ${(report.bytes / 1e6).toFixed(1)} MB`);
    if (report.narrows)
        console.log(
            `Engstellen     ${String(report.narrows.joined)} verbunden, ${String(report.narrows.cells)} Zellen, ${String(report.narrows.unresolved)} getrennt`,
        );
    console.log(
        `Zeit           ${(report.ms.total / 1000).toFixed(1)} s (Graph ${(report.ms.graph / 1000).toFixed(1)} s, Gewichte und Haefen ${(report.ms.weights / 1000).toFixed(1)} s, Hafenpaare ${(report.ms.pairs / 1000).toFixed(1)} s)`,
    );
    console.log(
        `Sperrgebiete   ${report.closures.map((closure) => `${closure.name} (${String(closure.pairs)} Hafenpaare)`).join(", ")}`,
    );
    console.log(
        `ohne Wasser    ${String(report.withoutLanding.length)}: ${report.withoutLanding.map((port) => port.name).join(", ")}`,
    );
    // Je Hafen eine eingerückte Zeile mit Kennung und Grund (WI-0060); die Feldzeilen oben bleiben, wie sie sind.
    for (const port of report.withoutLanding) {
        console.log(
            `  Hafen ohne Wasser-Zugang ${port.id} ${port.name}: ${describeLandless(port, landlessSettings(report))}`,
        );
    }
    console.log(
        `Gewaesser      ${(report.waters ?? []).map((water) => `${water.transport} ${String(water.ports)} Haefen`).join(", ") || "alle Schiffe ueberall"}`,
    );
} finally {
    await database.end({ timeout: 5 });
}
