import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { chordIsDry, offroadCost, offroadPathBetween, offroadRamp } from "../src/routing/map-points.ts";
import {
    buildOffroadBox,
    buildPlanes,
    centreX,
    centreY,
    crossingUnits,
    indexOf,
    wadeAt,
    type OffroadBox,
    type OffroadPlanes,
} from "../src/routing/offroad-grid.ts";
import {
    DISPLAY_EPSILON,
    findPath,
    finishPath,
    nearestReachable,
    simplifyLine,
    type OffroadPath,
} from "../src/routing/offroad-search.ts";
import { chordTouchesGround, prepareGround, type Ground } from "../src/routing/ground.ts";
import { chordCrossesRivers, NO_RIVERS, prepareRivers, type RiverRow } from "../src/routing/rivers.ts";
import { NO_WATER, prepareWater, type Water } from "../src/routing/water.ts";

/**
 * Der gebogene Gang querfeldein (WI-0030 R7): Raster und Suche nach Legacys Testliste
 * (`api/_internal/routing/__tests__/`, avesmaps@770c80e) - offroad-astar, offroad-multi-goal,
 * fluss-sperre, bach-furt, bach-querung-hindernis, offroad-shortest, offroad-ramp. Was Höhe oder Boden
 * braucht, fällt weg: Beides kennt Avesmaps3D noch nicht (Gelände-Entscheidung B).
 */

const model = AVENTURIA_TRAVEL_MODEL;
/** Legacys Testtempo; die Einheit ist die jeder Kante. */
const TEMPO = 2.3;
const zeit = offroadCost(model, { transport: "groupFoot", speed: TEMPO }, "fastest");
const strecke = offroadCost(model, { transport: "groupFoot", speed: TEMPO }, "shortest");
/** Eine Querung bei Vorgabe-Strömung: 15 Meilen, also 5 Karteneinheiten. */
const QUERUNG = 5;

function quadrate(...boxes: [number, number, number, number][]): Water {
    return prepareWater(
        boxes.map(([minX, minY, maxX, maxY]) => ({
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [minX, minY],
                        [maxX, minY],
                        [maxX, maxY],
                        [minX, maxY],
                        [minX, minY],
                    ],
                ],
            },
            minX,
            minY,
            maxX,
            maxY,
        })),
    );
}

function fluss(coordinates: [number, number][], extra: Partial<RiverRow> = {}): RiverRow {
    return { coordinates, isBach: false, flowDirection: null, flowFactor: null, ...extra };
}

/** Ein Bach mit Fließrichtung; ohne eigenen Faktor gilt die Vorgabe-Strömung 2. */
function bach(coordinates: [number, number][], stroemung: number | null = null): RiverRow {
    return fluss(coordinates, { isBach: true, flowDirection: "forward", flowFactor: stroemung });
}

function ebenen(box: OffroadBox, water: Water = NO_WATER, rows: RiverRow[] = []): OffroadPlanes {
    return buildPlanes(box, water, rows.length > 0 ? prepareRivers(rows, model) : NO_RIVERS, { search: true });
}

/** Eine Sperre ohne Wasser, nur aus gesetzten Zellen. */
function sperre(box: OffroadBox, blocked: (x: number, y: number) => boolean): OffroadPlanes {
    const plane = new Uint8Array(box.cellCount);
    for (let row = 0; row < box.rows; row += 1) {
        for (let column = 0; column < box.cols; column += 1) {
            if (blocked(centreX(box, column), centreY(box, row))) plane[row * box.cols + column] = 1;
        }
    }
    return { box, blocked: plane, fords: null, walls: null, ground: null, roads: null };
}

const laenge = (points: readonly [number, number][]): number =>
    points.slice(1).reduce((sum, [x, y], index) => {
        const [px, py] = points[index] as [number, number];
        return sum + Math.hypot(x - px, y - py);
    }, 0);

const hoechstesY = (path: OffroadPath): number => Math.max(...path.points.map(([, y]) => y));

describe("Die Kiste (offroad-astar §1)", () => {
    it("legt 30 % der Luftlinie als Rand an und hält die verlangte Zelle, solange sie passt", () => {
        const box = buildOffroadBox(10, 10, 20, 10, 0.5);
        expect(box.cell).toBe(0.5);
        expect(box.minX).toBeLessThanOrEqual(7);
        expect(box.maxX).toBeGreaterThanOrEqual(23);
        expect(box.cols * box.rows).toBe(box.cellCount);
        expect(box.coarsened).toBe(false);
        // Seit dem 31.08.2026 ist die Zelle 0,25 breit.
        expect(buildOffroadBox(0, 0, 1, 1).cell).toBe(0.25);
    });

    it("💣 verdoppelt über dem Deckel die Zelle, für diese eine Anfrage, und sagt es", () => {
        const huge = buildOffroadBox(0, 0, 290, 290, 0.5);
        expect(huge.cellCount).toBeLessThanOrEqual(150_000);
        expect(huge.cell).toBeGreaterThan(0.5);
        expect(huge.coarsened).toBe(true);
        expect(Math.log2(huge.cell / 0.5) % 1).toBe(0);
    });

    it("bleibt eine Kiste, auch wenn Start und Ziel zusammenfallen", () => {
        const dot = buildOffroadBox(5, 5, 5, 5, 0.5);
        expect(dot.cols).toBeGreaterThanOrEqual(1);
        expect(dot.rows).toBeGreaterThanOrEqual(1);
    });
});

