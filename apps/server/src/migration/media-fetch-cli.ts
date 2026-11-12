import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { meldeErgebnis } from "../abgleiche/protokoll.ts";
import { DownloadStore } from "./media-download.ts";
import { DEFAULT_FETCH_DELAY_MS, fetchMissingFiles, importFromUploadsCopy, legacyFileUrl } from "./media-fetch.ts";
import { parseMediaManifest } from "./media-manifest.ts";

/**
 * Holt die Dateien, die das Medien-Manifest nennt, ins Download-Fach (WI-0063 MEDIA-M9; Vertrag `media.yaml` →
 * `import_und_idempotenz`). 🔴 GEBAUT, NICHT AUSGEFÜHRT: ein Abruf geht an Legacy (STRATO Shared Hosting) und braucht den Zuruf des
 * Betreibers („zieh mal“). OHNE `--operator-said` rechnet das Werkzeug nur, WAS es holen würde (Adressen, die das Manifest nennt und
 * das Fach noch nicht kennt), und fragt nichts an.
 *
 * Geholt wird NUR, was das Manifest als lokale Legacy-Datei nennt (`/uploads/…`, ohne `?v=`) und das Fach noch nicht hat: nacheinander
 * mit Pause (Vorgabe 350 ms), ohne Wiederholung, ohne Weiterleitung, ohne Cookie und ohne Anmeldung; bei 429 oder 503 hört er auf.
 * `--refresh` fragt schon gelistete Adressen bedingt nach (`If-None-Match`, `If-Modified-Since`): eine unveränderte Datei kostet keine
 * Bytes, eine geänderte wird ersetzt (Legacys Dateien unter bestehenden Adressen sind nicht unveränderlich).
 *
 * `--from-uploads <ordner>` ersetzt den Abruf durch eine schreibgeschützte KOPIE von Legacys `uploads/`, die der Betreiber bereitstellt (der
 * bevorzugte Weg: kein Crawl, keine Last auf Legacy): Das Werkzeug liest nur, ohne Netz und ohne Zuruf, und nur unterhalb der Kopie.
 *
 * Die Bytes bleiben unverändert (`sha256/<2>/<2>/<hash>.<endung>`), dazu eine Liste `manifest-<Satz>.json` im selben Ordner; geprüft,
 * gerendert und abgelegt wird erst mit `migrate:media-files`.
 *
 * Beispiele:
 *   npm run legacy:media-fetch -- --private-file media-export-migration.json --download-dir C:\avesmaps3d-data\legacy-media
 *   npm run legacy:media-fetch -- --source media-export.json --operator-said "<Zitat des Betreibers>" --base-url https://avesmaps.de
 */
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        "private-file": { type: "string" },
        "download-dir": { type: "string", default: "C:\\avesmaps3d-data\\legacy-media" },
        "base-url": { type: "string", default: "https://avesmaps.de" },
        "operator-said": { type: "string" },
        // Ein Auftrag aus der Verwaltung („Abgleiche“, WI-0127 SYS-14) statt des Zurufs; schließt --operator-said aus.
        auftrag: { type: "string" },
        "from-uploads": { type: "string" },
        refresh: { type: "boolean", default: false },
        "delay-ms": { type: "string", default: String(DEFAULT_FETCH_DELAY_MS) },
    },
});

const manifestPath = values["private-file"] ?? values.source;
if (manifestPath === undefined) {
    console.error(
        'usage: (--source <media-export.json> | --private-file <media-export-migration.json>) [--download-dir <ordner>] [--base-url https://avesmaps.de] [--refresh] [--operator-said "<Zitat>"]',
    );
    process.exit(1);
}
const delayMs = Number(values["delay-ms"]);
if (!Number.isInteger(delayMs) || delayMs < 0) {
    console.error("--delay-ms braucht eine ganze Zahl ab 0");
    process.exit(1);
}

const parsed = parseMediaManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
if (parsed.manifest === null) {
    for (const finding of parsed.findings) console.error(`${finding.code}: ${finding.message}`);
    console.error("Das Manifest ist unbrauchbar: nichts zu holen.");
    process.exit(2);
}
const wanted = [
    ...new Set(parsed.manifest.items.flatMap((item) => (item.localUrl === null ? [] : [item.localUrl]))),
].sort();
const store = await DownloadStore.open(values["download-dir"]);
const missing = wanted.filter((url) => store.entryFor(url) === undefined);
// Zuruf (`--operator-said`) oder Auftrag aus der Verwaltung (`--auftrag`), nie beides (`abgleiche/freigabe.ts`).
const freigabe = freigabeOderEnde({ "operator-said": values["operator-said"], auftrag: values.auftrag });

