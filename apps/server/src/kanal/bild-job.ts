import { FORMAT_EXTENSION, RasterRejection, inspectImage } from "../media/raster/inspect.ts";
import { MAX_SOURCE_BYTES } from "../media/raster/limits.ts";
import { CHANNEL_PROFILES } from "../media/raster/profiles.ts";
import { renderRaster } from "../media/raster/render.ts";
import { MediaStorageError, MediaStore, channelKey } from "../media/storage.ts";
import { JobFailure, type JobContext } from "../jobs/handlers.ts";
import { withJobDatabase } from "../jobs/job-database.ts";

/**
 * Die Jobart `kanal_bild` (WI-0124, KANAL-0001 §6.1 Schritt 2): ein Bildschirmfoto des Betreiber-Kanals im Worker neu kodieren. Sie liest
 * das Original unter `private/kanal/<bild>/original.<endung>`, rendert `ansicht` (lange Kante 2560) und `vorschau` (480) als WebP ohne
 * EXIF, GPS, ICC und XMP, legt beide neben das Original und setzt die Zeile über `avesmaps_kanal.kanal_bild_fertig` auf `bereit`. Kann sie
 * nicht dekodieren, setzt sie `abgewiesen` mit dem Code der Rasterpipeline; der Job endet trotzdem erfolgreich (das Ergebnis steht an der
 * Zeile). Akteur `kanal`, also kein Editor-Job: Eine Kartensperre hält ihn nicht an.
 *
 * Eingabe (`input_ref`, klein): `bild` (UUID) und `endung` des Originals (`png`, `jpg`, `gif`, `webp`).
 */
export const KANAL_BILD_KIND = "kanal_bild";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ENDUNGEN: readonly string[] = Object.values(FORMAT_EXTENSION).filter((endung) => endung !== "svg");

export interface KanalBildInput {
    bild: string;
    endung: string;
}

export function parseKanalBildInput(raw: Record<string, unknown>): KanalBildInput {
    const bild = raw["bild"];
    const endung = raw["endung"];
    if (typeof bild !== "string" || !UUID.test(bild))
        throw new JobFailure("invalid_input", "bild ist keine UUID", false);
    if (typeof endung !== "string" || !ENDUNGEN.includes(endung)) {
        throw new JobFailure("invalid_input", "endung ist keine Rasterendung", false);
    }
    return { bild, endung };
}

type Ergebnis = { zustand: "bereit"; grund: null } | { zustand: "abgewiesen"; grund: string };

/** Rendert und legt ab; die Abweisung der Pipeline ist ein Ergebnis, kein Fehler des Jobs. */
async function rendere(store: MediaStore, input: KanalBildInput, context: JobContext): Promise<Ergebnis> {
    await context.beginPhase("read", 0);
    let bytes: Uint8Array;
    try {
        bytes = await store.read(channelKey(input.bild, "original", input.endung), MAX_SOURCE_BYTES);
    } catch (error) {
        if (error instanceof MediaStorageError && (error.code === "missing" || error.code === "too_large")) {
            return { zustand: "abgewiesen", grund: error.code === "missing" ? "source_missing" : "too_large_bytes" };
        }
        throw error;
    }
    try {
        await context.beginPhase("inspect", 0.2);
        const inspection = inspectImage(bytes);
        if (inspection.format === "svg")
            throw new RasterRejection("unsupported_format", "Ein Bildschirmfoto ist nie ein SVG");
        await context.beginPhase("render", 0.4);
        const ansicht = await renderRaster(bytes, inspection, CHANNEL_PROFILES.ansicht);
        const vorschau = await renderRaster(bytes, inspection, CHANNEL_PROFILES.vorschau);
        await context.beginPhase("store", 0.8);
        await store.storeChannel(input.bild, "ansicht", ansicht.bytes, "webp");
        await store.storeChannel(input.bild, "vorschau", vorschau.bytes, "webp");
        return { zustand: "bereit", grund: null };
    } catch (error) {
        if (error instanceof RasterRejection) return { zustand: "abgewiesen", grund: error.code };
        throw error;
    }
}

export async function runKanalBild(context: JobContext): Promise<Record<string, unknown>> {
    const input = parseKanalBildInput(context.input);
    const root = process.env["MEDIA_ROOT"];
    if (root === undefined || root === "")
        throw new JobFailure("media_root_missing", "MEDIA_ROOT ist nicht gesetzt", false);
    const ergebnis = await rendere(new MediaStore(root), input, context);
    await withJobDatabase(async (database) => {
        await database`SELECT avesmaps_kanal.kanal_bild_fertig(${input.bild}::uuid, ${ergebnis.zustand}, ${ergebnis.grund})`;
    });
    return { bild: input.bild, ...ergebnis };
}
