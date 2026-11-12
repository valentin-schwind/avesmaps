import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { freigabeOderEnde } from "../abgleiche/freigabe.ts";
import { meldeErgebnis } from "../abgleiche/protokoll.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { MediaStore } from "../media/storage.ts";
import { DownloadStore } from "./media-download.ts";
import { importMediaFiles } from "./media-files.ts";
import { MEDIA_CLASSES, isMediaClass, type MediaClass } from "./media-legacy.ts";

/**
 * Der Binärimport der Legacy-Medien (WI-0063 MEDIA-M9 und M10, Vertrag `media.yaml`, `umsetzung_m8_m10`): je Asset, das
 * `migrate:media` angelegt hat, die Datei aus dem Download-Fach prüfen, in das Profil seiner Rolle rendern und unter `MEDIA_ROOT`
 * ablegen (privates Original unter `private/source`, öffentliches WebP unter `published/` nur nach der Entscheidung der Policy),
 * danach `media_file` und `technical_state` schreiben.
 *
 * Er braucht kein Manifest: die Klasse und die Adresse der Datei stehen schon an `media_legacy_source`. Das Download-Fach
 * (`--download-dir`, Vorgabe `C:\avesmaps3d-data\legacy-media`) füllt `legacy:media-fetch` oder der Betreiber mit einer Kopie von
 * `uploads/`; dieses Werkzeug ruft NIE etwas ab. Liegt kein Fach vor (leerer Ordner), rechnet er aus den schon abgelegten Originalen
 * neu (Rezeptänderung, neue Freigabe, widerrufene Regel).
 *
 * 🔴 Wie `migrate:media`: nur mit dem Zuruf des Betreibers für genau diese Datenbank (`--operator-said`). OHNE ihn (oder mit
 * `--dry-run`) prüft und rendert er in einen Wegwerfordner und schreibt weder Zeilen noch Dateien in die Medienwurzel.
 * Abgewiesen wird nur nach den Grenzen des Betreibers (D2: 6 MiB, 512 KiB SVG, 16 MP, 8192 px; D4: SVG ohne Text) und aus
 * technischen Gründen; alles andere ist ein Befund. Dateien einer Klasse mit Beschränkung: `--class <name>`, `--limit <n>`.
 *
 * `MEDIA_ROOT` kommt aus `--media-root` oder der Umgebung; eine Medienwurzel eines anderen Rechners (Staging, Production) ist nie
 * dieselbe wie die lokale: getrennte Umgebungen.
 *
 * Beispiele:
 *   npm run migrate:media-files -- --media-root C:\avesmaps3d-data\media-probe
 *   npm run migrate:media-files -- --media-root <ordner> --download-dir <ordner> --operator-said "<Zitat des Betreibers>"
 */
const { values } = parseArgs({
    options: {
        "download-dir": { type: "string", default: "C:\\avesmaps3d-data\\legacy-media" },
        "media-root": { type: "string" },
        class: { type: "string", multiple: true },
        limit: { type: "string" },
        "operator-said": { type: "string" },
        // Ein Auftrag aus der Verwaltung („Abgleiche“, WI-0127 SYS-14) statt des Zurufs; schließt --operator-said aus.
        auftrag: { type: "string" },
        "dry-run": { type: "boolean", default: false },
    },
});

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
const classes: MediaClass[] = [];
for (const name of values.class ?? []) {
    if (!isMediaClass(name)) {
        console.error(`unbekannte Klasse ${name}; erlaubt: ${MEDIA_CLASSES.join(", ")}`);
        process.exit(1);
    }
    classes.push(name);
}
// Zuruf (`--operator-said`) oder Auftrag aus der Verwaltung (`--auftrag`), nie beides (`abgleiche/freigabe.ts`).
const freigabe = freigabeOderEnde({ "operator-said": values["operator-said"], auftrag: values.auftrag });
const dryRun = values["dry-run"] || !freigabe.apply;
const mediaRoot = values["media-root"] ?? process.env["MEDIA_ROOT"];
if (!dryRun && (mediaRoot === undefined || mediaRoot === "" || !isAbsolute(mediaRoot))) {
    console.error("MEDIA_ROOT fehlt oder ist nicht absolut (--media-root <ordner> oder die Umgebungsvariable)");
    process.exit(1);
}
const limit = values.limit === undefined ? undefined : Number(values.limit);
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    console.error("--limit braucht eine ganze Zahl ab 1");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl, { max: 4 });
const started = Date.now();
// Der Probelauf rendert in einen Wegwerfordner: so fallen Dekodierfehler auf, ohne dass etwas in die Medienwurzel gelangt.
const scratch = dryRun ? await mkdtemp(join(tmpdir(), "avesmaps3d-media-probe-")) : null;

