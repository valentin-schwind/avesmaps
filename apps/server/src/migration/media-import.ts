import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.ts";
import { createFinding, formatShare, type Finding, type FindingObject } from "../findings.ts";
import { parseMediaManifest, type MediaManifest } from "./media-manifest.ts";
import { assetTypeForRole } from "@avesmaps3d/shared";
import {
    CLASS_ROLE,
    MEDIA_CLASSES,
    MEDIA_CONTRACT_VERSION,
    MEDIA_SOURCE_SYSTEM,
    isMediaClass,
    type SubjectKind,
} from "./media-legacy.ts";
import {
    comparePublicToPrivate,
    planMedia,
    type MediaPlan,
    type PlannedAsset,
    type PlannedBinding,
    type SubjectIndex,
} from "./media-plan.ts";
import {
    PUBLICATION_RULE_SEEDS,
    ruleKeyLabel,
    ruleSeedStates,
    seedPublicationRules,
    type RuleSeedResult,
} from "./media-rules.ts";
import { diffSnapshots, publicationSnapshot, ruleSwitchFindings } from "./media-rule-switch.ts";
import { MAX_RETIRE_FRACTION } from "./retire-findings.ts";
import { nameUntitledAssets } from "../media-editor/titles.ts";
import {
    MERGED_SOURCE_CHANGED,
    mergedSourceChanged,
    readMergeRedirect,
    redirectMergedAssets,
} from "./media-merge-redirect.ts";

/**
 * Schreibt Legacys Medien als Metadaten idempotent in das Ziel (WI-0063 MEDIA-M8, Vertrag `media.yaml`, `umsetzung_m8_m10`): Assets,
 * Rechte, Erzeugungsnotizen, Legacy-Herkunft, Galerien (`place_media_gallery`), direkte Bindungen (Wappen, Cover, Karten),
 * Unterdrückungen und die Freigaberegeln mit Betreiberzitat. KEINE Datei, KEIN Byte: die Dateien kommen mit dem Binärimport
 * (`media-files.ts`); ein neues Asset steht bis dahin auf `technical_state pending`.
 *
 * EINE Transaktion für alles. Der zweite Lauf mit demselben Manifest schreibt nichts und rechnet nichts neu.
 *
 * 🔴 Medien sind keine redaktionellen Kartendaten, aber der Import schreibt in die Zieldatenbank: wie jeder Importer nur mit dem
 * Zuruf des Betreibers (die CLI rollt ohne `--operator-said` zurück, auch das Journal).
 * 🔴 Was ein Editor in Avesmaps3D gesetzt hat, überschreibt der Import nie: Bindungen und Unterdrückungen mit `origin editor`, und
 * Rechte, die schon geprüft sind (`reviewed_at`, `cleared`, `rejected`). Hochladestempel und Login werden einmal übernommen und nie
 * neu geschrieben.
 * 🔴 Schutzregel (Betreiber 2026-10-10: „nur die entscheidung darf nicht nachträglich kompromittiert werden“, WI-0068 P4a): kein Lauf hebt
 * eine Entscheidung eines Menschen auf. Er lässt stehen und meldet einen Befund (`held_by_editor`, `held_by_decision`): Bindung und
 * „bewusst ohne“ eines Editors, eine Galerie, die ein Editor angefasst hat (`media_gallery.origin editor`), eine Einzelfreigabe oder
 * -sperre an einer Verwendung (`publication_override`), Rechte oder Entstehungsart, die ein Editor im MAM gesetzt hat (Fachprotokoll
 * `rights.set`, `rights.reviewed`, `asset.metadata_set`), und eine widerrufene Freigaberegel.
 * 🔴 Ein Manifest ohne `items` im Export-B-Umfang (Export A, nur das Öffentliche) zieht nichts zurück: ein Bild, das A nicht nennt, ist
 * nur „nicht öffentlich“, nicht „aus Legacy verschwunden“.
 */

export const MEDIA_TABLES = [
    "media_asset",
    "media_rights",
    "media_creation",
    "media_legacy_source",
    "media_gallery",
    "media_gallery_item",
    "place_media_gallery",
    "place_media",
    "territory_media",
    "adventure_media",
    "citymap_media",
    "place_media_suppression",
    "territory_media_suppression",
] as const;
export type MediaTable = (typeof MEDIA_TABLES)[number];

export interface MediaTableReport {
    created: number;
    updated: number;
    unchanged: number;
    /** Zurückgezogen (`retired_at`) oder bei Unterdrückungen gelöscht. */
    retired: number;
    /** Wieder aktiviert, weil Legacy das Medium wieder nennt. */
    reappeared: number;
    /** Auf eine Zeile eines Editors gestoßen und nicht angefasst. */
    protectedRows: number;
}

const emptyReport = (): MediaTableReport => ({
    created: 0,
    updated: 0,
    unchanged: 0,
    retired: 0,
    reappeared: 0,
    protectedRows: 0,
});

export interface ImportMediaOptions {
    /** Rechnen und zählen, dann zurückrollen (auch das Journal). */
    dryRun?: boolean;
    /** Das öffentliche Manifest (A), wenn zusätzlich zu B eines vorliegt: nur zum Vergleich. */
    publicPayload?: unknown;
}

export interface ImportMediaReport {
    runId: string;
    sourceRef: string;
    dryRun: boolean;
    /** Das Manifest war unbrauchbar oder leer: nichts geschrieben, nichts zurückgezogen. */
    skipped: boolean;
    kind: MediaManifest["kind"] | null;
    mediaRevision: string;
    tables: Record<MediaTable, MediaTableReport>;
    byClass: MediaPlan["byClass"] | null;
    rules: RuleSeedResult;
    /**
     * Assets ohne Titel, die den Namen aus ihrem Fachobjekt bekamen (`media-editor/titles.ts`, Betreiber 2026-10-10), und die ein Mensch
     * bewusst ohne Titel ließ (nie angefasst).
     */
    titles: { named: number; keptHuman: number };
    changed: boolean;
    findings: Finding[];
}

class DryRunRollback extends Error {}

type SubjectTable = "place" | "territory" | "adventure" | "citymap";

const SUBJECT_COLUMNS: Readonly<Record<SubjectKind, { table: SubjectTable; name: string }>> = {
    place: { table: "place", name: "name" },
    territory: { table: "territory", name: "name" },
    adventure: { table: "adventure", name: "title" },
    citymap: { table: "citymap", name: "title" },
};

/** Die Fachobjekte des Ziels nach Legacy-UUID. Die Kennung ist `legacy_public_id`; ein Objekt ohne sie hat nie in Legacy gestanden. */
export async function readSubjectIndex(db: Queryable): Promise<SubjectIndex> {
    const index = {} as Record<SubjectKind, Map<string, { id: string; name: string | null }>>;
    for (const [kind, { table, name }] of Object.entries(SUBJECT_COLUMNS) as [
        SubjectKind,
        { table: SubjectTable; name: string },
    ][]) {
        const rows = await db.unsafe<{ id: string; legacy: string; name: string | null }[]>(
            `SELECT id::text AS id, legacy_public_id::text AS legacy, ${name} AS name FROM ${table} WHERE legacy_public_id IS NOT NULL`,
        );
        index[kind] = new Map(rows.map((row) => [row.legacy.toLowerCase(), { id: row.id, name: row.name }]));
    }
    return index;
}

