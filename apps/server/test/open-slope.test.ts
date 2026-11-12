import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, SLOPE_FAMILIES, type SlopeFamily } from "@avesmaps3d/shared";
import { offroadCost, offroadPathBetween } from "../src/routing/map-points.ts";
import { buildPlanes, type OffroadBox } from "../src/routing/offroad-grid.ts";
import { findPath, finishPath } from "../src/routing/offroad-search.ts";
import {
    calibrateOpen,
    chordTouchesRelief,
    groundWithRelief,
    KIND_MOUNTAIN,
    KIND_NONE,
    KIND_OPEN,
    KIND_PEAK,
    reliefAt,
    reliefPlane,
    reliefRules,
    reliefStepFactor,
    stepKind,
    terrainFromDomain,
    type TerrainHeights,
} from "../src/routing/relief.ts";
import { prepareGround } from "../src/routing/ground.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { NO_WATER } from "../src/routing/water.ts";
import type { DomainHeightSource } from "../src/terrain/domain/read.ts";

/**
 * Steigung querfeldein auch auf offenem Land (WI-0049 F5, Betreiber 2026-10-04: „A - schau ob du mit F4 kollidierst
 * oder was von F4 brauchen kannst“). Die Regel: außerhalb der Gebirgsflächen Faktor P / μ_offen mit der Familie des
 * Landmittels; μ_offen das längengewichtete Mittel von P über alle Schritte auf offenem Land. Der größere Faktor aus
 * Boden und Gelände gewinnt, wo kein Boden bremst, gilt P / μ_offen auch unter 1.
 *
 * Alle Fälle laufen auf einem kleinen erzeugten Domain-Raster (Zelle 0,25 E wie die Suche), gebaut wie in der Produktion
 * (`terrainFromDomain`).
 */

const model = AVENTURIA_TRAVEL_MODEL;
const CELL = 0.25;
const TEMPO = 3.45;
const zeit = offroadCost(model, { transport: "groupFoot", speed: TEMPO }, "fastest");

interface Fixture {
    size: number;
    height: (x: number, y: number) => number;
    /** Gebirgsfläche als Rechteck [minX, minY, maxX, maxY]; die Kanten liegen zwischen den Rasterpunkten. */
    mountain?: [number, number, number, number];
}

/** Das Domain-Raster: Punkte bei `CELL / 2 + k · CELL`, wie das gespeicherte (`loadDomainHeightSource`). */
function domainOf({ size, height, mountain }: Fixture): DomainHeightSource {
    const samples = new Uint16Array(size * size);
    for (let j = 0; j < size; j += 1) {
        for (let i = 0; i < size; i += 1) {
            samples[j * size + i] = Math.max(0, Math.round(height(CELL / 2 + i * CELL, CELL / 2 + j * CELL)));
        }
    }
    const mountains = mountain
        ? [
              {
                  minX: mountain[0],
                  minY: mountain[1],
                  maxX: mountain[2],
                  maxY: mountain[3],
                  geometry: {
                      type: "Polygon" as const,
                      coordinates: [
                          [
                              [mountain[0], mountain[1]],
                              [mountain[2], mountain[1]],
                              [mountain[2], mountain[3]],
                              [mountain[0], mountain[3]],
                              [mountain[0], mountain[1]],
                          ],
                      ],
                  },
              },
          ]
        : [];
    return {
        fingerprint: "open-slope",
        revision: "open-slope",
        membershipFingerprint: "open-slope",
        mountains,
        raster: { cell: CELL, originX: CELL / 2, originY: CELL / 2, width: size, height: size, samples },
    };
}

const terrainOf = (fixture: Fixture): TerrainHeights => terrainFromDomain(domainOf(fixture), model);

/** Dasselbe Gelände ohne die Eichung des offenen Landes: der Stand vor F5. */
function withoutOpen(terrain: TerrainHeights): TerrainHeights {
    const rest = { ...terrain };
    delete rest.muOpen;
    return rest;
}

