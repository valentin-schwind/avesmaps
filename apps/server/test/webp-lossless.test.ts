import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tileFormatOf, decodeTileImage } from "../src/terrain/tile-image.ts";
import { BitReader, BitWriter } from "../src/terrain/webp/bits.ts";
import { decodeWebp } from "../src/terrain/webp/decode.ts";
import { encodeWebpRgb } from "../src/terrain/webp/encode.ts";
import { fixedLog2 } from "../src/terrain/webp/fixed-log.ts";
import { buildDecodeTable, canonicalCodes, huffmanLengths } from "../src/terrain/webp/huffman.ts";
import { encodePngRgb, readPng } from "./helpers/png.ts";

/**
 * Verlustfreies WebP für die Höhenkacheln (WI-0073): ein eigener Kodierer und Dekodierer in TypeScript, weil die
 * Stage die Kacheln auf dem VPS rechnet und dort keine Bildbibliothek liegt.
 *
 * Wie weit der Dekodierer dem Format folgt, zeigt der Vergleich mit libwebp: Die Dateien unter `fixtures/webp`
 * hat Pillow (libwebp 1.6) mit verschiedenen Stufen geschrieben (`quality`, `method`; mit allen vier Transformationen,
 * Farbcache, mehreren Präfixcode-Gruppen und den festen Entfernungscodes) und ihre Pixel als PNG daneben gelegt.
 * Umgekehrt hat libwebp die Ausgabe des Kodierers gelesen: Alle 341 Kacheln des 8k-Stands und die Datei `golden.webp`
 * (siehe unten) ergaben dieselben RGB-Werte wie die PNG-Kacheln (Messung im Work Item).
 */

const FIXTURES = join(import.meta.dirname, "fixtures", "webp");

/** Ein deterministischer Zufall nur mit Ganzzahlen. */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state >>> 8;
    };
}

/** Rauschen: jedes Byte zufällig, die schwerste Eingabe. */
function noise(width: number, height: number, seed: number): Uint8Array {
    const next = random(seed);
    return Uint8Array.from({ length: width * height * 3 }, () => next() & 255);
}

/**
 * Höhenähnlich: eine glatte ganzzahlige Höhe, mit einem Faktor je Zeile als 24-Bit-Zahl auf drei Byte gelegt
 * (wie die Kodierung der Kacheln: die Werte liegen auf einem Gitter, das mit der Zeile wandert), dazu ein Meer.
 */
function hills(width: number, height: number): Uint8Array {
    const next = random(7);
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const dx = x - (width >> 1);
            const dy = y - (height >> 1);
            const land = Math.max(0, 2400 - ((dx * dx + dy * dy) >> 1) + (next() % 3));
            const value = 100000 + land * (130 + (y >> 5)) + (land > 0 ? next() % 2 : 0);
            const at = (y * width + x) * 3;
            rgb[at] = (value >> 16) & 255;
            rgb[at + 1] = (value >> 8) & 255;
            rgb[at + 2] = value & 255;
        }
    }
    return rgb;
}

function rgbaOf(argb: Uint32Array): Uint8Array {
    const rgba = new Uint8Array(argb.length * 4);
    argb.forEach((pixel, i) => {
        rgba[4 * i] = (pixel >>> 16) & 255;
        rgba[4 * i + 1] = (pixel >>> 8) & 255;
        rgba[4 * i + 2] = pixel & 255;
        rgba[4 * i + 3] = pixel >>> 24;
    });
    return rgba;
}

describe("Dekodierer gegen libwebp", () => {
    const files = readdirSync(FIXTURES).filter((name) => name.endsWith(".webp") && name !== "golden.webp");

    it("die Fixtures decken alle Transformationen und den Farbcache ab", () => {
        expect(files.length).toBeGreaterThanOrEqual(12);
    });

    it.each(files)("%s ergibt die Pixel der PNG-Datei daneben", (name) => {
        const expected = readPng(readFileSync(join(FIXTURES, name.replace(/-m\d\.webp$/, ".png"))));
        const image = decodeWebp(readFileSync(join(FIXTURES, name)));
        expect(image.width).toBe(expected.width);
        expect(image.height).toBe(expected.height);
        expect(Buffer.from(rgbaOf(image.argb)).equals(Buffer.from(expected.rgba))).toBe(true);
    });

    it("🔴 verdrehte Bits: lesbar oder ein klarer Fehler des Formats, nie ein anderer Absturz und kein Warten", () => {
        const next = random(99);
        for (const name of ["dem-crop-m4.webp", "palette-13-m4.webp", "gradient-m2.webp", "logo-m4.webp"]) {
            const good = readFileSync(join(FIXTURES, name));
            for (let round = 0; round < 150; round += 1) {
                const bad = Buffer.from(good);
                for (let flips = 1 + (next() % 4); flips > 0; flips -= 1) {
                    bad[20 + (next() % (bad.length - 20))]! ^= 1 << (next() % 8);
                }
                try {
                    decodeWebp(bad);
                } catch (error) {
                    expect((error as Error).message, name).toMatch(/^WebP Lossless: /);
                }
            }
        }
    });

    it("🔴 ein beschädigter Strom wirft, statt Pixel zu raten", () => {
        const good = readFileSync(join(FIXTURES, "dem-crop-m4.webp"));
        expect(() => decodeWebp(good.subarray(0, good.length >> 1))).toThrow(/WebP Lossless/);
        expect(() => decodeWebp(Buffer.from("kein WebP, aber lang genug fuer den Kopf"))).toThrow(/WebP Lossless/);
        const wrongSignature = Buffer.from(good);
        wrongSignature[20] = 0x2e;
        expect(() => decodeWebp(wrongSignature)).toThrow(/Kennung/);
    });
});