describe("Die Suche (offroad-astar §3-§4)", () => {
    const box = buildOffroadBox(0, 5, 20, 5, 1);

    it("findet die Lücke in der Mauer, und jeder Punkt des Weges ist trocken", () => {
        const mauer = quadrate([9, -20, 11, 3], [9, 7, 11, 30]);
        const planes = ebenen(box, mauer);
        expect(planes.blocked).toBeInstanceOf(Uint8Array);
        expect(planes.blocked?.length).toBe(box.cellCount);
        const weg = findPath(planes, zeit, { x: 0, y: 5 }, { x: 20, y: 5 });
        expect(weg?.distance).toBeGreaterThan(0);
        for (const [x, y] of weg?.points ?? []) expect(x > 9 && x < 11 && (y < 3 || y > 7)).toBe(false);
    });

    it("sagt vor einer geschlossenen Mauer „kein Weg“", () => {
        expect(findPath(ebenen(box, quadrate([9, -20, 11, 30])), zeit, { x: 0, y: 5 }, { x: 20, y: 5 })).toBeNull();
    });

    it("💣 lässt einen Start im Wasser los - um die Enden wird freigeräumt", () => {
        expect(findPath(ebenen(box, quadrate([-1, 4, 1, 6])), zeit, { x: 0, y: 5 }, { x: 20, y: 5 })).not.toBeNull();
    });

    it("Start gleich Ziel ist ein Weg der Länge null", () => {
        expect(findPath(ebenen(box), zeit, { x: 3, y: 5 }, { x: 3, y: 5 })?.distance).toBe(0);
    });

    it("💣 näht die Enden an die echten Punkte: nie kürzer als die Luftlinie", () => {
        const offen = buildOffroadBox(0.3, 0.3, 7.7, 0.3, 0.5);
        const weg = findPath(ebenen(offen), zeit, { x: 0.3, y: 0.3 }, { x: 7.7, y: 0.3 });
        const luftlinie = 7.4;
        expect(weg?.distance).toBeGreaterThanOrEqual(luftlinie - 1e-9);
        expect(weg?.points[0]).toEqual([0.3, 0.3]);
        expect(weg?.points[(weg.points.length || 1) - 1]).toEqual([7.7, 0.3]);
        // Die Einheit jeder Kante: Strecke / Tempo, mal Längenaufschlag der Luftlinie.
        expect(weg?.time).toBeCloseTo(((weg?.distance ?? 0) / TEMPO) * offroadRamp(model, luftlinie), 9);
    });
});

describe("Douglas-Peucker (offroad-astar §7)", () => {
    const treppe: [number, number][] = [];
    for (let stufe = 0; stufe < 6; stufe += 1) {
        treppe.push([stufe * 0.5, stufe * 0.5], [(stufe + 1) * 0.5, stufe * 0.5]);
    }

    it("fasst eine Gerade zu ihren zwei Enden zusammen", () => {
        const gerade: [number, number][] = [0, 1, 2, 3, 4, 5].map((x) => [x, 0]);
        expect(simplifyLine(gerade, 0.1)).toHaveLength(2);
    });

    it("🔴 0,10 kostet keine Länge, ein gröberes Epsilon kürzt die Linie - und Länge ist Reisezeit", () => {
        expect(laenge(simplifyLine(treppe, 0.1))).toBeCloseTo(laenge(treppe), 9);
        expect(laenge(simplifyLine(treppe, 0.5))).toBeLessThan(laenge(treppe) - 1e-9);
    });

    it("lässt die Enden stehen, und ein einzelner Punkt bleibt einer", () => {
        const kurz = simplifyLine(treppe, 99);
        expect(kurz[0]).toEqual(treppe[0]);
        expect(kurz[kurz.length - 1]).toEqual(treppe[treppe.length - 1]);
        expect(simplifyLine([[1, 2]], 0.1)).toHaveLength(1);
    });
});

describe("Der Mehrziel-Lauf (offroad-multi-goal)", () => {
    const box = buildOffroadBox(0, 0, 20, 20);
    const flach = ebenen(box);
    const punkt = { x: 4, y: 4 };

    it("rechnet für jedes Ziel dasselbe wie der Einzellauf", () => {
        // Ziele auf der Diagonalen und der Achse: Dort ist der günstigste Gitterweg eindeutig.
        for (const ziel of [
            { x: 6, y: 6 },
            { x: 14, y: 14 },
            { x: 4, y: 12 },
        ]) {
            const viele = nearestReachable(flach, zeit, punkt, [ziel]);
            const einer = findPath(flach, zeit, ziel, punkt);
            expect(viele?.index).toBe(0);
            expect(viele?.path.time).toBeCloseTo(einer?.time ?? NaN, 6);
            expect(viele?.path.distance).toBeCloseTo(einer?.distance ?? NaN, 6);
        }
    });

    it("läuft vom Ziel, dem Ausstieg, zum Kartenpunkt", () => {
        const weg = nearestReachable(flach, zeit, punkt, [{ x: 6, y: 6 }])?.path;
        expect(weg?.points[0]).toEqual([6, 6]);
        expect(weg?.points[(weg.points.length || 1) - 1]).toEqual([4, 4]);
    });

    it("überspringt ein unerreichbares Ziel, statt abzubrechen", () => {
        const mauer = Math.floor(box.cols / 2);
        const geteilt: OffroadPlanes = {
            box,
            blocked: Uint8Array.from({ length: box.cellCount }, (_, index) => (index % box.cols === mauer ? 1 : 0)),
            fords: null,
            walls: null,
            ground: null,
            roads: null,
        };
        const jenseits = { x: 18, y: 18 };
        const diesseits = { x: 5, y: 5 };
        expect(nearestReachable(geteilt, zeit, punkt, [jenseits, diesseits])?.index).toBe(1);
        expect(nearestReachable(geteilt, zeit, punkt, [jenseits])).toBeNull();
    });

    it("🔴 nimmt den ersten erreichbaren in der Reihenfolge der Ziele, nicht den billigsten", () => {
        expect(
            nearestReachable(flach, zeit, punkt, [
                { x: 14, y: 14 },
                { x: 5, y: 5 },
            ])?.index,
        ).toBe(0);
    });

    it("🔴 auch ein Ziel am Ufer zahlt die Furt (Betreiber 2026-09-24, anders als Legacys Code)", () => {
        const ufer = buildOffroadBox(0, 0, 0, 6);
        const punkt = { x: 0, y: 0 };
        // Eine kurze Flusswand neben dem Ziel macht es zum Ziel mit eigenem Lauf; der Bach quer über
        // die ganze Kiste lässt keinen Weg herum.
        const neben = fluss([
            [-0.5, 6.6],
            [0.5, 6.6],
        ]);
        const quer = bach([
            [-100, 3],
            [100, 3],
        ]);
        const mitBach = nearestReachable(ebenen(ufer, NO_WATER, [neben, quer]), zeit, punkt, [{ x: 0, y: 6 }]);
        const ohneBach = nearestReachable(ebenen(ufer, NO_WATER, [neben]), zeit, punkt, [{ x: 0, y: 6 }]);
        expect(mitBach?.index).toBe(0);
        expect((mitBach?.path.time ?? 0) - (ohneBach?.path.time ?? 0)).toBeGreaterThan((QUERUNG / TEMPO) * 0.9);
    });

    it("🔴 das Freiräumen eines Kandidaten öffnet den See für keinen anderen", () => {
        const seeBox = buildOffroadBox(2, 2, 24, 24);
        const see = sperre(seeBox, (x, y) => x >= 10 && x <= 11.6 && y >= 4 && y <= 20);
        const start = { x: 5, y: 12 };
        const fern = { x: 20, y: 12 };
        const nass = { x: 10.8, y: 12 };
        const ufer = { x: 9.7, y: 12 };
        const alleine = nearestReachable(see, zeit, start, [fern])?.path;
        // Um den See herum sind es rund 23 Einheiten; der Durchbruch wären 15.
        expect(alleine?.distance).toBeGreaterThan(20);
        for (const fremd of [nass, ufer]) {
            const mit = nearestReachable(see, zeit, start, [fern, fremd]);
            expect(mit?.index).toBe(0);
            expect(mit?.path.distance).toBeCloseTo(alleine?.distance ?? NaN, 9);
            // Der Kandidat am oder im Wasser wird trotzdem angebunden - in einem eigenen Lauf.
            expect(nearestReachable(see, zeit, start, [fremd, fern])?.index).toBe(0);
        }
    });
});

