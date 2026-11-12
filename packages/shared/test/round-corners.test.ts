import { describe, expect, it } from "vitest";
import type { CurvePoint } from "../src/catmull-rom.ts";
import { ROUNDED_CORNER_SEGMENTS, roundCornersWhere } from "../src/round-corners.ts";

/**
 * Die Rundung der Ecken eines Flugs, so weit die Linie frei bleibt (WI-0051 F3, Befund 2026-10-03: „flug- und
 * querfeldeinrouten sind nicht mehr geglättet“).
 *
 * 🔴 Der Befund: Die Anzeige des Flugs wurde im Ganzen gerundet und im Ganzen geprüft. Eine Linie, die um ein
 * Gebirge straff gezogen ist, berührt dessen Ecken; jede Rundung schneidet dort hinein, die Prüfung fiel durch, und
 * die Linie blieb eckig - bei 113 von 124 gemessenen Umwegflügen. Hier steht, was dagegen hält: Jede Ecke wird für
 * sich so weit gerundet, wie sie frei bleibt.
 */

const everything = (): boolean => true;
const nothing = (): boolean => false;

/** Der Abstand der Linie von einem Punkt: der kleinste über alle Stücke. */
function distanceTo(line: readonly CurvePoint[], point: CurvePoint): number {
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 1; index < line.length; index += 1) {
        const a = line[index - 1] as CurvePoint;
        const b = line[index] as CurvePoint;
        const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        const t =
            lengthSquared > 0
                ? Math.max(
                      0,
                      Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared),
                  )
                : 0;
        nearest = Math.min(nearest, Math.hypot(point.x - a.x - t * (b.x - a.x), point.y - a.y - t * (b.y - a.y)));
    }
    return nearest;
}

