import sharp from "sharp";

/**
 * Selbst erzeugte Bilder für die Tests der Rasterpipeline (WI-0063 MEDIA-M7). Nichts davon ist ein Legacy-Medium; jedes
 * Bild entsteht aus ganzzahliger Rechnung, ist also auf jedem Rechner dasselbe Bild, und die Prüfvektoren der Tests hängen
 * daran (dieselben Bytes rein, dieselben Bytes raus).
 */

export interface RawImage {
    data: Buffer;
    width: number;
    height: number;
    channels: 3 | 4;
}

const rawOptions = (image: RawImage) => ({
    raw: { width: image.width, height: image.height, channels: image.channels },
});

/**
 * Ein Bild mit Verlauf, Rauschen und scharfen Kanten, damit verlustbehaftete und verlustfreie Kodierung sich unterscheiden.
 * Mit `channels: 4` hat es halbdurchsichtige und undurchsichtige Pixel (nie voll durchsichtige: deren Farbe ist beim
 * verlustfreien WebP nicht festgelegt). `noisy: false` lässt das Rauschen weg: große Bilder bleiben dann klein und unter der
 * Bytegrenze (6 MiB), die die Vorprüfung durchsetzt.
 */
export function patternImage(width: number, height: number, channels: 3 | 4 = 3, noisy = true): RawImage {
    const data = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * channels;
            const noise = noisy ? (x * 7919 + y * 104_729 + x * y) % 23 : 0;
            const edge = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0 ? 40 : 0;
            data[i] = (x * 3 + noise + edge) & 255;
            data[i + 1] = (y * 5 + noise * 2) & 255;
            data[i + 2] = ((x + y) * 2 + edge + noise) & 255;
            if (channels === 4) data[i + 3] = x % 7 === 0 ? 128 : 255;
        }
    }
    return { data, width, height, channels };
}

/** Links rot, rechts blau: an ihm sieht man, ob die Orientierung angewendet wurde. */
export function halvesImage(width: number, height: number): RawImage {
    const data = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 3;
            const left = x < width / 2;
            data[i] = left ? 220 : 20;
            data[i + 1] = 20;
            data[i + 2] = left ? 20 : 220;
        }
    }
    return { data, width, height, channels: 3 };
}

export const png = (image: RawImage): Promise<Buffer> => sharp(image.data, rawOptions(image)).png().toBuffer();

export const jpeg = (image: RawImage, quality = 92): Promise<Buffer> =>
    sharp(image.data, rawOptions(image)).jpeg({ quality }).toBuffer();

/** Ein JPEG mit EXIF-Orientierung, Kamerakennung und GPS-Position (Positivkontrolle für das Entfernen). */
export function jpegWithExif(image: RawImage, orientation: number): Promise<Buffer> {
    return sharp(image.data, rawOptions(image))
        .jpeg({ quality: 92 })
        .withMetadata({ orientation })
        .withExifMerge({
            IFD0: { Make: "FixtureCam", Model: "FX-1" },
            IFD3: {
                GPSLatitudeRef: "N",
                GPSLatitude: "48/1 8/1 2400/100",
                GPSLongitudeRef: "E",
                GPSLongitude: "11/1 34/1 1200/100",
            },
        })
        .toBuffer();
}

/** Ein Bild, dessen Pixel Display-P3-Koordinaten sind und das das P3-Profil trägt; als sRGB gelesen wäre es ein anderes Bild. */
export function p3Png(color: { r: number; g: number; b: number }): Promise<Buffer> {
    return sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
        .withIccProfile("p3")
        .png()
        .toBuffer();
}

/** Ein einfarbiges Bild einer Größe: die Bomben und Grenzfälle brauchen keine Bildinhalte. */
export function solidPng(width: number, height: number, channels: 1 | 3 | 4 = 3): Promise<Buffer> {
    const background = channels === 1 ? { r: 120, g: 120, b: 120 } : { r: 200, g: 50, b: 30 };
    return sharp({ create: { width, height, channels: channels === 1 ? 3 : channels, background } })
        .toColourspace(channels === 1 ? "b-w" : "srgb")
        .png()
        .toBuffer();
}

/** Mehrbildige Dateien aus Einzelbildern (sharp `join`). */
async function frames(count: number, image: RawImage): Promise<Buffer[]> {
    return Promise.all(
        Array.from({ length: count }, (_unused, n) =>
            sharp(image.data, rawOptions(image))
                .modulate({ brightness: 1 - n * 0.1 })
                .png()
                .toBuffer(),
        ),
    );
}