describe("🔴 Ein Fluss nahe den Enden (Betreiber 2026-09-24, WI-0030 m)", () => {
    const box = buildOffroadBox(0, 0, 0, 10);
    const planes = ebenen(box, NO_WATER, [
        fluss([
            [-100, 5],
            [100, 5],
        ]),
    ]);
    const mit = (rivers: "free" | "blocked" | "priced") =>
        offroadCost(model, { transport: "groupFoot", speed: TEMPO }, "fastest", rivers);
    /** Zu Fuß: dreimal der Bachpreis, 45 Meilen = 15 Einheiten. */
    const FLUSS = 15;

    it("„free“ quert im freigeräumten Umkreis gratis wie Legacy, „priced“ zahlt, „blocked“ bleibt diesseits", () => {
        const von = { x: 0, y: 4.5 };
        const nach = { x: 0, y: 5.5 };
        expect(findPath(planes, mit("free"), von, nach)?.time).toBeLessThan(2 / TEMPO);
        expect(findPath(planes, mit("priced"), von, nach)?.time).toBeGreaterThan(FLUSS / TEMPO);
        expect(findPath(planes, mit("blocked"), von, nach)).toBeNull();
    });

    it("führt der Fluss durch die eigene Zelle eines Endes, liegt der Punkt am Fluss: Das Queren kostet nichts", () => {
        const amFluss = { x: 0, y: 5 };
        const nach = { x: 0, y: 8 };
        expect(findPath(planes, mit("priced"), amFluss, nach)?.time).toBeLessThan(4 / TEMPO);
        expect(findPath(planes, mit("blocked"), amFluss, { x: 0, y: 2 })?.time).toBeLessThan(4 / TEMPO);
    });
});

describe("🔴 Der Boden bremst (Betreiber 2026-09-24, WI-0030 R8)", () => {
    /** Rechteckige Landschaften mit ihrem Faktor. */
    const boden = (...flaechen: [number, number, number, number, number][]): Ground =>
        prepareGround(
            flaechen.map(([minX, minY, maxX, maxY, factor]) => ({
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [minX, minY],
                            [maxX, minY],
                            [maxX, maxY],
                            [minX, maxY],
                            [minX, minY],
                        ],
                    ],
                },
                minX,
                minY,
                maxX,
                maxY,
                factor,
            })),
        );
    const box = buildOffroadBox(0, 0, 0, 10);
    const ebene = (grund: Ground, rows: RiverRow[] = []) =>
        buildPlanes(box, NO_WATER, rows.length > 0 ? prepareRivers(rows, model) : NO_RIVERS, { search: true }, grund);

    it("im Wald dauert jeder Schritt anderthalbmal so lang, unter „Kürzeste“ zählt die Strecke", () => {
        const wald = ebene(boden([-50, -50, 50, 50, 1.5]));
        const von = { x: 0, y: 2 };
        const nach = { x: 0, y: 8 };
        const schnell = findPath(wald, zeit, von, nach) as OffroadPath;
        expect(schnell.distance).toBeCloseTo(6, 6);
        expect(schnell.time).toBeCloseTo((6 / TEMPO) * 1.5 * offroadRamp(model, 6), 6);
        const kurz = findPath(wald, strecke, von, nach) as OffroadPath;
        expect(kurz.distance).toBeCloseTo(6, 6);
    });

    it("um einen schmalen Sumpf geht der Gang herum, unter „Kürzeste“ hindurch", () => {
        const sumpf = ebene(boden([-1, 4.5, 1, 5.5, 7.5]));
        const von = { x: 0, y: 2 };
        const nach = { x: 0, y: 8 };
        const schnell = findPath(sumpf, zeit, von, nach) as OffroadPath;
        expect(schnell.distance).toBeGreaterThan(6.2);
        expect(schnell.points.some(([x]) => Math.abs(x) > 1)).toBe(true);
        expect(findPath(sumpf, strecke, von, nach)?.distance).toBeCloseTo(6, 6);
    });

    it("🔴 überlagerte Landschaften und das Bachbett zählen per Maximum, nicht als Produkt", () => {
        const doppelt = ebene(boden([-50, -50, 50, 50, 1.5], [-50, -50, 50, 50, 3.75]));
        const gerade: [number, number][] = [
            [0, 2],
            [0, 8],
        ];
        expect(finishPath(doppelt, zeit, gerade, false).time).toBeCloseTo(
            (6 / TEMPO) * 3.75 * offroadRamp(model, 6),
            6,
        );
        // Ein Bach längs durch den Wald: Das Bachbett (Watfaktor 3) ist teurer als der Wald und gewinnt.
        const mitBach = ebene(boden([-50, -50, 50, 50, 1.5]), [
            bach([
                [0, -100],
                [0, 100],
            ]),
        ]);
        const imBett = finishPath(mitBach, zeit, gerade, false).time;
        expect(imBett).toBeGreaterThan((6 / TEMPO) * 2.9 * offroadRamp(model, 6));
        expect(imBett).toBeLessThan((6 / TEMPO) * 3.1 * offroadRamp(model, 6));
    });

    it("die Sehne berührt Boden, wo sie eine Fläche schneidet oder in ihr liegt; offener Boden fällt weg", () => {
        const grund = boden([4, 4, 6, 6, 1.5], [10, 10, 12, 12, 1]);
        expect(grund.areas).toHaveLength(1);
        expect(chordTouchesGround(0, 5, 10, 5, grund)).toBe(true);
        expect(chordTouchesGround(4.5, 4.5, 5.5, 5.5, grund)).toBe(true);
        expect(chordTouchesGround(0, 0, 10, 0, grund)).toBe(false);
        expect(chordTouchesGround(10.5, 10.5, 11.5, 11.5, grund)).toBe(false);
    });
});

