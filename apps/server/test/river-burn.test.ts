import { describe, expect, it } from "vitest";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import {
    burnRivers,
    FLANK_GRADE,
    FLOOR_HALF_WIDTH,
    RISE_TOLERANCE,
    risingRivers,
    type RiverBurnInput,
} from "../src/terrain/river-burn.ts";
import { hashRiverInputs } from "../src/terrain/river-inputs.ts";
import { orientRivers, type RiverLake, type RiverRow } from "../src/terrain/river-network.ts";

/**
 * Flüsse ins Höhenmodell einbrennen (WI-0049 S6): Das Bett fällt in Fließrichtung, Riegel werden
 * durchbrochen, Flanken mit 30 %, über Rastergrenzen und Seen hinweg. Alles an erfundenen Rastern.
 */

const CELL = 0.25;
const FLANK = FLANK_GRADE * 3000;

/** Ein Raster von `w` × `h` Zellen ab (`x0`, `y0`), Höhe aus `f` (Zeile 0 im Süden). */
function raster(x0: number, y0: number, w: number, h: number, f: (x: number, y: number) => number): StoredRaster {
    const samples = new Uint16Array(w * h);
    for (let j = 0; j < h; j += 1) {
        for (let i = 0; i < w; i += 1) samples[j * w + i] = Math.max(0, Math.round(f(x0 + i * CELL, y0 + j * CELL)));
    }
    return { cell: CELL, originX: x0, originY: y0, width: w, height: h, samples };
}

/** Bilinear wie Routing und Kacheln, Maximum über die Raster, sonst 0. */
function heightAt(rasters: readonly StoredRaster[], x: number, y: number): number {
    let best = 0;
    for (const r of rasters) {
        const fx = (x - r.originX) / r.cell;
        const fy = (y - r.originY) / r.cell;
        if (fx < 0 || fy < 0 || fx > r.width - 1 || fy > r.height - 1) continue;
        const i = Math.min(Math.floor(fx), r.width - 2);
        const j = Math.min(Math.floor(fy), r.height - 2);
        const tx = fx - i;
        const ty = fy - j;
        const s = r.samples;
        const v =
            (s[j * r.width + i] as number) * (1 - tx) * (1 - ty) +
            (s[j * r.width + i + 1] as number) * tx * (1 - ty) +
            (s[(j + 1) * r.width + i] as number) * (1 - tx) * ty +
            (s[(j + 1) * r.width + i + 1] as number) * tx * ty;
        best = Math.max(best, v);
    }
    return best;
}

/** Die Höhen entlang einer Linie in Fließrichtung, alle 0,02 E. */
function profile(rasters: readonly StoredRaster[], line: [number, number][]): number[] {
    const heights: number[] = [];
    for (let k = 1; k < line.length; k += 1) {
        const [x0, y0] = line[k - 1] as [number, number];
        const [x1, y1] = line[k] as [number, number];
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.02);
        for (let s = k === 1 ? 0 : 1; s <= steps; s += 1) {
            heights.push(heightAt(rasters, x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps));
        }
    }
    return heights;
}

/** Das Höchste, um das eine Stelle über einer früheren liegt. */
function worstRise(heights: readonly number[]): number {
    let low = Infinity;
    let worst = 0;
    for (const h of heights) {
        worst = Math.max(worst, h - low);
        low = Math.min(low, h);
    }
    return worst;
}

const river = (
    id: string,
    coordinates: [number, number][],
    direction: RiverRow["direction"] = "forward",
    coast: RiverRow["coast"] = null,
): RiverRow => ({ id, name: `Fluss ${id}`, bach: false, direction, coordinates, coast });

const input = (rivers: RiverRow[], lakes: RiverLake[] = []): RiverBurnInput => ({ rivers, lakes });

/** Ein Tal von West nach Ost, 1.000 → 800 Schritt, mit Buckeln von ±150 im Talgrund; Hänge 30 %/E. */
function bumpyValley(): StoredRaster {
    return raster(0, 0, 41, 41, (x, y) => 1000 - 20 * x + 150 * Math.sin(x * 3) + 600 * Math.abs(y - 5));
}

