import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { wahrnehmungsAbstand, wahrnehmungsHash } from "../src/media/raster/wahrnehmung.ts";

/**
 * Der Wahrnehmungs-Hash (WI-0068 D2, `media/raster/wahrnehmung.ts`): dasselbe Motiv in anderer Größe, anderem Format oder gedreht
 * gespeichert liegt nah beieinander, ein anderes Motiv weit weg. Die Schwelle für „ähnlich“ setzt erst die Kalibrierung am Bestand; hier
 * stehen nur die Abstände, die das Rezept tragen muss.
 */

/** Ein Motiv mit Flächen und Kanten (ein Hash aus reinem Rauschen sagte nichts über Bilder). */
function motiv(variante: "burg" | "kueste"): string {
    return variante === "burg"
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
             <rect width="100" height="60" fill="#8fb3d9"/><rect y="40" width="100" height="20" fill="#5d7f3a"/>
             <rect x="30" y="18" width="40" height="24" fill="#7a6a58"/><rect x="26" y="10" width="10" height="32" fill="#6b5b49"/>
             <rect x="64" y="10" width="10" height="32" fill="#6b5b49"/><circle cx="85" cy="12" r="6" fill="#f2d16b"/>
           </svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
             <rect width="100" height="60" fill="#f0e6c8"/><path d="M0 35 Q 25 20 50 32 T 100 28 V60 H0Z" fill="#2f5f8a"/>
             <circle cx="20" cy="15" r="9" fill="#d9822b"/><rect x="70" y="8" width="6" height="22" fill="#3c3327"/>
           </svg>`;
}

async function raster(svg: string, breite: number, format: "png" | "jpeg" = "png"): Promise<Uint8Array> {
    const bild = sharp(Buffer.from(svg), { density: 300 }).resize({ width: breite });
    return new Uint8Array(format === "png" ? await bild.png().toBuffer() : await bild.jpeg({ quality: 60 }).toBuffer());
}

describe("Wahrnehmungs-Hash (WI-0068 D2)", () => {
    it("16 Hexziffern, und dieselben Bytes geben denselben Hash", async () => {
        const bytes = await raster(motiv("burg"), 800);
        const hash = await wahrnehmungsHash(bytes);
        expect(hash).toMatch(/^[0-9a-f]{16}$/u);
        expect(await wahrnehmungsHash(bytes)).toBe(hash);
    });

    it("🔴 dasselbe Motiv in 2000 und 128 Pixeln Breite, als PNG und als JPEG: nah beieinander", async () => {
        const gross = await wahrnehmungsHash(await raster(motiv("burg"), 2000));
        const klein = await wahrnehmungsHash(await raster(motiv("burg"), 128));
        const jpeg = await wahrnehmungsHash(await raster(motiv("burg"), 1200, "jpeg"));
        expect(wahrnehmungsAbstand(gross, klein)).toBeLessThanOrEqual(4);
        expect(wahrnehmungsAbstand(gross, jpeg)).toBeLessThanOrEqual(4);
    });

    it("🔴 ein anderes Motiv liegt weit weg", async () => {
        const burg = await wahrnehmungsHash(await raster(motiv("burg"), 800));
        const kueste = await wahrnehmungsHash(await raster(motiv("kueste"), 800));
        expect(wahrnehmungsAbstand(burg, kueste)).toBeGreaterThanOrEqual(16);
    });

    it("die Orientierung aus EXIF zählt: ein gedreht gespeichertes Foto ist dasselbe Bild", async () => {
        const aufrecht = await raster(motiv("burg"), 600, "jpeg");
        // Gespeichert um 90° gegen den Uhrzeigersinn gedreht, mit der Angabe „zum Zeigen um 90° im Uhrzeigersinn drehen“ (6).
        const gedreht = await sharp(Buffer.from(aufrecht))
            .rotate(-90)
            .withMetadata({ orientation: 6 })
            .jpeg()
            .toBuffer();
        expect(
            wahrnehmungsAbstand(await wahrnehmungsHash(aufrecht), await wahrnehmungsHash(new Uint8Array(gedreht))),
        ).toBeLessThanOrEqual(4);
    });

    it("Durchsichtiges zählt als mittleres Grau: ein Wappen frei gestellt und auf Grau liegt nah beieinander", async () => {
        const schild = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 110">
            <path d="M10 10h80v40c0 30-20 46-40 54C30 96 10 80 10 50z" fill="#8a2d22"/><path d="M50 14v78" stroke="#fffaea" stroke-width="9"/></svg>`;
        const frei = await sharp(Buffer.from(schild), { density: 300 }).resize({ width: 400 }).png().toBuffer();
        const aufGrau = await sharp(frei)
            .flatten({ background: { r: 128, g: 128, b: 128 } })
            .png()
            .toBuffer();
        expect(
            wahrnehmungsAbstand(
                await wahrnehmungsHash(new Uint8Array(frei)),
                await wahrnehmungsHash(new Uint8Array(aufGrau)),
            ),
        ).toBeLessThanOrEqual(2);
    });

    it("der Abstand zählt verschiedene Bits", () => {
        expect(wahrnehmungsAbstand("0000000000000000", "0000000000000000")).toBe(0);
        expect(wahrnehmungsAbstand("ffffffffffffffff", "0000000000000000")).toBe(64);
        expect(wahrnehmungsAbstand("8000000000000001", "0000000000000000")).toBe(2);
    });
});