interface ExistingAsset {
    id: string;
    publicId: string;
    key: string;
    origin: string;
    creationMethod: string;
    degradedOriginal: boolean;
    actor: string | null;
    uploadedAt: string | null;
    stampSemantics: string | null;
    hasRights: boolean;
    reviewed: boolean;
    basis: string | null;
    licenseKey: string | null;
    licenseFamily: string | null;
    clearance: string | null;
    legacyRightsCode: string | null;
    creator: string | null;
    attribution: string | null;
    rightsNote: string | null;
    hasCreation: boolean;
    noteRaw: string | null;
    hasSource: boolean;
    mediaClass: string | null;
    legacyOrigin: string | null;
    legacySource: string | null;
    legacyForm: string | null;
    storedUrl: string | null;
    localUrl: string | null;
    sourceUrl: string | null;
    legacyPublic: boolean | null;
    legacyShown: boolean | null;
    /** Ein Editor hat im MAM Rechte gesetzt oder geprüft (Fachprotokoll, WI-0068 P4a). */
    editorRights: boolean;
    /** Ein Editor hat im MAM die Art der Entstehung gesetzt. */
    editorMethod: boolean;
}

const TIMESTAMP = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/** Die Entscheidungen eines Editors im MAM stehen im Fachprotokoll (Migration 0086); vor 0086 gibt es keine. */
const EDITOR_RIGHTS = `EXISTS (SELECT 1 FROM media_audit_event e WHERE e.media_asset_public_id = a.public_id
                                AND e.action IN ('rights.set', 'rights.reviewed'))`;
const EDITOR_METHOD = `EXISTS (SELECT 1 FROM media_audit_event e WHERE e.media_asset_public_id = a.public_id
                                AND e.action = 'asset.metadata_set' AND e.details ->> 'creationMethod' IS NOT NULL)`;

async function readExistingAssets(tx: Queryable, mam: boolean): Promise<Map<string, ExistingAsset>> {
    const rows = await tx.unsafe<ExistingAsset[]>(
        `SELECT a.id::text AS id, a.public_id::text AS "publicId", a.source_ref AS key, a.origin, a.creation_method AS "creationMethod",
                ${mam ? EDITOR_RIGHTS : "FALSE"} AS "editorRights", ${mam ? EDITOR_METHOD : "FALSE"} AS "editorMethod",
                a.degraded_original AS "degradedOriginal", a.ingest_actor_legacy AS actor,
                to_char(a.legacy_uploaded_at AT TIME ZONE 'UTC', ${TIMESTAMP}) AS "uploadedAt", a.stamp_semantics AS "stampSemantics",
                r.media_asset_id IS NOT NULL AS "hasRights",
                coalesce(r.reviewed_at IS NOT NULL OR r.clearance_state IN ('cleared', 'rejected'), FALSE) AS reviewed,
                r.rights_basis AS basis, r.license_key AS "licenseKey", r.license_family AS "licenseFamily",
                r.clearance_state AS clearance, r.legacy_rights_code AS "legacyRightsCode", r.creator, r.attribution,
                r.rights_note AS "rightsNote",
                c.media_asset_id IS NOT NULL AS "hasCreation", c.legacy_note_raw AS "noteRaw",
                s.media_asset_id IS NOT NULL AS "hasSource", s.media_class AS "mediaClass", s.legacy_origin AS "legacyOrigin",
                s.legacy_source AS "legacySource", s.legacy_form AS "legacyForm", s.stored_url AS "storedUrl", s.local_url AS "localUrl",
                s.source_url AS "sourceUrl", s.legacy_public AS "legacyPublic", s.legacy_shown AS "legacyShown"
         FROM media_asset a
         LEFT JOIN media_rights r ON r.media_asset_id = a.id
         LEFT JOIN media_creation c ON c.media_asset_id = a.id
         LEFT JOIN media_legacy_source s ON s.media_asset_id = a.id
         WHERE a.source_system = '${MEDIA_SOURCE_SYSTEM}' AND a.source_ref IS NOT NULL`,
    );
    return new Map(rows.map((row) => [row.key, row]));
}

const sameText = (a: string | null | undefined, b: string | null | undefined): boolean => (a ?? null) === (b ?? null);

/** Die Art der Entstehung gehört nicht mehr dem Import, wenn die Rechte geprüft sind oder ein Editor sie gesetzt hat. */
const methodHeld = (existing: ExistingAsset): boolean => existing.reviewed || existing.editorMethod;

/** Die Rechte gehören nicht mehr dem Import, wenn sie geprüft sind oder ein Editor sie im MAM gesetzt hat. */
const rightsHeld = (existing: ExistingAsset): boolean => existing.reviewed || existing.editorRights;

type Hold = (code: string, message: string, object: FindingObject) => void;

const HELD_BY_DECISION =
    "Entscheidungen eines Menschen in Avesmaps3D (geprüfte oder im MAM gesetzte Rechte und Entstehungsart, Einzelfreigabe oder -sperre einer Verwendung, widerrufene Freigaberegel): der Import lässt sie stehen (Legacy sagt anderes)";
const EINBILD_UMGESTELLT =
    "Orte, deren Legacy-Galerie mit genau einem Bild jetzt ein Titelbild ist (Betreiber 2026-10-17, über den Zug): Bindung statt Galerieeintrag, Bild, Rechte und Freigabe bleiben";
const HELD_BY_EDITOR =
    "Medien, bei denen ein Editor in Avesmaps3D entschieden hat: der Import überschreibt es nie (Legacy sagt anderes)";

/** Sammelt die Befunde je Code; gemeinsam für Assets, Bindungen und Galerien. */
function holder(findings: Map<string, { message: string; objects: FindingObject[] }>): Hold {
    return (code, message, object) => {
        const entry = findings.get(code) ?? { message, objects: [] };
        entry.objects.push(object);
        findings.set(code, entry);
    };
}

function assetNeedsUpdate(existing: ExistingAsset, planned: PlannedAsset): boolean {
    return (
        existing.origin !== planned.origin ||
        (!methodHeld(existing) && existing.creationMethod !== planned.creationMethod) ||
        existing.degradedOriginal !== planned.degradedOriginal ||
        (existing.actor === null && planned.ingestActorLegacy !== null) ||
        (existing.uploadedAt === null && planned.legacyUploadedAt !== null) ||
        (existing.stampSemantics === null && planned.stampSemantics !== null)
    );
}

function rightsDiffer(existing: ExistingAsset, planned: PlannedAsset): boolean {
    const rights = planned.rights;
    return !(
        sameText(existing.basis, rights.basis) &&
        sameText(existing.licenseKey, rights.licenseKey) &&
        sameText(existing.licenseFamily, rights.licenseFamily) &&
        sameText(existing.clearance, rights.clearance) &&
        sameText(existing.legacyRightsCode, rights.legacyRightsCode) &&
        sameText(existing.creator, rights.creator) &&
        sameText(existing.attribution, rights.attribution) &&
        sameText(existing.rightsNote, rights.rightsNote)
    );
}

/**
 * Die Revision des Manifests (`media_revision`) gehört nicht zum Vergleich: sie wechselt bei jeder Änderung irgendwo in Legacy und ist
 * keine fachliche Änderung dieses Bildes. Sie zieht nur mit, wenn die Zeile ohnehin geschrieben wird.
 */