describe("Bett in Fließrichtung", () => {
    it("does not classify floating-point interpolation noise at the one-Schritt boundary as unresolved", () => {
        const rasters = [raster(0.125, 0.125, 16, 16, (x) => (x < 1.25 ? 2 : 3))];
        for (const y of [0.3, 0.71, 0.9]) {
            const rows = input([
                river("rounding", [
                    [0.2, y],
                    [3.5, y + 0.37],
                ]),
            ]);
            expect(risingRivers(rasters, rows).rising).toEqual([]);
        }
        const higher = [raster(0.125, 0.125, 16, 16, (x) => (x < 1.25 ? 2 : 4))];
        expect(
            risingRivers(
                higher,
                input([
                    river("real-rise", [
                        [0.2, 0.3],
                        [3.5, 0.67],
                    ]),
                ]),
            ).rising.length,
        ).toBe(1);
    });

    it("fällt, wenn die Geometrie in Fließrichtung liegt", () => {
        const rasters = [bumpyValley()];
        const line: [number, number][] = [
            [1, 5],
            [9, 5],
        ];
        expect(worstRise(profile(rasters, line))).toBeGreaterThan(100);
        const report = burnRivers(rasters, input([river("1", line)]));
        expect(report.rasters.risingBefore).toBe(1);
        expect(report.rasters.risingAfter).toBe(0);
        expect(report.tiles.risingAfter).toBe(0);
        expect(worstRise(profile(rasters, line))).toBeLessThanOrEqual(RISE_TOLERANCE + 0.5);
    });

    it("fällt ebenso, wenn die Geometrie gegen die Fließrichtung liegt (reverse)", () => {
        const forward = [bumpyValley()];
        const backward = [bumpyValley()];
        burnRivers(
            forward,
            input([
                river(
                    "1",
                    [
                        [1, 5],
                        [9, 5],
                    ],
                    "forward",
                ),
            ]),
        );
        burnRivers(
            backward,
            input([
                river(
                    "1",
                    [
                        [9, 5],
                        [1, 5],
                    ],
                    "reverse",
                ),
            ]),
        );
        expect(Array.from(backward[0]?.samples ?? [])).toEqual(Array.from(forward[0]?.samples ?? []));
        expect(
            risingRivers(
                backward,
                input([
                    river(
                        "1",
                        [
                            [9, 5],
                            [1, 5],
                        ],
                        "reverse",
                    ),
                ]),
            ).rising,
        ).toEqual([]);
    });

    it("bricht einen Riegel durch, statt oberhalb aufzufüllen", () => {
        // Talgrund 1.000 → 800, bei x = 5 quer ein Riegel von 500 Schritt.
        const f = (x: number, y: number): number =>
            1000 - 25 * x + 500 * Math.max(0, 1 - Math.abs(x - 5) / 0.75) + 300 * Math.abs(y - 5);
        const rasters = [raster(0, 0, 41, 41, f)];
        const before = Uint16Array.from(rasters[0]?.samples ?? []);
        burnRivers(
            rasters,
            input([
                river("1", [
                    [1, 5],
                    [9, 5],
                ]),
            ]),
        );
        const upstream = heightAt(rasters, 3.9, 5);
        expect(heightAt(rasters, 5, 5)).toBeLessThanOrEqual(upstream + RISE_TOLERANCE);
        // Flussauf nichts angehoben, der Riegel abseits des Flusses steht noch.
        const after = rasters[0]?.samples ?? new Uint16Array();
        expect(after.every((value, k) => value <= (before[k] as number))).toBe(true);
        expect(heightAt(rasters, 5, 8)).toBeCloseTo(f(5, 8), -1);
    });
});

