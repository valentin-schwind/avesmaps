import { randomUUID } from "node:crypto";
import {
    EDITOR_LOCK_ERROR_STATUS,
    pathReaderName,
    type EditorLock,
    type OperationReceipt,
    type PathRemovalBody,
    type PathSplitBody,
    type PathStateChange,
    type PathSammelRemovalBody,
    type PathStreetRemovalBody,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { derivePathVisualsFor } from "../derive/path-visual.ts";
import { ApiError } from "../http/api-error.ts";
import { exactKey } from "../routing/topology.ts";
import { fuehreFlussHoehenNach, umgekehrtAusProtokoll, wasserHoehenProtokoll } from "../terrain/fluss-hoehen.ts";
import { listEditorLocks } from "./editor-lock.ts";
import { mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";

/** Was der Schreibteil in der Transaktion liefert (der Rückgabewert, den `mapOperation` erwartet). */
export type TxErgebnis = Awaited<ReturnType<Parameters<typeof mapOperation>[3]>>;

/**
 * „Weg hier teilen“, „Ganz löschen“ und ↺ im Wegeditor (WI-0177 Stufe 3; Vertrag in `packages/shared/src/editor-path-split.ts`).
 *
 * - **`path.split`**, EINE Operation: Der vordere Teil (bis zum Teilungspunkt) behält Zeile und Kennung, seine Linie wird kürzer; der
 *   hintere Teil (ab dem Teilungspunkt) ist eine neue Zeile mit Herkunft `avesmaps3d` und denselben Feldern (Name, Art, Name auf der
 *   Karte, Bach, Fließrichtung und -stärke, Reisemittel samt Domäne und Jahreszeiten). Seine aktiven Wiki-Zuordnungen, Quellen und der
 *   Kanon werden mitkopiert, wie Legacy die Quellen auf beide Teile kopiert. Kurven beider Teile in derselben Transaktion.
 * - **`path.delete`** legt den Weg weich still (`is_active`), wie Legacys `delete_feature`; Wiki und Quellen bleiben am Weg.
 *   **`path.restore`** holt ihn zurück.
 * - **`path.take_off_map`** nimmt ihn von der Karte (Stufe 3b, Migration 0150, EDIT-0003 T43), **`path.put_on_map`** stellt ihn mit
 *   seiner gespeicherten Linie wieder her. Wie `place.take_off_map` die Zeile des Orts stilllegt, legt Abnehmen den Weg still
 *   (`is_active = FALSE`) und merkt `off_map`: Kacheln, Wegfindung, Suche und Prüfungen lesen nur `is_active` und lassen ihn ohne
 *   eigene Bedingung aus; die Liste zeigt ihn unter „Nicht auf der Karte“. Ein Zustand je Weg (`stand`): auf der Karte, abgenommen,
 *   gelöscht.
 * - **Eigene Höhen an Flüssen** (WI-0259): Teilen verschiebt keinen Stützpunkt, der Teilungspunkt liegt auf beiden Teilen; die Höhen hängen an der
 *   Lage und bleiben wirksam, ohne dass hier etwas nachzuführen wäre (`terrain/fluss-hoehen.ts`).
 * - Alle gegen die Revision des Wegs (409 `edit_conflict`), nie über die Sperre eines anderen hinweg (409 `object_locked`,
 *   EDIT-0003 §4), nie während eines Zugs (503 aus der Schreibnaht).
 */

interface WegZeile {
    id: string;
    public_id: string;
    map_domain_id: string;
    name: string;
    is_active: boolean;
    off_map: boolean;
    revision: number;
    updated_at: Date;
    geojson: string;
}

type Punkt = { x: number; y: number };

async function leseWeg(sql: Queryable, publicId: string): Promise<WegZeile | undefined> {
    const [row] = await sql<WegZeile[]>`
        SELECT id::text, public_id::text, map_domain_id, name, is_active, off_map, revision::int AS revision, updated_at,
               ST_AsGeoJSON(geom, 15) AS geojson
          FROM path WHERE public_id = ${publicId}::uuid
    `;
    return row;
}

const punkteVon = (geojson: string): Punkt[] =>
    (JSON.parse(geojson) as { coordinates: [number, number][] }).coordinates.map(([x, y]) => ({ x, y }));
const zeile = (punkte: readonly Punkt[]): [number, number][] => punkte.map((p) => [p.x, p.y]);
const linie = (punkte: readonly Punkt[]) => ({ xs: punkte.map((p) => p.x), ys: punkte.map((p) => p.y) });

export async function konflikt(tx: Sql, publicId: string): Promise<ApiError> {
    const row = await leseWeg(tx, publicId);
    return mapEditConflict(
        tx,
        { kind: "path", publicId },
        { revision: row?.revision ?? 0, changedAt: row?.updated_at ?? new Date() },
    );
}

/** Hält ein anderer den Weg (EDIT-0003 §4), schreibt diese Operation nicht über seinen Entwurf hinweg. */
async function pruefeSperre(tx: Sql, actor: MapActor, publicId: string): Promise<void> {
    await pruefeSperren(tx, actor, [publicId]);
}

/** Dasselbe für viele Abschnitte (eine Straße), mit EINEM Blick auf die Sperren. */
export async function pruefeSperren(tx: Sql, actor: MapActor, publicIds: readonly string[]): Promise<void> {
    const ids = new Set(publicIds);
    const fremd = (await listEditorLocks(tx, "path", undefined)).find(
        (sperre: EditorLock) => ids.has(sperre.id) && (actor.kind !== "person" || sperre.person.id !== actor.personId),
    );
    if (fremd !== undefined)
        throw new ApiError(
            EDITOR_LOCK_ERROR_STATUS.object_locked,
            "object_locked",
            `${fremd.person.name} bearbeitet das gerade.`,
            { lock: fremd },
        );
}

const nichtDa = (): ApiError => new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");

/** `path.split`: am inneren Stützpunkt `index` in zwei Wege; der vordere behält die Kennung. */
export async function splitPath(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: PathSplitBody,
): Promise<{ receipt: OperationReceipt; hinten: string }> {
    const vorab = await leseWeg(database, publicId);
    if (vorab === undefined || !vorab.is_active) throw nichtDa();
    const hinten = randomUUID();
    const receipt = await mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "path.split",
            mapDomainId: vorab.map_domain_id,
            body: { publicId, ...body },
        },
        async (tx) => {
            const row = await leseWeg(tx, publicId);
            if (row === undefined || !row.is_active) throw nichtDa();
            if (row.revision !== body.baseRevision) throw await konflikt(tx, publicId);
            await pruefeSperre(tx, actor, publicId);
            const punkte = punkteVon(row.geojson);
            const i = body.index;
            if (i <= 0 || i >= punkte.length - 1)
                throw new ApiError(400, "validation_failed", "Geteilt wird nur an einem inneren Stützpunkt.", {
                    field: "index",
                });
            // Der Stützpunkt, den der Editor meint, muss der gespeicherte sein (Legacy: `expected_coordinates`).
            if (exactKey(punkte[i]!.x, punkte[i]!.y) !== exactKey(body.at.x, body.at.y))
                throw await konflikt(tx, publicId);
            const vorne = punkte.slice(0, i + 1);
            const rest = punkte.slice(i);
            const v = linie(vorne);
            const [gekuerzt] = await tx<{ revision: number }[]>`
                UPDATE path
                   SET geom = ST_SetSRID(ST_MakeLine(ARRAY(
                           SELECT ST_MakePoint(t.x, t.y)
                             FROM unnest(${v.xs}::float8[], ${v.ys}::float8[]) WITH ORDINALITY AS t(x, y, n)
                            ORDER BY t.n)), 0)
                 WHERE public_id = ${publicId}::uuid AND revision = ${row.revision}
                RETURNING revision::int AS revision
            `;
            if (gekuerzt === undefined) throw await konflikt(tx, publicId);
            const h = linie(rest);
            const [neu] = await tx<{ id: string; revision: number; subtype: string }[]>`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active,
                                  flow_direction, flow_factor, allowed_transports, transport_domain, transport_seasons,
                                  is_tunnel, mark, transports_written)
                SELECT ${hinten}::uuid, p.map_domain_id, p.name, p.subtype, p.label_visible, p.is_bach,
                       ST_SetSRID(ST_MakeLine(ARRAY(
                           SELECT ST_MakePoint(t.x, t.y)
                             FROM unnest(${h.xs}::float8[], ${h.ys}::float8[]) WITH ORDINALITY AS t(x, y, n)
                            ORDER BY t.n)), 0),
                       'avesmaps3d', TRUE, p.flow_direction, p.flow_factor, p.allowed_transports, p.transport_domain,
                       p.transport_seasons, p.is_tunnel, p.mark, p.transports_written
                  FROM path p WHERE p.id = ${row.id}::bigint
                RETURNING id::text, revision::int AS revision, subtype
            `;
            // Wiki, Quellen und Kanon gehen mit (Legacy kopiert die Quellen auf beide Teile); nur Aktives.
            await tx`
                INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin,
                                                  source_system)
                SELECT ${neu!.id}::bigint, role, wiki_url, snapshot_id, assignment_state, assignment_origin, 'avesmaps3d'
                  FROM path_wiki_assignment WHERE path_id = ${row.id}::bigint AND is_active
            `;
            // Eine Quelle, die die Redaktion gesetzt hat (`editor`), bleibt auch am neuen Teil geschützt (WI-0254 Runde 6: Weg-Quellen gelten der ganzen Straße).
            await tx`
                INSERT INTO path_source (path_id, source_id, reference_kind, pages, note, legacy_origin, position, state, source_system)
                SELECT ${neu!.id}::bigint, source_id, reference_kind, pages, note, legacy_origin, position, state,
                       CASE WHEN source_system = 'editor' THEN 'editor' ELSE 'avesmaps3d' END
                  FROM path_source WHERE path_id = ${row.id}::bigint AND is_active
            `;
            await tx`
                INSERT INTO path_canon (path_id, canon, designator_type, designator_count, designator_label, derived_from,
                                        source_revision, source_system)
                SELECT ${neu!.id}::bigint, canon, designator_type, designator_count, designator_label, derived_from,
                       source_revision, 'avesmaps3d'
                  FROM path_canon WHERE path_id = ${row.id}::bigint
            `;
            await derivePathVisualsFor(tx, [Number(row.id), Number(neu!.id)]);
            return {
                receipt: {
                    affected: [
                        { kind: "path", id: publicId, revision: gekuerzt.revision },
                        { kind: "path", id: hinten, revision: neu!.revision },
                    ],
                    derivedWork: [
                        { kind: "path_visual", state: "done" },
                        { kind: "routing", state: "pending" },
                    ],
                    warnings: [],
                },
                summary: `${row.name}: geteilt am Stützpunkt ${String(i + 1)}`,
                entries: [
                    {
                        action: "path.split",
                        pathId: publicId,
                        revisionBefore: row.revision,
                        revisionAfter: gekuerzt.revision,
                        changes: { geometry: { before: zeile(punkte), after: zeile(vorne) } },
                    },
                    {
                        action: "path.created",
                        pathId: hinten,
                        revisionBefore: null,
                        revisionAfter: neu!.revision,
                        changes: {
                            geometry: { after: zeile(rest) },
                            subtype: { after: neu!.subtype },
                            active: { after: true },
                        },
                    },
                ],
            };
        },
    );
    // Eine wiederholte Kennung bekommt die erste Quittung: Ihr hinterer Teil ist der aus der Quittung.
    const zweiter = receipt.affected.find((entity) => entity.kind === "path" && entity.id !== publicId)?.id ?? hinten;
    return { receipt, hinten: zweiter };
}

