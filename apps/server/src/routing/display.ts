import { LEGACY_CATMULL, catmullRomPoint } from "@avesmaps3d/shared";

/**
 * Die gezeichnete Linie der Route (Betreiber 2026-09-25 zum Befund A seines Testers: „die leute glauben,
 * man überquert die straße“).
 *
 * Die Karte zeichnet jeden Weg als EINE Catmull-Rom-Kurve über den ganzen Weg (`derive/path-visual.ts`),
 * und die schwingt an Ecken gewollt bis 0,73 E über die Rohlinie hinaus. Geroutet wird auf der
 * Rohlinie. Ein an einem Anker geteilter Weg bekommt hier genau das Stück dieser Kurve, das er befährt,
 * und ein Gang querfeldein endet am Kurvenpunkt seines Ankers - sonst endete er scheinbar neben der
 * Straße, und die Route liefe neben ihr her. Gerechnet wird wie `catmullRomLine`, nur an beliebigen
 * Stellen statt an festen Abtastpunkten.
 */

/** Eine Stelle auf der Rohlinie eines Weges: Stück und Anteil darauf. */
interface Station {
    segment: number;
    t: number;
}

const EPSILON = 1e-9;

export class RouteDisplay {
    private readonly paths: ReadonlyMap<string, readonly [number, number][]>;

    constructor(paths: ReadonlyMap<string, readonly [number, number][]>) {
        this.paths = paths;
    }

    /** Der Punkt der gezeichneten Kurve an der Stelle eines Punktes der Rohlinie; null ohne den Weg. */
    pointOn(pathId: string, x: number, y: number): [number, number] | null {
        const points = this.paths.get(pathId);
        if (!points || points.length < 2) return null;
        return curveAt(points, locate(points, x, y, null));
    }

    /**
     * Das Stück der gezeichneten Kurve, das ein Stück der Rohlinie befährt - `coordinates` in der
     * gespeicherten Richtung des Weges. Null, wenn der Weg unbekannt ist.
     */
    piece(pathId: string, coordinates: readonly [number, number][]): [number, number][] | null {
        const points = this.paths.get(pathId);
        const [firstX, firstY] = coordinates[0] ?? [NaN, NaN];
        const [lastX, lastY] = coordinates[coordinates.length - 1] ?? [NaN, NaN];
        if (!points || points.length < 2 || coordinates.length < 2) return null;
        const from = locate(points, firstX, firstY, null);
        const to = locate(points, lastX, lastY, from);
        const line: [number, number][] = [curveAt(points, from)];
        for (let segment = from.segment; segment <= to.segment; segment += 1) {
            for (let sample = 1; sample <= LEGACY_CATMULL.samples; sample += 1) {
                const t = sample / LEGACY_CATMULL.samples;
                if (segment === from.segment && t <= from.t + EPSILON) continue;
                if (segment === to.segment && t >= to.t - EPSILON) break;
                line.push(curveAt(points, { segment, t }));
            }
        }
        line.push(curveAt(points, to));
        return line;
    }
}

/**
 * Wo ein Punkt auf der Rohlinie liegt: der nächste Fußpunkt, bei `after` erst ab dieser Stelle - ein
 * Weg, der sich selbst berührt, hat sonst zwei Antworten.
 */
function locate(points: readonly [number, number][], x: number, y: number, after: Station | null): Station {
    let best: Station = { segment: 0, t: 0 };
    let nearest = Infinity;
    for (let segment = after?.segment ?? 0; segment < points.length - 1; segment += 1) {
        const [ax, ay] = points[segment] as [number, number];
        const [bx, by] = points[segment + 1] as [number, number];
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSquared = dx * dx + dy * dy;
        let t = lengthSquared > 0 ? ((x - ax) * dx + (y - ay) * dy) / lengthSquared : 0;
        t = Math.max(after && segment === after.segment ? after.t : 0, Math.min(1, t));
        const distance = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
        if (distance < nearest - EPSILON) {
            nearest = distance;
            best = { segment, t };
        }
    }
    return best;
}

/** Der Kurvenpunkt an einer Stelle: dieselben Nachbarn und dieselbe Spannung wie `catmullRomLine`. */
function curveAt(points: readonly [number, number][], { segment, t }: Station): [number, number] {
    const at = (index: number): { x: number; y: number } => {
        const [x, y] = points[Math.max(0, Math.min(points.length - 1, index))] as [number, number];
        return { x, y };
    };
    const point = catmullRomPoint(
        at(segment - 1),
        at(segment),
        at(segment + 1),
        at(segment + 2),
        t,
        LEGACY_CATMULL.tension,
    );
    return [point.x, point.y];
}