function sourceDiffers(existing: ExistingAsset, planned: PlannedAsset): boolean {
    const legacy = planned.legacy;
    return !(
        existing.hasSource &&
        sameText(existing.mediaClass, legacy.mediaClass) &&
        sameText(existing.legacyOrigin, legacy.legacyOrigin) &&
        sameText(existing.legacySource, legacy.legacySource) &&
        sameText(existing.legacyForm, legacy.legacyForm) &&
        sameText(existing.storedUrl, legacy.storedUrl) &&
        sameText(existing.localUrl, legacy.localUrl) &&
        sameText(existing.sourceUrl, legacy.sourceUrl) &&
        existing.legacyPublic === legacy.legacyPublic &&
        (existing.legacyShown ?? null) === legacy.legacyShown
    );
}

/**
 * Die Provenienz `media_ingest` (WI-0068 P1, Migration 0086): je Legacy-Asset genau eine Zeile `legacy_import` mit dem anlegenden Lauf.
 * Login und Stempel stehen bis zum Schritt „entfernen“ an BEIDEN Stellen (Asset und Ingest) und werden an beiden gleich geführt: einmal
 * übernommen, nie neu geschrieben. Die Zeile zieht mit dem Asset mit und hat keine eigene Zählung im Bericht. Fehlt die Tabelle (Datenbank
 * vor 0086), schreibt der Import wie bisher nur das Asset.
 */
async function ingestTablePresent(tx: Queryable): Promise<boolean> {
    const [row] = await tx<{ present: boolean }[]>`SELECT to_regclass('public.media_ingest') IS NOT NULL AS present`;
    return row?.present === true;
}

async function insertLegacyIngest(tx: Queryable, assetId: string, runId: string, asset: PlannedAsset): Promise<void> {
    await tx`
        INSERT INTO media_ingest (media_asset_id, ingest_kind, migration_run_id, legacy_actor_label, legacy_uploaded_at,
                                  legacy_stamp_semantics, source_system, source_ref)
        VALUES (${assetId}, 'legacy_import', ${runId}, ${asset.ingestActorLegacy}, ${asset.legacyUploadedAt}, ${asset.stampSemantics},
                ${MEDIA_SOURCE_SYSTEM}, ${asset.key})
    `;
}

async function completeLegacyIngest(tx: Queryable, assetId: string, asset: PlannedAsset): Promise<void> {
    await tx`
        UPDATE media_ingest
        SET legacy_actor_label = coalesce(legacy_actor_label, ${asset.ingestActorLegacy}),
            legacy_uploaded_at = coalesce(legacy_uploaded_at, ${asset.legacyUploadedAt}),
            legacy_stamp_semantics = coalesce(legacy_stamp_semantics, ${asset.stampSemantics})
        WHERE media_asset_id = ${assetId} AND ingest_kind = 'legacy_import'
          AND (legacy_actor_label IS NULL OR legacy_uploaded_at IS NULL OR legacy_stamp_semantics IS NULL)
    `;
}

/** Legt Assets, Rechte, Notizen und Legacy-Herkunft an oder gleicht sie ab. Liefert Schlüssel -> Asset-ID. */
async function writeAssets(
    tx: Queryable,
    runId: string,
    plan: MediaPlan,
    tables: Record<MediaTable, MediaTableReport>,
    hold: Hold,
    mam: boolean,
): Promise<{ idByKey: Map<string, string>; existing: Map<string, ExistingAsset> }> {
    const existing = await readExistingAssets(tx, mam);
    const withIngest = mam;
    const idByKey = new Map<string, string>();
    for (const asset of plan.assets) {
        const row = existing.get(asset.key);
        // Export A kennt weder Stempel noch Notiz noch Einstufung mit Stempel: was ein früherer Lauf mit Export B über dieses Asset
        // wusste (nur B setzt `legacy_shown`), schreibt A nie zurück auf einen ärmeren Stand.
        if (plan.kind === "public" && row !== undefined && row.legacyShown !== null) {
            idByKey.set(asset.key, row.id);
            tables.media_asset.unchanged += 1;
            tables.media_rights.unchanged += 1;
            tables.media_legacy_source.unchanged += 1;
            continue;
        }
        let id: string;
        if (row === undefined) {
            const [inserted] = await tx<{ id: string }[]>`
                INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, degraded_original,
                                         moderation_state, source_system, source_ref, ingest_actor_legacy, legacy_uploaded_at,
                                         stamp_semantics, migration_run_id, imported_at)
                VALUES ('image', ${assetTypeOfClass(asset.legacy.mediaClass)}, ${asset.origin}, ${asset.creationMethod}, 'pending',
                        ${asset.degradedOriginal}, 'not_applicable',
                        ${MEDIA_SOURCE_SYSTEM}, ${asset.key}, ${asset.ingestActorLegacy}, ${asset.legacyUploadedAt},
                        ${asset.stampSemantics}, ${runId}, now())
                RETURNING id::text
            `;
            if (inserted === undefined) throw new Error(`media_asset: ${asset.key} nicht angelegt`);
            id = inserted.id;
            tables.media_asset.created += 1;
            if (withIngest) await insertLegacyIngest(tx, id, runId, asset);
        } else {
            id = row.id;
            const assetObject: FindingObject = { table: "media_asset", publicId: row.publicId, name: asset.key };
            if (methodHeld(row) && row.creationMethod !== asset.creationMethod) {
                hold("held_by_decision", HELD_BY_DECISION, assetObject);
            }
            if (assetNeedsUpdate(row, asset)) {
                await tx`
                    UPDATE media_asset
                    SET origin = ${asset.origin},
                        creation_method = CASE WHEN ${methodHeld(row)} THEN creation_method ELSE ${asset.creationMethod} END,
                        degraded_original = ${asset.degradedOriginal},
                        ingest_actor_legacy = coalesce(ingest_actor_legacy, ${asset.ingestActorLegacy}),
                        legacy_uploaded_at = coalesce(legacy_uploaded_at, ${asset.legacyUploadedAt}),
                        stamp_semantics = coalesce(stamp_semantics, ${asset.stampSemantics}),
                        migration_run_id = ${runId}, updated_at = now()
                    WHERE id = ${id}
                `;
                tables.media_asset.updated += 1;
                if (withIngest) await completeLegacyIngest(tx, id, asset);
            } else {
                tables.media_asset.unchanged += 1;
            }
        }
        idByKey.set(asset.key, id);

        // Rechte: 1:1. Schon geprüfte Rechte (reviewed_at, cleared, rejected) und Rechte eines Editors schreibt der Import nie über.
        if (row === undefined || !row.hasRights) {
            await tx`
                INSERT INTO media_rights (media_asset_id, rights_basis, license_key, license_family, legacy_rights_code, creator,
                                          attribution, rights_note, clearance_state)
                VALUES (${id}, ${asset.rights.basis}, ${asset.rights.licenseKey}, ${asset.rights.licenseFamily},
                        ${asset.rights.legacyRightsCode}, ${asset.rights.creator}, ${asset.rights.attribution},
                        ${asset.rights.rightsNote}, ${asset.rights.clearance})
            `;
            tables.media_rights.created += 1;
        } else if (rightsHeld(row)) {
            tables.media_rights.protectedRows += 1;
            if (rightsDiffer(row, asset)) {
                hold("held_by_decision", HELD_BY_DECISION, {
                    table: "media_asset",
                    publicId: row.publicId,
                    name: asset.key,
                });
            }
        } else if (rightsDiffer(row, asset)) {
            await tx`
                UPDATE media_rights
                SET rights_basis = ${asset.rights.basis}, license_key = ${asset.rights.licenseKey},
                    license_family = ${asset.rights.licenseFamily}, legacy_rights_code = ${asset.rights.legacyRightsCode},
                    creator = ${asset.rights.creator}, attribution = ${asset.rights.attribution},
                    rights_note = ${asset.rights.rightsNote}, clearance_state = ${asset.rights.clearance}, updated_at = now()
                WHERE media_asset_id = ${id}
            `;
            tables.media_rights.updated += 1;
        } else {
            tables.media_rights.unchanged += 1;
        }

        // Erzeugungsnotiz (Kommentar und Prompt gemischt, unverändert): nur die eine Spalte gehört dem Import.
        if (asset.legacyNoteRaw !== null) {
            if (row === undefined || !row.hasCreation) {
                await tx`INSERT INTO media_creation (media_asset_id, legacy_note_raw) VALUES (${id}, ${asset.legacyNoteRaw})`;
                tables.media_creation.created += 1;
            } else if (!sameText(row.noteRaw, asset.legacyNoteRaw)) {
                await tx`UPDATE media_creation SET legacy_note_raw = ${asset.legacyNoteRaw}, updated_at = now() WHERE media_asset_id = ${id}`;
                tables.media_creation.updated += 1;
            } else {
                tables.media_creation.unchanged += 1;
            }
        } else if (row?.hasCreation === true && row.noteRaw !== null) {
            await tx`UPDATE media_creation SET legacy_note_raw = NULL, updated_at = now() WHERE media_asset_id = ${id}`;
            tables.media_creation.updated += 1;
        }

        // Legacy-Herkunft: der Import führt jede Spalte.
        if (row === undefined || sourceDiffers(row, asset)) {
            const legacy = asset.legacy;
            await tx`
                INSERT INTO media_legacy_source (media_asset_id, media_class, legacy_origin, legacy_source, legacy_form, stored_url,
                                                 local_url, source_url, legacy_public, legacy_shown, media_revision)
                VALUES (${id}, ${legacy.mediaClass}, ${legacy.legacyOrigin}, ${legacy.legacySource}, ${legacy.legacyForm},
                        ${legacy.storedUrl}, ${legacy.localUrl}, ${legacy.sourceUrl}, ${legacy.legacyPublic}, ${legacy.legacyShown},
                        ${plan.mediaRevision === "" ? null : plan.mediaRevision})
                ON CONFLICT (media_asset_id) DO UPDATE
                SET media_class = EXCLUDED.media_class, legacy_origin = EXCLUDED.legacy_origin, legacy_source = EXCLUDED.legacy_source,
                    legacy_form = EXCLUDED.legacy_form, stored_url = EXCLUDED.stored_url, local_url = EXCLUDED.local_url,
                    source_url = EXCLUDED.source_url, legacy_public = EXCLUDED.legacy_public, legacy_shown = EXCLUDED.legacy_shown,
                    media_revision = EXCLUDED.media_revision, updated_at = now()
            `;
            if (row?.hasSource === true) tables.media_legacy_source.updated += 1;
            else tables.media_legacy_source.created += 1;
        } else {
            tables.media_legacy_source.unchanged += 1;
        }
    }
    // Der Asset-Typ (Migration 0095) für Assets, die ein früheres Release ohne ihn anlegte: aus der Klasse, nur wo er fehlt. Ein gesetzter
    // Typ bleibt (kein Import hebt eine Entscheidung auf, Betreiber 2026-10-10).
    await tx`
        UPDATE media_asset a
           SET asset_type = CASE ls.media_class
                   WHEN 'settlement_coat' THEN 'coat' WHEN 'territory_coat' THEN 'coat' WHEN 'settlement_image' THEN 'picture'
                   WHEN 'citymap_full' THEN 'map' WHEN 'citymap_preview' THEN 'map_preview' WHEN 'literature_cover' THEN 'cover'
               END
          FROM media_legacy_source ls
         WHERE ls.media_asset_id = a.id AND a.asset_type IS NULL AND ls.media_class = ANY(${[...MEDIA_CLASSES]})
    `;
    return { idByKey, existing };
}