/** Sanftes Hügelland: Wellen mit Hängen bis etwa 15 %, überall über 0. */
const rolling = (x: number, y: number): number =>
    420 + 220 * Math.sin(x * 0.9) * Math.cos(y * 0.7) + 120 * Math.sin(1.7 * x + 0.4 * y);

function boxOf(size: number): OffroadBox {
    const edge = size * CELL;
    return {
        minX: 0,
        minY: 0,
        maxX: edge,
        maxY: edge,
        cell: CELL,
        cols: size,
        rows: size,
        cellCount: size * size,
        coarsened: false,
    };
}

const heightsOf = (terrain: TerrainHeights, transport = "groupFoot") => ({ terrain, model, transport });

describe("Eichung des offenen Landes (μ_offen)", () => {
    it("🔴 genau das Mittel von P über alle Schritte außerhalb der Gebirge, unabhängig nachgerechnet", () => {
        // Gebirge in der Mitte und ein Meer (Höhe 0) im Süden: Beides zählt nicht.
        const fixture: Fixture = {
            size: 96,
            height: (x, y) => (y < 3 ? 0 : rolling(x, y) + (x > 12 && x < 18 ? 2500 : 0)),
            mountain: [12, 8, 18, 20],
        };
        const terrain = terrainOf(fixture);
        const domain = terrain.domain as DomainHeightSource;
        const { samples, width, height } = domain.raster;
        const inMountain = (i: number, j: number): boolean => {
            const x = CELL / 2 + i * CELL;
            const y = CELL / 2 + j * CELL;
            return x > 12 && x < 18 && y > 8 && y < 20;
        };
        for (const family of SLOPE_FAMILIES) {
            let weight = 0;
            let sum = 0;
            for (let j = 0; j < height; j += 1) {
                for (let i = 0; i < width; i += 1) {
                    const here = samples[j * width + i] as number;
                    if (here === 0 || inMountain(i, j)) continue;
                    for (let dj = -1; dj <= 1; dj += 1) {
                        for (let di = -1; di <= 1; di += 1) {
                            if (di === 0 && dj === 0) continue;
                            const ni = i + di;
                            const nj = j + dj;
                            if (ni < 0 || nj < 0 || ni >= width || nj >= height || inMountain(ni, nj)) continue;
                            const there = samples[nj * width + ni] as number;
                            if (there === 0) continue;
                            const run = CELL * Math.hypot(di, dj);
                            weight += run;
                            sum += run * reliefStepFactor(family, there - here, run, model);
                        }
                    }
                }
            }
            // Andere Reihenfolge der Summen (je Zelle statt je Höhenunterschied): gleich bis auf Rundung.
            expect(terrain.muOpen?.[family]).toBeCloseTo(sum / weight, 9);
        }
    });

    it("ein ebenes Raster hat μ = 1 für jede Familie; Hügel heben es über 1", () => {
        const flat = terrainOf({ size: 40, height: () => 500 });
        for (const family of SLOPE_FAMILIES) expect(flat.muOpen?.[family]).toBe(1);
        const hilly = terrainOf({ size: 40, height: rolling });
        for (const family of SLOPE_FAMILIES) expect(hilly.muOpen?.[family] as number).toBeGreaterThan(1);
    });

    it("das Gebirge und die Höhe 0 zählen nicht: ein steiles Gebirge ändert μ_offen nicht", () => {
        const plain = terrainOf({ size: 96, height: rolling });
        const withMountain = terrainOf({
            size: 96,
            // Dieselbe Landschaft, aber innerhalb der Fläche schroff: μ_offen sieht diese Zellen nicht.
            height: (x, y) =>
                x > 6 && x < 12 && y > 6 && y < 12 ? 3000 * Math.abs(Math.sin(x * 9 + y * 5)) : rolling(x, y),
            mountain: [6, 6, 12, 12],
        });
        const flatPart = terrainOf({ size: 96, height: rolling, mountain: [6, 6, 12, 12] });
        // Mit derselben Landschaft draußen: gleiches Mittel bis auf die fehlenden Schritte im Gebirge.
        for (const family of SLOPE_FAMILIES) {
            expect(
                Math.abs((withMountain.muOpen?.[family] as number) - (plain.muOpen?.[family] as number)),
            ).toBeLessThan(0.02);
            expect(withMountain.muOpen?.[family]).toBeCloseTo(flatPart.muOpen?.[family] as number, 12);
        }
    });

    it("Raster ohne Gebirge im Streifen und mit ihm geben dieselbe Zählung (Streifen über 128 Zeilen)", () => {
        // 300 Zeilen: mehrere Streifen der Zugehörigkeit; das Mittel hängt nicht an der Streifengrenze.
        const terrain = terrainOf({ size: 300, height: rolling, mountain: [10, 10, 30, 30] });
        const domain = terrain.domain as DomainHeightSource;
        const whole = calibrateOpen(
            [
                {
                    ...domain.raster,
                    membership: Uint8Array.from({ length: domain.raster.width * domain.raster.height }, (_, k) => {
                        const x = CELL / 2 + (k % domain.raster.width) * CELL;
                        const y = CELL / 2 + Math.floor(k / domain.raster.width) * CELL;
                        return x > 10 && x < 30 && y > 10 && y < 30 ? 1 : 0;
                    }),
                    maxX: 75,
                    maxY: 75,
                },
            ],
            model,
        );
        for (const family of SLOPE_FAMILIES) expect(whole[family]).toBeCloseTo(terrain.muOpen?.[family] as number, 12);
    });
});

