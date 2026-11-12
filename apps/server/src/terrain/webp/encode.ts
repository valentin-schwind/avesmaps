import { BitWriter } from "./bits.ts";
import { NUM_LENGTH_CODES, NUM_LITERAL_CODES, prefixEncode, TRANSFORM_PREDICTOR } from "./format.ts";
import { PrefixCode } from "./prefix-code.ts";
import { chooseModes, residualImage } from "./predictor-search.ts";
import {
    alphabetSlice,
    blockHistograms,
    CACHE,
    COPY,
    countToken,
    findReferences,
    groupBlocks,
    groupHistograms,
    layoutFor,
    tokensOfPixels,
    type Grouping,
    type Layout,
    type Tokens,
} from "./references.ts";

/**
 * Kodiert ein RGB-Bild verlustfrei als WebP (VP8L), ganz in TypeScript und ohne native Bibliothek (die Stage
 * rechnet die Höhenkacheln auf dem VPS, dort gibt es nur Node). Die Kopfzeile des Formats und alle
 * Bausteine stehen in `format.ts`, gelesen wird mit `decode.ts`.
 *
 * Aufbau des Stroms: die Transformation „Predictor“ (Vorhersage aus links, oben und links oben, je Block von
 * 16 × 16 Pixeln eine von drei Arten), dann das Bild der Abweichungen als Zeichenfolge (Pixel, Rückverweise
 * auf gleiche Pixel links oder darüber, Treffer im Farbcache) mit einem Präfixcode je Gruppe von Blöcken.
 *
 * Gleiche Eingabe ergibt auf jedem Rechner dieselben Bytes: Die Revision einer Kachelpyramide ist der Hash
 * ihrer Kacheln und Builds müssen reproduzierbar bleiben (AGENTS.md). Deshalb steht in keiner Entscheidung
 * eine Fließkommafunktion (`fixed-log.ts`), kein Zufall und keine Zeit.
 *
 * Gemessen an den 341 Höhenkacheln des 8k-Stands (WI-0073): rund 63 % der PNG-Größe, etwa 3 % mehr als
 * libwebp (Methode 4). Die Ableitung von z0 bis z4 braucht ein Drittel bis eine halbe Minute.
 */

/** Zweierlogarithmus der Kante eines Vorhersageblocks. */
const PREDICTOR_BITS = 4;
/** Zweierlogarithmus der Kante eines Blocks, der einen eigenen Präfixcode wählt. */
const GROUP_BITS = 5;
/** So viele Gruppen von Blöcken mit eigenem Präfixcode, höchstens. */
const GROUPS = 16;
const GROUP_ROUNDS = 6;
/** Größe des Farbcaches in Bit. */
const CACHE_BITS = 9;
/** Kürzester Rückverweis in Pixeln. */
const MIN_COPY = 5;
/** Bis zu dieser Zahl an Zeichen lohnt es, auch einen einfachen Aufbau (ein Code, kein Cache) zu versuchen. */
const SMALL_STREAM = 16384;

/** Die fünf Präfixcodes einer Gruppe. */
function codesOf(histogram: Uint32Array, layout: Layout): PrefixCode[] {
    return [0, 1, 2, 3, 4].map((alphabet) => new PrefixCode(alphabetSlice(histogram, layout, alphabet)));
}

function writeToken(writer: BitWriter, codes: readonly PrefixCode[], tokens: Tokens, index: number): void {
    const kind = tokens.kind[index]!;
    const value = tokens.value[index]!;
    if (kind === CACHE) {
        codes[0]!.write(writer, NUM_LITERAL_CODES + NUM_LENGTH_CODES + value);
    } else if (kind === COPY) {
        const lengthPrefix = prefixEncode(tokens.length[index]!);
        codes[0]!.write(writer, NUM_LITERAL_CODES + lengthPrefix.symbol);
        writer.write(lengthPrefix.extraValue, lengthPrefix.extraBits);
        const distancePrefix = prefixEncode(value);
        codes[4]!.write(writer, distancePrefix.symbol);
        writer.write(distancePrefix.extraValue, distancePrefix.extraBits);
    } else {
        codes[0]!.write(writer, (value >>> 8) & 255);
        codes[1]!.write(writer, (value >>> 16) & 255);
        codes[2]!.write(writer, value & 255);
        codes[3]!.write(writer, value >>> 24);
    }
}

const NO_CACHE = layoutFor(0);

/** Ein kleines Bild (Vorhersagearten, Gruppen) ohne Rückverweise und mit einem einzigen Code je Alphabet. */
function writeSubImage(writer: BitWriter, pixels: Uint32Array): void {
    const tokens = tokensOfPixels(pixels);
    const histogram = new Uint32Array(NO_CACHE.total);
    for (let index = 0; index < tokens.count; index += 1) countToken(histogram, 0, NO_CACHE, tokens, index);
    const codes = codesOf(histogram, NO_CACHE);
    writer.write(0, 1);
    for (const code of codes) code.describe(writer);
    for (let index = 0; index < tokens.count; index += 1) writeToken(writer, codes, tokens, index);
}

