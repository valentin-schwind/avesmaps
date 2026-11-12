import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, FREE_SEA_EDGE_PREFIX, travelHoursFromTime, travelSpeed } from "@avesmaps3d/shared";
import { buildRouteNetwork, lineLength, type RouteNode } from "../src/routing/network.ts";
import { buildRouteGraph, findRoute, type RouteRequest } from "../src/routing/router.ts";
import { SEA_ROUTE_SETTINGS } from "../src/routing/sea-derive.ts";
import type { SeaFleet } from "../src/routing/sea-free.ts";
import { clearOnMask } from "../src/routing/sea-graph-store.ts";
import { cellAt, LANDING_REACH, nearestWaterCell, SEA_CELL_UNITS } from "../src/routing/sea-grid.ts";
import { distanceToWater } from "../src/routing/sea-ports.ts";
import { NO_WATER } from "../src/routing/water.ts";
import { FULL_INVARIANTS, pick, random, scaled } from "./support/invariants.ts";
import { leiteSeegraphAb, ort, zufallsSee, type SeeAbleitung, type SeeSzenario } from "./support/sea-random.ts";

/**
 * Die freie Seefahrt als Invariante (WI-0061, Plan 11.54 „freie Wasserroute nicht durch Land“, „Port endet am
 * zugeordneten Wasser“, 11.55 „stabile Route bei kleinen Geometrieabweichungen“, WI-0046 S7 b).
 *
 * Die Regeln:
 * - Eine Seereise beginnt und endet am Hafen. Dazwischen liegt sie über Wasser; nur das Stück vom Hafen zur
 *   Anlegestelle, das erste und das letzte, darf über Land führen. Die Anlegestelle liegt im Wasser, höchstens
 *   `LANDING_REACH` (3 E) vom Hafen. Ein Hafen ohne Wasser in drei Einheiten hat keine Anlegestelle und keine Seereise.
 * - Zwei getrennte Wasserflächen verbindet keine Seereise.
 * - „Über Wasser“ heißt: jede Strecke liegt auf Wasserzellen der Maske des Seegraphen (`clearOnMask`, wie
 *   `verify:sea-routes`). Gegen die gezeichnete Küste selbst gemessen, streift eine Strecke sie um höchstens die halbe
 *   Zelle: Eine Zelle zählt als Wasser, wenn ihre Mitte im Wasser liegt (`SEA_CELL_UNITS`).
 *
 * Die Fälle: zufällige Meere mit Inseln, Landzungen und einem See auf einer Insel, Häfen an jeder Küste, dazu zwei ohne
 * Wasser, abgeleitet mit den Einstellungen und Bausteinen der echten Ableitung (`support/sea-random.ts`). Umfang:
 * kleine Teilmenge in `npm test`, voller Satz mit `npm run gate:routing-invariants`.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const SHIPS = model.transportmittel.wert.sea;
const TIMEOUT = scaled(30_000, 600_000);
/** Die Hälfte einer Zelle: So weit streift eine Linie über Wasserzellen die gezeichnete Küste. */
const HALF_CELL = SEA_CELL_UNITS / 2;
type Point = [number, number];

const speedOf = (ship: string): number => travelSpeed(model, ship, "Seeweg") as number;

/** Wie weit eine Strecke höchstens über Land liegt, gegen die gezeichnete Küste, alle 0,1 E abgetastet. */
function depthAlong(water: SeeSzenario["water"], ax: number, ay: number, bx: number, by: number): number {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.1));
    let deepest = 0;
    for (let step = 0; step <= steps; step += 1) {
        const depth = distanceToWater(water, ax + ((bx - ax) * step) / steps, ay + ((by - ay) * step) / steps, 5);
        deepest = Math.max(deepest, depth);
    }
    return deepest;
}

interface Lauf {
    szenario: SeeSzenario;
    ableitung: SeeAbleitung;
}

function laeufe(count: number, first = 1): Lauf[] {
    return Array.from({ length: count }, (_, index) => {
        const seed = (first + index) * 977;
        const szenario = zufallsSee(seed, { withLake: index % 2 === 1 });
        return { szenario, ableitung: leiteSeegraphAb(szenario) };
    });
}

const fleetOf = (ableitung: SeeAbleitung, ship: string): SeaFleet => {
    const fleet = ableitung.freeSea.fleet(ship, speedOf(ship), ableitung.nodes);
    if (!fleet) throw new Error(`der Seegraph kennt ${ship} nicht`);
    return fleet;
};

