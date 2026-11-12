import { deflateSync, inflateSync } from "node:zlib";

/**
 * PNG für die Tests des Kachelformats (WI-0073): lesen (8 Bit, RGB oder RGBA, alle Zeilenfilter; so schreibt es
 * Pillow) und schreiben (RGB, ohne Filter, wie der frühere Kodierer der Höhenkacheln).
 */

export interface PngPixels {
    width: number;
    height: number;
    /** Vier Bytes je Pixel (rot, grün, blau, alpha), Zeile für Zeile. */
    rgba: Uint8Array;
}

export function readPng(png: Buffer): PngPixels {
    let offset = 8;
    const idat: Buffer[] = [];
    let width = 0;
    let height = 0;
    let channels = 0;
    while (offset < png.length) {
        const length = png.readUInt32BE(offset);
        const type = png.toString("ascii", offset + 4, offset + 8);
        if (type === "IHDR") {
            width = png.readUInt32BE(offset + 8);
            height = png.readUInt32BE(offset + 12);
            const colorType = png[offset + 17];
            if (png[offset + 16] !== 8 || (colorType !== 2 && colorType !== 6))
                throw new Error("nur RGB oder RGBA mit 8 Bit");
            channels = colorType === 2 ? 3 : 4;
        } else if (type === "IDAT") {
            idat.push(png.subarray(offset + 8, offset + 8 + length));
        }
        offset += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const rows = new Uint8Array(stride * height);
    for (let y = 0; y < height; y += 1) {
        const filter = raw[y * (stride + 1)]!;
        for (let i = 0; i < stride; i += 1) {
            const a = i >= channels ? rows[y * stride + i - channels]! : 0;
            const b = y > 0 ? rows[(y - 1) * stride + i]! : 0;
            const c = y > 0 && i >= channels ? rows[(y - 1) * stride + i - channels]! : 0;
            let predictor = 0;
            if (filter === 1) predictor = a;
            else if (filter === 2) predictor = b;
            else if (filter === 3) predictor = (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            rows[y * stride + i] = (raw[y * (stride + 1) + 1 + i]! + predictor) & 255;
        }
    }
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        rgba[4 * i] = rows[channels * i]!;
        rgba[4 * i + 1] = rows[channels * i + 1]!;
        rgba[4 * i + 2] = rows[channels * i + 2]!;
        rgba[4 * i + 3] = channels === 4 ? rows[channels * i + 3]! : 255;
    }
    return { width, height, rgba };
}

const crcTable = Int32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
});

function crc32(buffer: Buffer): number {
    let c = -1;
    for (const byte of buffer) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

/** Ein RGB-PNG ohne Zeilenfilter, wie `encodePng` es vor WI-0073 für die Höhenkacheln schrieb. */
export function encodePngRgb(rgb: Uint8Array, size: number): Buffer {
    const stride = size * 3;
    const raw = Buffer.alloc((stride + 1) * size);
    for (let y = 0; y < size; y += 1)
        Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}
