import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import { dunstLage, type DunstLage } from "../atmosphere/dunst-tiefe";
import { KULISSEN_VORGABE } from "../atmosphere/kulisse-werte";
import { wetterSichtbar } from "./wetter-dunst";

/**
 * Die Kamera der Wetter-Icons (WI-0288 Stufe 3): dieselbe Rechnung wie in der Engine (`engine/kamera.ts`, `aktualisiereKamera`, `projekt`,
 * `aufEbene`), aber ohne sie. Der Wetter-Editor zeigt die Icons als Griffe auch, wenn kein Wetterschalter an ist und die Engine also gar
 * nicht läuft; dann liefert diese leere Ebene die Matrix der Karte.
 *
 * - Weltkoordinaten wie in der Engine: x und z in Karteneinheiten (0 bis 1024 über die Welt), y nach oben; `AUF_WELT` bildet sie auf die
 *   Mercator-Koordinaten der Karte ab (x/1024, z/1024, Höhe y/1024). So stehen die Icons mit und ohne Engine an genau derselben Stelle.
 * - Die Ebene zeichnet nichts; sie merkt sich nur die Matrix, die MapLibre ihr in jedem Bild gibt (`defaultProjectionData.mainMatrix`).
 * - Sie hängt sich nach einem Stilwechsel wieder ein (`styledata`), wie die Engine.
 */

export interface WetterKamera {
    /** Bildpunkte im Kartenrahmen, oder `null` hinter der Kamera und vor dem ersten Bild. */
    projekt(x: number, y: number, z: number): { x: number; y: number } | null;
    /** Wo ein Bildpunkt die Ebene der Höhe `y` trifft, in Karteneinheiten; `null` über dem Horizont. */
    aufEbene(px: number, py: number, y: number): { x: number; z: number } | null;
    /** Wie sichtbar das Wetter an dieser Stelle im Dunst des Geländes ist, 1 bis 0 (`wetter-dunst.ts`); vor dem ersten Bild 1. */
    sichtbar(x: number, y: number, z: number): number;
    ein(): void;
    aus(): void;
}

const EBENE_ID = "wetter-symbole-kamera";

/** Welt (x, y nach oben, z) auf Mercator (x/1024, z/1024, Höhe y/1024), spaltenweise; auch das Wasser rechnet damit (`map/wasser/`). */
export const AUF_WELT = ((): Float64Array => {
    const s = 1 / 1024;
    return Float64Array.from([s, 0, 0, 0, 0, 0, s, 0, 0, s, 0, 0, 0, 0, 0, 1]);
})();

/** Spaltenweise wie WebGL: `a · b`. */
export function mal(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
    const r = new Float64Array(16);
    for (let c = 0; c < 4; c++)
        for (let w = 0; w < 4; w++) {
            let summe = 0;
            for (let k = 0; k < 4; k++) summe += a[k * 4 + w]! * b[c * 4 + k]!;
            r[c * 4 + w] = summe;
        }
    return r;
}

/** Die Umkehrung nach Gauß mit Spaltentausch; `undefined`, wenn sie fehlt. */
export function umkehrung(m: ArrayLike<number>): Float64Array | undefined {
    const a = Array.from(m);
    const b = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let c = 0; c < 4; c++) {
        let p = c;
        for (let r = c + 1; r < 4; r++) if (Math.abs(a[c * 4 + r]!) > Math.abs(a[c * 4 + p]!)) p = r;
        if (p !== c)
            for (let k = 0; k < 4; k++) {
                [a[k * 4 + c], a[k * 4 + p]] = [a[k * 4 + p]!, a[k * 4 + c]!];
                [b[k * 4 + c], b[k * 4 + p]] = [b[k * 4 + p]!, b[k * 4 + c]!];
            }
        const d = a[c * 4 + c]!;
        if (Math.abs(d) < 1e-30) return undefined;
        for (let k = 0; k < 4; k++) {
            a[k * 4 + c]! /= d;
            b[k * 4 + c]! /= d;
        }
        for (let r = 0; r < 4; r++) {
            if (r === c) continue;
            const f = a[c * 4 + r]!;
            if (f === 0) continue;
            for (let k = 0; k < 4; k++) {
                a[k * 4 + r]! -= f * a[k * 4 + c]!;
                b[k * 4 + r]! -= f * b[k * 4 + c]!;
            }
        }
    }
    return Float64Array.from(b);
}

