import type { Queryable } from "../database.ts";
import type { FindingObject } from "../findings.ts";

/**
 * Die Umleitung des Medienimports auf zusammengeführte Werke (WI-0068 D1, Migration 0121).
 *
 * 🔴 **Eine Stelle, nicht viele.** Der Import findet ein Asset über seinen Legacy-Schlüssel (`source_ref`) und plant damit seine
 * Bindungen. Ist dieses Werk in ein anderes aufgegangen, sollen die Bindungen auf das BLEIBENDE zeigen — sonst passiert
 * Folgendes: Der Import sieht am Platz ein Asset mit Herkunft `editor` (das hat die Zusammenführung dort hinterlassen), lässt
 * ihn nach der Schutzregel stehen und meldet `held_by_editor`. Jede spätere Legacy-Änderung an diesem Platz käme nicht mehr an,
 * und jeder Lauf meldete Hunderte Befunde (Betreiber 2026-10-11, Entscheid A: „einmal zusammenführen genügt“).
 *
 * 🪤 **Nur die BINDUNGEN wandern, nicht das Werk.** Rechte, Herkunft und `source_ref` schreibt der Import weiter an das
 * aufgegangene Werk: Es bleibt das, was Legacy unter diesem Schlüssel kennt. Deshalb greift die Umleitung erst NACH dem Schreiben
 * der Assets und vor dem Planen der Bindungen.
 *
 * 🪤 **Ändert Legacy die Bytes**, auf denen eine Zusammenführung beruhte, meldet der Lauf einen Befund und ändert nichts am
 * bleibenden Werk: Zwei Werke, die einmal gleich waren, sind es dann nicht mehr — das aufzulösen ist eine Entscheidung, keine
 * Rechnung.
 */

export const MERGED_SOURCE_CHANGED =
    "Legacy hat die Bytes eines zusammengeführten Bildes geändert: die Zusammenführung bleibt, das bleibende Bild wird nicht angefasst";

export interface MergeRedirect {
    /** Das bleibende Werk je aufgegangenem Werk (beide als `media_asset.id`). */
    readonly keptByMerged: ReadonlyMap<string, string>;
    /** Die Bytes, auf denen die Zusammenführung beruhte, je aufgegangenem Werk. */
    readonly sha256ByMerged: ReadonlyMap<string, string>;
}

/** Die aktiven Zusammenführungen; `lifted_at IS NULL`, eine aufgehobene leitet nicht mehr um. */
export async function readMergeRedirect(tx: Queryable): Promise<MergeRedirect> {
    const rows = await tx<{ merged: string; kept: string; sha256: string }[]>`
        SELECT merged_asset_id::text AS merged, kept_asset_id::text AS kept, source_sha256 AS sha256
          FROM media_merge WHERE lifted_at IS NULL
    `;
    return {
        keptByMerged: new Map(rows.map((row) => [row.merged, row.kept])),
        sha256ByMerged: new Map(rows.map((row) => [row.merged, row.sha256])),
    };
}

/**
 * Schreibt `idByKey` auf die bleibenden Werke um.
 *
 * 🪤 Die Umleitung ist EIN Schritt, keine Kette: `media_merge_one_active` lässt ein Werk höchstens einmal aufgehen, und ein
 * bleibendes Werk kann nicht selbst aufgegangen sein (die Operation weist das ab). Trotzdem folgt diese Funktion der Kette bis zu
 * ihrem Ende — fände sie je eine, liefe sie sonst in eine halbe Auflösung statt in einen Fehler.
 */
export function redirectMergedAssets(
    idByKey: Map<string, string>,
    redirect: MergeRedirect,
): { umgeleitet: number; ziele: ReadonlySet<string> } {
    if (redirect.keptByMerged.size === 0) return { umgeleitet: 0, ziele: new Set() };
    let umgeleitet = 0;
    const ziele = new Set<string>();
    for (const [key, id] of idByKey) {
        let ziel = id;
        const gesehen = new Set<string>([id]);
        for (;;) {
            const weiter = redirect.keptByMerged.get(ziel);
            if (weiter === undefined || gesehen.has(weiter)) break;
            gesehen.add(weiter);
            ziel = weiter;
        }
        if (ziel === id) continue;
        idByKey.set(key, ziel);
        ziele.add(ziel);
        umgeleitet += 1;
    }
    return { umgeleitet, ziele };
}

/**
 * Prüft, ob Legacy die Bytes eines zusammengeführten Werks geändert hat — über die Originaldatei, die der Lauf gerade geschrieben
 * hat. Liefert die Befundobjekte; der Aufrufer meldet sie über seinen `hold`.
 */
export async function mergedSourceChanged(tx: Queryable, redirect: MergeRedirect): Promise<FindingObject[]> {
    if (redirect.sha256ByMerged.size === 0) return [];
    const ids = [...redirect.sha256ByMerged.keys()];
    const rows = await tx<{ id: string; publicId: string; key: string | null; sha256: string }[]>`
        SELECT a.id::text AS id, a.public_id::text AS "publicId", a.source_ref AS key, f.sha256
          FROM media_asset a JOIN media_file f ON f.media_asset_id = a.id AND f.storage_class = 'private_source'
         WHERE a.id = ANY(${ids}::bigint[])
    `;
    return rows
        .filter((row) => redirect.sha256ByMerged.get(row.id) !== row.sha256)
        .map((row) => ({ table: "media_asset", publicId: row.publicId, name: row.key ?? row.publicId }));
}
