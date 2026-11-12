import { createHash } from "node:crypto";
import type { MediaRole } from "@avesmaps3d/shared";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { inspectImage, RasterRejection, type RasterInspection } from "../src/media/raster/inspect.ts";
import { RASTER_ENGINE } from "../src/media/raster/limits.ts";
import { RASTER_PROFILES, profileForRole } from "../src/media/raster/profiles.ts";
import {
    cropTarget,
    engineVersions,
    recipeVersion,
    renderRaster,
    type RenderedRaster,
} from "../src/media/raster/render.ts";
import { PUBLISHED_VARIANT } from "../src/media/roles.ts";
import {
    animatedWebp,
    decodeRaw,
    GRADIENT_SVG,
    halvesImage,
    jpeg,
    jpegWithExif,
    minimalGif,
    p3Png,
    patternImage,
    png,
    solidPng,
    webpChunks,
} from "./support/media-fixtures.ts";

// Das erste Bild einer Datei lädt die Bildbibliothek; unter Last (andere Sitzungen, Volllauf) reichen 5 Sekunden nicht.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Die Rasterpipeline in Profilen (WI-0063 MEDIA-M7, Betreiberentscheide D1 bis D4): Maße und Qualität je Profil,
 * Orientierung, Metadaten, Farbraum, Alpha und Determinismus (Prüfvektoren).
 */

const hex12 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 12);

/** Ein JPEG ohne seine APP1-Segmente (EXIF, XMP): Kopf, übrige Segmente und Bilddaten, wie sie sind. */
function ohneApp1(jpegBytes: Buffer): Buffer {
    const teile: Buffer[] = [jpegBytes.subarray(0, 2)];
    let i = 2;
    while (i + 4 <= jpegBytes.length && jpegBytes[i] === 0xff) {
        const marker = jpegBytes[i + 1]!;
        if (marker === 0xda) break; // Start of Scan: ab hier Bilddaten.
        const laenge = jpegBytes.readUInt16BE(i + 2);
        if (marker !== 0xe1) teile.push(jpegBytes.subarray(i, i + 2 + laenge));
        i += 2 + laenge;
    }
    teile.push(jpegBytes.subarray(i));
    return Buffer.concat(teile);
}

async function render(bytes: Buffer, role: MediaRole): Promise<RenderedRaster> {
    return renderRaster(bytes, inspectImage(bytes), profileForRole(role));
}

/**
 * Die Prüfvektoren: SHA-256-Präfix der Quellbilder (selbst erzeugt, ganzzahlig) und der Ergebnisse je Profil, gerechnet mit
 * sharp 0.35.5 / libvips 8.18.7 / libwebp 1.6.0. Ein anderer Wert heißt: die Bytes haben sich geändert (neue Bibliothek,
 * geänderte Operationsfolge). Dann Rezeptrevision in `profiles.ts` anheben und die Vektoren bewusst neu eintragen.
 *
 * Alle Werte gelten unter Windows UND Linux (gleich gerechnet 2026-10-17: Windows x64 und Ubuntu glibc 2.39 wie der VPS).
 * 🪤 Ausnahme war das Quellbild mit EXIF: Die Reihenfolge der EXIF-Felder, die libvips beim Schreiben wählt, hängt an der Plattform
 * (Make/Model und die GPS-Felder stehen vertauscht, gleiche Länge, 27 Bytes verschieden; Claudios Prüflauf nach dem Push). Sein
 * Vektor gilt deshalb den Bilddaten ohne APP1 (`sourceExifImage`); dass das EXIF da ist, prüft die Orientierung. Die Ausgabe
 * `exifCoat` streift die Metadaten ab und ist auf beiden Plattformen gleich.
 */
const VECTORS = {
    sourceRgba: "9480528fb181",
    sourceRgb: "f46adee84cc7",
    sourcePhoto: "0a2cf2af5575",
    sourceExifImage: "7a62ac46d1ac",
    coat: "f0f4fa578287",
    header: "b3aa36ad6433",
    mapFull: "cd06afc4e457",
    mapPreview: "e01570c19a90",
    cover: "c40682a0012e",
    exifCoat: "a47184a38474",
} as const;

