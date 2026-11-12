import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestImage } from "../src/media/raster/ingest.ts";
import { inspectImage, RasterRejection } from "../src/media/raster/inspect.ts";
import { PDF_LIMITS } from "../src/media/raster/limits.ts";
import { isPdf } from "../src/media/raster/pdf-magic.ts";
import { pdfScale } from "../src/media/raster/pdf.ts";
import { MediaStore } from "../src/media/storage.ts";
import { halvesImage, png } from "./support/media-fixtures.ts";

// pdf.js und die Zeichenbibliothek laden beim ersten PDF; unter Last reichen 5 Sekunden nicht.
vi.setConfig({ testTimeout: 30_000 });

/** WI-0275 Stufe A: PDF als Kartenquelle der Medienverwaltung. Die Test-PDF entsteht hier, mit gültiger Querverweistabelle. */
function pdfWithPages(pages: number, width = 600, height = 400): Buffer {
    const objects: string[] = [];
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    const kids = Array.from({ length: pages }, (_, index) => `${String(4 + index * 2)} 0 R`).join(" ");
    objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${String(pages)} >>`);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    for (let index = 0; index < pages; index += 1) {
        const content = `0.8 0.1 0.1 rg 50 50 ${String(width - 100)} ${String(height - 100)} re f`;
        objects.push(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(width)} ${String(height)}] /Contents ${String(5 + index * 2)} 0 R >>`,
        );
        objects.push(`<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`);
    }
    let body = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((object, index) => {
        offsets.push(body.length);
        body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
    for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
    body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
    return Buffer.from(body, "latin1");
}

describe("PDF als Kartenquelle", () => {
    let root: string;
    let store: MediaStore;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "avesmaps3d-pdf-"));
        store = new MediaStore(root);
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("erkennt ein PDF an den Magic Bytes, nicht an der Endung", async () => {
        expect(isPdf(pdfWithPages(1))).toBe(true);
        expect(isPdf(await png(halvesImage(8, 8)))).toBe(false);
        expect(isPdf(Buffer.from("PDF-1.4 mit falschem Anfang"))).toBe(false);
    });

    it("nimmt ein PDF nur an, wo der Aufrufer es zulässt", () => {
        const bytes = pdfWithPages(1);
        expect(() => inspectImage(bytes)).toThrowError(expect.objectContaining({ code: "unsupported_format" }));
        const inspection = inspectImage(bytes, { allowPdf: true });
        expect(inspection.format).toBe("pdf");
        expect(inspection.mimeType).toBe("application/pdf");
    });

    it("weist ein PDF über 50 MiB ab, ein Bild bleibt bei seiner Grenze", () => {
        const big = Buffer.alloc(PDF_LIMITS.maxBytes + 1);
        big.write("%PDF-1.4\n", "latin1");
        expect(() => inspectImage(big, { allowPdf: true })).toThrowError(
            expect.objectContaining({ code: "too_large_bytes" }),
        );
        const ok = Buffer.alloc(PDF_LIMITS.maxBytes);
        ok.write("%PDF-1.4\n", "latin1");
        expect(inspectImage(ok, { allowPdf: true }).format).toBe("pdf");
    });

    it("hält Kante und Pixelzahl des Rasters ein", () => {
        expect(595 * pdfScale(595, 842)).toBeLessThanOrEqual(4096);
        expect(842 * pdfScale(595, 842)).toBeCloseTo(4096, 0);
        const scale = pdfScale(5000, 5000);
        expect(5000 * scale * 5000 * scale).toBeLessThanOrEqual(16_000_000);
    });

    it("rastert Seite 1 durch die Derivat-Kette; das PDF bleibt privat", async () => {
        const bytes = pdfWithPages(3);
        const result = await ingestImage(store, { bytes, role: "map_full", publish: true });
        expect(result.format).toBe("pdf");
        expect(result.source.mimeType).toBe("application/pdf");
        expect(result.source.key.startsWith("private/source/")).toBe(true);
        expect(result.source.key.endsWith(".pdf")).toBe(true);
        expect(result.derivatives).toHaveLength(1);
        const derivative = result.derivatives[0];
        expect(derivative?.mimeType).toBe("image/webp");
        expect(derivative?.key.startsWith("published/")).toBe(true);
        expect(derivative?.key.endsWith(".webp")).toBe(true);
        // 600 × 400 Punkte, lange Kante auf 4096 Pixel.
        expect(Math.max(derivative?.width ?? 0, derivative?.height ?? 0)).toBeLessThanOrEqual(4096);
        expect(derivative?.width).toBeGreaterThan(3000);
        expect(result.findings.map((finding) => finding.code)).toEqual(
            expect.arrayContaining(["pdf_source", "pdf_first_page_only"]),
        );
        // Der Inhalt der Seite ist da: Mitte rot, Rand weiß.
        const { data, info } = await sharp(await store.read(derivative?.key ?? "", 50 * 1024 * 1024))
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const at = (x: number, y: number): number[] => [
            ...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3),
        ];
        expect(at(info.width >> 1, info.height >> 1)[0]).toBeGreaterThan(180);
        expect(at(info.width >> 1, info.height >> 1)[1]).toBeLessThan(60);
        expect(at(2, 2)).toEqual([255, 255, 255]);
        expect(result.perceptualHash).toMatch(/^[0-9a-f]{16}$/u);
    });

    it("legt ohne Freigabe nur Original und private Vorschau ab", async () => {
        const result = await ingestImage(store, {
            bytes: pdfWithPages(1),
            role: "map_full",
            publish: false,
            preview: true,
        });
        expect(result.derivatives).toHaveLength(0);
        expect(result.preview?.storageClass).toBe("derivative");
        expect(result.preview?.mimeType).toBe("image/webp");
    });

    it("nimmt ein PDF für andere Rollen nicht an", async () => {
        await expect(
            ingestImage(store, { bytes: pdfWithPages(1), role: "header", publish: true }),
        ).rejects.toMatchObject({
            code: "unsupported_format",
        });
    });

    it("macht aus einem beschädigten PDF einen Befund statt eines Absturzes und speichert nichts", async () => {
        const broken = Buffer.from("%PDF-1.4\nkeine Objekte, kein Ende", "latin1");
        const failure = await ingestImage(store, { bytes: broken, role: "map_full", publish: true }).catch(
            (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(RasterRejection);
        expect((failure as RasterRejection).technicalState).toBe("decode_failed");
        await expect(store.read("private/source/none.pdf", 10)).rejects.toBeDefined();
    });
});
