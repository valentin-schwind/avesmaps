import { describe, expect, it } from "vitest";
import {
    buildAxisGraph,
    longestPath,
    pathLength,
    resample,
    type Point,
    type Triangle,
} from "../src/derive/chordal-axis.ts";
import { calmToChord, fitCurve, maxDeviationAngle, POLY_DEGREE, principalFrame } from "../src/derive/curve-fit.ts";

/**
 * Die reine Geometrie der Schriftlauf-Ableitung (WI-0004).
 *
 * Geprüft wird an Formen, deren Achse man von Hand kennt: ein langer schmaler Streifen hat eine
 * waagerechte Mittelachse, ein Bogen eine gebogene, ein Knick eine, die sich beruhigen lässt. Eine
 * Prüfung gegen eine echte Landschaftsfläche käme später und sagte weniger — dort ist jede
 * Abweichung plausibel.
 */

/** Trianguliert ein Rechteck der Länge `length` und Höhe `height` in gleichmäßige Streifen. */
function stripTriangles(length: number, height: number, steps: number): Triangle[] {
    const triangles: Triangle[] = [];
    for (let index = 0; index < steps; index += 1) {
        const x0 = (length * index) / steps;
        const x1 = (length * (index + 1)) / steps;
        triangles.push([
            { x: x0, y: 0 },
            { x: x1, y: 0 },
            { x: x0, y: height },
        ]);
        triangles.push([
            { x: x1, y: 0 },
            { x: x1, y: height },
            { x: x0, y: height },
        ]);
    }
    return triangles;
}

describe("Chordal Axis", () => {
    it("legt die Achse eines schmalen Streifens der Länge nach", () => {
        const graph = buildAxisGraph(stripTriangles(100, 10, 20));
        const path = longestPath(graph);

        expect(path.length, "die Achse besteht aus mehreren Punkten").toBeGreaterThan(5);
        // Sie läuft über fast die ganze Länge.
        expect(pathLength(path)).toBeGreaterThan(80);

        // 🪤 Die beiden Enden greifen bewusst bis an den Rand: ein Dreieck mit nur einer Innenkante
        // wird mit seiner gegenüberliegenden ECKE verbunden, damit die Achse bis ans Ende der
        // Fläche reicht statt eine halbe Dreiecksbreite davor aufzuhören. Bei einem Rechteck ist
        // dieses Ende eine Ecke. Die Mitte des Weges muss trotzdem in der Mitte der Höhe bleiben.
        const inner = path.slice(1, -1);
        for (const point of inner) {
            expect(point.y, "innen bleibt die Achse mittig").toBeGreaterThan(2);
            expect(point.y).toBeLessThan(8);
        }
        const firstX = (path[0] as Point).x;
        const lastX = (path[path.length - 1] as Point).x;
        expect(Math.min(firstX, lastX), "die Achse beginnt am Anfang der Fläche").toBeLessThan(5);
        expect(Math.max(firstX, lastX), "und endet an ihrem Ende").toBeGreaterThan(95);
    });

    it("liefert für zu wenige Dreiecke keinen Weg statt eines geratenen", () => {
        const graph = buildAxisGraph([
            [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0, y: 1 },
            ],
        ]);
        // Ein einzelnes Dreieck teilt keine Kante; es gibt keine Innenkante und damit keine Achse.
        expect(longestPath(graph)).toEqual([]);
    });

    it("tastet einen Linienzug gleichmäßig neu ab", () => {
        const line: Point[] = [
            { x: 0, y: 0 },
            { x: 30, y: 0 },
            { x: 30, y: 40 },
        ];
        const sampled = resample(line, 8);
        expect(sampled).toHaveLength(8);
        expect(sampled[0]).toEqual({ x: 0, y: 0 });
        expect(sampled[7]).toEqual({ x: 30, y: 40 });
        // Gleichmäßig heißt: jeder Schritt gleich lang, nicht jeder Stützpunkt getroffen.
        const steps: number[] = [];
        for (let index = 1; index < sampled.length; index += 1) {
            const from = sampled[index - 1] as Point;
            const to = sampled[index] as Point;
            steps.push(Math.hypot(to.x - from.x, to.y - from.y));
        }
        const first = steps[0] as number;
        for (const step of steps) {
            expect(Math.abs(step - first)).toBeLessThan(0.001);
        }
    });
});