describe("Profile: zentral registriert, Namen aus roles.ts", () => {
    it("jede Rolle hat genau ein Profil, und die Variante kommt aus roles.ts", () => {
        expect(RASTER_PROFILES.map((profile) => profile.role).sort()).toEqual(
            ["coat", "header", "literature_cover", "map_full", "map_preview", "photobox", "social_post"].sort(),
        );
        for (const profile of RASTER_PROFILES) {
            expect(profile.variant).toBe(PUBLISHED_VARIANT[profile.role]);
            expect(profileForRole(profile.role)).toBe(profile);
            expect(profile.variant).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
        }
        expect(RASTER_PROFILES.map((profile) => profile.variant)).toEqual([
            "coat",
            "header_16_9",
            "citymap_full",
            "citymap_preview",
            "literature_cover",
            "photobox_2048",
            "social_post_2048",
        ]);
    });

    it("🔴 D3: Wappen verlustfrei, Ortsbilder q80; Galerieeinträge erben die Rolle header", () => {
        expect(profileForRole("coat").encoding).toEqual({ mode: "lossless" });
        expect(profileForRole("header").encoding).toEqual({ mode: "lossy", quality: 80 });
        expect(profileForRole("header").geometry).toEqual({ kind: "crop", ratio: [16, 9], maxWidth: 800 });
    });

    it("recipe_version nennt Rezeptrevision und Bibliotheksversionen (die Bytes hängen an beidem)", () => {
        const versions = engineVersions();
        expect(recipeVersion(profileForRole("coat"))).toBe(
            `1 / sharp ${versions.sharp} / libvips ${versions.libvips} / libwebp ${versions.libwebp}`,
        );
        expect(versions.sharp).toMatch(/^\d+\.\d+\.\d+$/);
    });
});

describe("Einstellungen der Bibliothek (Claudios Bedingung)", () => {
    it("🔴 ein libvips-Arbeitsthread und kein Operationscache, sobald die Pipeline benutzt wird", async () => {
        await render(await png(patternImage(40, 30)), "coat");
        expect(sharp.concurrency()).toBe(1);
        expect(sharp.cache().memory.max).toBe(0);
        expect(RASTER_ENGINE).toMatchObject({ concurrency: 1 });
        expect(RASTER_ENGINE.timeoutSeconds).toBeGreaterThan(0);
    });
});

describe("Zuschnitt 16:9", () => {
    it("so groß wie möglich, höchstens 800 breit, nie größer als die Quelle", () => {
        const ratio = [16, 9] as const;
        expect(cropTarget({ width: 1600, height: 1200 }, ratio, 800)).toEqual({ width: 800, height: 450 });
        expect(cropTarget({ width: 800, height: 450 }, ratio, 800)).toEqual({ width: 800, height: 450 });
        expect(cropTarget({ width: 400, height: 300 }, ratio, 800)).toEqual({ width: 400, height: 225 });
        expect(cropTarget({ width: 300, height: 100 }, ratio, 800)).toEqual({ width: 178, height: 100 });
        expect(cropTarget({ width: 600, height: 1000 }, ratio, 800)).toEqual({ width: 600, height: 338 });
        expect(cropTarget({ width: 1, height: 1 }, ratio, 800)).toEqual({ width: 1, height: 1 });
    });
});

