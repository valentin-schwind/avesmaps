import sharp, { type Metadata, type SharpOptions, type WebpOptions } from "sharp";
import { assertDimensionsWithinLimits, RasterRejection, type RasterInspection } from "./inspect.ts";
import { RASTER_ENGINE, RASTER_LIMITS } from "./limits.ts";
import type { Encoding, RenderProfile } from "./profiles.ts";

/**
 * Der Kern der Rasterpipeline (WI-0063 26.11, MEDIA-M7): aus den Bytes einer geprüften Datei die öffentliche WebP-Datei
 * eines Profils. Rein im Sinn von „keine Datenbank, kein Dateisystem, keine Uhr“: dieselben Bytes und dasselbe Profil
 * ergeben dieselben Bytes (Prüfvektoren in `apps/server/test/media-raster-render.test.ts`).
 *
 * Die Operationsfolge ist das Rezept: Orientierung anwenden, skalieren oder zuschneiden, nach sRGB, WebP. Sie steht hier an
 * EINER Stelle; ihre Änderung ist eine neue Rezeptrevision (`profiles.ts`). Ohne `withMetadata` schreibt die Bibliothek weder
 * EXIF noch GPS noch ICC noch XMP: ein öffentliches Derivat trägt keine Metadaten.
 *
 * Die zweite Linie hinter `inspect.ts`: `failOn: "warning"` (jede Dekoderwarnung ist ein Fehler, eine abgeschnittene Datei
 * wird nie zu einem halben Bild) und `limitInputPixels` (die Bibliothek weist eine Pixelbombe schon am Kopf ab).
 */

const WEBP_MIME = "image/webp";
/** Der Aufwand des WebP-Kodierers (0 bis 6). Ausdrücklich gesetzt, damit ein geänderter Vorgabewert das Rezept nicht still ändert. */
const WEBP_EFFORT = 4;
/** Die Dichte, mit der die Bibliothek ein SVG ohne Zielmaß liest (Punkte je Zoll): ihr Vorgabewert, hier benannt. */
const SVG_BASE_DENSITY = 72;
/** Zulässiger Bereich der Dichte (`sharp`). */
const SVG_DENSITY_RANGE = { min: 1, max: 100_000 } as const;

export interface EngineVersions {
    sharp: string;
    libvips: string;
    libwebp: string;
}

/** Die Versionen der Bildbibliothek, wie sie in `recipe_version` stehen. */
export function engineVersions(): EngineVersions {
    const versions = sharp.versions as Record<string, string | undefined>;
    return {
        sharp: versions["sharp"] ?? "unknown",
        libvips: versions["vips"] ?? "unknown",
        libwebp: versions["webp"] ?? "unknown",
    };
}

/**
 * Der Wert von `media_file.recipe_version`: Rezeptrevision und Bibliotheksversionen. Die Bytes hängen an beidem; ein
 * Versionssprung der Bibliothek (neues libwebp) kann sie ändern, und der Wert macht das sichtbar.
 */
export function recipeVersion(profile: RenderProfile): string {
    const { sharp: sharpVersion, libvips, libwebp } = engineVersions();
    const revision =
        profile.tag === undefined ? String(profile.revision) : `${String(profile.revision)}+${profile.tag}`;
    return `${revision} / sharp ${sharpVersion} / libvips ${libvips} / libwebp ${libwebp}`;
}

let engineConfigured = false;

/** Einmal je Prozess: ein libvips-Arbeitsthread, kein Operationscache (Claudios Bedingung, `limits.ts`). */
function configureEngine(): void {
    if (engineConfigured) return;
    sharp.cache(false);
    sharp.concurrency(RASTER_ENGINE.concurrency);
    engineConfigured = true;
}

export interface RenderedRaster {
    bytes: Buffer;
    mimeType: typeof WEBP_MIME;
    width: number;
    height: number;
    /** Nur beim Auffüllen zum Quadrat (Wappen aus dem Editor): Sind die vier Ecken des Bildes selbst durchsichtig? */
    transparentCorners?: boolean;
    /**
     * Auf Wunsch (`corners`, jedes Wappen, WI-0068 P4b T2b) gemessen: dieselbe Frage, aber sie HÄLT NUR FEST und entscheidet nichts.
     * Beim Auffüllen ist sie dieselbe Messung wie `transparentCorners`.
     */
    corners?: boolean;
}