describe("🔴 Ein See bleibt Wand (Betreiber 2026-09-25, WI-0030 o)", () => {
    const box = buildOffroadBox(0, 0, 0, 10);
    const see = ebenen(box, quadrate([-0.6, 5.4, 0.6, 5.8]));
    const mit = (water: "coast" | "shore") =>
        offroadCost(model, { transport: "groupFoot", speed: TEMPO }, "fastest", "priced", water);
    const imSee = (path: OffroadPath | null): boolean =>
        (path?.points ?? []).some(([x, y], index, points) => {
            const [px, py] = (points[index - 1] ?? [x, y]) as [number, number];
            for (let step = 0; step <= 20; step += 1) {
                const sx = px + ((x - px) * step) / 20;
                const sy = py + ((y - py) * step) / 20;
                if (sx > -0.6 && sx < 0.6 && sy > 5.4 && sy < 5.8) return true;
            }
            return false;
        });

    it("„coast“ geht wie Legacy durch den See am Punkt, „shore“ außen herum", () => {
        const von = { x: 0, y: 5 };
        const nach = { x: 0, y: 8 };
        const kueste = findPath(see, mit("coast"), von, nach);
        expect(kueste?.distance).toBeCloseTo(3, 6);
        expect(imSee(kueste)).toBe(true);
        const ufer = findPath(see, mit("shore"), von, nach);
        expect(ufer?.distance).toBeGreaterThan(3.2);
        expect(imSee(ufer)).toBe(false);
    });

    it("die eigene Zelle eines Endes bleibt frei: Ein Punkt auf der Uferlinie ist nicht eingesperrt", () => {
        expect(findPath(see, mit("shore"), { x: 0, y: 5.45 }, { x: 0, y: 2 })).not.toBeNull();
    });
});

describe("Ein Fluss ist eine Wand (fluss-sperre)", () => {
    const box = buildOffroadBox(0, 0, 40, 40);
    const quer = fluss([
        [-200, 20],
        [200, 20],
    ]);
    const von = { x: 20, y: 5 };
    const nach = { x: 20, y: 35 };

    it("ohne Fluss geht es praktisch geradeaus, mit Fluss gar nicht", () => {
        expect(findPath(ebenen(box), zeit, von, nach)?.distance).toBeCloseTo(30, 0);
        expect(findPath(ebenen(box, NO_WATER, [quer]), zeit, von, nach)).toBeNull();
    });

    it("💣 auch eine schräge Wand hat keine diagonale Lücke", () => {
        const schraeg = fluss([
            [-200, -190],
            [200, 210],
        ]);
        expect(findPath(ebenen(box, NO_WATER, [schraeg]), zeit, { x: 30, y: 5 }, { x: 5, y: 30 })).toBeNull();
    });

    it("ein Fluss am Rand lässt die Reise in der Mitte in Ruhe", () => {
        const rand = fluss([
            [-10, 39.9],
            [50, 39.9],
        ]);
        expect(findPath(ebenen(box, NO_WATER, [rand]), zeit, von, nach)).not.toBeNull();
    });

    it("💣 die gerade Sehne fragt die Flüsse selbst - sie geht am Raster vorbei", () => {
        const welt = (rows: RiverRow[]) => ({ water: NO_WATER, rivers: prepareRivers(rows, model) });
        expect(chordIsDry(welt([quer]), von, nach)).toBe(false);
        expect(chordIsDry(welt([]), von, nach)).toBe(true);
        const daneben = fluss([
            [0, 39.5],
            [40, 39.5],
        ]);
        expect(chordIsDry(welt([daneben]), von, nach)).toBe(true);
    });

    it("sammelt Flüsse als Wand, Bäche als Furt, und eine Linie aus einem Punkt fällt heraus", () => {
        const rivers = prepareRivers(
            [
                fluss([
                    [1, 1],
                    [2, 2],
                ]),
                bach([
                    [3, 3],
                    [4, 4],
                ]),
                bach([[9, 9]]),
            ],
            model,
        );
        expect(rivers.walls.map((line) => line.coordinates)).toEqual([
            [
                [1, 1],
                [2, 2],
            ],
        ]);
        expect(rivers.fords.map((line) => [line.coordinates, line.factor, line.wade])).toEqual([
            [
                [
                    [3, 3],
                    [4, 4],
                ],
                1,
                3,
            ],
        ]);
    });
});

