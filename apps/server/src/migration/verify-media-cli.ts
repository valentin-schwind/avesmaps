import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { MediaStore } from "../media/storage.ts";
import { MEDIA_CLASSES } from "./media-legacy.ts";
import { mediaTotals, verifyMedia } from "./verify-media.ts";

/**
 * Paritätsprüfung der Medien: Manifest <-> Tafeln <-> Dateien (WI-0063 MEDIA-M8 bis M10, Vertrag `media.yaml` → `verifier`).
 *
 *   npm run verify:media -- --private-file <media-export-migration.json> [--source <media-export.json>] [--territories <political-territories.json>] [--media-root <ordner>] [--no-hash]
 *
 * Ohne Manifest laufen nur die Prüfungen, die keines brauchen (Rechte unabhängig gerechnet, Policy, Resolver, Dateien). Mit
 * `--media-root` (oder `MEDIA_ROOT`) auch die Prüfung der Dateien auf der Platte; `--no-hash` prüft dort nur Dasein und Größe.
 * Mit `--territories` (die Gebietsdatei E4) vergleicht er zusätzlich den Wappenzustand der Gebiete mit dem Manifest.
 *
 * Nur lesend. Endet mit Code 1 nur, wenn eine Prüfung aus `BLOCKING_CHECKS` ausfällt (Betreiber 2026-10-03: keine fremden Tore; die
 * Liste ist leer); alle anderen Ausfälle stehen als Befund darunter. Am Ende die Bilanz je Klasse: öffentlich, privat (mit Grund),
 * abgewiesen, noch pending.
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        "private-file": { type: "string" },
        territories: { type: "string" },
        "media-root": { type: "string" },
        "no-hash": { type: "boolean", default: false },
    },
});

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const read = async (path: string | undefined): Promise<unknown> =>
    path === undefined ? undefined : (JSON.parse(await readFile(path, "utf8")) as unknown);
const privatePayload = await read(values["private-file"]);
const publicPayload = await read(values.source);
const payload = privatePayload ?? publicPayload;
const mediaRoot = values["media-root"] ?? process.env["MEDIA_ROOT"];
const database = createDatabase(config.databaseUrl, { max: 4 });
try {
    const report = await verifyMedia(database, payload, {
        publicPayload: privatePayload === undefined ? undefined : publicPayload,
        territoriesPayload: await read(values.territories),
        store: mediaRoot === undefined || mediaRoot === "" ? undefined : new MediaStore(mediaRoot),
        hash: !values["no-hash"],
    });
    if (payload === undefined) console.warn("Kein Manifest angegeben: nur die Prüfungen ohne Manifest laufen.");
    if (report.manifestSkipped)
        console.warn("übersprungen: das Manifest ist unbrauchbar oder leer; nur die Prüfungen ohne Manifest liefen");
    if (mediaRoot === undefined || mediaRoot === "")
        console.warn("Keine Medienwurzel angegeben: die Prüfungen der Dateien auf der Platte entfallen.");
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(24)} ${entry.detail}`,
        );
        for (const offender of entry.offenders ?? []) console.warn(`        ${offender}`);
    }
    for (const text of formatFindings(report.findings, 20)) console.warn(text);

    console.warn("\nBilanz        Assets  öffentlich  privat  abgewiesen  pending   Gründe");
    for (const cls of MEDIA_CLASSES) {
        const row = report.summary[cls];
        console.warn(
            `${cls.padEnd(17)} ${String(row.assets).padStart(5)} ${String(row.public).padStart(11)} ${String(row.private).padStart(7)} ${String(row.rejected).padStart(11)} ${String(row.pending).padStart(8)}   ${Object.entries(
                row.reasons,
            )
                .map(([reason, n]) => `${reason} ${String(n)}`)
                .join(", ")}`,
        );
    }
    const total = mediaTotals(report.summary);
    console.warn(
        `${"gesamt".padEnd(17)} ${String(total.assets).padStart(5)} ${String(total.public).padStart(11)} ${String(total.private).padStart(7)} ${String(total.rejected).padStart(11)} ${String(total.pending).padStart(8)}   ${Object.entries(
            total.reasons,
        )
            .map(([reason, n]) => `${reason} ${String(n)}`)
            .join(", ")}`,
    );

    const befunde = befundSummary(report.checks, (entry) => entry.passed);
    if (befunde) console.warn(`\n${befunde}`);
    console.warn(report.passed ? "\nParitaet: bestanden" : "\nParitaet: GESCHEITERT");
    if (!report.passed) process.exit(1);
} finally {
    await database.end({ timeout: 5 });
}
