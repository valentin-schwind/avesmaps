/**
 * Die Mittelachse einer Fläche über ihre Chordal Axis (WI-0004, Finding MCS-008).
 *
 * Legacy nimmt ausdrücklich eine Chordal Axis und **keine** echte Medial Axis: sie entsteht aus
 * einer Delaunay-Triangulierung des verdichteten Randes, indem man die Mitten der inneren Kanten
 * verbindet. Das Ergebnis ist gröber als eine Medial Axis und genau deshalb brauchbar — es hat
 * keine Äste an jeder Randzacke, die man hinterher wieder wegglätten müsste.
 *
 * Hier stehen nur reine Funktionen. Die Triangulierung selbst kommt aus PostGIS, das Glätten aus
 * `curve-fit.ts`; was dazwischen liegt — welche Dreiecke innen sind, wie daraus ein Graph wird und
 * welcher Weg der längste ist — ist der Teil, den Legacy von Hand schreiben musste und wir auch.
 */

export interface Point {
    x: number;
    y: number;
}

/** Ein Dreieck aus der Triangulierung, drei Ecken im Uhrzeigersinn oder gegen ihn. */
export type Triangle = readonly [Point, Point, Point];

export interface AxisGraph {
    nodes: Point[];
    /** Kanten als Indexpaare mit ihrer Länge als Gewicht. */
    edges: { a: number; b: number; weight: number }[];
}

function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function centroid(triangle: Triangle): Point {
    return {
        x: (triangle[0].x + triangle[1].x + triangle[2].x) / 3,
        y: (triangle[0].y + triangle[1].y + triangle[2].y) / 3,
    };
}

/** Schlüssel einer ungerichteten Kante, auf sechs Nachkommastellen gerundet. */
function edgeKey(a: Point, b: Point): string {
    const first = `${a.x.toFixed(6)},${a.y.toFixed(6)}`;
    const second = `${b.x.toFixed(6)},${b.y.toFixed(6)}`;
    return first < second ? `${first}|${second}` : `${second}|${first}`;
}

/**
 * Baut den Graphen der Chordal Axis aus den Innendreiecken.
 *
 * Eine Kante ist "innen", wenn sie von zwei Innendreiecken geteilt wird. Die Knoten sind die Mitten
 * dieser Kanten; wie sie verbunden werden, hängt daran, wie viele geteilte Kanten ein Dreieck hat:
 *
 * - **drei** → ein Stern über den Schwerpunkt: das Dreieck ist eine Verzweigung,
 * - **zwei** → ein Durchgang: die beiden Mitten werden direkt verbunden,
 * - **eine** → eine Spitze: die Mitte wird mit der gegenüberliegenden Ecke verbunden, damit die
 *   Achse bis ans Ende der Fläche reicht statt kurz davor aufzuhören.
 *
 * 🪤 Ohne den Spitzenfall endet die Achse eine halbe Dreiecksbreite vor dem Ende der Fläche — bei
 * einem schmalen Gebirgsausläufer sind das schnell mehrere Kartenminuten, und der Name rutscht
 * sichtbar von der Spitze weg.
 */
