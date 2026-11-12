import { prepareBorderTerritory, type BorderSegment, type BorderTerritory } from "../../src/index.ts";

/**
 * Gebiete und Linien für die Zählung der Landesgrenzen (WI-0065 U1), von Hand und aus einem festen Seed. Sie
 * dienen dem Einheitstest (`travel-borders.test.ts`) und dem Paritätstest gegen Legacys Originalfunktion
 * (`travel-borders-legacy.test.ts`), der dieselben Eingaben in beide Rechnungen gibt.
 */

/** Meilen je Karteneinheit, wie in Legacys Fällen (`DISTANCE_SCALING_FACTOR`) und im Reisemodell. */
export const MILES_PER_UNIT = 3;

export interface SceneTerritory {
    id: string;
    name: string;
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
}

type Point = [number, number];

/** Ein achsenparalleles Rechteck als geschlossener Ring. */
export const box = (x0: number, y0: number, x1: number, y1: number): Point[] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
];

export function squareTerritory(id: string, x0: number, y0: number, x1: number, y1: number, name = id): SceneTerritory {
    return { id, name, geometry: { type: "Polygon", coordinates: [box(x0, y0, x1, y1)] } };
}

/** Die Form der Zählung aus einer Szene; wirft, wenn sie kein Polygon ist. */
export function prepared(scene: readonly SceneTerritory[]): BorderTerritory[] {
    return scene.map((entry) => {
        const territory = prepareBorderTerritory(entry);
        if (territory === null) throw new Error(`Szene ${entry.id} ist kein Polygon`);
        return territory;
    });
}

/**
 * Dieselben Gebiete mit Legacys Bauart der Hüllbox: alle Teile eines Gebiets tragen die Hüllbox des GANZEN Gebiets.
 * Das Ergebnis der Zählung ist dasselbe, nur langsamer (WI-0065: 32 s statt 1,0 s an 196 Reisen).
 */
export function withTerritoryWideBoxes(territories: readonly BorderTerritory[]): BorderTerritory[] {
    return territories.map((territory) => {
        const union = territory.parts.reduce<[number, number, number, number]>(
            (box, part) => [
                Math.min(box[0], part.bbox[0]),
                Math.min(box[1], part.bbox[1]),
                Math.max(box[2], part.bbox[2]),
                Math.max(box[3], part.bbox[3]),
            ],
            [Infinity, Infinity, -Infinity, -Infinity],
        );
        return { ...territory, parts: territory.parts.map((part) => ({ ...part, bbox: union })) };
    });
}

/** Legacys Eingabeform: ein GeoJSON-Feature mit dem Namen in `properties`. */
export interface LegacyFeature {
    type: "Feature";
    properties: { name: string };
    geometry: SceneTerritory["geometry"];
}

export const legacyFeature = (entry: SceneTerritory): LegacyFeature => ({
    type: "Feature",
    properties: { name: entry.name },
    geometry: entry.geometry,
});

/** Eine Linie als Abschnitte; jeder Abschnitt hat mindestens zwei Punkte. */
export const line = (...points: Point[]): BorderSegment[] => [{ geometry: { coordinates: points } }];

/** West (0 bis 100) und Ost (100 bis 200), je 100 hoch: die Quadrate aus Legacys `travel-costs.test.js`. */
export const WEST_OST: SceneTerritory[] = [
    squareTerritory("west", 0, 0, 100, 100, "West"),
    squareTerritory("ost", 100, 0, 200, 100, "Ost"),
];

/** Ein deterministischer Zufall (mulberry32): dieselbe Zahlenfolge auf jedem Rechner. */
export function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Eine Szene mit allem, was die Zählung unterscheiden muss: ein Reich (Alpha), ein L-förmiges, das Alpha überlappt
 * und hinter ihm in der Liste steht (Beta), eines mit Loch (Gamma) und ein Gebiet, das das Loch fast füllt (Delta, 3 Meilen Rand), zwei entfernte
 * Teile eines Gebiets (Epsilon) und ein zweites Gebiet gleichen Namens wie Alpha (Legacy schlüsselt nach Namen).
 */
export const FUZZ_SCENE: SceneTerritory[] = [
    squareTerritory("alpha", 0, 0, 100, 100, "Alpha"),
    {
        id: "beta",
        name: "Beta",
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [90, 0],
                    [200, 0],
                    [200, 50],
                    [150, 50],
                    [150, 100],
                    [90, 100],
                    [90, 0],
                ],
            ],
        },
    },
    {
        id: "gamma",
        name: "Gamma",
        geometry: { type: "Polygon", coordinates: [box(200, 0, 300, 100), box(230, 30, 270, 70)] },
    },
    squareTerritory("delta", 231, 31, 269, 69, "Delta"),
    {
        id: "epsilon",
        name: "Epsilon",
        geometry: { type: "MultiPolygon", coordinates: [[box(40, 110, 60, 130)], [box(220, 110, 240, 130)]] },
    },
    squareTerritory("alpha-zwei", 120, 60, 130, 70, "Alpha"),
];