describe("Die Art eines Schritts", () => {
    it("Gipfel vor Gebirge vor offenem Land vor nichts; reliefAt kennt offenes Land nicht", () => {
        expect(stepKind(KIND_OPEN, KIND_MOUNTAIN)).toBe(KIND_MOUNTAIN);
        expect(stepKind(KIND_MOUNTAIN, KIND_OPEN)).toBe(KIND_MOUNTAIN);
        expect(stepKind(KIND_NONE, KIND_OPEN)).toBe(KIND_OPEN);
        expect(stepKind(KIND_OPEN, KIND_NONE)).toBe(KIND_OPEN);
        expect(stepKind(KIND_PEAK, KIND_OPEN)).toBe(KIND_PEAK);
        expect(stepKind(KIND_NONE, KIND_NONE)).toBe(KIND_NONE);
        // Flug, Schneegrenze und Profile bleiben bei „kein Gebirge“, wie sie waren.
        const terrain = terrainOf({ size: 40, height: rolling });
        expect(reliefAt(terrain, 5, 5).kind).toBe(KIND_NONE);
    });

    it("🔴 der größere Faktor aus Boden und Gelände gewinnt; nur offenes Land ersetzt einen offenen Boden unter 1", () => {
        // Boden gewinnt gegen ein sanftes Gelände, Gelände gegen einen schwachen Boden.
        expect(groundWithRelief(1.5, KIND_OPEN, 0.93)).toBe(1.5);
        expect(groundWithRelief(1.5, KIND_OPEN, 2)).toBe(2);
        // Wo kein Boden bremst, gilt der Faktor des offenen Landes auch unter 1: Eine Ebene geht schneller als das Mittel.
        expect(groundWithRelief(1, KIND_OPEN, 0.93)).toBe(0.93);
        expect(groundWithRelief(1, KIND_OPEN, 1.4)).toBe(1.4);
        // Ohne Faktor (Höhe 0) bleibt der Boden.
        expect(groundWithRelief(1, KIND_OPEN, 0)).toBe(1);
        // Gebirge und Gipfel wirken nur, wo sie bremsen, wie vor F5.
        expect(groundWithRelief(1, KIND_PEAK, 0.8)).toBe(1);
        expect(groundWithRelief(1, KIND_MOUNTAIN, 0.8)).toBe(1);
        expect(groundWithRelief(1, KIND_MOUNTAIN, 3)).toBe(3);
    });
});