describe("Ein Bach ist eine Furt, keine Wand (bach-furt)", () => {
    const box = buildOffroadBox(0, 0, 40, 40);
    const querLinie: [number, number][] = [
        [-200, 20],
        [200, 20],
    ];
    const von = { x: 20, y: 5 };
    const nach = { x: 20, y: 35 };
    const mitBach = ebenen(box, NO_WATER, [bach(querLinie)]);
    const ohneAufschlag: OffroadPlanes = { ...mitBach, fords: null };

    it("🔴 ein Bach sperrt keine Zelle, ein Fluss schon", () => {
        expect(mitBach.blocked?.some((cell) => cell !== 0)).toBe(false);
        expect(ebenen(box, NO_WATER, [fluss(querLinie)]).blocked?.some((cell) => cell !== 0)).toBe(true);
        expect(findPath(mitBach, zeit, von, nach)).not.toBeNull();
    });

    it("🔴 aber er kostet - gegen dieselbe Strecke ohne Bach", () => {
        const ueberBach = findPath(mitBach, zeit, von, nach) as OffroadPath;
        const ohne = findPath(ohneAufschlag, zeit, von, nach) as OffroadPath;
        expect(ueberBach.distance).toBe(ohne.distance);
        expect(ueberBach.time).toBeGreaterThan(ohne.time);
        // Querung und Waten zusammen, in Meilen offenen Geländes.
        const mehrMeilen = (ueberBach.time - ohne.time) * TEMPO * 3;
        expect(mehrMeilen).toBeGreaterThan(10);
        expect(mehrMeilen).toBeLessThan(90);
    });

    it("🔴 der Preis steht im Gewicht: um das Ende des Baches herum ist länger und doch billiger", () => {
        const halb = ebenen(box, NO_WATER, [
            bach([
                [-200, 20],
                [20, 20],
            ]),
        ]);
        const ausweichen = findPath(halb, zeit, von, nach) as OffroadPath;
        const geradeaus = findPath({ ...halb, fords: null }, zeit, von, nach) as OffroadPath;
        expect(ausweichen.distance).toBeGreaterThan(geradeaus.distance + 1e-9);
        expect(ausweichen.time).toBeLessThan((findPath(mitBach, zeit, von, nach) as OffroadPath).time);

        // 🔴 Auch unter „Kürzeste“: Der Querungspreis ist kein Faktor und überlebt die Strecke als Gewicht.
        expect((findPath(halb, strecke, von, nach) as OffroadPath).distance).toBeGreaterThan(geradeaus.distance + 1e-9);
        expect((findPath({ ...halb, fords: null }, strecke, von, nach) as OffroadPath).distance).toBeCloseTo(
            geradeaus.distance,
            9,
        );
    });

    it("wo zwei Bäche dieselbe Zelle treffen, bremst der teurere", () => {
        const zwei = ebenen(box, NO_WATER, [bach(querLinie, 6), bach(querLinie)]);
        expect(wadeAt(box, zwei.fords, 20, 20)).toBe(9);
    });

    it("💣 auch schräg keine diagonale Lücke im Band - sonst liefe der Schritt gratis vorbei", () => {
        const schraeg = ebenen(box, NO_WATER, [
            bach([
                [-200, -190],
                [200, 210],
            ]),
        ]);
        const wade = schraeg.fords?.wade as Float64Array;
        const istBach = (column: number, row: number): boolean => (wade[row * box.cols + column] as number) > 0;
        let loecher = 0;
        let zellen = 0;
        for (let row = 0; row < box.rows - 1; row += 1) {
            for (let column = 0; column < box.cols - 1; column += 1) {
                if (istBach(column, row)) zellen += 1;
                const a = istBach(column, row);
                const b = istBach(column + 1, row);
                const c = istBach(column, row + 1);
                const d = istBach(column + 1, row + 1);
                if ((a && d && !b && !c) || (b && c && !a && !d)) loecher += 1;
            }
        }
        expect(loecher).toBe(0);
        expect(zellen).toBeGreaterThan(box.rows);
        const schraegMit = findPath(schraeg, zeit, { x: 30, y: 5 }, { x: 5, y: 30 }) as OffroadPath;
        const schraegOhne = findPath(
            { ...schraeg, fords: null },
            zeit,
            { x: 30, y: 5 },
            { x: 5, y: 30 },
        ) as OffroadPath;
        expect(schraegMit.time).toBeGreaterThan(schraegOhne.time);
    });

    it("ohne Bach entsteht keine Ebene aus dem Nichts", () => {
        expect(ebenen(box).fords).toBeNull();
    });
});

