import { randomUUID } from "node:crypto";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    TERRITORY_TARGETS_MAX,
    territoryDefaultZoomRange,
    type EditorTerritoryTargets,
    type OperationReceipt,
    type TerritoryAreaCreateBody,
    type TerritoryAreaCreateReceipt,
    type TerritoryCreateBody,
    type TerritoryCreateReceipt,
    type TerritoryObergebietBody,
    type TerritoryObergebietReceipt,
    type TerritoryTargetsQuery,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { GEBIET_ART, GEBIETSFLAECHE_ART, mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import { bereinige, geojsonAus, ringe, type Punkt } from "./ring-form.ts";
import { readEditorTerritoryForm } from "./territory-form.ts";
import { pruefeFremdeGebietssperre } from "./territory-reshape.ts";
import { pruefeObergebiet } from "./territory-update.ts";

/**
 * „Neue Fläche“ für Herrschaftsgebiete (WI-0209 C3; Vertrag und Regeln im Kopf von `TerritoryCreateBody` in
 * `packages/shared/src/territory-editor.ts`): `territory.create` (neues Gebiet oder Untergebiet samt erster Fläche), `territory_area.create`
 * („Grenze zeichnen“ an einem Gebiet ohne eigene Fläche) und die Ziele im Kasten. Muster `path-create.ts`.
 *
 * - **Eine Operation** je Anlage, in EINER Transaktion mit dem Fachprotokoll (`territory.created`, `territory_area.created`); danach reiht
 *   die Schreibnaht `territory_derive` ein (B3). Eigene Zeilen tragen `source_system = 'avesmaps3d'` und keine Legacy-Kennung (0145);
 *   die Testwelt legt sie still (B4).
 * - **Der Name** wie Legacy (`avesmapsPoliticalUniqueName`, `api/_internal/political/territories-support.php`, Mirror a7f2dac8): der
 *   erste freie unter „Neues Herrschaftsgebiet“, „… (2)“, „… (3)“ …, über alle Gebiete der Karte, auch die gelöschten. Zwei gleichzeitige
 *   Anlagen warten aufeinander (Advisory-Lock), sonst trügen beide denselben Namen.
 * - **Zoomspanne** am Server aus der Kette (`territoryDefaultZoomRange`, Stufe = Zahl der Obergebiete, das neue ist das tiefste), damit sie
 *   nicht vom Stand eines Browsers abhängt; **Deckkraft** die des Obergebiets, ohne Legacys 0,33 (`createRegionAt`,
 *   `js/map-features/map-features-region-crud.js`). Die Farbe rechnet der Editor (D4).
 * - **„Unter neues Obergebiet …“** (`territory.create_parent`, Mehrfachauswahl EDIT-0003 T57): ein Gebiet ohne Fläche und das Umhängen der
 *   gewählten darunter in EINER Operation; die Spanne kommt hier aus dem Editor (sein Vorschlag liegt vor den gewählten).
 */

/** Legacys Name beim Anlegen (Befund „Platzhalter“, D6, `territory-findings.ts`). */
export const NEUES_GEBIET = "Neues Herrschaftsgebiet";
/** Legacys Deckkraft eines neuen Gebiets ohne Obergebiet (`createRegionAt`). */
const DECKKRAFT_OHNE_OBERGEBIET = 0.33;
const OFFEN = AVENTURIA_POLITICAL_CARTOGRAPHY.openEndBf;

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

/** Der Ring als ein Polygon ohne Schlusspunkt und ohne gleiche Ecken hintereinander; mindestens drei Ecken. */
function ringAus(ring: readonly (readonly [number, number])[]): Punkt[][][] {
    const polygone = bereinige([[ring.map(([x, y]) => [x, y] as const)]]);
    if (polygone[0]![0]!.length < 3) throw ungueltig("Eine Fläche braucht mindestens drei Ecken.", { field: "ring" });
    return polygone;
}

async function inDerKarte(tx: Queryable, mapDomainId: string, polygone: Punkt[][][]): Promise<void> {
    const alle = polygone.flat(2);
    const [lage] = await tx<{ inside: boolean | null }[]>`
        SELECT bool_and(map_domain_contains(${mapDomainId}, ST_SetSRID(ST_MakePoint(t.x, t.y), 0))) AS inside
          FROM unnest(${alle.map((p) => p[0])}::float8[], ${alle.map((p) => p[1])}::float8[]) AS t(x, y)
    `;
    if (lage?.inside !== true) throw ungueltig("Eine Ecke liegt außerhalb der Karte.", { field: "ring" });
}

/** Legt die Fläche an und gibt ihre Revision zurück. */
async function legeFlaecheAn(
    tx: Sql,
    areaId: string,
    territoryRowId: string,
    mapDomainId: string,
    polygone: Punkt[][][],
): Promise<number> {
    const [zeile] = await tx<{ revision: number }[]>`
        INSERT INTO territory_area (public_id, territory_id, map_domain_id, geom, source_system, is_active)
        VALUES (${areaId}::uuid, ${territoryRowId}::bigint, ${mapDomainId},
                ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(polygone)}), 0)), 'avesmaps3d', TRUE)
        RETURNING revision::int AS revision
    `;
    return zeile!.revision;
}

interface Obergebiet {
    id: string;
    public_id: string;
    name: string;
    opacity: string;
    map_domain_id: string;
    /** Wie viele Obergebiete es selbst hat (die Wurzel 0). */
    tiefe: number;
}

async function leseObergebiet(sql: Queryable, publicId: string): Promise<Obergebiet | undefined> {
    const [zeile] = await sql<Obergebiet[]>`
        WITH RECURSIVE kette(id, parent_id, tiefe, pfad) AS (
            SELECT t.id, t.parent_id, 0, ARRAY[t.id] FROM territory t WHERE t.public_id = ${publicId}::uuid AND t.is_active
            UNION ALL
            SELECT p.id, p.parent_id, k.tiefe + 1, k.pfad || p.id
              FROM kette k JOIN territory p ON p.id = k.parent_id AND p.is_active
             WHERE NOT p.id = ANY(k.pfad)
        )
        SELECT t.id::text AS id, t.public_id::text AS public_id, t.name, t.opacity::text AS opacity, t.map_domain_id,
               (SELECT max(tiefe) FROM kette)::int AS tiefe
          FROM territory t WHERE t.public_id = ${publicId}::uuid AND t.is_active
    `;
    return zeile;
}

/** Der erste freie Name wie Legacy: „Neues Herrschaftsgebiet“, sonst „… (2)“, „… (3)“ … */
async function freierName(tx: Sql, mapDomainId: string): Promise<string> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`territory.create:${mapDomainId}`}))`;
    const vergeben = new Set(
        (
            await tx<{ name: string }[]>`
                SELECT name FROM territory
                 WHERE map_domain_id = ${mapDomainId} AND (name = ${NEUES_GEBIET} OR name LIKE ${`${NEUES_GEBIET} (%)`})
            `
        ).map((zeile) => zeile.name),
    );
    if (!vergeben.has(NEUES_GEBIET)) return NEUES_GEBIET;
    for (let n = 2; ; n += 1) {
        const name = `${NEUES_GEBIET} (${String(n)})`;
        if (!vergeben.has(name)) return name;
    }
}

/** `territory.create` (C3): ein neues Gebiet unter `parent` (oder als Wurzel) samt seiner ersten Fläche, EINE Operation. */
export async function createTerritory(
    database: Database,
    actor: MapActor,
    body: TerritoryCreateBody,
): Promise<TerritoryCreateReceipt> {
    const polygone = ringAus(body.ring);
    const ober = body.parent === undefined ? undefined : await leseObergebiet(database, body.parent);
    if (body.parent !== undefined && ober === undefined)
        throw ungueltig("Dieses Obergebiet gibt es nicht.", { field: "parent" });
    const mapDomainId = ober?.map_domain_id ?? AVENTURIA_POLITICAL_CARTOGRAPHY.mapDomain;
    const stufe = ober === undefined ? 0 : ober.tiefe + 1;
    const zoom = territoryDefaultZoomRange(stufe + 1, stufe);
    const publicId = randomUUID();
    const areaId = randomUUID();
    let name = "";
    const receipt: OperationReceipt = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "territory.create", mapDomainId, body },
        async (tx) => {
            await inDerKarte(tx, mapDomainId, polygone);
            // In der Transaktion noch einmal: Das Obergebiet kann inzwischen still sein.
            if (body.parent !== undefined) await pruefeObergebiet(tx, publicId, mapDomainId, body.parent);
            name = await freierName(tx, mapDomainId);
            const [gebiet] = await tx<{ id: string; revision: number }[]>`
                INSERT INTO territory (public_id, map_domain_id, parent_id, name, color, opacity, min_zoom, max_zoom,
                                       source_system, is_active)
                VALUES (${publicId}::uuid, ${mapDomainId},
                        (SELECT id FROM territory WHERE public_id = ${body.parent ?? null}::uuid),
                        ${name}, ${body.color}, ${ober === undefined ? DECKKRAFT_OHNE_OBERGEBIET : Number(ober.opacity)},
                        ${zoom.min}, ${zoom.max}, 'avesmaps3d', TRUE)
                RETURNING id::text AS id, revision::int AS revision
            `;
            const areaRevision = await legeFlaecheAn(tx, areaId, gebiet!.id, mapDomainId, polygone);
            return {
                receipt: {
                    affected: [
                        { kind: GEBIET_ART, id: publicId, revision: gebiet!.revision },
                        { kind: GEBIETSFLAECHE_ART, id: areaId, revision: areaRevision },
                    ],
                    derivedWork: [],
                    warnings: [],
                },
                summary:
                    ober === undefined
                        ? `${name}: neues Herrschaftsgebiet`
                        : `${name}: neues Herrschaftsgebiet unter ${ober.name}`,
                entries: [
                    {
                        action: "territory.created",
                        territoryId: publicId,
                        revisionBefore: null,
                        revisionAfter: gebiet!.revision,
                        changes: {
                            name: { after: name },
                            parent: { after: body.parent ?? null },
                            color: { after: body.color },
                            minZoom: { after: zoom.min },
                            maxZoom: { after: zoom.max },
                            active: { after: true },
                        },
                    },
                    {
                        action: "territory_area.created",
                        territoryId: publicId,
                        territoryAreaId: areaId,
                        revisionBefore: null,
                        revisionAfter: areaRevision,
                        changes: { geometry: { after: ringe(polygone) }, active: { after: true } },
                    },
                ],
            };
        },
    );
    return { ...receipt, ...(await angelegt(database, receipt, { publicId, areaId, name })) };
}

/** `territory.create_parent` (T57, A): ein Gebiet ohne Fläche unter `parent` und die gewählten darunter, EINE Operation. */
export async function createParentTerritory(
    database: Database,
    actor: MapActor,
    body: TerritoryObergebietBody,
): Promise<TerritoryObergebietReceipt> {
    const ids = body.territories.map((g) => g.id);
    if (new Set(ids).size !== ids.length)
        throw ungueltig("Ein Gebiet steht zweimal in der Änderung.", { field: "territories" });
    if (body.zoom.minZoom > body.zoom.maxZoom) throw ungueltig("„Zoom von“ liegt über „Zoom bis“.", { field: "zoom" });
    if (body.parent !== undefined && ids.includes(body.parent))
        throw ungueltig("Das neue Obergebiet kann nicht unter einem der gewählten hängen.", { field: "parent" });
    const ober = body.parent === undefined ? undefined : await leseObergebiet(database, body.parent);
    if (body.parent !== undefined && ober === undefined)
        throw ungueltig("Dieses Obergebiet gibt es nicht.", { field: "parent" });
    const mapDomainId = ober?.map_domain_id ?? AVENTURIA_POLITICAL_CARTOGRAPHY.mapDomain;
    // Nie unter einem Untergebiet eines gewählten: Das neue hinge sonst unter sich selbst.
    if (body.parent !== undefined) for (const id of ids) await pruefeObergebiet(database, id, mapDomainId, body.parent);
    const publicId = randomUUID();
    let name = "";
    const receipt = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "territory.create_parent", mapDomainId, body },
        async (tx) => {
            const gewaehlte: {
                id: string;
                public_id: string;
                name: string;
                revision: number;
                parent: string | null;
                parent_origin: string | null;
                map_domain_id: string;
                is_active: boolean;
                updated_at: Date;
            }[] = [];
            for (const { id, baseRevision } of body.territories) {
                const [zeile] = await tx<(typeof gewaehlte)[number][]>`
                    SELECT t.id::text AS id, t.public_id::text AS public_id, t.name, t.revision::int AS revision,
                           p.public_id::text AS parent, t.parent_origin, t.map_domain_id, t.is_active, t.updated_at
                      FROM territory t LEFT JOIN territory p ON p.id = t.parent_id
                     WHERE t.public_id = ${id}::uuid FOR NO KEY UPDATE OF t
                `;
                if (zeile === undefined || !zeile.is_active)
                    throw ungueltig("Ein Gebiet der Änderung ist nicht mehr da.", { territoryId: id });
                if (zeile.map_domain_id !== mapDomainId)
                    throw ungueltig("Ein Gebiet der Änderung liegt auf einer anderen Karte.", { territoryId: id });
                if (zeile.revision !== baseRevision)
                    throw await mapEditConflict(
                        tx,
                        { kind: "territory", publicId: id },
                        { revision: zeile.revision, changedAt: zeile.updated_at },
                    );
                gewaehlte.push(zeile);
            }
            await pruefeFremdeGebietssperre(tx, actor, ids);
            // In der Transaktion noch einmal: Das Obergebiet kann inzwischen still sein oder unter eines der gewählten gewandert.
            if (body.parent !== undefined) {
                await pruefeObergebiet(tx, publicId, mapDomainId, body.parent);
                for (const id of ids) await pruefeObergebiet(tx, id, mapDomainId, body.parent);
            }
            const gewuenscht = body.name?.trim() ?? "";
            name = gewuenscht === "" ? await freierName(tx, mapDomainId) : gewuenscht;
            const [gebiet] = await tx<{ id: string; revision: number }[]>`
                INSERT INTO territory (public_id, map_domain_id, parent_id, name, color, opacity, min_zoom, max_zoom,
                                       source_system, is_active)
                VALUES (${publicId}::uuid, ${mapDomainId},
                        (SELECT id FROM territory WHERE public_id = ${body.parent ?? null}::uuid),
                        ${name}, ${body.color}, ${ober === undefined ? DECKKRAFT_OHNE_OBERGEBIET : Number(ober.opacity)},
                        ${body.zoom.minZoom}, ${body.zoom.maxZoom}, 'avesmaps3d', TRUE)
                RETURNING id::text AS id, revision::int AS revision
            `;
            const affected: OperationReceipt["affected"] = [
                { kind: GEBIET_ART, id: publicId, revision: gebiet!.revision },
            ];
            const entries: MapAuditEntry[] = [
                {
                    action: "territory.created",
                    territoryId: publicId,
                    revisionBefore: null,
                    revisionAfter: gebiet!.revision,
                    changes: {
                        name: { after: name },
                        parent: { after: body.parent ?? null },
                        color: { after: body.color },
                        minZoom: { after: body.zoom.minZoom },
                        maxZoom: { after: body.zoom.maxZoom },
                        active: { after: true },
                    },
                },
            ];
            for (const kind of gewaehlte) {
                const [neu] = await tx<{ revision: number }[]>`
                    UPDATE territory SET parent_id = ${gebiet!.id}::bigint, parent_origin = 'override'
                     WHERE id = ${kind.id}::bigint RETURNING revision::int AS revision
                `;
                affected.push({ kind: GEBIET_ART, id: kind.public_id, revision: neu!.revision });
                entries.push({
                    action: "territory.updated",
                    territoryId: kind.public_id,
                    revisionBefore: kind.revision,
                    revisionAfter: neu!.revision,
                    changes: {
                        parent: { before: kind.parent, after: publicId },
                        parentOrigin: { before: kind.parent_origin, after: "override" },
                    },
                });
            }
            const namen = gewaehlte.map((g) => g.name);
            const liste =
                namen.length <= 3
                    ? namen.join(", ")
                    : `${namen.slice(0, 3).join(", ")} und ${String(namen.length - 3)} weitere`;
            return {
                receipt: { affected, derivedWork: [], warnings: [] },
                summary: `${name}: neues Obergebiet über ${liste}`,
                entries,
            };
        },
    );
    // Eine wiederholte Kennung bekommt die erste Quittung: Das neue Gebiet ist das erste darin.
    const neu = receipt.affected[0]?.id ?? publicId;
    const [vorhanden] = await database<{ name: string }[]>`SELECT name FROM territory WHERE public_id = ${neu}::uuid`;
    return { ...receipt, publicId: neu, name: neu === publicId && name !== "" ? name : (vorhanden?.name ?? name) };
}

/** Eine wiederholte Kennung bekommt die erste Quittung (`runOperation`): Gebiet und Fläche sind die aus ihr. */
async function angelegt(
    database: Queryable,
    receipt: OperationReceipt,
    gedacht: { publicId: string; areaId: string; name: string },
): Promise<{ publicId: string; areaId: string; name: string; minZoom?: number }> {
    const publicId = receipt.affected.find((x) => x.kind === GEBIET_ART)?.id ?? gedacht.publicId;
    const areaId = receipt.affected.find((x) => x.kind === GEBIETSFLAECHE_ART)?.id ?? gedacht.areaId;
    const [vorhanden] = await database<{ name: string; min_zoom: number | null }[]>`
        SELECT name, min_zoom FROM territory WHERE public_id = ${publicId}::uuid
    `;
    const name =
        publicId === gedacht.publicId && gedacht.name !== "" ? gedacht.name : (vorhanden?.name ?? gedacht.name);
    return { publicId, areaId, name, ...(vorhanden?.min_zoom == null ? {} : { minZoom: vorhanden.min_zoom }) };
}

/** `territory_area.create` (C3, „Grenze zeichnen“): eine Fläche an einem Gebiet ohne eigene Fläche im Anzeigejahr. */
export async function createTerritoryArea(
    database: Database,
    actor: MapActor,
    territoryId: string,
    body: TerritoryAreaCreateBody,
): Promise<TerritoryAreaCreateReceipt> {
    const polygone = ringAus(body.ring);
    const form = await readEditorTerritoryForm(database, territoryId);
    if (form === undefined) throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
    if (form.areas.length > 0)
        throw ungueltig("Dieses Gebiet hat schon eine eigene Fläche; „Grenzen bearbeiten“ ändert sie.", {
            field: "ring",
        });
    const [gebiet] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM territory WHERE public_id = ${territoryId}::uuid
    `;
    const mapDomainId = gebiet!.map_domain_id;
    const areaId = randomUUID();
    const receipt = await mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "territory_area.create",
            mapDomainId,
            body: { territoryId, ...body },
        },
        async (tx) => {
            await pruefeFremdeGebietssperre(tx, actor, [territoryId]);
            await inDerKarte(tx, mapDomainId, polygone);
            // Gegen die Revision des Gebiets; gezählt wird sie nicht, denn eine reine Formänderung zählt das Gebiet nicht (T44 (4)).
            // Die Zeile bleibt gesperrt: Eine zweite Anlage am selben Gebiet wartet und sieht dann die erste Fläche.
            const [jetzt] = await tx<{ id: string; revision: number; updated_at: Date; is_active: boolean }[]>`
                SELECT id::text AS id, revision::int AS revision, updated_at, is_active
                  FROM territory WHERE public_id = ${territoryId}::uuid FOR NO KEY UPDATE
            `;
            if (jetzt === undefined || !jetzt.is_active)
                throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
            if (jetzt.revision !== body.baseRevision)
                throw await mapEditConflict(
                    tx,
                    { kind: "territory", publicId: territoryId },
                    { revision: jetzt.revision, changedAt: jetzt.updated_at },
                );
            if (((await readEditorTerritoryForm(tx, territoryId))?.areas.length ?? 0) > 0)
                throw ungueltig("Dieses Gebiet hat schon eine eigene Fläche; „Grenzen bearbeiten“ ändert sie.", {
                    field: "ring",
                });
            const areaRevision = await legeFlaecheAn(tx, areaId, jetzt.id, mapDomainId, polygone);
            return {
                receipt: {
                    affected: [
                        { kind: GEBIET_ART, id: territoryId, revision: jetzt.revision },
                        { kind: GEBIETSFLAECHE_ART, id: areaId, revision: areaRevision },
                    ],
                    derivedWork: [],
                    warnings: [],
                },
                summary: `${form.name}: Grenze gezeichnet`,
                entries: [
                    {
                        action: "territory_area.created",
                        territoryId,
                        territoryAreaId: areaId,
                        revisionBefore: null,
                        revisionAfter: areaRevision,
                        changes: { geometry: { after: ringe(polygone) }, active: { after: true } },
                    },
                ],
            };
        },
    );
    const [name] = await database<
        { name: string; min_zoom: number | null }[]
    >`SELECT name, min_zoom FROM territory WHERE public_id = ${territoryId}::uuid`;
    return {
        ...receipt,
        publicId: territoryId,
        name: name?.name ?? form.name,
        areaId: receipt.affected.find((x) => x.kind === GEBIETSFLAECHE_ART)?.id ?? areaId,
        ...(name?.min_zoom == null ? {} : { minZoom: name.min_zoom }),
    };
}

