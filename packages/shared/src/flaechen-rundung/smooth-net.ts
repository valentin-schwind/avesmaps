import { reverseCoords, ringSignedArea2, smoothLine, type Coords } from "./smooth-line.ts";
import {
    buildGrid,
    cellRange,
    comparePoints,
    createPointTable,
    pointId,
    sealPointTable,
    type PointGrid,
    type PointTable,
} from "./smooth-points.ts";

/** Eine Fläche: Teile, je Teil die Ringe (der erste ist die Hülle), jeder Ring geschlossen (wie `apps/server/src/areas/wkb.ts` sie liest). */
export type SurfaceCoords = Coords[][];

/**
 * 🔴 **Eine Rechnung für Server und Browser** (WI-0178 Paket L2, Betreiber 2026-10-16 T27 (6): „beim Ziehen die fertige Rundung
 * live, die Ecken dünn dazu“): Diese Datei lag als `apps/server/src/areas/smooth-net.ts` beim Glätten der Karte; seit L2 liegt sie
 * in `packages/shared`, damit der Landschaftseditor beim Ziehen Punkt für Punkt dieselbe Rundung zeigt, die der Auftrag danach
 * speichert. Keine Datenbank, kein Node: nur Zahlen.
 *
 * Das gemeinsame Kantennetz aller Flächen, nahtlos geglättet (WI-0077, Betreiber 2026-10-04: „ich will dass alle flächen
 * geglättet werden - und zwar auf die art und weise, die wir vorgeschlagen hatten“; Verfahren aus WI-0055, Migration 0067).
 *
 * Reine Rechnung ohne Datenbank: Flächen hinein, geglättete Flächen heraus. Vier Schritte:
 *
 *   1. **Zusammenführen.** Punkte, die höchstens `tolerance` auseinanderliegen, werden zu einem (Kette über alle Nachbarn,
 *      der lexikografisch kleinste bleibt; wie `ST_ClusterDBSCAN` in 0067). Liegt ein Punkt einer anderen Fläche näher als
 *      `tolerance` an einem Randstück, wird er dort eingefügt (T-Stoß, wie `ST_Snap`). Danach haben zwei Flächen, die eine
 *      Grenze teilen, dort dieselben Punkte, auch wenn die eine Wald und die andere Hügelland ist.
 *   2. **Wem gehört jedes Randstück?** Ein Randstück zwischen zwei Punkten gehört allen Flächen, deren Rand genau dieses Stück
 *      trägt (gleiche Punkte, Richtung egal). Ein Rand zerfällt in **Ketten**: Stücke hintereinander mit denselben
 *      Eigentümern. Wo die Eigentümer wechseln, endet eine Kette, und dieser Punkt bleibt fest. Gekreuzt wird nichts:
 *      Eine Waldgrenze, die eine Hügellandgrenze nur quert, teilt mit ihr kein Stück, und keine der beiden bekommt dort einen
 *      festen Punkt.
 *   3. **Jede Kette einmal glätten.** Chaikin, `passes` Durchgänge, Enden fest; eine Kette, die einen ganzen Ring bildet
 *      (eine Insel, ein See ohne Nachbarn), rundet sich ohne festen Punkt wie ein Gewässer (`terrain_water_smooth`). Danach
 *      vereinfacht auf `resolution`. Die Kette liegt in einer festen Richtung und mit festem Anfang vor (nach den
 *      Koordinaten, nicht nach der Fläche), damit das Ergebnis nicht davon abhängt, welche Flächen gerade mitgerechnet werden.
 *   4. **Flächen neu bilden.** Jeder Ring setzt sich aus den geglätteten Ketten zusammen, die er trägt. Eine gemeinsame
 *      Kette liegt in allen Eigentümern als dieselbe Linie: kein Spalt, keine Überlappung, über alle Ebenen.
 *
 * **Der Kartenrand bleibt gerade** (`frame`; wie bei den Klimazonen, Betreiber 2026-10-04: „ich will nicht, dass die
 * kontrollpunkte and den ränder geglättet werden“): Ein Punkt höchstens `frame.margin` vom Rand der Kartendomäne ist fest,
 * und ein Stück zwischen zwei solchen Punkten bleibt eine Gerade. Ohne die Regel rundete Chaikin die Ecken der Karte ab,
 * wo ein Meer sie füllt (Ifirns Ozean: 5.493 E² in der Nordwestecke ohne Meer, gemessen).
 *
 * 🔴 Lokal gleich global: Das Ergebnis einer Fläche hängt nur von den Flächen ab, deren Rand höchstens `tolerance` (über
 * Ketten fast gleicher Punkte etwas mehr) neben ihrem Rand liegt. Wer nur eine geänderte Fläche und ihre Nachbarn neu
 * glättet und die Nachbarn der Nachbarn mitrechnet (`writeIds`), bekommt Punkt für Punkt dasselbe wie der volle Lauf.
 *
 * Gültigkeit prüft die Datenbank beim Schreiben (`ST_IsValid`, sonst `ST_MakeValid`); ein misslungener Ring fällt hier nur
 * weg, und die Fläche behält dann dort ihre Ausgangsform.
 */

