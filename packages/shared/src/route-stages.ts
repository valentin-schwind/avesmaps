import { isAirTransport } from "./air.ts";
import { calendarDate } from "./calendar.ts";
import { pathReaderName } from "./path-names.ts";
import type {
    RouteAirExtra,
    RouteHurry,
    RouteLeg,
    RouteSegment,
    RouteSlope,
    RouteSnow,
    RouteStage,
    RouteStagePoint,
    RouteStageSlope,
} from "./route.ts";
import { CLOCK_START, clockEnter, clockTravel } from "./travel-clock.ts";
import { hurryFactor } from "./transport-rules.ts";
import { travelDayHours, type TravelModel } from "./travel-model.ts";

/**
 * Die Etappen des Reiseplans (WI-0017, Schritt 2): aus den Abschnitten einer Route gebaut wie Legacys
 * Reiseplan (route-plan.js `buildRoutePlanEntries`, `cleanRoutePlanNoiseEntries`,
 * `nameRoutePlanTransferPoints`; route-result.js `avesmapsRouteRestCounter`; avesmaps@770c80e).
 *
 * ⭐ Legacy rechnete das im BROWSER, aus der Antwort des Servers, und die zwei Rechnungen sind einmal
 * auseinandergelaufen (Meldung #101). Hier rechnet es der Server, einmal, und die Oberfläche zeigt nur.
 *
 * Zwei bewusste Abweichungen, beide aus derselben Ursache - wir kennen die KNOTEN, Legacy nur die
 * Geometrie:
 *
 * - **Ein Ortsknoten heißt wie sein Ort.** Legacy sucht im Kasten ±0,5 den ERSTEN Ort der Liste und
 *   verwirft ihn, wenn er weiter als 0,15 weg liegt - liegen zwei Orte eng beieinander, heißt der
 *   Knoten dann „Kreuzung", obwohl er ein Ort ist.
 * - **An einer Kreuzung gilt der NÄCHSTE Ort bis 0,15**, nicht der erste der Liste. Dieselbe Regel wie
 *   bei den Wegenden (Betreiber 2026-09-23: „nächster Ort").
 */

/** Ein Ort liegt „am Knoten", wenn er höchstens so weit weg ist (Legacy `ROUTE_CITY_NODE_THRESHOLD`). */
export const CITY_NODE_RADIUS = 0.15;
/** Die Wegart der Notverbindungen - sie trennt jede Etappe (Legacy `SYNTHETIC_ROUTE_TYPE`). */
export const OFFROAD_TYPE = "Querfeldein";
/**
 * Kürzer als die Anzeigegenauigkeit - ein solches Stück querfeldein sagt nichts (0,00 Meilen). Legacys Schwelle für die
 * Schlussetappe (`route-plan.js`, `tailIsInvisibleOffroad`: „was auf 0,00 gerundet wird, sagt nichts“); seit dem
 * 2026-10-11 gilt sie überall in der Reise (`isInvisibleOffroad`, `mergeStageEntries`).
 */
const INVISIBLE_MILES = 0.01;

export interface StagePlace {
    id: string;
    name: string;
    hidden: boolean;
    x: number;
    y: number;
    /** Die Ortsklasse; ein Kartenpunkt hat keine. */
    subtype?: string;
    /** Ein Kartenpunkt der Anfrage, kein Ort (WI-0030). */
    mapPoint?: boolean;
}

export interface RouteStageContext {
    model: TravelModel;
    /** Die Wegpunkte der Anfrage (Orte und Kartenpunkte), in Reihenfolge. */
    waypointIds: readonly string[];
    /** Der Ort an diesem Knoten, bei einem Kartenpunkt der Punkt selbst; undefined bei Kreuzung oder Fußpunkt. */
    placeAt(nodeId: string): StagePlace | undefined;
    /** Der nächste Ort, den `accept` zulässt, höchstens `radius` vom Punkt; sonst undefined. */
    placeNear(x: number, y: number, radius: number, accept: (place: StagePlace) => boolean): StagePlace | undefined;
    /**
     * Wie nah ein Ort am Knoten liegen muss, damit er die Etappe benennt (WI-0153, Systemsteuerung). Ohne Angabe
     * gilt `CITY_NODE_RADIUS` — so rechnet der Browser, der die Einstellungen nicht kennt.
     */
    cityNodeRadius?: number;
}

