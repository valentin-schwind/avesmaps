import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import type { RouteNode } from "../../src/routing/network.ts";
import { coastDistance, coastProfile } from "../../src/routing/sea-coast.ts";
import { SEA_ROUTE_SETTINGS } from "../../src/routing/sea-derive.ts";
import { FreeSea } from "../../src/routing/sea-free.ts";
import { compactSeaGraph, waterMask, type SeaGraphPort } from "../../src/routing/sea-graph-store.ts";
import {
    buildSeaGrid,
    LANDING_REACH,
    nearestWaterCell,
    prepareNavigableWater,
    type NavigableWater,
    type SeaGrid,
} from "../../src/routing/sea-grid.ts";
import { SeaSearch } from "../../src/routing/sea-search.ts";
import { VisibilityGraph } from "../../src/routing/sea-visibility.ts";
import { random } from "./invariants.ts";

/**
 * Zufällige Seen für die Invarianten der freien Seefahrt (WI-0061, Plan 11.54 und 11.55): ein Meer von 60 × 40
 * Karteneinheiten mit Inseln, zwei Landzungen vom Rand und, in einigen Fällen, einem See auf einer Insel; dazu Häfen
 * an jeder Küste und ein paar ohne Wasser in drei Einheiten. Der Seegraph entsteht mit den Einstellungen der echten
 * Ableitung (`SEA_ROUTE_SETTINGS`: Zelle, Einzug, Ringe, Brücken) und denselben Bausteinen wie `deriveSeaRoutes`.
 * Dieselbe Kennzahl ergibt dieselbe Landschaft.
 */

const model = AVENTURIA_TRAVEL_MODEL;
type Ring = [number, number][];
export const SEE_BREITE = 60;
export const SEE_HOEHE = 40;

interface Rect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export interface Hafen {
    id: string;
    x: number;
    y: number;
}

export interface SeeSzenario {
    seed: number;
    /** Das Wasser, wie es gezeichnet ist (Küste ohne Einzug). */
    water: NavigableWater;
    /** Ringe der eingerückten Wasserfläche, wie `loadCoastRings` sie liefert: Wasser links jeder Laufrichtung. */
    rings: Ring[];
    inseln: Rect[];
    landzungen: Rect[];
    /** Ein See mitten auf einer Insel, oder keiner. */
    see: Rect | null;
    haefen: Hafen[];
}

const closed = (ring: Ring): Ring => [...ring, ring[0] as [number, number]];
const rectRing = ({ x0, y0, x1, y1 }: Rect, grow: number, clockwise: boolean): Ring => {
    const corners: Ring = [
        [x0 - grow, y0 - grow],
        [x1 + grow, y0 - grow],
        [x1 + grow, y1 + grow],
        [x0 - grow, y1 + grow],
    ];
    return clockwise ? corners.reverse() : corners;
};

/**
 * Der Rand des Meeres mit den beiden Landzungen (West und Nord), Wasser links jeder Laufrichtung. Mit `grow` größer null
 * wächst das Land um so viel ins Wasser und der Kasten schrumpft: die eingerückte Küste der Ableitung.
 */
function coastOutline(west: Rect, north: Rect, grow: number): Ring {
    return [
        [grow, grow],
        [SEE_BREITE - grow, grow],
        [SEE_BREITE - grow, SEE_HOEHE - grow],
        // Die Landzunge im Norden von Osten nach Westen: ihre Ostseite hinunter, um die Spitze, ihre Westseite hinauf.
        [north.x1 + grow, SEE_HOEHE - grow],
        [north.x1 + grow, north.y0 - grow],
        [north.x0 - grow, north.y0 - grow],
        [north.x0 - grow, SEE_HOEHE - grow],
        [grow, SEE_HOEHE - grow],
        // Die Landzunge im Westen von Norden nach Süden: ihre Nordseite hinein, um die Spitze, ihre Südseite hinaus.
        [grow, west.y1 + grow],
        [west.x1 + grow, west.y1 + grow],
        [west.x1 + grow, west.y0 - grow],
        [grow, west.y0 - grow],
    ];
}

