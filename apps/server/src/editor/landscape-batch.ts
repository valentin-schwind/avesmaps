import {
    isTerrainFrame,
    landscapeTypeFits,
    type EditorLandscapeLayer,
    type LandscapeBatchBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { pruefeFremdeSperre } from "./landscape-reshape.ts";
import { GELAENDE_VERALTET, leseRegion, schreibeFelder, speistGelaende, type RegionZeile } from "./landscape-update.ts";
import { mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { gipfelSchreiben, leseGipfel } from "./peak-update.ts";

/**
 * Die Mehrfachauswahl der Derographie (EDIT-0003 T57; Betreiber 2026-10-19 zu Fassung 5 der Gebiete: „perfekt genau das wollen wir“;
 * Vertrag `LandscapeBatchBody`): Ebene, Art und „Verbergen“ für alle gewählten Landschaften als EINE Operation `landscape.batch`.
 *
 * - **Dieselben Regeln wie an einer Landschaft** (`schreibeFelder` aus `landscape-update.ts`): Eine neue Ebene kommt mit einer Art aus
 *   ihr, die Art muss zur Ebene passen, in einer neuen Ebene steht die Landschaft oben, die Beschriftungen, deren Namensart der alten Art
 *   folgte, bekommen die neue. Der Kontinent „Aventurien“ rahmt das Gelände und behält Ebene und Art (400).
 * - **Gegen den Stand beim Schreiben:** Die Auswahl ist flüchtig und kennt keine Revisionen; Sperren anderer gelten wie immer.
 * - **↺** (`ruecknahme-flaeche.ts`, WI-0265 B6c, über `POST …/:id/restore-series` jeder der Landschaften): alle zurück auf ihre Werte von vorher, wenn seither
 *   niemand eine von ihnen geändert hat; sonst 409.
 * - **Gipfel und Vulkane** (`peaks`, Stage-Fund 2026-10-19: drei angehakte Vulkane ließen das Fenster leer): Mit ihnen geht nur
 *   „Besucher“, geschrieben als Merkmal „verborgen“ über denselben Schreibweg wie am Gipfel (`gipfelSchreiben`, gegen seinen Stand
 *   beim Schreiben); Ebene und Art tragen Gipfel nicht (400). ↺ holt sie mit zurück.
 */

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

/** Was eine Landschaft danach trägt; `undefined`, wenn die Änderung an ihr nicht geht (mit dem Satz). */
function felderNach(region: RegionZeile, changes: LandscapeBatchBody["changes"]) {
    const layer: EditorLandscapeLayer = changes.layer ?? region.region_layer;
    const type = changes.type ?? region.region_type;
    if (layer !== region.region_layer && changes.type === undefined)
        throw ungueltig("Eine neue Ebene braucht eine Art aus ihr.", { field: "type" });
    if (changes.type !== undefined && !landscapeTypeFits(layer, changes.type))
        throw ungueltig(`Die Art passt nicht zur Ebene von ${region.name}.`, {
            field: "type",
            layer,
            type: changes.type,
        });
    const rahmen = isTerrainFrame({ name: region.name, layer: region.region_layer, type: region.region_type });
    if (rahmen && (layer !== region.region_layer || type !== region.region_type))
        throw ungueltig("Der Kontinent Aventurien rahmt das Gelände: Ebene und Art bleiben.", { field: "ids" });
    return {
        name: region.name,
        layer,
        type,
        locked: region.is_locked,
        hidden: changes.hidden ?? region.is_hidden,
        curveEnabled: region.label_curve_enabled,
        curveMax: region.label_curve_max,
        hazards: region.hazards,
        order: undefined,
    };
}

async function leseAlle(sql: Database, ids: readonly string[]): Promise<RegionZeile[]> {
    const regionen = await Promise.all(ids.map((id) => leseRegion(sql, id)));
    if (regionen.some((region) => region === undefined))
        throw new ApiError(404, "not_found", "Eine der Landschaften gibt es nicht mehr.");
    const alle = regionen as RegionZeile[];
    if (new Set(alle.map((r) => r.map_domain_id)).size > 1)
        throw ungueltig("Die Landschaften liegen auf verschiedenen Karten.", { field: "ids" });
    return alle;
}

export async function batchLandscapes(
    database: Database,
    actor: MapActor,
    body: LandscapeBatchBody,
): Promise<OperationReceipt> {
    const { changes } = body;
    const gipfel = body.peaks ?? [];
    if (changes.layer === undefined && changes.type === undefined && changes.hidden === undefined)
        throw ungueltig("Die Änderung trägt nichts zu schreiben.", { field: "changes" });
    if (body.ids.length + gipfel.length === 0) throw ungueltig("Die Auswahl ist leer.", { field: "ids" });
    if (gipfel.length > 0 && (changes.layer !== undefined || changes.type !== undefined))
        throw ungueltig("Ebene und Art gelten nur für Flächen.", { field: "peaks" });
    const vorab = await leseAlle(database, body.ids);
    for (const region of vorab) felderNach(region, changes);
    const gipfelVorab = await Promise.all(gipfel.map((id) => leseGipfel(database, id)));
    if (gipfelVorab.some((zeile) => zeile === undefined))
        throw new ApiError(404, "not_found", "Einen der Gipfel gibt es nicht mehr.");
    const karten = new Set([
        ...vorab.map((region) => region.map_domain_id),
        ...gipfelVorab.map((zeile) => zeile!.map_domain_id),
    ]);
    if (karten.size > 1) throw ungueltig("Die Auswahl liegt auf verschiedenen Karten.", { field: "ids" });

    return mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "landscape.batch", mapDomainId: [...karten][0]!, body },
        async (tx) => {
            await pruefeFremdeSperre(tx, actor, body.ids);
            const affected: OperationReceipt["affected"] = [];
            const entries: MapAuditEntry[] = [];
            let gelaende = false;
            for (const id of body.ids) {
                const region = await leseRegion(tx, id);
                if (region === undefined)
                    throw new ApiError(404, "not_found", "Eine der Landschaften gibt es nicht mehr.");
                const neu = felderNach(region, changes);
                const geschrieben = await schreibeFelder(tx, region, region.revision, neu);
                affected.push(...geschrieben.affected);
                entries.push(...geschrieben.entries);
                if (neu.layer !== region.region_layer || neu.type !== region.region_type)
                    gelaende ||=
                        speistGelaende(region.region_layer, region.region_type) || speistGelaende(neu.layer, neu.type);
            }
            // Gipfel: nur „Besucher“, als Merkmal „verborgen“ (oben geprüft: ohne Ebene und Art steht `hidden`). „Nur Gelände“ bleibt, das ist kein Sichtbarkeitsschalter.
            for (const id of gipfel) {
                const jetzt = await leseGipfel(tx, id);
                if (jetzt === undefined) throw new ApiError(404, "not_found", "Einen der Gipfel gibt es nicht mehr.");
                const geschrieben = await gipfelSchreiben(tx, actor, id, jetzt.revision, {
                    merkmale: [
                        ...jetzt.merkmale.filter((merkmal) => merkmal !== "verborgen"),
                        ...(changes.hidden === true ? (["verborgen"] as const) : []),
                    ],
                });
                if (geschrieben === undefined) continue;
                affected.push(...geschrieben.affected);
                entries.push(...geschrieben.entries);
            }
            const teile = [
                ...(changes.layer !== undefined ? ["Ebene"] : []),
                ...(changes.type !== undefined ? ["Art"] : []),
                ...(changes.hidden !== undefined ? [changes.hidden ? "verborgen" : "zurückgeholt"] : []),
            ];
            const wer = [
                ...(body.ids.length > 0 ? [`${String(body.ids.length)} Landschaften`] : []),
                ...(gipfel.length > 0 ? [`${String(gipfel.length)} Gipfel`] : []),
            ];
            return {
                receipt: { affected, derivedWork: [], warnings: gelaende ? [GELAENDE_VERALTET] : [] },
                summary: `${wer.join(", ")}: ${teile.join(", ")}`,
                entries,
                // Verbergen allein geht in keine Ableitung ein (T41, Claudio 2026-10-18): nur die Kachelrevision.
                ...(entries.length > 0 &&
                entries.every((e) => Object.keys(e.changes ?? {}).every((k) => k === "hidden" || k === "showName"))
                    ? { ableitung: false as const }
                    : {}),
            };
        },
    );
}
