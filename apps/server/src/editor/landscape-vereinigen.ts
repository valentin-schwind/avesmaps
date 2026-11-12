import {
    FLAECHEN_FANG,
    type EditorLandscapeLayer,
    type FlaechenVereinigenBody,
    type FlaechenVereinigenGrund,
    type FlaechenVereinigenPruefung,
    type FlaechenVereinigenReceipt,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { planeVereinigung, type Teilflaeche, type Traeger } from "./flaechen-vereinigen.ts";
import { nimmTeilflaecheWeg, type Zeile } from "./landscape-boolean.ts";
import { pruefeFremdeSperre } from "./landscape-reshape.ts";
import { kraftlinienAnFlaeche } from "./landscape-retire.ts";
import { GELAENDE_VERALTET, speistGelaende } from "./landscape-update.ts";
import { LANDSCHAFT_ART, mapOperation, TEILFLAECHE_ART, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import { geojsonAus, polygoneVon, ringe, schluessel } from "./ring-form.ts";

/**
 * „Flächen vereinigen ›“ an Landschaften (WI-0252, Vertrag `editor-flaechen-vereinigen.ts`, Rechnung `flaechen-vereinigen.ts`):
 * `GET /api/editor/landscapes/vereinigen?ids=` prüft, `POST …/vereinigen` schreibt `landscape.merge`.
 *
 * - **Gleiche Art:** dieselbe Ebene (`region_layer`) und Art (`region_type`), dieselbe Karte, jede mit einer Teilfläche auf der Karte.
 *   Nachbarn sind die Teilflächen anderer Landschaften derselben Ebene: Flächen verschiedener Ebenen überlagern einander ohnehin.
 * - **Die anderen Landschaften** gehen wie bei „Mit anderer Fläche › vereinigen“ (`landscape-boolean.ts`, Legacy `geometry-ops.js#L202-L217`)
 *   mit ihrer letzten Teilfläche samt Beschriftungen von der Karte (`nimmTeilflaecheWeg`). Endet an einer ihrer Beschriftungen eine
 *   Kraftlinie, darf sie nicht gehen: Dann kann nur sie Vorlage sein, bei zweien keine (`kraftlinie`).
 * - **EINE Operation** gegen die Revision jeder Landschaft, die die Prüfung las, nie über eine fremde Sperre (EDIT-0003 §4); die Rechnung
 *   läuft in der Transaktion unter Sperre der Teilflächen noch einmal. ↺ im Verlauf der Vorlage über `…/:id/restore` (`restoreBoolean`,
 *   die Zeile `area.merged` trägt die Form vorher).
 */

interface Landschaft {
    id: string;
    public_id: string;
    name: string;
    revision: number;
    region_layer: EditorLandscapeLayer;
    region_type: string | null;
    map_domain_id: string;
    is_active: boolean;
    updated_at: Date;
}

async function leseLandschaften(sql: Queryable, ids: readonly string[], sperren: boolean): Promise<Landschaft[]> {
    return sperren
        ? await sql<Landschaft[]>`
              SELECT r.id::text, r.public_id::text, r.name, r.revision::int AS revision, r.region_layer, r.region_type,
                     r.map_domain_id, r.is_active, r.updated_at
                FROM region r WHERE r.public_id = ANY(${ids as string[]}::uuid[]) FOR NO KEY UPDATE OF r
          `
        : await sql<Landschaft[]>`
              SELECT r.id::text, r.public_id::text, r.name, r.revision::int AS revision, r.region_layer, r.region_type,
                     r.map_domain_id, r.is_active, r.updated_at
                FROM region r WHERE r.public_id = ANY(${ids as string[]}::uuid[])
          `;
}

type Flaeche = Zeile & { groesse: number };

async function leseFlaechen(sql: Queryable, landschaften: readonly string[], sperren: boolean): Promise<Flaeche[]> {
    return sperren
        ? await sql<Flaeche[]>`
              SELECT a.id::text, a.public_id::text, a.revision::int AS revision, a.updated_at, ST_AsGeoJSON(a.geom, 15) AS geojson,
                     r.id::text AS region_id, r.public_id::text AS region, r.name AS region_name, r.revision::int AS region_revision,
                     r.region_layer, r.region_type, a.map_domain_id, ST_Area(a.geom) AS groesse
                FROM region_area a JOIN region r ON r.id = a.region_id
               WHERE r.public_id = ANY(${landschaften as string[]}::uuid[]) AND a.is_active AND r.is_active
               ORDER BY a.id
                 FOR NO KEY UPDATE OF a
          `
        : await sql<Flaeche[]>`
              SELECT a.id::text, a.public_id::text, a.revision::int AS revision, a.updated_at, ST_AsGeoJSON(a.geom, 15) AS geojson,
                     r.id::text AS region_id, r.public_id::text AS region, r.name AS region_name, r.revision::int AS region_revision,
                     r.region_layer, r.region_type, a.map_domain_id, ST_Area(a.geom) AS groesse
                FROM region_area a JOIN region r ON r.id = a.region_id
               WHERE r.public_id = ANY(${landschaften as string[]}::uuid[]) AND a.is_active AND r.is_active
               ORDER BY a.id
          `;
}

/** Welche Teilflächen einander bis auf den Fangradius berühren, und die Ecken der Nachbarn derselben Ebene, die auf einer Ecke dieser Flächen liegen. */
async function umfeld(
    sql: Queryable,
    flaechen: readonly Flaeche[],
    landschaft: Landschaft,
): Promise<{ beruehrt: [string, string][]; nachbarEcken: Set<string> }> {
    const ids = flaechen.map((f) => f.id);
    const paare = await sql<{ a: string; b: string }[]>`
        SELECT a.public_id::text AS a, b.public_id::text AS b
          FROM region_area a JOIN region_area b ON a.id < b.id AND ST_DWithin(a.geom, b.geom, ${FLAECHEN_FANG})
         WHERE a.id = ANY(${ids}::bigint[]) AND b.id = ANY(${ids}::bigint[])
    `;
    // 🔴 Nur die Ecken der Nachbarn, die auf einer Ecke der gewählten Flächen liegen: Nur sie entscheiden (`flaechen-vereinigen.ts`, Schritte 3
    // und 5). Vorher las diese Stelle ganze Nachbarflächen, die bis auf den Fangradius an eine gewählte stoßen (`ST_DWithin` von Fläche zu
    // Fläche): An echten Daten dauerte das für „Meer“ und „Zyklopensee“ 99 s (214 Nachbarn, 1,5 MB GeoJSON), die Prüfung brach an der
    // Zeitgrenze der Anfrage ab (503), und das Menü stand grau da. Ein Vergleich der Ecken nach ihrem Raster ist in Millisekunden fertig.
    const ecken = await sql<{ x: number; y: number }[]>`
        WITH eigen AS (
            SELECT DISTINCT round(ST_X(p.geom) * 100000)::bigint AS kx, round(ST_Y(p.geom) * 100000)::bigint AS ky
              FROM region_area i CROSS JOIN LATERAL ST_DumpPoints(i.geom) AS p
             WHERE i.id = ANY(${ids}::bigint[])
        ), rahmen AS (
            SELECT ST_Expand(ST_Extent(i.geom), ${FLAECHEN_FANG}::float8) AS kasten FROM region_area i WHERE i.id = ANY(${ids}::bigint[])
        )
        SELECT DISTINCT ST_X(p.geom) AS x, ST_Y(p.geom) AS y
          FROM region_area n
          JOIN region r ON r.id = n.region_id
          CROSS JOIN rahmen
          CROSS JOIN LATERAL ST_DumpPoints(n.geom) AS p
          JOIN eigen e ON e.kx = round(ST_X(p.geom) * 100000)::bigint AND e.ky = round(ST_Y(p.geom) * 100000)::bigint
         WHERE n.is_active AND r.is_active AND n.map_domain_id = ${landschaft.map_domain_id}
           AND r.region_layer = ${landschaft.region_layer} AND NOT (n.id = ANY(${ids}::bigint[]))
           AND n.geom && rahmen.kasten
    `;
    const nachbarEcken = new Set(ecken.map((e) => schluessel([e.x, e.y])));
    return { beruehrt: paare.map((p) => [p.a, p.b] as [string, string]), nachbarEcken };
}

type Rechnung =
    | {
          readonly geht: true;
          readonly vorlage: string;
          readonly vorlagen: readonly string[];
          readonly flaechen: readonly Flaeche[];
          readonly traeger: readonly Traeger[];
          readonly weg: readonly string[];
      }
    | { readonly geht: false; readonly grund: FlaechenVereinigenGrund; readonly flaechen: readonly Flaeche[] };

/** Prüft und rechnet; ohne `vorlage` mit der ersten, die Vorlage sein kann. */
async function rechne(
    sql: Queryable,
    landschaften: readonly Landschaft[],
    vorlage: string | undefined,
    sperren: boolean,
): Promise<Rechnung> {
    const nicht = (grund: FlaechenVereinigenGrund, flaechen: readonly Flaeche[] = []): Rechnung => ({
        geht: false,
        grund,
        flaechen,
    });
    if (landschaften.length < 2) return nicht("anzahl");
    const erste = landschaften[0]!;
    if (landschaften.some((l) => !l.is_active || l.map_domain_id !== erste.map_domain_id)) return nicht("karte");
    if (landschaften.some((l) => l.region_layer !== erste.region_layer || l.region_type !== erste.region_type))
        return nicht("art");
    const flaechen = await leseFlaechen(
        sql,
        landschaften.map((l) => l.public_id),
        sperren,
    );
    if (landschaften.some((l) => !flaechen.some((f) => f.region === l.public_id))) return nicht("leer", flaechen);
    // Endet an einer Beschriftung eine Kraftlinie, darf diese Landschaft nicht gehen: Nur sie kann Vorlage sein.
    const mitLinie: string[] = [];
    for (const l of landschaften) if ((await kraftlinienAnFlaeche(sql, l.id)).length > 0) mitLinie.push(l.public_id);
    const vorlagen =
        mitLinie.length === 0 ? landschaften.map((l) => l.public_id) : mitLinie.length === 1 ? mitLinie : [];
    const gewaehlt = vorlage ?? vorlagen[0];
    if (gewaehlt === undefined || !vorlagen.includes(gewaehlt)) return nicht("kraftlinie", flaechen);
    const { beruehrt, nachbarEcken } = await umfeld(sql, flaechen, erste);
    const teile: Teilflaeche[] = flaechen.map((f) => ({
        id: f.public_id,
        besitzer: f.region,
        polygone: polygoneVon(f.geojson),
        groesse: f.groesse,
    }));
    const plan = await planeVereinigung(sql, { flaechen: teile, beruehrt, vorlage: gewaehlt, nachbarEcken });
    if (!plan.geht) return nicht(plan.grund, flaechen);
    return { geht: true, vorlage: gewaehlt, vorlagen, flaechen, traeger: plan.traeger, weg: plan.weg };
}

/** Die Kennungen je einmal, sortiert: dieselbe Sperrfolge für jede Auswahl. */
const geordnet = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/** `GET …/vereinigen?ids=`: geht es, sonst der Grund; dazu die gelesenen Revisionen, gegen die das Schreiben läuft. */
export async function pruefeLandschaftenVereinigen(
    database: Database,
    ids: readonly string[],
): Promise<FlaechenVereinigenPruefung> {
    const genannt = [...new Set(ids)];
    const landschaften = await leseLandschaften(database, genannt, false);
    const je = new Map(landschaften.map((l) => [l.public_id, l] as const));
    const rechnung =
        landschaften.length === genannt.length
            ? await rechne(
                  database,
                  genannt.map((id) => je.get(id)!),
                  undefined,
                  false,
              )
            : ({ geht: false, grund: "karte", flaechen: [] } as const);
    const objekte = genannt.flatMap((id) => {
        const l = je.get(id);
        return l === undefined
            ? []
            : [
                  {
                      publicId: id,
                      revision: l.revision,
                      name: l.name,
                      art: l.region_type ?? "",
                      flaechen: rechnung.flaechen.filter((f) => f.region === id).length,
                  },
              ];
    });
    return rechnung.geht
        ? { geht: true, objekte, vorlagen: [...rechnung.vorlagen] }
        : { geht: false, grund: rechnung.grund, objekte };
}

export const LANDSCHAFT_GRUND_TEXT: Readonly<Record<FlaechenVereinigenGrund, string>> = {
    anzahl: "Vereinigt werden mindestens zwei Flächen.",
    karte: "Eine der Flächen ist nicht auf der Karte.",
    art: "Vereinigt werden nur Flächen derselben Ebene und Art.",
    leer: "Eine der Landschaften hat keine Fläche auf der Karte.",
    nachbar: "Eine Nachbarfläche verlöre ihre gemeinsame Kante.",
    kraftlinie: "An einer Beschriftung, die ginge, endet eine Kraftlinie; erst sie umhängen oder entfernen.",
    zeit: "Die Flächen gelten zu verschiedenen Zeiten.",
};

/** `landscape.merge` (`POST …/vereinigen`): die Vorlage bekommt die vereinigte Form, die übrigen Landschaften gehen von der Karte. */
export async function vereinigeLandschaften(
    database: Database,
    actor: MapActor,
    body: FlaechenVereinigenBody,
): Promise<FlaechenVereinigenReceipt> {
    const ids = geordnet(body.objects.map((o) => o.publicId));
    if (!ids.includes(body.vorlage))
        throw new ApiError(400, "validation_failed", "Die Vorlage gehört nicht zu den gewählten Flächen.", {
            field: "vorlage",
        });
    const [vorab] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM region WHERE public_id = ${body.vorlage}::uuid
    `;
    if (vorab === undefined) throw new ApiError(404, "not_found", "Diese Landschaft gibt es nicht.");
    const quittung = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "landscape.merge", mapDomainId: vorab.map_domain_id, body },
        async (tx) => {
            const landschaften = await leseLandschaften(tx, ids, true);
            if (landschaften.length !== ids.length)
                throw new ApiError(404, "not_found", "Eine der Landschaften gibt es nicht.");
            const basis = new Map(body.objects.map((o) => [o.publicId, o.baseRevision] as const));
            const anders = landschaften.find((l) => basis.get(l.public_id) !== l.revision);
            if (anders !== undefined)
                throw await mapEditConflict(
                    tx,
                    { kind: "region", publicId: anders.public_id },
                    { revision: anders.revision, changedAt: anders.updated_at },
                );
            await pruefeFremdeSperre(tx, actor, ids);
            const rechnung = await rechne(tx, landschaften, body.vorlage, true);
            if (!rechnung.geht)
                throw new ApiError(400, "validation_failed", LANDSCHAFT_GRUND_TEXT[rechnung.grund], {
                    field: "objects",
                    grund: rechnung.grund,
                });
            const vorlage = landschaften.find((l) => l.public_id === body.vorlage)!;
            const flaeche = new Map(rechnung.flaechen.map((f) => [f.public_id, f] as const));
            const affected: FlaechenVereinigenReceipt["affected"][number][] = [
                { kind: LANDSCHAFT_ART, id: vorlage.public_id, revision: vorlage.revision },
            ];
            const entries: MapAuditEntry[] = [];
            for (const t of rechnung.traeger) {
                const zeile = flaeche.get(t.id)!;
                const [neu] = await tx<{ revision: number }[]>`
                    UPDATE region_area
                       SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(t.nachher)}), 0),
                           geometry_revision = COALESCE(geometry_revision, 0) + 1
                     WHERE public_id = ${t.id}::uuid AND revision = ${zeile.revision}
                    RETURNING revision::int AS revision
                `;
                if (neu === undefined)
                    throw await mapEditConflict(
                        tx,
                        { kind: "area", publicId: t.id },
                        { revision: zeile.revision, changedAt: zeile.updated_at },
                    );
                affected.push({ kind: TEILFLAECHE_ART, id: t.id, revision: neu.revision });
                entries.push({
                    action: "area.merged",
                    regionId: vorlage.public_id,
                    areaId: t.id,
                    revisionBefore: zeile.revision,
                    revisionAfter: neu.revision,
                    changes: { geometry: { before: ringe(t.vorher), after: ringe(t.nachher) } },
                });
            }
            // Von der Karte: die aufgenommenen Teilflächen, und mit der letzten einer anderen Landschaft diese samt Beschriftungen.
            const weg = new Set(rechnung.weg);
            for (const l of landschaften) {
                const ihre = rechnung.flaechen.filter((f) => f.region === l.public_id && weg.has(f.public_id));
                const ganz = l.public_id !== vorlage.public_id;
                for (const [i, f] of ihre.entries())
                    await nimmTeilflaecheWeg(tx, f, ganz && i === ihre.length - 1, affected, entries);
            }
            const andere = landschaften.filter((l) => l.public_id !== vorlage.public_id).map((l) => l.name);
            return {
                receipt: {
                    affected,
                    derivedWork: [],
                    warnings: speistGelaende(vorlage.region_layer, vorlage.region_type) ? [GELAENDE_VERALTET] : [],
                },
                summary: `${vorlage.name}: mit ${andere.join(", ")} vereinigt`,
                entries,
            };
        },
    );
    return { ...quittung, publicId: body.vorlage };
}
