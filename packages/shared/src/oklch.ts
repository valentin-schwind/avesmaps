/**
 * Farben in OKLCH: wahrgenommene Helligkeit L (0 bis 1), Buntheit C, Farbton h in Grad (Björn Ottosson, OKLab).
 *
 * Gebraucht für die Klimazonen (WI-0012, Betreiber 2026-10-05: Variante „C“, alle Zonen gleich hell, bunter, Farbtöne
 * unverändert) und für ihre Namen, deren Ton aus der Zone kommt und deren Helligkeit nicht (Legacy
 * `oklch(from … 0.85 c h)`, `css/features/ecosystem-layer.css`). MapLibre kennt keine relativen Farben; die Rechnung
 * steht deshalb hier und liefert fertige Hexwerte.
 */

export interface Oklch {
    l: number;
    c: number;
    /** Farbton in Grad, 0 bis unter 360. */
    h: number;
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function channels(hex: string): [number, number, number] {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) {
        throw new Error(`keine Farbe in der Form #rrggbb: ${hex}`);
    }
    return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
}

function toOklab([r, g, b]: [number, number, number]): [number, number, number] {
    const [lr, lg, lb] = [r, g, b].map(toLinear) as [number, number, number];
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
}

/** OKLab nach linearem sRGB; außerhalb des Farbraums liegen Kanäle unter 0 oder über 1. */
function toLinearRgb(l: number, a: number, b: number): [number, number, number] {
    const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
        4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
        -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
        -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
    ];
}

export function oklchOf(hex: string): Oklch {
    const [l, a, b] = toOklab(channels(hex));
    return { l, c: Math.hypot(a, b), h: ((((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360 };
}

const EPSILON = 1e-6;

/**
 * Die Farbe mit dieser Helligkeit, Buntheit und diesem Farbton, als Hexwert. Liegt sie außerhalb von sRGB, sinkt die
 * Buntheit, bis sie hineinpasst (Helligkeit und Farbton bleiben).
 */
export function oklchToHex({ l, c, h }: Oklch): string {
    const rad = (h * Math.PI) / 180;
    const at = (chroma: number): [number, number, number] =>
        toLinearRgb(l, chroma * Math.cos(rad), chroma * Math.sin(rad));
    const fits = (chroma: number): boolean => at(chroma).every((v) => v >= -EPSILON && v <= 1 + EPSILON);
    let chroma = c;
    if (!fits(chroma)) {
        let low = 0;
        let high = c;
        for (let step = 0; step < 40; step++) {
            const middle = (low + high) / 2;
            if (fits(middle)) low = middle;
            else high = middle;
        }
        chroma = low;
    }
    return `#${at(chroma)
        .map((v) =>
            Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255)
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")}`;
}

/** Derselbe Ton mit einer anderen wahrgenommenen Helligkeit (Legacy `oklch(from <farbe> <l> c h)`). */
export function withOklchLightness(hex: string, lightness: number): string {
    const { c, h } = oklchOf(hex);
    return oklchToHex({ l: lightness, c, h });
}