try {
    if (freigabe.zeile !== null) console.log(freigabe.zeile);
    if (dryRun) {
        console.log(
            !freigabe.apply
                ? "PROBELAUF - ohne --operator-said wird weder in die Datenbank noch in die Medienwurzel geschrieben\n"
                : "PROBELAUF (--dry-run) - nichts geschrieben\n",
        );
    }
    const downloads = await DownloadStore.open(values["download-dir"]);
    console.log(`download   ${values["download-dir"]}: ${String(downloads.size())} gelistete Adressen`);
    const store = new MediaStore(scratch ?? (mediaRoot as string));
    console.log(`medien     ${scratch === null ? store.root : `${store.root} (Wegwerf)`}`);
    let lastShown = 0;
    const report = await importMediaFiles(database, {
        store,
        downloads,
        classes: classes.length > 0 ? classes : undefined,
        limit,
        dryRun,
        onProgress: (done, total) => {
            if (done - lastShown >= 100 || done === total) {
                lastShown = done;
                console.log(`  ${String(done)} von ${String(total)}`);
            }
        },
    });
    console.log(`run        ${report.runId}${report.dryRun ? " (nichts geschrieben)" : ""}`);
    console.log(
        `assets     ${String(report.assets)} geprüft: ${String(report.ingested)} neu verarbeitet, ${String(report.unchanged)} schon auf dem Stand, ${String(report.held)} vom Notaus gehalten, ${String(report.missing)} ohne Datei, ${String(Object.values(report.rejected).reduce((sum, n) => sum + n, 0))} abgewiesen, ${String(report.notRechecked)} nicht neu beurteilt (keine Quelle)`,
    );
    console.log(
        `öffentlich ${String(report.published)} mit WebP unter published/, ${String(report.privateOnly)} nur privat; ${String(report.unpublished)} öffentliche Dateien weggenommen (Entscheidung gedreht)`,
    );
    if (Object.keys(report.rejected).length > 0) {
        console.log(
            `abgewiesen ${Object.entries(report.rejected)
                .map(([code, n]) => `${code} ${String(n)}`)
                .join(", ")}`,
        );
    }
    console.log(
        `klasse              Assets   ok  unverändert  abgewiesen  ohne Datei  öffentlich      Original-Bytes   WebP-Bytes`,
    );
    for (const cls of MEDIA_CLASSES) {
        const row = report.byClass[cls];
        console.log(
            `${cls.padEnd(19)} ${String(row.assets).padStart(6)} ${String(row.ok).padStart(4)} ${String(row.unchanged).padStart(12)} ${String(row.rejected).padStart(11)} ${String(row.missing).padStart(11)} ${String(row.published).padStart(11)} ${String(row.sourceBytes).padStart(16)} ${String(row.publishedBytes).padStart(12)}`,
        );
    }
    console.log(
        `bytes      ${String(report.bytesSource)} Original (${(report.bytesSource / 1048576).toFixed(1)} MiB) -> ${String(report.bytesPublished)} WebP (${(report.bytesPublished / 1048576).toFixed(1)} MiB); ${String(report.filesWritten)} Dateien geschrieben, ${String(report.filesDeduplicated)} schon mit denselben Bytes da`,
    );
    for (const text of formatFindings(report.findings, 20)) {
        console.log(text);
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const peak = (process.resourceUsage().maxRSS / 1024).toFixed(0);
    console.log(
        `laufzeit   ${seconds} s (Verarbeitung ${(report.durationMs / 1000).toFixed(1)} s), Spitzen-RSS ${peak} MB`,
    );
    console.log(report.changed ? "geändert   ja" : "geändert   nein (nichts zu schreiben)");
    // Eine Lücke ist hier nichts: abgewiesen nach D2 und D4 ist eine Entscheidung, „ohne Datei“ zählt der Abruf davor.
    meldeErgebnis(freigabe.auftrag, { luecken: [], befunde: report.findings.length });
} finally {
    await database.end({ timeout: 5 });
    if (scratch !== null) await rm(scratch, { recursive: true, force: true });
}
