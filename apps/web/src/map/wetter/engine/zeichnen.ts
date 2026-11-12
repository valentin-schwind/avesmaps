import { DESIGN_CANON } from "@avesmaps3d/shared";
import { dunstUniforms } from "../wetter-dunst";
import { dropTarget, target, tri, use, type UniformWert, type Ziel } from "./gl";
import { DM, PN, SHADOW, type Gpu, type Kern } from "./kern";
import { clamp, RAD, sstep } from "./mathe";
import { zAb, zBild } from "./zeitmessung";

/**
 * Das Zeichnen: Wolken in Wolkenauflösung mit Schatten und Verlauf über die Zeit (in `prerender`), danach in `render` die Ausgabe mit
 * Partikeln und Niederschlag über dem Bild der Karte.
 */

type Uniforms = Record<string, UniformWert | undefined>;

/** Ein bekannter GL-Zustand für die eigenen Durchgänge; MapLibre stellt seinen danach selbst wieder her. */
export function grundzustand(gl: WebGL2RenderingContext): void {
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(false);
    gl.colorMask(true, true, true, true);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
}

// ---------- Skalierung
/** Die Wolkenauflösung als Anteil: von der Automatik (`"auto"`) oder fest. */
export const currentScale = (k: Kern): number => (k.cfg.res === "auto" ? k.RES_LEVELS[k.resLevel]! : Number(k.cfg.res));

const erf = (x: number): number => {
    const t = 1 / (1 + 0.3275911 * x);
    return (
        1 -
        ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
            t *
            Math.exp(-x * x)
    );
};

function hochGewicht(k: Kern): { uRad: number; uWn: number } {
    const sx = k.W / k.CW,
        sy = k.H / k.CH,
        r = Math.max(1, Math.max(sx, sy) / 2),
        e = (s: number): number => Math.min(1, (r / s) * 1.1713 * erf((0.7566 * s) / r));
    return { uRad: r, uWn: Math.max(e(sx) * e(sy), 1e-3) };
}

/** Bildpuffer an die Bildgröße und die Wolkenauflösung anpassen; ein neuer Verlauf beginnt ohne Geschichte. */
export function resize(k: Kern, g: Gpu): void {
    const { gl, F } = g;
    const W = gl.drawingBufferWidth,
        H = gl.drawingBufferHeight;
    k.W = W;
    k.H = H;
    const sc = currentScale(k),
        cw = Math.max(2, Math.ceil(W * sc)),
        ch = Math.max(2, Math.ceil(H * sc));
    if (cw !== k.CW || ch !== k.CH) {
        k.CW = cw;
        k.CH = ch;
        dropTarget(gl, F.cloud);
        F.cloud = target(gl, cw, ch, [{ f: gl.RGBA16F }, { f: gl.R32F, n: true }]);
    }
    if (W !== k.HW || H !== k.HH) {
        k.HW = W;
        k.HH = H;
        dropTarget(gl, F.hA);
        dropTarget(gl, F.hB);
        F.hA = target(gl, W, H, [{ f: gl.RGBA16F }]);
        F.hB = target(gl, W, H, [{ f: gl.RGBA16F }]);
        k.historyValid = false;
    }
}

// Detailstufe nach dem Bildpunkt, nicht nach dem Wolkenpunkt: Das Hochrechnen über die Zeit sammelt die Feinform aus den verwackelten Proben (höchstens doppelte Hochrechnung, darunter wird gröber).
const R2 = [0.7548776662, 0.569840291] as const;
// 🪤 Der Bildwinkel des Pixelwinkels in Grad. Der Prototyp las `map.transform?.fov ?? 36.87`; `map.transform` gibt es seit MapLibre 6 nicht
// mehr, es galt also immer 36,87 (die Vorgabe der Karte, gerundet). So bleibt es, bis jemand bewusst auf `args.fov` umstellt (wie `wasser-ebene.ts`).
const SICHTWINKEL = 36.87;

const acesKurve = (x: number): number => clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
let dunstMerk: { hex: string; belichtung: number; l: [number, number, number] } | undefined;

/**
 * Der Ton von Horizont und Dunst der Karte (Kanon `atmosphere.skyHorizon`, WI-0290) als Strahlung der Engine: durch Gamma und ACES
 * zurück, durch die Belichtung geteilt. Damit laufen die fernen Wolken in denselben Ton wie Gelände und Kulisse.
 */
export function dunstStrahlung(hex: string, belichtung: number): [number, number, number] {
    if (dunstMerk && dunstMerk.hex === hex && dunstMerk.belichtung === belichtung) return dunstMerk.l;
    const n = Number.parseInt(hex.slice(1), 16);
    const l = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((kanal) => {
        const ziel = Math.pow(kanal / 255, 2.2);
        let unten = 0,
            oben = 16;
        for (let i = 0; i < 40; i++) {
            const mitte = (unten + oben) / 2;
            if (acesKurve(mitte) < ziel) unten = mitte;
            else oben = mitte;
        }
        return (unten + oben) / 2 / Math.max(belichtung, 1e-3);
    }) as [number, number, number];
    dunstMerk = { hex, belichtung, l };
    return l;
}

