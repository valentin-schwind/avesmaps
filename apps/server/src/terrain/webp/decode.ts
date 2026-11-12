import { BitReader } from "./bits.ts";
import { buildDecodeTable, type DecodeTable } from "./huffman.ts";
import {
    addPixels,
    CODE_LENGTH_CODES,
    CODE_LENGTH_EXTRA_BITS,
    CODE_LENGTH_LITERALS,
    CODE_LENGTH_ORDER,
    CODE_LENGTH_REPEAT_OFFSETS,
    distanceOfCode,
    MAX_CACHE_BITS,
    NUM_DISTANCE_CODES,
    NUM_LENGTH_CODES,
    NUM_LITERAL_CODES,
    predict,
    prefixDecode,
    TRANSFORM_CROSS_COLOR,
    TRANSFORM_PREDICTOR,
    TRANSFORM_SUBTRACT_GREEN,
} from "./format.ts";

/**
 * Dekodiert WebP Lossless (VP8L) vollständig nach der Spezifikation: alle vier Transformationen,
 * Farbcache, mehrere Präfixcode-Gruppen und Rückverweise. Gedacht für die Prüfung unserer eigenen
 * Kacheln und für den Vergleich mit fremden Kodierern (libwebp); ein beschädigter Strom wirft.
 */

export interface WebpImage {
    width: number;
    height: number;
    /** Zeilenweise, je Pixel `alpha << 24 | rot << 16 | grün << 8 | blau`. */
    argb: Uint32Array;
}

interface Transform {
    type: number;
    bits: number;
    /** Breite des Bildes, auf dem die Transformation arbeitet. */
    width: number;
    data: Uint32Array;
}

const divRoundUp = (value: number, shift: number): number => (value + (1 << shift) - 1) >> shift;

/**
 * Schutz vor Strömen, die mehr Speicher verlangen, als jede Kachel braucht: Eine Höhenkachel hat 512 × 512 Pixel,
 * der Dekodierer liest auch größere Bilder, aber keine Gigabyte. Und Gruppen: die Tabellen je Gruppe wachsen schnell.
 */
const MAX_PIXELS = 1 << 26;
const MAX_GROUPS = 4096;

function fail(reason: string): never {
    throw new Error(`WebP Lossless: ${reason}`);
}

/** Zerlegt den RIFF-Behälter und liefert das Bild. */
export function decodeWebp(file: Uint8Array): WebpImage {
    const text = (at: number): string => String.fromCharCode(file[at]!, file[at + 1]!, file[at + 2]!, file[at + 3]!);
    if (file.length < 20 || text(0) !== "RIFF" || text(8) !== "WEBP") fail("kein WebP-Behälter");
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    let at = 12;
    while (at + 8 <= file.length) {
        const size = view.getUint32(at + 4, true);
        if (text(at) === "VP8L") {
            if (at + 8 + size > file.length) fail("Chunk VP8L abgeschnitten");
            return decodeLossless(file.subarray(at + 8, at + 8 + size));
        }
        at += 8 + size + (size & 1);
    }
    return fail("kein Chunk VP8L (verlustbehaftetes WebP wird nicht gelesen)");
}

function decodeLossless(payload: Uint8Array): WebpImage {
    const reader = new BitReader(payload);
    if (reader.read(8) !== 0x2f) fail("falsche Kennung");
    const width = reader.read(14) + 1;
    const height = reader.read(14) + 1;
    reader.read(1);
    if (reader.read(3) !== 0) fail("unbekannte Version");
    if (width * height > MAX_PIXELS) fail(`Bild mit ${String(width)} × ${String(height)} Pixeln ist zu groß`);

    const transforms: Transform[] = [];
    let columns = width;
    while (reader.read(1) === 1) {
        const type = reader.read(2);
        if (transforms.some((entry) => entry.type === type)) fail("Transformation doppelt");
        if (type === TRANSFORM_PREDICTOR || type === TRANSFORM_CROSS_COLOR) {
            const bits = reader.read(3) + 2;
            const data = readImage(reader, divRoundUp(columns, bits), divRoundUp(height, bits), false);
            transforms.push({ type, bits, width: columns, data });
        } else if (type === TRANSFORM_SUBTRACT_GREEN) {
            transforms.push({ type, bits: 0, width: columns, data: new Uint32Array(0) });
        } else {
            const colors = reader.read(8) + 1;
            const bits = colors > 16 ? 0 : colors > 4 ? 1 : colors > 2 ? 2 : 3;
            const palette = readImage(reader, colors, 1, false);
            // Die Palette steht als Unterschied zum Eintrag davor.
            const table = new Uint32Array(1 << (8 >> bits));
            for (let i = 0; i < colors; i += 1)
                table[i] = i === 0 ? palette[0]! : addPixels(table[i - 1]!, palette[i]!);
            transforms.push({ type, bits, width: columns, data: table });
            columns = divRoundUp(columns, bits);
        }
    }
    let pixels = readImage(reader, columns, height, true);
    for (let i = transforms.length - 1; i >= 0; i -= 1) pixels = invert(transforms[i]!, pixels, height);
    if (reader.overrun) fail("Strom endet zu früh");
    return { width, height, argb: pixels };
}