describe("Glättung", () => {
    it("findet die Hauptachse einer langgestreckten Wolke", () => {
        const points: Point[] = [];
        for (let index = 0; index <= 20; index += 1) {
            points.push({ x: index, y: index }); // 45 Grad
        }
        const frame = principalFrame(points);
        expect((frame.angle * 180) / Math.PI).toBeCloseTo(45, 1);
    });

    it("macht aus einem Zickzack eine einzige weiche Biegung", () => {
        // Ein Sägezahn entlang x: die Achse springt, die Kurve darf das nicht.
        const rough: Point[] = [];
        for (let index = 0; index <= 40; index += 1) {
            rough.push({ x: index, y: index % 2 === 0 ? 3 : -3 });
        }
        const fitted = fitCurve(rough, 60);

        expect(fitted).toHaveLength(60);
        // Der Sägezahn ist weg: kein Teilstück schlägt mehr scharf aus.
        expect((maxDeviationAngle(fitted) * 180) / Math.PI).toBeLessThan(20);
        expect((maxDeviationAngle(rough) * 180) / Math.PI).toBeGreaterThan(60);
    });

    it("folgt einem echten Bogen, statt ihn zur Geraden zu machen", () => {
        const arc: Point[] = [];
        for (let index = 0; index <= 40; index += 1) {
            const t = index / 40;
            arc.push({ x: t * 100, y: Math.sin(t * Math.PI) * 25 });
        }
        const fitted = fitCurve(arc, 60);
        const apex = fitted.reduce((best, point) => (point.y > best.y ? point : best), fitted[0] as Point);
        // Ein Polynom dritten Grades trifft einen einzelnen Bogen gut; der Scheitel bleibt hoch.
        expect(apex.y).toBeGreaterThan(18);
    });

    it("beruhigt einen Knick und lässt die Endpunkte liegen", () => {
        const bent: Point[] = [
            { x: 0, y: 0 },
            { x: 25, y: 40 },
            { x: 50, y: 0 },
        ];
        const calmed = calmToChord(resample(bent, 21), 30);

        expect(calmed[0]).toEqual({ x: 0, y: 0 });
        expect(calmed[calmed.length - 1]?.x).toBeCloseTo(50, 6);
        expect((maxDeviationAngle(calmed) * 180) / Math.PI).toBeLessThanOrEqual(30.001);
    });

    it("kürzt beim Beruhigen — deshalb muss danach erneut gemessen werden", () => {
        const bent = resample(
            [
                { x: 0, y: 0 },
                { x: 25, y: 40 },
                { x: 50, y: 0 },
            ],
            21,
        );
        const calmed = calmToChord(bent, 30);
        expect(pathLength(calmed)).toBeLessThan(pathLength(bent));
    });
});

describe("Polynomgrad je Region (WI-0019)", () => {
    /**
     * Ein gerades Polynom vierten Grades, symmetrisch abgetastet. Weil es gerade ist, verschwindet
     * die Kovarianz, und sein Hauptachsenframe ist das eigene Koordinatensystem - ein Fit vierten
     * Grades muss es also treffen, einer dritten Grades kann es nicht.
     */
    function quartic(scale = 1): Point[] {
        return Array.from({ length: 81 }, (_, index) => {
            const x = -20 + index * 0.5;
            return { x: x * scale, y: (0.0004 * x ** 4 - 0.1 * x ** 2) * scale };
        });
    }

    /** Größter Abstand eines Kurvenpunkts zum dicht abgetasteten Original. */
    function worstDistance(curve: readonly Point[], reference: readonly Point[]): number {
        const dense = resample(reference, 4000);
        return Math.max(
            ...curve.map((point) => Math.min(...dense.map((q) => Math.hypot(point.x - q.x, point.y - q.y)))),
        );
    }

    it("Grad 4 trifft ein Polynom vierten Grades, Grad 3 nicht", () => {
        const points = quartic();
        // Der Rest ist die Sehnenabweichung zwischen 120 Stützpunkten, nicht der Fit.
        expect(worstDistance(fitCurve(points, 120, 4), points)).toBeLessThan(0.1);
        expect(worstDistance(fitCurve(points, 120, 3), points)).toBeGreaterThan(1);
    });

    it("🔴 Grad 5 ist skaleninvariant: ×100 und ×0,001 skalierte Punkte ergeben die skalierte Kurve", () => {
        // 🪤 Gemessen 2026-09-23, gegen die naheliegende Erwartung: nach OBEN hält auch der
        // unskalierte Fit - die Teilpivotierung fängt Potenzen bis u^10 auf, noch bei ×100000 liegt
        // der Fehler um 1e-13. Nach UNTEN kippt er: bei ×0,001 unterschreitet der Pivot die feste
        // Schwelle 1e-12, `solve` meldet „singulär", und der Fit fällt still auf die rohe Achse
        // zurück - an der Achse von Farlornschwelle 35 Einheiten daneben. Erst auf [-1, 1]
        // skaliert hängt der Fit nicht mehr am Kartenmaß.
        const reference = fitCurve(quartic(), 120, 5);
        for (const scale of [100, 0.001]) {
            const scaled = fitCurve(quartic(scale), 120, 5);
            const worst = Math.max(
                ...reference.map((point, index) => {
                    const other = scaled[index] as Point;
                    return Math.hypot(other.x / scale - point.x, other.y / scale - point.y);
                }),
            );
            expect(worst, `×${String(scale)}`).toBeLessThan(1e-6);
        }
    });

    it("ohne Angabe gilt Legacys Grad 3", () => {
        expect(POLY_DEGREE).toBe(3);
        expect(fitCurve(quartic(), 120)).toEqual(fitCurve(quartic(), 120, POLY_DEGREE));
    });
});
