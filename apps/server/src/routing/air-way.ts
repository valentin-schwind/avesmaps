import { werte } from "./einstellungen.ts";
import { AVENTURIA_FLIGHT_CARTOGRAPHY, roundCornersWhere } from "@avesmaps3d/shared";
import { buildCostField, type AirCostField, type AirFieldRule } from "./air-field.ts";
import {
    airTerrain,
    blockedCells,
    blockedFromHeights,
    boundsAbove,
    centreHeights,
    heightCells,
    type AirBox,
    type AirFrame,
    type AirTerrain,
} from "./air-obstacles.ts";
import { STRAIGHT_AIR_WAY, type AirPoint, type AirWay } from "./air-route.ts";
import { AirSearch, costAlong, pullTautOverTerrain, type AirGrid } from "./air-search.ts";
import { pullTautOverField } from "./air-taut.ts";
import { chordAbove, reliefAt, type TerrainHeights } from "./relief.ts";

/**
 * Der Weg des Flugs um die Gebirge (WI-0051, F2; F-E1 = C, F-E3 = B): der `AirWay`, den `findAirRoute` je
 * Wegpunktpaar fragt.
 *
 * - **Ist die Luftlinie frei, bleibt es die Luftlinie**, genau wie in F1: `chordAbove` prüft im Domain-DEM
 *   das Maximum jeder bilinearen Zelle gegen dasselbe Gelände wie jede andere Rechnung (`reliefAt`).
 * - **Sonst wird gesucht** (`air-search.ts`), auf einem Hindernisraster nur über einem Fenster der Etappe.
 *   Das Gebirge, in dem ein Wegpunkt liegt, kostet dort zehnfach, fremdes praktisch unendlich.
 * - **Das Fenster:** Das erste fasst jeden Weg, der höchstens `FIRST_SLACK` länger ist als die Luftlinie
 *   (eine Ellipse um beide Wegpunkte), dazu `END_MARGIN` um jeden Wegpunkt für den Ausgang aus seinem
 *   Gebirge. Ein günstigerer Weg als der gefundene ist höchstens so lang wie dessen Preis, abzüglich des
 *   Aufschlags, den jeder Weg über dem eigenen Gebirge zahlt; reicht die Ellipse dieser Länge über das
 *   Fenster hinaus, wird einmal in ihr gesucht. Muss der Flug über fremdes Gebirge, geht es ins größte
 *   Fenster: alles Gelände über der Grenze samt beiden Wegpunkten.
 * - **Die Zelle** ist 0,5 E breit; über `AIR_CELL_LIMIT` Zellen verdoppelt sie sich, wie querfeldein.
 * - Eine Etappe hält ihre Felder nur, solange sie rechnet; nichts wird je Höhe aufbewahrt.
 * - **F4, F4b (2026-10-04):** Dieser Weg ist der erste Kandidat der Abwägung (`air-weigh.ts`), die ihn gegen den Weg der
 *   Suche über dem Kostenfeld wägt (`flyOverField`, `air-field.ts`): EIN Raster über der Ellipse der Etappe, in dem
 *   jede Zelle Länge und Zuschlag über der Reisehöhe kostet; Gelände über der Grenze bleibt auch dort gesperrt.
 *
 * 🪤 **Warum nicht der Sichtbarkeitsgraph der freien Seefahrt?** Der wird je Datenstand abgeleitet und
 * gespeichert (`sea_route_graph`, PostGIS schiebt und vereinfacht die Küste). Der Flug bräuchte einen je
 * Höchstflughöhe; bis 2026-10-04 war die je Flugmittel verschieden und die des eigenen beliebig, seither ist sie
 * für alle dieselbe (5.000 Schritt über dem Meer, Grenze 4.800). Es bliebe also EIN Graph - aber die Etappen, die
 * überhaupt suchen, sind seither selten, und das Raster je Etappe kostet ein paar Millisekunden ohne jeden
 * Speicher dazwischen (WI-0051, „F2 Server“, „F2 korrigiert“). Übernommen sind Aufbau und Straffziehen der
 * Suche (`sea-search.ts`).
 */