export async function animatedGif(count: number, image: RawImage): Promise<Buffer> {
    return sharp(await frames(count, image), { join: { animated: true, across: 1 } })
        .gif({ delay: Array.from({ length: count }, () => 100), loop: 0 })
        .toBuffer();
}

export async function animatedWebp(count: number, image: RawImage): Promise<Buffer> {
    return sharp(await frames(count, image), { join: { animated: true, across: 1 } })
        .webp({ delay: Array.from({ length: count }, () => 100), loop: 0 })
        .toBuffer();
}

/** Ein GIF mit `count` Einzelbildern von 1 × 1 Pixel, von Hand zusammengesetzt (der kleinste gültige Aufbau). */
export function minimalGif(count: number): Buffer {
    const header = "47494638396101000100800000000000ffffff";
    const frame = "21f90401000000002c00000000010001000002024401" + "00";
    return Buffer.from(header + frame.repeat(count) + "3b", "hex");
}

/** Ein PNG mit einem `acTL`-Block vor den Bilddaten: so kündigt ein animiertes PNG (APNG) seine Einzelbilder an. */
export function withApngMarker(pngBytes: Buffer, frameCount: number): Buffer {
    const chunk = Buffer.alloc(8 + 8 + 4);
    chunk.writeUInt32BE(8, 0);
    chunk.write("acTL", 4, "ascii");
    chunk.writeUInt32BE(frameCount, 8);
    chunk.writeUInt32BE(0, 12);
    // Die Prüfsumme ist für die Vorprüfung ohne Belang (sie liest nur den Kopf).
    const afterIhdr = 8 + 8 + 13 + 4;
    return Buffer.concat([pngBytes.subarray(0, afterIhdr), chunk, pngBytes.subarray(afterIhdr)]);
}

/** Schreibt andere Maße in den PNG-Kopf: eine Dekompressionsbombe von wenigen Bytes. */
export function pngClaimingSize(pngBytes: Buffer, width: number, height: number): Buffer {
    const copy = Buffer.from(pngBytes);
    copy.writeUInt32BE(width, 16);
    copy.writeUInt32BE(height, 20);
    return copy;
}

/** Schreibt andere Maße in den ersten Rahmenkopf (SOF) eines JPEG. */
export function jpegClaimingSize(jpegBytes: Buffer, width: number, height: number): Buffer {
    const copy = Buffer.from(jpegBytes);
    let offset = 2;
    while (offset + 9 < copy.length) {
        const marker = copy[offset + 1] ?? 0;
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            copy.writeUInt16BE(height, offset + 5);
            copy.writeUInt16BE(width, offset + 7);
            return copy;
        }
        offset += 2 + copy.readUInt16BE(offset + 2);
    }
    throw new Error("kein SOF im JPEG");
}

/** Die Blocktypen einer WebP-Datei in ihrer Reihenfolge (`VP8 `, `VP8L`, `VP8X`, `ALPH`, `EXIF`, `ICCP`, `XMP `). */
export function webpChunks(bytes: Uint8Array): string[] {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const types: string[] = [];
    let offset = 12;
    while (offset + 8 <= buffer.length) {
        types.push(buffer.toString("ascii", offset, offset + 4));
        const length = buffer.readUInt32LE(offset + 4);
        offset += 8 + length + (length & 1);
    }
    return types;
}

/** Dekodiert eine Datei in rohe Pixel (immer mit Alphakanal), zum Vergleichen. */
export async function decodeRaw(bytes: Uint8Array): Promise<RawImage> {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: 4 };
}

/** Ein SVG ohne Text, mit Verlauf und durchsichtigem Hintergrund. */
export const GRADIENT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="300" viewBox="0 0 200 300">
  <!-- ein Kommentar, in dem <text> vorkommt, ist kein Text -->
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c83214"/><stop offset="1" stop-color="#1432c8"/></linearGradient>
    <clipPath id="c"><circle cx="100" cy="150" r="90"/></clipPath>
  </defs>
  <g clip-path="url(#c)"><rect x="0" y="0" width="200" height="300" fill="url(#g)"/></g>
  <use xlink:href="#c" fill="none"/>
</svg>
`;