export interface RouteStageOptions {
    /** „Reisestunden pro Tag" des Planers: der Reisetag an Land. 24 heißt: keine Rast. */
    hoursPerDay: number;
    /** Der Reisebeginn als Tag im Jahr (WI-0038); ohne ihn tragen die Etappen kein Datum. */
    departure?: number;
}

/** Eine Etappe im Bau - dieselben Felder wie Legacys Plan-Eintrag. */
export interface StageEntry {
    type: string;
    transport: string;
    flowState: "upstream" | "downstream" | null;
    start: RouteStagePoint;
    end: RouteStagePoint;
    pathNames: string[];
    distanceUnits: number;
    travelHours: number;
    segmentIndexes: number[];
}

const isMarker = (point: RouteStagePoint): boolean => point.point === "marker";
const isWaterType = (type: string): boolean => type === "Flussweg" || type === "Seeweg";
const placePoint = (place: StagePlace): RouteStagePoint => ({
    point: place.mapPoint === true ? "point" : "place",
    place_id: place.id,
    name: place.name,
    ...(place.subtype === undefined ? {} : { subtype: place.subtype }),
    x: place.x,
    y: place.y,
});
const markerAt = (coordinate: readonly [number, number]): RouteStagePoint => ({
    point: "marker",
    place_id: null,
    name: "",
    x: coordinate[0],
    y: coordinate[1],
});

/**
 * Zeigt der Reiseplan diesen Wegnamen? Nicht den blanken Typ („über Flussweg"), nicht erzeugte Namen
 * („Flussweg-12", „Meer-835", „Kreuzung-549").
 *
 * 🪤 Die Regel steht seit WI-0105 einmal, in `path-names.ts` (`isPathHandle`); dies ist nur ihr Name im
 * Reiseplan. Sie war hier und in `isRealPathName` zweimal abgeschrieben und beide Fassungen waren
 * wirkungsgleich.
 */
export function isShownPathName(name: string, subtype: string): boolean {
    return pathReaderName(name, subtype) !== null;
}

/**
 * Die Rohetappen: je Landabschnitt einer, gleichartiges Wasser zusammengefasst bis zu einem
 * ausdrücklichen Wegpunkt (Legacy `buildRoutePlanEntries` vor der Nachbearbeitung).
 */