/** So viele Zellen hat ein Fenster höchstens; darüber verdoppelt sich die Zelle (rund 7 Byte je Zelle). */
export const AIR_CELL_LIMIT = 1_500_000;
/** Das erste Fenster fasst jeden Weg, der höchstens so viel länger ist als die Luftlinie. */
const FIRST_SLACK = 0.25;
/** Um jeden Wegpunkt mindestens so viel Fenster, in Karteneinheiten: Platz für den Ausgang aus dem Gebirge. */
const END_MARGIN = 8;
/** Rand um jedes Fenster, in Zellen: Um das größte Fenster läuft so ein Ring ohne Sperre. */
const PAD_CELLS = 2;

type Point = [number, number];

/** Der Weg einer Etappe um die Gebirge, mit dem, was ihn erklärt. */
export interface AirDetour {
    points: Point[];
    /** Actual final search grid; diagnostics must use its resolution when classifying home components. */
    frame: AirFrame;
    /** Länge der Linie in Karteneinheiten. */
    distance: number;
    /** Karteneinheiten über gesperrten Zellen, nach dem Maß der Suche; 0, wenn der Flug die Sperre meidet. */
    blocked: number;
    /** Wie oft gesucht wurde (Fenster), und das größte Fenster in Zellen. */
    searches: number;
    cells: number;
    /** Was die Suche im größten Fenster belegte, in Byte. */
    bytes: number;
}

/** Der Flug einer Anfrage: der Weg je Etappe, und ob eine Etappe um Gebirge suchen muss. */
export interface AirFlight {
    way: AirWay;
    /**
     * Obstacle-verified display; the client must not smooth it again. Start und Ziel nennen die Etappe, deren Weg
     * die Linie ist (F4: Die Abwägung rundet um die Schwelle des gewählten Wegs); ohne sie gilt die Grenze der Höchstflughöhe.
     */
    display?: (points: Point[], from?: AirPoint, to?: AirPoint) => Point[];
    /** Berührt die Luftlinie Gelände über der Grenze? Dann sucht die Etappe (`ROUTE_FLIGHT_SEARCH_LIMIT`). */
    searches: (from: AirPoint, to: AirPoint) => boolean;
}

/** Ohne Gelände: immer die Luftlinie, keine Etappe sucht. */
export const STRAIGHT_FLIGHT: AirFlight = { way: STRAIGHT_AIR_WAY, searches: () => false };

/**
 * Der Flug für eine Höchstflughöhe über dem Meer: um das Gelände, das höher liegt als `ceilingSchritt` minus
 * `clearanceSchritt`. Der Dienst fragt mit der absoluten Höchstflughöhe, für alle Flugmittel dieselbe (Betreiber
 * 2026-10-04). Ohne Gelände die Luftlinie.
 */
export function terrainAirFlight(
    heights: TerrainHeights | null | undefined,
    ceilingSchritt: number,
    clearanceSchritt: number,
): AirFlight {
    return heights ? mountainAirFlight(airTerrain(heights), ceilingSchritt - clearanceSchritt) : STRAIGHT_FLIGHT;
}

/**
 * Der Flug um alles Gelände, das höher liegt als `limit` Schritt. Er gilt für EINE Anfrage: Dieselbe Etappe
 * (gleiche Lage von Start und Ziel, in dieser Richtung) wird nur einmal geprüft und gesucht, wie Etappen und
 * Seelinien seit `7928560` (Claudio 2026-09-28, `2026-09-28-flug-worker-budget-antwort.md`). Aufbewahrt
 * werden nur die fertigen Linien; die Suchfelder jeder Etappe sind nach ihr frei.
 */