describe("Flanken", () => {
    it("uses a wide smooth domain valley without changing the downstream bed postcondition", () => {
        const rasters = [raster(0, 0, 81, 81, (x) => (x < 2 ? 500 : 2000))];
        const rivers = input([
            river("1", [
                [1, 10],
                [19, 10],
            ]),
        ]);
        const report = burnRivers(rasters, rivers, { riverValley: { flankGrade: 0.1 } });
        expect(report.converged).toBe(true);
        expect(report.unresolved).toEqual([]);
        expect(risingRivers(rasters, rivers).rising).toEqual([]);
        expect(heightAt(rasters, 10, 10)).toBeLessThanOrEqual(500 + RISE_TOLERANCE);
        expect(heightAt(rasters, 10, 14)).toBeLessThan(1300);
        expect(heightAt(rasters, 10, 18)).toBe(2000);
    });

    it("ein Tal unter einem hohen Massiv bleibt schmal, das Massiv daneben steht (WI-0249, nur Fassung 19)", () => {
        // Ein Massiv von 3.000 Schritt; der Fluss kommt aus einer Senke von 500 (x < 2) und schneidet 2.500 tief hindurch.
        const massiv = (x: number): number => (x < 2 ? 500 : 3000);
        const line: [number, number][] = [
            [1, 10],
            [19, 10],
        ];
        const breit = [raster(0, 0, 81, 81, massiv)];
        burnRivers(breit, input([river("1", line)]), { riverValley: { flankGrade: 0.1 } });
        const gebirge = { grade: 0.7, from: 1500, to: 3000 };
        const schmal = [raster(0, 0, 81, 81, massiv)];
        const report = burnRivers(schmal, input([river("1", line)]), { riverValley: { flankGrade: 0.1, gebirge } });
        expect(report.converged).toBe(true);
        expect(report.unresolved).toEqual([]);
        expect(risingRivers(schmal, input([river("1", line)])).rising).toEqual([]);
        // Das Bett ist dasselbe; nur die Flanke ist schmaler.
        expect(heightAt(schmal, 10, 10)).toBeLessThanOrEqual(500 + RISE_TOLERANCE);
        expect(heightAt(breit, 10, 10)).toBeLessThanOrEqual(500 + RISE_TOLERANCE);
        // Heute reicht das Tal 12,75 E weit (Flanke 0,1): 4 E neben dem Fluss fehlen über 1.000 Schritt.
        expect(heightAt(breit, 10, 14)).toBeLessThan(2000);
        // Im Gebirge reicht es 0,25 + 1,5 · 2.500 / (3.000 · 0,7) = 2,04 E: Daneben steht das Massiv unverändert.
        expect(heightAt(schmal, 10, 12.25)).toBe(3000);
        expect(heightAt(schmal, 10, 14)).toBe(3000);
        expect(heightAt(schmal, 10, 11)).toBeGreaterThan(500);
        expect(heightAt(schmal, 10, 11)).toBeLessThan(3000);
        // Steil, aber weich: quer zum Fluss nie steiler als die Steilheit des Gebirges (0,7 · 3.000 Schritt je E), dazu Rundung.
        let steilste = 0;
        for (let y = 10; y < 13; y += 0.05)
            steilste = Math.max(steilste, (heightAt(schmal, 10, y + 0.05) - heightAt(schmal, 10, y)) / 0.05);
        expect(steilste).toBeGreaterThan(1500);
        expect(steilste).toBeLessThanOrEqual(0.7 * 3000 * 1.05);
    });

    it("in Land unter der Hochgebirgsgrenze bleibt die Talform Zeichen für Zeichen wie zuvor (WI-0249)", () => {
        const flach = (x: number, y: number): number => (x < 2 ? 200 : 1400 - 10 * Math.abs(y - 10));
        const line: [number, number][] = [
            [1, 10],
            [19, 10],
        ];
        const ohne = [raster(0, 0, 81, 81, flach)];
        burnRivers(ohne, input([river("1", line)]), { riverValley: { flankGrade: 0.1 } });
        const mit = [raster(0, 0, 81, 81, flach)];
        burnRivers(mit, input([river("1", line)]), {
            riverValley: { flankGrade: 0.1, gebirge: { grade: 0.7, from: 1500, to: 3000 } },
        });
        expect(Array.from(mit[0]!.samples)).toEqual(Array.from(ohne[0]!.samples));
    });

    it("steigen vom Bett mit 30 %, ein tieferer Einschnitt wird breiter", () => {
        // Eine Hochfläche von 2.000 Schritt; der Fluss kommt aus einer Senke von 500 (x < 2).
        const deep = [raster(0, 0, 41, 41, (x) => (x < 2 ? 500 : 2000))];
        burnRivers(
            deep,
            input([
                river("1", [
                    [1, 5],
                    [9, 5],
                ]),
            ]),
        );
        expect(heightAt(deep, 6, 5)).toBeLessThanOrEqual(500 + RISE_TOLERANCE);
        expect(heightAt(deep, 6, 6)).toBeCloseTo(500 + (1 - FLOOR_HALF_WIDTH) * FLANK, -1);
        expect(heightAt(deep, 6, 7.5)).toBe(2000);

        // Aus 1.500 statt 500: dieselbe Flanke, aber schmaler (bei 1 E schon wieder die Hochfläche).
        const shallow = [raster(0, 0, 41, 41, (x) => (x < 2 ? 1500 : 2000))];
        burnRivers(
            shallow,
            input([
                river("1", [
                    [1, 5],
                    [9, 5],
                ]),
            ]),
        );
        expect(heightAt(shallow, 6, 5.5)).toBeCloseTo(1500 + (0.5 - FLOOR_HALF_WIDTH) * FLANK, -1);
        expect(heightAt(shallow, 6, 6)).toBe(2000);
    });
});