describe("Der Bach ist ein Hindernis: ein Preis je Querung (bach-querung-hindernis)", () => {
    const linie: [number, number][] = [
        [10, -200],
        [10, 4],
    ];
    const von = { x: 0, y: 0 };
    const nach = { x: 20, y: 0 };
    const lauf = (rows: RiverRow[], optimize: "fastest" | "shortest"): OffroadPath | null =>
        offroadPathBetween(
            { water: NO_WATER, rivers: rows.length > 0 ? prepareRivers(rows, model) : NO_RIVERS },
            offroadCost(model, { transport: "groupFoot", speed: TEMPO }, optimize),
            von,
            nach,
        );
    const herum = (path: OffroadPath | null): boolean => hoechstesY(path as OffroadPath) >= 4;

    it("die Zahl ist die des Owners: 15 Meilen, in Karteneinheiten", () => {
        expect(zeit.crossingUnits * model.meilenJeKarteneinheit.wert).toBe(15);
    });

    it("der Umweg um die Wand existiert - straff gezogen rund 1,8 Einheiten statt 3,6 auf der Treppe", () => {
        const ohne = lauf([], "fastest") as OffroadPath;
        const wand = lauf([fluss(linie)], "fastest") as OffroadPath;
        expect(herum(wand)).toBe(true);
        const umweg = wand.distance - ohne.distance;
        expect(umweg).toBeGreaterThan(1.5);
        expect(umweg).toBeLessThan(2.5);
        // Schräg um den Kopf der Wand, nicht im 45°-Zickzack der Zellen - und kein Stück quert sie.
        expect(wand.points.length).toBeLessThanOrEqual(5);
        const nurWand = prepareRivers([fluss(linie)], model);
        for (let index = 1; index < wand.points.length; index += 1) {
            const [x1, y1] = wand.points[index - 1] as [number, number];
            const [x2, y2] = wand.points[index] as [number, number];
            expect(chordCrossesRivers(x1, y1, x2, y2, nurWand)).toBe(false);
        }
    });

    it("🔴 die Querung kostet je Reisemittel: Einzelreiter 5, allein zu Fuß 10, Gruppe zu Fuß 15, Karawane 30 Meilen", () => {
        const einheiten = (transport: string): number =>
            offroadCost(model, { transport, speed: TEMPO }, "fastest").crossingUnits * model.meilenJeKarteneinheit.wert;
        expect(einheiten("lightRider")).toBe(5);
        expect(einheiten("lightWalker")).toBe(10);
        expect(einheiten("groupHorse")).toBe(10);
        expect(einheiten("groupFoot")).toBe(15);
        expect(einheiten("caravan")).toBe(30);
        // Ein Mittel ohne eigenen Eintrag zahlt Legacys 15 Meilen.
        expect(einheiten("unbekannt")).toBe(15);
        // Die Karawane weicht einem Bach aus, den der Einzelreiter durchquert.
        const um = (transport: string): OffroadPath =>
            offroadPathBetween(
                { water: NO_WATER, rivers: prepareRivers([bach(linie)], model) },
                offroadCost(model, { transport, speed: TEMPO }, "fastest"),
                von,
                nach,
            ) as OffroadPath;
        expect(herum(um("caravan"))).toBe(true);
        expect(herum(um("lightRider"))).toBe(false);
    });

    it("🔴 der Bach lenkt, in beiden Modi: Vorgabe herum, ruhig hindurch, stark herum", () => {
        for (const optimize of ["fastest", "shortest"] as const) {
            expect(herum(lauf([bach(linie)], optimize))).toBe(true);
            expect(herum(lauf([bach(linie, 1)], optimize))).toBe(false);
            expect(herum(lauf([bach(linie, 6)], optimize))).toBe(true);
        }
    });

    it("die gemeldete Zeit trägt den Preis, die Strecke nicht", () => {
        const ohne = lauf([], "fastest") as OffroadPath;
        const durch = lauf([bach(linie, 1)], "fastest") as OffroadPath;
        const preis = (QUERUNG * 0.5) / TEMPO;
        const aufschlag = durch.time - ohne.time;
        expect(aufschlag).toBeGreaterThan(preis * 0.9);
        expect(aufschlag).toBeLessThan(preis * 6);
        expect(Math.abs(durch.distance - ohne.distance)).toBeLessThan(0.5);
    });

    it("die Gerade über einen Bach wird verworfen, ohne Bach bleibt sie", () => {
        const welt = (rows: RiverRow[]) => ({ water: NO_WATER, rivers: prepareRivers(rows, model) });
        expect(chordIsDry(welt([bach(linie)]), von, nach)).toBe(false);
        expect(chordIsDry(welt([]), von, nach)).toBe(true);
        const gerade = lauf([], "fastest") as OffroadPath;
        expect(gerade.points).toEqual([
            [0, 0],
            [20, 0],
        ]);
    });

    describe("der Preis ist exakt, an der reinen Funktion", () => {
        const box = buildOffroadBox(0, 0, 20, 0);
        const planes = (rows: RiverRow[]) => ebenen(box, NO_WATER, rows);
        const quer = planes([
            bach([
                [10, -200],
                [10, 200],
            ]),
        ]);
        const preis = (p: OffroadPlanes, x1: number, y1: number, x2: number, y2: number): number =>
            crossingUnits(box, p.fords, QUERUNG, indexOf(box, x1, y1), indexOf(box, x2, y2), x1, y1, x2, y2);

        it("ein querender Schritt kostet genau eine Querung, einer längs im Bett keine, einer fernab nichts", () => {
            expect(preis(quer, 9.8, 0, 10.2, 0)).toBe(QUERUNG);
            expect(preis(quer, 10, 0, 10, 0.4)).toBe(0);
            expect(preis(quer, 2, 0, 2.4, 0)).toBe(0);
            // Symmetrisch: hin und zurück ist derselbe Schnitt.
            expect(preis(quer, 10.2, 0, 9.8, 0)).toBe(QUERUNG);
        });

        it("starke Strömung, teure Querung: Strömung 6 kostet das Dreifache", () => {
            const stark = planes([
                bach(
                    [
                        [10, -200],
                        [10, 200],
                    ],
                    6,
                ),
            ]);
            expect(preis(stark, 9.8, 0, 10.2, 0)).toBe(3 * QUERUNG);
        });

        it("🔴 beide Enden im Bach: Wer zweimal quert, zahlt zweimal", () => {
            const u = planes([
                bach([
                    [10, 200],
                    [10, 0],
                    [11, 0],
                    [11, 200],
                ]),
            ]);
            expect(wadeAt(box, u.fords, 10, 1)).toBeGreaterThan(1);
            expect(preis(u, 10.9, 1, 11.1, 1)).toBe(QUERUNG);
        });

        it("🔴 waten bremst: Watfaktor 3 bei Vorgabe-Strömung, stärker bei starker, daneben trocken", () => {
            expect(wadeAt(box, quer.fords, 10, 0)).toBe(3);
            const stark = planes([
                bach(
                    [
                        [10, -200],
                        [10, 200],
                    ],
                    6,
                ),
            ]);
            expect(wadeAt(box, stark.fords, 10, 0)).toBe(9);
            expect(wadeAt(box, quer.fords, 2, 0)).toBe(1);
        });
    });
});

