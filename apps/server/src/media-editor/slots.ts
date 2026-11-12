import {
    MEDIA_GALLERY_ITEMS_MAX,
    mediaPublicUrl,
    type MediaCoatState,
    type MediaPersonRef,
    type MediaRole,
    type MediaSlotAsset,
    type MediaSlotSubjectKind,
    type MediaSubjectSlots,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { suggestedTitles } from "./titles.ts";
import type {
    ClearanceState,
    CreationMethod,
    ModerationState,
    PublicationOverride,
    PublicationRuleFacts,
    RightsBasis,
    TechnicalState,
} from "../media/policy.ts";
import { placesOfSourceFileSql, relationState } from "../media/image-relation.ts";
import { PUBLISHED_VARIANT } from "../media/roles.ts";
import { readPublicationRules } from "../media/rules.ts";
import { gehalteneAssets } from "../media/notaus.ts";
import { decideUsage } from "../migration/media-publication.ts";
import { inhaltsstandFuer, schalterVon } from "../system/inhaltsstand.ts";
import { personJson } from "./usage-sql.ts";

/**
 * Die Plätze eines Fachobjekts für den Ortseditor (WI-0068 P4a, EDIT-0001 E19): Wappen mit seinem Zustand (kein Entscheid,
 * „bewusst ohne“, gesetzt) und bei Orten die Titelbilder als Galerie. Jede Zeile trägt die Revision, die eine Operation als
 * `baseRevision` zurückschickt, „hochgeladen von …“ (privat) und die Entscheidung der Policy für genau diese Verwendung
 * („wartet auf Rechteprüfung“). Lesend, hinter `view_media_private`.
 */

interface SlotRow {
    asset_id: string;
    asset_revision: number;
    title: string | null;
    technical_state: TechnicalState;
    moderation_state: ModerationState;
    creation_method: CreationMethod;
    basis: RightsBasis | null;
    clearance: ClearanceState | null;
    license_key: string | null;
    license_family: string | null;
    requires_attribution: boolean | null;
    file_sha256: string | null;
    file_mime: string | null;
    file_width: number | null;
    file_height: number | null;
    uploaded_by: MediaPersonRef | null;
    uploaded_at: Date | null;
    override: PublicationOverride;
    retired: boolean;
    suppressed: boolean;
    revision: number;
    position: number;
    origin: "legacy" | "wiki_localized" | "editor";
    /** Nur an den Titelbildern: der Bildbezug (Betreiber 2026-10-11). */
    relation_override?: string | null;
    relation_places?: number;
}

/** Die Spalten eines Bildes an einem Platz (die Datei kommt aus `ASSET_JOINS`). */
const ASSET_SELECT = `
    a.public_id::text AS asset_id, a.revision::int AS asset_revision, a.title, a.technical_state, a.moderation_state,
    a.creation_method,
    r.rights_basis AS basis, r.clearance_state AS clearance, r.license_key, r.license_family, l.requires_attribution,
    f.sha256 AS file_sha256, f.mime_type AS file_mime, f.width AS file_width, f.height AS file_height,
    (SELECT ${personJson("p")} FROM media_ingest i LEFT JOIN avesmaps_auth.person p ON p.id = i.actor_person_id
      WHERE i.media_asset_id = a.id AND i.ingest_kind = 'editor_upload' ORDER BY i.id LIMIT 1) AS uploaded_by,
    (SELECT coalesce(i.legacy_uploaded_at, i.ingested_at) FROM media_ingest i
      WHERE i.media_asset_id = a.id ORDER BY i.id LIMIT 1) AS uploaded_at`;

const ASSET_JOINS = (variant: string): string => `
    JOIN media_asset a ON a.id = u.media_asset_id
    LEFT JOIN media_rights r ON r.media_asset_id = a.id
    LEFT JOIN license_catalog l ON l.key = r.license_key
    LEFT JOIN LATERAL (
        SELECT f.sha256, f.mime_type, f.width, f.height FROM media_file f
         WHERE f.media_asset_id = a.id AND f.storage_class = 'published' AND f.variant = '${variant}'
         ORDER BY f.created_at DESC, f.id DESC LIMIT 1
    ) f ON TRUE`;

function slotAsset(
    row: SlotRow,
    role: MediaRole,
    rules: readonly PublicationRuleFacts[],
    switches: { isOff(key: string): boolean },
    gehalten: ReadonlySet<string>,
): MediaSlotAsset {
    // Unter einem Notaus liegt die Datei in der Quarantäne (oder gleich dort): keine Vorschau über ihre öffentliche Adresse (S8-04).
    const suspended = gehalten.has(row.asset_id);
    const published =
        row.file_sha256 !== null && row.file_mime !== null && row.file_width !== null && row.file_height !== null
            ? { url: mediaPublicUrl(row.file_sha256), width: row.file_width, height: row.file_height }
            : null;
    const decision = decideUsage(
        {
            technicalState: row.technical_state,
            moderationState: row.moderation_state,
            creationMethod: row.creation_method,
            basis: row.basis,
            clearance: row.clearance,
            licenseKey: row.license_key,
            requiresAttribution: row.requires_attribution,
            licenseFamily: row.license_family,
            suspended,
        },
        role,
        { role, retired: row.retired, override: row.override, suppressed: row.suppressed },
        row.file_mime === null ? null : { mimeType: row.file_mime },
        rules,
        switches,
    );
    return {
        id: row.asset_id,
        revision: row.asset_revision,
        title: row.title,
        technicalState: row.technical_state,
        clearance: row.clearance,
        preview: suspended ? null : published,
        uploadedBy: row.uploaded_by,
        uploadedAt: row.uploaded_at?.toISOString() ?? null,
        publication: { public: decision.allowed, reason: decision.reason },
    };
}

const SPECS = {
    place: { table: "place", binding: "place_media", column: "place_id", suppression: "place_media_suppression" },
    territory: {
        table: "territory",
        binding: "territory_media",
        column: "territory_id",
        suppression: "territory_media_suppression",
    },
} as const;

export async function subjectSlots(
    database: Queryable,
    kind: MediaSlotSubjectKind,
    publicId: string,
): Promise<MediaSubjectSlots | undefined> {
    const spec = SPECS[kind];
    const [subject] = await database.unsafe<
        { id: string; name: string | null; active: boolean; subtype: string | null }[]
    >(
        `SELECT id::text AS id, name, is_active AS active, ${kind === "place" ? "subtype" : "NULL::text"} AS subtype
           FROM ${spec.table} WHERE public_id = $1::uuid`,
        [publicId],
    );
    if (subject === undefined) return undefined;
    const rules = await readPublicationRules(database);
    const switches = schalterVon(await inhaltsstandFuer(database));
    const gehalten = (await gehalteneAssets(database)).publicIds;

    const [coat] = await database.unsafe<SlotRow[]>(
        `SELECT ${ASSET_SELECT}, u.publication_override AS override, FALSE AS retired, FALSE AS suppressed,
                u.revision::int AS revision, 0 AS position, u.origin
           FROM ${spec.binding} u ${ASSET_JOINS(PUBLISHED_VARIANT.coat)}
          WHERE u.${spec.column} = $1 AND u.role = 'coat' AND u.retired_at IS NULL`,
        [subject.id],
    );
    const [suppression] = await database.unsafe<{ origin: "legacy" | "editor" }[]>(
        `SELECT origin FROM ${spec.suppression} WHERE ${spec.column} = $1 AND role = 'coat'`,
        [subject.id],
    );
    const coatState: MediaCoatState = coat !== undefined ? "set" : suppression !== undefined ? "none" : "undecided";

    let header: MediaSubjectSlots["header"] = null;
    if (kind === "place") {
        const [gallery] = await database<
            { id: string; public_id: string; revision: number; origin: "legacy" | "editor"; title: string | null }[]
        >`
            SELECT g.id::text AS id, g.public_id::text AS public_id, g.revision::int AS revision, g.origin, g.title
              FROM place_media_gallery b JOIN media_gallery g ON g.id = b.media_gallery_id
             WHERE b.place_id = ${subject.id} AND b.role = 'header' AND b.retired_at IS NULL
        `;
        // Das Titelbild als Einzelbild (WI-0219): EIN Bild ODER EINE Galerie.
        const [image] = await database.unsafe<SlotRow[]>(
            `SELECT ${ASSET_SELECT}, u.publication_override AS override, FALSE AS retired, FALSE AS suppressed,
                    u.revision::int AS revision, 0 AS position, u.origin,
                    u.image_relation_override AS relation_override, ${placesOfSourceFileSql("a.id")} AS relation_places
               FROM place_media u ${ASSET_JOINS(PUBLISHED_VARIANT.header)}
              WHERE u.place_id = $1 AND u.role = 'header' AND u.retired_at IS NULL`,
            [subject.id],
        );
        const [headerSuppression] = await database<{ held: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM place_media_suppression WHERE place_id = ${subject.id} AND role = 'header') AS held
        `;
        const items =
            gallery === undefined
                ? []
                : await database.unsafe<SlotRow[]>(
                      `SELECT ${ASSET_SELECT}, u.publication_override AS override, FALSE AS retired,
                              FALSE AS suppressed, u.revision::int AS revision, u.sort_order AS position, 'editor' AS origin,
                              u.image_relation_override AS relation_override,
                              ${placesOfSourceFileSql("a.id")} AS relation_places
                         FROM media_gallery_item u ${ASSET_JOINS(PUBLISHED_VARIANT.header)}
                        WHERE u.gallery_id = $1 AND u.retired_at IS NULL
                        ORDER BY u.sort_order, u.id`,
                      [gallery.id],
                  );
        header = {
            gallery:
                gallery === undefined
                    ? null
                    : {
                          id: gallery.public_id,
                          revision: gallery.revision,
                          origin: gallery.origin,
                          title: gallery.title,
                      },
            image:
                image === undefined
                    ? null
                    : {
                          asset: slotAsset(image, "header", rules, switches, gehalten),
                          revision: image.revision,
                          origin: image.origin,
                          relation: relationState(image.relation_override ?? null, image.relation_places ?? 0),
                      },
            items: items.map((row) => ({
                asset: slotAsset(row, "header", rules, switches, gehalten),
                position: row.position,
                revision: row.revision,
                relation: relationState(row.relation_override ?? null, row.relation_places ?? 0),
            })),
            max: MEDIA_GALLERY_ITEMS_MAX,
            suppressed: headerSuppression?.held === true,
        };
    }

    // Der Name eines neuen Wappens bzw. Titelbilds nach der Namensregel (7b): vorbelegt im Formular „Neues … hochladen“.
    const vorschlag = await suggestedTitles(
        database,
        { kind, publicId, name: subject.name ?? "", placeSubtype: subject.subtype },
        kind === "place" ? ["coat", "header"] : ["coat"],
    );

    return {
        subject: { kind, id: publicId, name: subject.name ?? "", active: subject.active },
        coat: {
            state: coatState,
            origin: coat?.origin ?? suppression?.origin ?? null,
            revision: coat?.revision ?? null,
            asset: coat === undefined ? null : slotAsset(coat, "coat", rules, switches, gehalten),
        },
        header,
        suggestedTitles: { coat: vorschlag.get("coat") ?? null, header: vorschlag.get("header") ?? null },
    };
}