describe("unbekannte Richtung", () => {
    const flat = (): number => 0;
    it("(a) erbt sie, wenn Ende auf Anfang trifft", () => {
        const rows = [
            river("a", [
                [0, 0],
                [1, 0],
            ]),
            river(
                "x",
                [
                    [1, 0],
                    [2, 0],
                ],
                null,
            ),
            river(
                "y",
                [
                    [3, 0],
                    [2, 0],
                ],
                null,
            ),
            river("b", [
                [3, 0],
                [4, 0],
            ]),
        ];
        const result = orientRivers(rows, flat);
        expect(result[1]).toEqual({ reversed: false, how: "geerbt" });
        // y liegt gegen die Kette: Sie erbt „rückwärts“, denn b beginnt an ihrem Anfang.
        expect(result[2]).toEqual({ reversed: true, how: "geerbt" });
    });

    it("(b) fließt sonst von der höheren zur tieferen Stelle, (c) bei Gleichstand zur Küste", () => {
        const height = (x: number): number => (x < 0.5 ? 1000 : 500);
        expect(
            orientRivers(
                [
                    river(
                        "u",
                        [
                            [1, 0],
                            [0, 0],
                        ],
                        null,
                    ),
                ],
                height,
            )[0],
        ).toEqual({
            reversed: true,
            how: "gelaende",
        });
        expect(
            orientRivers(
                [
                    river(
                        "k",
                        [
                            [0, 0],
                            [1, 0],
                        ],
                        null,
                        [5, 1],
                    ),
                ],
                flat,
            )[0],
        ).toEqual({
            reversed: false,
            how: "kueste",
        });
        expect(
            orientRivers(
                [
                    river(
                        "k",
                        [
                            [0, 0],
                            [1, 0],
                        ],
                        null,
                        [1, 5],
                    ),
                ],
                flat,
            )[0],
        ).toEqual({
            reversed: true,
            how: "kueste",
        });
    });
});

describe("über Rastergrenzen", () => {
    it("trägt das Bett durch eine flache Lücke ins nächste Gebirge", () => {
        const west = raster(0, 0, 17, 41, () => 1000);
        const east = raster(6, 0, 17, 41, () => 1500);
        const rasters = [west, east];
        const report = burnRivers(
            rasters,
            input([
                river("1", [
                    [1, 5],
                    [9, 5],
                ]),
            ]),
        );
        // In der Lücke (x 4 bis 6) ist das Gelände 0; im Osten darf der Fluss nicht wieder steigen.
        expect(
            Math.max(
                ...profile(rasters, [
                    [6.5, 5],
                    [9, 5],
                ]),
            ),
        ).toBeLessThanOrEqual(RISE_TOLERANCE);
        expect(report.deepCuts.map((entry) => entry.id)).toEqual(["1"]);
        expect(heightAt(rasters, 8, 8)).toBe(1500);
    });
});