/** Der Asset-Typ eines Legacy-Bildes aus seiner Klasse (über die Rolle, EINE Tafel: `MEDIA_ASSET_TYPE_ROLES`). */
function assetTypeOfClass(mediaClass: string | null): string | null {
    return isMediaClass(mediaClass) ? assetTypeForRole(CLASS_ROLE[mediaClass]) : null;
}

// ---- Bindungen ----------------------------------------------------------------------------------------------------------------

interface BindingTable {
    table: "place_media" | "territory_media" | "adventure_media" | "citymap_media";
    subjectColumn: "place_id" | "territory_id" | "adventure_id" | "citymap_id";
    kind: SubjectKind;
    suppression: "place_media_suppression" | "territory_media_suppression" | null;
}

const BINDING_TABLES: readonly BindingTable[] = [
    { table: "place_media", subjectColumn: "place_id", kind: "place", suppression: "place_media_suppression" },
    {
        table: "territory_media",
        subjectColumn: "territory_id",
        kind: "territory",
        suppression: "territory_media_suppression",
    },
    { table: "adventure_media", subjectColumn: "adventure_id", kind: "adventure", suppression: null },
    { table: "citymap_media", subjectColumn: "citymap_id", kind: "citymap", suppression: null },
];

interface BindingRow {
    id: string;
    subject: string;
    assetId: string;
    role: string;
    origin: string;
    retired: boolean;
    /** Gehört das Asset dem Legacy-Import? Nur solche Bindungen darf ein Reimport zurückziehen. */
    sourced: boolean;
    /** Eine Einzelfreigabe oder -sperre an der Verwendung: eine Entscheidung, die kein Lauf aufhebt. */
    decided: boolean;
    assetPublicId: string;
}

interface SuppressionRow {
    subject: string;
    role: string;
    origin: string;
}

const slotOf = (subject: string, role: string): string => `${subject}|${role}`;

/**
 * Die Orte, an denen eine Galerie hängt, die einem Editor gehört (Bindung oder Galerie mit Herkunft `editor`). Dort setzt der Import kein
 * Titelbild: EIN Titelbild ODER EINE Galerie (WI-0219), und die Wahl des Editors gilt (Schutzregel).
 */
async function editorGalleryPlaces(tx: Queryable, mam: boolean): Promise<Set<string>> {
    const rows = await tx<{ placeId: string }[]>`
        SELECT b.place_id::text AS "placeId" FROM place_media_gallery b JOIN media_gallery g ON g.id = b.media_gallery_id
         WHERE b.role = 'header' AND b.retired_at IS NULL AND (b.origin = 'editor' OR ${mam ? tx`g.origin = 'editor'` : tx`FALSE`})
    `;
    return new Set(rows.map((row) => row.placeId));
}