/** Ab diesem Alphawert (0 bis 255) gilt eine Ecke als nicht durchsichtig; dieselbe Schwelle wie die Messung am Bestand (WI-0068 P4b). */
export const CORNER_ALPHA_MAX = 15;

/**
 * Sind die vier Ecken des Bildes durchsichtig? Gerechnet an einer kleinen Fassung (32 × 32, gestreckt): Die Ecke bleibt Ecke, und kein
 * großes Raster entsteht nur für vier Pixel.
 */
async function cornersTransparent(input: Buffer, options: SharpOptions): Promise<boolean> {
    const { data, info } = await sharp(input, options)
        .autoOrient()
        .ensureAlpha()
        .resize({ width: 32, height: 32, fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number): number => data[(y * info.width + x) * info.channels + 3] ?? 255;
    const last = { x: info.width - 1, y: info.height - 1 };
    return [alpha(0, 0), alpha(last.x, 0), alpha(0, last.y), alpha(last.x, last.y)].every(
        (value) => value <= CORNER_ALPHA_MAX,
    );
}

const decodeFailed = (error: unknown): RasterRejection => {
    const reason = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 160) : "unbekannt";
    return new RasterRejection("decode_failed", `Das Bild lässt sich nicht vollständig dekodieren: ${reason}`, {
        cause: error,
    });
};

/** Die Maße nach der Orientierung: EXIF 5 bis 8 vertauscht Breite und Höhe. */
function orientedSize(
    width: number,
    height: number,
    orientation: number | undefined,
): { width: number; height: number } {
    return (orientation ?? 1) >= 5 ? { width: height, height: width } : { width, height };
}

/** Zentrierter Zuschnitt auf `ratio`: so groß wie möglich, höchstens `maxWidth` breit, nie größer als die Quelle. */
export function cropTarget(
    source: { width: number; height: number },
    ratio: readonly [number, number],
    maxWidth: number,
): { width: number; height: number } {
    let width = Math.min(maxWidth, source.width);
    let height = Math.round((width * ratio[1]) / ratio[0]);
    if (height > source.height) {
        height = source.height;
        width = Math.min(source.width, Math.round((height * ratio[0]) / ratio[1]));
    }
    return { width: Math.max(1, width), height: Math.max(1, height) };
}

function webpOptions(encoding: Encoding): WebpOptions {
    // Vorgabewerte (Qualität 80, Alpha 100) stehen ausdrücklich da: ein geänderter Vorgabewert der Bibliothek ändert das Rezept nicht still.
    if (encoding.mode === "lossless") return { lossless: true, quality: 80, effort: WEBP_EFFORT };
    return { quality: encoding.quality, alphaQuality: 100, effort: WEBP_EFFORT };
}

/**
 * Rendert die geprüften Bytes in das Profil. Wirft `RasterRejection` (`decode_failed`, oder eine Grenze, die erst die
 * Bibliothek sieht).
 */
