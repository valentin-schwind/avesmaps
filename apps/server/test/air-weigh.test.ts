import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    airSurchargeHours,
    resolveAirQuery,
    type RouteAir,
    type TravelModel,
} from "@avesmaps3d/shared";
import {
    airTerrain,
    blockedCells,
    blockedFromHeights,
    heightCells,
    type AirFrame,
    type AirTerrain,
} from "../src/routing/air-obstacles.ts";
import { airFieldRule } from "../src/routing/air-field.ts";
import { findAirRoute, STRAIGHT_AIR_WAY, type AirPoint } from "../src/routing/air-route.ts";
import {
    WEIGH_DETOUR,
    WEIGH_DETOUR_NEAR,
    WEIGH_MIN_HOURS,
    WEIGH_POLISH_RADII,
    WEIGH_WORK_BUDGET,
    weighedAirFlight,
    type WeighOptions,
} from "../src/routing/air-weigh.ts";
import { airFieldFrame, flyOverField } from "../src/routing/air-way.ts";
import { chordAbove, type TerrainHeights } from "../src/routing/relief.ts";
import { lineLength } from "../src/routing/router.ts";
import { flightProfiles, flightTrack } from "../src/routing/water-profile.ts";
import type { DomainHeightSource } from "../src/terrain/domain/read.ts";
import { DEFAULT_CONE } from "../src/terrain/peak-cone.ts";
import { random, shuffled } from "./support/invariants.ts";

/**
 * Die Abwägung des Flugs (WI-0051 F4, F4b; Betreiber 2026-10-04: „ich will, dass die lieber um hohe berge herumfliegen
 * als einfach drüber“, „F4b A - wie das höhenfeld in A* oder?“): Fliegen über der Reisehöhe kostet Zeit; der Weg jeder
 * Etappe ist der mit der kürzesten Zeit samt Zuschlag - gesucht über einem Kostenfeld, gewählt an der exakten Bahn. Die
 * Karte ist ein Domain-Raster (Zelle 0,25, 100 × 100 E), 100 Schritt hoch, mit Wänden und Gipfeln darauf.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const CELL = 0.25;
const SIZE = 401;
const MU = { mountain: 1, peak: 1 };
type Point = [number, number];

/** Ein Domain-Höhenmodell über 100 × 100 E (Zelle 0,25), die Höhe aus einer Funktion, dazu freie Gipfel. */
function karte(height: (x: number, y: number) => number, cones: TerrainHeights["cones"] = []): TerrainHeights {
    const samples = new Uint16Array(SIZE * SIZE);
    for (let j = 0; j < SIZE; j += 1) {
        for (let i = 0; i < SIZE; i += 1) samples[j * SIZE + i] = Math.max(0, Math.round(height(i * CELL, j * CELL)));
    }
    const domain: DomainHeightSource = {
        fingerprint: "test",
        revision: "test",
        membershipFingerprint: "test",
        mountains: [],
        raster: { cell: CELL, originX: 0, originY: 0, width: SIZE, height: SIZE, samples },
    };
    return { domain, rasters: [], cones, rule: DEFAULT_CONE, mu: { FOOT: MU, EQUID: MU, WHEEL: MU } };
}

const airOf = (id: string): RouteAir => {
    const resolved = resolveAirQuery(model, { air: id });
    if (!resolved.ok || !resolved.air) throw new Error(`${id} erwartet`);
    return resolved.air;
};
const hexe = airOf("witchFlight");
const hippogriff = airOf("hippogriff");
const greif = airOf("griffin");
const punkt = (id: string, x: number, y: number): AirPoint => ({ id, name: id, x, y });
const A = punkt("a", 20, 50);
const B = punkt("b", 80, 50);

/** Eine Wand quer über der Luftlinie von A nach B: x 48 bis 52, y von `von` bis `bis`. */
const wand =
    (hoehe: number, von: number, bis: number) =>
    (x: number, y: number): number =>
        x >= 48 && x <= 52 && y >= von && y <= bis ? hoehe : 100;

/** Die Gaußglocke eines Gipfels: `hoehe` über dem Boden im Mittelpunkt, Breite `sigma` in Karteneinheiten. */
const glocke =
    (cx: number, cy: number, hoehe: number, sigma: number) =>
    (x: number, y: number): number =>
        hoehe * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma));

