import { AVENTURIA, toRenderLngLat, type RouteResponse } from "@avesmaps3d/shared";
import { segmentShape } from "../map/route-layers";

/**
 * Die Zeitleiste einer Reise für den Playmode (Kap. 6.41, FEATURE-ROUTE-PLAYMODE; Betreiber
 * 2026-09-24). Reine Rechnung über ein fertiges Routenergebnis - das Routing ändert sich nicht.
 *
 * - **Die Zeit ist die Reisezeit.** Der Fortschritt läuft über die Reisestunden der Abschnitte: Auf
 *   der Reichsstraße eilt der Pfeil, im Gebirge kriecht er, flussabwärts gleitet er. Innerhalb eines
 *   Abschnitts verteilt sich die Zeit gleichmäßig über seine Länge.
 * - **Die Tage zählen die Rast mit** (Legacys Tageszählung): Die Rast einer Etappe verteilt sich über
 *   ihre Reisezeit, damit die Zahl rechts stetig wächst und am Ende die Gesamtdauer zeigt.
 * - **Die Richtung ist die auf der Karte**, im Uhrzeigersinn ab Norden - so dreht MapLibre ein Bild
 *   mit `icon-rotation-alignment: map`, und so dreht sich eine Kamera, die dem Pfeil folgt.
 * - **Voraus heißt Strecke, nicht Zeit** (WI-0053): `ahead` misst entlang der gezeichneten Linie. Im
 *   Gebirge kriecht der Pfeil; eine Vorausschau in Sekunden wäre dort kurz und träfe jede Kehre.
 */

export interface JourneyPosition {
    x: number;
    y: number;
    /** Fahrtrichtung in Grad, im Uhrzeigersinn ab Kartennorden. */
    heading: number;
    /** Die Etappe, in der der Pfeil gerade ist. */
    stage: number;
    /** Zurückgelegte Meilen. */
    miles: number;
    /** Verstrichene Tage, Rast eingeschlossen. */
    days: number;
    /**
     * Der Abschnitt unter dem Pfeil (`RouteSegment.index`, −1 ohne Abschnitt) und wie weit der Pfeil in ihm
     * ist, 0 bis 1 seiner gezeichneten Länge. Auf einem Flug findet der Pfeil damit die Höhe seiner Bahn
     * (WI-0051 F3, `flight-arcs.ts`).
     */
    segment: number;
    along: number;
}

export interface JourneyTimeline {
    /** Reisestunden ohne Rast - die Länge der Zeitleiste. */
    totalHours: number;
    totalMiles: number;
    totalDays: number;
    /** Wo jede Etappe beginnt, als Anteil 0…1 der Zeitleiste. Die erste beginnt bei 0. */
    stageStarts: number[];
    /** Die Lage des Pfeils bei einem Anteil 0…1. */
    at(fraction: number): JourneyPosition;
    /** Der Punkt `units` Karteneinheiten hinter dem Pfeil auf der gezeichneten Linie; höchstens das Ende. */
    ahead(fraction: number, units: number): { x: number; y: number };
    /** Wie weit der Pfeil noch bis zum Ende fährt, in Karteneinheiten auf der gezeichneten Linie (WI-0218: Auslauf am Ziel). */
    rest(fraction: number): number;
}

interface Piece {
    /** Beginn und Ende auf der Zeitleiste, in Reisestunden. */
    from: number;
    to: number;
    points: [number, number][];
    /** Aufgelaufene Länge an jedem Punkt, in Karteneinheiten. */
    lengths: number[];
    /** Länge der Linie vor diesem Abschnitt, in Karteneinheiten. */
    lengthBefore: number;
    stage: number;
    /** Der Abschnitt der Route (`RouteSegment.index`). */
    segment: number;
    /** Meilen vor diesem Abschnitt und in ihm. */
    milesBefore: number;
    miles: number;
    /** Tage (samt Rast) vor diesem Abschnitt und in ihm. */
    daysBefore: number;
    days: number;
}

/** Die Richtung von a nach b auf der gezeichneten Karte (Web Mercator), im Uhrzeigersinn ab Norden. */
export function mapHeading(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const space = AVENTURIA.coordinateSpace;
    const mercatorY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const from = toRenderLngLat(space, a);
    const to = toRenderLngLat(space, b);
    const east = ((to.lng - from.lng) * Math.PI) / 180;
    const north = mercatorY(to.lat) - mercatorY(from.lat);
    const degrees = (Math.atan2(east, north) * 180) / Math.PI;
    return (degrees + 360) % 360;
}