export function mountainAirFlight(terrain: AirTerrain, limit: number): AirFlight {
    const bounds = boundsAbove(terrain, limit);
    if (!bounds) return STRAIGHT_FLIGHT;
    const touches = new Map<string, boolean>();
    const lines = new Map<string, Point[]>();
    const keyOf = (from: AirPoint, to: AirPoint): string => `${from.x}:${from.y}\u0000${to.x}:${to.y}`;
    const searches = (from: AirPoint, to: AirPoint): boolean => {
        const key = keyOf(from, to);
        let touch = touches.get(key);
        if (touch === undefined) {
            touch = chordAbove(terrain.heights, from, to, limit);
            touches.set(key, touch);
        }
        return touch;
    };
    const way: AirWay = (from, to) => {
        if (!searches(from, to)) return STRAIGHT_AIR_WAY(from, to);
        const key = keyOf(from, to);
        let line = lines.get(key);
        if (!line) {
            line = flyAround(terrain, limit, from, to, bounds).points;
            lines.set(key, line);
        }
        return line;
    };
    return { way, searches, display: roundedDisplay(terrain, limit) };
}

/**
 * Die gezeichnete Linie eines Wegs um das Gelände über `limit`: jede Ecke so weit gerundet, wie sie frei bleibt
 * (`roundCornersWhere`). Chaikin im Ganzen, nur im Ganzen geprüft, fiel an jeder Ecke durch, die um ein Gebirge
 * straff gezogen ist (WI-0051 F3).
 */
export function roundedDisplay(terrain: AirTerrain, limit: number): (points: Point[]) => Point[] {
    return (points) => {
        const rounds = AVENTURIA_FLIGHT_CARTOGRAPHY.form.eckenRunden;
        if (rounds <= 0) return points;
        return roundCornersWhere(
            points.map(([x, y]) => ({ x, y })),
            (from, to) => !chordAbove(terrain.heights, from, to, limit),
            2 ** (rounds + 1),
        ).map(({ x, y }): Point => [x, y]);
    };
}

const unite = (a: AirBox, b: AirBox): AirBox => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
});

const clip = (a: AirBox, b: AirBox): AirBox => ({
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
});

const covers = (a: AirBox, b: AirBox): boolean =>
    a.minX <= b.minX && a.minY <= b.minY && a.maxX >= b.maxX && a.maxY >= b.maxY;

const around = (point: AirPoint, reach: number): AirBox => ({
    minX: point.x - reach,
    minY: point.y - reach,
    maxX: point.x + reach,
    maxY: point.y + reach,
});

/** Das Rechteck um die Ellipse aller Wege von `from` nach `to`, die höchstens `length` lang sind. */
function ellipseBox(from: AirPoint, to: AirPoint, length: number): AirBox {
    const direct = Math.hypot(to.x - from.x, to.y - from.y);
    const a = Math.max(length, direct) / 2;
    const b = Math.sqrt(Math.max(0, a * a - (direct / 2) ** 2));
    const cos = direct > 0 ? (to.x - from.x) / direct : 1;
    const sin = direct > 0 ? (to.y - from.y) / direct : 0;
    const halfX = Math.hypot(a * cos, b * sin);
    const halfY = Math.hypot(a * sin, b * cos);
    const x = (from.x + to.x) / 2;
    const y = (from.y + to.y) / 2;
    return { minX: x - halfX, minY: y - halfY, maxX: x + halfX, maxY: y + halfY };
}

/** Das Raster über einem Rechteck: auf ganze Zellen gebracht, mit Rand, bei zu vielen Zellen gröber. */
export function frameOver(box: AirBox, cellLimit = werte().airCellLimit): AirFrame {
    for (let cell = werte().airCellUnits; ; cell *= 2) {
        // Auf dem Gitter der Zellbreite: Zwei Fenster derselben Etappe teilen ihre Zellen.
        const left = Math.floor(box.minX / cell) - PAD_CELLS;
        const bottom = Math.floor(box.minY / cell) - PAD_CELLS;
        const cols = Math.ceil(box.maxX / cell) + PAD_CELLS - left;
        const rows = Math.ceil(box.maxY / cell) + PAD_CELLS - bottom;
        if (cols * rows <= cellLimit) return { minX: left * cell, minY: bottom * cell, cell, cols, rows };
    }
}

