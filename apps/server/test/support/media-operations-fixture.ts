import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { MediaFileUpload, MediaUploadForm } from "@avesmaps3d/shared";
import type { Database } from "../../src/database.ts";
import { MEDIA_EDITOR_SOURCE_SYSTEM } from "../../src/media-editor/upload.ts";

/**
 * Hilfen für die Tests des Schreibpfads der Medienverwaltung (WI-0068 P4a): Bilder, ein gültiges Formular und das Aufräumen von
 * allem, was die Operationen anlegen (Assets aus Hochladen, Galerien eines Editors, Operationen, Fachprotokoll, Jobs).
 *
 * Fachobjekte und Legacy-Medien legen die vorhandenen Fixtures an (`media-fixture.ts`, `media-import-fixture.ts`) und räumen sie ab;
 * hier fällt nur, was ein Editor erzeugt. Erkennbar am Quellsystem `avesmaps3d` (Assets, Galerien) und an den Personen der Tests.
 */

/**
 * Ein Bild, das ein neues Wappen sein darf (WI-0068 P4b, `MEDIA_COAT_QUALITY`): lange Seite 160, durchsichtiger Rand, in der Mitte eine
 * deckende Fläche in einer Farbe aus `seed` (verschiedene Bytes je Seed). Nicht quadratisch: der Worker füllt ein Wappen auf.
 */
export const pngBytes = async (seed: number, width = 160, height = 120): Promise<Buffer> => {
    const inner = { width: Math.max(1, width - 16), height: Math.max(1, height - 16) };
    const block = await sharp({
        create: {
            ...inner,
            channels: 4,
            background: { r: (seed * 53) % 256, g: (seed * 97) % 256, b: (seed * 29) % 256, alpha: 1 },
        },
    })
        .png()
        .toBuffer();
    return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: block, left: 8, top: 8 }])
        .png()
        .toBuffer();
};

/** Ein vollständiges Formular „Neues Wappen hochladen“: eigenes Werk, Zeichnung, ohne Beleg. */
export function uploadForm(overrides: Partial<MediaUploadForm> = {}): MediaUploadForm {
    return {
        title: "Wappen von Teststadt",
        role: "coat",
        creationMethod: "drawing",
        rights: { basis: "own_work", creator: "Urheberin Alrike" },
        ...overrides,
    };
}

export const file = (bytes: Uint8Array, name = "wappen.png"): MediaFileUpload => ({
    name,
    dataBase64: Buffer.from(bytes).toString("base64"),
});

export const operation = (): string => randomUUID();

/**
 * Ein zweites Werk mit DENSELBEN BYTES wie `publicId`, so wie Legacy den Bestand anlegte (ein Werk je Verwendung). Über das
 * Hochladen entsteht es nicht mehr (`media_already_exists`, Betreiber 2026-10-17); Zusammenführen und Duplikat-Prüfung brauchen
 * es trotzdem. Es trägt dasselbe Original und eine Abschrift der Rechte, im Quellsystem des Vorbilds (`cleanEditorMedia` räumt es ab).
 */
export async function bytegleichesWerk(database: Database, publicId: string, title: string): Promise<string> {
    const [row] = await database<{ public_id: string }[]>`
        WITH vorbild AS (SELECT * FROM media_asset WHERE public_id = ${publicId}::uuid),
        neu AS (
            INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state, source_system,
                                     title)
            SELECT media_kind, asset_type, origin, creation_method, technical_state, moderation_state, source_system, ${title}
              FROM vorbild
            RETURNING id, public_id
        ),
        datei AS (
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
            SELECT neu.id, f.variant, f.storage_class, f.storage_key, f.mime_type, f.width, f.height, f.byte_size, f.sha256
              FROM neu, vorbild v JOIN media_file f ON f.media_asset_id = v.id AND f.storage_class = 'private_source'
        ),
        rechte AS (
            INSERT INTO media_rights (media_asset_id, rights_basis, license_key, license_family, creator, rights_holder, attribution,
                                      rights_note, clearance_state)
            SELECT neu.id, r.rights_basis, r.license_key, r.license_family, r.creator, r.rights_holder, r.attribution, r.rights_note,
                   r.clearance_state
              FROM neu, vorbild v JOIN media_rights r ON r.media_asset_id = v.id
        )
        SELECT public_id::text AS public_id FROM neu
    `;
    return row!.public_id;
}

/** Räumt ab, was die Operationen dieser Personen angelegt haben, vor den Fixtures der Fachobjekte. */
export async function cleanEditorMedia(database: Database, people: readonly string[]): Promise<void> {
    const assets = `(SELECT id FROM media_asset WHERE source_system = '${MEDIA_EDITOR_SOURCE_SYSTEM}')`;
    const galleries = `(SELECT id FROM media_gallery WHERE source_system = '${MEDIA_EDITOR_SOURCE_SYSTEM}')`;
    if (people.length > 0) {
        await database`
            DELETE FROM media_audit_event
             WHERE operation_id IN (SELECT operation_id FROM media_operation WHERE actor_person_id = ANY(${people}::uuid[]))
        `;
        await database`DELETE FROM media_operation WHERE actor_person_id = ANY(${people}::uuid[])`;
        // Der Abgleich und „Vorschau erzeugen“ (WI-0287 Punkt 5) reihen Aufträge mit der Person als Auslöser ein.
        const arten = ["media_settle", "citymap_preview_generate"];
        await database`
            DELETE FROM job_event
             WHERE job_id IN (SELECT id FROM job WHERE kind = ANY(${arten}) AND actor_ref = ANY(${people}))
        `;
        await database`DELETE FROM job WHERE kind = ANY(${arten}) AND actor_ref = ANY(${people})`;
    }
    for (const statement of [
        `DELETE FROM media_publication_suspension WHERE media_asset_id IN ${assets}`,
        // Typbilder (Migration 0113): der ★ zeigt auf ein Asset des Editors.
        `DELETE FROM media_type_image WHERE media_asset_id IN ${assets}`,
        `DELETE FROM place_media WHERE media_asset_id IN ${assets}`,
        `DELETE FROM territory_media WHERE media_asset_id IN ${assets}`,
        `UPDATE media_gallery SET cover_item_id = NULL WHERE id IN ${galleries}`,
        `DELETE FROM media_gallery_item WHERE gallery_id IN ${galleries} OR media_asset_id IN ${assets}`,
        `DELETE FROM place_media_gallery WHERE media_gallery_id IN ${galleries}`,
        `DELETE FROM media_gallery WHERE source_system = '${MEDIA_EDITOR_SOURCE_SYSTEM}'`,
        `DELETE FROM media_rights_evidence WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_creation WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_rights WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_file WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_asset WHERE source_system = '${MEDIA_EDITOR_SOURCE_SYSTEM}'`,
    ]) {
        await database.unsafe(statement);
    }
}