async function writeBindings(
    tx: Queryable,
    plan: MediaPlan,
    index: SubjectIndex,
    idByKey: ReadonlyMap<string, string>,
    tables: Record<MediaTable, MediaTableReport>,
    hold: Hold,
    mam: boolean,
): Promise<{ retiring: number; active: number }> {
    let retiring = 0;
    let active = 0;
    const editorGalleries = await editorGalleryPlaces(tx, mam);
    for (const spec of BINDING_TABLES) {
        const report = tables[spec.table];
        const plannedBindings = plan.bindings.filter((binding) => binding.subjectKind === spec.kind);
        const bySlot = new Map<string, PlannedBinding>();
        for (const binding of plannedBindings) {
            const subject = index[spec.kind].get(binding.subjectPublicId);
            if (subject !== undefined) bySlot.set(slotOf(subject.id, binding.role), binding);
        }
        const rows = await tx.unsafe<BindingRow[]>(
            `SELECT m.id::text AS id, m.${spec.subjectColumn}::text AS subject, m.media_asset_id::text AS "assetId", m.role, m.origin,
                    m.retired_at IS NOT NULL AS retired, a.source_system = '${MEDIA_SOURCE_SYSTEM}' AS sourced,
                    m.publication_override <> 'none' AS decided, a.public_id::text AS "assetPublicId"
             FROM ${spec.table} m JOIN media_asset a ON a.id = m.media_asset_id`,
        );
        const suppressions: SuppressionRow[] =
            spec.suppression === null
                ? []
                : await tx.unsafe<SuppressionRow[]>(
                      `SELECT ${spec.subjectColumn}::text AS subject, role, origin FROM ${spec.suppression}`,
                  );
        const suppressionBySlot = new Map(suppressions.map((row) => [slotOf(row.subject, row.role), row]));
        const plannedSuppressions = new Set<string>();

        // 1. Unterdrückungen (nur Orte und Gebiete): erst die aktive Legacy-Bindung der Rolle zurückziehen, dann die Zeile.
        if (spec.suppression !== null) {
            const suppressionReport = tables[spec.suppression];
            for (const suppression of plan.suppressions.filter((entry) => entry.subjectKind === spec.kind)) {
                const subject = index[spec.kind].get(suppression.subjectPublicId);
                if (subject === undefined) continue;
                const slot = slotOf(subject.id, suppression.role);
                plannedSuppressions.add(slot);
                const object: FindingObject = {
                    table: spec.kind,
                    publicId: suppression.subjectPublicId,
                    name: subject.name,
                };
                const activeRows = rows.filter((row) => slotOf(row.subject, row.role) === slot && !row.retired);
                if (activeRows.some((row) => row.origin === "editor" || row.decided)) {
                    suppressionReport.protectedRows += 1;
                    const byEditor = activeRows.some((row) => row.origin === "editor");
                    hold(
                        byEditor ? "held_by_editor" : "held_by_decision",
                        byEditor ? HELD_BY_EDITOR : HELD_BY_DECISION,
                        object,
                    );
                    continue;
                }
                for (const row of activeRows) {
                    await tx.unsafe(
                        `UPDATE ${spec.table} SET retired_at = now(), updated_at = now() WHERE id = ${row.id}`,
                    );
                    row.retired = true;
                    report.retired += 1;
                }
                if (suppressionBySlot.has(slot)) {
                    suppressionReport.unchanged += 1;
                } else {
                    await tx.unsafe(
                        `INSERT INTO ${spec.suppression} (${spec.subjectColumn}, role, origin, legacy_reason) VALUES (${subject.id}, '${suppression.role}', 'legacy', $1)`,
                        [suppression.key],
                    );
                    suppressionReport.created += 1;
                }
            }
        }

        // 2. Bindungen: das geplante Asset ist aktiv, alles andere der Legacy-Herkunft in der Rolle wird zurückgezogen.
        for (const [slot, binding] of bySlot) {
            const subject = index[spec.kind].get(binding.subjectPublicId);
            const assetId = idByKey.get(binding.key);
            if (subject === undefined || assetId === undefined) continue;
            const object: FindingObject = { table: spec.kind, publicId: binding.subjectPublicId, name: subject.name };
            const suppression = suppressionBySlot.get(slot);
            if (suppression !== undefined && suppression.origin === "editor") {
                report.protectedRows += 1;
                hold("held_by_editor", HELD_BY_EDITOR, object);
                continue;
            }
            // Ein Titelbild aus Legacy, wo ein Editor eine Galerie gewählt hat: Die Galerie bleibt (WI-0219, Schutzregel).
            const titelbild = spec.kind === "place" && binding.role === "header";
            if (titelbild && editorGalleries.has(subject.id)) {
                report.protectedRows += 1;
                hold("held_by_editor", HELD_BY_EDITOR, object);
                continue;
            }
            const slotRows = rows.filter((row) => slotOf(row.subject, row.role) === slot);
            const activeRows = slotRows.filter((row) => !row.retired);
            if (activeRows.some((row) => row.origin === "editor" && row.assetId !== assetId)) {
                report.protectedRows += 1;
                hold("held_by_editor", HELD_BY_EDITOR, object);
                continue;
            }
            // Eine Einzelfreigabe oder -sperre an der Bindung, die Legacy jetzt ersetzen würde: stehen lassen, nie übertragen.
            if (activeRows.some((row) => row.decided && row.assetId !== assetId)) {
                report.protectedRows += 1;
                hold("held_by_decision", HELD_BY_DECISION, object);
                continue;
            }
            // Legacy nennt jetzt ein Medium: eine frühere Legacy-Unterdrückung in der Rolle fällt weg.
            if (suppression !== undefined && spec.suppression !== null) {
                await tx.unsafe(
                    `DELETE FROM ${spec.suppression} WHERE ${spec.subjectColumn} = ${subject.id} AND role = $1`,
                    [binding.role],
                );
                tables[spec.suppression].retired += 1;
            }
            // EIN Titelbild ODER EINE Galerie (WI-0219): Legacys Galerie an diesem Ort wird gelöst, ihre Einträge zieht der
            // Galerieschritt zurück (die Galerie nennt Legacy nicht mehr).
            if (titelbild) {
                const geloest = await tx`
                    UPDATE place_media_gallery SET retired_at = now(), updated_at = now()
                     WHERE place_id = ${subject.id} AND role = 'header' AND retired_at IS NULL AND origin = 'legacy'
                    RETURNING id
                `;
                tables.place_media_gallery.retired += geloest.length;
            }
            const own = activeRows.find((row) => row.assetId === assetId);
            for (const row of activeRows) {
                if (row === own || row.origin === "editor") continue;
                await tx.unsafe(`UPDATE ${spec.table} SET retired_at = now(), updated_at = now() WHERE id = ${row.id}`);
                row.retired = true;
                report.retired += 1;
            }
            if (own !== undefined) {
                if (own.origin !== binding.origin && own.origin !== "editor") {
                    await tx.unsafe(`UPDATE ${spec.table} SET origin = $1, updated_at = now() WHERE id = ${own.id}`, [
                        binding.origin,
                    ]);
                    report.updated += 1;
                } else {
                    report.unchanged += 1;
                }
                continue;
            }
            const back = slotRows.find((row) => row.assetId === assetId && row.retired);
            if (back !== undefined) {
                await tx.unsafe(
                    `UPDATE ${spec.table} SET retired_at = NULL, origin = $1, updated_at = now() WHERE id = ${back.id}`,
                    [binding.origin],
                );
                report.reappeared += 1;
            } else {
                await tx.unsafe(
                    `INSERT INTO ${spec.table} (${spec.subjectColumn}, media_asset_id, role, origin) VALUES (${subject.id}, ${assetId}, $1, $2)`,
                    [binding.role, binding.origin],
                );
                report.created += 1;
            }
        }

        // 3. Zurückziehen, was Legacy nicht mehr nennt: nur mit dem vollständigen Manifest (B) und nur Legacy-eigene Zeilen.
        if (plan.kind === "private") {
            for (const row of rows) {
                // Schon in 1 oder 2 zurückgezogen (Unterdrückung, ersetztes Medium) oder nicht Legacys: nicht zählen.
                if (row.retired || !row.sourced || row.origin === "editor") continue;
                active += 1;
                // Ein Platz, den dieses Manifest besetzt, ist oben behandelt (das geplante Asset ist aktiv).
                if (bySlot.has(slotOf(row.subject, row.role))) continue;
                if (row.decided) {
                    report.protectedRows += 1;
                    hold("held_by_decision", HELD_BY_DECISION, {
                        table: spec.table,
                        publicId: row.assetPublicId,
                        name: null,
                    });
                    continue;
                }
                await tx.unsafe(`UPDATE ${spec.table} SET retired_at = now(), updated_at = now() WHERE id = ${row.id}`);
                report.retired += 1;
                retiring += 1;
            }
            // Eine Legacy-Unterdrückung, die Legacy nicht mehr nennt, fällt weg (Legacy hat die Entscheidung zurückgenommen).
            if (spec.suppression !== null) {
                for (const row of suppressions) {
                    const slot = slotOf(row.subject, row.role);
                    if (row.origin !== "legacy" || plannedSuppressions.has(slot) || bySlot.has(slot)) continue;
                    await tx.unsafe(
                        `DELETE FROM ${spec.suppression} WHERE ${spec.subjectColumn} = ${row.subject} AND role = $1`,
                        [row.role],
                    );
                    tables[spec.suppression].retired += 1;
                }
            }
        }
    }
    return { retiring, active };
}