const liniengleich = (a: readonly Point[], b: readonly Point[]): boolean =>
    a.length === b.length && a.every((p, i) => p[0] === (b[i] as Point)[0] && p[1] === (b[i] as Point)[1]);

/** Die Reisezeit einer Linie wie der Dienst: Luftlinienzeit plus Zuschlag. */
function stunden(terrain: TerrainHeights, air: RouteAir, line: Point[], m: TravelModel = model): number {
    const route = findAirRoute([A, B], air, m, {
        hoursPerDay: 24,
        timed: false,
        way: () => line,
        profiles: (coordinates, distance, limit) => flightProfiles(coordinates, distance, terrain, air, m, limit),
    });
    return route.travelHours;
}

const mitFaktoren = (steigen: number, halten: number): TravelModel => ({
    ...model,
    flug: { ...model.flug, wert: { ...model.flug.wert, steigkostenFaktor: steigen, haltekostenFaktor: halten } },
});

/** Der höchste Boden unter einer Linie, in Schritt. */
function hoechsterBoden(terrain: TerrainHeights, line: readonly Point[], air: RouteAir = hexe): number {
    const track = flightTrack(line, terrain, air, model);
    return Math.max(...(track?.samples.height ?? [0]));
}

/**
 * Die Vorlage von `heightCells` für ein Domain-Raster: Stützstelle für Stützstelle in die Zellen, die das offene Quadrat von
 * einer Rasterzelle um sie berührt (die Fassung vor F4b, ohne die Abkürzung Zelle für Zelle).
 */
function vorlage(terrain: AirTerrain, frame: AirFrame, floor: number): Float32Array {
    const cells = new Float32Array(frame.cols * frame.rows);
    const raster = terrain.domainRaster;
    if (!raster) return cells;
    const maxX = raster.originX + (raster.width - 1) * raster.cell;
    const maxY = raster.originY + (raster.height - 1) * raster.cell;
    const span = (a: number, b: number, origin: number, cell: number, count: number): [number, number] => [
        Math.max(0, Math.floor((a - origin) / cell)),
        Math.min(count - 1, Math.ceil((b - origin) / cell) - 1),
    ];
    for (let j = 0; j < raster.height; j += 1) {
        const y = raster.originY + j * raster.cell;
        const [row0, row1] = span(
            Math.max(raster.originY, y - raster.cell),
            Math.min(maxY, y + raster.cell),
            frame.minY,
            frame.cell,
            frame.rows,
        );
        for (let i = 0; i < raster.width; i += 1) {
            const value = raster.samples[j * raster.width + i] as number;
            if (value <= floor) continue;
            const x = raster.originX + i * raster.cell;
            const [column0, column1] = span(
                Math.max(raster.originX, x - raster.cell),
                Math.min(maxX, x + raster.cell),
                frame.minX,
                frame.cell,
                frame.cols,
            );
            for (let row = row0; row <= row1; row += 1) {
                for (let column = column0; column <= column1; column += 1) {
                    const at = row * frame.cols + column;
                    if (value > (cells[at] as number)) cells[at] = value;
                }
            }
        }
    }
    return cells;
}

