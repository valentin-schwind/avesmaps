import { werte } from "./einstellungen.ts";
import {
    AIR_EDGE_PREFIX,
    AIR_TYPE,
    CLOCK_START,
    clockEnter,
    clockTravel,
    stageDayHours,
    travelDayHours,
    type RouteAir,
    type RouteSegment,
    type TravelModel,
} from "@avesmaps3d/shared";
import { profilePointLimit } from "./elevation-profile.ts";
import { lineLength, type RouteLegResult, type RouteResult } from "./router.ts";
import type { FlightProfiles } from "./water-profile.ts";

/**
 * Der Flug (WI-0051, F1): von Wegpunkt zu Wegpunkt, je Paar ein Abschnitt der Wegart `Flug` und damit eine
 * Etappe. Kein Graph, keine Suche, keine Domäne: Wegarten, Mittel, Optimierung und Umstiege gelten nicht,
 * und es gibt weder Steigung noch Sperren noch den Boden der Jahreszeit (Plan 6.37: nichts erfinden).
 *
 * - **Zeit:** Meilen / Tempo des Flugmittels, dazu mit Höhenmodell der Zuschlag über der Reisehöhe über Grund (F4,
 *   `flightSurcharge`: Steigen und Halten über Boden + Reisehöhe, das Folgen des Geländes auf Reisehöhe ist frei).
 *   `cost_units` ist wie bei jedem Abschnitt die Kantenzeit, aus der `travelHoursFromTime` die Stunden rechnet;
 *   `cost_factor` ist 1.
 * - **Rast und Datum** wie an Land (F-E2 = A): dieselbe Uhr wie der Reiseplan (`buildRouteStages`), mit den
 *   Reisestunden des Planers (`stageDayHours`). Mit Reisebeginn trägt jeder Abschnitt seine Klimazone (`zoneOf`), wie
 *   ein Landabschnitt: Das Höhenprofil zeichnet daraus die Schneegrenze.
 * - **Start und Landung überall** (F-E3 = A): auch ein Kartenpunkt im Wasser ist ein Wegpunkt.
 *
 * ⭐ **Der Weg** zwischen zwei Wegpunkten kommt aus einem `AirWay`. Ohne Angabe die Luftlinie
 * (`STRAIGHT_AIR_WAY`); der Dienst reicht den Weg um die Gebirge herein, die über die absolute Höchstflughöhe ragen
 * (F2, `air-way.ts`). Alles andere - Länge, Zeit, Etappen, Rast, Datum - rechnet über dessen Linie.
 */

/** Ein Wegpunkt des Flugs: ein Ort oder ein Kartenpunkt, mit Namen und Lage in `aventuria-v1`. */
export interface AirPoint {
    id: string;
    name: string;
    x: number;
    y: number;
}

/**
 * Der Weg von einem Wegpunkt zum nächsten, in Flugrichtung; die Linie beginnt und endet an den Wegpunkten.
 * `null` heißt: Es gibt keinen Weg; die Route scheitert dann an dieser Etappe wie an einem unverbundenen Netz.
 * Der Weg um die Gebirge (F2) liefert nie `null`: Muss er, quert er die Sperre auf dem kürzesten Stück.
 */
export type AirWay = (from: AirPoint, to: AirPoint) => [number, number][] | null;

/** Die Luftlinie (F1). */
export const STRAIGHT_AIR_WAY: AirWay = (from, to) => [
    [from.x, from.y],
    [to.x, to.y],
];

export interface AirRouteOptions {
    /** „Reisestunden pro Tag“ des Planers; 24 heißt ohne Rast. */
    hoursPerDay: number;
    /** Mit Reisebeginn: Dann trägt das Ergebnis die Stunden bis zur Ankunft, samt Rast. */
    timed: boolean;
    /** Der Weg zwischen zwei Wegpunkten; ohne Angabe die Luftlinie. */
    way?: AirWay;
    /** Die gezeichnete Linie zum Weg; Start und Ziel nennen die Etappe (die Wahl des Wegs hängt an ihr, `air-weigh.ts`). */
    display?: (points: [number, number][], from?: AirPoint, to?: AirPoint) => [number, number][];
    /**
     * Das Gelände unter dem Abschnitt und die Flughöhe darüber (`flightProfiles`): Linie in Flugrichtung, ihre Länge und
     * wie viele Punkte der Abschnitt höchstens trägt. Das Höhenprofil ist Anzeige; der Zuschlag über der Reisehöhe
     * (F4, `surcharge`) aber verlängert die Reisezeit des Abschnitts. Ohne Angabe oder ohne Ergebnis (kein Höhenmodell)
     * trägt der Abschnitt weder Linie noch Zuschlag: Dann gilt die Zeit der Luftlinie.
     */
    profiles?: (coordinates: [number, number][], distance: number, limit: number) => FlightProfiles | null;
    /**
     * Die Klimazone eines Abschnitts (`ClimateZones.zoneOf`, dieselbe Regel wie an Land: die Zone, in der der größte Teil
     * seiner Länge liegt, an der Linie des Abschnitts). Nur mit Reisebeginn gesetzt, wie `climate_zone` der Landabschnitte
     * (`route-result.ts`): Das Höhenprofil braucht sie für die Schneegrenze, und die gibt es nur mit Datum.
     */
    zoneOf?: (coordinates: [number, number][]) => string | null;
    /**
     * Muss die Etappe um Gebirge suchen? Mehr als `ROUTE_FLIGHT_SEARCH_LIMIT` solcher Etappen weist die
     * Reise vor jeder Suche ab (`flight_legs:<n>`). Ohne Angabe sucht keine.
     */
    searches?: (from: AirPoint, to: AirPoint) => boolean;
}