/**
 * Der Weg um das Gelände über `limit`, dessen Luftlinie gesperrt ist: gesucht im ersten Fenster, bei Bedarf
 * im Fenster der gefundenen Länge oder im größten. `bounds` ist das Gelände über der Grenze (`boundsAbove`).
 */
export function flyAround(
    terrain: AirTerrain,
    limit: number,
    from: AirPoint,
    to: AirPoint,
    bounds: AirBox,
    cellLimit = werte().airCellLimit,
): AirDetour {
    const outer = unite(bounds, unite(around(from, 0), around(to, 0)));
    const direct = Math.hypot(to.x - from.x, to.y - from.y);
    const ends = unite(around(from, END_MARGIN), around(to, END_MARGIN));
    let box = clip(unite(ellipseBox(from, to, direct * (1 + FIRST_SLACK)), ends), outer);
    let searches = 0;
    let cells = 0;
    let bytes = 0;
    for (;;) {
        const frame = frameOver(box, cellLimit);
        const found = searchIn(terrain, limit, frame, from, to);
        searches += 1;
        cells = Math.max(cells, frame.cols * frame.rows);
        bytes = Math.max(bytes, found.bytes);
        // Ein günstigerer Weg ist höchstens `longest` lang, liegt also in dieser Ellipse. Über fremdes Gebirge nur,
        // wenn es auch im größten Fenster sein muss.
        const wanted = found.forced
            ? outer
            : clip(unite(ellipseBox(from, to, found.longest + 2 * frame.cell), ends), outer);
        if (covers(box, wanted) || searches >= 3) {
            return {
                points: found.points,
                frame,
                distance: found.distance,
                blocked: found.blocked,
                searches,
                cells,
                bytes,
            };
        }
        box = unite(box, wanted);
    }
}

/**
 * Das Raster der Abwägung (F4b, `air-weigh.ts`): EIN Raster über der Ellipse der längsten Länge `reach`, die einen Weg
 * noch lohnen kann (dazu `END_MARGIN` um die Wegpunkte), begrenzt auf das Land samt den Wegpunkten. Null, wo kein Gelände
 * liegt. Ohne das Gelände zu lesen: So viele Zellen kostet jede Rechnung darin.
 */
export function airFieldFrame(
    terrain: AirTerrain,
    from: AirPoint,
    to: AirPoint,
    reach: number,
    cellLimit: number,
): AirFrame | null {
    const bounds = boundsAbove(terrain, 0);
    if (!bounds) return null;
    const outer = unite(bounds, unite(around(from, 0), around(to, 0)));
    const ends = unite(around(from, END_MARGIN), around(to, END_MARGIN));
    const direct = Math.hypot(to.x - from.x, to.y - from.y);
    return frameOver(clip(unite(ellipseBox(from, to, Math.max(reach, direct)), ends), outer), cellLimit);
}

/**
 * Der Weg einer Etappe über dem Kostenfeld (F4b): ein A* in `frame`, in dem jeder Schritt zur Länge kostet, was das
 * Fliegen dort über der Reisehöhe kostet (`air-field.ts`), und das Gelände über `limit` (die Höchstflughöhe minus den
 * Mindestabstand, 4.800 Schritt) wie in F2 gesperrt ist. Straff gezogen nach demselben Preis. Das Gelände wird einmal in
 * den Boden je Zelle gelesen; aus ihm kommen Sperre und Kostenfeld.
 */