describe("„Kürzeste“ im Gelände (offroad-shortest)", () => {
    const box = buildOffroadBox(0, 0, 20, 20);
    // Ein langsamer Streifen quer im Weg, nur bis x = 12: Faktor 4.
    const wade = new Float64Array(box.cellCount);
    for (let row = 0; row < box.rows; row += 1) {
        for (let column = 0; column < box.cols; column += 1) {
            const x = centreX(box, column);
            const y = centreY(box, row);
            if (y >= 8 && y <= 12 && x <= 12) wade[row * box.cols + column] = 4;
        }
    }
    const streifen: OffroadPlanes = {
        box,
        blocked: new Uint8Array(box.cellCount),
        fords: { wade, cells: new Map(), fords: [] },
        walls: null,
        ground: null,
        roads: null,
    };
    const von = { x: 4, y: 4 };
    const nach = { x: 4, y: 16 };

    it("der Streckenmodus ist kürzer, der Zeitmodus schneller", () => {
        const schnell = findPath(streifen, zeit, von, nach) as OffroadPath;
        const kurz = findPath(streifen, strecke, von, nach) as OffroadPath;
        expect(kurz.distance).toBeLessThan(schnell.distance - 1e-6);
        expect(schnell.time).toBeLessThan(kurz.time - 1e-6);
        expect(kurz.distance).toBeLessThan(12.6);
    });

    it("🔴 die Messung bleibt ehrlich: Die kürzeste Linie zahlt den Streifen", () => {
        const kurz = findPath(streifen, strecke, von, nach) as OffroadPath;
        expect(kurz.time).toBeGreaterThan(kurz.distance / TEMPO + 1e-6);
    });

    it("der Mehrziel-Lauf rechnet im Streckenmodus dieselbe Länge", () => {
        const viele = nearestReachable(streifen, strecke, nach, [von]);
        expect(viele?.path.distance).toBeCloseTo((findPath(streifen, strecke, von, nach) as OffroadPath).distance, 6);
    });

    it("die trockene Gerade braucht keine Suche, wird aber mit dem Gelände gemessen", () => {
        const gerade = finishPath(
            streifen,
            zeit,
            [
                [4, 4],
                [4, 16],
            ],
            false,
        );
        expect(gerade.points).toHaveLength(2);
        expect(gerade.distance).toBe(12);
        expect(gerade.time).toBeGreaterThan(gerade.distance / TEMPO + 1e-6);
        const welt = { water: quadrate([0, 9, 20, 11]), rivers: NO_RIVERS };
        expect(chordIsDry(welt, von, nach)).toBe(false);
    });
});

describe("Der Längenaufschlag am gemeinsamen Abschluss (offroad-ramp G/H)", () => {
    const box = buildOffroadBox(0, 0, 60, 60);
    const eben = { box, fords: null };

    it("die Strecke bleibt unangetastet, und die lange Etappe ist je Einheit langsamer", () => {
        const kurz = finishPath(
            eben,
            zeit,
            [
                [0, 0],
                [3, 0],
            ],
            true,
        );
        const lang = finishPath(
            eben,
            zeit,
            [
                [0, 0],
                [30, 0],
            ],
            true,
        );
        expect(kurz.distance).toBe(3);
        expect(lang.distance).toBe(30);
        expect(lang.time / lang.distance).toBeGreaterThan(kurz.time / kurz.distance + 1e-9);
        expect(lang.time).toBeCloseTo((30 / TEMPO) * offroadRamp(model, 30), 9);
    });

    it("🔴 der Aufschlag hängt an der Luftlinie, nicht an der Schlangenlinie", () => {
        const bogen = finishPath(
            eben,
            zeit,
            [
                [0, 0],
                [15, 20],
                [30, 0],
            ],
            true,
        );
        expect(bogen.distance).toBeGreaterThan(49);
        expect(bogen.time).toBeCloseTo((bogen.distance / TEMPO) * offroadRamp(model, 30), 9);
        expect(bogen.time).toBeLessThan((bogen.distance / TEMPO) * offroadRamp(model, bogen.distance));
    });
});

