import type { EditorLock, LandscapeUpdateBody, OperationReceipt } from "@avesmaps3d/shared";
import { EDITOR_LOCK_ERROR_STATUS } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { listEditorLocks } from "./editor-lock.ts";
import { LANDSCHAFT_ART, TEILFLAECHE_ART, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import {
    abweichung,
    bereinige,
    geojsonAus,
    gleich,
    mitGemeinsamenEcken,
    mitgezogen,
    polygoneVon,
    ringe,
    schluessel,
    formFehlerArt,
    zuKurzerRing,
    type Punkt,
} from "./ring-form.ts";

/**
 * Die Form einer Landschaft beim Schreiben (WI-0178 C2, seit B2 Teil von `landscape.update`, `landscape-update.ts`; EDIT-0004 §2.3, §5;
 * EDIT-0003 T27 (4), T44): jede Teilfläche, die der Entwurf geändert hat, und die mitgezogenen Nachbarn in der Transaktion der EINEN
 * Operation.
 *
 * - **Eigene Teilflächen** bekommen ihre neue Form, je gegen ihre Revision; gespeichert wird der eckige Umriss, gerundet wird danach
 *   (Auftrag `land_smooth`, B3). `geometry_revision` zählt mit, damit die Schriftläufe die Region als geändert erkennen.
 * - **Nachbarn** (Teilflächen anderer Landschaften derselben Ebene): Nur gemeinsame Ecken ziehen mit (B4). An ihnen darf sich nur bewegen,
 *   was genau auf einer alten Ecke dieser Landschaft lag und auf eine ihrer neuen Ecken geht; Zahl und Lage aller anderen Ecken bleiben.
 *   So kann der Schreibweg keine fremde Fläche umzeichnen.
 * - **Ein Konflikt an einer der Flächen nimmt alles zurück** (409 `edit_conflict`, eine Transaktion). Hält ein anderer eine der
 *   Landschaften (EDIT-0003 §4), 409 `object_locked`; der Entwurf bleibt im Browser. Läuft der Zug, 503 (`mapOperation`).
 * - 🔴 **Keine Rundung der Koordinaten** (die Rechnung an Ringen steht in `ring-form.ts`, geteilt mit `territory-reshape.ts`).
 * - **Gültig** (Befund der Kraftlinien-Sitzung 2026-10-19 zu „Fläche vereinfachen“): Eine Form, die sich selbst schneidet oder ein Loch
 *   über ihren Rand schiebt, ist 400, wenn die Fläche vorher gültig war (`ST_IsValid`); eine schon vorher ungültige aus Legacy bleibt
 *   bearbeitbar. Die Ablehnung nennt, was falsch ist und wo (Vali 2026-11-09, „Ja, bauen“ auf die Frage, ob der Editor die Stelle
 *   markieren soll): `details.art` (`formFehlerArt`), `details.stelle` (die Stelle aus `ST_IsValidDetail`, Kartenkoordinaten) und
 *   `details.landschaft` (welche Fläche, eigene oder mitgezogener Nachbar). Der Code bleibt `form_ungueltig`, das Log kennt ihn.
 * - **Wo** (Vali 2026-11-10: „editoren werden immer wieder beim editieren gehindert“): Auch `ring_unter_drei` und `nachbar_umgezeichnet`
 *   tragen `stelle` und `landschaft`, damit der Editor die Stelle markiert. Der Editor prüft jeden Schritt schon mit derselben Rechnung
 *   (`@avesmaps3d/shared`, `flaechen-ringe.ts`); hier kommt nur noch an, was ein Entwurf von vorher mitbringt.
 */

/** Welche Landschaft und wo, für die Marke im Editor. */
function wo(
    zeile: Pick<FlaechenZeile, "region_public_id" | "region_name"> | undefined,
    regionId: string,
    stelle: Punkt | undefined,
): Record<string, unknown> {
    return {
        ...(zeile === undefined
            ? {}
            : {
                  landschaft: {
                      id: zeile.region_public_id,
                      name: zeile.region_name,
                      eigene: zeile.region_public_id === regionId,
                  },
              }),
        ...(stelle === undefined ? {} : { stelle: { x: stelle[0], y: stelle[1] } }),
    };
}

export interface FlaechenZeile {
    id: string;
    public_id: string;
    region_public_id: string;
    region_name: string;
    region_layer: string;
    region_revision: number;
    map_domain_id: string;
    revision: number;
    is_active: boolean;
    region_active: boolean;
    updated_at: Date;
    geojson: string;
}

async function leseFlaechen(sql: Queryable, ids: readonly string[]): Promise<Map<string, FlaechenZeile>> {
    const rows = await sql<FlaechenZeile[]>`
        SELECT a.id::text, a.public_id::text, r.public_id::text AS region_public_id, r.name AS region_name, r.region_layer,
               r.revision::int AS region_revision, a.map_domain_id, a.revision::int AS revision, a.is_active,
               r.is_active AS region_active, a.updated_at, ST_AsGeoJSON(a.geom, 15) AS geojson
          FROM region_area a JOIN region r ON r.id = a.region_id
         WHERE a.public_id = ANY(${ids as string[]}::uuid[])
    `;
    return new Map(rows.map((row) => [row.public_id, row]));
}

/** Alle gültigen Teilflächen der Landschaft, auch die, die der Körper nicht nennt (OPS-000079, wie `territory-reshape.ts`). */
async function leseEigeneFlaechen(sql: Queryable, regionId: string): Promise<FlaechenZeile[]> {
    const ids = await sql<{ id: string }[]>`
        SELECT a.public_id::text AS id
          FROM region_area a JOIN region r ON r.id = a.region_id
         WHERE r.public_id = ${regionId}::uuid AND a.is_active AND r.is_active
    `;
    const zeilen = await leseFlaechen(
        sql,
        ids.map(({ id }) => id),
    );
    return [...zeilen.values()];
}

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

async function konflikt(tx: Sql, zeile: FlaechenZeile): Promise<ApiError> {
    const [jetzt] = await tx<{ revision: number; updated_at: Date }[]>`
        SELECT revision::int AS revision, updated_at FROM region_area WHERE public_id = ${zeile.public_id}::uuid
    `;
    return mapEditConflict(
        tx,
        { kind: "area", publicId: zeile.public_id },
        { revision: jetzt?.revision ?? zeile.revision, changedAt: jetzt?.updated_at ?? zeile.updated_at },
    );
}

/** Was vor der Transaktion feststeht: die erste eigene Teilfläche (Domäne, Ebene, Name) und die bereinigten neuen Formen. */
export interface FormVorab {
    readonly erste: FlaechenZeile;
    readonly neu: ReadonlyMap<string, Punkt[][][]>;
}

/** Prüft die Teilflächen einer Änderung, bevor die Operation beginnt: doppelt, fremd, zu wenig Ecken. */
export async function pruefeFlaechen(
    database: Database,
    regionId: string,
    areas: NonNullable<LandscapeUpdateBody["areas"]>,
): Promise<FormVorab> {
    const ids = areas.map((area) => area.id);
    if (new Set(ids).size !== ids.length)
        throw ungueltig("Eine Teilfläche steht zweimal in der Änderung.", {
            field: "areas",
            reason: "flaeche_doppelt",
        });
    const vorab = await leseFlaechen(database, ids);
    const eigene = areas.filter((area) => vorab.get(area.id)?.region_public_id === regionId);
    const erste = (eigene[0] && vorab.get(eigene[0].id)) ?? (await leseEigeneFlaechen(database, regionId))[0];
    if (erste === undefined || !erste.region_active)
        throw new ApiError(404, "not_found", "Diese Landschaft hat keine solche Teilfläche.", {
            reason: "keine_eigene_flaeche",
        });
    const neu = new Map(areas.map((area) => [area.id, bereinige(area.polygons)] as const));
    for (const area of areas) {
        const kurz = zuKurzerRing(neu.get(area.id)!, area.polygons);
        if (kurz !== undefined)
            throw ungueltig("Ein Ring braucht mindestens drei Ecken.", {
                field: "areas",
                areaId: area.id,
                reason: "ring_unter_drei",
                ...wo(vorab.get(area.id), regionId, kurz.stelle),
            });
    }
    return { erste, neu };
}

/** Hält ein anderer eine dieser Landschaften (EDIT-0003 §4), schreibt die Operation nicht über seinen Entwurf hinweg. */
export async function pruefeFremdeSperre(tx: Sql, actor: MapActor, landschaften: readonly string[]): Promise<void> {
    const fremd = (await listEditorLocks(tx, "landscape", undefined)).find(
        (sperre: EditorLock) =>
            landschaften.includes(sperre.id) && (actor.kind !== "person" || sperre.person.id !== actor.personId),
    );
    if (fremd !== undefined)
        throw new ApiError(
            EDITOR_LOCK_ERROR_STATUS.object_locked,
            "object_locked",
            `${fremd.person.name} bearbeitet das gerade.`,
            { lock: fremd },
        );
}

/**
 * Die Form in der Transaktion einer Operation (`area.reshape`, `landscape.update`): jede Teilfläche gegen ihre Revision, Nachbarn nur
 * an gemeinsamen Ecken, alles in der Karte. Gibt Gegenstände und Einträge fürs Protokoll zurück; ein Konflikt wirft und nimmt die ganze
 * Operation zurück.
 */
export async function formeUmIn(
    tx: Sql,
    actor: MapActor,
    regionId: string,
    areas: NonNullable<LandscapeUpdateBody["areas"]>,
    { erste, neu }: FormVorab,
): Promise<{ affected: OperationReceipt["affected"]; entries: MapAuditEntry[]; nachbarn: number }> {
    const ids = areas.map((area) => area.id);
    const zeilen = await leseFlaechen(tx, ids);
    for (const area of areas) {
        const zeile = zeilen.get(area.id);
        if (zeile === undefined || !zeile.is_active || !zeile.region_active)
            throw ungueltig("Eine Teilfläche der Änderung ist nicht mehr da.", {
                areaId: area.id,
                reason: "flaeche_fehlt",
            });
        if (zeile.revision !== area.baseRevision) throw await konflikt(tx, zeile);
        if (zeile.map_domain_id !== erste.map_domain_id || zeile.region_layer !== erste.region_layer)
            throw ungueltig("Eine mitgezogene Fläche liegt in einer anderen Ebene.", {
                areaId: area.id,
                reason: "andere_ebene",
            });
    }
    await pruefeFremdeSperre(tx, actor, [...new Set([...zeilen.values()].map((zeile) => zeile.region_public_id))]);

    const eigene = areas.filter((area) => zeilen.get(area.id)!.region_public_id === regionId);
    const eigeneAlt = new Set<string>();
    const eigeneNeu = new Set<string>();
    for (const area of eigene) {
        for (const ring of polygoneVon(zeilen.get(area.id)!.geojson).flat())
            for (const p of ring) eigeneAlt.add(schluessel(p));
        for (const ring of neu.get(area.id)!.flat()) for (const p of ring) eigeneNeu.add(schluessel(p));
    }
    // Was der Körper nicht nennt, blieb, wie es war: Seine Ecken sind alt und neu zugleich.
    for (const zeile of await leseEigeneFlaechen(tx, regionId)) {
        if (ids.includes(zeile.public_id)) continue;
        for (const ring of polygoneVon(zeile.geojson).flat())
            for (const p of ring) {
                eigeneAlt.add(schluessel(p));
                eigeneNeu.add(schluessel(p));
            }
    }

    // `ST_IsValidDetail` statt `ST_IsValid`: dazu Grund und Stelle, und ohne NOTICE.
    const ungueltige = await tx<{ id: string; grund: string | null; x: number | null; y: number | null }[]>`
        SELECT t.id, (d.befund).reason AS grund, ST_X((d.befund).location) AS x, ST_Y((d.befund).location) AS y
          FROM unnest(
                   ${areas.map((area) => area.id)}::text[],
                   ${areas.map((area) => zeilen.get(area.id)!.geojson)}::text[],
                   ${areas.map((area) => geojsonAus(neu.get(area.id)!))}::text[]
               ) WITH ORDINALITY AS t(id, alt, neu, nr)
          CROSS JOIN LATERAL (SELECT ST_IsValidDetail(ST_GeomFromGeoJSON(t.neu)) AS befund) AS d
         WHERE (ST_IsValidDetail(ST_GeomFromGeoJSON(t.alt))).valid AND NOT (d.befund).valid
         ORDER BY t.nr
    `;
    // Die eigene Fläche zuerst: Ihre Stelle hat man gerade gezogen, ein Nachbar ist meist nur die Folge.
    const fehler = ungueltige.find((u) => zeilen.get(u.id)!.region_public_id === regionId) ?? ungueltige[0];
    if (fehler !== undefined) {
        const zeile = zeilen.get(fehler.id)!;
        throw ungueltig("Die Form schneidet sich selbst, oder ein Loch liegt über ihrem Rand.", {
            field: "areas",
            areaId: fehler.id,
            reason: "form_ungueltig",
            art: formFehlerArt(fehler.grund),
            landschaft: {
                id: zeile.region_public_id,
                name: zeile.region_name,
                eigene: zeile.region_public_id === regionId,
            },
            ...(fehler.x === null || fehler.y === null ? {} : { stelle: { x: fehler.x, y: fehler.y } }),
        });
    }

    const alle = [...neu.values()].flat(3);
    const [lage] = await tx<{ inside: boolean | null }[]>`
        SELECT bool_and(map_domain_contains(${erste.map_domain_id}, ST_SetSRID(ST_MakePoint(t.x, t.y), 0))) AS inside
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
        const form = neu.get(area.id)!;
        const eigen = zeile.region_public_id === regionId;
        if (gleich(alt, form)) continue;
        const bewegt = eigen ? [] : mitgezogen(alt, form, eigeneAlt, eigeneNeu);
        if (bewegt === undefined && !mitGemeinsamenEcken(alt, form, eigeneAlt, eigeneNeu))
            throw ungueltig("An einer Nachbarfläche bewegt sich mehr als die gemeinsamen Ecken.", {
                field: "areas",
                areaId: area.id,
                reason: "nachbar_umgezeichnet",
                ...wo(zeile, regionId, abweichung(alt, form, eigeneAlt, eigeneNeu)),
            });
        if (!eigen) nachbarn += 1;
        const [geschrieben] = await tx<{ revision: number }[]>`
            UPDATE region_area
               SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(form)}), 0),
                   geometry_revision = COALESCE(geometry_revision, 0) + 1
             WHERE public_id = ${area.id}::uuid AND revision = ${area.baseRevision}
            RETURNING revision::int AS revision
        `;
        if (geschrieben === undefined) throw await konflikt(tx, zeile);
        if (!gemeldet.has(zeile.region_public_id)) {
            gemeldet.add(zeile.region_public_id);
            affected.push({
                kind: LANDSCHAFT_ART,
                id: zeile.region_public_id,
                revision: zeile.region_revision,
            });
        }
        affected.push({ kind: TEILFLAECHE_ART, id: area.id, revision: geschrieben.revision });
        entries.push({
            action: eigen || bewegt === undefined ? "area.reshaped" : "area.carried",
            regionId: zeile.region_public_id,
            areaId: area.id,
            revisionBefore: zeile.revision,
            revisionAfter: geschrieben.revision,
            changes: {
                geometry:
                    eigen || bewegt === undefined
                        ? { before: ringe(alt), after: ringe(form) }
                        : {
                              before: bewegt.map(({ von }) => [...von]),
                              after: bewegt.map(({ nach }) => [...nach]),
                          },
            },
        });
    }
    return { affected, entries, nachbarn };
}
