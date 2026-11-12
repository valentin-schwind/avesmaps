import { describe, expect, it } from "vitest";
import { polishWay, type PolishOptions } from "../src/routing/air-polish.ts";
import { lineLength } from "../src/routing/router.ts";
import { random } from "./support/invariants.ts";

/**
 * Das Feilen am Weg des Flugs (WI-0051 F4b): Mustersuche an den Ecken eines Wegs nach einer Kostenfunktion, die der Aufrufer
 * stellt (im Dienst die exakte Bahn). Hier mit erfundenen Kosten.
 */

type Point = [number, number];

const OPTIONS: PolishOptions = { radii: [3, 1.5, 0.75], passes: 3, maxEvaluations: 400 };
const erlaubt = (): boolean => true;

describe("polishWay", () => {
    it("🔴 entfernt eine Ecke, die nichts bringt: Länge allein ist auf der Geraden am kleinsten", () => {
        const line: Point[] = [
            [0, 0],
            [5, 8],
            [10, 0],
        ];
        const result = polishWay(line, (l) => lineLength(l as Point[]), erlaubt, OPTIONS);
        expect(result.line).toEqual([
            [0, 0],
            [10, 0],
        ]);
        expect(result.cost).toBeCloseTo(10, 12);
    });

    it("🔴 schiebt die Ecke neben ein Hindernis, statt es zu queren, und bleibt so kurz wie möglich", () => {
        // Ein Hindernis bei (5, 0) mit Radius 2: Jede Sehne, die näher als 2 an ihm vorbeiführt, kostet 100 dazu.
        const cost = (line: readonly Point[]): number => {
            let price = lineLength(line as Point[]);
            for (let i = 1; i < line.length; i += 1) {
                const [x0, y0] = line[i - 1] as Point;
                const [x1, y1] = line[i] as Point;
                const dx = x1 - x0;
                const dy = y1 - y0;
                const t = Math.max(0, Math.min(1, ((5 - x0) * dx + (0 - y0) * dy) / (dx * dx + dy * dy)));
                if (Math.hypot(x0 + dx * t - 5, y0 + dy * t) < 2) price += 100;
            }
            return price;
        };
        const start: Point[] = [
            [0, 0],
            [4, 6],
            [10, 0],
        ];
        const result = polishWay(start, cost, erlaubt, {
            ...OPTIONS,
            radii: [3, 1.5, 0.75, 0.375, 0.19],
            maxEvaluations: 800,
        });
        expect(result.cost).toBeLessThan(cost(start));
        // Kein Aufschlag mehr: Der Weg bleibt ausserhalb des Radius.
        expect(result.cost).toBeLessThan(100);
        // Nah an der besten Lösung (Ecke bei (5, 2): Länge 2 × √29 = 10,77).
        expect(result.cost).toBeLessThan(11.2);
        expect(result.line[0]).toEqual([0, 0]);
        expect(result.line[result.line.length - 1]).toEqual([10, 0]);
    });

    it("🔴 fügt in einen geraden Weg eine Ecke ein, wo ein Hindernis mittendrin liegt: Ohne innere Ecke gäbe es sonst nichts zu verschieben", () => {
        // Ein Hindernis bei (10, 0), dessen Aufschlag mit dem Abstand sinkt (bis 4), mitten auf der Geraden von (0, 0) nach (20, 0).
        const cost = (line: readonly Point[]): number => {
            let price = lineLength(line as Point[]);
            for (let i = 1; i < line.length; i += 1) {
                const [x0, y0] = line[i - 1] as Point;
                const [x1, y1] = line[i] as Point;
                const dx = x1 - x0;
                const dy = y1 - y0;
                const t = Math.max(0, Math.min(1, ((10 - x0) * dx + (0 - y0) * dy) / (dx * dx + dy * dy)));
                price += 40 * Math.max(0, 4 - Math.hypot(x0 + dx * t - 10, y0 + dy * t));
            }
            return price;
        };
        const gerade: Point[] = [
            [0, 0],
            [20, 0],
        ];
        expect(cost(gerade)).toBeGreaterThan(150);
        const result = polishWay(gerade, cost, erlaubt, { ...OPTIONS, maxEvaluations: 800 });
        expect(result.line.length).toBeGreaterThan(2);
        expect(result.cost).toBeLessThan(25);
        expect(result.line[0]).toEqual([0, 0]);
        expect(result.line[result.line.length - 1]).toEqual([20, 0]);
        // Und `allowed` hat das letzte Wort: Ohne Erlaubnis für Wege mit Ecke bleibt die Gerade.
        const verboten = polishWay(gerade, cost, (l) => l.length <= 2, OPTIONS);
        expect(verboten.line).toEqual(gerade);
    });

    it("🔴 wird nie teurer, die Enden bleiben, und es zählt höchstens `maxEvaluations` Bewertungen (zufällige Kosten)", () => {
        const next = random(20261004);
        for (let round = 0; round < 40; round += 1) {
            const a = next() * 10;
            const b = next() * 10;
            const c = next() * 6;
            // Eine glatte, aber verbeulte Kostenfläche über der Ebene plus die Länge.
            const cost = (line: readonly Point[]): number =>
                lineLength(line as Point[]) +
                line.reduce(
                    (sum, [x, y]) => sum + 3 * Math.max(0, Math.sin(x / (1 + c)) * Math.cos(y / (1 + a / 5))),
                    0,
                );
            const start: Point[] = [[0, 0]];
            for (let k = 0; k < 2 + (round % 4); k += 1) start.push([next() * 20, next() * 20]);
            start.push([20 + b, 20]);
            const options = { ...OPTIONS, maxEvaluations: 10 + (round % 5) * 25 };
            const result = polishWay(start, cost, erlaubt, options);
            expect(result.cost, `Runde ${String(round)}`).toBeLessThanOrEqual(cost(start) + 1e-9);
            expect(result.cost, `Runde ${String(round)}`).toBeCloseTo(cost(result.line), 9);
            expect(result.line[0]).toEqual(start[0]);
            expect(result.line[result.line.length - 1]).toEqual(start[start.length - 1]);
            expect(result.evaluations, `Runde ${String(round)}`).toBeLessThanOrEqual(options.maxEvaluations);
        }
    });

    it("🔴 deterministisch: dieselbe Eingabe, dasselbe Ergebnis, auch mit einem Zwischenspeicher der Kosten", () => {
        const cost = (line: readonly Point[]): number =>
            lineLength(line as Point[]) +
            line.reduce((sum, [x, y]) => sum + 2 * Math.abs(Math.sin(x) * Math.cos(y)), 0);
        const start: Point[] = [
            [0, 0],
            [3, 5],
            [7, 2],
            [12, 9],
            [15, 0],
        ];
        const first = polishWay(start, cost, erlaubt, OPTIONS);
        const memo = new Map<string, number>();
        const cached = (line: readonly Point[]): number => {
            const key = JSON.stringify(line);
            let known = memo.get(key);
            if (known === undefined) {
                known = cost(line);
                memo.set(key, known);
            }
            return known;
        };
        const second = polishWay(start, cached, erlaubt, OPTIONS);
        expect(JSON.stringify(second.line)).toBe(JSON.stringify(first.line));
        expect(second.cost).toBe(first.cost);
    });

    it("🔴 verboten ist verboten: Wege, die `allowed` ablehnt, nimmt es nie, auch wenn sie billiger wären", () => {
        // Billig ist nur die Gerade; verboten ist jede Linie mit weniger als 3 Punkten.
        const result = polishWay(
            [
                [0, 0],
                [5, 8],
                [10, 0],
            ],
            (l) => lineLength(l as Point[]),
            (l) => l.length >= 3,
            OPTIONS,
        );
        expect(result.line).toHaveLength(3);
        // Die Ecke wandert aber so nah an die Gerade heran, wie es der Radius der Mustersuche zulässt.
        expect(Math.abs((result.line[1] as Point)[1])).toBeLessThan(1);
    });

    it("ohne innere Ecke gibt es nichts zu feilen, und mit Startkosten spart es die erste Bewertung", () => {
        const line: Point[] = [
            [0, 0],
            [10, 0],
        ];
        const counted = polishWay(line, (l) => lineLength(l as Point[]), erlaubt, OPTIONS);
        expect(counted.line).toEqual(line);
        expect(counted.evaluations).toBe(1);
        const known = polishWay(line, (l) => lineLength(l as Point[]), erlaubt, OPTIONS, 10);
        expect(known.evaluations).toBe(0);
        expect(known.cost).toBe(10);
    });
});
