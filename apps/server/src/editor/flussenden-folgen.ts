import { WASSER_LAGE_E, type OperationReceipt } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import { derivePathVisualsFor } from "../derive/path-visual.ts";
import { fuehreFlussHoehenNach, wasserHoehenProtokoll, type FlussPunktVerschoben } from "../terrain/fluss-hoehen.ts";
import { listEditorLocks } from "./editor-lock.ts";
import type { MapActor, MapAuditEntry } from "./map-operation.ts";

/**
 * Flussenden folgen ihrer Geländemarke (OPS-000088, Vali 2026-11-06: „das flussende soll auf den vertex springen, sich strg wieder lösen und ansonsten soll das flussende einer
 * eingerasteten landmarke folgen“).
 *
 * - **Die Verbindung ist die Lage**, wie bei Wegenden am Ort (`pathEndsAt`): Eingerastet heißt, das Ende liegt auf dem Punkt der Marke; wer es mit Strg wegzieht, hat es gelöst. Es gibt keine
 *   eigene Spalte, die mit der Karte auseinanderlaufen könnte. Nur Flüsse und Bäche (`Flussweg`), nur deren Enden, nie ein Stützpunkt dazwischen.
 * - **EINE Operation:** Lage der Marke und Enden gehen in derselben Transaktion, je Weg seine neue Revision, Protokoll `path.endpoint_moved` wie beim Ort, eigene Flusshöhen ziehen mit (WI-0259).
 *   Weil die Enden unter `affected` stehen, folgen Wegfindung und Gelände über dieselbe Schreibnaht wie jede Wegänderung (`gelaendeNachOperation`, Routing in `map-operation.ts`).
 * - **Was liegen bleibt, meldet die Quittung** (`path_end_left`): ein Fluss, den gerade ein anderer bearbeitet (seine Sperre gilt), und ein Fluss, dessen anderes Ende schon an der neuen Lage liegt
 *   (Anfang und Ende dürfen nicht aufeinander liegen, `pruefeKurve`).
 */

interface FlussZeile {
    id: string;
    public_id: string;
    revision: number;
    sx: number;
    sy: number;
    ex: number;
    ey: number;
}

export interface FlussendenGefolgt {
    readonly affected: OperationReceipt["affected"];
    readonly entries: MapAuditEntry[];
    readonly warnings: OperationReceipt["warnings"];
    /** So viele Enden sind mitgegangen. */
    readonly enden: number;
}

const NICHTS: FlussendenGefolgt = { affected: [], entries: [], warnings: [], enden: 0 };

