import { describe, expect, it } from "vitest";
import {
    areaEdges,
    buildEdgeGrid,
    chordCrossesWater,
    COAST_TOLERANCE,
    lineIntervals,
    NO_WATER,
    prepareWater,
} from "../src/routing/water.ts";

/**
 * Der Wassertest der Querfeldein-Kanten (WI-0017), übertragen aus Legacys V9-Kern und V13. Die Fälle
 * sind die, an denen Legacy gemessen gescheitert war, bevor die Regel stand.
 */

type Ring = [number, number][];
const quadrat = (min: number, max: number): Ring => [
    [min, min],
    [max, min],
    [max, max],
    [min, max],
    [min, min],
];
const wasser = (rings: Ring[], min = 0, max = 10) =>
    prepareWater([{ geometry: { type: "Polygon", coordinates: rings }, minX: min, minY: min, maxX: max, maxY: max }]);

describe("Wassertest", () => {
    it("findet die Durchfahrt einer Linie durch eine Fläche als Bogenlänge", () => {
        const intervals = lineIntervals(
            [
                [-5, 5],
                [15, 5],
            ],
            areaEdges({ type: "Polygon", coordinates: [quadrat(0, 10)] }),
        );
        expect(intervals).toEqual([{ enter: 5, exit: 15 }]);
    });

    it("🔴 zählt ein Loch als Land", () => {
        const see = wasser([quadrat(0, 10), quadrat(3, 7)]);
        expect(chordCrossesWater(4, 5, 6, 5, see), "im Loch").toBe(false);
        expect(chordCrossesWater(-5, 5, 15, 5, see), "quer über den Ring").toBe(true);
    });

    it("🔴 Wasser bis 1 Einheit vor einem Ende ist Küstenzeichnung, keine Querung", () => {
        const see = wasser([quadrat(0, 10)]);
        expect(chordCrossesWater(-5, 5, 0.9, 5, see)).toBe(false);
        expect(chordCrossesWater(-5, 5, 2, 5, see)).toBe(true);
    });

    it("🪤 eine Sehne unter 2 Einheiten ist nie nass - auch mitten im Meer", () => {
        expect(chordCrossesWater(5, 5, 6.9, 5, wasser([quadrat(0, 10)]))).toBe(false);
    });

    it("🪤 eine Linie genau durch eine Ecke verliert die Durchfahrt nicht", () => {
        const raute: Ring = [
            [5, 0],
            [10, 5],
            [5, 10],
            [0, 5],
            [5, 0],
        ];
        const intervals = lineIntervals(
            [
                [5, -5],
                [5, 15],
            ],
            areaEdges({ type: "Polygon", coordinates: [raute] }),
        );
        expect(intervals).toEqual([{ enter: 5, exit: 15 }]);
    });

    it("ohne Wasser ist nichts nass, und was keine Fläche ist, hat keine Kanten", () => {
        expect(chordCrossesWater(-100, 0, 100, 0, NO_WATER)).toBe(false);
        expect(areaEdges({ type: "Point", coordinates: [1, 2] })).toHaveLength(0);
    });
});

