import type { Map as MapLibreMap } from "maplibre-gl";
import type { DunstLage } from "../../atmosphere/dunst-tiefe";
import type { Hoehen } from "./daten";
import { progStart, target, tex2, wrapRepeat, type Farbe, type Programm, type UniformWert, type Ziel } from "./gl";
import { LW, LH, neueSonne, type Sonne } from "./himmel";
import type { Vec2, Vec3 } from "./mathe";
import { neuesRauschen, type Rauschen, type RauschTexturen } from "./rauschen";
import { FS_NOISE } from "./shader/rauschen";
import { VS_TRI } from "./shader/bausteine";
import {
    FS_CURL,
    FS_DIV,
    FS_GEWICHT,
    FS_JAC,
    FS_MEER,
    FS_MEERTIEFE,
    FS_PROJ,
    FS_TIEFE,
    FS_VEL,
} from "./shader/stroemung";
import { FS_NS, FS_PART, FS_SEG, VS_NS, VS_SEG } from "./shader/teilchen";
import { FS_SCROLL, FS_SNOW, FS_WX } from "./shader/wetter";
import { FS_AUS, FS_CLOUD, FS_CLOUDSHADOW, FS_TAA } from "./shader/wolken";
import type { WetterCfg } from "./typen";
import type { GpuUhr } from "./zeitmessung";

/**
 * Der Zustand der Wetter-Engine: `Kern` hält alles, was die CPU rechnet und merkt, `Gpu` die Programme, Texturen und Bildpuffer im
 * GL-Kontext der Karte (ab `initGL`). Die Module der Engine rechnen mit beiden; die Fabrik (`wetter-engine.ts`) verbindet sie.
 *
 * Weltkoordinaten: x,z in Karteneinheiten (0 bis 1024), y nach oben, 1 Einheit = 3.000 Schritt. Das Grundfeld ist periodisch und größer
 * als die Karte; zwei feinere Fenster folgen der Kamera.
 */

export const SHADOW = 512,
    MAXG = 8,
    VN = 1024,
    PN = 256,
    MN = 512;
/** Das Feld der Meeresströmung: 512² über 1.536 Einheiten (9 km je Zelle). */
export const DM: Vec3 = [-256, -256, 1536];
export const WARM_STEPS = 320;

/** Eine Wetterstufe: das Grundfeld oder ein feineres Fenster um die Kamera. */
export interface Stufe {
    /** Mitte in Karteneinheiten. */
    c: Vec2;
    /** Ausdehnung in Karteneinheiten. */
    readonly e: number;
    /** Zellen je Seite. */
    readonly res: number;
    on: boolean;
    stale: boolean;
    /** Maßstab und Rate der mitgeführten Struktur. */
    readonly mf: number;
    readonly mr: number;
    /** Gewicht beim Lesen (Überblendung nach Kameraabstand). */
    w: number;
}

/** Die Bildpuffer einer Stufe: Anzeige und Zustand im Wechsel, dazu die 16-Bit-Kopie zum Zeichnen (`v`). */
export interface StufenPuffer {
    a: Ziel;
    b: Ziel;
    readonly v: WebGLTexture;
}

export interface ZielPaar {
    A: Ziel;
    B: Ziel;
}

export interface Felder {
    readonly tiefe: Ziel;
    u: Ziel;
    u2: Ziel;
    readonly curl: Ziel;
    readonly div: Ziel;
    readonly jw: Ziel;
    readonly mjw: Ziel;
    p: Ziel;
    p2: Ziel;
    snow: Ziel;
    snow2: Ziel;
    readonly mt: Ziel;
    m: Ziel;
    m2: Ziel;
    readonly md: Ziel;
    mp: Ziel;
    mp2: Ziel;
    readonly cloudShadow: Ziel;
    /** Wolken in Wolkenauflösung und der Verlauf in voller Bildgröße, angelegt von `resize`. */
    cloud: Ziel | null;
    hA: Ziel | null;
    hB: Ziel | null;
}

export interface Texturen extends RauschTexturen {
    readonly sky: WebGLTexture;
    hm?: WebGLTexture;
    veg?: WebGLTexture;
    kw0?: WebGLTexture;
    kw1?: WebGLTexture;
    kw2?: WebGLTexture;
}

