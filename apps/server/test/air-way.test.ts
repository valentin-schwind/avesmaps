import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { airTerrain } from "../src/routing/air-obstacles.ts";
import { STRAIGHT_AIR_WAY, type AirPoint } from "../src/routing/air-route.ts";
import { mountainAirFlight, STRAIGHT_FLIGHT, terrainAirFlight } from "../src/routing/air-way.ts";
import { calibrateRelief, chordAbove, KIND_NONE, reliefAt, type TerrainHeights } from "../src/routing/relief.ts";
import { gebirge } from "./support/air-terrain.ts";

/**
 * Der Weg des Flugs um die Gebirge (WI-0051, F2): Umflogen wird Gelände, das höher liegt als die
 * Höchstflughöhe minus den Mindestabstand (F-E1 = C). Über dem Gebirge, in dem ein Wegpunkt liegt, zählt ein
 * Stück zehnfach: Der Flug verlässt es dort, wo die ganze Reise am kürzesten wird (F-E3 = B). Die Grenze steht
 * hier direkt in Schritt: 2.000, also etwa Höchstflughöhe 2.200. Die Suche ist von der Höhe unabhängig; die Grenze
 * des Produkts ist seit 2026-10-04 für alle Flugmittel 4.800 (5.000 − 200, Betreiber), diese Datei prüft die Suche
 * mit beliebigen Grenzen.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const rule = { kind: "steigung" as const, steigung: 0.3 };
const GRENZE = 2000;
type Point = [number, number];

const punkt = (id: string, x: number, y: number): AirPoint => ({ id, name: id, x, y });

it("keeps an obstacle-free flight display when corner rounding would cut into a peak", () => {
    const coneRule = { kind: "radius" as const, radius: 30 };
    const peaks = [{ x: 50, y: 50, h: 5000, radius: 30 }];
    const heights: TerrainHeights = {
        rasters: [],
        cones: [{ ...peaks[0]!, radius: 30 }],
        rule: coneRule,
        mu: calibrateRelief([], peaks, coneRule, model),
    };
    const line: Point[] = [
        [20, 50],
        [20, 80],
        [80, 80],
        [80, 50],
    ];
    const flight = terrainAirFlight(heights, 1000, 200);
    expect(flight.display).toBeDefined();
    const display = flight.display!(line);
    for (let index = 1; index < display.length; index += 1) {
        expect(
            chordAbove(
                heights,
                { x: display[index - 1]![0], y: display[index - 1]![1] },
                { x: display[index]![0], y: display[index]![1] },
                800,
            ),
        ).toBe(false);
    }
});

function länge(points: readonly Point[]): number {
    let sum = 0;
    for (let index = 1; index < points.length; index += 1) {
        const [x0, y0] = points[index - 1] as Point;
        const [x1, y1] = points[index] as Point;
        sum += Math.hypot(x1 - x0, y1 - y0);
    }
    return sum;
}

/** Wie viel der Linie über Gelände liegt, das höher ist als die Grenze - fein abgetastet, am echten Gelände. */
function überDerGrenze(t: TerrainHeights, points: readonly Point[], grenze = GRENZE): number {
    let sum = 0;
    for (let index = 1; index < points.length; index += 1) {
        const [x0, y0] = points[index - 1] as Point;
        const [x1, y1] = points[index] as Point;
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.01);
        const piece = Math.hypot(x1 - x0, y1 - y0) / steps;
        for (let step = 0; step < steps; step += 1) {
            const f = (step + 0.5) / steps;
            const here = reliefAt(t, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
            if (here.kind !== KIND_NONE && here.height > grenze) sum += piece;
        }
    }
    return sum;
}

/**
 * Der kürzeste Weg um das Ende einer Wand: von (x0|y) über die beiden Ecken (links|oben) und (rechts|oben)
 * nach (x1|y). Mit `rand` um so viel größer: Das Raster sperrt eine Zelle, sobald Gelände darin höher liegt,
 * die Wand wächst also um bis zu eine halbe Zelle je Seite.
 */
function umDieWand(x0: number, x1: number, y: number, links: number, rechts: number, oben: number, rand = 0): number {
    const l = links - rand;
    const r = rechts + rand;
    const o = oben + rand;
    return Math.hypot(l - x0, o - y) + (r - l) + Math.hypot(x1 - r, o - y);
}

