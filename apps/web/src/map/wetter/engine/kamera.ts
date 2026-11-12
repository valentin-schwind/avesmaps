import { MercatorCoordinate, type CustomRenderMethodInput } from "maplibre-gl";
import { dunstLage } from "../../atmosphere/dunst-tiefe";
import { KULISSEN_VORGABE } from "../../atmosphere/kulisse-werte";
import type { Kern } from "./kern";
import type { Vec3 } from "./mathe";

/**
 * Kamera aus der Matrix der Karte: world (x,y,z) → Mercator (x/1024, z/1024, y/1024). In 32 Bit wie im Prototyp; die Icons rechnen
 * dasselbe ohne Engine in `wetter-kamera.ts` (64 Bit).
 */

/** Spaltenweise wie WebGL: `a · b`. */
export function mat(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++)
        for (let w = 0; w < 4; w++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[k * 4 + w]! * b[c * 4 + k]!;
            r[c * 4 + w] = s;
        }
    return r;
}

/** Die Umkehrung nach Gauß mit Spaltentausch. */
export function invertiere(m: ArrayLike<number>): Float32Array {
    const a = Array.from(m),
        b = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let c = 0; c < 4; c++) {
        let p = c;
        for (let r = c + 1; r < 4; r++) if (Math.abs(a[c * 4 + r]!) > Math.abs(a[c * 4 + p]!)) p = r;
        if (p !== c)
            for (let k = 0; k < 4; k++) {
                let t = a[k * 4 + c]!;
                a[k * 4 + c] = a[k * 4 + p]!;
                a[k * 4 + p] = t;
                t = b[k * 4 + c]!;
                b[k * 4 + c] = b[k * 4 + p]!;
                b[k * 4 + p] = t;
            }
        const d = a[c * 4 + c]!;
        for (let k = 0; k < 4; k++) {
            a[k * 4 + c]! /= d;
            b[k * 4 + c]! /= d;
        }
        for (let r = 0; r < 4; r++) {
            if (r === c) continue;
            const f = a[c * 4 + r]!;
            for (let k = 0; k < 4; k++) {
                a[k * 4 + r]! -= f * a[k * 4 + c]!;
                b[k * 4 + r]! -= f * b[k * 4 + c]!;
            }
        }
    }
    return new Float32Array(b);
}

const AUF_WELT = ((): number[] => {
    const s = 1 / 1024;
    return [s, 0, 0, 0, 0, 0, s, 0, 0, s, 0, 0, 0, 0, 0, 1];
})();

export function aktualisiereKamera(k: Kern, args: CustomRenderMethodInput): void {
    k.prevVP = k.vp;
    const vp = mat(args.defaultProjectionData.mainMatrix, AUF_WELT);
    k.vp = vp;
    if (!k.prevVP) k.prevVP = vp;
    const invVP = invertiere(vp);
    k.invVP = invVP;
    const e = [invVP[8]!, invVP[9]!, invVP[10]!, invVP[11]!] as const;
    const eye: Vec3 = [e[0] / e[3], e[1] / e[3], e[2] / e[3]];
    k.eye = eye;
    const cam = k.cam,
        map = k.map;
    // Der Dunst des Geländes in diesem Bild: Wolken, Teilchen und Bodeneffekte weichen ihm (`wetter-dunst.ts`).
    k.dunst = dunstLage(
        {
            vp,
            inv: invVP,
            sichtfeld: args.fov,
            fern: args.farZ,
            hoehe: map.getCanvas().clientHeight,
            neigung: map.getPitch(),
        },
        KULISSEN_VORGABE,
    );
    const m = MercatorCoordinate.fromLngLat(map.getCenter());
    cam.tx = m.x * 1024;
    cam.tz = m.y * 1024;
    cam.dist = Math.hypot(eye[0] - cam.tx, eye[1], eye[2] - cam.tz);
    // Die gewachsene Überhöhung (`terrain.ts` stellt sie bis 30° Neigung am Gelände), nicht die des Stils: `getTerrain()` nennt immer die volle.
    const hs: unknown = map.terrain?.exaggeration ?? 0;
    k.hs = typeof hs !== "number" ? 0 : hs;
}

/** Bildpunkte im Kartenrahmen, oder `null` hinter der Kamera und vor dem ersten Bild. */
export function projekt(k: Kern, x: number, y: number, z: number): { x: number; y: number } | null {
    const m = k.vp;
    if (!m) return null;
    const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    if (w < 0.01) return null;
    const c = k.map.getCanvas();
    return {
        x: (((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w) * 0.5 + 0.5) * c.clientWidth,
        y: (0.5 - ((m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w) * 0.5) * c.clientHeight,
    };
}

/** Wo ein Bildpunkt die Ebene der Höhe `y` trifft, in Karteneinheiten; `null` über dem Horizont. */
export function aufEbene(k: Kern, px: number, py: number, y: number): { x: number; z: number } | null {
    const a = k.invVP;
    if (!a) return null;
    const eye = k.eye;
    const c = k.map.getCanvas(),
        nx = (px / c.clientWidth) * 2 - 1,
        ny = 1 - (py / c.clientHeight) * 2,
        w = a[3]! * nx + a[7]! * ny + a[11]! + a[15]!,
        f: Vec3 = [
            (a[0]! * nx + a[4]! * ny + a[8]! + a[12]!) / w,
            (a[1]! * nx + a[5]! * ny + a[9]! + a[13]!) / w,
            (a[2]! * nx + a[6]! * ny + a[10]! + a[14]!) / w,
        ];
    const d: Vec3 = [f[0] - eye[0], f[1] - eye[1], f[2] - eye[2]],
        l = Math.hypot(d[0], d[1], d[2]);
    d[0] /= l;
    d[1] /= l;
    d[2] /= l;
    if (d[1] > -0.004) d[1] = -0.004;
    const kk = (y - eye[1]) / d[1];
    if (kk <= 0) return null;
    const q = Math.min(kk, k.cam.dist * 8 + 200);
    return { x: eye[0] + d[0] * q, z: eye[2] + d[2] * q };
}
