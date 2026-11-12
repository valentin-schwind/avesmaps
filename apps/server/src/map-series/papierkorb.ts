import { rm } from "node:fs/promises";
import { join } from "node:path";
import { AVENTURIA_SERIES, KARTENSERIE_PAPIERKORB_TAGE, istKartenserieKennung } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { isMissingTable } from "../system/state-row.ts";
import type { Ablage } from "./ablage.ts";
import { existiert } from "./fassungen.ts";

/**
 * Der Papierkorb der Kartenserien nach seiner Frist (WI-0220 Schnitt 4; Vorlage Fassung 4, abgenommen 2026-10-18: „Kacheln und Quelle
 * bleiben 30 Tage liegen“). Die Pflege der Warteschlange ruft ihn einmal am Tag als aufgezeichneten Job `map_series_papierkorb`, mit der
 * Jobs-Rolle und als Dienstbenutzer der Umgebung (auf dem VPS `ReadWritePaths=$SRV/shared`).
 *
 * - Abgelaufen ist eine Serie, die länger als `KARTENSERIE_PAPIERKORB_TAGE` im Papierkorb liegt. Ihre Kacheln (`<TILE_ROOT>/<serie>/`)
 *   und Quellen (`<Ablage>/<serie>/`) kommen weg.
 * - Eine neue Serie (nicht in der JSON) verliert auch ihre Zeile: Die Kennung ist danach wieder frei.
 * - Eine Serie der JSON behält ihre Zeile im Papierkorb, sonst brächte die Vorgabe sie zurück, ohne Kacheln. Wiederherstellen geht nach
 *   der Frist nicht mehr (`schreiben.ts`), und der Reiter zeigt sie nicht mehr.
 * - Wiederholbar: Was schon fehlt, ist kein Fehler.
 */
export const KARTENSERIEN_PAPIERKORB_KIND = "map_series_papierkorb";

/** Die Frist als SQL-Intervall: aus derselben Zahl wie Lesemodell und Schreibweg. */
export const PAPIERKORB_FRIST_SQL = `${String(KARTENSERIE_PAPIERKORB_TAGE)} days`;

export interface PapierkorbErgebnis {
    /** Die Serien, deren Frist abgelaufen ist (auch die, bei denen nichts mehr zu löschen war). */
    serien: string[];
    /** Wie viele Ordner (Kacheln, Quellen) weggeräumt wurden. */
    ordner: number;
    /** Wie viele Zeilen neuer Serien wegfielen. */
    zeilen: number;
}

async function weg(pfad: string): Promise<number> {
    if (!(await existiert(pfad))) return 0;
    await rm(pfad, { recursive: true, force: true });
    return 1;
}

export async function raeumePapierkorb(
    db: Queryable,
    { tileRoot, ablage }: { tileRoot: string | undefined; ablage: Ablage | undefined },
): Promise<PapierkorbErgebnis> {
    let abgelaufen: { series_id: string }[];
    try {
        abgelaufen = await db<{ series_id: string }[]>`
            SELECT series_id FROM map_series
             WHERE status = 'papierkorb' AND papierkorb_at < now() - ${PAPIERKORB_FRIST_SQL}::interval
             ORDER BY series_id
        `;
    } catch (error) {
        if (isMissingTable(error)) return { serien: [], ordner: 0, zeilen: 0 };
        throw error;
    }
    const vorgabe = new Set(AVENTURIA_SERIES.series.map((s) => s.id));
    let ordner = 0;
    let zeilen = 0;
    const serien: string[] = [];
    for (const { series_id: id } of abgelaufen) {
        // Die Kennung landet in einem Pfad: nur, was das Muster erfüllt (Kleinbuchstaben), nie `..` oder `/`.
        if (!istKartenserieKennung(id)) continue;
        serien.push(id);
        if (tileRoot !== undefined) ordner += await weg(join(tileRoot, id));
        if (ablage !== undefined) ordner += await weg(join(ablage.wurzel, id));
        if (vorgabe.has(id)) continue;
        const geloescht = await db`
            DELETE FROM map_series
             WHERE series_id = ${id} AND status = 'papierkorb' AND papierkorb_at < now() - ${PAPIERKORB_FRIST_SQL}::interval
        `;
        zeilen += geloescht.count;
    }
    return { serien, ordner, zeilen };
}
