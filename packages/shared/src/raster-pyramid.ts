import { Type, type Static } from "@sinclair/typebox";
import { checkPointer, readPointer } from "./pointer-reading.ts";

/**
 * Der Zeiger einer Kartenserie auf ihre ausgelieferte Rasterpyramide (ADR-0008).
 *
 * Jede Pyramide liegt unter ihrer **Revision**, und unter einer Revision ändert sich nie wieder ein
 * Byte - deshalb dürfen ihre Kacheln `immutable` ausgeliefert werden. Welche Revision gilt, sagt
 * allein `/tiles/raster/<serie>/current.json`, ausgeliefert mit `no-cache`. Ein Pyramidenneubau
 * braucht so keinen Frontend-Deploy: neue Revision ablegen, Zeiger ersetzen, die Karte folgt beim
 * nächsten Laden.
 *
 * 💣 Unter einem FESTEN Pfad war `immutable` eine Lüge: nach einem Neubau hätte ein Besucher einen
 * Tag lang kachelweise alten und neuen Stand gemischt gesehen, ohne jeden Fehler.
 */

/**
 * Die ersten 12 Hexzeichen des SHA-256 über das Manifest der Pyramide
 * (`scripts/dev/tile-manifest.ps1`). Derselbe Inhalt ergibt dieselbe Revision, jeder andere eine
 * neue - das Verzeichnis prüft sich damit selbst.
 */
export const RASTER_REVISION_PATTERN = "^[0-9a-f]{12}$";

export const RasterPyramidPointer = Type.Object(
    {
        schemaVersion: Type.Literal(1),
        /** Die Serie, zu der der Zeiger gehört. Ein falsch kopierter Zeiger fällt so auf. */
        series: Type.String({ minLength: 1 }),
        revision: Type.String({ pattern: RASTER_REVISION_PATTERN }),
        /**
         * Der volle SHA-256 des Manifests, dessen Anfang die Revision ist. Claudio prüft damit nach
         * dem Ausrollen in einem Aufruf, dass die ausgelieferte Revision genau die gebaute ist.
         */
        manifest: Type.String({ pattern: "^[0-9a-f]{64}$" }),
        format: Type.Literal("webp"),
        tileSize: Type.Integer({ exclusiveMinimum: 0 }),
        /** Darüber skaliert der Renderer hoch, wie die Legacy-Karte es auch tat. */
        maxNativeZoom: Type.Integer({ minimum: 0 }),
    },
    { $id: "RasterPyramidPointer", additionalProperties: false },
);

export type RasterPyramidPointer = Static<typeof RasterPyramidPointer>;

/** Wo der Zeiger einer Serie liegt. */
export function rasterPointerUrl(seriesId: string): string {
    return `/tiles/raster/${seriesId}/current.json`;
}

/** Die Kachelvorlage der Revision, auf die der Zeiger zeigt. */
export function rasterTileTemplate(pointer: RasterPyramidPointer): string {
    return `/tiles/raster/${pointer.series}/${pointer.revision}/{z}/{x}/{y}.${pointer.format}`;
}

/**
 * Die Prüfungen über das Schema hinaus, für den strengen und den toleranten Leser gleich.
 *
 * 🪤 Ein Zeiger, der zu einer ANDEREN Serie gehört, ist ein Fehler und kein Zeiger: sonst zeigte der
 * Umschalter „Modern" und die Karte das Original, ohne dass irgendetwas meldet.
 */
function assertRasterPointerConsistent(candidate: RasterPyramidPointer, seriesId: string): RasterPyramidPointer {
    if (candidate.series !== seriesId) {
        throw new Error(`der Rasterzeiger für ${seriesId} gehört zur Serie ${candidate.series}`);
    }
    // 🪤 Von Hand nachgezogen, stimmen Revision und Manifest leicht nicht mehr überein - dann ist
    // unklar, welche Pyramide gemeint war, und geraten wird nicht.
    if (!candidate.manifest.startsWith(candidate.revision)) {
        throw new Error(
            `der Rasterzeiger für ${seriesId} nennt Revision ${candidate.revision}, sein Manifest aber nicht`,
        );
    }
    return candidate;
}

/**
 * Streng: prüft einen Zeiger und gibt ihn typisiert zurück (jedes Feld, das das Schema nicht kennt, ist ein Fehler).
 * Der Client liest mit `readRasterPointer` (WI-0075 R5b, `pointer-reading.ts`).
 */
export function parseRasterPointer(candidate: unknown, seriesId: string): RasterPyramidPointer {
    return assertRasterPointerConsistent(
        checkPointer(RasterPyramidPointer, candidate, `Rasterzeiger für ${seriesId}`),
        seriesId,
    );
}

/** Tolerant: der Client liest den Zeiger und ignoriert Felder, die eine neuere Version des Servers dazugibt. */
export function readRasterPointer(candidate: unknown, seriesId: string): RasterPyramidPointer {
    return assertRasterPointerConsistent(
        readPointer(RasterPyramidPointer, candidate, `Rasterzeiger für ${seriesId}`),
        seriesId,
    );
}
