import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DownloadStore } from "../../src/migration/media-download.ts";
import { MediaStore } from "../../src/media/storage.ts";

/**
 * Bilder und ein Download-Fach für die Tests des Binärimports (WI-0063 MEDIA-M9, M10). Alles selbst erzeugt, kein Legacy-Medium: ein
 * einfarbiges Bild je Startwert (verschiedene Startwerte, verschiedene Bytes) in der Größe, die Legacy je Klasse abgelegt hat.
 */

const color = (seed: number) => ({ r: (seed * 53) % 256, g: (seed * 97 + 40) % 256, b: (seed * 29 + 120) % 256 });

/** Legacys Ortsbild: 800 x 450, WebP (q82). */
export const settlementImage = (seed: number): Promise<Buffer> =>
    sharp({ create: { width: 800, height: 450, channels: 3, background: color(seed) } })
        .webp({ quality: 82 })
        .toBuffer();

/** Ein Wappen: PNG mit Alphakanal, so groß wie eine Wiki-Datei (hier klein gehalten). */
export const coatPng = (seed: number, size = 96): Promise<Buffer> =>
    sharp({ create: { width: size, height: size, channels: 4, background: { ...color(seed), alpha: 0.6 } } })
        .png()
        .toBuffer();

export const coverJpeg = (seed: number): Promise<Buffer> =>
    sharp({ create: { width: 300, height: 420, channels: 3, background: color(seed) } })
        .jpeg({ quality: 90 })
        .toBuffer();

export const mapPng = (seed: number): Promise<Buffer> =>
    sharp({ create: { width: 640, height: 480, channels: 3, background: color(seed) } })
        .png()
        .toBuffer();

/** Ein SVG-Wappen ohne Text, Skript und Verweise. */
export const coatSvg = (seed: number): Buffer =>
    Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="rgb(${String(color(seed).r)},${String(color(seed).g)},${String(color(seed).b)})"/><circle cx="60" cy="60" r="30" fill="#fff"/></svg>`,
    );

/** Ein SVG mit Text: die Pipeline rendert keinen (Betreiber D4), die Vorprüfung weist es ab. */
export const svgWithText = (): Buffer =>
    Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text x="4" y="24">Wappen von Gareth</text></svg>`,
    );

export interface Workspace {
    /** Die Medienwurzel (privat und öffentlich): ein Wegwerfordner. */
    root: string;
    store: MediaStore;
    /** Das Download-Fach. */
    downloadDir: string;
    downloads: DownloadStore;
    /** Legt eine Datei unter ihrer Legacy-Adresse ins Fach (nach SHA-256 benannt, in der Liste geführt). */
    put(
        localUrl: string,
        bytes: Uint8Array,
        extension: string,
        options?: { etag?: string; lastModified?: string },
    ): Promise<void>;
    /** Schreibt die Liste und öffnet das Fach neu (so liest es auch der Binärimport). */
    reopen(name?: string): Promise<DownloadStore>;
    dispose(): Promise<void>;
}

export async function createWorkspace(): Promise<Workspace> {
    const base = await mkdtemp(join(tmpdir(), "avesmaps3d-media-files-"));
    const root = join(base, "media");
    const downloadDir = join(base, "downloads");
    await mkdir(root, { recursive: true });
    await mkdir(downloadDir, { recursive: true });
    // Jeder Abruf trägt einen späteren Zeitpunkt: bei derselben Adresse gilt in `DownloadStore.open` der jüngere Eintrag.
    let tick = 0;
    const workspace: Workspace = {
        root,
        store: new MediaStore(root),
        downloadDir,
        downloads: await DownloadStore.open(downloadDir),
        async put(localUrl, bytes, extension, options = {}) {
            tick += 1;
            await workspace.downloads.put(
                {
                    url: localUrl,
                    status: 200,
                    contentType: null,
                    etag: options.etag ?? null,
                    lastModified: options.lastModified ?? null,
                    fetchedAt: new Date(Date.UTC(2026, 9, 4, 11, 7, 0) + tick * 1000).toISOString(),
                },
                bytes,
                extension,
            );
        },
        async reopen(name = "test") {
            await workspace.downloads.writeListing(name, {
                zug: "Test",
                basis: "https://legacy.invalid",
                fetchedAt: "2026-10-04T11:07:20.488Z",
            });
            workspace.downloads = await DownloadStore.open(downloadDir);
            return workspace.downloads;
        },
        async dispose() {
            await rm(base, { recursive: true, force: true });
        },
    };
    return workspace;
}
