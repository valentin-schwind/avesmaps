import type { Database } from "../database.ts";
import { enqueueSettle } from "../media-editor/settle.ts";
import { PHOTOBOX_KACHEL_VARIANT, PUBLISHED_VARIANT } from "../media/roles.ts";
import { PHOTOBOX_AUSLOESER } from "./db.ts";

/**
 * Die Kacheln der Reisebilder nachziehen (WI-0272 S4, Aufgabe 24, `npm run photobox:kacheln`): Ein Reisebild, das vor der zweiten Fassung (`photobox_kachel`, Aufgabe 22)
 * veröffentlicht wurde, hat nur die Hauptfassung. Der Abgleich ergänzt die Kachel beim nächsten Lauf; dieses Werkzeug reiht ihn für jedes aktive Reisebild ein, dem sie fehlt.
 *
 * - **Gemeint** ist jedes Reisebild mit aktiver Verwendung (nicht offline genommen), dessen Hauptfassung öffentlich ist und dem die Kachel fehlt. Ohne öffentliche Hauptfassung
 *   (noch keine Freigaberegel, unter Notaus) gibt es nichts nachzuziehen, der Abgleich der Freigabe oder des Aufhebens rechnet beide Fassungen zugleich.
 * - **Nur einreihen:** Gerechnet wird im Worker (`media_settle`), nie hier und nie im Fastify-Prozess. Das Werkzeug schreibt ausschließlich Aufträge, mit dem Auslöser `photobox`
 *   und niedriger Priorität (90, wie der Sammellauf der Duplikate: fremde Uploads und Freigaben warten nicht hinter ihm).
 * - **Wiederholbar:** Ein Bild, für das schon ein Abgleich wartet oder läuft, wird nicht noch einmal eingereiht. In jeder Umgebung erlaubt.
 */

export interface KachelnErgebnis {
    /** Für so viele Reisebilder wurde ein Abgleich eingereiht. */
    eingereiht: number;
    /** So viele ohne Kachel hatten schon einen Abgleich in der Warteschlange. */
    wartend: number;
}

/** Die Priorität der Abgleiche dieses Werkzeugs (0 zuerst, Vorgabe 50). */
const PRIORITAET = 90;

export async function reiheKachelnEin(db: Database): Promise<KachelnErgebnis> {
    const bilder = await db<{ asset: string; wartet: boolean }[]>`
        SELECT a.public_id::text AS asset,
               EXISTS (
                   SELECT 1 FROM job j
                    WHERE j.kind = 'media_settle' AND j.state IN ('QUEUED', 'RUNNING') AND j.input_ref ->> 'asset' = a.public_id::text
               ) AS wartet
          FROM photobox_media m
          JOIN media_asset a ON a.id = m.media_asset_id
         WHERE m.retired_at IS NULL
           AND EXISTS (
               SELECT 1 FROM media_file f
                WHERE f.media_asset_id = a.id AND f.storage_class = 'published' AND f.variant = ${PUBLISHED_VARIANT.photobox}
           )
           AND NOT EXISTS (
               SELECT 1 FROM media_file k
                WHERE k.media_asset_id = a.id AND k.storage_class = 'published' AND k.variant = ${PHOTOBOX_KACHEL_VARIANT}
           )
         ORDER BY m.id
    `;
    const ergebnis: KachelnErgebnis = { eingereiht: 0, wartend: 0 };
    await db.begin(async (tx) => {
        for (const bild of bilder) {
            if (bild.wartet) {
                ergebnis.wartend += 1;
                continue;
            }
            await enqueueSettle(tx, {
                assetPublicId: bild.asset,
                role: "photobox",
                actorPersonId: PHOTOBOX_AUSLOESER,
                priority: PRIORITAET,
            });
            ergebnis.eingereiht += 1;
        }
    });
    return ergebnis;
}
