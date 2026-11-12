import { hoeheAt, vegAt } from "./daten";
import type { Ziel } from "./gl";
import { DM, MN, VN, type Gpu, type Kern } from "./kern";
import { clamp } from "./mathe";
import type { Verteilung, WindMessung } from "./typen";

/**
 * Messungen für die Werkzeuge unter `project-control/discovery/wi-0288-wetter-messung/`: Zahlen statt nur Bilder. Sie lesen die Felder
 * der GPU zurück und kosten darum je Aufruf einige Millisekunden; im Betrieb ruft sie niemand.
 */

const q = (a: number[], p: number): number => {
    if (!a.length) return 0;
    a.sort((m, n) => m - n);
    return +a[Math.min(a.length - 1, Math.floor(a.length * p))]!.toFixed(2);
};
const verteile = (a: number[]): Verteilung => ({ n: a.length, mitte: q(a, 0.5), p95: q(a, 0.95) });

/** Wolke, Regen, Dampf und weitere Werte einer Zelle (Spalten wie in `messeWind`). */
type Probe = readonly number[];
const mittel = (a: readonly Probe[], n: number, m: number, stellen: number): number =>
    +(a.reduce((b, c) => b + c[m]!, 0) / n).toFixed(stellen);

// Windtempo je Lage aus dem Strömungsfeld, damit die Prüfung Zahlen statt nur Bilder hat.
export function messeWind(k: Kern, g: Gpu): WindMessung {
    const { gl, F } = g,
        { cfg, D0, CELL } = k;
    const hoehe = (x: number, z: number): number => hoeheAt(k.hoehen, x, z);
    const r = new Float32Array(VN * VN * 4),
        wg = { meer: [] as number[], land: [] as number[], kamm: [] as number[] },
        hoch: number[] = [];
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.u.fb);
    gl.readPixels(0, 0, VN, VN, gl.RGBA, gl.FLOAT, r);
    for (let j = 0; j < VN; j++)
        for (let i = 0; i < VN; i++) {
            const x = D0[0] + (i + 0.5) * CELL,
                z = D0[1] + (j + 0.5) * CELL;
            if (x < 0 || x > 1024 || z < 0 || z > 1024) continue;
            const h = hoehe(x, z),
                o = (j * VN + i) * 4,
                b = Math.hypot(r[o]!, r[o + 1]!);
            if (h > 0) hoch.push(h);
            (h <= 0 ? wg.meer : h < cfg.schicht * 0.4 ? wg.land : wg.kamm).push(b);
        }
    const land = verteile(wg.land),
        kamm = verteile(wg.kamm);
    const hoehen = { p50: q(hoch, 0.5), p90: q(hoch, 0.9), p99: q(hoch, 0.99), max: q(hoch, 1) };
    const mf = new Float32Array(MN * MN * 4),
        mg = { meer: [] as number[], land: [] as number[] };
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.m.fb);
    gl.readPixels(0, 0, MN, MN, gl.RGBA, gl.FLOAT, mf);
    for (let j = 0; j < MN; j += 2)
        for (let i = 0; i < MN; i += 2) {
            const o = (j * MN + i) * 4;
            (hoehe(DM[0] + ((i + 0.5) * DM[2]) / MN, DM[1] + ((j + 0.5) * DM[2]) / MN) > 0 ? mg.land : mg.meer).push(
                Math.hypot(mf[o]!, mf[o + 1]!),
            );
        }
    const meer = { meer: verteile(mg.meer), land: verteile(mg.land) };
    const l = k.WL[0]!,
        S = l.res,
        A = new Float32Array(S * S * 4),
        Z = new Float32Array(S * S * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.stufen[0]!.a.fb);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, S, S, gl.RGBA, gl.FLOAT, A);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, S, S, gl.RGBA, gl.FLOAT, Z);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    const lage = { meer: [] as Probe[], flach: [] as Probe[], luv: [] as Probe[], lee: [] as Probe[] };
    for (let j = 0; j < S; j += 2)
        for (let i = 0; i < S; i += 2) {
            const x = D0[0] + ((i + 0.5) * l.e) / S,
                z = D0[1] + ((j + 0.5) * l.e) / S;
            if (x < 0 || x > 1024 || z < 0 || z > 1024) continue;
            const iv = Math.min(VN - 1, Math.floor((x - D0[0]) / CELL)),
                jv = Math.min(VN - 1, Math.floor((z - D0[1]) / CELL)),
                ov = (jv * VN + iv) * 4,
                sx = (hoehe(x + 16, z) - hoehe(x - 16, z)) / 96000,
                sz = (hoehe(x, z + 16) - hoehe(x, z - 16)) / 96000,
                hg = r[ov]! * sx + r[ov + 1]! * sz,
                h = hoehe(x, z),
                g2 =
                    h <= 0
                        ? lage.meer
                        : hg > 0.12
                          ? lage.luv
                          : hg < -0.12
                            ? lage.lee
                            : Math.abs(hg) < 0.02
                              ? lage.flach
                              : null;
            if (!g2) continue;
            const o = (j * S + i) * 4;
            g2.push([
                A[o]!,
                A[o + 3]!,
                Z[o]!,
                Z[o + 1]! - (cfg.tn + ((cfg.ts - cfg.tn) * z) / 1024),
                A[o + 1]!,
                A[o + 2]!,
            ]);
        }
    const vk = {
        wueste: [] as Probe[],
        eis: [] as Probe[],
        trocken: [] as Probe[],
        mittel: [] as Probe[],
        wald: [] as Probe[],
        nass: [] as Probe[],
    };
    for (let j = 0; j < S; j += 2)
        for (let i = 0; i < S; i += 2) {
            const x = D0[0] + ((i + 0.5) * l.e) / S,
                z = D0[1] + ((j + 0.5) * l.e) / S;
            if (x < 0 || x > 1024 || z < 0 || z > 1024 || hoehe(x, z) <= 0) continue;
            const v = vegAt(k.veg, x, z),
                o = (j * S + i) * 4;
            (v < 0.075
                ? vk.wueste
                : v < 0.2
                  ? vk.eis
                  : v < 0.4
                    ? vk.trocken
                    : v < 0.62
                      ? vk.mittel
                      : v < 0.85
                        ? vk.wald
                        : vk.nass
            ).push([A[o]!, A[o + 3]!, Z[o]!, Z[o + 1]!]);
        }
    const vegetation: Record<string, WindMessung["vegetation"][string]> = {};
    for (const [name, a] of Object.entries(vk)) {
        const n = Math.max(a.length, 1);
        vegetation[name] = {
            n: a.length,
            wolke: mittel(a, n, 0, 3),
            regen: mittel(a, n, 1, 3),
            dampf: mittel(a, n, 2, 3),
            temp: mittel(a, n, 3, 3),
        };
    }
    const wetter: Record<string, WindMessung["wetter"][string]> = {};
    for (const [name, a] of Object.entries(lage)) {
        const n = Math.max(a.length, 1);
        wetter[name] = {
            n: a.length,
            wolke: mittel(a, n, 0, 2),
            regen: mittel(a, n, 1, 2),
            dampf: mittel(a, n, 2, 2),
            waerme: mittel(a, n, 3, 2),
            basis: mittel(a, n, 4, 2),
            oben: mittel(a, n, 5, 2),
            bedeckt: +(a.filter((c) => c[0]! > 0.5).length / n).toFixed(2),
        };
    }
    const wirbel: { x: number; z: number; augeKm: number; profil: number[][] }[] = [];
    const { gP, gV } = k;
    for (let gi = 0; gi < k.gN; gi++) {
        if (gV[gi * 4 + 2] === 0) continue;
        const b = Array.from({ length: 12 }, () => [0, 0, 0, 0] as [number, number, number, number]),
            offen = [0] as [number];
        const gx = gP[gi * 4]!,
            gz = gP[gi * 4 + 1]!,
            gr = gP[gi * 4 + 2]!;
        for (let j = 0; j < S; j++)
            for (let i = 0; i < S; i++) {
                let dx = D0[0] + ((i + 0.5) * l.e) / S - gx,
                    dz = D0[1] + ((j + 0.5) * l.e) / S - gz;
                dx -= l.e * Math.round(dx / l.e);
                dz -= l.e * Math.round(dz / l.e);
                const dr = Math.hypot(dx, dz),
                    o = (j * S + i) * 4;
                if (dr < gr * 0.25 && A[o]! <= 0.5) offen[0]++;
                const kk = Math.floor(dr / gr / 0.125);
                if (kk >= 12) continue;
                const fach = b[kk]!;
                fach[0]++;
                fach[1] += A[o]!;
                fach[2] += A[o]! > 0.5 ? 1 : 0;
                fach[3] += A[o + 2]!;
            }
        wirbel.push({
            x: Math.round(gx),
            z: Math.round(gz),
            augeKm: 2 * Math.sqrt(offen[0] / Math.PI) * (l.e / S) * 3,
            profil: b.map((c) => [
                +(c[1] / Math.max(c[0], 1)).toFixed(2),
                +(c[2] / Math.max(c[0], 1)).toFixed(2),
                +(c[3] / Math.max(c[0], 1)).toFixed(1),
            ]),
        });
    }
    // 🪤 Wie im Prototyp steht unter `meer` die Meeresströmung; das Windtempo über dem Meer überschrieb sie dort schon immer.
    return { meer, land, kamm, hoehen, vegetation, wetter, wirbel };
}

