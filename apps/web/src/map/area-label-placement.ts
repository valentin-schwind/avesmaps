import type { AreaLabelPoint, AreaLabelPoints } from "./landscape-layers";

/**
 * Wo der Name einer Fläche steht, die ihn mittig im sichtbaren Teil trägt: die Klimazonen (WI-0012, Nachtrag 2026-10-05) und die
 * Sprachen (WI-0261 S5a, E5: „die labels der flächen können bei den sprachen auch so angezeigt werden wie bei den klimazonen“).
 * Für die Klimazonen, wörtlich: „ob du die zonennamen statt links mittig anzeigen könntest - immer da wo die zone ist“.
 *
 * Reine Geometrie, ohne Karte: Bänder und Meere kommen als Ringe am Boden (Mercator, 0 bis 1), die Umrechnung zwischen
 * Boden und Bild reicht der Aufrufer (`GroundProjection`, in `area-labels.ts` MapLibres Kamera ohne Gelände). „Band“ heißt hier
 * jede Fläche mit einem Namen, eine Klimazone wie eine Sprache.
 *
 * 1. **Was zu sehen ist:** das Band in der freien Fläche der Karte, ohne das Meer, das deckend darüber liegt (Betreiber
 *    2026-10-05: die Meere stehen in der Klimaansicht). Über dem Meer ist von der Zone nichts zu sehen.
 * 2. **Wo die Mitte ist:** Senkrechte Schnitte durch das Bild, im Abstand von etwa `COLUMN_SPACING` Bildpunkten, je Schnitt
 *    die Abschnitte des Bandes ohne Meer. Ihr Schwerpunkt ist die Mitte des sichtbaren Teils (geneigt im Bild gemessen,
 *    nicht am Boden). Am Boden gerechnet wird nur, wo die Schnitte die Ränder kreuzen: Jede Senkrechte im Bild ist auch
 *    am Boden eine Gerade, selbst geneigt.
 * 3. **Wo der Name steht:** auf der Senkrechten durch diesen Schwerpunkt, in der Mitte des Abschnitts, in dem der
 *    Schwerpunkt liegt. So steht er auch in einem schrägen Band mittig zwischen den Grenzen. Liegt der Schwerpunkt im Meer
 *    (eine Zone aus Inseln), steht er im nächsten Abschnitt mit Platz.
 * 4. **Zu schmal:** Ein Abschnitt, der niedriger ist als ein Name samt Saum, trägt keinen; hat keiner Platz, steht keiner
 *    (Legacy, WI-0012: „dann lieber kein Name als einer, der in die Nachbarzone ragt“).
 * 5. **Am Rand:** Ein Name, der über den Rand der freien Fläche ragte, rückt waagrecht hinein, wo sein Band dort Platz hat
 *    (seit 2026-10-05 stehen die Namen in Versalien und 22 px, die längsten messen rund 384 px).
 *
 * **Flächen, die sich überlappen** (`ausweichen`, die Sprachen; Bauvorlage `namenZiele` der Probierseite 2026-10-30): Klimazonen
 * teilen sich nie eine Stelle, Sprachen schon. Deshalb dort zwei Regeln mehr:
 *
 * 6. **Ausweichen:** Der größte sichtbare Teil setzt zuerst. Ein Name, der auf einen schon gesetzten träfe, rückt im eigenen
 *    sichtbaren Teil an die nächste freie Stelle (nächst dem Schwerpunkt), statt wegzufallen; findet er keine, steht keiner.
 * 7. **Platz auch in der Breite:** Über die ganze Breite des Namens (samt Saum) muss seine Fläche ihn in der Höhe tragen,
 *    nicht nur an der Senkrechten seiner Mitte; und er bleibt ganz in der freien Fläche. Ein Name, der breiter ist als sie,
 *    steht nicht.
 */

export type Point2 = readonly [number, number];

/** Wie die Karte gerade zwischen Boden (Mercator) und Bild (CSS-Pixel der Karte) umrechnet. */
export interface GroundProjection {
    toScreen(ground: Point2): Point2;
    toGround(screen: Point2): Point2;
}

/** Ein Ring als flache Liste `x0, y0, x1, y1, …` am Boden, ohne den Schlusspunkt zu wiederholen. */
export type Ring = readonly number[];