export function rawStageEntries(segments: readonly RouteSegment[], context: RouteStageContext): StageEntry[] {
    const waypoints = new Set(context.waypointIds);
    // 🔴 Ein versteckter Ort, den die Anfrage NENNT, ist aufgedeckt: Wer ihn als Ziel gesetzt hat, darf
    // ihn nicht aus dem eigenen Reiseplan verlieren (Legacy `isRoutePlanMarkerName`, Owner 15.08.2026).
    const visible = (place: StagePlace): boolean => !place.hidden || waypoints.has(place.id);
    // 🔴 Benannt wird nach der GEOMETRIE, wie in Legacy (`routeSegmentEndpointName`): Ein Wegende heißt
    // wie der nächste Ort höchstens 0,15 daneben - auch wenn der Weg im Netz an einem Ort hängt, der
    // weiter weg liegt (bis ±0,5). Dort ist es nur eine Markierung, und die Etappe schließt nicht.
    // Gefunden mit `compare:stages` (Gluckenhang, 0,1535 neben dem Wegende).
    // 🪤 EINMAL je Reise gelesen, nicht je Punkt (WI-0153).
    const radius = context.cityNodeRadius ?? CITY_NODE_RADIUS;
    const pointAt = (nodeId: string, coordinate: readonly [number, number]): RouteStagePoint => {
        const own = context.placeAt(nodeId);
        const ownIsNear = own !== undefined && Math.hypot(own.x - coordinate[0], own.y - coordinate[1]) <= radius;
        // Der nächste Ort zählt, auch ein versteckter - er macht das Ende dann zur Markierung (Legacy).
        const near = ownIsNear ? own : context.placeNear(coordinate[0], coordinate[1], radius, () => true);
        return near && visible(near) ? placePoint(near) : markerAt(coordinate);
    };
    const isWaypoint = (point: RouteStagePoint): boolean => point.place_id !== null && waypoints.has(point.place_id);

    const entries: StageEntry[] = [];
    let water: StageEntry | null = null;
    const flush = (): void => {
        if (water) entries.push(water);
        water = null;
    };

    for (const segment of segments) {
        const coordinates = segment.geometry.coordinates;
        if (coordinates.length < 2) continue;
        const type = segment.synthetic ? OFFROAD_TYPE : segment.subtype;
        const transport = segment.transport_type;
        const flowState =
            type === "Flussweg" && (segment.flow_state === "upstream" || segment.flow_state === "downstream")
                ? segment.flow_state
                : null;
        const start = pointAt(segment.from_node_id, coordinates[0] as [number, number]);
        const end = pointAt(segment.to_node_id, coordinates[coordinates.length - 1] as [number, number]);
        const pathName =
            !segment.synthetic && isShownPathName(segment.path_name, segment.subtype) ? segment.path_name.trim() : "";

        if (isWaterType(type)) {
            const current: StageEntry | null = water;
            if (
                current !== null &&
                (current.type !== type ||
                    current.transport !== transport ||
                    current.flowState !== flowState ||
                    isWaypoint(start))
            ) {
                flush();
            }
            const aggregate: StageEntry = water ?? {
                type,
                transport,
                flowState,
                start,
                end,
                pathNames: [],
                distanceUnits: 0,
                travelHours: 0,
                segmentIndexes: [],
            };
            water = aggregate;
            aggregate.distanceUnits += segment.distance_units;
            aggregate.travelHours += segment.travel_hours;
            if (pathName && !aggregate.pathNames.includes(pathName)) aggregate.pathNames.push(pathName);
            // Ein Zwischenhafen schreibt den Endnamen nicht fort, nur ein echter Ort (Legacy).
            if (!isMarker(end)) aggregate.end = end;
            aggregate.segmentIndexes.push(segment.index);
            if (isWaypoint(end)) flush();
            continue;
        }

        flush();
        entries.push({
            type,
            transport,
            flowState: null,
            start,
            end,
            pathNames: pathName ? [pathName] : [],
            distanceUnits: segment.distance_units,
            travelHours: segment.travel_hours,
            segmentIndexes: [segment.index],
        });
    }
    flush();
    return entries;
}

const addNames = (target: string[], names: readonly string[]): void => {
    for (const name of names) if (!target.includes(name)) target.push(name);
};

const absorb = (into: StageEntry, from: StageEntry): void => {
    into.distanceUnits += from.distanceUnits;
    into.travelHours += from.travelHours;
    into.segmentIndexes.push(...from.segmentIndexes);
};

/** Ein Stück querfeldein, kürzer als die Anzeigegenauigkeit (`INVISIBLE_MILES`): Es zeigte 0,00 Meilen. */
const isInvisibleOffroad = (entry: StageEntry, milesPerUnit: number): boolean =>
    entry.type === OFFROAD_TYPE && entry.distanceUnits * milesPerUnit < INVISIBLE_MILES;

