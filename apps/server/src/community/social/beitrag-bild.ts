import type { Queryable } from "../../database.ts";
import { inspectImage } from "../../media/raster/inspect.ts";
import { MAX_SOURCE_BYTES } from "../../media/raster/limits.ts";
import { profileForRole } from "../../media/raster/profiles.ts";
import { renderRaster } from "../../media/raster/render.ts";
import { sha256Of } from "../../media/storage.ts";

/**
 * Die Datei eines Beitrags, gerechnet aus dem privaten Original eines Bildes, das nicht zur Kategorie „Social Media Posts“ gehört (WI-0278). Ein solches Bild hat keine Fassung für Beiträge: Hängt es irgendwo, ist seine
 * öffentliche Datei zugeschnitten oder klein (Kopfbild 800 × 450, Kartenvorschau 400); hängt es nirgends, hat es keine. Das Profil ist das der Kategorie: lange Kante 2048, kein Zuschnitt, nie vergrößert, ohne Metadaten.
 *
 * Nur für Dienste, die die Bytes bekommen. Das Rechnen legt nichts ab: Das Bild wird dadurch auf Avesmaps nicht öffentlich. Wer selbst abholt (Instagram), braucht die öffentliche Datei (`instagram-ableitung.ts`).
 *
 * Im Auftrag, nie im Fastify-Prozess (`media-editor/settle.ts`). `null`, wenn es das Original nicht gibt oder es sich nicht rechnen lässt; dann nimmt der Auftrag die öffentliche Datei, wenn es eine gibt.
 */
export async function rechneBeitragsbild(
    db: Queryable,
    bild: string,
    ablage: { read(schluessel: string, maxBytes: number): Promise<Uint8Array> },
): Promise<{ bytes: Uint8Array; mime: string } | null> {
    // Ist das Original gelöscht (`bytes_deleted_at`, WI-0275), rechnet der Auftrag wie der Abgleich aus dem Master.
    const [quelle] = await db<{ schluessel: string | null; sha256: string | null }[]>`
        SELECT CASE WHEN f.bytes_deleted_at IS NULL THEN f.storage_key ELSE m.storage_key END AS schluessel,
               CASE WHEN f.bytes_deleted_at IS NULL THEN f.sha256 ELSE m.sha256 END AS sha256
          FROM public.media_asset a
          JOIN public.media_file f ON f.media_asset_id = a.id AND f.storage_class = 'private_source'
          LEFT JOIN public.media_file m ON m.media_asset_id = a.id AND m.storage_class = 'master'
         WHERE a.public_id = ${bild}::uuid
         LIMIT 1
    `;
    if (quelle === undefined || quelle.schluessel === null) return null;
    try {
        const bytes = await ablage.read(quelle.schluessel, MAX_SOURCE_BYTES);
        if (sha256Of(bytes) !== quelle.sha256) return null;
        const gerechnet = await renderRaster(bytes, inspectImage(bytes), profileForRole("social_post"));
        return { bytes: gerechnet.bytes, mime: gerechnet.mimeType };
    } catch {
        return null;
    }
}
