import { inflateSync } from "node:zlib";
import { decodeWebp } from "./webp/decode.ts";

/**
 * Liest die Bytes einer Höhenkachel als RGB, gleich in welchem Format sie abgelegt wurden.
 *
 * Seit WI-0073 sind neue Kacheln verlustfreies WebP. PNG bleibt lesbar, solange Revisionen in Datenbanken
 * liegen, die vor der Umstellung entstanden sind (Stage: die abgelöste Revision einen Tag lang, ADR-0008).
 */

export type TileFormat = "png" | "webp";

export interface TileRgb {
    width: number;
    height: number;
    /** Drei Bytes je Pixel, Zeile für Zeile. */
    rgb: Uint8Array;
}

/** Das Format nach den ersten Bytes; `null` bei etwas anderem. */
export function tileFormatOf(image: Uint8Array): TileFormat | null {
    if (image.length >= 8 && image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47)
        return "png";
    if (image.length >= 12 && image[0] === 0x52 && image[1] === 0x49 && image[2] === 0x46 && image[3] === 0x46)
        return "webp";
    return null;
}

/** RGB-PNG mit 8 Bit und beliebigen Zeilenfiltern (so schrieb es der frühere Kodierer). */
function decodePng(png: Buffer): TileRgb {
    let offset = 8;
    const idat: Buffer[] = [];
    let width = 0;
    let height = 0;
    while (offset < png.length) {
        const length = png.readUInt32BE(offset);
        const type = png.toString("ascii", offset + 4, offset + 8);
        if (type === "IHDR") {
            width = png.readUInt32BE(offset + 8);
            height = png.readUInt32BE(offset + 12);
            if (png[offset + 16] !== 8 || png[offset + 17] !== 2)
                throw new Error("Höhenkachel ist kein RGB-PNG mit 8 Bit");
        } else if (type === "IDAT") {
            idat.push(png.subarray(offset + 8, offset + 8 + length));
        }
        offset += 12 + length;
    }
    // Die Filter werden an Ort und Stelle im entpackten Puffer aufgelöst: kein zweites Bild je Kachel.
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * 3;
    const row = stride + 1;
    for (let y = 0; y < height; y += 1) {
        const type = raw[y * row] ?? 0;
        for (let i = 0; i < stride; i += 1) {
            const at = y * row + 1 + i;
            const a = i >= 3 ? (raw[at - 3] ?? 0) : 0;
            const b = y > 0 ? (raw[at - row] ?? 0) : 0;
            const c = y > 0 && i >= 3 ? (raw[at - row - 3] ?? 0) : 0;
            let predictor = 0;
            if (type === 1) predictor = a;
            else if (type === 2) predictor = b;
            else if (type === 3) predictor = (a + b) >> 1;
            else if (type === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            raw[at] = ((raw[at] ?? 0) + predictor) & 255;
        }
    }
    const rgb = new Uint8Array(stride * height);
    for (let y = 0; y < height; y += 1) rgb.set(raw.subarray(y * row + 1, y * row + 1 + stride), y * stride);
    return { width, height, rgb };
}

function decodeWebpRgb(webp: Buffer): TileRgb {
    const { width, height, argb } = decodeWebp(webp);
    const rgb = new Uint8Array(argb.length * 3);
    for (let i = 0; i < argb.length; i += 1) {
        const pixel = argb[i]!;
        rgb[3 * i] = (pixel >>> 16) & 255;
        rgb[3 * i + 1] = (pixel >>> 8) & 255;
        rgb[3 * i + 2] = pixel & 255;
    }
    return { width, height, rgb };
}

/** Dekodiert eine Kachel (PNG oder WebP) zu RGB. */
export function decodeTileImage(image: Buffer): TileRgb {
    const format = tileFormatOf(image);
    if (format === "png") return decodePng(image);
    if (format === "webp") return decodeWebpRgb(image);
    throw new Error("Höhenkachel ist weder PNG noch WebP");
}
