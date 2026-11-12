import {
    MEDIA_GALLERY_ITEMS_MAX,
    type DerivedWork,
    type MediaGalleryAddBody,
    type MediaGalleryDeleteBody,
    type MediaGalleryDeleteHindernis,
    type MediaGalleryBindBody,
    type MediaGalleryCaptionBody,
    type MediaGalleryCoverBody,
    type MediaGalleryCreateBody,
    type MediaGalleryOrderBody,
    type MediaGalleryRemoveBody,
    type MediaGalleryTitleBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { notFound } from "./asset-operations.ts";
import { mediaEditConflict } from "./audit.ts";
import {
    bindableAsset,
    headerGallery,
    lockSlot,
    releaseHeaderGallery,
    releaseHeaderImageOf,
    requireGalleryBase,
    type HeaderRelease,
} from "./binding-operations.ts";
import { mediaOperation, type MediaActor, type MediaAuditEntry } from "./operation-store.ts";
import { enqueueSettle } from "./settle.ts";
import { nameUntitledAssets } from "./titles.ts";
import { MEDIA_EDITOR_SOURCE_SYSTEM } from "./upload.ts";

/**
 * Die Galerie als eigenes Medienobjekt im Schreibpfad (WI-0068 P6; Vertrag `packages/shared/src/media-gallery-operations.ts`).
 *
 * | Operation         | was                                                             |
 * |-------------------|-----------------------------------------------------------------|
 * | `gallery.create`  | eine Galerie anlegen - ohne Ort, also als Entwurf               |
 * | `gallery.title`   | Titel setzen oder leeren                                        |
 * | `gallery.add`     | ein Bild hineinlegen                                            |
 * | `gallery.order`   | die aktiven Einträge in neue Folge bringen                      |
 * | `gallery.cover`   | das Titelbild setzen oder zurücknehmen                          |
 * | `gallery.caption` | die Bildunterschrift eines Eintrags                             |
 * | `gallery.remove`  | ein Bild herausnehmen (Eintrag zurückgezogen, das Asset bleibt) |
 * | `gallery.bind`    | die Galerie an einen Ort binden                                 |
 * | `gallery.unbind`  | die Bindung an einen Ort lösen                                  |
 *
 * 🔴 **Am Ort hängt EIN Titelbild ODER EINE Galerie** (WI-0219, `binding-operations.ts`): `gallery.bind` löst ein Einzelbild des Orts
 * und ersetzt eine bisherige Galerie nur ausdrücklich (`replaceRevision`). Diese Operationen arbeiten an der GALERIE und können
 * deshalb, was von einem Ort aus nicht geht: eine Galerie ohne Ort anlegen, sie an einen zweiten Ort binden, eine Bindung lösen,
 * ohne die Bilder anzufassen.
 *
 * 🔴 **Alles gegen die Revision der GALERIE.** Sie steigt auch bei einer Änderung an einem Eintrag (Trigger
 * `media_gallery_item_touches_gallery`, Migration 0086): EINE `baseRevision` schützt die ganze Folge, und zwei gleichzeitige
 * Umsortierungen enden in 409 statt in einem stillen Überschreiben.
 *
 * 🔴 **Binden und Lösen rühren die Bilder nicht an.** Lösen nimmt NUR diesem Ort die Galerie; Bilder, Folge und die anderen Orte
 * bleiben. Lösen ist deshalb kein Zurückziehen von Einträgen - wer das will, nimmt `gallery.remove`.
 *
 * 🪤 **„Entwurf“ steht nirgends als Spalte, sondern folgt aus der fehlenden Ortsbindung.** `publication_state` bleibt
 * `published` wie bei jeder Galerie, die der Ortseditor anlegt: Der Publikationsentscheid liest die Spalte NICHT, er fragt nach
 * Verwendungen - und eine Galerie ohne Ort ist keine (`readUsages` in `migration/media-publication.ts` verbindet über die
 * Ortsbindung). Eine zweite Quelle der Wahrheit („draft“ in der Spalte) liefe früher oder später gegen die erste; die Oberfläche
 * rechnet den Entwurf aus den Bindungen (`medien-galerien-modell.ts`, `istEntwurf`).
 *
 * 🪤 **Was ein Mensch anfasst, gehört ab dann ihm**: Jede dieser Operationen setzt `origin = 'editor'` an Galerie und aktiven
 * Bindungen, damit der Medienimport sie nicht wieder abgleicht (Schutzregel wie bei den ortsbezogenen Operationen).
 */

interface GalleryRow {
    id: string;
    publicId: string;
    revision: number;
    updatedAt: Date;
}

interface ItemRow {
    id: string;
    assetDbId: string;
    assetId: string;
    sortOrder: number;
    retired: boolean;
}

const notInGallery = (): ApiError =>
    new ApiError(409, "media_not_bound", "Dieses Bild steht nicht (mehr) in dieser Galerie.");

/** Die Galerie über ihre öffentliche Kennung, gesperrt für diese Transaktion. */
async function lockGallery(tx: Queryable, publicId: string): Promise<GalleryRow> {
    const [row] = await tx<{ id: string; revision: number; updated_at: Date }[]>`
        SELECT id::text AS id, revision::int AS revision, updated_at FROM media_gallery
         WHERE public_id = ${publicId}::uuid FOR UPDATE
    `;
    if (row === undefined) throw notFound("Diese Galerie");
    return { id: row.id, publicId, revision: row.revision, updatedAt: row.updated_at };
}

async function requireBase(tx: Queryable, gallery: GalleryRow, baseRevision: number): Promise<void> {
    if (baseRevision === gallery.revision) return;
    throw await mediaEditConflict(
        tx,
        { record: "gallery", galleryId: gallery.publicId },
        { revision: gallery.revision, changedAt: gallery.updatedAt },
    );
}

async function items(tx: Queryable, galleryId: string): Promise<ItemRow[]> {
    return tx<ItemRow[]>`
        SELECT i.id::text AS id, i.media_asset_id::text AS "assetDbId", a.public_id::text AS "assetId",
               i.sort_order AS "sortOrder", i.retired_at IS NOT NULL AS retired
          FROM media_gallery_item i JOIN media_asset a ON a.id = i.media_asset_id
         WHERE i.gallery_id = ${galleryId}
         ORDER BY i.retired_at IS NOT NULL, i.sort_order, i.id
           FOR UPDATE OF i
    `;
}

/** Die aktiven Einträge auf 0 … n-1 in dieser Folge, die zurückgezogenen dahinter (ihre Folge bleibt). */
async function renumber(tx: Queryable, alle: readonly ItemRow[], aktiveFolge: readonly string[]): Promise<void> {
    const zurueck = alle.filter((item) => item.retired);
    const folge = [...aktiveFolge, ...zurueck.map((item) => item.id)];
    for (const [position, id] of folge.entries()) {
        const item = alle.find((entry) => entry.id === id);
        if (item === undefined || item.sortOrder === position) continue;
        await tx`UPDATE media_gallery_item SET sort_order = ${position}, updated_at = now() WHERE id = ${id}`;
    }
}

/** Galerie und ihre aktiven Bindungen gehören ab jetzt dem Editor; danach die frische Revision. */
async function claim(tx: Queryable, gallery: GalleryRow): Promise<number> {
    await tx`UPDATE media_gallery SET origin = 'editor' WHERE id = ${gallery.id} AND origin <> 'editor'`;
    await tx`
        UPDATE place_media_gallery SET origin = 'editor', updated_at = now()
         WHERE media_gallery_id = ${gallery.id} AND retired_at IS NULL AND origin <> 'editor'
    `;
    const [row] = await tx<{ revision: number }[]>`
        SELECT revision::int AS revision FROM media_gallery WHERE id = ${gallery.id}
    `;
    return row!.revision;
}

/**
 * Die Assets der aktiven Einträge neu rechnen lassen: Folge, Cover und Ortsbindung ändern, was öffentlich ausgeliefert wird.
 * Ein zweiter Job für dasselbe Asset schadet nicht, der Abgleich ist wiederholbar.
 */
async function settleActive(tx: Queryable, alle: readonly ItemRow[], actorPersonId: string): Promise<DerivedWork[]> {
    const work: DerivedWork[] = [];
    for (const item of alle.filter((entry) => !entry.retired)) {
        work.push(await enqueueSettle(tx, { assetPublicId: item.assetId, role: "header", actorPersonId }));
    }
    return work;
}

/**
 * Steht in dieser Galerie schon ein AKTIVER Eintrag, dessen Original dieselben Bytes hat?
 *
 * 🔴 Legacy legte je Verwendung ein eigenes Werk an: 1.025 Assets teilen ihre Quelldatei mit einem anderen (WI-0068 §21).
 * Zwei solche Werke in EINER Galerie sind zweimal dasselbe Bild — der Nutzer sähe eine Dublette, und das spätere
 * Zusammenführen (D1, `media_merge`) müsste sie wieder auflösen. Die Eindeutigkeit der Tafel
 * (`media_gallery_item_asset_unique`) fängt das NICHT: Sie prüft die Asset-Kennung, und das sind zwei verschiedene.
 *
 * 🪤 Verglichen wird das ORIGINAL (`private_source`), nicht die veröffentlichte Datei: Die ist gerechnet (WebP, Größe aus
 * dem Rezept) und kann sich zwischen zwei Läufen ändern, ohne dass sich das Werk ändert.
 */
async function gleicheDateiInGalerie(
    tx: Queryable,
    galleryId: string,
    assetDbId: string,
): Promise<{ publicId: string; titel: string | null } | undefined> {
    const [row] = await tx<{ publicId: string; titel: string | null }[]>`
        SELECT a.public_id::text AS "publicId", a.title AS titel
          FROM media_file neu
          JOIN media_file alt ON alt.sha256 = neu.sha256 AND alt.storage_class = 'private_source'
                             AND alt.media_asset_id <> neu.media_asset_id
          JOIN media_gallery_item i ON i.media_asset_id = alt.media_asset_id
                                   AND i.gallery_id = ${galleryId} AND i.retired_at IS NULL
          JOIN media_asset a ON a.id = alt.media_asset_id
         WHERE neu.media_asset_id = ${assetDbId} AND neu.storage_class = 'private_source'
         LIMIT 1
    `;
    return row;
}

/** Die Bilder einer gerade gebundenen Galerie bekommen ihren Namen aus dem Fachobjekt (`titles.ts`). */
async function deriveTitles(
    tx: Queryable,
    assetDbIds: readonly string[],
): Promise<{ affected: { kind: string; id: string; revision: number }[]; entries: MediaAuditEntry[] }> {
    const { named } = await nameUntitledAssets(tx, { assetIds: assetDbIds });
    return {
        affected: named.map((asset) => ({ kind: "media_asset", id: asset.publicId, revision: asset.revision })),
        entries: named.map((asset) => ({
            action: "asset.title_derived",
            assetId: asset.publicId,
            galleryId: null,
            targetRevision: asset.revision,
            details: { subject: asset.subject, role: asset.role },
        })),
    };
}

interface Work {
    receipt: Omit<OperationReceipt, "operationId" | "status" | "environment">;
    entries: MediaAuditEntry[];
}

/** Der gemeinsame Rahmen: Galerie sperren, Revision prüfen, arbeiten, Besitz übernehmen, Quittung mit frischer Revision. */
function galleryOperation(
    database: Database,
    actor: MediaActor,
    input: { operationId: string; operation: string; galleryId: string; baseRevision: number; body: object },
    work: (tx: Queryable, gallery: GalleryRow, alle: ItemRow[]) => Promise<Work>,
): Promise<OperationReceipt> {
    return mediaOperation(
        database,
        actor,
        {
            operationId: input.operationId,
            operation: input.operation,
            body: { gallery: input.galleryId, baseRevision: input.baseRevision, ...input.body },
        },
        async (tx) => {
            const gallery = await lockGallery(tx, input.galleryId);
            await requireBase(tx, gallery, input.baseRevision);
            const alle = await items(tx, gallery.id);
            const ergebnis = await work(tx, gallery, alle);
            const revision = await claim(tx, gallery);
            return {
                receipt: {
                    ...ergebnis.receipt,
                    affected: [{ kind: "gallery", id: gallery.publicId, revision }, ...ergebnis.receipt.affected],
                },
                entries: ergebnis.entries.map((entry) => ({
                    ...entry,
                    galleryId: entry.galleryId === undefined ? gallery.publicId : entry.galleryId,
                    targetRevision: entry.targetRevision ?? revision,
                })),
            };
        },
    );
}

/**
 * Eine Galerie anlegen - ohne Ort. Damit ist sie ein Entwurf: Ihre Bilder sind für Besucher unsichtbar, bis sie jemand an einen
 * Ort bindet (Betreiber 2026-10-13).
 */
export function createGallery(
    database: Database,
    actor: MediaActor,
    body: MediaGalleryCreateBody,
): Promise<OperationReceipt> {
    const titel = body.title?.trim();
    return mediaOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "gallery.create", body: {} },
        async (tx) => {
            const [row] = await tx<{ public_id: string; revision: number }[]>`
                INSERT INTO media_gallery (gallery_kind, source_system, origin, publication_state, title)
                VALUES ('object_gallery', ${MEDIA_EDITOR_SOURCE_SYSTEM}, 'editor', 'published',
                        ${titel === undefined || titel === "" ? null : titel})
                RETURNING public_id::text AS public_id, revision::int AS revision
            `;
            return {
                receipt: {
                    affected: [{ kind: "gallery", id: row!.public_id, revision: row!.revision }],
                    derivedWork: [],
                    warnings: [],
                },
                entries: [
                    {
                        action: "gallery.created",
                        galleryId: row!.public_id,
                        targetRevision: row!.revision,
                        details: { role: "header" },
                    },
                ],
            };
        },
    );
}