/** Wo ein Weg steht: auf der Karte, von der Karte genommen (Stufe 3b) oder gelöscht. */
export type WegStand = "karte" | "abgenommen" | "geloescht";

export const wegStand = (row: { is_active: boolean; off_map: boolean }): WegStand =>
    row.is_active ? "karte" : row.off_map ? "abgenommen" : "geloescht";

/** Die Spalten zu einem Stand: Nur auf der Karte ist der Weg aktiv; `off_map` unterscheidet abgenommen von gelöscht. */
const spaltenFuer = (stand: WegStand) => ({ is_active: stand === "karte", off_map: stand === "abgenommen" });

/** Die vier Wechsel des Stands: woher sie gehen, wohin, und was der Verlauf sagt. */
export const WEG_WECHSEL = {
    "path.delete": { von: ["karte", "abgenommen"], nach: "geloescht", eintrag: "path.deleted", satz: "gelöscht" },
    "path.restore": { von: ["geloescht"], nach: "karte", eintrag: "path.restored", satz: "zurückgeholt" },
    "path.take_off_map": {
        von: ["karte"],
        nach: "abgenommen",
        eintrag: "path.taken_off_map",
        satz: "von der Karte genommen",
    },
    "path.put_on_map": { von: ["abgenommen"], nach: "karte", eintrag: "path.put_on_map", satz: "zurück auf der Karte" },
} as const satisfies Record<string, { von: readonly WegStand[]; nach: WegStand; eintrag: string; satz: string }>;
export type WegWechsel = keyof typeof WEG_WECHSEL;