describe("Seen", () => {
    // Ein Hochtal auf 1.500, darin ein See; der Zufluss kommt aus einer Senke von 800.
    const lake: RiverLake = {
        id: "see",
        name: "Bergsee",
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [4, 4],
                    [6, 4],
                    [6, 6],
                    [4, 6],
                    [4, 4],
                ],
            ],
        },
    };
    const dry: RiverLake = {
        id: "trocken",
        name: "See ohne Fluss",
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [2, 8],
                    [3, 8],
                    [3, 9],
                    [2, 9],
                    [2, 8],
                ],
            ],
        },
    };

    it("liegt auf dem Bett, ein tieferer Zufluss zieht ihn herab und alles flussab folgt", () => {
        const rasters = [raster(0, 0, 41, 41, (x) => (x < 2 ? 800 : 1500))];
        const rows = [
            river("zu", [
                [1, 5],
                [4, 5],
            ]),
            river("ab", [
                [6, 5],
                [9, 5],
            ]),
        ];
        const report = burnRivers(rasters, input(rows, [lake, dry]));
        expect(heightAt(rasters, 5, 5)).toBeLessThanOrEqual(800 + RISE_TOLERANCE);
        expect(
            Math.max(
                ...profile(rasters, [
                    [6, 5],
                    [9, 5],
                ]),
            ),
        ).toBeLessThanOrEqual(800 + RISE_TOLERANCE);
        expect(report.lakes.map((entry) => entry.id)).toEqual(["see"]);
        expect(report.lakes[0]?.lowered).toBeGreaterThan(650);
        // Ein See ohne Fluss bleibt, wie er ist.
        expect(heightAt(rasters, 2.5, 8.5)).toBe(1500);
    });

    it("feste Seen (Domain): Ein Zufluss aus tieferem Gelände zieht den Spiegel nicht herab, der Anstieg bleibt Befund", () => {
        const rasters = [raster(0, 0, 41, 41, (x) => (x < 2 ? 800 : 1500))];
        // Die Zellen des Sees (Mitten in 4..6 E) sind gesperrt, wie es `fixedLakeBurn` für die Domain tut.
        const protectedCells = new Set<number>();
        for (let j = 0; j < 41; j += 1)
            for (let i = 0; i < 41; i += 1)
                if (i * CELL > 4 && i * CELL < 6 && j * CELL > 4 && j * CELL < 6) protectedCells.add(j * 41 + i);
        const rows = [
            river("zu", [
                [1, 5],
                [4, 5],
            ]),
            river("ab", [
                [6, 5],
                [9, 5],
            ]),
        ];
        const fixed = { lakes: "fixed" as const, protectedCells };
        const report = burnRivers(rasters, input(rows, [lake, dry]), fixed);
        // Der See bleibt, wo er ist; der Abfluss beginnt auf ihm; in die Senke wird nicht tiefer geschnitten als der Spiegel.
        expect(heightAt(rasters, 5, 5)).toBe(1500);
        expect(report.lakes[0]?.level).toBe(1500);
        expect(report.lakes[0]?.lowered).toBe(0);
        expect(
            Math.max(
                ...profile(rasters, [
                    [6, 5],
                    [9, 5],
                ]),
            ),
        ).toBeLessThanOrEqual(1500 + RISE_TOLERANCE);
        expect(heightAt(rasters, 3, 5)).toBeGreaterThan(1500 - RISE_TOLERANCE - 1);
        // Der Zufluss steigt von 800 zum See: das ist ein Befund mit seiner Zahl, kein Absenken des Sees.
        const rising = risingRivers(rasters, input(rows, [lake, dry]), fixed).rising;
        expect(rising.map((entry) => entry.id)).toEqual(["zu"]);
        expect(rising[0]?.value).toBeGreaterThan(600);
        expect(report.unresolved.map((entry) => entry.id)).toEqual(["zu"]);
    });

    it("feste Seen: Der tiefste Zufluss an der Mündung senkt den See, ein tiefes Bett weiter flussauf nicht", () => {
        const setup = (reach: number) => {
            const rasters = [raster(0, 0, 41, 41, (x) => (x < 2 ? 800 : 1500))];
            const protectedCells = new Set<number>();
            for (let j = 0; j < 41; j += 1)
                for (let i = 0; i < 41; i += 1)
                    if (i * CELL > 4 && i * CELL < 6 && j * CELL > 4 && j * CELL < 6) protectedCells.add(j * 41 + i);
            const rows = [
                river("zu", [
                    [1, 5],
                    [4, 5],
                ]),
            ];
            const report = burnRivers(rasters, input(rows, [lake]), {
                lakes: "fixed",
                protectedCells,
                lakePull: { reach },
            });
            return { level: heightAt(rasters, 5, 5), report };
        };
        // Die Senke von 800 liegt 2 bis 3 E vor der Mündung (x < 2, Mündung bei x = 4).
        expect(setup(1).level).toBe(1500);
        expect(setup(1).report.lakes[0]?.level).toBe(1500);
        // Reicht der Zufluss bis dorthin, bestimmt sein tiefstes Gelände den See.
        const pulled = setup(3);
        expect(pulled.level).toBeLessThanOrEqual(800 + RISE_TOLERANCE);
        expect(pulled.level).toBeGreaterThanOrEqual(700);
        expect(pulled.report.lakes[0]?.lowered).toBeGreaterThan(600);
    });

    it("ohne tieferen Zufluss bleibt der Spiegel, der Abfluss beginnt auf ihm", () => {
        const rasters = [raster(0, 0, 41, 41, (x, y) => (x >= 4 && x <= 6 && y >= 4 && y <= 6 ? 1200 : 1500))];
        burnRivers(
            rasters,
            input(
                [
                    river("zu", [
                        [1, 5],
                        [4, 5],
                    ]),
                    river("ab", [
                        [6, 5],
                        [9, 5],
                    ]),
                ],
                [lake],
            ),
        );
        expect(heightAt(rasters, 5, 5)).toBe(1200);
        expect(
            Math.max(
                ...profile(rasters, [
                    [6.1, 5],
                    [9, 5],
                ]),
            ),
        ).toBeLessThanOrEqual(1200 + RISE_TOLERANCE);
    });
});