/**
 * Zufällige Linien über die Szene: die Hälfte gerade Sprünge kreuz und quer, die Hälfte kleinschrittige Wege, die an
 * den Grenzen bei x = 90, 100, 150, 200 pendeln (dort entscheidet die Schwelle). Jede Linie wird in ein bis drei
 * Abschnitte geteilt.
 */
export function fuzzLines(count: number, seed: number): BorderSegment[][] {
    const random = mulberry32(seed);
    const between = (from: number, to: number): number => from + random() * (to - from);
    const boundaries = [90, 100, 150, 200, 230, 270];
    const lines: BorderSegment[][] = [];
    for (let index = 0; index < count; index += 1) {
        const points: Point[] = [];
        if (index % 2 === 0) {
            const length = 2 + Math.floor(random() * 9);
            for (let point = 0; point < length; point += 1) points.push([between(-10, 310), between(-10, 140)]);
        } else {
            let x = between(0, 300);
            let y = between(5, 95);
            const length = 6 + Math.floor(random() * 30);
            for (let point = 0; point < length; point += 1) {
                points.push([x, y]);
                const anchor = boundaries[Math.floor(random() * boundaries.length)] as number;
                // Mal ein kleiner Schritt um die Grenze herum, mal ein weiterer Gang.
                x = random() < 0.7 ? anchor + between(-2, 2) : x + between(-40, 40);
                y = Math.min(140, Math.max(-10, y + between(-25, 25)));
            }
        }
        const segments: BorderSegment[] = [];
        const cuts = 1 + Math.floor(random() * 3);
        const size = Math.max(2, Math.ceil(points.length / cuts));
        for (let from = 0; from < points.length - 1; from += size - 1) {
            const chunk = points.slice(from, from + size);
            if (chunk.length >= 2) segments.push({ geometry: { coordinates: chunk } });
        }
        lines.push(segments);
    }
    return lines;
}

/** Dieselbe Reise rückwärts: die Abschnitte in umgekehrter Reihenfolge, jede Linie umgekehrt. */
export function reversed(segments: readonly BorderSegment[]): BorderSegment[] {
    return [...segments]
        .reverse()
        .map((segment) => ({ geometry: { coordinates: [...segment.geometry.coordinates].reverse() } }));
}

/**
 * Die Fälle der Tabelle „An Legacys eigenem Code nachgemessen“ (WI-0065): die ersten fünf sind Legacys eigene
 * Tests (`travel-costs.test.js:134-173`). `expected` ist Legacys Ergebnis; `null` heißt „kein Ergebnis“.
 */
export interface LegacyCase {
    name: string;
    scene: SceneTerritory[];
    segments: BorderSegment[];
    expected: number | null;
}

const WEST = squareTerritory("west", 0, 0, 100, 100, "West");
export const LEGACY_CASES: LegacyCase[] = [
    { name: "gerade durch beide Reiche", scene: WEST_OST, segments: line([10, 50], [190, 50]), expected: 1 },
    {
        name: "Pendeln an der Grenze",
        scene: WEST_OST,
        segments: line([10, 50], [99, 50], [100.3, 50], [99, 50], [100.3, 50], [99, 50], [190, 50]),
        expected: 1,
    },
    {
        name: "hinüber, zurück, wieder hinüber",
        scene: WEST_OST,
        segments: line([10, 50], [150, 50], [50, 50], [190, 50]),
        expected: 3,
    },
    { name: "ins Meer hinaus", scene: WEST_OST, segments: line([10, 50], [90, 50], [90, 500], [10, 500]), expected: 0 },
    { name: "ohne Gebiete", scene: [], segments: line([10, 50], [190, 50]), expected: null },
    {
        name: "West, weites Meer, Ost",
        scene: WEST_OST,
        segments: line([50, 50], [50, 500], [150, 500], [150, 50]),
        expected: 0,
    },
    {
        name: "West, Meer, West",
        scene: WEST_OST,
        segments: line([50, 50], [50, 500], [60, 500], [60, 50]),
        expected: 0,
    },
    {
        name: "Lücke von 6 Meilen",
        scene: [WEST, squareTerritory("ost", 102, 0, 200, 100, "Ost")],
        segments: line([10, 50], [190, 50]),
        expected: 0,
    },
    {
        name: "Lücke von 3 Meilen",
        scene: [WEST, squareTerritory("ost", 101, 0, 200, 100, "Ost")],
        segments: line([10, 50], [190, 50]),
        expected: 1,
    },
    { name: "Start 1,5 Meilen vor der Grenze", scene: WEST_OST, segments: line([99.5, 50], [190, 50]), expected: 1 },
    { name: "Ziel 1,5 Meilen hinter der Grenze", scene: WEST_OST, segments: line([190, 50], [99.5, 50]), expected: 0 },
];