export interface NetArea {
    /** Kennung der Fläche (`region_area.id`). */
    id: number;
    /** Ebene der Region; zählt nur für die Statistik, welche gemeinsamen Ketten Ebenen überspannen. */
    layer: string;
    /** Die gültige Ausgangsform: Teile, je Teil Hülle und Löcher, jeder Ring geschlossen. */
    polygons: SurfaceCoords;
}

export interface NetOptions {
    /** Punkte, die höchstens so weit auseinanderliegen, gelten als derselbe; so nah fügt sich ein Punkt in ein Randstück. */
    tolerance: number;
    /** Durchgänge der Chaikin-Glättung. */
    passes: number;
    /** Vereinfachung der geglätteten Ketten (Douglas-Peucker). */
    resolution: number;
    /** Der Rand der Kartendomäne: Punkte höchstens `margin` davon bleiben fest. Ohne Angabe ist kein Punkt fest. */
    frame?: { minX: number; minY: number; maxX: number; maxY: number; margin: number } | undefined;
    /** Wird nach jedem Schritt mit seinem Namen gerufen (Zeit und Speicher messen). */
    onPhase?: ((name: string) => void) | undefined;
}

export interface NetStats {
    /** Verschiedene Stützpunkte der Eingabe. */
    vertices: number;
    /** Gruppen fast gleicher Punkte, die zu einem wurden. */
    mergedPoints: number;
    /** Punkte, die als T-Stoß in ein Randstück einer anderen Fläche eingefügt wurden. */
    insertedPoints: number;
    /** Ketten im Netz, davon mit mindestens zwei Eigentümern, davon über mindestens zwei Ebenen. */
    chains: number;
    sharedChains: number;
    crossLayerChains: number;
}

export interface NetResult {
    /** Je geschriebener Fläche die geglättete Form; fehlt eine, ging jeder Ring verloren (Rückfall auf die Ausgangsform). */
    shapes: Map<number, SurfaceCoords>;
    stats: NetStats;
}

/** Ein Ring als Punktkennungen, ohne Schlusspunkt. */
type RingIds = Int32Array;

interface WorkArea {
    id: number;
    layer: string;
    /** Teile, je Teil Hülle und Löcher; jeder Schritt ersetzt sie. */
    polygons: RingIds[][];
    /** Vor dem Zusammenführen: der Rückfall, wenn dabei jeder Teil verschwände. */
    original: RingIds[][];
    write: boolean;
}

/** Eine Kette eines Rings: welche, und ob der Ring sie rückwärts liest. */
interface RunRef {
    chain: number;
    reversed: boolean;
}

/** Alle Ketten des Netzes, je einmal. */
interface Chains {
    ids: Int32Array[];
    open: boolean[];
    owner: number[];
    needed: boolean[];
    /** Je Fläche, Teil und Ring die Ketten in Ringfolge. */
    areaRuns: RunRef[][][][];
}