/** Die Uniforms aller Zeichendurchgänge eines Bilds. */
export function uniforms(k: Kern, g: Gpu): Uniforms {
    const { T, F } = g,
        { cfg, sun, WL, cam, CW, CH, W, H } = k;
    const st = g.stufen;
    const jx = ((((k.frameNo * R2[0]) % 1) - 0.5) * 2) / CW,
        jy = ((((k.frameNo * R2[1]) % 1) - 0.5) * 2) / CH;
    const pixAng = (2 * Math.tan((SICHTWINKEL * RAD) / 2)) / Math.min(H, 2 * CH);
    return {
        uEye: k.eye,
        uInvVP: k.invVP ?? undefined,
        uSunDir: sun.dir,
        uSunH: sun.h,
        uSun: sun.color,
        uAmbTop: sun.ambTop,
        uAmbBot: sun.ambBot,
        uDunstL: dunstStrahlung(DESIGN_CANON.atmosphere.skyHorizon, cfg.exposure),
        ...dunstUniforms(k.dunst),
        uSky: T.sky,
        uTime: k.time + k.taktRest,
        uBase: 0.03,
        uThick: 4.3,
        uSchleier: cfg.schleier,
        uRegenKarte: cfg.regenkarte ? 1 : 0,
        uCov: cfg.cov,
        uScale: cfg.scale,
        uSigma: 73 * cfg.density,
        uOfs: [k.ofs[0] + 2.5 * cfg.wind * k.taktRest, k.ofs[1]],
        uNBase: T.nBase,
        uNDetail: T.nDetail,
        uW0: st[0]!.v,
        uW1: st[1]!.v,
        uW2: st[2]!.v,
        uD0: k.D0,
        uL1: [WL[1]!.c[0], WL[1]!.c[1], WL[1]!.e],
        uL2: [WL[2]!.c[0], WL[2]!.c[1], WL[2]!.e],
        uLw: [WL[1]!.w, WL[2]!.w],
        uUhr: k.uhr,
        uSchneeHang: cfg.schneeHang,
        uHS: k.hs,
        uK: k.hs / 3,
        uOben: ((k.peak / 1000) * k.hs) / 3 + 0.01,
        uHang: k.hangMax * k.hs,
        uHM: T.hm,
        uSnow: F.snow.tex[0],
        uTN: cfg.tn,
        uTS: cfg.ts,
        uKW0: T.kw0,
        uKW1: T.kw1,
        uKW2: T.kw2,
        "uSG[0]": k.sg,
        uSchnee: k.schneeAn,
        uLinie: cfg.linie ? 1 : 0,
        uWolken: cfg.wolken ? 1 : 0,
        uSchatten: cfg.schatten,
        uCloudShadow: F.cloudShadow.tex[0],
        uShadowCtr: k.shadowCtr,
        uShadowExt: k.shadowExt,
        uVP: k.vp ?? undefined,
        uRes: [W, H],
        uMaxD: 220 + cam.dist * 3,
        uSteps: cfg.steps,
        uShafts: cfg.shafts,
        uPixAng: pixAng,
        uFrame: k.frameNo % 1024,
        uJit: [jx, jy],
        uExposure: cfg.exposure,
        uVel: F.u.tex[0],
    };
}

/** Wolkenschatten (jedes zweite Bild), Wolken in Wolkenauflösung, Verlauf in voller Bildgröße. */
export function zeichneWolken(k: Kern, g: Gpu, U: Uniforms, cloud: Ziel, hA: Ziel, hB: Ziel): void {
    const { gl, P, F, vao } = g,
        { cfg, cam } = k;
    zAb(gl, k.uhrGpu, "schatten");
    // Nur, wenn ihn jemand liest: Schatten am Boden oder Lichtstrahlen (am Telefon beide 0, `TELEFON_PROFIL`).
    if (cfg.wolken && (cfg.schatten > 0 || cfg.shafts > 0) && k.frameNo % 2 === 1) {
        // Wie im Prototyp ein Viertel des Abstands nach vorn: Flach geneigt liegt fast alles, was man sieht, vor dem Kamerapunkt.
        const vx = cam.tx - k.eye[0],
            vz = cam.tz - k.eye[2],
            vl = Math.hypot(vx, vz) || 1,
            ext = clamp(cam.dist * 3.2 + 20, 40, 5000),
            tx = ext / SHADOW,
            cx = Math.round((cam.tx + (vx / vl) * cam.dist * 0.25) / tx) * tx,
            cz = Math.round((cam.tz + (vz / vl) * cam.dist * 0.25) / tx) * tx;
        gl.bindFramebuffer(gl.FRAMEBUFFER, F.cloudShadow.fb);
        gl.viewport(0, 0, SHADOW, SHADOW);
        use(gl, P.shadow, { ...U, uCtr: [cx, cz], uExt: ext });
        tri(gl, vao);
        k.shadowCtr = [cx, cz];
        k.shadowExt = ext;
        U["uShadowCtr"] = k.shadowCtr;
        U["uShadowExt"] = ext;
    }
    zAb(gl, k.uhrGpu, "wolken");
    gl.bindFramebuffer(gl.FRAMEBUFFER, cloud.fb);
    gl.viewport(0, 0, k.CW, k.CH);
    use(gl, P.cloud, U);
    tri(gl, vao);
    zAb(gl, k.uhrGpu, "taa");
    gl.bindFramebuffer(gl.FRAMEBUFFER, hB.fb);
    gl.viewport(0, 0, k.W, k.H);
    use(gl, P.taa, {
        ...U,
        uCur: cloud.tex[0],
        uCurD: cloud.tex[1],
        uHist: hA.tex[0],
        uPrevVP: k.prevVP ?? undefined,
        uCloudRes: [k.CW, k.CH],
        uReset: k.historyValid ? 0 : 1,
        ...hochGewicht(k),
    });
    tri(gl, vao);
    zAb(gl, k.uhrGpu, null);
}

