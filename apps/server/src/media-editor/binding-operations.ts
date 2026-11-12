import {
    assetTypeAllowsRole,
    assetTypeForRole,
    type DerivedWork,
    type MediaCoatBindBody,
    type MediaCoatNoneBody,
    type MediaHeaderNoneBody,
    type MediaHeaderSetBody,
    type MediaSlotSubjectKind,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { lockAsset, notFound, type LockedAsset } from "./asset-operations.ts";
import { requireNichtReisebild } from "./reisebild.ts";
import { mediaBindingKey, mediaEditConflict } from "./audit.ts";
import { mediaOperation, type MediaActor, type MediaAuditEntry } from "./operation-store.ts";
import { enqueueSettle } from "./settle.ts";
import { nameUntitledAssets } from "./titles.ts";

/**
 * Bindungen am Platz für den Ortseditor (WI-0068 P4a, EDIT-0001 E19, WI-0126 §11i/§11j): jede Handlung eine Operation der
 * Medienverwaltung mit Revision, Fachprotokoll und Quittung, aufgerufen gegen DIESE Operationen, keine eigenen Ort-Routen.
 *
 * - **Wappen** (`coat`, Ort und Gebiet): drei Zustände eines Platzes. Kein Entscheid (Legacy darf ihn füllen), „bewusst ohne“ (eine
 *   Unterdrückung mit Herkunft `editor`, eigener Zustand, nicht bloß leer) und gesetzt (eine aktive Bindung). Setzen ersetzt die
 *   aktive Bindung (sie wird zurückgezogen, das Asset bleibt) und hebt ein „bewusst ohne“ auf; Entfernen macht den Platz
 *   „bewusst ohne“.
 * - **Titelbild** (`header`, nur Orte; WI-0219): EIN Bild (`header.set`, eine Einzelbindung) ODER EINE Galerie (`gallery.bind`). Jede
 *   Wahl ersetzt, was bisher hängt; das Alte wird nur gelöst. „Kein Titelbild“ (`header.none`) macht den Platz „bewusst ohne“.
 * - Die Galerie des Ortes von früher (`header.add`, `header.remove`, `header.order`, eine Bildliste am Ort) ist mit WI-0219 entfallen:
 *   Bilder einer Galerie ordnet die Medienverwaltung an der Galerie selbst (`gallery-operations.ts`).
 *
 * 🔴 Schutzregel (Betreiber 2026-10-10, „die entscheidung darf nicht nachträglich kompromittiert werden“): Was hier entsteht, trägt die
 * Herkunft `editor` (Bindung, Unterdrückung, Galerie samt Bindung an den Ort). Der Medienimport lässt solche Zeilen stehen und meldet
 * einen Befund (`held_by_editor`), statt sie mit Legacys Stand zu überschreiben.
 *
 * Gleichzeitigkeit: Ein Platz (Fachobjekt und Rolle) wird je Transaktion gesperrt; der gesehene Stand geht mit (`baseRevision` der
 * Bindung oder der Galerie, beim Wappen ohne Bindung `baseState`). Weicht er ab: 409 `edit_conflict`. Das Fachobjekt steht im Protokoll
 * als `details.subject` (`place:<id>`): der Verlauf am Ort.
 */

interface SubjectSpec {
    table: "place" | "territory";
    binding: "place_media" | "territory_media";
    column: "place_id" | "territory_id";
    suppression: "place_media_suppression" | "territory_media_suppression";
}

const SUBJECTS: Readonly<Record<MediaSlotSubjectKind, SubjectSpec>> = {
    place: { table: "place", binding: "place_media", column: "place_id", suppression: "place_media_suppression" },
    territory: {
        table: "territory",
        binding: "territory_media",
        column: "territory_id",
        suppression: "territory_media_suppression",
    },
};

const subjectRef = (kind: MediaSlotSubjectKind, id: string): string => `${kind}:${id}`;

/** Das Fachobjekt und die Sperre seines Platzes bis zum Ende der Transaktion; sonst 404. Auch für den Bildbezug (`header-relation.ts`). */
export async function lockSlot(
    tx: Queryable,
    kind: MediaSlotSubjectKind,
    publicId: string,
    role: "coat" | "header",
): Promise<{ id: string; spec: SubjectSpec }> {
    const spec = SUBJECTS[kind];
    const [row] = await tx.unsafe<{ id: string }[]>(
        `SELECT id::text AS id FROM ${spec.table} WHERE public_id = $1::uuid`,
        [publicId],
    );
    if (row === undefined) throw notFound(kind === "place" ? "Diesen Ort" : "Dieses Gebiet");
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`media_slot:${spec.table}:${row.id}:${role}`}))`;
    return { id: row.id, spec };
}

/**
 * Das Asset für eine Bindung in `role`: kein 3D-Modell, und der Asset-Typ muss die Rolle tragen (Betreiber 2026-10-10: „wappen sind ein
 * eigener bild typ und haben nichts mit normalen bildern zu tun“). Ein Asset ohne Typ (vor Migration 0095 angelegt, etwa vom vorigen
 * Release) bekommt ihn hier aus der Rolle, in derselben Transaktion; die Spalte hebt keine Revision.
 */
export async function bindableAsset(
    tx: Queryable,
    assetId: string,
    role: "coat" | "header" | "map_full" | "map_preview",
): Promise<LockedAsset> {
    const asset = await lockAsset(tx, assetId);
    // 🔴 Ein Reisebild bindet kein Editor (Wappen, Titelbild und Galerie laufen alle hier durch).
    requireNichtReisebild(asset);
    if (asset.mediaKind !== "image") {
        throw new ApiError(409, "media_kind_not_bindable", "Ein 3D-Modell ist kein Wappen und kein Titelbild.");
    }
    if (!assetTypeAllowsRole(asset.assetType, role)) {
        throw new ApiError(
            409,
            "media_type_mismatch",
            role === "coat"
                ? "Dieses Bild ist kein Wappen."
                : role === "map_full"
                  ? "Dieses Bild ist keine Karte."
                  : role === "map_preview"
                    ? "Dieses Bild ist keine Kartenvorschau."
                    : "Ein Wappen ist kein Titelbild.",
            { assetType: asset.assetType },
        );
    }
    if (asset.assetType === null) {
        const type = assetTypeForRole(role);
        await tx`UPDATE media_asset SET asset_type = ${type} WHERE id = ${asset.id} AND asset_type IS NULL`;
        return { ...asset, assetType: type };
    }
    return asset;
}

/** 409 für einen Platz ohne Bindung, dessen gesehener Zustand nicht mehr gilt (eine Unterdrückung hat keine Revision). */
const slotChanged = (): ApiError =>
    new ApiError(409, "edit_conflict", "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.", {
        currentRevision: 0,
    });

export const notBound = (): ApiError => new ApiError(409, "media_not_bound", "Das Bild hängt hier nicht (mehr).");

/**
 * Hat das gebundene Asset noch keinen Titel, bekommt es den Namen aus dem Fachobjekt (`titles.ts`, Betreiber 2026-10-10), in derselben
 * Transaktion: die neue Revision des Assets steht in der Quittung, die Handlung im Fachprotokoll. Ein Titel eines Menschen bleibt.
 */
async function deriveTitle(
    tx: Queryable,
    assetDbId: string,
): Promise<{ affected: { kind: string; id: string; revision: number }[]; entries: MediaAuditEntry[] }> {
    const { named } = await nameUntitledAssets(tx, { assetIds: [assetDbId] });
    return {
        affected: named.map((asset) => ({ kind: "media_asset", id: asset.publicId, revision: asset.revision })),
        entries: named.map((asset) => ({
            action: "asset.title_derived",
            assetId: asset.publicId,
            targetRevision: asset.revision,
            details: { subject: asset.subject, role: asset.role },
        })),
    };
}

// --- Wappen ---------------------------------------------------------------------------------------------------------------------

interface ActiveBinding {
    id: string;
    revision: number;
    updatedAt: Date;
    assetDbId: string;
    assetId: string;
}

/** Die aktive Bindung einer Rolle am Fachobjekt (Wappen; am Ort auch das Titelbild als Einzelbild, WI-0219), gesperrt. */
async function activeBinding(
    tx: Queryable,
    spec: SubjectSpec,
    subjectId: string,
    role: "coat" | "header",
): Promise<ActiveBinding | undefined> {
    const [row] = await tx.unsafe<
        { id: string; revision: number; updated_at: Date; asset_db_id: string; asset_id: string }[]
    >(
        `SELECT m.id::text AS id, m.revision::int AS revision, m.updated_at, m.media_asset_id::text AS asset_db_id,
                a.public_id::text AS asset_id
           FROM ${spec.binding} m JOIN media_asset a ON a.id = m.media_asset_id
          WHERE m.${spec.column} = $1 AND m.role = $2 AND m.retired_at IS NULL
            FOR UPDATE OF m`,
        [subjectId, role],
    );
    return row === undefined
        ? undefined
        : {
              id: row.id,
              revision: row.revision,
              updatedAt: row.updated_at,
              assetDbId: row.asset_db_id,
              assetId: row.asset_id,
          };
}

async function isSuppressed(
    tx: Queryable,
    spec: SubjectSpec,
    subjectId: string,
    role: "coat" | "header",
): Promise<boolean> {
    const [row] = await tx.unsafe<{ held: boolean }[]>(
        `SELECT EXISTS (SELECT 1 FROM ${spec.suppression} WHERE ${spec.column} = $1 AND role = $2) AS held`,
        [subjectId, role],
    );
    return row?.held === true;
}

/**
 * 🔴 Die Revision, mit der eine Bindung an diesem Platz aktiv wird: über JEDER, die eine Bindung dieses Platzes je trug (aktiv oder
 * zurückgezogen). Der gesehene Stand eines Platzes ist die Revision seiner aktiven Bindung; wechselt das Bild, ist das eine ANDERE Zeile.
 * Begänne sie wieder bei 1 oder käme eine zurückgezogene mit ihrer alten Zahl zurück, ginge ein zweiter Wechsel mit demselben gesehenen
 * Stand durch und ersetzte den ersten still (Befund WI-0068 R8 2026-10-18, `media-wettlauf.test.ts`). Beim Zurückholen übernimmt der
 * Trigger `revision_bump_forward()` (Migration 0195) die gesetzte höhere Zahl; ohne 0195 zählt er wie bisher um eins.
 *
 * Erst NACH dem Lösen der bisherigen Bindung fragen: deren Zurückziehen zählt mit.
 */
async function naechsteRevision(
    tx: Queryable,
    spec: SubjectSpec,
    subjectId: string,
    role: "coat" | "header",
): Promise<number> {
    const [row] = await tx.unsafe<{ revision: number }[]>(
        `SELECT coalesce(max(revision), 0)::int + 1 AS revision FROM ${spec.binding} WHERE ${spec.column} = $1 AND role = $2`,
        [subjectId, role],
    );
    return row!.revision;
}

async function retireBinding(tx: Queryable, spec: SubjectSpec, bindingId: string): Promise<number> {
    const [row] = await tx.unsafe<{ revision: number }[]>(
        `UPDATE ${spec.binding} SET retired_at = now(), updated_at = now() WHERE id = $1 RETURNING revision::int AS revision`,
        [bindingId],
    );
    return row!.revision;
}

export function bindCoat(database: Database, actor: MediaActor, body: MediaCoatBindBody): Promise<OperationReceipt> {
    if (body.baseRevision !== undefined && body.baseState !== undefined) {
        throw new ApiError(
            400,
            "validation_failed",
            "Entweder die Revision der Bindung oder der Zustand des Platzes.",
            {
                issues: [{ path: "baseState", rule: "not_allowed" }],
            },
        );
    }
    const subject = subjectRef(body.subject.kind, body.subject.id);
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "coat.bind",
            body: { subject, assetId: body.assetId, baseRevision: body.baseRevision, baseState: body.baseState },
        },
        async (tx) => {
            const { id: subjectId, spec } = await lockSlot(tx, body.subject.kind, body.subject.id, "coat");
            const asset = await bindableAsset(tx, body.assetId, "coat");
            const active = await activeBinding(tx, spec, subjectId, "coat");
            const suppressed = await isSuppressed(tx, spec, subjectId, "coat");
            if (active !== undefined) {
                if (body.baseRevision !== active.revision) {
                    throw await mediaEditConflict(
                        tx,
                        {
                            record: "binding",
                            assetId: active.assetId,
                            binding: mediaBindingKey(spec.binding, active.id),
                        },
                        { revision: active.revision, changedAt: active.updatedAt },
                    );
                }
                if (active.assetId === asset.publicId) {
                    throw new ApiError(409, "media_already_bound", "Dieses Wappen ist hier schon gesetzt.");
                }
            } else if (body.baseRevision !== undefined || body.baseState !== (suppressed ? "none" : "undecided")) {
                throw slotChanged();
            }

            const entries: MediaAuditEntry[] = [];
            const derivedWork: DerivedWork[] = [];
            if (suppressed) {
                await tx.unsafe(`DELETE FROM ${spec.suppression} WHERE ${spec.column} = $1 AND role = 'coat'`, [
                    subjectId,
                ]);
            }
            if (active !== undefined) {
                const revision = await retireBinding(tx, spec, active.id);
                entries.push({
                    action: "binding.coat_released",
                    assetId: active.assetId,
                    targetRevision: revision,
                    details: {
                        binding: mediaBindingKey(spec.binding, active.id),
                        subject,
                        role: "coat",
                        replacedBy: asset.publicId,
                    },
                });
                derivedWork.push(
                    await enqueueSettle(tx, {
                        assetPublicId: active.assetId,
                        role: "coat",
                        actorPersonId: actor.personId,
                    }),
                );
            }
            // Eine frühere, zurückgezogene Bindung desselben Bildes kommt zurück (je Platz und Bild eine Zeile, Migration 0064).
            const revision = await naechsteRevision(tx, spec, subjectId, "coat");
            const [back] = await tx.unsafe<{ id: string; revision: number }[]>(
                `UPDATE ${spec.binding} SET retired_at = NULL, origin = 'editor', updated_at = now(), revision = $3
                  WHERE ${spec.column} = $1 AND media_asset_id = $2 AND role = 'coat' AND retired_at IS NOT NULL
                 RETURNING id::text AS id, revision::int AS revision`,
                [subjectId, asset.id, revision],
            );
            const [created] =
                back === undefined
                    ? await tx.unsafe<{ id: string; revision: number }[]>(
                          `INSERT INTO ${spec.binding} (${spec.column}, media_asset_id, role, origin, revision)
                           VALUES ($1, $2, 'coat', 'editor', $3)
                           RETURNING id::text AS id, revision::int AS revision`,
                          [subjectId, asset.id, revision],
                      )
                    : [back];
            const binding = created!;
            entries.push({
                action: "binding.coat_set",
                assetId: asset.publicId,
                targetRevision: binding.revision,
                details: {
                    binding: mediaBindingKey(spec.binding, binding.id),
                    subject,
                    role: "coat",
                    ...(back === undefined ? {} : { reactivated: true }),
                },
            });
            derivedWork.unshift(
                await enqueueSettle(tx, { assetPublicId: asset.publicId, role: "coat", actorPersonId: actor.personId }),
            );
            const titled = await deriveTitle(tx, asset.id);
            return {
                receipt: {
                    affected: [{ kind: "coat", id: subject, revision: binding.revision }, ...titled.affected],
                    derivedWork,
                    warnings: [],
                },
                entries: [...entries, ...titled.entries],
            };
        },
    );
}

/** Wappen entfernen: Der Platz wird „bewusst ohne“ (Unterdrückung mit Herkunft `editor`), das Asset bleibt. */
export function removeCoat(database: Database, actor: MediaActor, body: MediaCoatNoneBody): Promise<OperationReceipt> {
    const subject = subjectRef(body.subject.kind, body.subject.id);
    return mediaOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "coat.none", body: { subject, baseRevision: body.baseRevision } },
        async (tx) => {
            const { id: subjectId, spec } = await lockSlot(tx, body.subject.kind, body.subject.id, "coat");
            const active = await activeBinding(tx, spec, subjectId, "coat");
            if (active === undefined) throw slotChanged();
            if (active.revision !== body.baseRevision) {
                throw await mediaEditConflict(
                    tx,
                    { record: "binding", assetId: active.assetId, binding: mediaBindingKey(spec.binding, active.id) },
                    { revision: active.revision, changedAt: active.updatedAt },
                );
            }
            const revision = await retireBinding(tx, spec, active.id);
            await tx.unsafe(
                `INSERT INTO ${spec.suppression} (${spec.column}, role, origin) VALUES ($1, 'coat', 'editor')
                 ON CONFLICT (${spec.column}, role) DO UPDATE SET origin = 'editor', legacy_reason = NULL`,
                [subjectId],
            );
            return {
                receipt: {
                    affected: [{ kind: "coat", id: subject }],
                    derivedWork: [
                        await enqueueSettle(tx, {
                            assetPublicId: active.assetId,
                            role: "coat",
                            actorPersonId: actor.personId,
                        }),
                    ],
                    warnings: [],
                },
                entries: [
                    {
                        action: "binding.coat_none",
                        assetId: active.assetId,
                        targetRevision: revision,
                        details: { binding: mediaBindingKey(spec.binding, active.id), subject, role: "coat" },
                    },
                ],
            };
        },
    );
}

// --- Titelbilder ----------------------------------------------------------------------------------------------------------------

export interface HeaderGallery {
    id: string;
    publicId: string;
    revision: number;
    updatedAt: Date;
    bindingId: string;
}

interface GalleryItem {
    id: string;
    assetDbId: string;
    assetId: string;
    sortOrder: number;
    retired: boolean;
}

export async function headerGallery(tx: Queryable, placeId: string): Promise<HeaderGallery | undefined> {
    const [row] = await tx<{ id: string; public_id: string; revision: number; updated_at: Date; binding_id: string }[]>`
        SELECT g.id::text AS id, g.public_id::text AS public_id, g.revision::int AS revision, g.updated_at, b.id::text AS binding_id
          FROM place_media_gallery b JOIN media_gallery g ON g.id = b.media_gallery_id
         WHERE b.place_id = ${placeId} AND b.role = 'header' AND b.retired_at IS NULL
           FOR UPDATE OF g
    `;
    return row === undefined
        ? undefined
        : {
              id: row.id,
              publicId: row.public_id,
              revision: row.revision,
              updatedAt: row.updated_at,
              bindingId: row.binding_id,
          };
}

async function galleryItems(tx: Queryable, galleryId: string): Promise<GalleryItem[]> {
    return tx<GalleryItem[]>`
        SELECT i.id::text AS id, i.media_asset_id::text AS "assetDbId", a.public_id::text AS "assetId", i.sort_order AS "sortOrder",
               i.retired_at IS NOT NULL AS retired
          FROM media_gallery_item i JOIN media_asset a ON a.id = i.media_asset_id
         WHERE i.gallery_id = ${galleryId}
         ORDER BY i.retired_at IS NOT NULL, i.sort_order, i.id
           FOR UPDATE OF i
    `;
}

/** Der gesehene Stand der Galerie: ihre Revision, oder keine, wenn der Ort noch keine Galerie hatte. */
export async function requireGalleryBase(
    tx: Queryable,
    gallery: HeaderGallery | undefined,
    baseRevision: number | undefined,
): Promise<void> {
    if (gallery === undefined) {
        if (baseRevision !== undefined) throw slotChanged();
        return;
    }
    if (baseRevision !== gallery.revision) {
        throw await mediaEditConflict(
            tx,
            { record: "gallery", galleryId: gallery.publicId },
            { revision: gallery.revision, changedAt: gallery.updatedAt },
        );
    }
}

// --- Titelbild: EIN Bild ODER EINE Galerie (WI-0219) ----------------------------------------------------------------------------
//
// Betreiber 2026-10-17: „er kann nicht mehr wie ein bild haben, EIN titelbild oder EINE Galerie“. Das Einzelbild ist eine Bindung
// `place_media` der Rolle `header` (Schema seit 0064, vom Resolver gelesen), die Galerie eine Bindung `place_media_gallery`. Jede
// Wahl ersetzt, was bisher am Ort hängt; das Alte wird nur gelöst und bleibt in der Medienverwaltung unter „Bilder“ bzw. „Galerien“
// (Orchestrierung 2026-10-17, Option A). Die 78 Titelbilder aus Legacy sind Galerien mit einem Bild und bleiben es, bis jemand wählt.

/** Was das Lösen des Bisherigen ins Protokoll und in die Quittung legt. */
export interface HeaderRelease {
    entries: MediaAuditEntry[];
    derivedWork: DerivedWork[];
    warnings: { code: string; message: string }[];
}

const PLACE = SUBJECTS.place;

/** Das Einzelbild als Titelbild lösen: Die Bindung wird zurückgezogen, das Asset bleibt. `replacedBy` nennt, was an seine Stelle tritt. */
async function releaseImage(
    tx: Queryable,
    image: ActiveBinding,
    subject: string,
    actorPersonId: string,
    replacedBy: string | undefined,
): Promise<HeaderRelease> {
    const revision = await retireBinding(tx, PLACE, image.id);
    return {
        entries: [
            {
                action: "binding.header_released",
                assetId: image.assetId,
                galleryId: null,
                targetRevision: revision,
                details: {
                    binding: mediaBindingKey(PLACE.binding, image.id),
                    subject,
                    role: "header",
                    ...(replacedBy === undefined ? {} : { replacedBy }),
                },
            },
        ],
        derivedWork: [await enqueueSettle(tx, { assetPublicId: image.assetId, role: "header", actorPersonId })],
        warnings: [],
    };
}

/**
 * Die Galerie als Titelbild lösen (wie `gallery.unbind`): Nur dieser Ort verliert sie, Bilder, Folge und andere Orte bleiben. Hängt sie
 * danach an keinem Ort mehr, ist sie ein Entwurf, und die Quittung sagt es.
 */
export async function releaseHeaderGallery(
    tx: Queryable,
    gallery: HeaderGallery,
    subject: string,
    actorPersonId: string,
    replacedBy: string | undefined,
): Promise<HeaderRelease> {
    await tx`UPDATE place_media_gallery SET retired_at = now(), updated_at = now() WHERE id = ${gallery.bindingId}`;
    const [rest] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM place_media_gallery WHERE media_gallery_id = ${gallery.id} AND retired_at IS NULL
    `;
    const draft = (rest?.n ?? 0) === 0;
    const derivedWork: DerivedWork[] = [];
    for (const item of await galleryItems(tx, gallery.id)) {
        if (!item.retired)
            derivedWork.push(await enqueueSettle(tx, { assetPublicId: item.assetId, role: "header", actorPersonId }));
    }
    return {
        entries: [
            {
                action: "gallery.unbound",
                galleryId: gallery.publicId,
                targetRevision: gallery.revision,
                details: { subject, role: "header", draft, ...(replacedBy === undefined ? {} : { replacedBy }) },
            },
        ],
        derivedWork,
        warnings: draft
            ? [
                  {
                      code: "gallery_is_draft",
                      message:
                          "Diese Galerie hängt an keinem Ort mehr. Ihre Bilder sind damit für Besucher unsichtbar.",
                  },
              ]
            : [],
    };
}