/** Warum ein Wechsel nicht geht: der Stand, in dem der Weg gerade ist. */
const STEHT: Record<WegStand, string> = {
    karte: "Dieser Weg ist auf der Karte.",
    abgenommen: "Dieser Weg ist von der Karte genommen.",
    geloescht: "Dieser Weg ist gelöscht.",
};

/** `path.delete`, `path.restore`, `path.take_off_map`, `path.put_on_map`: EIN Wechsel des Stands gegen die Revision. */
export async function setPathState(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: PathRemovalBody,
    wechsel: WegWechsel,
): Promise<OperationReceipt> {
    return setPathsState(
        database,
        actor,
        publicId,
        body.operationId,
        [{ publicId, baseRevision: body.baseRevision }],
        wechsel,
        {
            publicId,
            ...body,
        },
    );
}

/**
 * „Ganze Straße (n Abschnitte) …“ (EDIT-0003 T49): derselbe Wechsel für alle Abschnitte in EINER Operation, jeder gegen seine Revision
 * und nie über eine fremde Sperre; geht einer nicht, geht keiner (409 oder 400 nennt den Abschnitt). 🔴 Die Abschnitte im Körper sind
 * genau die Straße der Route (dieselbe Gruppierung wie das Wege-Fenster, `readEditorPathStreet`): ein fremder Weg ist 400, ein fehlender
 * Abschnitt 409 (die Straße hat sich inzwischen geändert). Sonst nähme „Ganze Straße“ beliebige Wege mit (Befund der Sicherheitsprüfung,
 * OPS-000036, 2026-10-18).
 */