export function setGalleryTitle(
    database: Database,
    actor: MediaActor,
    body: MediaGalleryTitleBody,
): Promise<OperationReceipt> {
    const titel = body.title?.trim();
    const wert = titel === undefined || titel === "" ? null : titel;
    return galleryOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "gallery.title",
            galleryId: body.galleryId,
            baseRevision: body.baseRevision,
            body: {},
        },
        async (tx, gallery) => {
            await tx`UPDATE media_gallery SET title = ${wert} WHERE id = ${gallery.id}`;
            return {
                receipt: { affected: [], derivedWork: [], warnings: [] },
                entries: [{ action: "gallery.title_set", details: { fields: wert === null ? [] : ["title"] } }],
            };
        },
    );
}

/**
 * Ein Bild in die Galerie legen. Ein zurückgezogener Eintrag desselben Bildes wird wieder aufgenommen, statt einen zweiten
 * anzulegen (`media_gallery_item_asset_unique`).
 *
 * Keine Zehnergrenze (Betreiber 2026-10-12: „Grenze 10 entfällt“); es gilt nur der technische Deckel eines Auftrags
 * (`MEDIA_GALLERY_ITEMS_MAX`), derselbe wie in `gallery.order`.
 */
export function addToGallery(
    database: Database,
    actor: MediaActor,
    body: MediaGalleryAddBody,
): Promise<OperationReceipt> {
    return galleryOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "gallery.add",
            galleryId: body.galleryId,
            baseRevision: body.baseRevision,
            body: { assetId: body.assetId, position: body.position },
        },
        async (tx, gallery, alle) => {
            const asset = await bindableAsset(tx, body.assetId, "header");
            const aktiv = alle.filter((item) => !item.retired);
            if (aktiv.some((item) => item.assetId === asset.publicId)) {
                throw new ApiError(409, "media_already_bound", "Dieses Bild steht schon in dieser Galerie.");
            }
            const doppelt = await gleicheDateiInGalerie(tx, gallery.id, asset.id);
            if (doppelt !== undefined) {
                throw new ApiError(
                    409,
                    "media_duplicate_file",
                    `Dieselbe Datei steht schon in dieser Galerie, als „${doppelt.titel ?? "Bild ohne Titel"}“. Zwei Werke mit denselben Bytes sind dasselbe Bild; sie gehören zusammengeführt, nicht nebeneinander.`,
                    { assetId: doppelt.publicId },
                );
            }
            if (aktiv.length >= MEDIA_GALLERY_ITEMS_MAX) {
                throw new ApiError(
                    409,
                    "gallery_full",
                    `Eine Galerie trägt höchstens ${String(MEDIA_GALLERY_ITEMS_MAX)} Bilder.`,
                );
            }
            const position = Math.min(body.position ?? aktiv.length, aktiv.length);
            const zurueck = alle.find((item) => item.retired && item.assetId === asset.publicId);
            let itemId: string;
            if (zurueck !== undefined) {
                await tx`UPDATE media_gallery_item SET retired_at = NULL, updated_at = now() WHERE id = ${zurueck.id}`;
                zurueck.retired = false;
                itemId = zurueck.id;
            } else {
                // Erst hinten geparkt, dann an seine Stelle nummeriert: die Folge ist je Galerie eindeutig, aber DEFERRABLE.
                const geparkt = 1_000_000 + alle.length;
                const [inserted] = await tx<{ id: string }[]>`
                    INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order)
                    VALUES (${gallery.id}, ${asset.id}, ${geparkt})
                    RETURNING id::text AS id
                `;
                itemId = inserted!.id;
                alle.push({
                    id: itemId,
                    assetDbId: asset.id,
                    assetId: asset.publicId,
                    sortOrder: geparkt,
                    retired: false,
                });
            }
            const folge = aktiv.map((item) => item.id);
            folge.splice(position, 0, itemId);
            await renumber(tx, alle, folge);

            // Den Namen aus dem Fachobjekt gibt es erst, wenn die Galerie an einem Ort hängt; ohne Ort findet `titles.ts` keinen.
            const titled = await deriveTitles(tx, [asset.id]);
            return {
                receipt: {
                    affected: titled.affected,
                    derivedWork: [
                        await enqueueSettle(tx, {
                            assetPublicId: asset.publicId,
                            role: "header",
                            actorPersonId: actor.personId,
                        }),
                    ],
                    warnings: [],
                },
                entries: [
                    {
                        action: "gallery.header_added",
                        assetId: asset.publicId,
                        details: { position, ...(zurueck === undefined ? {} : { reactivated: true }) },
                    },
                    ...titled.entries,
                ],
            };
        },
    );
}

