import type { MediaEvidenceType, MediaFileUpload } from "@avesmaps3d/shared";
import { ApiError } from "../http/api-error.ts";
import { sniffFormat } from "../media/raster/inspect.ts";
import { RASTER_LIMITS } from "../media/raster/limits.ts";
import { sha256Of, type MediaStore } from "../media/storage.ts";

/**
 * Dateien aus der Anfrage (WI-0068 P4a): Base64 lesen und eine Belegdatei prüfen. Ein Beleg ist privat und hat nie eine Adresse
 * (`private/evidence/`); angenommen werden PDF, Rasterbilder und reiner UTF-8-Text (eine Mail als Text). Das Format kommt aus den
 * Bytes, nie aus dem Namen. Abgewiesen wird, was ausführbar sein könnte oder als Seite gelesen würde: jede andere Binärdatei, HTML,
 * SVG, Text mit Steuerzeichen.
 */

/** Base64 der Anfrage in Bytes. Das Schema hat die Zeichen schon geprüft; leer ist hier ein Fehler der Anfrage. */
export function decodeBase64(file: MediaFileUpload, path: string): Buffer {
    const bytes = Buffer.from(file.dataBase64, "base64");
    if (bytes.byteLength === 0) {
        throw new ApiError(400, "validation_failed", "Die Datei ist leer.", { issues: [{ path, rule: "required" }] });
    }
    return bytes;
}

/** Der Dateiname nur zur Anzeige: ohne Pfad, ohne Steuerzeichen, höchstens 255 Zeichen (Migration 0086). */
export function displayFilename(name: string): string | null {
    // eslint-disable-next-line no-control-regex -- genau darum geht es: Steuerzeichen aus einem Namen
    const plain = name.replace(/[\u0000-\u001f\u007f/\\]/gu, "").trim();
    return plain === "" ? null : plain.slice(0, 255);
}

export interface DecodedEvidence {
    bytes: Buffer;
    sha256: string;
    type: MediaEvidenceType;
    extension: string;
}

const RASTER_EXTENSION = { png: "png", jpeg: "jpg", gif: "gif", webp: "webp" } as const;
const RASTER_TYPE = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as const;

/** Reiner Text: gültiges UTF-8, keine Steuerzeichen außer Tab und Zeilenwechsel, keine Seite (HTML, SVG, Skript). */
function isPlainText(bytes: Buffer): boolean {
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return false;
    }
    // eslint-disable-next-line no-control-regex -- genau darum geht es: Steuerzeichen in einem Text
    if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/u.test(text)) return false;
    return !/<\s*(script|html|svg|!doctype|iframe|object)\b/iu.test(text);
}

function sniffEvidence(bytes: Buffer): { type: MediaEvidenceType; extension: string } | null {
    if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { type: "application/pdf", extension: "pdf" };
    const raster = sniffFormat(bytes);
    if (raster !== null && raster !== "svg") return { type: RASTER_TYPE[raster], extension: RASTER_EXTENSION[raster] };
    if (raster === null && isPlainText(bytes)) return { type: "text/plain", extension: "txt" };
    return null;
}

/** Prüft eine Belegdatei aus der Anfrage: Größe wie ein Rasterbild (D2), Format aus den Bytes. */
export function decodeEvidenceFile(file: MediaFileUpload, path = "evidence.file"): DecodedEvidence {
    const bytes = decodeBase64(file, path);
    if (bytes.byteLength > RASTER_LIMITS.maxRasterBytes) {
        throw new ApiError(413, "payload_too_large", "Der Beleg ist zu groß.", {
            reason: "too_large_bytes",
            limitBytes: RASTER_LIMITS.maxRasterBytes,
        });
    }
    const sniffed = sniffEvidence(bytes);
    if (sniffed === null) {
        throw new ApiError(415, "unsupported_media_type", "Als Beleg gehen PDF, Bild oder reiner Text.", {
            reason: "unsupported_format",
        });
    }
    return { bytes, sha256: sha256Of(bytes), ...sniffed };
}

/** Legt den Beleg ab (vor der Datenbankzeile; ein unreferenzierter Hash ist aufräumbar). */
export async function storeEvidence(
    store: MediaStore,
    decoded: DecodedEvidence,
): Promise<{ key: string; sha256: string }> {
    const stored = await store.storeEvidence(decoded.bytes, decoded.extension);
    return { key: stored.key, sha256: stored.sha256 };
}
