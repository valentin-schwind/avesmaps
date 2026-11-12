import {
    KARTENVORSCHLAG_GRENZEN,
    PHOTOBOX_RIGHTS,
    assetTypeForRole,
    type KartenvorschlagNutzung,
    type KartenvorschlagZustand,
} from "@avesmaps3d/shared";
import { schluesselHash } from "../community/db.ts";
import { isNotProvisioned, type Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { rejectionError } from "../media-editor/upload.ts";
import { MetadatenFehler, entferneMetadaten } from "../photobox/metadaten.ts";
import { lizenzfamilie } from "../photobox/db.ts";
import {
    FORMAT_EXTENSION,
    RasterRejection,
    inspectImage,
    sniffFormat,
    type RasterInspection,
} from "../media/raster/inspect.ts";
import { sperreQuelle } from "../media/quellsperre.ts";
import { KARTENVORSCHLAG_QUELLSYSTEM } from "./quellsystem.ts";
import { sha256Of, type MediaStore } from "../media/storage.ts";

/**
 * Der Kartenvorschlag in der Datenbank (WI-0275 Stufe B): Fehler, die Prüfung einer hochgeladenen Datei, das Anlegen ihres Werks und das Lesen eines
 * Vorschlags zum Statusschlüssel. Leicht: kein Fastify; die Routen (`routes/kartenvorschlag.ts`), das Einreichen (`einreichen.ts`), die Statusaktionen
 * (`status.ts`) und die Redaktion (`redaktion.ts`) benutzen es gleich.
 *
 * 🔴 Der Statusschlüssel kommt hier nur als Argument an und wird sofort zum Hash (`schluesselHash`, die Stelle der Community); er steht in keiner Zeile,
 * keiner Fehlermeldung und keinem Protokoll.
 */

export { KARTENVORSCHLAG_QUELLSYSTEM };
/** Wer den Abgleich der Datei auslöste, wenn kein Konto handelt (`job.actor_ref`, opake Bezeichnung): es handelt keine Person. */
export const KARTENVORSCHLAG_AUSLOESER = "kartenvorschlag";

/** Der eine Satz, wenn zu einem Schlüssel kein Vorschlag da ist: derselbe für „nie gewesen“ und „gelöscht“. */
export const STATUS_FEHLT = "Zu diesem Link gibt es keinen Kartenvorschlag (mehr).";

export const nichtGefunden = (): ApiError => new ApiError(404, "kartenvorschlag_not_found", STATUS_FEHLT);
/**
 * 422 `kartenvorschlag_invalid`. WI-0291: `reason` ist der stabile Fachcode (ADR-0018, snake_case) und `weiter` trägt die Angaben, die der Satz braucht (Feld, Jahre, Arten); das Fenster
 * bildet beides auf einen Satz in der Sprache der Oberfläche ab, der sagt, was zu tun ist. Der deutsche Satz bleibt für Protokoll und alte Fenster. Ohne `reason` (Redaktionswege) bleibt `details` leer.
 */
export const ungueltig = (satz: string, reason?: string, weiter: Record<string, unknown> = {}): ApiError =>
    new ApiError(422, "kartenvorschlag_invalid", satz, reason === undefined ? undefined : { reason, ...weiter });
/** Der Schritt geht in diesem Zustand nicht (mehr). WI-0291: `details.reason` und der Zustand, damit das Fenster sagt, wie es steht und was zu tun ist (wie `photobox/db.ts`). */
export const uebergangFehlt = (reason = "uebergang", zustand?: string): ApiError =>
    new ApiError(409, "kartenvorschlag_transition", "Das geht bei diesem Kartenvorschlag nicht (mehr).", {
        reason,
        ...(zustand === undefined ? {} : { zustand }),
    });
/** Der Schlüssel gehört schon einem Vorschlag (Doppelklick mit neuer Kennung, ein Formular, das nicht neu geöffnet wurde): 409. */
export const schluesselBelegt = (): ApiError =>
    new ApiError(
        409,
        "kartenvorschlag_key_used",
        "Dieser Link gehört schon zu einem Kartenvorschlag. Bitte das Formular neu öffnen.",
    );

/** Ist der Kartenvorschlag in dieser Datenbank nutzbar (die Tafel da und lesbar)? Ohne sie nimmt der Server nichts an. */
export async function kartenvorschlagBereit(db: Queryable): Promise<boolean> {
    try {
        await db`SELECT 1 FROM citymap_suggestion LIMIT 1`;
        return true;
    } catch (error) {
        if (isNotProvisioned(error)) return false;
        throw error;
    }
}

/** Ein Freitext der Anfrage, wie er gespeichert wird: getrimmt; leer danach ist 422 (die Datenbank zählt ebenfalls nach `btrim`). */
export function bereinigt(text: string, was: string, feld?: string): string {
    const kurz = text.trim();
    if (kurz === "") {
        throw ungueltig(`${was} darf nicht leer sein.`, feld === undefined ? undefined : "feld_leer", { feld });
    }
    return kurz;
}

/** Ein freiwilliger Freitext: `undefined` bleibt `null`, sonst getrimmt wie `bereinigt`. */
export const freiwillig = (text: string | undefined, was: string, feld?: string): string | null =>
    text === undefined ? null : bereinigt(text, was, feld);

/** Eine geprüfte Datei: die Bytes (bei Rastern ohne Metadaten) und das Ergebnis der Vorprüfung (Art aus den Bytes). */
export interface GepruefteDatei {
    bytes: Buffer;
    inspection: RasterInspection;
}

const ERLAUBT = new Set(["jpeg", "png", "webp", "pdf"]);

/**
 * Prüft eine hochgeladene Kartendatei vor jedem Byte auf der Platte: Art aus den Bytes (JPEG, PNG, WebP oder PDF, bis 50 MiB; kein SVG, kein GIF), die
 * Grenzen der Pipeline (Pixel, Kantenlänge) und die Übereinstimmung mit der angekündigten Art. 🔴 Die 6-MiB-Grenze der Medienverwaltung (D2) bleibt
 * unberührt: Die 50 MiB gelten nur hier (`maxRasterBytes`). Ein Raster verliert hier seine Metadaten (EXIF, XMP, IPTC, Kommentare, Anhang), wie bei den
 * Reisebildern; ein PDF bleibt, wie es ist (privates Original, gerastert wird nur Seite 1 im Worker).
 */
export function pruefeKartendatei(bytes: Buffer, angekuendigt: string): GepruefteDatei {
    if (bytes.byteLength === 0) throw ungueltig("Die Datei ist leer.", "datei_leer");
    if (bytes.byteLength > KARTENVORSCHLAG_GRENZEN.dateiBytes) {
        throw new ApiError(413, "kartenvorschlag_too_large", "Die Datei ist größer als 50 MB.", {
            reason: "datei_zu_gross",
            limitBytes: KARTENVORSCHLAG_GRENZEN.dateiBytes,
        });
    }
    const unterstuetzt = (): ApiError =>
        new ApiError(415, "unsupported_media_type", "Angenommen werden JPEG, PNG, WebP und PDF.", {
            reason: "unsupported_format",
        });
    if (sniffFormat(bytes) === "svg") throw unterstuetzt();
    try {
        const grenzen = { allowPdf: true, maxRasterBytes: KARTENVORSCHLAG_GRENZEN.dateiBytes } as const;
        const vorab = inspectImage(bytes, grenzen);
        if (!ERLAUBT.has(vorab.format)) throw unterstuetzt();
        if (vorab.mimeType !== angekuendigt) {
            throw ungueltig("Die Datei passt nicht zu der angegebenen Art.", "datei_art_falsch", {
                angekuendigt,
                tatsaechlich: vorab.mimeType,
            });
        }
        if (vorab.format === "pdf") return { bytes, inspection: vorab };
        const sauber = entferneMetadaten(bytes, vorab.format);
        if (!sauber.entfernt) return { bytes, inspection: vorab };
        const gereinigt = Buffer.from(sauber.bytes.buffer, sauber.bytes.byteOffset, sauber.bytes.byteLength);
        return { bytes: gereinigt, inspection: inspectImage(gereinigt, grenzen) };
    } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error instanceof MetadatenFehler) throw rejectionError(new RasterRejection("bad_header", error.message));
        if (!(error instanceof RasterRejection)) throw error;
        if (error.code === "unsupported_format") throw unterstuetzt();
        throw rejectionError(error);
    }
}

