import {
    MEDIA_HISTORY_LIMIT,
    headerGraphicOfPlace,
    kartenvorschlagNummer,
    mediaEditorPreviewUrl,
    type KarteVorschauSperre,
    mediaPublicUrl,
    type MediaAssetCore,
    type MediaAssetDetail,
    type MediaCreationEditorView,
    type MediaEvidenceView,
    type MediaHistoryEntry,
    type MediaIngestView,
    type MediaLegacySourceView,
    type MediaPersonRef,
    type MediaRepresentation,
    type MediaRightsEditorView,
    type MediaSuspensionView,
    type PhotoboxSubmissionView,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { KARTENVORSCHLAG_QUELLSYSTEM } from "../kartenvorschlag/quellsystem.ts";
import { resolvePlaceMediaParts } from "../media/resolver.ts";
import { PHOTOBOX_QUELLSYSTEM } from "../photobox/db.ts";
import { erzeugtAusVon, erzeugteVon, vorschauSperren } from "./kartensammlung-vorschau.ts";
import { photoboxBild } from "./photobox-loeschen.ts";
import { personJson } from "./usage-sql.ts";
import { countRetired, loadUsages, sameFileAssets } from "./usage.ts";
import { vorschlagsBild } from "./vorschlag-loeschen.ts";

/**
 * Das Asset im Inspector (WI-0068 §3.3, P2): Kern, Rechte, Entstehung, Provenienz (`media_ingest`), Legacys Angaben, Dateien,
 * Notaus, Zahlen der Verwendungen, Historie aus dem Fachprotokoll und die Belege. Lesend, je Teil eine schmale Abfrage über
 * den Primärschlüssel des Assets; nichts davon ist eine öffentliche Sicht.
 *
 * Die Provenienz kommt aus `media_ingest` (Schritt „umstellen“ der Zwei-Release-Regel, AGENTS.md); die alten Spalten am Asset
 * (`ingest_actor_legacy`, `legacy_uploaded_at`, `stamp_semantics`) liest dieser Pfad nicht mehr. Sie bleiben, bis ein späteres
 * Release sie entfernt.
 */

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

interface CoreRow {
    id: string;
    public_id: string;
    revision: number;
    title: string | null;
    media_kind: MediaAssetCore["kind"];
    asset_type: MediaAssetCore["assetType"];
    origin: MediaAssetCore["origin"];
    creation_method: MediaAssetCore["creationMethod"];
    technical_state: MediaAssetCore["technicalState"];
    moderation_state: MediaAssetCore["moderationState"];
    degraded_original: boolean;
    source_system: string;
    source_ref: string | null;
    created_at: Date;
    updated_at: Date;
    imported_at: Date | null;
}

async function loadCore(database: Queryable, publicId: string): Promise<CoreRow | undefined> {
    const [row] = await database.unsafe<CoreRow[]>(
        `SELECT id::text AS id, public_id::text AS public_id, revision::int AS revision, title, media_kind, asset_type, origin,
                creation_method, technical_state, moderation_state, degraded_original, source_system, source_ref, created_at,
                updated_at, imported_at
           FROM media_asset WHERE public_id = $1::uuid`,
        [publicId],
    );
    return row;
}

async function loadRights(database: Queryable, assetId: string): Promise<MediaRightsEditorView | null> {
    const [row] = await database.unsafe<
        {
            revision: number;
            rights_basis: MediaRightsEditorView["basis"];
            license_key: string | null;
            license_family: string | null;
            license_name: string | null;
            license_uri: string | null;
            requires_attribution: boolean | null;
            creator: string | null;
            rights_holder: string | null;
            attribution: string | null;
            clearance_state: MediaRightsEditorView["clearance"];
            reviewed_at: Date | null;
            updated_at: Date;
            rights_note: string | null;
            legacy_rights_code: string | null;
            reviewed_by: string | null;
            reviewer: MediaPersonRef | null;
        }[]
    >(
        `SELECT r.revision::int AS revision, r.rights_basis, r.license_key, r.license_family, l.display_name AS license_name,
                l.canonical_uri AS license_uri, l.requires_attribution, r.creator, r.rights_holder, r.attribution,
                r.clearance_state, r.reviewed_at, r.updated_at, r.rights_note, r.legacy_rights_code, r.reviewed_by,
                ${personJson("p")} AS reviewer
           FROM media_rights r
           LEFT JOIN license_catalog l ON l.key = r.license_key
           LEFT JOIN avesmaps_auth.person p ON p.id = r.reviewed_by_person
          WHERE r.media_asset_id = $1::bigint`,
        [assetId],
    );
    if (row === undefined) return null;
    return {
        revision: row.revision,
        basis: row.rights_basis,
        licenseKey: row.license_key,
        licenseFamily: row.license_family,
        licenseName: row.license_name,
        licenseUri: row.license_uri,
        requiresAttribution: row.requires_attribution,
        creator: row.creator,
        rightsHolder: row.rights_holder,
        attribution: row.attribution,
        clearance: row.clearance_state,
        reviewedAt: iso(row.reviewed_at),
        updatedAt: row.updated_at.toISOString(),
        rightsNote: row.rights_note,
        legacyRightsCode: row.legacy_rights_code,
        reviewedBy: row.reviewed_by,
        reviewer: row.reviewer,
    };
}

async function loadCreation(database: Queryable, assetId: string): Promise<MediaCreationEditorView | null> {
    const [row] = await database.unsafe<
        {
            revision: number;
            updated_at: Date;
            tool: string | null;
            model: string | null;
            prompt: string | null;
            negative_prompt: string | null;
            parameters: Record<string, unknown> | null;
            legacy_note_raw: string | null;
        }[]
    >(
        `SELECT revision::int AS revision, updated_at, tool, model, prompt, negative_prompt, parameters, legacy_note_raw
           FROM media_creation WHERE media_asset_id = $1::bigint`,
        [assetId],
    );
    if (row === undefined) return null;
    return {
        revision: row.revision,
        updatedAt: row.updated_at.toISOString(),
        tool: row.tool,
        model: row.model,
        prompt: row.prompt,
        negativePrompt: row.negative_prompt,
        parameters: row.parameters,
        legacyNoteRaw: row.legacy_note_raw,
    };
}

async function loadIngest(database: Queryable, assetId: string): Promise<MediaIngestView[]> {
    const rows = await database.unsafe<
        {
            ingest_kind: MediaIngestView["kind"];
            migration_run_id: string | null;
            source_system: string | null;
            source_ref: string | null;
            ingested_at: Date;
            actor: MediaPersonRef | null;
            legacy_actor_label: string | null;
            legacy_uploaded_at: Date | null;
            legacy_stamp_semantics: MediaIngestView["legacyStampSemantics"];
            submission_id: string | null;
            original_filename: string | null;
        }[]
    >(
        `SELECT i.ingest_kind, i.migration_run_id::text AS migration_run_id, i.source_system, i.source_ref, i.ingested_at,
                ${personJson("p")} AS actor, i.legacy_actor_label, i.legacy_uploaded_at, i.legacy_stamp_semantics,
                i.submission_id::text AS submission_id, i.original_filename
           FROM media_ingest i
           LEFT JOIN avesmaps_auth.person p ON p.id = i.actor_person_id
          WHERE i.media_asset_id = $1::bigint
          ORDER BY i.ingested_at, i.id`,
        [assetId],
    );
    return rows.map((row) => ({
        kind: row.ingest_kind,
        migrationRunId: row.migration_run_id,
        sourceSystem: row.source_system,
        sourceRef: row.source_ref,
        ingestedAt: row.ingested_at.toISOString(),
        actor: row.actor,
        legacyActorLabel: row.legacy_actor_label,
        legacyUploadedAt: iso(row.legacy_uploaded_at),
        legacyStampSemantics: row.legacy_stamp_semantics,
        submissionId: row.submission_id,
        originalFilename: row.original_filename,
    }));
}

async function loadLegacySource(database: Queryable, assetId: string): Promise<MediaLegacySourceView | null> {
    const [row] = await database.unsafe<
        {
            media_class: string;
            legacy_origin: string | null;
            legacy_source: string | null;
            legacy_form: string | null;
            legacy_public: boolean;
            legacy_shown: boolean | null;
            media_revision: string | null;
            file_fetched_at: Date | null;
            local_url: string;
            stored_url: string | null;
            source_url: string | null;
        }[]
    >(
        `SELECT media_class, legacy_origin, legacy_source, legacy_form, legacy_public, legacy_shown, media_revision,
                file_fetched_at, local_url, stored_url, source_url
           FROM media_legacy_source WHERE media_asset_id = $1::bigint`,
        [assetId],
    );
    if (row === undefined) return null;
    return {
        mediaClass: row.media_class,
        legacyOrigin: row.legacy_origin,
        legacySource: row.legacy_source,
        legacyForm: row.legacy_form,
        legacyPublic: row.legacy_public,
        legacyShown: row.legacy_shown,
        mediaRevision: row.media_revision,
        fileFetchedAt: iso(row.file_fetched_at),
        localUrl: row.local_url,
        storedUrl: row.stored_url,
        sourceUrl: row.source_url,
    };
}

async function loadFiles(database: Queryable, assetId: string, publicId: string): Promise<MediaRepresentation[]> {
    const rows = await database.unsafe<
        {
            variant: string;
            storage_class: MediaRepresentation["storageClass"];
            mime_type: string;
            width: number | null;
            height: number | null;
            byte_size: string;
            sha256: string;
            derivative_recipe: string | null;
            recipe_version: string | null;
            created_at: Date;
            storage_key: string;
            corners_transparent: boolean | null;
            bytes_deleted_at: Date | null;
        }[]
    >(
        `SELECT variant, storage_class, mime_type, width, height, byte_size::text AS byte_size, sha256, derivative_recipe,
                recipe_version, created_at, storage_key, corners_transparent, bytes_deleted_at
           FROM media_file WHERE media_asset_id = $1::bigint
          ORDER BY CASE storage_class WHEN 'private_source' THEN 0 WHEN 'master' THEN 1 WHEN 'derivative' THEN 2 ELSE 3 END,
                   variant, created_at, id`,
        [assetId],
    );
    return rows.map((row) => ({
        variant: row.variant,
        storageClass: row.storage_class,
        mimeType: row.mime_type,
        width: row.width,
        height: row.height,
        byteSize: Number(row.byte_size),
        sha256: row.sha256,
        recipe: row.derivative_recipe,
        recipeVersion: row.recipe_version,
        createdAt: row.created_at.toISOString(),
        url: row.storage_class === "published" ? mediaPublicUrl(row.sha256) : null,
        privateUrl:
            row.storage_class === "derivative" && row.variant.startsWith("intern_")
                ? mediaEditorPreviewUrl(publicId, row.variant)
                : null,
        storageKey: row.storage_key,
        cornersTransparent: row.corners_transparent,
        bytesDeletedAt: iso(row.bytes_deleted_at),
    }));
}

/**
 * Alle Notaus-Einträge der Bytes dieses Assets, auch die an einem anderen Asset mit denselben Bytes ausgelösten. 🔴 Mit LEFT JOIN: Ist das auslösende Werk gelöscht
 * (Migration 0328), bleibt der Eintrag und gilt weiter; er nennt dann kein Werk (`triggeredOn` NULL).
 */
async function loadSuspensions(database: Queryable, assetId: string): Promise<MediaSuspensionView[]> {
    const rows = await database.unsafe<
        {
            revision: number;
            source_sha256: string;
            triggered_on: string | null;
            suspended_at: Date;
            lifted_at: Date | null;
            file_state: MediaSuspensionView["fileState"];
            reason: string;
            suspended_by: MediaPersonRef | null;
            lifted_by: MediaPersonRef | null;
            lift_reason: string | null;
        }[]
    >(
        `SELECT n.revision::int AS revision, n.source_sha256, a.public_id::text AS triggered_on, n.suspended_at, n.lifted_at,
                n.file_state, n.reason, ${personJson("sp")} AS suspended_by, ${personJson("lp")} AS lifted_by, n.lift_reason
           FROM media_publication_suspension n
           LEFT JOIN media_asset a ON a.id = n.media_asset_id
           LEFT JOIN avesmaps_auth.person sp ON sp.id = n.suspended_by_person
           LEFT JOIN avesmaps_auth.person lp ON lp.id = n.lifted_by_person
          WHERE n.source_sha256 IN (
                    SELECT f.sha256 FROM media_file f WHERE f.media_asset_id = $1::bigint AND f.storage_class = 'private_source'
                )
          ORDER BY n.suspended_at DESC, n.id DESC`,
        [assetId],
    );
    return rows.map((row) => ({
        revision: row.revision,
        sha256: row.source_sha256,
        triggeredOn: row.triggered_on,
        suspendedAt: row.suspended_at.toISOString(),
        liftedAt: iso(row.lifted_at),
        fileState: row.file_state,
        reason: row.reason,
        suspendedBy: row.suspended_by,
        liftedBy: row.lifted_by,
        liftReason: row.lift_reason,
    }));
}

/** Die jüngsten Einträge des Fachprotokolls zu diesem Asset (Akteur und Zeit stehen an der Operation). */
async function loadHistory(database: Queryable, publicId: string): Promise<MediaHistoryEntry[]> {
    const rows = await database.unsafe<
        {
            operation_id: string;
            at: Date;
            action: string;
            actor_kind: MediaHistoryEntry["actorKind"];
            target_revision: number | null;
            actor: MediaPersonRef | null;
            actor_label: string | null;
            decision: string | null;
        }[]
    >(
        `SELECT e.operation_id::text AS operation_id, o.at, e.action, o.actor_kind, e.target_revision::int AS target_revision,
                ${personJson("p")} AS actor, o.actor_label,
                CASE WHEN e.action = 'rights.reviewed' THEN e.details ->> 'decision' END AS decision
           FROM media_audit_event e
           JOIN media_operation o ON o.operation_id = e.operation_id
           LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
          WHERE e.media_asset_public_id = $1::uuid
          ORDER BY e.id DESC
          LIMIT ${String(MEDIA_HISTORY_LIMIT)}`,
        [publicId],
    );
    return rows.map((row) => ({
        operationId: row.operation_id,
        at: row.at.toISOString(),
        action: row.action,
        actorKind: row.actor_kind,
        targetRevision: row.target_revision,
        actor: row.actor,
        actorLabel: row.actor_label,
        ...(row.decision === null ? {} : { decision: row.decision }),
    }));
}

/**
 * Die Belege: am Asset selbst und an den nicht widerrufenen Freigaberegeln seiner Rechtsbasis (etwa die Fan-Richtlinie, die
 * EINMAL an der Regel hängt statt an 1.100 Assets). Die Datei eines Belegs hat keine Adresse; nur `hasFile` sagt, dass es sie gibt.
 */
async function loadEvidence(database: Queryable, assetId: string): Promise<MediaEvidenceView[]> {
    const rows = await database.unsafe<
        {
            evidence_kind: MediaEvidenceView["kind"];
            via_rule: boolean;
            has_file: boolean;
            external_url: string | null;
            issuer: string | null;
            recipient: string | null;
            dated_on: string | null;
            description: string | null;
            recorded_by: string | null;
            recorded_at: Date;
        }[]
    >(
        `SELECT e.evidence_kind, e.publication_rule_id IS NOT NULL AS via_rule, e.storage_key IS NOT NULL AS has_file,
                e.external_url, e.issuer, e.recipient, to_char(e.dated_on, 'YYYY-MM-DD') AS dated_on, e.description,
                e.recorded_by, e.recorded_at
           FROM media_rights_evidence e
          WHERE e.media_asset_id = $1::bigint
             OR e.publication_rule_id IN (
                    SELECT pr.id FROM publication_rule pr
                      JOIN media_rights r ON r.media_asset_id = $1::bigint
                     WHERE pr.revoked_on IS NULL AND pr.rights_basis = r.rights_basis
                       AND (pr.license_key IS NULL OR pr.license_key = r.license_key)
                )
          ORDER BY e.publication_rule_id IS NOT NULL, e.recorded_at, e.id`,
        [assetId],
    );
    return rows.map((row) => ({
        kind: row.evidence_kind,
        viaRule: row.via_rule,
        hasFile: row.has_file,
        externalUrl: row.external_url,
        issuer: row.issuer,
        recipient: row.recipient,
        datedOn: row.dated_on,
        description: row.description,
        recordedBy: row.recorded_by,
        recordedAt: row.recorded_at.toISOString(),
    }));
}

/** Die Werke, die in diesem aufgegangen sind, solange die Zusammenführung gilt (D1), neueste zuerst. */
async function loadMergedHere(database: Queryable, assetId: string): Promise<MediaAssetDetail["mergedHere"]> {
    const rows = await database<
        {
            asset_id: string;
            title: string | null;
            merged_at: Date;
            person_id: string | null;
            display_name: string | null;
        }[]
    >`
        SELECT a.public_id::text AS asset_id, a.title, m.merged_at, p.id::text AS person_id, p.display_name
          FROM media_merge m
          JOIN media_asset a ON a.id = m.merged_asset_id
          LEFT JOIN avesmaps_auth.person p ON p.id = m.merged_by_person
         WHERE m.kept_asset_id = ${assetId}::bigint AND m.lifted_at IS NULL
         ORDER BY m.merged_at DESC, m.id DESC
    `;
    return rows.map((row) => ({
        assetId: row.asset_id,
        title: row.title,
        mergedAt: row.merged_at.toISOString(),
        mergedBy:
            row.person_id === null || row.display_name === null
                ? null
                : { id: row.person_id, displayName: row.display_name },
    }));
}

interface SubmissionRow {
    public_id: string;
    revision: number;
    state: PhotoboxSubmissionView["zustand"];
    submitted_at: Date;
    description: string | null;
    pending_description: string | null;
    editor_message: string | null;
    creation_kind: PhotoboxSubmissionView["entstehung"];
    usage_grant: PhotoboxSubmissionView["nutzung"];
    view_direction: number | null;
    attribution_name: string | null;
    x: number;
    y: number;
    reference_kind: NonNullable<PhotoboxSubmissionView["bezug"]>["art"] | null;
    reference_key: string | null;
    terms_version: string;
    adjusted_by_editors: boolean;
    place_public_id: string | null;
    place_name: string | null;
    place_subtype: string | null;
}

/**
 * Die Einreichung eines Besuchers hinter diesem Asset (WI-0272 S3): nur, wenn es das AKTUELLE Bild der Einreichung ist (das des jüngsten Eingangs;
 * ein ersetztes ist abgelehnt und gehört nicht mehr zu ihr). `ortHatOrtsansicht` fragt die Auslieferung des Ortskopfs (`resolvePlaceMediaParts`):
 * Liefert der Ort eine Ortsansicht öffentlich aus, reiht sich ein Reisebild dahinter ein, sonst ersetzt es sein Typbild. Eine zweite Rechnung gäbe
 * es nicht, und eine Ortsansicht, die nicht öffentlich ist, zählt nicht (wie bei 2B).
 */
async function loadSubmission(database: Queryable, assetId: string): Promise<PhotoboxSubmissionView | undefined> {
    const [row] = await database<SubmissionRow[]>`
        SELECT s.public_id::text AS public_id, s.revision::int AS revision, s.state, s.submitted_at, s.description, s.pending_description,
               s.editor_message, s.creation_kind, s.usage_grant, s.view_direction::int AS view_direction, s.attribution_name,
               ST_X(s.geom) AS x, ST_Y(s.geom) AS y, s.reference_kind, s.reference_key, s.terms_version, s.adjusted_by_editors,
               p.public_id::text AS place_public_id, p.name AS place_name, p.subtype AS place_subtype
          FROM media_ingest i
          JOIN media_submission s ON s.id = i.submission_id
          LEFT JOIN place p ON p.id = s.place_id
         WHERE i.media_asset_id = ${assetId}::bigint
           AND NOT EXISTS (SELECT 1 FROM media_ingest j WHERE j.submission_id = i.submission_id AND j.id > i.id)
         LIMIT 1
    `;
    if (row === undefined) return undefined;
    let ort: PhotoboxSubmissionView["ort"];
    let ortHatOrtsansicht: boolean | undefined;
    if (row.place_public_id !== null && row.place_name !== null) {
        ort = {
            publicId: row.place_public_id,
            name: row.place_name,
            typ: headerGraphicOfPlace(row.place_subtype ?? undefined),
        };
        const { delivered } = await resolvePlaceMediaParts(database, row.place_public_id);
        ortHatOrtsansicht = delivered.some((sicht) => sicht.role === "header" && sicht.relation === "place_view");
    }
    return {
        publicId: row.public_id,
        revision: row.revision,
        zustand: row.state,
        eingereichtAm: row.submitted_at.toISOString(),
        beschreibung: row.description ?? "",
        ...(row.pending_description === null ? {} : { wartendeBeschreibung: row.pending_description }),
        ...(row.editor_message === null ? {} : { nachricht: row.editor_message }),
        entstehung: row.creation_kind,
        nutzung: row.usage_grant,
        ...(row.view_direction === null ? {} : { blickrichtung: row.view_direction }),
        ...(row.attribution_name === null ? {} : { name: row.attribution_name }),
        lage: { x: row.x, y: row.y },
        ...(ort === undefined ? {} : { ort }),
        ...(row.reference_kind === null || row.reference_key === null
            ? {}
            : { bezug: { art: row.reference_kind, id: row.reference_key } }),
        bedingungen: row.terms_version,
        angepasst: row.adjusted_by_editors,
        ...(ortHatOrtsansicht === undefined ? {} : { ortHatOrtsansicht }),
    };
}

/**
 * Der Kartenvorschlag hinter einem Bild aus einem Vorschlag (OPS-000093): Hängen mehrere am Bild, zählt der offene (er wartet auf die Redaktion), sonst der neueste. Die Redaktionsrechte prüft
 * die Oberfläche; die Route verlangt `view_media_private`, und der Vorschlag selbst ist nur über seine eigene Route lesbar.
 */
async function ladeKartenvorschlag(
    database: Queryable,
    assetId: string,
): Promise<{ id: string; nummer: string; zustand: string } | undefined> {
    const [zeile] = await database.unsafe<{ id: string; nummer: string; zustand: string }[]>(
        `SELECT public_id::text AS id, number::text AS nummer, state AS zustand
           FROM citymap_suggestion
          WHERE media_asset_id = $1::bigint
          ORDER BY (state IN ('pending', 'incoming', 'technical_failed')) DESC, id DESC
          LIMIT 1`,
        [assetId],
    );
    return zeile === undefined ? undefined : { ...zeile, nummer: kartenvorschlagNummer(zeile.nummer) };
}

/** Das Asset über seine öffentliche Kennung; `undefined`, wenn es das Asset nicht gibt. */
export async function assetDetail(database: Queryable, publicId: string): Promise<MediaAssetDetail | undefined> {
    const core = await loadCore(database, publicId);
    if (core === undefined) return undefined;
    const id = core.id;
    const [
        rights,
        creation,
        ingest,
        legacySource,
        representations,
        suspensions,
        history,
        evidence,
        others,
        usages,
        retired,
        mergedHere,
        submission,
        herkunft,
        erzeugte,
        sperren,
        ausVorschlag,
        kartenvorschlag,
        ausPhotobox,
    ] = await Promise.all([
        loadRights(database, id),
        loadCreation(database, id),
        loadIngest(database, id),
        loadLegacySource(database, id),
        loadFiles(database, id, publicId),
        loadSuspensions(database, id),
        loadHistory(database, publicId),
        loadEvidence(database, id),
        sameFileAssets(database, id),
        loadUsages(database, [id]),
        countRetired(database, [id]),
        loadMergedHere(database, id),
        loadSubmission(database, id),
        // „Vorschau erzeugen“ (WI-0287 Punkt 5): an einer erzeugten Vorschau ihre Karte, an einer Karte die erzeugten Vorschauen und die Sperre.
        erzeugtAusVon(database, [id]),
        core.asset_type === "map" ? erzeugteVon(database, id) : Promise.resolve([]),
        core.asset_type === "map"
            ? vorschauSperren(database, [id])
            : Promise.resolve(new Map<string, KarteVorschauSperre | null>()),
        // Ein Bild aus einem Kartenvorschlag (WI-0287): ob es nur noch an stillgelegten Einträgen hängt und damit gelöscht werden darf.
        core.origin === "community_upload" && core.source_system === KARTENVORSCHLAG_QUELLSYSTEM
            ? vorschlagsBild(database, id)
            : Promise.resolve(undefined),
        // Dasselbe Bild: zu welchem Vorschlag es gehört, damit der Inspector in die Redaktion führen kann (OPS-000093).
        core.origin === "community_upload" && core.source_system === KARTENVORSCHLAG_QUELLSYSTEM
            ? ladeKartenvorschlag(database, id)
            : Promise.resolve(undefined),
        // Ein PhotoBox-Bild (WI-0272): dieselben Fakten, mit denen das Löschen entscheidet (`photobox-loeschen.ts`), für den Knopf und das Blatt.
        core.origin === "community_upload" && core.source_system === PHOTOBOX_QUELLSYSTEM
            ? photoboxBild(database, id)
            : Promise.resolve(undefined),
    ]);
    const ausKarte = herkunft.get(id);
    return {
        asset: {
            id: core.public_id,
            revision: core.revision,
            title: core.title,
            kind: core.media_kind,
            assetType: core.asset_type,
            origin: core.origin,
            creationMethod: core.creation_method,
            technicalState: core.technical_state,
            moderationState: core.moderation_state,
            degradedOriginal: core.degraded_original,
            sourceSystem: core.source_system,
            sourceRef: core.source_ref,
            createdAt: core.created_at.toISOString(),
            updatedAt: core.updated_at.toISOString(),
            importedAt: iso(core.imported_at),
        },
        rights,
        creation,
        ingest,
        legacySource,
        representations,
        suspensions,
        usageCount: usages.get(id)?.length ?? 0,
        retiredUsageCount: retired.get(id) ?? 0,
        sharedFileCount: others.length,
        history,
        evidence,
        mergedHere,
        ...(submission === undefined ? {} : { submission }),
        ...(ausKarte === undefined ? {} : { erzeugtAus: ausKarte }),
        ...(core.asset_type === "map" ? { erzeugte, vorschauSperre: sperren.get(id) ?? null } : {}),
        ...(ausVorschlag === undefined
            ? {}
            : {
                  ausVorschlag: {
                      nurStillgelegt: ausVorschlag.nurStillgelegt,
                      eintraege: ausVorschlag.eintraege,
                      vorschauen: ausVorschlag.vorschauen.length,
                  },
              }),
        ...(kartenvorschlag === undefined ? {} : { kartenvorschlag }),
        ...(ausPhotobox === undefined
            ? {}
            : {
                  ausPhotobox: {
                      zustand: ausPhotobox.zustand,
                      aktiv: ausPhotobox.aktiv,
                      anderswo: ausPhotobox.anderswo,
                      ort: ausPhotobox.ort,
                  },
              }),
    };
}