describe("Profile: Maße", () => {
    it("coat: lange Kante 512, kein Zuschnitt, nie vergrößert", async () => {
        const big = await render(await png(patternImage(1024, 1280, 4)), "coat");
        expect([big.width, big.height]).toEqual([410, 512]);
        const small = await render(await png(patternImage(100, 80, 4)), "coat");
        expect([small.width, small.height]).toEqual([100, 80]);
        const wide = await render(await png(patternImage(1500, 600, 4)), "coat");
        expect([wide.width, wide.height]).toEqual([512, 205]);
    });

    it("header: 16:9, höchstens 800 × 450, zentriert zugeschnitten; kleine Bilder werden nicht vergrößert", async () => {
        for (const [width, height, expected] of [
            [1600, 1200, [800, 450]],
            [1600, 900, [800, 450]],
            [800, 450, [800, 450]],
            [400, 300, [400, 225]],
            [600, 1000, [600, 338]],
            [1200, 400, [711, 400]],
        ] as const) {
            const out = await render(await png(patternImage(width, height)), "header");
            expect([out.width, out.height], `${String(width)}x${String(height)}`).toEqual(expected);
        }
    });

    it("header: der Zuschnitt ist zentriert", async () => {
        // Oben rot, in der Mitte grün, unten blau: nach dem Zuschnitt 4:3 → 16:9 bleibt die Mitte, die Ränder fallen weg.
        const width = 160;
        const height = 120;
        const data = Buffer.alloc(width * height * 3);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const i = (y * width + x) * 3;
                const band = y < 15 ? [255, 0, 0] : y >= 105 ? [0, 0, 255] : [0, 255, 0];
                data[i] = band[0] ?? 0;
                data[i + 1] = band[1] ?? 0;
                data[i + 2] = band[2] ?? 0;
            }
        }
        const source = await png({ data, width, height, channels: 3 });
        const out = await render(source, "header");
        expect([out.width, out.height]).toEqual([160, 90]);
        const pixels = await decodeRaw(out.bytes);
        for (const y of [0, 45, 89]) {
            const i = (y * pixels.width + 80) * 4;
            // verlustbehaftet (q80): die Mitte ist grün, nie rot oder blau
            expect(pixels.data[i + 1], `Zeile ${String(y)}`).toBeGreaterThan(200);
            expect(pixels.data[i] ?? 0).toBeLessThan(60);
            expect(pixels.data[i + 2] ?? 0).toBeLessThan(60);
        }
    });

    it("citymap_full: Pixel erhalten, nichts skaliert, nichts zugeschnitten", async () => {
        const image = patternImage(1200, 900);
        const out = await render(await png(image), "map_full");
        expect([out.width, out.height]).toEqual([1200, 900]);
    });

    it("citymap_preview: lange Kante 400; literature_cover: lange Kante 600 im Hochformat", async () => {
        const preview = await render(await png(patternImage(3000, 2000, 3, false)), "map_preview");
        expect([preview.width, preview.height]).toEqual([400, 267]);
        const cover = await render(await jpeg(patternImage(1200, 1800)), "literature_cover");
        expect([cover.width, cover.height]).toEqual([400, 600]);
        const tiny = await render(await png(patternImage(120, 90)), "literature_cover");
        expect([tiny.width, tiny.height]).toEqual([120, 90]);
    });

    it("🔴 photobox: lange Kante 2048, verlustbehaftet, ohne EXIF und GPS (WI-0272)", async () => {
        expect(profileForRole("photobox").geometry).toEqual({ kind: "fit_inside", longEdge: 2048 });
        expect(profileForRole("photobox").encoding).toEqual({ mode: "lossy", quality: 80 });
        const source = await jpegWithExif(patternImage(4000, 3000, 3, false), 1);
        // Positivkontrolle: Die Eingabe trägt Kamera und Position.
        expect(source.includes("FixtureCam")).toBe(true);
        expect((await sharp(source).metadata()).exif).toBeDefined();
        const out = await render(source, "photobox");
        expect([out.width, out.height]).toEqual([2048, 1536]);
        expect(webpChunks(out.bytes)).toContain("VP8 ");
        expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
        expect(out.bytes.includes("FixtureCam")).toBe(false);
        const small = await render(await png(patternImage(640, 480)), "photobox");
        expect([small.width, small.height]).toEqual([640, 480]);
    });

    it("jede Ausgabe ist WebP", async () => {
        for (const profile of RASTER_PROFILES) {
            const out = await render(await png(patternImage(300, 200)), profile.role);
            expect(out.mimeType).toBe("image/webp");
            expect(out.bytes.toString("ascii", 0, 4)).toBe("RIFF");
            expect(out.bytes.toString("ascii", 8, 12)).toBe("WEBP");
        }
    });
});

describe("Profile: Qualität (D3)", () => {
    it("🔴 coat ist verlustfrei: unverkleinert kommen alle Pixel, auch die halbdurchsichtigen, bitgleich zurück", async () => {
        const image = patternImage(200, 160, 4);
        const out = await render(await png(image), "coat");
        const pixels = await decodeRaw(out.bytes);
        expect([pixels.width, pixels.height]).toEqual([200, 160]);
        expect(pixels.data.equals(image.data)).toBe(true);
        expect(webpChunks(out.bytes)).toContain("VP8L");
    });

    it("map_full ist verlustfrei", async () => {
        const image = patternImage(300, 220);
        const out = await render(await png(image), "map_full");
        const pixels = await decodeRaw(out.bytes);
        // Ohne Alpha: die Quelle hat drei Kanäle, das Raster vier (Alpha 255).
        for (let i = 0; i < image.width * image.height; i += 1) {
            expect(pixels.data[i * 4]).toBe(image.data[i * 3]);
            expect(pixels.data[i * 4 + 1]).toBe(image.data[i * 3 + 1]);
            expect(pixels.data[i * 4 + 2]).toBe(image.data[i * 3 + 2]);
        }
    });

    it("header ist verlustbehaftet (q80): ein VP8-Block, und die Pixel weichen von der Quelle ab", async () => {
        const image = patternImage(800, 450);
        const lossy = await render(await png(image), "header");
        expect([lossy.width, lossy.height]).toEqual([800, 450]);
        expect(webpChunks(lossy.bytes)).toContain("VP8 ");
        expect(webpChunks(lossy.bytes)).not.toContain("VP8L");
        const pixels = await decodeRaw(lossy.bytes);
        let different = 0;
        for (let i = 0; i < image.width * image.height; i += 1) {
            if (pixels.data[i * 4] !== image.data[i * 3]) different += 1;
        }
        expect(different).toBeGreaterThan(0);
    });
});

