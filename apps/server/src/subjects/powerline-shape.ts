import { POWERLINE_VIA_LIMIT, type SubjectLineShape, type SubjectLink } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Gestalt einer Kraftlinie (WI-0063 P7; Legacy `js/map-features/powerline-topology.js` und `powerlineInfoboxMarkup`, Mirror
 * `b9657635a`): die Zeilen „Verbindet“, „Verläuft über“ und „Abschnitte“ der Infobox.
 *
 * Eine Kraftlinie liegt als viele Segmente in der Karte, die nur der Name zusammenhält. Aus den Verweisen der Segmente auf ihre Knoten
 * (`from_public_id`, `to_public_id`) entsteht ein ungerichteter Graph; ein Knoten mit genau einer Kante ist ein Ende der Linie, kein
 * Ende ein Ring. 54 der 61 Linien im Bestand von 2026-07-22 sind Stränge, sechs verzweigt, eine ein Ring.
 *
 * - **Verbindet:** die äußeren Enden. Von jedem Ende geht es nach innen, bis ein BENANNTER Knoten kommt (Kreuzungen und Nodix tragen
 *   keinen Namen); gleiche Namen zählen einmal.
 * - **Verläuft über:** die übrigen benannten Knoten, höchstens zwölf (`POWERLINE_VIA_LIMIT`).
 * - **Abschnitte:** die Zahl der Segmente, wenn es mehr als eines gibt; ein Ring sagt es.
 *
 * 🔴 Benannt ist nur ein Ort oder eine Landmarke, die Besucher sehen: Ein Label, ein Nodix und ein verborgener Ort sind Knoten der Linie, aber keine
 * Namen. Abweichung von Legacy: Die Enden stehen von West nach Ost, und „Verläuft über“ folgt bei einem Strang der Linie von dort
 * her - Legacy zählt in der Reihenfolge, in der die Segmente im Kartenpayload liegen.
 */

/** Ein benannter Knoten: ein Ort oder eine Landmarke (`kind: "peak"`, WI-0271 §17), die Besucher sehen. */
export interface NamedNode {
    kind?: "peak";
    id: string;
    name: string;
    x: number;
    y: number;
}

/** Ein Segment der Linie: die Kennungen seiner zwei Knoten (ein Ort, ein Label, ein Nodix, oder gar nichts mehr). */
export interface LineSegment {
    from: string;
    to: string;
}

const link = (node: NamedNode): SubjectLink => ({ ref: { kind: node.kind ?? "place", id: node.id }, name: node.name });