const VOLLBILD = {
    noise: FS_NOISE,
    tiefe: FS_TIEFE,
    curl: FS_CURL,
    vel: FS_VEL,
    div: FS_DIV,
    jac: FS_JAC,
    proj: FS_PROJ,
    gewicht: FS_GEWICHT,
    wx: FS_WX,
    snow: FS_SNOW,
    scroll: FS_SCROLL,
    part: FS_PART,
    shadow: FS_CLOUDSHADOW,
    cloud: FS_CLOUD,
    taa: FS_TAA,
    aus: FS_AUS,
    meertiefe: FS_MEERTIEFE,
    meer: FS_MEER,
} as const;
export type Programme = Record<keyof typeof VOLLBILD | "seg" | "ns", Programm>;

export interface Gpu {
    readonly gl: WebGL2RenderingContext;
    readonly vao: WebGLVertexArrayObject;
    /** Der Name der Grafikkarte für die Messzeile des Telefon-Tests (`stand().gpu`); ohne die Erweiterung leer. */
    readonly gpuName: string;
    readonly parallel: KHR_parallel_shader_compile | null;
    readonly P: Programme;
    readonly T: Texturen;
    readonly F: Felder;
    /** Je Stufe von `Kern.WL` ihre Bildpuffer. */
    readonly stufen: readonly StufenPuffer[];
    /** Windpartikel und Partikel der Meeresströmung, je zwei Zustände im Wechsel. */
    readonly pt: ZielPaar;
    readonly pm: ZielPaar;
}

/** Ein Wunsch der Messwerkzeuge, eingelöst im nächsten Bild. */
export interface FensterWunsch {
    readonly r: number;
    readonly n: number;
    readonly y: number;
    readonly fertig: (aus: { deck: number[]; hell: number[] }) => void;
}

export interface Kern {
    readonly map: MapLibreMap;
    readonly cfg: WetterCfg;
    // ---- Raster, fest ab dem Entstehen (Folge `neustart` im Wettermodell)
    readonly D0: Vec3;
    readonly W0: number;
    readonly CELL: number;
    readonly PX: Vec2;
    readonly WL: readonly Stufe[];
    /** Die Stufen der Wolkenauflösung (Automatik) von der gröbsten an, und die Takte der Rechnung in Sekunden je Schritt. */
    readonly RES_LEVELS: readonly number[];
    readonly TAKTE: readonly number[];
    // ---- Antrieb durch die Symbole: Lage und Wirkung je Quelle (Wind und Wirbel, Meeresströmung)
    readonly gP: Float32Array;
    readonly gV: Float32Array;
    readonly mP: Float32Array;
    readonly mV: Float32Array;
    gN: number;
    mN: number;
    /** Schneefallgrenze der Wegfindung in Schritt je Wert des Klimarasters (WI-0288 Stufe 5): 0 keine Zone, 1 bis 8 die Zonen, −1 ohne Grenze. Der Jahreslauf (`wetter-jahr.ts`) schreibt hinein. */
    readonly sg: Float32Array;
    // ---- Simulation
    time: number;
    /** Die eigene Uhr von Regen und Schnee, unabhängig vom Simulationstempo. */
    uhr: number;
    paused: boolean;
    ofs: Vec2;
    wxStart: boolean;
    tiefeFuer: number | null;
    meerMaske: boolean;
    // ---- Takt der Rechnung (`TAKTE`): Stufe der Automatik, Wartezeit, aufgelaufene Zeit, Schritt in Arbeit und seine Hälfte
    taktStufe: number;
    taktWarte: number;
    taktRest: number;
    taktDt: number;
    phase: number;
    // ---- Daten der Karte
    hoehen: Hoehen | null;
    peak: number;
    hangMax: number;
    veg: Uint8Array | null;
    klima: Uint8Array | null;
    // ---- Kamera
    readonly cam: { tx: number; tz: number; dist: number };
    eye: Vec3;
    vp: Float32Array | null;
    prevVP: Float32Array | null;
    invVP: Float32Array | null;
    /** Der Dunst des Geländes in diesem Bild (`dunst-tiefe.ts`): Das Wetter weicht ihm (`wetter-dunst.ts`). */
    dunst: DunstLage | undefined;
    hs: number;
    frameNo: number;
    // ---- Himmel
    readonly sun: Sonne;
    readonly skyData: Float32Array;
    // ---- Partikel: wie viele je Bild neu entstehen, und wo die Kamera beim letzten Bild stand
    readonly pt: { neu: number; d: number; x: number; z: number };
    // ---- Bild
    W: number;
    H: number;
    CW: number;
    CH: number;
    HW: number;
    HH: number;
    historyValid: boolean;
    resLevel: number;
    shadowCtr: Vec2;
    shadowExt: number;
    schneeAn: number;
    U: Record<string, UniformWert | undefined> | null;
    readonly rauschen: Rauschen;
    // ---- Messung (Werkzeuge unter `project-control/discovery/wi-0288-wetter-messung/`)
    readonly uhrGpu: GpuUhr;
}