export function buildAxisGraph(triangles: readonly Triangle[]): AxisGraph {
    const sharedCount = new Map<string, number>();
    for (const triangle of triangles) {
        for (let index = 0; index < 3; index += 1) {
            const key = edgeKey(triangle[index] as Point, triangle[(index + 1) % 3] as Point);
            sharedCount.set(key, (sharedCount.get(key) ?? 0) + 1);
        }
    }

    const nodeIndex = new Map<string, number>();
    const nodes: Point[] = [];
    const addNode = (point: Point): number => {
        const key = `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
        const existing = nodeIndex.get(key);
        if (existing !== undefined) {
            return existing;
        }
        nodes.push(point);
        nodeIndex.set(key, nodes.length - 1);
        return nodes.length - 1;
    };

    const edgeSet = new Set<string>();
    const edges: AxisGraph["edges"] = [];
    const connect = (a: number, b: number): void => {
        if (a === b) {
            return;
        }
        const key = a < b ? `${String(a)}-${String(b)}` : `${String(b)}-${String(a)}`;
        if (edgeSet.has(key)) {
            return;
        }
        edgeSet.add(key);
        edges.push({ a, b, weight: distance(nodes[a] as Point, nodes[b] as Point) });
    };

    for (const triangle of triangles) {
        const shared: { middle: Point; opposite: Point }[] = [];
        for (let index = 0; index < 3; index += 1) {
            const from = triangle[index] as Point;
            const to = triangle[(index + 1) % 3] as Point;
            if ((sharedCount.get(edgeKey(from, to)) ?? 0) >= 2) {
                shared.push({ middle: midpoint(from, to), opposite: triangle[(index + 2) % 3] as Point });
            }
        }

        if (shared.length === 3) {
            const hub = addNode(centroid(triangle));
            for (const entry of shared) {
                connect(hub, addNode(entry.middle));
            }
        } else if (shared.length === 2) {
            connect(addNode((shared[0] as { middle: Point }).middle), addNode((shared[1] as { middle: Point }).middle));
        } else if (shared.length === 1) {
            const only = shared[0] as { middle: Point; opposite: Point };
            connect(addNode(only.middle), addNode(only.opposite));
        }
    }

    return { nodes, edges };
}

interface Reach {
    far: number;
    distance: number[];
    previous: number[];
}

type Adjacency = { to: number; weight: number }[][];

function adjacencyOf(graph: AxisGraph): Adjacency {
    const neighbours: Adjacency = Array.from({ length: graph.nodes.length }, () => []);
    for (const edge of graph.edges) {
        (neighbours[edge.a] as { to: number; weight: number }[]).push({ to: edge.b, weight: edge.weight });
        (neighbours[edge.b] as { to: number; weight: number }[]).push({ to: edge.a, weight: edge.weight });
    }
    return neighbours;
}

/**
 * Dijkstra ohne Heap, beschränkt auf die Knoten einer Komponente.
 *
 * Die Beschränkung ist keine Mikrooptimierung: ohne sie kostet ein Lauf O(n²) über den GANZEN
 * Graphen, und da wir für jede Komponente zweimal laufen, wird aus einer Fläche mit hundert
 * Dreiecksinseln schnell eine Minute Rechenzeit.
 */
function farthestFrom(neighbours: Adjacency, component: readonly number[], start: number): Reach {
    const distanceTo = new Array<number>(neighbours.length).fill(Number.POSITIVE_INFINITY);
    const previous = new Array<number>(neighbours.length).fill(-1);
    const visited = new Array<boolean>(neighbours.length).fill(false);

    distanceTo[start] = 0;
    for (;;) {
        let current = -1;
        let best = Number.POSITIVE_INFINITY;
        for (const index of component) {
            if (!visited[index] && (distanceTo[index] as number) < best) {
                best = distanceTo[index] as number;
                current = index;
            }
        }
        if (current === -1) {
            break;
        }
        visited[current] = true;
        for (const edge of neighbours[current] as { to: number; weight: number }[]) {
            const candidate = (distanceTo[current] as number) + edge.weight;
            if (candidate < (distanceTo[edge.to] as number)) {
                distanceTo[edge.to] = candidate;
                previous[edge.to] = current;
            }
        }
    }

    let far = start;
    for (const index of component) {
        const value = distanceTo[index] as number;
        if (Number.isFinite(value) && value > (distanceTo[far] as number)) {
            far = index;
        }
    }
    return { far, distance: distanceTo, previous };
}

/** Zerlegt den Graphen in seine Zusammenhangskomponenten. */
function componentsOf(neighbours: Adjacency): number[][] {
    const seen = new Array<boolean>(neighbours.length).fill(false);
    const components: number[][] = [];
    for (let start = 0; start < neighbours.length; start += 1) {
        if (seen[start]) {
            continue;
        }
        const component: number[] = [];
        const queue = [start];
        seen[start] = true;
        while (queue.length > 0) {
            const node = queue.pop() as number;
            component.push(node);
            for (const edge of neighbours[node] as { to: number; weight: number }[]) {
                if (!seen[edge.to]) {
                    seen[edge.to] = true;
                    queue.push(edge.to);
                }
            }
        }
        components.push(component);
    }
    return components;
}

/**
 * Der längste Weg durch den Graphen, über zwei Dijkstra-Läufe je Komponente.
 *
 * Vom beliebigen Startknoten zum entferntesten, von dort zum entferntesten — das ist der
 * Durchmesser. Bei einem Baum ist das exakt; die Chordal Axis eines Polygons ist einer, solange die
 * Fläche keine Löcher hat. Mit Loch kann ein Kreis entstehen, dann ist es eine gute Näherung, und
 * der Polynomfit danach macht ohnehin eine einzige Biegung daraus.
 *
 * 🪤 Der Graph ist regelmäßig **nicht** zusammenhängend: der Innentest lässt Dreiecke an Buchten und
 * Engstellen fallen und zerschneidet die Achse dabei in Inseln. Wer nur von Knoten 0 aus sucht,
 * bekommt die Insel, in der Knoten 0 zufällig liegt — bei den Drachensteinen 3 statt 80
 * Karteneinheiten, und der Name stand auf einem Stummel.
 */
export function longestPath(graph: AxisGraph): Point[] {
    if (graph.nodes.length === 0) {
        return [];
    }
    const neighbours = adjacencyOf(graph);
    let best: Point[] = [];
    let bestLength = 0;
    for (const component of componentsOf(neighbours)) {
        if (component.length < 2) {
            continue;
        }
        const first = farthestFrom(neighbours, component, component[0] as number);
        const second = farthestFrom(neighbours, component, first.far);
        const path: Point[] = [];
        for (let node = second.far; node !== -1; node = second.previous[node] as number) {
            path.push(graph.nodes[node] as Point);
            if (node === first.far) {
                break;
            }
        }
        path.reverse();
        const length = pathLength(path);
        if (length > bestLength) {
            bestLength = length;
            best = path;
        }
    }
    return best;
}

/** Gesamtlänge eines Linienzugs. */
export function pathLength(points: readonly Point[]): number {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
        total += distance(points[index - 1] as Point, points[index] as Point);
    }
    return total;
}

/** Gleichmäßig nach Bogenlänge neu abtasten. Der erste und der letzte Punkt bleiben liegen. */
export function resample(points: readonly Point[], count: number): Point[] {
    if (points.length < 2 || count < 2) {
        return [...points];
    }
    const total = pathLength(points);
    if (total === 0) {
        return [points[0] as Point, points[points.length - 1] as Point];
    }
    const step = total / (count - 1);
    const output: Point[] = [points[0] as Point];
    let segment = 1;
    let travelled = 0;
    for (let index = 1; index < count - 1; index += 1) {
        const target = step * index;
        while (segment < points.length - 1) {
            const length = distance(points[segment - 1] as Point, points[segment] as Point);
            if (travelled + length >= target) {
                break;
            }
            travelled += length;
            segment += 1;
        }
        const from = points[segment - 1] as Point;
        const to = points[segment] as Point;
        const length = distance(from, to);
        const ratio = length === 0 ? 0 : (target - travelled) / length;
        output.push({ x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio });
    }
    output.push(points[points.length - 1] as Point);
    return output;
}
