import { mapPointId, parseLandmarkWaypointId, parseMapPointId, type StagePlace } from "@avesmaps3d/shared";
import type { RouteResult } from "./route-result.ts";

/**
 * Landmarken als Wegpunkt (WI-0271 L6, §4.3): Eine Landmarke ist Start, Zwischen- oder Ziel als **benannter Kartenpunkt**.
 *
 * - **Sie fährt als Kartenpunkt.** Der Router bekommt statt `l:<uuid>` den Kartenpunkt an ihrer Lage (`mapPointId`, drei Stellen)
 *   und hängt ihn an wie jeden anderen (`attachMapPoints`, eine Querfeldein-Kante zum nächsten Netzpunkt). Kein neuer Mechanismus im
 *   Router, keine Änderung am Netz: Die Kantenfolge ist dieselbe wie die einer Route über `p:<x>:<y>` an derselben Stelle, auch die
 *   Kennungen der Kanten (`offroad-p:…`, `flug-p:…`).
 * - **Sie heißt im Ergebnis wie sie selbst.** Danach tragen Abschnitte, Etappen, Sperren und Absage wieder ihre Kennung `l:<uuid>`
 *   und ihren Namen statt „Kartenpunkt“ (`asLandmarkRoute`).
 * - **Ohne Landmarke geschieht nichts.** Eine Anfrage ohne `l:` hat dieselben Stationen und dasselbe Ergebnisobjekt wie vorher: Die
 *   Antwort einer Ortsroute ist bytegleich.
 *
 * 🔴 Welche Landmarke Reiseziel ist (aktiv, Art laut `LANDMARKEN_KATALOG`), entscheidet EINE Stelle: der Wegpunktindex des Hauptthreads
 * (`waypoints.ts`), der auch die Wegpunktsuche speist. Der Worker liest `terrain_peak` nicht; er bekommt die aufgelösten Landmarken mit
 * der Anfrage (`RouteQuery.landmarks`). Was dort fehlt, ist `unknown_waypoint`.
 *
 * 🪤 Liegen eine Landmarke und ein Kartenpunkt der Anfrage (oder zwei Landmarken) auf denselben drei Stellen, sind sie für den Router
 * derselbe Punkt; die Abschnitte nennen dann die erste Landmarke.
 */

/** Eine Landmarke der Anfrage, aufgelöst vom Hauptthread (`WaypointIndex.byIds`): aktiv, und ihre Art darf Reiseziel sein. */
export interface RouteLandmark {
    /** `l:<uuid>` (`landmarkWaypointId`). */
    id: string;
    name: string;
    /** Ihre Art (`LANDMARKEN_KATALOG`); sie steht an der Etappe als `subtype`. */
    subtype: string;
    x: number;
    y: number;
}

export interface LandmarkStations {
    /** Die Wegpunkte, wie der Router sie fährt: jede bekannte Landmarke als Kartenpunkt an ihrer Lage, alles andere unverändert. */
    stations: string[];
    /** Die Landmarken der Anfrage als Ende einer Etappe, nach ihrer Kennung `l:<uuid>`. */
    places: Map<string, StagePlace>;
    /** Vom Kartenpunkt, den der Router fährt, zurück zur Landmarke; leer ohne Landmarke. */
    back: Map<string, { id: string; name: string }>;
}

/** Die Stationen des Routers: Eine Landmarke, die der Hauptthread aufgelöst hat, wird der Kartenpunkt an ihrer Lage. */
export function landmarkStations(
    waypoints: readonly string[],
    landmarks: readonly RouteLandmark[] = [],
): LandmarkStations {
    const known = new Map(landmarks.map((landmark) => [landmark.id, landmark]));
    const places = new Map<string, StagePlace>();
    const back = new Map<string, { id: string; name: string }>();
    const stations = waypoints.map((id) => {
        const landmark = parseLandmarkWaypointId(id) === null ? undefined : known.get(id);
        // Unbekannt bleibt die Kennung stehen: Dann ist sie weder Ort noch Kartenpunkt, und der Dienst sagt `unknown_waypoint`.
        if (!landmark) return id;
        const station = mapPointId(landmark);
        // Die Lage auf den drei Stellen der Kennung, wie bei jedem Kartenpunkt: Dort beginnt und endet die Linie der Route.
        const at = parseMapPointId(station) ?? { x: landmark.x, y: landmark.y };
        places.set(id, { id, name: landmark.name, hidden: false, mapPoint: true, subtype: landmark.subtype, ...at });
        if (!back.has(station)) back.set(station, { id, name: landmark.name });
        return station;
    });
    return { stations, places, back };
}

/**
 * Das Ergebnis des Routers mit den Landmarken zurück: Abschnitte, Etappen der Anfrage (`legs`), Sperren und die Absage eines Punkts
 * nennen `l:<uuid>` und den Namen der Landmarke statt des Kartenpunkts. Kanten, Strecken und Zeiten bleiben, wie sie sind.
 * Ohne Landmarke ist es dasselbe Objekt.
 */
export function asLandmarkRoute(
    result: RouteResult,
    waypoints: readonly string[],
    { stations, back }: Pick<LandmarkStations, "stations" | "back">,
): RouteResult {
    if (back.size === 0) return result;
    const idOf = (node: string): string => back.get(node)?.id ?? node;
    const nameOf = (node: string, name: string): string => back.get(node)?.name ?? name;
    return {
        ...result,
        segments: result.segments.map((segment) =>
            back.has(segment.from_node_id) || back.has(segment.to_node_id)
                ? {
                      ...segment,
                      from_node: nameOf(segment.from_node_id, segment.from_node),
                      to_node: nameOf(segment.to_node_id, segment.to_node),
                      from_node_id: idOf(segment.from_node_id),
                      to_node_id: idOf(segment.to_node_id),
                  }
                : segment,
        ),
        // Die Etappen der Anfrage stehen in der Folge der Wegpunkte: die i-te von Station i nach i+1.
        legs: result.legs.map((leg, index) => ({
            ...leg,
            from: leg.from === stations[index] ? (waypoints[index] ?? leg.from) : leg.from,
            to: leg.to === stations[index + 1] ? (waypoints[index + 1] ?? leg.to) : leg.to,
        })),
        refused: result.refused && { ...result.refused, waypoint: idOf(result.refused.waypoint) },
        closures: result.closures.map((closure) =>
            back.has(closure.diverges_at_node_id)
                ? {
                      ...closure,
                      diverges_at_node: nameOf(closure.diverges_at_node_id, closure.diverges_at_node),
                      diverges_at_node_id: idOf(closure.diverges_at_node_id),
                  }
                : closure,
        ),
    };
}
