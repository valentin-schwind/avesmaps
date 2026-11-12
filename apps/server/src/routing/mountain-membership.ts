import type { DomainHeightSource, MountainMembership } from "../terrain/domain/read.ts";

/**
 * Die Zugehörigkeit der Rasterzellen zum Gebirge, zeilenweise (WI-0071, Nachtrag): dieselben Zellen wie
 * `domainMountainMask` (`terrain/domain/read.ts`), aber nach Zeilen statt nach Zellen gerechnet.
 *
 * `domainMountainMask` fragt für jede Zelle im Umkreis einer Fläche `pointInGeometry`: gerade/ungerade Kreuzungszahl
 * gegen jede Kante der Ringe. Das kostet je Zelle so viel wie die Fläche Kanten hat; gemessen am 4k-Raster 9 bis 10 s,
 * am 8k-Raster 25 bis 36 s des Ladens, und die Eichung des Geländes (WI-0067) wartete darauf bei jedem Kaltstart und bei
 * jeder Änderung an einer Gebirgsfläche. Hier schneidet jede Kante nur die Zeilen, die sie überspannt, und die Zellen
 * einer Zeile liegen dazwischen: Die Kosten sind Kanten mal überspannte Zeilen plus Zellen, nicht Kanten mal Zellen.
 *
 * 🔴 Dasselbe Ergebnis, Zelle für Zelle, auch an den Rändern. Dafür rechnet diese Datei mit denselben Zahlen wie
 * `pointInRing` (`packages/shared/src/gebirge/geometry.ts`): Die Zeile hat die Höhe `originY + Zeile * Zellgröße` und die Zelle die
 * Mitte `originX + Spalte * Zellgröße`, genau wie das Raster sie dort übergibt. Eine Kante schneidet die Zeile, wenn
 * ihre Höhe in `[tiefer, höher)` liegt, und zwar bei `((xj - xi) * (y - yi)) / (yj - yi) + xi`; die Zelle liegt innen,
 * wenn eine ungerade Zahl solcher Schnitte rechts von ihrer Mitte liegt (`x < Schnitt`). Ein Loch zählt für sich
 * (außen innen und in keinem Loch), die Teile einer MultiPolygon-Fläche ebenso, und gesetzt wird nur im Umkreis der
 * Fläche (`minX` bis `maxY`), den `domainMountainMask` ebenso begrenzt. `route-mountain-membership.test.ts` hält beide
 * gegeneinander, an zufälligen Ringen mit Löchern, Eckpunkten genau auf Zeilen und Spalten und falschem Umkreis.
 */

type Ring = readonly (readonly number[])[];
type Polygon = readonly Ring[];

/** Die Zellen, die die Zeilen und Spalten des Rasters bilden: Mitte der Zelle `index` ist `origin + index * cell`. */
interface Axis {
    origin: number;
    cell: number;
}

/**
 * Der kleinste Index in `[low, high]`, dessen Mitte `value` erreicht oder übersteigt, sonst `high`. Die Mitten wachsen
 * mit dem Index (Multiplikation und Addition runden monoton); der Schätzwert aus der Division liegt höchstens um eins
 * daneben und wird mit genau den Zahlen der Mitten berichtigt.
 */
function firstAtLeast(axis: Axis, value: number, low: number, high: number): number {
    let index = Math.min(high, Math.max(low, Math.ceil((value - axis.origin) / axis.cell)));
    while (index > low && axis.origin + (index - 1) * axis.cell >= value) index -= 1;
    while (index < high && axis.origin + index * axis.cell < value) index += 1;
    return index;
}

/** Die Fläche als Polygone: Ein Polygon ist ein äußerer Ring, gefolgt von seinen Löchern (wie `pointInGeometry`). */
function polygonsOf(geometry: MountainMembership["geometry"] | null | undefined): readonly Polygon[] {
    if (!geometry) return [];
    if (geometry.type === "Polygon") return [geometry.coordinates as Polygon];
    if (geometry.type === "MultiPolygon") return geometry.coordinates as readonly Polygon[];
    return [];
}

/** Die Schnitte der Kanten eines Rings mit den Zeilen `bottom` bis `top`, je Zeile (Index `Zeile - bottom`). */
function ringCrossings(ring: Ring, rowsAxis: Axis, bottom: number, top: number): (number[] | undefined)[] | null {
    const rows: (number[] | undefined)[] = new Array<number[] | undefined>(top - bottom + 1);
    const lowest = rowsAxis.origin + bottom * rowsAxis.cell;
    const highest = rowsAxis.origin + top * rowsAxis.cell;
    let any = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i] as readonly number[];
        const b = ring[j] as readonly number[];
        const xi = a[0] as number;
        const yi = a[1] as number;
        const xj = b[0] as number;
        const yj = b[1] as number;
        const low = yi < yj ? yi : yj;
        const high = yi < yj ? yj : yi;
        // Waagerecht oder ohne Zahl: kreuzt keine Zeile (`yi > y !== yj > y` ist dort nie wahr).
        if (!(low < high) || high <= lowest || low > highest) continue;
        const end = firstAtLeast(rowsAxis, high, bottom, top + 1);
        for (let row = firstAtLeast(rowsAxis, low, bottom, top + 1); row < end; row += 1) {
            const y = rowsAxis.origin + row * rowsAxis.cell;
            const crossing = ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
            if (Number.isNaN(crossing)) continue;
            (rows[row - bottom] ??= []).push(crossing);
            any = true;
        }
    }
    return any ? rows : null;
}

