import { describe, expect, it, vi } from "vitest";
import {
    assertDimensionsWithinLimits,
    inspectImage,
    RasterRejection,
    sniffFormat,
    type RejectCode,
} from "../src/media/raster/inspect.ts";
import { RASTER_LIMITS } from "../src/media/raster/limits.ts";
import {
    animatedGif,
    animatedWebp,
    GRADIENT_SVG,
    halvesImage,
    jpeg,
    jpegClaimingSize,
    minimalGif,
    patternImage,
    png,
    pngClaimingSize,
    withApngMarker,
} from "./support/media-fixtures.ts";

// Das erste Bild einer Datei lädt die Bildbibliothek; unter Last (andere Sitzungen, Volllauf) reichen 5 Sekunden nicht.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Die Vorprüfung der Rasterpipeline (WI-0063 MEDIA-M7): Format aus den Bytes, Grenzen D2, Dekompressionsbomben, Mehrbilder,
 * SVG ohne Text, Skript und externe Verweise. Alles hier läuft, BEVOR ein Dekoder ein Byte sieht.
 */

const utf8 = (text: string): Buffer => Buffer.from(text, "utf8");

function rejection(bytes: Uint8Array): RasterRejection {
    try {
        inspectImage(bytes);
    } catch (error) {
        if (error instanceof RasterRejection) return error;
        throw error;
    }
    throw new Error("die Vorprüfung hat die Datei angenommen");
}

const codeOf = (bytes: Uint8Array): RejectCode => rejection(bytes).code;

describe("Vorprüfung: das Format kommt aus den Bytes", () => {
    it("erkennt PNG, JPEG, GIF, WebP und SVG an ihren Magic Bytes", async () => {
        const image = patternImage(40, 30);
        const pngBytes = await png(image);
        expect(sniffFormat(pngBytes)).toBe("png");
        expect(sniffFormat(await jpeg(image))).toBe("jpeg");
        expect(sniffFormat(minimalGif(1))).toBe("gif");
        expect(sniffFormat(await animatedWebp(2, image))).toBe("webp");
        expect(sniffFormat(utf8(GRADIENT_SVG))).toBe("svg");
    });

    it("liest Maße und Art aus dem Kopf, ohne zu dekodieren", async () => {
        const image = patternImage(40, 30);
        expect(inspectImage(await png(image))).toMatchObject({
            format: "png",
            mimeType: "image/png",
            width: 40,
            height: 30,
            findings: [],
        });
        expect(inspectImage(await jpeg(image))).toMatchObject({ format: "jpeg", width: 40, height: 30 });
        expect(inspectImage(minimalGif(1))).toMatchObject({ format: "gif", width: 1, height: 1 });
    });

    it("ein SVG hat keine festen Pixel und trägt den Befund svg_source", () => {
        expect(inspectImage(utf8(GRADIENT_SVG))).toMatchObject({
            format: "svg",
            mimeType: "image/svg+xml",
            width: null,
            height: null,
            findings: [{ code: "svg_source" }],
        });
    });

    it("das Format ist das der Bytes, nie das einer Endung: ein PNG bleibt ein PNG, was HTML ist, ist kein Bild", async () => {
        // Es gibt keinen Dateinamen in der Schnittstelle; die Bytes allein entscheiden.
        expect(inspectImage(await png(patternImage(8, 8))).format).toBe("png");
        expect(codeOf(utf8("<html><body>nicht ein Bild</body></html>"))).toBe("unsupported_format");
        expect(codeOf(utf8("<?php echo 1; ?>"))).toBe("unsupported_format");
        expect(codeOf(Buffer.from(Array.from({ length: 4096 }, (_unused, index) => (index * 31) & 255)))).toBe(
            "unsupported_format",
        );
        expect(codeOf(Buffer.from("RIFF....WAVEfmt "))).toBe("unsupported_format");
    });

    it("eine leere Datei ist ein beschädigtes Bild, kein nicht unterstütztes Format", () => {
        const error = rejection(new Uint8Array(0));
        expect(error.code).toBe("empty_file");
        expect(error.technicalState).toBe("decode_failed");
    });
});

