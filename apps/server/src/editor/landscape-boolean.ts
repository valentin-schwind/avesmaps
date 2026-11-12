import {
    landscapeBooleanConsumesTarget,
    type EditorLandscapeLayer,
    type LandscapeBooleanBody,
    type LandscapeBooleanOperation,
    type LandscapeBooleanPreview,
    type LandscapeBooleanPreviewBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { pruefeVerknuepfung, verknuepfung } from "./flaechen-rechnung.ts";
import { kraftlinienAnFlaeche } from "./landscape-retire.ts";
import { pruefeFremdeSperre } from "./landscape-reshape.ts";
import { GELAENDE_VERALTET, speistGelaende } from "./landscape-update.ts";
import { LANDSCHAFT_ART, mapOperation, TEILFLAECHE_ART, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import { geojsonAus, polygoneVon, ringe, type Punkt } from "./ring-form.ts";

/**
 * „Mit anderer Fläche ›“ (Werkzeug 1 im Plan der Editor-Orchestrierung 2026-10-19, Thomas 4.1: „Mehrere Landschaftsflächen miteinander
 * vereinigen“). Wie Legacy (Mirror 5ff58118, `map-features-ecosystem-boolean.js`, `geometry-ops.js#L507-L546`), nur in PostGIS statt
 * `polygon-clipping` im Browser:
 *
 * - Die Teilfläche, an der das Menü steht (Quelle), bekommt die neue Form: ∪ bei „vereinigen“, Quelle ohne Ziel bei „ausschneiden“, ∩ bei
 *   „schnittmenge“; die „… behalten“-Fassungen rechnen wie ihr Original. Das Ergebnis darf mehrere Polygone und Löcher haben (Exklave,
 *   Enklave), wie in Legacy.
 * - **Plausibel** wie Legacy (`assertEcosystemBooleanPlausible`): Ein Ergebnis ohne Fläche ist 400; ein Abzug, der wächst, eine
 *   Schnittmenge größer als eine der beiden, eine Vereinigung kleiner als die größere sind Rechenfehler, nie ein Ergebnis.
 * - Quelle und Ziel sind zwei verschiedene, aktive Teilflächen derselben Karte; ob sie in derselben Ebene liegen, entscheidet die Zielwahl
 *   (nur sichtbare Flächen, Legacy seit 09.10.2026 ohne Ebenen-Sperre).
 * - **Sofort geschrieben** als EINE Operation gegen beide Revisionen und Sperren; ↺ im Verlauf holt beides zurück (`ruecknahme-flaeche.ts`, WI-0265 B6c).
 *   Editor-Orchestrierung 2026-10-19: Ausnahme von EDIT-0003 G4 wie „Verbergen“, denn ein Ergebnis mit Loch oder mehreren Teilen und das
 *   Wegnehmen einer anderen Landschaft gehören nicht in den Entwurf der ersten.
 */

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

/** So heißt die Operation im Verlauf (die Wörter des Menüs). */
const WORT: Record<LandscapeBooleanOperation, string> = {
    vereinigen: "mit anderer vereinigt",
    "vereinigen-behalten": "mit anderer vereinigt, andere beibehalten",
    ausschneiden: "von anderer ausgeschnitten",
    "ausschneiden-behalten": "von anderer ausgeschnitten, andere beibehalten",
    schnittmenge: "neu von anderer ausgeschnitten",
};

interface Paar {
    quelle_region: string;
    ziel_region: string;
    ziel_name: string;
    quelle_revision: number;
    ziel_revision: number;
    ziel_geojson: string;
    quelle_aktiv: boolean;
    ziel_aktiv: boolean;
    gleiche_karte: boolean;
    ziel_rest: number;
    ergebnis: string | null;
    f_quelle: number;
    f_ziel: number;
    f_ergebnis: number;
}

export interface FlaechenRechnung {
    /** Die neue Form der Quelle: je Polygon die Ringe, ohne Schlusspunkt. */
    readonly polygone: Punkt[][][];
    readonly quelleRegion: string;
    readonly zielRegion: string;
    /** Die andere Teilfläche ist die letzte ihrer Landschaft. */
    readonly zielLetzte: boolean;
    readonly zielPolygone: Punkt[][][];
    readonly zielName: string;
    readonly quelleRevision: number;
    readonly zielRevision: number;
}

/** Rechnet die neue Form der Quelle; wirft 404 ohne die beiden Teilflächen, 400 ohne plausibles Ergebnis. */
export async function rechneFlaechen(
    sql: Queryable,
    operation: LandscapeBooleanOperation,
    areaId: string,
    targetAreaId: string,
): Promise<FlaechenRechnung> {
    if (areaId === targetAreaId) throw ungueltig("Bitte eine andere Fläche wählen.", { field: "targetAreaId" });
    const [paar] = await sql<Paar[]>`
        WITH q AS (
            SELECT a.geom, a.is_active AND r.is_active AS aktiv, a.map_domain_id, r.public_id::text AS region, a.revision
              FROM region_area a JOIN region r ON r.id = a.region_id
             WHERE a.public_id = ${areaId}::uuid
        ), z AS (
            SELECT a.geom, a.is_active AND r.is_active AS aktiv, a.map_domain_id, a.region_id, r.public_id::text AS region,
                   a.revision, r.name
              FROM region_area a JOIN region r ON r.id = a.region_id
             WHERE a.public_id = ${targetAreaId}::uuid
        ), e AS (
            SELECT ${verknuepfung(sql, operation)} AS geom FROM q, z
        )
        SELECT q.region AS quelle_region, z.region AS ziel_region, z.name AS ziel_name, q.revision::int AS quelle_revision,
               z.revision::int AS ziel_revision, ST_AsGeoJSON(z.geom, 15) AS ziel_geojson,
               q.aktiv AS quelle_aktiv, z.aktiv AS ziel_aktiv,
               q.map_domain_id = z.map_domain_id AS gleiche_karte,
               (SELECT count(*)::int FROM region_area x
                 WHERE x.region_id = z.region_id AND x.is_active AND x.public_id <> ${targetAreaId}::uuid) AS ziel_rest,
               CASE WHEN ST_IsEmpty(e.geom) THEN NULL ELSE ST_AsGeoJSON(e.geom, 15) END AS ergebnis,
               ST_Area(q.geom) AS f_quelle, ST_Area(z.geom) AS f_ziel, ST_Area(e.geom) AS f_ergebnis
          FROM q, z, e
    `;
    if (paar === undefined || !paar.quelle_aktiv || !paar.ziel_aktiv)
        throw new ApiError(404, "not_found", "Eine der beiden Flächen gibt es nicht mehr.");
    if (!paar.gleiche_karte) throw ungueltig("Die andere Fläche liegt auf einer anderen Karte.");
    const flaechen = { ergebnis: paar.ergebnis, quelle: paar.f_quelle, ziel: paar.f_ziel, neu: paar.f_ergebnis };
    pruefeVerknuepfung(operation, flaechen);
    return {
        polygone: polygoneVon(flaechen.ergebnis),
        quelleRegion: paar.quelle_region,
        zielRegion: paar.ziel_region,
        zielLetzte: paar.ziel_rest === 0,
        zielPolygone: polygoneVon(paar.ziel_geojson),
        zielName: paar.ziel_name,
        quelleRevision: paar.quelle_revision,
        zielRevision: paar.ziel_revision,
    };
}

/** Die Vorschau (`POST …/:id/boolean-preview`): rechnet für die Quelle dieser Landschaft, schreibt nichts. */
export async function vorschauFlaechen(
    database: Database,
    regionId: string,
    body: LandscapeBooleanPreviewBody,
): Promise<LandscapeBooleanPreview> {
    const rechnung = await rechneFlaechen(database, body.operation, body.areaId, body.targetAreaId);
    if (rechnung.quelleRegion !== regionId)
        throw new ApiError(404, "not_found", "Diese Landschaft hat keine solche Teilfläche.");
    const verschluckt = landscapeBooleanConsumesTarget(body.operation);
    const alsListe = (polygone: Punkt[][][]): [number, number][][][] =>
        polygone.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x, y])));
    return {
        polygons: alsListe(rechnung.polygone),
        targetPolygons: alsListe(rechnung.zielPolygone),
        areaRevision: rechnung.quelleRevision,
        targetAreaRevision: rechnung.zielRevision,
        targetName: rechnung.zielName,
        consumesTarget: verschluckt,
        targetLandscapeGoes: verschluckt && rechnung.zielLetzte && rechnung.zielRegion !== regionId,
    };
}