/** Ein Einzelbild des Orts lösen, falls eins hängt (eine Galerie kommt an seine Stelle, `gallery.bind`). */
export async function releaseHeaderImageOf(
    tx: Queryable,
    placeDbId: string,
    subject: string,
    actorPersonId: string,
    replacedBy: string,
): Promise<HeaderRelease> {
    const image = await activeBinding(tx, PLACE, placeDbId, "header");
    return image === undefined
        ? { entries: [], derivedWork: [], warnings: [] }
        : releaseImage(tx, image, subject, actorPersonId, replacedBy);
}

/** Was am Ort als Titelbild hängt, samt Sperre: das Einzelbild, die Galerie (nie beides, sonst beides) und ob er „bewusst ohne“ ist. */
async function headerSlot(tx: Queryable, placeDbId: string) {
    return {
        image: await activeBinding(tx, PLACE, placeDbId, "header"),
        gallery: await headerGallery(tx, placeDbId),
        suppressed: await isSuppressed(tx, PLACE, placeDbId, "header"),
    };
}

/** Der gesehene Stand muss gelten: am Einzelbild seine Revision, an der Galerie ihre, sonst der Zustand des Platzes. */
async function requireHeaderBase(
    tx: Queryable,
    slot: Awaited<ReturnType<typeof headerSlot>>,
    seen: { baseRevision?: number | undefined; galleryRevision?: number | undefined; baseState?: string | undefined },
): Promise<void> {
    if (slot.image !== undefined) {
        if (seen.baseRevision === slot.image.revision) return;
        throw await mediaEditConflict(
            tx,
            { record: "binding", assetId: slot.image.assetId, binding: mediaBindingKey(PLACE.binding, slot.image.id) },
            { revision: slot.image.revision, changedAt: slot.image.updatedAt },
        );
    }
    if (slot.gallery !== undefined) {
        await requireGalleryBase(tx, slot.gallery, seen.galleryRevision);
        return;
    }
    // Nichts hängt: Der gesehene Zustand des Platzes muss gelten (ohne Entscheid oder „bewusst ohne“), wie beim Wappen.
    if (seen.baseRevision !== undefined || seen.galleryRevision !== undefined) throw slotChanged();
    if (seen.baseState !== (slot.suppressed ? "none" : "undecided")) throw slotChanged();
}