describe("Vorprüfung: Grenzen (Betreiberentscheid D2)", () => {
    it("die Grenzen stehen so, wie der Betreiber sie entschieden hat", () => {
        expect(RASTER_LIMITS).toEqual({
            maxRasterBytes: 6 * 1024 * 1024,
            maxSvgBytes: 512 * 1024,
            maxPixels: 16_000_000,
            maxEdge: 8192,
        });
    });

    it("6 MiB Raster: darüber abgewiesen, genau an der Grenze angenommen", async () => {
        const base = await png(patternImage(8, 8));
        const atLimit = Buffer.concat([base, Buffer.alloc(RASTER_LIMITS.maxRasterBytes - base.length)]);
        expect(inspectImage(atLimit).format).toBe("png");
        const over = Buffer.concat([base, Buffer.alloc(RASTER_LIMITS.maxRasterBytes + 1 - base.length)]);
        expect(codeOf(over)).toBe("too_large_bytes");
    });

    it("512 KiB SVG: darüber abgewiesen, genau an der Grenze angenommen", () => {
        const pad = (size: number): Buffer => {
            const head = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><!--';
            const tail = "--></svg>";
            return utf8(head + "x".repeat(size - head.length - tail.length) + tail);
        };
        expect(inspectImage(pad(RASTER_LIMITS.maxSvgBytes)).format).toBe("svg");
        expect(codeOf(pad(RASTER_LIMITS.maxSvgBytes + 1))).toBe("too_large_bytes");
    });

    it("16 MP und 8192 px: die Grenze selbst gilt, eins darüber nicht", async () => {
        const small = await png(patternImage(8, 8));
        expect(inspectImage(pngClaimingSize(small, 4000, 4000)).width).toBe(4000);
        expect(codeOf(pngClaimingSize(small, 4001, 4000))).toBe("too_many_pixels");
        expect(inspectImage(pngClaimingSize(small, 8192, 1953)).width).toBe(8192);
        expect(codeOf(pngClaimingSize(small, 8193, 1))).toBe("too_large_dimensions");
        expect(codeOf(pngClaimingSize(small, 1, 8193))).toBe("too_large_dimensions");
    });

    it("🔴 eine Dekompressionsbombe wird am Kopf abgewiesen, nie dekodiert (PNG und JPEG, wenige Bytes)", async () => {
        const smallPng = await png(patternImage(8, 8));
        const bomb = pngClaimingSize(smallPng, 30_000, 30_000);
        expect(bomb.length).toBeLessThan(1000);
        expect(codeOf(bomb)).toBe("too_large_dimensions");
        expect(codeOf(pngClaimingSize(smallPng, 8000, 8000))).toBe("too_many_pixels");
        const smallJpeg = await jpeg(patternImage(16, 16));
        expect(codeOf(jpegClaimingSize(smallJpeg, 60_000, 60_000))).toBe("too_large_dimensions");
        expect(codeOf(jpegClaimingSize(smallJpeg, 6000, 6000))).toBe("too_many_pixels");
    });

    it("Maße null oder fehlend sind ein beschädigter Kopf", async () => {
        const small = await png(patternImage(8, 8));
        const error = rejection(pngClaimingSize(small, 0, 10));
        expect(error.code).toBe("bad_header");
        expect(error.technicalState).toBe("decode_failed");
        expect(() => assertDimensionsWithinLimits(Number.NaN, 5)).toThrow(RasterRejection);
    });

    it("die Abweisung nennt Maße und Grenze ohne Pfad und ohne Dateinamen", async () => {
        const small = await png(patternImage(8, 8));
        const message = rejection(pngClaimingSize(small, 5000, 5000)).message;
        expect(message).toContain("25,0 MP");
        expect(message).toContain("16 MP");
    });

    it("ein abgeschnittener oder verwürfelter Kopf ist ein beschädigter Kopf, kein Absturz", async () => {
        const pngBytes = await png(patternImage(8, 8));
        expect(codeOf(pngBytes.subarray(0, 20))).toBe("bad_header");
        const jpegBytes = await jpeg(patternImage(16, 16));
        expect(codeOf(jpegBytes.subarray(0, 6))).toBe("bad_header");
        // Die Länge des ersten Blocks verwürfelt: der nächste Marker liegt nicht dort, wo der Kopf ihn verspricht.
        const garbled = Buffer.from(jpegBytes);
        garbled[4] = 0x00;
        garbled[5] = 0x02;
        expect(codeOf(garbled)).toBe("bad_header");
    });
});

