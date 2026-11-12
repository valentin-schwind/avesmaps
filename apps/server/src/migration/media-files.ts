import { randomUUID } from "node:crypto";
import type { Database } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import type { ClearanceState, CreationMethod, ModerationState, RightsBasis } from "../media/policy.ts";
import { readPublicationRules } from "../media/rules.ts";
import { RasterRejection } from "../media/raster/inspect.ts";
import { ingestImage, internVariante, type IngestedFile } from "../media/raster/ingest.ts";
import { RASTER_LIMITS } from "../media/raster/limits.ts";
import { profileForRole } from "../media/raster/profiles.ts";
import { recipeVersion } from "../media/raster/render.ts";
import { MediaStorageError, sha256Of, type MediaStore } from "../media/storage.ts";
import type { DownloadStore, ListingEntry } from "./media-download.ts";
import {
    CLASS_ROLE,
    MEDIA_CLASSES,
    MEDIA_CONTRACT_VERSION,
    MEDIA_SOURCE_SYSTEM,
    type MediaClass,
} from "./media-legacy.ts";
import { quarantaeneAktiv, zieheQuarantaeneNach, type QuarantaeneErgebnis } from "../media/quarantine.ts";
import { assetPublishes, readUsages, type UsageRow } from "./media-publication.ts";

/**
 * Der Binärimport der Legacy-Medien (WI-0063 MEDIA-M9 und M10, Vertrag `media.yaml` → `umsetzung_m8_m10`): je Asset, das der
 * Metadatenimport (`media-import.ts`) angelegt hat, die Datei aus dem Download-Fach prüfen, rendern und ablegen, danach die Zeilen
 * `media_file` schreiben und `technical_state` setzen.
 *
 * Reihenfolge je Datei (Vertrag `speicher.atomizitaet`): Bytes lesen, SHA-256 gegen die Liste, Vorprüfung, Rendern in das Profil der
 * Rolle, das private Original unter `private/source`, das öffentliche Derivat unter `published/` (nur wenn die Entscheidung der
 * Policy JA sagt), DANN die Datenbank. Eine Referenz auf fehlende Bytes entsteht nie; ein unreferenzierter Hash ist aufräumbar.
 *
 * 🔴 SYNCHRON in diesem Prozess (Entscheidung, begründet in `media.yaml` → `umsetzung_m8_m10.verarbeitung`): derselbe Code wie die Jobart
 * `media_derive` (`ingestImage`), aber ohne Warteschlange. Der Import ist ein eigener Node-Prozess wie jede `migrate:*`- und
 * `derive:*`-Stufe, nie der Fastify-Prozess; `sharp.concurrency(1)`, ein Bild nach dem anderen (rund 100 bis 120 MB Spitze, bei
 * `map_full` bis 480 MB).
 *
 * 🔴 Abgewiesen wird nur nach den Grenzen des Betreibers (D2: 6 MiB, 512 KiB SVG, 16 MP, 8192 px; D4: SVG ohne Text) und aus
 * technischen Gründen (kein Bild, beschädigt, Mehrbilder, SVG mit Skript oder Fremdverweis). Alles andere ist ein Befund. Ein defektes
 * Einzelasset verschluckt den Bericht nicht und hält den Lauf nicht an.
 * 🔴 Das Veröffentlichen folgt allein `media/policy.ts`: `publish` ist die Entscheidung, nie eine eigene Liste. Hat sich die
 * Entscheidung gedreht (Regel widerrufen, Einzelsperre), nimmt der Lauf die öffentliche Datei wieder weg; das Original bleibt.
 * 🔴 Schutzregel (Betreiber 2026-10-10: „nur die entscheidung darf nicht nachträglich kompromittiert werden“, WI-0068 P4a): Gilt für die
 * Bytes eines Assets ein Notaus (`media_publication_suspension`), rührt der Lauf das Asset nicht an: kein Lesen, kein neues Original,
 * keine öffentliche Datei, keine Rückkehr aus der Quarantäne. Er meldet es als Befund `suspended_held`.
 * 🔴 Ebenso eine Datei in Quarantäne (WI-0127 SYS-10 b3, `media_quarantine`): Der Lauf legt sie nicht zurück und nicht neu an (Befund
 * `quarantine_held`), und am Ende zieht er die Quarantäne der Inhaltsschalter nach, damit eine neue Datei einer ausgeschalteten Art nicht
 * unter `published/` stehen bleibt.
 */

