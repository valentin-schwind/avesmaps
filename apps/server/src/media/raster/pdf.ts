import { RasterRejection } from "./inspect.ts";
import { PDF_LIMITS, RASTER_LIMITS } from "./limits.ts";

export { isPdf } from "./pdf-magic.ts";

/**
 * Die erste Seite eines PDF als Rasterbild (WI-0275 Stufe A, Kartenquellen der Medienverwaltung). Ein PDF ist wie ein SVG ein privates
 * Quellartefakt: Es wird nie ausgeliefert; sein Raster läuft danach durch dieselbe Derivat-Kette wie jedes Bild (`renderRaster`).
 *
 * - Reiner JavaScript-Weg ohne Systemwerkzeug: `pdfjs-dist` (Apache-2.0) liest, `@napi-rs/canvas` (MIT, vorgebaute Binärdatei für
 *   Windows und Linux) zeichnet. Kein mupdf (AGPL), kein Poppler, kein Ghostscript auf dem VPS.
 * - Gerastert wird nur Seite 1. Weitere Seiten bleiben unbeachtet (Befund `pdf_first_page_only`).
 * - Skript, Formulare (XFA), Systemschriften und `eval` sind aus; ein verschlüsseltes oder beschädigtes PDF ist ein technischer
 *   Befund (`decode_failed`), kein Absturz. Eine Zeitgrenze bricht ein PDF ab, das den Dekoder festhält.
 */

export interface PdfPage {
    /** Das gerasterte PNG der ersten Seite. */
    png: Buffer;
    width: number;
    height: number;
    pageCount: number;
}

interface PdfLike {
    numPages: number;
    getPage(n: number): Promise<{
        getViewport(options: { scale: number }): { width: number; height: number };
        render(options: Record<string, unknown>): { promise: Promise<void> };
        cleanup(): void;
    }>;
}

interface LoadingTaskLike {
    promise: Promise<unknown>;
    destroy(): Promise<void>;
}

/** Der Maßstab, mit dem die Seite die Grenzen einhält: lange Kante höchstens 4096 Pixel und höchstens 16 MP (ein Vektor verliert beim Vergrößern nichts). */
export function pdfScale(pageWidth: number, pageHeight: number): number {
    const byEdge = PDF_LIMITS.maxRasterEdge / Math.max(pageWidth, pageHeight);
    const byPixels = Math.sqrt(RASTER_LIMITS.maxPixels / (pageWidth * pageHeight));
    return Math.min(byEdge, byPixels * 0.98);
}

const reject = (message: string, cause?: unknown): RasterRejection =>
    new RasterRejection("decode_failed", message, cause === undefined ? undefined : { cause });

/** Rastert Seite 1. Wirft `RasterRejection` (`decode_failed`), nie einen anderen Fehler, für ein PDF, das sich nicht lesen lässt. */
export async function rasterizePdfFirstPage(bytes: Uint8Array): Promise<PdfPage> {
    const [pdfjs, canvasModule] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("@napi-rs/canvas"),
    ]);
    let task: LoadingTaskLike | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
        const work = (async (): Promise<PdfPage> => {
            // pdf.js nimmt die Bytes in Besitz (überträgt den Puffer): eine Kopie, das Original wird danach noch gespeichert.
            const loading = pdfjs.getDocument({
                data: new Uint8Array(bytes),
                enableXfa: false,
                useSystemFonts: false,
                disableFontFace: true,
                maxImageSize: RASTER_LIMITS.maxPixels,
                verbosity: 0,
            });
            task = loading as unknown as LoadingTaskLike;
            const document = (await loading.promise) as unknown as PdfLike;
            if (document.numPages < 1) throw reject("Das PDF hat keine Seite");
            const page = await document.getPage(1);
            const base = page.getViewport({ scale: 1 });
            if (!(base.width > 0 && base.height > 0)) throw reject("Die erste Seite des PDF hat keine Größe");
            const viewport = page.getViewport({ scale: pdfScale(base.width, base.height) });
            const width = Math.max(1, Math.floor(viewport.width));
            const height = Math.max(1, Math.floor(viewport.height));
            const canvas = canvasModule.createCanvas(width, height);
            const context = canvas.getContext("2d");
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, width, height);
            await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" }).promise;
            page.cleanup();
            return { png: canvas.toBuffer("image/png"), width, height, pageCount: document.numPages };
        })();
        const timeout = new Promise<never>((_, fail) => {
            timer = setTimeout(
                () => fail(reject(`Das PDF ließ sich nicht in ${String(PDF_LIMITS.timeoutSeconds)} s rastern`)),
                PDF_LIMITS.timeoutSeconds * 1000,
            );
        });
        return await Promise.race([work, timeout]);
    } catch (error) {
        if (error instanceof RasterRejection) throw error;
        const name = (error as { name?: string } | null)?.name;
        if (name === "PasswordException") throw reject("Das PDF ist passwortgeschützt", error);
        throw reject("Das PDF ist beschädigt oder lässt sich nicht lesen", error);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
        await task?.destroy().catch(() => undefined);
    }
}
