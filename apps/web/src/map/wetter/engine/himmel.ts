import { RAD, sstep, type Vec2, type Vec3 } from "./mathe";

/**
 * Atmosphäre: Streuung einmal je Sonnenstand in eine kleine Tabelle (`LW` × `LH`), dazu Sonnenfarbe und Himmelslicht oben und unten.
 * Nur Rechnung auf der CPU; das Hochladen der Tabelle macht die Engine (`T.sky`).
 */

export const LW = 48,
    LH = 40;

/** Sonnenstand und Licht, wie die Wolken sie lesen (`uSunDir`, `uSunH`, `uSun`, `uAmbTop`, `uAmbBot`). */
export interface Sonne {
    dir: Vec3;
    h: Vec2;
    color: number[];
    ambTop: number[];
    ambBot: number[];
    dirty: boolean;
}

export const neueSonne = (): Sonne => ({
    dir: [0, 1, 0],
    h: [1, 0],
    color: [20, 20, 20],
    ambTop: [1, 1, 1],
    ambBot: [0.2, 0.2, 0.2],
    dirty: true,
});

const R0 = 6360e3,
    RA = 6420e3,
    HR = 7994,
    HM = 1200,
    H0 = 1500,
    BR: Vec3 = [5.5e-6, 13e-6, 22.4e-6],
    BM = 7e-6;
const AMB_ZU: Vec3 = [0.003, 0.004, 0.007];
const AMB_BODEN: Vec3 = [0.11, 0.13, 0.11];

function sphereFar(py: number, dx: number, dy: number, dz: number, px: number, pz: number, r: number): number {
    const b = px * dx + py * dy + pz * dz,
        c = px * px + py * py + pz * pz - r * r,
        d = b * b - c;
    return d < 0 ? 0 : -b + Math.sqrt(d);
}

const rgbOut: Vec3 = [0, 0, 0];

function scatter(dx: number, dy: number, dz: number, sx: number, sy: number, sz: number, I: number): void {
    const N = 12,
        M = 4,
        ty = R0 + H0,
        tMax = sphereFar(ty, dx, dy, dz, 0, 0, RA),
        dt = tMax / N;
    let oR = 0,
        oM = 0,
        r0 = 0,
        r1 = 0,
        r2 = 0,
        m0 = 0,
        m1 = 0,
        m2 = 0;
    for (let i = 0; i < N; i++) {
        const t = (i + 0.5) * dt,
            px = dx * t,
            py = ty + dy * t,
            pz = dz * t,
            h = Math.sqrt(px * px + py * py + pz * pz) - R0;
        const hr = Math.exp(-h / HR) * dt,
            hm = Math.exp(-h / HM) * dt;
        oR += hr;
        oM += hm;
        const tl = sphereFar(py, sx, sy, sz, px, pz, RA),
            dl = tl / M;
        let lR = 0,
            lM = 0,
            ok = true;
        for (let j = 0; j < M; j++) {
            const s = (j + 0.5) * dl,
                qx = px + sx * s,
                qy = py + sy * s,
                qz = pz + sz * s,
                q = Math.sqrt(qx * qx + qy * qy + qz * qz) - R0;
            if (q < 0) {
                ok = false;
                break;
            }
            lR += Math.exp(-q / HR) * dl;
            lM += Math.exp(-q / HM) * dl;
        }
        if (!ok) continue;
        const mt = BM * 1.1 * (oM + lM),
            rt = oR + lR;
        const a0 = Math.exp(-BR[0] * rt - mt),
            a1 = Math.exp(-BR[1] * rt - mt),
            a2 = Math.exp(-BR[2] * rt - mt);
        r0 += a0 * hr;
        r1 += a1 * hr;
        r2 += a2 * hr;
        m0 += a0 * hm;
        m1 += a1 * hm;
        m2 += a2 * hm;
    }
    const mu = dx * sx + dy * sy + dz * sz,
        g = 0.76,
        pR = (3 / (16 * Math.PI)) * (1 + mu * mu),
        pM =
            ((3 / (8 * Math.PI)) * ((1 - g * g) * (1 + mu * mu))) /
            ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
    rgbOut[0] = I * (r0 * BR[0] * pR + m0 * BM * pM);
    rgbOut[1] = I * (r1 * BR[1] * pR + m1 * BM * pM);
    rgbOut[2] = I * (r2 * BR[2] * pR + m2 * BM * pM);
}

