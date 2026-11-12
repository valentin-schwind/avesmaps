import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    flightAltitude,
    flightSurcharge,
    resolveAirQuery,
    type RouteAir,
} from "@avesmaps3d/shared";
import {
    airFieldRule,
    axisOf,
    AXES,
    AXIS_OF_DIRECTION,
    buildCostField,
    stepExtra,
    turnExtra,
} from "../src/routing/air-field.ts";
import type { AirFrame } from "../src/routing/air-obstacles.ts";
import { SCHRITT_PER_UNIT } from "../src/routing/slope.ts";
import { random } from "./support/invariants.ts";

/**
 * Das Kostenfeld des Flugs (WI-0051 F4b): Die Bahn je Zelle und Achse ist die Rechnung von `flightAltitude` auf einer Geraden
 * des Rasters, der Preis eines Schritts der von `flightSurcharge`. Hier gegen die Rechnung der Bahn selbst.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const airOf = (id: string): RouteAir => {
    const resolved = resolveAirQuery(model, { air: id });
    if (!resolved.ok || !resolved.air) throw new Error(`${id} erwartet`);
    return resolved.air;
};
const hexe = airOf("witchFlight");
const hippogriff = airOf("hippogriff");

const COLS = 60;
const ROWS = 60;
const CELL = 0.5;
const frame: AirFrame = { minX: 0, minY: 0, cell: CELL, cols: COLS, rows: ROWS };
const at = (column: number, row: number): number => row * COLS + column;

/** Ein zufälliges, aber zusammenhängendes Gelände zwischen 0 und etwa 4.000 Schritt. */
function gelaende(seed: number): Float32Array {
    const next = random(seed);
    const phase = [next() * 6, next() * 6, next() * 6, next() * 6];
    const ground = new Float32Array(COLS * ROWS);
    for (let row = 0; row < ROWS; row += 1) {
        for (let column = 0; column < COLS; column += 1) {
            const base =
                Math.max(0, Math.sin(column / 7 + phase[0]!) * Math.cos(row / 9 + phase[1]!)) * 3000 +
                Math.max(0, Math.sin((column + row) / 5 + phase[2]!)) * 700 +
                (next() < 0.03 ? next() * 1000 : 0);
            ground[at(column, row)] = Math.round(base);
        }
    }
    return ground;
}

describe("axisOf und die Achsen", () => {
    it("jede der acht Nachbarrichtungen liegt auf der Achse, die `AXIS_OF_DIRECTION` nennt", () => {
        const directions: [number, number][] = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [-1, 1],
            [1, -1],
            [-1, -1],
        ];
        directions.forEach(([dx, dy], index) => {
            expect(axisOf(dx, dy), `Richtung ${String(index)}`).toBe(AXIS_OF_DIRECTION[index]);
            // Dieselbe Gerade in die Gegenrichtung gehört zur selben Achse.
            expect(axisOf(-dx, -dy)).toBe(axisOf(dx, dy));
        });
        // Die Achsen selbst: Ost-West, Nord-Süd und die beiden Diagonalen.
        expect(AXES.map(([dx, dy]) => axisOf(dx, dy))).toEqual([0, 1, 2, 3]);
    });

    it("eine schräge Richtung nimmt die nächste Achse, bis 22,5° daneben", () => {
        for (const degrees of [-80, -60, -30, -10, 0, 10, 20, 30, 40, 50, 60, 80, 100, 120, 150, 170]) {
            const radians = (degrees * Math.PI) / 180;
            const axis = axisOf(Math.cos(radians), Math.sin(radians));
            const [dx, dy] = AXES[axis] as readonly [number, number];
            const between = Math.abs(Math.cos(radians) * dy - Math.sin(radians) * dx) / Math.hypot(dx, dy);
            // Der Sinus des Winkels zur Achse liegt unter dem von 22,5°.
            expect(between, `${String(degrees)}°`).toBeLessThanOrEqual(Math.sin((22.5 * Math.PI) / 180) + 1e-9);
        }
    });
});

