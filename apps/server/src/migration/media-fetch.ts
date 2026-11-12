import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FORMAT_EXTENSION, sniffFormat } from "../media/raster/inspect.ts";
import type { DownloadStore } from "./media-download.ts";
import { legacyLocalPath } from "./media-manifest.ts";
import { plainFileUnder } from "./uploads-path.ts";

/**
 * Der Abruf der Legacy-Dateien ins Download-Fach (WI-0063 MEDIA-M9, Vertrag `media.yaml` → `import_und_idempotenz.nur_lokale_pfade`).
 * GEBAUT, NICHT AUSGEFÜHRT: ein Lauf braucht den Zuruf des Betreibers („zieh mal“; `--operator-said` der CLI).
 *
 * Die Regeln, damit es kein zweiter SSRF-Importpfad wird (Media-Core-Plan Abschnitt 11, STOP-Regeln 17 und 18):
 *   - Geholt wird nur, was das Manifest als lokale Legacy-Datei nennt: `/uploads/…` auf der Basisadresse, die der Betreiber nennt. Die
 *     Adresse wird aus Pfad und Basis zusammengesetzt und danach geprüft (gleicher Ursprung, gleicher Pfad); eine Weiterleitung wird
 *     NICHT verfolgt (sie wäre ein Weg zu einem fremden Ziel).
 *   - Nacheinander, mit Pause (Vorgabe 350 ms wie beim ersten Zug), ohne Wiederholung. Bei 429 oder 503 hört der Lauf auf: ein
 *     überlastetes Shared Hosting bekommt keine weiteren Anfragen. Der Zug hält nie an, er meldet.
 *   - Nur Adressen, die noch fehlen; mit `refresh` fragt er bedingt nach (`If-None-Match`, `If-Modified-Since`), eine unveränderte Datei
 *     kostet keine Bytes: Legacys Dateien unter bestehenden Adressen sind nicht unveränderlich (STOP-Regel 37).
 *   - Die Größe ist begrenzt (Vorgabe 24 MiB, das Doppelte von Legacys eigener Grenze von 12 MB): eine größere Antwort wird abgebrochen
 *     und nicht abgelegt. Die Bytes bleiben unverändert; geprüft und abgewiesen wird beim Binärimport (D2).
 *   - Kein Cookie, keine Anmeldung, kein Schlüssel: der Abruf ist anonym und öffentlich, wie ein Besucher ihn machen würde. Dateien aus
 *     Legacys privatem Bereich gibt es nicht; Export B (Admin) liefert nie Bytes.
 */

export interface FetchOptions {
    /** Die Basisadresse von Legacy, etwa `https://avesmaps.de`. */
    baseUrl: string;
    /** Pause zwischen zwei Abrufen in Millisekunden. */
    delayMs?: number;
    maxBytes?: number;
    /** Auch schon gelistete Adressen bedingt neu erfragen. */
    refresh?: boolean;
    /** Zeitgrenze je Abruf in Millisekunden. */
    timeoutMs?: number;
    /** Für Tests und die Pause; im Betrieb `fetch` und `setTimeout`. */
    fetchFn?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => Date;
    /** Wird nach jedem Abruf gerufen (der Aufrufer schreibt die Liste in Abständen). */
    onProgress?: (done: number, total: number) => void | Promise<void>;
}

export interface FetchFailure {
    url: string;
    reason: string;
}

export interface FetchReport {
    requested: number;
    fetched: number;
    notModified: number;
    alreadyPresent: number;
    refused: FetchFailure[];
    failed: FetchFailure[];
    bytes: number;
    /** Warum der Lauf vorzeitig aufgehört hat (429, 503), sonst `null`. */
    aborted: string | null;
    durationMs: number;
}

export const DEFAULT_FETCH_DELAY_MS = 350;
export const DEFAULT_FETCH_MAX_BYTES = 24 * 1024 * 1024;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Die Dateiendung der abgelegten Datei: aus den Bytes erkannt, sonst aus dem Typ der Antwort, sonst `bin`. */
function extensionOf(bytes: Uint8Array, contentType: string | null): string {
    const format = sniffFormat(bytes);
    if (format !== null) return FORMAT_EXTENSION[format];
    const type = contentType?.split(";")[0]?.trim().toLowerCase();
    switch (type) {
        case "image/png":
            return "png";
        case "image/jpeg":
            return "jpg";
        case "image/gif":
            return "gif";
        case "image/webp":
            return "webp";
        case "image/svg+xml":
            return "svg";
        default:
            return "bin";
    }
}