/** Eine Fläche, wie sie aus einer Kachel kommt: Außenring zuerst, dann die Löcher, dazu ihr Rahmen. */
export interface Piece {
    rings: readonly Ring[];
    /** `minX, minY, maxX, maxY` aller Ringe. */
    bbox: readonly [number, number, number, number];
}

/**
 * Ein Band: sein Schlüssel (`type_key`, bei Sprachen der Schlüssel der Sprache), sein Name und seine Teile aus allen geladenen
 * Kacheln. `properties` reist mit bis in den Punkt der Quelle (die Farben eines Sprachnamens); Klimazonen tragen keine.
 */
export interface BandShape {
    key: string;
    name: string;
    pieces: readonly Piece[];
    properties?: Readonly<Record<string, string>>;
}

/** Die sichtbare Fläche der Karte in Bildpunkten (ohne das, was ein Panel deckt). */
export interface ScreenRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** Wo ein Name stehen soll. */
export interface LabelTarget {
    key: string;
    name: string;
    /** Die Stelle im Bild. */
    at: Point2;
    /** Wie hoch der sichtbare Teil des Bandes an dieser Stelle im Bild ist. */
    room: number;
    properties?: Readonly<Record<string, string>>;
}

/** So dicht liegen die Schnitte, in Bildpunkten. Feiner sieht man den Schwerpunkt nicht wandern. */
export const COLUMN_SPACING = 32;

/**
 * So dicht liegen die Schnitte, wenn Namen ausweichen und Platz in der Breite brauchen: Ein Name von 200 Bildpunkten liegt über
 * gut zwölf Schnitten; eine Bucht dazwischen fiele bei 32 eher durch (die Bauvorlage prüft in Zeilen zu 10 Bildpunkten).
 */
export const AVOID_COLUMN_SPACING = 16;

/** Wie Namen sich setzen; ohne Angabe wie die Klimazonen. */
export interface PlacementOptions {
    /** Flächen, die sich überlappen (Sprachen): ausweichen und Platz in der Breite (Regeln 6 und 7 oben). */
    ausweichen?: boolean;
}

