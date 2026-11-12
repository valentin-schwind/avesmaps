import type {
    OperationReceipt,
    TerritoryRestoreBody,
    TerritoryRetireBody,
    TerritorySammelRetireBody,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { GEBIET_ART, GEBIETSFLAECHE_ART, mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import { geojsonAus, polygoneVon, ringe, type Punkt } from "./ring-form.ts";
import { pruefeFremdeGebietssperre } from "./territory-reshape.ts";

/**
 * „Entfernen“ eines Herrschaftsgebiets und sein ↺ (WI-0209 D3; EDIT-0005 §7 D3, Fragen 4 und 5; Vertrag `TerritoryRetireBody`).
 *
 * - **`off_map`** setzt die aktiven Flächen des Gebiets still (`territory_area.retired`); das Gebiet und seine Revision bleiben.
 * - **`retire`** setzt das Gebiet still (`territory.retired`) und behandelt seine Untergebiete: `up` hängt sie an sein Obergebiet,
 *   `root` macht sie zu Wurzeln (beides `territory.updated` mit `parent` und Herkunft `override`), `along` setzt den ganzen Teilbaum
 *   still. Flächen und Ansprüche eines stillen Gebiets liest die Ableitung ohnehin nicht (`readDeriveInputs`).
 * - **Sperre** nur der Gebiete, die sich ändern (Frage 5); das Gebiet selbst gegen `baseRevision`, die Untergebiete unter
 *   `FOR NO KEY UPDATE` (nicht `FOR UPDATE`: die laufende Ableitung hält `FOR KEY SHARE` über die Fremdschlüssel ihrer Tafeln).
 * - **↺** (`territory.restore`): liest das Protokoll der zurückgenommenen Operation und kehrt jede Zeile um, wenn sie noch so steht, wie die
 *   Operation sie hinterließ; sonst 409 `edit_conflict`. Die Herkunft eines zurückgehängten Untergebiets kommt mit (`parentOrigin`).
 * - **„Flächen vereinigen ›“** (`territory.merge`, WI-0252, `territory-vereinigen.ts`): ↺ ebenfalls hier; die Vorlage bekommt ihre Form
 *   zurück (`territory_area.merged`), wenn sie seither niemand geformt hat, die übrigen Flächen kommen wieder auf die Karte.
 * - **Mehrere** (`retireTerritories`, Mehrfachauswahl EDIT-0003 T57): dieselben Schritte je Gebiet in EINER Operation; Obergebiete vor
 *   ihren Untergebieten, damit jedes Untergebiet höchstens einmal umgehängt wird und ↺ den Baum in einem Durchgang wieder herstellt.
 */

interface GebietZeile {
    id: string;
    public_id: string;
    name: string;
    parent_id: string | null;
    parent_public_id: string | null;
    parent_origin: string | null;
    map_domain_id: string;
    revision: number;
    is_active: boolean;
    updated_at: Date;
}

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

async function leseGebiet(sql: Queryable, publicId: string, sperren = false): Promise<GebietZeile | undefined> {
    const [zeile] = sperren
        ? await sql<GebietZeile[]>`
            SELECT t.id::text AS id, t.public_id::text AS public_id, t.name, t.parent_id::text AS parent_id,
                   p.public_id::text AS parent_public_id, t.parent_origin, t.map_domain_id, t.revision::int AS revision,
                   t.is_active, t.updated_at
              FROM territory t LEFT JOIN territory p ON p.id = t.parent_id
             WHERE t.public_id = ${publicId}::uuid FOR NO KEY UPDATE OF t`
        : await sql<GebietZeile[]>`
            SELECT t.id::text AS id, t.public_id::text AS public_id, t.name, t.parent_id::text AS parent_id,
                   p.public_id::text AS parent_public_id, t.parent_origin, t.map_domain_id, t.revision::int AS revision,
                   t.is_active, t.updated_at
              FROM territory t LEFT JOIN territory p ON p.id = t.parent_id
             WHERE t.public_id = ${publicId}::uuid`;
    return zeile;
}

/** Die aktiven Untergebiete (direkt) oder der ganze aktive Teilbaum unter `id`, gesperrt. */
async function untergebiete(tx: Sql, id: string, ganz: boolean): Promise<GebietZeile[]> {
    return ganz
        ? tx<GebietZeile[]>`
            WITH RECURSIVE unten AS (
                SELECT c.id FROM territory c WHERE c.parent_id = ${id}::bigint AND c.is_active AND c.id <> ${id}::bigint
                UNION
                SELECT c.id FROM territory c JOIN unten u ON c.parent_id = u.id WHERE c.is_active
            )
            SELECT t.id::text AS id, t.public_id::text AS public_id, t.name, t.parent_id::text AS parent_id,
                   p.public_id::text AS parent_public_id, t.parent_origin, t.map_domain_id, t.revision::int AS revision,
                   t.is_active, t.updated_at
              FROM territory t JOIN unten u ON u.id = t.id LEFT JOIN territory p ON p.id = t.parent_id
             ORDER BY t.id FOR NO KEY UPDATE OF t`
        : tx<GebietZeile[]>`
            SELECT t.id::text AS id, t.public_id::text AS public_id, t.name, t.parent_id::text AS parent_id,
                   p.public_id::text AS parent_public_id, t.parent_origin, t.map_domain_id, t.revision::int AS revision,
                   t.is_active, t.updated_at
              FROM territory t LEFT JOIN territory p ON p.id = t.parent_id
             WHERE t.parent_id = ${id}::bigint AND t.is_active AND t.id <> ${id}::bigint
             ORDER BY t.id FOR NO KEY UPDATE OF t`;
}

const namenSatz = (namen: readonly string[]): string =>
    namen.length <= 3 ? namen.join(", ") : `${namen.slice(0, 3).join(", ")} und ${String(namen.length - 3)} weitere`;

/** `territory.retire` (WI-0209 D3): „Von der Karte nehmen“ oder „Ganz löschen“ mit den Untergebieten. */
export async function retireTerritory(
    database: Database,
    actor: MapActor,
    territoryId: string,
    body: TerritoryRetireBody,
): Promise<OperationReceipt> {
    const vorab = await leseGebiet(database, territoryId);
    if (vorab === undefined || !vorab.is_active)
        throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
    if (body.stage === "off_map" && body.children !== undefined)
        throw ungueltig("Beim Abnehmen von der Karte bleiben die Untergebiete, wo sie sind.", { field: "children" });

    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "territory.retire",
            mapDomainId: vorab.map_domain_id,
            body: { territoryId, ...body },
        },
        async (tx) => {
            const gebiet = await leseGebiet(tx, territoryId, true);
            if (gebiet === undefined || !gebiet.is_active)
                throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
            if (gebiet.revision !== body.baseRevision)
                throw await mapEditConflict(
                    tx,
                    { kind: "territory", publicId: territoryId },
                    { revision: gebiet.revision, changedAt: gebiet.updated_at },
                );
            const affected: OperationReceipt["affected"] = [];
            const entries: MapAuditEntry[] = [];
            if (body.stage === "off_map") {
                if ((await nimmVonDerKarte(tx, actor, gebiet, affected, entries)) === 0)
                    throw ungueltig("Dieses Gebiet hat keine eigene Fläche auf der Karte.", { field: "stage" });
                return {
                    receipt: { affected, derivedWork: [], warnings: [] },
                    summary: `${gebiet.name}: von der Karte genommen`,
                    entries,
                };
            }
            const kinder = await loesche(tx, actor, gebiet, body.children, affected, entries);
            const mit =
                kinder.length === 0
                    ? ""
                    : body.children === "along"
                      ? `, mit ${namenSatz(kinder.map((k) => k.name))}`
                      : `, Untergebiete ${body.children === "up" ? "eine Ebene hoch" : "eigenständig"}`;
            return {
                receipt: { affected, derivedWork: [], warnings: [] },
                summary: `${gebiet.name}: gelöscht${mit}`,
                entries,
            };
        },
    );
}