describe("Die Ebene der Suche", () => {
    it("offenes Land nur mit Eichung: Land mit Höhe wird offen, Meer (0) und Gebirge behalten ihre Art", () => {
        const fixture: Fixture = {
            size: 64,
            height: (x, y) => (y < 2 ? 0 : rolling(x, y)),
            mountain: [10, 6, 14, 12],
        };
        const terrain = terrainOf(fixture);
        const box = boxOf(64);
        const plane = reliefPlane(box, terrain, model, "groupFoot");
        if (!plane) throw new Error("Ebene erwartet");
        const at = (x: number, y: number): number =>
            plane.kind[Math.floor(y / CELL) * 64 + Math.floor(x / CELL)] as number;
        expect(at(4, 8)).toBe(KIND_OPEN);
        expect(at(12, 9)).toBe(KIND_MOUNTAIN);
        expect(at(4, 0.5)).toBe(KIND_NONE);
        // Ohne die Eichung (etwa ein Stand von vor F5) bleibt offenes Land ohne Art, wie vorher.
        const without = reliefPlane(box, withoutOpen(terrain), model, "groupFoot");
        if (!without) throw new Error("Ebene erwartet (Gebirge)");
        expect(without.kind[Math.floor(8 / CELL) * 64 + Math.floor(4 / CELL)]).toBe(KIND_NONE);
        expect(without.floor).toBe(1);
        // Ein Gelände ganz ohne Gebirge und ohne Eichung hat gar keine Ebene.
        expect(reliefPlane(box, withoutOpen(terrainOf({ size: 64, height: rolling })), model, "groupFoot")).toBeNull();
    });

    it.each(["groupFoot", "groupHorse", "lightRider", "caravan"])(
        "🔴 %s: Ebene unter dem Mittel, Hang darüber, im Mittel genau 1 - und nie unter der Untergrenze floor",
        (transport) => {
            const terrain = terrainOf({ size: 64, height: rolling });
            const box = boxOf(64);
            const plane = reliefPlane(box, terrain, model, transport);
            if (!plane) throw new Error("Ebene erwartet");
            const family: SlopeFamily = reliefRules(terrain, model, transport).open?.family as SlopeFamily;
            const mu = terrain.muOpen?.[family] as number;
            // Ohne Höhenunterschied genau 1 / μ, bergauf mehr, und floor ist der kleinste Wert.
            expect(plane.step(KIND_OPEN, 500, 500, CELL)).toBeCloseTo(1 / mu, 12);
            expect(plane.floor).toBeCloseTo(1 / mu, 12);
            expect(plane.step(KIND_OPEN, 500, 800, CELL)).toBeGreaterThan(1);
            // Jeder Schritt der Ebene (alle acht Nachbarn jeder Zelle, nach Länge gewogen): Mittel 1, Minimum floor.
            let weight = 0;
            let sum = 0;
            let least = Infinity;
            for (let row = 1; row < 63; row += 1) {
                for (let column = 1; column < 63; column += 1) {
                    const cell = row * 64 + column;
                    for (let dr = -1; dr <= 1; dr += 1) {
                        for (let dc = -1; dc <= 1; dc += 1) {
                            if (dr === 0 && dc === 0) continue;
                            const other = (row + dr) * 64 + column + dc;
                            const run = CELL * Math.hypot(dr, dc);
                            const factor = plane.step(
                                KIND_OPEN,
                                plane.height[cell] as number,
                                plane.height[other] as number,
                                run,
                            );
                            weight += run;
                            sum += run * factor;
                            least = Math.min(least, factor);
                        }
                    }
                }
            }
            expect(least).toBeGreaterThanOrEqual(plane.floor - 1e-12);
            // Die Ebene innen hat nahezu dieselben Schritte wie die Eichung (ohne den Rand des Rasters).
            expect(sum / weight).toBeGreaterThan(0.99);
            expect(sum / weight).toBeLessThan(1.01);
        },
    );

    it("Gebirge und Gipfel rechnen wie vor F5: dieselben Faktoren mit und ohne die Eichung des offenen Landes", () => {
        const terrain = terrainOf({ size: 64, height: rolling, mountain: [0, 0, 16, 16] });
        const box = boxOf(64);
        const withOpen = reliefPlane(box, terrain, model, "lightRider");
        const plain = reliefPlane(box, withoutOpen(terrain), model, "lightRider");
        if (!withOpen || !plain) throw new Error("Ebenen erwartet");
        for (const rise of [-400, -50, 0, 50, 400]) {
            expect(withOpen.step(KIND_MOUNTAIN, 500, 500 + rise, CELL)).toBe(
                plain.step(KIND_MOUNTAIN, 500, 500 + rise, CELL),
            );
        }
        expect(withOpen.step(KIND_PEAK, 500, 650, CELL)).toBe(plain.step(KIND_PEAK, 500, 650, CELL));
    });

    it("die Sehne weiß, ob sie offenes Land berührt: Land mit Höhe ja, nur Meer nicht, ohne Eichung wie vorher", () => {
        const terrain = terrainOf({ size: 64, height: (x, y) => (y < 4 ? 0 : rolling(x, y)) });
        expect(chordTouchesRelief(terrain, { x: 2, y: 8 }, { x: 14, y: 8 })).toBe(true);
        expect(chordTouchesRelief(terrain, { x: 2, y: 2 }, { x: 14, y: 2 })).toBe(false);
        expect(chordTouchesRelief(withoutOpen(terrain), { x: 2, y: 8 }, { x: 14, y: 8 })).toBe(false);
    });
});