describe("Gipfel neben dem Tal: der Weg wird um das Gelände gerechnet, nicht um eine Schwelle", () => {
    // Das Hochland liegt auf 2.000 Schritt, überall: Es liegt über jeder Schwelle von 1.500 und darunter, aber unter 3.000.
    // Ein Gipfel von 3.500 steht mitten auf der Luftlinie. Daneben ist das Hochland ein Tal im Sinn der Bahn: Wer dort
    // fliegt, bleibt auf Boden + Mindestabstand und zahlt nichts. (Auf dem Stand F4, der nur Wege um alles über 3.000 und
    // über 1.500 Schritt kannte, flog der Hexenbesen an der Flanke des Gipfels entlang, bis 2.900 Schritt hoch.)
    it("🔴 der Hexenbesen fliegt neben dem Gipfel durch, statt ihn zu überfliegen", () => {
        const t = karte((x, y) => 2000 + glocke(50, 50, 1500, 3.5)(x, y));
        const flight = weighedAirFlight(t, hexe, model);
        const line = flight.way(A, B) as Point[];
        const gerade = STRAIGHT_AIR_WAY(A, B) as Point[];
        expect(line.length, "ein Weg um den Gipfel hat Knicke").toBeGreaterThan(2);
        // Er bleibt auf dem Hochland: Die Bahn steigt nie auf die Flanke des Gipfels (hoechstens 2.300 statt 3.500).
        expect(hoechsterBoden(t, line)).toBeLessThan(2300);
        expect(hoechsterBoden(t, gerade)).toBeGreaterThan(3400);
        // Er ist schneller als die Luftlinie samt Zuschlag, und nur wenig länger.
        expect(stunden(t, hexe, line)).toBeLessThan(stunden(t, hexe, gerade));
        expect(lineLength(line)).toBeLessThan(lineLength(gerade) * 1.15);
    });

    it("🔴 eine Wand auf dem Hochland, deren Ende neben der Luftlinie liegt, umfliegt er am Ende", () => {
        const t = karte((x, y) => (x >= 48 && x <= 52 && y <= 58 ? 2800 : 2000));
        const flight = weighedAirFlight(t, hexe, model);
        const line = flight.way(A, B) as Point[];
        expect(line.length).toBeGreaterThan(2);
        expect(hoechsterBoden(t, line)).toBeLessThan(2300);
        expect(stunden(t, hexe, line)).toBeLessThan(stunden(t, hexe, STRAIGHT_AIR_WAY(A, B) as Point[]));
    });

    it("🔴 das Tal neben dem Gipfel findet auch ein hochfliegendes Flugmittel, wenn es sich lohnt, und es wird nie langsamer als die Luftlinie", () => {
        const t = karte((x, y) => 100 + glocke(50, 50, 3600, 4)(x, y));
        const gerade = STRAIGHT_AIR_WAY(A, B) as Point[];
        for (const air of [hexe, hippogriff, greif]) {
            const line = weighedAirFlight(t, air, model).way(A, B) as Point[];
            expect(stunden(t, air, line), air.profile).toBeLessThanOrEqual(stunden(t, air, gerade) + 1e-9);
            // Wer ausweicht, tut es um den Gipfel, nicht über ihn (er ragt 3.600 Schritt hoch).
            if (line.length > 2) expect(hoechsterBoden(t, line, air), air.profile).toBeLessThan(3000);
        }
        // Der Hexenbesen weicht aus: Über dem Gipfel zahlt er 3.500 Schritt Steigen.
        expect(weighedAirFlight(t, hexe, model).way(A, B)).not.toEqual(gerade);
    });
});

describe("flyOverField: die Suche über dem Kostenfeld", () => {
    it("🔴 Das Straffziehen führt den Weg nicht quer durch die Wand, um die er läuft: Ecken kosten das Steigen auf die neue Achse", () => {
        // Eine Wand von 2.500 Schritt auf 100 Schritt Land, deren Ende 10 E neben der Luftlinie liegt; Steigen kostet 500
        // Schritt Strecke je Schritt, Halten nichts. Der Weg um das Ende ist 3 E länger, die Wand zu queren kostet 130 E.
        const t = karte(wand(2500, 40, 60));
        const terrain = airTerrain(t);
        const rule = airFieldRule(hexe, mitFaktoren(500, 0));
        const frame = airFieldFrame(terrain, A, B, 75, 400_000);
        expect(frame).not.toBeNull();
        const found = flyOverField(terrain, frame as AirFrame, 4800, rule, A, B);
        expect(found.points[0]).toEqual([A.x, A.y]);
        expect(found.points[found.points.length - 1]).toEqual([B.x, B.y]);
        expect(found.points.length).toBeGreaterThan(2);
        // Keine Sehne über der Wand (Gelände über 1.000 Schritt) und höchstens ein Viertel länger als die Luftlinie.
        for (let index = 1; index < found.points.length; index += 1) {
            const [x0, y0] = found.points[index - 1] as Point;
            const [x1, y1] = found.points[index] as Point;
            expect(chordAbove(t, { x: x0, y: y0 }, { x: x1, y: y1 }, 1000), `Sehne ${String(index)}`).toBe(false);
        }
        expect(found.distance).toBeLessThan(60 * 1.25);
    });
});