/** Den Rumpf lesen, aber nie mehr als `maxBytes`: darüber wird abgebrochen. */
async function readLimited(response: Response, maxBytes: number): Promise<Buffer | null> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel();
        return null;
    }
    if (response.body === null) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            return null;
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
}

export interface CopyReport {
    requested: number;
    copied: number;
    alreadyPresent: number;
    /** Adressen, zu denen die Kopie keine Datei hat. */
    missing: string[];
    refused: FetchFailure[];
    bytes: number;
}

/**
 * Nimmt die Dateien aus einer KOPIE von Legacys `uploads/` ins Download-Fach (Betreiber stellt sie bereit, bevorzugt gegenüber einem
 * Abruf: kein Crawl, keine Last auf Legacy; Legacy-Anfrage E5). Kein Netz und kein Zuruf nötig: es wird nur gelesen. Gelesen wird nur,
 * was das Manifest als lokale Datei nennt, und nur unterhalb der Kopie (`..`, absolute Pfade und Verknüpfungen führen nicht hinaus);
 * Größe und Art der Datei werden vor dem Lesen geprüft. Zeitpunkt und Last-Modified der Liste sind die der Datei in der Kopie.
 */
export async function importFromUploadsCopy(
    localUrls: readonly string[],
    store: DownloadStore,
    uploadsDirectory: string,
    options: { maxBytes?: number; refresh?: boolean } = {},
): Promise<CopyReport> {
    const maxBytes = options.maxBytes ?? DEFAULT_FETCH_MAX_BYTES;
    const root = resolve(uploadsDirectory);
    const wanted = [...new Set(localUrls)].sort();
    const report: CopyReport = {
        requested: wanted.length,
        copied: 0,
        alreadyPresent: 0,
        missing: [],
        refused: [],
        bytes: 0,
    };
    for (const localUrl of wanted) {
        const path = legacyLocalPath(localUrl);
        if (path === null) {
            report.refused.push({ url: localUrl, reason: "keine lokale Legacy-Datei" });
            continue;
        }
        if (store.entryFor(path) !== undefined && options.refresh !== true) {
            report.alreadyPresent += 1;
            continue;
        }
        // `/uploads/a/b.png` -> `<Kopie>/a/b.png`; ein Segment `..` hat legacyLocalPath schon abgewiesen, die Probe bleibt trotzdem
        // (dieselbe Probe wie beim Aufräumen des Fachs, geteilt in `uploads-path.ts`).
        const probe = await plainFileUnder(root, path.slice("/uploads/".length), maxBytes);
        if (probe.kind === "missing") {
            report.missing.push(path);
            continue;
        }
        if (probe.kind === "refused") {
            report.refused.push({ url: localUrl, reason: probe.reason });
            continue;
        }
        const bytes = await readFile(probe.file);
        await store.put(
            {
                url: path,
                status: 200,
                contentType: null,
                etag: null,
                lastModified: probe.mtime.toUTCString(),
                fetchedAt: probe.mtime.toISOString(),
            },
            bytes,
            extensionOf(bytes, null),
        );
        report.copied += 1;
        report.bytes += bytes.byteLength;
    }
    return report;
}

/**
 * Legacys Basisadresse, oder `null`, wenn sie keine ist: `https://…`, oder `http://` nur auf einem lokalen Entwicklungsrechner
 * (dort läuft im Test ein eigener Server). EINE Stelle, geteilt vom Abruf der Dateien und vom Abruf der Aufzählung (WI-0086).
 */
export function legacyBase(baseUrl: string): URL | null {
    let base: URL;
    try {
        base = new URL(baseUrl);
    } catch {
        return null;
    }
    if (base.protocol === "https:") return base;
    return base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ? base : null;
}

/**
 * Die vollständige Adresse eines Pfades auf Legacys Basisadresse, oder `null`, wenn Ursprung oder Pfad sich dabei ändern würden
 * (eine Kodierung, ein Doppelschrägstrich, ein Fragezeichen). Der Pfad muss schon geprüft sein.
 */
