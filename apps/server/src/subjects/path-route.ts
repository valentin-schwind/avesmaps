import type { SubjectRoutePlace } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * „Weg als Route“ (WI-0063 P7, B12; Legacy `js/routing/weg-als-route.js`, Mirror `b9657635a`): die Orte einer Straße in der Reihenfolge,
 * in der man sie bereist. Legacy setzt sie anstelle der Wegpunkte des Planers; hier liefert der Server die Liste, der Planer nimmt sie.
 *
 * Die Regeln sind Legacys (Entwurf `2026-09-14-wege-mehrfachzuweisung-design.md` 5.2):
 *  - **Die Straße ist die ganze Gruppe** (Besucher bekommen nie nur einen Abschnitt), ihre Abschnitte geographisch geordnet: kleinste
 *    Ecke der Hüllbox (x, dann y, auf zwei Stellen gerundet), bei Gleichstand die öffentliche ID (`wpGroupWays`).
 *  - **Ketten:** Die Enden der Abschnitte werden zu Knoten zusammengefasst (Toleranz 0,001). Eine Kette läuft, solange der nächste Knoten
 *    GENAU zwei Abschnitte hat; ein Ende oder eine Verzweigung schließt sie. Erst von Enden aus, dann der Rest, die längste zuerst
 *    (`wpChainSegments`).
 *  - **Lücken:** Mehrere Stücke hängen von der längsten Kette aus am jeweils NÄCHSTEN Ende an, das Stück notfalls umgedreht.
 *  - **Orte:** Der Ort an einem Wegende ist der nächste Ort unter 0,01 (`EXACT_HIT`, Legacy `LOCATION_ENDPOINT_EXACT_HIT`). Kreuzungen,
 *    offene Wegenden und verborgene Orte fahren nicht mit, aufeinanderfolgende Dopplungen fallen weg.
 *
 * Abweichung von Legacy: Die Orte sind an ihrer Kennung erkannt, nicht an ihrem Namen (ein Name ist keine Identität, MCS-014).
 */

/** Zwei Enden sind derselbe Knoten, wenn sie höchstens so weit auseinanderliegen (Legacy `WP_CHAIN_TOLERANZ`). */
export const CHAIN_TOLERANCE = 0.001;
/** So nah muss ein Ort am Wegende liegen, um es zu benennen (Legacy `LOCATION_ENDPOINT_EXACT_HIT`, wie der Router). */
export const END_PLACE_REACH = 0.01;

type Point = readonly [number, number];

/** Ein Ort an einem Wegende; `hidden` ist ein verborgener Ort (er benennt das Ende, fährt aber nicht mit). */
export interface EndPlace extends SubjectRoutePlace {
    hidden: boolean;
}

/** Ein Abschnitt: seine Enden samt Ort und die Ecke seiner Hüllbox für die Reihenfolge. */
export interface RouteSegment {
    id: string;
    from: Point;
    to: Point;
    fromPlace: EndPlace | null;
    toPlace: EndPlace | null;
    minX: number;
    minY: number;
}

interface Station {
    place: EndPlace | null;
    point: Point;
}

interface Link {
    index: number;
    /** Das Stück liegt rückwärts in der Kette: Es wird an seinem `to` betreten. */
    reversed: boolean;
}

const rounded = (value: number): number => Math.round(value * 100) / 100;

/** Die Abschnitte in Legacys Reihenfolge: Hüllbox-Ecke, auf zwei Stellen gerundet, dann die Kennung. */
export function orderSegments(segments: readonly RouteSegment[]): RouteSegment[] {
    return [...segments].sort(
        (left, right) =>
            rounded(left.minX) - rounded(right.minX) ||
            rounded(left.minY) - rounded(right.minY) ||
            (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
}

/** Die Knoten der Enden: je Gitterzelle (Maschenweite = Toleranz) eine Probe über die acht Nachbarzellen (Legacy `wpChainNodeResolver`). */
function nodeResolver(points: readonly Point[]): (point: Point) => string | null {
    const grid = new Map<string, { x: number; y: number; key: string }[]>();
    const cell = (value: number): number => Math.floor(value / CHAIN_TOLERANCE);
    const find = (point: Point): string | null => {
        const [x, y] = point;
        for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
                for (const candidate of grid.get(`${String(cell(x) + dx)}:${String(cell(y) + dy)}`) ?? []) {
                    if (Math.hypot(candidate.x - x, candidate.y - y) <= CHAIN_TOLERANCE) return candidate.key;
                }
            }
        }
        return null;
    };
    // Der erste Punkt seiner Nachbarschaft gibt dem Knoten den Namen: Die Reihenfolge ist die der Abschnitte und damit stabil.
    for (const point of points) {
        if (find(point) !== null) continue;
        const key = `${String(point[0])}|${String(point[1])}`;
        const at = `${String(cell(point[0]))}:${String(cell(point[1]))}`;
        const entry = { x: point[0], y: point[1], key };
        const bucket = grid.get(at);
        if (bucket) bucket.push(entry);
        else grid.set(at, [entry]);
    }
    return find;
}