describe("roundCornersWhere", () => {
    const corner: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
    ];

    it("🔴 rundet jede Ecke voll, wo nichts im Weg ist: eine Parabel von Mitte zu Mitte der Seiten", () => {
        const line = roundCornersWhere(corner, everything);
        // Anfang und Ende bleiben, die Rundung beginnt in der Mitte der ersten und endet in der Mitte der zweiten Seite.
        expect(line[0]).toEqual({ x: 0, y: 0 });
        expect(line[line.length - 1]).toEqual({ x: 10, y: 10 });
        expect(line).toContainEqual({ x: 5, y: 0 });
        expect(line).toContainEqual({ x: 10, y: 5 });
        expect(line).toHaveLength(2 + (ROUNDED_CORNER_SEGMENTS + 1));
        // Der Scheitel der Parabel liegt bei (M1 + 2V + M2) / 4 und damit weit vor der Ecke.
        const middle = line[1 + ROUNDED_CORNER_SEGMENTS / 2] as CurvePoint;
        expect(middle.x).toBeCloseTo(8.75, 9);
        expect(middle.y).toBeCloseTo(1.25, 9);
        expect(distanceTo(line, { x: 10, y: 0 })).toBeGreaterThan(1.7);
    });

    it("🔴 bleibt in der Hülle der Linie und schlägt keine Schleife, auch zwischen langen und kurzen Seiten", () => {
        const zug: CurvePoint[] = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 101, y: 3 },
            { x: 102, y: -2 },
            { x: 200, y: 4 },
        ];
        const line = roundCornersWhere(zug, everything);
        for (let index = 1; index + 1 < line.length; index += 1) {
            const a = line[index - 1] as CurvePoint;
            const b = line[index] as CurvePoint;
            const c = line[index + 1] as CurvePoint;
            // Keine Kehre: Aufeinanderfolgende Stücke biegen nie um mehr als 90 Grad.
            expect((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)).toBeGreaterThanOrEqual(0);
        }
        // Jeder Punkt liegt höchstens so weit neben dem Zug, wie der Zug selbst hoch ist.
        for (const point of line) expect(distanceTo(zug, point)).toBeLessThan(5);
    });

    it("🔴 rundet jede Ecke für sich: Eine, die nicht rund werden darf, hält die anderen nicht auf", () => {
        // Ein Gebirge am Knick bei (10|0): Alles, was der Ecke näher kommt als 0,2 E, ist gesperrt.
        const zug: CurvePoint[] = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ];
        const near = (point: CurvePoint): number => Math.hypot(point.x - 10, point.y - 0);
        const free = (from: CurvePoint, to: CurvePoint): boolean => {
            // Abgetastet: Das Stück darf der gesperrten Ecke nirgends näher kommen als 0,2.
            for (let step = 0; step <= 20; step += 1) {
                const f = step / 20;
                if (near({ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f }) < 0.2) return false;
            }
            return true;
        };
        const line = roundCornersWhere(zug, free);
        // Die erste Ecke ist gesperrt: höchstens ganz eng gerundet, ihr nächster Punkt liegt noch außerhalb von 0,2.
        expect(Math.min(...line.map(near))).toBeGreaterThanOrEqual(0.2);
        // Die zweite Ecke ist voll gerundet: (10|5) und (5|10) sind die Mitten der Seiten.
        expect(line).toContainEqual({ x: 10, y: 5 });
        expect(line).toContainEqual({ x: 5, y: 10 });
        // Anfang und Ende bleiben.
        expect(line[0]).toEqual({ x: 0, y: 0 });
        expect(line[line.length - 1]).toEqual({ x: 0, y: 10 });
    });

    it("🔴 zieht die Rundung enger, bis sie frei bleibt, und nimmt die breiteste, die es tut", () => {
        // Ein Felsen im Inneren der Ecke bei (8|2): Alles, was ihm näher kommt als 1,2, ist gesperrt. Beide Seiten sind frei
        // (2 Abstand), die volle Rundung geht bei (8,75|1,25) ihm zu nah vorbei.
        const free = (from: CurvePoint, to: CurvePoint): boolean => {
            for (let step = 0; step <= 40; step += 1) {
                const f = step / 40;
                if (Math.hypot(from.x + (to.x - from.x) * f - 8, from.y + (to.y - from.y) * f - 2) < 1.2) return false;
            }
            return true;
        };
        const full = roundCornersWhere(corner, everything);
        const narrow = roundCornersWhere(corner, free);
        // Enger als voll, aber gerundet: mehr Punkte als der Zug, und die Linie liegt näher an der Ecke.
        expect(narrow.length).toBeGreaterThan(corner.length);
        expect(distanceTo(narrow, { x: 10, y: 0 })).toBeLessThan(distanceTo(full, { x: 10, y: 0 }));
        for (let index = 1; index < narrow.length; index += 1) {
            expect(free(narrow[index - 1] as CurvePoint, narrow[index] as CurvePoint)).toBe(true);
        }
        // Sie beginnt auf der ersten Seite, aber näher an der Ecke als die volle (bei x = 5).
        const start = narrow[1] as CurvePoint;
        expect(start.y).toBe(0);
        expect(start.x).toBeGreaterThan(5);
        expect(start.x).toBeLessThan(10);
    });

    it("🔴 lässt die Ecke stehen, wenn keine Rundung frei bleibt, und die Linie bleibt wie sie ist", () => {
        expect(roundCornersWhere(corner, nothing)).toEqual(corner);
    });

    it("gerade Strecken und Kehren sind keine Ecken; zwei Punkte bleiben zwei Punkte", () => {
        const straight: CurvePoint[] = [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 10, y: 0 },
        ];
        expect(roundCornersWhere(straight, everything)).toEqual(straight);
        const back: CurvePoint[] = [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 0, y: 0 },
        ];
        expect(roundCornersWhere(back, everything)).toEqual(back);
        const two: CurvePoint[] = [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
        ];
        expect(roundCornersWhere(two, everything)).toEqual(two);
    });

    it("die Rundungen zweier benachbarter Ecken überlappen nie und stoßen in der Mitte der gemeinsamen Seite zusammen", () => {
        const zug: CurvePoint[] = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 20, y: 10 },
        ];
        const line = roundCornersWhere(zug, everything);
        // Die Mitte der gemeinsamen Seite (10|5) steht einmal da, nicht doppelt.
        expect(line.filter((point) => point.x === 10 && point.y === 5)).toHaveLength(1);
        // Die Reihenfolge der Punkte entlang der Linie läuft nie zurück: x und y wachsen nur.
        for (let index = 1; index < line.length; index += 1) {
            const a = line[index - 1] as CurvePoint;
            const b = line[index] as CurvePoint;
            expect(b.x).toBeGreaterThanOrEqual(a.x - 1e-12);
            expect(b.y).toBeGreaterThanOrEqual(a.y - 1e-12);
        }
    });

    it("ändert die Eingabe nicht", () => {
        const input = corner.map((point) => ({ ...point }));
        roundCornersWhere(input, everything);
        expect(input).toEqual(corner);
    });
});