export async function setStreetState(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: PathStreetRemovalBody,
    wechsel: "path.delete" | "path.take_off_map",
): Promise<OperationReceipt> {
    if (!body.sections.some((teil) => teil.publicId === publicId))
        throw new ApiError(400, "validation_failed", "Der Abschnitt gehört nicht zu dieser Straße.", {
            field: "sections",
        });
    return setPathsState(
        database,
        actor,
        publicId,
        body.operationId,
        body.sections,
        wechsel,
        { publicId, ...body },
        "strasse",
    );
}

/**
 * „Weg entfernen …“ an der Mehrfachauswahl (WI-0252): derselbe Wechsel für ALLE gewählten Wege in EINER Operation unter dem Namen des
 * Einzelfalls (`path.delete`, `path.take_off_map`), jeder Abschnitt gegen seine Revision und nie über eine fremde Sperre; geht einer
 * nicht, geht keiner. 🔴 Wie bei „Ganze Straße“ ist ein Weg seine ganze Straße: Der Körper muss von jedem genannten Weg alle Abschnitte
 * nennen (sonst 409, die Straße hat sich geändert), und alle liegen auf derselben Karte (sonst 400). Sonst ließe die Sammel-Route einen
 * Teil einer Straße zurück. ↺ ist die Rücknahme der Wege (`ruecknahme-weg.ts`) über genau diese Abschnitte.
 */
export async function setPathsStateSammel(
    database: Database,
    actor: MapActor,
    body: PathSammelRemovalBody,
    wechsel: "path.delete" | "path.take_off_map",
): Promise<OperationReceipt> {
    // In fester Reihenfolge schreiben (nach Kennung), damit zwei Auswahlen einander nicht festhalten.
    const abschnitte = [...body.sections].sort((a, b) =>
        a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0,
    );
    return setPathsState(
        database,
        actor,
        abschnitte[0]!.publicId,
        body.operationId,
        abschnitte,
        wechsel,
        { ...body, sections: abschnitte },
        "wege",
    );
}

/**
 * Die Abschnitte der Straße eines Wegs, wie das Wege-Fenster sie gruppiert (`readEditorPathStreet`): gleicher echter Name über Wegtypen
 * und Kennzeichen hinweg (Regel (c)), derselbe Stand; ohne echten Namen (leer, Griff) nur er selbst.
 */