export interface MediaFilesOptions {
    store: MediaStore;
    downloads: DownloadStore;
    /** Nur diese Klassen (Vorgabe: alle). */
    classes?: readonly MediaClass[] | undefined;
    /** Höchstens so viele Assets (für Proben). */
    limit?: number | undefined;
    /** Prüfen und Rendern, aber keine Zeile schreiben (die CLI gibt dann einen Wegwerf-Speicher). */
    dryRun?: boolean | undefined;
    onProgress?: ((done: number, total: number) => void) | undefined;
}

export interface ClassFileCounts {
    assets: number;
    ok: number;
    unchanged: number;
    rejected: number;
    missing: number;
    published: number;
    sourceBytes: number;
    publishedBytes: number;
}

export interface MediaFilesReport {
    runId: string;
    dryRun: boolean;
    assets: number;
    /** Schon auf dem Stand (Quelle, Rezept und Entscheidung gleich): nichts gelesen, nichts gerechnet. */
    unchanged: number;
    /** Ein Notaus gilt für die Bytes: stehen gelassen, nichts gelesen, nichts geschrieben (Befund `suspended_held`). */
    held: number;
    /** In diesem Lauf geprüft, gerendert und abgelegt. */
    ingested: number;
    /** Danach mit öffentlicher Datei / nur mit privatem Original. */
    published: number;
    privateOnly: number;
    /** Öffentliche Dateien, die wegfielen, weil die Entscheidung der Policy jetzt NEIN sagt. */
    unpublished: number;
    /** Assets, deren `technical_state` sich in diesem Lauf änderte (abgewiesen, ohne Datei). */
    stateChanged: number;
    /** Früher abgewiesen, Quelle diesmal nicht vorhanden: nicht neu beurteilt. */
    notRechecked: number;
    /** Abgewiesen, je Code. */
    rejected: Record<string, number>;
    missing: number;
    hashMismatch: number;
    byClass: Record<MediaClass, ClassFileCounts>;
    bytesSource: number;
    bytesPublished: number;
    /** Dateien, die ein Lauf neu auf die Platte schrieb, und solche, die mit denselben Bytes schon dalagen. */
    filesWritten: number;
    filesDeduplicated: number;
    durationMs: number;
    changed: boolean;
    findings: Finding[];
    /** Der Nachzug der Quarantäne am Ende (WI-0127 SYS-10 b3); fehlt, wenn nichts zu tun war oder im Probelauf. */
    quarantine?: QuarantaeneErgebnis;
}

interface AssetRow {
    id: string;
    publicId: string;
    key: string;
    technicalState: string;
    moderationState: ModerationState;
    creationMethod: CreationMethod;
    mediaClass: MediaClass;
    localUrl: string;
    basis: RightsBasis | null;
    clearance: ClearanceState | null;
    licenseKey: string | null;
    requiresAttribution: boolean | null;
    fetchedEtag: string | null;
    fetchedLastModified: string | null;
}

interface FileRow {
    id: string;
    assetId: string;
    variant: string;
    storageClass: string;
    storageKey: string;
    sha256: string;
    recipeVersion: string | null;
    /** Nur an `private_source` eines Wappens (T2b): Ecken durchsichtig; `null`: noch nicht gemessen. */
    cornersTransparent: boolean | null;
    /** Nur an `private_source`: der Wahrnehmungs-Hash (WI-0068 D2); `null`: noch nicht gerechnet. */
    perceptualHash: string | null;
}

const emptyClass = (): ClassFileCounts => ({
    assets: 0,
    ok: 0,
    unchanged: 0,
    rejected: 0,
    missing: 0,
    published: 0,
    sourceBytes: 0,
    publishedBytes: 0,
});