describe("buildCostField", () => {
    it("🔴 über ebenem Land liegt die Bahn überall und auf jeder Achse auf Boden + Mindestabstand (jede Zelle ist auf jeder Achse gelesen)", () => {
        const rule = airFieldRule(hexe, model);
        const flat = new Float32Array(COLS * ROWS);
        const field = buildCostField(frame, new Float32Array(flat), flat, rule);
        // Boden 0: Bedarf = max(Reisehöhe 100, 0 + Mindestabstand 200) = 200.
        for (let axis = 0; axis < 4; axis += 1) {
            const altitude = field.altitude[axis] as Uint16Array;
            for (let index = 0; index < altitude.length; index += 1) {
                if (altitude[index] !== 200)
                    throw new Error(`Achse ${String(axis)}, Zelle ${String(index)}: ${String(altitude[index])}`);
            }
        }
    });

    it("🔴 die Bahn je Zelle ist die von flightAltitude entlang der Geraden: Ost-West, Nord-Süd und beide Diagonalen, innen auf einen Schritt genau", () => {
        let raised = 0;
        for (const air of [hexe, hippogriff]) {
            const rule = airFieldRule(air, model);
            for (let seed = 1; seed <= 6; seed += 1) {
                const ground = gelaende(seed * 7919);
                const field = buildCostField(frame, new Float32Array(ground), ground, rule);
                // Je Achse eine Gerade quer durch das Raster: Zellen, auf einer Folge von Zellen.
                const lines: [number, number[]][] = [
                    [0, Array.from({ length: COLS }, (_, k) => at(k, 23 + (seed % 7)))],
                    [1, Array.from({ length: ROWS }, (_, k) => at(11 + seed * 5, k))],
                    [2, Array.from({ length: Math.min(COLS, ROWS) }, (_, k) => at(k, k))],
                    [3, Array.from({ length: Math.min(COLS, ROWS) }, (_, k) => at(k, ROWS - 1 - k))],
                ];
                for (const [axis, cells] of lines) {
                    const [dx, dy] = AXES[axis] as readonly [number, number];
                    const step = CELL * (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1) * SCHRITT_PER_UNIT;
                    const exact = flightAltitude({
                        ground: cells.map((index) => ground[index] as number),
                        length: step * (cells.length - 1),
                        cruise: rule.cruise,
                        ceiling: rule.ceiling,
                        reach: rule.reach,
                        clearance: rule.clearance,
                        hold: rule.hold,
                        slope: rule.slope,
                    });
                    const mine = field.altitude[axis] as Uint16Array;
                    // Innen: Die Rampen am Start und am Ziel von `flightAltitude` kennt das Feld nicht (sie greifen nur
                    // nahe den Enden: 5.000 Schritt Höhe brauchen 20.000 Schritt Weg, rund 14 Zellen).
                    for (let k = 14; k < cells.length - 14; k += 1) {
                        // Die Probe prüft etwas: Oft hebt die Hülle die Bahn über Boden + Mindestabstand.
                        if ((exact[k] as number) > (ground[cells[k] as number] as number) + rule.clearance + 50)
                            raised += 1;
                        expect(
                            Math.abs((mine[cells[k] as number] as number) - (exact[k] as number)),
                            `${air.profile}, Gelände ${String(seed)}, Achse ${String(axis)}, Zelle ${String(k)}`,
                        ).toBeLessThanOrEqual(1);
                    }
                }
            }
        }
        expect(raised).toBeGreaterThan(300);
    });

    it("🔴 der Preis einer Zellfolge ist der Zuschlag der Bahn: die Summe von stepExtra gleich flightSurcharge über denselben Werten", () => {
        for (const air of [hexe, hippogriff]) {
            const rule = airFieldRule(air, model);
            for (let seed = 1; seed <= 6; seed += 1) {
                const ground = gelaende(seed * 104729);
                const field = buildCostField(frame, new Float32Array(ground), ground, rule);
                const cells = Array.from({ length: COLS }, (_, k) => at(k, 20 + seed));
                const altitude = field.altitude[0] as Uint16Array;
                const exact = flightSurcharge({
                    ground: cells.map((index) => ground[index] as number),
                    altitude: cells.map((index) => altitude[index] as number),
                    length: CELL * SCHRITT_PER_UNIT * (cells.length - 1),
                    standard: rule.standard,
                    scale: rule.scale,
                    climbFactor: rule.climbFactor,
                    holdFactor: rule.holdFactor,
                });
                let sum = 0;
                for (let k = 1; k < cells.length; k += 1) {
                    sum += stepExtra(field, 0, cells[k - 1] as number, cells[k] as number, CELL);
                }
                // stepExtra in Karteneinheiten, flightSurcharge in Schritt.
                const expected = exact.climb + exact.hold;
                expect(sum * SCHRITT_PER_UNIT, `${air.profile}, Gelände ${String(seed)}`).toBeCloseTo(expected, 6);
            }
        }
    });

    it("🔴 eine Ecke zwischen zwei Achsen kostet das Steigen von der alten Bahn auf die neue, nie weniger als nichts, und nichts auf ebenem Land", () => {
        const rule = airFieldRule(hexe, model);
        const flat = new Float32Array(COLS * ROWS);
        const ebene = buildCostField(frame, new Float32Array(flat), flat, rule);
        for (const from of [0, 1, 2, 3]) {
            for (const to of [0, 1, 2, 3]) expect(turnExtra(ebene, from, to, at(30, 30))).toBe(0);
        }
        // Ein Gipfel liegt auf der Ost-West-Geraden durch (30, 30), nicht auf der Nord-Süd-Geraden: Von Nord-Süd auf Ost-West
        // zu wechseln kostet das Steigen auf die höhere Bahn, zurück kostet nichts (Sinken ist frei).
        const ground = new Float32Array(COLS * ROWS);
        for (let row = 29; row <= 31; row += 1)
            for (let column = 36; column <= 38; column += 1) ground[at(column, row)] = 3500;
        const field = buildCostField(frame, new Float32Array(ground), ground, rule);
        const cell = at(32, 30);
        const up = turnExtra(field, 1, 0, cell);
        expect(up).toBeGreaterThan(1);
        expect(turnExtra(field, 0, 1, cell)).toBe(0);
        // Dieselbe Achse: keine Ecke.
        expect(turnExtra(field, 0, 0, cell)).toBe(0);
        // Der Betrag: Zuwachs der Bahn und des Überstands (hier gleich, der Boden ist dort derselbe), mal Steigfaktor.
        const altitude0 = (field.altitude[0] as Uint16Array)[cell] as number;
        const altitude1 = (field.altitude[1] as Uint16Array)[cell] as number;
        expect(up).toBeCloseTo(((altitude0 - altitude1) * rule.climbFactor) / SCHRITT_PER_UNIT, 9);
    });

    it("🔴 Wer neben einem Gipfel durch ein Tal fliegt, zahlt nichts: Die Bahn einer Achse sieht nur ihre eigene Gerade", () => {
        const rule = airFieldRule(hexe, model);
        const ground = new Float32Array(COLS * ROWS);
        // Ein Gipfel von 4.000 Schritt bei (30, 30), breit genug für das Feld.
        for (let row = 28; row <= 32; row += 1)
            for (let column = 28; column <= 32; column += 1) ground[at(column, row)] = 4000;
        const field = buildCostField(frame, new Float32Array(ground), ground, rule);
        const price = (axis: number, cells: number[]): number => {
            let sum = 0;
            for (let k = 1; k < cells.length; k += 1)
                sum += stepExtra(field, axis, cells[k - 1] as number, cells[k] as number, CELL);
            return sum;
        };
        const row = (y: number): number[] => Array.from({ length: COLS }, (_, k) => at(k, y));
        const column = (x: number): number[] => Array.from({ length: ROWS }, (_, k) => at(x, k));
        // Durch den Gipfel kostet es, drei Zellen daneben (1,5 E) auf der freien Seite nichts, in beiden Richtungen.
        expect(price(0, row(30))).toBeGreaterThan(5);
        expect(price(1, column(30))).toBeGreaterThan(5);
        expect(price(0, row(40))).toBe(0);
        expect(price(1, column(40))).toBe(0);
        expect(price(0, row(10))).toBe(0);
        expect(price(1, column(10))).toBe(0);
        // Rückwärts dasselbe: Eine Achse hat keine Richtung.
        expect(price(0, row(30).reverse())).toBeCloseTo(price(0, row(30)), 6);
    });
});