export async function renderRaster(
    bytes: Uint8Array,
    inspection: RasterInspection,
    profile: RenderProfile,
    options: { corners?: boolean } = {},
): Promise<RenderedRaster> {
    configureEngine();
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const isSvg = inspection.format === "svg";
    const strict = { failOn: "warning", limitInputPixels: RASTER_LIMITS.maxPixels } as const;

    // Der Kopf noch einmal, jetzt aus der Bibliothek: nur lesen, nichts dekodieren (deshalb ohne Pixelgrenze: sie würde hier
    // nur den Fehlercode verschlucken; die Grenze prüft `assertDimensionsWithinLimits` gleich danach mit den Maßen der
    // Bibliothek, und beim Dekodieren gilt `limitInputPixels` wieder). Ein SVG hat kein festes Maß; seine Pixelgrenze gilt
    // für das Raster, das unten entsteht, nicht für das Eigenmaß.
    let meta: Metadata;
    try {
        meta = await sharp(input, { failOn: "warning", limitInputPixels: false }).metadata();
    } catch (error) {
        throw decodeFailed(error);
    }
    if ((meta.pages ?? 1) > 1) {
        throw new RasterRejection(
            "animated_or_multiframe",
            `Die Datei hat ${String(meta.pages)} Bilder; mehrbildige Dateien nimmt die Pipeline nicht an`,
        );
    }
    if (meta.width === undefined || meta.height === undefined) {
        throw new RasterRejection("decode_failed", "Das Bild hat keine lesbaren Maße");
    }
    if (!isSvg) assertDimensionsWithinLimits(meta.width, meta.height);

    // Die Größe, aus der Zuschnitt und Skalierung rechnen: das Raster nach der Orientierung, bei SVG das Zielraster.
    let working = orientedSize(meta.width, meta.height, meta.orientation);
    let density: number | undefined;
    if (isSvg) {
        const scale = profile.svgLongEdge / Math.max(meta.width, meta.height);
        density = Math.min(SVG_DENSITY_RANGE.max, Math.max(SVG_DENSITY_RANGE.min, SVG_BASE_DENSITY * scale));
        working = {
            width: Math.max(1, Math.round(meta.width * scale)),
            height: Math.max(1, Math.round(meta.height * scale)),
        };
    }

    let pipeline = sharp(input, density === undefined ? strict : { ...strict, density }).autoOrient();
    const { geometry } = profile;
    let transparentCorners: boolean | undefined;
    if (geometry.kind === "fit_inside") {
        pipeline = pipeline.resize({
            width: geometry.longEdge,
            height: geometry.longEdge,
            fit: "inside",
            // Ein Vektor darf wachsen (er verliert dabei nichts), ein Raster nie.
            withoutEnlargement: !isSvg,
        });
        if (geometry.padSquare === true) {
            // Erst die Ecken des Bildes selbst (der Rand käme ja durchsichtig dazu), dann der Rand.
            transparentCorners = await cornersTransparent(
                input,
                density === undefined ? strict : { ...strict, density },
            );
            const scale = isSvg
                ? geometry.longEdge / Math.max(working.width, working.height)
                : Math.min(1, geometry.longEdge / Math.max(working.width, working.height));
            const width = Math.max(1, Math.round(working.width * scale));
            const height = Math.max(1, Math.round(working.height * scale));
            const side = Math.max(width, height);
            const left = Math.floor((side - width) / 2);
            const top = Math.floor((side - height) / 2);
            pipeline = pipeline.ensureAlpha().extend({
                left,
                right: side - width - left,
                top,
                bottom: side - height - top,
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            });
        }
    } else if (geometry.kind === "crop") {
        const target = cropTarget(working, geometry.ratio, geometry.maxWidth);
        pipeline = pipeline.resize({ width: target.width, height: target.height, fit: "cover", position: "centre" });
    } else if (isSvg) {
        pipeline = pipeline.resize({
            width: profile.svgLongEdge,
            height: profile.svgLongEdge,
            fit: "inside",
            withoutEnlargement: false,
        });
    }
    const corners =
        transparentCorners ??
        (options.corners === true
            ? await cornersTransparent(input, density === undefined ? strict : { ...strict, density }).catch(
                  (error: unknown) => {
                      throw decodeFailed(error);
                  },
              )
            : undefined);

    try {
        const { data, info } = await pipeline
            .toColourspace("srgb")
            .timeout({ seconds: RASTER_ENGINE.timeoutSeconds })
            .webp(webpOptions(profile.encoding))
            .toBuffer({ resolveWithObject: true });
        if (info.format !== "webp") throw new Error("Die Ausgabe ist kein WebP");
        return {
            bytes: data,
            mimeType: WEBP_MIME,
            width: info.width,
            height: info.height,
            ...(transparentCorners === undefined ? {} : { transparentCorners }),
            ...(corners === undefined ? {} : { corners }),
        };
    } catch (error) {
        throw decodeFailed(error);
    }
}
