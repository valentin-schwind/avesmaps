import { describe, expect, it } from "vitest";
import type { RouteNode } from "../src/routing/network.ts";
import { buildNodeGrid, nearestPairs, nearestPairsByLoop, type Pair } from "../src/routing/nearest-pairs.ts";

/**
 * Die nächsten Paare zwischen einem Netzteil und dem Hauptnetz (WI-0117): Das Gitter über dem Hauptnetz ersetzt die
 * Schleife über alle Paare, aber nicht ihr Ergebnis - nicht den Abstand, nicht die Reihenfolge bei Gleichstand.
 * Die Schleife ist die Vorschrift (Legacy), das Gitter wird an ihr gemessen.
 */

const node = (id: string, x: number, y: number): RouteNode => ({ id, name: id, kind: "place", isHidden: false, x, y });

/** Ein fester Zufall, damit jeder Lauf dieselben Fälle prüft. */
function zufall(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

const spur = (pairs: readonly Pair[]) => pairs.map((pair) => [pair.from.id, pair.to.id, pair.distance]);

describe("Die nächsten Paare über dem Gitter (WI-0117)", () => {
    it("🔴 gleicht die Schleife Paar für Paar - auch bei Gleichstand, den ein ganzzahliges Netz massenhaft erzeugt", () => {
        const next = zufall(7);
        let verglichen = 0;
        for (let trial = 0; trial < 240; trial += 1) {
            // Ein enges ganzzahliges Netz: viele Knoten im selben Punkt, viele gleich weite Paare.
            const spanne = [6, 40, 400][trial % 3] as number;
            const main = Array.from({ length: 120 + Math.floor(next() * 900) }, (_, index) =>
                node(`m${String(index)}`, Math.floor(next() * spanne), Math.floor(next() * spanne)),
            );
            const detached = Array.from({ length: 1 + Math.floor(next() * 30) }, (_, index) =>
                node(
                    `d${String(index)}`,
                    Math.floor(next() * spanne * 1.4 - spanne * 0.2),
                    Math.floor(next() * spanne),
                ),
            );
            const grid = buildNodeGrid(main);
            for (const limit of [1, 2, 5, 25]) {
                expect(spur(nearestPairs(detached, main, limit, grid))).toEqual(
                    spur(nearestPairsByLoop(detached, main, limit)),
                );
                verglichen += 1;
            }
        }
        expect(verglichen).toBe(960);
    });

    it("bei gleichem Abstand gewinnt das Paar, das die Schleife zuerst sähe: erst der Netzteilknoten, dann der Hauptnetzknoten", () => {
        // Vier Knoten im Quadrat um den Ursprung, alle gleich weit; viele Füller, damit das Gitter rechnet.
        const filler = Array.from({ length: 200 }, (_, index) => node(`f${String(index)}`, 500 + index, 500));
        const main = [node("m0", 1, 0), node("m1", -1, 0), node("m2", 0, 1), node("m3", 0, -1), ...filler];
        const detached = [node("d0", 0, 0), node("d1", 0, 0)];
        const grid = buildNodeGrid(main);
        const erste = nearestPairs(detached, main, 1, grid)[0];
        expect([erste?.from.id, erste?.to.id]).toEqual(["d0", "m0"]);
        const vier = nearestPairs(detached, main, 4, grid);
        expect(vier.map((pair) => [pair.from.id, pair.to.id])).toEqual([
            ["d0", "m0"],
            ["d0", "m1"],
            ["d0", "m2"],
            ["d0", "m3"],
        ]);
    });

    it("ein Netzteil weit außerhalb des Hauptnetzes findet sein nächstes Paar trotzdem", () => {
        const main = Array.from({ length: 300 }, (_, index) =>
            node(`m${String(index)}`, index % 20, Math.floor(index / 20)),
        );
        const detached = [node("d0", 5000, -3000), node("d1", -4000, 4000)];
        const grid = buildNodeGrid(main);
        for (const limit of [1, 25]) {
            expect(spur(nearestPairs(detached, main, limit, grid))).toEqual(
                spur(nearestPairsByLoop(detached, main, limit)),
            );
        }
    });

    it("entartete Verteilungen: alle Knoten im selben Punkt, alle auf einer Linie, ein einziger Knoten", () => {
        const einPunkt = Array.from({ length: 300 }, (_, index) => node(`m${String(index)}`, 3, 3));
        const linie = Array.from({ length: 300 }, (_, index) => node(`m${String(index)}`, index * 0.37, 12));
        const einzel = [node("m0", 9, 9)];
        const detached = Array.from({ length: 12 }, (_, index) => node(`d${String(index)}`, index, index * 2));
        for (const main of [einPunkt, linie, einzel]) {
            const grid = buildNodeGrid(main);
            for (const limit of [1, 3, 25]) {
                expect(spur(nearestPairs(detached, main, limit, grid))).toEqual(
                    spur(nearestPairsByLoop(detached, main, limit)),
                );
            }
        }
    });

    it("ohne Hauptnetz oder ohne Netzteil gibt es keine Paare", () => {
        const main = Array.from({ length: 50 }, (_, index) => node(`m${String(index)}`, index, 0));
        const detached = [node("d0", 1, 1)];
        expect(nearestPairs(detached, [], 1, buildNodeGrid([]))).toEqual([]);
        expect(nearestPairs([], main, 1, buildNodeGrid(main))).toEqual([]);
    });

    it("ohne Gitter, bei wenigen Paaren und bei limit 0 rechnet die Schleife - dasselbe Ergebnis", () => {
        const main = Array.from({ length: 30 }, (_, index) => node(`m${String(index)}`, index * 3, (index * 7) % 11));
        const detached = [node("d0", 4, 4), node("d1", 40, 2)];
        expect(spur(nearestPairs(detached, main, 3))).toEqual(spur(nearestPairsByLoop(detached, main, 3)));
        expect(spur(nearestPairs(detached, main, 3, buildNodeGrid(main)))).toEqual(
            spur(nearestPairsByLoop(detached, main, 3)),
        );
        expect(nearestPairs(detached, main, 0, buildNodeGrid(main))).toEqual([]);
    });
});
