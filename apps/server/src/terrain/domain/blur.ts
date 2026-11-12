function blurLine(
    source: Float32Array | Float64Array,
    target: Float32Array | Float64Array,
    start: number,
    stride: number,
    n: number,
    radius: number,
): void {
    let sum = 0;
    for (let i = 0; i < Math.min(radius, n); i += 1) sum += source[start + i * stride] as number;
    for (let i = 0; i < n; i += 1) {
        if (i + radius < n) sum += source[start + (i + radius) * stride] as number;
        if (i - radius - 1 >= 0) sum -= source[start + (i - radius - 1) * stride] as number;
        target[start + i * stride] = sum;
    }
}

/** So viele Spalten laufen nebeneinander durch (WI-0227: 16 war auf 4096² am schnellsten, 8 und 32 langsamer). */
export const COLUMN_BLOCK = 16;

/** Die Zeilen `[from, to)` eines Durchgangs von `source` nach `target` (WI-0227: je Zeile unabhängig, also auch auf Threads). */
export function blurRows(
    source: Float32Array | Float64Array,
    target: Float32Array | Float64Array,
    n: number,
    radius: number,
    from: number,
    to: number,
): void {
    for (let y = from; y < to; y += 1) blurLine(source, target, y * n, 1, n, radius);
}

/**
 * Die Spalten `[from, to)` wie `blurLine` mit Schritt `n`, aber `COLUMN_BLOCK` Spalten zugleich, Zeile für Zeile (WI-0227). Je Spalte
 * dieselbe Summe in derselben Reihenfolge, also bytegleich; nur liest jede Zeile zusammenhängenden Speicher statt einer Zelle je 16 KB.
 * Jede Spalte rechnet für sich: Wie die Spalten auf Blöcke und Threads verteilt werden, ändert kein Bit.
 */
export function blurColumns(
    source: Float32Array | Float64Array,
    target: Float32Array | Float64Array,
    n: number,
    radius: number,
    from: number,
    to: number,
    sums: Float64Array = new Float64Array(COLUMN_BLOCK),
): void {
    const lead = Math.min(radius, n);
    for (let x0 = from; x0 < to; x0 += COLUMN_BLOCK) {
        const width = Math.min(COLUMN_BLOCK, to - x0);
        for (let b = 0; b < width; b += 1) sums[b] = 0;
        for (let i = 0; i < lead; i += 1) {
            const row = i * n + x0;
            for (let b = 0; b < width; b += 1) sums[b] = (sums[b] as number) + (source[row + b] as number);
        }
        for (let i = 0; i < n; i += 1) {
            if (i + radius < n) {
                const add = (i + radius) * n + x0;
                for (let b = 0; b < width; b += 1) sums[b] = (sums[b] as number) + (source[add + b] as number);
            }
            if (i - radius - 1 >= 0) {
                const sub = (i - radius - 1) * n + x0;
                for (let b = 0; b < width; b += 1) sums[b] = (sums[b] as number) - (source[sub + b] as number);
            }
            const out = i * n + x0;
            for (let b = 0; b < width; b += 1) target[out + b] = sums[b] as number;
        }
    }
}

export function blur(
    field: Float32Array | Float64Array,
    spare: Float32Array | Float64Array,
    n: number,
    radius: number,
): void {
    if (radius === 0) return;
    const sums = new Float64Array(COLUMN_BLOCK);
    for (let pass = 0; pass < 3; pass += 1) {
        blurRows(field, spare, n, radius, 0, n);
        blurColumns(spare, field, n, radius, 0, n, sums);
    }
}