export interface AngelegtesWerk {
    id: string;
    publicId: string;
    format: string;
    byteSize: number;
    sha256: string;
}

/**
 * Legt das Werk einer Kartendatei an, in der Transaktion des Aufrufers: erst die Bytes (privat, Name aus dem Hash, nie aus dem Dateinamen), dann Werk
 * (`community_upload`, Moderation `pending`), Quelldatei und Rechte (aus der Lizenzwahl, nie geprüft). 🔴 Das Werk hat keine Verwendung und bleibt
 * `pending`: `decidePublication` hält es zurück, bis die Redaktion die Karte anlegt. 🔴 Die Sperre je Hash kommt vor den Bytes: Gleichzeitig kann das Original
 * eines angenommenen, bytegleichen Vorschlags fallen (`original-loeschen.ts`, `media/quellsperre.ts`).
 */
export async function legeWerkAn(
    tx: Queryable,
    store: MediaStore,
    datei: GepruefteDatei,
    fakten: { titel: string; nutzung: KartenvorschlagNutzung; urheber: string | null },
): Promise<AngelegtesWerk> {
    const { inspection } = datei;
    await sperreQuelle(tx, sha256Of(datei.bytes));
    const quelle = await store.store("private_source", datei.bytes, FORMAT_EXTENSION[inspection.format]);
    const [werk] = await tx<{ id: string; public_id: string }[]>`
        INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state, source_system, title)
        VALUES ('image', ${assetTypeForRole("map_full")}, 'community_upload', 'unknown', 'pending', 'pending', ${KARTENVORSCHLAG_QUELLSYSTEM},
                ${fakten.titel})
        RETURNING id::text AS id, public_id::text AS public_id
    `;
    await tx`
        INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
        VALUES (${werk!.id}::bigint, 'source', 'private_source', ${quelle.key}, ${inspection.mimeType}, ${inspection.width},
                ${inspection.height}, ${quelle.byteSize}, ${quelle.sha256})
    `;
    const rechte = PHOTOBOX_RIGHTS[fakten.nutzung];
    const familie = await lizenzfamilie(tx, rechte.licenseKey);
    await tx`
        INSERT INTO media_rights (media_asset_id, rights_basis, license_key, license_family, creator, attribution, clearance_state)
        VALUES (${werk!.id}::bigint, ${rechte.basis}, ${rechte.licenseKey}, ${familie}, ${fakten.urheber}, ${fakten.urheber}, 'unreviewed')
    `;
    return {
        id: werk!.id,
        publicId: werk!.public_id,
        format: inspection.format,
        byteSize: quelle.byteSize,
        sha256: quelle.sha256,
    };
}