describe("🔴 Die gezeichnete Linie eines Gangs (Befund 2026-10-03: „querfeldeinrouten sind nicht mehr geglättet“)", () => {
    // Die Treppe der Suche im Gebirge: Zelle für Zelle um Hänge, jede Abkürzung kostet mehr. Länge und Zeit gehören ihr;
    // gezeichnet wird die Linie darunter, gerade genug für die Kurve der Karte.
    const box = buildOffroadBox(10, 10, 20, 13, 0.25);
    const zackig: [number, number][] = [[10, 10]];
    for (let x = 10.75; x < 20; x += 0.75) {
        zackig.push([x, 10 + ((x - 10) * 3) / 10 + (zackig.length % 2 === 0 ? 0.3 : -0.3)]);
    }
    zackig.push([20, 13]);

    const abstandZu = (line: readonly [number, number][], point: [number, number]): number => {
        let nearest = Number.POSITIVE_INFINITY;
        for (let index = 1; index < line.length; index += 1) {
            const [ax, ay] = line[index - 1] as [number, number];
            const [bx, by] = line[index] as [number, number];
            const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
            const t =
                lengthSquared > 0
                    ? Math.max(
                          0,
                          Math.min(1, ((point[0] - ax) * (bx - ax) + (point[1] - ay) * (by - ay)) / lengthSquared),
                      )
                    : 0;
            nearest = Math.min(nearest, Math.hypot(point[0] - ax - t * (bx - ax), point[1] - ay - t * (by - ay)));
        }
        return nearest;
    };

    it("🔴 über freiem Gelände wird die Treppe zur Linie, ohne mehr als DISPLAY_EPSILON von ihr abzuweichen", () => {
        const weg = finishPath(ebenen(box), zeit, zackig, true);
        // Das Zickzack (0,3 daneben) bleibt in der gerechneten Linie: Das Epsilon der Länge ist 0,10.
        expect(weg.points.length).toBeGreaterThan(6);
        const gezeichnet = weg.display;
        expect(gezeichnet).toBeDefined();
        const linie = gezeichnet as [number, number][];
        expect(linie.length).toBeLessThan(weg.points.length / 2);
        expect(linie[0]).toEqual(weg.points[0]);
        expect(linie[linie.length - 1]).toEqual(weg.points[weg.points.length - 1]);
        for (const punkt of weg.points) expect(abstandZu(linie, punkt)).toBeLessThanOrEqual(DISPLAY_EPSILON + 1e-9);
    });

    it("🔴 Länge, Zeit und Linie der Rechnung bleiben, was sie waren: Die gezeichnete Linie ändert nur das Bild", () => {
        const mit = finishPath(ebenen(box), zeit, zackig, true);
        const ohne = finishPath({ ...ebenen(box), blocked: null }, zeit, zackig, true);
        expect(ohne.display).toBeUndefined();
        expect(mit.display).toBeDefined();
        expect(mit.points).toEqual(ohne.points);
        expect(mit.distance).toBe(ohne.distance);
        expect(mit.time).toBe(ohne.time);
    });

    it("🔴 sie schneidet nie in eine gesperrte Zelle: Wo die Abkürzung über die Wand ginge, bleibt die Treppe", () => {
        // Ein Klotz von (14|8) bis (16|12); der Gang führt in einem Bogen über ihn (y 12,6), die Gerade ginge hindurch.
        const klotz = sperre(buildOffroadBox(10, 10, 21, 10, 0.25), (x, y) => x >= 14 && x <= 16 && y >= 8 && y <= 12);
        const bogen: [number, number][] = [
            [10, 10],
            [13.5, 11.6],
            [14.5, 12.6],
            [15.5, 12.6],
            [16.5, 11.6],
            [21, 10],
        ];
        const weg = finishPath(klotz, zeit, bogen, true);
        const gezeichnet = weg.display ?? weg.points;
        // Nirgends in einer gesperrten Zelle, fein abgetastet.
        for (let index = 1; index < gezeichnet.length; index += 1) {
            const [ax, ay] = gezeichnet[index - 1] as [number, number];
            const [bx, by] = gezeichnet[index] as [number, number];
            const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.02);
            for (let step = 0; step <= steps; step += 1) {
                const x = ax + ((bx - ax) * step) / steps;
                const y = ay + ((by - ay) * step) / steps;
                expect(
                    klotz.blocked?.[indexOf(klotz.box, x, y)],
                    `(${x.toFixed(2)}|${y.toFixed(2)}) liegt im Klotz`,
                ).toBe(0);
            }
        }
        // Und der Bogen ist geblieben: Die Linie läuft oben um den Klotz, nicht in einer Geraden darunter.
        expect(Math.max(...gezeichnet.map(([, y]) => y))).toBeGreaterThan(12.4);
    });

    it("🔴 auch eine dünne Sperre innerhalb des Epsilons hält die Linie davon ab, hindurchzugehen", () => {
        // Die Gerade von (10|10) nach (20|12) geht bei x = 15 durch eine einzelne gesperrte Zelle; der Gang weicht ihr
        // um 0,44 aus - weniger als DISPLAY_EPSILON. Allein nach der Abweichung fiele der Ausweichpunkt weg.
        const dünn = sperre(
            buildOffroadBox(10, 10, 20, 12, 0.25),
            (x, y) => x >= 14.9 && x <= 15.15 && y >= 10.85 && y <= 11.1,
        );
        expect(dünn.blocked?.some((zelle) => zelle === 1)).toBe(true);
        const ausweichen: [number, number][] = [
            [10, 10],
            [14.6, 10.92],
            [15, 11.45],
            [15.4, 11.08],
            [20, 12],
        ];
        const weg = finishPath(dünn, zeit, ausweichen, true);
        const gezeichnet = weg.display ?? weg.points;
        expect(gezeichnet).toContainEqual([15, 11.45]);
        for (let index = 1; index < gezeichnet.length; index += 1) {
            const [ax, ay] = gezeichnet[index - 1] as [number, number];
            const [bx, by] = gezeichnet[index] as [number, number];
            const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.02);
            for (let step = 0; step <= steps; step += 1) {
                const x = ax + ((bx - ax) * step) / steps;
                const y = ay + ((by - ay) * step) / steps;
                expect(dünn.blocked?.[indexOf(dünn.box, x, y)], `(${x.toFixed(2)}|${y.toFixed(2)})`).toBe(0);
            }
        }
    });

    it("eine Gerade und ein Weg ohne Sperre haben nichts zu begradigen: kein display", () => {
        const gerade = finishPath(
            ebenen(box),
            zeit,
            [
                [10, 10],
                [20, 13],
            ],
            true,
        );
        expect(gerade.display).toBeUndefined();
        expect(finishPath({ ...ebenen(box), blocked: null }, zeit, zackig, true).display).toBeUndefined();
    });

    it("💣 die Suche liefert die Linie mit: ein Weg um eine Mauer behält seinen Bogen, sein display hält den Abstand", () => {
        const mauer = quadrate([9, -20, 11, 3], [9, 7, 11, 30]);
        const planes = ebenen(buildOffroadBox(0, 5, 20, 5, 1), mauer);
        const weg = findPath(planes, zeit, { x: 0, y: 5 }, { x: 20, y: 5 }) as OffroadPath;
        const linie = weg.display ?? weg.points;
        for (const [x, y] of linie) expect(x > 9 && x < 11 && (y < 3 || y > 7)).toBe(false);
        for (const punkt of weg.points) expect(abstandZu(linie, punkt)).toBeLessThanOrEqual(DISPLAY_EPSILON + 1e-9);
    });
});
