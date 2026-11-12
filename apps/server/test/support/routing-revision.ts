import { revisionKey, type RoutingDataRevision } from "../../src/routing/revision.ts";

/**
 * Hilfen für Testquellen des Rechendienstes (`RoutingSource`): Eine Revision aus einer Kennung, damit ein Test
 * „r1“, „r2“ sagen kann, statt acht Teile zu erfinden.
 */

/** Eine Revision, deren Teil `map` die Kennung trägt; die übrigen Teile sind fest und für alle Kennungen gleich. */
export function revisionOf(id: string): RoutingDataRevision {
    return {
        map: id,
        travelModel: "modell",
        terrain: null,
        pathProfiles: null,
        seaGraph: null,
        climate: null,
        territories: null,
        // WI-0153: der achte Teil; `null` heißt „keine Tafel“ und ist für alle Kennungen gleich.
        settings: null,
        settingsLive: null,
    };
}

/** Die `routing_graph_revision`, unter der eine Route auf einem Stand mit `revisionOf(id)` antwortet. */
export function keyOf(id: string): string {
    return revisionKey(revisionOf(id));
}
