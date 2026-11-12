import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { switchPublicationRules } from "./media-rule-switch.ts";

/**
 * Der Regelwechsel der Medien auf Zuruf (WI-0068, Betreiber 2026-10-10): wendet die Freigaberegeln des Skripts an
 * (`media-rules.ts`, `seedPublicationRules`), ohne Legacy-Manifest und ohne sonst etwas zu importieren. Heute heißt das: die
 * Klassenregeln own_work/coat und own_work/header werden in EINER Transaktion durch own_work/ai_generated/coat und
 * own_work/ai_generated/header abgelöst. Davor und danach misst es jede Verwendung mit derselben Entscheidung wie der Resolver.
 *
 * OHNE `--operator-said` rechnet es nur und rollt zurück (auch das Journal). `--dry-run` rechnet auch mit Zitat nur. Die Dateien unter
 * `published/` gleicht danach `migrate:media-files` ab (nur nötig, wenn sich eine Entscheidung ändert).
 *
 *   npm run media:regeln
 *   npm run media:regeln -- --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        "operator-said": { type: "string" },
        "dry-run": { type: "boolean", default: false },
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
    const report = await switchPublicationRules(database, { dryRun, operatorSaid });
    console.log(`run        ${report.runId}${report.dryRun ? " (verworfen)" : ""}`);
    console.log("vorher     " + report.statesBefore.map(({ rule, state }) => `${rule} ${state}`).join(", "));
    console.log(
        `regeln     ${String(report.rules.created)} neu, ${String(report.rules.superseded)} abgelöst (widerrufen), ${String(report.rules.present)} schon da${report.rules.held.length === 0 ? "" : `; nicht angelegt (Vorgängerin widerrufen): ${report.rules.held.join(", ")}`}`,
    );
    console.log(
        `öffentlich vorher ${String(report.before.public)} Verwendungen (${String(report.before.byRule)} über eine Regel), nachher ${String(report.after.public)} (${String(report.after.byRule)} über eine Regel)`,
    );
    const lost = report.changes.filter((change) => change.before.public && !change.after.public);
    const gained = report.changes.filter((change) => !change.before.public && change.after.public);
    console.log(
        `geändert   ${String(report.changes.length)} Verwendungen: ${String(lost.length)} fallen aus der Öffentlichkeit, ${String(gained.length)} werden öffentlich, ${String(report.changes.length - lost.length - gained.length)} nur mit anderem Grund`,
    );
    for (const change of report.changes.slice(0, 40)) {
        console.log(
            `  ${change.before.publicId} ${change.before.role} ${change.before.subjectName}: ${change.before.public ? "öffentlich" : "privat"} (${change.before.reason}) -> ${change.after.public ? "öffentlich" : "privat"} (${change.after.reason})`,
        );
    }
    for (const text of formatFindings(report.findings, 50)) console.log(text);
} finally {
    await database.end({ timeout: 5 });
}