/**
 * Der Grenz-Lauf (Legacy `cleanRoutePlanNoiseEntries`): Rohetappen werden gesammelt, bis die offene
 * Etappe an einem echten Ort endet, der nicht ihr Anfang ist. Kreuzungen und Markierungen sind nur
 * Stützpunkte darin.
 *
 * 🔴 Die WEGART trennt nicht - Reichsstraße, Straße und Weg sind EIN Marsch bis zur nächsten Stadt.
 * Es trennen Querfeldein gegen Weg, eine andere Strömung auf dem Fluss und ein anderes Reisemittel
 * (Meldung #102: sonst erbte eine Flussfahrt den Landtag und die Kosten des Marsches davor).
 *
 * 🔴 **Ein unsichtbares Stück querfeldein (0,00 Meilen) ist keine Etappe und trennt keine**, nirgends in der Reise
 * (Betreiber 2026-10-11: „ein teilstück von 0 meilen … darf weder auf der karte noch im routenplaner in den etappen
 * auftauchen“). Es gehört zur offenen Etappe; ist keine offen, zur nächsten, am Ende der Reise zur letzten. Strecke
 * und Zeit zählen dort weiter, die Summen der Reise bleiben. Legacy kannte die Regel nur für die Schlussetappe: Die
 * Sperre schützt eine Querfeldein-Etappe davor, Länge und Anstieg an eine fremde zu verlieren - wo es beides nicht
 * gibt, gibt es nichts zu schützen. 🪤 Seit WI-0132 (keine Kreuzungen, keine Fangtoleranz) entsteht so ein Stück
 * mitten in der Reise: als Brücke zwischen zwei Wegenden, die sich in der Karte knapp verfehlen (Moorbrück → Gerrun,
 * 0,00026 Einheiten). Die Brücke bleibt im Netz und in den Abschnitten; nur der Reiseplan zeigt sie nicht.
 *
 * @param milesPerUnit für die Schwelle, unter der ein Stück querfeldein unsichtbar ist
 */
export function mergeStageEntries(entries: readonly StageEntry[], milesPerUnit: number): StageEntry[] {
    const copy = (entry: StageEntry): StageEntry => ({
        ...entry,
        pathNames: [...entry.pathNames],
        segmentIndexes: [...entry.segmentIndexes],
    });
    if (entries.length <= 1) return entries.map(copy);

    const result: StageEntry[] = [];
    let open: StageEntry | null = null;
    /** Ein unsichtbares Stück, als keine Etappe offen war: Es geht in die nächste. */
    let carried: StageEntry | null = null;
    for (const raw of entries) {
        let entry = copy(raw);
        if (isInvisibleOffroad(entry, milesPerUnit)) {
            const into = open ?? carried;
            if (into) {
                absorb(into, entry);
                into.end = entry.end;
            } else {
                carried = entry;
            }
            // In der offenen Etappe kann es sie an einem Ort schließen (unten); getragen wartet es auf die nächste.
            if (!open) continue;
        } else {
            if (carried) {
                entry = {
                    ...entry,
                    start: carried.start,
                    distanceUnits: carried.distanceUnits + entry.distanceUnits,
                    travelHours: carried.travelHours + entry.travelHours,
                    segmentIndexes: [...carried.segmentIndexes, ...entry.segmentIndexes],
                };
                carried = null;
            }
            if (open) {
                const offroadBreak = (entry.type === OFFROAD_TYPE) !== (open.type === OFFROAD_TYPE);
                const riverFlowBreak =
                    open.type === "Flussweg" && entry.type === "Flussweg" && open.flowState !== entry.flowState;
                const vehicleBreak = open.transport !== entry.transport;
                if (offroadBreak || riverFlowBreak || vehicleBreak) {
                    result.push(open);
                    open = null;
                }
            }
            if (!open) {
                open = entry;
            } else {
                absorb(open, entry);
                addNames(open.pathNames, entry.pathNames);
                open.end = entry.end;
            }
        }
        // An einem echten Ort, der nicht der Anfang der Etappe ist, wird sie geschlossen.
        if (!isMarker(open.end) && open.end.place_id !== open.start.place_id) {
            result.push(open);
            open = null;
        }
    }

    const tail: StageEntry | null = open;
    if (tail) {
        const last = result[result.length - 1];
        const tailRiverFlowBreak =
            last !== undefined &&
            last.type === "Flussweg" &&
            tail.type === "Flussweg" &&
            last.flowState !== tail.flowState;
        // Eine Querfeldein-Schlussetappe wird nie geschluckt (eine unsichtbare ist keine, siehe oben).
        const tailOffroadBreak = tail.type === OFFROAD_TYPE && (last === undefined || last.type !== OFFROAD_TYPE);
        const tailVehicleBreak = last !== undefined && last.transport !== tail.transport;
        const swallow = isMarker(tail.end) && !tailRiverFlowBreak && !tailOffroadBreak && !tailVehicleBreak;
        if (swallow && last) {
            absorb(last, tail);
        } else {
            result.push(tail);
        }
    }
    // Ein unsichtbares Stück am Ende der Reise gehört zur letzten Etappe; ist es die ganze Reise, bleibt es ihre einzige.
    const rest: StageEntry | null = carried;
    if (rest) {
        const last = result[result.length - 1];
        if (last) absorb(last, rest);
        else result.push(rest);
    }
    return result;
}

