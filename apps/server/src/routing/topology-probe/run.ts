import { AVENTURIA, AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { queryOf, resolveName, type GateCase } from "../corpus-gate-run.ts";
import type { RouteNetwork } from "../network.ts";
import { RouteService, type RouteOutcome, type RouteQuery, type RoutingData, type RoutingSource } from "../service.ts";

/**
 * WI-0132 P1: der ECHTE Routendienst über einem eingeschobenen Netz. Die Naht dafür gibt es schon: `RouteService` nimmt
 * eine `RoutingSource`, und ein Datenstand ist ein Objekt mit dem Bestandteil `network`. Gemessen wird also mit
 * demselben Dienst, Graphenbau, derselben Suche und Etappenbildung wie im Worker; nur das Netz ist ein anderes. Alle
 * übrigen Bestandteile (Wasser, Land, Flüsse, Boden, Klima, Gelände, Zollgebiete, Revision) sind dieselben Objekte.
 */

export function serviceOver(
    data: RoutingData,
    network: RouteNetwork,
    loadSea: RoutingSource["loadSea"] | undefined,
): RouteService {
    const swapped: RoutingData = { ...data, network };
    return new RouteService({
        mapDomain: AVENTURIA.mapDomain,
        model: AVENTURIA_TRAVEL_MODEL,
        source: {
            revision: async () => swapped.revision,
            load: async () => swapped,
            ...(loadSea ? { loadSea } : {}),
        },
        recheckMs: Number.POSITIVE_INFINITY,
    });
}

export interface CaseRun {
    id: string;
    label: string;
    waypoints: string[];
    outcome: RouteOutcome | { unresolved: string };
    ms: number;
}

/** Löst die Orte der Fälle über die Orte des Netzes auf (wie das Routing-Gate) und rechnet jeden Fall einmal. */
export async function runGateCases(
    service: RouteService,
    network: RouteNetwork,
    cases: readonly GateCase[],
): Promise<CaseRun[]> {
    const places = [...network.nodes.values()]
        .filter((node) => node.kind === "place")
        .map((node) => ({ id: node.id, name: node.name, hidden: node.isHidden }));
    const runs: CaseRun[] = [];
    for (const one of cases) {
        const query = queryOf(one.request);
        if ("invalid" in query) {
            runs.push({ id: one.id, label: one.label, waypoints: [], outcome: { unresolved: query.invalid }, ms: 0 });
            continue;
        }
        const ids: string[] = [];
        let unresolved: string | undefined;
        for (const name of one.names) {
            const hit = resolveName(places, name);
            if ("id" in hit) ids.push(hit.id);
            else unresolved ??= hit.unresolved;
        }
        if (unresolved !== undefined) {
            runs.push({ id: one.id, label: one.label, waypoints: ids, outcome: { unresolved }, ms: 0 });
            continue;
        }
        const began = performance.now();
        const outcome = await service.route({ ...query, waypoints: ids });
        runs.push({ id: one.id, label: one.label, waypoints: ids, outcome, ms: performance.now() - began });
    }
    return runs;
}

/** Eine einzelne Anfrage mit den Vorgaben des Planers (`queryOf({})`) und eigenen Wegpunkten. */
export async function routeWith(service: RouteService, waypoints: string[]): Promise<RouteOutcome> {
    const query = queryOf({}) as Omit<RouteQuery, "waypoints">;
    return service.route({ ...query, waypoints });
}
