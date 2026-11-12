/**
 * Die Zollzählung gegen zwei Implementierungen, als Tabelle je Reise (WI-0065 U6): `npm run compare:tolls`.
 *
 *   npm run compare:tolls                                  Korpus: die Fälle des Routing-Gates und 196 gezogene Reisen (Seed 65)
 *   npm run compare:tolls -- --only "Gareth > Fasar"       nur Reisen, deren Bezeichnung das enthält (mehrere mit Komma)
 *   npm run compare:tolls -- --seed 7                      andere gezogene Reisen
 *   npm run compare:tolls -- --outliers 5                  die fünf Reisen mit den meisten Grenzen, mit der Zahl bei 3/5/8/10 Meilen (Abnahme Z2)
 *   npm run compare:tolls -- --summary                     ohne Tabelle
 *   npm run compare:tolls -- --fetch                       vorher `git fetch` im Discovery-Mirror (der Drift-Wächter liest dann den neuesten Stand)
 *
 * Drei Rechenwege (Einzelheiten und Toleranz in `apps/server/test/support/toll-oracle.ts`):
 *
 * - **A** unsere Zählung (`countBorderCrossings`), auf den Gebieten, die der Routing-Worker lädt;
 * - **B1** Legacys Code, unverändert im `vm`-Kontext (nur aus dem Discovery-Mirror, nie aus dem Legacy-Repository);
 * - **B2** die exakte Rechnung in PostGIS, mit eigener Zusammenfassung.
 *
 * A muss bei JEDER Reise B1 gleichen (ein Port); A gegen B2 darf nur bei einem Lauf um eine Abtastung von der Schwelle
 * abweichen (`Grenzfall`), und höchstens bei 3 % des Korpus. Dazu der DRIFT-Wächter: Hat Legacy die Zählung am
 * Mirror-`master` seit dem festgehaltenen Stand geändert, meldet die CLI es. Exit 1 bei einem Befund oder Drift.
 *
 * Nur lesend gegen die Datenbank (`DATABASE_URL`); nichts wird abgeleitet oder geändert.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { AVENTURIA } from "@avesmaps3d/shared";
import { loadConfig } from "../../apps/server/src/config.ts";
import { createDatabase, WORKER_TIMEOUTS } from "../../apps/server/src/database.ts";
import { openGateService } from "../../apps/server/src/routing/corpus-gate-run.ts";
import { partKey } from "../../apps/server/src/routing/revision.ts";
import {
    BORDER_RULE,
    DEFAULT_SEED,
    ExactBorders,
    MILES_PER_UNIT,
    checkRootSet,
    countsAtThreshold,
    describeDeviation,
    deviates,
    drawnTrips,
    gateTrips,
    legacyTerritories,
    loadOracleRoots,
    maxDeviations,
    measureTrip,
    routeTrips,
    summarizeRows,
    type OracleContext,
    type OracleRow,
    type OracleTrip,
    type Timing,
} from "../../apps/server/test/support/toll-oracle.ts";
import {
    LEGACY_BLOB,
    LEGACY_MIRROR,
    checkLegacyDrift,
    loadLegacyBorders,
    readPinnedLegacySource,
} from "./legacy-route-costs.ts";

const { values } = parseArgs({
    options: {
        only: { type: "string" },
        seed: { type: "string", default: String(DEFAULT_SEED) },
        outliers: { type: "string" },
        summary: { type: "boolean", default: false },
        fetch: { type: "boolean", default: false },
        mirror: { type: "string", default: LEGACY_MIRROR },
    },
});

const out = (text = ""): void => {
    process.stdout.write(`${text}\n`);
};

const seed = Number.parseInt(values.seed, 10);
const outliers = values.outliers === undefined ? 0 : Number.parseInt(values.outliers, 10);
if (!Number.isInteger(seed) || !Number.isInteger(outliers) || outliers < 0) {
    process.stderr.write("--seed und --outliers erwarten ganze Zahlen\n");
    process.exit(2);
}
const config = loadConfig();
if (!config.databaseUrl) {
    process.stderr.write("DATABASE_URL ist nicht gesetzt\n");
    process.exit(2);
}

/* Der Drift-Wächter: Legacys Zählung am Mirror-master gegen den festgehaltenen Stand. */
if (values.fetch && existsSync(values.mirror)) {
    process.stderr.write(`git fetch im Mirror ${values.mirror} ...\n`);
    execFileSync("git", ["--git-dir", values.mirror, "fetch", "--quiet"], { stdio: "inherit" });
}
const drift = checkLegacyDrift(values.mirror);
const source = readPinnedLegacySource(values.mirror);
const code = source === null ? null : loadLegacyBorders(source, MILES_PER_UNIT);