/**
 * Der Übergang an einer Markierung bekommt einen Namen, und der hängt an der Richtung (Legacy
 * `nameRoutePlanTransferPoints`, Owner 15.08.2026): Weg → Gelände „Abgangspunkt", Gelände → Weg
 * „Anschlusspunkt". Ein Wechsel des Reisemittels mit Wasser auf einer Seite heißt „Anlegestelle".
 * Ein echter Ort am Übergang behält seinen Namen.
 */
export function nameTransferPoints(entries: readonly StageEntry[]): StageEntry[] {
    const result = entries.map((entry) => ({ ...entry }));
    for (let index = 0; index < result.length - 1; index += 1) {
        const current = result[index] as StageEntry;
        const next = result[index + 1] as StageEntry;
        if (!isMarker(current.end)) continue;
        const currentOffroad = current.type === OFFROAD_TYPE;
        const nextOffroad = next.type === OFFROAD_TYPE;
        let point: RouteStagePoint["point"];
        if (currentOffroad !== nextOffroad) {
            point = nextOffroad ? "exit" : "join";
        } else if (current.transport !== next.transport && (isWaterType(current.type) || isWaterType(next.type))) {
            point = "landing";
        } else {
            continue;
        }
        const named: RouteStagePoint = { ...current.end, point };
        current.end = named;
        next.start = named;
    }
    return result;
}

/**
 * Der Rastzähler EINER Reise (Legacy `avesmapsRouteRestCounter`, Owner 14.08.2026): Er bucht je
 * Etappe die Rast, die auf ihr fällig wird, und trägt den angebrochenen Tag in die nächste. 💣 Ein
 * Zähler für die ganze Route, nie einer je Etappe: Drei kurze Etappen teilen einen Reisetag, und eine
 * Nacht kann mitten in einer Etappe liegen. Die Regeln stehen an der Uhr (`travel-clock.ts`).
 */
export function restCounter(includeRests: boolean): (travelHours: number, dayHours: number, exempt: boolean) => number {
    let clock = CLOCK_START;
    return (travelHours, dayHours, exempt) => {
        const step = clockTravel(clock, travelHours, dayHours, exempt, includeRests);
        clock = step.clock;
        return step.rest;
    };
}

/**
 * Der Reisetag einer Etappe: Land folgt dem Planerfeld, Wasser seinem eigenen Tag (Legacy
 * `avesmapsRouteLegTravelHours`) - Lastensegler und Galeere ankern nachts (GA S. 131). Der Flug folgt dem
 * Planerfeld wie Land (WI-0051, F-E2 = A).
 */
export function stageDayHours(model: TravelModel, transport: string, hoursPerDay: number): number {
    return model.transportmittel.wert.land.includes(transport) || isAirTransport(model, transport)
        ? hoursPerDay
        : travelDayHours(model, transport);
}

/** Nur das Schiff mit Nachtfahrt, und nur auf See, schläft an Bord (Legacy `exemptFlags`). */
export function isRestExempt(model: TravelModel, entry: Pick<StageEntry, "type" | "transport">): boolean {
    return entry.type === "Seeweg" && model.nachtfahrt.wert.includes(entry.transport);
}