/** Der Graph der Abschnitte: Knoten sind die zusammengefassten Enden, Kanten die Abschnitte (Legacy `wpChainGraph`). */
function chainGraph(segments: readonly RouteSegment[]): { nodes: Map<string, number[]>; ends: [string, string][] } {
    const resolve = nodeResolver(segments.flatMap((segment) => [segment.from, segment.to]));
    const nodes = new Map<string, number[]>();
    const ends: [string, string][] = [];
    segments.forEach((segment, index) => {
        const from = resolve(segment.from) as string;
        const to = resolve(segment.to) as string;
        ends[index] = [from, to];
        for (const key of [from, to]) {
            const edges = nodes.get(key);
            if (edges) edges.push(index);
            else nodes.set(key, [index]);
        }
    });
    return { nodes, ends };
}

/**
 * Die Abschnitte zu Ketten ordnen, die längste zuerst (Legacy `wpChainSegments`). Eine gebrochene Kette wird gezeigt, nicht überbrückt:
 * Verzweigungen und Lücken sind der Normalfall, und eine erfundene Verbindung behauptete einen Weg, den es nicht gibt.
 */
export function chainSegments(segments: readonly RouteSegment[]): Link[][] {
    const { nodes, ends } = chainGraph(segments);
    const used = new Set<number>();
    const chains: Link[][] = [];

    const run = (startIndex: number, startKey: string): Link[] => {
        const chain: Link[] = [];
        let index: number | undefined = startIndex;
        let entry = startKey;
        while (index !== undefined && !used.has(index)) {
            used.add(index);
            const pair = ends[index] as [string, string];
            // Betreten wir das Stück an seinem `to`, liegt es rückwärts in der Kette.
            const reversed = pair[0] !== entry;
            chain.push({ index, reversed });
            const exit = reversed ? pair[0] : pair[1];
            const neighbours = nodes.get(exit) ?? [];
            // Genau zwei: Bei einer Verzweigung (drei und mehr) schließt die Kette, welcher Arm der richtige wäre, kann niemand wissen.
            if (neighbours.length !== 2) break;
            const next: number | undefined = neighbours[0] === index ? neighbours[1] : neighbours[0];
            if (next === undefined || used.has(next)) break;
            index = next;
            entry = exit;
        }
        return chain;
    };

    // Erst von echten Enden aus (Knoten mit einer Kante), sonst begänne eine Kette in ihrer Mitte und zerfiele in zwei Hälften.
    segments.forEach((_, index) => {
        if (used.has(index)) return;
        const [from, to] = ends[index] as [string, string];
        if ((nodes.get(from) ?? []).length === 1) chains.push(run(index, from));
        else if ((nodes.get(to) ?? []).length === 1) chains.push(run(index, to));
    });
    segments.forEach((_, index) => {
        if (!used.has(index)) chains.push(run(index, (ends[index] as [string, string])[0]));
    });
    return chains.filter((chain) => chain.length > 0).sort((left, right) => right.length - left.length);
}

/** Die Stationen einer Kette in Fahrtrichtung: der Anfang des ersten Stücks, dann das Ende jedes Stücks. */
function stationsOf(segments: readonly RouteSegment[], chain: readonly Link[]): Station[] {
    const stations: Station[] = [];
    chain.forEach((link, at) => {
        const segment = segments[link.index] as RouteSegment;
        const start: Station = link.reversed
            ? { place: segment.toPlace, point: segment.to }
            : { place: segment.fromPlace, point: segment.from };
        const end: Station = link.reversed
            ? { place: segment.fromPlace, point: segment.from }
            : { place: segment.toPlace, point: segment.to };
        if (at === 0) stations.push(start);
        stations.push(end);
    });
    return stations;
}