/** Die Eigentümer je Randstück (in der Reihenfolge der Ringe), dazu je Eigentümersatz Größe und Zahl der Ebenen. */
interface Owners {
    segOwner: Int32Array;
    size: number[];
    layers: number[];
}

/**
 * Das Netz rechnen. `writeIds`: nur für diese Flächen wird eine Form gebaut (die übrigen sind Nachbarn, die mitzählen);
 * ohne Angabe für alle.
 */
/** Das Rezept des Netzes; Migration 0072 nennt es in `region_area_smooth_recipe()`. Server (`areas/smooth.ts`) und Editor nehmen dasselbe. */
export const SMOOTH_NET_OPTIONS: NetOptions = Object.freeze({
    // Punkte, die höchstens so weit auseinanderliegen, sind derselbe (Legacy rundet auf Tausendstel; WI-0055 gemessen).
    tolerance: 0.001,
    // Dieselbe Rundung wie `terrain_water_smooth` (Migration 0053).
    passes: 3,
    // Ein halber Bildpunkt der größten Kamerazoomstufe (Zoom 8, 128 Bildpunkte je E).
    resolution: 0.004,
});

export function smoothNet(areas: readonly NetArea[], options: NetOptions, writeIds?: ReadonlySet<number>): NetResult {
    const phase = options.onPhase ?? ((): void => {});
    const { table, work } = ingest(areas, writeIds);
    const vertices = table.count;
    phase("eingelesen");
    const mergedPoints = mergeNearPoints(table, work, options.tolerance);
    phase("zusammengefuehrt");
    const insertedPoints = insertTouchingPoints(table, work, options.tolerance);
    phase("T-Stoesse");
    const owners = ownersOfSegments(vertices, work);
    phase("Eigentuemer");
    const chains = buildChains(table, work, owners.segOwner, framePoints(table, options.frame));
    phase("Ketten");
    const smoothed = smoothChains(table, chains, options);
    phase("geglaettet");
    const shapes = assemble(work, chains.areaRuns, smoothed);
    phase("zusammengesetzt");
    let sharedChains = 0;
    let crossLayerChains = 0;
    for (const owner of chains.owner) {
        if ((owners.size[owner] as number) > 1) sharedChains += 1;
        if ((owners.layers[owner] as number) > 1) crossLayerChains += 1;
    }
    return {
        shapes,
        stats: { vertices, mergedPoints, insertedPoints, chains: chains.ids.length, sharedChains, crossLayerChains },
    };
}

/** Die Flächen als Punktkennungen; jeder Ring ohne Schlusspunkt und ohne aufeinanderfolgende Dopplungen. */
function ingest(
    areas: readonly NetArea[],
    writeIds: ReadonlySet<number> | undefined,
): { table: PointTable; work: WorkArea[] } {
    let capacity = 0;
    for (const area of areas) for (const rings of area.polygons) for (const ring of rings) capacity += ring.length / 2;
    const table = createPointTable(capacity);
    const work: WorkArea[] = [];
    for (const area of areas) {
        const polygons: RingIds[][] = [];
        for (const rings of area.polygons) {
            const shell = rings[0] ? coordsToIds(table, rings[0]) : undefined;
            if (!shell) continue;
            const polygon = [shell];
            for (const hole of rings.slice(1)) {
                const ids = coordsToIds(table, hole);
                if (ids) polygon.push(ids);
            }
            polygons.push(polygon);
        }
        work.push({
            id: area.id,
            layer: area.layer,
            polygons,
            original: polygons,
            write: writeIds ? writeIds.has(area.id) : true,
        });
    }
    sealPointTable(table);
    return { table, work };
}

function coordsToIds(table: PointTable, ring: Coords): RingIds | undefined {
    const out: number[] = [];
    const n = ring.length / 2;
    for (let p = 0; p < n; p += 1) out.push(pointId(table, ring[2 * p] as number, ring[2 * p + 1] as number));
    return compactRing(out);
}

