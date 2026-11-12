import type { Queryable } from "../database.ts";
import { KARTENVORSCHLAG_QUELLSYSTEM } from "../kartenvorschlag/quellsystem.ts";
import { MEDIA_USAGE_TABLES } from "./usage-sql.ts";

/**
 * Ein Bild aus einem Kartenvorschlag endgültig löschen (WI-0287; Vali 2026-11-07 auf „Soll der Betreiber Bilder aus Vorschlägen an stillgelegten Einträgen endgültig
 * löschen dürfen?“: „Ja, erlauben“). Die Regel vom 2026-10-17 („A, nur eigene Uploads“) bleibt für alles andere; das hier ist ihre eine Ausnahme.
 *
 * Löschbar ist ein solches Bild, wenn
 * - es aus einem Vorschlag stammt (Herkunft `community_upload`, Quellsystem `kartenvorschlag`) und jeder Vorschlag, der darauf zeigt, angenommen ist (ein offener
 *   verlöre sonst seine Datei; abgelehnte und zurückgezogene räumt die Aufbewahrung ab, `kartenvorschlag_aufbewahren`),
 * - es mindestens eine Verwendung hat und JEDE Verwendung des Bilds und der aus ihm erzeugten Vorschauen eine Bindung an einen stillgelegten Eintrag der
 *   Kartensammlung ist (`citymap.state = 'retired'`, WI-0287 „Eintrag entfernen“). Eine Zeile in einer anderen Verwendungstafel hält es fest, auch eine
 *   zurückgezogene; ebenso eine gelöste Bindung an einem Eintrag, der noch gilt.
 *
 * Legacy-Herkunft, Zusammenführung und Notaus prüft `asset-delete.ts` wie bei jedem Werk, für die erzeugten Vorschauen ebenso.
 */
export interface VorschlagsBild {
    /** Bild und erzeugte Vorschauen hängen nur an stillgelegten Einträgen: Der Betreiber darf löschen. */
    nurStillgelegt: boolean;
    /** Die Titel der Einträge, an denen Bild oder erzeugte Vorschau hängen, ohne Doppel, alphabetisch. */
    eintraege: string[];
    /** Die internen Kennungen der aus dem Bild erzeugten Vorschauen (`media_asset.generated_from_asset_id`). */
    vorschauen: string[];
}

/** Die Verwendungen der Werke `w` in allen Tafeln außer den Bindungen der Kartensammlung, aktiv oder zurückgezogen. */
const ANDERSWO_SQL = MEDIA_USAGE_TABLES.filter((table) => table !== "citymap_media")
    .map((table) => `(SELECT count(*) FROM ${table} WHERE media_asset_id IN (SELECT id FROM werke))`)
    .join(" + ");

interface Zeile {
    vorschlaege: number;
    offen: number;
    vorschauen: string[] | null;
    anderswo: number;
    aktiv: number;
    eigene: number;
    eintraege: string[] | null;
}

/** Die Fakten zu einem Bild aus einem Vorschlag (interne Kennung); `undefined`, wenn das Werk keines ist. In der Transaktion des Löschens nach den Sperren lesen. */
export async function vorschlagsBild(q: Queryable, assetId: string): Promise<VorschlagsBild | undefined> {
    const [zeile] = await q.unsafe<Zeile[]>(
        `WITH bild AS (
             SELECT a.id FROM media_asset a WHERE a.id = $1::bigint AND a.origin = 'community_upload' AND a.source_system = $2
         ), werke AS (
             SELECT id FROM bild UNION ALL SELECT v.id FROM media_asset v JOIN bild b ON v.generated_from_asset_id = b.id
         ), bindungen AS (
             SELECT m.media_asset_id, c.state, c.title FROM citymap_media m JOIN citymap c ON c.id = m.citymap_id
              WHERE m.media_asset_id IN (SELECT id FROM werke)
         )
         SELECT (SELECT count(*) FROM citymap_suggestion s JOIN bild b ON s.media_asset_id = b.id)::int AS vorschlaege,
                (SELECT count(*) FROM citymap_suggestion s JOIN bild b ON s.media_asset_id = b.id WHERE s.state <> 'approved')::int AS offen,
                (SELECT array_agg(v.id::text ORDER BY v.id) FROM media_asset v JOIN bild b ON v.generated_from_asset_id = b.id) AS vorschauen,
                (${ANDERSWO_SQL})::int AS anderswo,
                (SELECT count(*) FROM bindungen WHERE state <> 'retired')::int AS aktiv,
                (SELECT count(*) FROM bindungen WHERE media_asset_id = $1::bigint)::int AS eigene,
                (SELECT array_agg(DISTINCT title ORDER BY title) FROM bindungen) AS eintraege`,
        [assetId, KARTENVORSCHLAG_QUELLSYSTEM],
    );
    if (zeile === undefined || zeile.vorschlaege === 0) return undefined;
    return {
        nurStillgelegt: zeile.offen === 0 && zeile.anderswo === 0 && zeile.aktiv === 0 && zeile.eigene > 0,
        eintraege: zeile.eintraege ?? [],
        vorschauen: zeile.vorschauen ?? [],
    };
}