/** Projektion mit einer Matrix aus Welt in Bildpunkte eines Rahmens; `null` hinter der Kamera. */
export function projiziere(
    m: ArrayLike<number>,
    breite: number,
    hoehe: number,
    x: number,
    y: number,
    z: number,
): { x: number; y: number } | null {
    const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    if (w < 0.01) return null;
    return {
        x: (((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w) * 0.5 + 0.5) * breite,
        y: (0.5 - ((m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w) * 0.5) * hoehe,
    };
}

/** Der Strahl durch einen Bildpunkt, geschnitten mit der Ebene der Höhe `y` (Engine `aufEbene`). */
export function schneide(
    inv: ArrayLike<number>,
    breite: number,
    hoehe: number,
    px: number,
    py: number,
    y: number,
): { x: number; z: number } | null {
    const e3 = inv[11]!;
    if (Math.abs(e3) < 1e-30) return null;
    const auge = [inv[8]! / e3, inv[9]! / e3, inv[10]! / e3];
    const nx = (px / breite) * 2 - 1;
    const ny = 1 - (py / hoehe) * 2;
    const w = inv[3]! * nx + inv[7]! * ny + inv[11]! + inv[15]!;
    const f = [
        (inv[0]! * nx + inv[4]! * ny + inv[8]! + inv[12]!) / w,
        (inv[1]! * nx + inv[5]! * ny + inv[9]! + inv[13]!) / w,
        (inv[2]! * nx + inv[6]! * ny + inv[10]! + inv[14]!) / w,
    ];
    const d = [f[0]! - auge[0]!, f[1]! - auge[1]!, f[2]! - auge[2]!];
    const l = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
    d[0]! /= l;
    d[1]! /= l;
    d[2]! /= l;
    if (d[1]! > -0.004) d[1] = -0.004;
    const k = (y - auge[1]!) / d[1]!;
    if (!(k > 0)) return null;
    return { x: auge[0]! + d[0]! * k, z: auge[2]! + d[2]! * k };
}

export function erzeugeWetterKamera(map: MapLibreMap): WetterKamera {
    let vp: Float64Array | undefined;
    let inv: Float64Array | undefined;
    let dunst: DunstLage | undefined;
    const ebene: CustomLayerInterface = {
        id: EBENE_ID,
        type: "custom",
        renderingMode: "2d",
        render(_gl: WebGL2RenderingContext | WebGLRenderingContext, args: CustomRenderMethodInput): void {
            vp = mal(args.defaultProjectionData.mainMatrix, AUF_WELT);
            inv = umkehrung(vp);
            dunst =
                inv === undefined
                    ? undefined
                    : dunstLage(
                          {
                              vp,
                              inv,
                              sichtfeld: args.fov,
                              fern: args.farZ,
                              hoehe: map.getCanvas().clientHeight,
                              neigung: map.getPitch(),
                          },
                          KULISSEN_VORGABE,
                      );
        },
    };
    let ab: (() => void) | undefined;
    const rahmen = (): { breite: number; hoehe: number } => {
        const leinwand = map.getCanvas();
        return { breite: leinwand.clientWidth, hoehe: leinwand.clientHeight };
    };
    return {
        projekt(x, y, z) {
            if (vp === undefined) return null;
            const { breite, hoehe } = rahmen();
            return projiziere(vp, breite, hoehe, x, y, z);
        },
        aufEbene(px, py, y) {
            if (inv === undefined) return null;
            const { breite, hoehe } = rahmen();
            return schneide(inv, breite, hoehe, px, py, y);
        },
        sichtbar: (x, y, z) => wetterSichtbar(dunst, x, y, z),
        ein() {
            if (ab) return;
            // 🪤 Erst mit geladenem Stil (wie die Engine seit `4b2c195a5`): Sonst wirft jedes `styledata` der Laufzeitbilder „Style is not done
            // loading“. `isStyleLoaded()` wartet zusätzlich auf Kacheln und käme zu spät.
            ab = () => {
                const stil = (map as unknown as { style?: { _loaded?: boolean } }).style;
                if (stil?._loaded === true && map.getLayer(EBENE_ID) === undefined) map.addLayer(ebene);
            };
            map.on("styledata", ab);
            ab();
            map.triggerRepaint();
        },
        aus() {
            if (ab) map.off("styledata", ab);
            ab = undefined;
            if (map.getLayer(EBENE_ID) !== undefined) map.removeLayer(EBENE_ID);
            vp = undefined;
            inv = undefined;
            dunst = undefined;
        },
    };
}