/** Beides lösen, was hängt (Einzelbild, Galerie); `replacedBy` fürs Protokoll. */
async function releaseSlot(
    tx: Queryable,
    slot: Awaited<ReturnType<typeof headerSlot>>,
    subject: string,
    actorPersonId: string,
    replacedBy: string | undefined,
): Promise<HeaderRelease> {
    const parts = [
        slot.image === undefined ? undefined : await releaseImage(tx, slot.image, subject, actorPersonId, replacedBy),
        slot.gallery === undefined
            ? undefined
            : await releaseHeaderGallery(tx, slot.gallery, subject, actorPersonId, replacedBy),
    ].filter((part): part is HeaderRelease => part !== undefined);
    return {
        entries: parts.flatMap((part) => part.entries),
        derivedWork: parts.flatMap((part) => part.derivedWork),
        warnings: parts.flatMap((part) => part.warnings),
    };
}

/** Genau ein gesehener Stand. */
function oneBase(body: { baseRevision?: number; galleryRevision?: number; baseState?: string }): void {
    const given = [body.baseRevision, body.galleryRevision, body.baseState].filter((value) => value !== undefined);
    if (given.length > 1) {
        throw new ApiError(
            400,
            "validation_failed",
            "Genau ein gesehener Stand: die Revision des Einzelbilds, die der Galerie oder der Zustand des Platzes.",
            { issues: [{ path: "baseState", rule: "not_allowed" }] },
        );
    }
}

