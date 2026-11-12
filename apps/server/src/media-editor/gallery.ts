import {
    MAM_GALLERY_PREVIEWS,
    mediaPublicUrl,
    type MamGalleryList,
    type MediaGalleryDetail,
    type MediaGalleryItemView,
    type MediaPersonRef,
    type MediaUsageSubject,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { MEDIA_EDITOR_SOURCE_SYSTEM } from "./upload.ts";
import { personJson } from "./usage-sql.ts";

/**
 * Die Galerie als eigenes Medienobjekt (WI-0068 §9, P2): Titel, Art, Herkunft, Veröffentlichungszustand, Cover, die Einträge in
 * ihrer Reihenfolge (zurückgezogene an ihrer Stelle) und wer die Galerie verwendet. Die Revision der Galerie steigt mit jeder
 * Änderung an einem Eintrag (Migration 0086); EINE `baseRevision` schützt so später das Umsortieren der ganzen Folge.
 */

interface GalleryRow {
    id: string;
    public_id: string;
    revision: number;
    gallery_kind: MediaGalleryDetail["kind"];
    title: string | null;
    origin: MediaGalleryDetail["origin"];
    publication_state: MediaGalleryDetail["publicationState"];
    cover_asset_id: string | null;
    created_at: Date;
    updated_at: Date;
    from_legacy: boolean;
    created_by: { id: string; displayName: string } | null;
}

interface ItemRow {
    asset_id: string;
    asset_revision: number;
    asset_title: string | null;
    media_kind: MediaGalleryItemView["asset"]["kind"];
    technical_state: MediaGalleryItemView["asset"]["technicalState"];
    clearance_state: MediaGalleryItemView["asset"]["clearance"];
    preview_sha256: string | null;
    preview_width: number | null;
    preview_height: number | null;
    position: number;
    caption: string | null;
    retired: boolean;
    revision: number;
    override: MediaGalleryItemView["override"]["state"];
    override_decided_on: string | null;
    decided_by: MediaPersonRef | null;
    override_reason: string | null;
    override_operator_quote: string | null;
}

interface BindingRow {
    subject_id: string;
    subject_name: string;
    subject_active: boolean;
    role: MediaGalleryDetail["bindings"][number]["role"];
    origin: MediaGalleryDetail["bindings"][number]["origin"];
    retired: boolean;
    revision: number;
}

/** Die Galerie über ihre öffentliche Kennung; `undefined`, wenn es sie nicht gibt. */
export async function galleryDetail(database: Queryable, publicId: string): Promise<MediaGalleryDetail | undefined> {
    const [gallery] = await database.unsafe<GalleryRow[]>(
        `SELECT g.id::text AS id, g.public_id::text AS public_id, g.revision::int AS revision, g.gallery_kind, g.title, g.origin,
                g.publication_state, ca.public_id::text AS cover_asset_id, g.created_at, g.updated_at,
                g.source_system <> '${MEDIA_EDITOR_SOURCE_SYSTEM}' AS from_legacy,
                (SELECT ${personJson("p")}
                   FROM media_audit_event e
                   JOIN media_operation o ON o.operation_id = e.operation_id
                   LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
                  WHERE e.media_gallery_public_id = g.public_id AND e.action = 'gallery.created'
                  ORDER BY e.id LIMIT 1) AS created_by
           FROM media_gallery g
           LEFT JOIN media_gallery_item ci ON ci.id = g.cover_item_id
           LEFT JOIN media_asset ca ON ca.id = ci.media_asset_id
          WHERE g.public_id = $1::uuid`,
        [publicId],
    );
    if (gallery === undefined) return undefined;
    const [items, bindings] = await Promise.all([
        database.unsafe<ItemRow[]>(
            `SELECT a.public_id::text AS asset_id, a.revision::int AS asset_revision, a.title AS asset_title, a.media_kind,
                    a.technical_state, r.clearance_state, pv.sha256 AS preview_sha256, pv.width AS preview_width,
                    pv.height AS preview_height, i.sort_order AS position, i.caption, i.retired_at IS NOT NULL AS retired,
                    i.revision::int AS revision, i.publication_override AS override,
                    to_char(i.override_decided_on, 'YYYY-MM-DD') AS override_decided_on, ${personJson("p")} AS decided_by,
                    i.override_reason, i.override_operator_quote
               FROM media_gallery_item i
               JOIN media_asset a ON a.id = i.media_asset_id
               LEFT JOIN media_rights r ON r.media_asset_id = a.id
               LEFT JOIN avesmaps_auth.person p ON p.id = i.override_decided_by
               LEFT JOIN LATERAL (
                   SELECT f.sha256, f.width, f.height FROM media_file f
                    WHERE f.media_asset_id = a.id AND f.storage_class = 'published'
                    ORDER BY f.width * f.height, f.id
                    LIMIT 1
               ) pv ON TRUE
              WHERE i.gallery_id = $1::bigint
              ORDER BY i.sort_order, i.id`,
            [gallery.id],
        ),
        database.unsafe<BindingRow[]>(
            `SELECT s.public_id::text AS subject_id, s.name AS subject_name, s.is_active AS subject_active, b.role, b.origin,
                    b.retired_at IS NOT NULL AS retired, b.revision::int AS revision
               FROM place_media_gallery b
               JOIN place s ON s.id = b.place_id
              WHERE b.media_gallery_id = $1::bigint
              ORDER BY b.retired_at IS NOT NULL, s.name, b.id`,
            [gallery.id],
        ),
    ]);
    return {
        id: gallery.public_id,
        revision: gallery.revision,
        kind: gallery.gallery_kind,
        title: gallery.title,
        origin: gallery.origin,
        publicationState: gallery.publication_state,
        coverAssetId: gallery.cover_asset_id,
        createdAt: gallery.created_at.toISOString(),
        updatedAt: gallery.updated_at.toISOString(),
        fromLegacy: gallery.from_legacy,
        createdBy: gallery.created_by,
        items: items.map((row) => ({
            asset: {
                id: row.asset_id,
                revision: row.asset_revision,
                title: row.asset_title,
                kind: row.media_kind,
                technicalState: row.technical_state,
                clearance: row.clearance_state,
                preview:
                    row.preview_sha256 === null || row.preview_width === null || row.preview_height === null
                        ? null
                        : {
                              url: mediaPublicUrl(row.preview_sha256),
                              width: row.preview_width,
                              height: row.preview_height,
                          },
            },
            position: row.position,
            caption: row.caption,
            retired: row.retired,
            revision: row.revision,
            override: {
                state: row.override,
                decidedOn: row.override_decided_on,
                decidedBy: row.decided_by,
                reason: row.override_reason,
                operatorQuote: row.override_operator_quote,
            },
        })),
        bindings: bindings.map((row) => ({
            subject: {
                kind: "place",
                id: row.subject_id,
                name: row.subject_name,
                active: row.subject_active,
            } satisfies MediaUsageSubject,
            role: row.role,
            origin: row.origin,
            retired: row.retired,
            revision: row.revision,
        })),
    };
}

interface SummaryRow {
    public_id: string;
    revision: number;
    gallery_kind: MediaGalleryDetail["kind"];
    title: string | null;
    origin: MediaGalleryDetail["origin"];
    publication_state: MediaGalleryDetail["publicationState"];
    items: number;
    places: { id: string; name: string }[] | null;
    previews: { sha256: string; width: number; height: number }[] | null;
}

/**
 * Die Galerien als Liste für Spalte 2 der Medienverwaltung (WI-0068 P6).
 *
 * - **Gesucht wird über Titel UND Ortsnamen:** Fast keine Galerie des Bestands hat einen Titel (82 von 82 tragen `NULL`), sie
 *   heißen in der Oberfläche nach ihrem Ort. Wer „Fasar“ tippt, meint die Galerie von Fasar.
 * - **`draft`** ist keine abgeleitete Spielerei, sondern die Entscheidung des Betreibers vom 2026-10-13: ohne aktive Ortsbindung
 *   ist die Galerie ein Entwurf und für Besucher unsichtbar.
 * - **Der Stapel** zeigt das Cover zuerst, dann die Folge; ein Eintrag ohne veröffentlichte Datei fällt aus dem Stapel (er hat
 *   nichts zu zeigen), zählt aber in `items` mit.
 */
export async function galleryList(
    database: Queryable,
    options: { q?: string | undefined; limit: number; offset: number },
): Promise<MamGalleryList> {
    const suche = options.q?.trim() ?? "";
    const muster = suche === "" ? null : `%${suche}%`;
    const rows = await database<SummaryRow[]>`
        WITH gefiltert AS (
            SELECT g.id
              FROM media_gallery g
             WHERE ${muster}::text IS NULL
                OR g.title ILIKE ${muster}
                OR EXISTS (
                       SELECT 1 FROM place_media_gallery b JOIN place p ON p.id = b.place_id
                        WHERE b.media_gallery_id = g.id AND b.retired_at IS NULL AND p.name ILIKE ${muster}
                   )
        )
        SELECT g.public_id::text AS public_id, g.revision::int AS revision, g.gallery_kind, g.title, g.origin,
               g.publication_state,
               (SELECT count(*)::int FROM media_gallery_item i WHERE i.gallery_id = g.id AND i.retired_at IS NULL) AS items,
               (SELECT jsonb_agg(jsonb_build_object('id', p.public_id, 'name', p.name) ORDER BY p.name)
                  FROM place_media_gallery b JOIN place p ON p.id = b.place_id
                 WHERE b.media_gallery_id = g.id AND b.retired_at IS NULL) AS places,
               (SELECT jsonb_agg(jsonb_build_object('sha256', x.sha256, 'width', x.width, 'height', x.height) ORDER BY x.rang)
                  FROM (
                      SELECT f.sha256, f.width, f.height,
                             -- Das Cover zuerst, dann die Folge der Galerie.
                             row_number() OVER (
                                 ORDER BY (i.id = g.cover_item_id) DESC, i.sort_order, i.id
                             ) AS rang
                        FROM media_gallery_item i
                        JOIN media_file f ON f.media_asset_id = i.media_asset_id AND f.storage_class = 'published'
                       WHERE i.gallery_id = g.id AND i.retired_at IS NULL
                       LIMIT ${MAM_GALLERY_PREVIEWS}
                  ) x) AS previews
          FROM media_gallery g JOIN gefiltert ON gefiltert.id = g.id
         ORDER BY g.id
         LIMIT ${options.limit} OFFSET ${options.offset}
    `;
    const [gesamt] = await database<{ n: number }[]>`
        SELECT count(*)::int AS n FROM media_gallery g
         WHERE ${muster}::text IS NULL
            OR g.title ILIKE ${muster}
            OR EXISTS (
                   SELECT 1 FROM place_media_gallery b JOIN place p ON p.id = b.place_id
                    WHERE b.media_gallery_id = g.id AND b.retired_at IS NULL AND p.name ILIKE ${muster}
               )
    `;
    return {
        items: rows.map((row) => ({
            id: row.public_id,
            revision: row.revision,
            title: row.title,
            kind: row.gallery_kind,
            origin: row.origin,
            publicationState: row.publication_state,
            items: row.items,
            places: row.places ?? [],
            draft: (row.places ?? []).length === 0,
            previews: (row.previews ?? []).map((preview) => ({
                url: mediaPublicUrl(preview.sha256),
                width: preview.width,
                height: preview.height,
            })),
        })),
        total: gesamt?.n ?? 0,
    };
}