/** Die Etappen einer Route, samt Rast, in der Form des Vertrags. */
export function buildRouteStages(
    segments: readonly RouteSegment[],
    legs: readonly RouteLeg[],
    context: RouteStageContext,
    options: RouteStageOptions,
): RouteStage[] {
    const { model } = context;
    const milesPerUnit = model.meilenJeKarteneinheit.wert;
    const entries = nameTransferPoints(mergeStageEntries(rawStageEntries(segments, context), milesPerUnit));

    // Die Enden der Reise sind die Wegpunkte selbst - nie „Markierung" (Legacy benennt sie hier nach).
    const first = entries[0];
    const last = entries[entries.length - 1];
    const firstWaypoint = context.placeAt(context.waypointIds[0] ?? "");
    const lastWaypoint = context.placeAt(context.waypointIds[context.waypointIds.length - 1] ?? "");
    if (first && isMarker(first.start) && firstWaypoint) first.start = placePoint(firstWaypoint);
    if (last && isMarker(last.end) && lastWaypoint) last.end = placePoint(lastWaypoint);

    const includeRests = options.hoursPerDay < 24;
    const { departure } = options;
    // Dieselbe Uhr wie die Suche (WI-0038, E1): Das Datum einer Etappe ist das, mit dem gesperrt wurde.
    let clock = CLOCK_START;
    const legOf = (segmentIndex: number): number => {
        const found = legs.findIndex(
            (leg) => segmentIndex >= leg.segment_start && segmentIndex < leg.segment_start + leg.segment_count,
        );
        return Math.max(found, 0);
    };

    return entries.map((entry, index): RouteStage => {
        const segmentStart = Math.min(...entry.segmentIndexes);
        const exempt = isRestExempt(model, entry);
        const before = clock.hours;
        // Die Rast, die der letzte volle Tag schuldet, wird vor dieser Etappe gebucht und zählt zu ihr.
        // Wie im Zähler: nur vor einem Stück, das wirklich reist.
        const entered = exempt || !(entry.travelHours > 1e-9) ? clock : clockEnter(clock);
        const step = clockTravel(
            entered,
            entry.travelHours,
            stageDayHours(model, entry.transport, options.hoursPerDay),
            exempt,
            includeRests,
        );
        const startHours = entered.hours;
        clock = step.clock;
        const own = entry.segmentIndexes.map((segmentIndex) => segments[segmentIndex]);
        const ground = stageGround(own);
        const slope = stageSlope(own, milesPerUnit);
        const airExtra = stageAirExtra(own);
        const hurry = stageHurry(model, own);
        return {
            index,
            leg_index: legOf(segmentStart),
            segment_start: segmentStart,
            segment_count: entry.segmentIndexes.length,
            type: entry.type,
            transport: entry.transport,
            flow_state: entry.flowState,
            path_names: entry.pathNames,
            from: entry.start,
            to: entry.end,
            distance_units: entry.distanceUnits,
            travel_hours: entry.travelHours,
            rest_hours: startHours - before + step.rest,
            ...(departure === undefined
                ? {}
                : {
                      start_date: calendarDate(departure, startHours),
                      end_date: calendarDate(departure, clock.hours),
                  }),
            ...(ground ? { ground } : {}),
            ...(slope ? { slope } : {}),
            ...(airExtra ? { air_extra: airExtra } : {}),
            ...(hurry ? { hurry } : {}),
        };
    });
}

/**
 * Was das Eiltempo auf einer Etappe gebracht hat (WI-0078): die Strecke ihrer geeilten Abschnitte und die Stunden,
 * die sie gegenüber dem normalen Tempo spart (`travel_hours` ist schon die kürzere Zeit, also ist die normale
 * `travel_hours × hurry_factor`). Undefined, wenn keiner ihrer Abschnitte geeilt ist.
 */
