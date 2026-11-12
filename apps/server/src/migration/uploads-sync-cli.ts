import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { formatFinding } from "../findings.ts";
import { DownloadStore } from "./media-download.ts";
import { DEFAULT_FETCH_DELAY_MS } from "./media-fetch.ts";
import { parseUploadsList, UploadsSourceIncomplete, type UploadsList } from "./uploads-list.ts";
import {
    buildSyncReport,
    compareUploads,
    fetchPlanned,
    pruneOrphans,
    requestUploadsList,
    syncFindings,
    uploadsListUrl,
    UPLOADS_ETAG_FILE,
    type PruneReport,
    type UploadsPlan,
} from "./uploads-sync.ts";

/**
 * `npm run legacy:uploads-sync` — hält das Download-Fach mit Legacys `uploads/` gleichstandig (WI-0086).
 *
 * 🔴 GEBAUT, NICHT AUSGEFÜHRT. Der Listen-Export (`uploads-export.php`) existiert in Legacy noch nicht: Teil L wartet auf die
 * scope-genaue Freigabe des Betreibers. Ohne `--operator-said` geht KEINE Anfrage an Legacy hinaus - weder nach der Aufzählung
 * noch nach einer Datei; der Lauf sagt dann nur, was er täte.
 *
 * Der Ablauf (§5):
 *   1. die Aufzählung holen, bedingt über `X-Avesmaps-ETag`: ein 304 heißt „in uploads/ hat sich nichts geändert", und der Zug ist
 *      nach EINER Anfrage fertig;
 *   2. gegen die Liste des Fachs vergleichen - neu, geändert (Größe ODER Änderungszeit), verwaist;
 *   3. nur neu und geändert holen, nacheinander mit Pause, ohne Weiterleitung, ohne Cookie, bei 429 oder 503 Schluss;
 *   4. verbuchen, was WIRKLICH ankam (Größe, ETag, Last-Modified aus der Antwort, nie aus der Aufzählung);
 *   5. verwaiste melden; `--prune` löscht sie, über 5 % aber nicht;
 *   6. Bericht ins Fach.
 *
 * 🔴 Die Aufzählung ist eine QUELLE: `ok` nicht wahr, abgeschnitten, leer oder mit falscher Anzahl hält den Zug an
 * (`BLOCKING_SOURCE_CHECKS A24`, Exit 2). Jede andere Prüfung meldet nur.
 *
 * Beispiele:
 *   npm run legacy:uploads-sync
 *   npm run legacy:uploads-sync -- --operator-said "<Zitat des Betreibers>" --prune
 *   npm run legacy:uploads-sync -- --list-file uploads-export.json --download-dir C:\avesmaps3d-data\legacy-media
 */
const { values } = parseArgs({
    options: {
        "download-dir": { type: "string", default: "C:\\avesmaps3d-data\\legacy-media" },
        "base-url": { type: "string", default: "https://avesmaps.de" },
        "operator-said": { type: "string" },
        /** Eine schon gespeicherte Antwort statt des Abrufs (Rückfall wie `--territories-file`, `--media-file`). */
        "list-file": { type: "string" },
        prune: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        "delay-ms": { type: "string", default: String(DEFAULT_FETCH_DELAY_MS) },
    },
});

const downloadDir = values["download-dir"];
const baseUrl = values["base-url"];
const operatorSaid = values["operator-said"];
const listFile = values["list-file"];
const delayMs = Number(values["delay-ms"]);
if (!Number.isInteger(delayMs) || delayMs < 0) {
    console.error("--delay-ms braucht eine ganze Zahl ab 0");
    process.exit(1);
}
const listUrl = uploadsListUrl(baseUrl);
if (listUrl === null) {
    console.error(`--base-url ${baseUrl}: keine Legacy-Basisadresse (https, oder http nur lokal)`);
    process.exit(1);
}

const store = await DownloadStore.open(downloadDir);
const listedBefore = store.size();
const at = new Date().toISOString();
const etagPath = join(downloadDir, UPLOADS_ETAG_FILE);
const storedEtag = await readFile(etagPath, "utf8").then(
    (text) => text.trim(),
    () => "",
);

console.log(`fach       ${downloadDir}: ${String(listedBefore)} gelistete Adressen`);
console.log(`liste      ${listUrl.href}${storedEtag === "" ? "" : ` (bedingt, ETag ${storedEtag})`}`);

const writeReport = async (
    list: UploadsList | null,
    plan: UploadsPlan | null,
    fetched: Awaited<ReturnType<typeof fetchPlanned>> | null,
    prune: PruneReport | null,
    mode: "nur_gerechnet" | "geholt" | "gleichstandig",
): Promise<void> => {
    const findings = plan === null ? [] : syncFindings(plan, list as UploadsList, store, fetched, prune);
    for (const finding of findings) for (const line of formatFinding(finding, 20)) console.log(`BEFUND ${line}`);
    const stamp = at.replace(/[:.]/g, "-");
    const path = join(downloadDir, `uploads-sync-${stamp}.json`);
    const report = buildSyncReport({
        zug: operatorSaid ?? "(ohne Zuruf: nur gerechnet)",
        basis: baseUrl,
        at,
        list,
        plan,
        fetched,
        prune,
        listedBefore,
        findings,
        mode,
    });
    await writeFile(path, `${JSON.stringify(report, null, 1)}\n`, "utf8");
    console.log(`bericht    ${path}`);
};

