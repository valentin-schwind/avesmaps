import { PDF_LIMITS, RASTER_LIMITS } from "./limits.ts";
import { isPdf } from "./pdf-magic.ts";

/**
 * Die Vorprüfung der Rasterpipeline: alles, was geschieht, BEVOR irgendein Dekoder ein Byte sieht (WI-0063 26.19,
 * MEDIA-M7). Reiner TypeScript-Code ohne native Bibliothek.
 *
 * - Das Format kommt aus den Bytes (Magic Bytes), nie aus Dateiname, Endung oder behauptetem MIME-Typ.
 * - Byte- und Pixelgrenze (D2) stehen VOR dem Dekodieren: Maße kommen aus dem Dateikopf, eine Dekompressionsbombe von
 *   wenigen KB wird nie entpackt.
 * - Mehrbildige Dateien (GIF, animiertes WebP, APNG) werden gemeldet, nicht verarbeitet (`animated_or_multiframe`).
 * - SVG: nie Text (D4, Betreiber 2026-10-04: die Pipeline rendert keinen Text), nie Skript, nie ein externer Verweis, nie
 *   eine DTD oder Entität. Ein SVG bleibt privates Quellartefakt und wird gerastert.
 *
 * Die Bibliothek prüft danach ein zweites Mal (`failOn: "warning"`, `limitInputPixels`); diese Datei ist die erste Linie.
 */

export type RasterFormat = "png" | "jpeg" | "gif" | "webp" | "svg" | "pdf";

export const FORMAT_MIME: Readonly<Record<RasterFormat, string>> = {
    png: "image/png",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
};

/** Die Dateiendung des privaten Originals je Format (aus dem erkannten Format, nie aus einem Dateinamen). */
export const FORMAT_EXTENSION: Readonly<Record<RasterFormat, string>> = {
    png: "png",
    jpeg: "jpg",
    gif: "gif",
    webp: "webp",
    svg: "svg",
    pdf: "pdf",
};

export const REJECT_CODES = [
    "empty_file",
    "unsupported_format",
    "too_large_bytes",
    "too_many_pixels",
    "too_large_dimensions",
    "animated_or_multiframe",
    "bad_header",
    "svg_invalid",
    "svg_has_text",
    "svg_forbidden_content",
    "decode_failed",
] as const;
export type RejectCode = (typeof REJECT_CODES)[number];

/** Was der Medienimport am Asset vermerkt (`media_asset.technical_state`). */
export type RejectedTechnicalState = "unsupported_format" | "decode_failed";

/** Ein Befund ohne Abbruch (Vertrag `befundcodes`), etwa `svg_source`. */
export interface MediaFinding {
    code: string;
    detail?: string;
}

/**
 * Die Pipeline weist eine Datei ab. Der Code ist maschinenlesbar (Befund, Job-Fehler), die Meldung deutsch und ohne Pfad.
 * Abgewiesen wird nur nach den Grenzen des Betreibers (D2, D4) und aus technischen Gründen (kein Bild, kaputt, Format).
 */
export class RasterRejection extends Error {
    readonly code: RejectCode;
    readonly technicalState: RejectedTechnicalState;

    constructor(code: RejectCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "RasterRejection";
        this.code = code;
        this.technicalState =
            code === "empty_file" || code === "bad_header" || code === "svg_invalid" || code === "decode_failed"
                ? "decode_failed"
                : "unsupported_format";
    }
}

export interface RasterInspection {
    format: RasterFormat;
    mimeType: string;
    byteSize: number;
    /** Aus dem Dateikopf. `null` bei SVG: ein Vektorbild hat keine festen Pixel. */
    width: number | null;
    height: number | null;
    /**
     * Kann das Bild durchsichtige Pixel haben? Aus dem Dateikopf, ohne zu dekodieren (WI-0068 P4b, Wappen brauchen einen
     * transparenten Hintergrund): PNG mit Alphakanal oder tRNS, WebP mit Alpha-Flag, GIF mit Transparenzfarbe; JPEG nie. `null` bei
     * SVG (ein Vektor hat keinen Kopf dafür). Ob die Ecken WIRKLICH durchsichtig sind, sieht erst der Worker beim Dekodieren.
     */
    alpha: boolean | null;
    findings: MediaFinding[];
}