export function stageHurry(
    model: TravelModel,
    segments: readonly (RouteSegment | undefined)[],
): RouteHurry | undefined {
    let hurry: RouteHurry | undefined;
    for (const segment of segments) {
        const factor = segment?.hurry_factor;
        if (!segment || factor === undefined || !(factor > 1)) continue;
        hurry ??= { distance_units: 0, saved_hours: 0, hurried_hours: 0 };
        hurry.distance_units += segment.distance_units;
        hurry.saved_hours += segment.travel_hours * (factor - 1);
        hurry.hurried_hours += hurriedHours(model, segment, factor);
    }
    return hurry;
}

/**
 * Wie viele Stunden dieses Abschnitts wirklich im erhöhten Tempo gelaufen sind (WI-0078 §10b). Ein Abschnitt kann an
 * einer Tagesgrenze geteilt sein: Dann liefen `e` Stunden mit dem vollen Faktor `F` der Geographia und `n` im
 * normalen Tempo. Aus `e + n = travel_hours` und `F·e + n = travel_hours · faktor` folgt
 *
 *     e = travel_hours · (faktor − 1) / (F − 1)
 *
 * 🔴 Eine Rechnung, eine Stelle: `F` kommt aus demselben Reisemodell wie der Faktor selbst (`hurryFactor`), nicht aus
 * einer Zahl im Code. Ohne Regel für diesen Abschnitt gibt es auch keine Eilstunden.
 */
function hurriedHours(model: TravelModel, segment: RouteSegment, factor: number): number {
    const full = hurryFactor(model, segment.transport_type, segment.subtype);
    if (!(full > 1)) return 0;
    return (segment.travel_hours * (factor - 1)) / (full - 1);
}

/** Dasselbe über die ganze Reise, aus ihren Etappen; undefined, wenn keine geeilt ist. */
export function routeHurry(stages: readonly RouteStage[]): RouteHurry | undefined {
    let hurry: RouteHurry | undefined;
    for (const stage of stages) {
        const own = stage.hurry;
        if (!own) continue;
        hurry ??= { distance_units: 0, saved_hours: 0, hurried_hours: 0 };
        hurry.distance_units += own.distance_units;
        hurry.saved_hours += own.saved_hours;
        hurry.hurried_hours += own.hurried_hours;
    }
    return hurry;
}

/** Das steilere von zwei Gefällen, mit Vorzeichen; bei gleichem Betrag bergauf. */
const steeper = (a: number, b: number): number => (Math.abs(b) > Math.abs(a) ? b : a);

/**
 * Die Steigung einer Etappe (WI-0049 S5d): Anstieg, Abstieg und Mehrzeit summiert, höchster Punkt und
 * steilster Abschnitt über ihre Abschnitte mit Höhe, dazu wie viele Meilen die tragen. Undefined, wenn
 * keiner Höhen trägt.
 */
export function stageSlope(
    segments: readonly (RouteSegment | undefined)[],
    milesPerUnit: number,
): RouteStageSlope | undefined {
    let slope: RouteStageSlope | undefined;
    for (const segment of segments) {
        const own = segment?.slope;
        if (!segment || !own) continue;
        const miles = segment.distance_units * milesPerUnit;
        slope = slope
            ? {
                  ascent_schritt: slope.ascent_schritt + own.ascent_schritt,
                  descent_schritt: slope.descent_schritt + own.descent_schritt,
                  highest_schritt: Math.max(slope.highest_schritt, own.highest_schritt),
                  steepest_grade: steeper(slope.steepest_grade, own.steepest_grade),
                  extra_hours: slope.extra_hours + own.extra_hours,
                  covered_miles: slope.covered_miles + miles,
              }
            : { ...own, covered_miles: miles };
    }
    return slope;
}

/**
 * Die Steigung der ganzen Reise über ihre Etappen, samt Legacys Erfassungsvermerk: wie viele Etappen
 * Höhen tragen, von wie vielen. Undefined, wenn keine.
 */