describe("Kodierer", () => {
    const sizes: [number, number][] = [
        [1, 1],
        [1, 9],
        [9, 1],
        [2, 3],
        [16, 16],
        [17, 33],
        [64, 64],
        [100, 37],
        [130, 130],
    ];

    it.each(sizes)("kodiert und liest zurück: Rauschen %i × %i", (width, height) => {
        const rgb = noise(width, height, width * 31 + height);
        const image = decodeWebp(encodeWebpRgb(rgb, width, height));
        expect(image.width).toBe(width);
        expect(image.height).toBe(height);
        expect(Buffer.from(rgbaOf(image.argb)).equals(Buffer.from(rgbaOfRgb(rgb)))).toBe(true);
    });

    it.each(sizes)("kodiert und liest zurück: Höhenfeld %i × %i", (width, height) => {
        const rgb = hills(width, height);
        const image = decodeWebp(encodeWebpRgb(rgb, width, height));
        expect(Buffer.from(rgbaOf(image.argb)).equals(Buffer.from(rgbaOfRgb(rgb)))).toBe(true);
    });

    it("eine Fläche aus einer Farbe wird winzig", () => {
        const rgb = new Uint8Array(512 * 512 * 3);
        for (let i = 0; i < rgb.length; i += 3) rgb.set([1, 134, 160], i);
        const webp = encodeWebpRgb(rgb, 512, 512);
        expect(webp.length).toBeLessThan(400);
        expect(Buffer.from(rgbaOf(decodeWebp(webp).argb)).equals(Buffer.from(rgbaOfRgb(rgb)))).toBe(true);
    });

    it("legt einen gültigen RIFF-Behälter an (Größen, gerade Länge, Kennung, Alpha nicht benutzt)", () => {
        const webp = encodeWebpRgb(noise(5, 5, 1), 5, 5);
        expect(webp.toString("ascii", 0, 4)).toBe("RIFF");
        expect(webp.toString("ascii", 8, 16)).toBe("WEBPVP8L");
        expect(webp.readUInt32LE(4)).toBe(webp.length - 8);
        expect(webp.length % 2).toBe(0);
        expect(webp.readUInt32LE(16)).toBeLessThanOrEqual(webp.length - 20);
        // 0x2f, dann 14 + 14 Bit Größe, das Bit „Alpha benutzt“ (aus) und drei Bit Version (0).
        const reader = new BitReader(webp.subarray(20));
        expect([reader.read(8), reader.read(14), reader.read(14), reader.read(1), reader.read(3)]).toEqual([
            0x2f, 4, 4, 0, 0,
        ]);
    });

    it("lehnt ein Bild ab, dessen Puffer nicht zur Größe passt", () => {
        expect(() => encodeWebpRgb(new Uint8Array(10), 4, 4)).toThrow(/passt nicht/);
        expect(() => encodeWebpRgb(new Uint8Array(0), 0, 0)).toThrow(/Bildgröße/);
    });

    it("🔴 gleiche Eingabe, gleiche Bytes (Revision der Kacheln = Hash der Kacheln, AGENTS.md: Builds reproduzierbar)", () => {
        const rgb = hills(128, 96);
        const first = encodeWebpRgb(rgb, 128, 96);
        expect(encodeWebpRgb(Uint8Array.from(rgb), 128, 96).equals(first)).toBe(true);
        // Ein anderer Rechner, eine andere Node-Version, ein anderes Jahr: dieselbe Datei. Sie hat libwebp (Pillow 12.2,
        // libwebp 1.6) gelesen und dieselben Pixel erhalten; ändert sich der Kodierer mit Absicht, wird sie neu erzeugt
        // (`encodeWebpRgb(hills(128, 96), 128, 96)`, danach mit libwebp gegenlesen) und die neue Revision gemeldet.
        expect(first.equals(readFileSync(join(FIXTURES, "golden.webp")))).toBe(true);
    });

    it("ein Höhenfeld wird deutlich kleiner als sein PNG (verlustfrei, WI-0073)", () => {
        const rgb = hills(256, 256);
        const webp = encodeWebpRgb(rgb, 256, 256);
        const png = encodePngRgb(rgb, 256);
        expect(webp.length).toBeLessThan(png.length * 0.9);
    });
});