export function buildTimeline(route: RouteResponse): JourneyTimeline {
    const milesPerUnit = route.miles_per_unit;
    const stageOf = new Map<number, number>();
    const restShare = new Map<number, number>();
    for (const stage of route.stages) {
        for (let offset = 0; offset < stage.segment_count; offset += 1)
            stageOf.set(stage.segment_start + offset, stage.index);
        // Die Rast einer Etappe verteilt sich über ihre Reisezeit: Stunde Reise × dieser Anteil = Rast.
        restShare.set(stage.index, stage.travel_hours > 0 ? stage.rest_hours / stage.travel_hours : 0);
    }

    const pieces: Piece[] = [];
    let hours = 0;
    let miles = 0;
    let days = 0;
    let length = 0;
    for (const segment of route.segments) {
        // Der Pfeil fährt die GEZEICHNETE Linie ab, geglättet wie auf der Karte - sonst schnitte er Kurven.
        const points = segmentShape(segment).map(({ x, y }) => [x, y] as [number, number]);
        if (points.length < 2) continue;
        const lengths = [0];
        for (let index = 1; index < points.length; index += 1) {
            const [ax, ay] = points[index - 1] as [number, number];
            const [bx, by] = points[index] as [number, number];
            lengths.push((lengths[index - 1] as number) + Math.hypot(bx - ax, by - ay));
        }
        const stage = stageOf.get(segment.index) ?? 0;
        const segmentMiles = segment.distance_units * milesPerUnit;
        const segmentDays = (segment.travel_hours * (1 + (restShare.get(stage) ?? 0))) / 24;
        pieces.push({
            from: hours,
            to: hours + segment.travel_hours,
            points,
            lengths,
            lengthBefore: length,
            stage,
            segment: segment.index,
            milesBefore: miles,
            miles: segmentMiles,
            daysBefore: days,
            days: segmentDays,
        });
        hours += segment.travel_hours;
        length += lengths[lengths.length - 1] as number;
        miles += segmentMiles;
        days += segmentDays;
    }
    const totalHours = hours;

    const stageStarts = route.stages.map((stage) => {
        const first = pieces.find((piece) => piece.stage === stage.index);
        return first && totalHours > 0 ? first.from / totalHours : 0;
    });

    /** Der Abschnitt zu einem Anteil der Zeitleiste und wie weit der Pfeil in ihm ist, 0…1. */
    const locate = (fraction: number): { piece: Piece; within: number } | undefined => {
        const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
        const time = clamped * totalHours;
        const piece = pieces.find((candidate) => time <= candidate.to) ?? pieces[pieces.length - 1];
        if (!piece) return undefined;
        const span = piece.to - piece.from;
        return { piece, within: span > 0 ? Math.min(1, Math.max(0, (time - piece.from) / span)) : 1 };
    };
    /** Die Stelle `distance` Einheiten weit in einem Abschnitt: Punkt und Richtung des Stücks darunter. */
    const pointIn = (piece: Piece, distance: number): { x: number; y: number; heading: number } => {
        let index = 1;
        while (index < piece.lengths.length - 1 && (piece.lengths[index] as number) < distance) index += 1;
        const [ax, ay] = piece.points[index - 1] as [number, number];
        const [bx, by] = piece.points[index] as [number, number];
        const startLength = piece.lengths[index - 1] as number;
        const stepLength = (piece.lengths[index] as number) - startLength;
        const t = stepLength > 0 ? Math.min(1, Math.max(0, (distance - startLength) / stepLength)) : 0;
        return {
            x: ax + (bx - ax) * t,
            y: ay + (by - ay) * t,
            heading: mapHeading({ x: ax, y: ay }, { x: bx, y: by }),
        };
    };
    const lengthOf = (piece: Piece): number => piece.lengths[piece.lengths.length - 1] as number;

    const at = (fraction: number): JourneyPosition => {
        const found = locate(fraction);
        if (!found) return { x: 0, y: 0, heading: 0, stage: 0, miles: 0, days: 0, segment: -1, along: 0 };
        const { piece, within } = found;
        const { heading, ...position } = pointIn(piece, within * lengthOf(piece));
        return {
            ...position,
            heading,
            stage: piece.stage,
            miles: piece.milesBefore + piece.miles * within,
            days: piece.daysBefore + piece.days * within,
            // Die Zeit verteilt sich gleichmäßig über die Länge: Der Anteil der Zeit ist der Anteil des Wegs.
            segment: piece.segment,
            along: within,
        };
    };

    const ahead = (fraction: number, units: number): { x: number; y: number } => {
        const found = locate(fraction);
        if (!found) return { x: 0, y: 0 };
        const target = found.piece.lengthBefore + found.within * lengthOf(found.piece) + Math.max(0, units);
        const piece =
            pieces.find((candidate) => target <= candidate.lengthBefore + lengthOf(candidate)) ??
            (pieces[pieces.length - 1] as Piece);
        const { x, y } = pointIn(piece, Math.min(lengthOf(piece), target - piece.lengthBefore));
        return { x, y };
    };

    const rest = (fraction: number): number => {
        const found = locate(fraction);
        return found ? Math.max(0, length - found.piece.lengthBefore - found.within * lengthOf(found.piece)) : 0;
    };

    return { totalHours, totalMiles: miles, totalDays: days, stageStarts, at, ahead, rest };
}

/**
 * Wo auf der Leiste ein Etappenpunkt steht: an jedem Etappenanfang außer dem ersten. Steht einer
 * näher als `minGap` (Anteil der Leiste) am vorigen, entfällt er, von links gezählt - sonst würden
 * viele kurze Etappen zu einer Kette ohne Lücke.
 */
export function stageDots(stageStarts: readonly number[], minGap: number): number[] {
    const kept: number[] = [];
    for (const start of stageStarts) {
        if (start <= 0) continue;
        const last = kept[kept.length - 1];
        if (last !== undefined && start - last < minGap) continue;
        kept.push(start);
    }
    return kept;
}
