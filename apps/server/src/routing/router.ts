import { parseMapPointId, type RouteClosure } from "@avesmaps3d/shared";
import { closureReport, fairWeatherReport, type RouteTiming } from "./closures.ts";
import type { RouteNode, RouteNetwork } from "./network.ts";
import { RequestGraph } from "./request-graph.ts";
import { anchorWaypoints, attachMapPoints, bendEmergencyLinks } from "./request-links.ts";
import { NO_OFFROAD_TERRAIN, withEdges, type OffroadTerrain, type RouteGraph } from "./route-edge.ts";
import type { MapPoint } from "./map-points.ts";
import { componentBridges, yearRoundBridgesFor } from "./route-graph.ts";
import { assembleRoute, emptyResult, reportName, type HurryPace, type RouteResult } from "./route-result.ts";
import { findLeg, findLegs } from "./route-search.ts";

/**
 * Die Wegfindung (WI-0017, ROUTE-A): Dijkstra auf dem Netz aus `network.ts`, mit Legacys Regeln für
 * Transportmittel, Gewicht, Strömung und Querfeldein (`client-graph.php`, avesmaps@bfec670).
 *
 * Diese Datei ist die Fassade und die Orchestrierung (Hardening Review M7): `findRoute` ruft die vier Stufen
 * nacheinander auf, und alles, was Importeure von hier lesen, steht hier wieder bereit. Die Stufen liegen je in
 * einem Modul, jede kennt nur die davor und die Grundbegriffe aus `route-edge.ts`:
 *
 * 1. `route-graph.ts` - der Graph je Profil (gezeichnete Wege, Brücken); der Dienst hält ihn je Datenstand.
 * 2. `request-graph.ts`, `request-links.ts` - die Kanten je Anfrage (Anker, Kartenpunkte, gebogene Notverbindungen).
 * 3. `route-search.ts` - Dijkstra je Etappe.
 * 4. `route-result.ts` - Abschnitte, Etappen und Zeiten der gefundenen Route.
 *
 * Die Antwort trägt ihre Abschnitte in Legacys Form (`segments`): Aus genau dieser Folge baut die
 * Etappenrechnung ihre Etappen - Landabschnitte einzeln, gleichartige Wasserabschnitte zusammen. Wer
 * dieselben Abschnitte liefert, bekommt dieselben Etappen.
 *
 * Querfeldein gibt es in drei Formen. Die ersten beiden sind Notverbindungen, nur mit Landreise und
 * einem Mittel, das querfeldein darf:
 *
 * - **Brücken**, einmal je Profil: Jeder abgetrennte Netzteil bekommt EINE Kante zum Hauptnetz,
 *   zwischen den beiden nächsten Knoten.
 * - **Anker**, je Anfrage: Ein Wegpunkt ohne Landweg wird an die bis zu sechs nächsten Landwege
 *   angebunden, und jeder davon wird an seinem Fußpunkt geteilt. Welcher gewinnt, entscheidet die Suche.
 *
 * Keine von beiden quert offenes Wasser (`water.ts`), und keine endet an einem Ort, den nur die See
 * erreicht (die Häfen des Seegraphen; ohne Seegraphen die Orte an gezeichneten Seewegen, wie Legacy).
 * Länge und Zeit zählen für die Wegwahl mal `querfeldeinAufschlag`; die gemeldete
 * Reisezeit rechnet ohne ihn, wie der Reiseplan der Karte (route-plan.js). Unter „Schnellste“ werden
 * die benutzten Notverbindungen danach gebogen und gemessen wie jeder Gang querfeldein, und die Route
 * rechnet einmal neu (`bendEmergencyLinks`, R7).
 * 🪤 Legacys API rechnet den Aufschlag in `duration.travel_hours` mit ein - dort ist eine Stunde
 * querfeldein 25 Stunden lang.
 *
 * - **Der Gang zu einem Kartenpunkt** (WI-0030), je Anfrage: GENAU EINE Kante zum nächsten Punkt des
 *   Netzes, den man querfeldein erreicht (`map-points.ts`). Gewollt, keine Notverbindung: ohne
 *   Aufschlag, mit dem Längenaufschlag auf die Zeit, auch wenn „Land“ aus ist (wie Legacy). Er biegt
 *   um Meer, See und Flüsse (R7, `offroad-search.ts`).
 *
 * **Freie Seefahrt** (WI-0046; seit WI-0153 Schnitt 7e die einzige): Das Schiff fährt von Hafen zu Hafen über den
 * abgeleiteten Seegraphen (`sea-free.ts`), nie über gezeichnete Seewege. Die Suche fragt
 * die Seekanten eines Hafens erst, wenn sie ihn erreicht (`RequestGraph.forEachSeaEdge`).
 *
 * **Steigung** (WI-0049 S5a/S5c): Mit Wegprofilen wächst die Zeit eines Landwegs je Richtung mit seinem
 * Anstieg (`slope.ts`), nach der Steigungsfamilie des Landmittels (Fuß, Reit- und Lasttier, Wagen). Ohne
 * Wegprofile rechnet alles wie vorher. Wegpunkt-Hälften erben die Zeit je Einheit ihres Weges und damit
 * seine Steigung. Querfeldein rechnet das Gelände (`relief.ts`) samt Sternregel.
 *
 * **Saisonale Sperren** (WI-0038): Mit Reisebeginn (`timing`) laufen die Sperrfenster der Wege und Seereisen mit
 * einer Uhr über die Zwischenziele (`closures.ts`); gesperrte Kanten fallen weg, der Boden der Jahreszeit
 * verlängert die Kante, und Netzteile, die nur über Wasser mit Fenster am Hauptnetz hängen, bekommen ihre
 * ganzjährigen Brücken (`yearRoundBridgesFor`). Die Route nennt die umgangenen oder sperrenden Wege
 * (`closures`). Ohne Reisebeginn sperrt nichts, und sie nennt ihre Wege mit Sperrzeit (`seasonalWays`).
 */