/** Die Folge: GENAU die aktiven Einträge, in neuer Reihenfolge. Fehlt einer oder ist einer zu viel, ist die Anfrage falsch. */
export function orderGallery(
    database: Database,
    actor: MediaActor,
    body: MediaGalleryOrderBody,
): Promise<OperationReceipt> {
    return galleryOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "gallery.order",
            galleryId: body.galleryId,
            baseRevision: body.baseRevision,
            body: { order: body.order },
        },
        async (tx, gallery, alle) => {
            const aktiv = alle.filter((item) => !item.retired);
            const gewuenscht = new Set(body.order);
            if (gewuenscht.size !== aktiv.length || aktiv.some((item) => !gewuenscht.has(item.assetId))) {
                throw new ApiError(
                    400,
                    "validation_failed",
                    "Die Folge muss genau die Bilder dieser Galerie nennen, jedes einmal.",
                    { issues: [{ path: "order", rule: "exact_set" }] },
                );
            }
            const folge = body.order.map((assetId) => aktiv.find((item) => item.assetId === assetId)!.id);
            await renumber(tx, alle, folge);
            return {
                receipt: {
                    affected: [],
                    derivedWork: await settleActive(tx, alle, actor.personId),
                    warnings: [],
                },
                entries: [{ action: "gallery.header_reordered", details: { order: body.order.length } }],
            };
        },
    );
}

