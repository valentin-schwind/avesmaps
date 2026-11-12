import type { Database, Queryable } from "../database.ts";
import { gleicheQuarantaeneAb, type QuarantaeneErgebnis } from "./quarantine.ts";
import type { MediaStore } from "./storage.ts";

/**
 * Der Einzelbild-Notaus beim Lesen und in der Quarantäne (WI-0068; Code-Review 2026-10-16 S8-04, WI-0189 B2). Die Operationen, die
 * ihn setzen und aufheben, stehen in `media-editor/suspension.ts`; hier steht, was Lesepfad, Abgleich und Job über ihn wissen.
 *
 * 🔴 **Er ist ein Fakt der Entscheidung** (`decidePublication`, Grund `publication_suspended`): Resolver, Plätze des Ortseditors und
 * Reverse Usage fragen `gehalteneAssets` einmal je Anfrage und geben das Ergebnis je Zeile mit. Ein gesperrtes Bild bekommt so keine
 * Adresse mehr, auch solange seine veröffentlichte Zeile steht und die Datei nur in der Quarantäne liegt.
 * 🔴 **Die Datei bewegt der Job `media_quarantine` mit der Jobs-Rolle**, nie die Operation als App-Rolle (WI-0189 B2: die App-Rolle
 * darf `media_quarantine` nicht schreiben, der Aufruf endete mit 500). `file_state` folgt dort den Dateien.
 * 🔴 **Eine erzeugte Vorschau folgt dem Notaus ihrer Karte** (WI-0287 Punkt 5): Jede Frage nach gehaltenen Bytes geht über `GEHALTENE_QUELLBYTES_SQL`, die die Bytes
 * der aus einer gehaltenen Karte erzeugten Vorschauen mitnimmt. Das Aufheben reiht ihren Abgleich mit ein (`enqueueSettleForActiveRoles`).
 */

/**
 * Die ORIGINALBYTES, die gerade offline sind, als EINE Abfrage (Spalte `sha256`), für jeden Weg, der den Notaus fragt:
 *
 * - die Bytes, für die ein Notaus gilt (`media_publication_suspension.source_sha256`, ohne `lifted_at`);
 * - 🔴 dazu die Bytes jeder Vorschau, die aus einem so gehaltenen Werk erzeugt wurde (WI-0287 Punkt 5, `media_asset.generated_from_asset_id`): Der Notaus gilt den Bytes,
 *   die Vorschau hat andere, und trotzdem geht sie mit ihrer Karte offline („Offline: der Notaus der Karte gilt auch hier.“). Wird die Karte freigegeben, kommt sie
 *   wieder, außer ein eigener Notaus hält ihre Bytes.
 *
 * Eingesetzt als Unterabfrage (`${db.unsafe(GEHALTENE_QUELLBYTES_SQL)}` oder im Text); sie liest nur wenige Zeilen (die aktiven Notaus-Einträge) über Indizes.
 */
export const GEHALTENE_QUELLBYTES_SQL = `
    SELECT n.source_sha256 AS sha256 FROM media_publication_suspension n WHERE n.lifted_at IS NULL
    UNION
    SELECT erzeugt.sha256
      FROM media_publication_suspension n
      JOIN media_file karte ON karte.sha256 = n.source_sha256 AND karte.storage_class = 'private_source'
      JOIN media_asset vorschau ON vorschau.generated_from_asset_id = karte.media_asset_id
      JOIN media_file erzeugt ON erzeugt.media_asset_id = vorschau.id AND erzeugt.storage_class = 'private_source'
     WHERE n.lifted_at IS NULL`;

/**
 * Die ORIGINALBYTES, die ein Notaus gerade hält (`GEHALTENE_QUELLBYTES_SQL`, samt der erzeugten Vorschauen). Das ist die Identität des Bildes:
 * Sie überlebt jede neue Rezeptfassung, und `migrate:media-files` und `media_settle` fragen danach.
 */
export async function gehalteneQuellbytes(db: Queryable): Promise<Set<string>> {
    const rows = await db.unsafe<{ sha256: string }[]>(GEHALTENE_QUELLBYTES_SQL);
    return new Set(rows.map((row) => row.sha256));
}

/** Die Assets, deren Original ein Notaus gerade hält: öffentliche und interne Kennungen, in EINER Abfrage je Anfrage. */
export interface GehalteneAssets {
    publicIds: ReadonlySet<string>;
    ids: ReadonlySet<string>;
}

