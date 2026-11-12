import { klimaraster } from "../klimazonen";
import { leseMvtEbene, type MvtObjekt } from "../wetter-mvt";
import { tex2 } from "./gl";
import { clamp, M_U } from "./mathe";

/**
 * Die Daten der Karte, nur lesend: Höhen aus den Geländekacheln, Vegetation aus den Vektorkacheln, die Klimazonen der Wegfindung. Laden,
 * Hochladen als Textur und Abfragen an einer Stelle.
 */

// Höhen nur lesend von den Geländekacheln der App: Mapbox-Kodierung, je Zelle mit cos(Breite) ausgeglichen (terrain/dem-tiles.ts)
export interface Hoehen {
    /** Höhe in Metern je Zelle, Zeile für Zeile von Nord nach Süd. */
    readonly h: Int16Array;
    /** Zellen je Seite. */
    readonly S: number;
    /** Die größte Höhe vor dem Klemmen auf ±32.000. */
    readonly peak: number;
}

/** Der Zeiger auf den aktuellen Stand der Geländekacheln (`/tiles/terrain/dem/current.json`), so weit die Engine ihn liest. */
interface GelaendeZeiger {
    readonly tileSize: number;
    readonly revision: string | number;
    readonly format: string;
}

const zeichnen2d = (c: OffscreenCanvas, lesen: boolean): OffscreenCanvasRenderingContext2D => {
    const g = c.getContext("2d", lesen ? { willReadFrequently: true } : undefined);
    if (!g) throw Error("Kein 2D-Zeichenkontext");
    return g;
};

export async function ladeHoehen(): Promise<Hoehen> {
    const z = (await (await fetch("/tiles/terrain/dem/current.json")).json()) as GelaendeZeiger,
        dz = 2,
        n = 1 << dz,
        ts = z.tileSize,
        S = n * ts;
    const h = new Int16Array(S * S),
        WELT = 40075016.68557849,
        RMPS = WELT / (1024 * 3000),
        c = new OffscreenCanvas(ts, ts),
        g = zeichnen2d(c, true);
    let peak = 0;
    // Alle Kacheln zugleich holen und entpacken, dann in der alten Folge einlesen (vorher eine nach der anderen).
    const liste: [number, number][] = [];
    for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) liste.push([tx, ty]);
    const bilder = await Promise.all(
        liste.map(async ([tx, ty]) => {
            const r = await fetch(`/tiles/terrain/dem/${z.revision}/${dz}/${tx}/${ty}.${z.format}`);
            if (!r.ok) throw Error("Geländekachel fehlt: " + r.status);
            return {
                tx,
                ty,
                b: await createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" }),
            };
        }),
    );
    for (const { tx, ty, b } of bilder) {
        g.clearRect(0, 0, ts, ts);
        g.drawImage(b, 0, 0);
        const d = g.getImageData(0, 0, ts, ts).data;
        for (let y = 0; y < ts; y++) {
            const row = ty * ts + y,
                ch = Math.cosh(Math.PI * (1 - (2 * (row + 0.5)) / S));
            for (let x = 0; x < ts; x++) {
                const o = (y * ts + x) * 4,
                    rm = -10000 + (d[o]! * 65536 + d[o + 1]! * 256 + d[o + 2]!) * 0.1,
                    v = Math.round((rm * ch) / RMPS);
                h[row * S + tx * ts + x] = Math.max(-32000, Math.min(32000, v));
                if (v > peak) peak = v;
            }
        }
    }
    return { h, S, peak };
}

/** Die Höhentextur (km, Gefälle in x und z, Land) mit allen Mipmaps; dazu das steilste Gefälle, ab `hangMax` aufwärts. */
export function uploadHoehen(
    gl: WebGL2RenderingContext,
    hoehen: Hoehen,
    hangMax: number,
): { tex: WebGLTexture; hangMax: number } {
    const S = hoehen.S,
        d = new Float32Array(S * S * 4),
        cell = (1024 * M_U) / S,
        h = hoehen.h;
    for (let j = 0; j < S; j++)
        for (let i = 0; i < S; i++) {
            const k = j * S + i,
                o = k * 4;
            d[o] = h[k]! / 1000;
            d[o + 1] = (h[j * S + Math.min(S - 1, i + 1)]! - h[j * S + Math.max(0, i - 1)]!) / (2 * cell);
            d[o + 2] = (h[Math.min(S - 1, j + 1) * S + i]! - h[Math.max(0, j - 1) * S + i]!) / (2 * cell);
            d[o + 3] = h[k]! > 0 ? 1 : 0;
            hangMax = Math.max(hangMax, Math.hypot(d[o + 1]!, d[o + 2]!));
        }
    const tex = tex2(gl, S, S, gl.RGBA16F, { min: gl.LINEAR_MIPMAP_LINEAR, levels: Math.log2(S) + 1 });
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, S, S, gl.RGBA, gl.FLOAT, d);
    gl.generateMipmap(gl.TEXTURE_2D);
    return { tex, hangMax };
}