async function strassenAbschnitte(tx: Sql, anker: WegZeile): Promise<string[]> {
    const [art] = await tx<{ subtype: string }[]>`SELECT subtype FROM path WHERE public_id = ${anker.public_id}::uuid`;
    if (pathReaderName(anker.name, art?.subtype ?? "") === null) return [anker.public_id];
    const zeilen = await tx<{ id: string }[]>`
        SELECT public_id::text AS id FROM path
         WHERE map_domain_id = ${anker.map_domain_id} AND name = ${anker.name} AND btrim(name) <> subtype
           AND is_active = ${anker.is_active} AND off_map = ${anker.off_map}
    `;
    return zeilen.map((z) => z.id);
}

/**
 * Die gewählten Wege einer Sammel-Operation (WI-0252): alle Abschnitte auf der Karte der Operation, jeder genannte Weg mit ALLEN seinen
 * Abschnitten (die Straße, wie das Wege-Fenster sie gruppiert); ein fehlender ist 409, ein doppelter oder auf einer anderen Karte 400.
 * Gibt die Zahl der Wege zurück.
 */
async function pruefeWege(tx: Sql, abschnitte: readonly { publicId: string }[], mapDomainId: string): Promise<number> {
    const genannt = new Set(abschnitte.map((teil) => teil.publicId));
    if (genannt.size !== abschnitte.length)
        throw new ApiError(400, "validation_failed", "Ein Abschnitt steht mehrfach in der Auswahl.", {
            field: "sections",
        });
    const gesehen = new Set<string>();
    let wege = 0;
    for (const { publicId } of abschnitte) {
        const row = await leseWeg(tx, publicId);
        if (row === undefined) throw nichtDa();
        if (row.map_domain_id !== mapDomainId)
            throw new ApiError(400, "validation_failed", "Die gewählten Wege liegen auf verschiedenen Karten.", {
                field: "sections",
                publicId,
            });
        if (gesehen.has(publicId)) continue;
        wege += 1;
        for (const id of await strassenAbschnitte(tx, row)) gesehen.add(id);
    }
    const fehlt = [...gesehen].find((id) => !genannt.has(id));
    if (fehlt !== undefined) throw await konflikt(tx, fehlt);
    return wege;
}

/** Das Recht eines Wechsels: löschen und zurückholen an Objekten, abnehmen und zurück auf die Karte an der Lage (wie am Ort). */
export const rechtFuer = (wechsel: PathStateChange): "edit_map_objects" | "edit_map_geometry" =>
    wechsel === "path.delete" || wechsel === "path.restore" ? "edit_map_objects" : "edit_map_geometry";

async function setPathsState(
    database: Database,
    actor: MapActor,
    anker: string,
    operationId: string,
    abschnitte: readonly { publicId: string; baseRevision: number }[],
    wechsel: WegWechsel,
    body: object,
    /** Was die genannten Abschnitte sein müssen: beliebige (einzeln, ↺), genau die Straße des Ankers, oder ganze Straßen mehrerer Wege. */
    umfang: "abschnitt" | "strasse" | "wege" = "abschnitt",
    source: "editor" | "restore" = "editor",
): Promise<OperationReceipt> {
    const vorab = await leseWeg(database, anker);
    if (vorab === undefined) throw nichtDa();
    return mapOperation(
        database,
        actor,
        { operationId, operation: wechsel, mapDomainId: vorab.map_domain_id, body, source },
        (tx) =>
            schreibeStandIn(tx, actor, {
                anker,
                mapDomainId: vorab.map_domain_id,
                abschnitte,
                wechsel,
                umfang,
            }),
    );
}

/** Was der Schreibteil eines Wechsels des Stands braucht (`setPathsState` und die Rücknahme, `ruecknahme-weg.ts`). */
export interface StandSchreiben {
    anker: string;
    mapDomainId: string;
    abschnitte: readonly { publicId: string; baseRevision: number }[];
    wechsel: WegWechsel;
    /** Was die genannten Abschnitte sein müssen: beliebige (einzeln, ↺), genau die Straße des Ankers, oder ganze Straßen mehrerer Wege. */
    umfang: "abschnitt" | "strasse" | "wege";
}

/**
 * Der Schreibteil eines Wechsels des Stands in einer laufenden Transaktion: jeder Abschnitt gegen seine Revision, nie über eine fremde Sperre, geht einer nicht, geht keiner.
 * Die Routen rufen ihn über `setPathsState`; die Rücknahme (WI-0265 B6a) ruft ihn in der Transaktion ihrer einen Operation, damit der Gegenwechsel dieselben Prüfungen und
 * dieselben Folgen hat wie ein Wechsel aus dem Menü.
 */