/** Der Strom des Hauptbildes ab dem Farbcache-Merker. */
function writeMainImage(
    writer: BitWriter,
    tokens: Tokens,
    layout: Layout,
    width: number,
    grouping: Grouping,
    blockHist: Uint32Array,
): void {
    if (layout.cacheBits > 0) {
        writer.write(1, 1);
        writer.write(layout.cacheBits, 4);
    } else {
        writer.write(0, 1);
    }
    const blocksX = (width + (1 << GROUP_BITS) - 1) >> GROUP_BITS;
    const codes = groupHistograms(blockHist, layout, grouping).map((histogram) => codesOf(histogram, layout));
    if (grouping.groups > 1) {
        writer.write(1, 1);
        writer.write(GROUP_BITS - 2, 3);
        writeSubImage(
            writer,
            Uint32Array.from(
                grouping.group,
                (group) => (((group >> 8) << 16) | ((group & 255) << 8) | 0xff000000) >>> 0,
            ),
        );
    } else {
        writer.write(0, 1);
    }
    for (const group of codes) for (const code of group) code.describe(writer);
    for (let index = 0; index < tokens.count; index += 1) {
        const start = tokens.start[index]!;
        const block = (Math.floor(start / width) >> GROUP_BITS) * blocksX + ((start % width) >> GROUP_BITS);
        writeToken(writer, codes[grouping.group[block]!]!, tokens, index);
    }
}

/** RIFF-Behälter um einen VP8L-Strom. */
function container(payload: Uint8Array): Buffer {
    const padded = payload.length + (payload.length & 1);
    const file = Buffer.alloc(20 + padded);
    file.write("RIFF", 0, "ascii");
    file.writeUInt32LE(12 + padded, 4);
    file.write("WEBPVP8L", 8, "ascii");
    file.writeUInt32LE(payload.length, 16);
    file.set(payload, 20);
    return file;
}

/**
 * Kodiert ein opakes RGB-Bild (drei Bytes je Pixel, Zeile für Zeile) als verlustfreies WebP. Alpha ist
 * überall 255; das Kopfbit „Alpha benutzt“ bleibt aus, der Alphakanal kostet kein Bit.
 */
export function encodeWebpRgb(rgb: Uint8Array, width: number, height: number): Buffer {
    if (width < 1 || height < 1 || width > 16384 || height > 16384) throw new Error("Bildgröße außerhalb von VP8L");
    if (rgb.length !== width * height * 3) throw new Error("RGB-Puffer passt nicht zur Bildgröße");
    const argb = new Uint32Array(width * height);
    for (let i = 0; i < argb.length; i += 1) {
        argb[i] = (0xff000000 | (rgb[3 * i]! << 16) | (rgb[3 * i + 1]! << 8) | rgb[3 * i + 2]!) >>> 0;
    }
    const modes = chooseModes(argb, width, height, PREDICTOR_BITS);
    const residuals = residualImage(argb, width, height, PREDICTOR_BITS, modes);

    const blocks = ((width + (1 << GROUP_BITS) - 1) >> GROUP_BITS) * ((height + (1 << GROUP_BITS) - 1) >> GROUP_BITS);
    // Der übliche Aufbau; kleine Bilder (Meer, Ebenen) probieren zusätzlich die einfachen, deren Köpfe kürzer sind.
    const first = findReferences(residuals, width, CACHE_BITS, MIN_COPY);
    const variants: { cacheBits: number; groups: number; tokens: Tokens }[] = [
        { cacheBits: CACHE_BITS, groups: GROUPS, tokens: first },
    ];
    if (first.count < SMALL_STREAM) {
        variants.push(
            { cacheBits: CACHE_BITS, groups: 1, tokens: first },
            { cacheBits: 0, groups: 1, tokens: findReferences(residuals, width, 0, MIN_COPY) },
        );
    }
    let best: Uint8Array | undefined;
    for (const { cacheBits, groups, tokens } of variants) {
        const layout = layoutFor(cacheBits);
        const blockHist = blockHistograms(tokens, layout, width, height, GROUP_BITS);
        const grouping = groupBlocks(blockHist, layout, blocks, groups, GROUP_ROUNDS);
        const writer = new BitWriter();
        writer.write(0x2f, 8);
        writer.write(width - 1, 14);
        writer.write(height - 1, 14);
        writer.write(0, 1);
        writer.write(0, 3);
        writer.write(1, 1);
        writer.write(TRANSFORM_PREDICTOR, 2);
        writer.write(PREDICTOR_BITS - 2, 3);
        writeSubImage(
            writer,
            Uint32Array.from(modes, (mode) => (0xff000000 | (mode << 8)) >>> 0),
        );
        writer.write(0, 1);
        writeMainImage(writer, tokens, layout, width, grouping, blockHist);
        const stream = writer.finish();
        if (!best || stream.length < best.length) best = stream;
    }
    return container(best!);
}