/** Nimmt das Werk eines zurückgezogenen oder abgelehnten Vorschlags aus dem Verkehr: `rejected` hält jede Veröffentlichung und jede neue Vorschau zurück. */
export async function nimmWerkAus(tx: Queryable, werkId: string | null): Promise<void> {
    if (werkId === null) return;
    await tx`UPDATE media_asset SET moderation_state = 'rejected' WHERE id = ${werkId}::bigint AND moderation_state <> 'rejected'`;
}

/**
 * Zieht den Übergang nach der technischen Prüfung nach: Der Abgleich (`media_settle`, im Worker) setzt nur `media_asset.technical_state`; die Rolle der
 * Aufträge hat keine Rechte an `citymap_suggestion`, den Wechsel schreibt also, wer liest. Ein Vorschlag im Zustand `incoming` mit Werk wird `pending`
 * (Datei in Ordnung) oder `technical_failed` (nicht verarbeitbar), sobald sein Werk nicht mehr `pending` ist. Gesperrte Zeilen bleiben für diesen Lauf
 * liegen (`SKIP LOCKED`): Ein Lesepfad wartet nie an einer Zeilensperre. Idempotent. Ohne `id` für alle, mit nur für diesen Vorschlag.
 */
export async function technikNachziehen(q: Queryable, id?: string | number): Promise<number> {
    const nur = id === undefined ? q`` : q`AND s.id = ${String(id)}::bigint`;
    const gewechselt = await q<{ id: string }[]>`
        WITH offen AS (
            SELECT s.id, a.technical_state AS technik
              FROM citymap_suggestion s
              JOIN media_asset a ON a.id = s.media_asset_id
             WHERE s.state = 'incoming' ${nur}
               FOR UPDATE OF s SKIP LOCKED
        )
        UPDATE citymap_suggestion s
           SET state = CASE WHEN o.technik = 'ok' THEN 'pending' ELSE 'technical_failed' END,
               state_changed_at = now()
          FROM offen o
         WHERE o.id = s.id AND s.state = 'incoming' AND o.technik <> 'pending'
        RETURNING s.id::text AS id
    `;
    return gewechselt.length;
}