const distance = (left: Point, right: Point): number => Math.hypot(left[0] - right[0], left[1] - right[1]);

/**
 * Die Orte der Straße in Reihenfolge: Ketten, Lücken nach dem nächsten Ende geschlossen, dann ohne Kreuzungen, offene Enden,
 * verborgene Orte und ohne aufeinanderfolgende Dopplungen. Reine Rechnung.
 */
export function orderRoutePlaces(input: readonly RouteSegment[]): SubjectRoutePlace[] {
    const segments = orderSegments(input);
    const chains = chainSegments(segments);
    const [first, ...others] = chains;
    if (first === undefined) return [];

    let sequence = stationsOf(segments, first);
    const rest = others.map((chain) => stationsOf(segments, chain));
    while (rest.length > 0) {
        const here = (sequence[sequence.length - 1] as Station).point;
        let best = 0;
        let flip = false;
        let nearest = Number.POSITIVE_INFINITY;
        rest.forEach((stations, at) => {
            const front = distance(here, (stations[0] as Station).point);
            const back = distance(here, (stations[stations.length - 1] as Station).point);
            if (front < nearest) {
                nearest = front;
                best = at;
                flip = false;
            }
            if (back < nearest) {
                nearest = back;
                best = at;
                flip = true;
            }
        });
        const [next] = rest.splice(best, 1) as [Station[]];
        sequence = sequence.concat(flip ? next.slice().reverse() : next);
    }

    const places: SubjectRoutePlace[] = [];
    let last: string | undefined;
    for (const station of sequence) {
        const place = station.place;
        if (place === null || place.hidden) continue;
        if (place.id === last) continue;
        last = place.id;
        places.push({ id: place.id, name: place.name, subtype: place.subtype, x: place.x, y: place.y });
    }
    return places;
}

/**
 * „Von – Bis“ der ganzen Straße (Legacy `wpGanzeStrecke`, Markierungszeile „Ganze Straße: Perz – Helmdahl“): die zwei am weitesten
 * auseinanderliegenden ORTE unter den offenen Enden - ein offenes Ende ist ein Knoten mit genau EINER Kante über alle Abschnitte. Zwei
 * Enden gleichen Namens sind kein Paar; bei Gleichstand gewinnt das Namenspaar in alphabetischer Folge. Vorn steht das westlichere Ende
 * (kleineres x, dann kleineres y, dann der Name). Ein verborgener Ort nennt kein Ende (Legacy tut es, Avesmaps3D zeigt Besuchern keinen).
 * `undefined` bei weniger als zwei Orten.
 */
export function wholeStretch(input: readonly RouteSegment[]): { from: string; to: string } | undefined {
    const segments = orderSegments(input);
    const { nodes, ends } = chainGraph(segments);
    const open: { name: string; x: number; y: number }[] = [];
    segments.forEach((segment, index) => {
        const pair = ends[index] as [string, string];
        const sides: [string, Point, EndPlace | null][] = [
            [pair[0], segment.from, segment.fromPlace],
            [pair[1], segment.to, segment.toPlace],
        ];
        for (const [key, point, place] of sides) {
            if ((nodes.get(key) ?? []).length !== 1 || place === null || place.hidden) continue;
            open.push({ name: place.name, x: point[0], y: point[1] });
        }
    });
    let best: { gap: number; pair: string; a: (typeof open)[number]; b: (typeof open)[number] } | undefined;
    for (let i = 0; i < open.length; i += 1) {
        for (let j = i + 1; j < open.length; j += 1) {
            const a = open[i] as (typeof open)[number];
            const b = open[j] as (typeof open)[number];
            if (a.name === b.name) continue;
            const gap = Math.hypot(a.x - b.x, a.y - b.y);
            const pair = a.name < b.name ? `${a.name}\u0000${b.name}` : `${b.name}\u0000${a.name}`;
            if (best === undefined || gap > best.gap || (gap === best.gap && pair < best.pair))
                best = { gap, pair, a, b };
        }
    }
    if (best === undefined) return undefined;
    const { a, b } = best;
    const aFirst = a.x < b.x || (a.x === b.x && (a.y < b.y || (a.y === b.y && a.name < b.name)));
    return aFirst ? { from: a.name, to: b.name } : { from: b.name, to: a.name };
}