class Findings {
    private readonly entries = new Map<string, { message: string; objects: FindingObject[] }>();

    add(code: string, message: string, asset: AssetRow, detail?: string): void {
        const entry = this.entries.get(code) ?? { message, objects: [] };
        entry.objects.push({
            table: "media_asset",
            publicId: asset.publicId,
            name: detail === undefined ? asset.key : `${asset.key} (${detail})`,
        });
        this.entries.set(code, entry);
    }

    toFindings(): Finding[] {
        return [...this.entries.entries()].map(([code, entry]) =>
            createFinding(code, entry.message, { eintraege: entry.objects.length }, entry.objects),
        );
    }
}

/**
 * Wie viel der Medienzug aus Legacy je Datei liest: die Rastergrenze der Betreiber-Entscheidung D2 (6 MiB, größer als jede SVG-Grenze). 🔴 Nicht `MAX_SOURCE_BYTES`:
 * Seit WI-0275 (e8cb6bf68) schließt es das PDF der Kartensammlung (50 MiB) ein, das es in Legacy nicht gibt; eine zu große Datei wird sonst erst gelesen und dann abgewiesen
 * statt vorher ohne Lesen.
 */
const MAX_LEGACY_BYTES = RASTER_LIMITS.maxRasterBytes;

const REJECTION_MESSAGES: Readonly<Record<string, string>> = {
    empty_file: "leere Datei (decode_failed)",
    unsupported_format: "kein PNG, JPEG, GIF, WebP oder SVG (unsupported_format)",
    too_large_bytes: "über der Bytegrenze des Betreibers (D2: 6 MiB, 512 KiB bei SVG)",
    too_many_pixels: "über der Pixelgrenze des Betreibers (D2: 16 MP)",
    too_large_dimensions: "über der Kantengrenze des Betreibers (D2: 8192 px)",
    animated_or_multiframe:
        "mehrbildig (animated_or_multiframe): nicht verarbeitet, das erste Bild nur nach Entscheidung",
    bad_header: "beschädigter Dateikopf (decode_failed)",
    svg_invalid: "kein lesbares SVG (decode_failed)",
    svg_has_text: "SVG mit Text (D4: die Pipeline rendert keinen Text)",
    svg_forbidden_content: "SVG mit Skript, DTD, Entität oder Fremdverweis (svg_forbidden_content)",
    decode_failed: "nicht vollständig dekodierbar (decode_failed)",
};