/** Die Höhe in Metern an einer Stelle (Karteneinheiten), bilinear; außerhalb der Karte und vor dem Laden 0. */
export function hoeheAt(hoehen: Hoehen | null, x: number, z: number): number {
    if (!hoehen || x < 0 || x > 1024 || z < 0 || z > 1024) return 0;
    const hoehe = hoehen.h,
        HS = hoehen.S;
    const fx = (x / 1024) * HS - 0.5,
        fz = (z / 1024) * HS - 0.5,
        i = Math.max(0, Math.min(HS - 2, Math.floor(fx))),
        j = Math.max(0, Math.min(HS - 2, Math.floor(fz))),
        u = clamp(fx - i),
        v = clamp(fz - j),
        o = j * HS + i;
    return (
        hoehe[o]! * (1 - u) * (1 - v) +
        hoehe[o + 1]! * u * (1 - v) +
        hoehe[o + HS]! * (1 - u) * v +
        hoehe[o + HS + 1]! * u * v
    );
}

// Verdunstung je Vegetationsart (Derographie, Ebene „vegetation“): wie viel Wasser der Boden hergeben kann. Setzungen, keine Regelwerksangaben.
const VERDUNSTUNG_JE_ART: Readonly<Record<string, number>> = {
    suempfe_moore: 1,
    auenlandschaft: 0.95,
    flussland_flusstal: 0.9,
    dschungel: 0.9,
    urwald: 0.9,
    wuestenoase: 0.8,
    wald: 0.7,
    kulturlandschaft: 0.5,
    graslandschaft: 0.5,
    steppe: 0.3,
    tundra: 0.3,
    gletscher: 0.1,
    eislandschaft: 0.1,
    schneelandschaft: 0.1,
    wueste: 0.05,
};
// Land ohne Vegetationsfläche verdunstet wie bisher jedes Land.
export const VEG_GRUND = 0.56;
const grau = (v: number): string => {
    const n = Math.round(v * 255);
    return `rgb(${n},${n},${n})`;
};

interface VegFlaeche {
    readonly v: number;
    readonly o: number;
    readonly ft: MvtObjekt;
    readonly tx: number;
    readonly ty: number;
    readonly e: number;
}

/** Der Verdunstungsfaktor je Zelle (1024², 0 bis 255). Zoom 1 reicht: vier Kacheln, darin fehlt gegen Zoom 2 praktisch nichts, und 8 Kachelpunkte je Karteneinheit sind feiner als das Raster. */
export async function ladeVegetation(): Promise<Uint8Array> {
    const N = 1024,
        c = new OffscreenCanvas(N, N),
        g = zeichnen2d(c, false);
    g.fillStyle = grau(VEG_GRUND);
    g.fillRect(0, 0, N, N);
    const flaechen: VegFlaeche[] = [];
    // Die vier Kacheln zugleich holen (Betreiber 2026-11-08: „das erstmalige anzeigen des wetters dauert recht lang“; nacheinander je 1,2 bis 1,6 s), gelesen in der alten Folge.
    const kacheln = await Promise.all(
        (
            [
                [0, 0],
                [1, 0],
                [0, 1],
                [1, 1],
            ] as const
        ).map(async ([tx, ty]) => {
            const r = await fetch(`/tiles/vector/region_area_tile/1/${tx}/${ty}`);
            if (!r.ok) throw Error("Vegetationskachel fehlt: " + r.status);
            return { tx, ty, daten: new Uint8Array(await r.arrayBuffer()) };
        }),
    );
    for (const { tx, ty, daten } of kacheln) {
        const l = leseMvtEbene(daten, "region_area_render");
        if (!l) continue;
        for (const ft of l.objekte) {
            const p = ft.eigenschaften;
            if (p["region_layer"] !== "vegetation") continue;
            const v = VERDUNSTUNG_JE_ART[String(p["region_type"])];
            if (v !== undefined) flaechen.push({ v, o: Number(p["stack_order"]) || 0, ft, tx, ty, e: l.extent });
        }
    }
    // Oben liegende Flächen gewinnen, wie auf der Karte.
    flaechen.sort((a, b) => a.o - b.o);
    for (const { v, ft, tx, ty, e } of flaechen) {
        g.fillStyle = grau(v);
        g.beginPath();
        for (const ring of ft.ringe) {
            ring.forEach((q, k) => {
                const x = (tx + q.x / e) * 512,
                    y = (ty + q.y / e) * 512;
                if (k) g.lineTo(x, y);
                else g.moveTo(x, y);
            });
            g.closePath();
        }
        g.fill("evenodd");
    }
    // Weiche Ränder: Die Luft mischt ohnehin über Kilometer.
    const w = new OffscreenCanvas(N, N),
        gw = zeichnen2d(w, true);
    gw.filter = "blur(2px)";
    gw.drawImage(c, 0, 0);
    const d = gw.getImageData(0, 0, N, N).data,
        o = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) o[k] = d[k * 4]!;
    return o;
}