describe("Vorprüfung: mehrbildige Dateien werden gemeldet, nicht verarbeitet", () => {
    it("ein GIF mit mehreren Bildern (von Hand und von sharp erzeugt)", async () => {
        expect(codeOf(minimalGif(2))).toBe("animated_or_multiframe");
        expect(codeOf(await animatedGif(3, patternImage(16, 12)))).toBe("animated_or_multiframe");
        expect(inspectImage(minimalGif(1)).format).toBe("gif");
    });

    it("ein animiertes WebP", async () => {
        expect(codeOf(await animatedWebp(3, patternImage(16, 12)))).toBe("animated_or_multiframe");
    });

    it("ein animiertes PNG (APNG)", async () => {
        const apng = withApngMarker(await png(patternImage(16, 12)), 4);
        expect(codeOf(apng)).toBe("animated_or_multiframe");
    });

    it("mehrbildig ist ein nicht unterstütztes Format, kein beschädigtes Bild", () => {
        expect(rejection(minimalGif(2)).technicalState).toBe("unsupported_format");
    });
});

const svg = (inner: string, root = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'): Buffer =>
    utf8(`${root}${inner}</svg>`);

describe("Vorprüfung: SVG (D4 und Sicherheit)", () => {
    it("ein SVG ohne Text mit Verlauf, Clip und lokalen Verweisen besteht, auch mit Prolog, BOM und Kommentaren", () => {
        expect(inspectImage(utf8(GRADIENT_SVG)).format).toBe("svg");
        expect(inspectImage(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8(GRADIENT_SVG)])).format).toBe("svg");
        expect(inspectImage(svg('<rect width="4" height="4" fill="url(#g)"/><use href="#r"/>')).format).toBe("svg");
        expect(inspectImage(svg("<!-- <script>alert(1)</script> <text>x</text> -->")).format).toBe("svg");
    });

    it("🔴 D4: ein SVG mit <text> wird abgewiesen, in jeder Schreibweise", () => {
        for (const element of [
            "<text>Wappen</text>",
            '<text x="1" y="2">A</text>',
            "<tspan>A</tspan>",
            "<textPath>A</textPath>",
            '<svg:text xmlns:svg="http://www.w3.org/2000/svg">A</svg:text>',
            "<a:text>A</a:text>",
            "<text/>",
        ]) {
            const error = rejection(svg(element));
            expect(error.code, element).toBe("svg_has_text");
            expect(error.technicalState).toBe("unsupported_format");
        }
    });

    it("Text, der nur im Namen steckt, ist kein Text (textbox, context)", () => {
        expect(inspectImage(svg('<g id="textbox"><rect width="1" height="1"/></g>')).format).toBe("svg");
        expect(inspectImage(svg("<context/>")).format).toBe("svg");
    });

    it("Skript, Ereignisse und foreignObject werden abgewiesen", () => {
        for (const inner of [
            "<script>alert(1)</script>",
            '<script type="text/javascript" href="x.js"/>',
            '<rect onload="x()" width="1" height="1"/>',
            '<rect width="1" height="1" onclick = "x()"/>',
            '<a href="javascript:alert(1)"><rect width="1" height="1"/></a>',
            "<foreignObject><div>x</div></foreignObject>",
        ]) {
            expect(codeOf(svg(inner)), inner).toBe("svg_forbidden_content");
        }
    });

    it("externe Verweise werden abgewiesen: href, xlink:href, url(), @import, Stylesheet", () => {
        for (const inner of [
            '<image href="https://example.org/x.png" width="1" height="1"/>',
            '<image xlink:href="http://example.org/x.png" width="1" height="1"/>',
            '<image href="file:///etc/passwd" width="1" height="1"/>',
            '<image href="../secret.png" width="1" height="1"/>',
            '<image href=\'x.png\' width="1" height="1"/>',
            '<image href="data:image/png;base64,AAAA" width="1" height="1"/>',
            '<rect width="1" height="1" fill="url(http://example.org/g)"/>',
            "<style>rect { fill: url('https://example.org/g'); }</style>",
            '<style>@import url("https://example.org/a.css");</style>',
            '<style>@import "a.css";</style>',
        ]) {
            expect(codeOf(svg(inner)), inner).toBe("svg_forbidden_content");
        }
        const stylesheet = utf8(
            '<?xml version="1.0"?><?xml-stylesheet href="a.css" type="text/css"?><svg xmlns="http://www.w3.org/2000/svg"/>',
        );
        expect(codeOf(stylesheet)).toBe("svg_forbidden_content");
    });

    it("DTD und Entitäten (XXE, Billion Laughs) werden abgewiesen", () => {
        const xxe = utf8(
            '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
        );
        expect(codeOf(xxe)).toBe("svg_forbidden_content");
        const laughs = utf8(
            '<!DOCTYPE svg [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg"/>',
        );
        expect(codeOf(laughs)).toBe("svg_forbidden_content");
        const plainDoctype = utf8(
            '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"/>',
        );
        expect(codeOf(plainDoctype)).toBe("svg_forbidden_content");
    });

    it("ungültiges UTF-8 in einem SVG ist ein beschädigtes Bild", () => {
        const broken = Buffer.concat([
            utf8('<svg xmlns="http://www.w3.org/2000/svg"><!--'),
            Buffer.from([0xff, 0xfe, 0xfd]),
            utf8("--></svg>"),
        ]);
        const error = rejection(broken);
        expect(error.code).toBe("svg_invalid");
        expect(error.technicalState).toBe("decode_failed");
    });

    it("🔴 ein hinterhältiges SVG hält die Prüfung nicht auf: unbeendete Muster bis 512 KiB prüft sie in linearer Zeit", () => {
        const head = '<svg xmlns="http://www.w3.org/2000/svg">';
        for (const unit of ["url(", "<!--", 'href="', "href='", "<svg:", "<a ", "on", "url(url(  ", "@import "]) {
            const body = unit.repeat(Math.floor((RASTER_LIMITS.maxSvgBytes - 200) / unit.length));
            const started = performance.now();
            try {
                inspectImage(utf8(`${head}${body}</svg>`));
            } catch (error) {
                expect(error, unit).toBeInstanceOf(RasterRejection);
            }
            expect(performance.now() - started, unit).toBeLessThan(1000);
        }
    });

    it("ein Kommentar ohne Ende ist kein gültiges SVG; ein url( ohne ) gilt als Verweis", () => {
        expect(codeOf(utf8('<svg xmlns="http://www.w3.org/2000/svg"><!-- <text>A</text></svg>'))).toBe("svg_invalid");
        expect(codeOf(svg('<rect fill="url(#g" width="1" height="1"/>'))).toBe("svg_forbidden_content");
        expect(
            inspectImage(svg('<rect fill="url( #g )" width="1" height="1"/><rect fill="URL(\'#h\')"/>')).format,
        ).toBe("svg");
        expect(codeOf(svg('<rect fill="URL(http://example.org/x)" width="1" height="1"/>'))).toBe(
            "svg_forbidden_content",
        );
    });

    it("ein SVG, das erst nach Text im Dokument anfängt, ist keines", () => {
        expect(codeOf(utf8("Hallo <svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe("unsupported_format");
    });
});

describe("Vorprüfung: Abweisungen tragen den Zustand für das Asset", () => {
    it("Grenzen und Formate sind unsupported_format, beschädigte Köpfe decode_failed", async () => {
        const small = await png(patternImage(8, 8));
        expect(rejection(pngClaimingSize(small, 9000, 9)).technicalState).toBe("unsupported_format");
        expect(rejection(utf8("kein Bild")).technicalState).toBe("unsupported_format");
        expect(rejection(small.subarray(0, 20)).technicalState).toBe("decode_failed");
    });

    it("ein Bild, das die Prüfung besteht, ist unverändert dasselbe Bild (die Prüfung verändert nichts)", async () => {
        const bytes = await png(halvesImage(30, 20));
        const copy = Buffer.from(bytes);
        inspectImage(bytes);
        expect(bytes.equals(copy)).toBe(true);
    });
});
