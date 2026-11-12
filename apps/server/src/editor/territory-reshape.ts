import type { EditorLock, OperationReceipt, TerritoryReshapeArea } from "@avesmaps3d/shared";
import { EDITOR_LOCK_ERROR_STATUS } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { listEditorLocks } from "./editor-lock.ts";
import { GEBIET_ART, GEBIETSFLAECHE_ART, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import {
    abweichung,
    bereinige,
    formFehlerArt,
    geojsonAus,
    gleich,
    mitGemeinsamenEcken,
    mitgezogen,
    polygoneVon,
    ringe,
    schluessel,
    zuKurzerRing,
    type Punkt,
} from "./ring-form.ts";

/**
 * Die Form eines Gebiets schreiben (WI-0209 C2, B2; EDIT-0005 §6, §7 C1/C2): die Griffe, mit denen `territory.update`
 * (`territory-update.ts`) alle Flächen schreibt, die der Entwurf geändert hat, wie `landscape.update` mit `formeUmIn`
 * (`landscape-reshape.ts`); die Rechnung an Ringen ist dieselbe (`ring-form.ts`). Einen eigenen Schreibweg der Form
 * (`POST …/reshape`, `territory_area.reshape`) gibt es seit B2 Teil 2 nicht mehr: „Fertig“ schreibt Felder und Form in EINER Operation.
 *
 * - **Eigene Flächen** (die des bearbeiteten Gebiets) bekommen ihre neue Form, je gegen ihre Revision; den Zähler setzt der Trigger
 *   (Migration 0145).
 * - **Nachbarn** (Flächen anderer Gebiete): Nur gemeinsame Ecken ziehen mit. An ihnen darf sich nur bewegen, was genau auf einer alten
 *   Ecke dieses Gebiets lag und auf eine seiner neuen Ecken geht. So zeichnet diese Route keine fremde Fläche um. Kommt eine Ecke dazu oder fällt
 *   eine weg (`mitGemeinsamenEcken`), steht die Nachbarin mit ihrer ganzen Form im Protokoll (`reshaped`), damit ↺ sie zurückholt.
 * - **Nur die Nachbarin im Körper** (OPS-000079): Ist die eigene Fläche am Ende wie zu Beginn, fehlt sie im Körper; das war 404. Die Ecken des Gebiets kommen darum aus
 *   allen seinen Flächen, nicht nur aus denen im Körper.
 * - **`details.reason`** ist das feste Kürzel der Regel; `error-handler.ts` schreibt es ins Log. `ring_unter_drei` und `nachbar_umgezeichnet`
 *   tragen dazu `stelle` und `gebiet` (welches, eigenes oder Nachbar) für die Marke im Editor (Vali 2026-11-10, wie `landscape-reshape.ts`).
 *   Der Editor prüft jeden Schritt schon mit derselben Rechnung (`@avesmaps3d/shared`, `flaechen-ringe.ts`).
 * - **Gültig** (Vali 2026-11-10, „Ja, alle drei“ auf die Frage der Koordination; wie `landscape-reshape.ts`): Ein Gebiet, das sich selbst
 *   kreuzt oder an sich selbst stößt, ist 400 `form_ungueltig` mit `art`, `stelle` (`ST_IsValidDetail`) und `gebiet`, wenn die Fläche vorher
 *   gültig war. Eine schon vorher ungültige aus Legacy bleibt speicherbar. Der Editor nimmt einen solchen Schritt gar nicht erst an
 *   (`flaechen-gueltig.ts`, `form-regel.ts`); vor 2026-11-10 prüfte der Server die Form eines Gebiets nicht.
 * - **Ein Konflikt nimmt alles zurück** (409 `edit_conflict`, eine Transaktion). Hält ein anderer eines der Gebiete (EDIT-0003 §4),
 *   409 `object_locked`; der Entwurf bleibt im Browser. Läuft der Zug, 503 (`mapOperation`, `EDITOR_TABELLEN` mit `territory_area`).
 * - **Danach** reiht die Schreibnaht den Auftrag `territory_derive` ein (B3, zwei Minuten Sammelzeit) und meldet `map.changed`; die
 *   alte Ableitung bleibt sichtbar, bis die neue fertig ist. Der Editor leitet nie selbst ab.
 */

interface FlaechenZeile {
    id: string;
    public_id: string;
    territory_public_id: string;
    territory_name: string;
    territory_revision: number;
    map_domain_id: string;
    revision: number;
    is_active: boolean;
    territory_active: boolean;
    updated_at: Date;
    geojson: string;
}

async function leseFlaechen(sql: Queryable, ids: readonly string[]): Promise<Map<string, FlaechenZeile>> {
    const rows = await sql<FlaechenZeile[]>`
        SELECT a.id::text, a.public_id::text, t.public_id::text AS territory_public_id, t.name AS territory_name,
               t.revision::int AS territory_revision, a.map_domain_id, a.revision::int AS revision, a.is_active,
               t.is_active AS territory_active, a.updated_at, ST_AsGeoJSON(a.geom, 15) AS geojson
          FROM territory_area a JOIN territory t ON t.id = a.territory_id
         WHERE a.public_id = ANY(${ids as string[]}::uuid[])
    `;
    return new Map(rows.map((row) => [row.public_id, row]));
}

/** Alle gültigen Flächen des Gebiets, auch die, die der Körper nicht nennt. */
async function leseEigeneFlaechen(sql: Queryable, territoryId: string): Promise<FlaechenZeile[]> {
    const ids = await sql<{ id: string }[]>`
        SELECT a.public_id::text AS id
          FROM territory_area a JOIN territory t ON t.id = a.territory_id
         WHERE t.public_id = ${territoryId}::uuid AND a.is_active AND t.is_active
    `;
    const zeilen = await leseFlaechen(
        sql,
        ids.map(({ id }) => id),
    );
    return [...zeilen.values()];
}

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

/** Welches Gebiet und wo, für die Marke im Editor. */
function wo(
    zeile: Pick<FlaechenZeile, "territory_public_id" | "territory_name"> | undefined,
    territoryId: string,
    stelle: Punkt | undefined,
): Record<string, unknown> {
    return {
        ...(zeile === undefined
            ? {}
            : {
                  gebiet: {
                      id: zeile.territory_public_id,
                      name: zeile.territory_name,
                      eigene: zeile.territory_public_id === territoryId,
                  },
              }),
        ...(stelle === undefined ? {} : { stelle: { x: stelle[0], y: stelle[1] } }),
    };
}

async function konflikt(tx: Sql, zeile: FlaechenZeile): Promise<ApiError> {
    const [jetzt] = await tx<{ revision: number; updated_at: Date }[]>`
        SELECT revision::int AS revision, updated_at FROM territory_area WHERE public_id = ${zeile.public_id}::uuid
    `;
    return mapEditConflict(
        tx,
        { kind: "territory_area", publicId: zeile.public_id },
        { revision: jetzt?.revision ?? zeile.revision, changedAt: jetzt?.updated_at ?? zeile.updated_at },
    );
}

/** Was vor der Transaktion feststeht: die Flächen, die eigenen davon, die Karte und die bereinigten Ringe. */
export interface GebietsformVorab {
    readonly ids: readonly string[];
    readonly eigene: readonly TerritoryReshapeArea[];
    readonly mapDomainId: string;
    readonly name: string;
    readonly neu: ReadonlyMap<string, Punkt[][][]>;
}

/** Prüft die Form vor der Transaktion: keine Fläche doppelt, ein Gebiet mit Fläche, jeder Ring mit drei Ecken. */
export async function pruefeGebietsflaechen(
    database: Queryable,
    territoryId: string,
    areas: readonly TerritoryReshapeArea[],
): Promise<GebietsformVorab> {
    const ids = areas.map((area) => area.id);
    if (new Set(ids).size !== ids.length)
        throw ungueltig("Eine Fläche steht zweimal in der Änderung.", { field: "areas", reason: "flaeche_doppelt" });
    const vorab = await leseFlaechen(database, ids);
    const eigene = areas.filter((area) => vorab.get(area.id)?.territory_public_id === territoryId);
    const erste = (eigene[0] && vorab.get(eigene[0].id)) ?? (await leseEigeneFlaechen(database, territoryId))[0];
    if (erste === undefined || !erste.territory_active)
        throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet hat keine solche Fläche.", {
            reason: "keine_eigene_flaeche",
        });
    const neu = new Map(areas.map((area) => [area.id, bereinige(area.polygons)] as const));
    for (const area of areas) {
        const polygone = neu.get(area.id)!;
        // Der letzte Teil einer Fläche lässt sich nicht entfernen („Unterpolygone löschen …“, OPS-000075): eine Fläche ohne Teil gäbe es nicht mehr.
        if (polygone.length === 0 || polygone.some((polygon) => polygon.length === 0))
            throw ungueltig("Eine Fläche braucht mindestens einen Teil.", {
                field: "areas",
                areaId: area.id,
                reason: "flaeche_ohne_teil",
            });
        const kurz = zuKurzerRing(polygone, area.polygons);
        if (kurz !== undefined)
            throw ungueltig("Ein Ring braucht mindestens drei Ecken.", {
                field: "areas",
                areaId: area.id,
                reason: "ring_unter_drei",
                ...wo(vorab.get(area.id), territoryId, kurz.stelle),
            });
    }
    return { ids, eigene, mapDomainId: erste.map_domain_id, name: erste.territory_name, neu };
}

