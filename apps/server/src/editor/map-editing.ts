import type { FastifyRequest } from "fastify";
import { MAP_EDITING_ERROR_STATUS, type MapEditingMode } from "@avesmaps3d/shared";
import { ApiError } from "../http/api-error.ts";

/**
 * Der Schalter an den Schreibrouten des Ortseditors (WI-0128 E9, EDIT-0001 §4.6, §5.1 N1): Steht `MAP_EDITING` nicht auf `testwelt`,
 * antwortet jede Route 423 `map_editing_off`, bevor sie etwas liest oder schreibt. Als `preHandler` nach Anmeldung, Recht und
 * Schemaprüfung (wer nicht darf, erfährt nichts über den Schalter), wie die Kartensperre (SYS-4, `system/write-guard.ts`), die
 * zusätzlich gilt.
 */

/** Der Modus dieser Instanz; ohne Angabe in der Konfiguration `off`. */
export const mapEditingOf = (request: FastifyRequest): MapEditingMode => request.server.config.mapEditing ?? "off";

export function mapEditingOff(): ApiError {
    return new ApiError(
        MAP_EDITING_ERROR_STATUS.map_editing_off,
        "map_editing_off",
        "Bearbeiten der Karte ist in dieser Umgebung ausgeschaltet.",
    );
}

/** Für die Optionen einer Schreibroute: `{ preHandler: requireMapEditing }`. */
export async function requireMapEditing(request: FastifyRequest): Promise<void> {
    if (mapEditingOf(request) !== "testwelt") throw mapEditingOff();
}