export { lineLength } from "./network.ts";
export { ANCHOR_LIMIT, ANCHOR_PREFIX } from "./request-graph.ts";
export { NO_OFFROAD_TERRAIN, SYNTHETIC_TYPE } from "./route-edge.ts";
export type { OffroadTerrain, RouteGraph, RouteRequest } from "./route-edge.ts";
export { buildRouteGraph } from "./route-graph.ts";
export { MAP_POINT_NAME } from "./route-result.ts";
export type { HurryPace, RouteLegResult, RouteResult } from "./route-result.ts";

/**
 * Eine Route über Stationen: Start, Zwischenziele, Ziel - Orte als Knoten-Id, Kartenpunkte als
 * `p:<x>:<y>`. Etappe für Etappe wie Legacy, auf EINEM Graphen mit den Ankern aller Wegpunkte.
 */
export function findRoute(
    network: RouteNetwork,
    graph: RouteGraph,
    stations: string[],
    terrain: OffroadTerrain = NO_OFFROAD_TERRAIN,
    timing: RouteTiming | null = null,
    /**
     * Eiltempo (WI-0078): Es steht bewusst NICHT in `RouteRequest` und nicht im Graphenschlüssel - es ändert keine
     * Kante und keine Suche, nur die Zeit der schon gefundenen Abschnitte (`assembleRoute`). `null` heißt: Haken aus;
     * sonst trägt es den Reisetag des Planers, denn die Taktung rechnet am Reisetag.
     */
    hurry: HurryPace | null = null,
): RouteResult {
    const { model } = graph;
    // 🔴 Ein versteckter Ort, den die Anfrage NENNT, darf Brückenende sein: Wer ihn eingegeben hat, hat
    // ihn gefunden. Die Brücken des Profils gelten dann nicht, sie werden für diese Anfrage neu gebaut.
    const named = new Set(stations);
    /** Wie ein Bericht einen Knoten nennt: der Ort, der Kartenpunkt, sonst nichts (technischer Knoten, Fußpunkt). */
    const placeName = reportName(network, named);
    const namesHidden = stations.some((id) => network.nodes.get(id)?.isHidden === true);
    const bridgeEnd = (node: RouteNode): boolean => !node.isHidden || named.has(node.id);
    const base = namesHidden ? withEdges(graph.drawn, componentBridges(network, graph, bridgeEnd)) : graph.adjacency;
    const view = new RequestGraph(base, graph.sea);
    if (timing) view.add(yearRoundBridgesFor(network, graph, bridgeEnd, base, !namesHidden));
    // Legacys Reihenfolge: Start, Ziel, dann die Zwischenziele - erst die Orte, dann die Kartenpunkte.
    const waypoints = [
        ...new Set(
            [stations[0], stations[stations.length - 1], ...stations.slice(1, -1)].filter(
                (id): id is string => id !== undefined,
            ),
        ),
    ];
    anchorWaypoints(network, graph, view, waypoints, terrain);
    const points = waypoints.flatMap((id): MapPoint[] => {
        const at = parseMapPointId(id);
        return at ? [{ id, ...at }] : [];
    });
    const refused = attachMapPoints(network, graph, view, stations, points, terrain, (node) => {
        // Ein versteckter Ort ist kein Ausstieg - außer die Anfrage nennt ihn.
        return !node.isHidden || named.has(node.id);
    });
    if (refused) return { ...emptyResult(), refused };

    let route = findLegs(view, graph, stations, timing);
    // Die benutzten Notverbindungen werden gebogen, dann rechnet die Route EINMAL neu: Der Bogen ist
    // länger als die Sehne, also kann jetzt eine andere Route die günstigere sein.
    if ("edges" in route && bendEmergencyLinks(graph, view, terrain, route.edges) > 0) {
        route = findLegs(view, graph, stations, timing);
    }
    if ("tooLarge" in route) return { ...emptyResult(), tooLarge: route.tooLarge };
    if ("failedLegIndex" in route) {
        const failed = { ...emptyResult(), failedLegIndex: route.failedLegIndex };
        if (!timing || !route.start) return failed;
        // Gibt es die Etappe ohne Sperrfenster? Dann ist sie gesperrt, nicht unverbunden (Legacy `blocked`).
        const from = stations[route.failedLegIndex] as string;
        const to = stations[route.failedLegIndex + 1] as string;
        const open = findLeg(view, graph, from, to, { timing, start: route.start, windows: false });
        const report = open.found
            ? closureReport({
                  model,
                  timing,
                  legIndex: route.failedLegIndex,
                  start: route.start,
                  startNode: from,
                  actual: null,
                  unrestricted: open,
                  nodeName: placeName,
              })
            : null;
        return report ? { ...failed, seasonClosed: true, closures: [report] } : failed;
    }
    // Mit Reisebeginn: der Vergleichslauf ohne Fenster, nur für Etappen, deren Suche eine Sperre berührt hat.
    // Er sucht noch, gehört also vor die Ergebnisbildung; deren Zeichnen der Seekanten und Zusammenfügen der Anker
    // ändert den Anfragegraphen nicht, der Vergleichslauf sieht sie nicht.
    const closures: RouteClosure[] = [];
    if (timing) {
        route.legs.forEach((leg, legIndex) => {
            if (!leg.touched) return;
            const from = stations[legIndex] as string;
            const to = stations[legIndex + 1] as string;
            const open = findLeg(view, graph, from, to, { timing, start: leg.start, windows: false });
            if (!open.found) return;
            const report = closureReport({
                model,
                timing,
                legIndex,
                start: leg.start,
                startNode: from,
                actual: leg,
                unrestricted: open,
                nodeName: placeName,
            });
            if (report) {
                closures.push(report);
                return;
            }
            // 🔴 WI-0082, Fassung C: Meldet der Vergleichslauf nichts, kann die Route den gesperrten Weg trotzdem
            // berührt haben - sie meidet ihn dann aus einem anderen Grund (dem Boden der Jahreszeit). Dritte, nur
            // meldende Suche: die Route des GUTEN WETTERS, ohne Fenster und ohne den Boden der Jahreszeit.
            const fair = findLeg(view, graph, from, to, {
                timing,
                start: leg.start,
                windows: false,
                seasonGround: false,
            });
            if (!fair.found) return;
            const anyway = fairWeatherReport({
                model,
                timing,
                legIndex,
                start: leg.start,
                startNode: from,
                actual: leg,
                fair,
                nodeName: placeName,
            });
            if (anyway) closures.push(anyway);
        });
    }
    return assembleRoute({ network, graph, trace: view, stations, route, terrain, timing, closures, hurry });
}