function flug(t: TerrainHeights, from: AirPoint, to: AirPoint, grenze = GRENZE): Point[] {
    const line = mountainAirFlight(airTerrain(t), grenze).way(from, to);
    if (!line) throw new Error("Der Flug findet immer einen Weg");
    expect(line[0]).toEqual([from.x, from.y]);
    expect(line[line.length - 1]).toEqual([to.x, to.y]);
    return line;
}

describe("Flug um die Gebirge", () => {
    // Eine Wand von 10 × 40 E in der Mitte.
    const wand = gebirge((x, y) => x >= 45 && x <= 55 && y >= 30 && y <= 70);

    it("🔴 ist die Luftlinie frei, bleibt es genau die Luftlinie wie in F1", () => {
        const a = punkt("a", 20, 20);
        const b = punkt("b", 80, 20);
        expect(chordAbove(wand, a, b, GRENZE)).toBe(false);
        expect(flug(wand, a, b)).toEqual(STRAIGHT_AIR_WAY(a, b));
        // Über die Wand, wenn die Höchstflughöhe darüber liegt.
        const c = punkt("c", 20, 50);
        const d = punkt("d", 80, 50);
        expect(flug(wand, c, d, 3000)).toEqual(STRAIGHT_AIR_WAY(c, d));
    });

    it("🔴 dieselbe Etappe prüft und sucht er je Anfrage nur einmal, wie Etappen und Seelinien (7928560)", () => {
        const flight = mountainAirFlight(airTerrain(wand), GRENZE);
        const c = punkt("c", 20, 50);
        const d = punkt("d", 80, 50);
        expect(flight.searches(c, d)).toBe(true);
        const hin = flight.way(c, d);
        // Gleiche Lage, andere Kennung (etwa ein Kartenpunkt auf dem Ort): dieselbe Linie, ohne neue Suche.
        expect(flight.way({ ...c, id: "p:20:50" }, d)).toBe(hin);
        // Der Rückweg ist eine eigene Etappe.
        expect(flight.way(d, c)).not.toBe(hin);
        expect(flight.searches(punkt("a", 20, 20), punkt("b", 80, 20))).toBe(false);
    });

    it("🔴 ohne Gelände fliegt er die Luftlinie", () => {
        expect(terrainAirFlight(null, 2200, 200)).toBe(STRAIGHT_FLIGHT);
        expect(terrainAirFlight(undefined, 2200, 200)).toBe(STRAIGHT_FLIGHT);
    });

    it("🔴 umfliegt eine Wand an ihrer Ecke: kaum länger als der kürzeste Weg, nie darüber, wenige Knicke", () => {
        const a = punkt("a", 20, 50);
        const b = punkt("b", 80, 50);
        const line = flug(wand, a, b);
        // Der kürzeste Weg führt über zwei Ecken der Wand; auf dem Raster ist sie um bis zu eine halbe Zelle größer.
        expect(länge(line)).toBeGreaterThan(umDieWand(20, 80, 50, 45, 55, 70));
        expect(länge(line)).toBeLessThan(umDieWand(20, 80, 50, 45, 55, 70, 0.5) * 1.005);
        expect(überDerGrenze(wand, line)).toBe(0);
        expect(line.length).toBeLessThanOrEqual(5);
        // Jedes Stück für sich hält die Grenze, auch gegen die feine Prüfung der Luftlinie.
        for (let index = 1; index < line.length; index += 1) {
            const [x0, y0] = line[index - 1] as Point;
            const [x1, y1] = line[index] as Point;
            expect(chordAbove(wand, { x: x0, y: y0 }, { x: x1, y: y1 }, GRENZE)).toBe(false);
        }
    });

    it("🔴 die gezeichnete Linie des Umwegs ist gerundet - jede Ecke, soweit sie frei bleibt - und schneidet nie ins Gebirge (Befund 2026-10-03)", () => {
        const a = punkt("a", 20, 50);
        const b = punkt("b", 80, 50);
        const flight = terrainAirFlight(wand, 2200, 200);
        const line = flight.way(a, b) as Point[];
        expect(line.length).toBeGreaterThan(2);
        const shown = flight.display?.(line) as Point[];
        // Der Befund: Die Linie blieb eckig (`display` gleich dem Weg), weil die Rundung im Ganzen geprüft wurde und
        // an den Ecken, die um die Wand straff gezogen sind, in sie schnitt.
        expect(shown.length).toBeGreaterThan(line.length * 4);
        expect(shown[0]).toEqual(line[0]);
        expect(shown[shown.length - 1]).toEqual(line[line.length - 1]);
        // Rund heißt: Kein Knick ist mehr spitzer als 45 Grad (die Ecken der Wand waren rechtwinklig).
        for (let index = 1; index + 1 < shown.length; index += 1) {
            const [x0, y0] = shown[index - 1] as Point;
            const [x1, y1] = shown[index] as Point;
            const [x2, y2] = shown[index + 1] as Point;
            const dot = (x1 - x0) * (x2 - x1) + (y1 - y0) * (y2 - y1);
            const lengths = Math.hypot(x1 - x0, y1 - y0) * Math.hypot(x2 - x1, y2 - y1);
            expect(dot / lengths).toBeGreaterThan(Math.cos(Math.PI / 4));
        }
        // Nie ins Gebirge: weder nach der feinen Abtastung noch Stück für Stück nach der Prüfung des Flugs.
        expect(überDerGrenze(wand, shown)).toBe(0);
        for (let index = 1; index < shown.length; index += 1) {
            const [x0, y0] = shown[index - 1] as Point;
            const [x1, y1] = shown[index] as Point;
            expect(chordAbove(wand, { x: x0, y: y0 }, { x: x1, y: y1 }, GRENZE)).toBe(false);
        }
    });

    it("sucht über das erste Fenster hinaus, wenn der Umweg länger ist als ein Viertel", () => {
        // Eine lange Mauer quer zur kurzen Luftlinie: Der Weg führt um ihr Ende, gut viermal so lang.
        const mauer = gebirge((x, y) => x >= 48 && x <= 52 && y >= 10 && y <= 90);
        const line = flug(mauer, punkt("a", 40, 50), punkt("b", 60, 50));
        expect(länge(line)).toBeGreaterThan(umDieWand(40, 60, 50, 48, 52, 90));
        expect(länge(line)).toBeLessThan(umDieWand(40, 60, 50, 48, 52, 90, 0.5) * 1.005);
        expect(überDerGrenze(mauer, line)).toBe(0);
    });

    it("🔴 F-E3 = B: Ein Wegpunkt im Gebirge verlässt es zum Ziel hin, wenn der nächste Rand einen langen Umweg brächte", () => {
        // Ein Riegel über die ganze Breite, 10 E tief. Der Start liegt 2 E vom Südrand, das Ziel im Norden: Nach
        // Süden hinaus müsste der Flug um das Ende des Riegels, nach Norden sind es 8 E über dem eigenen Gebirge.
        const riegel = gebirge((_x, y) => y >= 40 && y <= 50);
        const start = punkt("s", 50, 42);
        const ziel = punkt("z", 50, 70);
        for (const [von, nach] of [
            [start, ziel],
            [ziel, start],
        ] as const) {
            const line = flug(riegel, von, nach);
            expect(überDerGrenze(riegel, line)).toBeGreaterThan(7.8);
            expect(überDerGrenze(riegel, line)).toBeLessThan(8.8);
            expect(länge(line)).toBeLessThan(28.5);
            expect(Math.min(...line.map(([, y]) => y))).toBeGreaterThanOrEqual(42);
        }
    });

    it("🔴 F-E3 = B: den nächsten Rand, wenn der Weg zum Ziel dort kaum länger ist - das Gebirge zählt zehnfach", () => {
        // 3 E unter dem Nordrand der Wand, 5 E vom Westrand, das Ziel im Westen. Geradewegs wären es 5,1 E über dem
        // Gebirge (zehnfach 51) und 26 E frei; nach Norden 3 E (30) und gut 32 E frei um die Ecke.
        const start = punkt("s", 50, 67);
        const ziel = punkt("z", 20, 60);
        for (const [von, nach] of [
            [start, ziel],
            [ziel, start],
        ] as const) {
            const line = flug(wand, von, nach);
            const gesperrt = überDerGrenze(wand, line);
            expect(gesperrt).toBeGreaterThan(2.8);
            expect(gesperrt).toBeLessThan(3.5);
            // Der Knick am Gebirge liegt am Nordrand, nicht am Westrand.
            const knick = (von === start ? line[1] : line[line.length - 2]) as Point;
            expect(knick[1]).toBeGreaterThanOrEqual(70);
        }
    });

    it("🔴 ein Tal ringsum im Gebirge: kein Scheitern; der Ring zählt zehnfach, gequert wird, wo die Reise am kürzesten ist", () => {
        // Ein Ring um ein Tal bei (50|50): im Norden 2 E dick, sonst 6 E.
        const ring = gebirge(
            (x, y) => x >= 30 && x <= 70 && y >= 30 && y <= 70 && !(x > 36 && x < 64 && y > 36 && y < 68),
        );
        const tal = punkt("tal", 50, 50);
        // Von Süden quert er die dicke Südseite: Um den Ring herum zur dünnen Nordseite wäre es viel weiter.
        const süden = punkt("süden", 50, 5);
        for (const line of [flug(ring, süden, tal), flug(ring, tal, süden)]) {
            expect(überDerGrenze(ring, line)).toBeGreaterThan(5.9);
            expect(überDerGrenze(ring, line)).toBeLessThan(6.8);
            expect(Math.max(...line.map(([, y]) => y))).toBeLessThanOrEqual(50);
        }
        // Von Norden die dünne Nordseite.
        const norden = punkt("norden", 50, 95);
        for (const line of [flug(ring, norden, tal), flug(ring, tal, norden)]) {
            expect(überDerGrenze(ring, line)).toBeGreaterThan(1.9);
            expect(überDerGrenze(ring, line)).toBeLessThan(2.6);
        }
    });

    it("🔴 fremdes Gebirge bleibt praktisch unpassierbar, auch wenn der Flug aus dem eigenen kommt", () => {
        // Der Start liegt mitten in einem Block, das Ziel hinter einer schmalen, langen fremden Mauer: 2 E über ihr
        // wären kürzer als der Weg um ihr Ende, aber sie gehört keinem Wegpunkt.
        const block = (x: number, y: number): boolean => x >= 10 && x <= 30 && y >= 40 && y <= 60;
        const mauer = (x: number, y: number): boolean => x >= 50 && x <= 52 && y >= 5 && y <= 95;
        const beide = gebirge((x, y) => block(x, y) || mauer(x, y));
        const line = flug(beide, punkt("s", 20, 50), punkt("z", 80, 50));
        expect(überDerGrenze(gebirge(mauer), line)).toBe(0);
        // Aus dem eigenen Block hinaus: 10 E bis zum nächsten Rand.
        expect(überDerGrenze(gebirge(block), line)).toBeGreaterThan(9.8);
        expect(überDerGrenze(gebirge(block), line)).toBeLessThan(11);
        expect(Math.max(...line.map(([, y]) => y))).toBeGreaterThan(95);
    });

    it("zwei Wegpunkte im selben Gebirge: geradewegs, wenn Verlassen und Anfliegen mehr Sperre kosteten", () => {
        const massiv = gebirge((x, y) => x >= 20 && x <= 80 && y >= 20 && y <= 80);
        const a = punkt("a", 48, 50);
        const b = punkt("b", 52, 50);
        expect(flug(massiv, a, b)).toEqual([
            [48, 50],
            [52, 50],
        ]);
    });

    it("umfliegt einen freien Gipfel, wo sein Kegel über die Grenze reicht", () => {
        const gipfel = { x: 50, y: 50, h: 3000, radius: 3000 / (0.3 * 3000) };
        const t: TerrainHeights = {
            rasters: [],
            cones: [gipfel],
            rule,
            mu: calibrateRelief([], [gipfel], rule, model),
        };
        const a = punkt("a", 40, 50);
        const b = punkt("b", 60, 50);
        const line = flug(t, a, b);
        // Über 2.000 Schritt reicht der Kegel bis R · √(1 - ∛(2/3)), gut 1,2 E.
        expect(line.length).toBeGreaterThan(2);
        expect(überDerGrenze(t, line)).toBe(0);
        expect(länge(line)).toBeGreaterThan(20);
        expect(länge(line)).toBeLessThan(20.6);
        // Unter der Höchstflughöhe bleibt der Gipfel kein Hindernis.
        expect(flug(t, a, b, 3000)).toEqual(STRAIGHT_AIR_WAY(a, b));
    });

    it("unter einer Grenze unter null sperrt alles Gelände, aber nur Gelände", () => {
        // Eine Grenze unter null (Höchstflughöhe 10, Grenze -190): Das Produkt kennt sie seit 2026-10-04 nicht mehr,
        // die Suche aber muss sie aushalten.
        const line = flug(wand, punkt("a", 110, 20), punkt("b", 150, 20), -190);
        expect(line).toEqual([
            [110, 20],
            [150, 20],
        ]);
        // Über dem Raster (100 Schritt überall) ist jeder Punkt gesperrt: Der Weg führt geradewegs hinaus.
        const hinaus = flug(wand, punkt("c", 98, 50), punkt("d", 130, 50), -190);
        expect(überDerGrenze(wand, hinaus, -190)).toBeLessThan(2.5);
    });
});