/** „Von der Karte nehmen“ an EINEM Gebiet in einer laufenden Operation: seine aktiven Flächen gehen. Gibt ihre Zahl zurück. */
async function nimmVonDerKarte(
    tx: Sql,
    actor: MapActor,
    gebiet: GebietZeile,
    affected: OperationReceipt["affected"],
    entries: MapAuditEntry[],
): Promise<number> {
    const territoryId = gebiet.public_id;
    await pruefeFremdeGebietssperre(tx, actor, [territoryId]);
    const flaechen = await tx<{ public_id: string; vorher: number; nachher: number }[]>`
        WITH alt AS (
            SELECT id, public_id, revision FROM territory_area
             WHERE territory_id = ${gebiet.id}::bigint AND is_active
        )
        UPDATE territory_area a SET is_active = FALSE FROM alt WHERE a.id = alt.id
        RETURNING alt.public_id::text AS public_id, alt.revision::int AS vorher, a.revision::int AS nachher
    `;
    for (const f of flaechen) {
        affected.push({ kind: GEBIETSFLAECHE_ART, id: f.public_id, revision: f.nachher });
        entries.push({
            action: "territory_area.retired",
            territoryId,
            territoryAreaId: f.public_id,
            revisionBefore: f.vorher,
            revisionAfter: f.nachher,
            changes: { active: { before: true, after: false } },
        });
    }
    return flaechen.length;
}

