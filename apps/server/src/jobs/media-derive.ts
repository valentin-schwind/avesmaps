import { MEDIA_ROLES, type MediaRole } from "@avesmaps3d/shared";
import { FORMAT_EXTENSION, RasterRejection } from "../media/raster/inspect.ts";
import { ingestImage, type IngestedFile } from "../media/raster/ingest.ts";
import { MAX_SOURCE_BYTES } from "../media/raster/limits.ts";
import {
    INCOMING_DIRECTORY,
    MediaStorageError,
    MediaStore,
    sha256Of,
    storageKey,
    type StorageClass,
} from "../media/storage.ts";
import { JobFailure, type JobContext } from "./handlers.ts";

/**
 * Die Jobart `media_derive` (WI-0063 MEDIA-M7, JOBS-0001): ein Bild prüfen, in das Profil seiner Rolle rendern und ablegen
 * (`media/raster/ingest.ts`). Sie läuft in der Queue, nicht im Fastify-Prozess und in keiner eigenen Unit (Claudio,
 * `handovers/2026-10-04-media-m7-sharp-antwort.md`, Frage 4): EINE Speichergrenze für alle Hintergrundarbeit, und die Zulassung
 * verhindert, dass ein Bildauftrag neben der Geländeableitung läuft.
 *
 * Eingabe (`input_ref`, klein: Verweise, nie Bytes):
 *   - `role`: eine Rolle aus `MEDIA_ROLES` (wählt das Profil);
 *   - `publish`: Pflicht. `true` nur, wenn die Veröffentlichungsentscheidung (`policy.ts`) für diese Rolle JA gesagt hat;
 *   - die Quelle, genau eine von zwei:
 *       `incoming`: Schlüssel unter `incoming/` (ein Upload, untrusted; der Aufrufer legt ihn dort ab),
 *       `sourceSha256` und `sourceExtension`: ein schon abgelegtes Original unter `private/source` (neu rendern, etwa nach
 *       einer Rezeptänderung oder nach einer Freigabe).
 *
 * Ergebnis (klein): `format`, `source`, `derivatives` (Hash, Größe, Maße, Schlüssel für die spätere `media_file`-Zeile),
 * `findings`. Eine abgewiesene Datei endet mit dem Code der Abweisung (`too_many_pixels`, `svg_has_text`, …), nie wiederholt.
 *
 * 🔴 Kein Schreibpfad in die Datenbank: der Job legt Dateien ab und meldet. `MEDIA_ROOT` kommt aus der Umgebung des Workers.
 */

type SourceRef = { kind: "incoming"; key: string } | { kind: "stored"; sha256: string; extension: string };

export interface MediaDeriveInput {
    role: MediaRole;
    publish: boolean;
    source: SourceRef;
}

const invalid = (message: string): JobFailure => new JobFailure("invalid_input", message, false);

const SOURCE_EXTENSIONS: readonly string[] = Object.values(FORMAT_EXTENSION);
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Ein Upload liegt direkt unter `incoming/`; kein Unterverzeichnis, kein Pfad. */
const INCOMING_KEY = new RegExp(`^${INCOMING_DIRECTORY}/[A-Za-z0-9._-]{1,128}$`);

export function parseMediaDeriveInput(raw: Record<string, unknown>): MediaDeriveInput {
    const role = raw["role"];
    if (typeof role !== "string" || !(MEDIA_ROLES as readonly string[]).includes(role)) {
        throw invalid("role fehlt oder ist keine bekannte Rolle");
    }
    if (typeof raw["publish"] !== "boolean") {
        throw invalid("publish ist Pflicht (true nur nach der Veröffentlichungsentscheidung)");
    }
    const incoming = raw["incoming"];
    const sha256 = raw["sourceSha256"];
    const extension = raw["sourceExtension"];
    if (incoming !== undefined && sha256 !== undefined)
        throw invalid("entweder incoming oder sourceSha256, nicht beides");
    let source: SourceRef;
    if (typeof incoming === "string") {
        if (!INCOMING_KEY.test(incoming)) throw invalid("incoming ist kein Schlüssel direkt unter incoming/");
        source = { kind: "incoming", key: incoming };
    } else if (typeof sha256 === "string" && typeof extension === "string") {
        if (!SHA256_HEX.test(sha256)) throw invalid("sourceSha256 ist keine SHA-256 in Kleinschreibung");
        if (!SOURCE_EXTENSIONS.includes(extension)) throw invalid("sourceExtension ist keine bekannte Endung");
        source = { kind: "stored", sha256, extension };
    } else {
        throw invalid("Quelle fehlt: incoming oder sourceSha256 mit sourceExtension");
    }
    return { role: role as MediaRole, publish: raw["publish"], source };
}

async function readSource(store: MediaStore, source: SourceRef): Promise<Uint8Array> {
    try {
        if (source.kind === "incoming") return await store.read(source.key, MAX_SOURCE_BYTES);
        const storageClass: StorageClass = "private_source";
        const bytes = await store.read(storageKey(storageClass, source.sha256, source.extension), MAX_SOURCE_BYTES);
        // Ein Original, dessen Bytes nicht mehr zu seinem Namen passen, ist beschädigt: nichts darf daraus entstehen.
        if (sha256Of(bytes) !== source.sha256) {
            throw new JobFailure("source_corrupt", "Das abgelegte Original passt nicht mehr zu seiner SHA-256", false);
        }
        return bytes;
    } catch (error) {
        if (error instanceof MediaStorageError && error.code === "missing") {
            throw new JobFailure("source_missing", "Die Quelldatei fehlt", false);
        }
        if (error instanceof MediaStorageError && error.code === "too_large") {
            throw new JobFailure("too_large_bytes", error.message, false);
        }
        throw error;
    }
}

const summary = (file: IngestedFile): Record<string, unknown> => ({ ...file });

export async function runMediaDerive(context: JobContext): Promise<Record<string, unknown>> {
    const input = parseMediaDeriveInput(context.input);
    const root = process.env["MEDIA_ROOT"];
    if (root === undefined || root === "") {
        throw new JobFailure("media_root_missing", "MEDIA_ROOT ist nicht gesetzt", false);
    }
    const store = new MediaStore(root);

    await context.beginPhase("read", 0);
    const bytes = await readSource(store, input.source);

    const phases = { inspect: 0.2, render: 0.4, store: 0.8 } as const;
    try {
        const result = await ingestImage(store, { bytes, role: input.role, publish: input.publish }, async (step) => {
            await context.beginPhase(step, phases[step]);
        });
        return {
            format: result.format,
            source: summary(result.source),
            derivatives: result.derivatives.map(summary),
            findings: result.findings,
        };
    } catch (error) {
        if (error instanceof RasterRejection) throw new JobFailure(error.code, error.message, false);
        throw error;
    }
}
