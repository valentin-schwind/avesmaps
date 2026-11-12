import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { PHOTOBOX_TERMS_VERSION, type MediaFileUpload, type PhotoboxEinreichung } from "@avesmaps3d/shared";
import { schluesselHash } from "../../src/community/db.ts";
import type { Database } from "../../src/database.ts";
import { file, pngBytes } from "./media-operations-fixture.ts";

/**
 * Hilfen für die Tests der Reisebild-Einreichung (WI-0272 S2): ein gültiger Rumpf, ein SVG und das Aufräumen von allem, was eine Einreichung
 * anlegt (Einreichung, Eingang, Assets samt Dateien, Rechten, Entstehung, Operationen, Fachprotokoll, Jobs).
 *
 * Aufgeräumt wird nur, was die Tests SELBST angelegt haben (`Spuren`: ihre Schlüssel und Operationen): Mehrere Testdateien teilen eine
 * Datenbank, und die Einreichungen anderer Dateien tragen dieselbe Fassung der Bedingungen.
 */

export interface Spuren {
    /** Die Statusschlüssel, die ein Test benutzt hat. */
    schluessel: string[];
    /** Die Kennungen der Operationen, die ein Test geschickt hat. */
    operationen: string[];
}

export const neueSpuren = (): Spuren => ({ schluessel: [], operationen: [] });

/** Ein Statusschlüssel, wie ihn das Formular erzeugt: 32 Zufallsbytes, base64url (43 Zeichen). */
export const neuerSchluessel = (spuren?: Spuren): string => {
    const schluessel = randomBytes(32).toString("base64url");
    spuren?.schluessel.push(schluessel);
    return schluessel;
};

export const neueOperation = (spuren?: Spuren): string => {
    const operationId = randomUUID();
    spuren?.operationen.push(operationId);
    return operationId;
};

/** Ein PNG mit anderen Bytes je `seed` (verschiedene Bilder). */
export const pngUpload = async (seed: number): Promise<MediaFileUpload> =>
    file(await pngBytes(seed, 160, 90), "reisebild.png");

/**
 * Die Angaben, die ein Foto vom Gerät mitbringt (Hersteller, Urheber, Ort) und die nach dem Einreichen nirgends in der privaten Quelle stehen dürfen
 * (WI-0272 S3, Fixrunde A: die Metadaten fallen beim Eingang weg, nicht erst im Worker).
 */
export const EXIF_GEHEIMNISSE = ["TestCam", "Alrik Testmann", "XMP-GEHEIM", "HINTEN-GEHEIM"] as const;

/**
 * Ein JPEG, wie es ein fremder Client schicken kann: GPS-EXIF, XMP und angehängte Daten hinter dem Bildende. `ausrichtung` setzt zusätzlich die
 * EXIF-Ausrichtung (6 = um 90 Grad gedreht). `bytes` sind die Bytes des Uploads.
 */
export async function jpegMitMetadaten(
    seed: number,
    { ausrichtung }: { ausrichtung?: number } = {},
): Promise<{ upload: MediaFileUpload; bytes: Buffer }> {
    const roh = Buffer.alloc(96 * 64 * 3);
    for (let i = 0; i < roh.length; i += 1) roh[i] = (i * (3 + (seed % 7)) + seed * 31) % 256;
    let bild = sharp(roh, { raw: { width: 96, height: 64, channels: 3 } }).jpeg({ quality: 85 });
    bild =
        ausrichtung === undefined
            ? bild.withExif({
                  IFD0: { Copyright: "Alrik Testmann", Make: "TestCam" },
                  IFD3: {
                      GPSLatitudeRef: "N",
                      GPSLatitude: "51/1 28/1 38/1",
                      GPSLongitudeRef: "E",
                      GPSLongitude: "7/1 0/1 12/1",
                  },
              })
            : bild.withMetadata({ orientation: ausrichtung });
    const grund = await bild.toBuffer();
    const xmp = Buffer.concat([
        Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"),
        Buffer.from("<x:xmpmeta>XMP-GEHEIM</x:xmpmeta>"),
    ]);
    const segment = Buffer.concat([Buffer.from([0xff, 0xe1, (xmp.length + 2) >> 8, (xmp.length + 2) & 0xff]), xmp]);
    const bytes = Buffer.concat([grund.subarray(0, 2), segment, grund.subarray(2), Buffer.from("HINTEN-GEHEIM")]);
    return { upload: file(bytes, "IMG_0001.jpg"), bytes };
}

/** Ein SVG: Ein Besucher darf es nie einreichen (415). */
export const svgUpload = (): MediaFileUpload =>
    file(
        Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#fa0"/></svg>',
            "utf8",
        ),
        "bild.svg",
    );

