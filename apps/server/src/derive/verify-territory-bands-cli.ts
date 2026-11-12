import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import type { LegacyTerritoryPayload } from "../migration/territories.ts";
import { verifyLegacyBands, verifyOwnBands } from "../territories/verify-legacy-bands.ts";

/**
 * Nachweis je Band 0 bis 8 (WI-0209): Legacys Anzeigeregel, unabhängig nachgebaut, gegen unsere abgeleiteten Gebiete. Nur
 * lesend; meldet nur und endet mit 0 (keine Betreiberprüfung, `AGENTS.md` „Blockierende Prüfungen im Betrieb“), außer die
 * Datenbank oder die Datei fehlt.
 *
 *   N1, aus dem Export, aus dem importiert wurde:
 *   npm run verify:territory-bands -- --source C:\avesmaps3d-data\legacy-snapshots\aktuell\legacy-political-territories.json
 *   N2, aus unseren eigenen Tafeln (nach Änderungen im Editor):
 *   npm run verify:territory-bands -- --aus-datenbank
 *       [--bericht <datei.json>] [--zeigen 20]
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        "aus-datenbank": { type: "boolean", default: false },
        bericht: { type: "string" },
        zeigen: { type: "string", default: "20" },
    },
});
if (Boolean(values.source) === values["aus-datenbank"]) {
    console.error(
        "usage: --source <legacy-political-territories.json> | --aus-datenbank  [--bericht <datei.json>] [--zeigen <n>]",
    );
    process.exit(2);
}
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const payload = values.source ? (JSON.parse(readFileSync(values.source, "utf8")) as LegacyTerritoryPayload) : null;
const zeigen = Math.max(0, Number(values.zeigen) || 0);
const database = createDatabase(config.databaseUrl);
try {
    const report = payload ? await verifyLegacyBands(database, payload) : await verifyOwnBands(database);
    const regel = report.quelle === "export" ? "Legacy" : "Regel";
    console.warn(
        report.quelle === "export"
            ? `Quelle Export · Anzeigejahr ${String(report.yearBf)} · Export ${String(report.stamp.export)} · eingespielt ${String(report.stamp.imported)} · oberstes abgeleitetes Band ${String(report.derivedMaxBand)}`
            : `Quelle Datenbank (unsere Tafeln) · Anzeigejahr ${String(report.yearBf)} · eingespielt ${String(report.stamp.imported)} · oberstes abgeleitetes Band ${String(report.derivedMaxBand)}`,
    );
    if (report.quelle === "export" && report.stamp.export !== report.stamp.imported)
        console.warn("Befund  Export und eingespielter Stand sind verschieden: Abweichungen können am Stand liegen");
    console.warn(`Band  zeigt  ${regel.padStart(6)}  unsere  gleich  abweichend`);
    for (const b of report.bands) {
        const echte = b.differences.filter((d) => !d.why.startsWith("vom Import")).length;
        console.warn(
            `${String(b.band).padStart(4)}  ${String(b.oursFromBand).padStart(4)}  ${String(b.legacy).padStart(6)}  ${String(b.ours).padStart(6)}  ${String(b.same).padStart(6)}  ${String(echte).padStart(6)}${b.differences.length > echte ? ` (+${String(b.differences.length - echte)} vom Import übersprungen)` : ""}`,
        );
        for (const d of b.differences.filter((x) => !x.why.startsWith("vom Import")).slice(0, zeigen)) {
            console.warn(`        ${d.area}: ${regel} ${d.legacy ?? "–"}, unsere ${d.ours ?? "–"} (${d.why})`);
        }
    }
    const h = report.hierarchy;
    console.warn(
        report.quelle === "export"
            ? `Hierarchie: ${String(h.territories)} Gebiete, ${String(h.parentMismatches.length)} gespeicherte Eltern abweichend; ${String(h.shapesChecked)} Formen, ${String(h.effectiveMismatches.length)} mit anderem wirksamen Elter oder anderer Tiefe`
            : `Hierarchie: ${String(h.territories)} Gebiete; ${String(h.shapesChecked)} Formen, ${String(h.effectiveMismatches.length)} mit anderem wirksamen Elter oder anderer Tiefe`,
    );
    for (const line of [...h.parentMismatches, ...h.effectiveMismatches].slice(0, zeigen))
        console.warn(`        ${line}`);
    if (report.notInExport.areas || report.notInExport.territories)
        console.warn(
            `Befund  bei uns, nicht im Export: ${String(report.notInExport.areas)} Flächen, ${String(report.notInExport.territories)} Gebiete (außerhalb des Vergleichs)`,
        );
    if (report.skippedByImport.length)
        console.warn(
            `Befund  ${String(report.skippedByImport.length)} Flächen des Exports hat der Import übersprungen (leer oder entartet, ADR-0014 §6)`,
        );
    if (report.aboveDerived)
        console.warn(
            `Befund  ${String(report.aboveDerived)} Gebiete reichen über das oberste abgeleitete Band ${String(report.derivedMaxBand)} hinaus; die Karte zeigt sie dort erst nach einer Ableitung bis dahin (Übergangsregel WI-0188)`,
        );
    console.warn(
        report.passed
            ? `\nNachweis: ${regel} und unsere Ableitung stimmen in jedem Band überein`
            : "\nNachweis: Abweichungen (Befund, siehe oben)",
    );
    if (values.bericht) writeFileSync(values.bericht, JSON.stringify(report, null, 1));
} finally {
    await database.end({ timeout: 5 });
}