describe("Das Kantengitter ändert kein Ergebnis (WI-0117)", () => {
    /** Ein fester Zufall, damit jeder Lauf dieselben Fälle prüft. */
    function zufall(seed: number): () => number {
        let state = seed;
        return () => {
            state = (state * 1664525 + 1013904223) % 4294967296;
            return state / 4294967296;
        };
    }

    /** Ein zerklüfteter Ring um (50, 50) mit `count` Ecken und, wenn gewünscht, einem Loch. */
    function kueste(count: number, next: () => number, grid = false): Ring[] {
        const ring = (radius: number, wobble: number): Ring => {
            const points: Ring = [];
            for (let index = 0; index < count; index += 1) {
                const angle = (2 * Math.PI * index) / count;
                const r = radius + (next() - 0.5) * wobble;
                // Auf ein Raster gelegt: Viele Ecken liegen auf demselben Wert, Kanten laufen achsenparallel.
                const snap = grid ? 1 : 0.0001;
                points.push([
                    Math.round((50 + r * Math.cos(angle)) / snap) * snap,
                    Math.round((50 + r * Math.sin(angle)) / snap) * snap,
                ]);
            }
            points.push(points[0] as [number, number]);
            return points;
        };
        return [ring(40, 12), ring(12, 4).reverse()];
    }

    /** Die Vorschrift: dieselbe Frage ohne Gitter. */
    function ohneGitter(coordinates: [number, number][], edges: Float64Array) {
        return lineIntervals(coordinates, edges);
    }

    it("🔴 liefert dieselben Durchfahrten wie die Schleife über alle Kanten - Zufallslinien, Ecken, Achsenparallele", () => {
        const next = zufall(11);
        let mitTreffer = 0;
        for (const [count, raster] of [
            [90, false],
            [400, false],
            [140, true],
        ] as const) {
            const edges = areaEdges({ type: "Polygon", coordinates: kueste(count, next, raster) });
            const grid = buildEdgeGrid(edges);
            expect(grid, "genug Kanten für ein Gitter").not.toBeNull();
            for (let trial = 0; trial < 700; trial += 1) {
                const points: [number, number][] = Array.from({ length: 2 + (trial % 4) }, () => [
                    raster ? Math.round(next() * 100) : next() * 110 - 5,
                    raster ? Math.round(next() * 100) : next() * 110 - 5,
                ]);
                // Jede dritte Linie beginnt auf einer Ecke des Rings, jede fünfte läuft achsenparallel.
                if (trial % 3 === 0)
                    points[0] = [
                        edges[(trial % (edges.length / 4)) * 4] as number,
                        edges[(trial % (edges.length / 4)) * 4 + 1] as number,
                    ];
                if (trial % 5 === 0) points[1] = [points[0]?.[0] as number, (points[1]?.[1] as number) ?? 0];
                const erwartet = ohneGitter(points, edges);
                if (erwartet.length > 0) mitTreffer += 1;
                expect(lineIntervals(points, edges, grid)).toEqual(erwartet);
            }
        }
        expect(mitTreffer, "die Fälle treffen die Fläche auch wirklich").toBeGreaterThan(900);
    });

    it("🔴 chordCrossesWater über das Gitter antwortet wie die Schleife, an Küste, Loch und Rand", () => {
        const next = zufall(23);
        const rings = kueste(300, next);
        const water = wasser(rings, 0, 100);
        const edges = areaEdges({ type: "Polygon", coordinates: rings });
        const vorschrift = (x1: number, y1: number, x2: number, y2: number): boolean => {
            const high = Math.hypot(x2 - x1, y2 - y1) - COAST_TOLERANCE;
            if (high <= COAST_TOLERANCE) return false;
            return lineIntervals(
                [
                    [x1, y1],
                    [x2, y2],
                ],
                edges,
            ).some((interval) => Math.min(interval.exit, high) > Math.max(interval.enter, COAST_TOLERANCE));
        };
        let nass = 0;
        for (let trial = 0; trial < 1500; trial += 1) {
            const [x1, y1, x2, y2] = [next() * 120 - 10, next() * 120 - 10, next() * 120 - 10, next() * 120 - 10] as [
                number,
                number,
                number,
                number,
            ];
            const antwort = chordCrossesWater(x1, y1, x2, y2, water);
            if (antwort) nass += 1;
            expect(antwort).toBe(vorschrift(x1, y1, x2, y2));
        }
        expect(nass, "nasse und trockene Sehnen kommen vor").toBeGreaterThan(100);
        expect(nass).toBeLessThan(1400);
    });

    it("eine Fläche mit wenigen Kanten bekommt kein Gitter, und eine Linie ganz außerhalb findet nichts", () => {
        const edges = areaEdges({ type: "Polygon", coordinates: [quadrat(0, 10)] });
        expect(buildEdgeGrid(edges)).toBeNull();
        const erzwungen = buildEdgeGrid(edges, 1);
        expect(erzwungen).not.toBeNull();
        const ausserhalb: [number, number][] = [
            [100, 100],
            [120, 130],
        ];
        expect(lineIntervals(ausserhalb, edges, erzwungen)).toEqual([]);
        // Quer durch, über den Rand des Gitters hinaus.
        const quer: [number, number][] = [
            [-50, 5],
            [60, 5],
        ];
        expect(lineIntervals(quer, edges, erzwungen)).toEqual(ohneGitter(quer, edges));
        // Eine Linie ganz im Inneren: keine Kante geschnitten, der Strahltest über das Gitter sagt „innen“.
        const innen: [number, number][] = [
            [2, 5],
            [8, 5],
        ];
        expect(lineIntervals(innen, edges, erzwungen)).toEqual([{ enter: 0, exit: 6 }]);
    });
});
