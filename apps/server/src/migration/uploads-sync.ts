import { createFinding, formatShare, type Finding } from "../findings.ts";
import type { DownloadStore, ListingEntry } from "./media-download.ts";
import { DEFAULT_FETCH_DELAY_MS, fetchMissingFiles, legacyPathUrl, type FetchReport } from "./media-fetch.ts";
import type { UploadsItem, UploadsList } from "./uploads-list.ts";

/**
 * Der Sync von Legacys `uploads/` ins vorhandene Download-Fach (WI-0086 §5).
 *
 * 🔴 **Nur lesen.** Gegen Legacy gibt es hier GENAU zwei Anfragen: ein GET auf die Aufzählung und je geänderter Datei ein GET auf
 * ihre Adresse (über `fetchMissingFiles`). Kein POST, kein PUT, kein DELETE, kein Formular, keine Anmeldung, kein Cookie. Ein
 * Wächtertest liest den Quelltext dieses Moduls und hält das fest (`uploads-sync.test.ts`).
 *
 * 🔴 **Kein neuer Speicher** (§3): Geschrieben wird in das Fach, das `migrate:media-files` schon liest. Der Sync fügt keinen Ort
 * hinzu, sondern eine Antwort auf die Frage, was zu holen ist.
 *
 * Die beiden Löcher, die er schließt (§1):
 *   - Ein unter derselben Adresse ERSETZTES Bild fällt heute durch (`legacy:media-fetch` überspringt jede gelistete Adresse).
 *     Die Aufzählung nennt Größe und Änderungszeit, der Vergleich sieht den Unterschied: ein GET statt 2.483.
 *   - Die Frischeprüfung war zu teuer, um sie zu machen. Jetzt kostet sie EINE Anfrage, und ein 304 beendet den Zug.
 *
 * 💣 **Verbucht wird, was WIRKLICH ankam.** Größe, ETag und `Last-Modified` stammen aus der ANTWORT (`store.put` in
 * `fetchMissingFiles`), nie aus der Aufzählung. Wird eine Datei zwischen Aufzählung und Abruf geschrieben, weicht die nächste
 * Aufzählung wieder ab und der Sync holt sie erneut; verbuchte man die Werte der Liste, wäre eine halb geschriebene Datei für
 * immer „aktuell".
 */

/** Der Kopf, in dem Legacys Exporte ihren Inhalts-ETag tragen (STRATO entfernt den echten `ETag` aus Antworten mit Rumpf). */
export const UPLOADS_ETAG_HEADER = "x-avesmaps-etag";

/** Legacys lesender Listen-Export, der elfte (WI-0086 §4, Teil L; existiert erst nach der Freigabe des Betreibers). */
export const UPLOADS_EXPORT_PATH = "/api/app/uploads-export.php";

/** Wo der Inhalts-ETag des letzten Zugs im Fach liegt (eine Textdatei, kein zweiter Speicher). */
export const UPLOADS_ETAG_FILE = "uploads-list.etag";

/** Die Adresse der Aufzählung auf der Basisadresse, oder `null`, wenn die Basis keine Legacy-Basis ist. */
export function uploadsListUrl(baseUrl: string): URL | null {
    return legacyPathUrl(UPLOADS_EXPORT_PATH, baseUrl);
}

/**
 * Ab dieser Quote verwaister Adressen räumt `--prune` NICHT auf, sondern meldet (wie `MAX_RETIRE_FRACTION` der Importer): Eine
 * Liste, die plötzlich fast leer ist, ist wahrscheinlich ein Ausfall und kein Aufräumen.
 */
export const MAX_PRUNE_FRACTION = 0.05;

/** Warum eine Adresse als geändert gilt. */
export type ChangeReason = "groesse" | "zeit" | "groesse_und_zeit";

export interface ChangedUpload {
    path: string;
    reason: ChangeReason;
    /** Was das Fach vom letzten Holen weiß, und was die Aufzählung sagt. */
    known: { bytes: number; mtime: number | null };
    listed: { bytes: number; mtime: number };
}