/**
 * Der Einlauf fester Seen (WI-0249 P7; nur Fassung 19, `generator.lakes.inletDepth`). Lauf T16 (Trollzacken): Der Bach in den Blutsee lag
 * 6 bis 7 E vor der Mündung bis 38 Schritt unter dem Spiegel, dahinter bis zum See eine Strecke genau auf dem Spiegel. Hier dasselbe im
 * Kleinen: ein See auf 1.000 (Zellen 4 bis 6 E, gesperrt wie in der Domain), der Zufluss fällt von 1.300 auf den Spiegel und läuft
 * in einer Rinne (|y − 5| ≤ 0,3 E, Ufer höher) zum See; darin eine Mulde. Neben dem See ein tieferes Tal (900) ohne Zufluss.
 */
describe("Einlauf fester Seen (WI-0249 P7)", () => {
    const lake: RiverLake = {
        id: "see",
        name: "Blutsee",
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [4, 4],
                    [6, 4],
                    [6, 6],
                    [4, 6],
                    [4, 4],
                ],
            ],
        },
    };
    const rows = [
        river("zu", [
            [0.5, 5],
            [4, 5],
        ]),
    ];
    const LEVEL = 1000;
    /** Die Mulde liegt von `from` bis `to` (E) um `depth` unter dem Spiegel. */
    function setup(mulde: { from: number; to: number; depth: number }): StoredRaster[] {
        return [
            raster(0, 0, 41, 41, (x, y) => {
                if (x >= 4 && x <= 6 && y >= 4 && y <= 6) return LEVEL;
                // Das tiefere Tal neben dem See: 0,5 E südlich des Ufers, kein Fluss.
                if (x >= 4.25 && x <= 5.75 && y >= 3 && y <= 3.5) return 900;
                const sohle =
                    x < 1.5 ? LEVEL + (1.5 - x) * 300 : x >= mulde.from && x < mulde.to ? LEVEL - mulde.depth : LEVEL;
                const quer = Math.abs(y - 5);
                return quer <= 0.3 ? sohle : Math.max(sohle, LEVEL + 400 * (quer - 0.3));
            }),
        ];
    }
    const protectedCells = new Set<number>();
    for (let j = 0; j < 41; j += 1)
        for (let i = 0; i < 41; i += 1)
            if (i * CELL > 4 && i * CELL < 6 && j * CELL > 4 && j * CELL < 6) protectedCells.add(j * 41 + i);
    const burn = (rasters: StoredRaster[], einlauf?: { tiefe: number }) =>
        burnRivers(rasters, input(rows, [lake]), {
            lakes: "fixed",
            protectedCells,
            ...(einlauf ? { einlauf } : {}),
        });
    /** Der Zufluss bis in den See. */
    const lauf = (rasters: StoredRaster[]) =>
        profile(rasters, [
            [0.5, 5],
            [4.5, 5],
        ]);

    it.each([
        ["hinter einer Strecke genau auf dem Spiegel (T16)", { from: 1.5, to: 2.5, depth: 38 }],
        ["direkt am Ufer", { from: 3, to: 4, depth: 38 }],
    ])("hebt eine Mulde %s auf den Spiegel; der Fluss fällt zum See, sonst ändert sich nichts", (_, mulde) => {
        const ohne = setup(mulde);
        const ohneBericht = burn(ohne);
        // Ohne den Wert wie zuvor: Die Mulde bleibt, der Fluss steigt aus ihr in den See an, ein Befund.
        expect(heightAt(ohne, (mulde.from + mulde.to) / 2, 5)).toBe(LEVEL - mulde.depth);
        expect(worstRise(lauf(ohne))).toBeGreaterThan(mulde.depth - 1);
        expect(ohneBericht.unresolved.map((entry) => entry.id)).toEqual(["zu"]);

        const mit = setup(mulde);
        const bericht = burn(mit, { tiefe: 100 });
        expect(heightAt(mit, (mulde.from + mulde.to) / 2, 5)).toBe(LEVEL);
        expect(worstRise(lauf(mit))).toBeLessThanOrEqual(RISE_TOLERANCE);
        expect(bericht.unresolved).toEqual([]);
        expect(risingRivers(mit, input(rows, [lake]), { lakes: "fixed", protectedCells }).rising).toEqual([]);
        expect(bericht.lakes[0]?.level).toBe(LEVEL);
        // Gehoben sind genau die Zellen der Mulde, eben auf den Spiegel; alles andere wie ohne den Wert.
        const a = ohne[0]!.samples;
        const b = mit[0]!.samples;
        let gehoben = 0;
        for (let k = 0; k < a.length; k += 1) {
            if (a[k] === b[k]) continue;
            gehoben += 1;
            const x = (k % 41) * CELL;
            const y = Math.floor(k / 41) * CELL;
            expect([a[k], b[k]]).toEqual([LEVEL - mulde.depth, LEVEL]);
            expect(x >= mulde.from && x < mulde.to && Math.abs(y - 5) <= 0.3).toBe(true);
        }
        expect(gehoben).toBe(3 * Math.round((mulde.to - mulde.from) / CELL));
        // Das tiefere Tal neben dem See hat keinen Einlauf und bleibt.
        expect(heightAt(mit, 5, 3.25)).toBe(900);
    });

    it("hebt keine Mulde tiefer als `tiefe`: Dann kommt der Fluss aus einem tieferen Tal, der Anstieg bleibt Befund", () => {
        const tief = { from: 1.5, to: 2.5, depth: 300 };
        const ohne = setup(tief);
        burn(ohne);
        const mit = setup(tief);
        const bericht = burn(mit, { tiefe: 100 });
        expect(mit[0]!.samples).toEqual(ohne[0]!.samples);
        expect(heightAt(mit, 2, 5)).toBe(LEVEL - 300);
        expect(bericht.unresolved.map((entry) => entry.id)).toEqual(["zu"]);
        // 0 hebt nichts.
        const null0 = setup({ from: 1.5, to: 2.5, depth: 38 });
        burn(null0, { tiefe: 0 });
        expect(heightAt(null0, 2, 5)).toBe(LEVEL - 38);
    });

    it("hebt auch hinter einem Riegel, den das Nachschneiden bis auf den Spiegel durchbricht", () => {
        // Zwischen Mulde (1,5 bis 2,5 E) und See ein Riegel 20 Schritt über dem Spiegel (2,5 bis 3 E): Das Bett durch ihn ist der
        // Spiegel, das Nachschneiden senkt ihn darauf, und erst dann reicht der Einlauf bis in die Mulde.
        const rasters = setup({ from: 1.5, to: 2.5, depth: 38 });
        const r = rasters[0]!;
        for (let j = 0; j < 41; j += 1)
            for (let i = 0; i < 41; i += 1) {
                const x = i * CELL;
                if (x >= 2.5 && x < 3 && Math.abs(j * CELL - 5) <= 0.3) r.samples[j * 41 + i] = LEVEL + 20;
            }
        const bericht = burn(rasters, { tiefe: 100 });
        expect(heightAt(rasters, 2, 5)).toBe(LEVEL);
        expect(heightAt(rasters, 2.75, 5)).toBe(LEVEL);
        expect(worstRise(lauf(rasters))).toBeLessThanOrEqual(RISE_TOLERANCE);
        expect(bericht.unresolved).toEqual([]);
    });

    it("zweimal einbrennen ist einmal", () => {
        const rasters = setup({ from: 1.5, to: 2.5, depth: 38 });
        burn(rasters, { tiefe: 100 });
        const once = Uint16Array.from(rasters[0]!.samples);
        burn(rasters, { tiefe: 100 });
        expect(rasters[0]!.samples).toEqual(once);
    });
});