/** Der Wasserteil einer Anlegestelle (Zelle des Rasters), oder -1 ohne Anlegestelle. */
function partOf(ableitung: SeeAbleitung, hafen: { x: number; y: number }): number {
    const landing = nearestWaterCell(ableitung.grid, hafen.x, hafen.y, LANDING_REACH, SEA_ROUTE_SETTINGS.minArea);
    return landing ? (ableitung.grid.part[cellAt(ableitung.grid, landing.x, landing.y)] as number) : -1;
}

/**
 * Der Teil der Zeichenlinie zwischen den Anlegestellen, als Stücke `[ax, ay, bx, by]`: von dem Punkt der Linie, der der
 * ersten Anlegestelle am nächsten liegt, bis zu dem der letzten. Die Rundung führt durch jede Anlegestelle (sie ist die
 * Ecke, die sie rundet), die Vereinfachung verschiebt sie höchstens um ihre Toleranz. Null, wenn die Linie nicht
 * durch beide führt.
 */
function betweenLandings(
    display: readonly Point[],
    first: Point,
    last: Point,
): { pieces: [number, number, number, number][] } | null {
    const nearest = (target: Point, fromEnd: boolean): { index: number; at: Point; distance: number } => {
        let best = { index: 0, at: display[0] as Point, distance: Infinity };
        for (let step = 0; step + 1 < display.length; step += 1) {
            const index = fromEnd ? display.length - 2 - step : step;
            const [ax, ay] = display[index] as Point;
            const [bx, by] = display[index + 1] as Point;
            const length = (bx - ax) ** 2 + (by - ay) ** 2;
            const t =
                length > 0
                    ? Math.max(0, Math.min(1, ((target[0] - ax) * (bx - ax) + (target[1] - ay) * (by - ay)) / length))
                    : 0;
            const at: Point = [ax + (bx - ax) * t, ay + (by - ay) * t];
            const distance = Math.hypot(target[0] - at[0], target[1] - at[1]);
            if (distance < best.distance - 1e-12) best = { index, at, distance };
        }
        return best;
    };
    const start = nearest(first, false);
    const end = nearest(last, true);
    if (start.distance > 0.03 || end.distance > 0.03) return null;
    const line: Point[] = [start.at, ...display.slice(start.index + 1, end.index + 1), end.at];
    const pieces: [number, number, number, number][] = [];
    for (let index = 1; index < line.length; index += 1) {
        const [ax, ay] = line[index - 1] as Point;
        const [bx, by] = line[index] as Point;
        pieces.push([ax, ay, bx, by]);
    }
    return { pieces };
}

