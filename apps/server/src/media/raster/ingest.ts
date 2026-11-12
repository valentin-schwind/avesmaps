import type { MediaRole } from "@avesmaps3d/shared";
import { internVariante } from "../roles.ts";
import { sha256Of, storageKey, type MediaStore, type StorageClass } from "../storage.ts";
import { FORMAT_EXTENSION, FORMAT_MIME, inspectImage, type MediaFinding, type RasterFormat } from "./inspect.ts";
import { rasterizePdfFirstPage } from "./pdf.ts";
import { beifassungen, profileForAsset, type RasterProfile } from "./profiles.ts";
import { recipeVersion, renderRaster } from "./render.ts";
import { wahrnehmungsHash } from "./wahrnehmung.ts";

/**
 * Die Aufnahme eines Bildes (WI-0063 26.20 MEDIA-3): Vorprüfung, Rendern in das Profil der Rolle, dann Speichern: das
 * private Original unter `private/source` und die öffentliche WebP-Datei unter `published/sha256/…`.
 *
 * 🔴 Reihenfolge: erst prüfen und rendern, nichts geschrieben; dann das Original, dann das Derivat. Eine abgewiesene Datei
 * hinterlässt nichts im Speicher; schlägt das Derivat fehl, bleibt das Original (authoritativ, ein unreferenzierter Hash
 * ist aufräumbar). Eine Datenbankzeile entsteht hier NIE: Hash, Größe und Maße stehen im Ergebnis für die spätere
 * `media_file`-Zeile (Metadatenimport MEDIA-M8 bis M10, später WI-0068), und die Datenbanktransaktion folgt den Bytes.
 *
 * 🔴 `publish` heißt: die Veröffentlichungsentscheidung (`policy.ts`) hat für diese Rolle JA gesagt. Nur dann entsteht eine
 * Datei unter `published/`, denn Nginx liefert `/media/` aus diesem Baum aus (`media.yaml` → `storage`: „nur freigegebene
 * Dateien“). Ohne Freigabe wird das Bild trotzdem vollständig gerendert (ein nicht dekodierbares Bild fällt auf), aber nichts
 * Öffentliches geschrieben; das Derivat ist aus Quelle und Rezept jederzeit reproduzierbar.
 *
 * 🔴 Die private Vorschau (WI-0068 P4b, geschützter Bildweg): Entsteht keine öffentliche Datei und bittet der Aufrufer darum
 * (`preview`), legt die Aufnahme dieselbe gerechnete
 * Fassung als `derivative` unter `derivatives/` ab, Variante `intern_<variante>`. Editoren sehen das Bild darüber in der Medienverwaltung
 * (`GET …/media/:id/vorschau`, nur `view_media_private`), nie die Bytes des Originals (EXIF, Ort der Aufnahme). Sie ist kein Weg nach
 * draußen: Nginx liefert nur `published/` aus.
 */

export { internVariante };

export interface IngestedFile {
    /** `source` oder der Variantenname der Rolle (`coat`, `header_16_9`, …). */
    variant: string;
    storageClass: StorageClass;
    /** Relativ zur Medienwurzel, aus Klasse und SHA-256 abgeleitet. */
    key: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    byteSize: number;
    sha256: string;
    /** Rezeptname und -version des Derivats; `null` beim Original. */
    derivativeRecipe: string | null;
    recipeVersion: string | null;
    /** `false`: unter dem Schlüssel lagen dieselben Bytes schon (physische Deduplizierung), nichts wurde geschrieben. */
    written: boolean;
}

export interface IngestResult {
    format: RasterFormat;
    source: IngestedFile;
    /** Leer, wenn die Rolle nicht freigegeben ist (`publish: false`); sonst die Hauptfassung zuerst, danach die Beifassungen der Rolle (das Reisebild: die Kachel). */
    derivatives: IngestedFile[];
    /** Die private Vorschau, wenn keine öffentliche Datei entstand (sonst `undefined`): dieselbe Fassung, Klasse `derivative`. */
    preview: IngestedFile | undefined;
    /**
     * Bei einem Wappen: Sind die Ecken des Originals durchsichtig (WI-0068 P4b T2b, Spalte `media_file.corners_transparent`)? Hält nur
     * fest; über die Veröffentlichung entscheidet sie nur beim Wappen aus dem Editor. Sonst `undefined`.
     */
    corners: boolean | undefined;
    /**
     * Der Wahrnehmungs-Hash des Originals (WI-0068 D2, `wahrnehmung.ts`, Spalte `media_file.perceptual_hash`): hält nur fest. `undefined`,
     * wenn er sich nicht rechnen ließ (Befund `perceptual_hash_failed`); die Aufnahme gilt trotzdem.
     */
    perceptualHash: string | undefined;
    findings: MediaFinding[];
}