// ---- Galerien -----------------------------------------------------------------------------------------------------------------

interface GalleryRow {
    id: string;
    ref: string;
    /** `editor`: ein Editor hat die Galerie angefasst (WI-0068 P4a); der Import gleicht sie nicht mehr ab. */
    origin: string;
}

interface GalleryBindingRow {
    id: string;
    placeId: string;
    galleryId: string;
    origin: string;
    retired: boolean;
}

interface ItemRow {
    id: string;
    galleryId: string;
    assetId: string;
    sortOrder: number;
    retired: boolean;
    sourced: boolean;
    decided: boolean;
    assetPublicId: string;
}

async function writeGalleries(
    tx: Queryable,
    runId: string,
    plan: MediaPlan,
    index: SubjectIndex,
    idByKey: ReadonlyMap<string, string>,
    tables: Record<MediaTable, MediaTableReport>,
    hold: Hold,
    mam: boolean,
): Promise<{ retiring: number; active: number }> {
    let retiring = 0;
    let active = 0;
    const galleries = await tx<GalleryRow[]>`
        SELECT id::text, source_ref AS ref, ${mam ? tx`origin` : tx`'legacy'`} AS origin
        FROM media_gallery WHERE source_system = ${MEDIA_SOURCE_SYSTEM} AND source_ref IS NOT NULL
    `;
    const galleryByRef = new Map(galleries.map((row) => [row.ref, row]));
    const bindings = await tx<GalleryBindingRow[]>`
        SELECT id::text, place_id::text AS "placeId", media_gallery_id::text AS "galleryId", origin, retired_at IS NOT NULL AS retired
        FROM place_media_gallery WHERE role = 'header'
    `;
    const items = await tx<ItemRow[]>`
        SELECT i.id::text, i.gallery_id::text AS "galleryId", i.media_asset_id::text AS "assetId", i.sort_order AS "sortOrder",
               i.retired_at IS NOT NULL AS retired, a.source_system = ${MEDIA_SOURCE_SYSTEM} AS sourced,
               i.publication_override <> 'none' AS decided, a.public_id::text AS "assetPublicId"
        FROM media_gallery_item i JOIN media_asset a ON a.id = i.media_asset_id
    `;
    const suppressedPlaces = new Set(
        (
            await tx<
                { placeId: string }[]
            >`SELECT place_id::text AS "placeId" FROM place_media_suppression WHERE role = 'header'`
        ).map((row) => row.placeId),
    );
    // Ein Einzelbild, das ein Editor als Titelbild gesetzt hat (WI-0219: EIN Titelbild ODER EINE Galerie), hält den Platz wie eine
    // Unterdrückung: Legacys Galerie bleibt gelöst, sonst hinge am Ort beides.
    const editorImagePlaces = new Set(
        (
            await tx<{ placeId: string }[]>`
                SELECT place_id::text AS "placeId" FROM place_media
                 WHERE role = 'header' AND retired_at IS NULL AND origin = 'editor'
            `
        ).map((row) => row.placeId),
    );
    const plannedRefs = new Set(plan.galleries.map((gallery) => gallery.ref));
    // Titelbilder aus Legacy (Einzelbild am Ort): Sie weichen einer Galerie, die Legacy jetzt nennt.
    const legacyImages = await tx<{ id: string; placeId: string; retired: boolean; decided: boolean }[]>`
        SELECT id::text, place_id::text AS "placeId", retired_at IS NOT NULL AS retired, publication_override <> 'none' AS decided
          FROM place_media WHERE role = 'header' AND origin <> 'editor' AND retired_at IS NULL
    `;
    // Eintrag einer Galerie, die Legacy nicht mehr nennt, weil ihr einziges Bild jetzt das Titelbild des Orts ist: eine Umstellung
    // (Betreiber 2026-10-17, „A, über den Zug“), kein Rückzug; die Stilllegequote zählt sie nicht.
    const titelbildVon = new Set(
        plan.bindings
            .filter((binding) => binding.subjectKind === "place" && binding.role === "header")
            .map((binding) => {
                const place = index.place.get(binding.subjectPublicId);
                const assetId = idByKey.get(binding.key);
                return place === undefined || assetId === undefined ? "" : `${place.id}|${assetId}`;
            }),
    );
    const umgestellt: FindingObject[] = [];

    for (const gallery of plan.galleries) {
        const place = index.place.get(gallery.placePublicId);
        if (place === undefined) continue;
        const object: FindingObject = { table: "place", publicId: gallery.placePublicId, name: place.name };
        const placeBindings = bindings.filter((row) => row.placeId === place.id);
        const activeOthers = placeBindings.filter((row) => !row.retired);

        let galleryRow = galleryByRef.get(gallery.ref);
        const holdsHeader = suppressedPlaces.has(place.id) || editorImagePlaces.has(place.id);
        // Ein Titelbild aus Legacy mit Einzelentscheid (Freigabe oder Sperre), das die Galerie ersetzen würde: stehen lassen.
        const entschiedenesBild = legacyImages.find((row) => row.placeId === place.id && row.decided);
        if (!holdsHeader && entschiedenesBild !== undefined) {
            tables.place_media.protectedRows += 1;
            hold("held_by_decision", HELD_BY_DECISION, object);
            continue;
        }
        const editorBinding = activeOthers.find((row) => row.origin === "editor" && row.galleryId !== galleryRow?.id);
        // Eine Galerie, die ein Editor angefasst hat (Titelbild hinzugefügt, entfernt, umsortiert), gehört ihm: Reihenfolge, Einträge und
        // Bindung bleiben, wie er sie hinterließ.
        if (holdsHeader || editorBinding !== undefined || galleryRow?.origin === "editor") {
            tables.place_media_gallery.protectedRows += 1;
            hold("held_by_editor", HELD_BY_EDITOR, object);
            continue;
        }
        if (galleryRow === undefined) {
            const [inserted] = await tx<{ id: string }[]>`
                INSERT INTO media_gallery (gallery_kind, source_system, source_ref, migration_run_id)
                VALUES ('object_gallery', ${MEDIA_SOURCE_SYSTEM}, ${gallery.ref}, ${runId})
                RETURNING id::text
            `;
            if (inserted === undefined) throw new Error(`media_gallery: ${gallery.ref} nicht angelegt`);
            galleryRow = { id: inserted.id, ref: gallery.ref, origin: "legacy" };
            tables.media_gallery.created += 1;
        } else {
            tables.media_gallery.unchanged += 1;
        }

        // EIN Titelbild ODER EINE Galerie (WI-0219): Hat Legacy hier jetzt mehrere Bilder, weicht sein bisheriges Einzelbild.
        for (const bild of legacyImages.filter((row) => row.placeId === place.id && !row.retired)) {
            await tx`UPDATE place_media SET retired_at = now(), updated_at = now() WHERE id = ${bild.id}`;
            bild.retired = true;
            tables.place_media.retired += 1;
        }

        // Die Bindung Ort - Galerie: eine andere aktive Legacy-Galerie wird zurückgezogen, die eigene (wieder) aktiv.
        const own = placeBindings.find((row) => row.galleryId === galleryRow?.id);
        for (const other of activeOthers) {
            if (other === own || other.origin === "editor") continue;
            await tx`UPDATE place_media_gallery SET retired_at = now(), updated_at = now() WHERE id = ${other.id}`;
            tables.place_media_gallery.retired += 1;
        }
        if (own === undefined) {
            await tx`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${place.id}, ${galleryRow.id}, 'header', 'legacy')`;
            tables.place_media_gallery.created += 1;
        } else if (own.retired) {
            await tx`UPDATE place_media_gallery SET retired_at = NULL, origin = 'legacy', updated_at = now() WHERE id = ${own.id}`;
            tables.place_media_gallery.reappeared += 1;
        } else {
            tables.place_media_gallery.unchanged += 1;
        }

        // Die Einträge: Reihenfolge wie in Legacy; ein Eintrag, den Legacy nicht mehr nennt, wird zurückgezogen (nur mit B).
        const galleryId = galleryRow.id;
        const existingItems = items.filter((row) => row.galleryId === galleryId);
        const desired = new Map<string, number>();
        for (const item of gallery.items) {
            const assetId = idByKey.get(item.key);
            if (assetId !== undefined) desired.set(assetId, item.sortOrder);
        }
        const finalOrders = new Set(desired.values());
        let nextFree = Math.max(-1, ...existingItems.map((row) => row.sortOrder), ...finalOrders) + 1;
        // Wer eine geplante Stelle hält, ohne selbst geplant zu sein (zurückgezogen oder fremd), rückt beiseite.
        for (const row of existingItems) {
            if (desired.has(row.assetId)) continue;
            if (finalOrders.has(row.sortOrder)) {
                await tx`UPDATE media_gallery_item SET sort_order = ${nextFree}, updated_at = now() WHERE id = ${row.id}`;
                row.sortOrder = nextFree;
                nextFree += 1;
            }
        }
        for (const item of gallery.items) {
            const assetId = idByKey.get(item.key);
            if (assetId === undefined) continue;
            const row = existingItems.find((entry) => entry.assetId === assetId);
            if (row === undefined) {
                await tx`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${galleryId}, ${assetId}, ${item.sortOrder})`;
                tables.media_gallery_item.created += 1;
            } else if (row.retired || row.sortOrder !== item.sortOrder) {
                await tx`UPDATE media_gallery_item SET retired_at = NULL, sort_order = ${item.sortOrder}, updated_at = now() WHERE id = ${row.id}`;
                if (row.retired) tables.media_gallery_item.reappeared += 1;
                else tables.media_gallery_item.updated += 1;
            } else {
                tables.media_gallery_item.unchanged += 1;
            }
        }
        if (plan.kind === "private") {
            for (const row of existingItems) {
                if (row.retired || !row.sourced) continue;
                active += 1;
                if (desired.has(row.assetId)) continue;
                if (row.decided) {
                    tables.media_gallery_item.protectedRows += 1;
                    hold("held_by_decision", HELD_BY_DECISION, {
                        table: "media_gallery_item",
                        publicId: row.assetPublicId,
                        name: gallery.ref,
                    });
                    continue;
                }
                await tx`UPDATE media_gallery_item SET retired_at = now(), updated_at = now() WHERE id = ${row.id}`;
                tables.media_gallery_item.retired += 1;
                retiring += 1;
            }
        }
    }

    // Galerien, die Legacy nicht mehr nennt (kein Ort mit Bildern mehr): Einträge und Bindung zurückziehen, nur mit B.
    if (plan.kind === "private") {
        for (const row of galleries) {
            if (plannedRefs.has(row.ref)) continue;
            const editorBindung = bindings.some(
                (entry) => entry.galleryId === row.id && !entry.retired && entry.origin === "editor",
            );
            if (row.origin === "editor" || editorBindung) {
                tables.place_media_gallery.protectedRows += 1;
                hold("held_by_editor", HELD_BY_EDITOR, { table: "media_gallery", publicId: row.ref, name: null });
                continue;
            }
            const orteDerGalerie = bindings.filter((entry) => entry.galleryId === row.id).map((entry) => entry.placeId);
            for (const item of items.filter((entry) => entry.galleryId === row.id && !entry.retired && entry.sourced)) {
                const umstellung = orteDerGalerie.some((placeId) => titelbildVon.has(`${placeId}|${item.assetId}`));
                if (!umstellung) active += 1;
                if (item.decided) {
                    tables.media_gallery_item.protectedRows += 1;
                    hold("held_by_decision", HELD_BY_DECISION, {
                        table: "media_gallery_item",
                        publicId: item.assetPublicId,
                        name: row.ref,
                    });
                    continue;
                }
                if (umstellung) {
                    const ortKennung = row.ref.replace(/^settlement-gallery:/u, "");
                    umgestellt.push({
                        table: "place",
                        publicId: ortKennung,
                        name: index.place.get(ortKennung)?.name ?? null,
                    });
                } else retiring += 1;
                await tx`UPDATE media_gallery_item SET retired_at = now(), updated_at = now() WHERE id = ${item.id}`;
                tables.media_gallery_item.retired += 1;
            }
            for (const binding of bindings.filter(
                (entry) => entry.galleryId === row.id && !entry.retired && entry.origin === "legacy",
            )) {
                await tx`UPDATE place_media_gallery SET retired_at = now(), updated_at = now() WHERE id = ${binding.id}`;
                tables.place_media_gallery.retired += 1;
            }
        }
    }
    for (const objekt of umgestellt) hold("einbild_galerie_umgestellt", EINBILD_UMGESTELLT, objekt);
    return { retiring, active };
}