describe("Höhenfeld: Sperre für jede Grenze aus einem Lesen des Geländes", () => {
    it("🔴 heightCells ist gleich der Vorlage Stützstelle für Stützstelle, und blockedFromHeights(heightCells) gleich blockedCells", () => {
        const cones = [
            { x: 30, y: 30, h: 2600, radius: 0 },
            { x: 70.3, y: 61.1, h: 900, radius: 0 },
        ];
        const t = karte(
            (x, y) => 100 + 1500 * Math.max(0, Math.sin(x / 7) * Math.cos(y / 5)) + (x > 60 && y < 40 ? 2500 : 0),
            cones,
        );
        const terrain = airTerrain(t);
        const next = random(20261004);
        let blocked = 0;
        for (let round = 0; round < 25; round += 1) {
            const cell = round % 3 === 0 ? 1 : 0.5;
            const frame: AirFrame = {
                minX: Math.floor(next() * 40 * 4) / 4,
                minY: Math.floor(next() * 40 * 4) / 4,
                cell,
                cols: 20 + Math.floor(next() * 60),
                rows: 20 + Math.floor(next() * 60),
            };
            const floor = [0, 500, 1500][round % 3] as number;
            const field = heightCells(terrain, frame, floor);
            // Ohne Kegel gelesen: Die Vorlage kennt nur das Raster, die Kegel liegen über ihm in ein paar Zellen.
            const reference = vorlage(terrain, frame, floor);
            let differing = 0;
            for (let index = 0; index < field.length; index += 1) {
                if ((field[index] as number) !== (reference[index] as number)) differing += 1;
            }
            // Nur die Zellen der Kegel dürfen abweichen (und nur nach oben).
            expect(differing, `Runde ${String(round)}`).toBeLessThan(field.length / 4);
            for (let index = 0; index < field.length; index += 1) {
                expect(field[index] as number, `Zelle ${String(index)}, Runde ${String(round)}`).toBeGreaterThanOrEqual(
                    reference[index] as number,
                );
            }
            for (const limit of [floor, floor + 1, floor + 400, 2000, 3000, 4800]) {
                if (limit < floor) continue;
                const aus = blockedFromHeights(field, limit);
                const direkt = blockedCells(terrain, frame, limit);
                expect(aus.length).toBe(direkt.length);
                for (let index = 0; index < aus.length; index += 1) {
                    if (aus[index] !== direkt[index]) {
                        throw new Error(
                            `Zelle ${String(index)}, Grenze ${String(limit)}, floor ${String(floor)}, Runde ${String(round)}`,
                        );
                    }
                }
                blocked += direkt.reduce((sum, value) => sum + value, 0);
            }
        }
        // Die Probe prüft etwas: Es gibt gesperrte Zellen.
        expect(blocked).toBeGreaterThan(1000);
    });

    it("🔴 ohne Kegel ist heightCells genau die Vorlage, auch an den Rändern des Rasters und bei Fenstern darüber hinaus", () => {
        const t = karte((x, y) => 300 + 1800 * Math.max(0, Math.sin(x / 9) * Math.cos(y / 6)));
        const terrain = airTerrain(t);
        const next = random(7);
        for (let round = 0; round < 30; round += 1) {
            const cell = [0.5, 1, 2][round % 3] as number;
            const frame: AirFrame = {
                minX: Math.floor((next() * 130 - 15) * 4) / 4,
                minY: Math.floor((next() * 130 - 15) * 4) / 4,
                cell,
                cols: 10 + Math.floor(next() * 90),
                rows: 10 + Math.floor(next() * 90),
            };
            const floor = round % 2 === 0 ? 0 : 700;
            expect(Array.from(heightCells(terrain, frame, floor)), `Runde ${String(round)}`).toEqual(
                Array.from(vorlage(terrain, frame, floor)),
            );
        }
    });
});