/** Das Titelbild; `null` nimmt die Setzung zurück, dann gilt wieder der erste Eintrag. */
export function setGalleryCover(
    database: Database,
    actor: MediaActor,
    body: MediaGalleryCoverBody,
): Promise<OperationReceipt> {
    return galleryOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "gallery.cover",
            galleryId: body.galleryId,
            baseRevision: body.baseRevision,
            body: { assetId: body.assetId },
        },
        async (tx, gallery, alle) => {
            if (body.assetId === null) {
                await tx`UPDATE media_gallery SET cover_item_id = NULL WHERE id = ${gallery.id}`;
            } else {
                // 🪤 Nur ein AKTIVER Eintrag kann Titelbild sein, sonst zeigte die Galerie ein Bild, das sie nicht mehr führt.
                const item = alle.find((entry) => !entry.retired && entry.assetId === body.assetId);
                if (item === undefined) throw notInGallery();
                await tx`UPDATE media_gallery SET cover_item_id = ${item.id}::bigint WHERE id = ${gallery.id}`;
            }
            return {
                receipt: {
                    affected: [],
                    derivedWork: await settleActive(tx, alle, actor.personId),
                    warnings: [],
                },
                entries: [
                    {
                        action: "gallery.cover_set",
                        assetId: body.assetId,
                        details: body.assetId === null ? { cleared: true } : {},
                    },
                ],
            };
        },
    );
}

