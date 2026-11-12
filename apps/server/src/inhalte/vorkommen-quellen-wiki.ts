import {
    SOURCE_REFERENCE_KINDS,
    type InhalteQuellenWiki,
    type InhalteTraegerWikiStand,
    type SourceReferenceKind,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { zitateLesbar } from "./traeger-quellen-lesen.ts";

/**
 * Das Zitat des Wikis an den Quellen eines Eintrags der Vorkommen (WI-0254 §12): Der Lauf der Quellen legt es ab (`wikisync_quelle_zitat`, `traeger_art = 'lore'`, `traeger_id` = `lore_entry.public_id`,
 * `quelle_key` = `feature_source.source_key`), die Klappbox im Reiter „Vorkommen“ rechnet damit den Kreis (Herkunft = Vergleich mit dem Wiki, wie in den Karteneditoren, `traeger-quellen-lesen.ts`).
 *
 * - **Der Lauf** ist der jüngste fertige mit dem Bereich „Quellen“, der Zitate der Vorkommen abgelegt hat (`zahlen.quelle.zitateVorkommen` > 0). Ein Lauf ohne diese Zahl ist älter als der Bau der Vorkommen-Zitate
 *   oder übersprang die Zitate wegen eines fehlenden Rechts: Ein Vergleich damit machte jede Quelle zu „weicht ab“. Fehlt die Tafel (Migration 0251) oder darf die App sie noch nicht lesen, gibt es keinen Lauf.
 * - Es ist nur zu lesen. Die Quellen des Eintrags (`lore_entry_source`) legt der Lauf nie an, ändert und löst er nie.
 */

const BEZUGSARTEN: ReadonlySet<string> = new Set(SOURCE_REFERENCE_KINDS);
const bezugsArt = (wert: string | null): SourceReferenceKind | null =>
    wert !== null && BEZUGSARTEN.has(wert) ? (wert as SourceReferenceKind) : null;

/** Der Lauf, aus dem die Zitate stammen, und was das Wiki am Eintrag je Quelle (Schlüssel `feature_source.source_key`) zitiert. */
export interface VorkommenZitate {
    stand: InhalteTraegerWikiStand;
    werte: ReadonlyMap<string, InhalteQuellenWiki>;
}

/** Die Zitate des Wikis zu einem Eintrag (`lore_entry.public_id`); `undefined`, wo es keinen Lauf mit Zitaten der Vorkommen gibt. */
export async function leseVorkommenZitate(
    database: Queryable,
    eintragPublicId: string,
): Promise<VorkommenZitate | undefined> {
    if (!(await zitateLesbar(database))) return undefined;
    const [lauf] = await database<{ id: number; dump_stand: string | null; beendet_am: Date | null }[]>`
        SELECT l.id::int AS id, l.dump_stand, l.beendet_am
          FROM wikisync_lauf l
         WHERE l.status = 'fertig' AND 'quelle' = ANY(l.bereiche)
           AND coalesce((l.zahlen #>> '{quelle,zitateVorkommen}')::int, 0) > 0
         ORDER BY l.id DESC
         LIMIT 1
    `;
    if (lauf === undefined) return undefined;
    const zeilen = await database<
        { quelle_key: string; art: string | null; seiten: string | null; notiz: string | null }[]
    >`
        SELECT z.quelle_key, z.art, z.seiten, z.notiz
          FROM wikisync_quelle_zitat z
         WHERE z.lauf_id = ${lauf.id}::bigint AND z.traeger_art = 'lore' AND z.traeger_id = ${eintragPublicId}::uuid
    `;
    return {
        stand: { laufId: lauf.id, dumpStand: lauf.dump_stand, beendetAm: lauf.beendet_am?.toISOString() ?? null },
        werte: new Map(
            zeilen.map((zeile) => [
                zeile.quelle_key,
                { art: bezugsArt(zeile.art), seiten: zeile.seiten, notiz: zeile.notiz },
            ]),
        ),
    };
}