/** Aufeinanderfolgende gleiche Punkte entfernen (auch über den Schluss); unter drei Punkten bleibt kein Ring. */
function compactRing(ids: readonly number[]): RingIds | undefined {
    const out: number[] = [];
    for (const id of ids) if (out.length === 0 || out[out.length - 1] !== id) out.push(id);
    while (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
    return out.length >= 3 ? Int32Array.from(out) : undefined;
}

function find(parent: Int32Array, i: number): number {
    let root = i;
    while ((parent[root] as number) !== root) root = parent[root] as number;
    let node = i;
    while ((parent[node] as number) !== root) {
        const next = parent[node] as number;
        parent[node] = root;
        node = next;
    }
    return root;
}

/**
 * 1a. Fast gleiche Punkte zusammenführen: jede Kette von Paaren höchstens `tolerance` auseinander wird ein Punkt, der
 * lexikografisch kleinste. Gibt die Zahl der Gruppen mit mehr als einem Punkt zurück.
 */
function mergeNearPoints(table: PointTable, work: WorkArea[], tolerance: number): number {
    const vertices = table.count;
    const parent = new Int32Array(vertices);
    for (let id = 0; id < vertices; id += 1) parent[id] = id;
    const near = buildGrid(table, tolerance, () => true);
    const range = new Int32Array(2);
    for (let id = 0; id < vertices; id += 1) {
        const x = table.xs[id] as number;
        const y = table.ys[id] as number;
        const cx = Math.floor(x / tolerance);
        const cy = Math.floor(y / tolerance);
        for (let dx = -1; dx <= 1; dx += 1) {
            cellRange(near, cx + dx, cy - 1, cy + 1, range);
            for (let q = range[0] as number; q < (range[1] as number); q += 1) {
                const other = near.ids[q] as number;
                if (other <= id) continue;
                const ox = (table.xs[other] as number) - x;
                const oy = (table.ys[other] as number) - y;
                if (Math.sqrt(ox * ox + oy * oy) <= tolerance) {
                    const a = find(parent, id);
                    const b = find(parent, other);
                    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
                }
            }
        }
    }
    const best = new Int32Array(vertices).fill(-1);
    const members = new Int32Array(vertices);
    for (let id = 0; id < vertices; id += 1) {
        const root = find(parent, id);
        members[root] = (members[root] as number) + 1;
        const current = best[root] as number;
        if (current < 0 || comparePoints(table, id, current) < 0) best[root] = id;
    }
    let groups = 0;
    const rep = new Int32Array(vertices);
    for (let id = 0; id < vertices; id += 1) {
        const root = find(parent, id);
        rep[id] = best[root] as number;
        if (root === id && (members[id] as number) > 1) groups += 1;
    }
    if (groups === 0) return 0;
    for (const area of work) {
        const merged: RingIds[][] = [];
        for (const polygon of area.polygons) {
            const shell = compactRing(Array.from(polygon[0] as RingIds, (id) => rep[id] as number));
            if (!shell) continue;
            const rings = [shell];
            for (const hole of polygon.slice(1)) {
                const ids = compactRing(Array.from(hole, (id) => rep[id] as number));
                if (ids) rings.push(ids);
            }
            merged.push(rings);
        }
        // Eine Fläche, die dabei verschwände, behält ihre Ausgangsform.
        area.polygons = merged.length > 0 ? merged : area.original;
    }
    return groups;
}

/** Was die T-Stöße eines Laufs teilen: Punkte, Gitter und Merker, einmal angelegt. */
interface SnapContext {
    table: PointTable;
    grid: PointGrid;
    tolerance: number;
    firstArea: Int32Array;
    shared: Uint8Array;
    stamp: Int32Array;
    range: Int32Array;
}

/**
 * 1b. T-Stöße: Punkte anderer Flächen, die näher als `tolerance` an einem Randstück liegen, dort einfügen (wie `ST_Snap`:
 * jeder Punkt in das nächste Randstück des Rings, nie ein Punkt, den der Ring schon trägt). Gibt die Zahl der eingefügten
 * Punkte zurück.
 */
function insertTouchingPoints(table: PointTable, work: WorkArea[], tolerance: number): number {
    const vertices = table.count;
    // Wer trägt welchen Punkt: die erste Fläche und ob es mehrere sind.
    const firstArea = new Int32Array(vertices).fill(-1);
    const shared = new Uint8Array(vertices);
    for (const [index, area] of work.entries()) {
        for (const polygon of area.polygons) {
            for (const ring of polygon) {
                for (const id of ring) {
                    const first = firstArea[id] as number;
                    if (first < 0) firstArea[id] = index;
                    else if (first !== index) shared[id] = 1;
                }
            }
        }
    }
    const context: SnapContext = {
        table,
        grid: buildGrid(table, Math.max(tolerance * 50, 0.05), (id) => (firstArea[id] as number) >= 0),
        tolerance,
        firstArea,
        shared,
        stamp: new Int32Array(vertices),
        range: new Int32Array(2),
    };
    let ringStamp = 0;
    let inserted = 0;
    for (const [index, area] of work.entries()) {
        for (const polygon of area.polygons) {
            for (let r = 0; r < polygon.length; r += 1) {
                const ring = polygon[r] as RingIds;
                const snapped = snapRing(ring, index, context, ++ringStamp);
                if (snapped) {
                    inserted += snapped.length - ring.length;
                    polygon[r] = snapped;
                }
            }
        }
    }
    return inserted;
}

/**
 * Die T-Stöße eines Rings: Punkte anderer Flächen, die näher als `tolerance` an einem Randstück liegen (und nicht an dessen
 * Enden), werden dort eingefügt, jeder in das nächste Stück. `undefined`: nichts einzufügen.
 */
function snapRing(ring: RingIds, area: number, context: SnapContext, ringStamp: number): RingIds | undefined {
    const { table, grid, tolerance, firstArea, shared, stamp, range } = context;
    const n = ring.length;
    for (const id of ring) stamp[id] = ringStamp;
    let found: Map<number, { segment: number; distance: number; t: number }> | undefined;
    const size = grid.size;
    for (let k = 0; k < n; k += 1) {
        const a = ring[k] as number;
        const b = ring[(k + 1) % n] as number;
        const ax = table.xs[a] as number;
        const ay = table.ys[a] as number;
        const bx = table.xs[b] as number;
        const by = table.ys[b] as number;
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSqr = dx * dx + dy * dy;
        if (lengthSqr === 0) continue;
        const cx0 = Math.floor((Math.min(ax, bx) - tolerance) / size);
        const cx1 = Math.floor((Math.max(ax, bx) + tolerance) / size);
        const cy0 = Math.floor((Math.min(ay, by) - tolerance) / size);
        const cy1 = Math.floor((Math.max(ay, by) + tolerance) / size);
        // Kurze Stücke: alle Zellen ihres Rahmens. Ein langes, schräges Stück: an Stützstellen im Abstand einer Zelle
        // entlang, je drei mal drei Zellen (ein Punkt näher als `tolerance` liegt in einer davon).
        const short = (cx1 - cx0 + 1) * (cy1 - cy0 + 1) <= 64;
        const steps = short ? 0 : Math.ceil(Math.hypot(dx, dy) / size) + 1;
        for (let step = 0; step <= steps; step += 1) {
            const sx = Math.floor((ax + (dx * step) / Math.max(steps, 1)) / size);
            const sy = Math.floor((ay + (dy * step) / Math.max(steps, 1)) / size);
            const fromX = short ? cx0 : sx - 1;
            const toX = short ? cx1 : sx + 1;
            for (let cx = fromX; cx <= toX; cx += 1) {
                cellRange(grid, cx, short ? cy0 : sy - 1, short ? cy1 : sy + 1, range);
                for (let q = range[0] as number; q < (range[1] as number); q += 1) {
                    const id = grid.ids[q] as number;
                    if ((stamp[id] as number) === ringStamp) continue;
                    if ((firstArea[id] as number) === area && (shared[id] as number) === 0) continue;
                    const px = table.xs[id] as number;
                    const py = table.ys[id] as number;
                    const t = ((px - ax) * dx + (py - ay) * dy) / lengthSqr;
                    if (t <= 0 || t >= 1) continue;
                    const ex = ax + t * dx - px;
                    const ey = ay + t * dy - py;
                    const distance = Math.sqrt(ex * ex + ey * ey);
                    if (distance >= tolerance) continue;
                    found ??= new Map();
                    const previous = found.get(id);
                    if (!previous || distance < previous.distance) found.set(id, { segment: k, distance, t });
                }
            }
        }
    }
    if (!found) return undefined;
    const bySegment = new Map<number, { id: number; t: number }[]>();
    for (const [id, hit] of found) {
        const list = bySegment.get(hit.segment) ?? [];
        list.push({ id, t: hit.t });
        bySegment.set(hit.segment, list);
    }
    const out: number[] = [];
    for (let k = 0; k < n; k += 1) {
        out.push(ring[k] as number);
        const hits = bySegment.get(k);
        if (!hits) continue;
        hits.sort((p, q) => p.t - q.t || p.id - q.id);
        for (const hit of hits) out.push(hit.id);
    }
    return Int32Array.from(out);
}

/** 2. Eigentümer je Randstück: dasselbe Paar von Punkten, Richtung egal. */
function ownersOfSegments(vertices: number, work: readonly WorkArea[]): Owners {
    let count = 0;
    for (const area of work) for (const polygon of area.polygons) for (const ring of polygon) count += ring.length;
    const segKey = new Float64Array(count);
    const segArea = new Int32Array(count);
    let s = 0;
    for (const [index, area] of work.entries()) {
        for (const polygon of area.polygons) {
            for (const ring of polygon) {
                const n = ring.length;
                for (let k = 0; k < n; k += 1) {
                    const a = ring[k] as number;
                    const b = ring[(k + 1) % n] as number;
                    segKey[s] = Math.min(a, b) * vertices + Math.max(a, b);
                    segArea[s] = index;
                    s += 1;
                }
            }
        }
    }
    const order = new Int32Array(count);
    for (let q = 0; q < count; q += 1) order[q] = q;
    order.sort(
        (a, b) => (segKey[a] as number) - (segKey[b] as number) || (segArea[a] as number) - (segArea[b] as number),
    );
    const segOwner = new Int32Array(count);
    const ownerIds = new Map<string, number>();
    const size: number[] = [];
    const layers: number[] = [];
    for (let q = 0; q < count;) {
        const key = segKey[order[q] as number] as number;
        let end = q;
        const owners: number[] = [];
        while (end < count && segKey[order[end] as number] === key) {
            const owner = segArea[order[end] as number] as number;
            if (owners[owners.length - 1] !== owner) owners.push(owner);
            end += 1;
        }
        const signature = owners.join(",");
        let ownerId = ownerIds.get(signature);
        if (ownerId === undefined) {
            ownerId = size.length;
            ownerIds.set(signature, ownerId);
            size.push(owners.length);
            layers.push(new Set(owners.map((owner) => (work[owner] as WorkArea).layer)).size);
        }
        for (let p = q; p < end; p += 1) segOwner[order[p] as number] = ownerId;
        q = end;
    }
    return { segOwner, size, layers };
}

/** Die festen Punkte am Kartenrand (1) als Merker je Punkt. */
function framePoints(table: PointTable, frame: NetOptions["frame"]): Uint8Array {
    const fixed = new Uint8Array(table.count);
    if (!frame) return fixed;
    for (let id = 0; id < table.count; id += 1) {
        const x = table.xs[id] as number;
        const y = table.ys[id] as number;
        if (
            x <= frame.minX + frame.margin ||
            x >= frame.maxX - frame.margin ||
            y <= frame.minY + frame.margin ||
            y >= frame.maxY - frame.margin
        ) {
            fixed[id] = 1;
        }
    }
    return fixed;
}

/**
 * 3. Ketten: Stücke mit denselben Eigentümern hintereinander, in fester Richtung, je einmal. Eine Kette endet, wo die
 * Eigentümer wechseln oder an einem festen Punkt (`fixed`, Kartenrand).
 */
function buildChains(table: PointTable, work: readonly WorkArea[], segOwner: Int32Array, fixed: Uint8Array): Chains {
    const index = new Map<string, number>();
    const chains: Chains = { ids: [], open: [], owner: [], needed: [], areaRuns: [] };
    let s = 0;
    for (const area of work) {
        const polygonsRuns: RunRef[][][] = [];
        for (const polygon of area.polygons) {
            const ringsRuns: RunRef[][] = [];
            for (const ring of polygon) {
                const resolved: RunRef[] = [];
                for (const run of ringChains(ring, segOwner, s, table, fixed)) {
                    let chain = index.get(run.key);
                    if (chain === undefined) {
                        chain = chains.ids.length;
                        index.set(run.key, chain);
                        chains.ids.push(run.ids);
                        chains.open.push(run.open);
                        chains.owner.push(run.owner);
                        chains.needed.push(false);
                    }
                    if (area.write) chains.needed[chain] = true;
                    resolved.push({ chain, reversed: run.reversed });
                }
                s += ring.length;
                ringsRuns.push(resolved);
            }
            polygonsRuns.push(ringsRuns);
        }
        chains.areaRuns.push(polygonsRuns);
    }
    return chains;
}

interface Run {
    key: string;
    ids: Int32Array;
    open: boolean;
    reversed: boolean;
    owner: number;
}

/** Die Ketten eines Rings in Ringfolge, je in fester Richtung (`reversed`: im Ring rückwärts gelesen). */
function ringChains(ring: RingIds, segOwner: Int32Array, offset: number, table: PointTable, fixed: Uint8Array): Run[] {
    const n = ring.length;
    const ownerAt = (k: number): number => segOwner[offset + (((k % n) + n) % n)] as number;
    // Vor dem Stück k endet eine Kette: andere Eigentümer als das Stück davor, oder sein Anfang ist ein fester Punkt.
    const breaksAt = (k: number): boolean =>
        ownerAt(k) !== ownerAt(k - 1) || (fixed[ring[((k % n) + n) % n] as number] as number) === 1;
    let start = -1;
    for (let k = 0; k < n; k += 1) {
        if (breaksAt(k)) {
            start = k;
            break;
        }
    }
    if (start < 0) {
        // Ein ganzer Ring mit denselben Eigentümern: ohne festen Punkt, Anfang am kleinsten Punkt, gegen den Uhrzeigersinn.
        let min = 0;
        for (let q = 1; q < n; q += 1) if (comparePoints(table, ring[q] as number, ring[min] as number) < 0) min = q;
        const rotated = new Int32Array(n);
        for (let q = 0; q < n; q += 1) rotated[q] = ring[(min + q) % n] as number;
        const coords = new Float64Array(2 * n + 2);
        for (let q = 0; q <= n; q += 1) {
            coords[2 * q] = table.xs[rotated[q % n] as number] as number;
            coords[2 * q + 1] = table.ys[rotated[q % n] as number] as number;
        }
        let ids = rotated;
        if (ringSignedArea2(coords) < 0) {
            ids = new Int32Array(n);
            for (let q = 0; q < n; q += 1) ids[q] = rotated[(n - q) % n] as number;
        }
        return [{ key: `r${ids.join(",")}`, ids, open: false, reversed: false, owner: ownerAt(0) }];
    }
    const runs: Run[] = [];
    let k = start;
    while (k < start + n) {
        const owner = ownerAt(k);
        let end = k;
        while (end + 1 < start + n && !breaksAt(end + 1)) end += 1;
        const length = end - k + 2;
        const ids = new Int32Array(length);
        for (let q = 0; q < length; q += 1) ids[q] = ring[(k + q) % n] as number;
        const first = ids[0] as number;
        const last = ids[length - 1] as number;
        // Feste Richtung: vom kleineren zum größeren Ende; eine Schleife (Anfang gleich Ende) nach ihrem zweiten Punkt.
        const reversed =
            first !== last
                ? comparePoints(table, first, last) > 0
                : comparePoints(table, ids[1] as number, ids[length - 2] as number) > 0;
        const canonical = reversed ? ids.slice().reverse() : ids;
        runs.push({ key: `o${canonical.join(",")}`, ids: canonical, open: true, reversed, owner });
        k = end + 1;
    }
    return runs;
}

/** Jede Kette, die eine geschriebene Fläche braucht, einmal glätten. */
function smoothChains(table: PointTable, chains: Chains, options: NetOptions): (Coords | undefined)[] {
    const smoothed: (Coords | undefined)[] = new Array<Coords | undefined>(chains.ids.length);
    let scratch = new Float64Array(1024);
    for (let c = 0; c < chains.ids.length; c += 1) {
        if (!chains.needed[c]) continue;
        const ids = chains.ids[c] as Int32Array;
        const open = chains.open[c] as boolean;
        const length = 2 * ids.length + (open ? 0 : 2);
        if (scratch.length < length) scratch = new Float64Array(2 * length);
        const coords = scratch.subarray(0, length);
        for (let q = 0; q < ids.length; q += 1) {
            coords[2 * q] = table.xs[ids[q] as number] as number;
            coords[2 * q + 1] = table.ys[ids[q] as number] as number;
        }
        if (!open) {
            coords[2 * ids.length] = coords[0] as number;
            coords[2 * ids.length + 1] = coords[1] as number;
        }
        smoothed[c] = smoothLine(coords, options.passes, open, options.resolution, open ? 2 : 4);
    }
    return smoothed;
}

/** 4. Jede geschriebene Fläche aus ihren geglätteten Ketten. */
function assemble(
    work: readonly WorkArea[],
    areaRuns: readonly RunRef[][][][],
    smoothed: readonly (Coords | undefined)[],
): Map<number, SurfaceCoords> {
    const shapes = new Map<number, SurfaceCoords>();
    for (const [index, area] of work.entries()) {
        if (!area.write) continue;
        const polygons: SurfaceCoords = [];
        for (const ringsRuns of areaRuns[index] as RunRef[][][]) {
            const rings: Coords[] = [];
            for (const [r, runs] of ringsRuns.entries()) {
                const ring = assembleRing(runs, smoothed);
                if (ring) rings.push(ring);
                else if (r === 0) break;
            }
            if (rings.length > 0) polygons.push(rings);
        }
        if (polygons.length > 0) shapes.set(area.id, polygons);
    }
    return shapes;
}

/** Ein Ring aus seinen geglätteten Ketten; `undefined`, wenn er keine Fläche mehr umschließt. */
function assembleRing(runs: readonly RunRef[], smoothed: readonly (Coords | undefined)[]): Coords | undefined {
    const parts: Coords[] = [];
    let points = 0;
    for (const run of runs) {
        const line = smoothed[run.chain];
        if (!line) return undefined;
        const part = run.reversed ? reverseCoords(line) : line;
        parts.push(part);
        points += part.length / 2;
    }
    if (parts.length === 1) {
        // Ein Ring ohne festen Punkt: die geglättete Kette selbst.
        const only = parts[0] as Coords;
        return only.length / 2 >= 4 ? only : undefined;
    }
    points -= parts.length - 1;
    if (points < 4) return undefined;
    const out = new Float64Array(2 * points);
    let o = 0;
    for (const [index, part] of parts.entries()) {
        for (let q = index === 0 ? 0 : 2; q < part.length; q += 1) out[o++] = part[q] as number;
    }
    return out;
}