/** Das Titelbild setzen: EIN Bild; was bisher hängt (Einzelbild oder Galerie), wird gelöst (`MediaHeaderSetBody`). */
export function setHeader(database: Database, actor: MediaActor, body: MediaHeaderSetBody): Promise<OperationReceipt> {
    oneBase(body);
    const subject = subjectRef("place", body.placeId);
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "header.set",
            body: {
                subject,
                assetId: body.assetId,
                baseRevision: body.baseRevision,
                galleryRevision: body.galleryRevision,
                baseState: body.baseState,
            },
        },
        async (tx) => {
            const { id: placeId } = await lockSlot(tx, "place", body.placeId, "header");
            const asset = await bindableAsset(tx, body.assetId, "header");
            const slot = await headerSlot(tx, placeId);
            await requireHeaderBase(tx, slot, body);
            if (slot.image?.assetId === asset.publicId) {
                throw new ApiError(409, "media_already_bound", "Dieses Bild ist hier schon das Titelbild.");
            }
            const released = await releaseSlot(tx, slot, subject, actor.personId, asset.publicId);
            if (slot.suppressed)
                await tx`DELETE FROM place_media_suppression WHERE place_id = ${placeId} AND role = 'header'`;
            // Eine frühere, zurückgezogene Bindung desselben Bildes kommt zurück (je Platz und Bild eine Zeile, Migration 0064).
            const revision = await naechsteRevision(tx, PLACE, placeId, "header");
            const [back] = await tx<{ id: string; revision: number }[]>`
                UPDATE place_media SET retired_at = NULL, origin = 'editor', updated_at = now(), revision = ${revision}
                 WHERE place_id = ${placeId} AND media_asset_id = ${asset.id} AND role = 'header' AND retired_at IS NOT NULL
                RETURNING id::text AS id, revision::int AS revision
            `;
            const [created] =
                back === undefined
                    ? await tx<{ id: string; revision: number }[]>`
                          INSERT INTO place_media (place_id, media_asset_id, role, origin, revision)
                          VALUES (${placeId}, ${asset.id}, 'header', 'editor', ${revision})
                          RETURNING id::text AS id, revision::int AS revision
                      `
                    : [back];
            const binding = created!;
            const titled = await deriveTitle(tx, asset.id);
            return {
                receipt: {
                    affected: [{ kind: "header", id: subject, revision: binding.revision }, ...titled.affected],
                    derivedWork: [
                        await enqueueSettle(tx, {
                            assetPublicId: asset.publicId,
                            role: "header",
                            actorPersonId: actor.personId,
                        }),
                        ...released.derivedWork,
                    ],
                    warnings: released.warnings,
                },
                entries: [
                    ...released.entries,
                    {
                        action: "binding.header_set",
                        assetId: asset.publicId,
                        targetRevision: binding.revision,
                        details: {
                            binding: mediaBindingKey(PLACE.binding, binding.id),
                            subject,
                            role: "header",
                            ...(back === undefined ? {} : { reactivated: true }),
                        },
                    },
                    ...titled.entries,
                ],
            };
        },
    );
}