describe("Pipeline: Orientierung, Metadaten, Farbraum, Alpha", () => {
    it("die EXIF-Orientierung wird angewendet: ein Hochformat mit Orientierung 6 kommt gedreht heraus", async () => {
        // 60 × 40, links rot, rechts blau, Orientierung 6 (90° im Uhrzeigersinn): angezeigt 40 × 60, oben rot, unten blau.
        const source = await jpegWithExif(halvesImage(60, 40), 6);
        const out = await render(source, "coat");
        expect([out.width, out.height]).toEqual([40, 60]);
        const pixels = await decodeRaw(out.bytes);
        const at = (x: number, y: number): number[] => {
            const i = (y * pixels.width + x) * 4;
            return [pixels.data[i] ?? 0, pixels.data[i + 1] ?? 0, pixels.data[i + 2] ?? 0];
        };
        expect(at(20, 5)[0]).toBeGreaterThan(180);
        expect(at(20, 5)[2]).toBeLessThan(80);
        expect(at(20, 55)[2]).toBeGreaterThan(180);
        expect(at(20, 55)[0]).toBeLessThan(80);
    });

    it("🔴 EXIF, GPS, ICC und XMP kommen nicht in die öffentliche Datei (mit Positivkontrolle)", async () => {
        const source = await jpegWithExif(patternImage(120, 90), 1);
        // Positivkontrolle: Die Eingabe trägt Kamera und Position; mit `keepMetadata` überlebten sie ein WebP.
        expect(source.includes("FixtureCam")).toBe(true);
        const kept = await sharp(source).keepMetadata().webp().toBuffer();
        expect(webpChunks(kept)).toContain("EXIF");
        expect(kept.includes("FixtureCam")).toBe(true);

        for (const role of ["coat", "header", "map_preview", "literature_cover", "map_full", "photobox"] as const) {
            const out = await render(source, role);
            const chunks = webpChunks(out.bytes);
            expect(chunks, role).not.toContain("EXIF");
            expect(chunks, role).not.toContain("ICCP");
            expect(chunks, role).not.toContain("XMP ");
            for (const chunk of chunks) expect(["VP8 ", "VP8L", "VP8X", "ALPH"], role).toContain(chunk);
            expect(out.bytes.includes("FixtureCam"), role).toBe(false);
            expect(out.bytes.includes("FX-1"), role).toBe(false);
            expect(out.bytes.includes("Exif"), role).toBe(false);
        }
    });

    it("🔴 der Farbraum ist sRGB: ein Display-P3-Bild kommt farbrichtig heraus, das Profil nicht", async () => {
        const color = { r: 200, g: 50, b: 30 };
        const source = await p3Png(color);
        expect((await sharp(source).metadata()).icc).toBeDefined();
        const out = await render(source, "coat");
        const pixels = await decodeRaw(out.bytes);
        // Die Pixel der Quelle waren P3-Koordinaten; die Pipeline wandelt sie zurück in den ursprünglichen sRGB-Wert.
        expect(Math.abs((pixels.data[0] ?? 0) - color.r)).toBeLessThanOrEqual(3);
        expect(Math.abs((pixels.data[1] ?? 0) - color.g)).toBeLessThanOrEqual(3);
        expect(Math.abs((pixels.data[2] ?? 0) - color.b)).toBeLessThanOrEqual(3);
        expect(webpChunks(out.bytes)).not.toContain("ICCP");
    });

    it("Alpha bleibt erhalten, im verlustfreien wie im verlustbehafteten Profil", async () => {
        const image = patternImage(300, 200, 4);
        for (const role of ["coat", "header", "map_preview"] as const) {
            const out = await render(await png(image), role);
            const pixels = await decodeRaw(out.bytes);
            const alphas = new Set<number>();
            for (let i = 3; i < pixels.data.length; i += 4) alphas.add(pixels.data[i] ?? 0);
            expect(alphas.size, role).toBeGreaterThan(1);
            expect(Math.min(...alphas), role).toBeLessThan(255);
        }
    });

    it("ein CMYK-JPEG wird nach sRGB gewandelt (kein Absturz, richtige Farbe)", async () => {
        const cmyk = await sharp({
            create: { width: 48, height: 32, channels: 3, background: { r: 200, g: 50, b: 30 } },
        })
            .toColourspace("cmyk")
            .jpeg({ quality: 95 })
            .toBuffer();
        expect((await sharp(cmyk).metadata()).space).toBe("cmyk");
        const out = await render(cmyk, "coat");
        expect([out.width, out.height]).toEqual([48, 32]);
        const pixels = await decodeRaw(out.bytes);
        // Rot bleibt rot: die Rundreise über CMYK ist ungenau, aber nie ein anderer Farbton.
        expect(pixels.data[0] ?? 0).toBeGreaterThan(150);
        expect(pixels.data[2] ?? 255).toBeLessThan(110);
    });

    it("ein Graustufenbild und ein Bild mit 16 Bit werden zu sRGB-WebP", async () => {
        const grey = await render(await solidPng(64, 48, 1), "coat");
        expect([grey.width, grey.height]).toEqual([64, 48]);
        const sixteen = await sharp({
            create: { width: 32, height: 32, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
        })
            .toColourspace("rgb16")
            .png()
            .toBuffer();
        const out = await render(sixteen, "coat");
        expect([out.width, out.height]).toEqual([32, 32]);
    });
});

describe("SVG: privates Quellartefakt, gerastert zum Profil", () => {
    it("wird auf die lange Kante des Profils gerastert (ein Vektor darf wachsen), mit durchsichtigem Hintergrund", async () => {
        const bytes = Buffer.from(GRADIENT_SVG, "utf8");
        const coat = await render(bytes, "coat");
        expect([coat.width, coat.height]).toEqual([341, 512]);
        const pixels = await decodeRaw(coat.bytes);
        // Außerhalb des Kreises ist das Bild durchsichtig, im Kreis undurchsichtig.
        expect(pixels.data[3]).toBe(0);
        const center = (Math.floor(pixels.height / 2) * pixels.width + Math.floor(pixels.width / 2)) * 4;
        expect(pixels.data[center + 3]).toBe(255);
        const preview = await render(bytes, "map_preview");
        expect(Math.max(preview.width, preview.height)).toBe(400);
    });

    it("citymap_full rastert ein SVG auf 3840 px und bleibt unter der Pixelgrenze", async () => {
        const full = await render(Buffer.from(GRADIENT_SVG, "utf8"), "map_full");
        expect(Math.max(full.width, full.height)).toBe(3840);
        expect(full.width * full.height).toBeLessThanOrEqual(16_000_000);
    }, 30_000);

    it("das Ergebnis eines SVG ist ein WebP, nie ein SVG", async () => {
        const out = await render(Buffer.from(GRADIENT_SVG, "utf8"), "coat");
        expect(out.bytes.toString("ascii", 8, 12)).toBe("WEBP");
        expect(out.bytes.includes("<svg")).toBe(false);
    });
});

describe("zweite Linie: die Bibliothek prüft noch einmal", () => {
    const passInspection = (bytes: Buffer): RasterInspection => ({
        format: "png",
        mimeType: "image/png",
        byteSize: bytes.length,
        width: 10,
        height: 10,
        alpha: true,
        findings: [],
    });

    it("🔴 ein echtes Bild über 16 MP wird auch von der Bibliothek abgewiesen, wenn die Vorprüfung es durchließe", async () => {
        const big = await solidPng(5000, 4000, 1);
        await expect(renderRaster(big, passInspection(big), profileForRole("coat"))).rejects.toMatchObject({
            code: "too_many_pixels",
        });
    }, 30_000);

    it("ein abgeschnittenes Bild ist decode_failed, kein halbes Bild", async () => {
        const full = await png(patternImage(200, 150));
        const truncated = full.subarray(0, Math.floor(full.length / 2));
        await expect(renderRaster(truncated, passInspection(truncated), profileForRole("coat"))).rejects.toMatchObject({
            code: "decode_failed",
            technicalState: "decode_failed",
        });
        const jpegBytes = await jpeg(patternImage(200, 150));
        const cut = jpegBytes.subarray(0, Math.floor(jpegBytes.length / 2));
        await expect(renderRaster(cut, passInspection(cut), profileForRole("coat"))).rejects.toBeInstanceOf(
            RasterRejection,
        );
    });

    it("mehrbildige Dateien werden auch von der Bibliothek erkannt", async () => {
        const gif = minimalGif(2);
        await expect(renderRaster(gif, passInspection(gif), profileForRole("coat"))).rejects.toMatchObject({
            code: "animated_or_multiframe",
        });
        const webp = await animatedWebp(3, patternImage(16, 12));
        await expect(renderRaster(webp, passInspection(webp), profileForRole("coat"))).rejects.toMatchObject({
            code: "animated_or_multiframe",
        });
    });

    it("ein Standbild-GIF wird verarbeitet", async () => {
        const out = await render(minimalGif(1), "coat");
        expect([out.width, out.height]).toEqual([1, 1]);
    });
});

describe("Determinismus: dieselben Bytes rein, dieselben Bytes raus (Prüfvektoren)", () => {
    it("die Bibliothek ist die entschiedene (D1: sharp 0.35.5 mit libvips 8.18.7 und libwebp 1.6.0)", () => {
        // Ein Versionssprung kann die Bytes ändern: dann sind die Vektoren unten NEU zu bewerten und `revision` anzuheben.
        expect(engineVersions()).toEqual({ sharp: "0.35.5", libvips: "8.18.7", libwebp: "1.6.0" });
    });

    it("zwei Läufe liefern dieselben Bytes, in jedem Profil", async () => {
        const source = await png(patternImage(640, 480, 4));
        for (const profile of RASTER_PROFILES) {
            const first = await render(source, profile.role);
            const second = await render(source, profile.role);
            expect(first.bytes.equals(second.bytes), profile.role).toBe(true);
        }
    });

    it("zehn Läufe gleichzeitig liefern dieselben Bytes (Parallelität ändert nichts)", async () => {
        const source = await png(patternImage(320, 240, 4));
        const outputs = await Promise.all(Array.from({ length: 10 }, () => render(source, "header")));
        for (const out of outputs) expect(out.bytes.equals(outputs[0]?.bytes ?? Buffer.alloc(0))).toBe(true);
    });

    it("🔴 Gegenvektor von Claudio (VPS linux-x64 glibc 2.39 = Windows): PNG, WebP q80 mit Resize 32, WebP verlustfrei", async () => {
        const source = await sharp({
            create: { width: 64, height: 64, channels: 4, background: { r: 200, g: 50, b: 30, alpha: 0.5 } },
        })
            .png()
            .toBuffer();
        expect(hex12(source)).toBe("1d5ee21457b5");
        expect(hex12(await sharp(source).resize(32).webp({ quality: 80 }).toBuffer())).toBe("2e218700b202");
        expect(hex12(await sharp(source).webp({ lossless: true }).toBuffer())).toBe("3158b5fdc815");
    });

    it("🔴 Prüfvektoren der Profile an selbst erzeugten Bildern (SHA-256, Präfix)", async () => {
        const rgba = await png(patternImage(1024, 1280, 4));
        const rgb = await png(patternImage(1672, 941));
        const photo = await jpeg(patternImage(1200, 1800), 90);
        const exif = await jpegWithExif(halvesImage(160, 90), 6);
        expect(hex12(rgba)).toBe(VECTORS.sourceRgba);
        expect(hex12(rgb)).toBe(VECTORS.sourceRgb);
        expect(hex12(photo)).toBe(VECTORS.sourcePhoto);
        expect(hex12(ohneApp1(exif))).toBe(VECTORS.sourceExifImage);
        expect(ohneApp1(exif).length).toBeLessThan(exif.length);
        expect((await sharp(exif).metadata()).orientation).toBe(6);
        expect(hex12((await render(rgba, "coat")).bytes)).toBe(VECTORS.coat);
        expect(hex12((await render(rgb, "header")).bytes)).toBe(VECTORS.header);
        expect(hex12((await render(rgb, "map_full")).bytes)).toBe(VECTORS.mapFull);
        expect(hex12((await render(rgb, "map_preview")).bytes)).toBe(VECTORS.mapPreview);
        expect(hex12((await render(photo, "literature_cover")).bytes)).toBe(VECTORS.cover);
        expect(hex12((await render(exif, "coat")).bytes)).toBe(VECTORS.exifCoat);
    });
});