export function setGalleryCaption(
    database: Database,
    actor: MediaActor,
    body: MediaGalleryCaptionBody,
): Promise<OperationReceipt> {
    const text = body.caption?.trim();
    const wert = text === undefined || text === "" ? null : text;
    return galleryOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "gallery.caption",
            galleryId: body.galleryId,
            baseRevision: body.baseRevision,
            body: { assetId: body.assetId },
        },
        async (tx, gallery, alle) => {
            const item = alle.find((entry) => !entry.retired && entry.assetId === body.assetId);
            if (item === undefined) throw notInGallery();
            await tx`UPDATE media_gallery_item SET caption = ${wert}, updated_at = now() WHERE id = ${item.id}`;
            return {
                receipt: { affected: [], derivedWork: [], warnings: [] },
                entries: [
                    {
                        action: "gallery.caption_set",
                        assetId: body.assetId,
                        details: { fields: wert === null ? [] : ["caption"] },
                    },
                ],
            };
        },
    );
}

/** Ein Bild aus der Galerie nehmen: der Eintrag wird zurückgezogen, das Asset bleibt unberührt. */
export function removeFromGallery(
    database: Database,
    actor: MediaActor,
    body: MediaGalleryRemoveBody,
): Promise<OperationReceipt> {
    return galleryOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "gallery.remove",
            galleryId: body.galleryId,
            baseRevision: body.baseRevision,
            body: { assetId: body.assetId },
        },
        async (tx, gallery, alle) => {
            const item = alle.find((entry) => !entry.retired && entry.assetId === body.assetId);
            if (item === undefined) throw notInGallery();
            // War es das Titelbild, fällt die Setzung weg: die Oberfläche nimmt dann wieder den ersten Eintrag.
            await tx`
                UPDATE media_gallery SET cover_item_id = NULL
                 WHERE id = ${gallery.id} AND cover_item_id = ${item.id}::bigint
            `;
            await tx`UPDATE media_gallery_item SET retired_at = now(), updated_at = now() WHERE id = ${item.id}`;
            item.retired = true;
            await renumber(
                tx,
                alle,
                alle.filter((entry) => !entry.retired).map((entry) => entry.id),
            );
            return {
                receipt: {
                    affected: [],
                    // Das herausgenommene Bild zuerst: seine öffentliche Datei fällt weg, wenn es sonst nirgends hängt.
                    derivedWork: [
                        await enqueueSettle(tx, {
                            assetPublicId: body.assetId,
                            role: "header",
                            actorPersonId: actor.personId,
                        }),
                        ...(await settleActive(tx, alle, actor.personId)),
                    ],
                    warnings: [],
                },
                entries: [{ action: "gallery.header_removed", assetId: body.assetId, details: {} }],
            };
        },
    );
}

