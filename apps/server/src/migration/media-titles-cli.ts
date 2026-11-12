import { parseArgs } from "node:util";
import { MEDIA_ROLES } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { backfillAssetTitles } from "./media-titles.ts";

/**
 * Der Nachtrag der Asset-Namen für den Bestand auf Zuruf (WI-0068, Betreiber 2026-10-10): „Wappen von Gareth“, „Bild von Gareth (1)“
 * nach der Regel in `media-editor/titles.ts`, für Assets ohne Titel; dazu bekommen Namen des Systems, die verschiedene Objekte gleichen
 * Namens meinen, die Art nach einem Komma („Wappen von Fasar, Stadt“, Betreiber 2026-10-11). Ein Titel eines Menschen bleibt.
 *
 * OHNE `--operator-said` rechnet es nur und rollt zurück (auch das Journal). `--dry-run` rechnet auch mit Zitat nur. `--zeige <n>`
 * druckt die ersten n Namen (Vorgabe 12), `--objekt <name>` alle Namen der Assets dieses Fachobjekts (etwa Gareth).
 *
 *   npm run media:titel
 *   npm run media:titel -- --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        "operator-said": { type: "string" },
        "dry-run": { type: "boolean", default: false },
        zeige: { type: "string", default: "12" },
        objekt: { type: "string" },
    },
});

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const operatorSaid = values["operator-said"];
if (operatorSaid !== undefined && (operatorSaid.trim() === "" || operatorSaid.startsWith("-"))) {
    console.error("--operator-said braucht das Zitat des Betreibers");
    process.exit(2);
}
const dryRun = values["dry-run"] || operatorSaid === undefined;
const database = createDatabase(config.databaseUrl, { max: 1 });

try {
    if (operatorSaid !== undefined) console.log(`Freigabe (Betreiberzitat): „${operatorSaid}“`);
    if (dryRun) console.log("PROBELAUF - nichts geschrieben, auch kein Journal\n");
    const report = await backfillAssetTitles(database, { dryRun, operatorSaid });
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log(`ohne Titel ${String(report.untitledBefore)} Assets vorher`);
    console.log(
        `benannt    ${String(report.named.length)}: ${MEDIA_ROLES.map((role) => `${role} ${String(report.byRole[role])}`).join(", ")}`,
    );
    console.log(
        `gelassen   ${String(report.keptHuman)} bewusst ohne Titel (Mensch), ${String(report.withoutSubject)} ohne Fachobjekt (kein Name)`,
    );
    console.log(
        `umbenannt  ${String(report.renamed.length)}: ${MEDIA_ROLES.map((role) => `${role} ${String(report.renamedByRole[role])}`).join(", ")}`,
    );
    console.log(
        `gleich     ${String(report.sharedNamesBefore)} Namen mehrfach vergeben vorher, ${String(report.sharedNamesAfter)} nachher`,
    );
    const shown = Math.max(0, Number(values.zeige));
    for (const asset of report.named.slice(0, shown)) console.log(`  ${asset.publicId}  ${asset.title}`);
    for (const asset of report.renamed.slice(0, shown)) {
        console.log(`  ${asset.publicId}  ${asset.before}  →  ${asset.title}`);
    }
    if (values.objekt !== undefined) {
        const needle = values.objekt;
        for (const asset of report.named.filter((entry) => entry.title.includes(needle))) {
            console.log(`  ${asset.publicId}  ${asset.title}`);
        }
        for (const asset of report.renamed.filter((entry) => entry.title.includes(needle))) {
            console.log(`  ${asset.publicId}  ${asset.before}  →  ${asset.title}`);
        }
    }
} finally {
    await database.end({ timeout: 5 });
}