/**
 * Die Zellen `[von, bis)` einer Zeile, die im Ring liegen, als Paare in `into`: ungerade viele Schnitte rechts der
 * Zellmitte. Zwischen zwei aufeinanderfolgenden Schnitten ändert sich die Zahl nicht.
 */
function insideSpans(crossings: readonly number[], columns: Axis, left: number, right: number, into: number[]): void {
    into.length = 0;
    const sorted = Float64Array.from(crossings).sort();
    let start = left;
    for (let at = 0; at <= sorted.length; at += 1) {
        const end = at < sorted.length ? firstAtLeast(columns, sorted[at] as number, left, right + 1) : right + 1;
        // Links vom ersten Schnitt liegen alle `m` rechts der Mitte, hinter dem letzten keiner.
        if ((sorted.length - at) % 2 === 1 && start < end) into.push(start, end);
        start = end;
    }
}

/** Was beim Malen einer Zeile gebraucht wird: die Achsen, der Umkreis der Fläche und zwei Listen zum Wiederverwenden. */
interface Painter {
    mask: Uint8Array;
    width: number;
    from: number;
    columns: Axis;
    lines: Axis;
    /** Eine Zeile Zwischenraum für Polygone mit Löchern; zwischen zwei Zeilen überall 0. */
    scratch: Uint8Array;
    shell: number[];
    hole: number[];
}

/** Ein Polygon (äußerer Ring und Löcher) in die Zeilen `bottom` bis `top` und die Spalten `left` bis `right` malen. */
function paintPolygon(p: Painter, polygon: Polygon, left: number, right: number, bottom: number, top: number): void {
    const outline = polygon[0];
    if (!outline) return;
    const shell = ringCrossings(outline, p.lines, bottom, top);
    if (!shell) return;
    const holes: (number[] | undefined)[][] = [];
    for (const ring of polygon.slice(1)) {
        const crossings = ringCrossings(ring, p.lines, bottom, top);
        if (crossings) holes.push(crossings);
    }
    for (let row = bottom; row <= top; row += 1) {
        const crossings = shell[row - bottom];
        if (!crossings) continue;
        insideSpans(crossings, p.columns, left, right, p.shell);
        if (p.shell.length === 0) continue;
        const base = (row - p.from) * p.width;
        const cut = holes.filter((ring) => ring[row - bottom] !== undefined);
        if (cut.length === 0) {
            for (let at = 0; at < p.shell.length; at += 2)
                p.mask.fill(1, base + (p.shell[at] as number), base + (p.shell[at + 1] as number));
            continue;
        }
        // Mit Löchern: die Zellen im äußeren Ring, ohne die in einem Loch, dann in die Maske.
        for (let at = 0; at < p.shell.length; at += 2)
            p.scratch.fill(1, p.shell[at] as number, p.shell[at + 1] as number);
        for (const ring of cut) {
            insideSpans(ring[row - bottom] as number[], p.columns, left, right, p.hole);
            for (let at = 0; at < p.hole.length; at += 2)
                p.scratch.fill(0, p.hole[at] as number, p.hole[at + 1] as number);
        }
        for (let column = p.shell[0] as number; column < (p.shell[p.shell.length - 1] as number); column += 1) {
            if (!p.scratch[column]) continue;
            p.mask[base + column] = 1;
            p.scratch[column] = 0;
        }
    }
}

/**
 * Die Zugehörigkeit zum Gebirge für die Rasterzeilen `from` bis `to` (ohne `to`): die Vereinigung der Gebirgsflächen,
 * auch Zellen mit Höhe 0. Die Eichung des Geländes liest sie streifenweise statt als ganzes Raster (16 MiB bei 4k,
 * 64 MiB bei 8k) neben dem Raster selbst (WI-0071).
 */
export function mountainMembershipRows(source: DomainHeightSource, from: number, to: number): Uint8Array {
    const r = source.raster;
    const painter: Painter = {
        mask: new Uint8Array(r.width * Math.max(0, to - from)),
        width: r.width,
        from,
        columns: { origin: r.originX, cell: r.cell },
        lines: { origin: r.originY, cell: r.cell },
        scratch: new Uint8Array(r.width),
        shell: [],
        hole: [],
    };
    for (const area of source.mountains) {
        const left = Math.max(0, Math.ceil((area.minX - r.originX) / r.cell));
        const bottom = Math.max(from, Math.ceil((area.minY - r.originY) / r.cell));
        const right = Math.min(r.width - 1, Math.floor((area.maxX - r.originX) / r.cell));
        const top = Math.min(to - 1, r.height - 1, Math.floor((area.maxY - r.originY) / r.cell));
        if (!(left <= right && bottom <= top)) continue;
        for (const polygon of polygonsOf(area.geometry)) paintPolygon(painter, polygon, left, right, bottom, top);
    }
    return painter.mask;
}