export async function schreibeStandIn(tx: Sql, actor: MapActor, parameter: StandSchreiben): Promise<TxErgebnis> {
    const { anker, abschnitte, wechsel, umfang } = parameter;
    const regel = WEG_WECHSEL[wechsel];
    let wege = 0;
    if (umfang === "wege") wege = await pruefeWege(tx, abschnitte, parameter.mapDomainId);
    if (umfang === "strasse") {
        const ankerJetzt = await leseWeg(tx, anker);
        if (ankerJetzt === undefined) throw nichtDa();
        const strasse = new Set(await strassenAbschnitte(tx, ankerJetzt));
        const fremd = abschnitte.find((teil) => !strasse.has(teil.publicId));
        if (fremd !== undefined)
            throw new ApiError(400, "validation_failed", "Der Abschnitt gehört nicht zu dieser Straße.", {
                field: "sections",
                publicId: fremd.publicId,
            });
        const genannt = new Set(abschnitte.map((teil) => teil.publicId));
        const fehlt = [...strasse].find((id) => !genannt.has(id));
        if (fehlt !== undefined) throw await konflikt(tx, fehlt);
    }
    const affected: OperationReceipt["affected"][number][] = [];
    const entries: MapAuditEntry[] = [];
    let name = "";
    for (const { publicId, baseRevision } of abschnitte) {
        const row = await leseWeg(tx, publicId);
        if (row === undefined) throw nichtDa();
        name ||= row.name;
        if (row.revision !== baseRevision) throw await konflikt(tx, publicId);
        const vorher = wegStand(row);
        if (!(regel.von as readonly WegStand[]).includes(vorher))
            throw new ApiError(400, "validation_failed", STEHT[vorher], { field: "active", publicId });
        await pruefeSperre(tx, actor, publicId);
        const ziel = spaltenFuer(regel.nach);
        const [geaendert] = await tx<{ id: string; revision: number }[]>`
            UPDATE path SET is_active = ${ziel.is_active}, off_map = ${ziel.off_map}
             WHERE public_id = ${publicId}::uuid AND revision = ${row.revision}
            RETURNING id::text, revision::int AS revision
        `;
        if (geaendert === undefined) throw await konflikt(tx, publicId);
        if (ziel.is_active) await derivePathVisualsFor(tx, [Number(geaendert.id)]);
        const changes: Record<string, { before: boolean; after: boolean }> = {};
        if (row.is_active !== ziel.is_active) changes["active"] = { before: row.is_active, after: ziel.is_active };
        if (row.off_map !== ziel.off_map) changes["offMap"] = { before: row.off_map, after: ziel.off_map };
        affected.push({ kind: "path", id: publicId, revision: geaendert.revision });
        entries.push({
            action: regel.eintrag,
            pathId: publicId,
            revisionBefore: row.revision,
            revisionAfter: geaendert.revision,
            changes,
        });
    }
    return {
        receipt: { affected, derivedWork: [{ kind: "routing", state: "pending" as const }], warnings: [] },
        summary:
            wege > 1
                ? `${String(wege)} Wege: ${String(abschnitte.length)} Abschnitte ${regel.satz}`
                : abschnitte.length === 1
                  ? `${name}: ${regel.satz}`
                  : `${name}: ${String(abschnitte.length)} Abschnitte ${regel.satz}`,
        entries,
    };
}

/**
 * Die Rücknahme von `path.split` und `path.join` und ihre Gegenstücke (WI-0265 B8a, B8a2; `ruecknahme-weg.ts`): EIN Paar von Schreibwegen, das in beide Richtungen geht.
 *
 * - `legeTeileZusammenIn`: die Teile werden EIN Weg. Der vordere Teil bekommt die ganze Linie, jeder hintere wird still gelegt wie bei „Wege verbinden“ (`is_active`; Wiki, Quellen und
 *   Kanon bleiben an ihm). Rücknahme von „Weg teilen“ (ein hinterer Teil) und von der Rücknahme von „Wege verbinden“ (so viele hintere Teile, wie die Kette Glieder hatte). Einträge `path.merged`.
 * - `teileWiederIn`: das Gegenstück. Der vordere Teil bekommt seine kürzere Linie zurück, jeder hintere kommt zurück auf die Karte. Rücknahme von `path.merged`; geschrieben werden die
 *   Einträge des Teilens (`path.split` am vorderen, `path.created` an jedem hinteren Teil), sodass auch diese Rücknahme sich wieder zusammenlegen lässt.
 *
 * Beide: Jeder Teil gegen seine heutige Revision (die Vorprüfung unter den Sperren hat sie mit der Revision nach der Operation verglichen), nie über eine fremde Sperre, geht einer nicht, geht keiner.
 * 🔴 Die Höhen an Flüssen (WI-0259, „Höhe wandert mit“): Teilen verschiebt keinen Stützpunkt, Verbinden schon (`wasserHoehen` im Protokoll des vorderen Teils). `hoehen` ist dieser Eintrag der Operation,
 * die zurückgenommen wird; die Höhen gehen so zurück, und der Eintrag dieser Rücknahme führt ihr Gegenstück, sodass die Kette über beliebig viele Rücknahmen der Rücknahme stimmt.
 */