// 🔴 Ohne Zuruf und ohne gespeicherte Antwort geht nichts hinaus - auch nicht die eine Anfrage nach der Aufzählung.
if (operatorSaid === undefined && listFile === undefined) {
    console.log(
        "\nNUR GERECHNET - ohne --operator-said wird nichts abgerufen, auch nicht die Aufzählung.\n" +
            `Mit dem Zuruf des Betreibers holt der Lauf EINE Aufzählung von ${listUrl.href} und daraus nur,\n` +
            `was das Fach noch nicht hat oder was sich in Größe oder Änderungszeit unterscheidet.\n` +
            `Eine gespeicherte Antwort geht auch ohne Zuruf: --list-file <datei>.`,
    );
    await writeReport(null, null, null, null, "nur_gerechnet");
    process.exit(0);
}

let payload: unknown;
let freshEtag: string | null = null;
if (listFile !== undefined) {
    console.log(`quelle     ${listFile} (gespeicherte Antwort, kein Abruf)`);
    payload = JSON.parse(await readFile(listFile, "utf8")) as unknown;
} else {
    console.log(`Freigabe (Betreiberzitat): „${operatorSaid as string}“`);
    const response = await requestUploadsList({ url: listUrl.href, storedEtag });
    if (response.kind === "not_modified") {
        console.log("liste      304: in uploads/ hat sich nichts geändert - der Zug ist nach einer Anfrage fertig");
        await writeReport(null, null, null, null, "gleichstandig");
        process.exit(0);
    }
    payload = JSON.parse(response.text) as unknown;
    freshEtag = response.etag;
}

let parsed;
try {
    parsed = parseUploadsList(payload);
} catch (error) {
    if (!(error instanceof UploadsSourceIncomplete)) throw error;
    // 🔴 Quellenprüfung A24: eine unvollständige Aufzählung sähe wie eine Massenlöschung aus.
    console.error(`\nABBRUCH (Quellenprüfung A24): ${error.message}`);
    for (const [key, value] of Object.entries(error.detail)) console.error(`  ${key}: ${String(value)}`);
    console.error("Es wurde nichts geholt und nichts gelöscht.");
    process.exit(2);
}

for (const finding of parsed.findings) for (const line of formatFinding(finding, 20)) console.log(`BEFUND ${line}`);
const list = parsed.list;
const plan = compareUploads(list, store);
console.log(
    `aufzaehlung ${String(list.declared.files)} Dateien, ${(list.declared.bytes / 1048576).toFixed(1)} MiB, Stempel ${list.revision === "" ? "(ohne)" : list.revision}`,
);
console.log(
    `vergleich  ${String(plan.fresh.length)} neu, ${String(plan.changed.length)} geändert, ${String(plan.unchanged.length)} gleichstandig, ${String(plan.orphaned.length)} verwaist`,
);
for (const change of plan.changed.slice(0, 10))
    console.log(
        `  geändert (${change.reason}) ${change.path}: verbucht ${String(change.known.bytes)} B / ${String(change.known.mtime ?? "?")}, aufgezählt ${String(change.listed.bytes)} B / ${String(change.listed.mtime)}`,
    );

const mayFetch = operatorSaid !== undefined && !values["dry-run"];
if (!mayFetch) {
    console.log(
        `\nNUR GERECHNET - ${values["dry-run"] ? "--dry-run" : "ohne --operator-said"}: es wird nichts geholt und nichts gelöscht. Zu holen wären:`,
    );
    for (const url of plan.wanted.slice(0, 10)) console.log(`  ${url}`);
    if (plan.wanted.length > 10) console.log(`  … und ${String(plan.wanted.length - 10)} weitere`);
    await writeReport(list, plan, null, null, "nur_gerechnet");
    process.exit(0);
}

const name = `uploads-${at.replace(/[:.]/g, "-")}`;
const writeList = (replacesOlderLists = false): Promise<string> =>
    store.writeListing(name, { zug: operatorSaid as string, basis: baseUrl, fetchedAt: at }, { replacesOlderLists });
const fetched = await fetchPlanned(plan, store, {
    baseUrl,
    delayMs,
    onProgress: async (done, total) => {
        // Die Liste in Abständen schreiben: bricht der Lauf ab, geht nichts verloren, was schon auf der Platte liegt.
        if (done % 50 === 0 || done === total) await writeList();
    },
});
console.log(
    `abruf      ${String(fetched.fetched)} geholt (${(fetched.bytes / 1048576).toFixed(1)} MiB), ${String(fetched.notModified)} unverändert, ${String(fetched.refused.length)} abgewiesen, ${String(fetched.failed.length)} gescheitert, in ${(fetched.durationMs / 1000).toFixed(0)} s`,
);
if (fetched.aborted !== null) console.log(`ABGEBROCHEN ${fetched.aborted}`);

let prune: PruneReport | null = null;
if (values.prune) {
    prune = await pruneOrphans(plan.orphaned, store, listedBefore);
    console.log(
        `aufraeumen ${String(prune.removed)} gelöscht (${(prune.bytes / 1048576).toFixed(1)} MiB), ${String(prune.entryOnly)} nur die Zeile (Bytes unter anderer Adresse), ${String(prune.refused.length)} abgewiesen${prune.withheld === null ? "" : ", ZURÜCKGEHALTEN (Quote)"}`,
    );
}
// Nach einem Aufräumen ist die neue Liste die ganze Wahrheit; sonst bleiben die älteren Listen stehen.
const listing = await writeList(prune !== null && prune.removed + prune.entryOnly > 0);
console.log(`liste      ${listing}`);

if (freshEtag !== null && freshEtag !== "") await writeFile(etagPath, `${freshEtag}\n`, "utf8");
else if (listFile === undefined) await rm(etagPath, { force: true });

await writeReport(list, plan, fetched, prune, "geholt");
