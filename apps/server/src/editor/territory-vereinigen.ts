import {
    FLAECHEN_FANG,
    type FlaechenVereinigenBody,
    type FlaechenVereinigenGrund,
    type FlaechenVereinigenPruefung,
    type FlaechenVereinigenReceipt,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { planeVereinigung, type Teilflaeche, type Traeger } from "./flaechen-vereinigen.ts";
import { GEBIET_ART, GEBIETSFLAECHE_ART, mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import { geojsonAus, polygoneVon, ringe, schluessel } from "./ring-form.ts";
import { pruefeFremdeGebietssperre } from "./territory-reshape.ts";

/**
 * „Flächen vereinigen ›“ an Herrschaftsgebieten (WI-0252, Vertrag `editor-flaechen-vereinigen.ts`, Rechnung `flaechen-vereinigen.ts`):
 * `GET /api/editor/territories/vereinigen?ids=` prüft, `POST …/vereinigen` schreibt `territory.merge`.
 *
 * - **Gleiche Art:** dieselbe Art (`territory_type`) unter demselben Obergebiet (die Ebene im Baum: Die Form eines Obergebiets bleibt so,
 *   wie sie war), dieselbe Karte, jedes mit einer Fläche. Dieselbe Gültigkeit der Gebiete und aller Flächen, dieselben Zoombänder der
 *   Flächen (`zeit`): Eine vereinigte Fläche trägt nur eine. Nachbarn sind alle anderen Gebietsflächen: Gebiete teilen ihre Grenzen.
 * - **Nur die Geometrie:** Die Vorlage bekommt die vereinigte Form; die anderen Gebiete verlieren ihre Flächen wie bei „Entfernen › Von der
 *   Karte“ (`territory_area.retired`). Ihr Eintrag mit Untergebieten, Ansprüchen, Hauptstadt, Sitz, Wiki und Herkunft bleibt unberührt:
 *   Was mit diesen Bezügen beim Vereinigen geschehen soll, sagt das Modell nicht; das entscheidet der Betreiber (WI-0252 §8).
 * - **EINE Operation** gegen die Revision jedes Gebiets, die die Prüfung las, nie über eine fremde Sperre; die Rechnung läuft in der
 *   Transaktion unter Sperre der Flächen noch einmal. Danach reiht die Schreibnaht `territory_derive` ein. ↺ im Verlauf der Vorlage über
 *   `…/:id/restore` (`restoreTerritory`, die Zeile `territory_area.merged` trägt die Form vorher).
 */

interface Gebiet {
    id: string;
    public_id: string;
    name: string;
    revision: number;
    territory_type: string | null;
    parent_id: string | null;
    map_domain_id: string;
    is_active: boolean;
    updated_at: Date;
    valid_from_bf: number | null;
    valid_to_bf: number | null;
}

async function leseGebiete(sql: Queryable, ids: readonly string[], sperren: boolean): Promise<Gebiet[]> {
    return sperren
        ? await sql<Gebiet[]>`
              SELECT t.id::text, t.public_id::text, t.name, t.revision::int AS revision, t.territory_type, t.parent_id::text,
                     t.map_domain_id, t.is_active, t.updated_at, t.valid_from_bf, t.valid_to_bf
                FROM territory t WHERE t.public_id = ANY(${ids as string[]}::uuid[]) FOR NO KEY UPDATE OF t
          `
        : await sql<Gebiet[]>`
              SELECT t.id::text, t.public_id::text, t.name, t.revision::int AS revision, t.territory_type, t.parent_id::text,
                     t.map_domain_id, t.is_active, t.updated_at, t.valid_from_bf, t.valid_to_bf
                FROM territory t WHERE t.public_id = ANY(${ids as string[]}::uuid[])
          `;
}

interface Flaeche {
    id: string;
    public_id: string;
    revision: number;
    updated_at: Date;
    geojson: string;
    territory: string;
    groesse: number;
    valid_from_bf: number | null;
    valid_to_bf: number | null;
    min_zoom: number | null;
    max_zoom: number | null;
}

async function leseFlaechen(sql: Queryable, gebiete: readonly string[], sperren: boolean): Promise<Flaeche[]> {
    return sperren
        ? await sql<Flaeche[]>`
              SELECT a.id::text, a.public_id::text, a.revision::int AS revision, a.updated_at, ST_AsGeoJSON(a.geom, 15) AS geojson,
                     t.public_id::text AS territory, ST_Area(a.geom) AS groesse, a.valid_from_bf, a.valid_to_bf, a.min_zoom, a.max_zoom
                FROM territory_area a JOIN territory t ON t.id = a.territory_id
               WHERE t.public_id = ANY(${gebiete as string[]}::uuid[]) AND a.is_active AND t.is_active
               ORDER BY a.id
                 FOR NO KEY UPDATE OF a
          `
        : await sql<Flaeche[]>`
              SELECT a.id::text, a.public_id::text, a.revision::int AS revision, a.updated_at, ST_AsGeoJSON(a.geom, 15) AS geojson,
                     t.public_id::text AS territory, ST_Area(a.geom) AS groesse, a.valid_from_bf, a.valid_to_bf, a.min_zoom, a.max_zoom
                FROM territory_area a JOIN territory t ON t.id = a.territory_id
               WHERE t.public_id = ANY(${gebiete as string[]}::uuid[]) AND a.is_active AND t.is_active
               ORDER BY a.id
          `;
}

/** Welche Flächen einander bis auf den Fangradius berühren, und die Ecken anderer Gebietsflächen, die auf einer Ecke dieser Flächen liegen. */
async function umfeld(
    sql: Queryable,
    flaechen: readonly Flaeche[],
    karte: string,
): Promise<{ beruehrt: [string, string][]; nachbarEcken: Set<string> }> {
    const ids = flaechen.map((f) => f.id);
    const paare = await sql<{ a: string; b: string }[]>`
        SELECT a.public_id::text AS a, b.public_id::text AS b
          FROM territory_area a JOIN territory_area b ON a.id < b.id AND ST_DWithin(a.geom, b.geom, ${FLAECHEN_FANG})
         WHERE a.id = ANY(${ids}::bigint[]) AND b.id = ANY(${ids}::bigint[])
    `;
    // Nur die Ecken der Nachbarn, die auf einer Ecke der gewählten Flächen liegen (wie `landscape-vereinigen.ts`): Nur sie entscheiden. Ganze
    // Nachbarflächen mit `ST_DWithin` von Fläche zu Fläche zu lesen, brauchte an echten Daten über die Zeitgrenze der Anfrage hinaus.
    const ecken = await sql<{ x: number; y: number }[]>`
        WITH eigen AS (
            SELECT DISTINCT round(ST_X(p.geom) * 100000)::bigint AS kx, round(ST_Y(p.geom) * 100000)::bigint AS ky
              FROM territory_area i CROSS JOIN LATERAL ST_DumpPoints(i.geom) AS p
             WHERE i.id = ANY(${ids}::bigint[])
        ), rahmen AS (
            SELECT ST_Expand(ST_Extent(i.geom), ${FLAECHEN_FANG}::float8) AS kasten FROM territory_area i WHERE i.id = ANY(${ids}::bigint[])
        )
        SELECT DISTINCT ST_X(p.geom) AS x, ST_Y(p.geom) AS y
          FROM territory_area n
          JOIN territory t ON t.id = n.territory_id
          CROSS JOIN rahmen
          CROSS JOIN LATERAL ST_DumpPoints(n.geom) AS p
          JOIN eigen e ON e.kx = round(ST_X(p.geom) * 100000)::bigint AND e.ky = round(ST_Y(p.geom) * 100000)::bigint
         WHERE n.is_active AND t.is_active AND n.map_domain_id = ${karte} AND NOT (n.id = ANY(${ids}::bigint[]))
           AND n.geom && rahmen.kasten
    `;
    const nachbarEcken = new Set(ecken.map((e) => schluessel([e.x, e.y])));
    return { beruehrt: paare.map((p) => [p.a, p.b] as [string, string]), nachbarEcken };
}

type Rechnung =
    | {
          readonly geht: true;
          readonly vorlage: string;
          readonly flaechen: readonly Flaeche[];
          readonly traeger: readonly Traeger[];
          readonly weg: readonly string[];
      }
    | { readonly geht: false; readonly grund: FlaechenVereinigenGrund; readonly flaechen: readonly Flaeche[] };

const zeitVon = (x: {
    valid_from_bf: number | null;
    valid_to_bf: number | null;
    min_zoom?: number | null;
    max_zoom?: number | null;
}): string => JSON.stringify([x.valid_from_bf, x.valid_to_bf, x.min_zoom ?? null, x.max_zoom ?? null]);

async function rechne(
    sql: Queryable,
    gebiete: readonly Gebiet[],
    vorlage: string | undefined,
    sperren: boolean,
): Promise<Rechnung> {
    const nicht = (grund: FlaechenVereinigenGrund, flaechen: readonly Flaeche[] = []): Rechnung => ({
        geht: false,
        grund,
        flaechen,
    });
    if (gebiete.length < 2) return nicht("anzahl");
    const erstes = gebiete[0]!;
    if (gebiete.some((g) => !g.is_active || g.map_domain_id !== erstes.map_domain_id)) return nicht("karte");
    if (gebiete.some((g) => g.territory_type !== erstes.territory_type || g.parent_id !== erstes.parent_id))
        return nicht("art");
    if (new Set(gebiete.map(zeitVon)).size > 1) return nicht("zeit");
    const flaechen = await leseFlaechen(
        sql,
        gebiete.map((g) => g.public_id),
        sperren,
    );
    if (gebiete.some((g) => !flaechen.some((f) => f.territory === g.public_id))) return nicht("leer", flaechen);
    if (new Set(flaechen.map(zeitVon)).size > 1) return nicht("zeit", flaechen);
    const gewaehlt = vorlage ?? erstes.public_id;
    const { beruehrt, nachbarEcken } = await umfeld(sql, flaechen, erstes.map_domain_id);
    const teile: Teilflaeche[] = flaechen.map((f) => ({
        id: f.public_id,
        besitzer: f.territory,
        polygone: polygoneVon(f.geojson),
        groesse: f.groesse,
    }));
    const plan = await planeVereinigung(sql, { flaechen: teile, beruehrt, vorlage: gewaehlt, nachbarEcken });
    if (!plan.geht) return nicht(plan.grund, flaechen);
    return { geht: true, vorlage: gewaehlt, flaechen, traeger: plan.traeger, weg: plan.weg };
}

/** `GET …/vereinigen?ids=`: geht es, sonst der Grund; dazu die gelesenen Revisionen, gegen die das Schreiben läuft. */
export async function pruefeGebieteVereinigen(
    database: Database,
    ids: readonly string[],
): Promise<FlaechenVereinigenPruefung> {
    const genannt = [...new Set(ids)];
    const gebiete = await leseGebiete(database, genannt, false);
    const je = new Map(gebiete.map((g) => [g.public_id, g] as const));
    const rechnung =
        gebiete.length === genannt.length
            ? await rechne(
                  database,
                  genannt.map((id) => je.get(id)!),
                  undefined,
                  false,
              )
            : ({ geht: false, grund: "karte", flaechen: [] } as const);
    const objekte = genannt.flatMap((id) => {
        const g = je.get(id);
        return g === undefined
            ? []
            : [
                  {
                      publicId: id,
                      revision: g.revision,
                      name: g.name,
                      art: g.territory_type ?? "",
                      flaechen: rechnung.flaechen.filter((f) => f.territory === id).length,
                  },
              ];
    });
    return rechnung.geht ? { geht: true, objekte, vorlagen: genannt } : { geht: false, grund: rechnung.grund, objekte };
}

export const GEBIET_GRUND_TEXT: Readonly<Record<FlaechenVereinigenGrund, string>> = {
    anzahl: "Vereinigt werden mindestens zwei Gebiete.",
    karte: "Eines der Gebiete ist nicht auf der Karte.",
    art: "Vereinigt werden nur Gebiete derselben Art unter demselben Obergebiet.",
    leer: "Eines der Gebiete hat keine Fläche auf der Karte.",
    nachbar: "Ein Nachbargebiet verlöre seine gemeinsame Grenze.",
    kraftlinie: "An einer Beschriftung endet eine Kraftlinie.",
    zeit: "Die Gebiete oder ihre Flächen gelten zu verschiedenen Zeiten oder Zoomstufen.",
};

/** `territory.merge` (`POST …/vereinigen`): die Vorlage bekommt die vereinigte Form, die übrigen Gebiete verlieren ihre Flächen. */
export async function vereinigeGebiete(
    database: Database,
    actor: MapActor,
    body: FlaechenVereinigenBody,
): Promise<FlaechenVereinigenReceipt> {
    const ids = [...new Set(body.objects.map((o) => o.publicId))].sort();
    if (!ids.includes(body.vorlage))
        throw new ApiError(400, "validation_failed", "Die Vorlage gehört nicht zu den gewählten Gebieten.", {
            field: "vorlage",
        });
    const [vorab] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM territory WHERE public_id = ${body.vorlage}::uuid
    `;
    if (vorab === undefined) throw new ApiError(404, "not_found", "Dieses Gebiet gibt es nicht.");
    const quittung = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "territory.merge", mapDomainId: vorab.map_domain_id, body },
        async (tx) => {
            const gebiete = await leseGebiete(tx, ids, true);
            if (gebiete.length !== ids.length) throw new ApiError(404, "not_found", "Eines der Gebiete gibt es nicht.");
            const basis = new Map(body.objects.map((o) => [o.publicId, o.baseRevision] as const));
            const anders = gebiete.find((g) => basis.get(g.public_id) !== g.revision);
            if (anders !== undefined)
                throw await mapEditConflict(
                    tx,
                    { kind: "territory", publicId: anders.public_id },
                    { revision: anders.revision, changedAt: anders.updated_at },
                );
            await pruefeFremdeGebietssperre(tx, actor, ids);
            const rechnung = await rechne(tx, gebiete, body.vorlage, true);
            if (!rechnung.geht)
                throw new ApiError(400, "validation_failed", GEBIET_GRUND_TEXT[rechnung.grund], {
                    field: "objects",
                    grund: rechnung.grund,
                });
            const vorlage = gebiete.find((g) => g.public_id === body.vorlage)!;
            const flaeche = new Map(rechnung.flaechen.map((f) => [f.public_id, f] as const));
            const affected: FlaechenVereinigenReceipt["affected"][number][] = gebiete.map((g) => ({
                kind: GEBIET_ART,
                id: g.public_id,
                revision: g.revision,
            }));
            const entries: MapAuditEntry[] = [];
            for (const t of rechnung.traeger) {
                const zeile = flaeche.get(t.id)!;
                const [neu] = await tx<{ revision: number }[]>`
                    UPDATE territory_area
                       SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(t.nachher)}), 0))
                     WHERE public_id = ${t.id}::uuid AND revision = ${zeile.revision}
                    RETURNING revision::int AS revision
                `;
                if (neu === undefined)
                    throw await mapEditConflict(
                        tx,
                        { kind: "territory_area", publicId: t.id },
                        { revision: zeile.revision, changedAt: zeile.updated_at },
                    );
                affected.push({ kind: GEBIETSFLAECHE_ART, id: t.id, revision: neu.revision });
                entries.push({
                    action: "territory_area.merged",
                    territoryId: vorlage.public_id,
                    territoryAreaId: t.id,
                    revisionBefore: zeile.revision,
                    revisionAfter: neu.revision,
                    changes: { geometry: { before: ringe(t.vorher), after: ringe(t.nachher) } },
                });
            }
            for (const id of rechnung.weg) {
                const zeile = flaeche.get(id)!;
                const [still] = await tx<{ revision: number }[]>`
                    UPDATE territory_area SET is_active = FALSE
                     WHERE public_id = ${id}::uuid AND revision = ${zeile.revision}
                    RETURNING revision::int AS revision
                `;
                if (still === undefined)
                    throw await mapEditConflict(
                        tx,
                        { kind: "territory_area", publicId: id },
                        { revision: zeile.revision, changedAt: zeile.updated_at },
                    );
                affected.push({ kind: GEBIETSFLAECHE_ART, id, revision: still.revision });
                entries.push({
                    action: "territory_area.retired",
                    territoryId: zeile.territory,
                    territoryAreaId: id,
                    revisionBefore: zeile.revision,
                    revisionAfter: still.revision,
                    changes: { active: { before: true, after: false } },
                });
            }
            const andere = gebiete.filter((g) => g.public_id !== vorlage.public_id).map((g) => g.name);
            return {
                receipt: { affected, derivedWork: [], warnings: [] },
                summary: `${vorlage.name}: mit ${andere.join(", ")} vereinigt`,
                entries,
            };
        },
    );
    return { ...quittung, publicId: body.vorlage };
}