export async function importMediaFiles(database: Database, options: MediaFilesOptions): Promise<MediaFilesReport> {
    const started = Date.now();
    const runId = randomUUID();
    const dryRun = options.dryRun === true;
    const wantedClasses = new Set<MediaClass>(options.classes ?? MEDIA_CLASSES);
    const findings = new Findings();
    const report: MediaFilesReport = {
        runId,
        dryRun,
        assets: 0,
        unchanged: 0,
        held: 0,
        ingested: 0,
        published: 0,
        privateOnly: 0,
        unpublished: 0,
        stateChanged: 0,
        notRechecked: 0,
        rejected: {},
        missing: 0,
        hashMismatch: 0,
        byClass: Object.fromEntries(MEDIA_CLASSES.map((name) => [name, emptyClass()])) as Record<
            MediaClass,
            ClassFileCounts
        >,
        bytesSource: 0,
        bytesPublished: 0,
        filesWritten: 0,
        filesDeduplicated: 0,
        durationMs: 0,
        changed: false,
        findings: [],
    };

    const assets = await database<AssetRow[]>`
        SELECT a.id::text AS id, a.public_id::text AS "publicId", a.source_ref AS key, a.technical_state AS "technicalState",
               a.moderation_state AS "moderationState", a.creation_method AS "creationMethod",
               s.media_class AS "mediaClass", s.local_url AS "localUrl",
               r.rights_basis AS basis, r.clearance_state AS clearance, r.license_key AS "licenseKey",
               l.requires_attribution AS "requiresAttribution", s.file_etag AS "fetchedEtag", s.file_last_modified AS "fetchedLastModified"
        FROM media_asset a
        JOIN media_legacy_source s ON s.media_asset_id = a.id
        LEFT JOIN media_rights r ON r.media_asset_id = a.id
        LEFT JOIN license_catalog l ON l.key = r.license_key
        WHERE a.source_system = ${MEDIA_SOURCE_SYSTEM}
        ORDER BY a.id
    `;
    const rules = await readPublicationRules(database);
    const usages = await readUsages(database);
    const usagesByAsset = new Map<string, UsageRow[]>();
    for (const usage of usages) usagesByAsset.set(usage.assetId, [...(usagesByAsset.get(usage.assetId) ?? []), usage]);
    const files = await database<FileRow[]>`
        SELECT f.id::text AS id, f.media_asset_id::text AS "assetId", f.variant, f.storage_class AS "storageClass",
               f.storage_key AS "storageKey", f.sha256, f.recipe_version AS "recipeVersion",
               f.corners_transparent AS "cornersTransparent", f.perceptual_hash AS "perceptualHash"
        FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id WHERE a.source_system = ${MEDIA_SOURCE_SYSTEM}
    `;
    const filesByAsset = new Map<string, FileRow[]>();
    for (const file of files) filesByAsset.set(file.assetId, [...(filesByAsset.get(file.assetId) ?? []), file]);
    const suspended = await suspendedSources(database);
    const quarantaene = await quarantaeneAktiv(database);

    const queue = assets
        .filter((asset) => wantedClasses.has(asset.mediaClass))
        .slice(0, options.limit ?? Number.MAX_SAFE_INTEGER);
    report.assets = queue.length;
    let done = 0;

    for (const asset of queue) {
        done += 1;
        options.onProgress?.(done, queue.length);
        const counts = report.byClass[asset.mediaClass];
        counts.assets += 1;
        const role = CLASS_ROLE[asset.mediaClass];
        const profile = profileForRole(role);
        const recipe = recipeVersion(profile);
        const own = filesByAsset.get(asset.id) ?? [];
        const sourceRow = own.find((file) => file.storageClass === "private_source");
        const publishedRows = own.filter((file) => file.storageClass === "published");
        // Die private Vorschau (WI-0068 P4b): gehört zum Stand, solange das Bild privat bleibt; ein zweiter Lauf legt sie für den Bestand an.
        const internRows = own.filter(
            (file) => file.storageClass === "derivative" && file.variant.startsWith("intern_"),
        );
        // Ein Notaus hält die Bytes: weder neue Bytes aus Legacy noch eine Entscheidung der Policy holen das Bild zurück.
        if (sourceRow !== undefined && suspended.has(sourceRow.sha256)) {
            report.held += 1;
            findings.add(
                "suspended_held",
                "Assets, deren Bytes ein Notaus hält: der Lauf lässt Original, öffentliche Datei und Quarantäne stehen",
                asset,
            );
            continue;
        }
        // Eine öffentliche Datei in Quarantäne bleibt dort; sie folgt allein dem Quarantäne-Abgleich (WI-0127 SYS-10 b3).
        if (publishedRows.some((file) => quarantaene.has(file.sha256))) {
            report.held += 1;
            findings.add(
                "quarantine_held",
                "Assets, deren öffentliche Datei in Quarantäne liegt: der Lauf lässt Original und Datei stehen",
                asset,
            );
            continue;
        }
        const listing: ListingEntry | undefined = options.downloads.entryFor(asset.localUrl);
        // Die Entscheidung der Policy, als wäre die Datei schon technisch in Ordnung und als WebP da (hypothetisch: vor dem Schreiben).
        const publish = assetPublishes(
            {
                technicalState: "ok",
                moderationState: asset.moderationState,
                creationMethod: asset.creationMethod,
                basis: asset.basis,
                clearance: asset.clearance,
                licenseKey: asset.licenseKey,
                requiresAttribution: asset.requiresAttribution,
            },
            role,
            usagesByAsset.get(asset.id) ?? [],
            { mimeType: "image/webp" },
            rules,
            true,
        ).allowed;

        // Schon auf dem Stand? Dann wird nichts gelesen und nichts gerechnet (zweiter Lauf).
        // Ein Wappen ohne Messung der Ecken (T2b) ist nicht auf dem Stand: Der Lauf misst den Bestand einmal nach.
        const sourceCurrent =
            sourceRow !== undefined &&
            (listing === undefined || sourceRow.sha256 === listing.sha256) &&
            (role !== "coat" || sourceRow.cornersTransparent !== null);
        const publishedCurrent = publish
            ? publishedRows.length === 1 &&
              publishedRows[0]?.variant === profile.variant &&
              publishedRows[0].recipeVersion === recipe &&
              internRows.length === 0
            : publishedRows.length === 0 &&
              internRows.length === 1 &&
              internRows[0]?.variant === internVariante(profile.variant) &&
              internRows[0].recipeVersion === recipe;
        if (asset.technicalState === "ok" && sourceCurrent && publishedCurrent) {
            report.unchanged += 1;
            counts.unchanged += 1;
            counts.ok += 1;
            if (publish) {
                report.published += 1;
                counts.published += 1;
            } else {
                report.privateOnly += 1;
            }
            continue;
        }

        // Die Bytes: bevorzugt Legacys Datei aus dem Download-Fach (Legacy ist die Quelle; die Datei unter der Adresse kann sich ändern),
        // sonst das schon abgelegte Original (neu rendern nach einer Rezeptänderung oder einer neuen Entscheidung).
        let bytes: Buffer | null = null;
        let tooLarge = false;
        if (listing !== undefined) {
            const result = await options.downloads.read(asset.localUrl, MAX_LEGACY_BYTES);
            if (result.ok) bytes = result.file.bytes;
            else if (result.miss.kind === "too_large") tooLarge = true;
            else if (result.miss.kind === "hash_mismatch") {
                report.hashMismatch += 1;
                findings.add(
                    "source_hash_mismatch",
                    "Dateien im Download-Fach, deren Bytes nicht zur SHA-256 der Liste passen (beschädigt); nicht verwendet",
                    asset,
                );
            }
        }
        if (bytes === null && !tooLarge && sourceRow !== undefined) {
            try {
                const stored = await options.store.read(sourceRow.storageKey, MAX_LEGACY_BYTES);
                if (sha256Of(stored) === sourceRow.sha256) bytes = stored;
            } catch (error) {
                if (!(error instanceof MediaStorageError)) throw error;
            }
        }

        const unpublishKeys: string[] = [];
        const fail = async (state: "missing_file" | "decode_failed" | "unsupported_format"): Promise<void> => {
            counts.rejected += state === "missing_file" ? 0 : 1;
            // Derselbe Stand wie zuvor und nichts Öffentliches zu entfernen: nichts schreiben (ein zweiter Lauf rührt nichts an).
            if (dryRun || (asset.technicalState === state && publishedRows.length === 0 && internRows.length === 0))
                return;
            await database.begin(async (tx) => {
                for (const row of [...publishedRows, ...internRows]) {
                    await tx`DELETE FROM media_file WHERE id = ${row.id}`;
                    unpublishKeys.push(row.storageKey);
                }
                await tx`UPDATE media_asset SET technical_state = ${state}, updated_at = now() WHERE id = ${asset.id}`;
            });
            report.stateChanged += asset.technicalState === state ? 0 : 1;
            if (publishedRows.length > 0) report.unpublished += publishedRows.length;
        };

        if (
            !tooLarge &&
            bytes === null &&
            (asset.technicalState === "decode_failed" || asset.technicalState === "unsupported_format")
        ) {
            // Früher abgewiesen, und diesmal liegt die Quelle nicht vor (kein Download-Fach, nie ein Original abgelegt): nicht neu
            // beurteilen. „Fehlt“ wäre eine neue Aussage über eine Datei, die wir gar nicht angesehen haben.
            report.notRechecked += 1;
            continue;
        }
        if (tooLarge) {
            report.rejected["too_large_bytes"] = (report.rejected["too_large_bytes"] ?? 0) + 1;
            findings.add("too_large_bytes", REJECTION_MESSAGES["too_large_bytes"] ?? "zu groß", asset);
            await fail("unsupported_format");
        } else if (bytes === null) {
            report.missing += 1;
            counts.missing += 1;
            findings.add(
                "missing_file",
                "Assets, deren Datei weder im Download-Fach noch als Original im Speicher liegt (missing_file); gemeldet, nicht erfunden",
                asset,
                asset.localUrl,
            );
            await fail("missing_file");
        } else {
            try {
                const result = await ingestImage(options.store, { bytes, role, publish, preview: true });
                report.ingested += 1;
                counts.ok += 1;
                const source = result.source;
                const published = result.derivatives[0];
                for (const file of [
                    source,
                    ...result.derivatives,
                    ...(result.preview === undefined ? [] : [result.preview]),
                ]) {
                    if (file.written) report.filesWritten += 1;
                    else report.filesDeduplicated += 1;
                }
                counts.sourceBytes += source.byteSize;
                report.bytesSource += source.byteSize;
                if (published !== undefined) {
                    counts.published += 1;
                    counts.publishedBytes += published.byteSize;
                    report.published += 1;
                    report.bytesPublished += published.byteSize;
                } else {
                    report.privateOnly += 1;
                }
                for (const finding of result.findings) {
                    findings.add(finding.code, `Assets mit dem Befund ${finding.code}`, asset, finding.detail);
                }
                if (!dryRun) {
                    await writeFileRows(
                        database,
                        asset,
                        sourceRow,
                        publishedRows,
                        source,
                        published,
                        listing,
                        unpublishKeys,
                        { rows: internRows, file: result.preview },
                        result.corners,
                        result.perceptualHash,
                    );
                    if (publish === false && publishedRows.length > 0) report.unpublished += publishedRows.length;
                }
            } catch (error) {
                if (!(error instanceof RasterRejection)) throw error;
                report.rejected[error.code] = (report.rejected[error.code] ?? 0) + 1;
                findings.add(error.code, REJECTION_MESSAGES[error.code] ?? error.message, asset);
                findings.add(
                    error.technicalState,
                    error.technicalState === "decode_failed"
                        ? "Assets, die sich nicht vollständig dekodieren lassen (decode_failed)"
                        : "Assets mit nicht unterstütztem Format oder über einer Grenze des Betreibers (unsupported_format)",
                    asset,
                    error.code,
                );
                await fail(error.technicalState);
            }
        }

        // Aufräumen NACH dem Festschreiben: eine öffentliche Datei oder private Vorschau, die keine Zeile mehr hält, wird entfernt.
        if (!dryRun) {
            for (const key of unpublishKeys) {
                const [referenced] = await database<{ present: boolean }[]>`
                    SELECT EXISTS (SELECT 1 FROM media_file WHERE storage_key = ${key}) AS present
                `;
                if (referenced?.present !== true) await options.store.remove(key);
            }
        }
    }

    // Gleiche Bytes unter verschiedenen Schlüsseln: zwei Assets, eine physische Datei (Information, kein Fehler).
    const duplicates = await database<{ sha256: string; assets: number }[]>`
        SELECT f.sha256, count(DISTINCT f.media_asset_id)::int AS assets
        FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
        WHERE f.storage_class = 'private_source' AND a.source_system = ${MEDIA_SOURCE_SYSTEM}
        GROUP BY f.sha256 HAVING count(DISTINCT f.media_asset_id) > 1
    `;
    const duplicateFindings =
        duplicates.length === 0
            ? []
            : [
                  createFinding(
                      "duplicate_bytes_distinct_assets",
                      `${String(duplicates.length)} Dateien (Bytes) stehen unter mehreren Assets, je eine physische Datei; Information, kein Fehler`,
                      {
                          dateien: duplicates.length,
                          assets: duplicates.reduce((sum, row) => sum + row.assets, 0),
                      },
                  ),
              ];

    // Die Quarantäne der Inhaltsschalter nachziehen: eine neue Datei einer ausgeschalteten Art wandert gleich dorthin (WI-0127 SYS-10 b3).
    // 🔴 Ein Fehler hier hält den Import nicht an (Betreiber 2026-10-03: nur Betreiber-Gates blockieren): Befund, der Job
    // `media_quarantine` holt es beim nächsten Lauf nach.
    const quarantineFindings = [];
    if (!dryRun) {
        try {
            const quarantine = await zieheQuarantaeneNach(database, options.store);
            if (quarantine !== null) report.quarantine = quarantine;
        } catch (error) {
            quarantineFindings.push(
                createFinding(
                    "quarantine_not_reconciled",
                    "Die Quarantäne der Inhaltsschalter ließ sich am Ende nicht nachziehen; der nächste Abgleich holt es nach",
                    { fehler: error instanceof Error ? error.message.slice(0, 200) : String(error) },
                ),
            );
        }
    }

    report.findings = [...findings.toFindings(), ...duplicateFindings, ...quarantineFindings];
    report.changed = report.ingested > 0 || report.unpublished > 0 || report.stateChanged > 0;
    report.durationMs = Date.now() - started;

    // Der Lauf als Journalzeile (Provenienz des Binärimports), nie im Probelauf und nur, wenn er etwas getan hat.
    if (!dryRun && report.changed) {
        await database`
            INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version, completed_at, status, journal)
            VALUES (${runId}, 'media_files', ${MEDIA_SOURCE_SYSTEM}, ${`download-dir; assets=${String(report.assets)}`},
                    ${MEDIA_CONTRACT_VERSION}, now(), 'completed',
                    ${
                        {
                            assets: report.assets,
                            unchanged: report.unchanged,
                            held: report.held,
                            ingested: report.ingested,
                            published: report.published,
                            private_only: report.privateOnly,
                            unpublished: report.unpublished,
                            rejected: report.rejected,
                            missing: report.missing,
                            hash_mismatch: report.hashMismatch,
                            bytes_source: report.bytesSource,
                            bytes_published: report.bytesPublished,
                            files_written: report.filesWritten,
                            files_deduplicated: report.filesDeduplicated,
                            findings: report.findings.map((finding) => finding.code),
                        } as unknown as string
                    })
        `;
    }
    return report;
}

