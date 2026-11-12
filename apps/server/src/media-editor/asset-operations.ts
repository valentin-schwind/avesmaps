import {
    validateMediaCreation,
    validateMediaEvidence,
    validateMediaRights,
    type DerivedWork,
    type MediaCreationBody,
    type MediaEvidenceBody,
    type MediaFormIssue,
    type MediaLicenseInfo,
    type MediaMetadataBody,
    type MediaRightsBody,
    type MediaRightsFields,
    type MediaRightsReviewBody,
    type OperationReceipt,
    type ReceiptWarning,
} from "@avesmaps3d/shared";
import type { Static } from "@sinclair/typebox";
import type { MediaAssetType } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import type { MediaStore } from "../media/storage.ts";
import { mediaEditConflict } from "./audit.ts";
import { decodeEvidenceFile, storeEvidence } from "./evidence-file.ts";
import { mediaOperation, type MediaActor, type MediaAuditEntry } from "./operation-store.ts";
import { enqueueSettleForActiveRoles } from "./settle.ts";

/**
 * Die Operationen am Asset (WI-0068 P4a, §14 „edit creation metadata“, „edit rights metadata“, Rechteprüfung, Beleg): je Handlung
 * eine Operation mit eigener Kennung, `baseRevision` des Datensatzes, den sie ändert, Fachprotokoll und Quittung.
 *
 * | Operation          | Datensatz       | Recht                 |
 * |--------------------|-----------------|-----------------------|
 * | `asset.metadata`   | `media_asset`   | `upload_media`        |
 * | `creation.set`     | `media_creation`| `upload_media`        |
 * | `rights.set`       | `media_rights`  | `upload_media`        |
 * | `rights.review`    | `media_rights`  | `review_media_rights` |
 * | `rights.evidence`  | (anhängen)      | `upload_media`        |
 *
 * 🔴 „Rechte geprüft“ darf jeder mit `review_media_rights`, auch am eigenen Hochgeladenen (Betreiber 2026-11-06, WI-0282). Das Fachprotokoll
 * vermerkt den eigenen Upload (`eigenerUpload`).
 * 🔴 Ändern sich Grundlage oder Lizenz, fällt der Prüfstand auf `unreviewed`: eine frühere Prüfung galt einer anderen Aussage.
 * 🔴 Was die Policy entscheiden lässt (Entstehung, Grundlage, Lizenz, Prüfstand), reiht den Abgleich je aktiver Rolle ein
 * (`enqueueSettleForActiveRoles`, Code-Review 2026-10-16 S8-01): „Rechte geprüft“ macht ein Bild öffentlich, „abgelehnt“ nimmt die
 * Datei unter `published/` weg. Für Eilfälle bleibt der Notaus (`suspension.ts`): Ausgelieferte Kopien holt keiner zurück.
 */

export type ReceiptWithoutEnvironment = Omit<OperationReceipt, "operationId" | "status" | "environment">;
type Warning = Static<typeof ReceiptWarning>;

export const notFound = (what: string): ApiError => new ApiError(404, "not_found", `${what} gibt es nicht.`);

/** 400 `validation_failed` mit den Befunden der gemeinsamen Prüfung (Pfad und Regel, nie der Wert; ADR-0018). */
export function formRejected(issues: readonly MediaFormIssue[]): ApiError {
    return new ApiError(400, "validation_failed", "Die Angaben sind so nicht vollständig.", {
        issues: issues.map(({ path, rule }) => ({ path, rule })),
    });
}

/** Der Lizenzkatalog, wie das Formular ihn braucht. */
export async function readLicenses(database: Queryable): Promise<MediaLicenseInfo[]> {
    return database<MediaLicenseInfo[]>`
        SELECT key, display_name AS "displayName", canonical_uri AS uri, family, requires_attribution AS "requiresAttribution"
          FROM license_catalog ORDER BY family, key
    `;
}

