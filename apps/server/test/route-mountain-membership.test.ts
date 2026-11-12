import { describe, expect, it } from "vitest";
import { mountainMembershipRows } from "../src/routing/mountain-membership.ts";
import { riseHistogram } from "../src/routing/relief.ts";
import { domainMountainMask, type DomainHeightSource, type MountainMembership } from "../src/terrain/domain/read.ts";
import { type V12Geometry } from "@avesmaps3d/shared";

/**
 * WI-0071, Nachtrag: Die Zugehörigkeit zum Gebirge wird nach Zeilen gerechnet (`mountain-membership.ts`) und die Eichung
 * zählt die Höhenunterschiede in einem Lauf. Beides gibt Zelle für Zelle und Zahl für Zahl dasselbe wie der Weg davor:
 * `domainMountainMask` (Punkt in Fläche je Zelle) und die Zählung je Richtung. Die Vergleiche laufen an Ringen, die ein
 * echter Datenbestand nicht hat und die den Rand prüfen: Eckpunkte genau auf Zeilen und Spalten, Löcher, mehrere Teile,
 * sich schneidende und waagerechte Kanten, ein Umkreis, der nicht zur Fläche passt.
 */

/** Ein kleiner, feststehender Zufallsgenerator (mulberry32): dieselben Fälle bei jedem Lauf. */
function generator(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface Layout {
    width: number;
    height: number;
    cell: number;
    originX: number;
    originY: number;
}

/** Zellgrößen, die sich genau darstellen lassen (1, 64) und solche, die es nicht tun (0,1; 1/3): Zeilen liegen dort auf gerundeten Werten. */
const LAYOUTS: Layout[] = [
    { width: 13, height: 17, cell: 1, originX: 0.5, originY: 0.5 },
    { width: 29, height: 23, cell: 0.1, originX: 0.05, originY: 0.05 },
    { width: 16, height: 16, cell: 64, originX: 32, originY: 32 },
    { width: 37, height: 41, cell: 1 / 3, originX: 1 / 6, originY: 1 / 6 },
];

type Ring = number[][];

function source(layout: Layout, mountains: MountainMembership[]): DomainHeightSource {
    return {
        fingerprint: "test",
        revision: "test",
        membershipFingerprint: "test",
        raster: { ...layout, samples: new Uint16Array(layout.width * layout.height) },
        mountains,
    };
}

/** Eine Fläche mit dem Umkreis ihrer Eckpunkte, wie ihn PostGIS (`ST_XMin` …) liefert. */
function areaOf(geometry: V12Geometry, box?: [number, number, number, number]): MountainMembership {
    const points = (
        geometry.type === "Polygon"
            ? (geometry.coordinates as number[][][]).flat()
            : (geometry.coordinates as number[][][][]).flat(2)
    ) as number[][];
    const xs = points.map((point) => point[0] as number);
    const ys = points.map((point) => point[1] as number);
    const [minX, minY, maxX, maxY] = box ?? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    return { geometry, minX, minY, maxX, maxY };
}

/** Der Vergleich: ganz und in Streifen (auch über das Raster hinaus) gegen `domainMountainMask`. */
function expectSame(
    layout: Layout,
    mountains: MountainMembership[],
    label: string,
    stripes = [layout.height, 1, 5, 7],
) {
    const input = source(layout, mountains);
    const oracle = domainMountainMask(input);
    for (const stripe of stripes) {
        const parts: Uint8Array[] = [];
        for (let from = 0; from < layout.height; from += stripe)
            parts.push(mountainMembershipRows(input, from, Math.min(layout.height, from + stripe)));
        expect(Buffer.concat(parts).equals(Buffer.from(oracle)), `${label}, Streifenhöhe ${String(stripe)}`).toBe(true);
    }
    return oracle;
}

describe("Die Zugehörigkeit zum Gebirge nach Zeilen ist `domainMountainMask`, Zelle für Zelle", () => {
    it("🔴 ein Rechteck mit Kanten genau auf Zellmitten, Zeilen und Spalten", () => {
        for (const layout of LAYOUTS) {
            const at = (axis: "x" | "y", index: number) =>
                (axis === "x" ? layout.originX : layout.originY) + index * layout.cell;
            const ring: Ring = [
                [at("x", 2), at("y", 3)],
                [at("x", 7), at("y", 3)],
                [at("x", 7), at("y", 9)],
                [at("x", 2), at("y", 9)],
                [at("x", 2), at("y", 3)],
            ];
            const oracle = expectSame(
                layout,
                [areaOf({ type: "Polygon", coordinates: [ring] })],
                `Rechteck ${String(layout.cell)}`,
            );
            expect(oracle.some((value) => value === 1)).toBe(true);
            expect(oracle.some((value) => value === 0)).toBe(true);
        }
    });

    it("🔴 ein Ring mit Loch, ein Loch außerhalb und zwei Löcher, die sich überdecken", () => {
        const layout = LAYOUTS[0] as Layout;
        const square = (a: number, b: number): Ring => [
            [a, a],
            [b, a],
            [b, b],
            [a, b],
            [a, a],
        ];
        const donut: V12Geometry = { type: "Polygon", coordinates: [square(1, 11), square(3, 6)] };
        const outside: V12Geometry = { type: "Polygon", coordinates: [square(1, 6), square(8, 9.5)] };
        const overlapping: V12Geometry = { type: "Polygon", coordinates: [square(0, 12), square(2, 6), square(4, 8)] };
        for (const [label, geometry] of [
            ["Loch", donut],
            ["Loch außerhalb", outside],
            ["überdeckende Löcher", overlapping],
        ] as const) {
            const oracle = expectSame(layout, [areaOf(geometry)], label);
            expect(oracle.some((value) => value === 1)).toBe(true);
        }
    });

    it("mehrere Teile und mehrere Flächen: die Vereinigung, jede Zelle einmal", () => {
        const layout = LAYOUTS[1] as Layout;
        const part = (x: number, y: number, size: number): Ring[] => [
            [
                [x, y],
                [x + size, y + size / 2],
                [x + size / 2, y + size],
                [x, y],
            ],
        ];
        const many: V12Geometry = {
            type: "MultiPolygon",
            coordinates: [part(0.2, 0.2, 1), part(0.8, 0.6, 1.2), part(1.9, 1.0, 0.7)],
        };
        const single: V12Geometry = { type: "Polygon", coordinates: part(0.5, 0.3, 1.8) };
        expectSame(layout, [areaOf(many), areaOf(single), areaOf(many)], "Vereinigung");
    });

    it("🔴 zufällige Ringe (auch sich schneidende, offene, waagerechte) mit Löchern und Teilen, auf allen Rastern", () => {
        const random = generator(20261003);
        const between = (low: number, high: number) => low + random() * (high - low);
        let withCells = 0;
        const cases = 400;
        for (let run = 0; run < cases; run += 1) {
            const layout = LAYOUTS[run % LAYOUTS.length] as Layout;
            const extentX = layout.width * layout.cell;
            const extentY = layout.height * layout.cell;
            /** Ein Wert genau auf einer Zellmitte (so gerechnet wie das Raster), auf halbem Weg oder irgendwo, auch draußen. */
            const coordinate = (axis: "x" | "y"): number => {
                const origin = axis === "x" ? layout.originX : layout.originY;
                const count = axis === "x" ? layout.width : layout.height;
                const extent = axis === "x" ? extentX : extentY;
                const mode = random();
                if (mode < 0.45) return origin + Math.floor(between(-2, count + 2)) * layout.cell;
                if (mode < 0.6) return origin + (Math.floor(between(-2, count + 2)) + 0.5) * layout.cell;
                return between(-0.15 * extent, 1.15 * extent);
            };
            const ring = (): Ring => {
                const count = 3 + Math.floor(random() * 7);
                const points: Ring = Array.from({ length: count }, () => [coordinate("x"), coordinate("y")]);
                if (random() < 0.7) points.push([...(points[0] as number[])]);
                if (random() < 0.1) points.push([points[points.length - 1]?.[0] as number, points[0]?.[1] as number]);
                return points;
            };
            const polygon = (): Ring[] => [ring(), ...Array.from({ length: Math.floor(random() * 3) }, ring)];
            const mountains = Array.from({ length: 1 + Math.floor(random() * 3) }, (): MountainMembership => {
                const geometry: V12Geometry =
                    random() < 0.6
                        ? { type: "Polygon", coordinates: polygon() }
                        : {
                              type: "MultiPolygon",
                              coordinates: Array.from({ length: 1 + Math.floor(random() * 3) }, polygon),
                          };
                if (random() < 0.75) return areaOf(geometry);
                // Ein Umkreis, der nicht zur Fläche passt: kleiner, größer, verschoben.
                return areaOf(geometry, [
                    between(-0.1, 0.5) * extentX,
                    between(-0.1, 0.5) * extentY,
                    between(0.4, 1.1) * extentX,
                    between(0.4, 1.1) * extentY,
                ]);
            });
            const oracle = expectSame(layout, mountains, `Fall ${String(run)}`, [layout.height, 1, 6, 16]);
            if (oracle.some((value) => value === 1)) withCells += 1;
        }
        // Die Fälle prüfen etwas: ein Großteil trifft Zellen.
        expect(withCells).toBeGreaterThan(cases / 2);
    });

    it("🔴 die Streifen: jede Spanne gleich dem Ausschnitt des ganzen Rasters, auch über den Rand hinaus", () => {
        const layout = LAYOUTS[3] as Layout;
        const triangle: Ring = [
            [1, 1],
            [11, 5],
            [3, 13],
            [1, 1],
        ];
        const input = source(layout, [areaOf({ type: "Polygon", coordinates: [triangle] })]);
        const whole = Buffer.from(domainMountainMask(input));
        for (const [from, to] of [
            [0, 41],
            [3, 4],
            [7, 31],
            [30, 41],
            [38, 60],
        ] as const) {
            const rows = mountainMembershipRows(input, from, to);
            const wanted = Buffer.alloc(layout.width * (to - from));
            whole.copy(wanted, 0, from * layout.width, Math.min(to, layout.height) * layout.width);
            expect(Buffer.from(rows).equals(wanted), `Zeilen ${String(from)} bis ${String(to)}`).toBe(true);
        }
    });

    it("Ränder: leere Ringe, Ringe aus zwei Punkten, Flächen ohne Geometrie, ein Umkreis ohne Zelle", () => {
        const layout = LAYOUTS[0] as Layout;
        const empty: MountainMembership = {
            geometry: { type: "Polygon", coordinates: [] },
            minX: 0,
            minY: 0,
            maxX: 9,
            maxY: 9,
        };
        const twoPoints: MountainMembership = {
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [1, 1],
                        [5, 5],
                    ],
                ],
            },
            minX: 1,
            minY: 1,
            maxX: 5,
            maxY: 5,
        };
        const nothing = { geometry: null, minX: 0, minY: 0, maxX: 9, maxY: 9 } as unknown as MountainMembership;
        const unknown = {
            geometry: { type: "Point", coordinates: [3, 3] },
            minX: 0,
            minY: 0,
            maxX: 9,
            maxY: 9,
        } as unknown as MountainMembership;
        const square: Ring = [
            [2, 2],
            [3, 2],
            [3, 3],
            [2, 3],
            [2, 2],
        ];
        // Der Umkreis liegt zwischen zwei Zellmitten: keine Zelle darin, auch wenn die Fläche größer ist.
        const between: MountainMembership = areaOf({ type: "Polygon", coordinates: [square] }, [2.1, 2.1, 2.4, 2.4]);
        const oracle = expectSame(layout, [empty, twoPoints, nothing, unknown, between], "Ränder");
        expect(oracle.every((value) => value === 0)).toBe(true);
        expect(mountainMembershipRows(source(layout, []), 0, layout.height).every((value) => value === 0)).toBe(true);
    });
});