/** Der Anteil des Bilds, den Wolken decken (jeder vierte Bildpunkt des Verlaufs). */
export function leseDeckung(k: Kern, g: Gpu, hA: Ziel): number {
    const gl = g.gl;
    const r = new Float32Array(k.W * k.H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, hA.fb);
    gl.readPixels(0, 0, k.W, k.H, gl.RGBA, gl.FLOAT, r);
    let a = 0,
        n = 0;
    for (let i = 3; i < r.length; i += 16) {
        a += 1 - clamp(r[i]!);
        n++;
    }
    return +(a / n).toFixed(4);
}

/** Deckung und Helligkeit in einem Raster von `ng`² Punkten um die Bildmitte (Halbbreite `rw`, Höhe `yw`). */
export function leseFenster(
    k: Kern,
    g: Gpu,
    hA: Ziel,
    vp: Float32Array,
    rw: number,
    ng: number,
    yw: number,
): { deck: number[]; hell: number[] } {
    const gl = g.gl,
        { cfg, cam, W, H } = k;
    const r = new Float32Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, hA.fb);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, r);
    const deck = new Float32Array(ng * ng),
        hell = new Float32Array(ng * ng),
        ton = (x: number): number => {
            x *= cfg.exposure;
            return Math.pow(clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)), 1 / 2.2);
        };
    for (let j = 0; j < ng; j++)
        for (let i = 0; i < ng; i++) {
            const x = cam.tx + (((i + 0.5) / ng) * 2 - 1) * rw,
                z = cam.tz + (((j + 0.5) / ng) * 2 - 1) * rw,
                w = vp[3]! * x + vp[7]! * yw + vp[11]! * z + vp[15]!,
                u = ((vp[0]! * x + vp[4]! * yw + vp[8]! * z + vp[12]!) / w) * 0.5 + 0.5,
                v = ((vp[1]! * x + vp[5]! * yw + vp[9]! * z + vp[13]!) / w) * 0.5 + 0.5,
                px = Math.min(W - 1, Math.max(0, Math.floor(u * W))),
                py = Math.min(H - 1, Math.max(0, Math.floor(v * H))),
                o = (py * W + px) * 4,
                a = 1 - clamp(r[o + 3]!),
                l = r[o]! * 0.2126 + r[o + 1]! * 0.7152 + r[o + 2]! * 0.0722;
            deck[j * ng + i] = a;
            hell[j * ng + i] = ton(l) + (1 - a) * 0.3;
        }
    return { deck: Array.from(deck), hell: Array.from(hell) };
}