describe("Netz", () => {
    it("ein Nebenfluss mit tieferem Bett zieht den Hauptfluss ab der Mündung herab (T-Stoß)", () => {
        // Der Hauptfluss liegt hoch (1.500), der Nebenfluss kommt aus einer Senke (600) und mündet bei x = 5.
        const rasters = [raster(0, 0, 41, 41, (x, y) => (y < 2 ? 600 : 1500))];
        const rows = [
            river("haupt", [
                [1, 5],
                [9, 5],
            ]),
            river("neben", [
                [5, 1],
                [5, 5],
            ]),
        ];
        burnRivers(rasters, input(rows));
        expect(
            worstRise(
                profile(rasters, [
                    [1, 5],
                    [9, 5],
                ]),
            ),
        ).toBeLessThanOrEqual(RISE_TOLERANCE + 0.5);
        expect(
            Math.max(
                ...profile(rasters, [
                    [5.3, 5],
                    [9, 5],
                ]),
            ),
        ).toBeLessThanOrEqual(600 + RISE_TOLERANCE);
        expect(heightAt(rasters, 2, 5)).toBe(1500);
    });
});

describe("Fixpunkt und Fingerabdruck", () => {
    it("zweimal einbrennen ist einmal", () => {
        const rasters = [bumpyValley()];
        const rows = [
            river("1", [
                [1, 5],
                [9, 5],
            ]),
            river(
                "2",
                [
                    [1, 3],
                    [5, 5],
                ],
                null,
            ),
        ];
        burnRivers(rasters, input(rows));
        const once = Uint16Array.from(rasters[0]?.samples ?? []);
        const again = burnRivers(rasters, input(rows));
        expect(again.changedCells).toBe(0);
        expect(Array.from(rasters[0]?.samples ?? [])).toEqual(Array.from(once));
    });

    it("wechselt mit Lage, Richtung und Bach eines Flusses", () => {
        const rows = [
            river("1", [
                [1, 5],
                [9, 5],
            ]),
        ];
        const base = hashRiverInputs(rows, []);
        expect(
            hashRiverInputs(
                [
                    river("1", [
                        [1, 5],
                        [9, 5],
                    ]),
                ],
                [],
            ),
        ).toBe(base);
        expect(
            hashRiverInputs(
                [
                    river("1", [
                        [1, 5],
                        [9, 5.01],
                    ]),
                ],
                [],
            ),
        ).not.toBe(base);
        expect(
            hashRiverInputs(
                [
                    river(
                        "1",
                        [
                            [1, 5],
                            [9, 5],
                        ],
                        "reverse",
                    ),
                ],
                [],
            ),
        ).not.toBe(base);
        expect(
            hashRiverInputs(
                [
                    {
                        ...river("1", [
                            [1, 5],
                            [9, 5],
                        ]),
                        bach: true,
                    },
                ],
                [],
            ),
        ).not.toBe(base);
    });
});