/** Ein Teil samt Rahmen. */
export function piece(rings: readonly Ring[]): Piece {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ring of rings) {
        for (let i = 0; i + 1 < ring.length; i += 2) {
            const x = ring[i]!;
            const y = ring[i + 1]!;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    return { rings, bbox: [minX, minY, maxX, maxY] };
}

/**
 * Ein Ring ohne Punkte, die näher als `tolerance` am letzten behaltenen liegen. Eine Küste aus Legacys Raster hat in der
 * Übersicht 33.000 Punkte; für eine Mitte genügt ein Punkt je Bildpunkt.
 */
export function thinRing(ring: Ring, tolerance: number): number[] {
    const out: number[] = [];
    const limit = tolerance * tolerance;
    for (let i = 0; i + 1 < ring.length; i += 2) {
        const x = ring[i]!;
        const y = ring[i + 1]!;
        const n = out.length;
        if (n >= 2) {
            const dx = x - out[n - 2]!;
            const dy = y - out[n - 1]!;
            if (dx * dx + dy * dy < limit) continue;
        }
        out.push(x, y);
    }
    return out;
}

/** Eine Senkrechte im Bild, am Boden: von oben (`u = 0`) nach unten (`u = 1`). */
interface ScanLine {
    x: number;
    g0x: number;
    g0y: number;
    dx: number;
    dy: number;
    length2: number;
    bbox: readonly [number, number, number, number];
}

function scanLine(x: number, rect: ScreenRect, projection: GroundProjection): ScanLine | undefined {
    const [g0x, g0y] = projection.toGround([x, rect.top]);
    const [g1x, g1y] = projection.toGround([x, rect.bottom]);
    const dx = g1x - g0x;
    const dy = g1y - g0y;
    const length2 = dx * dx + dy * dy;
    if (!Number.isFinite(length2) || length2 === 0) return undefined;
    return {
        x,
        g0x,
        g0y,
        dx,
        dy,
        length2,
        bbox: [Math.min(g0x, g1x), Math.min(g0y, g1y), Math.max(g0x, g1x), Math.max(g0y, g1y)],
    };
}

const overlaps = (a: readonly number[], b: readonly number[]): boolean =>
    a[0]! <= b[2]! && b[0]! <= a[2]! && a[1]! <= b[3]! && b[1]! <= a[3]!;

/** Wo Flächen die Senkrechte decken, als Anteile `u` von 0 bis 1, zusammengelegt (Teile überlappen sich im Kachelpuffer). */
export function spansAlong(pieces: readonly Piece[], line: ScanLine): [number, number][] {
    const spans: [number, number][] = [];
    for (const part of pieces) {
        if (!overlaps(part.bbox, line.bbox)) continue;
        const crossings: number[] = [];
        for (const ring of part.rings) {
            const n = ring.length / 2;
            let px = ring[2 * n - 2]!;
            let py = ring[2 * n - 1]!;
            let ps = line.dx * (py - line.g0y) - line.dy * (px - line.g0x);
            for (let k = 0; k < n; k++) {
                const qx = ring[2 * k]!;
                const qy = ring[2 * k + 1]!;
                const qs = line.dx * (qy - line.g0y) - line.dy * (qx - line.g0x);
                // Halboffen (> 0 gegen ≤ 0): Ein Eckpunkt genau auf der Linie zählt einmal, nicht zweimal.
                if (ps > 0 !== qs > 0) {
                    const t = ps / (ps - qs);
                    const cx = px + t * (qx - px);
                    const cy = py + t * (qy - py);
                    crossings.push(((cx - line.g0x) * line.dx + (cy - line.g0y) * line.dy) / line.length2);
                }
                px = qx;
                py = qy;
                ps = qs;
            }
        }
        crossings.sort((a, b) => a - b);
        for (let i = 0; i + 1 < crossings.length; i += 2) {
            const from = Math.max(0, crossings[i]!);
            const to = Math.min(1, crossings[i + 1]!);
            if (to > from) spans.push([from, to]);
        }
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const span of spans) {
        const last = merged[merged.length - 1];
        if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
        else merged.push([span[0], span[1]]);
    }
    return merged;
}

/** `spans` ohne `holes` (beide sortiert und zusammengelegt). */
export function subtractSpans(
    spans: readonly (readonly [number, number])[],
    holes: readonly (readonly [number, number])[],
): [number, number][] {
    const out: [number, number][] = [];
    for (const [from, to] of spans) {
        let start = from;
        for (const [a, b] of holes) {
            if (b <= start) continue;
            if (a >= to) break;
            if (a > start) out.push([start, a]);
            start = Math.max(start, b);
            if (start >= to) break;
        }
        if (start < to) out.push([start, to]);
    }
    return out;
}

/** Die Abschnitte im Bild (oben, unten), aus Anteilen der Senkrechten. */
function onScreen(
    spans: readonly (readonly [number, number])[],
    line: ScanLine,
    rect: ScreenRect,
    projection: GroundProjection,
): [number, number][] {
    const yAt = (u: number): number =>
        u <= 0
            ? rect.top
            : u >= 1
              ? rect.bottom
              : projection.toScreen([line.g0x + u * line.dx, line.g0y + u * line.dy])[1];
    return spans.map(([from, to]) => {
        const a = yAt(from);
        const b = yAt(to);
        return [Math.min(a, b), Math.max(a, b)];
    });
}

/**
 * Je Band im Bild die Stelle seines Namens; Bänder ohne sichtbaren Teil oder ohne Platz an dieser Stelle fehlen.
 *
 * @param seas was deckend über den Bändern liegt (die Meere der Klimaansicht); leer, wo nichts darüber liegt
 * @param room die Höhe, die ein Name samt Saum braucht (Bildpunkte)
 * @param widthOf wie breit ein Name samt Saum im Bild steht (Bildpunkte); ohne Angabe rückt kein Name vom Rand weg
 * @param options `ausweichen` für Flächen, die sich überlappen (Sprachen)
 */
export function placeBandLabels(
    bands: readonly BandShape[],
    seas: readonly Piece[],
    rect: ScreenRect,
    projection: GroundProjection,
    room: number,
    widthOf?: (name: string) => number,
    options: PlacementOptions = {},
): LabelTarget[] {
    const width = rect.right - rect.left;
    if (width <= 0 || rect.bottom <= rect.top || bands.length === 0) return [];
    const ausweichen = options.ausweichen === true;
    const columns = Math.max(8, Math.round(width / (ausweichen ? AVOID_COLUMN_SPACING : COLUMN_SPACING)));
    const sums = bands.map(() => ({ length: 0, x: 0, y: 0 }));
    // Je Band die Abschnitte, die einen Namen tragen könnten (Senkrechte bei `x`, oben, unten).
    const candidates = bands.map((): [number, number, number][] => []);
    // Je Band und Senkrechte alle sichtbaren Abschnitte: Beim Ausweichen prüfen sie den Platz in der Breite.
    const columnSpans = bands.map((): { x: number; spans: [number, number][] }[] => []);
    const visible = (band: BandShape, line: ScanLine, water: [number, number][]): [number, number][] =>
        onScreen(subtractSpans(spansAlong(band.pieces, line), water), line, rect, projection);
    for (let column = 0; column < columns; column++) {
        const line = scanLine(rect.left + ((column + 0.5) * width) / columns, rect, projection);
        if (!line) continue;
        const water = spansAlong(seas, line);
        bands.forEach((band, index) => {
            const sum = sums[index]!;
            const spans = visible(band, line, water);
            if (ausweichen) columnSpans[index]!.push({ x: line.x, spans });
            for (const [top, bottom] of spans) {
                const length = bottom - top;
                sum.length += length;
                sum.x += line.x * length;
                sum.y += ((top + bottom) / 2) * length;
                if (length >= room) candidates[index]!.push([line.x, top, bottom]);
            }
        });
    }
    if (ausweichen) {
        return placeAvoiding({
            bands,
            sums,
            columnSpans,
            room,
            rect,
            widthOf: (name) => widthOf?.(name) ?? 0,
            spansAt: (band, x) => {
                const line = scanLine(x, rect, projection);
                return line ? visible(band, line, spansAlong(seas, line)) : [];
            },
        });
    }
    const targets: LabelTarget[] = [];
    bands.forEach((band, index) => {
        const sum = sums[index]!;
        if (sum.length <= 0) return;
        const [cx, cy] = [sum.x / sum.length, sum.y / sum.length];
        // Zuerst die Senkrechte durch den Schwerpunkt; liegt er dort im Meer oder ist der Abschnitt zu schmal (eine Zone aus
        // Inseln, eine zerklüftete Küste), der nächste Abschnitt mit Platz auf einer der übrigen Senkrechten.
        const line = scanLine(cx, rect, projection);
        const own: [number, number, number][] = line
            ? visible(band, line, spansAlong(seas, line))
                  .filter(([top, bottom]) => bottom - top >= room)
                  .map(([top, bottom]) => [cx, top, bottom])
            : [];
        let best: [number, number, number] | undefined;
        let bestDistance = Infinity;
        for (const candidate of [...own, ...candidates[index]!]) {
            const [x, top, bottom] = candidate;
            const distance = Math.hypot(x - cx, cy < top ? top - cy : cy > bottom ? cy - bottom : 0);
            // Bei gleichem Abstand der höhere Abschnitt.
            if (distance < bestDistance || (distance === bestDistance && best && bottom - top > best[2] - best[1])) {
                best = candidate;
                bestDistance = distance;
            }
        }
        if (!best) return;
        const placed = inside(best, widthOf?.(band.name) ?? 0, candidates[index]!, (at) => {
            const shifted = scanLine(at, rect, projection);
            return shifted ? visible(band, shifted, spansAlong(seas, shifted)) : [];
        });
        const [x, top, bottom] = placed;
        targets.push({
            key: band.key,
            name: band.name,
            at: [x, (top + bottom) / 2],
            room: bottom - top,
            ...(band.properties ? { properties: band.properties } : {}),
        });
    });
    return targets;

    /**
     * Ein Name, der über den Rand der freien Fläche ragte, rückt waagrecht hinein, soweit er dort Platz in seinem Band hat
     * (ein langer Name am Rand des Bildes, am Telefon auch mittig). Hat das Band an der eingerückten Stelle keinen Platz,
     * steht er im nächsten Abschnitt mit Platz, der ganz im Bild liegt. Gibt es keinen, oder ist er breiter als die
     * Fläche, bleibt er, wo er war.
     */
    function inside(
        spot: [number, number, number],
        labelWidth: number,
        others: readonly [number, number, number][],
        spansAt: (x: number) => [number, number][],
    ): [number, number, number] {
        const half = labelWidth / 2;
        const [x, top, bottom] = spot;
        const low = rect.left + half;
        const high = rect.right - half;
        if (half === 0 || low > high || (x >= low && x <= high)) return spot;
        const to = Math.min(high, Math.max(low, x));
        const middle = (top + bottom) / 2;
        const choices: [number, number, number][] = [
            ...spansAt(to).map(([a, b]): [number, number, number] => [to, a, b]),
            ...others.filter(([at]) => at >= low && at <= high),
        ];
        let best: [number, number, number] | undefined;
        let bestDistance = Infinity;
        for (const choice of choices) {
            const [at, a, b] = choice;
            if (b - a < room) continue;
            const distance = Math.hypot(at - x, middle < a ? a - middle : middle > b ? middle - b : 0);
            if (distance < bestDistance) {
                best = choice;
                bestDistance = distance;
            }
        }
        return best ?? spot;
    }
}

/** Ein gesetzter Name im Bild: links, oben, rechts, unten. */
type Box = readonly [number, number, number, number];

const boxesOverlap = (a: Box, b: Box): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Ein halber Bildpunkt Spiel: Ein Name, der genau an den Rand seines Abschnitts rückt, scheitert nicht an der Rundung. */
const SLACK = 0.5;

/** Trägt einer der Abschnitte die Höhe von `top` bis `bottom`? */
const carries = (spans: readonly (readonly [number, number])[], top: number, bottom: number): boolean =>
    spans.some(([a, b]) => a <= top + SLACK && b >= bottom - SLACK);

/**
 * Regeln 6 und 7 (Flächen, die sich überlappen): der größte sichtbare Teil zuerst; je Name die Stelle nächst seinem Schwerpunkt,
 * an der seine Fläche ihn über die ganze Breite trägt, die ganz in der freien Fläche liegt und keinen schon gesetzten Namen trifft.
 *
 * Gesucht wird in zwei Stufen, weil die Rechnung in jedem Bild der Kamera läuft: zuerst je Senkrechte die Höhe nächst dem
 * Schwerpunkt (dort steht der Name fast immer), erst wenn keine davon frei ist, auch die übrigen Höhen jedes Abschnitts in
 * Schritten einer halben Namenshöhe. Die Ränder des Namens prüft je eine Senkrechte genau an der Kante.
 */
function placeAvoiding(input: {
    bands: readonly BandShape[];
    sums: readonly { length: number; x: number; y: number }[];
    columnSpans: readonly (readonly { x: number; spans: [number, number][] }[])[];
    room: number;
    rect: ScreenRect;
    widthOf: (name: string) => number;
    spansAt: (band: BandShape, x: number) => [number, number][];
}): LabelTarget[] {
    const { bands, sums, columnSpans, room, rect } = input;
    const half = room / 2;
    const placed: Box[] = [];
    const targets: LabelTarget[] = [];
    const order = bands
        .map((_, index) => index)
        .filter((index) => sums[index]!.length > 0)
        .sort((a, b) => sums[b]!.length - sums[a]!.length);
    for (const index of order) {
        const band = bands[index]!;
        const sum = sums[index]!;
        const [cx, cy] = [sum.x / sum.length, sum.y / sum.length];
        const halfWidth = input.widthOf(band.name) / 2;
        const low = rect.left + halfWidth;
        const high = rect.right - halfWidth;
        if (low > high) continue;
        const columns = columnSpans[index]!;
        /** Steht ein Name mit der Mitte bei (x, y) frei und über seine ganze Breite getragen? */
        const fits = ([x, y]: Point2): boolean => {
            const box: Box = [x - halfWidth, y - half, x + halfWidth, y + half];
            if (placed.some((other) => boxesOverlap(other, box))) return false;
            for (const column of columns) {
                if (column.x < box[0] || column.x > box[2]) continue;
                if (!carries(column.spans, box[1], box[3])) return false;
            }
            // Die beiden Kanten genau: Zwischen zwei Senkrechten könnte eine Bucht liegen.
            return (
                carries(input.spansAt(band, box[0]), box[1], box[3]) &&
                carries(input.spansAt(band, box[2]), box[1], box[3])
            );
        };
        /** Die Stellen einer Senkrechten bei `x`: je Abschnitt mit Platz die Höhe nächst dem Schwerpunkt, mit `all` alle Höhen. */
        const spots = (x: number, spans: readonly (readonly [number, number])[], all: boolean): Point2[] => {
            const at = Math.min(high, Math.max(low, x));
            const out: Point2[] = [];
            for (const [top, bottom] of spans) {
                if (bottom - top < room) continue;
                const from = top + half;
                const to = bottom - half;
                out.push([at, Math.min(to, Math.max(from, cy))]);
                if (all) for (let y = from; y <= to; y += half) out.push([at, y]);
            }
            return out;
        };
        const nearest = (list: Point2[]): Point2[] =>
            list.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
        const own = input.spansAt(band, Math.min(high, Math.max(low, cx)));
        const search = (all: boolean): Point2 | undefined =>
            nearest([...spots(cx, own, all), ...columns.flatMap((column) => spots(column.x, column.spans, all))]).find(
                fits,
            );
        const spot = search(false) ?? search(true);
        if (!spot) continue;
        const [x, y] = spot;
        placed.push([x - halfWidth, y - half, x + halfWidth, y + half]);
        const span = input.spansAt(band, x).find(([a, b]) => a <= y && b >= y);
        targets.push({
            key: band.key,
            name: band.name,
            at: [x, y],
            room: span ? span[1] - span[0] : room,
            ...(band.properties ? { properties: band.properties } : {}),
        });
    }
    return targets;
}

/**
 * Wie weit ein Name je Zug zu einer neuen Stelle aufschließt (Anteil des Wegs). Die Stelle eines Namens kann springen, wenn
 * eine Insel durch einen Schnitt wandert oder ein Abschnitt zu schmal wird; der Name gleitet dann hin, statt zu springen.
 * Eine Stelle, die mit der Karte wandert (ein kleiner sichtbarer Teil), eilt beim Verschieben um gut einen Zug nach; eine,
 * die im Bild stehen bleibt (die Mitte einer breiten Zone), gar nicht.
 */
export const FOLLOW = 0.45;

/** Näher als so viele Bildpunkte: angekommen. */
const ARRIVED = 0.5;

const lngOf = (x: number): number => x * 360 - 180;
const latOf = (y: number): number => (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - 90;

/**
 * Aus den Stellen der Namen die Punkte der Quelle: Die Stelle im Bild (`shown`) schließt zu ihrem Ziel auf (`FOLLOW`), bei
 * reduzierter Bewegung steht sie sofort dort; der Punkt ist der Boden unter ihr.
 *
 * @param shown wo die Namen im letzten Zug standen (Bildpunkte)
 * @returns wo sie jetzt stehen, die Punkte der Quelle und ob alle angekommen sind
 */
export function composeLabelPoints(
    shown: ReadonlyMap<string, Point2>,
    targets: readonly LabelTarget[],
    projection: GroundProjection,
    reducedMotion = false,
): { shown: Map<string, Point2>; points: AreaLabelPoints; settled: boolean } {
    const next = new Map<string, Point2>();
    const features: AreaLabelPoint[] = [];
    let settled = true;
    for (const target of targets) {
        const previous = shown.get(target.key);
        // Ein Name, der neu ins Bild kommt, beginnt an seiner Stelle.
        let at: Point2 = target.at;
        if (previous !== undefined && !reducedMotion) {
            const dx = target.at[0] - previous[0];
            const dy = target.at[1] - previous[1];
            if (Math.hypot(dx, dy) > ARRIVED) {
                at = [previous[0] + dx * FOLLOW, previous[1] + dy * FOLLOW];
                settled = false;
            }
        }
        next.set(target.key, at);
        const [x, y] = projection.toGround(at);
        features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [lngOf(x), latOf(y)] },
            properties: { ...target.properties, type_key: target.key, name: target.name },
        });
    }
    return { shown: next, points: { type: "FeatureCollection", features }, settled };
}