// ---- Lauf ---------------------------------------------------------------------------------------------------------------------

/**
 * Eine Freigaberegel, die der Import anlegen würde, die aber widerrufen ist, oder deren Vorgängerin widerrufen ist: Der Widerruf ist
 * eine Entscheidung (`seedPublicationRules` legt nie neu an und löst nie eine widerrufene Vorgängerin ab), hier steht dazu der Befund.
 */
async function holdRevokedRules(tx: Queryable, hold: Hold): Promise<void> {
    for (const { seed, state } of await ruleSeedStates(tx, PUBLICATION_RULE_SEEDS)) {
        if (state !== "revoked" && state !== "held") continue;
        const name = ruleKeyLabel(seed);
        hold("held_by_decision", HELD_BY_DECISION, {
            table: "publication_rule",
            publicId: name,
            name: state === "held" ? `${name} (Vorgängerin ${ruleKeyLabel(seed.supersedes ?? seed)} widerrufen)` : name,
        });
    }
}

export async function importMedia(
    database: Database,
    payload: unknown,
    options: ImportMediaOptions = {},
): Promise<ImportMediaReport> {
    const runId = randomUUID();
    const parsed = parseMediaManifest(payload);
    const sourceRef = `media-export.php; items=${String(Array.isArray((payload as { items?: unknown } | null)?.items) ? (payload as { items: unknown[] }).items.length : "unbekannt")}`;
    const report: ImportMediaReport = {
        runId,
        sourceRef,
        dryRun: options.dryRun === true,
        skipped: parsed.manifest === null,
        kind: parsed.manifest?.kind ?? null,
        mediaRevision: parsed.manifest?.mediaRevision ?? "",
        tables: Object.fromEntries(MEDIA_TABLES.map((name) => [name, emptyReport()])) as Record<
            MediaTable,
            MediaTableReport
        >,
        byClass: null,
        rules: { created: 0, present: 0, evidence: 0, superseded: 0, held: [] },
        titles: { named: 0, keptHuman: 0 },
        changed: false,
        findings: [...parsed.findings],
    };
    const manifest = parsed.manifest;
    if (manifest === null) return report;

    if (options.publicPayload !== undefined && manifest.kind === "private") {
        const publicParse = parseMediaManifest(options.publicPayload);
        report.findings.push(
            ...publicParse.findings.map((finding) => ({ ...finding, code: `public_${finding.code}` })),
        );
        if (publicParse.manifest !== null) {
            const drift = comparePublicToPrivate(publicParse.manifest, manifest);
            if (drift !== null) report.findings.push(drift);
        }
    }

    try {
        await database.begin(async (transaction) => {
            const index = await readSubjectIndex(transaction);
            const plan = planMedia(manifest, index);
            report.byClass = plan.byClass;
            report.findings.push(...plan.findings);
            await transaction`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'media', ${MEDIA_SOURCE_SYSTEM}, ${sourceRef}, ${MEDIA_CONTRACT_VERSION})
            `;
            // Der Regelwechsel (Ablösung, Betreiber 2026-10-10) für sich gemessen: was er allein an der Öffentlichkeit ändert, steht als
            // Befund im Bericht, nie still (WI-0068 „Nicht still wegnehmen“); der Lauf geht weiter.
            const switching = (await ruleSeedStates(transaction)).some(({ state }) => state === "pending");
            const before = switching ? await publicationSnapshot(transaction) : null;
            report.rules = await seedPublicationRules(transaction);
            if (before !== null) {
                report.findings.push(
                    ...ruleSwitchFindings(diffSnapshots(before, await publicationSnapshot(transaction))),
                );
            }
            const held = new Map<string, { message: string; objects: FindingObject[] }>();
            const hold = holder(held);
            const mam = await ingestTablePresent(transaction);
            await holdRevokedRules(transaction, hold);
            const { idByKey } = await writeAssets(transaction, runId, plan, report.tables, hold, mam);
            // 🔴 Zusammengefuehrte Werke (WI-0068 D1): Die Bindungen zeigen ab hier auf das BLEIBENDE Werk, die Rechte und
            // die Herkunft hat `writeAssets` gerade an das aufgegangene geschrieben. Ohne diesen Schritt saehe der Lauf am Platz
            // eine Editor-Bindung, liesse ihn nach der Schutzregel stehen und meldete `held_by_editor` - und jede spaetere
            // Legacy-Aenderung an diesem Platz kaeme nicht mehr an (Betreiber 2026-10-11, Entscheid A).
            const redirect = await readMergeRedirect(transaction);
            redirectMergedAssets(idByKey, redirect);
            for (const objekt of await mergedSourceChanged(transaction, redirect)) {
                hold("merged_source_changed", MERGED_SOURCE_CHANGED, objekt);
            }
            const bindingPressure = await writeBindings(transaction, plan, index, idByKey, report.tables, hold, mam);
            const galleryPressure = await writeGalleries(
                transaction,
                runId,
                plan,
                index,
                idByKey,
                report.tables,
                hold,
                mam,
            );
            for (const [code, entry] of held) {
                report.findings.push(
                    createFinding(code, entry.message, { eintraege: entry.objects.length }, entry.objects),
                );
            }
            // Namen aus dem Fachobjekt für Assets ohne Titel; ein Titel eines Menschen bleibt (`titles.ts`, Betreiber 2026-10-10).
            if (mam) {
                const titles = await nameUntitledAssets(transaction);
                report.titles = { named: titles.named.length, keptHuman: titles.keptHuman };
            }
            const retiring = bindingPressure.retiring + galleryPressure.retiring;
            const active = bindingPressure.active + galleryPressure.active;
            if (active > 0 && retiring / active > MAX_RETIRE_FRACTION) {
                report.findings.push(
                    createFinding(
                        "stilllegequote",
                        `Medienbindungen und Galerieeinträge: der Lauf zieht ${String(retiring)} von ${String(active)} aktiven Zeilen zurück (${formatShare(retiring / active)}, Grenzwert ${formatShare(MAX_RETIRE_FRACTION)}); der Lauf geht weiter`,
                        { active, retiring, share: Number((retiring / active).toFixed(4)), limit: MAX_RETIRE_FRACTION },
                    ),
                );
            }
            report.changed =
                report.rules.created + report.rules.evidence + report.rules.superseded + report.titles.named > 0 ||
                Object.values(report.tables).some(
                    (table) => table.created + table.updated + table.retired + table.reappeared > 0,
                );
            await transaction`
                UPDATE migration_run
                SET completed_at = now(), status = 'completed', journal = ${
                    {
                        kind: manifest.kind,
                        media_revision: manifest.mediaRevision,
                        tables: report.tables,
                        by_class: plan.byClass,
                        rules: report.rules,
                        titles: report.titles,
                        dry_run: report.dryRun,
                        findings: report.findings.map((finding) => finding.code),
                    } as unknown as string
                }
                WHERE id = ${runId}
            `;
            if (options.dryRun) throw new DryRunRollback();
        });
    } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
    }
    return report;
}

/** Eine Zeile für den Bericht von `legacy:update` (Schritt I26): Zahlen je Tabelle als neu/geändert/zurückgezogen. */
export function summarizeMedia(report: ImportMediaReport): string {
    if (report.skipped)
        return "uebersprungen: Manifest unbrauchbar oder leer, nichts geschrieben, nichts zurueckgezogen";
    const tables = MEDIA_TABLES.map((name) => {
        const table = report.tables[name];
        return `${name} ${String(table.created)}/${String(table.updated)}/${String(table.retired)}`;
    }).join(", ");
    const orphans =
        report.byClass === null
            ? 0
            : MEDIA_CLASSES.reduce((sum, name) => sum + (report.byClass?.[name].orphans ?? 0), 0);
    return `${report.kind === "private" ? "Export B" : "Export A"}: ${tables} (neu/geaendert/zurueckgezogen); Regeln ${String(report.rules.created)} neu, ${String(report.rules.superseded)} abgeloest; Fachobjekt unbekannt ${String(orphans)}`;
}