export interface Zeile {
    id: string;
    public_id: string;
    revision: number;
    updated_at: Date;
    geojson: string;
    region_id: string;
    region: string;
    region_name: string;
    region_revision: number;
    region_layer: EditorLandscapeLayer;
    region_type: string | null;
    map_domain_id: string;
}

export async function leseZeilen(
    sql: Queryable,
    ids: readonly string[],
    sperren: boolean,
): Promise<Map<string, Zeile>> {
    const zeilen = sperren
        ? await sql<Zeile[]>`
              SELECT a.id::text, a.public_id::text, a.revision::int AS revision, a.updated_at, ST_AsGeoJSON(a.geom, 15) AS geojson,
                     r.id::text AS region_id, r.public_id::text AS region, r.name AS region_name,
                     r.revision::int AS region_revision, r.region_layer, r.region_type, a.map_domain_id
                FROM region_area a JOIN region r ON r.id = a.region_id
               WHERE a.public_id = ANY(${ids as string[]}::uuid[]) AND a.is_active AND r.is_active
                 FOR NO KEY UPDATE OF a
          `
        : await sql<Zeile[]>`
              SELECT a.id::text, a.public_id::text, a.revision::int AS revision, a.updated_at, ST_AsGeoJSON(a.geom, 15) AS geojson,
                     r.id::text AS region_id, r.public_id::text AS region, r.name AS region_name,
                     r.revision::int AS region_revision, r.region_layer, r.region_type, a.map_domain_id
                FROM region_area a JOIN region r ON r.id = a.region_id
               WHERE a.public_id = ANY(${ids as string[]}::uuid[]) AND a.is_active AND r.is_active
          `;
    return new Map(zeilen.map((z) => [z.public_id, z]));
}