const database = createDatabase(config.databaseUrl, { max: 2, timeouts: WORKER_TIMEOUTS });
const started = performance.now();
const gate = await openGateService(database);
const loadedMs = performance.now() - started;
const tolls = gate.data.territories;
if (!tolls || tolls.territories.length === 0) {
    process.stderr.write(
        "keine abgeleiteten Gebiete in der Datenbank (npm run derive:territories): nichts zu vergleichen\n",
    );
    await database.end({ timeout: 5 });
    process.exit(2);
}

const roots = await loadOracleRoots(database, AVENTURIA.mapDomain);
const context: OracleContext = {
    territories: tolls.territories,
    yearBf: tolls.yearBf,
    roots,
    legacy: code === null ? null : { code, territories: legacyTerritories(code, roots) },
    exact: new ExactBorders(database, AVENTURIA.mapDomain, roots),
};

const fromGate = gateTrips(gate);
let trips: OracleTrip[] = [...fromGate.trips, ...(await drawnTrips(database, seed))];
if (values.only) {
    const wanted = values.only.split(",").map((part) => part.trim().toLowerCase());
    trips = trips.filter((trip) => wanted.some((part) => trip.label.toLowerCase().includes(part)));
}
const routed = await routeTrips(gate, trips);
const rows: OracleRow[] = [];
for (const one of routed) {
    if (one.response !== null) rows.push(await measureTrip(context, one));
}
const finding = await checkRootSet(database, AVENTURIA.mapDomain, roots);
await database.end({ timeout: 5 });
const totalMs = performance.now() - started;

/* Ausgabe */
const pad = (cells: string[], widths: number[], right: number[]): string =>
    cells
        .map((cell, column) =>
            right.includes(column) ? cell.padStart(widths[column] ?? 0) : cell.padEnd(widths[column] ?? 0),
        )
        .join("  ");

function table(header: string[], body: string[][], right: number[]): void {
    const widths = header.map((title, column) =>
        Math.max(title.length, ...body.map((line) => (line[column] ?? "").length)),
    );
    out(pad(header, widths, right));
    out(widths.map((width) => "-".repeat(width)).join("  "));
    for (const line of body) out(pad(line, widths, right));
}

const short = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const ms = (value: number | null): string => (value === null ? "-" : value.toFixed(1));
const timing = (one: Timing | null): string =>
    one === null
        ? "-"
        : `Median ${one.median.toFixed(1)} ms, p95 ${one.p95.toFixed(1)} ms, größte ${one.max.toFixed(1)} ms, gesamt ${(one.total / 1000).toFixed(2)} s`;

out(`Zollzählung: A (unsere Zählung) gegen B1 (Legacys Code, unverändert) und B2 (exakt in PostGIS)`);
out(
    `Stand: Karte ${partKey(gate.data.revision.map) ?? "-"}, Gebiete ${partKey(gate.data.revision.territories) ?? "-"} (Anzeigejahr ${String(tolls.yearBf)} BF, ${String(tolls.territories.length)} Zollgebiete), Schwelle ${String(BORDER_RULE.mindestLaufMeilen)} Meilen, ${String(MILES_PER_UNIT)} Meilen je Einheit`,
);
out(
    `Legacy: ${
        code === null
            ? `Mirror ${values.mirror} NICHT lesbar - B1 entfällt`
            : `Blob ${LEGACY_BLOB.slice(0, 9)} aus dem Mirror ausgeführt; Mirror-master ${drift.masterCommit?.slice(0, 9) ?? "?"}: ${drift.state.toUpperCase()} (${drift.detail})`
    }`,
);
out();

if (!values.summary) {
    const body = rows.map((row) => {
        const flag = deviates(row)
            ? row.borderRoad === null
                ? "ja"
                : "Grenzweg"
            : row.borderline.length > 0
              ? "nahe"
              : "-";
        const near = row.borderline.map((run) => run.miles.toFixed(2)).join("/");
        return [
            short(row.trip.label, 62),
            String(row.a?.count ?? "?"),
            row.b1 === null ? "-" : String(row.b1),
            String(row.b2.count),
            deviates(row) ? String((row.a?.count ?? 0) - row.b2.count) : "0",
            flag === "-" ? "-" : `${flag} (${near} mi)`,
            ms(row.aMs),
            ms(row.b1Ms),
            ms(row.b2Ms),
            row.problems.length > 0 ? "PROBLEM" : "",
        ];
    });
    table(["Reise", "A", "B1", "B2", "A-B2", "Grenzfall", "A ms", "B1 ms", "B2 ms", ""], body, [1, 2, 3, 4, 6, 7, 8]);
    out();
}