export interface IngestRequest {
    bytes: Uint8Array;
    role: MediaRole;
    publish: boolean;
    /**
     * Ein Wappen aus dem Editor (WI-0068 P4b): zum Quadrat aufgefüllt, und nur mit durchsichtigen Ecken veröffentlicht (Befund
     * `coat_not_transparent` sonst, die Datei bleibt privat). Der Bestand aus Legacy bleibt beim Profil der Rolle.
     */
    editorCoat?: boolean;
    /**
     * Die private Vorschau ablegen, wenn nichts öffentlich wird (WI-0068 P4b). Nur wer auch die Zeile `media_file` schreibt, bittet
     * darum (Abgleich, Binärimport); `media_derive` schreibt keine Zeilen und legt deshalb keine Vorschau ab.
     */
    preview?: boolean;
    /** Eine größere Grenze für Rasterdateien (WI-0275: Kartenvorschläge bis 50 MiB); ohne sie gilt die 6-MiB-Grenze der Medienverwaltung (D2). */
    maxRasterBytes?: number;
    /**
     * `false`: Die Bytes kommen nicht aus einem Original, sondern aus dem Master eines Werks, dessen Original gelöscht ist (WI-0275, `media-editor/settle.ts`). Unter
     * `private/source` entsteht dann nichts; `source` im Ergebnis beschreibt nur die Eingabe und hat keine Datei. Vorgabe: ablegen.
     */
    quelleAblegen?: boolean;
}

/** Die Rollen der Kartensammlung dürfen ein PDF als Quelle haben (WI-0275); alle anderen Rollen nehmen nur Bilder an. */
export const PDF_ROLES: ReadonlySet<MediaRole> = new Set<MediaRole>(["map_full", "map_preview"]);

export type IngestStep = "inspect" | "render" | "store";