type Raster = Parameters<typeof riseHistogram>[0][number];

/** Die Zählung, wie sie vorher lief und wie man sie hinschreibt: jedes Paar mit Nachbar nach Osten, Norden, Nordosten und Südosten. */
function referenceHistogram(raster: Raster, members: Uint8Array | null): Map<number, Uint32Array> {
    const histogram = new Map<number, Uint32Array>();
    const { width, height, samples, cell } = raster;
    const member = (i: number, j: number) => (members ? members[j * width + i] === 1 : samples[j * width + i] !== 0);
    for (const [di, dj] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
    ] as const) {
        const run = cell * Math.hypot(di, dj);
        let counts = histogram.get(run);
        if (!counts) {
            counts = new Uint32Array(65536);
            histogram.set(run, counts);
        }
        for (let j = 0; j < height; j += 1) {
            for (let i = 0; i < width; i += 1) {
                const i2 = i + di;
                const j2 = j + dj;
                if (i2 < 0 || i2 >= width || j2 < 0 || j2 >= height) continue;
                if (!member(i, j) || !member(i2, j2)) continue;
                const rise = Math.abs((samples[j2 * width + i2] as number) - (samples[j * width + i] as number));
                counts[rise] = (counts[rise] as number) + 1;
            }
        }
    }
    return histogram;
}