interface TeileSchreiben {
    readonly mapDomainId: string;
    readonly vorne: string;
    readonly hinten: readonly string[];
    /** Die Höhen an Flüssen, die die Operation umzog, die zurückgenommen wird (`changes.wasserHoehen` ihres vorderen Teils im Protokoll). */
    readonly hoehen?: { before?: unknown; after?: unknown } | undefined;
}

/** Die Teile lesen, auf der Karte oder still gelegt; fehlt einer, ist der Weg weg (404). */
async function leseTeile(tx: Sql, vorne: string, hinten: readonly string[]) {
    const vorn = await leseWeg(tx, vorne);
    const hintere = await Promise.all(hinten.map((id) => leseWeg(tx, id)));
    if (vorn === undefined || hintere.some((teil) => teil === undefined)) throw nichtDa();
    return { vorn, hintere: hintere as WegZeile[] };
}

/** Die Höhen an Flüssen der zurückgenommenen Operation an ihre Stützpunkte zurück; der Eintrag trägt, was dabei umzog. */
async function fuehreHoehenZurueck(
    tx: Sql,
    mapDomainId: string,
    hoehen: TeileSchreiben["hoehen"],
    eintrag: MapAuditEntry,
    affected: OperationReceipt["affected"],
): Promise<void> {
    const umgezogen = umgekehrtAusProtokoll(hoehen);
    if (umgezogen.length === 0) return;
    const ergebnis = await fuehreFlussHoehenNach(tx, mapDomainId, umgezogen, { genau: true });
    if (ergebnis.umzuege.length > 0 && eintrag.changes !== undefined)
        eintrag.changes["wasserHoehen"] = wasserHoehenProtokoll(ergebnis.umzuege);
    for (const g of ergebnis.affected) affected.push(g);
}

export async function legeTeileZusammenIn(
    tx: Sql,
    actor: MapActor,
    p: TeileSchreiben & { readonly linie: readonly [number, number][] },
): Promise<TxErgebnis> {
    const { vorn, hintere } = await leseTeile(tx, p.vorne, p.hinten);
    // Alle Teile auf der Karte; ein Teil, den seither jemand gelöscht oder abgenommen hat, ist ein Konflikt.
    for (const teil of [vorn, ...hintere]) if (!teil.is_active) throw await konflikt(tx, teil.public_id);
    await pruefeSperren(tx, actor, [p.vorne, ...p.hinten]);
    const davor = punkteVon(vorn.geojson);
    const neu = p.linie.map(([x, y]) => ({ x, y }));
    const gesamt = linie(neu);
    const [zusammen] = await tx<{ revision: number }[]>`
        UPDATE path
           SET geom = ST_SetSRID(ST_MakeLine(ARRAY(
                   SELECT ST_MakePoint(t.x, t.y)
                     FROM unnest(${gesamt.xs}::float8[], ${gesamt.ys}::float8[]) WITH ORDINALITY AS t(x, y, n)
                    ORDER BY t.n)), 0)
         WHERE public_id = ${p.vorne}::uuid AND revision = ${vorn.revision}
        RETURNING revision::int AS revision
    `;
    if (zusammen === undefined) throw await konflikt(tx, p.vorne);
    const affected: OperationReceipt["affected"] = [{ kind: "path", id: p.vorne, revision: zusammen.revision }];
    const entries: MapAuditEntry[] = [
        {
            action: "path.merged",
            pathId: p.vorne,
            revisionBefore: vorn.revision,
            revisionAfter: zusammen.revision,
            changes: { geometry: { before: zeile(davor), after: zeile(neu) } },
        },
    ];
    for (const teil of hintere) {
        const [still] = await tx<{ revision: number }[]>`
            UPDATE path SET is_active = FALSE
             WHERE public_id = ${teil.public_id}::uuid AND revision = ${teil.revision}
            RETURNING revision::int AS revision
        `;
        if (still === undefined) throw await konflikt(tx, teil.public_id);
        affected.push({ kind: "path", id: teil.public_id, revision: still.revision });
        entries.push({
            action: "path.merged",
            pathId: teil.public_id,
            revisionBefore: teil.revision,
            revisionAfter: still.revision,
            changes: { active: { before: true, after: false } },
        });
    }
    await derivePathVisualsFor(tx, [Number(vorn.id)]);
    await fuehreHoehenZurueck(tx, p.mapDomainId, p.hoehen, entries[0]!, affected);
    return {
        receipt: {
            affected,
            derivedWork: [
                { kind: "path_visual", state: "done" },
                { kind: "routing", state: "pending" },
            ],
            warnings: [],
        },
        summary: `${vorn.name}: ${hintere.length === 1 ? "Teilen" : "Trennen"} zurückgenommen`,
        entries,
    };
}