const overlaps = (a: Rect, b: Rect, gap: number): boolean =>
    a.x0 - gap < b.x1 && a.x1 + gap > b.x0 && a.y0 - gap < b.y1 && a.y1 + gap > b.y0;

export function zufallsSee(seed: number, options: { withLake?: boolean } = {}): SeeSzenario {
    const next = random(seed);
    const between = (from: number, to: number): number => from + next() * (to - from);
    // Die Landzungen ragen 10 bis 22 Einheiten ins Meer, 3 bis 8 breit; im Westen unten, im Norden rechts.
    const westY = between(6, 18);
    const west: Rect = { x0: -1, x1: between(10, 22), y0: westY, y1: westY + between(3, 8) };
    const northX = between(34, 48);
    const north: Rect = { x0: northX, x1: northX + between(3, 8), y0: SEE_HOEHE - between(8, 16), y1: SEE_HOEHE + 1 };
    const landzungen = [west, north];
    const inseln: Rect[] = [];
    const wanted = 3 + Math.floor(next() * 4);
    for (let attempt = 0; attempt < 400 && inseln.length < wanted; attempt += 1) {
        // Die erste Insel eines Meeres mit See ist groß genug für ihn (mindestens 11 × 11 E).
        const large = options.withLake === true && inseln.length === 0;
        const width = large ? between(11, 13) : between(2, 12);
        const height = large ? between(11, 13) : between(2, 12);
        const x0 = between(4, SEE_BREITE - 4 - width);
        const y0 = between(4, SEE_HOEHE - 4 - height);
        const one: Rect = { x0, y0, x1: x0 + width, y1: y0 + height };
        // Zwischen zwei Küsten mindestens 2,5 Einheiten Wasser: enger würden Ringe einander schneiden.
        if ([...landzungen, ...inseln].some((other) => overlaps(one, other, 2.5))) continue;
        inseln.push(one);
    }
    // Ein See mitten auf der ersten Insel, wenn sie groß genug ist (mindestens 10 E², sonst gilt er nicht als Wasser): 3 Einheiten vom Meer.
    const groesste = inseln[0];
    const lake: Rect | null =
        options.withLake && groesste && groesste.x1 - groesste.x0 >= 10 && groesste.y1 - groesste.y0 >= 10
            ? { x0: groesste.x0 + 3, y0: groesste.y0 + 3, x1: groesste.x1 - 3, y1: groesste.y1 - 3 }
            : null;
    const box = (rect: Rect): Ring => closed(rectRing(rect, 0, false));
    const areaOf = (
        coordinates: Ring[],
        name: string,
        regionType: "meer" | "see",
    ): Parameters<typeof prepareNavigableWater>[0][number] => {
        const points = coordinates[0] as Ring;
        return {
            geometry: { type: "Polygon", coordinates: coordinates },
            minX: Math.min(...points.map(([x]) => x)),
            minY: Math.min(...points.map(([, y]) => y)),
            maxX: Math.max(...points.map(([x]) => x)),
            maxY: Math.max(...points.map(([, y]) => y)),
            regionName: name,
            regionType,
            areaPublicId: name,
        };
    };
    const meer = areaOf(
        [closed(coastOutline(west, north, 0)), ...inseln.map((one) => closed(rectRing(one, 0, true)))],
        "Meer",
        "meer",
    );
    const water = prepareNavigableWater([meer, ...(lake ? [areaOf([box(lake)], "See", "see")] : [])]);
    const rings: Ring[] = [
        coastOutline(west, north, 0.25),
        ...inseln.map((one) => rectRing(one, 0.25, true)),
        ...(lake ? [rectRing(lake, -0.25, false)] : []),
    ];
    // Häfen: an den Inseln und Landzungen bis 2,6 Einheiten vom Ufer, am Festland im Westen und Norden; einige ohne Wasser.
    const haefen: Hafen[] = [];
    const add = (x: number, y: number): void => {
        haefen.push({ id: `h${String(haefen.length)}`, x, y });
    };
    for (const one of inseln) {
        for (let index = 0; index < 1 + Math.floor(next() * 3); index += 1) {
            const inX = Math.min(2.6, (one.x1 - one.x0) / 2);
            const inY = Math.min(2.6, (one.y1 - one.y0) / 2);
            // Ein Punkt in der Randzone der Insel: auf einer der vier Seiten, bis zur Tiefe der Zone.
            const side = Math.floor(next() * 4);
            if (side === 0) add(between(one.x0, one.x1), between(one.y0, one.y0 + inY));
            else if (side === 1) add(between(one.x0, one.x1), between(one.y1 - inY, one.y1));
            else if (side === 2) add(between(one.x0, one.x0 + inX), between(one.y0, one.y1));
            else add(between(one.x1 - inX, one.x1), between(one.y0, one.y1));
        }
    }
    add(between(west.x1 - 2.6, west.x1), between(west.y0, west.y1));
    add(between(west.x0, west.x1), between(west.y1 - 2.6, west.y1));
    add(between(north.x0, north.x1), between(north.y0, north.y0 + 2.6));
    add(between(-2.6, -0.2), between(0, west.y0 - 2));
    add(between(0, SEE_BREITE), between(SEE_HOEHE + 0.2, SEE_HOEHE + 2.6));
    if (lake) add(between(lake.x0 - 1.2, lake.x0 - 0.2), between(lake.y0, lake.y1));
    // Ohne Wasser in drei Einheiten: weit im Land.
    add(-7, 30);
    add(SEE_BREITE / 2, SEE_HOEHE + 8);
    return { seed, water, rings, inseln, landzungen, see: lake, haefen };
}