/** Ein Präfixcode über `alphabet` Symbole. */
function readPrefixCode(reader: BitReader, alphabet: number): DecodeTable {
    const lengths = new Uint8Array(alphabet);
    if (reader.read(1) === 1) {
        const count = reader.read(1) + 1;
        const first = reader.read(reader.read(1) === 1 ? 8 : 1);
        if (first >= alphabet) fail("Symbol außerhalb des Alphabets");
        lengths[first] = 1;
        if (count === 2) {
            const second = reader.read(8);
            if (second >= alphabet) fail("Symbol außerhalb des Alphabets");
            lengths[second] = 1;
        }
    } else {
        const lengthCodes = new Uint8Array(CODE_LENGTH_CODES);
        const used = reader.read(4) + 4;
        if (used > CODE_LENGTH_CODES) fail("zu viele Codelängen");
        for (let i = 0; i < used; i += 1) lengthCodes[CODE_LENGTH_ORDER[i]!] = reader.read(3);
        const lengthTable = buildDecodeTable(lengthCodes) ?? fail("ungültiger Code der Codelängen");
        let remaining = alphabet;
        if (reader.read(1) === 1) {
            remaining = 2 + reader.read(2 + 2 * reader.read(3));
            if (remaining > alphabet) fail("zu viele Codelängen angekündigt");
        }
        let symbol = 0;
        let previous = 8;
        while (symbol < alphabet && remaining > 0) {
            remaining -= 1;
            const entry = lengthTable.table[reader.peek(15) & lengthTable.mask]!;
            reader.position += entry & 15;
            const code = entry >> 4;
            if (code < CODE_LENGTH_LITERALS) {
                lengths[symbol] = code;
                symbol += 1;
                if (code !== 0) previous = code;
            } else {
                const slot = code - CODE_LENGTH_LITERALS;
                const repeat = reader.read(CODE_LENGTH_EXTRA_BITS[slot]!) + CODE_LENGTH_REPEAT_OFFSETS[slot]!;
                if (symbol + repeat > alphabet) fail("Wiederholung über das Alphabet hinaus");
                lengths.fill(code === CODE_LENGTH_LITERALS ? previous : 0, symbol, symbol + repeat);
                symbol += repeat;
            }
        }
    }
    if (reader.overrun) fail("Strom endet zu früh");
    return buildDecodeTable(lengths) ?? fail("unvollständiger Präfixcode");
}

/** Ein Teilbild (Transformationsdaten, Gruppenbild) oder das Hauptbild samt Rückverweisen. */
function readImage(reader: BitReader, width: number, height: number, main: boolean): Uint32Array {
    let cacheBits = 0;
    if (reader.read(1) === 1) {
        cacheBits = reader.read(4);
        if (cacheBits < 1 || cacheBits > MAX_CACHE_BITS) fail("Farbcache-Größe ungültig");
    }
    let groupBits = 0;
    let groups: Uint32Array | null = null;
    let groupCount = 1;
    if (main && reader.read(1) === 1) {
        groupBits = reader.read(3) + 2;
        groups = readImage(reader, divRoundUp(width, groupBits), divRoundUp(height, groupBits), false);
        for (let i = 0; i < groups.length; i += 1) {
            groups[i] = (groups[i]! >>> 8) & 0xffff;
            if (groups[i]! >= groupCount) groupCount = groups[i]! + 1;
        }
        if (groupCount > MAX_GROUPS) fail(`${String(groupCount)} Präfixcode-Gruppen sind unplausibel`);
    }
    const cacheSize = cacheBits > 0 ? 1 << cacheBits : 0;
    const alphabets = [
        NUM_LITERAL_CODES + NUM_LENGTH_CODES + cacheSize,
        NUM_LITERAL_CODES,
        NUM_LITERAL_CODES,
        NUM_LITERAL_CODES,
        NUM_DISTANCE_CODES,
    ];
    const codes: DecodeTable[] = [];
    for (let group = 0; group < groupCount; group += 1) {
        for (const alphabet of alphabets) codes.push(readPrefixCode(reader, alphabet));
    }

    const total = width * height;
    const pixels = new Uint32Array(total);
    const cache = cacheSize > 0 ? new Uint32Array(cacheSize) : null;
    const groupColumns = groups ? divRoundUp(width, groupBits) : 0;
    let cached = 0;
    let at = 0;
    const next = (table: DecodeTable): number => {
        const entry = table.table[reader.peek(15) & table.mask]!;
        reader.position += entry & 15;
        return entry >> 4;
    };
    while (at < total) {
        let base = 0;
        if (groups) base = groups[(((at / width) | 0) >> groupBits) * groupColumns + ((at % width) >> groupBits)]! * 5;
        const symbol = next(codes[base]!);
        if (symbol < NUM_LITERAL_CODES) {
            const red = next(codes[base + 1]!);
            const blue = next(codes[base + 2]!);
            const alpha = next(codes[base + 3]!);
            pixels[at] = ((alpha << 24) | (red << 16) | (symbol << 8) | blue) >>> 0;
            at += 1;
        } else if (symbol < NUM_LITERAL_CODES + NUM_LENGTH_CODES) {
            const lengthPrefix = prefixDecode(symbol - NUM_LITERAL_CODES);
            const length = lengthPrefix.base + reader.read(lengthPrefix.extraBits);
            const distancePrefix = prefixDecode(next(codes[base + 4]!));
            const distance = distanceOfCode(distancePrefix.base + reader.read(distancePrefix.extraBits), width);
            if (distance > at || at + length > total) fail("Rückverweis außerhalb des Bildes");
            for (let i = 0; i < length; i += 1) pixels[at + i] = pixels[at + i - distance]!;
            at += length;
        } else {
            if (!cache) fail("Farbcache-Symbol ohne Farbcache");
            for (; cached < at; cached += 1)
                cache[Math.imul(pixels[cached]!, 0x1e35a7bd) >>> (32 - cacheBits)] = pixels[cached]!;
            pixels[at] = cache[symbol - NUM_LITERAL_CODES - NUM_LENGTH_CODES]!;
            at += 1;
        }
        if (reader.overrun) fail("Strom endet zu früh");
    }
    return pixels;
}