/** Rechnet Tabelle (`skyData`, RGBA je Feld) und Licht für Sonnenhöhe `sunEl` und Richtung `sunAz` in Grad, Stärke `sunPower`. */
export function berechneHimmel(
    sun: Sonne,
    skyData: Float32Array,
    sunEl: number,
    sunAz: number,
    sunPower: number,
): void {
    const el = sunEl * RAD,
        az = sunAz * RAD,
        ce = Math.cos(el),
        se = Math.sin(el),
        I = 20 * sunPower;
    sun.dir = [Math.sin(az) * ce, se, -Math.cos(az) * ce];
    const hl = Math.hypot(sun.dir[0], sun.dir[2]) || 1;
    sun.h = [sun.dir[0] / hl, sun.dir[2] / hl];
    for (let j = 0; j < LH; j++) {
        const v = (j + 0.5) / LH,
            e = (v * v * Math.PI) / 2,
            c = Math.cos(e),
            s = Math.sin(e);
        for (let i = 0; i < LW; i++) {
            const u = (i + 0.5) / LW,
                rel = u * u * Math.PI,
                o = (j * LW + i) * 4;
            scatter(Math.cos(rel) * c, s, Math.sin(rel) * c, ce, se, 0, I);
            const hz = Math.pow(1 - v, 4) * sstep(0.05, 0.4, se) * 0.75,
                lu = (rgbOut[0] + rgbOut[1] + rgbOut[2]) / 3;
            skyData[o] = (rgbOut[0] + (lu * 0.9 - rgbOut[0]) * hz) * 0.74 + 0.0015;
            skyData[o + 1] = (rgbOut[1] + (lu * 0.99 - rgbOut[1]) * hz) * 0.74 + 0.002;
            skyData[o + 2] = (rgbOut[2] + (lu * 1.11 - rgbOut[2]) * hz) * 0.74 + 0.004;
            skyData[o + 3] = 1;
        }
    }
    // Sonnenfarbe: Durchlässigkeit vom Beobachter zur Sonne
    const tl = sphereFar(R0 + H0, ce, se, 0, 0, 0, RA),
        M = 24,
        dl = tl / M;
    let oR = 0,
        oM = 0;
    for (let j = 0; j < M; j++) {
        const s = (j + 0.5) * dl,
            x = ce * s,
            y = R0 + H0 + se * s,
            h = Math.max(0, Math.hypot(x, y) - R0);
        oR += Math.exp(-h / HR) * dl;
        oM += Math.exp(-h / HM) * dl;
    }
    const fadeSun = sstep(-0.06, 0.02, se);
    sun.color = BR.map((b) => I * fadeSun * Math.exp(-b * oR - BM * 1.1 * oM));
    // Himmelslicht: kosinusgewichteter Mittelwert
    const amb: Vec3 = [0, 0, 0];
    let w = 0;
    for (const e of [12, 35, 65])
        for (let a = 0; a < 8; a++) {
            const r = e * RAD,
                g = Math.sin(r),
                phi = (a / 8) * 6.28318;
            scatter(Math.cos(phi) * Math.cos(r), g, Math.sin(phi) * Math.cos(r), ce, se, 0, I);
            amb[0] += rgbOut[0] * g;
            amb[1] += rgbOut[1] * g;
            amb[2] += rgbOut[2] * g;
            w += g;
        }
    sun.ambTop = amb.map((v, i) => v / w + AMB_ZU[i]!);
    const E = Math.max(se, 0) / Math.PI;
    sun.ambBot = AMB_BODEN.map((a, i) => a * (sun.color[i]! * E + sun.ambTop[i]!));
}