export function routeSlope(stages: readonly RouteStage[]): RouteSlope | undefined {
    let slope: RouteSlope | undefined;
    for (const stage of stages) {
        const own = stage.slope;
        if (!own) continue;
        slope = slope
            ? {
                  ascent_schritt: slope.ascent_schritt + own.ascent_schritt,
                  descent_schritt: slope.descent_schritt + own.descent_schritt,
                  highest_schritt: Math.max(slope.highest_schritt, own.highest_schritt),
                  steepest_grade: steeper(slope.steepest_grade, own.steepest_grade),
                  extra_hours: slope.extra_hours + own.extra_hours,
                  covered_miles: slope.covered_miles + own.covered_miles,
                  covered_stages: slope.covered_stages + 1,
                  total_stages: stages.length,
              }
            : { ...own, covered_stages: 1, total_stages: stages.length };
    }
    return slope;
}

/**
 * Der Zuschlag eines Flugs über der Reisehöhe (WI-0051 F4) je Etappe: die Stunden summiert, der größte Überstand.
 * Undefined, wo keiner ihrer Abschnitte einen trägt (an Land, im Flug ohne Höhenmodell).
 */
export function stageAirExtra(segments: readonly (RouteSegment | undefined)[]): RouteAirExtra | undefined {
    let extra: RouteAirExtra | undefined;
    for (const segment of segments) {
        const own = segment?.air_extra;
        if (!own) continue;
        extra = extra
            ? {
                  extra_hours: extra.extra_hours + own.extra_hours,
                  peak_schritt: Math.max(extra.peak_schritt, own.peak_schritt),
              }
            : { extra_hours: own.extra_hours, peak_schritt: own.peak_schritt };
    }
    return extra;
}

/** Der Zuschlag über der Reisehöhe der ganzen Reise (WI-0051 F4): über ihre Etappen. Undefined, wenn keine einen trägt. */
export function routeAirExtra(stages: readonly RouteStage[]): RouteAirExtra | undefined {
    let extra: RouteAirExtra | undefined;
    for (const stage of stages) {
        const own = stage.air_extra;
        if (!own) continue;
        extra = extra
            ? {
                  extra_hours: extra.extra_hours + own.extra_hours,
                  peak_schritt: Math.max(extra.peak_schritt, own.peak_schritt),
              }
            : { ...own };
    }
    return extra;
}

/**
 * Die Mehrzeit durch Schnee und Eis der ganzen Reise (WI-0065 Nachtrag 2026-10-04): die Stunden der Abschnitte summiert,
 * dazu ihre Bodenzustände in der Folge ihres ersten Auftretens. Undefined, wenn kein Abschnitt welche trägt (ohne
 * Reisebeginn, ohne Schnee, im Flug).
 */
export function routeSnow(segments: readonly RouteSegment[]): RouteSnow | undefined {
    let snow: RouteSnow | undefined;
    for (const segment of segments) {
        const own = segment.snow;
        if (!own) continue;
        snow ??= { extra_hours: 0, conditions: [] };
        snow.extra_hours += own.extra_hours;
        if (!snow.conditions.includes(own.condition)) snow.conditions.push(own.condition);
    }
    return snow;
}

/**
 * Der Bodenzustand einer Etappe (WI-0038, E10): der Zustand mit den meisten Stunden, und um wie viel
 * er die Etappe verlängert hat - Legacys Vermerk „· leichter Schnee +14 %“.
 */
function stageGround(segments: readonly (RouteSegment | undefined)[]): RouteStage["ground"] {
    let hours = 0;
    let plain = 0;
    const byCondition = new Map<string, number>();
    for (const segment of segments) {
        if (!segment) continue;
        const factor = segment.ground?.factor ?? 1;
        hours += segment.travel_hours;
        plain += segment.travel_hours / factor;
        if (segment.ground) {
            const condition = segment.ground.condition;
            byCondition.set(condition, (byCondition.get(condition) ?? 0) + segment.travel_hours);
        }
    }
    if (byCondition.size === 0 || plain <= 0 || hours <= plain + 1e-9) return undefined;
    const [condition] = [...byCondition.entries()].reduce((best, next) => (next[1] > best[1] ? next : best));
    return { condition, percent: Math.round((hours / plain - 1) * 100) };
}
