/**
 * Festlegungen des Formats WebP Lossless (VP8L), die Kodierer und Dekodierer teilen:
 * Alphabete, Entfernungstabelle, Transformationsarten und die vierzehn Vorhersagen.
 * Quelle: „WebP Lossless Bitstream Specification“.
 */

export const NUM_LITERAL_CODES = 256;
export const NUM_LENGTH_CODES = 24;
export const NUM_DISTANCE_CODES = 40;
/** Größte Zahl Bit einer Farbcache-Größe. */
export const MAX_CACHE_BITS = 11;
/** Größte Länge einer Rückverweis-Kopie in Pixeln. */
export const MAX_COPY_LENGTH = 4096;
/** Hinter diese Nummer fallen die 120 festen Entfernungscodes; danach ist es `Entfernung + 120`. */
export const PLANE_CODES = 120;

/** Art einer Transformation, wie sie im Strom steht. */
export const TRANSFORM_PREDICTOR = 0;
export const TRANSFORM_CROSS_COLOR = 1;
export const TRANSFORM_SUBTRACT_GREEN = 2;
export const TRANSFORM_COLOR_INDEXING = 3;

/** Reihenfolge der Codelängen des Codes, der die Codelängen beschreibt. */
export const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const CODE_LENGTH_CODES = 19;
export const CODE_LENGTH_LITERALS = 16;
export const CODE_LENGTH_EXTRA_BITS = [2, 3, 7] as const;
export const CODE_LENGTH_REPEAT_OFFSETS = [3, 3, 11] as const;

/** Die 120 festen Entfernungen als (Spalte, Zeile) zum Pixel darüber/links (Entfernungscode 1 bis 120). */
// prettier-ignore
const DISTANCE_MAP: readonly (readonly [number, number])[] = [
    [0, 1], [1, 0], [1, 1], [-1, 1], [0, 2], [2, 0], [1, 2], [-1, 2], [2, 1], [-2, 1], [2, 2], [-2, 2],
    [0, 3], [3, 0], [1, 3], [-1, 3], [3, 1], [-3, 1], [2, 3], [-2, 3], [3, 2], [-3, 2], [0, 4], [4, 0],
    [1, 4], [-1, 4], [4, 1], [-4, 1], [3, 3], [-3, 3], [2, 4], [-2, 4], [4, 2], [-4, 2], [0, 5], [3, 4],
    [-3, 4], [4, 3], [-4, 3], [5, 0], [1, 5], [-1, 5], [5, 1], [-5, 1], [2, 5], [-2, 5], [5, 2], [-5, 2],
    [4, 4], [-4, 4], [3, 5], [-3, 5], [5, 3], [-5, 3], [0, 6], [6, 0], [1, 6], [-1, 6], [6, 1], [-6, 1],
    [2, 6], [-2, 6], [6, 2], [-6, 2], [4, 5], [-4, 5], [5, 4], [-5, 4], [3, 6], [-3, 6], [6, 3], [-6, 3],
    [0, 7], [7, 0], [1, 7], [-1, 7], [5, 5], [-5, 5], [7, 1], [-7, 1], [4, 6], [-4, 6], [6, 4], [-6, 4],
    [2, 7], [-2, 7], [7, 2], [-7, 2], [3, 7], [-3, 7], [7, 3], [-7, 3], [5, 6], [-5, 6], [6, 5], [-6, 5],
    [8, 0], [4, 7], [-4, 7], [7, 4], [-7, 4], [8, 1], [8, 2], [6, 6], [-6, 6], [8, 3], [5, 7], [-5, 7],
    [7, 5], [-7, 5], [8, 4], [6, 7], [-6, 7], [7, 6], [-7, 6], [8, 5], [7, 7], [-7, 7], [8, 6], [8, 7],
];

/** Entfernung in Pixeln zu einem Entfernungscode (1 oder größer) bei gegebener Bildbreite. */
export function distanceOfCode(code: number, width: number): number {
    if (code > PLANE_CODES) return code - PLANE_CODES;
    const [dx, dy] = DISTANCE_MAP[code - 1]!;
    return Math.max(1, dx + dy * width);
}

/** Der kleinste feste Entfernungscode je Entfernung bei einer Bildbreite; 0, wenn keiner passt. */
export function planeCodesFor(width: number): Map<number, number> {
    const codes = new Map<number, number>();
    DISTANCE_MAP.forEach(([dx, dy], index) => {
        const distance = dx + dy * width;
        if (distance >= 1 && !codes.has(distance)) codes.set(distance, index + 1);
    });
    return codes;
}