describe("Eine freie Seereise liegt über Wasser, beginnt und endet am Hafen mit Wasser-Zugang (zufällige Meere)", () => {
    const seas = scaled(4, 40);

    it(
        `🔴 ${String(seas)} Meere, jedes Hafenpaar, jedes Schiff: Enden, Anlegestellen, kein Land, getrennte Wasser`,
        () => {
            const stats = { lines: 0, unconnected: 0, noAccess: 0, deepest: 0, lakeSeas: 0 };
            for (const [index, { szenario, ableitung }] of laeufe(seas).entries()) {
                const { grid } = ableitung;
                const mask = ableitung.freeSea.graph.mask;
                const at = new Map(szenario.haefen.map((hafen) => [hafen.id, hafen]));
                if (szenario.see) stats.lakeSeas += 1;
                // Ein Hafen ohne Wasser in drei Einheiten hat keine Anlegestelle: Er steht nicht im Seegraphen.
                for (const id of ableitung.ohneWasser) {
                    stats.noAccess += 1;
                    for (const ship of SHIPS) {
                        const fleet = fleetOf(ableitung, ship);
                        expect(fleet.has(id), `Meer ${String(index)}: ${id} ohne Wasser`).toBe(false);
                        expect(fleet.ports.has(id)).toBe(false);
                    }
                }
                expect(ableitung.mitWasser.length, `Meer ${String(index)}`).toBeGreaterThan(6);
                let counter = 0;
                for (const ship of SHIPS.slice(0, scaled(2, SHIPS.length))) {
                    const fleet = fleetOf(ableitung, ship);
                    expect(new Set(fleet.ports), `Meer ${String(index)}, ${ship}`).toEqual(
                        new Set(ableitung.mitWasser),
                    );
                    for (const a of ableitung.mitWasser) {
                        for (const b of ableitung.mitWasser) {
                            if (a === b) continue;
                            const from = at.get(a) as { x: number; y: number };
                            const to = at.get(b) as { x: number; y: number };
                            const where = `Meer ${String(index)}, ${ship}, ${a} -> ${b}`;
                            const line = fleet.line(a, b);
                            // Getrennte Wasser (der See auf der Insel und das Meer) verbindet keine Reise, alles andere schon.
                            const together = partOf(ableitung, from) === partOf(ableitung, to);
                            expect(line !== null, where).toBe(together);
                            if (!line) {
                                stats.unconnected += 1;
                                continue;
                            }
                            stats.lines += 1;
                            // Gegen die gezeichnete Küste (teuer) prüft der kleine Satz jede vierte Linie, der volle jede.
                            counter += 1;
                            const exact = counter % scaled(4, 1) === 0;
                            const { geometry, display } = line;
                            // Am Hafen beginnt und endet sie, dann folgt die Anlegestelle, im Wasser und höchstens drei Einheiten entfernt.
                            expect(geometry[0], where).toEqual([from.x, from.y]);
                            expect(geometry[geometry.length - 1], where).toEqual([to.x, to.y]);
                            const first = geometry[1] as Point;
                            const last = geometry[geometry.length - 2] as Point;
                            expect(grid.water[cellAt(grid, first[0], first[1])], where).toBe(1);
                            expect(grid.water[cellAt(grid, last[0], last[1])], where).toBe(1);
                            expect(Math.hypot(first[0] - from.x, first[1] - from.y), where).toBeLessThanOrEqual(
                                LANDING_REACH,
                            );
                            expect(Math.hypot(last[0] - to.x, last[1] - to.y), where).toBeLessThanOrEqual(
                                LANDING_REACH,
                            );
                            // Zwischen den Anlegestellen liegt jede Strecke auf Wasserzellen ...
                            for (let piece = 2; piece < geometry.length - 1; piece += 1) {
                                const [ax, ay] = geometry[piece - 1] as Point;
                                const [bx, by] = geometry[piece] as Point;
                                expect(clearOnMask(mask, ax, ay, bx, by), `${where}, Stück ${String(piece)}`).toBe(
                                    true,
                                );
                                // ... und gegen die gezeichnete Küste höchstens die halbe Zelle über Land.
                                if (exact) {
                                    const depth = depthAlong(szenario.water, ax, ay, bx, by);
                                    stats.deepest = Math.max(stats.deepest, depth);
                                    expect(depth, `${where}, Stück ${String(piece)}`).toBeLessThanOrEqual(HALF_CELL);
                                }
                            }
                            // Die Zeichenlinie führt durch beide Anlegestellen; zwischen ihnen streift sie die Küste wie die
                            // gemessene Linie höchstens um die halbe Zelle (die Rundung prüft die Maske, die Vereinfachung
                            // verschiebt sie um bis zu 0,02 E), davor und danach, im Hafenstück, darf sie über Land führen.
                            const points = display as Point[];
                            const between = betweenLandings(points, first, last);
                            expect(between, `${where}, Zeichenlinie`).not.toBeNull();
                            for (const [piece, [ax, ay, bx, by]] of (between?.pieces ?? []).entries()) {
                                if (!exact) break;
                                const depth = depthAlong(szenario.water, ax, ay, bx, by);
                                stats.deepest = Math.max(stats.deepest, depth);
                                expect(depth, `${where}, Zeichenlinie ${String(piece)}`).toBeLessThanOrEqual(HALF_CELL);
                            }
                            expect(points[0], where).toEqual([from.x, from.y]);
                            expect(points[points.length - 1], where).toEqual([to.x, to.y]);
                        }
                    }
                }
            }
            if (FULL_INVARIANTS) console.warn(`Freie Seereisen (Meere ${String(seas)}): ${JSON.stringify(stats)}`);
            // Der Test prüft etwas: viele Linien, getrennte Wasser kommen vor, und die Küste wird gestreift.
            expect(stats.lines).toBeGreaterThan(seas * 100);
            expect(stats.unconnected).toBeGreaterThan(0);
            expect(stats.noAccess).toBeGreaterThanOrEqual(seas * 2);
            expect(stats.deepest).toBeLessThanOrEqual(HALF_CELL);
        },
        TIMEOUT,
    );

    it(
        "🔴 im Router: Distanz und Zeit stimmen mit der Linie überein, die Enden sitzen auf den Häfen, ein Hafen ohne Wasser hat keine Seekante",
        () => {
            for (const [index, { szenario, ableitung }] of laeufe(scaled(3, 20), 100).entries()) {
                const places = szenario.haefen.map((hafen) => ort(hafen.id, hafen));
                const network = buildRouteNetwork(places, []);
                const at = new Map(szenario.haefen.map((hafen) => [hafen.id, hafen]));
                const next = random(index * 7 + 1);
                for (const ship of SHIPS) {
                    const request: RouteRequest = {
                        optimize: "fastest",
                        transports: { land: "groupFoot", river: "riverSailer", sea: ship },
                        enabled: { land: true, river: true, sea: true },
                        minimizeTransfers: false,
                    };
                    const graph = buildRouteGraph(network, model, request, NO_WATER, ableitung.freeSea);
                    const ids = ableitung.mitWasser;
                    for (let sample = 0; sample < scaled(6, 40); sample += 1) {
                        const a = pick(ids, next);
                        const b = pick(ids, next);
                        if (a === b) continue;
                        const where = `Meer ${String(index)}, ${ship}, ${a} -> ${b}`;
                        const result = findRoute(network, graph, [a, b]);
                        const together =
                            partOf(ableitung, at.get(a) as Point2) === partOf(ableitung, at.get(b) as Point2);
                        expect(result.found, where).toBe(together);
                        if (!result.found) continue;
                        const [segment] = result.segments;
                        if (!segment) throw new Error(`${where}: kein Abschnitt`);
                        expect(segment.edge_id, where).toBe(`${FREE_SEA_EDGE_PREFIX}${a}-${b}`);
                        const line = segment.geometry.coordinates as Point[];
                        expect(line[0], where).toEqual([(at.get(a) as Point2).x, (at.get(a) as Point2).y]);
                        expect(line[line.length - 1], where).toEqual([
                            (at.get(b) as Point2).x,
                            (at.get(b) as Point2).y,
                        ]);
                        // Die gemeldete Distanz ist die Länge der Linie (Float32 im Graphen: ein Tausendstel), die Zeit folgt aus ihr.
                        expect(Math.abs(segment.distance_units - lineLength(line)), where).toBeLessThan(
                            1e-3 * Math.max(1, segment.distance_units),
                        );
                        expect(segment.travel_hours, where).toBeCloseTo(
                            travelHoursFromTime(model, segment.distance_units / speedOf(ship)),
                            6,
                        );
                        expect(result.distanceUnits, where).toBeCloseTo(segment.distance_units, 9);
                    }
                    // Ein Hafen ohne Wasser bekommt keine Seekante: Die Reise zu ihm findet keinen Weg.
                    for (const id of ableitung.ohneWasser) {
                        const a = ids[0] as string;
                        const result = findRoute(network, graph, [a, id]);
                        expect(
                            result.segments.some((segment) => segment.edge_id.startsWith(FREE_SEA_EDGE_PREFIX)),
                            `Meer ${String(index)}, ${ship}, ${a} -> ${id}`,
                        ).toBe(false);
                    }
                }
            }
        },
        TIMEOUT,
    );
});