interface SegmentRow {
    id: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    min_x: number;
    min_y: number;
    a_id: string | null;
    a_name: string | null;
    a_subtype: string | null;
    a_hidden: boolean | null;
    a_x: number | null;
    a_y: number | null;
    b_id: string | null;
    b_name: string | null;
    b_subtype: string | null;
    b_hidden: boolean | null;
    b_x: number | null;
    b_y: number | null;
}

const endPlace = (
    id: string | null,
    name: string | null,
    subtype: string | null,
    hidden: boolean | null,
    x: number | null,
    y: number | null,
): EndPlace | null =>
    id === null || name === null || subtype === null || x === null || y === null || name.trim() === ""
        ? null
        : { id, name, subtype, hidden: hidden === true, x: Number(x), y: Number(y) };

/**
 * Die Abschnitte einer Straße samt den Orten an ihren Enden. Der nächste aktive Ort unter `reach` benennt ein Ende, bei
 * Gleichstand der westlichere (kleineres x, dann y; Legacy: nie der Name, denn JS und PHP sortieren Umlaute verschieden).
 *
 * `reach` ist der exakte Treffer, mit dem der Router rechnet (`exactHit` der Systemsteuerung, WI-0214); ohne Angabe die Vorgabe
 * `END_PLACE_REACH`.
 */
export async function readRouteSegments(
    database: Queryable,
    memberIds: readonly string[],
    mapDomainId: string,
    reach: number = END_PLACE_REACH,
): Promise<RouteSegment[]> {
    const rows = await database<SegmentRow[]>`
        SELECT p.public_id::text AS id,
               ST_X(ST_StartPoint(p.geom)) AS x0, ST_Y(ST_StartPoint(p.geom)) AS y0,
               ST_X(ST_EndPoint(p.geom)) AS x1, ST_Y(ST_EndPoint(p.geom)) AS y1,
               ST_XMin(p.geom) AS min_x, ST_YMin(p.geom) AS min_y,
               a.id AS a_id, a.name AS a_name, a.subtype AS a_subtype, a.hidden AS a_hidden, a.x AS a_x, a.y AS a_y,
               b.id AS b_id, b.name AS b_name, b.subtype AS b_subtype, b.hidden AS b_hidden, b.x AS b_x, b.y AS b_y
        FROM path p
        LEFT JOIN LATERAL (
            SELECT o.public_id::text AS id, o.name, o.subtype, o.is_hidden AS hidden, ST_X(o.geom) AS x, ST_Y(o.geom) AS y
            FROM place o
            WHERE o.is_active AND o.map_domain_id = ${mapDomainId}
              AND ST_DWithin(o.geom, ST_StartPoint(p.geom), ${reach})
              AND ST_Distance(o.geom, ST_StartPoint(p.geom)) < ${reach}
            ORDER BY ST_Distance(o.geom, ST_StartPoint(p.geom)), ST_X(o.geom), ST_Y(o.geom), o.public_id
            LIMIT 1
        ) a ON TRUE
        LEFT JOIN LATERAL (
            SELECT o.public_id::text AS id, o.name, o.subtype, o.is_hidden AS hidden, ST_X(o.geom) AS x, ST_Y(o.geom) AS y
            FROM place o
            WHERE o.is_active AND o.map_domain_id = ${mapDomainId}
              AND ST_DWithin(o.geom, ST_EndPoint(p.geom), ${reach})
              AND ST_Distance(o.geom, ST_EndPoint(p.geom)) < ${reach}
            ORDER BY ST_Distance(o.geom, ST_EndPoint(p.geom)), ST_X(o.geom), ST_Y(o.geom), o.public_id
            LIMIT 1
        ) b ON TRUE
        WHERE p.public_id = ANY(${[...memberIds]}::uuid[]) AND p.is_active AND p.map_domain_id = ${mapDomainId}
        ORDER BY p.public_id
    `;
    return rows.map((row) => ({
        id: row.id,
        from: [Number(row.x0), Number(row.y0)],
        to: [Number(row.x1), Number(row.y1)],
        fromPlace: endPlace(row.a_id, row.a_name, row.a_subtype, row.a_hidden, row.a_x, row.a_y),
        toPlace: endPlace(row.b_id, row.b_name, row.b_subtype, row.b_hidden, row.b_x, row.b_y),
        minX: Number(row.min_x),
        minY: Number(row.min_y),
    }));
}