/** „Ganz löschen“ an EINEM Gebiet in einer laufenden Operation, mit seinen Untergebieten nach `children`. Gibt diese zurück. */
async function loesche(
    tx: Sql,
    actor: MapActor,
    gebiet: GebietZeile,
    children: TerritoryRetireBody["children"],
    affected: OperationReceipt["affected"],
    entries: MapAuditEntry[],
): Promise<GebietZeile[]> {
    const territoryId = gebiet.public_id;
    const kinder = await untergebiete(tx, gebiet.id, children === "along");
    if (kinder.length > 0 && children === undefined)
        throw ungueltig("Was mit den Untergebieten geschieht, muss gewählt sein.", { field: "children" });
    await pruefeFremdeGebietssperre(tx, actor, [territoryId, ...kinder.map((k) => k.public_id)]);

    const stillsetzen = async (zeile: GebietZeile): Promise<void> => {
        const [neu] = await tx<{ revision: number }[]>`
            UPDATE territory SET is_active = FALSE WHERE id = ${zeile.id}::bigint RETURNING revision::int AS revision
        `;
        affected.push({ kind: GEBIET_ART, id: zeile.public_id, revision: neu!.revision });
        entries.push({
            action: "territory.retired",
            territoryId: zeile.public_id,
            revisionBefore: zeile.revision,
            revisionAfter: neu!.revision,
            changes: { active: { before: true, after: false } },
        });
    };
    await stillsetzen(gebiet);
    if (children === "along") for (const kind of kinder) await stillsetzen(kind);
    else
        for (const kind of kinder) {
            const ziel = children === "up" ? gebiet.parent_id : null;
            const [neu] = await tx<{ revision: number }[]>`
                UPDATE territory SET parent_id = ${ziel}::bigint, parent_origin = 'override'
                 WHERE id = ${kind.id}::bigint RETURNING revision::int AS revision
            `;
            affected.push({ kind: GEBIET_ART, id: kind.public_id, revision: neu!.revision });
            entries.push({
                action: "territory.updated",
                territoryId: kind.public_id,
                revisionBefore: kind.revision,
                revisionAfter: neu!.revision,
                changes: {
                    parent: {
                        before: territoryId,
                        after: children === "up" ? gebiet.parent_public_id : null,
                    },
                    parentOrigin: { before: kind.parent_origin, after: "override" },
                },
            });
        }
    return kinder;
}

