import { isTerrainFrame, type OperationReceipt } from "@avesmaps3d/shared";
import type { EditorLandscapeLayer, LandscapeBatchRetireBody, LandscapeRetireBody } from "@avesmaps3d/shared";
import { leseGipfel, nimmGipfelWeg, pruefeFremdeGipfelSperre, type GipfelZeile } from "./peak-update.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { GELAENDE_VERALTET, speistGelaende } from "./landscape-update.ts";
import { pruefeFremdeSperre } from "./landscape-reshape.ts";
import { LANDSCHAFT_ART, TEILFLAECHE_ART, mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";

/**
 * „Fläche entfernen …“ einer Derographie-Fläche und sein ↺ (WI-0178 D2; EDIT-0004 §2.6, FL6; EDIT-0003 T43, T54; Claudio 2026-10-18,
 * `2026-10-18-landschaft-entfernen-antwort-an-claudia.md`; Muster Herrschaftsgebiete `territory-retire.ts`).
 *
 * - **`off_map`** nimmt die Fläche von der Karte (`region.is_active` FALSE, `off_map` TRUE), **`retire`** löscht sie weich (beides FALSE).
 *   In derselben Operation gehen ihre aktiven Teilflächen und Beschriftungen mit (`is_active` FALSE): Kacheln, Suche, Kraftlinienknoten
 *   und Gelände lesen nur die Teile (Leser-Erfassung 2026-10-18). Das Protokoll hält jede Zeile; ↺ kehrt genau diese um.
 * - **Abgewiesen:** der Kontinent „Aventurien“ (er rahmt das Gelände, 400); eine Fläche, an deren Beschriftung eine Kraftlinie endet,
 *   auch eine abgenommene (409 `powerline_endpoint`, wie am Kraftlinienpunkt, T52; Claudio, Bedingung C).
 * - **Danach** wie beim Speichern: `label_runs` räumt die Schriftläufe, `land_smooth` die geglätteten Formen, die Kacheln über
 *   `map.changed`; speist die Fläche das Gelände, meldet die Quittung `terrain_stale`.
 * - **↺** (WI-0265 B6c): `ruecknahme-flaeche.ts` (`POST /api/editor/landscapes/:id/restore-series`) macht jede Zeile des Protokolls wieder aktiv, wenn sie noch so steht,
 *   wie die Operation sie hinterließ; sonst 409 `edit_conflict` (etwa wenn der Landschaften-Zug eine gelöschte Fläche schon zurückgeholt hat). Der frühere Weg
 *   `landscape.restore` entfiel.
 * - **Gipfel** (`peaks` der Mehrfachauswahl, Editor-Orchestrierung 2026-10-19): gehen in derselben Operation weich mit
 *   (`peak-update.ts` `nimmGipfelWeg`); `stage` gilt nur für Landschaften. ↺ an einer Landschaft oder einem Gipfel der Operation holt
 *   alles zurück (`ruecknahme-flaeche.ts`, auch für `peak.retire`).
 */

interface RegionZeile {
    id: string;
    public_id: string;
    name: string;
    region_layer: EditorLandscapeLayer;
    region_type: string | null;
    map_domain_id: string;
    revision: number;
    is_active: boolean;
    off_map: boolean;
    updated_at: Date;
}

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

async function leseRegion(sql: Queryable, publicId: string, sperren = false): Promise<RegionZeile | undefined> {
    const [zeile] = sperren
        ? await sql<RegionZeile[]>`
            SELECT id::text AS id, public_id::text AS public_id, name, region_layer, region_type, map_domain_id,
                   revision::int AS revision, is_active, off_map, updated_at
              FROM region WHERE public_id = ${publicId}::uuid AND region_layer <> 'klima' FOR NO KEY UPDATE`
        : await sql<RegionZeile[]>`
            SELECT id::text AS id, public_id::text AS public_id, name, region_layer, region_type, map_domain_id,
                   revision::int AS revision, is_active, off_map, updated_at
              FROM region WHERE public_id = ${publicId}::uuid AND region_layer <> 'klima'`;
    return zeile;
}

/** Die Kraftlinien, die an einer Beschriftung der Fläche enden, auch abgenommene (Claudio, Bedingung C). */
export async function kraftlinienAnFlaeche(tx: Queryable, regionId: string): Promise<string[]> {
    const zeilen = await tx<{ name: string }[]>`
        SELECT DISTINCT coalesce(nullif(p.name, ''), p.public_id::text) AS name
          FROM powerline p JOIN map_label l ON l.public_id IN (p.from_public_id, p.to_public_id)
         WHERE (p.is_active OR p.off_map) AND l.is_active AND l.region_id = ${regionId}::bigint
         ORDER BY 1
    `;
    return zeilen.map((z) => z.name);
}

/**
 * Nimmt EINE Landschaft samt aktiver Teilflächen und Beschriftungen von der Karte (`off_map`) oder löscht sie weich (`retire`), in der
 * Transaktion des Aufrufers; vorher die Prüfung der Kraftlinien. Die Revision prüft der Aufrufer (gesperrt gelesen, `leseRegion`).
 */
async function nimmLandschaftWeg(
    tx: Queryable,
    region: RegionZeile,
    stage: LandscapeRetireBody["stage"],
): Promise<{ affected: OperationReceipt["affected"]; entries: MapAuditEntry[]; gelaende: boolean }> {
    const regionId = region.public_id;
    const linien = await kraftlinienAnFlaeche(tx, region.id);
    if (linien.length > 0)
        throw new ApiError(
            409,
            "powerline_endpoint",
            `An einer Beschriftung von ${region.name} endet eine Kraftlinie (${linien.slice(0, 3).join(", ")}); erst sie umhängen oder entfernen.`,
            { powerlines: linien },
        );
    const abnehmen = stage === "off_map";
    const [neu] = await tx<{ revision: number }[]>`
        UPDATE region SET is_active = FALSE, off_map = ${abnehmen}
         WHERE id = ${region.id}::bigint AND revision = ${region.revision}
        RETURNING revision::int AS revision
    `;
    if (neu === undefined)
        throw await mapEditConflict(
            tx,
            { kind: "region", publicId: regionId },
            { revision: region.revision, changedAt: region.updated_at },
        );
    const affected: OperationReceipt["affected"] = [{ kind: LANDSCHAFT_ART, id: regionId, revision: neu.revision }];
    const entries: MapAuditEntry[] = [
        {
            action: abnehmen ? "region.taken_off_map" : "region.retired",
            regionId,
            revisionBefore: region.revision,
            revisionAfter: neu.revision,
            changes: {
                active: { before: true, after: false },
                ...(abnehmen ? { offMap: { before: false, after: true } } : {}),
            },
        },
    ];
    const flaechen = await tx<{ public_id: string; vorher: number; nachher: number }[]>`
        WITH alt AS (SELECT id, public_id, revision FROM region_area WHERE region_id = ${region.id}::bigint AND is_active)
        UPDATE region_area a SET is_active = FALSE FROM alt WHERE a.id = alt.id
        RETURNING alt.public_id::text AS public_id, alt.revision::int AS vorher, a.revision::int AS nachher
    `;
    for (const f of flaechen) {
        affected.push({ kind: TEILFLAECHE_ART, id: f.public_id, revision: f.nachher });
        entries.push({
            action: "area.retired",
            regionId,
            areaId: f.public_id,
            revisionBefore: f.vorher,
            revisionAfter: f.nachher,
            changes: { active: { before: true, after: false } },
        });
    }
    const beschriftungen = await tx<{ public_id: string; vorher: number; nachher: number }[]>`
        WITH alt AS (SELECT id, public_id, revision FROM map_label WHERE region_id = ${region.id}::bigint AND is_active)
        UPDATE map_label l SET is_active = FALSE FROM alt WHERE l.id = alt.id
        RETURNING alt.public_id::text AS public_id, alt.revision::int AS vorher, l.revision::int AS nachher
    `;
    for (const b of beschriftungen) {
        affected.push({ kind: "label", id: b.public_id, revision: b.nachher });
        entries.push({
            action: "label.retired",
            regionId,
            labelId: b.public_id,
            revisionBefore: b.vorher,
            revisionAfter: b.nachher,
            changes: { active: { before: true, after: false } },
        });
    }
    return {
        affected,
        entries,
        gelaende: flaechen.length > 0 && speistGelaende(region.region_layer, region.region_type),
    };
}

/**
 * „Entfernen …“ für alle gewählten Landschaften (Mehrfachauswahl, EDIT-0003 T57): EINE Operation `landscape.retire` über alle, gegen den
 * Stand beim Schreiben; ↺ an einer von ihnen holt alle zurück (`ruecknahme-flaeche.ts`). Der Kontinent „Aventurien“ bleibt (400).
 */
export async function retireLandscapes(
    database: Database,
    actor: MapActor,
    body: LandscapeBatchRetireBody,
): Promise<OperationReceipt> {
    const gipfelIds = body.peaks ?? [];
    if (body.ids.length + gipfelIds.length === 0) throw ungueltig("Die Auswahl ist leer.", { field: "ids" });
    const vorab = await Promise.all(body.ids.map((id) => leseRegion(database, id)));
    if (vorab.some((region) => region === undefined || !region.is_active))
        throw new ApiError(404, "not_found", "Eine der Flächen gibt es nicht mehr.");
    const regionen = vorab as RegionZeile[];
    if (regionen.some((r) => isTerrainFrame({ name: r.name, layer: r.region_layer, type: r.region_type })))
        throw ungueltig("Der Kontinent Aventurien rahmt das Gelände und bleibt.", { field: "ids" });
    const gipfelVorab = await Promise.all(gipfelIds.map((id) => leseGipfel(database, id)));
    if (gipfelVorab.some((gipfel) => gipfel === undefined))
        throw new ApiError(404, "not_found", "Einen der Gipfel gibt es nicht mehr.");
    const karten = new Set([
        ...regionen.map((r) => r.map_domain_id),
        ...(gipfelVorab as GipfelZeile[]).map((g) => g.map_domain_id),
    ]);
    if (karten.size > 1) throw ungueltig("Die Auswahl liegt auf verschiedenen Karten.", { field: "ids" });
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "landscape.retire",
            mapDomainId: [...karten][0]!,
            body,
        },
        async (tx) => {
            await pruefeFremdeSperre(tx, actor, body.ids);
            await pruefeFremdeGipfelSperre(tx, actor, gipfelIds);
            const affected: OperationReceipt["affected"] = [];
            const entries: MapAuditEntry[] = [];
            let gelaende = false;
            for (const id of body.ids) {
                const region = await leseRegion(tx, id, true);
                if (region === undefined || !region.is_active)
                    throw new ApiError(404, "not_found", "Eine der Flächen gibt es nicht mehr.");
                const weg = await nimmLandschaftWeg(tx, region, body.stage);
                affected.push(...weg.affected);
                entries.push(...weg.entries);
                gelaende ||= weg.gelaende;
            }
            for (const id of gipfelIds) {
                const gipfel = await leseGipfel(tx, id, true);
                if (gipfel === undefined) throw new ApiError(404, "not_found", "Einen der Gipfel gibt es nicht mehr.");
                const weg = await nimmGipfelWeg(tx, gipfel);
                affected.push(...weg.affected);
                entries.push(...weg.entries);
            }
            const wer = [
                ...(body.ids.length > 0 ? [`${String(body.ids.length)} Flächen`] : []),
                ...(gipfelIds.length > 0 ? [`${String(gipfelIds.length)} Gipfel`] : []),
            ].join(", ");
            return {
                receipt: { affected, derivedWork: [], warnings: gelaende ? [GELAENDE_VERALTET] : [] },
                summary: `${wer}: ${body.stage === "off_map" && gipfelIds.length === 0 ? "von der Karte genommen" : "gelöscht"}`,
                entries,
            };
        },
    );
}