/** Ein gültiger Rumpf der Einreichung; `patch` überschreibt einzelne Felder. */
export async function einreichung(
    spuren: Spuren,
    seed: number,
    patch: Partial<PhotoboxEinreichung> = {},
): Promise<PhotoboxEinreichung> {
    return {
        operationId: neueOperation(spuren),
        schluessel: neuerSchluessel(spuren),
        bild: await pngUpload(seed),
        lage: { x: 300, y: 300 },
        entstehung: "photo",
        nutzung: "avesmaps_only",
        beschreibung: "Der Blick vom Hafen auf die Bucht",
        bedingungen: PHOTOBOX_TERMS_VERSION,
        falle: { feld: "", dauerMs: 8000 },
        ...patch,
    };
}

/** Räumt ab, was die Einreichungen dieser Spuren angelegt haben (Eingang und Einreichung zuerst, dann die Assets). */
export async function raeumeAuf(database: Database, spuren: Spuren): Promise<void> {
    const hashes = spuren.schluessel.map((schluessel) => schluesselHash(schluessel).toString("hex"));
    const operationen = spuren.operationen;
    const submissions = await database<{ id: string; approved: string | null }[]>`
        SELECT id::text AS id, approved_media_asset_id::text AS approved
          FROM media_submission WHERE encode(status_key_hash, 'hex') = ANY(${hashes}::text[])`;
    const submissionIds = submissions.map((row) => row.id);
    const assets = await database<{ id: string; public_id: string }[]>`
        SELECT a.id::text AS id, a.public_id::text AS public_id
          FROM media_asset a
         WHERE a.id IN (SELECT media_asset_id FROM media_ingest WHERE submission_id = ANY(${submissionIds}::bigint[]))
            OR a.id = ANY(${submissions.flatMap((row) => (row.approved === null ? [] : [row.approved]))}::bigint[])`;
    const assetIds = assets.map((row) => row.id);
    const assetPublicIds = assets.map((row) => row.public_id);

    await database`DELETE FROM job_event WHERE job_id IN (SELECT id FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ANY(${assetPublicIds}::text[]))`;
    await database`DELETE FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ANY(${assetPublicIds}::text[])`;
    await database`DELETE FROM media_audit_event WHERE operation_id = ANY(${operationen}::uuid[])`;
    await database`DELETE FROM media_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
    // Die Verwendung einer freigegebenen Einreichung (Migration 0293) hält Einreichung UND Asset.
    await database`DELETE FROM photobox_media WHERE media_submission_id = ANY(${submissionIds}::bigint[])`;
    await database`DELETE FROM media_ingest WHERE submission_id = ANY(${submissionIds}::bigint[])`;
    await database`DELETE FROM media_submission WHERE id = ANY(${submissionIds}::bigint[])`;
    await database`DELETE FROM media_file WHERE media_asset_id = ANY(${assetIds}::bigint[])`;
    await database`DELETE FROM media_rights WHERE media_asset_id = ANY(${assetIds}::bigint[])`;
    await database`DELETE FROM media_creation WHERE media_asset_id = ANY(${assetIds}::bigint[])`;
    await database`DELETE FROM media_asset WHERE id = ANY(${assetIds}::bigint[])`;
}

/** Ein eigener Ort für die Tests (Quellsystem `photobox-test`, zufällige Kennung): `cleanMediaFixtures` anderer Dateien räumt ihn nie ab. */
export async function legeOrtAn(
    database: Database,
    name = "Photobox-Testort",
): Promise<{ id: string; publicId: string }> {
    const publicId = randomUUID();
    const [ort] = await database<{ id: string }[]>`
        INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
        VALUES (${publicId}, 'aventuria', ${name}, 'stadt', ST_SetSRID(ST_MakePoint(320, 310), 0), 'photobox-test', TRUE)
        RETURNING id::text AS id`;
    if (ort === undefined) throw new Error("Ort nicht angelegt");
    return { id: ort.id, publicId };
}

/** Was die Einreichungen dieser Spuren gerade in der Datenbank halten (nur die eigenen Zeilen: andere Testdateien teilen sich die Tafeln). */
export interface Zahlen {
    einreichung: number;
    asset: number;
    datei: number;
    eingang: number;
    operation: number;
    auftrag: number;
}

export async function zaehle(database: Database, spuren: Spuren): Promise<Zahlen> {
    const hashes = spuren.schluessel.map((schluessel) => schluesselHash(schluessel).toString("hex"));
    const [row] = await database<Zahlen[]>`
        WITH s AS (SELECT id FROM media_submission WHERE encode(status_key_hash, 'hex') = ANY(${hashes}::text[])),
             i AS (SELECT media_asset_id FROM media_ingest WHERE submission_id IN (SELECT id FROM s)),
             a AS (SELECT id, public_id FROM media_asset WHERE id IN (SELECT media_asset_id FROM i))
        SELECT (SELECT count(*) FROM s)::int AS einreichung,
               (SELECT count(*) FROM a)::int AS asset,
               (SELECT count(*) FROM media_file WHERE media_asset_id IN (SELECT id FROM a))::int AS datei,
               (SELECT count(*) FROM i)::int AS eingang,
               (SELECT count(*) FROM media_operation WHERE operation_id = ANY(${spuren.operationen}::uuid[]))::int AS operation,
               (SELECT count(*) FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' IN (SELECT public_id::text FROM a))::int AS auftrag`;
    return row!;
}