/** `territory.retire` für mehrere (Mehrfachauswahl, T57): EINE Operation, Obergebiete vor ihren Untergebieten. */
export async function retireTerritories(
    database: Database,
    actor: MapActor,
    body: TerritorySammelRetireBody,
): Promise<OperationReceipt> {
    const ids = body.territories.map((g) => g.id);
    if (new Set(ids).size !== ids.length)
        throw ungueltig("Ein Gebiet steht zweimal in der Änderung.", { field: "territories" });
    const vorab = await leseGebiet(database, ids[0]!);
    if (vorab === undefined || !vorab.is_active)
        throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");

    return mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "territory.retire", mapDomainId: vorab.map_domain_id, body },
        async (tx) => {
            // Erst alle gegen ihre Revision, bevor eines sich ändert (ein Umhängen zählt die Revision eines gewählten Untergebiets).
            for (const { id, baseRevision } of body.territories) {
                const gebiet = await leseGebiet(tx, id, true);
                if (gebiet === undefined || !gebiet.is_active)
                    throw ungueltig("Ein Gebiet der Änderung ist nicht mehr da.", { territoryId: id });
                if (gebiet.map_domain_id !== vorab.map_domain_id)
                    throw ungueltig("Ein Gebiet der Änderung liegt auf einer anderen Karte.", { territoryId: id });
                if (gebiet.revision !== baseRevision)
                    throw await mapEditConflict(
                        tx,
                        { kind: "territory", publicId: id },
                        { revision: gebiet.revision, changedAt: gebiet.updated_at },
                    );
            }
            const tiefe = new Map(
                (
                    await tx<{ id: string; tiefe: number }[]>`
                        WITH RECURSIVE kette AS (
                            SELECT t.public_id AS start, t.parent_id, 0 AS tiefe FROM territory t WHERE t.public_id = ANY(${ids}::uuid[])
                            UNION ALL
                            SELECT k.start, p.parent_id, k.tiefe + 1 FROM kette k JOIN territory p ON p.id = k.parent_id WHERE k.tiefe < 64
                        )
                        SELECT start::text AS id, max(tiefe)::int AS tiefe FROM kette GROUP BY start
                    `
                ).map((z) => [z.id, z.tiefe]),
            );
            const folge = [...ids].sort((a, b) => (tiefe.get(a) ?? 0) - (tiefe.get(b) ?? 0));
            const affected: OperationReceipt["affected"] = [];
            const entries: MapAuditEntry[] = [];
            const namen: string[] = [];
            for (const id of folge) {
                const gebiet = (await leseGebiet(tx, id, true))!;
                if (body.stage === "off_map") {
                    if ((await nimmVonDerKarte(tx, actor, gebiet, affected, entries)) > 0) namen.push(gebiet.name);
                } else {
                    await loesche(tx, actor, gebiet, "up", affected, entries);
                    namen.push(gebiet.name);
                }
            }
            if (namen.length === 0)
                throw ungueltig("Keines der gewählten Gebiete hat eine eigene Fläche auf der Karte.", {
                    field: "stage",
                });
            // Ein Untergebiet, das umgehängt und danach selbst gelöscht wurde, steht einmal in der Quittung, mit seiner letzten Revision.
            const quittung = new Map(affected.map((objekt) => [`${objekt.kind}:${objekt.id}`, objekt]));
            return {
                receipt: { affected: [...quittung.values()], derivedWork: [], warnings: [] },
                summary:
                    body.stage === "off_map"
                        ? `Von der Karte genommen: ${namenSatz(namen)}`
                        : `Gelöscht: ${namenSatz(namen)}, Untergebiete eine Ebene hoch`,
                entries,
            };
        },
    );
}

export interface ProtokollZeile {
    action: string;
    territory: string | null;
    area: string | null;
    revision_after: number | null;
    changes: Record<string, { before?: unknown; after?: unknown }>;
}

/** Die Operationen, die `territory.restore` umkehrt (Entfernen, „Unter neues Obergebiet …“, „Flächen vereinigen ›“). */
export const ENTFERNEN_OPERATIONEN: ReadonlySet<string> = new Set([
    "territory.retire",
    "territory.create_parent",
    "territory.merge",
]);

/** Das Protokoll einer Operation, die `territory.restore` umkehrt: ihre Aktion, ihre Karte und ihre Zeilen in der Folge des Schreibens. */
export async function leseEntfernenProtokoll(
    database: Queryable,
    operationId: string,
): Promise<{ op: { action: string; map_domain_id: string } | undefined; zeilen: ProtokollZeile[] }> {
    const [op] = await database<{ action: string; map_domain_id: string }[]>`
        SELECT o.action, o.map_domain_id FROM map_operation o WHERE o.operation_id = ${operationId}::uuid
    `;
    const zeilen = await database<ProtokollZeile[]>`
        SELECT e.action, e.territory_public_id::text AS territory, e.territory_area_public_id::text AS area,
               e.revision_after::int AS revision_after, e.changes
          FROM map_audit_event e WHERE e.operation_id = ${operationId}::uuid ORDER BY e.id
    `;
    return { op, zeilen };
}