/** Der Ort über seine öffentliche Kennung, gesperrt; ohne ihn 404. */
async function lockPlace(tx: Queryable, publicId: string): Promise<{ id: string }> {
    const [row] = await tx<{ id: string }[]>`
        SELECT id::text AS id FROM place WHERE public_id = ${publicId}::uuid FOR UPDATE
    `;
    if (row === undefined) throw notFound("Diesen Ort");
    return row;
}

export function bindGallery(
    database: Database,
    actor: MediaActor,
    body: MediaGalleryBindBody,
): Promise<OperationReceipt> {
    return galleryOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "gallery.bind",
            galleryId: body.galleryId,
            baseRevision: body.baseRevision,
            body: { subject: `place:${body.placeId}`, replaceRevision: body.replaceRevision },
        },
        async (tx, gallery, alle) => {
            const place = await lockPlace(tx, body.placeId);
            // Dieselbe Sperre des Platzes wie `header.set`: Titelbild und Galerie überholen sich nicht.
            await lockSlot(tx, "place", body.placeId, "header");
            const subject = `place:${body.placeId}`;
            const bisher = await headerGallery(tx, place.id);
            const geloest: HeaderRelease[] = [];
            if (bisher !== undefined) {
                // 🔴 Je Ort höchstens EINE aktive Galerie je Rolle (`place_media_gallery_one_active_per_role`). Ersetzen nur ausdrücklich,
                // mit der gesehenen Revision der bisherigen (der Ortseditor, „Galerie wählen …“, WI-0219).
                if (bisher.publicId === gallery.publicId) {
                    throw new ApiError(409, "media_already_bound", "Diese Galerie hängt schon an diesem Ort.");
                }
                if (body.replaceRevision === undefined) {
                    throw new ApiError(
                        409,
                        "place_has_gallery",
                        "Dieser Ort hat schon eine Galerie. Ein Ort hat eine Galerie, nicht zwei.",
                    );
                }
                await requireGalleryBase(tx, bisher, body.replaceRevision);
                geloest.push(await releaseHeaderGallery(tx, bisher, subject, actor.personId, gallery.publicId));
            }
            // EIN Titelbild ODER EINE Galerie (WI-0219): Ein Einzelbild des Orts wird gelöst und bleibt unter „Bilder“.
            geloest.push(await releaseHeaderImageOf(tx, place.id, subject, actor.personId, gallery.publicId));
            const [frueher] = await tx<{ id: string }[]>`
                SELECT id::text AS id FROM place_media_gallery
                 WHERE place_id = ${place.id} AND media_gallery_id = ${gallery.id} AND role = 'header'
                   FOR UPDATE
            `;
            if (frueher === undefined) {
                await tx`
                    INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin)
                    VALUES (${place.id}, ${gallery.id}, 'header', 'editor')
                `;
            } else {
                // 🪤 Eine früher gelöste Bindung wird WIEDER AUFGENOMMEN: `place_media_gallery_unique` lässt keine zweite Zeile
                // für dasselbe Paar zu, ein zweites INSERT endete sonst in 409 „jemand war schneller“, was hier gelogen wäre.
                await tx`
                    UPDATE place_media_gallery SET retired_at = NULL, origin = 'editor', updated_at = now()
                     WHERE id = ${frueher.id}::bigint
                `;
            }
            // Eine Galerie am Ort hebt eine Unterdrückung der Rolle auf (aus Legacy oder von einem Editor), wie `header.set`.
            await tx`DELETE FROM place_media_suppression WHERE place_id = ${place.id} AND role = 'header'`;
            // Erst mit einem Ort werden die Bilder öffentlich - und bekommen ihren Namen aus dem Fachobjekt.
            const titled = await deriveTitles(
                tx,
                alle.filter((item) => !item.retired).map((item) => item.assetDbId),
            );
            return {
                receipt: {
                    affected: titled.affected,
                    derivedWork: [
                        ...(await settleActive(tx, alle, actor.personId)),
                        ...geloest.flatMap((teil) => teil.derivedWork),
                    ],
                    warnings: geloest.flatMap((teil) => teil.warnings),
                },
                entries: [
                    ...geloest.flatMap((teil) => teil.entries),
                    { action: "gallery.bound", details: { subject, role: "header" } },
                    ...titled.entries,
                ],
            };
        },
    );
}