const signed8 = (value: number): number => (value << 24) >> 24;
const colorDelta = (transform: number, color: number): number => (signed8(transform) * signed8(color)) >> 5;

/** Nimmt eine Transformation zurück (auf `pixels`, das dabei verändert oder ersetzt wird). */
function invert(transform: Transform, pixels: Uint32Array, height: number): Uint32Array {
    const width = transform.width;
    const { bits, data } = transform;
    if (transform.type === TRANSFORM_PREDICTOR) {
        const blocksPerRow = divRoundUp(width, bits);
        pixels[0] = addPixels(pixels[0]!, 0xff000000);
        for (let x = 1; x < width; x += 1) pixels[x] = addPixels(pixels[x]!, pixels[x - 1]!);
        for (let y = 1; y < height; y += 1) {
            const row = y * width;
            pixels[row] = addPixels(pixels[row]!, pixels[row - width]!);
            for (let x = 1; x < width; x += 1) {
                const mode = (data[(y >> bits) * blocksPerRow + (x >> bits)]! >>> 8) & 15;
                const at = row + x;
                // Für die letzte Spalte liegt „rechts oben“ im Speicher auf dem ersten Pixel der eigenen Zeile.
                const predicted = predict(
                    mode,
                    pixels[at - 1]!,
                    pixels[at - width]!,
                    pixels[at - width + 1]!,
                    pixels[at - width - 1]!,
                );
                pixels[at] = addPixels(pixels[at]!, predicted);
            }
        }
        return pixels;
    }
    if (transform.type === TRANSFORM_CROSS_COLOR) {
        const blocksPerRow = divRoundUp(width, bits);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const element = data[(y >> bits) * blocksPerRow + (x >> bits)]!;
                const pixel = pixels[y * width + x]!;
                const green = (pixel >>> 8) & 255;
                const red = (((pixel >>> 16) & 255) + colorDelta(element & 255, green)) & 255;
                const blue =
                    ((pixel & 255) +
                        colorDelta((element >>> 8) & 255, green) +
                        colorDelta((element >>> 16) & 255, red)) &
                    255;
                pixels[y * width + x] = ((pixel & 0xff00ff00) | (red << 16) | blue) >>> 0;
            }
        }
        return pixels;
    }
    if (transform.type === TRANSFORM_SUBTRACT_GREEN) {
        for (let i = 0; i < pixels.length; i += 1) {
            const pixel = pixels[i]!;
            const green = (pixel >>> 8) & 255;
            const red = (((pixel >>> 16) & 255) + green) & 255;
            const blue = ((pixel & 255) + green) & 255;
            pixels[i] = ((pixel & 0xff00ff00) | (red << 16) | blue) >>> 0;
        }
        return pixels;
    }
    // Farbindex: mehrere Indizes stecken je Pixel im Grünkanal, die Breite wächst wieder.
    const out = new Uint32Array(width * height);
    const packedWidth = divRoundUp(width, bits);
    const bitsPerIndex = 8 >> bits;
    const mask = (1 << bitsPerIndex) - 1;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const packed = (pixels[y * packedWidth + (x >> bits)]! >>> 8) & 255;
            out[y * width + x] = data[(packed >> ((x & ((1 << bits) - 1)) * bitsPerIndex)) & mask]!;
        }
    }
    return out;
}