/** Die Aufnahme in Schritten; `onStep` meldet den Beginn jedes Schrittes (der Job zeichnet daraus seine Phasen auf). */
export async function ingestImage(
    store: MediaStore,
    request: IngestRequest,
    onStep: (step: IngestStep) => Promise<void> | void = () => undefined,
): Promise<IngestResult> {
    const profile: RasterProfile = profileForAsset(request.role, { editorCoat: request.editorCoat === true });

    await onStep("inspect");
    const inspection = inspectImage(request.bytes, {
        allowPdf: PDF_ROLES.has(request.role),
        ...(request.maxRasterBytes === undefined ? {} : { maxRasterBytes: request.maxRasterBytes }),
    });

    await onStep("render");
    // Ein PDF (Kartenquelle, WI-0275) bleibt als Original privat; seine erste Seite wird zum PNG gerastert und läuft wie ein Bild durch
    // das Profil der Rolle. Maße, Hash und Derivat kommen aus dem Raster, das Original behält Bytes und Typ des PDF.
    let pixelBytes: Uint8Array = request.bytes;
    let pixelInspection = inspection;
    const pdfFindings: MediaFinding[] = [];
    if (inspection.format === "pdf") {
        const page = await rasterizePdfFirstPage(request.bytes);
        pixelBytes = page.png;
        // Das Raster ist von uns erzeugt und schon in den Maßen begrenzt (4096 px, 16 MP); die 6-MiB-Grenze der Hochladenden gilt nicht für es.
        pixelInspection = {
            format: "png",
            mimeType: FORMAT_MIME.png,
            byteSize: page.png.byteLength,
            width: page.width,
            height: page.height,
            alpha: false,
            findings: [],
        };
        if (page.pageCount > 1) {
            pdfFindings.push({
                code: "pdf_first_page_only",
                detail: `${String(page.pageCount)} Seiten, gerastert wird Seite 1`,
            });
        }
    }
    const rendered = await renderRaster(pixelBytes, pixelInspection, profile, { corners: request.role === "coat" });

    await onStep("store");
    const stored =
        request.quelleAblegen === false
            ? {
                  key: storageKey("private_source", sha256Of(request.bytes), FORMAT_EXTENSION[inspection.format]),
                  byteSize: request.bytes.byteLength,
                  sha256: sha256Of(request.bytes),
                  written: false,
              }
            : await store.store("private_source", request.bytes, FORMAT_EXTENSION[inspection.format]);
    const source: IngestedFile = {
        variant: "source",
        storageClass: "private_source",
        key: stored.key,
        mimeType: inspection.mimeType,
        width: pixelInspection.width,
        height: pixelInspection.height,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        derivativeRecipe: null,
        recipeVersion: null,
        written: stored.written,
    };

    const derivatives: IngestedFile[] = [];
    const findings = [...inspection.findings, ...pdfFindings];
    // Der Wahrnehmungs-Hash ist eine Zugabe: Scheitert er, gilt die Aufnahme trotzdem (Befund), nichts wird abgewiesen.
    const perceptualHash = await wahrnehmungsHash(pixelBytes, inspection.format === "pdf" ? "png" : undefined).catch(
        (error: unknown) => {
            findings.push({
                code: "perceptual_hash_failed",
                detail: error instanceof Error ? error.message.slice(0, 160) : "unbekannt",
            });
            return undefined;
        },
    );
    if (rendered.transparentCorners === false) {
        findings.push({
            code: "coat_not_transparent",
            detail: "die Ecken des Wappens sind nicht durchsichtig; es bleibt privat",
        });
    }
    if (request.publish && rendered.transparentCorners !== false) {
        const published = await store.store("published", rendered.bytes, "webp");
        derivatives.push({
            variant: profile.variant,
            storageClass: "published",
            key: published.key,
            mimeType: rendered.mimeType,
            width: rendered.width,
            height: rendered.height,
            byteSize: published.byteSize,
            sha256: published.sha256,
            derivativeRecipe: profile.variant,
            recipeVersion: recipeVersion(profile),
            written: published.written,
        });
        // Die Beifassungen der Rolle (das Reisebild: die Kachel, WI-0272 S4) entstehen aus denselben Bytes, gleich nach der Hauptfassung; `derivatives[0]` bleibt diese.
        for (const beifassung of beifassungen(request.role)) {
            const zweite = await renderRaster(request.bytes, inspection, beifassung);
            const abgelegt = await store.store("published", zweite.bytes, "webp");
            derivatives.push({
                variant: beifassung.variant,
                storageClass: "published",
                key: abgelegt.key,
                mimeType: zweite.mimeType,
                width: zweite.width,
                height: zweite.height,
                byteSize: abgelegt.byteSize,
                sha256: abgelegt.sha256,
                derivativeRecipe: beifassung.variant,
                recipeVersion: recipeVersion(beifassung),
                written: abgelegt.written,
            });
        }
    }
    let preview: IngestedFile | undefined;
    if (request.preview === true && derivatives.length === 0) {
        // Die Vorschau ist eine Zugabe: Darf der Prozess nicht nach derivatives/ schreiben, bleibt sie aus (Befund), die Prüfung gilt.
        const intern = await store.store("derivative", rendered.bytes, "webp").catch((error: unknown) => {
            if (!["EACCES", "EPERM", "EROFS"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
            findings.push({ code: "private_preview_not_stored", detail: "derivatives/ ist nicht beschreibbar" });
            return undefined;
        });
        if (intern !== undefined) {
            preview = {
                variant: internVariante(profile.variant),
                storageClass: "derivative",
                key: intern.key,
                mimeType: rendered.mimeType,
                width: rendered.width,
                height: rendered.height,
                byteSize: intern.byteSize,
                sha256: intern.sha256,
                derivativeRecipe: profile.variant,
                recipeVersion: recipeVersion(profile),
                written: intern.written,
            };
        }
    }
    return {
        format: inspection.format,
        source,
        derivatives,
        preview,
        corners: rendered.corners,
        perceptualHash,
        findings,
    };
}