export interface LockedAsset {
    id: string;
    publicId: string;
    revision: number;
    updatedAt: Date;
    mediaKind: "image" | "model_3d";
    /** Der Asset-Typ (Migration 0095); `null`: noch keiner. */
    assetType: MediaAssetType | null;
    creationMethod: string;
    technicalState: string;
    /** Das Quellsystem (`photobox`: ein Reisebild, `avesmaps3d`: ein Editor-Upload …); `null` bei Assets ohne. */
    sourceSystem: string | null;
    /** Die Herkunft (`community_upload`: Reisebild oder Kartenvorschlag, die Lizenz ändert nur der Betreiber). */
    origin: string;
}

/** Das Asset, gesperrt bis zum Ende der Transaktion; sonst 404. */
export async function lockAsset(tx: Queryable, publicId: string): Promise<LockedAsset> {
    const [row] = await tx<
        {
            id: string;
            revision: number;
            updated_at: Date;
            media_kind: LockedAsset["mediaKind"];
            asset_type: MediaAssetType | null;
            creation_method: string;
            technical_state: string;
            source_system: string | null;
            origin: string;
        }[]
    >`
        SELECT id::text AS id, revision::int AS revision, updated_at, media_kind, asset_type, creation_method, technical_state, source_system, origin
          FROM media_asset WHERE public_id = ${publicId}::uuid FOR UPDATE
    `;
    if (row === undefined) throw notFound("Dieses Medium");
    return {
        id: row.id,
        publicId,
        revision: row.revision,
        updatedAt: row.updated_at,
        mediaKind: row.media_kind,
        assetType: row.asset_type,
        creationMethod: row.creation_method,
        technicalState: row.technical_state,
        sourceSystem: row.source_system,
        origin: row.origin,
    };
}

/**
 * 409 `media_rights_follow_source`, wenn das Werk eine erzeugte Vorschau ist (WI-0287 Punkt 5): Ihre Rechte und ihre Entstehung kommen von der Karte und ändern sich nur
 * dort (Migration 0320; der Auslöser überschriebe jede Änderung hier ohnehin mit den Werten der Karte).
 */
export async function pruefeEigeneRechte(tx: Queryable, assetId: string): Promise<void> {
    const [zeile] = await tx<{ karte: string | null }[]>`
        SELECT k.public_id::text AS karte FROM media_asset a LEFT JOIN media_asset k ON k.id = a.generated_from_asset_id
         WHERE a.id = ${assetId}::bigint
    `;
    if (zeile?.karte !== null && zeile?.karte !== undefined) {
        throw new ApiError(
            409,
            "media_rights_follow_source",
            "Die Rechte dieser Vorschau folgen ihrer Karte. Ändern geht nur an der Karte.",
            { sourceAssetId: zeile.karte },
        );
    }
}

