import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase, WORKER_TIMEOUTS } from "../database.ts";
import { countClasses, GATE_CLASSES, type GateClass } from "./corpus-gate.ts";
import { changedParts, revisionKey } from "./revision.ts";
import {
    classifyRuns,
    GATE_FILES,
    loadGateFiles,
    openGateService,
    recordBaseline,
    runCases,
    type GateRow,
} from "./corpus-gate-run.ts";

/**
 * Das Routing-Gate über den vollen Korpus (siehe `corpus-gate.ts`): `npm run gate:routing-corpus`.
 *
 * Rechnet die 40 Fälle des Legacy-Korpus und die Ergänzungsfälle (Flug, Saison) gegen die lokale Datenbank
 * und vergleicht sie mit der Basislinie `route-gate-baseline.json`. Ausgabe: eine Tabelle je Fall und die Zahl je
 * Klasse. Der Exit-Code ist nur bei `REGRESSION` ungleich null.
 *
 * - `--only <Kennung,…>` rechnet nur diese Fälle (Teilzeichenfolge der Kennung genügt), `--subset` nur die schnelle
 *   Teilmenge der Testsuite.
 * - `--record` nimmt die Basislinie NEU auf, gegen den heutigen Datenstand. Nur bewusst aufrufen (nach einer
 *   gewollten Änderung des Routers oder der Daten, siehe AGENTS.md); sie schreibt alle Fälle, auch die, die
 *   keine Route finden oder deren Ort fehlt, und sagt das.
 *
 * Nur lesend gegen die Datenbank; nichts wird abgeleitet oder geändert.
 */

const { values } = parseArgs({
    options: {
        only: { type: "string" },
        subset: { type: "boolean", default: false },
        record: { type: "boolean", default: false },
        verbose: { type: "boolean", default: false },
    },
});

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(2);
}
const files = loadGateFiles();
let cases = files.cases;
if (values.subset) cases = cases.filter((one) => files.subset.includes(one.id));
if (values.only) {
    const wanted = values.only.split(",").map((part) => part.trim());
    cases = cases.filter((one) => wanted.some((part) => one.id.includes(part)));
}
if (values.record && cases.length !== files.cases.length) {
    console.error("--record nimmt immer alle Fälle auf; ohne --only und --subset aufrufen");
    process.exit(2);
}

const database = createDatabase(config.databaseUrl, { max: 2, timeouts: WORKER_TIMEOUTS });
const started = performance.now();
const gate = await openGateService(database);
const loadedMs = performance.now() - started;
const runs = await runCases(gate, cases);
await database.end({ timeout: 5 });
const totalMs = performance.now() - started;
const { revision } = gate.data;

const number = (value: number): string => (value === 0 ? "-" : value.toFixed(2));

if (values.record) {
    const baseline = recordBaseline(runs, revision, new Date().toISOString().slice(0, 10));
    writeFileSync(GATE_FILES.baseline, `${JSON.stringify(baseline, null, 2)}\n`);
    const odd = runs.filter((run) => run.result.outcome !== "route");
    console.log(`Basislinie aufgenommen: ${String(runs.length)} Fälle, Stand ${baseline.keys.routing_graph_revision}`);
    console.log(`  Karte ${baseline.keys.map_revision}, Gelände ${baseline.keys.terrain_revision ?? "-"}`);
    console.log(`  ohne Route oder nicht lösbar: ${String(odd.length)}`);
    for (const run of odd) console.log(`  ${run.case.id} ${run.case.label}: ${run.result.outcome}`);
    console.log(`Datei: ${GATE_FILES.baseline}`);
    process.exit(0);
}

if (!files.baseline) {
    console.error("Keine Basislinie: mit --record aufnehmen (siehe AGENTS.md)");
    process.exit(2);
}
const rows: GateRow[] = classifyRuns(runs, files.baseline, files.expected, revision);

const header = ["Fall", "Klasse", "Stunden Basis", "Stunden jetzt", "Distanz jetzt", "Etappen", "Hinweis"];
const table = rows.map((row) => [
    row.case.id,
    row.class,
    number(row.baseline?.travelHours ?? 0),
    number(row.result.travelHours),
    number(row.result.distanceUnits),
    String(row.result.stages),
    row.result.outcome === "route" ? row.note : `${row.result.outcome}${row.note ? ` (${row.note})` : ""}`,
]);
const widths = header.map((title, column) =>
    Math.max(title.length, ...table.map((line) => (line[column] ?? "").length)),
);
const line = (cells: string[]): string =>
    cells
        .map((cell, column) =>
            column >= 2 && column <= 5 ? cell.padStart(widths[column] ?? 0) : cell.padEnd(widths[column] ?? 0),
        )
        .join("  ");
console.log(line(header));
console.log(widths.map((width) => "-".repeat(width)).join("  "));
for (const cells of table) console.log(line(cells));

const counts = countClasses(rows.map((row) => row.class));
console.log("");
console.log(GATE_CLASSES.map((one: GateClass) => `${one} ${String(counts[one])}`).join("   "));
const moved = changedParts(files.baseline.revision, revision);
console.log(
    `Basislinie ${files.baseline.recorded} (Stand ${files.baseline.keys.routing_graph_revision}), jetzt Stand ${revisionKey(revision)}; Daten seit der Basislinie: ${moved.length === 0 ? "unverändert" : `geändert (${moved.join(", ")})`}`,
);
console.log(
    `${String(runs.length)} Fälle in ${(totalMs / 1000).toFixed(1)} s (Laden ${(loadedMs / 1000).toFixed(1)} s)`,
);

const unneeded = rows.filter((row) => row.class === "MATCH" && files.expected.some((one) => one.case === row.case.id));
for (const row of unneeded)
    console.log(
        `Hinweis: ${row.case.id} steht unter erwarteten Änderungen, gleicht aber der Basislinie: Eintrag entfernen`,
    );

const shown = rows.filter((row) => row.class === "REGRESSION" || (values.verbose && row.class !== "MATCH"));
for (const row of shown) {
    console.log(`\n${row.class} ${row.case.id} (${row.case.label})`);
    for (const difference of row.differences) console.log(`  ${difference}`);
    if (row.class === "REGRESSION") {
        console.log("  gewollt? Eintrag für route-gate-expected-changes.json:");
        console.log(
            JSON.stringify({ case: row.case.id, wi: "WI-????", reason: "…", result: row.result }, null, 2).replace(
                /^/gm,
                "  ",
            ),
        );
    }
}
if (counts.DATA_CHANGE > 0) {
    console.log(
        "\nDATA_CHANGE ist kein Codefehler: Die Daten haben sich seit der Basislinie geändert. Neu aufnehmen mit --record.",
    );
}
process.exit(counts.REGRESSION > 0 ? 1 : 0);