/** Ein Vorschlag, so wie die Statusaktionen und die Redaktion ihn brauchen. */
export interface Vorschlag {
    id: string;
    publicId: string;
    nummer: number;
    revision: number;
    state: KartenvorschlagZustand;
    way: "link" | "file";
    title: string;
    linkUrl: string | null;
    fileMime: string | null;
    mediaAssetId: string | null;
    submittedAt: Date;
    decidedAt: Date | null;
    decisionReason: string | null;
    updatedAt: Date;
}

interface VorschlagRow {
    id: string;
    public_id: string;
    number: string;
    revision: number;
    state: KartenvorschlagZustand;
    way: "link" | "file";
    title: string;
    link_url: string | null;
    file_mime: string | null;
    media_asset_id: string | null;
    submitted_at: Date;
    decided_at: Date | null;
    decision_reason: string | null;
    updated_at: Date;
}

/**
 * Der Vorschlag zum Schlüssel; `undefined`, wenn es keinen gibt. `gesperrt`: die Zeile bleibt bis zum Ende der Transaktion gesperrt (zwei gleichzeitige
 * Aktionen am selben Vorschlag laufen nacheinander). Ein eingegangener Vorschlag, dessen Datei technisch geprüft ist, wechselt vor dem Lesen in
 * `pending` oder `technical_failed` (`technikNachziehen`).
 */
export async function ladeVorschlag(
    q: Queryable,
    schluessel: string,
    { gesperrt = false }: { gesperrt?: boolean } = {},
): Promise<Vorschlag | undefined> {
    const lies = async (): Promise<VorschlagRow | undefined> => {
        const sperre = gesperrt ? q`FOR UPDATE OF s` : q``;
        const [row] = await q<VorschlagRow[]>`
            SELECT s.id::text AS id, s.public_id::text AS public_id, s.number::text AS number, s.revision::int AS revision, s.state, s.way, s.title,
                   s.link_url, s.file_mime, s.media_asset_id::text AS media_asset_id, s.submitted_at, s.decided_at, s.decision_reason, s.updated_at
              FROM citymap_suggestion s
             WHERE s.status_key_hash = ${schluesselHash(schluessel)}
             ${sperre}
        `;
        return row;
    };
    let row = await lies();
    if (row?.state === "incoming" && (await technikNachziehen(q, row.id)) > 0) row = await lies();
    if (row === undefined) return undefined;
    return {
        id: row.id,
        publicId: row.public_id,
        nummer: Number(row.number),
        revision: row.revision,
        state: row.state,
        way: row.way,
        title: row.title,
        linkUrl: row.link_url,
        fileMime: row.file_mime,
        mediaAssetId: row.media_asset_id,
        submittedAt: row.submitted_at,
        decidedAt: row.decided_at,
        decisionReason: row.decision_reason,
        updatedAt: row.updated_at,
    };
}