/** Der Verdunstungsfaktor an einer Stelle (0 bis 1); ohne Vegetation der Grundwert. */
export const vegAt = (veg: Uint8Array | null, x: number, z: number): number =>
    veg
        ? veg[Math.min(1023, Math.max(0, Math.floor(z))) * 1024 + Math.min(1023, Math.max(0, Math.floor(x)))]! / 255
        : VEG_GRUND;

/** Die Vegetationstextur (R8, 1024²); ohne Vegetation überall der Grundwert. */
export function uploadVegetation(gl: WebGL2RenderingContext, veg: Uint8Array | null): WebGLTexture {
    const N = 1024,
        d = veg ?? new Uint8Array(N * N).fill(Math.round(VEG_GRUND * 255));
    const t = tex2(gl, N, N, gl.R8);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RED, gl.UNSIGNED_BYTE, d);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    return t;
}

// Klimazonen der Wegfindung (WI-0288 Stufe 5): das Raster aus `klimazonen.ts`, eine Zelle je Karteneinheit, Wert 1 bis 8 in der Folge von `wetterKlimazonen`.
export const ladeKlima = (): Promise<Uint8Array> => klimaraster();

// Weiche Klimazonen: je Zone (0 keine, 1 bis 11) ihr Anteil, auf 256² gemittelt (eine Zelle 12 km) und weichgezeichnet, Gauß aus dreimal Kasten mit der
// Breite `cfg.klimaWeich` (km, Sigma); drei RGBA8-Texturen, linear gelesen. Weich wird nur die Höhe der Grenze, Gelände, Hang, Sonnenhang und Rand bleiben.
const KW = 256;
function klimaGewichte(klima: Uint8Array | null, klimaWeich: number | undefined): Float32Array[] {
    const S = 1024 / KW,
        n = KW * KW,
        w = Array.from({ length: 12 }, () => new Float32Array(n));
    for (let z = 0; z < 1024; z++)
        for (let x = 0; x < 1024; x++) {
            const k = klima ? Math.min(11, klima[z * 1024 + x]!) : 0;
            w[k]![((z / S) | 0) * KW + ((x / S) | 0)]! += 1 / (S * S);
        }
    const sigma = Math.max(0, klimaWeich ?? 0) / 3 / S;
    if (sigma > 0.3) {
        const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2)),
            tmp = new Float32Array(n);
        const kasten = (a: Float32Array, b: Float32Array, quer: boolean): void => {
            const at = (j: number, i: number): number => {
                i = Math.min(KW - 1, Math.max(0, i));
                return quer ? a[j * KW + i]! : a[i * KW + j]!;
            };
            for (let j = 0; j < KW; j++) {
                let s = 0;
                for (let i = -r; i <= r; i++) s += at(j, i);
                for (let i = 0; i < KW; i++) {
                    const v = s / (2 * r + 1);
                    if (quer) b[j * KW + i] = v;
                    else b[i * KW + j] = v;
                    s += at(j, i + r + 1) - at(j, i - r);
                }
            }
        };
        for (const a of w) {
            if (!a.some((v) => v > 0)) continue;
            for (let p = 0; p < 3; p++) {
                kasten(a, tmp, true);
                kasten(tmp, a, false);
            }
        }
    }
    return w;
}

/** Die drei Texturen der weichen Klimazonen (`uKW0` bis `uKW2`), je vier Zonen in RGBA. */
export function uploadKlima(
    gl: WebGL2RenderingContext,
    klima: Uint8Array | null,
    klimaWeich: number | undefined,
): [WebGLTexture, WebGLTexture, WebGLTexture] {
    const w = klimaGewichte(klima, klimaWeich);
    const kw: WebGLTexture[] = [];
    for (let t = 0; t < 3; t++) {
        const d = new Uint8Array(KW * KW * 4);
        for (let i = 0; i < KW * KW; i++)
            for (let c = 0; c < 4; c++) d[i * 4 + c] = Math.round(clamp(w[t * 4 + c]![i]!) * 255);
        kw.push(tex2(gl, KW, KW, gl.RGBA8));
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, KW, KW, gl.RGBA, gl.UNSIGNED_BYTE, d);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    }
    return [kw[0]!, kw[1]!, kw[2]!];
}