export async function teileWiederIn(
    tx: Sql,
    actor: MapActor,
    p: TeileSchreiben & { readonly linieVorne: readonly [number, number][] },
): Promise<TxErgebnis> {
    const { vorn, hintere } = await leseTeile(tx, p.vorne, p.hinten);
    if (!vorn.is_active) throw await konflikt(tx, p.vorne);
    // Ein still gelegter Teil muss es noch sein (sonst hat ihn inzwischen jemand zurückgeholt oder von der Karte genommen).
    for (const teil of hintere) if (teil.is_active || teil.off_map) throw await konflikt(tx, teil.public_id);
    await pruefeSperren(tx, actor, [p.vorne, ...p.hinten]);
    const davor = punkteVon(vorn.geojson);
    const neu = p.linieVorne.map(([x, y]) => ({ x, y }));
    const kurz = linie(neu);
    const [geteilt] = await tx<{ revision: number }[]>`
        UPDATE path
           SET geom = ST_SetSRID(ST_MakeLine(ARRAY(
                   SELECT ST_MakePoint(t.x, t.y)
                     FROM unnest(${kurz.xs}::float8[], ${kurz.ys}::float8[]) WITH ORDINALITY AS t(x, y, n)
                    ORDER BY t.n)), 0)
         WHERE public_id = ${p.vorne}::uuid AND revision = ${vorn.revision}
        RETURNING revision::int AS revision
    `;
    if (geteilt === undefined) throw await konflikt(tx, p.vorne);
    const affected: OperationReceipt["affected"] = [{ kind: "path", id: p.vorne, revision: geteilt.revision }];
    const entries: MapAuditEntry[] = [
        {
            action: "path.split",
            pathId: p.vorne,
            revisionBefore: vorn.revision,
            revisionAfter: geteilt.revision,
            changes: { geometry: { before: zeile(davor), after: zeile(neu) } },
        },
    ];
    for (const teil of hintere) {
        const [zurueck] = await tx<{ revision: number }[]>`
            UPDATE path SET is_active = TRUE
             WHERE public_id = ${teil.public_id}::uuid AND revision = ${teil.revision}
            RETURNING revision::int AS revision
        `;
        if (zurueck === undefined) throw await konflikt(tx, teil.public_id);
        affected.push({ kind: "path", id: teil.public_id, revision: zurueck.revision });
        entries.push({
            action: "path.created",
            pathId: teil.public_id,
            revisionBefore: teil.revision,
            revisionAfter: zurueck.revision,
            changes: {
                geometry: { after: zeile(punkteVon(teil.geojson)) },
                active: { before: false, after: true },
            },
        });
    }
    await derivePathVisualsFor(tx, [Number(vorn.id), ...hintere.map((teil) => Number(teil.id))]);
    await fuehreHoehenZurueck(tx, p.mapDomainId, p.hoehen, entries[0]!, affected);
    return {
        receipt: {
            affected,
            derivedWork: [
                { kind: "path_visual", state: "done" },
                { kind: "routing", state: "pending" },
            ],
            warnings: [],
        },
        summary: `${vorn.name}: wieder ${hintere.length === 1 ? "geteilt" : "getrennt"}`,
        entries,
    };
}