export const partikelZahl = (k: Kern): number => Math.min(PN * PN, Math.round(4800 * k.cfg.pmenge));

function zeichnePartikel(k: Kern, g: Gpu, U: Uniforms, vp: Float32Array): void {
    const { gl, P, F, vao } = g,
        { cfg, cam } = k;
    if (!cfg.partikel && !cfg.meer) return;
    const mass = k.H / 900,
        mitte = vp[3]! * cam.tx + vp[11]! * cam.tz + vp[15]!;
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.bindVertexArray(vao);
    if (cfg.meer) {
        use(gl, P.seg, {
            ...U,
            uVel: F.m.tex[0],
            uD0: DM,
            uPart: g.pm.A.tex[0],
            uTrail: 0.005 * cfg.mlang * cam.dist,
            uW: 3.4 * cfg.mbreit * mass,
            uA: cfg.mhell,
            uFarbe: 0,
            uTon: [0.2, 0.95, 0.85],
            uMinTempo: 1.2,
            uMitte: mitte,
        });
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 60, Math.min(PN * PN, Math.round(4000 * cfg.mmenge)));
    }
    if (cfg.partikel) {
        use(gl, P.seg, {
            ...U,
            uPart: g.pt.A.tex[0],
            uTrail: 0.004 * cfg.plang * cam.dist,
            uW: 3.4 * cfg.pbreit * mass,
            uA: cfg.phell,
            uFarbe: cfg.pfarbe ? 1 : 0,
            uTon: [0.93, 0.98, 1],
            uMinTempo: 0,
            uMitte: mitte,
        });
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 60, partikelZahl(k));
    }
}

// Nur nah: Weiter weg sind Regen und Schnee nicht zu erkennen.
function zeichneNiederschlag(k: Kern, g: Gpu, U: Uniforms, vp: Float32Array): void {
    const { gl, P, vao } = g,
        { cfg, cam } = k;
    const nah = 1 - sstep(cfg.nahVoll, cfg.nahAb, cam.dist);
    if (!cfg.niederschlag || nah <= 0) return;
    const kk = Math.log2(Math.max(cam.dist, 2) * 2.6),
        k1 = Math.ceil(kk),
        f = k1 - kk,
        n = Math.round(14000 * cfg.nmenge);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.bindVertexArray(vao);
    for (const [e, a] of [
        [2 ** k1, 1 - f],
        [2 ** (k1 - 1), f],
    ] as const) {
        if (a <= 0.01) continue;
        use(gl, P.ns, {
            ...U,
            uCam: [cam.tx, cam.tz],
            uExt: e,
            uFade: a * nah,
            uA: cfg.nhell,
            uGross: cfg.ngross,
            uMass: k.H / 900,
            uMitte: vp[3]! * cam.tx + vp[11]! * cam.tz + vp[15]!,
        });
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    }
}

/** `render`: das Wolkenbild über die Karte, Partikel darunter (mit Wolken) oder darüber (ohne), zuletzt der Niederschlag. */
export function zeichneAusgabe(k: Kern, g: Gpu, U: Uniforms, hA: Ziel, vp: Float32Array): void {
    const { gl, P, vao } = g,
        cfg = k.cfg;
    grundzustand(gl);
    gl.enable(gl.BLEND);
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, k.W, k.H);
    // Mit Wolken liegen die Partikel darunter, ohne Wolken obenauf, damit auch der Schnee sie nicht verdeckt.
    zAb(gl, k.uhrGpu, "partikel");
    if (cfg.wolken) zeichnePartikel(k, g, U, vp);
    zAb(gl, k.uhrGpu, "ausgabe");
    gl.blendFuncSeparate(gl.ONE, gl.SRC_ALPHA, gl.ZERO, gl.ONE);
    use(gl, P.aus, { ...U, uCloud: hA.tex[0] });
    tri(gl, vao);
    zAb(gl, k.uhrGpu, "partikel");
    if (!cfg.wolken) zeichnePartikel(k, g, U, vp);
    zAb(gl, k.uhrGpu, "niederschlag");
    zeichneNiederschlag(k, g, U, vp);
    zAb(gl, k.uhrGpu, null);
    zBild(k.uhrGpu);
    gl.bindVertexArray(null);
}