export function erzeugeKern(map: MapLibreMap, cfg: WetterCfg): Kern {
    const D0: Vec3 = [(1024 - cfg.eFern) / 2, (1024 - cfg.eFern) / 2, cfg.eFern];
    const W0 = cfg.rFern,
        WN = cfg.rMittel;
    const RES_LEVELS = [cfg.resMin, ...[0.25, 0.33, 0.4, 0.5, 0.6, 0.7, 0.85, 1].filter((l) => l > cfg.resMin + 1e-6)];
    return {
        map,
        cfg,
        D0,
        W0,
        CELL: D0[2] / VN,
        PX: [1 / VN, 1 / VN],
        WL: [
            { c: [512, 512], e: D0[2], res: W0, on: true, stale: false, mf: 1 / 46, mr: 0.05, w: 1 },
            { c: [512, 512], e: cfg.eMittel, res: WN, on: false, stale: true, mf: 1 / 18, mr: 0.12, w: 0 },
            { c: [512, 512], e: cfg.eNah, res: cfg.rNah, on: false, stale: true, mf: 1 / 4.5, mr: 0.25, w: 0 },
        ],
        RES_LEVELS,
        TAKTE: [1 / cfg.takt, 1.5 / cfg.takt, 2 / cfg.takt, 3 / cfg.takt],
        gP: new Float32Array(MAXG * 4),
        gV: new Float32Array(MAXG * 4),
        mP: new Float32Array(MAXG * 4),
        mV: new Float32Array(MAXG * 4),
        gN: 0,
        mN: 0,
        sg: new Float32Array(12).fill(-1),
        time: 0,
        uhr: 0,
        paused: false,
        ofs: [0, 0],
        wxStart: true,
        tiefeFuer: null,
        meerMaske: false,
        taktStufe: 0,
        taktWarte: 0,
        taktRest: 0,
        taktDt: 0,
        phase: 0,
        hoehen: null,
        peak: 0,
        hangMax: 0.1,
        veg: null,
        klima: null,
        cam: { tx: 512, tz: 512, dist: 1500 },
        eye: [0, 0, 0],
        vp: null,
        prevVP: null,
        invVP: null,
        dunst: undefined,
        hs: 0,
        frameNo: 0,
        sun: neueSonne(),
        skyData: new Float32Array(LW * LH * 4),
        pt: { neu: 0, d: 0, x: 0, z: 0 },
        W: 0,
        H: 0,
        CW: 0,
        CH: 0,
        HW: 0,
        HH: 0,
        historyValid: false,
        // Die Automatik beginnt bei halber Auflösung; das Telefon-Profil gröber (`resStart`, `wetter-ebene.ts`).
        resLevel: Math.max(
            0,
            RES_LEVELS.findIndex((l) => l >= (cfg.resStart ?? 0.5) - 1e-6),
        ),
        shadowCtr: [512, 512],
        shadowExt: 3000,
        schneeAn: -1,
        U: null,
        rauschen: neuesRauschen(),
        uhrGpu: { zm: null },
    };
}