export async function gehalteneAssets(db: Queryable): Promise<GehalteneAssets> {
    // 🪤 Als EINE getaggte Abfrage ohne `unsafe`: Die Lesewege zählen ihre `unsafe`-Aufrufe (kein N+1, `media-resolver.test.ts`), und diese Frage gehört
    // nicht zu ihnen. Derselbe Text wie `GEHALTENE_QUELLBYTES_SQL`: die eigenen gehaltenen Bytes und die der aus ihnen erzeugten Vorschauen (WI-0287).
    const rows = await db<{ id: string; public_id: string }[]>`
        WITH gehalten AS (
            SELECT n.source_sha256 AS sha256 FROM media_publication_suspension n WHERE n.lifted_at IS NULL
            UNION
            SELECT erzeugt.sha256
              FROM media_publication_suspension n
              JOIN media_file karte ON karte.sha256 = n.source_sha256 AND karte.storage_class = 'private_source'
              JOIN media_asset vorschau ON vorschau.generated_from_asset_id = karte.media_asset_id
              JOIN media_file erzeugt ON erzeugt.media_asset_id = vorschau.id AND erzeugt.storage_class = 'private_source'
             WHERE n.lifted_at IS NULL
        )
        SELECT DISTINCT a.id::text AS id, a.public_id::text AS public_id
          FROM gehalten n
          JOIN media_file quelle ON quelle.sha256 = n.sha256 AND quelle.storage_class = 'private_source'
          JOIN media_asset a ON a.id = quelle.media_asset_id
    `;
    return { publicIds: new Set(rows.map((row) => row.public_id)), ids: new Set(rows.map((row) => row.id)) };
}

/**
 * Die Zielmenge der QUARANTÄNE für den Grund `asset_suspension`.
 *
 * 🔴 **Zwei verschiedene Einheiten, und das ist die Falle:** Der Notaus steht auf den Bytes des ORIGINALS, die Quarantäne bewegt
 * die VERÖFFENTLICHTE Datei — und die hat einen anderen Hash (das Original ist ein PNG, veröffentlicht wird ein gerechnetes WebP).
 * Wer hier die Quellbytes durchreicht, verschiebt nichts: Unter `published/` liegt dieser Hash nicht, und das Bild bliebe öffentlich,
 * während die Tafel „aus“ sagt. Deshalb übersetzt diese Abfrage Quelle → veröffentlichte Dateien.
 *
 * Nebenbei erledigt dieselbe Übersetzung die Reichweite des Notaus: Sie findet die veröffentlichten Dateien ALLER Assets, die sich
 * dieses Original teilen (im Bestand teilen sich 1.025 Assets in 218 Gruppen ihre Datei).
 *
 * 🪤 Die Menge hängt an den veröffentlichten Zeilen. Deshalb fasst `media_settle` sie unter einem Notaus nicht an (S8-04): Fiele die
 * Zeile weg, gäbe der nächste Abgleich die Datei aus der Quarantäne zurück.
 */
export async function zielNotausQuarantaene(db: Queryable): Promise<Set<string>> {
    // Die gehaltenen Quellbytes samt der erzeugten Vorschauen (WI-0287): Deren veröffentlichte Datei wandert mit der der Karte in die Quarantäne und zurück.
    const rows = await db<{ sha256: string }[]>`
        SELECT DISTINCT veroeffentlicht.sha256
          FROM (${db.unsafe(GEHALTENE_QUELLBYTES_SQL)}) n
          JOIN media_file quelle ON quelle.sha256 = n.sha256 AND quelle.storage_class = 'private_source'
          JOIN media_file veroeffentlicht ON veroeffentlicht.media_asset_id = quelle.media_asset_id
                                         AND veroeffentlicht.storage_class = 'published'
    `;
    return new Set(rows.map((row) => row.sha256));
}

/**
 * Gleicht die Quarantäne des Grundes `asset_suspension` mit allen aktiven Notaus-Zeilen ab und schreibt danach den Zustand der
 * Datei an die Zeilen zurück. Läuft im Job `media_quarantine` (Jobs-Rolle: `media_quarantine` und `file_state`, `media-grants.psql`).
 */
export async function ziehNotausQuarantaeneNach(database: Database, store: MediaStore): Promise<QuarantaeneErgebnis> {
    const ergebnis = await gleicheQuarantaeneAb(
        database,
        store,
        "asset_suspension",
        await zielNotausQuarantaene(database),
        null,
    );
    await database`
        UPDATE media_publication_suspension SET file_state = 'quarantined'
         WHERE lifted_at IS NULL AND file_state <> 'quarantined'
    `;
    await database`
        UPDATE media_publication_suspension SET file_state = 'restored'
         WHERE lifted_at IS NOT NULL AND file_state <> 'restored'
    `;
    return ergebnis;
}
