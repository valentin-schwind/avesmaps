/**
 * Zwei kleine, erfundene Gebirge für den Test der V12-Übertragung (WI-0049 S3). Sie liegen hier,
 * weil zwei Leser sie brauchen: `apps/server/test/terrain-v12.test.ts` rechnet sie mit dem Port,
 * `fixture-hashes.mjs` mit Legacys Modul und schreibt die erwarteten Prüfsummen aus.
 *
 * Ändert sich hier etwas, stimmen die Prüfsummen im Test nicht mehr; neu erzeugen mit
 *   node scripts/dev/terrain-oracle/fixture-hashes.mjs
 */
import { type V12Input } from "@avesmaps3d/shared";

/**
 * Drei Gipfel (einer ohne Höhe) ohne Kurve, also Spannbaum; ein Bach mit Fließrichtung durch einen
 * See, ein Fluss mit geratener Richtung; Plateau, Hypsometrie und die übrigen Regler gesetzt.
 */
export const FIXTURE_GRAT: V12Input = {
    bounds: { min_x: 500.2, min_y: 300.2, max_x: 519.7, max_y: 314.9 },
    geometry: {
        type: "Polygon",
        coordinates: [
            [
                [500.3, 301.1],
                [507, 300.2],
                [514.6, 300.9],
                [519.7, 304.4],
                [519.1, 310.2],
                [515.2, 314.6],
                [508.4, 314.9],
                [503.1, 313.2],
                [500.2, 308.7],
                [500.3, 301.1],
            ],
        ],
    },
    peaks: [
        { x: 506.3, y: 305.4, h: 3200 },
        { x: 511.8, y: 308.1, h: null },
        { x: 516.2, y: 306.0, h: 2400 },
    ],
    kurve: null,
    fluesse: [
        {
            n: "Testbach",
            bach: true,
            dir: "forward",
            p: [
                [503.0, 311.5],
                [506.5, 309.8],
                [510.2, 312.0],
                [513.8, 313.9],
                [516.0, 316.2],
            ],
        },
        {
            n: "Testfluss",
            bach: false,
            dir: null,
            p: [
                [512.0, 299.5],
                [513.5, 303.8],
                [512.9, 305.5],
            ],
        },
    ],
    seen: [
        {
            n: "Testsee",
            g: {
                type: "Polygon",
                coordinates: [
                    [
                        [508.2, 310.6],
                        [509.9, 310.5],
                        [510.3, 312.1],
                        [508.5, 312.4],
                        [508.2, 310.6],
                    ],
                ],
            },
        },
    ],
    regler: {
        koernung: 9,
        stufen: 4,
        erosion: 2,
        plateau: 0.8,
        hypsometrie: 0.4,
        maximalhoehe: 1500,
        bergform: 2,
        rauschen: 0.4,
        sattel: 0.85,
        talbreite: 1.2,
        einschnitt: 500,
    },
    saat: -1234567,
};

/**
 * Ohne Gipfel und ohne Kurve, aber mit Maximalhöhe: der Kamm läuft auf der Mittelachse. Zwei Teile,
 * der größere mit einem Loch; nur drei Regler gesetzt, der Rest nimmt Legacys Vorgaben.
 */
export const FIXTURE_MITTELACHSE: V12Input = {
    bounds: { min_x: 600, min_y: 400, max_x: 620, max_y: 412 },
    geometry: {
        type: "MultiPolygon",
        coordinates: [
            [
                [
                    [600, 400],
                    [611, 400.5],
                    [612.5, 411],
                    [601, 412],
                    [600, 400],
                ],
                [
                    [604, 404],
                    [607, 404],
                    [607, 407],
                    [604, 407],
                    [604, 404],
                ],
            ],
            [
                [
                    [613.5, 402],
                    [620, 401.5],
                    [619.5, 410.5],
                    [614, 409.8],
                    [613.5, 402],
                ],
            ],
        ],
    },
    peaks: [],
    kurve: null,
    fluesse: [],
    seen: [],
    regler: { maximalhoehe: 2200, erosion: 1, rauschen: 0.3 },
    saat: 424242,
};

/** Ohne Gipfel und ohne Maximalhöhe: Legacy lässt die Fläche flach und meldet sie leer. */
export const FIXTURE_FLACH: V12Input = {
    ...FIXTURE_MITTELACHSE,
    regler: { erosion: 1, rauschen: 0.3 },
};

export const V12_FIXTURES: readonly { name: string; input: V12Input }[] = [
    { name: "grat", input: FIXTURE_GRAT },
    { name: "mittelachse", input: FIXTURE_MITTELACHSE },
    { name: "flach", input: FIXTURE_FLACH },
];