export function legacyPathUrl(path: string, baseUrl: string): URL | null {
    const base = legacyBase(baseUrl);
    if (base === null) return null;
    const url = new URL(path, base);
    return url.origin === base.origin && url.pathname === path ? url : null;
}

/** Die vollständige Adresse einer lokalen Legacy-Datei, oder `null`, wenn sie nicht auf Legacys Ursprung und unter `/uploads/` bleibt. */
export function legacyFileUrl(localUrl: string, baseUrl: string): URL | null {
    const path = legacyLocalPath(localUrl);
    return path === null ? null : legacyPathUrl(path, baseUrl);
}

export async function fetchMissingFiles(
    localUrls: readonly string[],
    store: DownloadStore,
    options: FetchOptions,
): Promise<FetchReport> {
    const started = Date.now();
    const fetchFn = options.fetchFn ?? fetch;
    const sleep = options.sleep ?? defaultSleep;
    const delayMs = options.delayMs ?? DEFAULT_FETCH_DELAY_MS;
    const maxBytes = options.maxBytes ?? DEFAULT_FETCH_MAX_BYTES;
    const now = options.now ?? (() => new Date());
    const report: FetchReport = {
        requested: 0,
        fetched: 0,
        notModified: 0,
        alreadyPresent: 0,
        refused: [],
        failed: [],
        bytes: 0,
        aborted: null,
        durationMs: 0,
    };

    const wanted = [...new Set(localUrls)].sort();
    report.requested = wanted.length;
    let done = 0;
    for (const localUrl of wanted) {
        done += 1;
        const url = legacyFileUrl(localUrl, options.baseUrl);
        if (url === null) {
            report.refused.push({ url: localUrl, reason: "keine lokale Legacy-Datei auf der Basisadresse" });
            continue;
        }
        const known = store.entryFor(localUrl);
        if (known !== undefined && options.refresh !== true) {
            report.alreadyPresent += 1;
            continue;
        }
        const headers: Record<string, string> = { accept: "image/*,*/*;q=0.1" };
        if (known?.etag) headers["if-none-match"] = known.etag;
        else if (known?.lastModified) headers["if-modified-since"] = known.lastModified;
        try {
            const response = await fetchFn(url, {
                headers,
                redirect: "manual",
                signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
            });
            if (response.status === 304 && known !== undefined) {
                report.notModified += 1;
            } else if (response.status === 429 || response.status === 503) {
                await response.body?.cancel();
                report.aborted = `HTTP ${String(response.status)} bei ${localUrl}: der Lauf hört auf (kein weiterer Abruf)`;
                break;
            } else if (response.status >= 300 && response.status < 400) {
                await response.body?.cancel();
                report.refused.push({
                    url: localUrl,
                    reason: `Weiterleitung (HTTP ${String(response.status)}) nicht verfolgt`,
                });
            } else if (response.status !== 200) {
                await response.body?.cancel();
                report.failed.push({ url: localUrl, reason: `HTTP ${String(response.status)}` });
            } else {
                const bytes = await readLimited(response, maxBytes);
                if (bytes === null) {
                    report.failed.push({
                        url: localUrl,
                        reason: `größer als ${String(maxBytes)} Bytes, nicht abgelegt`,
                    });
                } else if (bytes.byteLength === 0) {
                    report.failed.push({ url: localUrl, reason: "leere Antwort" });
                } else {
                    const contentType = response.headers.get("content-type");
                    await store.put(
                        {
                            url: localUrl,
                            status: 200,
                            contentType,
                            etag: response.headers.get("etag"),
                            lastModified: response.headers.get("last-modified"),
                            fetchedAt: now().toISOString(),
                        },
                        bytes,
                        extensionOf(bytes, contentType),
                    );
                    report.fetched += 1;
                    report.bytes += bytes.byteLength;
                }
            }
        } catch (error) {
            report.failed.push({ url: localUrl, reason: error instanceof Error ? error.message : String(error) });
        }
        await options.onProgress?.(done, wanted.length);
        if (done < wanted.length) await sleep(delayMs);
    }
    report.durationMs = Date.now() - started;
    return report;
}
