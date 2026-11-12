import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { verifyWikiLinkTargets } from "./verify-wiki-link-targets.ts";

/**
 * Paritätsprüfung der Zuordnungstafel (X2) und der Linkziele (X1) gegen dieselben Antwortdateien, aus denen importiert wurde (WI-0063 27.12).
 *
 *   npm run verify:wiki-links -- --zuordnung <wiki-zuordnung.json> --linkziele <wiki-linkziele.json>
 *
 * Nur lesend. Endet mit Code 1 nur, wenn eine Prüfung aus `BLOCKING_CHECKS` ausfällt (Betreiber 2026-10-03: keine fremden Tore; die Liste ist leer);
 * alle anderen Ausfälle und der Abgleich mit den eigenen Zuweisungen stehen als Befund darunter.
 */
const { values } = parseArgs({ options: { linkziele: { type: "string" }, zuordnung: { type: "string" } } });

if (!values.linkziele && !values.zuordnung) {
    console.error("usage: --zuordnung <wiki-zuordnung.json> --linkziele <wiki-linkziele.json>");
    process.exit(1);
}

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const read = async (path: string | undefined): Promise<unknown> =>
    path === undefined ? null : (JSON.parse(await readFile(path, "utf8")) as unknown);
const input = { linkziele: await read(values.linkziele), zuordnung: await read(values.zuordnung) };
const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyWikiLinkTargets(database, input);
    if (report.skipped) {
        console.warn("übersprungen: beide Antworten fehlen, sind unbrauchbar oder leer; nichts zu prüfen");
    }
    for (const entry of report.checks) {
        console.warn(
            `${checkWord(entry.passed, entry.blocking !== false, "OK  ")}  ${entry.name.padEnd(18)} ${entry.detail}`,
        );
        for (const offender of entry.offenders ?? []) {
            console.warn(`        ${offender}`);
        }
    }
    for (const text of formatFindings(report.findings, 20)) {
        console.warn(text);
    }
    const befunde = befundSummary(report.checks, (entry) => entry.passed);
    if (befunde) console.warn(`\n${befunde}`);
    console.warn(report.passed ? "\nParitaet: bestanden" : "\nParitaet: GESCHEITERT");
    if (!report.passed) {
        process.exit(1);
    }
} finally {
    await database.end({ timeout: 5 });
}