/**
 * Kehrt Entfernen, „Unter neues Obergebiet …“ oder „Flächen vereinigen ›“ in einer laufenden Transaktion um (geteilt von `territory.restore` und der Rücknahme einer Serie,
 * `ruecknahme-gebiet.ts`, WI-0265 B6b): jede Zeile des Protokolls, wenn sie noch so steht, wie die Operation sie hinterließ, sonst 409 `edit_conflict`. `op` ist die Operation,
 * die zurückgenommen wird. Seit WI-0265 B8b kehrt sie auch ein Zurückholen um (`territory.restore`, `territory.restore_series`): Die Zeilen eines Zurückholens (`territory.restored`,
 * `territory_area.restored`, die Form der Vorlage) sind dieselben Wechsel in die Gegenrichtung, die Rücknahme also das Entfernen noch einmal.
 */
export async function kehreEntfernenUm(
    tx: Sql,
    actor: MapActor,
    territoryId: string,
    op: { action: string },
    zeilen: readonly ProtokollZeile[],
): Promise<Awaited<ReturnType<Parameters<typeof mapOperation>[3]>>> {
    const gebiete = [...new Set(zeilen.map((z) => z.territory).filter((x): x is string => x !== null))];
    await pruefeFremdeGebietssperre(tx, actor, gebiete);
    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    const konflikt = (): ApiError =>
        new ApiError(
            409,
            "edit_conflict",
            "Seitdem hat sich etwas geändert; das Entfernen lässt sich nicht mehr zurücknehmen.",
        );
    let name = "";
    for (const z of zeilen) {
        if ((z.action === "territory_area.merged" || z.action === "territory_area.reshaped") && z.area !== null) {
            // „Flächen vereinigen ›“ (und die Form, die ein Zurückholen der Vorlage hinterließ): die Form vorher, wenn seither niemand die Fläche geformt hat.
            const vorher = z.changes["geometry"]?.before;
            if (vorher === undefined) throw konflikt();
            const polygone = (vorher as number[][][][]).map((p) =>
                p.map((ring) => ring.map(([x, y]) => [x!, y!] as Punkt)),
            );
            const [neu] = await tx<{ vorher: number; nachher: number; jetzt: string }[]>`
                    WITH alt AS (
                        SELECT id, revision, ST_AsGeoJSON(geom, 15) AS jetzt FROM territory_area
                         WHERE public_id = ${z.area}::uuid AND is_active AND revision = ${z.revision_after} FOR NO KEY UPDATE
                    )
                    UPDATE territory_area a SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(polygone)}), 0))
                      FROM alt WHERE a.id = alt.id
                    RETURNING alt.revision::int AS vorher, a.revision::int AS nachher, alt.jetzt
                `;
            if (neu === undefined) throw konflikt();
            affected.push({ kind: GEBIETSFLAECHE_ART, id: z.area, revision: neu.nachher });
            entries.push({
                action: "territory_area.reshaped",
                territoryId: z.territory ?? territoryId,
                territoryAreaId: z.area,
                revisionBefore: neu.vorher,
                revisionAfter: neu.nachher,
                changes: { geometry: { before: ringe(polygoneVon(neu.jetzt)), after: vorher } },
            });
        } else if (z.action === "territory_area.retired" && z.area !== null) {
            const [neu] = await tx<{ vorher: number; nachher: number }[]>`
                    WITH alt AS (SELECT id, revision FROM territory_area WHERE public_id = ${z.area}::uuid AND NOT is_active FOR NO KEY UPDATE)
                    UPDATE territory_area a SET is_active = TRUE FROM alt WHERE a.id = alt.id
                    RETURNING alt.revision::int AS vorher, a.revision::int AS nachher
                `;
            if (neu === undefined) throw konflikt();
            affected.push({ kind: GEBIETSFLAECHE_ART, id: z.area, revision: neu.nachher });
            entries.push({
                action: "territory_area.restored",
                territoryId: z.territory ?? territoryId,
                territoryAreaId: z.area,
                revisionBefore: neu.vorher,
                revisionAfter: neu.nachher,
                changes: { active: { before: false, after: true } },
            });
        } else if (z.action === "territory_area.restored" && z.area !== null) {
            // Die Rücknahme eines Zurückholens (WI-0265 B8b): die Fläche geht wieder still, wenn sie noch so steht, wie das Zurückholen sie hinterließ.
            const [neu] = await tx<{ vorher: number; nachher: number }[]>`
                    WITH alt AS (SELECT id, revision FROM territory_area WHERE public_id = ${z.area}::uuid AND is_active FOR NO KEY UPDATE)
                    UPDATE territory_area a SET is_active = FALSE FROM alt WHERE a.id = alt.id
                    RETURNING alt.revision::int AS vorher, a.revision::int AS nachher
                `;
            if (neu === undefined) throw konflikt();
            affected.push({ kind: GEBIETSFLAECHE_ART, id: z.area, revision: neu.nachher });
            entries.push({
                action: "territory_area.retired",
                territoryId: z.territory ?? territoryId,
                territoryAreaId: z.area,
                revisionBefore: neu.vorher,
                revisionAfter: neu.nachher,
                changes: { active: { before: true, after: false } },
            });
        } else if (z.action === "territory.retired" && z.territory !== null) {
            const [neu] = await tx<{ vorher: number; nachher: number; name: string }[]>`
                    WITH alt AS (SELECT id, revision FROM territory WHERE public_id = ${z.territory}::uuid AND NOT is_active FOR NO KEY UPDATE)
                    UPDATE territory t SET is_active = TRUE FROM alt WHERE t.id = alt.id
                    RETURNING alt.revision::int AS vorher, t.revision::int AS nachher, t.name
                `;
            if (neu === undefined) throw konflikt();
            if (z.territory === territoryId) name = neu.name;
            affected.push({ kind: GEBIET_ART, id: z.territory, revision: neu.nachher });
            entries.push({
                action: "territory.restored",
                territoryId: z.territory,
                revisionBefore: neu.vorher,
                revisionAfter: neu.nachher,
                changes: { active: { before: false, after: true } },
            });
        }
    }
    // Die Untergebiete zurück unter das Gebiet, erst nachdem es wieder aktiv ist (der Kreis-Trigger sieht den Baum).
    for (const z of zeilen) {
        if (z.action !== "territory.updated" || z.territory === null) continue;
        const parent = z.changes["parent"];
        const herkunft = z.changes["parentOrigin"];
        if (parent === undefined) continue;
        const jetzt = await leseGebiet(tx, z.territory, true);
        if (jetzt === undefined || !jetzt.is_active || (jetzt.parent_public_id ?? null) !== (parent.after ?? null))
            throw konflikt();
        const vorherOrigin = typeof herkunft?.before === "string" ? herkunft.before : null;
        const [neu] = await tx<{ revision: number }[]>`
                UPDATE territory
                   SET parent_id = (SELECT id FROM territory WHERE public_id = ${(parent.before as string | null) ?? null}::uuid),
                       parent_origin = ${vorherOrigin}
                 WHERE id = ${jetzt.id}::bigint RETURNING revision::int AS revision
            `;
        affected.push({ kind: GEBIET_ART, id: z.territory, revision: neu!.revision });
        entries.push({
            action: "territory.updated",
            territoryId: z.territory,
            revisionBefore: jetzt.revision,
            revisionAfter: neu!.revision,
            changes: {
                parent: { before: parent.after ?? null, after: parent.before ?? null },
                parentOrigin: { before: jetzt.parent_origin, after: vorherOrigin },
            },
        });
    }
    // „Unter neues Obergebiet …“ (T57): Das neue Gebiet geht still, wenn es nichts mehr trägt (die gewählten hängen schon zurück).
    for (const z of zeilen) {
        if (z.action !== "territory.created" || z.territory === null) continue;
        const [neu] = await tx<{ vorher: number; nachher: number; name: string }[]>`
                WITH alt AS (
                    SELECT t.id, t.revision FROM territory t
                     WHERE t.public_id = ${z.territory}::uuid AND t.is_active
                       AND NOT EXISTS (SELECT 1 FROM territory c WHERE c.parent_id = t.id AND c.is_active)
                       AND NOT EXISTS (SELECT 1 FROM territory_area a WHERE a.territory_id = t.id AND a.is_active)
                     FOR NO KEY UPDATE OF t
                )
                UPDATE territory t SET is_active = FALSE FROM alt WHERE t.id = alt.id
                RETURNING alt.revision::int AS vorher, t.revision::int AS nachher, t.name
            `;
        if (neu === undefined) throw konflikt();
        name = neu.name;
        affected.push({ kind: GEBIET_ART, id: z.territory, revision: neu.nachher });
        entries.push({
            action: "territory.retired",
            territoryId: z.territory,
            revisionBefore: neu.vorher,
            revisionAfter: neu.nachher,
            changes: { active: { before: true, after: false } },
        });
    }
    // Die Rücknahme eines Zurückholens (WI-0265 B8b): Das Gebiet geht wieder still, nachdem seine Untergebiete wieder dort hängen, wohin das Entfernen sie hängte. Hängt jetzt noch ein aktives
    // Untergebiet oder eine aktive Fläche daran, die das Zurückholen nicht kannte, bleibt es stehen (409): Es verlöre sie.
    for (const z of zeilen) {
        if (z.action !== "territory.restored" || z.territory === null) continue;
        const [neu] = await tx<{ vorher: number; nachher: number; name: string }[]>`
                WITH alt AS (
                    SELECT t.id, t.revision FROM territory t
                     WHERE t.public_id = ${z.territory}::uuid AND t.is_active
                       AND NOT EXISTS (SELECT 1 FROM territory c WHERE c.parent_id = t.id AND c.is_active)
                     FOR NO KEY UPDATE OF t
                )
                UPDATE territory t SET is_active = FALSE FROM alt WHERE t.id = alt.id
                RETURNING alt.revision::int AS vorher, t.revision::int AS nachher, t.name
            `;
        if (neu === undefined) throw konflikt();
        if (z.territory === territoryId) name = neu.name;
        affected.push({ kind: GEBIET_ART, id: z.territory, revision: neu.nachher });
        entries.push({
            action: "territory.retired",
            territoryId: z.territory,
            revisionBefore: neu.vorher,
            revisionAfter: neu.nachher,
            changes: { active: { before: true, after: false } },
        });
    }
    if (entries.length === 0) throw konflikt();
    if (name === "") name = (await leseGebiet(tx, territoryId))?.name ?? "";
    return {
        receipt: { affected, derivedWork: [], warnings: [] },
        summary:
            op.action === "territory.create_parent"
                ? `${name}: neues Obergebiet zurückgenommen`
                : op.action === "territory.merge"
                  ? `${name}: Vereinigen zurückgenommen`
                  : op.action === "territory.restore" || op.action === "territory.restore_series"
                    ? `${name}: Zurückholen zurückgenommen`
                    : `${name}: Entfernen zurückgenommen`,
        entries,
    };
}

/** ↺ für „Entfernen“ (`territory.restore`): kehrt die Operation `reverts` um, wenn alles noch so steht. */
export async function restoreTerritory(
    database: Database,
    actor: MapActor,
    territoryId: string,
    body: TerritoryRestoreBody,
): Promise<OperationReceipt> {
    const { op, zeilen } = await leseEntfernenProtokoll(database, body.reverts);
    const umkehrbar = op !== undefined && ENTFERNEN_OPERATIONEN.has(op.action);
    if (!umkehrbar || !zeilen.some((z) => z.territory === territoryId))
        throw ungueltig("Diese Operation lässt sich hier nicht zurücknehmen.", { field: "reverts" });

    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "territory.restore",
            mapDomainId: op.map_domain_id,
            body: { territoryId, ...body },
            source: "restore",
        },
        (tx) => kehreEntfernenUm(tx, actor, territoryId, op, zeilen),
    );
}