/** Aufbau im GL-Kontext der Karte: Programme anstoßen, Texturen und Bildpuffer anlegen. */
export function initGL(k: Kern, gl: WebGL2RenderingContext): Gpu {
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
    if (!gl.getExtension("EXT_color_buffer_float"))
        throw Error("Diese Grafikkarte kann nicht in Gleitkomma-Puffer zeichnen.");
    const vao = gl.createVertexArray();
    const parallel = gl.getExtension("KHR_parallel_shader_compile");
    const vollbild = {} as Record<keyof typeof VOLLBILD, Programm>;
    for (const name of Object.keys(VOLLBILD) as (keyof typeof VOLLBILD)[])
        vollbild[name] = progStart(gl, VS_TRI, VOLLBILD[name]);
    const P: Programme = { ...vollbild, seg: progStart(gl, VS_SEG, FS_SEG), ns: progStart(gl, VS_NS, FS_NS) };
    const T: Texturen = { sky: tex2(gl, LW, LH, gl.RGBA16F) };
    const rgbaF: Farbe = { f: gl.RGBA16F },
        fein = gl.getExtension("OES_texture_float_linear"),
        wxF: Farbe = { f: fein ? gl.RGBA32F : gl.RGBA16F },
        snF: Farbe = { f: fein ? gl.R32F : gl.R16F };
    const VN2 = (colors: readonly Farbe[]): Ziel => target(gl, VN, VN, colors);
    const MN2 = (colors: readonly Farbe[]): Ziel => target(gl, MN, MN, colors);
    const tiefe = VN2([rgbaF]),
        u = wrapRepeat(gl, VN2([rgbaF])),
        u2 = wrapRepeat(gl, VN2([rgbaF])),
        curl = wrapRepeat(gl, VN2([{ f: gl.R16F }]));
    const div = wrapRepeat(gl, VN2([{ f: gl.R32F, n: true }])),
        jw = VN2([{ f: gl.RGBA32F, n: true }]),
        mjw = MN2([{ f: gl.RGBA32F, n: true }]),
        p = wrapRepeat(gl, VN2([{ f: gl.R32F, n: true }])),
        p2 = wrapRepeat(gl, VN2([{ f: gl.R32F, n: true }]));
    // Zum Zeichnen schreibt jede Stufe eine Kopie in 16 Bit mit: Die Wolken lesen das Wetterfeld je Schritt mehrfach, halbe Breite halbiert den Speicherweg. Gerechnet wird weiter in 32 Bit.
    const stufen = k.WL.map((l, i): StufenPuffer => {
        const s: StufenPuffer = {
            a: target(gl, l.res, l.res, [wxF, wxF]),
            b: target(gl, l.res, l.res, [wxF, wxF]),
            v: tex2(gl, l.res, l.res, gl.RGBA16F),
        };
        if (i === 0) {
            wrapRepeat(gl, s.a);
            wrapRepeat(gl, s.b);
            wrapRepeat(gl, { tex: [s.v] });
        }
        for (const t of [s.a, s.b]) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, s.v, 0);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
                throw Error("Bildpuffer der Wetterkopie unvollständig");
        }
        return s;
    });
    const snow = wrapRepeat(gl, target(gl, k.W0, k.W0, [snF])),
        snow2 = wrapRepeat(gl, target(gl, k.W0, k.W0, [snF]));
    const mt = MN2([rgbaF]),
        m = MN2([rgbaF]),
        m2 = MN2([rgbaF]),
        md = MN2([{ f: gl.R32F, n: true }]),
        mp = MN2([{ f: gl.R32F, n: true }]),
        mp2 = MN2([{ f: gl.R32F, n: true }]);
    const cloudShadow = target(gl, SHADOW, SHADOW, [{ f: gl.R8 }]);
    const F: Felder = {
        tiefe,
        u,
        u2,
        curl,
        div,
        jw,
        mjw,
        p,
        p2,
        snow,
        snow2,
        mt,
        m,
        m2,
        md,
        mp,
        mp2,
        cloudShadow,
        cloud: null,
        hA: null,
        hB: null,
    };
    const teilchen = (): Ziel => target(gl, PN, PN, [{ f: gl.RGBA32F, n: true }]);
    const pt: ZielPaar = { A: teilchen(), B: teilchen() },
        pm: ZielPaar = { A: teilchen(), B: teilchen() };
    return { gl, vao, gpuName, parallel, P, T, F, stufen, pt, pm };
}
