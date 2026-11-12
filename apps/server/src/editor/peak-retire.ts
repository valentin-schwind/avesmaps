import type { OperationReceipt, PeakRetireBody } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { mapOperation, type MapActor } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import { leseGipfel, nimmGipfelWeg, pruefeFremdeGipfelSperre } from "./peak-update.ts";

/**
 * „Gipfel entfernen …“ und sein ↺ (Editor-Orchestrierung 2026-10-19 nach den Stage-Funden zur Mehrfachauswahl: „Gipfel lassen sich nicht
 * entfernen“; Vertrag `editor-peaks.ts`). Wie „Fläche entfernen“ (`landscape-retire.ts`), aber ohne „Von der Karte nehmen“: Ein Gipfel
 * ist ein Punkt ohne Teile.
 *
 * - **Weich:** `terrain_peak.is_active` FALSE, eine Protokollzeile `peak.retired`. Kacheln, Liste der Gebirge, Gelände und Suche lesen nur
 *   aktive Gipfel; der Gelöschte bleibt mit Namen, Höhe und Wiki-Zuordnung stehen.
 * - **Gelände:** Die Operation meldet den Gipfel unter `affected`; die Schreibnaht sieht ihn aus dem Eingabeindex verschwinden und reiht
 *   das Gelände im Umkreis ein (`gelaende-folgen.ts`), wie beim Verschieben.
 * - **Abgewiesen:** Hält ein anderer den Gipfel, 409 `object_locked`; ein anderer Stand als `baseRevision`, 409 `edit_conflict`.
 * - **↺** (WI-0265 B6c): `ruecknahme-gipfel.ts` (`POST /api/editor/peaks/:id/restore-series`); es holt auch ein „Entfernen …“ der Mehrfachauswahl samt seiner
 *   Landschaften zurück. Der frühere Weg `peak.restore` entfiel mit ihm.
 */

const nichtDa = (): ApiError => new ApiError(404, "not_found", "Diesen Gipfel gibt es nicht.");

/** `peak.retire`: „Gipfel entfernen …“ an EINEM Gipfel. */
export async function retirePeak(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: PeakRetireBody,
): Promise<OperationReceipt> {
    const vorab = await leseGipfel(database, publicId);
    if (vorab === undefined) throw nichtDa();
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "peak.retire",
            mapDomainId: vorab.map_domain_id,
            body: { peakId: publicId, ...body },
        },
        async (tx) => {
            const gipfel = await leseGipfel(tx, publicId, true);
            if (gipfel === undefined) throw nichtDa();
            if (gipfel.revision !== body.baseRevision)
                throw await mapEditConflict(
                    tx,
                    { kind: "peak", publicId },
                    { revision: gipfel.revision, changedAt: gipfel.updated_at },
                );
            await pruefeFremdeGipfelSperre(tx, actor, [publicId]);
            const weg = await nimmGipfelWeg(tx, gipfel);
            return {
                receipt: { affected: weg.affected, derivedWork: [], warnings: [] },
                summary: `${gipfel.name}: gelöscht`,
                entries: weg.entries,
            };
        },
    );
}