// --- Format aus den Bytes -------------------------------------------------------------------------------------------

const ascii = (bytes: Uint8Array, offset: number, length: number): string => {
    let text = "";
    for (let index = offset; index < Math.min(offset + length, bytes.length); index += 1) {
        text += String.fromCharCode(bytes[index] ?? 0);
    }
    return text;
};

const u16be = (b: Uint8Array, o: number): number => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const u32be = (b: Uint8Array, o: number): number =>
    (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;
const u16le = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u32le = (b: Uint8Array, o: number): number =>
    ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;
const u24le = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Wie weit vorn in der Datei ein SVG sein Wurzelelement haben muss, damit es als SVG erkannt wird. */
const SVG_SNIFF_BYTES = 8192;

/** Was vor dem Wurzelelement stehen darf: Leerraum, `<?xml …?>`, Kommentare und (dann abgewiesen) ein Doctype. */
function looksLikeSvg(bytes: Uint8Array): boolean {
    const head = new TextDecoder("utf-8").decode(bytes.subarray(0, SVG_SNIFF_BYTES));
    const root = /<svg[\s/>]/.exec(head);
    if (root === null) return false;
    const prefix = head
        .slice(0, root.index)
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<\?xml[\s\S]*?\?>/g, "")
        .trim();
    return prefix === "" || /^<!DOCTYPE/i.test(prefix);
}

/** Das echte Format aus den Bytes, oder `null`. */
export function sniffFormat(bytes: Uint8Array): Exclude<RasterFormat, "pdf"> | null {
    if (bytes.length >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return "png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
    if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "gif";
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
    return looksLikeSvg(bytes) ? "svg" : null;
}

// --- Kopf ohne Pixeldekodierung --------------------------------------------------------------------------------------

interface RasterHeader {
    width: number;
    height: number;
    frames: number;
    alpha: boolean;
}

const bad = (what: string): RasterRejection => new RasterRejection("bad_header", `Dateikopf beschädigt: ${what}`);

function pngHeader(b: Uint8Array): RasterHeader {
    if (b.length < 33 || ascii(b, 12, 4) !== "IHDR") throw bad("PNG ohne IHDR");
    let frames = 1;
    // Farbtyp 4 (Grau mit Alpha) und 6 (RGBA) tragen Alpha; jeder andere nur über einen Block tRNS vor dem ersten IDAT.
    const colourType = b[25] ?? 0;
    let alpha = colourType === 4 || colourType === 6;
    // Animiertes PNG (APNG): der Block acTL steht vor dem ersten IDAT.
    let offset = 8;
    while (offset + 8 <= b.length) {
        const length = u32be(b, offset);
        const type = ascii(b, offset + 4, 4);
        if (type === "acTL") frames = Math.max(1, u32be(b, offset + 8));
        if (type === "tRNS") alpha = true;
        if (type === "IDAT") break;
        offset += 12 + length;
    }
    return { width: u32be(b, 16), height: u32be(b, 20), frames, alpha };
}

function jpegHeader(b: Uint8Array): RasterHeader {
    let offset = 2;
    while (offset + 4 <= b.length) {
        if (b[offset] !== 0xff) throw bad("JPEG-Markerfolge");
        const marker = b[offset + 1] ?? 0;
        // Füllbytes und Marker ohne Länge.
        if (marker === 0xff) {
            offset += 1;
            continue;
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
        }
        // Der Rahmenkopf (SOF): Höhe, Breite. Ausgenommen sind DHT (c4), JPG (c8) und DAC (cc).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: u16be(b, offset + 5), width: u16be(b, offset + 7), frames: 1, alpha: false };
        }
        // Vor dem Rahmenkopf beginnt schon die Bilddatenfolge oder endet die Datei: kein gültiger Kopf.
        if (marker === 0xda || marker === 0xd9) break;
        offset += 2 + u16be(b, offset + 2);
    }
    throw bad("JPEG ohne Rahmenkopf");
}