interface Point2 {
    x: number;
    y: number;
}

/** Die Verschiebung eines Hafens um `size` Karteneinheiten in eine Richtung. */
const shiftBy = (hafen: Point2, angle: number, size: number): Point2 => ({
    x: hafen.x + Math.cos(angle) * size,
    y: hafen.y + Math.sin(angle) * size,
});

const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Eine Seereise, wie der Router sie meldet: gefahrene Distanz, Zeit und Linie. */
interface Reise {
    distance: number;
    hours: number;
    geometry: Point[];
}

/** Die Seereisen eines Schiffs über den Seegraphen einer Ableitung, mit den Häfen an den Lagen von `nodes`. */
function reiseVon(
    ableitung: SeeAbleitung,
    nodes: ReadonlyMap<string, RouteNode>,
    ship: string,
): (a: string, b: string) => Reise | null {
    const network = buildRouteNetwork([...nodes.values()], []);
    const request: RouteRequest = {
        optimize: "fastest",
        transports: { land: "groupFoot", river: "riverSailer", sea: ship },
        enabled: { land: true, river: true, sea: true },
        minimizeTransfers: false,
    };
    const graph = buildRouteGraph(network, model, request, NO_WATER, ableitung.freeSea);
    return (a, b) => {
        const result = findRoute(network, graph, [a, b]);
        const [segment] = result.segments;
        if (!result.found || !segment) return null;
        return {
            distance: segment.distance_units,
            hours: segment.travel_hours,
            geometry: segment.geometry.coordinates as Point[],
        };
    };
}