describe("Die Eichung zählt die Höhenunterschiede in einem Lauf wie vorher je Richtung", () => {
    function raster(width: number, height: number, seed: number): { samples: Uint16Array; members: Uint8Array } {
        const random = generator(seed);
        const samples = new Uint16Array(width * height);
        const members = new Uint8Array(width * height);
        for (let index = 0; index < samples.length; index += 1) {
            // Teils kein Gebirge, teils Gebirge mit Höhe 0 (zählt dazu), sonst ganze Schritt in 0 bis 900.
            members[index] = random() < 0.55 ? 1 : 0;
            samples[index] = random() < 0.15 ? 0 : Math.floor(random() * 900);
        }
        return { samples, members };
    }

    it("🔴 Zugehörigkeit als ganzes Raster, zeilenweise (über mehrere Streifen) und aus den Höhen: dieselben Zahlen in derselben Ordnung", () => {
        // 300 Zeilen: mehr als zwei Streifen zu 128, und eine Breite, die in keinem Streifen aufgeht.
        for (const [width, height] of [
            [41, 300],
            [1, 9],
            [9, 1],
            [2, 2],
            [64, 129],
        ] as const) {
            const { samples, members } = raster(width, height, width * 1000 + height);
            const base = { cell: 0.25, originX: 0.125, originY: 0.125, width, height, samples, maxX: 0, maxY: 0 };
            const expectedMembers = referenceHistogram(base, members);
            const expectedHeights = referenceHistogram(base, null);
            const cases: [string, Raster, Map<number, Uint32Array>][] = [
                ["ganz", { ...base, membership: members }, expectedMembers],
                [
                    "Streifen",
                    {
                        ...base,
                        membershipRows: (from, to) => members.subarray(from * width, to * width),
                    },
                    expectedMembers,
                ],
                ["Höhen", base, expectedHeights],
            ];
            for (const [name, input, expected] of cases) {
                const got = riseHistogram([input]);
                expect(
                    [...got.keys()],
                    `${name} ${String(width)}x${String(height)}: Längen in derselben Ordnung`,
                ).toEqual([...expected.keys()]);
                for (const [run, counts] of expected) {
                    expect(
                        Buffer.from(got.get(run)?.buffer ?? new ArrayBuffer(0)).equals(Buffer.from(counts.buffer)),
                        `${name} ${String(width)}x${String(height)}, Länge ${String(run)}`,
                    ).toBe(true);
                }
                // Die Zählung ist nicht leer: ein Vergleich zweier leerer Tafeln wäre keiner.
                let total = 0;
                for (const counts of got.values()) for (const count of counts) total += count;
                if (width * height > 1000) expect(total).toBeGreaterThan(1000);
            }
        }
    });

    it("mehrere Raster zählen in eine Tafel, je Länge eine", () => {
        const a = raster(20, 140, 5);
        const b = raster(33, 150, 6);
        const first: Raster = {
            cell: 0.5,
            originX: 0,
            originY: 0,
            width: 20,
            height: 140,
            samples: a.samples,
            maxX: 0,
            maxY: 0,
            membership: a.members,
        };
        const second: Raster = {
            cell: 0.5,
            originX: 0,
            originY: 0,
            width: 33,
            height: 150,
            samples: b.samples,
            maxX: 0,
            maxY: 0,
            membership: b.members,
        };
        const got = riseHistogram([first, second]);
        const one = referenceHistogram(first, a.members);
        const two = referenceHistogram(second, b.members);
        expect([...got.keys()]).toEqual([...one.keys()]);
        for (const [run, counts] of got) {
            const wanted = new Uint32Array(65536);
            for (let rise = 0; rise < wanted.length; rise += 1)
                wanted[rise] = (one.get(run)?.[rise] as number) + (two.get(run)?.[rise] as number);
            expect(Buffer.from(counts.buffer).equals(Buffer.from(wanted.buffer)), `Länge ${String(run)}`).toBe(true);
        }
    });
});