type Wechsel = { vorher: number; nachher: number };

/** Endet an einer Beschriftung dieser Landschaft eine Kraftlinie, darf sie nicht mitgehen (wie „Fläche entfernen“): 409. */
export async function pruefeKraftlinien(tx: Queryable, zeile: Zeile): Promise<void> {
    const linien = await kraftlinienAnFlaeche(tx, zeile.region_id);
    if (linien.length > 0)
        throw new ApiError(
            409,
            "powerline_endpoint",
            `An einer Beschriftung von ${zeile.region_name} endet eine Kraftlinie (${linien.slice(0, 3).join(", ")}); erst sie umhängen oder entfernen.`,
            { powerlines: linien },
        );
}

/**
 * Nimmt eine Teilfläche von der Karte und, mit `mitLandschaft` (sie war die letzte ihrer Landschaft), die Landschaft samt Beschriftungen
 * (Legacy `geometry-ops.js#L202-L217`, wie „Fläche entfernen“; vorher `pruefeKraftlinien`). Quittung und Protokoll kommen zu `affected`
 * und `entries`. Für „vereinigen“, „ausschneiden“ (Werkzeug 1) und „Originalfläche löschen“ beim Kopieren (Werkzeug 8).
 */
export async function nimmTeilflaecheWeg(
    tx: Queryable,
    zeile: Zeile,
    mitLandschaft: boolean,
    affected: OperationReceipt["affected"],
    entries: MapAuditEntry[],
): Promise<void> {
    const [weg] = await tx<{ revision: number }[]>`
        UPDATE region_area SET is_active = FALSE WHERE id = ${zeile.id}::bigint RETURNING revision::int AS revision
    `;
    if (!affected.some((x) => x.kind === LANDSCHAFT_ART && x.id === zeile.region))
        affected.push({ kind: LANDSCHAFT_ART, id: zeile.region, revision: zeile.region_revision });
    affected.push({ kind: TEILFLAECHE_ART, id: zeile.public_id, revision: weg!.revision });
    entries.push({
        action: "area.retired",
        regionId: zeile.region,
        areaId: zeile.public_id,
        revisionBefore: zeile.revision,
        revisionAfter: weg!.revision,
        changes: { active: { before: true, after: false } },
    });
    if (!mitLandschaft) return;
    const [region] = await tx<{ revision: number }[]>`
        UPDATE region SET is_active = FALSE WHERE id = ${zeile.region_id}::bigint RETURNING revision::int AS revision
    `;
    const i = affected.findIndex((x) => x.kind === LANDSCHAFT_ART && x.id === zeile.region);
    affected[i] = { kind: LANDSCHAFT_ART, id: zeile.region, revision: region!.revision };
    entries.push({
        action: "region.retired",
        regionId: zeile.region,
        revisionBefore: zeile.region_revision,
        revisionAfter: region!.revision,
        changes: { active: { before: true, after: false } },
    });
    const beschriftungen = await tx<({ public_id: string } & Wechsel)[]>`
        WITH alt AS (SELECT id, public_id, revision FROM map_label WHERE region_id = ${zeile.region_id}::bigint AND is_active)
        UPDATE map_label l SET is_active = FALSE FROM alt WHERE l.id = alt.id
        RETURNING alt.public_id::text AS public_id, alt.revision::int AS vorher, l.revision::int AS nachher
    `;
    for (const b of beschriftungen) {
        affected.push({ kind: "label", id: b.public_id, revision: b.nachher });
        entries.push({
            action: "label.retired",
            regionId: zeile.region,
            labelId: b.public_id,
            revisionBefore: b.vorher,
            revisionAfter: b.nachher,
            changes: { active: { before: true, after: false } },
        });
    }
}