function gifHeader(b: Uint8Array): RasterHeader {
    if (b.length < 13) throw bad("GIF zu kurz");
    let offset = 13;
    // Farbtabelle des Bildschirms.
    if (((b[10] ?? 0) & 0x80) !== 0) offset += 3 * (1 << (((b[10] ?? 0) & 7) + 1));
    let frames = 0;
    let alpha = false;
    while (offset < b.length) {
        const block = b[offset];
        if (block === 0x3b) break;
        if (block === 0x21) {
            // Graphic Control Extension: Bit 0 des gepackten Felds ist die Transparenzfarbe.
            if (b[offset + 1] === 0xf9 && ((b[offset + 3] ?? 0) & 0x01) !== 0) alpha = true;
            offset += 2;
            while (offset < b.length && b[offset] !== 0) offset += (b[offset] ?? 0) + 1;
            offset += 1;
        } else if (block === 0x2c) {
            frames += 1;
            const packed = b[offset + 9] ?? 0;
            offset += 10;
            if ((packed & 0x80) !== 0) offset += 3 * (1 << ((packed & 7) + 1));
            offset += 1;
            while (offset < b.length && b[offset] !== 0) offset += (b[offset] ?? 0) + 1;
            offset += 1;
        } else {
            throw bad("GIF-Block unbekannt");
        }
    }
    return { width: u16le(b, 6), height: u16le(b, 8), frames: Math.max(1, frames), alpha };
}

function webpHeader(b: Uint8Array): RasterHeader {
    let offset = 12;
    let width = 0;
    let height = 0;
    let animated = false;
    let alpha = false;
    let frames = 0;
    while (offset + 8 <= b.length) {
        const type = ascii(b, offset, 4);
        const length = u32le(b, offset + 4);
        if (type === "VP8X") {
            animated = ((b[offset + 8] ?? 0) & 0x02) !== 0;
            if (((b[offset + 8] ?? 0) & 0x10) !== 0) alpha = true;
            width = 1 + u24le(b, offset + 12);
            height = 1 + u24le(b, offset + 15);
        } else if (type === "VP8 " && width === 0) {
            width = u16le(b, offset + 14) & 0x3fff;
            height = u16le(b, offset + 16) & 0x3fff;
        } else if (type === "VP8L" && width === 0) {
            const bits = u32le(b, offset + 9);
            width = (bits & 0x3fff) + 1;
            height = ((bits >>> 14) & 0x3fff) + 1;
            if (((bits >>> 28) & 1) !== 0) alpha = true;
        } else if (type === "ANMF") {
            frames += 1;
        } else if (type === "ALPH") {
            alpha = true;
        }
        offset += 8 + length + (length & 1);
    }
    if (width === 0 || height === 0) throw bad("WebP ohne Maße");
    return { width, height, frames: animated ? Math.max(frames, 2) : 1, alpha };
}

function rasterHeader(format: Exclude<RasterFormat, "svg" | "pdf">, bytes: Uint8Array): RasterHeader {
    switch (format) {
        case "png":
            return pngHeader(bytes);
        case "jpeg":
            return jpegHeader(bytes);
        case "gif":
            return gifHeader(bytes);
        case "webp":
            return webpHeader(bytes);
    }
}

// --- Grenzen ---------------------------------------------------------------------------------------------------------

const megapixels = (pixels: number): string => (pixels / 1_000_000).toFixed(1).replace(".", ",");