/** `landscape.retire` (D2): „Von der Karte nehmen“ oder „Ganz löschen“, die Teile gehen mit. */
export async function retireLandscape(
    database: Database,
    actor: MapActor,
    regionId: string,
    body: LandscapeRetireBody,
): Promise<OperationReceipt> {
    const vorab = await leseRegion(database, regionId);
    if (vorab === undefined || !vorab.is_active) throw new ApiError(404, "not_found", "Diese Fläche gibt es nicht.");
    if (isTerrainFrame({ name: vorab.name, layer: vorab.region_layer, type: vorab.region_type }))
        throw ungueltig("Der Kontinent Aventurien rahmt das Gelände und bleibt.", { field: "stage" });

    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "landscape.retire",
            mapDomainId: vorab.map_domain_id,
            body: { regionId, ...body },
        },
        async (tx) => {
            const region = await leseRegion(tx, regionId, true);
            if (region === undefined || !region.is_active)
                throw new ApiError(404, "not_found", "Diese Fläche gibt es nicht.");
            if (region.revision !== body.baseRevision)
                throw await mapEditConflict(
                    tx,
                    { kind: "region", publicId: regionId },
                    { revision: region.revision, changedAt: region.updated_at },
                );
            await pruefeFremdeSperre(tx, actor, [regionId]);
            const weg = await nimmLandschaftWeg(tx, region, body.stage);
            return {
                receipt: { affected: weg.affected, derivedWork: [], warnings: weg.gelaende ? [GELAENDE_VERALTET] : [] },
                summary: `${region.name}: ${body.stage === "off_map" ? "von der Karte genommen" : "gelöscht"}`,
                entries: weg.entries,
            };
        },
    );
}