/**
 * „Titelbild entfernen“: lösen, was hängt, und den Platz für gebundene Bilder schließen, damit kein Import es wieder bindet (`MediaHeaderNoneBody`). Vali 2026-11-02: „wird ein titelbild entfernt ist das
 * gleichzusetzen mit "kein titelbild aber typbild"“. Der Kopf zeigt danach das Typbild oder, wenn der Ort welche hat, die Reisebilder (`PLACE_REISEBILDER_QUERY`).
 */
export function setHeaderNone(
    database: Database,
    actor: MediaActor,
    body: MediaHeaderNoneBody,
): Promise<OperationReceipt> {
    oneBase(body);
    const subject = subjectRef("place", body.placeId);
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "header.none",
            body: { subject, baseRevision: body.baseRevision, galleryRevision: body.galleryRevision },
        },
        async (tx) => {
            const { id: placeId } = await lockSlot(tx, "place", body.placeId, "header");
            const slot = await headerSlot(tx, placeId);
            if (slot.image === undefined && slot.gallery === undefined) throw slotChanged();
            await requireHeaderBase(tx, slot, body);
            const released = await releaseSlot(tx, slot, subject, actor.personId, undefined);
            await tx`
                INSERT INTO place_media_suppression (place_id, role, origin) VALUES (${placeId}, 'header', 'editor')
                ON CONFLICT (place_id, role) DO UPDATE SET origin = 'editor', legacy_reason = NULL
            `;
            return {
                receipt: {
                    affected: [{ kind: "header", id: subject }],
                    derivedWork: released.derivedWork,
                    warnings: released.warnings,
                },
                entries: [
                    ...released.entries,
                    {
                        action: "binding.header_none",
                        // Hängt nur eine Galerie, ist SIE das Ziel: ohne Ziel lehnt `media_audit_event_has_target` die Zeile ab
                        // (Fund des Betreibers 2026-10-18 an A'Sarar, „galerie lösen geht noch nicht“: 500).
                        assetId: slot.image?.assetId ?? null,
                        galleryId: slot.image === undefined ? (slot.gallery?.publicId ?? null) : null,
                        details: { subject, role: "header" },
                    },
                ],
            };
        },
    );
}
