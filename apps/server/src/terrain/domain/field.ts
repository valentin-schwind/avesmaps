/** Positive cubic B-spline reconstruction: C2 continuity, constant preservation, no membership overshoot. */
export function sampleSmoothField(field: { m: number; values: Float32Array }, n: number, x: number, y: number): number {
    const u = ((x + 0.5) * field.m) / n - 0.5,
        v = ((y + 0.5) * field.m) / n - 0.5;
    const ix = Math.floor(u),
        iy = Math.floor(v);
    const weights = (t: number): number[] => [
        (1 - t) ** 3 / 6,
        (3 * t ** 3 - 6 * t * t + 4) / 6,
        (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6,
        t ** 3 / 6,
    ];
    const wx = weights(u - ix),
        wy = weights(v - iy);
    let result = 0;
    let total = 0;
    for (let dy = 0; dy < 4; dy += 1) {
        const row = Math.max(0, Math.min(field.m - 1, iy + dy - 1)) * field.m;
        for (let dx = 0; dx < 4; dx += 1) {
            const weight = wy[dy]! * wx[dx]!;
            total += weight;
            result += weight * field.values[row + Math.max(0, Math.min(field.m - 1, ix + dx - 1))]!;
        }
    }
    return result / total;
}
