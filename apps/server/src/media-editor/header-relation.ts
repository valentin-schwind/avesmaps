import type { MediaHeaderRelationBody, MediaImageRelation, OperationReceipt } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { mediaBindingKey, mediaEditConflict } from "./audit.ts";
import { headerGallery, lockSlot, notBound, requireGalleryBase } from "./binding-operations.ts";
import { mediaOperation, type MediaActor } from "./operation-store.ts";

/**
 * Den Bildbezug einer Verwendung übersteuern (Betreiber 2026-10-11, wörtlich „1A … 2 B … 3 A ja das gilt für alle“; Arbeitsanweisung
 * `project-control/work-items/bildbezug-ortsansicht-typbild-2026-10-11.md`, WI-0068 „Bildbezug (Ortsansicht/Typbild)“).
 *
 * Operation `header.relation` (`POST /api/editor/media/bindings/header/relation`, Recht `upload_media` wie jede Bindung, Schreibklasse
 * `map`): setzt an GENAU EINER Verwendung eines Titelbildes `image_relation_override` (Migration 0111) auf `place_view` oder
 * `type_image`, oder mit `null` zurück auf die Regel (`apps/server/src/media/image-relation.ts`). Die Oberflächen dafür bauen der
 * Ortseditor (E19, Bildbindungen) und die Medienverwaltung (Inspector „Verwendungen“); hier steht nur der Schreibpfad.
 *
 * - Die Verwendung ist das Bild an diesem Ort: ein aktiver Eintrag der Kopf-Galerie oder eine aktive Bindung `place_media` mit Rolle
 *   `header`. Gibt es beide, nennt `via` die gemeinte (sonst 400); gibt es keine, 409 `media_not_bound`.
 * - Revision wie die übrigen Titelbild-Operationen: Am Galerieeintrag zählt die Revision der GALERIE (jede Änderung an einem Eintrag
 *   zählt sie mit, Migration 0086), an der Bindung die der Bindung. Veraltet: 409 `edit_conflict` mit „wer, wann“ aus dem Protokoll.
 * - Fachprotokoll `gallery.header_relation_set` beziehungsweise `binding.header_relation_set` mit neuem und vorigem Wert.
 * - 🔴 Die Galerie wird dabei NICHT zur Galerie des Editors (anders als Hinzufügen, Entfernen, Umsortieren): Der Bildbezug ist eine
 *   Entscheidung über die Beschriftung, nicht über die Folge. Legacy gleicht Folge und Einträge weiter ab, und die Spalte übersteht jeden
 *   Zug, weil kein Import sie schreibt und keiner einen Eintrag löscht (Betreiber 2026-10-10: „die entscheidung darf nicht nachträglich
 *   kompromittiert werden“). Provenienz, Rechte und Freigabe des Assets bleiben unberührt.
 */

interface RelationUsage {
    via: "gallery" | "binding";
    id: string;
    previous: MediaImageRelation | null;
    /** Nur an der Bindung: ihre Revision und Zeit (an der Galerie gilt die der Galerie). */
    revision?: number;
    updatedAt?: Date;
}

async function galleryUsage(tx: Queryable, galleryId: string, assetId: string): Promise<RelationUsage | undefined> {
    const [row] = await tx<{ id: string; previous: MediaImageRelation | null }[]>`
        SELECT i.id::text AS id, i.image_relation_override AS previous
          FROM media_gallery_item i JOIN media_asset a ON a.id = i.media_asset_id
         WHERE i.gallery_id = ${galleryId} AND a.public_id = ${assetId}::uuid AND i.retired_at IS NULL
           FOR UPDATE OF i
    `;
    return row === undefined ? undefined : { via: "gallery", id: row.id, previous: row.previous };
}

async function bindingUsage(tx: Queryable, placeId: string, assetId: string): Promise<RelationUsage | undefined> {
    const [row] = await tx<{ id: string; previous: MediaImageRelation | null; revision: number; updated_at: Date }[]>`
        SELECT m.id::text AS id, m.image_relation_override AS previous, m.revision::int AS revision, m.updated_at
          FROM place_media m JOIN media_asset a ON a.id = m.media_asset_id
         WHERE m.place_id = ${placeId} AND m.role = 'header' AND a.public_id = ${assetId}::uuid AND m.retired_at IS NULL
           FOR UPDATE OF m
    `;
    return row === undefined
        ? undefined
        : { via: "binding", id: row.id, previous: row.previous, revision: row.revision, updatedAt: row.updated_at };
}

export function setHeaderRelation(
    database: Database,
    actor: MediaActor,
    body: MediaHeaderRelationBody,
): Promise<OperationReceipt> {
    const subject = `place:${body.placeId}`;
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "header.relation",
            body: { subject, assetId: body.assetId, via: body.via, value: body.value, baseRevision: body.baseRevision },
        },
        async (tx) => {
            const { id: placeId } = await lockSlot(tx, "place", body.placeId, "header");
            const gallery = await headerGallery(tx, placeId);
            const inGallery =
                gallery !== undefined && body.via !== "binding"
                    ? await galleryUsage(tx, gallery.id, body.assetId)
                    : undefined;
            const bound = body.via !== "gallery" ? await bindingUsage(tx, placeId, body.assetId) : undefined;
            if (inGallery !== undefined && bound !== undefined) {
                throw new ApiError(
                    400,
                    "validation_failed",
                    "Das Bild hängt hier zweimal; welche Verwendung ist gemeint?",
                    {
                        issues: [{ path: "via", rule: "required" }],
                    },
                );
            }
            const usage = inGallery ?? bound;
            if (usage === undefined) throw notBound();

            if (usage.via === "gallery") {
                await requireGalleryBase(tx, gallery, body.baseRevision);
                await tx`UPDATE media_gallery_item SET image_relation_override = ${body.value}, updated_at = now() WHERE id = ${usage.id}`;
                // Die Galerie zählt mit (Trigger aus 0086); ihre neue Revision ist die, die das Protokoll nennt.
                const [row] = await tx<
                    { revision: number }[]
                >`SELECT revision::int AS revision FROM media_gallery WHERE id = ${gallery!.id}`;
                const revision = row!.revision;
                return {
                    receipt: {
                        affected: [{ kind: "gallery", id: gallery!.publicId, revision }],
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: [
                        {
                            action: "gallery.header_relation_set",
                            galleryId: gallery!.publicId,
                            assetId: body.assetId,
                            targetRevision: revision,
                            details: { subject, relation: body.value, previous: usage.previous },
                        },
                    ],
                };
            }

            const binding = mediaBindingKey("place_media", usage.id);
            if (usage.revision !== body.baseRevision) {
                throw await mediaEditConflict(
                    tx,
                    { record: "binding", assetId: body.assetId, binding },
                    { revision: usage.revision!, changedAt: usage.updatedAt! },
                );
            }
            const [row] = await tx<{ revision: number }[]>`
                UPDATE place_media SET image_relation_override = ${body.value}, updated_at = now() WHERE id = ${usage.id}
                RETURNING revision::int AS revision
            `;
            const revision = row!.revision;
            return {
                receipt: {
                    affected: [{ kind: "header", id: subject, revision }],
                    derivedWork: [],
                    warnings: [],
                },
                entries: [
                    {
                        action: "binding.header_relation_set",
                        assetId: body.assetId,
                        targetRevision: revision,
                        details: { binding, subject, relation: body.value, previous: usage.previous },
                    },
                ],
            };
        },
    );
}
