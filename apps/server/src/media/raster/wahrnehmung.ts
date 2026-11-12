import sharp from "sharp";
import { inspectImage, type RasterFormat } from "./inspect.ts";
import { RASTER_LIMITS } from "./limits.ts";

/**
 * Der Wahrnehmungs-Hash eines Originals (WI-0068 D2, Plan `project-control/handovers/2026-10-11-medien-duplikate-bewertung.md` §1):
 * 64 Bit, nach denen zwei Bilder „ähnlich“ heißen, auch wenn ihre Bytes verschieden sind (andere Größe, anderes Format, neu gespeichert).
 * Bytegleiche Duplikate erkennt weiter die SHA-256 (D1); dieser Hash ist nur der Hinweis für die zweite Stufe.
 *
 * Rezept (dHash): Orientierung aus EXIF anwenden, Durchsichtiges auf mittleres Grau legen, Graustufen, auf 9 × 8 verkleinern; je Zeile
 * vergleicht ein Bit, ob das Pixel heller ist als sein linker Nachbar. Abstand zweier Hashes ist die Zahl verschiedener Bits (0 bis 64).
 *
 * 🔴 Er HÄLT NUR FEST (Spalte `media_file.perceptual_hash` am Original, Migration 0196) und entscheidet nichts: kein Zusammenführen, keine
 * Veröffentlichung. Ab welchem Abstand „ähnlich“ gilt, bestimmt erst die Kalibrierung am Bestand (`media:aehnlich -- --bericht`), je
 * Asset-Typ; Wappen sind auf grauem Grund fast nur Schildumriss und brauchen vielleicht eine engere Schwelle.
 * 🪤 Ändert sich das Rezept, ändern sich die Hashes: dann `WAHRNEHMUNG_REZEPT` hochzählen und den Bestand nachrechnen.
 */
export const WAHRNEHMUNG_REZEPT = "dhash-9x8-grau-v1";

const GRAU = { r: 128, g: 128, b: 128 } as const;
/** SVG ohne festes Maß: in kleiner Auflösung rastern genügt für 9 × 8 Pixel. */
const SVG_DICHTE = 72;

/** Der Hash als 16 Hexziffern (64 Bit). Wirft, wenn sich das Bild nicht dekodieren lässt (die Aufnahme hat es dann schon abgewiesen). */
export async function wahrnehmungsHash(bytes: Uint8Array, knownFormat?: RasterFormat): Promise<string> {
    // `knownFormat`: das Raster einer PDF-Seite (WI-0275) ist schon geprüft und darf über der 6-MiB-Grenze der Bilder liegen.
    const inspection = knownFormat === undefined ? inspectImage(bytes) : { format: knownFormat };
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const optionen = {
        failOn: "error",
        limitInputPixels: RASTER_LIMITS.maxPixels,
        ...(inspection.format === "svg" ? { density: SVG_DICHTE } : {}),
    } as const;
    const { data, info } = await sharp(input, optionen)
        .autoOrient()
        .flatten({ background: GRAU })
        .greyscale()
        .resize({ width: 9, height: 8, fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const kanaele = info.channels;
    let bits = 0n;
    for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
            const links = data[(y * 9 + x) * kanaele] ?? 0;
            const rechts = data[(y * 9 + x + 1) * kanaele] ?? 0;
            bits = (bits << 1n) | (rechts > links ? 1n : 0n);
        }
    }
    return bits.toString(16).padStart(16, "0");
}

/** Die Zahl verschiedener Bits zweier Hashes (0 bis 64). */
export function wahrnehmungsAbstand(a: string, b: string): number {
    let rest = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let zahl = 0;
    while (rest > 0n) {
        zahl += Number(rest & 1n);
        rest >>= 1n;
    }
    return zahl;
}