/** Der Seegraph eines Szenarios, so abgeleitet wie `deriveSeaRoutes` es tut, mit den Häfen an `lage` (Vorgabe: die des Szenarios). */
export interface SeeAbleitung {
    grid: SeaGrid;
    freeSea: FreeSea;
    /** Die Orte des Netzes: jeder Hafen an der Lage, mit der der Router rechnet. */
    nodes: Map<string, RouteNode>;
    /** Die Häfen im Graphen, und die ohne Anlegestelle in drei Einheiten. */
    mitWasser: string[];
    ohneWasser: string[];
}

export function leiteSeegraphAb(
    szenario: SeeSzenario,
    lage: (hafen: Hafen) => { x: number; y: number } = (hafen) => hafen,
): SeeAbleitung {
    const grid = buildSeaGrid(szenario.water, SEA_ROUTE_SETTINGS.cell);
    const graph = new VisibilityGraph(grid, szenario.rings, {
        offsets: SEA_ROUTE_SETTINGS.offsets,
        bridge: { search: new SeaSearch(grid), reach: SEA_ROUTE_SETTINGS.reach },
    });
    const transports = model.transportmittel.wert.sea;
    graph.weigh(
        transports.map((transport) => coastProfile(model, transport)),
        coastDistance(grid),
    );
    const ports: SeaGraphPort[] = [];
    const mitWasser: string[] = [];
    const ohneWasser: string[] = [];
    for (const hafen of szenario.haefen) {
        const at = lage(hafen);
        const landing = nearestWaterCell(grid, at.x, at.y, LANDING_REACH, SEA_ROUTE_SETTINGS.minArea);
        if (!landing) {
            ohneWasser.push(hafen.id);
            continue;
        }
        ports.push({ placeId: hafen.id, node: graph.attach(landing.x, landing.y) });
        mitWasser.push(hafen.id);
    }
    const compact = compactSeaGraph(graph.snapshot(), transports, ports, waterMask(grid));
    return {
        grid,
        freeSea: new FreeSea(compact),
        nodes: new Map(szenario.haefen.map((hafen) => [hafen.id, ort(hafen.id, lage(hafen))])),
        mitWasser,
        ohneWasser,
    };
}

export const ort = (id: string, at: { x: number; y: number }): RouteNode => ({
    id,
    name: id,
    kind: "place",
    isHidden: false,
    x: at.x,
    y: at.y,
});