/**
 * `landscape.boolean` (`POST …/:id/boolean`): Die Quelle bekommt die neue Form, gegen ihre Revision; „vereinigen“ und „ausschneiden“
 * nehmen die andere Teilfläche von der Karte, und war sie die letzte ihrer Landschaft, die Landschaft samt Beschriftungen (wie Legacy
 * `geometry-ops.js#L202-L217`; wie „Fläche entfernen“, darum auch dieselbe Prüfung der Kraftlinien). EINE Operation, beide Landschaften
 * unter der Sperre (EDIT-0003 §4).
 */
export async function booleanLandscape(
    database: Database,
    actor: MapActor,
    regionId: string,
    body: LandscapeBooleanBody,
): Promise<OperationReceipt> {
    const vorab = await rechneFlaechen(database, body.operation, body.areaId, body.targetAreaId);
    if (vorab.quelleRegion !== regionId)
        throw new ApiError(404, "not_found", "Diese Landschaft hat keine solche Teilfläche.");
    const quelleVorab = (await leseZeilen(database, [body.areaId], false)).get(body.areaId)!;

    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "landscape.boolean",
            mapDomainId: quelleVorab.map_domain_id,
            body: { regionId, ...body },
        },
        async (tx) => {
            const zeilen = await leseZeilen(tx, [body.areaId, body.targetAreaId], true);
            const quelle = zeilen.get(body.areaId);
            const ziel = zeilen.get(body.targetAreaId);
            if (quelle === undefined || ziel === undefined)
                throw new ApiError(404, "not_found", "Eine der beiden Flächen gibt es nicht mehr.");
            for (const [zeile, basis] of [
                [quelle, body.baseRevision],
                [ziel, body.targetBaseRevision],
            ] as const)
                if (zeile.revision !== basis)
                    throw await mapEditConflict(
                        tx,
                        { kind: "area", publicId: zeile.public_id },
                        { revision: zeile.revision, changedAt: zeile.updated_at },
                    );
            await pruefeFremdeSperre(tx, actor, [...new Set([quelle.region, ziel.region])]);
            const rechnung = await rechneFlaechen(tx, body.operation, body.areaId, body.targetAreaId);
            const verschluckt = landscapeBooleanConsumesTarget(body.operation);
            const mitLandschaft = verschluckt && rechnung.zielLetzte && ziel.region !== quelle.region;
            if (mitLandschaft) await pruefeKraftlinien(tx, ziel);

            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE region_area
                   SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(rechnung.polygone)}), 0),
                       geometry_revision = COALESCE(geometry_revision, 0) + 1
                 WHERE public_id = ${body.areaId}::uuid AND revision = ${body.baseRevision}
                RETURNING revision::int AS revision
            `;
            const affected: OperationReceipt["affected"] = [
                { kind: LANDSCHAFT_ART, id: quelle.region, revision: quelle.region_revision },
                { kind: TEILFLAECHE_ART, id: body.areaId, revision: geschrieben!.revision },
            ];
            const entries: MapAuditEntry[] = [
                {
                    action: "area.boolean",
                    regionId: quelle.region,
                    areaId: body.areaId,
                    revisionBefore: quelle.revision,
                    revisionAfter: geschrieben!.revision,
                    changes: {
                        geometry: { before: ringe(polygoneVon(quelle.geojson)), after: ringe(rechnung.polygone) },
                    },
                },
            ];
            if (verschluckt) await nimmTeilflaecheWeg(tx, ziel, mitLandschaft, affected, entries);
            const gelaende =
                speistGelaende(quelle.region_layer, quelle.region_type) ||
                (verschluckt && speistGelaende(ziel.region_layer, ziel.region_type));
            return {
                receipt: { affected, derivedWork: [], warnings: gelaende ? [GELAENDE_VERALTET] : [] },
                summary: `${quelle.region_name}: ${WORT[body.operation]} (${ziel.region_name})`,
                entries,
            };
        },
    );
}