/** Wendet die Pixel- und Kantengrenze (D2) auf Maße an. Auch die Bibliothek ruft das mit ihren eigenen Maßen auf. */
export function assertDimensionsWithinLimits(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        throw bad("Maße fehlen oder sind null");
    }
    if (Math.max(width, height) > RASTER_LIMITS.maxEdge) {
        throw new RasterRejection(
            "too_large_dimensions",
            `Bild ist ${String(width)} × ${String(height)} px groß, die längste Kante darf höchstens ${String(RASTER_LIMITS.maxEdge)} px haben`,
        );
    }
    if (width * height > RASTER_LIMITS.maxPixels) {
        throw new RasterRejection(
            "too_many_pixels",
            `Bild hat ${megapixels(width * height)} MP, erlaubt sind höchstens ${String(RASTER_LIMITS.maxPixels / 1_000_000)} MP`,
        );
    }
}

// --- SVG -------------------------------------------------------------------------------------------------------------

const TEXT_ELEMENT =
    /<(?:[A-Za-z_][\w.-]*:)?(?:text|tspan|textPath|tref|altGlyph|altGlyphDef|altGlyphItem|glyphRef)(?=[\s/>])/;
const SCRIPT_ELEMENT = /<(?:[A-Za-z_][\w.-]*:)?(?:script|foreignObject)(?=[\s/>])/;
const EVENT_ATTRIBUTE = /[\s"'/]on[a-z]+\s*=/i;
const HREF_ATTRIBUTE = /\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const URL_OPEN = /url\(/gi;

/** Ein Verweis ist nur dann harmlos, wenn er innerhalb des Dokuments bleibt (`#id`). */
const isLocalReference = (target: string): boolean => target.trim().startsWith("#");

/**
 * Nimmt die Kommentare heraus (ein auskommentiertes `<text>` ist keines). Linear: eine Regel mit `[\s\S]*?` bräuchte bei
 * vielen unbeendeten `<!--` quadratische Zeit, und das SVG darf bis 512 KiB groß sein. Ein Kommentar ohne Ende ist kein
 * gültiges XML.
 */
function stripComments(text: string): string {
    let result = "";
    let from = 0;
    for (;;) {
        const start = text.indexOf("<!--", from);
        if (start === -1) return result + text.slice(from);
        const end = text.indexOf("-->", start + 4);
        if (end === -1) throw new RasterRejection("svg_invalid", "SVG hat einen Kommentar ohne Ende");
        result += text.slice(from, start);
        from = end + 3;
    }
}

/**
 * Zeigt irgendein `url(…)` aus dem Dokument hinaus? Linear aus demselben Grund wie `stripComments`: ein Muster mit
 * `[^)\s]*` hinter jedem `url(` wäre bei vielen unbeendeten Aufrufen quadratisch. Ein `url(` ohne `)` gilt als Verweis.
 */
function hasExternalUrlReference(scan: string): boolean {
    URL_OPEN.lastIndex = 0;
    for (let match = URL_OPEN.exec(scan); match !== null; match = URL_OPEN.exec(scan)) {
        const end = scan.indexOf(")", match.index + 4);
        if (end === -1) return true;
        const target = scan
            .slice(match.index + 4, end)
            .trim()
            .replace(/^["']|["']$/g, "");
        if (!isLocalReference(target)) return true;
        URL_OPEN.lastIndex = end + 1;
    }
    return false;
}

const forbidden = (what: string): RasterRejection =>
    new RasterRejection("svg_forbidden_content", `SVG enthält ${what}; das nimmt die Pipeline nicht an`);

/** D4 und die Sicherheitsregeln für SVG. Wirft `RasterRejection`; ein SVG, das hier besteht, wird gerastert. */
function checkSvg(bytes: Uint8Array): void {
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
        throw new RasterRejection("svg_invalid", "SVG ist kein gültiges UTF-8", { cause: error });
    }
    const scan = stripComments(text);

    if (/<!DOCTYPE/i.test(scan) || /<!ENTITY/i.test(scan)) throw forbidden("eine DTD oder Entität");
    if (/<\?xml-stylesheet/i.test(scan)) throw forbidden("ein externes Stylesheet");
    // D4: ein SVG mit Text wird abgewiesen, die Pipeline rendert nie Text.
    if (TEXT_ELEMENT.test(scan)) {
        throw new RasterRejection("svg_has_text", "SVG enthält Text (<text>); die Pipeline rendert keinen Text");
    }
    if (SCRIPT_ELEMENT.test(scan)) throw forbidden("Skript oder ein foreignObject");
    if (EVENT_ATTRIBUTE.test(scan) || /javascript:/i.test(scan)) throw forbidden("ein Ereignis oder javascript:");
    if (/@import/i.test(scan)) throw forbidden("@import");
    for (const match of scan.matchAll(HREF_ATTRIBUTE)) {
        if (!isLocalReference(match[1] ?? match[2] ?? "")) throw forbidden("einen externen Verweis (href)");
    }
    if (hasExternalUrlReference(scan)) throw forbidden("einen externen Verweis (url())");
}

// --- Einstieg --------------------------------------------------------------------------------------------------------

/**
 * Prüft Bytes, bevor ein Dekoder sie sieht. Wirft `RasterRejection` mit Code, sonst die erkannte Art und, bei Rastern,
 * die Maße aus dem Kopf.
 */
export function inspectImage(
    bytes: Uint8Array,
    options: {
        allowPdf?: boolean;
        /** Eine größere Grenze für Rasterdateien als die 6 MiB der Medienverwaltung (D2); nur der Vorschlagsweg der Kartensammlung (WI-0275) setzt sie. */
        maxRasterBytes?: number;
    } = {},
): RasterInspection {
    if (bytes.byteLength === 0) throw new RasterRejection("empty_file", "Die Datei ist leer");
    // Ein PDF nur dort, wo der Aufrufer es ausdrücklich zulässt (Kartenquellen, WI-0275); sonst ist es ein unbekanntes Format.
    if (options.allowPdf === true && isPdf(bytes)) {
        if (bytes.byteLength > PDF_LIMITS.maxBytes) {
            throw new RasterRejection(
                "too_large_bytes",
                `PDF hat ${String(bytes.byteLength)} Bytes, erlaubt sind höchstens ${String(PDF_LIMITS.maxBytes)}`,
            );
        }
        return {
            format: "pdf",
            mimeType: FORMAT_MIME.pdf,
            byteSize: bytes.byteLength,
            width: null,
            height: null,
            alpha: null,
            findings: [{ code: "pdf_source", detail: "privates Quellartefakt, Raster der ersten Seite als Derivat" }],
        };
    }
    const format = sniffFormat(bytes);
    if (format === null) {
        throw new RasterRejection("unsupported_format", "Das Format ist kein PNG, JPEG, GIF, WebP oder SVG");
    }

    const mimeType = FORMAT_MIME[format];
    const byteSize = bytes.byteLength;

    if (format === "svg") {
        if (byteSize > RASTER_LIMITS.maxSvgBytes) {
            throw new RasterRejection(
                "too_large_bytes",
                `SVG hat ${String(byteSize)} Bytes, erlaubt sind höchstens ${String(RASTER_LIMITS.maxSvgBytes)}`,
            );
        }
        checkSvg(bytes);
        return {
            format,
            mimeType,
            byteSize,
            width: null,
            height: null,
            alpha: null,
            findings: [{ code: "svg_source", detail: "privates Quellartefakt, Raster als Derivat" }],
        };
    }

    const rasterGrenze = options.maxRasterBytes ?? RASTER_LIMITS.maxRasterBytes;
    if (byteSize > rasterGrenze) {
        throw new RasterRejection(
            "too_large_bytes",
            `Datei hat ${String(byteSize)} Bytes, erlaubt sind höchstens ${String(rasterGrenze)}`,
        );
    }
    const header = rasterHeader(format, bytes);
    if (header.frames > 1) {
        throw new RasterRejection(
            "animated_or_multiframe",
            `Die Datei hat ${String(header.frames)} Bilder; mehrbildige Dateien nimmt die Pipeline nicht an`,
        );
    }
    assertDimensionsWithinLimits(header.width, header.height);
    return {
        format,
        mimeType,
        byteSize,
        width: header.width,
        height: header.height,
        alpha: header.alpha,
        findings: [],
    };
}