/** Die Bindung an EINEN Ort lösen; Bilder, Folge und die anderen Orte bleiben unberührt. */
export function unbindGallery(
    database: Database,
    actor: MediaActor,
    body: MediaGalleryBindBody,
): Promise<OperationReceipt> {
    if (body.replaceRevision !== undefined) {
        throw new ApiError(400, "validation_failed", "Ersetzen gibt es nur beim Binden.", {
            issues: [{ path: "replaceRevision", rule: "not_allowed" }],
        });
    }
    return galleryOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "gallery.unbind",
            galleryId: body.galleryId,
            baseRevision: body.baseRevision,
            body: { subject: `place:${body.placeId}` },
        },
        async (tx, gallery, alle) => {
            const place = await lockPlace(tx, body.placeId);
            const [bindung] = await tx<{ id: string }[]>`
                SELECT id::text AS id FROM place_media_gallery
                 WHERE place_id = ${place.id} AND media_gallery_id = ${gallery.id} AND retired_at IS NULL
                   FOR UPDATE
            `;
            if (bindung === undefined) {
                throw new ApiError(409, "media_not_bound", "Diese Galerie hängt nicht an diesem Ort.");
            }
            await tx`
                UPDATE place_media_gallery SET retired_at = now(), updated_at = now() WHERE id = ${bindung.id}::bigint
            `;
            const [rest] = await tx<{ n: number }[]>`
                SELECT count(*)::int AS n FROM place_media_gallery
                 WHERE media_gallery_id = ${gallery.id} AND retired_at IS NULL
            `;
            const ortlos = (rest?.n ?? 0) === 0;
            return {
                receipt: {
                    affected: [],
                    derivedWork: await settleActive(tx, alle, actor.personId),
                    warnings: ortlos
                        ? [
                              {
                                  code: "gallery_is_draft",
                                  message:
                                      "Diese Galerie hängt an keinem Ort mehr. Ihre Bilder sind damit für Besucher unsichtbar.",
                              },
                          ]
                        : [],
                },
                entries: [
                    {
                        action: "gallery.unbound",
                        details: { subject: `place:${body.placeId}`, role: "header", draft: ortlos },
                    },
                ],
            };
        },
    );
}