describe("Der Gang auf offenem Land", () => {
    /** Ein Hügel von 1.500 Schritt mitten in einer Ebene auf 300 Schritt (32 E breit). */
    const hill = terrainOf({
        size: 128,
        height: (x, y) => 300 + 1500 * Math.exp(-((x - 16) ** 2 + (y - 16) ** 2) / (2 * 1.5 ** 2)),
    });
    const planes = (terrain: TerrainHeights | null, ground = prepareGround([])) =>
        buildPlanes(boxOf(128), NO_WATER, NO_RIVERS, { search: true }, ground, [], terrain ? heightsOf(terrain) : null);
    const von = { x: 3.5, y: 16 };
    const nach = { x: 28.5, y: 16 };

    it("🔴 die Suche geht um den Hang, und der Umweg ist unter der neuen Regel billiger als die Sehne", () => {
        const search = findPath(planes(hill), zeit, von, nach);
        if (!search) throw new Error("Weg erwartet");
        // Die Sehne läuft über den Gipfel.
        const chord = finishPath(
            planes(hill),
            zeit,
            [
                [von.x, von.y],
                [nach.x, nach.y],
            ],
            false,
        );
        expect(search.time).toBeLessThan(chord.time);
        expect(Math.max(...search.points.map(([, y]) => Math.abs(y - 16)))).toBeGreaterThan(1.5);
        // Ohne die Eichung des offenen Landes (Stand vor F5) läuft der Gang gerade über den Hügel.
        const before = findPath(planes(withoutOpen(hill)), zeit, von, nach);
        if (!before) throw new Error("Weg erwartet");
        expect(before.points).toHaveLength(2);
    });

    it("🔴 Ebene ohne Höhenunterschied: μ = 1, also genau wie ohne Gelände (Zeit und Weg)", () => {
        const flat = terrainOf({ size: 128, height: () => 500 });
        const withHeights = findPath(planes(flat), zeit, von, nach);
        const without = findPath(planes(null), zeit, von, nach);
        if (!withHeights || !without) throw new Error("Wege erwartet");
        expect(withHeights.time).toBeCloseTo(without.time, 9);
        expect(withHeights.points).toEqual(without.points);
        expect(withHeights.levelTime).toBeCloseTo(withHeights.time, 9);
    });

    it("🔴 eine Ebene in einem Hügelland bremst weniger als der Mittelwert, der Hang mehr: Mehrzeit nie negativ", () => {
        const terrain = terrainOf({ size: 128, height: rolling });
        const path = offroadPathBetween(
            { water: NO_WATER, rivers: NO_RIVERS, heights: heightsOf(terrain) },
            zeit,
            { x: 4, y: 10 },
            { x: 26, y: 22 },
        );
        if (!path || path.levelTime === undefined) throw new Error("Weg mit Bezugszeit erwartet");
        expect(path.time).toBeGreaterThanOrEqual(path.levelTime - 1e-9);
        // Die Bezugszeit selbst ist eine Ebene: Länge / Tempo × Faktor ≥ floor.
        const ramp = zeit.ramp(Math.hypot(22, 12));
        const plane = reliefPlane(boxOf(128), terrain, model, "groupFoot");
        expect(path.levelTime).toBeGreaterThanOrEqual((path.distance / TEMPO) * (plane?.floor ?? 1) * ramp - 1e-9);
    });

    it("🔴 der Boden gewinnt gegen ein Gelände, das weniger bremst: Wald (1,5) auf einer Ebene bleibt 1,5", () => {
        const flat = terrainOf({ size: 128, height: () => 500 });
        const wald = prepareGround([
            {
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [0, 0],
                            [32, 0],
                            [32, 32],
                            [0, 32],
                            [0, 0],
                        ],
                    ],
                },
                minX: 0,
                minY: 0,
                maxX: 32,
                maxY: 32,
                factor: 1.5,
            },
        ]);
        const gerade = [
            [4, 16],
            [28, 16],
        ] as [number, number][];
        const withHeights = finishPath(planes(flat, wald), zeit, gerade, false);
        const without = finishPath(planes(null, wald), zeit, gerade, false);
        expect(withHeights.time).toBeCloseTo(without.time, 9);
        // Und im hügeligen Wald wächst der Faktor nur dort, wo der Hang mehr bremst als der Wald.
        const waldHill = finishPath(planes(hill, wald), zeit, gerade, false);
        const waldFlat = finishPath(planes(null, wald), zeit, gerade, false);
        expect(waldHill.time).toBeGreaterThan(waldFlat.time);
    });

    it("unter „Kürzeste“ sucht der Gang ohne Gelände (gerade Sehne), die Zeit rechnet es mit", () => {
        const strecke = offroadCost(model, { transport: "groupFoot", speed: TEMPO }, "shortest");
        const world = { water: NO_WATER, rivers: NO_RIVERS, heights: heightsOf(hill) };
        const kurz = offroadPathBetween(world, strecke, von, nach);
        const flat = offroadPathBetween({ water: NO_WATER, rivers: NO_RIVERS }, strecke, von, nach);
        if (!kurz || !flat) throw new Error("Wege erwartet");
        expect(kurz.distance).toBeCloseTo(flat.distance, 9);
        expect(kurz.time).toBeGreaterThan(flat.time);
    });

    it("🔴 Gebirge bleibt, wie es war: eine Kiste ganz im Gebirge rechnet mit und ohne die Eichung des offenen Landes gleich", () => {
        const mountain = terrainOf({ size: 128, height: rolling, mountain: [0, 0, 32, 32] });
        const a = findPath(planes(mountain), zeit, { x: 4, y: 6 }, { x: 28, y: 24 });
        const b = findPath(planes(withoutOpen(mountain)), zeit, { x: 4, y: 6 }, { x: 28, y: 24 });
        if (!a || !b) throw new Error("Wege erwartet");
        expect(a.time).toBe(b.time);
        expect(a.points).toEqual(b.points);
    });
});