const summary = summarizeRows(rows);
const allowed = maxDeviations(summary.trips);
out(
    `${String(summary.trips)} Reisen gerechnet (${String(routed.length - rows.length)} ohne Ergebnis: Flug, keine Route, abgelehnt), ${String(summary.crossings)} Grenzen, meiste ${String(summary.most?.a?.count ?? 0)} (${summary.most?.trip.label ?? "-"})`,
);
out(
    `A = B1:  ${String(summary.aEqualsB1)} von ${String(summary.b1Compared)}${summary.b1Compared === 0 ? " (ohne Mirror nicht geprüft)" : ""}`,
);
out(
    `A = B2:  ${String(summary.aEqualsB2)} von ${String(summary.trips)}; Grenzfälle ${String(summary.counted.length)} (erlaubt ${String(allowed)}, 3 % des Korpus), dazu auf Wegen entlang einer Grenze ${String(summary.borderRoads.length)} (Befund); Reisen mit einem Lauf nahe der Schwelle ${String(summary.nearRoutes)}`,
);
for (const row of summary.counted) out(`  Grenzfall: ${describeDeviation(row)}`);
for (const row of summary.borderRoads) out(`  Grenzfall, Befund: ${describeDeviation(row)}`);
out(`Zählzeit A:  ${timing(summary.timesMs.a)}`);
out(`Zählzeit B1: ${timing(summary.timesMs.b1)}`);
out(`Rechenzeit B2 (PostGIS, mit Abfrage): ${timing(summary.timesMs.b2)}`);
out(`Laden des Datenstands ${(loadedMs / 1000).toFixed(1)} s, gesamt ${(totalMs / 1000).toFixed(1)} s`);
out(
    `Zollgebiete: ${String(finding.band0)} Wurzeln im Band 0, ${String(finding.nominal)} Herrschaftsgebiete ohne Elternteil mit Fläche; wirksam souverän, aber nicht im Band 0 (zählen nicht, wie Legacy): ${finding.effectiveOutsideBand0.join(", ") || "keine"}`,
);
if (fromGate.skipped.length > 0) out(`Fälle des Gates ohne Kosten: ${fromGate.skipped.join("; ")}`);

if (outliers > 0) {
    out();
    out(
        `Die ${String(outliers)} Reisen mit den meisten Grenzen - Zahl der Grenzen je Schwelle (Meilen im Nachbarreich), A/B2 wo sie sich unterscheiden`,
    );
    const thresholds = [3, 5, 8, 10];
    const ranked = [...rows].sort((a, b) => (b.a?.count ?? 0) - (a.a?.count ?? 0) || b.miles - a.miles);
    // Gleichstand am Ende der Liste gehört dazu: Sonst entschiede die Länge der Reise, wer als fünfte dasteht.
    const cut = ranked[outliers - 1]?.a?.count ?? 0;
    const worst = ranked.filter((row, index) => index < outliers || (row.a?.count ?? 0) === cut);
    const body = worst.map((row) => [
        short(row.trip.label, 62),
        `${row.miles.toFixed(0)} mi`,
        ...thresholds.map((threshold) => {
            const counts = countsAtThreshold(context, row, threshold);
            return counts.a === counts.b2 ? String(counts.a) : `${String(counts.a)}/${String(counts.b2)}`;
        }),
    ]);
    table(["Reise", "Länge", ...thresholds.map((threshold) => `${String(threshold)} mi`)], body, [1, 2, 3, 4, 5]);
    if (worst.length > outliers)
        out(`(${String(worst.length - outliers)} weitere mit ebenso vielen Grenzen wie die letzte, siehe Tabelle)`);
}

let failed = false;
if (summary.problems.length > 0) {
    failed = true;
    out();
    out("BEFUNDE:");
    for (const { trip, problem } of summary.problems) out(`  ${trip}: ${problem}`);
}
if (summary.counted.length > allowed) {
    failed = true;
    out(
        `\nZu viele Grenzfälle: ${String(summary.counted.length)} von ${String(summary.trips)} (erlaubt ${String(allowed)}; ohne die ${String(summary.borderRoads.length)} auf Wegen entlang einer Grenze).`,
    );
}
if (finding.onlyBand0.length > 0 || finding.onlyNominal.length > 0) {
    failed = true;
    out(
        `\nDie Zollgebiete weichen von den Herrschaftsgebieten ohne Elternteil ab: nur Band 0 ${finding.onlyBand0.join(", ") || "-"}; nur nominell ${finding.onlyNominal.join(", ") || "-"}.`,
    );
}
if (drift.state === "drifted") {
    failed = true;
    out(
        `\nDRIFT: Legacy hat die Zählung der Landesgrenzen geändert (${drift.detail}). Port (packages/shared/src/travel-borders.ts), Blob in scripts/dev/legacy-route-costs.ts und WI-0065 prüfen.`,
    );
}
process.exit(failed ? 1 : 0);
