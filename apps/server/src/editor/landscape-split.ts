import { randomUUID } from "node:crypto";
import type { LandscapeSplitBody, LandscapeSplitReceipt } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { schneide } from "./flaechen-rechnung.ts";
import { leseZeilen } from "./landscape-boolean.ts";
import { legeLandschaftAn } from "./landscape-create.ts";
import { pruefeFremdeSperre } from "./landscape-reshape.ts";
import { GELAENDE_VERALTET, speistGelaende } from "./landscape-update.ts";
import { LANDSCHAFT_ART, mapOperation, TEILFLAECHE_ART, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import { geojsonAus, polygoneVon, ringe, type Punkt } from "./ring-form.ts";

/**
 * „Zerschneiden“ (Werkzeug 5, Betreiber 2026-10-19; Vertrag `LandscapeSplitBody` in `packages/shared/src/landscape-editor.ts`). Wie
 * Legacy (Mirror 5ff58118, `map-features-ecosystem-boolean.js` `ecosystemSplitGeometry`, `geometry-ops.js#L540-L580`), aber exakt:
 *
 * - **Schnitt** mit `ST_Split` je Teil der Teilfläche an der Linie, wie sie gezeichnet ist (keine Verlängerung, kein Abstand): Die
 *   Stücke teilen die Schnittkante Ecke für Ecke. Ein Teil, den die Linie nicht ganz quert, bleibt, wie er ist.
 * - **Was bleibt:** von jedem geschnittenen Teil das größte Stück, dazu alle ungeschnittenen Teile. Alle übrigen Stücke werden EINE
 *   neue Landschaft (ganz vorn) mit Name, Ebene und Art der Quelle (Legacy: „Der grösste Teil bleibt; alles andere wandert gemeinsam
 *   in die neue Fläche“; statt Legacys Platzhalter der Name der Quelle, Editor-Orchestrierung 2026-10-19: „teilen und trennen“ meint
 *   dieselbe Landschaft in zwei Teilen).
 * - **Kein Schnitt** (die Linie trennt nichts ganz ab): 400 mit Legacys Satz; nichts ist geschrieben.
 * - EINE Operation gegen die Revision der Teilfläche und die Sperre ihrer Landschaft; ↺ im Verlauf wie bei den Werkzeugen 1 und 3
 *   (`restoreBoolean`).
 */

export async function splitLandscape(
    database: Database,
    actor: MapActor,
    regionId: string,
    body: LandscapeSplitBody,
): Promise<LandscapeSplitReceipt> {
    const vorab = (await leseZeilen(database, [body.areaId], false)).get(body.areaId);
    if (vorab === undefined || vorab.region !== regionId)
        throw new ApiError(404, "not_found", "Diese Landschaft hat keine solche Teilfläche.");
    const neueId = randomUUID();
    const neueTeilId = randomUUID();
    let neu: { publicId: string; name: string } | undefined;

    const receipt = await mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "landscape.split",
            mapDomainId: vorab.map_domain_id,
            body: { regionId, ...body },
        },
        async (tx) => {
            const quelle = (await leseZeilen(tx, [body.areaId], true)).get(body.areaId);
            if (quelle === undefined || quelle.region !== regionId)
                throw new ApiError(404, "not_found", "Diese Landschaft hat keine solche Teilfläche.");
            if (quelle.revision !== body.baseRevision)
                throw await mapEditConflict(
                    tx,
                    { kind: "area", publicId: quelle.public_id },
                    { revision: quelle.revision, changedAt: quelle.updated_at },
                );
            await pruefeFremdeSperre(tx, actor, [quelle.region]);

            const r = await schneide(tx, tx`SELECT geom FROM region_area WHERE id = ${quelle.id}::bigint`, body.line);

            const bleibt = polygoneVon(r.bleibt);
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE region_area
                   SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(bleibt)}), 0),
                       geometry_revision = COALESCE(geometry_revision, 0) + 1
                 WHERE id = ${quelle.id}::bigint AND revision = ${body.baseRevision}
                RETURNING revision::int AS revision
            `;
            const angelegt = await legeLandschaftAn(tx, {
                domain: quelle.map_domain_id,
                publicId: neueId,
                areaId: neueTeilId,
                layer: quelle.region_layer,
                type: quelle.region_type,
                polygone: polygoneVon(r.geht) as Punkt[][][],
                name: quelle.region_name,
            });
            neu = { publicId: neueId, name: angelegt.name };
            const entries: MapAuditEntry[] = [
                {
                    action: "area.split",
                    regionId: quelle.region,
                    areaId: quelle.public_id,
                    revisionBefore: quelle.revision,
                    revisionAfter: geschrieben!.revision,
                    changes: { geometry: { before: ringe(polygoneVon(quelle.geojson)), after: ringe(bleibt) } },
                },
                ...angelegt.entries,
            ];
            return {
                receipt: {
                    affected: [
                        { kind: LANDSCHAFT_ART, id: quelle.region, revision: quelle.region_revision },
                        { kind: TEILFLAECHE_ART, id: quelle.public_id, revision: geschrieben!.revision },
                        ...angelegt.affected,
                    ],
                    derivedWork: [],
                    warnings: speistGelaende(quelle.region_layer, quelle.region_type) ? [GELAENDE_VERALTET] : [],
                },
                summary: `${quelle.region_name}: zerschnitten, das Stück als eigene Landschaft`,
                entries,
            };
        },
    );
    return { ...receipt, ...(neu ?? {}) };
}