/** Die Bytes, für die ein Notaus gilt (Migration 0086); vor 0086 keine. */
async function suspendedSources(database: Database): Promise<Set<string>> {
    const [present] = await database<{ present: boolean }[]>`
        SELECT to_regclass('public.media_publication_suspension') IS NOT NULL AS present
    `;
    if (present?.present !== true) return new Set();
    const rows = await database<{ sha256: string }[]>`
        SELECT source_sha256 AS sha256 FROM media_publication_suspension WHERE lifted_at IS NULL
    `;
    return new Set(rows.map((row) => row.sha256));
}

/**
 * Schreibt die Zeilen `media_file` eines Assets in EINER Transaktion: das Original (neu oder ersetzt, wenn Legacys Datei sich
 * geändert hat), das Derivat (ersetzt die frühere Rezeptfassung) oder, ohne Freigabe, kein Derivat und dafür die private Vorschau
 * (`intern_<variante>`). Dann `technical_state ok` und die Angaben des Abrufs an der Legacy-Herkunft.
 */
async function writeFileRows(
    database: Database,
    asset: AssetRow,
    sourceRow: FileRow | undefined,
    publishedRows: readonly FileRow[],
    source: IngestedFile,
    published: IngestedFile | undefined,
    listing: ListingEntry | undefined,
    unpublishKeys: string[],
    intern: { rows: readonly FileRow[]; file: IngestedFile | undefined },
    corners: boolean | undefined,
    perceptualHash: string | undefined,
): Promise<void> {
    await database.begin(async (tx) => {
        if (sourceRow === undefined) {
            await tx`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                VALUES (${asset.id}, 'source', 'private_source', ${source.key}, ${source.mimeType}, ${source.width}, ${source.height},
                        ${source.byteSize}, ${source.sha256})
            `;
        } else if (sourceRow.sha256 !== source.sha256) {
            await tx`
                UPDATE media_file
                SET storage_key = ${source.key}, mime_type = ${source.mimeType}, width = ${source.width}, height = ${source.height},
                    byte_size = ${source.byteSize}, sha256 = ${source.sha256}
                WHERE id = ${sourceRow.id}
            `;
        }
        const keep =
            published === undefined
                ? undefined
                : publishedRows.find(
                      (row) =>
                          row.sha256 === published.sha256 &&
                          row.variant === published.variant &&
                          row.recipeVersion === published.recipeVersion,
                  );
        for (const row of publishedRows) {
            if (row === keep) continue;
            await tx`DELETE FROM media_file WHERE id = ${row.id}`;
            if (published === undefined || row.storageKey !== published.key) unpublishKeys.push(row.storageKey);
        }
        if (published !== undefined && keep === undefined) {
            await tx`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                        derivative_recipe, recipe_version)
                VALUES (${asset.id}, ${published.variant}, 'published', ${published.key}, ${published.mimeType}, ${published.width},
                        ${published.height}, ${published.byteSize}, ${published.sha256}, ${published.derivativeRecipe},
                        ${published.recipeVersion})
            `;
        }
        // Die Messung der Ecken (T2b) an die Zeile des Originals, nur bei einem Wappen und nur, wenn sie sich ändert.
        if (
            corners !== undefined &&
            (sourceRow === undefined || sourceRow.sha256 !== source.sha256 || sourceRow.cornersTransparent !== corners)
        ) {
            await tx`
                UPDATE media_file SET corners_transparent = ${corners}
                 WHERE media_asset_id = ${asset.id} AND storage_class = 'private_source'
            `;
        }
        // 🪤 Ein fehlender Wahrnehmungs-Hash (WI-0068 D2) macht ein Asset NICHT „nicht auf dem Stand“: Den Bestand holt `media:aehnlich`
        // nach, ohne jedes Bild neu zu rendern. Wird ein Asset ohnehin gerechnet, schreibt der Lauf ihn mit.
        if (
            perceptualHash !== undefined &&
            (sourceRow === undefined ||
                sourceRow.sha256 !== source.sha256 ||
                sourceRow.perceptualHash !== perceptualHash)
        ) {
            await tx`
                UPDATE media_file SET perceptual_hash = ${perceptualHash}
                 WHERE media_asset_id = ${asset.id} AND storage_class = 'private_source'
            `;
        }
        const preview = published === undefined ? intern.file : undefined;
        const keepIntern =
            preview === undefined
                ? undefined
                : intern.rows.find(
                      (row) =>
                          row.sha256 === preview.sha256 &&
                          row.variant === preview.variant &&
                          row.recipeVersion === preview.recipeVersion,
                  );
        for (const row of intern.rows) {
            if (row === keepIntern) continue;
            await tx`DELETE FROM media_file WHERE id = ${row.id}`;
            if (preview === undefined || row.storageKey !== preview.key) unpublishKeys.push(row.storageKey);
        }
        if (preview !== undefined && keepIntern === undefined) {
            await tx`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                        derivative_recipe, recipe_version)
                VALUES (${asset.id}, ${preview.variant}, 'derivative', ${preview.key}, ${preview.mimeType}, ${preview.width},
                        ${preview.height}, ${preview.byteSize}, ${preview.sha256}, ${preview.derivativeRecipe}, ${preview.recipeVersion})
            `;
        }
        await tx`UPDATE media_asset SET technical_state = 'ok', updated_at = now() WHERE id = ${asset.id}`;
        if (listing !== undefined) {
            await tx`
                UPDATE media_legacy_source
                SET file_etag = ${listing.etag}, file_last_modified = ${listing.lastModified}, file_fetched_at = ${listing.fetchedAt},
                    updated_at = now()
                WHERE media_asset_id = ${asset.id}
                  AND (file_etag IS DISTINCT FROM ${listing.etag} OR file_last_modified IS DISTINCT FROM ${listing.lastModified}
                       OR file_fetched_at IS DISTINCT FROM ${listing.fetchedAt}::timestamptz)
            `;
        }
    });
}