export function flyOverField(
    terrain: AirTerrain,
    frame: AirFrame,
    limit: number,
    rule: AirFieldRule,
    from: AirPoint,
    to: AirPoint,
): AirDetour {
    const highest = heightCells(terrain, frame, 0);
    const field = buildCostField(frame, highest, centreHeights(terrain, frame), rule);
    const found = searchIn(terrain, limit, frame, from, to, blockedFromHeights(highest, limit), field);
    return {
        points: found.points,
        frame,
        distance: found.distance,
        blocked: found.blocked,
        searches: 1,
        cells: frame.cols * frame.rows,
        bytes:
            found.bytes +
            highest.byteLength +
            field.ground.byteLength +
            field.altitude.reduce((sum, axis) => sum + axis.byteLength, 0),
    };
}

/** Liegt der Wegpunkt selbst über der Grenze? */
function pointAbove(heights: TerrainHeights, point: AirPoint, limit: number): boolean {
    const here = reliefAt(heights, point.x, point.y);
    return here.height > Math.max(0, limit);
}

/** Eine Suche in einem Fenster. */
function searchIn(
    terrain: AirTerrain,
    limit: number,
    frame: AirFrame,
    from: AirPoint,
    to: AirPoint,
    blockedAbove: Uint8Array = blockedCells(terrain, frame, limit),
    field?: AirCostField,
): { points: Point[]; distance: number; longest: number; blocked: number; forced: boolean; bytes: number } {
    const grid: AirGrid = { ...frame, blocked: blockedAbove, ...(field ? { field } : {}) };
    const cellOf = (point: AirPoint): number => {
        const column = Math.min(frame.cols - 1, Math.max(0, Math.floor((point.x - frame.minX) / frame.cell)));
        const row = Math.min(frame.rows - 1, Math.max(0, Math.floor((point.y - frame.minY) / frame.cell)));
        return row * frame.cols + column;
    };
    const start = cellOf(from);
    const goal = cellOf(to);
    // Ein Wegpunkt, der selbst tiefer liegt, steht frei, auch wenn seine Zelle anderswo höher reicht. In
    // dieser einen Zelle kann die Linie dann höheres Gelände streifen; der Wegpunkt liegt ja daneben.
    if (!pointAbove(terrain.heights, from, limit)) grid.blocked[start] = 0;
    if (!pointAbove(terrain.heights, to, limit)) grid.blocked[goal] = 0;
    const search = new AirSearch(grid);
    const route = search.route(start, goal);
    // Vom Wegpunkt erst zur Mitte seiner Zelle: So schneidet schon der erste Schritt keine Nachbarzelle an.
    const stairs: Point[] = [
        [from.x, from.y],
        ...route.cells.map((cell): Point => [
            frame.minX + ((cell % frame.cols) + 0.5) * frame.cell,
            frame.minY + (Math.floor(cell / frame.cols) + 0.5) * frame.cell,
        ]),
        [to.x, to.y],
    ];
    const points = field ? pullTautOverField(grid, stairs) : pullTautOverTerrain(grid, stairs);
    let distance = 0;
    let cost = 0;
    for (let index = 1; index < points.length; index += 1) {
        const [x0, y0] = points[index - 1] as Point;
        const [x1, y1] = points[index] as Point;
        distance += Math.hypot(x1 - x0, y1 - y0);
        cost += costAlong(grid, x0, y0, x1, y1);
    }
    // Ein günstigerer Weg kostet weniger als dieser. Sein Preis ist seine Länge plus der Aufschlag auf das
    // eigene Gebirge der Wegpunkte, und davon zahlt jeder Weg mindestens `route.reach`: So lang ist er höchstens.
    const longest = cost - (werte().homeFactor - 1) * route.reach;
    // Über fremdes Gebirge führt die Suche nur, wenn das Fenster keinen anderen Weg lässt.
    return { points, distance, longest, blocked: route.blocked, forced: route.crossing > 0, bytes: search.bytes };
}