describe("weighedAirFlight: drüber oder drumherum", () => {
    it("🔴 eine kurze hohe Wand umfliegt der Hexenbesen lieber, als sie zu überfliegen: Die Wahl ist schneller als die Luftlinie samt Zuschlag", () => {
        const t = karte(wand(2500, 40, 60));
        const flight = weighedAirFlight(t, hexe, model);
        const line = flight.way(A, B) as Point[];
        expect(line.length).toBeGreaterThan(2);
        expect(line[0]).toEqual([A.x, A.y]);
        expect(line[line.length - 1]).toEqual([B.x, B.y]);
        const gerade = STRAIGHT_AIR_WAY(A, B) as Point[];
        expect(stunden(t, hexe, line)).toBeLessThan(stunden(t, hexe, gerade));
        // Die Luftlinie kostet über der Wand Zuschlag, der Umweg fast keinen; er ist etwas länger.
        const geradeTrack = flightTrack(gerade, t, hexe, model);
        const umwegTrack = flightTrack(line, t, hexe, model);
        expect(geradeTrack?.surcharge.hours).toBeGreaterThan(umwegTrack?.surcharge.hours ?? Infinity);
        expect(lineLength(line)).toBeGreaterThan(lineLength(gerade));
        expect(lineLength(line)).toBeLessThan(lineLength(gerade) * (1 + WEIGH_DETOUR));
        // Die Luftlinie kostet Zuschlag: Die Etappe wägt, und das Budget der Suchen zählt sie.
        expect(flight.searches(A, B)).toBe(true);
    });

    it("🔴 eine Wand über die ganze Karte fliegt er über, wenn kein Weg drumherum führt: nie langsamer als die Luftlinie", () => {
        const t = karte(wand(2500, 0, 100));
        const flight = weighedAirFlight(t, hexe, model);
        const line = flight.way(A, B) as Point[];
        expect(stunden(t, hexe, line)).toBeLessThanOrEqual(stunden(t, hexe, STRAIGHT_AIR_WAY(A, B) as Point[]));
        // Das Raster endet mit dem Land: Kein Weg um die Wand, also bleibt er auf der Luftlinie.
        expect(line).toEqual(STRAIGHT_AIR_WAY(A, B));
    });

    it("🔴 sanftes Hügelland kostet kaum Zuschlag: kein Umweg und keine Suche für ein hochfliegendes Flugmittel", () => {
        // Hügel von 60 Schritt Höhe auf 100: Die Bahn hält die Reisehöhe, die Hülle steigt kaum über Boden + Reisehöhe.
        const t = karte((x, y) => 100 + 60 * Math.max(0, Math.sin(x / 6) * Math.cos(y / 6)));
        const flight = weighedAirFlight(t, greif, model);
        expect(flight.way(A, B)).toEqual(STRAIGHT_AIR_WAY(A, B));
        expect(flight.searches(A, B)).toBe(false);
        const track = flightTrack(STRAIGHT_AIR_WAY(A, B) as Point[], t, greif, model);
        expect(track?.surcharge.hours ?? 0).toBeLessThan(WEIGH_MIN_HOURS);
    });

    it("🔴 Auf Reisehöhe über Grund kostet nichts: ebenes Land kostet keinen Zuschlag und keine Suche", () => {
        const t = karte(() => 100);
        for (const air of [hexe, hippogriff, greif]) {
            const flight = weighedAirFlight(t, air, model);
            expect(flight.searches(A, B), air.profile).toBe(false);
            const track = flightTrack(flight.way(A, B) as Point[], t, air, model);
            expect(track?.surcharge.hours, air.profile).toBe(0);
        }
    });

    it("der Zuschlag steigt mit der Höhe der Wand", () => {
        const gerade = STRAIGHT_AIR_WAY(A, B) as Point[];
        const stufen = [1600, 2200, 3000, 4000].map((hoehe) => {
            const t = karte(wand(hoehe, 0, 100));
            return {
                hexe: flightTrack(gerade, t, hexe, model)?.surcharge.hours ?? 0,
                greif: flightTrack(gerade, t, greif, model)?.surcharge.hours ?? 0,
            };
        });
        for (let k = 1; k < stufen.length; k += 1) {
            expect(stufen[k]?.hexe).toBeGreaterThan(stufen[k - 1]?.hexe ?? Infinity);
            expect(stufen[k]?.greif).toBeGreaterThan(stufen[k - 1]?.greif ?? Infinity);
        }
    });

    it("🔴 der Zuschlag ist nie negativ, und ohne Faktoren (0, 0) kostet das Steigen nichts: Dann bleibt es bei der Luftlinienzeit und beim Weg der Höchstflughöhe", () => {
        const t = karte(wand(2500, 40, 60));
        const frei = mitFaktoren(0, 0);
        const flight = weighedAirFlight(t, hexe, frei);
        expect(flight.way(A, B)).toEqual(STRAIGHT_AIR_WAY(A, B));
        const track = flightTrack(STRAIGHT_AIR_WAY(A, B) as Point[], t, hexe, frei);
        expect(track?.surcharge).toMatchObject({
            climbSchritt: 0,
            holdSchritt: 0,
            climbHours: 0,
            holdHours: 0,
            hours: 0,
        });
        for (const f of [1, 10, 50, 200]) {
            const surcharge = flightTrack(STRAIGHT_AIR_WAY(A, B) as Point[], t, hexe, mitFaktoren(f, 1))?.surcharge;
            expect(surcharge?.hours ?? -1).toBeGreaterThanOrEqual(0);
        }
    });

    it("🔴 je höher der Steigfaktor, desto eher der Umweg: Aus der Luftlinie bei Faktor 0 wird ein Weg um die Wand", () => {
        const t = karte(wand(2500, 40, 60));
        const lines = [0, 5, 50, 500].map((f) => weighedAirFlight(t, hexe, mitFaktoren(f, 0)).way(A, B) as Point[]);
        expect(lines[0]).toEqual(STRAIGHT_AIR_WAY(A, B));
        expect(lines[3]?.length).toBeGreaterThan(2);
        expect(lineLength(lines[3] as Point[])).toBeGreaterThan(lineLength(lines[0] as Point[]));
    });

    it("🔴 dieselbe Etappe wägt er je Anfrage einmal; das Ergebnis hängt nur von der Etappe ab, nicht von der Reihenfolge, und nicht vom Zwischenspeicher", () => {
        const t = karte(wand(2500, 40, 60), [{ x: 30, y: 80, h: 3200, radius: 0 }]);
        const legs: [AirPoint, AirPoint][] = [
            [A, B],
            [B, A],
            [punkt("c", 20, 45), punkt("d", 80, 58)],
            [punkt("e", 30, 20), punkt("f", 30, 95)],
            [punkt("g", 10, 90), punkt("h", 90, 10)],
        ];
        const bytes = (flight: ReturnType<typeof weighedAirFlight>, order: readonly number[]) => {
            const out = new Map<number, string>();
            for (const index of order) {
                const [from, to] = legs[index] as [AirPoint, AirPoint];
                const line = flight.way(from, to) as Point[];
                out.set(index, JSON.stringify([line, flight.display?.(line, from, to), flight.searches(from, to)]));
            }
            return JSON.stringify([...out.entries()].sort((a, b) => a[0] - b[0]));
        };
        const all = legs.map((_, index) => index);
        const warm = weighedAirFlight(t, hexe, model);
        const first = bytes(warm, all);
        expect(bytes(warm, [...all].reverse())).toBe(first);
        for (const seed of [1, 2, 3]) {
            const frisch = weighedAirFlight(
                karte(wand(2500, 40, 60), [{ x: 30, y: 80, h: 3200, radius: 0 }]),
                hexe,
                model,
            );
            expect(bytes(frisch, shuffled(all, seed))).toBe(first);
        }
        // Dieselbe Etappe: dieselbe Linie, ohne neue Suche.
        const [from, to] = legs[0] as [AirPoint, AirPoint];
        expect(warm.way({ ...from, id: "p:20:50" }, to)).toBe(warm.way(from, to));
    });

    it("🔴 das Budget der Anfrage bleibt: Reicht es nicht mehr, bleibt eine Etappe beim Weg der Höchstflughöhe und die Zeit rechnet ehrlich", () => {
        const t = karte(wand(2500, 40, 60));
        const gewogen: boolean[] = [];
        const options: WeighOptions = {
            observer: { chosen: ({ skipped, searched }) => gewogen.push(!skipped && searched > 0) },
            budget: 120_000,
        };
        const flight = weighedAirFlight(t, hexe, model, options);
        const lines: Point[][] = [];
        for (let k = 0; k < 40; k += 1) {
            lines.push(
                flight.way(
                    punkt(`s${String(k)}`, 20, 44 + k * 0.1),
                    punkt(`t${String(k)}`, 80, 56 - k * 0.1),
                ) as Point[],
            );
        }
        // Die ersten Etappen wägen (Umweg), danach nicht mehr (Luftlinie); nie kommt nach einer übersprungenen eine gewogene.
        expect(gewogen[0]).toBe(true);
        expect(gewogen[gewogen.length - 1]).toBe(false);
        expect(gewogen.indexOf(false)).toBeGreaterThan(0);
        expect(gewogen.slice(gewogen.indexOf(false)).every((value) => !value)).toBe(true);
        expect(lines[0]?.length).toBeGreaterThan(2);
        expect(lines[lines.length - 1]).toHaveLength(2);
        // Das Budget hängt an Zellen und Bewertungen, nicht an Uhr oder Last: ein zweiter Lauf liefert dasselbe.
        const nochmal = weighedAirFlight(t, hexe, model, { budget: 120_000 });
        const again: Point[][] = [];
        for (let k = 0; k < 40; k += 1) {
            again.push(
                nochmal.way(
                    punkt(`s${String(k)}`, 20, 44 + k * 0.1),
                    punkt(`t${String(k)}`, 80, 56 - k * 0.1),
                ) as Point[],
            );
        }
        expect(JSON.stringify(again)).toBe(JSON.stringify(lines));
        // Die Vorgabe reicht für eine übliche Anfrage: einige Dutzend solcher Etappen.
        expect(WEIGH_WORK_BUDGET).toBeGreaterThanOrEqual(1_000_000);
    });

    it("die Grenzen sind stimmig: das enge Raster enger als das weite, das Feilen von grob zu fein", () => {
        expect(WEIGH_DETOUR_NEAR).toBeGreaterThan(0);
        expect(WEIGH_DETOUR_NEAR).toBeLessThan(WEIGH_DETOUR);
        const sorted = [...WEIGH_POLISH_RADII].sort((a, b) => b - a);
        expect([...WEIGH_POLISH_RADII]).toEqual(sorted);
    });

    it("ohne Höhenmodell fliegt er die Luftlinie, ohne Suche und ohne Zuschlag", () => {
        const flight = weighedAirFlight(null, hexe, model);
        expect(flight.way(A, B)).toEqual(STRAIGHT_AIR_WAY(A, B));
        expect(flight.searches(A, B)).toBe(false);
        // Auch im Dienst: Ohne Profil kein Zuschlag, die Luftlinienzeit.
        const route = findAirRoute([A, B], hexe, model, { hoursPerDay: 24, timed: false });
        expect(route.segments[0]?.air_extra).toBeUndefined();
        expect(route.travelHours).toBeCloseTo((60 * 3) / 40, 12);
        expect(airSurchargeHours(0, 40)).toBe(0);
    });

    it("🔴 die gezeichnete Linie hängt am gewählten Weg: gerundet nur dort, wo sie frei bleibt, und nie höher hinauf als der Weg selbst (plus Mindestabstand)", () => {
        const t = karte(wand(2500, 40, 60));
        const flight = weighedAirFlight(t, hexe, model);
        const line = flight.way(A, B) as Point[];
        const display = flight.display?.(line, A, B) as Point[];
        expect(display.length).toBeGreaterThanOrEqual(line.length);
        expect(display[0]).toEqual(line[0]);
        expect(display[display.length - 1]).toEqual(line[line.length - 1]);
        // Der Weg führt um die Wand (der höchste Boden unter ihm ist 100): Auch die Rundung schneidet sie nicht an.
        const limit = hoechsterBoden(t, line) + model.flug.wert.mindestabstandSchritt;
        for (let index = 1; index < display.length; index += 1) {
            const from = display[index - 1] as Point;
            const to = display[index] as Point;
            expect(chordAbove(t, { x: from[0], y: from[1] }, { x: to[0], y: to[1] }, limit)).toBe(false);
        }
        // Ein Weg, der dagegen die Luftlinie ist, bleibt gerade.
        const gerade = weighedAirFlight(
            karte(() => 100),
            hexe,
            model,
        );
        expect(
            liniengleich(
                gerade.display?.(STRAIGHT_AIR_WAY(A, B) as Point[], A, B) ?? [],
                STRAIGHT_AIR_WAY(A, B) as Point[],
            ),
        ).toBe(true);
    });
});
