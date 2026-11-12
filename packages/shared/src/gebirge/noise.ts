/**
 * Wertrauschen mit fester Saat, Oktaven als fBm (hydrologie.js#L1420-1458, aff0449a5). Die
 * Ganzzahlschritte (`Math.imul`, `|0`, `>>>`) sind Legacys, sonst stimmt der Zufall nicht.
 */

/** Ganzzahl-Hash einer Gitterzelle auf [0, 1) (hydrologie.js#L1420-1426). */
export function hash2(seed: number, ix: number, iy: number): number {
    let n = (seed ^ Math.imul(ix, 0x85ebca6b) ^ Math.imul(iy, 0xc2b2ae35)) | 0;
    n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
    n ^= n >>> 12;
    n = Math.imul(n ^ (n >>> 15), 0x297a2d39);
    n ^= n >>> 15;
    return (n >>> 0) / 4294967296;
}

/** Glatt interpoliertes Wertrauschen auf [-1, 1] (hydrologie.js#L1428-1443). */
export function wertRauschen(seed: number, x: number, y: number, cell: number): number {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    const fx = x / cell - gx;
    const fy = y / cell - gy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash2(seed, gx, gy);
    const b = hash2(seed, gx + 1, gy);
    const c = hash2(seed, gx, gy + 1);
    const d = hash2(seed, gx + 1, gy + 1);
    const t = a + (b - a) * sx;
    const u = c + (d - c) * sx;
    return (t + (u - t) * sy) * 2 - 1;
}

/** Summe der Oktaven, je Oktave halbe Zelle und neue Saat, normiert (hydrologie.js#L1445-1458). */
export function fbm(seed: number, x: number, y: number, cell: number, oktaven: number, gain: number): number {
    let s = 0;
    let amp = 1;
    let tot = 0;
    let c = cell;
    for (let o = 0; o < oktaven; o++) {
        s += amp * wertRauschen(seed + o * 7919, x, y, c);
        tot += amp;
        amp *= gain;
        c /= 2;
    }
    return tot > 0 ? s / tot : 0;
}

/**
 * Das Zellmuster (WI-0226, nicht aus Legacy). Je Gitterzelle ein Mittelpunkt aus Saat und Gitterlage, versetzt um 15–85 % der Zelle,
 * damit die Berge gleichmäßig verteilt bleiben; die Lage davor verwirbelt (`warp` × Zelle), damit es nicht wie Waben aussieht.
 * Ergebnis: `c` = 1 in der Zellmitte und 0 auf der Grenze (Tal, Sattel); `hz` ist die Höhe der Zelle auf [0, 1).
 */
export function zellMuster(seed: number, x: number, y: number, cell: number, warp: number): { c: number; hz: number } {
    const wx = x + warp * cell * wertRauschen(seed + 101, x, y, cell * 0.7);
    const wy = y + warp * cell * wertRauschen(seed + 202, x, y, cell * 0.7);
    const gx = Math.floor(wx / cell);
    const gy = Math.floor(wy / cell);
    let f1 = Infinity;
    let f2 = Infinity;
    let hz = 0;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const cx = gx + dx;
            const cy = gy + dy;
            const px = (cx + 0.15 + 0.7 * hash2(seed + 11, cx, cy)) * cell;
            const py = (cy + 0.15 + 0.7 * hash2(seed + 13, cx, cy)) * cell;
            const d = Math.hypot(wx - px, wy - py);
            if (d < f1) {
                f2 = f1;
                f1 = d;
                hz = hash2(seed + 17, cx, cy);
            } else if (d < f2) {
                f2 = d;
            }
        }
    }
    return { c: (f2 - f1) / (f2 + f1 + 1e-9), hz };
}
