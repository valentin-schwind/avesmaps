import { randomUUID } from "node:crypto";
import type { LandscapePartsBody, LandscapePartsOperation, LandscapePartsReceipt } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { rechneTeile } from "./flaechen-rechnung.ts";
import { leseZeilen } from "./landscape-boolean.ts";
import { legeLandschaftAn } from "./landscape-create.ts";
import { pruefeFremdeSperre } from "./landscape-reshape.ts";
import { GELAENDE_VERALTET, speistGelaende } from "./landscape-update.ts";
import { LANDSCHAFT_ART, mapOperation, TEILFLAECHE_ART, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import { geojsonAus, polygoneVon, ringe, type Punkt } from "./ring-form.ts";

/**
 * „Unterflächen ›“ (Werkzeug 3 im Plan der Editor-Orchestrierung 2026-10-19, Thomas 4.1). Wie Legacy (Mirror 5ff58118,
 * `map-features-ecosystem-geometry-ops.js#L580-L760`, `map-features-ecosystem-boolean.js#L270-L310`), nur in PostGIS:
 *
 * - Eine **Unterfläche** ist ein Polygon der Teilfläche (ein Stück einer Fläche aus mehreren Stücken), gezählt ab 0 in der Folge der
 *   gespeicherten Polygone (`ST_Dump`, dieselbe Folge wie im Detail). Alle drei Handgriffe erst ab zwei Teilen.
 * - **vereinigen:** alle Teile mit sich selbst (`ST_UnaryUnion`); getrennt liegende bleiben getrennt. Ändert sich die Zahl nicht, 400
 *   („berühren einander nicht“, Legacy sagt es als Warnung).
 * - **herausloesen:** der Teil wird eine neue Landschaft (ganz vorn) mit Name, Ebene und Art der Quelle (Legacy `createArea`, statt
 *   seines Platzhalters der Name der Quelle, Editor-Orchestrierung 2026-10-19); Löcher reisen mit ihrem Teil.
 * - **loeschen:** der Teil geht, ohne Rückfrage (Owner 2026-07-27: man sieht ihn blau, bevor der Klick fällt).
 * - Sofort geschrieben als EINE Operation gegen die Revision der Teilfläche und die Sperre ihrer Landschaft; ↺ im Verlauf holt sie zurück
 *   (`restoreBoolean`, das beide Werkzeuge kennt).
 */

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

/** So heißt die Operation im Verlauf. */
const WORT: Record<LandscapePartsOperation, string> = {
    vereinigen: "Unterflächen vereinigt",
    herausloesen: "Unterfläche herausgelöst",
    loeschen: "Unterfläche gelöscht",
};

export async function partsLandscape(
    database: Database,
    actor: MapActor,
    regionId: string,
    body: LandscapePartsBody,
): Promise<LandscapePartsReceipt> {
    const vorab = (await leseZeilen(database, [body.areaId], false)).get(body.areaId);
    if (vorab === undefined || vorab.region !== regionId)
        throw new ApiError(404, "not_found", "Diese Landschaft hat keine solche Teilfläche.");
    if (body.operation !== "vereinigen" && body.part === undefined)
        throw ungueltig("Welche Unterfläche? Bitte eine anklicken.", { field: "part" });
    const neueId = randomUUID();
    const neueTeilId = randomUUID();
    let zahlen: { partsBefore: number; partsAfter: number } | undefined;
    let neu: { publicId: string; name: string } | undefined;

    const receipt = await mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "landscape.parts",
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

            const r = await rechneTeile(
                tx,
                tx`SELECT geom FROM region_area WHERE id = ${quelle.id}::bigint`,
                body.operation,
                body.part,
            );
            zahlen = { partsBefore: r.teile, partsAfter: r.rest_teile };

            const rest = polygoneVon(r.rest);
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE region_area
                   SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(rest)}), 0),
                       geometry_revision = COALESCE(geometry_revision, 0) + 1
                 WHERE id = ${quelle.id}::bigint AND revision = ${body.baseRevision}
                RETURNING revision::int AS revision
            `;
            const affected: LandscapePartsReceipt["affected"] = [
                { kind: LANDSCHAFT_ART, id: quelle.region, revision: quelle.region_revision },
                { kind: TEILFLAECHE_ART, id: quelle.public_id, revision: geschrieben!.revision },
            ];
            const entries: MapAuditEntry[] = [
                {
                    action: "area.parts",
                    regionId: quelle.region,
                    areaId: quelle.public_id,
                    revisionBefore: quelle.revision,
                    revisionAfter: geschrieben!.revision,
                    changes: { geometry: { before: ringe(polygoneVon(quelle.geojson)), after: ringe(rest) } },
                },
            ];
            let summary = `${quelle.region_name}: ${WORT[body.operation]}`;
            if (body.operation === "vereinigen") summary += ` (${String(r.teile)} → ${String(r.rest_teile)})`;
            if (body.operation === "herausloesen") {
                const angelegt = await legeLandschaftAn(tx, {
                    domain: quelle.map_domain_id,
                    publicId: neueId,
                    areaId: neueTeilId,
                    layer: quelle.region_layer,
                    type: quelle.region_type,
                    polygone: polygoneVon(r.stueck!) as Punkt[][][],
                    name: quelle.region_name,
                });
                neu = { publicId: neueId, name: angelegt.name };
                affected.push(...angelegt.affected);
                entries.push(...angelegt.entries);
                summary += " als eigene Landschaft";
            }
            return {
                receipt: {
                    affected,
                    derivedWork: [],
                    warnings: speistGelaende(quelle.region_layer, quelle.region_type) ? [GELAENDE_VERALTET] : [],
                },
                summary,
                entries,
            };
        },
    );
    return { ...receipt, ...(zahlen ?? {}), ...(neu ?? {}) };
}