/**
 * Die Flugreise über die Stationen, in der Form der Landroute (`RouteResult`), damit Dienst, Reiseplan und
 * Antwort sie wie jede Route behandeln. Zweimal derselbe Wegpunkt hintereinander ist wie an Land eine Etappe
 * ohne Abschnitt.
 */
export function findAirRoute(
    stations: readonly AirPoint[],
    air: RouteAir,
    model: TravelModel,
    options: AirRouteOptions,
): RouteResult {
    const way = options.way ?? STRAIGHT_AIR_WAY;
    const milesPerUnit = model.meilenJeKarteneinheit.wert;
    // Die Kantenzeit des Routers: Stunden = Zeit x Meilen je Einheit x Zeitfaktor (`travelHoursFromTime`).
    const hoursPerTime = milesPerUnit * model.zeitfaktor.wert;
    const dayHours = stageDayHours(model, air.profile, options.hoursPerDay);
    const includeRests = options.hoursPerDay < 24;
    const empty = (): RouteResult => ({
        found: false,
        nodeIds: [],
        segments: [],
        distanceUnits: 0,
        cost: 0,
        travelHours: 0,
        travelDays: 0,
        failedLegIndex: null,
        legs: [],
        refused: null,
        tooLarge: null,
        seasonClosed: false,
        arrivalHours: null,
        closures: [],
        seasonalWays: [],
    });
    // Das Budget der Suchen (Claudio 2026-09-28): Die Luftlinien prüfen kostet wenig, eine Suche bis 90 ms.
    // Also erst zählen, dann rechnen; wiederholte Etappen zählen je Vorkommen wie die Seereisen.
    if (options.searches) {
        let searching = 0;
        for (let index = 0; index + 1 < stations.length; index += 1) {
            const from = stations[index] as AirPoint;
            const to = stations[index + 1] as AirPoint;
            if (from.id !== to.id && options.searches(from, to)) searching += 1;
        }
        if (searching > werte().routeFlightSearchLimit)
            return { ...empty(), tooLarge: `flight_legs:${String(searching)}` };
    }
    const result = { ...empty(), found: stations.length >= 2, nodeIds: stations.slice(0, 1).map(({ id }) => id) };
    let clock = CLOCK_START;
    for (let index = 0; index + 1 < stations.length; index += 1) {
        const from = stations[index] as AirPoint;
        const to = stations[index + 1] as AirPoint;
        const leg: RouteLegResult = {
            from: from.id,
            to: to.id,
            segmentStart: result.segments.length,
            segmentCount: 0,
            distanceUnits: 0,
            travelHours: 0,
        };
        if (from.id !== to.id) {
            const coordinates = way(from, to);
            if (!coordinates) return { ...empty(), failedLegIndex: index };
            const distance = lineLength(coordinates);
            const lines = options.profiles?.(coordinates, distance, profilePointLimit(stations.length - 1));
            // Die Luftlinienzeit, dazu der Zuschlag über der Reisehöhe (F4): Steigen und Halten über Boden + Reisehöhe.
            const surcharge = lines?.surcharge;
            const hours = (distance * milesPerUnit) / air.speedMph + (surcharge?.hours ?? 0);
            const segment: RouteSegment = {
                index: result.segments.length,
                edge_id: `${AIR_EDGE_PREFIX}${from.id}-${to.id}`,
                public_id: "",
                from_node: from.name,
                to_node: to.name,
                from_node_id: from.id,
                to_node_id: to.id,
                subtype: AIR_TYPE,
                path_name: "",
                transport_type: air.profile,
                distance_units: distance,
                cost_units: hours / hoursPerTime,
                cost_factor: 1,
                travel_hours: hours,
                flow_time_factor: 1,
                flow_state: "",
                ...(lines
                    ? {
                          elevation_profile: lines.elevation_profile,
                          elevation_surface: "land" as const,
                          air_profile: lines.air_profile,
                          air_extra: {
                              extra_hours: lines.surcharge.hours,
                              climb_hours: lines.surcharge.climbHours,
                              hold_hours: lines.surcharge.holdHours,
                              peak_schritt: lines.surcharge.peakSchritt,
                          },
                      }
                    : {}),
                ...(options.zoneOf ? { climate_zone: options.zoneOf(coordinates) } : {}),
                synthetic: false,
                offroad: false,
                geometry: { type: "LineString", coordinates },
                ...(options.display
                    ? {
                          display: {
                              type: "LineString" as const,
                              coordinates: options.display(coordinates, from, to),
                          },
                      }
                    : {}),
            };
            result.segments.push(segment);
            leg.segmentCount = 1;
            leg.distanceUnits = distance;
            leg.travelHours = hours;
            result.distanceUnits += distance;
            result.cost += segment.cost_units;
            result.travelHours += hours;
            result.travelDays += hours / travelDayHours(model, air.profile);
            // Dieselbe Uhr wie der Reiseplan: die Rast eines vollen Tages vor dem nächsten Stück, das reist.
            const entered = hours > 1e-9 ? clockEnter(clock) : clock;
            clock = clockTravel(entered, hours, dayHours, false, includeRests).clock;
            result.nodeIds.push(to.id);
        }
        result.legs.push(leg);
    }
    return { ...result, arrivalHours: options.timed ? clock.hours : null };
}