describe("freie Gipfel", () => {
    it("schneidet keinen Kegel, meldet aber den Lauf, den er anhebt", () => {
        const rasters = [raster(20, 20, 5, 5, () => 100)];
        const peaks = [{ x: 5, y: 5, h: 900 }];
        const report = burnRivers(
            rasters,
            input([
                river("1", [
                    [1, 5],
                    [9, 5],
                ]),
            ]),
            { peaks },
        );
        expect(report.coneRises.map((entry) => entry.id)).toEqual(["1"]);
        expect(report.changedCells).toBe(0);
    });
});

describe("Gipfel im Gebirge", () => {
    it("bleiben stehen, auch wenn ein Graben an ihnen vorbeiführt; der Lauf daneben ist ein Befund", () => {
        // Hochfläche 2.000 mit einem Gipfel von 4.000 bei (6, 5.3); der Fluss kommt aus einer Senke von 500.
        const f = (x: number, y: number): number =>
            x < 2 ? 500 : 2000 + 2000 * Math.max(0, 1 - Math.hypot(x - 6, y - 5.3) / 1.5);
        const rasters = [raster(0, 0, 41, 41, f)];
        const peak = { x: 6, y: 5.3 };
        const i = Math.floor(peak.x / CELL);
        const j = Math.floor(peak.y / CELL);
        const before = [0, 1].flatMap((dj) => [0, 1].map((di) => rasters[0]?.samples[(j + dj) * 41 + i + di]));
        const rows = [
            river("1", [
                [1, 5],
                [9, 5],
            ]),
        ];
        const report = burnRivers(rasters, input(rows), { anchors: [peak] });
        const after = [0, 1].flatMap((dj) => [0, 1].map((di) => rasters[0]?.samples[(j + dj) * 41 + i + di]));
        expect(after).toEqual(before);
        expect(report.peakRises.map((entry) => entry.id)).toEqual(["1"]);
        expect(report.unresolved).toEqual([]);
        // Abseits des Gipfels fällt der Lauf trotzdem.
        expect(
            Math.max(
                ...profile(rasters, [
                    [7.5, 5],
                    [9, 5],
                ]),
            ),
        ).toBeLessThanOrEqual(500 + RISE_TOLERANCE);
        expect(risingRivers(rasters, input(rows), { anchors: [peak] }).rising).toEqual([]);
    });
});