console.log(
    `manifest   ${manifestPath}: ${String(parsed.manifest.items.length)} Einträge, ${String(wanted.length)} verschiedene lokale Dateien`,
);
console.log(
    `fach       ${values["download-dir"]}: ${String(store.size())} gelistete Adressen, ${String(missing.length)} fehlen${values.refresh ? "; --refresh fragt auch die übrigen bedingt nach" : ""}`,
);
// Eine schreibgeschützte Kopie von Legacys `uploads/`, vom Betreiber bereitgestellt: nur lesen, kein Netz, kein Zuruf nötig.
if (values["from-uploads"] !== undefined) {
    const copy = await importFromUploadsCopy(values.refresh ? wanted : missing, store, values["from-uploads"], {
        refresh: values.refresh,
    });
    const revision =
        parsed.manifest.mediaRevision === ""
            ? new Date().toISOString().replace(/[:.]/g, "-")
            : parsed.manifest.mediaRevision.replace(/[^A-Za-z0-9._-]/g, "-");
    const listing = await store.writeListing(`${revision}-kopie`, {
        zug: `Kopie von uploads/ (${values["from-uploads"]})`,
        basis: values["from-uploads"],
        fetchedAt: new Date().toISOString(),
    });
    console.log(
        `kopie      ${String(copy.copied)} übernommen (${(copy.bytes / 1048576).toFixed(1)} MiB), ${String(copy.alreadyPresent)} schon da, ${String(copy.missing.length)} fehlen in der Kopie, ${String(copy.refused.length)} abgewiesen`,
    );
    for (const url of copy.missing.slice(0, 20)) console.log(`  fehlt: ${url}`);
    for (const failure of copy.refused.slice(0, 20)) console.log(`  ${failure.url}: ${failure.reason}`);
    console.log(`liste      ${listing}`);
    process.exit(0);
}

const refused = wanted.filter((url) => legacyFileUrl(url, values["base-url"]) === null);
if (refused.length > 0)
    console.log(
        `abgewiesen ${String(refused.length)} Adressen (nicht auf der Basisadresse oder nicht https); erste: ${refused.slice(0, 3).join(", ")}`,
    );

if (!freigabe.apply) {
    console.log(
        "\nNUR GERECHNET - ohne --operator-said wird nichts abgerufen. Mit dem Zuruf des Betreibers holt der Lauf:",
    );
    for (const url of (values.refresh ? wanted : missing).slice(0, 10)) console.log(`  ${url}`);
    if ((values.refresh ? wanted : missing).length > 10)
        console.log(`  … und ${String((values.refresh ? wanted : missing).length - 10)} weitere`);
    process.exit(0);
}

console.log(freigabe.zeile);
const name =
    parsed.manifest.mediaRevision === ""
        ? new Date().toISOString().replace(/[:.]/g, "-")
        : parsed.manifest.mediaRevision.replace(/[^A-Za-z0-9._-]/g, "-");
const fetchedAt = new Date().toISOString();
const writeList = (): Promise<string> =>
    store.writeListing(name, { zug: freigabe.kurz ?? "", basis: values["base-url"], fetchedAt });
const report = await fetchMissingFiles(values.refresh ? wanted : missing, store, {
    baseUrl: values["base-url"],
    delayMs,
    refresh: values.refresh,
    onProgress: async (done, total) => {
        // Die Liste in Abständen schreiben: bricht der Lauf ab, geht nichts verloren, was schon auf der Platte liegt.
        if (done % 50 === 0 || done === total) await writeList();
    },
});
const listing = await writeList();
console.log(
    `abruf      ${String(report.fetched)} geholt (${(report.bytes / 1048576).toFixed(1)} MiB), ${String(report.notModified)} unverändert, ${String(report.alreadyPresent)} schon da, ${String(report.refused.length)} abgewiesen, ${String(report.failed.length)} gescheitert, in ${(report.durationMs / 1000).toFixed(0)} s`,
);
for (const failure of [...report.refused, ...report.failed].slice(0, 20))
    console.log(`  ${failure.url}: ${failure.reason}`);
if (report.aborted !== null) console.log(`ABGEBROCHEN ${report.aborted}`);
console.log(`liste      ${listing}`);
meldeErgebnis(freigabe.auftrag, {
    luecken: report.failed.length > 0 || report.aborted !== null ? ["dateien"] : [],
    befunde: report.failed.length + report.refused.length,
});