export interface UploadsPlan {
    /** Adressen, die das Fach nicht kennt. */
    fresh: string[];
    /** Adressen, deren Größe oder Änderungszeit abweicht. */
    changed: ChangedUpload[];
    /** Adressen, die gleichstandig sind: nichts zu tun. */
    unchanged: string[];
    /** Adressen, die das Fach kennt und Legacy nicht mehr nennt. */
    orphaned: string[];
    /**
     * Adressen, bei denen das Fach keine Änderungszeit hat (`Last-Modified` fehlte in der Antwort) und die Größe gleich ist: ein
     * Austausch mit gleicher Länge wäre hier unsichtbar. Befund, kein Tor.
     */
    undatable: string[];
    /** Was geholt werden soll: `fresh` und `changed`, sortiert. */
    wanted: string[];
}

/** Die Änderungszeit, die das Fach vom letzten Holen kennt, in Unix-Sekunden; `null`, wenn die Antwort keine nannte. */
export function knownMtime(entry: ListingEntry): number | null {
    if (entry.lastModified === null) return null;
    const parsed = Date.parse(entry.lastModified);
    // `Last-Modified` hat Sekundenauflösung, `stat` liefert Sekunden: beide Seiten werden auf Sekunden geschnitten.
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

/**
 * Vergleicht die Aufzählung mit der Liste des Fachs. Drei Mengen (§5.2): neu, geändert, verwaist — und als vierte die
 * gleichstandigen, damit der Bericht die Summe ausweist.
 */
export function compareUploads(list: UploadsList, store: DownloadStore): UploadsPlan {
    const plan: UploadsPlan = {
        fresh: [],
        changed: [],
        unchanged: [],
        orphaned: [],
        undatable: [],
        wanted: [],
    };
    const listed = new Set<string>();
    for (const item of list.items) {
        listed.add(item.path);
        const entry = store.entryFor(item.path);
        if (entry === undefined || entry.status !== 200) {
            plan.fresh.push(item.path);
            continue;
        }
        const change = changeOf(entry, item);
        if (change === null) {
            plan.unchanged.push(item.path);
            if (knownMtime(entry) === null) plan.undatable.push(item.path);
            continue;
        }
        plan.changed.push(change);
    }
    for (const url of store.urls()) if (!listed.has(url)) plan.orphaned.push(url);
    plan.fresh.sort();
    plan.changed.sort((a, b) => a.path.localeCompare(b.path));
    plan.unchanged.sort();
    plan.orphaned.sort();
    plan.undatable.sort();
    plan.wanted = [...plan.fresh, ...plan.changed.map((change) => change.path)].sort();
    return plan;
}

/** `null`, wenn die Adresse gleichstandig ist, sonst womit sie abweicht. */
function changeOf(entry: ListingEntry, item: UploadsItem): ChangedUpload | null {
    const mtime = knownMtime(entry);
    const sizeDiffers = entry.bytes !== item.bytes;
    const timeDiffers = mtime !== null && mtime !== item.mtime;
    if (!sizeDiffers && !timeDiffers) return null;
    return {
        path: item.path,
        reason: sizeDiffers && timeDiffers ? "groesse_und_zeit" : sizeDiffers ? "groesse" : "zeit",
        known: { bytes: entry.bytes, mtime },
        listed: { bytes: item.bytes, mtime: item.mtime },
    };
}

/** Was der Abruf der Aufzählung ergibt: derselbe Stand wie beim letzten Zug (304) oder ein frischer Rumpf. */
export type UploadsListResponse =
    { kind: "not_modified"; etag: string } | { kind: "fresh"; text: string; etag: string | null };

export interface ListRequestOptions {
    /** Die vollständige Adresse der Aufzählung, etwa `https://avesmaps.de/api/app/uploads-export.php`. */
    url: string;
    /** Der Inhalts-ETag des letzten Zugs; leer heißt unbedingt fragen. */
    storedEtag: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
}

/**
 * Holt die Aufzählung: EIN GET, bedingt über den Inhalts-ETag (`X-Avesmaps-ETag` als `If-None-Match`, wie bei den Gebieten).
 *
 * 🔴 Keine Schleife, keine Wiederholung. Es gibt bewusst keinen `data_changing`-Zweig: Der Export liest kein Datenbankfeld, also
 * gibt es keinen Stand, der sich unter dem Lesen bewegen kann (§4). Eine Datei, die sich bewegt, heilt §5.4.
 * Jede Antwort außer 200 und 304 ist ein technischer Abbruch, nie ein stiller Rückfall.
 */
export async function requestUploadsList(options: ListRequestOptions): Promise<UploadsListResponse> {
    const fetchFn = options.fetchFn ?? fetch;
    const response = await fetchFn(options.url, {
        headers: options.storedEtag === "" ? {} : { "if-none-match": options.storedEtag },
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    if (response.status === 304 && options.storedEtag !== "") {
        await response.body?.cancel();
        return { kind: "not_modified", etag: options.storedEtag };
    }
    if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(`${options.url}: HTTP ${String(response.status)}`);
    }
    return { kind: "fresh", text: await response.text(), etag: response.headers.get(UPLOADS_ETAG_HEADER) };
}

export interface PruneReport {
    /** Zeile und Datei weg. */
    removed: number;
    /** Nur die Zeile weg, weil dieselben Bytes unter einer anderen Adresse weiterleben (das Fach entdoppelt). */
    entryOnly: number;
    bytes: number;
    refused: { url: string; reason: string }[];
    /** Gesetzt, wenn die Quote das Aufräumen verhindert hat; dann ist nichts gelöscht. */
    withheld: Finding | null;
}

/**
 * Räumt die verwaisten Adressen im Fach auf — oder eben nicht (§5.5).
 *
 * 🔴 Über `MAX_PRUNE_FRACTION` wird NICHT gelöscht, sondern befundet. `listedBefore` ist, was das Fach vor dem Zug kannte.
 */
export async function pruneOrphans(
    orphaned: readonly string[],
    store: DownloadStore,
    listedBefore: number,
): Promise<PruneReport> {
    const report: PruneReport = { removed: 0, entryOnly: 0, bytes: 0, refused: [], withheld: null };
    if (orphaned.length === 0) return report;
    const share = listedBefore === 0 ? 0 : orphaned.length / listedBefore;
    if (share > MAX_PRUNE_FRACTION) {
        report.withheld = createFinding(
            "uploads_prune_quote",
            `${String(orphaned.length)} von ${String(listedBefore)} Adressen des Fachs (${formatShare(share)}) nennt Legacy nicht mehr, mehr als ${formatShare(MAX_PRUNE_FRACTION)}; --prune hat NICHTS gelöscht (eine fast leere Liste ist wahrscheinlich ein Ausfall)`,
            { verwaist: orphaned.length, gelistet: listedBefore, quote: formatShare(share) },
            [],
            orphaned.length,
            orphaned.slice(0, 50),
        );
        return report;
    }
    for (const url of orphaned) {
        const result = await store.remove(url);
        if (result.kind === "removed") {
            report.removed += 1;
            report.bytes += result.bytes;
        } else if (result.kind === "entry_only") {
            report.entryOnly += 1;
        } else if (result.kind === "refused") {
            report.refused.push({ url, reason: result.reason });
        }
    }
    return report;
}

/**
 * Die Befunde eines Zugs (§5.5 und §5.4): verwaiste Adressen, Antworten, die nicht zur Aufzählung passen, abgewiesene Adressen,
 * fehlende Änderungszeiten. 🔴 Alles meldet nur; angehalten hat allenfalls die Quellenprüfung A24, und die war vorher.
 */
export function syncFindings(
    plan: UploadsPlan,
    list: UploadsList,
    store: DownloadStore,
    fetched: FetchReport | null,
    prune: PruneReport | null,
): Finding[] {
    const findings: Finding[] = [];
    if (plan.orphaned.length > 0 && (prune === null || prune.withheld !== null)) {
        findings.push(
            createFinding(
                "uploads_verwaist",
                `${String(plan.orphaned.length)} Adresse(n) kennt das Fach, Legacy nennt sie nicht mehr; nicht gelöscht (mit --prune werden sie gelöscht)`,
                { verwaist: plan.orphaned.length },
                [],
                plan.orphaned.length,
                plan.orphaned.slice(0, 50),
            ),
        );
    }
    if (prune?.withheld) findings.push(prune.withheld);
    if (prune !== null && prune.refused.length > 0) {
        findings.push(
            createFinding(
                "uploads_prune_abgewiesen",
                `${String(prune.refused.length)} verwaiste Datei(en) wurden nicht gelöscht, weil der Ablageort keine einfache Datei unterhalb des Fachs ist`,
                { abgewiesen: prune.refused.length },
                [],
                prune.refused.length,
                prune.refused.map((entry) => `${entry.url}: ${entry.reason}`).slice(0, 20),
            ),
        );
    }
    if (plan.undatable.length > 0) {
        findings.push(
            createFinding(
                "uploads_ohne_zeitstempel",
                `${String(plan.undatable.length)} Adresse(n) hat das Fach ohne Last-Modified verbucht; bei gleicher Größe bliebe ein Austausch dort unsichtbar (der nächste Abruf verbucht die Zeit)`,
                { ohne_zeit: plan.undatable.length },
                [],
                plan.undatable.length,
                plan.undatable.slice(0, 20),
            ),
        );
    }
    if (fetched !== null) {
        const listedBytes = new Map(list.items.map((item) => [item.path, item.bytes]));
        const drift: string[] = [];
        for (const url of plan.wanted) {
            const entry = store.entryFor(url);
            const listed = listedBytes.get(url);
            if (entry === undefined || listed === undefined || entry.bytes === listed) continue;
            drift.push(`${url}: ${String(entry.bytes)} Bytes geholt, ${String(listed)} aufgezählt`);
        }
        if (drift.length > 0) {
            findings.push(
                createFinding(
                    "uploads_antwort_weicht_ab",
                    `${String(drift.length)} Antwort(en) hatten eine andere Länge als die Aufzählung (die Datei wurde zwischen Aufzählung und Abruf geschrieben); verbucht ist, was ankam`,
                    { abweichend: drift.length },
                    [],
                    drift.length,
                    drift.slice(0, 20),
                ),
            );
        }
        if (fetched.refused.length > 0) {
            findings.push(
                createFinding(
                    "uploads_adresse_abgewiesen",
                    `${String(fetched.refused.length)} Adresse(n) wurden abgewiesen (nicht unter /uploads/ auf der Basisadresse, oder eine Weiterleitung)`,
                    { abgewiesen: fetched.refused.length },
                    [],
                    fetched.refused.length,
                    fetched.refused.map((entry) => `${entry.url}: ${entry.reason}`).slice(0, 20),
                ),
            );
        }
        if (fetched.failed.length > 0) {
            findings.push(
                createFinding(
                    "uploads_abruf_gescheitert",
                    `${String(fetched.failed.length)} Abruf(e) sind gescheitert; die übrigen wurden geholt`,
                    { gescheitert: fetched.failed.length },
                    [],
                    fetched.failed.length,
                    fetched.failed.map((entry) => `${entry.url}: ${entry.reason}`).slice(0, 20),
                ),
            );
        }
        if (fetched.aborted !== null) {
            findings.push(
                createFinding(
                    "uploads_abruf_abgebrochen",
                    `der Abruf hat vorzeitig aufgehört: ${fetched.aborted}`,
                    {},
                    [],
                    0,
                    [],
                ),
            );
        }
    }
    return findings;
}

export interface SyncOptions {
    baseUrl: string;
    delayMs?: number;
    maxBytes?: number;
    fetchFn?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => Date;
    onProgress?: (done: number, total: number) => void | Promise<void>;
}

/**
 * Holt, was der Plan als neu oder geändert ausweist: `refresh` ist WAHR, damit eine schon gelistete Adresse bedingt gefragt wird
 * (ein unveränderter ETag kostet dann keine Bytes) und eine neue Adresse ohne Bedingung.
 */
export function fetchPlanned(plan: UploadsPlan, store: DownloadStore, options: SyncOptions): Promise<FetchReport> {
    return fetchMissingFiles(plan.wanted, store, {
        baseUrl: options.baseUrl,
        delayMs: options.delayMs ?? DEFAULT_FETCH_DELAY_MS,
        ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
        refresh: true,
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    });
}

/** Die Bytes einer Menge von Adressen nach der Aufzählung (für den Bericht). */
export function bytesOf(list: UploadsList, paths: readonly string[]): number {
    const bytes = new Map(list.items.map((item) => [item.path, item.bytes]));
    return paths.reduce((total, path) => total + (bytes.get(path) ?? 0), 0);
}

export interface SyncReportInput {
    zug: string;
    basis: string;
    at: string;
    list: UploadsList | null;
    /** `null` bei 304: in `uploads/` hat sich nichts geändert. */
    plan: UploadsPlan | null;
    fetched: FetchReport | null;
    prune: PruneReport | null;
    listedBefore: number;
    findings: readonly Finding[];
    /** Was das Werkzeug wirklich getan hat. */
    mode: "nur_gerechnet" | "geholt" | "gleichstandig";
}

/**
 * Der Bericht des Zugs, in der Form der Liste `manifest-<satz>.json`: deutsche Schlüssel, sortiert, reproduzierbar. Er landet im
 * Fach, nicht im Repository (die Adressen sind Legacys Daten).
 */
export function buildSyncReport(input: SyncReportInput): Record<string, unknown> {
    const list = input.list;
    const plan = input.plan;
    return {
        zug: input.zug,
        werkzeug: "legacy:uploads-sync",
        stand: input.mode,
        abgerufen_am: input.at,
        basis: input.basis,
        uploads_revision: list?.revision ?? null,
        aufzaehlung: list === null ? null : { dateien: list.declared.files, bytes: list.declared.bytes },
        fach_vorher: input.listedBefore,
        mengen:
            plan === null
                ? null
                : {
                      neu: { anzahl: plan.fresh.length, bytes: list === null ? 0 : bytesOf(list, plan.fresh) },
                      geaendert: {
                          anzahl: plan.changed.length,
                          bytes:
                              list === null
                                  ? 0
                                  : bytesOf(
                                        list,
                                        plan.changed.map((change) => change.path),
                                    ),
                      },
                      gleichstandig: { anzahl: plan.unchanged.length },
                      verwaist: { anzahl: plan.orphaned.length, adressen: plan.orphaned },
                  },
        geaendert_warum:
            plan === null
                ? null
                : plan.changed.map((change) => ({
                      url: change.path,
                      grund: change.reason,
                      verbucht: change.known,
                      aufgezaehlt: change.listed,
                  })),
        abruf:
            input.fetched === null
                ? null
                : {
                      angefragt: input.fetched.requested,
                      geholt: input.fetched.fetched,
                      unveraendert: input.fetched.notModified,
                      bytes: input.fetched.bytes,
                      abgewiesen: input.fetched.refused.length,
                      gescheitert: input.fetched.failed.length,
                      abgebrochen: input.fetched.aborted,
                      dauer_ms: input.fetched.durationMs,
                  },
        aufraeumen:
            input.prune === null
                ? null
                : {
                      geloescht: input.prune.removed,
                      nur_zeile: input.prune.entryOnly,
                      bytes: input.prune.bytes,
                      abgewiesen: input.prune.refused.length,
                      zurueckgehalten: input.prune.withheld !== null,
                  },
        befunde: input.findings.map((finding) => ({
            code: finding.code,
            message: finding.message,
            numbers: finding.numbers,
            anzahl: finding.objectCount,
            zeilen: finding.notes,
        })),
    };
}
