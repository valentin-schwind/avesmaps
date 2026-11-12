import {
    MEDIA_COAT_QUALITY,
    assetTypeForRole,
    validateMediaForm,
    type MediaCoatRejection,
    type MediaRole,
    type MediaUploadBody,
    type MediaUploadForm,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { FORMAT_EXTENSION, RasterRejection, inspectImage, type RasterInspection } from "../media/raster/inspect.ts";
import { PDF_ROLES } from "../media/raster/ingest.ts";
import { PDF_LIMITS, RASTER_LIMITS } from "../media/raster/limits.ts";
import { sperreQuelle } from "../media/quellsperre.ts";
import { sha256Of, type MediaStore } from "../media/storage.ts";
import { evidenceEntry, formRejected, insertEvidence, normalizedRights, readLicenses } from "./asset-operations.ts";
import { decodeBase64, decodeEvidenceFile, displayFilename, storeEvidence } from "./evidence-file.ts";
import { mediaOperation, type MediaActor, type MediaAuditEntry } from "./operation-store.ts";
import { enqueueSettle } from "./settle.ts";

/**
 * Hochladen über die Ingestion (WI-0068 P4a, §5, WI-0126 §11j): Datei prüfen, privat ablegen, Asset samt Rechten, Entstehung,
 * Provenienz und Beleg anlegen, den Abgleich der Dateien einreihen. Eine Operation (`asset.upload`).
 *
 * - **Prüfung vor jedem Byte auf der Platte:** Format aus den Bytes (Magic Bytes), die Grenzen des Betreibers (D2: 6 MiB, 512 KiB SVG,
 *   16 MP, 8192 px), ein Bild statt mehrerer, SVG ohne Text, Skript, DTD und Fremdverweis (D4). Nur PNG, JPEG, GIF, WebP und dieses
 *   SVG; alles andere, auch Ausführbares, ist 415. Dieselbe Vorprüfung wie die Rasterpipeline (`inspectImage`), reiner TypeScript-Code
 *   ohne Dekoder: Im Fastify-Prozess wird nichts dekodiert.
 * - **Ablage privat:** das Original unter `private/source/` (Name aus dem Hash, nie aus dem Dateinamen). Dekodieren, Rendern und eine
 *   öffentliche Fassung macht der Job `media_settle` im Worker (Claudio, M7); bis dahin ist das Asset `pending`.
 * - **Öffentlich nur über `decidePublication`.** Ein neues Asset hat keine Verwendung; erst eine Bindung kann es öffentlich machen, und
 *   nur, wenn die Policy JA sagt. Der Prüfstand ist `unreviewed`, außer die Person mit `review_media_rights` gibt das Bild gleich beim
 *   Hochladen frei (`rightsReviewed`, Betreiber 2026-11-06, WI-0282: „geh davon aus, dass sie die lizenz beim hochladen kennen“).
 * - **Provenienz:** `media_ingest` `editor_upload` mit der Person als Hochlader (`actor_person_id`), Dateiname nur zur Anzeige, die
 *   „Herkunft“ des Formulars als `source_ref`. Der Hochlader ist nie der Urheber (`media_rights.creator` kommt aus dem Formular).
 */

/** Das Quellsystem der Assets, die in Avesmaps3D hochgeladen werden (Legacy: `avesmaps-legacy`). */
export const MEDIA_EDITOR_SOURCE_SYSTEM = "avesmaps3d";

/** Eine Abweisung der Vorprüfung als Antwort: Größe 413, Format 415, alles andere 422, je mit dem Code der Pipeline. */
export function rejectionError(rejection: RasterRejection): ApiError {
    const details = { reason: rejection.code };
    if (rejection.code === "too_large_bytes") {
        return new ApiError(413, "payload_too_large", "Die Datei ist zu groß.", {
            ...details,
            limitBytes: RASTER_LIMITS.maxRasterBytes,
            limitSvgBytes: RASTER_LIMITS.maxSvgBytes,
            limitPdfBytes: PDF_LIMITS.maxBytes,
        });
    }
    if (rejection.code === "unsupported_format") {
        return new ApiError(415, "unsupported_media_type", "Angenommen werden PNG, JPEG, GIF, WebP und SVG.", details);
    }
    return new ApiError(422, "media_file_rejected", rejection.message, details);
}

/**
 * Ein neues Wappen erfüllt die Qualitätsmerkmale, soweit der Dateikopf sie zeigt (Betreiber 2026-10-10, `MEDIA_COAT_QUALITY`): lange
 * Seite mindestens 128 Pixel (SVG ausgenommen) und ein Format, das durchsichtig sein kann. Nicht quadratisch ist kein Fehler (der Worker
 * füllt auf); undurchsichtige Ecken sieht erst der Worker beim Dekodieren.
 */
export function coatRejection(inspection: RasterInspection): MediaCoatRejection | null {
    if (inspection.width !== null && inspection.height !== null) {
        if (Math.max(inspection.width, inspection.height) < MEDIA_COAT_QUALITY.minLongEdge) return "coat_too_small";
    }
    if (inspection.alpha === false) return "coat_not_transparent";
    return null;
}

/**
 * 🔴 Ein zweites Werk mit DENSELBEN BYTES entsteht nicht (Betreiber 2026-10-17: „Der Server muss dieselbe Prüfung verbindlich
 * wiederholen, einschließlich gleichzeitiger Uploads, damit kein Race Condition erneut Duplikate anlegt.“).
 *
 * Die Sperre je Hash gilt bis zum Ende der Transaktion: Zwei gleichzeitige Uploads derselben Datei kommen nacheinander hier vorbei,
 * und der zweite sieht das Werk des ersten. Gefragt wird nach den lebenden Werken (ein aufgegangenes zählt über das bleibende);
 * genannt wird das kanonische, das älteste, wie in `sameBytesAssets`.
 */
async function refuseKnownBytes(tx: Queryable, sha256: string): Promise<void> {
    await sperreQuelle(tx, sha256);
    const [known] = await tx<{ public_id: string }[]>`
        SELECT a.public_id::text AS public_id
          FROM media_file f
          JOIN media_asset a ON a.id = f.media_asset_id
         WHERE f.storage_class = 'private_source' AND f.sha256 = ${sha256}
           AND NOT EXISTS (SELECT 1 FROM media_merge m WHERE m.merged_asset_id = a.id AND m.lifted_at IS NULL)
         ORDER BY a.id
         LIMIT 1
    `;
    if (known !== undefined) {
        throw new ApiError(409, "media_already_exists", "Dieses Bild gibt es bereits.", { assetId: known.public_id });
    }
}

function inspect(bytes: Uint8Array, role: MediaRole): RasterInspection {
    try {
        // Ein PDF als Kartenquelle nur für die Rollen der Kartensammlung (WI-0275); das Format kommt aus den Magic Bytes. Eine Karte darf als Rasterdatei bis 50 MB groß sein
        // (WI-0287, wie ein Kartenvorschlag), eine Kartenvorschau bleibt bei den 6 MiB (D2), auch als PDF.
        if (role === "map_preview" && bytes.byteLength > RASTER_LIMITS.maxRasterBytes) {
            throw new RasterRejection(
                "too_large_bytes",
                `Datei hat ${String(bytes.byteLength)} Bytes, erlaubt sind höchstens ${String(RASTER_LIMITS.maxRasterBytes)}`,
            );
        }
        return inspectImage(bytes, {
            allowPdf: PDF_ROLES.has(role),
            ...(role === "map_full" ? { maxRasterBytes: PDF_LIMITS.maxBytes } : {}),
        });
    } catch (error) {
        if (error instanceof RasterRejection) throw rejectionError(error);
        throw error;
    }
}

export function uploadMedia(
    database: Database,
    store: MediaStore,
    actor: MediaActor,
    options: { mayReview: boolean },
    body: MediaUploadBody,
): Promise<OperationReceipt> {
    return uploadMediaBytes(database, store, actor, options, {
        operationId: body.operationId,
        name: body.file.name,
        form: body.form,
        bytes: decodeBase64(body.file, "file"),
    });
}

/** Dasselbe mit den Bytes in der Hand: Eine Kartendatei kommt als Rohkörper, nicht als Base64 (WI-0287, `MEDIA_KARTE_DATEI_URL`). */
export async function uploadMediaBytes(
    database: Database,
    store: MediaStore,
    actor: MediaActor,
    options: { mayReview: boolean },
    body: { operationId: string; name: string; form: MediaUploadForm; bytes: Uint8Array },
): Promise<OperationReceipt> {
    const form = body.form;
    const licenses = await readLicenses(database);
    const issues = validateMediaForm(form, {
        mode: "upload",
        licenses,
        mayReview: options.mayReview,
    });
    if (issues.length > 0) throw formRejected(issues);

    const bytes = body.bytes;
    const inspection = inspect(bytes, form.role);
    if (form.role === "coat") {
        const reason = coatRejection(inspection);
        if (reason !== null) {
            throw new ApiError(
                422,
                "media_file_rejected",
                reason === "coat_too_small"
                    ? `Ein Wappen braucht an der langen Seite mindestens ${String(MEDIA_COAT_QUALITY.minLongEdge)} Pixel.`
                    : "Ein Wappen braucht einen durchsichtigen Hintergrund; dieses Format kann keinen haben.",
                { reason },
            );
        }
    }
    const sha256 = sha256Of(bytes);
    const evidence = form.evidence?.file === undefined ? null : decodeEvidenceFile(form.evidence.file);
    const rights = normalizedRights(form.rights, licenses);
    // Kommt der Name aus der folgenden Bindung (7b), bleibt der Titel leer; die Bindung vergibt ihn als abgeleiteten.
    const title = form.titleFromBinding === true ? null : form.title.trim();
    const creation = {
        tool: form.creation?.tool?.trim() || null,
        model: form.creation?.model?.trim() || null,
        prompt: form.creation?.prompt?.trim() || null,
        negativePrompt: form.creation?.negativePrompt?.trim() || null,
    };
    const provenance = form.provenance?.trim() || null;
    const filename = displayFilename(body.name);

    // Der Inhalt, über den eine Wiederholung erkannt wird: die Felder und die Hashes der Dateien, nie die Bytes.
    const hashed = {
        file: { name: body.name, sha256 },
        form: {
            ...form,
            evidence:
                form.evidence === undefined
                    ? undefined
                    : { ...form.evidence, file: evidence === null ? undefined : { sha256: evidence.sha256 } },
        },
    };

    return mediaOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "asset.upload", body: hashed },
        async (tx) => {
            await refuseKnownBytes(tx, sha256);
            // Erst die Bytes, dann die Zeilen (ein unreferenzierter Hash ist aufräumbar, eine Zeile ohne Bytes ein Defekt).
            const source = await store.store("private_source", bytes, FORMAT_EXTENSION[inspection.format]);
            const evidenceFile = evidence === null ? null : await storeEvidence(store, evidence);

            const [asset] = await tx<{ id: string; public_id: string; revision: number }[]>`
                INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state, source_system,
                                         title)
                VALUES ('image', ${assetTypeForRole(form.role)}, 'editor_upload', ${form.creationMethod}, 'pending', 'not_applicable',
                        ${MEDIA_EDITOR_SOURCE_SYSTEM}, ${title})
                RETURNING id::text AS id, public_id::text AS public_id, revision::int AS revision
            `;
            const assetId = asset!.public_id;
            await tx`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                VALUES (${asset!.id}, 'source', 'private_source', ${source.key}, ${inspection.mimeType}, ${inspection.width},
                        ${inspection.height}, ${source.byteSize}, ${source.sha256})
            `;
            const freigegeben = form.rightsReviewed === true;
            const [rightsRow] = await tx<{ revision: number }[]>`
                INSERT INTO media_rights (media_asset_id, rights_basis, license_key, license_family, creator, rights_holder,
                                          attribution, rights_note, clearance_state, reviewed_at, reviewed_by_person)
                VALUES (${asset!.id}, ${rights.basis}, ${rights.licenseKey}, ${rights.licenseFamily}, ${rights.creator},
                        ${rights.rightsHolder}, ${rights.attribution}, ${rights.rightsNote},
                        ${freigegeben ? "cleared" : "unreviewed"}, ${freigegeben ? new Date() : null},
                        ${freigegeben ? actor.personId : null}::uuid)
                RETURNING revision::int AS revision
            `;
            const hasCreation = Object.values(creation).some((value) => value !== null);
            if (hasCreation) {
                await tx`
                    INSERT INTO media_creation (media_asset_id, tool, model, prompt, negative_prompt)
                    VALUES (${asset!.id}, ${creation.tool}, ${creation.model}, ${creation.prompt}, ${creation.negativePrompt})
                `;
            }
            await tx`
                INSERT INTO media_ingest (media_asset_id, ingest_kind, actor_person_id, source_system, source_ref, original_filename)
                VALUES (${asset!.id}, 'editor_upload', ${actor.personId}::uuid, ${MEDIA_EDITOR_SOURCE_SYSTEM}, ${provenance},
                        ${filename})
            `;
            const entries: MediaAuditEntry[] = [
                {
                    action: "asset.uploaded",
                    assetId,
                    targetRevision: asset!.revision,
                    details: {
                        role: form.role,
                        kind: "image",
                        format: inspection.format,
                        byteSize: source.byteSize,
                        sha256: source.sha256,
                    },
                },
                {
                    action: "rights.set",
                    assetId,
                    targetRevision: rightsRow!.revision,
                    details: { basis: rights.basis, licenseKey: rights.licenseKey, fields: [] },
                },
                ...(freigegeben
                    ? [
                          {
                              action: "rights.reviewed",
                              assetId,
                              targetRevision: rightsRow!.revision,
                              details: { decision: "cleared", previous: "unreviewed", eigenerUpload: true },
                          } satisfies MediaAuditEntry,
                      ]
                    : []),
            ];
            if (form.evidence !== undefined) {
                await insertEvidence(tx, asset!.id, actor, form.evidence, evidenceFile);
                entries.push(evidenceEntry(assetId, form.evidence));
            }
            const settle = await enqueueSettle(tx, {
                assetPublicId: assetId,
                role: form.role,
                actorPersonId: actor.personId,
            });
            return {
                receipt: {
                    affected: [
                        { kind: "media_asset", id: assetId, revision: asset!.revision },
                        { kind: "media_rights", id: assetId, revision: rightsRow!.revision },
                    ],
                    derivedWork: [settle],
                    warnings: inspection.findings.map((finding) => ({
                        code: finding.code,
                        message: "Hinweis der Vorprüfung; das Bild wird trotzdem verarbeitet.",
                    })),
                },
                entries,
            };
        },
    );
}