/** Ein RGB-Puffer als RGBA mit Alpha 255, zum Vergleichen. */
function rgbaOfRgb(rgb: Uint8Array): Uint8Array {
    const rgba = new Uint8Array((rgb.length / 3) * 4);
    for (let i = 0; i < rgb.length / 3; i += 1) rgba.set([rgb[3 * i]!, rgb[3 * i + 1]!, rgb[3 * i + 2]!, 255], 4 * i);
    return rgba;
}

describe("Kachelbilder lesen (WebP und PNG aus der Zeit davor)", () => {
    const rgb = hills(512, 512);

    it("erkennt das Format an den ersten Bytes", () => {
        expect(tileFormatOf(encodePngRgb(rgb, 512))).toBe("png");
        expect(tileFormatOf(encodeWebpRgb(rgb, 512, 512))).toBe("webp");
        expect(tileFormatOf(Buffer.from("GIF89a"))).toBeNull();
    });

    it("🔴 dieselben RGB-Werte aus WebP und PNG, Byte für Byte (verlustfrei: die Höhe steckt in RGB)", () => {
        const fromWebp = decodeTileImage(encodeWebpRgb(rgb, 512, 512));
        const fromPng = decodeTileImage(encodePngRgb(rgb, 512));
        expect([fromWebp.width, fromWebp.height]).toEqual([512, 512]);
        expect(Buffer.from(fromWebp.rgb).equals(Buffer.from(fromPng.rgb))).toBe(true);
        expect(Buffer.from(fromWebp.rgb).equals(Buffer.from(rgb))).toBe(true);
    });

    it("weder PNG noch WebP: wirft", () => {
        expect(() => decodeTileImage(Buffer.from("GIF89a und mehr Bytes"))).toThrow(/weder PNG noch WebP/);
    });
});

describe("Bausteine", () => {
    it("Bits: niederwertig zuerst, 24 Bit am Stück, Rundlauf", () => {
        const writer = new BitWriter();
        const values: [number, number][] = [
            [5, 3],
            [0xabcdef, 24],
            [1, 1],
            [0, 7],
            [0x3fff, 14],
            [0xffffff, 24],
        ];
        for (const [value, bits] of values) writer.write(value, bits);
        const bytes = writer.finish();
        expect(bytes[0]).toBe(0b00000101 | ((0xabcdef & 0x1f) << 3));
        const reader = new BitReader(bytes);
        for (const [value, bits] of values) expect(reader.read(bits)).toBe(value);
    });

    it("Huffman: längenbegrenzt, vollständig, kanonisch und lesbar", () => {
        // Fibonacci-Häufigkeiten ergäben ohne Grenze einen Baum der Tiefe 40.
        const counts = new Uint32Array(40);
        let a = 1;
        let b = 1;
        for (let i = 0; i < counts.length; i += 1) {
            counts[i] = a;
            [a, b] = [b, Math.min(a + b, 2 ** 31)];
        }
        const lengths = huffmanLengths(counts, 15);
        expect(Math.max(...lengths)).toBeLessThanOrEqual(15);
        expect(lengths.every((length) => length > 0)).toBe(true);
        expect(lengths.reduce((sum, length) => sum + 2 ** -length, 0)).toBeCloseTo(1, 12);
        const table = buildDecodeTable(lengths);
        expect(table).not.toBeNull();
        // Jedes Symbol wird über seinen Code wiedergefunden.
        const codes = canonicalCodes(lengths);
        lengths.forEach((length, symbol) => {
            const entry = table!.table[codes[symbol]! & table!.mask]!;
            expect([entry >> 4, entry & 15]).toEqual([symbol, length]);
        });
        // Ein unvollständiger Code ist kein Code.
        expect(buildDecodeTable(Uint8Array.of(1, 2, 0, 0))).toBeNull();
    });

    it("Huffman: ein Symbol kostet kein Bit, gleiche Häufigkeiten ergeben dieselben Längen", () => {
        expect(buildDecodeTable(Uint8Array.of(0, 0, 1))?.mask).toBe(0);
        const counts = Uint32Array.of(5, 5, 5, 5, 1, 9, 9, 0);
        expect(huffmanLengths(counts).join()).toBe(huffmanLengths(Uint32Array.from(counts)).join());
    });

    it("fixedLog2: Ganzzahl-Logarithmus auf ein Tausendstel Bit (abgeschnitten), Zweierpotenzen genau", () => {
        for (const k of [0, 1, 5, 10, 17, 30]) expect(fixedLog2(2 ** k)).toBe(k * 1024);
        for (const value of [3, 7, 100, 4097, 262143, 1_000_003]) {
            expect(Math.abs(fixedLog2(value) / 1024 - Math.log2(value))).toBeLessThan(0.0015);
        }
    });
});