describe("Stabilität der freien Seeroute bei kleinen Verschiebungen eines Hafens (Plan 11.55)", () => {
    const seas = scaled(3, 30);
    const SHIPS_TESTED = ["cargoShip", "galley"];

    it(
        "🔴 Ort verschoben, Seegraph derselbe: Distanz und Zeit ändern sich um höchstens die Verschiebung beider Enden, die Linie dazwischen bleibt",
        () => {
            let compared = 0;
            for (const [index, { szenario, ableitung }] of laeufe(seas, 200).entries()) {
                const next = random(index + 5);
                for (const size of [0.05, 0.25, 0.49]) {
                    const nodes = new Map(
                        szenario.haefen.map((hafen) => [
                            hafen.id,
                            ort(hafen.id, shiftBy(hafen, next() * 2 * Math.PI, size)),
                        ]),
                    );
                    for (const ship of SHIPS_TESTED) {
                        const base = reiseVon(ableitung, ableitung.nodes, ship);
                        const moved = reiseVon(ableitung, nodes, ship);
                        // Die Zeit ist der Distanz proportional: dieselbe Grenze in Stunden.
                        const hoursOf = (distance: number): number =>
                            travelHoursFromTime(model, distance / speedOf(ship));
                        for (const a of ableitung.mitWasser) {
                            for (const b of ableitung.mitWasser) {
                                if (a >= b) continue;
                                const one = base(a, b);
                                const two = moved(a, b);
                                const where = `Meer ${String(index)}, ${ship}, ${a} -> ${b}, um ${String(size)}`;
                                expect(two === null, where).toBe(one === null);
                                if (!one || !two) continue;
                                compared += 1;
                                // Beide Enden verschoben: höchstens 2 · Verschiebung, und nur die Hafenstücke ändern sich.
                                expect(Math.abs(two.distance - one.distance), where).toBeLessThanOrEqual(
                                    2 * size + 1e-3,
                                );
                                expect(Math.abs(two.hours - one.hours), where).toBeLessThanOrEqual(
                                    hoursOf(2 * size + 1e-3),
                                );
                                expect(two.geometry.slice(1, -1), where).toEqual(one.geometry.slice(1, -1));
                            }
                        }
                    }
                }
            }
            expect(compared).toBeGreaterThan(seas * 300);
        },
        TIMEOUT,
    );

    // Verschoben wird ein Hafen VOR der Ableitung, die anderen bleiben, wo sie sind. Die Anlegestelle ist die nächste
    // Wasserzelle; wechselt sie nicht, ist der Graph derselbe.
    const deltas = scaled([0.1, 0.49], [0.05, 0.1, 0.25, 0.49]);
    const measured: Record<string, { ports: number; flips: number; changes: number[]; sameOver: number }> = {};

    it(
        `🔴 Hafen vor der Ableitung verschoben (${deltas.join(", ")} E): ohne Wechsel der Anlegestelle höchstens um die Verschiebung, ein Wechsel nur bei knappem Gleichstand`,
        () => {
            for (const size of deltas) {
                const stat = { ports: 0, flips: 0, changes: [] as number[], sameOver: 0 };
                measured[String(size)] = stat;
                for (const [index, { szenario, ableitung }] of laeufe(seas, 300).entries()) {
                    const next = random(index * 13 + Math.round(size * 1000));
                    const base = reiseVon(ableitung, ableitung.nodes, "cargoShip");
                    for (const subject of szenario.haefen) {
                        const angle = next() * 2 * Math.PI;
                        const to = shiftBy(subject, angle, size * (0.5 + 0.5 * next()));
                        const moved = Math.hypot(to.x - subject.x, to.y - subject.y);
                        const landing = (at: Point2) =>
                            nearestWaterCell(ableitung.grid, at.x, at.y, LANDING_REACH, SEA_ROUTE_SETTINGS.minArea);
                        const before = landing(subject);
                        const after = landing(to);
                        if (!before || !after) continue;
                        stat.ports += 1;
                        const flipped = before.cell !== after.cell;
                        if (flipped) {
                            stat.flips += 1;
                            // Ein Wechsel ist immer ein knapper Gleichstand: Beide Zellen lagen vom alten Ort aus
                            // höchstens 2 · Verschiebung auseinander.
                            const distance = (cell: Point2): number =>
                                Math.hypot(cell.x - subject.x, cell.y - subject.y);
                            expect(
                                Math.abs(distance(after) - distance(before)),
                                `Meer ${String(index)}, ${subject.id}, um ${String(size)}`,
                            ).toBeLessThanOrEqual(2 * moved + 1e-9);
                        }
                        // Mit dem einen Hafen an anderer Stelle neu abgeleitet; die übrigen bleiben.
                        const again = leiteSeegraphAb(szenario, (hafen) => (hafen.id === subject.id ? to : hafen));
                        const other = reiseVon(again, again.nodes, "cargoShip");
                        for (const partner of ableitung.mitWasser) {
                            if (partner === subject.id || !again.mitWasser.includes(partner)) continue;
                            const one = base(subject.id, partner);
                            const two = other(subject.id, partner);
                            if (!one || !two) continue;
                            const delta = Math.abs(two.distance - one.distance);
                            if (flipped) {
                                stat.changes.push(delta);
                            } else {
                                // Dieselbe Anlegestelle: derselbe Graph, nur das Hafenstück ändert sich.
                                if (delta > moved + 1e-3) stat.sameOver += 1;
                                const where = `Meer ${String(index)}, ${subject.id} -> ${partner}, um ${String(size)}`;
                                expect(delta, where).toBeLessThanOrEqual(moved + 1e-3);
                                expect(two.geometry.slice(1, -1), where).toEqual(one.geometry.slice(1, -1));
                            }
                        }
                    }
                }
            }
        },
        TIMEOUT,
    );

    it("📏 Befund: Wechselt die Anlegestelle, verschiebt sich die Reise um etwa eine Zelle, in Ausnahmen um die Küste einer Insel", () => {
        const table = deltas.map((size) => {
            const stat = measured[String(size)] ?? { ports: 0, flips: 0, changes: [] as number[], sameOver: 0 };
            const sorted = [...stat.changes].sort((a, b) => a - b);
            const quantile = (share: number): number =>
                sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
            return {
                verschiebung: size,
                haefen: stat.ports,
                wechsel: stat.ports === 0 ? 0 : Number((stat.flips / stat.ports).toFixed(3)),
                paare: stat.changes.length,
                median: Number(median(stat.changes).toFixed(3)),
                p99: Number(quantile(0.99).toFixed(3)),
                hoechstens: Number((sorted[sorted.length - 1] ?? 0).toFixed(3)),
                ohneWechselUeber: stat.sameOver,
            };
        });
        if (FULL_INVARIANTS)
            console.warn(`Stabilität der Anlegestelle (Meere ${String(seas)}): ${JSON.stringify(table)}`);
        for (const row of table) {
            const where = `um ${String(row.verschiebung)}`;
            expect(row.haefen, where).toBeGreaterThan(seas * 5);
            // Ohne Wechsel der Anlegestelle ändert sich die Reise nie um mehr als die Verschiebung (oben streng geprüft).
            expect(row.ohneWechselUeber, where).toBe(0);
            // Der Anteil der Häfen, deren Anlegestelle wechselt, wächst mit der Verschiebung (gemessen 1,05 je Einheit).
            expect(row.wechsel, where).toBeLessThanOrEqual(Math.min(0.9, 2.5 * row.verschiebung));
            // Die Verteilung der Änderung nach einem Wechsel trägt erst der volle Satz (im kleinen sind es zu wenige Wechsel):
            // im Median eine Zelle, im 99. Perzentil und im Höchstwert der Umweg um eine Insel (gemessen 6,7 und 9,9 E).
            if (FULL_INVARIANTS) {
                expect(row.median, where).toBeLessThanOrEqual(1);
                expect(row.p99, where).toBeLessThanOrEqual(10);
                expect(row.hoechstens, where).toBeLessThanOrEqual(20);
            }
        }
    });
});
