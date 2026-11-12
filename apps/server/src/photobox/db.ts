import {
    PHOTOBOX_GRENZEN,
    PHOTOBOX_CREATION_METHOD,
    PHOTOBOX_RIGHTS,
    type MediaFileUpload,
    type PhotoboxCreationKind,
    type PhotoboxSubmissionState,
    type PhotoboxUsageGrant,
} from "@avesmaps3d/shared";
import { schluesselHash } from "../community/db.ts";
import { isNotProvisioned, type Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { decodeBase64 } from "../media-editor/evidence-file.ts";
import type { PhotoboxAkteur } from "../media-editor/operation-store.ts";
import { rejectionError } from "../media-editor/upload.ts";
import {
    FORMAT_EXTENSION,
    RasterRejection,
    inspectImage,
    sniffFormat,
    type RasterInspection,
} from "../media/raster/inspect.ts";
import { MetadatenFehler, entferneMetadaten } from "./metadaten.ts";
import { internVariante } from "../media/raster/ingest.ts";
import { PUBLISHED_VARIANT } from "../media/roles.ts";
import { sperreQuelle } from "../media/quellsperre.ts";
import { sha256Of, type MediaStore } from "../media/storage.ts";

/**
 * Das Reisebild in der Datenbank (WI-0272 S2): Lesen der Einreichung zum Schlüssel, das aktuelle Asset und das Anlegen eines Bildes samt
 * Zeilen. Leicht: kein Fastify, die Routen (`routes/photobox.ts`), das Einreichen (`einreichen.ts`) und die Statusaktionen (`status.ts`)
 * benutzen es gleich.
 *
 * 🔴 Der Schlüssel der Statusseite kommt hier nur als Argument an und wird sofort zum Hash (`schluesselHash`, die Stelle der Community); er
 * steht in keiner Zeile, keiner Fehlermeldung und keinem Protokoll.
 */

/** Das Quellsystem der Assets und des Eingangs eines Reisebilds. */
export const PHOTOBOX_QUELLSYSTEM = "photobox";

/**
 * Wer einen Auftrag der Warteschlange auslöste, wenn kein Konto handelt (`job.actor_ref`, opake Bezeichnung wie `inhaltsschalter` beim
 * Quarantäne-Abgleich, `system/inhaltsschalter.ts`): der Abgleich der Dateien eines Reisebilds (`media_settle`). Es handelt keine Person.
 */
export const PHOTOBOX_AUSLOESER = "photobox";

/** Der Handelnde ohne Konto: anonym, Bezeichnung `photobox` (`media_operation.actor_label`, nie ein Name). */
export const photoboxAkteur = (environment: PhotoboxAkteur["environment"]): PhotoboxAkteur => ({
    kind: "anonymous",
    label: "photobox",
    environment,
});

/** Der eine Satz, wenn zu einem Schlüssel keine Einreichung (mehr) da ist: derselbe für „nie gewesen“, „gelöscht“ und „geleert“. */
export const STATUS_FEHLT = "Zu diesem Link gibt es kein Reisebild (mehr).";

export const nichtGefunden = (): ApiError => new ApiError(404, "photobox_not_found", STATUS_FEHLT);
/**
 * Der Schritt geht in diesem Zustand nicht (mehr). WI-0291: `details` nennt den Zustand (`zustand`, falls der Aufrufer ihn kennt), damit das Fenster sagt, wie es steht
 * und was zu tun ist (neu laden), statt „später erneut versuchen“. Der deutsche Satz bleibt für Protokoll und alte Fenster.
 */
export const uebergangFehlt = (zustand?: string, reason = "uebergang"): ApiError =>
    new ApiError(409, "photobox_transition", "Das geht bei diesem Reisebild nicht (mehr).", {
        reason,
        ...(zustand === undefined ? {} : { zustand }),
    });
/** Die sechste Ersetzung des Bildes (`PHOTOBOX_GRENZEN.ersetzungenJeEinreichung`): wer so oft ersetzt, reicht besser neu ein. */
export const ersetzungenErschoepft = (): ApiError =>
    new ApiError(
        409,
        "photobox_replace_limit",
        "Dieses Reisebild wurde schon zu oft ersetzt. Reiche es bitte neu ein.",
        { reason: "ersetzungen_erschoepft", hoechstens: PHOTOBOX_GRENZEN.ersetzungenJeEinreichung },
    );
/**
 * Eine abgelehnte Angabe (422). WI-0291: `reason` ist der stabile Fachcode (`cc_by_avesmaps`, `stelle_ausserhalb`, `ort_unbekannt`, `feld_leer`, `angaben_passen_nicht`,
 * `nichts_zu_korrigieren`), `weiter` trägt, was der Satz des Fensters braucht (`feld`). Der deutsche Satz bleibt für Protokoll und alte Fenster.
 */
export const ungueltig = (satz: string, reason: string, weiter: Record<string, unknown> = {}): ApiError =>
    new ApiError(422, "photobox_invalid", satz, { reason, ...weiter });

/** Ein Freitext der Anfrage, wie er gespeichert wird: getrimmt; leer danach ist 422 (die Datenbank zählt ebenfalls nach `btrim`). */
export function bereinigt(text: string, was: string, feld: string): string {
    const kurz = text.trim();
    if (kurz === "") throw ungueltig(`${was} darf nicht leer sein.`, "feld_leer", { feld });
    return kurz;
}

/** Ein geprüftes Bild: die Bytes (ohne Metadaten) und das Ergebnis der Vorprüfung (Format aus den Bytes). */
export interface GeprueftesBild {
    bytes: Buffer;
    inspection: RasterInspection;
}

/**
 * Prüft ein hochgeladenes Bild vor jedem Byte auf der Platte, wie die Medienverwaltung (`upload.ts`): Format aus den Bytes, die Grenzen des
 * Betreibers (6 MiB, 16 MP, 8192 px), ein Bild statt mehrerer. 🔴 Ein SVG nimmt kein Besucher an (415): Es ist ein Dokument, kein Foto.
 *
 * 🔴 **Metadaten fallen hier weg, schon beim Eingang** (WI-0272 S3, Fixrunde A, `photobox/metadaten.ts`): Nach der Prüfung des Formats entfernt eine Byte-Arbeit auf
 * Containerebene (ohne Bildbibliothek, ohne zu dekodieren) EXIF, XMP, IPTC, Kommentare und alles hinter dem Bildende; danach prüft `inspectImage` die bereinigten
 * Bytes erneut. Prüfsumme, Größe und Ablage entstehen aus ihnen, die private Quelle trägt also nie Metadaten. Ein kaputter Aufbau und ein Bild, dessen Drehung
 * nur im EXIF steht, sind 422 (`media_file_rejected`) wie jede ungültige Datei.
 */
export function pruefeBild(upload: MediaFileUpload): GeprueftesBild {
    const bytes = decodeBase64(upload, "bild");
    if (sniffFormat(bytes) === "svg") {
        throw new ApiError(415, "unsupported_media_type", "Angenommen werden JPEG, PNG, WebP und GIF.", {
            reason: "unsupported_format",
        });
    }
    try {
        const vorab = inspectImage(bytes);
        if (vorab.format === "svg") throw new RasterRejection("unsupported_format", "Ein SVG nimmt kein Besucher an");
        const sauber = entferneMetadaten(bytes, vorab.format);
        if (!sauber.entfernt) return { bytes, inspection: vorab };
        const gereinigt = Buffer.from(sauber.bytes.buffer, sauber.bytes.byteOffset, sauber.bytes.byteLength);
        return { bytes: gereinigt, inspection: inspectImage(gereinigt) };
    } catch (error) {
        if (error instanceof MetadatenFehler) throw rejectionError(new RasterRejection("bad_header", error.message));
        if (!(error instanceof RasterRejection)) throw error;
        if (error.code === "unsupported_format") {
            throw new ApiError(415, "unsupported_media_type", "Angenommen werden JPEG, PNG, WebP und GIF.", {
                reason: error.code,
            });
        }
        throw rejectionError(error);
    }
}

/** Ist das Reisebild in dieser Datenbank nutzbar (die Tafel da und lesbar)? Ohne sie nimmt der Server nichts an. */
export async function photoboxBereit(db: Queryable): Promise<boolean> {
    try {
        await db`SELECT 1 FROM media_submission LIMIT 1`;
        return true;
    } catch (error) {
        if (isNotProvisioned(error)) return false;
        throw error;
    }
}

/** Die Einreichung zu einem Schlüssel, so wie die Statusaktionen sie brauchen. */
export interface Einreichung {
    id: string;
    publicId: string;
    revision: number;
    state: PhotoboxSubmissionState;
    creationKind: PhotoboxCreationKind;
    usageGrant: PhotoboxUsageGrant;
    description: string;
    pendingDescription: string | null;
    editorMessage: string | null;
    attributionName: string | null;
    viewDirection: number | null;
    adjustedByEditors: boolean;
    submittedAt: Date;
    approvedAssetId: string | null;
    /** Wann der Betreiber das Bild endgültig löschte (WI-0272, Migration 0328); `null`: nie. Dann bleibt die Einreichung ohne Datei und ohne Aktion. */
    mediaDeletedAt: Date | null;
    x: number;
    y: number;
    placeName: string | null;
}

interface EinreichungRow {
    id: string;
    public_id: string;
    revision: number;
    state: PhotoboxSubmissionState;
    creation_kind: PhotoboxCreationKind;
    usage_grant: PhotoboxUsageGrant;
    description: string;
    pending_description: string | null;
    editor_message: string | null;
    attribution_name: string | null;
    view_direction: number | null;
    adjusted_by_editors: boolean;
    submitted_at: Date;
    approved_asset: string | null;
    media_deleted_at: Date | null;
    x: number;
    y: number;
    place_name: string | null;
}

/**
 * Zieht den Übergang nach der technischen Prüfung nach (WI-0272 S2, Stage-Fund): Der Abgleich (`media_settle`) setzt nur `media_asset.technical_state`;
 * die Rolle der Aufträge hat keine Rechte an `media_submission`, den Wechsel der Einreichung schreibt also, wer liest. Eine Einreichung im Zustand
 * `incoming` wird `pending` (Bild in Ordnung) oder `technical_failed` (nicht verarbeitbar), sobald ihr aktuelles Asset (das des jüngsten Eingangs, wie
 * `aktuellesAsset`) nicht mehr `pending` ist; solange es `pending` ist, bleibt sie `incoming`. `state_changed_at` zählt ab dem Wechsel (Fristen der
 * Aufbewahrung); die Revision zählt der Trigger. Ohne `submissionId` für alle (der Moderationskorb, S3), mit nur für diese. Gibt die Zahl der
 * gewechselten Einreichungen zurück. Idempotent: Eine zweite Ausführung findet nichts mehr.
 *
 * 🔴 Eine Einreichung, die gerade ein anderer hält (eine Statusaktion, eine Operation der Redaktion), bleibt für diesen Lauf liegen (`FOR UPDATE OF s SKIP LOCKED`): Ein Lesepfad
 * wartet nie an einer Zeilensperre (Review M9), der nächste Lesevorgang holt es nach. Die Lesefunktionen der Medienverwaltung rufen es selbst nicht auf (sie bleiben rein lesend,
 * Fixrunde E); die Routen tun es einmal vor dem Lesen (`routes/media-editor.ts`).
 */
export async function technikNachziehen(q: Queryable, submissionId?: string | number): Promise<number> {
    const nur = submissionId === undefined ? q`` : q`AND s.id = ${String(submissionId)}::bigint`;
    const gewechselt = await q<{ id: string }[]>`
        WITH offen AS (
            SELECT s.id,
                   (SELECT a.technical_state
                      FROM media_ingest i
                      JOIN media_asset a ON a.id = i.media_asset_id
                     WHERE i.submission_id = s.id
                     ORDER BY i.id DESC
                     LIMIT 1) AS technik
              FROM media_submission s
             WHERE s.state = 'incoming' ${nur}
               FOR UPDATE OF s SKIP LOCKED
        )
        UPDATE media_submission s
           SET state = CASE WHEN o.technik = 'ok' THEN 'pending' ELSE 'technical_failed' END,
               state_changed_at = now()
          FROM offen o
         WHERE o.id = s.id AND s.state = 'incoming' AND o.technik IS NOT NULL AND o.technik <> 'pending'
        RETURNING s.id::text AS id
    `;
    return gewechselt.length;
}

/**
 * Die Einreichung zum Schlüssel; `undefined`, wenn es keine gibt (auch keine geleerte: ohne Schlüssel gibt es keine Statusseite).
 * `gesperrt`: die Zeile bleibt bis zum Ende der Transaktion gesperrt (zwei gleichzeitige Aktionen am selben Bild laufen nacheinander).
 * `technik`: eine eingegangene Einreichung, deren Bild technisch geprüft ist, wechselt vor dem Lesen in `pending` oder `technical_failed`
 * (`technikNachziehen`); gelesen wird dann der neue Stand. Die Statusseite und jede Statusaktion setzen es, sonst sähen sie `incoming`.
 */
export async function ladeEinreichung(
    q: Queryable,
    schluessel: string,
    { gesperrt = false, technik = false }: { gesperrt?: boolean; technik?: boolean } = {},
): Promise<Einreichung | undefined> {
    const lies = async (): Promise<EinreichungRow | undefined> => {
        const sperre = gesperrt ? q`FOR UPDATE OF s` : q``;
        const [row] = await q<EinreichungRow[]>`
            SELECT s.id::text AS id, s.public_id::text AS public_id, s.revision::int AS revision, s.state, s.creation_kind, s.usage_grant,
                   s.description, s.pending_description, s.editor_message, s.attribution_name, s.view_direction::int AS view_direction,
                   s.adjusted_by_editors, s.submitted_at, s.approved_media_asset_id::text AS approved_asset, s.media_deleted_at,
                   ST_X(s.geom) AS x, ST_Y(s.geom) AS y, p.name AS place_name
              FROM media_submission s
              LEFT JOIN place p ON p.id = s.place_id
             WHERE s.status_key_hash = ${schluesselHash(schluessel)}
             ${sperre}
        `;
        return row;
    };
    let row = await lies();
    if (technik && row?.state === "incoming" && (await technikNachziehen(q, row.id)) > 0) row = await lies();
    if (row === undefined) return undefined;
    return {
        id: row.id,
        publicId: row.public_id,
        revision: row.revision,
        state: row.state,
        creationKind: row.creation_kind,
        usageGrant: row.usage_grant,
        description: row.description,
        pendingDescription: row.pending_description,
        editorMessage: row.editor_message,
        attributionName: row.attribution_name,
        viewDirection: row.view_direction,
        adjustedByEditors: row.adjusted_by_editors,
        submittedAt: row.submitted_at,
        approvedAssetId: row.approved_asset,
        mediaDeletedAt: row.media_deleted_at,
        x: row.x,
        y: row.y,
        placeName: row.place_name,
    };
}

export interface AssetRef {
    id: string;
    publicId: string;
}

/** Das aktuelle Asset einer Einreichung: das des jüngsten Eingangs (ein ersetztes Bild hat mehrere). */
export async function aktuellesAsset(q: Queryable, submissionId: string): Promise<AssetRef | undefined> {
    const [row] = await q<{ id: string; public_id: string }[]>`
        SELECT a.id::text AS id, a.public_id::text AS public_id
          FROM media_ingest i
          JOIN media_asset a ON a.id = i.media_asset_id
         WHERE i.submission_id = ${submissionId}::bigint
         ORDER BY i.id DESC
         LIMIT 1
    `;
    return row === undefined ? undefined : { id: row.id, publicId: row.public_id };
}

/** Wie es um die Vorschau des Bildes steht (`vorschauLage`). */
export type VorschauLage =
    | { art: "bereit"; schluessel: string }
    /** Die Datei liegt in Quarantäne (Inhaltsschalter, Notaus): Sie kommt nicht von selbst wieder, die Seite braucht nicht nachzufragen. */
    | { art: "gesperrt" }
    /** Es gibt noch keine: Der Worker rechnet sie, oder sie ist (nach dem Löschen) nicht mehr da. */
    | { art: "fehlt" };

/**
 * Die Vorschau des Assets für die Statusseite und `Meine Reisebilder`: die interne Vorschau (`derivative`, `intern_photobox_2048`), solange das Bild privat ist,
 * sonst die veröffentlichte Datei der Rolle (`published`, `photobox_2048`). Mit der Freigaberegel veröffentlicht der Abgleich das Bild und löscht dabei absichtlich
 * die interne Vorschau (WI-0272 S3, Review I1); ohne den Rückgriff verlöre jedes freigegebene Bild seine Vorschau. Liegt die veröffentlichte Datei in Quarantäne
 * (`media_quarantine`, Inhaltsschalter oder Notaus), ist sie `gesperrt`: Sie läge nicht mehr unter ihrem Schlüssel, und ihr Bild soll auch hier nicht erscheinen.
 */
export async function vorschauLage(q: Queryable, assetId: string): Promise<VorschauLage> {
    const [row] = await q<{ storage_key: string; gesperrt: boolean }[]>`
        SELECT f.storage_key,
               f.storage_class = 'published' AND EXISTS (
                   SELECT 1 FROM media_quarantine mq WHERE mq.sha256 = f.sha256 AND mq.restored_at IS NULL
               ) AS gesperrt
          FROM media_file f
         WHERE f.media_asset_id = ${assetId}::bigint
           AND ((f.storage_class = 'derivative' AND f.variant = ${internVariante(PUBLISHED_VARIANT.photobox)})
             OR (f.storage_class = 'published' AND f.variant = ${PUBLISHED_VARIANT.photobox}))
         ORDER BY (f.storage_class = 'derivative') DESC, f.id DESC
         LIMIT 1
    `;
    if (row === undefined) return { art: "fehlt" };
    return row.gesperrt ? { art: "gesperrt" } : { art: "bereit", schluessel: row.storage_key };
}

export interface BildFakten {
    submissionId: string;
    submissionPublicId: string;
    entstehung: PhotoboxCreationKind;
    nutzung: PhotoboxUsageGrant;
    /** Die freiwillige Nennung (bereits getrimmt); `null` ohne. */
    name: string | null;
}

export interface AngelegtesBild extends AssetRef {
    revision: number;
    format: string;
    byteSize: number;
    sha256: string;
}

/**
 * Legt ein Bild für eine Einreichung an, in der Transaktion des Aufrufers: erst die Bytes (privat, Name aus dem Hash, nie aus dem Dateinamen),
 * dann Asset (`community_upload`, Moderation `pending`), Quelldatei, Rechte (aus der Lizenzwahl, nie geprüft), Entstehung und Eingang.
 * Der Eingang trägt die Einreichung und KEINEN Dateinamen; `source_ref` ist `photobox:<Kennung der Einreichung>`.
 *
 * 🔴 Das Asset hat keine Verwendung und bleibt `pending`: `decidePublication` hält es zurück, bis die Redaktion entscheidet.
 */
export async function legeBildAn(
    tx: Queryable,
    store: MediaStore,
    bild: GeprueftesBild,
    fakten: BildFakten,
): Promise<AngelegtesBild> {
    const { inspection } = bild;
    // Gleichzeitig kann das Original eines angenommenen, bytegleichen Kartenvorschlags fallen (`media/quellsperre.ts`).
    await sperreQuelle(tx, sha256Of(bild.bytes));
    const quelle = await store.store("private_source", bild.bytes, FORMAT_EXTENSION[inspection.format]);
    const [asset] = await tx<{ id: string; public_id: string; revision: number }[]>`
        INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state, source_system)
        VALUES ('image', 'picture', 'community_upload', ${PHOTOBOX_CREATION_METHOD[fakten.entstehung]}, 'pending', 'pending',
                ${PHOTOBOX_QUELLSYSTEM})
        RETURNING id::text AS id, public_id::text AS public_id, revision::int AS revision
    `;
    await tx`
        INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
        VALUES (${asset!.id}::bigint, 'source', 'private_source', ${quelle.key}, ${inspection.mimeType}, ${inspection.width},
                ${inspection.height}, ${quelle.byteSize}, ${quelle.sha256})
    `;
    const rechte = PHOTOBOX_RIGHTS[fakten.nutzung];
    const familie = await lizenzfamilie(tx, rechte.licenseKey);
    await tx`
        INSERT INTO media_rights (media_asset_id, rights_basis, license_key, license_family, creator, attribution, clearance_state)
        VALUES (${asset!.id}::bigint, ${rechte.basis}, ${rechte.licenseKey}, ${familie}, ${fakten.name}, ${fakten.name}, 'unreviewed')
    `;
    // Die Wahl des Einreichers, wie sie war (die Entstehung des Mediums steht am Asset; die vierte Wahl, eine Aufnahme aus Avesmaps, ist dort `derived`).
    await tx`
        INSERT INTO media_creation (media_asset_id, parameters)
        VALUES (${asset!.id}::bigint, ${tx.json({ wahl: fakten.entstehung })})
    `;
    await tx`
        INSERT INTO media_ingest (media_asset_id, ingest_kind, submission_id, source_system, source_ref)
        VALUES (${asset!.id}::bigint, 'community_upload', ${fakten.submissionId}::bigint, ${PHOTOBOX_QUELLSYSTEM},
                ${`photobox:${fakten.submissionPublicId}`})
    `;
    return {
        id: asset!.id,
        publicId: asset!.public_id,
        revision: asset!.revision,
        format: inspection.format,
        byteSize: quelle.byteSize,
        sha256: quelle.sha256,
    };
}

/** Die Familie einer Lizenz aus dem Katalog (für `media_rights.license_family`); `null` ohne Schlüssel. */
export async function lizenzfamilie(q: Queryable, licenseKey: string | null): Promise<string | null> {
    if (licenseKey === null) return null;
    const [row] = await q<{ family: string | null }[]>`SELECT family FROM license_catalog WHERE key = ${licenseKey}`;
    return row?.family ?? null;
}