/** Hält ein anderer eines der Gebiete (EDIT-0003 §4), schreibt die Operation nicht über seinen Entwurf hinweg: 409 `object_locked`. */
export async function pruefeFremdeGebietssperre(tx: Sql, actor: MapActor, gebiete: readonly string[]): Promise<void> {
    const fremd = (await listEditorLocks(tx, "territory", undefined)).find(
        (sperre: EditorLock) =>
            gebiete.includes(sperre.id) && (actor.kind !== "person" || sperre.person.id !== actor.personId),
    );
    if (fremd !== undefined)
        throw new ApiError(
            EDITOR_LOCK_ERROR_STATUS.object_locked,
            "object_locked",
            `${fremd.person.name} bearbeitet das gerade.`,
            {
                lock: fremd,
            },
        );
}

/** Schreibt die Form in der Transaktion `tx`: eigene Flächen und mitgezogene Nachbarn, je gegen ihre Revision. */
export async function formeGebietUmIn(
    tx: Sql,
    actor: MapActor,
    territoryId: string,
    areas: readonly TerritoryReshapeArea[],
    vorab: GebietsformVorab,
): Promise<{ affected: OperationReceipt["affected"]; entries: MapAuditEntry[]; nachbarn: number }> {
    const zeilen = await leseFlaechen(tx, vorab.ids);
    for (const area of areas) {
        const zeile = zeilen.get(area.id);
        if (zeile === undefined || !zeile.is_active || !zeile.territory_active)
            throw ungueltig("Eine Fläche der Änderung ist nicht mehr da.", {
                areaId: area.id,
                reason: "flaeche_fehlt",
            });
        if (zeile.revision !== area.baseRevision) throw await konflikt(tx, zeile);
        if (zeile.map_domain_id !== vorab.mapDomainId)
            throw ungueltig("Eine mitgezogene Fläche liegt auf einer anderen Karte.", {
                areaId: area.id,
                reason: "andere_karte",
            });
    }
    await pruefeFremdeGebietssperre(tx, actor, [
        ...new Set([...zeilen.values()].map((zeile) => zeile.territory_public_id)),
    ]);

    const eigeneAlt = new Set<string>();
    const eigeneNeu = new Set<string>();
    for (const area of vorab.eigene) {
        for (const ring of polygoneVon(zeilen.get(area.id)!.geojson).flat())
            for (const p of ring) eigeneAlt.add(schluessel(p));
        for (const ring of vorab.neu.get(area.id)!.flat()) for (const p of ring) eigeneNeu.add(schluessel(p));
    }
    // Was der Körper nicht nennt, blieb, wie es war: Seine Ecken sind alt und neu zugleich.
    for (const zeile of await leseEigeneFlaechen(tx, territoryId)) {
        if (vorab.ids.includes(zeile.public_id)) continue;
        for (const ring of polygoneVon(zeile.geojson).flat())
            for (const p of ring) {
                eigeneAlt.add(schluessel(p));
                eigeneNeu.add(schluessel(p));
            }
    }

    // `ST_IsValidDetail`: dazu Grund und Stelle, und ohne NOTICE. Nur, wenn die Fläche vorher gültig war (Kopf der Datei).
    const ungueltige = await tx<{ id: string; grund: string | null; x: number | null; y: number | null }[]>`
        SELECT t.id, (d.befund).reason AS grund, ST_X((d.befund).location) AS x, ST_Y((d.befund).location) AS y
          FROM unnest(
                   ${areas.map((area) => area.id)}::text[],
                   ${areas.map((area) => zeilen.get(area.id)!.geojson)}::text[],
                   ${areas.map((area) => geojsonAus(vorab.neu.get(area.id)!))}::text[]
               ) WITH ORDINALITY AS t(id, alt, neu, nr)
          CROSS JOIN LATERAL (SELECT ST_IsValidDetail(ST_GeomFromGeoJSON(t.neu)) AS befund) AS d
         WHERE (ST_IsValidDetail(ST_GeomFromGeoJSON(t.alt))).valid AND NOT (d.befund).valid
         ORDER BY t.nr
    `;
    // Das eigene Gebiet zuerst: Seine Stelle hat man gerade gezogen, ein Nachbar ist meist nur die Folge.
    const fehler = ungueltige.find((u) => zeilen.get(u.id)!.territory_public_id === territoryId) ?? ungueltige[0];
    if (fehler !== undefined)
        throw ungueltig("Die Form schneidet sich selbst, oder ein Loch liegt über ihrem Rand.", {
            field: "areas",
            areaId: fehler.id,
            reason: "form_ungueltig",
            art: formFehlerArt(fehler.grund),
            ...wo(
                zeilen.get(fehler.id),
                territoryId,
                fehler.x === null || fehler.y === null ? undefined : [fehler.x, fehler.y],
            ),
        });

    const alle = [...vorab.neu.values()].flat(3);
    const [lage] = await tx<{ inside: boolean | null }[]>`
        SELECT bool_and(map_domain_contains(${vorab.mapDomainId}, ST_SetSRID(ST_MakePoint(t.x, t.y), 0))) AS inside
          FROM unnest(${alle.map((p) => p[0])}::float8[], ${alle.map((p) => p[1])}::float8[]) AS t(x, y)
    `;
    if (lage?.inside !== true)
        throw ungueltig("Eine Ecke liegt außerhalb der Karte.", { field: "areas", reason: "ecke_ausserhalb" });

    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    const gemeldet = new Set<string>();
    let nachbarn = 0;
    for (const area of areas) {
        const zeile = zeilen.get(area.id)!;
        const alt = polygoneVon(zeile.geojson);
        const form = vorab.neu.get(area.id)!;
        const eigen = zeile.territory_public_id === territoryId;
        if (gleich(alt, form)) continue;
        const bewegt = eigen ? [] : mitgezogen(alt, form, eigeneAlt, eigeneNeu);
        if (bewegt === undefined && !mitGemeinsamenEcken(alt, form, eigeneAlt, eigeneNeu))
            throw ungueltig("An einer Nachbarfläche bewegt sich mehr als die gemeinsamen Ecken.", {
                field: "areas",
                areaId: area.id,
                reason: "nachbar_umgezeichnet",
                ...wo(zeile, territoryId, abweichung(alt, form, eigeneAlt, eigeneNeu)),
            });
        if (!eigen) nachbarn += 1;
        const [geschrieben] = await tx<{ revision: number }[]>`
            UPDATE territory_area
               SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(form)}), 0))
             WHERE public_id = ${area.id}::uuid AND revision = ${area.baseRevision}
            RETURNING revision::int AS revision
        `;
        if (geschrieben === undefined) throw await konflikt(tx, zeile);
        if (!gemeldet.has(zeile.territory_public_id)) {
            gemeldet.add(zeile.territory_public_id);
            affected.push({ kind: GEBIET_ART, id: zeile.territory_public_id, revision: zeile.territory_revision });
        }
        affected.push({ kind: GEBIETSFLAECHE_ART, id: area.id, revision: geschrieben.revision });
        entries.push({
            action: eigen || bewegt === undefined ? "territory_area.reshaped" : "territory_area.carried",
            territoryId: zeile.territory_public_id,
            territoryAreaId: area.id,
            revisionBefore: zeile.revision,
            revisionAfter: geschrieben.revision,
            changes: {
                geometry:
                    eigen || bewegt === undefined
                        ? { before: ringe(alt), after: ringe(form) }
                        : { before: bewegt.map(({ von }) => [...von]), after: bewegt.map(({ nach }) => [...nach]) },
            },
        });
    }
    return { affected, entries, nachbarn };
}