export async function zieheFlussendenNach(
    tx: Sql,
    actor: MapActor,
    mapDomainId: string,
    von: { readonly x: number; readonly y: number },
    nach: { readonly x: number; readonly y: number },
): Promise<FlussendenGefolgt> {
    const zeilen = await tx<FlussZeile[]>`
        WITH marke AS (SELECT ST_SetSRID(ST_MakePoint(${von.x}, ${von.y}), 0) AS geom)
        SELECT w.id::text, w.public_id::text, w.revision::int AS revision,
               ST_X(ST_StartPoint(w.geom)) AS sx, ST_Y(ST_StartPoint(w.geom)) AS sy,
               ST_X(ST_EndPoint(w.geom)) AS ex, ST_Y(ST_EndPoint(w.geom)) AS ey
          FROM path w, marke
         WHERE w.is_active AND w.map_domain_id = ${mapDomainId} AND w.subtype = 'Flussweg'
           AND w.geom && ST_Expand(marke.geom, ${WASSER_LAGE_E})
           AND (ST_DWithin(ST_StartPoint(w.geom), marke.geom, ${WASSER_LAGE_E})
                OR ST_DWithin(ST_EndPoint(w.geom), marke.geom, ${WASSER_LAGE_E}))
         ORDER BY w.public_id
           FOR NO KEY UPDATE OF w
    `;
    if (zeilen.length === 0) return NICHTS;
    const nah = (x: number, y: number, ziel: { readonly x: number; readonly y: number }): boolean =>
        Math.abs(x - ziel.x) <= WASSER_LAGE_E && Math.abs(y - ziel.y) <= WASSER_LAGE_E;
    const gehalten = new Set(
        (await listEditorLocks(tx, "path", undefined))
            .filter((sperre) => actor.kind !== "person" || sperre.person.id !== actor.personId)
            .map((sperre) => sperre.id),
    );
    const affected: OperationReceipt["affected"][number][] = [];
    const entries: MapAuditEntry[] = [];
    const ids: number[] = [];
    const gewandert: FlussPunktVerschoben[] = [];
    let liegen = 0;
    let enden = 0;
    let flussEintrag: MapAuditEntry | undefined;
    for (const zeile of zeilen) {
        const start = nah(zeile.sx, zeile.sy, von);
        const ende = nah(zeile.ex, zeile.ey, von);
        // Hält ihn ein anderer oder läge danach Anfang auf Ende, bleibt dieser Fluss, wo er ist.
        const aufeinander =
            (start && !ende && nah(zeile.ex, zeile.ey, nach)) || (ende && !start && nah(zeile.sx, zeile.sy, nach));
        if (gehalten.has(zeile.public_id) || aufeinander) {
            liegen += Number(start) + Number(ende);
            continue;
        }
        const [neu] = await tx<{ revision: number }[]>`
            WITH ziel AS (SELECT ST_SetSRID(ST_MakePoint(${nach.x}, ${nach.y}), 0) AS punkt)
            UPDATE path w
               SET geom = ST_SetPoint(
                       ST_SetPoint(w.geom, 0, CASE WHEN ${start}::boolean THEN ziel.punkt ELSE ST_StartPoint(w.geom) END),
                       -1,
                       CASE WHEN ${ende}::boolean THEN ziel.punkt ELSE ST_EndPoint(w.geom) END
                   )
              FROM ziel
             WHERE w.id = ${zeile.id}::bigint
            RETURNING w.revision::int AS revision
        `;
        ids.push(Number(zeile.id));
        affected.push({ kind: "path", id: zeile.public_id, revision: neu!.revision });
        const welche = [...(start ? (["start"] as const) : []), ...(ende ? (["end"] as const) : [])];
        const eintrag: MapAuditEntry = {
            action: "path.endpoint_moved",
            pathId: zeile.public_id,
            revisionBefore: zeile.revision,
            revisionAfter: neu!.revision,
            changes: {
                geometry: {
                    before: welche.map((e) =>
                        e === "start" ? { end: e, x: zeile.sx, y: zeile.sy } : { end: e, x: zeile.ex, y: zeile.ey },
                    ),
                    after: welche.map((e) => ({ end: e, x: nach.x, y: nach.y })),
                },
            },
        };
        entries.push(eintrag);
        flussEintrag ??= eintrag;
        enden += welche.length;
        for (const e of welche)
            gewandert.push({ von: e === "start" ? { x: zeile.sx, y: zeile.sy } : { x: zeile.ex, y: zeile.ey }, nach });
    }
    if (ids.length > 0) await derivePathVisualsFor(tx, ids);
    // Die Flusshöhen folgen den Enden, NACH allen Geometrien dieser Transaktion (wie beim Ort, `verschiebeOrtIn`).
    if (gewandert.length > 0) {
        const hoehen = await fuehreFlussHoehenNach(tx, mapDomainId, gewandert);
        if (hoehen.umzuege.length > 0 && flussEintrag?.changes !== undefined)
            flussEintrag.changes["wasserHoehen"] = wasserHoehenProtokoll(hoehen.umzuege);
        for (const gegenstand of hoehen.affected) affected.push(gegenstand);
    }
    return {
        affected,
        entries,
        warnings:
            liegen === 0
                ? []
                : [
                      {
                          code: "path_end_left",
                          message: `${String(liegen)} Flussenden blieben an der alten Lage liegen.`,
                      },
                  ],
        enden,
    };
}
