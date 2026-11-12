import type { DerivedWork } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import type { TechnicalState } from "../media/policy.ts";
import { FORMAT_MIME, RasterRejection, inspectImage, type RasterInspection } from "../media/raster/inspect.ts";
import { PDF_LIMITS } from "../media/raster/limits.ts";
import { rasterizePdfFirstPage } from "../media/raster/pdf.ts";
import type { RenderProfile } from "../media/raster/profiles.ts";
import { renderRaster } from "../media/raster/render.ts";
import type { MediaStore } from "../media/storage.ts";
import type { KartenvorschauInput } from "./kartensammlung-vorschau.ts";
import { enqueueSettle, leseQuelle } from "./settle.ts";

/**
 * Der Kern der Jobart `citymap_preview_generate` (WI-0287 Punkt 5, `jobs/kartenvorschau-job.ts`): aus der Karte, aus der eine Vorschau erzeugt wurde
 * (`media_asset.generated_from_asset_id`), das ORIGINAL der Vorschau rechnen und wie ein Upload ablegen (`private_source`). Danach reiht er den gewöhnlichen Abgleich ein
 * (`media_settle`, Rolle `map_preview`), der die Fassung nach dem Profil `citymap_preview` rechnet und nach der Policy veröffentlicht oder privat hält.
 *
 * 🔴 Im Worker, nie im Fastify-Prozess (wie `media_settle`): Die Operation hat nur Werk, Rechte und Bindung angelegt.
 * - Die Bytes der Karte kommen wie im Abgleich (`leseQuelle`): das Original gegen seinen Hash, bei einem gelöschten Original eines Kartenvorschlags der Master. Bei einem
 *   PDF die erste Seite, gerastert wie in der Pipeline (`media/raster/ingest.ts`, `rasterizePdfFirstPage`).
 * - **Format des Originals der Vorschau:** WebP verlustbehaftet, Qualität 90, lange Kante höchstens 1200 px (nie vergrößert, kein Zuschnitt; `KARTENVORSCHAU_QUELLE`).
 *   Begründung: Das Profil `citymap_preview` will 400 px; 1200 px lassen das Dreifache als Reserve für ein schärferes Rezept (eine neue Revision des Profils rechnet aus
 *   diesem Original, ohne neu zu erzeugen). WebP schreibt und liest dieselbe Bibliothek (sharp), die die Pipeline schon nimmt; q90 hält den zweiten verlustbehafteten
 *   Schritt (q80 im Profil) sauber. Ein PNG dieser Größe hätte bei einer bunten Karte mehrere MB; das WebP bleibt weit unter den 6 MiB, die der Abgleich für ein
 *   Original der Vorschau annimmt. Keine Metadaten (der Render schreibt weder EXIF noch ICC).
 * - Fehlt die Datei der Karte oder lässt sie sich nicht lesen, endet der Job mit dem Code (`source_missing`, `decode_failed` …, nicht wiederholbar) und die Vorschau trägt
 *   den technischen Zustand (`missing_file` …): Sie bleibt sichtbar und sagt, was fehlt.
 * - Reihenfolge wie überall: erst die Bytes, dann die Zeilen in der Transaktion, die den Job abschließt (`commit`, gegen eine fremde Lease geschützt).
 * - Wiederholbar: Hat die Vorschau schon ein Original (ein zweiter Lauf), wird nichts neu gerechnet, nur der Abgleich noch einmal eingereiht.
 */

export const KARTENVORSCHAU_QUELLE: RenderProfile = {
    variant: "kartenvorschau_quelle",
    revision: 1,
    geometry: { kind: "fit_inside", longEdge: 1200 },
    svgLongEdge: 1200,
    encoding: { mode: "lossy", quality: 90 },
};

export interface KartenvorschauErgebnis {
    kind: "citymap_preview_generate";
    asset: string;
    karte: string | null;
    /** Das abgelegte Original der Vorschau (Hash, Maße, Größe); `null`: nichts gerechnet (schon da oder abgebrochen). */
    source: { sha256: string; width: number; height: number; byteSize: number } | null;
    /** Der eingereihte Abgleich. */
    settle: DerivedWork | null;
    findings: string[];
}

/** Ein Befund, mit dem der Job endet: Der technische Zustand der Vorschau ist schon geschrieben. */
export class KartenvorschauAbbruch extends Error {
    readonly code: string;
    readonly technicalState: TechnicalState;
    constructor(code: string, message: string, technicalState: TechnicalState) {
        super(message);
        this.name = "KartenvorschauAbbruch";
        this.code = code;
        this.technicalState = technicalState;
    }
}

/** Abschluss: die Zeilen in der Transaktion, die den Job abschließt (`completeJob`); in Tests eine eigene. */
export type KartenvorschauCommit = (
    write: (tx: Queryable) => Promise<void>,
    result: KartenvorschauErgebnis,
) => Promise<"ok" | "fenced">;

const eigeneTransaktion =
    (database: Database): KartenvorschauCommit =>
    async (write) => {
        await database.begin((tx) => write(tx));
        return "ok";
    };

interface VorschauZeile {
    id: string;
    public_id: string;
    technical_state: TechnicalState;
    hat_original: boolean;
    karte_id: string | null;
    karte: string | null;
    source_key: string | null;
    source_sha256: string | null;
    source_deleted_at: Date | null;
}

