import { describe, expect, it } from "vitest";
import { blur } from "../src/terrain/domain/blur.ts";

/**
 * WI-0227: Der Kastenfilter läuft die Spalten blockweise statt einzeln. Das Ergebnis muss bytegleich zur früheren Bauart bleiben,
 * sonst ändert sich das Gelände (Rückverteilung der Erosion, Materialfelder, Gebirgssaaten).
 */

/** Die frühere Bauart: jede Zeile und jede Spalte einzeln, dieselbe Summe in derselben Reihenfolge. */
function blurBefore(
    field: Float32Array | Float64Array,
    spare: Float32Array | Float64Array,
    n: number,
    radius: number,
): void {
    const line = (
        source: Float32Array | Float64Array,
        target: Float32Array | Float64Array,
        start: number,
        stride: number,
    ): void => {
        let sum = 0;
        for (let i = 0; i < Math.min(radius, n); i += 1) sum += source[start + i * stride]!;
        for (let i = 0; i < n; i += 1) {
            if (i + radius < n) sum += source[start + (i + radius) * stride]!;
            if (i - radius - 1 >= 0) sum -= source[start + (i - radius - 1) * stride]!;
            target[start + i * stride] = sum;
        }
    };
    if (radius === 0) return;
    for (let pass = 0; pass < 3; pass += 1) {
        for (let y = 0; y < n; y += 1) line(field, spare, y * n, 1);
        for (let x = 0; x < n; x += 1) line(spare, field, x, n);
    }
}

/** Beide Feldarten, die der Filter kennt, mit einer Bauweise für Länge und Kopie. */
type Field = Float32Array | Float64Array;
type FieldType = { readonly name: string; new (input: number | ArrayLike<number>): Field };

function randomField(Type: FieldType, n: number, seed: number): Field {
    const field = new Type(n * n);
    let state = seed >>> 0;
    for (let k = 0; k < field.length; k += 1) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        // Gemischte Größenordnungen und Vorzeichen, damit Rundung in der Summe wirklich vorkommt.
        field[k] = ((state / 4294967296) * 2 - 1) * 10 ** ((state >>> 28) % 5);
    }
    return field;
}

describe("Kastenfilter, Spalten im Block (WI-0227)", () => {
    for (const Type of [Float32Array, Float64Array] as FieldType[]) {
        for (const [n, radius] of [
            [1, 1],
            [7, 0],
            [17, 1],
            [37, 3],
            [50, 16],
            [33, 40],
            [130, 64],
        ] as const) {
            it(`🔴 bytegleich zur früheren Bauart: ${Type.name}, n ${n}, Radius ${radius}`, () => {
                const expected = randomField(Type, n, n * 31 + radius);
                const actual = new Type(expected);
                blurBefore(expected, new Type(n * n), n, radius);
                blur(actual, new Type(n * n), n, radius);
                expect(Buffer.from(actual.buffer).equals(Buffer.from(expected.buffer))).toBe(true);
            });
        }
    }
});