/** Die Gestalt der Linie; `undefined`, wenn es nichts zu sagen gibt (ein Segment, dessen Enden niemand benennt). Reine Rechnung. */
export function powerlineShape(
    segments: readonly LineSegment[],
    named: ReadonlyMap<string, NamedNode>,
): SubjectLineShape | undefined {
    const adjacency = new Map<string, string[]>();
    const add = (from: string, to: string): void => {
        const list = adjacency.get(from);
        if (list) list.push(to);
        else adjacency.set(from, [to]);
    };
    for (const segment of segments) {
        if (segment.from === "" || segment.to === "") continue;
        add(segment.from, segment.to);
        add(segment.to, segment.from);
    }
    if (adjacency.size === 0 && segments.length < 2) return undefined;

    const isNamed = (id: string): boolean => named.has(id);
    const chainEnds = [...adjacency.keys()].filter((id) => (adjacency.get(id) ?? []).length === 1);

    // Von einem Ende nach innen, bis ein benannter Knoten erscheint (Kreuzungen und Nodix überspringen).
    const walkToName = (start: string): string | undefined => {
        const visited = new Set<string>();
        let current: string | undefined = start;
        while (current !== undefined && !visited.has(current)) {
            visited.add(current);
            if (isNamed(current)) return current;
            current = (adjacency.get(current) ?? []).find((id) => !visited.has(id));
        }
        return undefined;
    };
    const endIds: string[] = [];
    for (const end of chainEnds) {
        const found = walkToName(end);
        if (found !== undefined && !endIds.includes(found)) endIds.push(found);
    }
    const east = (left: string, right: string): number => {
        const a = named.get(left) as NamedNode;
        const b = named.get(right) as NamedNode;
        return a.x - b.x || a.y - b.y || a.name.localeCompare(b.name, "de");
    };
    endIds.sort(east);

    const isRing = adjacency.size > 0 && chainEnds.length === 0;
    // Ein Strang hat zwei Enden: Dann folgt „Verläuft über“ der Linie von ihrem westlichen benannten Ende her.
    let order = [...adjacency.keys()];
    const [firstChainEnd] = chainEnds;
    if (chainEnds.length === 2 && firstChainEnd !== undefined) {
        const walk: string[] = [];
        const seen = new Set<string>();
        let current: string | undefined = firstChainEnd;
        while (current !== undefined && !seen.has(current)) {
            walk.push(current);
            seen.add(current);
            current = (adjacency.get(current) ?? []).find((id) => !seen.has(id));
        }
        const [westEnd] = endIds;
        const first = walk.findIndex(isNamed);
        const last = walk.length - 1 - [...walk].reverse().findIndex(isNamed);
        // Steht das westliche benannte Ende hinten, wird die Linie umgedreht.
        order = westEnd !== undefined && walk[last] === westEnd && walk[first] !== westEnd ? walk.reverse() : walk;
    }
    const stations = order.filter((id) => isNamed(id) && !endIds.includes(id));

    const shape: SubjectLineShape = {};
    if (endIds.length > 0) shape.ends = endIds.map((id) => link(named.get(id) as NamedNode));
    if (stations.length > 0) {
        shape.via = stations.slice(0, POWERLINE_VIA_LIMIT).map((id) => link(named.get(id) as NamedNode));
        if (stations.length > POWERLINE_VIA_LIMIT) shape.viaMore = true;
    }
    // Immer wahr und immer verfügbar - und die einzige Zeile, die eine Linie ohne einen einzigen benannten Punkt noch trägt.
    if (segments.length > 1) shape.segments = segments.length;
    if (isRing) shape.ring = true;
    return Object.keys(shape).length === 0 ? undefined : shape;
}

/** Die Gestalt der Kraftlinie aus der Datenbank: ihre Segmente und die benannten Orte an ihren Knoten. */
export async function readPowerlineShape(
    database: Queryable,
    memberIds: readonly string[],
    mapDomainId: string,
): Promise<SubjectLineShape | undefined> {
    const rows = await database<{ from_id: string; to_id: string }[]>`
        SELECT from_public_id::text AS from_id, to_public_id::text AS to_id
        FROM powerline
        WHERE public_id = ANY(${[...memberIds]}::uuid[]) AND is_active AND map_domain_id = ${mapDomainId}
        ORDER BY public_id
    `;
    if (rows.length === 0) return undefined;
    const nodeIds = [...new Set(rows.flatMap((row) => [row.from_id, row.to_id]))];
    const places = await database<{ id: string; name: string; x: number; y: number }[]>`
        SELECT public_id::text AS id, name, ST_X(geom) AS x, ST_Y(geom) AS y
        FROM place
        WHERE public_id = ANY(${nodeIds}::uuid[]) AND is_active AND NOT is_hidden AND map_domain_id = ${mapDomainId}
          AND btrim(name) <> ''
    `;
    const landmarken = await database<{ id: string; name: string; x: number; y: number }[]>`
        SELECT public_id::text AS id, name, ST_X(geom) AS x, ST_Y(geom) AS y
        FROM terrain_peak
        WHERE public_id = ANY(${nodeIds}::uuid[]) AND is_active AND NOT 'nur_gelaende' = ANY (merkmale) AND NOT 'verborgen' = ANY (merkmale)
          AND map_domain_id = ${mapDomainId} AND btrim(name) <> ''
    `;
    const named = new Map<string, NamedNode>([
        ...places.map((place): [string, NamedNode] => [
            place.id,
            { id: place.id, name: place.name, x: Number(place.x), y: Number(place.y) },
        ]),
        ...landmarken.map((landmarke): [string, NamedNode] => [
            landmarke.id,
            { kind: "peak", id: landmarke.id, name: landmarke.name, x: Number(landmarke.x), y: Number(landmarke.y) },
        ]),
    ]);
    return powerlineShape(
        rows.map((row) => ({ from: row.from_id, to: row.to_id })),
        named,
    );
}