/** Die Ziele im Kasten (C3): Ecken und Kanten der Gebietsflächen, die im Anzeigejahr gelten; je höchstens `TERRITORY_TARGETS_MAX`. */
export async function readTerritoryTargets(
    database: Queryable,
    kasten: TerritoryTargetsQuery,
    mapDomainId = AVENTURIA_POLITICAL_CARTOGRAPHY.mapDomain,
    yearBf: number = AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf,
): Promise<EditorTerritoryTargets> {
    const [x0, x1] = [Math.min(kasten.x0, kasten.x1), Math.max(kasten.x0, kasten.x1)];
    const [y0, y1] = [Math.min(kasten.y0, kasten.y1), Math.max(kasten.y0, kasten.y1)];
    // Die Flächen im Kasten, die im Anzeigejahr gelten (wie `territory-form.ts`); dieselbe Bedingung in beiden Abfragen.
    const corners = await database<{ area_id: string; name: string; x: number; y: number }[]>`
        WITH f AS (
            SELECT a.public_id, a.geom, o.name
              FROM territory_area a
              JOIN territory o ON o.id = a.territory_id AND o.is_active
             WHERE a.is_active AND a.map_domain_id = ${mapDomainId}
               AND (coalesce(a.valid_from_bf, o.valid_from_bf) IS NULL OR coalesce(a.valid_from_bf, o.valid_from_bf) <= ${yearBf})
               AND (a.valid_to_bf IS NULL OR a.valid_to_bf = ${OFFEN} OR a.valid_to_bf >= ${yearBf})
               AND a.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
        )
        SELECT DISTINCT ON (ST_X(d.geom), ST_Y(d.geom)) f.public_id::text AS area_id, f.name, ST_X(d.geom) AS x, ST_Y(d.geom) AS y
          FROM f CROSS JOIN LATERAL ST_DumpPoints(f.geom) d
         WHERE d.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
         ORDER BY ST_X(d.geom), ST_Y(d.geom), f.public_id
         LIMIT ${TERRITORY_TARGETS_MAX + 1}
    `;
    const edges = await database<{ area_id: string; name: string; ax: number; ay: number; bx: number; by: number }[]>`
        WITH f AS (
            SELECT a.public_id, a.geom, o.name
              FROM territory_area a
              JOIN territory o ON o.id = a.territory_id AND o.is_active
             WHERE a.is_active AND a.map_domain_id = ${mapDomainId}
               AND (coalesce(a.valid_from_bf, o.valid_from_bf) IS NULL OR coalesce(a.valid_from_bf, o.valid_from_bf) <= ${yearBf})
               AND (a.valid_to_bf IS NULL OR a.valid_to_bf = ${OFFEN} OR a.valid_to_bf >= ${yearBf})
               AND a.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
        )
        SELECT f.public_id::text AS area_id, f.name,
               ST_X(ST_StartPoint(s.geom)) AS ax, ST_Y(ST_StartPoint(s.geom)) AS ay,
               ST_X(ST_EndPoint(s.geom)) AS bx, ST_Y(ST_EndPoint(s.geom)) AS by
          FROM f CROSS JOIN LATERAL ST_DumpSegments(ST_Boundary(f.geom)) s
         WHERE s.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
         ORDER BY f.public_id, s.path
         LIMIT ${TERRITORY_TARGETS_MAX + 1}
    `;
    return {
        corners: corners
            .slice(0, TERRITORY_TARGETS_MAX)
            .map((c) => ({ areaId: c.area_id, name: c.name, x: c.x, y: c.y })),
        edges: edges
            .slice(0, TERRITORY_TARGETS_MAX)
            .map((e) => ({ areaId: e.area_id, name: e.name, a: [e.ax, e.ay], b: [e.bx, e.by] })),
        truncated: corners.length > TERRITORY_TARGETS_MAX || edges.length > TERRITORY_TARGETS_MAX,
    };
}