/** Hat diese Person das Asset hochgeladen (Editor-Upload)? */
export async function uploadedBy(tx: Queryable, assetId: string, personId: string): Promise<boolean> {
    const [row] = await tx<{ own: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM media_ingest WHERE media_asset_id = ${assetId} AND actor_person_id = ${personId}::uuid
        ) AS own
    `;
    return row?.own === true;
}

const trimmed = (value: string | null | undefined): string | null => {
    if (value === undefined || value === null) return null;
    const text = value.trim();
    return text === "" ? null : text;
};

// --- Titel und Art der Entstehung -----------------------------------------------------------------------------------------------

export function setMetadata(
    database: Database,
    actor: MediaActor,
    assetId: string,
    body: MediaMetadataBody,
): Promise<OperationReceipt> {
    const fields = (["title", "creationMethod"] as const).filter((field) => body[field] !== undefined);
    if (fields.length === 0) {
        throw new ApiError(400, "validation_failed", "Es ist nichts zu ändern.", {
            issues: [{ path: "title", rule: "required" }],
        });
    }
    const title = body.title === undefined ? undefined : trimmed(body.title);
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "asset.metadata",
            body: { assetId, baseRevision: body.baseRevision, title, creationMethod: body.creationMethod },
        },
        async (tx) => {
            const asset = await lockAsset(tx, assetId);
            if (asset.revision !== body.baseRevision) {
                throw await mediaEditConflict(
                    tx,
                    { record: "asset", assetId },
                    { revision: asset.revision, changedAt: asset.updatedAt },
                );
            }
            // Der Name einer erzeugten Vorschau ist ihrer; ihre Entstehung kommt von der Karte (WI-0287).
            if (body.creationMethod !== undefined && body.creationMethod !== asset.creationMethod) {
                await pruefeEigeneRechte(tx, asset.id);
            }
            const [row] = await tx<{ revision: number }[]>`
                UPDATE media_asset
                   SET title = CASE WHEN ${title !== undefined} THEN ${title ?? null} ELSE title END,
                       creation_method = coalesce(${body.creationMethod ?? null}, creation_method),
                       updated_at = now()
                 WHERE id = ${asset.id}
                RETURNING revision::int AS revision
            `;
            const revision = row!.revision;
            const methodChanged = body.creationMethod !== undefined && body.creationMethod !== asset.creationMethod;
            // Die Entstehung entscheidet mit, ob eine Freigaberegel trägt (Betreiber 2026-10-10, KI-Regeln für Wappen und Ortsbilder):
            // ändert sie sich, gleicht der Worker die öffentlichen Fassungen je aktiver Rolle ab.
            const derivedWork: DerivedWork[] = methodChanged
                ? await enqueueSettleForActiveRoles(tx, {
                      assetId: asset.id,
                      assetPublicId: assetId,
                      actorPersonId: actor.personId,
                  })
                : [];
            return {
                receipt: {
                    affected: [{ kind: "media_asset", id: assetId, revision }],
                    derivedWork,
                    warnings: [],
                },
                entries: [
                    {
                        action: "asset.metadata_set",
                        assetId,
                        targetRevision: revision,
                        details: { fields, ...(methodChanged ? { creationMethod: body.creationMethod } : {}) },
                    },
                ],
            };
        },
    );
}

// --- Werkzeug, Modell, Prompt ---------------------------------------------------------------------------------------------------

export function setCreation(
    database: Database,
    actor: MediaActor,
    assetId: string,
    body: MediaCreationBody,
): Promise<OperationReceipt> {
    const values = {
        tool: trimmed(body.creation.tool),
        model: trimmed(body.creation.model),
        prompt: trimmed(body.creation.prompt),
        negativePrompt: trimmed(body.creation.negativePrompt),
    };
    const fields = (Object.keys(values) as (keyof typeof values)[]).filter(
        (field) => body.creation[field] !== undefined,
    );
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "creation.set",
            body: { assetId, baseRevision: body.baseRevision, creation: values, fields },
        },
        async (tx) => {
            const asset = await lockAsset(tx, assetId);
            const issues = validateMediaCreation(
                asset.creationMethod as Parameters<typeof validateMediaCreation>[0],
                values,
            );
            if (issues.length > 0) throw formRejected(issues);
            const [current] = await tx<{ revision: number; updated_at: Date }[]>`
                SELECT revision::int AS revision, updated_at FROM media_creation WHERE media_asset_id = ${asset.id} FOR UPDATE
            `;
            if ((current?.revision ?? undefined) !== body.baseRevision) {
                throw await mediaEditConflict(
                    tx,
                    { record: "creation", assetId },
                    { revision: current?.revision ?? 0, changedAt: current?.updated_at ?? asset.updatedAt },
                );
            }
            const keep = (field: keyof typeof values): boolean => body.creation[field] === undefined;
            const [row] =
                current === undefined
                    ? await tx<{ revision: number }[]>`
                        INSERT INTO media_creation (media_asset_id, tool, model, prompt, negative_prompt)
                        VALUES (${asset.id}, ${values.tool}, ${values.model}, ${values.prompt}, ${values.negativePrompt})
                        RETURNING revision::int AS revision
                    `
                    : await tx<{ revision: number }[]>`
                        UPDATE media_creation
                           SET tool = CASE WHEN ${keep("tool")} THEN tool ELSE ${values.tool} END,
                               model = CASE WHEN ${keep("model")} THEN model ELSE ${values.model} END,
                               prompt = CASE WHEN ${keep("prompt")} THEN prompt ELSE ${values.prompt} END,
                               negative_prompt = CASE WHEN ${keep("negativePrompt")} THEN negative_prompt ELSE ${values.negativePrompt} END,
                               updated_at = now()
                         WHERE media_asset_id = ${asset.id}
                        RETURNING revision::int AS revision
                    `;
            const revision = row!.revision;
            return {
                receipt: {
                    affected: [{ kind: "media_creation", id: assetId, revision }],
                    derivedWork: [],
                    warnings: [],
                },
                entries: [{ action: "creation.set", assetId, targetRevision: revision, details: { fields } }],
            };
        },
    );
}

// --- Rechte ---------------------------------------------------------------------------------------------------------------------

/** Die Rechte, wie sie gespeichert werden: getrimmt, Familie aus dem Katalog. */
export function normalizedRights(
    rights: MediaRightsFields,
    licenses: readonly MediaLicenseInfo[],
): {
    basis: MediaRightsFields["basis"];
    licenseKey: string | null;
    licenseFamily: string | null;
    creator: string | null;
    rightsHolder: string | null;
    attribution: string | null;
    rightsNote: string | null;
} {
    const licenseKey = rights.basis === "license" ? trimmed(rights.licenseKey) : null;
    return {
        basis: rights.basis,
        licenseKey,
        licenseFamily: licenses.find((license) => license.key === licenseKey)?.family ?? null,
        creator: trimmed(rights.creator),
        rightsHolder: trimmed(rights.rightsHolder),
        attribution: trimmed(rights.attribution),
        rightsNote: trimmed(rights.rightsNote),
    };
}

const CLEARANCE_RESET: Warning = {
    code: "clearance_reset",
    message: "Grundlage oder Lizenz haben sich geändert: Die Rechte warten wieder auf ihre Prüfung.",
};

export async function setRights(
    database: Database,
    actor: MediaActor,
    assetId: string,
    body: MediaRightsBody,
    optionen: {
        /** Wirft, wenn die Sitzung die Lizenz eines Community-Uploads nicht ändern darf (`edit_community_license`). */
        pruefeCommunityLizenz: () => void;
    },
): Promise<OperationReceipt> {
    const licenses = await readLicenses(database);
    const issues = validateMediaRights(body.rights, licenses);
    if (issues.length > 0) throw formRejected(issues);
    const rights = normalizedRights(body.rights, licenses);
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "rights.set",
            body: { assetId, baseRevision: body.baseRevision, rights },
        },
        async (tx) => {
            const asset = await lockAsset(tx, assetId);
            await pruefeEigeneRechte(tx, asset.id);
            const [current] = await tx<
                { revision: number; updated_at: Date; rights_basis: string; license_key: string | null }[]
            >`
                SELECT revision::int AS revision, updated_at, rights_basis, license_key
                  FROM media_rights WHERE media_asset_id = ${asset.id} FOR UPDATE
            `;
            if ((current?.revision ?? undefined) !== body.baseRevision) {
                throw await mediaEditConflict(
                    tx,
                    { record: "rights", assetId },
                    { revision: current?.revision ?? 0, changedAt: current?.updated_at ?? asset.updatedAt },
                );
            }
            const reset =
                current !== undefined &&
                (current.rights_basis !== rights.basis || (current.license_key ?? null) !== rights.licenseKey);
            // Betreiber 2026-11-06 (WI-0282): „die lizenz von bilder die nutzer hochladen darf nicht geändert werden- nur durch den betreiber“.
            if (reset && asset.origin === "community_upload") optionen.pruefeCommunityLizenz();
            const [row] =
                current === undefined
                    ? await tx<{ revision: number }[]>`
                        INSERT INTO media_rights (media_asset_id, rights_basis, license_key, license_family, creator, rights_holder,
                                                  attribution, rights_note, clearance_state)
                        VALUES (${asset.id}, ${rights.basis}, ${rights.licenseKey}, ${rights.licenseFamily}, ${rights.creator},
                                ${rights.rightsHolder}, ${rights.attribution}, ${rights.rightsNote}, 'unreviewed')
                        RETURNING revision::int AS revision
                    `
                    : await tx<{ revision: number }[]>`
                        UPDATE media_rights
                           SET rights_basis = ${rights.basis}, license_key = ${rights.licenseKey},
                               license_family = ${rights.licenseFamily}, creator = ${rights.creator},
                               rights_holder = ${rights.rightsHolder}, attribution = ${rights.attribution},
                               rights_note = ${rights.rightsNote},
                               clearance_state = CASE WHEN ${reset} THEN 'unreviewed' ELSE clearance_state END,
                               reviewed_at = CASE WHEN ${reset} THEN NULL ELSE reviewed_at END,
                               reviewed_by = CASE WHEN ${reset} THEN NULL ELSE reviewed_by END,
                               reviewed_by_person = CASE WHEN ${reset} THEN NULL ELSE reviewed_by_person END,
                               updated_at = now()
                         WHERE media_asset_id = ${asset.id}
                        RETURNING revision::int AS revision
                    `;
            const revision = row!.revision;
            const fields = (["creator", "rightsHolder", "attribution", "rightsNote"] as const).filter(
                (field) => body.rights[field] !== undefined,
            );
            // Eine neue Rechtezeile oder eine andere Grundlage oder Lizenz ändert, was die Policy sagt (S8-01); Namen und Notizen nicht.
            const derivedWork =
                current === undefined || reset
                    ? await enqueueSettleForActiveRoles(tx, {
                          assetId: asset.id,
                          assetPublicId: assetId,
                          actorPersonId: actor.personId,
                      })
                    : [];
            return {
                receipt: {
                    affected: [{ kind: "media_rights", id: assetId, revision }],
                    derivedWork,
                    warnings: reset ? [CLEARANCE_RESET] : [],
                },
                entries: [
                    {
                        action: "rights.set",
                        assetId,
                        targetRevision: revision,
                        details: {
                            basis: rights.basis,
                            licenseKey: rights.licenseKey,
                            fields,
                            ...(reset ? { clearanceReset: true } : {}),
                        },
                    },
                ],
            };
        },
    );
}

/** „Rechte geprüft“ und die anderen Prüfentscheidungen; auch am eigenen Hochgeladenen (WI-0282), das Fachprotokoll vermerkt es. */
export function reviewRights(
    database: Database,
    actor: MediaActor,
    assetId: string,
    body: MediaRightsReviewBody,
): Promise<OperationReceipt> {
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "rights.review",
            body: { assetId, baseRevision: body.baseRevision, decision: body.decision },
        },
        async (tx) => {
            const asset = await lockAsset(tx, assetId);
            await pruefeEigeneRechte(tx, asset.id);
            const eigenerUpload = await uploadedBy(tx, asset.id, actor.personId);
            const [current] = await tx<
                { revision: number; updated_at: Date; rights_basis: string; clearance_state: string }[]
            >`
                SELECT revision::int AS revision, updated_at, rights_basis, clearance_state
                  FROM media_rights WHERE media_asset_id = ${asset.id} FOR UPDATE
            `;
            if (current === undefined || current.revision !== body.baseRevision) {
                throw await mediaEditConflict(
                    tx,
                    { record: "rights", assetId },
                    { revision: current?.revision ?? 0, changedAt: current?.updated_at ?? asset.updatedAt },
                );
            }
            // Eine unbekannte Grundlage lässt sich nicht als geprüft freigeben: sie ist nie öffentlich (Policy).
            if (body.decision === "cleared" && current.rights_basis === "unknown") {
                throw formRejected([{ path: "decision", rule: "not_allowed" }]);
            }
            const [row] = await tx<{ revision: number }[]>`
                UPDATE media_rights
                   SET clearance_state = ${body.decision}, reviewed_at = now(), reviewed_by_person = ${actor.personId}::uuid,
                       reviewed_by = NULL, updated_at = now()
                 WHERE media_asset_id = ${asset.id}
                RETURNING revision::int AS revision
            `;
            const revision = row!.revision;
            // Der Prüfstand entscheidet mit (S8-01); ein Abgleich, der schon auf dem Stand ist, rendert nichts.
            const derivedWork = await enqueueSettleForActiveRoles(tx, {
                assetId: asset.id,
                assetPublicId: assetId,
                actorPersonId: actor.personId,
            });
            return {
                receipt: {
                    affected: [{ kind: "media_rights", id: assetId, revision }],
                    derivedWork,
                    warnings: [],
                },
                entries: [
                    {
                        action: "rights.reviewed",
                        assetId,
                        targetRevision: revision,
                        details: {
                            decision: body.decision,
                            previous: current.clearance_state,
                            ...(eigenerUpload ? { eigenerUpload: true } : {}),
                        },
                    },
                ],
            };
        },
    );
}

/**
 * „Rechte bestätigen“ im Social Hub (WI-0278, Betreiber 2026-11-03, Recht `manage_news`): Wer Beiträge freigeben darf, bestätigt die Rechte an einem Bild der Kategorie „Social Media Posts“, auch am
 * eigenen Upload, so wie er den eigenen Beitrag allein freigeben darf (E10). Protokolliert wird es wie jede Prüfung, der eigene Upload mit Vermerk. Danach reiht `reviewRights` den Abgleich ein, der
 * die öffentliche Fassung anlegt. Eine Wiederholung derselben Bestätigung ändert nichts.
 */
export async function bestaetigeSocialBild(
    database: Database,
    actor: MediaActor,
    assetId: string,
    operationId: string,
): Promise<void> {
    const [stand] = await database<
        { asset_type: MediaAssetType | null; clearance_state: string | null; revision: number | null }[]
    >`
        SELECT a.asset_type, r.clearance_state, r.revision::int AS revision
          FROM media_asset a LEFT JOIN media_rights r ON r.media_asset_id = a.id
         WHERE a.public_id = ${assetId}::uuid
    `;
    if (stand === undefined) throw new ApiError(404, "not_found", "Dieses Bild gibt es nicht.");
    if (stand.asset_type !== "social_post") {
        throw new ApiError(
            422,
            "community_invalid",
            "Nur Bilder der Kategorie „Social Media Posts“ werden hier bestätigt; die übrigen prüft die Medienverwaltung.",
            { reason: "bild_nicht_social" },
        );
    }
    if (stand.clearance_state === "cleared") return;
    await reviewRights(database, actor, assetId, {
        operationId,
        baseRevision: stand.revision ?? 0,
        decision: "cleared",
    });
}

// --- Beleg ----------------------------------------------------------------------------------------------------------------------

/** Schreibt eine Belegzeile (die Datei liegt schon unter `private/evidence/`). Der Erfasser ist die pseudonyme `person.id`. */
export async function insertEvidence(
    tx: Sql,
    assetDbId: string,
    actor: MediaActor,
    evidence: MediaEvidenceBody["evidence"],
    file: { key: string; sha256: string } | null,
): Promise<void> {
    await tx`
        INSERT INTO media_rights_evidence (media_asset_id, evidence_kind, storage_key, external_url, sha256, description, recorded_by)
        VALUES (${assetDbId}, ${evidence.kind}, ${file?.key ?? null}, ${trimmed(evidence.url)}, ${file?.sha256 ?? null},
                ${trimmed(evidence.text)}, ${actor.personId})
    `;
}

export function evidenceEntry(assetId: string, evidence: MediaEvidenceBody["evidence"]): MediaAuditEntry {
    return {
        action: "rights.evidence_added",
        assetId,
        targetRevision: null,
        details: { kind: evidence.kind, hasFile: evidence.file !== undefined, hasUrl: trimmed(evidence.url) !== null },
    };
}

export function addEvidence(
    database: Database,
    store: MediaStore,
    actor: MediaActor,
    assetId: string,
    body: MediaEvidenceBody,
): Promise<OperationReceipt> {
    const issues = validateMediaEvidence(body.evidence);
    if (issues.length > 0) throw formRejected(issues);
    const decoded = body.evidence.file === undefined ? null : decodeEvidenceFile(body.evidence.file);
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "rights.evidence",
            body: {
                assetId,
                evidence: { ...body.evidence, file: decoded === null ? undefined : { sha256: decoded.sha256 } },
            },
        },
        async (tx) => {
            const asset = await lockAsset(tx, assetId);
            const file = decoded === null ? null : await storeEvidence(store, decoded);
            await insertEvidence(tx, asset.id, actor, body.evidence, file);
            return {
                receipt: { affected: [{ kind: "media_asset", id: assetId }], derivedWork: [], warnings: [] },
                entries: [evidenceEntry(assetId, body.evidence)],
            };
        },
    );
}
