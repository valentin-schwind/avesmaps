import type { Queryable } from "../database.ts";

/**
 * Die Sperre je Hash der Bytes eines Originals (`media_file.sha256`, Klasse `private_source`), bis zum Ende der Transaktion.
 *
 * - Zwei gleichzeitige Uploads derselben Datei kommen nacheinander vorbei (`media-editor/upload.ts`).
 * - 🔴 Wer eine Originalzeile anlegt und wer eine Originaldatei löscht (`kartenvorschlag/original-loeschen.ts`), schließen einander aus. Der Anlegende sperrt VOR dem
 *   Ablegen der Bytes: `store` sieht sonst die alte Datei und schreibt nichts, der Löschende nimmt sie weg, und die neue Zeile zeigt ins Leere.
 */
export async function sperreQuelle(tx: Queryable, sha256: string): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`media_source:${sha256}`}, 0))`;
}