/** Zerlegt eine Länge oder einen Entfernungscode (ab 1) in Präfixsymbol, Zahl der Zusatzbits und deren Wert. */
export function prefixEncode(value: number): { symbol: number; extraBits: number; extraValue: number } {
    if (value <= 4) return { symbol: value - 1, extraBits: 0, extraValue: 0 };
    const rest = value - 1;
    const highest = 31 - Math.clz32(rest);
    const second = (rest >> (highest - 1)) & 1;
    const extraBits = highest - 1;
    return { symbol: 2 * highest + second, extraBits, extraValue: rest & ((1 << extraBits) - 1) };
}

/** Umkehrung von `prefixEncode` ohne die Zusatzbits: der kleinste Wert zum Symbol und ihre Zahl. */
export function prefixDecode(symbol: number): { base: number; extraBits: number } {
    if (symbol < 4) return { base: symbol + 1, extraBits: 0 };
    const extraBits = (symbol - 2) >> 1;
    return { base: ((2 + (symbol & 1)) << extraBits) + 1, extraBits };
}

/** Der Mittelwert je Farbkanal, abgerundet. */
export function average2(a: number, b: number): number {
    return ((((a ^ b) & 0xfefefefe) >>> 1) + (a & b)) >>> 0;
}

const clamp255 = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value);

/** `Select` der Spezifikation: links oder oben, je nachdem, wen die Steigung näher legt. */
function select(left: number, top: number, topLeft: number): number {
    let toLeft = 0;
    for (let shift = 0; shift < 32; shift += 8) {
        const t = (top >>> shift) & 255;
        const l = (left >>> shift) & 255;
        const c = (topLeft >>> shift) & 255;
        toLeft += Math.abs(l - c) - Math.abs(t - c);
    }
    return toLeft > 0 ? left : top;
}

function clampAddSubtractFull(a: number, b: number, c: number): number {
    let result = 0;
    for (let shift = 0; shift < 32; shift += 8) {
        const value = clamp255(((a >>> shift) & 255) + ((b >>> shift) & 255) - ((c >>> shift) & 255));
        result |= value << shift;
    }
    return result >>> 0;
}

function clampAddSubtractHalf(average: number, c: number): number {
    let result = 0;
    for (let shift = 0; shift < 32; shift += 8) {
        const a = (average >>> shift) & 255;
        const value = clamp255(a + (((a - ((c >>> shift) & 255)) / 2) | 0));
        result |= value << shift;
    }
    return result >>> 0;
}

/** Die Zahl der Vorhersagearten. */
export const PREDICTOR_MODES = 14;

/** Vorhersage eines Pixels aus links, oben, rechts oben und links oben (Art 0 bis 13; sonst wie 0). */
export function predict(mode: number, left: number, top: number, topRight: number, topLeft: number): number {
    switch (mode) {
        case 1:
            return left;
        case 2:
            return top;
        case 3:
            return topRight;
        case 4:
            return topLeft;
        case 5:
            return average2(average2(left, topRight), top);
        case 6:
            return average2(left, topLeft);
        case 7:
            return average2(left, top);
        case 8:
            return average2(topLeft, top);
        case 9:
            return average2(top, topRight);
        case 10:
            return average2(average2(left, topLeft), average2(top, topRight));
        case 11:
            return select(left, top, topLeft);
        case 12:
            return clampAddSubtractFull(left, top, topLeft);
        case 13:
            return clampAddSubtractHalf(average2(left, top), topLeft);
        default:
            return 0xff000000;
    }
}

/** Addiert zwei Pixel je Kanal modulo 256. */
export function addPixels(a: number, b: number): number {
    const alphaGreen = ((a & 0xff00ff00) >>> 0) + ((b & 0xff00ff00) >>> 0);
    const redBlue = (a & 0x00ff00ff) + (b & 0x00ff00ff);
    return ((alphaGreen & 0xff00ff00) | (redBlue & 0x00ff00ff)) >>> 0;
}

/** Subtrahiert `b` von `a` je Kanal modulo 256. */
export function subtractPixels(a: number, b: number): number {
    const alpha = ((a >>> 24) - (b >>> 24)) & 255;
    const red = (((a >>> 16) & 255) - ((b >>> 16) & 255)) & 255;
    const green = (((a >>> 8) & 255) - ((b >>> 8) & 255)) & 255;
    const blue = ((a & 255) - (b & 255)) & 255;
    return ((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0;
}