/** Den technischen Zustand der Vorschau setzen, nur solange sie noch kein Original hat (ein späterer Lauf hätte es schon geschrieben). */
async function setzeZustand(database: Database, vorschauId: string, zustand: TechnicalState): Promise<void> {
    await database`
        UPDATE media_asset SET technical_state = ${zustand}, updated_at = now()
         WHERE id = ${vorschauId}::bigint
           AND NOT EXISTS (SELECT 1 FROM media_file WHERE media_asset_id = ${vorschauId}::bigint AND storage_class = 'private_source')
    `;
}

/** Das Raster der Karte: ein Bild wie es ist, ein PDF als seine erste Seite (wie `ingestImage`). */
async function rasterDerKarte(
    bytes: Uint8Array,
): Promise<{ pixel: Uint8Array; inspection: RasterInspection; findings: string[] }> {
    const inspection = inspectImage(bytes, { allowPdf: true, maxRasterBytes: PDF_LIMITS.maxBytes });
    if (inspection.format !== "pdf") return { pixel: bytes, inspection, findings: [] };
    const page = await rasterizePdfFirstPage(bytes);
    return {
        pixel: page.png,
        inspection: {
            format: "png",
            mimeType: FORMAT_MIME.png,
            byteSize: page.png.byteLength,
            width: page.width,
            height: page.height,
            alpha: false,
            findings: [],
        },
        findings: page.pageCount > 1 ? ["pdf_first_page_only"] : [],
    };
}

export async function rechneKartenvorschau(
    database: Database,
    store: MediaStore,
    input: KartenvorschauInput,
    commit: KartenvorschauCommit = eigeneTransaktion(database),
    onStep: (step: "read" | "render" | "store") => Promise<void> | void = () => undefined,
): Promise<KartenvorschauErgebnis> {
    const [vorschau] = await database<VorschauZeile[]>`
        SELECT v.id::text AS id, v.public_id::text AS public_id, v.technical_state,
               EXISTS (SELECT 1 FROM media_file o WHERE o.media_asset_id = v.id AND o.storage_class = 'private_source') AS hat_original,
               k.id::text AS karte_id, k.public_id::text AS karte,
               f.storage_key AS source_key, f.sha256 AS source_sha256, f.bytes_deleted_at AS source_deleted_at
          FROM media_asset v
          LEFT JOIN media_asset k ON k.id = v.generated_from_asset_id
          LEFT JOIN media_file f ON f.media_asset_id = k.id AND f.storage_class = 'private_source'
         WHERE v.public_id = ${input.asset}::uuid
    `;
    const ergebnis: KartenvorschauErgebnis = {
        kind: "citymap_preview_generate",
        asset: input.asset,
        karte: vorschau?.karte ?? null,
        source: null,
        settle: null,
        findings: [],
    };
    if (vorschau === undefined) {
        throw new KartenvorschauAbbruch("asset_missing", "Die Vorschau gibt es nicht (mehr).", "missing_file");
    }
    const abgleich = async (tx: Queryable): Promise<void> => {
        ergebnis.settle = await enqueueSettle(tx, {
            assetPublicId: vorschau.public_id,
            role: "map_preview",
            actorPersonId: input.actor,
        });
    };
    // Ein zweiter Lauf: Das Original liegt schon da, nur der Abgleich wird noch einmal eingereiht.
    if (vorschau.hat_original) {
        ergebnis.findings.push("source_present");
        await commit(abgleich, ergebnis);
        return ergebnis;
    }
    if (vorschau.karte_id === null) {
        await setzeZustand(database, vorschau.id, "missing_file");
        throw new KartenvorschauAbbruch(
            "source_unlinked",
            "Die Vorschau kennt ihre Karte nicht mehr; es gibt nichts zu rechnen.",
            "missing_file",
        );
    }

    await onStep("read");
    const { bytes } = await leseQuelle(database, store, {
        id: vorschau.karte_id,
        source_key: vorschau.source_key,
        source_sha256: vorschau.source_sha256,
        source_deleted_at: vorschau.source_deleted_at,
    });
    if (bytes === null) {
        await setzeZustand(database, vorschau.id, "missing_file");
        throw new KartenvorschauAbbruch(
            "source_missing",
            "Die Datei der Karte fehlt; die Vorschau bleibt ohne Bild.",
            "missing_file",
        );
    }

    await onStep("render");
    let gerechnet: Awaited<ReturnType<typeof renderRaster>>;
    try {
        const raster = await rasterDerKarte(bytes);
        ergebnis.findings.push(...raster.findings);
        gerechnet = await renderRaster(raster.pixel, raster.inspection, KARTENVORSCHAU_QUELLE);
    } catch (error) {
        if (!(error instanceof RasterRejection)) throw error;
        await setzeZustand(database, vorschau.id, error.technicalState);
        throw new KartenvorschauAbbruch(error.code, error.message, error.technicalState);
    }

    await onStep("store");
    const abgelegt = await store.store("private_source", gerechnet.bytes, "webp");
    ergebnis.source = {
        sha256: abgelegt.sha256,
        width: gerechnet.width,
        height: gerechnet.height,
        byteSize: abgelegt.byteSize,
    };
    await commit(async (tx) => {
        await tx`SELECT 1 FROM media_asset WHERE id = ${vorschau.id}::bigint FOR UPDATE`;
        const [schon] = await tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_file WHERE media_asset_id = ${vorschau.id}::bigint AND storage_class = 'private_source'
        `;
        if ((schon?.n ?? 0) === 0) {
            await tx`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                VALUES (${vorschau.id}::bigint, 'source', 'private_source', ${abgelegt.key}, ${gerechnet.mimeType}, ${gerechnet.width},
                        ${gerechnet.height}, ${abgelegt.byteSize}, ${abgelegt.sha256})
            `;
        }
        await abgleich(tx);
    }, ergebnis);
    return ergebnis;
}