const ENTFERNEN_SAETZE: Readonly<Record<MediaGalleryDeleteHindernis, string>> = {
    legacy: "Importierte Galerien lassen sich nicht entfernen; entfernt werden nur selbst angelegte.",
    bound: "Diese Galerie hängt noch an einem Ort. Erst dort lösen, dann entfernen.",
    foreign: "Diese Galerie hat jemand anderes angelegt.",
};
const nichtEntfernbar = (reason: MediaGalleryDeleteHindernis): ApiError =>
    new ApiError(409, "media_not_deletable", ENTFERNEN_SAETZE[reason], { reason });

/**
 * Eine Galerie entfernen (`gallery.delete`, Vertrag `MediaGalleryDeleteBody`): nur eine selbst in der Medienverwaltung angelegte, die an
 * keinem Ort hängt. Geprüft in derselben Transaktion unter der Sperre der Galerie und gegen ihre gesehene Revision. Es fallen die Zeilen
 * ihrer Ortsbindungen (nur noch Verlauf), ihre Einträge und sie selbst; die Bilder bleiben, das Fachprotokoll auch (ohne Fremdschlüssel).
 */
export function deleteGallery(
    database: Database,
    actor: MediaActor,
    body: MediaGalleryDeleteBody,
): Promise<OperationReceipt> {
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "gallery.delete",
            body: { gallery: body.galleryId, baseRevision: body.baseRevision },
        },
        async (tx) => {
            const gallery = await lockGallery(tx, body.galleryId);
            await requireBase(tx, gallery, body.baseRevision);
            const [bestand] = await tx<
                { source_system: string; orte: number; ersteller: string | null; eintraege: number }[]
            >`
                SELECT g.source_system,
                       (SELECT count(*)::int FROM place_media_gallery b
                         WHERE b.media_gallery_id = g.id AND b.retired_at IS NULL) AS orte,
                       (SELECT o.actor_person_id::text FROM media_audit_event e
                          JOIN media_operation o ON o.operation_id = e.operation_id
                         WHERE e.media_gallery_public_id = g.public_id AND e.action = 'gallery.created'
                         ORDER BY e.id LIMIT 1) AS ersteller,
                       (SELECT count(*)::int FROM media_gallery_item i WHERE i.gallery_id = g.id) AS eintraege
                  FROM media_gallery g WHERE g.id = ${gallery.id}::bigint
            `;
            if (bestand!.source_system !== MEDIA_EDITOR_SOURCE_SYSTEM) throw nichtEntfernbar("legacy");
            if (bestand!.orte > 0) throw nichtEntfernbar("bound");
            if (bestand!.ersteller !== actor.personId) throw nichtEntfernbar("foreign");
            // Die Ortsbindungen sind nur noch Verlauf (keine aktive, oben geprüft); das Cover fällt mit seinem Eintrag (ON DELETE SET NULL).
            await tx`DELETE FROM place_media_gallery WHERE media_gallery_id = ${gallery.id}::bigint`;
            await tx`DELETE FROM media_gallery_item WHERE gallery_id = ${gallery.id}::bigint`;
            await tx`DELETE FROM media_gallery WHERE id = ${gallery.id}::bigint`;
            return {
                receipt: { affected: [{ kind: "gallery", id: gallery.publicId }], derivedWork: [], warnings: [] },
                entries: [
                    { action: "gallery.deleted", galleryId: gallery.publicId, details: { items: bestand!.eintraege } },
                ],
            };
        },
    );
}
