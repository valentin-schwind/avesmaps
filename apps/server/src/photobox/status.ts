import {
    PHOTOBOX_GRENZEN,
    PHOTOBOX_RIGHTS,
    photoboxAktionErlaubt,
    photoboxGrantAllowed,
    type DerivedWork,
    type PhotoboxAktion,
    type PhotoboxBeschreibung,
    type PhotoboxBildErsetzen,
    type PhotoboxNutzung,
    type PhotoboxOffline,
    type PhotoboxStatus,
    type PhotoboxSubmissionState,
    type PhotoboxUsageGrant,
    type PhotoboxZurueckziehen,
} from "@avesmaps3d/shared";
import type { AuthEnvironment } from "../auth/config.ts";
import type { Sql } from "../auth/session-store.ts";
import { schluesselHash } from "../community/db.ts";
import type { GlockeLog } from "../community/glocke.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { mediaOperation, type MediaAuditEntry } from "../media-editor/operation-store.ts";
import { enqueueSettle } from "../media-editor/settle.ts";
import { resolveReisebild } from "../media/resolver.ts";
import { MediaStorageError, sha256Of, type MediaStore } from "../media/storage.ts";
import {
    PHOTOBOX_AUSLOESER,
    aktuellesAsset,
    bereinigt,
    ersetzungenErschoepft,
    ladeEinreichung,
    legeBildAn,
    lizenzfamilie,
    nichtGefunden,
    photoboxAkteur,
    pruefeBild,
    ungueltig,
    uebergangFehlt,
    vorschauLage,
    type Einreichung,
} from "./db.ts";
import { OHNE_PROTOKOLL, meldeNeuesReisebild } from "./glocke.ts";
import { vergissReisebilder } from "./karte.ts";

/**
 * Was der Einreicher auf seiner Statusseite sieht und tut (WI-0272 S2, §12/§13): der Zustand lesen, die interne Vorschau holen, die Beschreibung
 * ändern, das Bild ersetzen, zurückziehen, offline nehmen und die Lizenzwahl ändern. Der Schlüssel öffnet alles; ohne Konto, ohne Sitzung.
 *
 * - 🔴 **Eine Stelle für „was darf der Zustand“:** jede Aktion fragt `photoboxAktionErlaubt` (`packages/shared`), dieselbe Frage wie die Oberfläche;
 *   sonst 409 `photobox_transition`. Ein unbekannter Schlüssel ist 404 `photobox_not_found` mit demselben Satz, gleich ob es das Bild nie gab oder es
 *   gelöscht wurde.
 * - **Idempotent und protokolliert (M10):** jede Aktion ist eine Operation im Protokoll der Medien (anonymer Handelnder `photobox`) mit Revision der
 *   Einreichung; dieselbe Kennung noch einmal liefert die Quittung, nichts wird doppelt getan. Der Schlüssel geht nur als Hash in den Hash der Anfrage.
 * - **Der Zustandswechsel nur, wenn sich der Zustand ändert:** `state_changed_at` setzt `setzeZustand` nur dann, sonst liefen die Fristen der Aufbewahrung
 *   mit jeder Beschreibung von vorn.
 * - 🔴 **Offline wirkt sofort:** das Asset wird `rejected` (`decidePublication` hält es überall zurück), die öffentliche Datei wird nach dem Commit der
 *   Transaktion gelöscht (erst die Datei, dann die Zeile; ein Absturz dazwischen heilt der `media_settle`-Auftrag, der in derselben Transaktion eingereiht
 *   wurde; dieser Abgleich rechnet für ein abgelehntes Asset nichts, er nimmt nur eine noch vorhandene öffentliche Datei weg). Alle übrigen Dateien (Original,
 *   interne Vorschauen) löscht der nächste tägliche Lauf der Aufbewahrung (`photobox_aufbewahren`, Migration 0284), die Angaben nach 30 Tagen.
 *   Die Verwendung der Rolle photobox (Migration 0293, die Freigabe der Redaktion legt sie an) zieht das Offline-Nehmen zurück.
 * - 🔔 **Die Glocke** (Aufgabe 19): Ein neues Bild und eine Beschreibung, die auf Prüfung wartet, melden sich bei der Redaktion (`photobox/glocke.ts`, bestenfalls, in der Transaktion der Operation).
 * - 🔴 **Bild endgültig gelöscht** (WI-0272, `media_submission.media_deleted_at`, Migration 0328): Die Statusseite sagt es (`bildEntfernt`), zeigt keine Vorschau (auch keine
 *   ersetzte Fassung) und nimmt keine Aktion mehr an (409 `photobox_transition`, Grund `bild_entfernt`). Sonst wartete etwa eine neue Beschreibung auf eine Prüfung, die
 *   niemand mehr erreicht.
 */

/** Die Größe, bis zu der die interne Vorschau gelesen wird (eine 2048-Pixel-Fassung ist weit darunter). */
const VORSCHAU_MAX_BYTES = 8 * 1024 * 1024;

// --- Lesen ----------------------------------------------------------------------------------------------------------------------

const FEHLT = { art: "fehlt" } as const;

/**
 * Der Stand der Einreichung zum Schlüssel; `null`, wenn es keine gibt. Ist das Bild technisch geprüft, wechselt eine eingegangene Einreichung hier in
 * `pending` oder `technical_failed` (`technikNachziehen`: der Abgleich der Aufträge schreibt `media_submission` nicht, wer liest, zieht nach).
 */
export async function statusLesen(q: Queryable, schluessel: string): Promise<PhotoboxStatus | null> {
    const einreichung = await ladeEinreichung(q, schluessel, { technik: true });
    if (einreichung === undefined) return null;
    const entfernt = einreichung.mediaDeletedAt !== null;
    const asset = entfernt ? undefined : await aktuellesAsset(q, einreichung.id);
    const vorschau = asset === undefined ? FEHLT : await vorschauLage(q, asset.id);
    const karte = einreichung.state === "approved" && !entfernt ? await resolveReisebild(q, einreichung.id) : undefined;
    return {
        zustand: einreichung.state,
        eingereichtAm: einreichung.submittedAt.toISOString(),
        beschreibung: einreichung.description,
        ...(einreichung.pendingDescription === null ? {} : { wartendeBeschreibung: einreichung.pendingDescription }),
        ...(einreichung.editorMessage === null ? {} : { nachricht: einreichung.editorMessage }),
        entstehung: einreichung.creationKind,
        nutzung: einreichung.usageGrant,
        ...(einreichung.viewDirection === null ? {} : { blickrichtung: einreichung.viewDirection }),
        ...(einreichung.attributionName === null ? {} : { name: einreichung.attributionName }),
        lage: { x: einreichung.x, y: einreichung.y },
        ...(einreichung.placeName === null ? {} : { ortName: einreichung.placeName }),
        vorschauBereit: vorschau.art === "bereit",
        ...(vorschau.art === "gesperrt" ? { vorschauGesperrt: true as const } : {}),
        ...(entfernt ? { bildEntfernt: true as const } : {}),
        angepasst: einreichung.adjustedByEditors,
        ...(karte === undefined ? {} : { karte }),
    };
}

/**
 * Die Vorschau (WebP) des aktuellen Bildes: 404 bei unbekanntem Schlüssel, 404 `photobox_preview_missing`, solange der Worker sie nicht rechnete oder wenn die Datei in
 * Quarantäne liegt. Vor der Veröffentlichung ist es die interne Vorschau, danach die veröffentlichte Datei (`vorschauLage`).
 */
export async function vorschauLesen(q: Queryable, store: MediaStore, schluessel: string): Promise<Buffer> {
    const einreichung = await ladeEinreichung(q, schluessel);
    if (einreichung === undefined) throw nichtGefunden();
    // Nach dem endgültigen Löschen gibt es keine Vorschau, auch nicht die einer ersetzten Fassung.
    const asset = einreichung.mediaDeletedAt === null ? await aktuellesAsset(q, einreichung.id) : undefined;
    const vorschau = asset === undefined ? FEHLT : await vorschauLage(q, asset.id);
    const key = vorschau.art === "bereit" ? vorschau.schluessel : undefined;
    const fehlt = new ApiError(404, "photobox_preview_missing", "Die Vorschau ist noch nicht fertig.");
    if (key === undefined) throw fehlt;
    try {
        return await store.read(key, VORSCHAU_MAX_BYTES);
    } catch (error) {
        if (error instanceof MediaStorageError && error.code === "missing") throw fehlt;
        throw error;
    }
}

// --- Schreiben ------------------------------------------------------------------------------------------------------------------

export interface Aktionsspur {
    revision: number;
    derivedWork?: DerivedWork[];
    entries: MediaAuditEntry[];
}

interface AktionsEingabe {
    operationId: string;
    operation: string;
    schluessel: string;
    /** Der Inhalt ohne Schlüssel und ohne Bytes (Hashes statt Dateien): daran erkennt `runOperation` eine Wiederholung. */
    inhalt: Record<string, unknown>;
    aktion: PhotoboxAktion;
    nutzungZiel?: PhotoboxUsageGrant;
}

/**
 * Eine Aktion des Einreichers als Operation: die Einreichung zum Schlüssel gesperrt lesen (404), den Zustand fragen (409), dann `work`. Sie schreibt
 * Operation und Fachprotokoll in derselben Transaktion; die Quittung nennt die Einreichung mit ihrer neuen Revision.
 */
async function alsEinreicher(
    db: Database,
    umgebung: AuthEnvironment,
    eingabe: AktionsEingabe,
    work: (tx: Sql, einreichung: Einreichung) => Promise<Aktionsspur>,
): Promise<void> {
    await mediaOperation(
        db,
        photoboxAkteur(umgebung),
        {
            operationId: eingabe.operationId,
            operation: eingabe.operation,
            body: { schluessel: schluesselHash(eingabe.schluessel).toString("hex"), ...eingabe.inhalt },
        },
        async (tx) => {
            // Mit dem Wechsel nach der technischen Prüfung: `photoboxAktionErlaubt` muss den richtigen Zustand sehen, nicht ein längst überholtes `incoming`.
            const einreichung = await ladeEinreichung(tx, eingabe.schluessel, { gesperrt: true, technik: true });
            if (einreichung === undefined) throw nichtGefunden();
            if (!photoboxAktionErlaubt(einreichung.state, eingabe.aktion, eingabe.nutzungZiel))
                throw uebergangFehlt(einreichung.state);
            // Das Bild ist endgültig gelöscht (WI-0272): Es gibt nichts mehr zu ändern.
            if (einreichung.mediaDeletedAt !== null) throw uebergangFehlt(einreichung.state, "bild_entfernt");
            const spur = await work(tx, einreichung);
            return {
                receipt: {
                    affected: [{ kind: "media_submission", id: einreichung.publicId, revision: spur.revision }],
                    derivedWork: spur.derivedWork ?? [],
                    warnings: [],
                },
                entries: spur.entries,
            };
        },
    );
}

/**
 * Setzt den Zustand; `state_changed_at` nur, wenn er sich ändert (die Fristen des Verfalls und Löschens zählen ab dem Wechsel). Gibt die neue
 * Revision zurück (der Trigger zählt sie).
 *
 * 🔴 Wechselt die Einreichung aus einer Rückfrage (`changes_requested`) in einen anderen Zustand, leert das die Nachricht der Redaktion (`editor_message`, Review M10): Der
 * Einsender hat geantwortet (Beschreibung, neues Bild) oder zurückgezogen, die Rückfrage gilt nicht mehr, und die Statusseite zeigt keine alte Warnung. Die Nachricht einer
 * Ablehnung bleibt (der Grund; die Einreichung verlässt `rejected` nie durch den Einsender).
 */
export async function setzeZustand(tx: Queryable, id: string, zustand: PhotoboxSubmissionState): Promise<number> {
    const [row] = await tx<{ revision: number }[]>`
        UPDATE media_submission
           SET state = ${zustand},
               state_changed_at = CASE WHEN state IS DISTINCT FROM ${zustand} THEN now() ELSE state_changed_at END,
               editor_message = CASE WHEN state = 'changes_requested' AND ${zustand} <> 'changes_requested' THEN NULL ELSE editor_message END
         WHERE id = ${id}::bigint
        RETURNING revision::int AS revision
    `;
    return row!.revision;
}

async function nehmeAssetAus(tx: Queryable, assetId: string): Promise<void> {
    await tx`UPDATE media_asset SET moderation_state = 'rejected' WHERE id = ${assetId}::bigint AND moderation_state <> 'rejected'`;
}

/**
 * Die Beschreibung ändern: vor der Freigabe gilt sie sofort, danach wartet sie auf die Prüfung der Redaktion (`pending_description`). Bei einer Rückfrage
 * (`changes_requested`) ist sie die Antwort darauf: Die Einreichung geht zurück auf `pending`, mit neuem `state_changed_at`.
 */
export async function beschreibungSetzen(
    db: Database,
    umgebung: AuthEnvironment,
    body: PhotoboxBeschreibung,
    log: GlockeLog = OHNE_PROTOKOLL,
): Promise<void> {
    const text = bereinigt(body.beschreibung, "Die Bildbeschreibung", "beschreibung");
    await alsEinreicher(
        db,
        umgebung,
        {
            operationId: body.operationId,
            operation: "photobox.describe",
            schluessel: body.schluessel,
            inhalt: { beschreibung: text },
            aktion: "beschreibung",
        },
        async (tx, einreichung) => {
            const wartet = einreichung.state === "approved";
            // Die geänderte Beschreibung bei einer Rückfrage IST die Antwort darauf: Die Einreichung liegt wieder bei der Redaktion (`pending`).
            const antwort = einreichung.state === "changes_requested";
            const [row] = await tx<{ revision: number }[]>`
                UPDATE media_submission
                   SET description = CASE WHEN ${wartet} THEN description ELSE ${text} END,
                       pending_description = CASE WHEN ${wartet} THEN ${text} ELSE NULL END
                 WHERE id = ${einreichung.id}::bigint
                RETURNING revision::int AS revision
            `;
            const revision = antwort ? await setzeZustand(tx, einreichung.id, "pending") : row!.revision;
            const asset = await aktuellesAsset(tx, einreichung.id);
            // Was auf Prüfung wartet, meldet sich: die Antwort auf eine Rückfrage und eine Beschreibung nach der Freigabe. Vor der Freigabe liegt die Einreichung schon im Korb.
            // 🔴 Wartete nach der Freigabe schon eine Beschreibung, meldet sich die nächste Änderung nicht (Review M8): Die Glocke zählt Einreichungen, nicht Änderungen,
            // und 20 Änderungen je Stunde bliesen die Zahl sonst auf, ohne dass mehr zu prüfen wäre.
            const neuWartend = wartet && einreichung.pendingDescription === null;
            if (neuWartend || antwort) await meldeNeuesReisebild(tx, log, umgebung, body.operationId);
            return {
                revision,
                entries: [
                    {
                        action: "photobox.description_set",
                        assetId: asset?.publicId ?? null,
                        targetRevision: revision,
                        details: antwort ? { pending: wartet, previous: einreichung.state } : { pending: wartet },
                    },
                ],
            };
        },
    );
}

/**
 * Ein neues Bild vor der Freigabe: neues Asset samt Eingang, die Einreichung zurück auf `incoming`, das alte Asset `rejected`. Höchstens
 * `PHOTOBOX_GRENZEN.ersetzungenJeEinreichung` Mal je Einreichung, die nächste ist 409 `photobox_replace_limit`.
 */
export async function bildErsetzen(
    db: Database,
    store: MediaStore,
    umgebung: AuthEnvironment,
    body: PhotoboxBildErsetzen,
    log: GlockeLog = OHNE_PROTOKOLL,
): Promise<void> {
    const bild = pruefeBild(body.bild);
    await alsEinreicher(
        db,
        umgebung,
        {
            operationId: body.operationId,
            operation: "photobox.replace_image",
            schluessel: body.schluessel,
            inhalt: { bild: sha256Of(bild.bytes) },
            aktion: "bild",
        },
        async (tx, einreichung) => {
            // Der Deckel zählt die Zeilen des Eingangs (die erste ist die Einreichung selbst); die Einreichung ist gesperrt, zwei Ersetzungen zugleich
            // sehen also nie denselben Stand. Gezählt wird VOR dem Ablegen der Bytes: Eine abgewiesene Ersetzung schreibt keine Datei.
            const [eingang] = await tx<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_ingest WHERE submission_id = ${einreichung.id}::bigint
            `;
            if ((eingang?.n ?? 0) > PHOTOBOX_GRENZEN.ersetzungenJeEinreichung) throw ersetzungenErschoepft();
            const alt = await aktuellesAsset(tx, einreichung.id);
            const neu = await legeBildAn(tx, store, bild, {
                submissionId: einreichung.id,
                submissionPublicId: einreichung.publicId,
                entstehung: einreichung.creationKind,
                nutzung: einreichung.usageGrant,
                name: einreichung.attributionName,
            });
            if (alt !== undefined) await nehmeAssetAus(tx, alt.id);
            const revision = await setzeZustand(tx, einreichung.id, "incoming");
            const abgleich = await enqueueSettle(tx, {
                assetPublicId: neu.publicId,
                role: "photobox",
                actorPersonId: PHOTOBOX_AUSLOESER,
            });
            await meldeNeuesReisebild(tx, log, umgebung, body.operationId);
            return {
                revision,
                derivedWork: [abgleich],
                entries: [
                    {
                        action: "photobox.image_replaced",
                        assetId: neu.publicId,
                        targetRevision: revision,
                        details: {
                            format: neu.format,
                            byteSize: neu.byteSize,
                            sha256: neu.sha256,
                            replaced: alt?.publicId ?? null,
                        },
                    },
                ],
            };
        },
    );
}

/** Zurückziehen, nur vor der Freigabe: `withdrawn`, das Bild ist abgelehnt (nie mehr bindbar); die Aufbewahrung löscht es 30 Tage danach. */
export async function zurueckziehen(
    db: Database,
    umgebung: AuthEnvironment,
    body: PhotoboxZurueckziehen,
): Promise<void> {
    await alsEinreicher(
        db,
        umgebung,
        {
            operationId: body.operationId,
            operation: "photobox.withdraw",
            schluessel: body.schluessel,
            inhalt: {},
            aktion: "zurueckziehen",
        },
        async (tx, einreichung) => {
            const asset = await aktuellesAsset(tx, einreichung.id);
            if (asset !== undefined) await nehmeAssetAus(tx, asset.id);
            const revision = await setzeZustand(tx, einreichung.id, "withdrawn");
            return {
                revision,
                entries: [
                    {
                        action: "photobox.withdrawn",
                        assetId: asset?.publicId ?? null,
                        targetRevision: revision,
                        details: { previous: einreichung.state },
                    },
                ],
            };
        },
    );
}

export interface VeroeffentlichteDatei {
    id: string;
    storage_key: string;
    sha256: string;
}

export interface OfflineErgebnis {
    /** Die neue Revision der Einreichung. */
    revision: number;
    /** Die öffentlichen Dateien, die nach dem Commit zu löschen sind (`entferneVeroeffentlichte`). */
    dateien: VeroeffentlichteDatei[];
    /** Der Abgleich, der in derselben Transaktion eingereiht wurde. */
    abgleich: DerivedWork[];
    /** Das freigegebene Medium (sonst das jüngste), an dem das Protokoll die Zeile schreibt. */
    assetPublicId: string | null;
}

/**
 * Der Kern des Offline-Nehmens, für den Einreicher (`offlineNehmen`) und die Redaktion (`photobox/redaktion.ts`) derselbe: alle Assets der
 * Einreichung `rejected` (`decidePublication` hält sie überall zurück), die Verwendung der Rolle photobox zurückgezogen (`photobox_media.retired_at`,
 * sonst hielte sie die Aufbewahrung für immer), der Zustand `offline`, ein Abgleich für das freigegebene Medium (er nimmt eine noch vorhandene
 * öffentliche Datei weg). Wer fragt, prüft vorher, dass die Einreichung freigegeben ist. `ausloeser` ist der Auslöser des Abgleichs: beim
 * Einreicher die Bezeichnung `photobox`, bei der Redaktion die Person.
 */
export async function nimmEinreichungOffline(
    tx: Queryable,
    einreichung: { id: string; approvedAssetId: string | null },
    ausloeser: string,
): Promise<OfflineErgebnis> {
    const assets = await tx<{ id: string; public_id: string }[]>`
        SELECT a.id::text AS id, a.public_id::text AS public_id
          FROM media_asset a
         WHERE a.id IN (SELECT media_asset_id FROM media_ingest WHERE submission_id = ${einreichung.id}::bigint)
            OR a.id = ${einreichung.approvedAssetId}::bigint
         ORDER BY a.id
    `;
    const ids = assets.map((asset) => asset.id);
    await tx`UPDATE media_asset SET moderation_state = 'rejected' WHERE id = ANY(${ids}::bigint[]) AND moderation_state <> 'rejected'`;
    const dateien = await tx<VeroeffentlichteDatei[]>`
        SELECT id::text AS id, storage_key, sha256 FROM media_file
         WHERE media_asset_id = ANY(${ids}::bigint[]) AND storage_class = 'published'
    `;
    await tx`
        UPDATE photobox_media SET retired_at = now()
         WHERE media_submission_id = ${einreichung.id}::bigint AND retired_at IS NULL
    `;
    const revision = await setzeZustand(tx, einreichung.id, "offline");
    const freigegeben = assets.find((asset) => asset.id === einreichung.approvedAssetId) ?? assets.at(-1);
    const abgleich =
        freigegeben === undefined
            ? []
            : [
                  await enqueueSettle(tx, {
                      assetPublicId: freigegeben.public_id,
                      role: "photobox",
                      actorPersonId: ausloeser,
                  }),
              ];
    return { revision, dateien, abgleich, assetPublicId: freigegeben?.public_id ?? null };
}

/**
 * Offline nehmen, nur nach der Freigabe: `offline`, alle Assets der Einreichung `rejected` (`decidePublication` hält sie überall zurück), die
 * öffentliche Datei sofort weg. Die Dateien werden erst NACH dem Commit der Transaktion gelöscht: Scheitert die Operation, bleibt ein Bild nicht ohne
 * Datei zurück. Ein Absturz zwischen Commit und Löschen heilt der `media_settle`-Auftrag derselben Transaktion (er nimmt die veröffentlichte Datei
 * eines abgelehnten Assets weg). Die Verwendung der Rolle photobox wird zurückgezogen (`nimmEinreichungOffline`).
 */
export async function offlineNehmen(
    db: Database,
    store: MediaStore,
    umgebung: AuthEnvironment,
    body: PhotoboxOffline,
): Promise<void> {
    let dateien: VeroeffentlichteDatei[] = [];
    await alsEinreicher(
        db,
        umgebung,
        {
            operationId: body.operationId,
            operation: "photobox.offline",
            schluessel: body.schluessel,
            inhalt: {},
            aktion: "offline",
        },
        async (tx, einreichung) => {
            const ergebnis = await nimmEinreichungOffline(tx, einreichung, PHOTOBOX_AUSLOESER);
            dateien = ergebnis.dateien;
            return {
                revision: ergebnis.revision,
                derivedWork: ergebnis.abgleich,
                entries: [
                    {
                        action: "photobox.offline",
                        assetId: ergebnis.assetPublicId,
                        targetRevision: ergebnis.revision,
                        details: { previous: einreichung.state, files: dateien.length },
                    },
                ],
            };
        },
    );
    // Offline wirkt sofort, auch durch den Zwischenspeicher des Lesepfads der Karte (S4): gleich nach dem Commit, vor dem Löschen der Dateien.
    vergissReisebilder();
    await entferneVeroeffentlichte(db, store, dateien);
}

/**
 * Nach dem Commit: die öffentlichen Dateien und ihre Kopien in der Quarantäne weg, erst die Datei, dann die Zeile. Eine Datei bleibt, wenn eine ANDERE
 * Zeile sie hält (bytegleiche Werke teilen sich ihre Datei). Ein Fehler hier wirft nicht mehr: Die Operation ist geschehen, der Auftrag räumt nach.
 */
export async function entferneVeroeffentlichte(
    db: Database,
    store: MediaStore,
    dateien: readonly VeroeffentlichteDatei[],
): Promise<void> {
    const ids = dateien.map((datei) => datei.id);
    for (const datei of dateien) {
        try {
            const [gehalten] = await db<{ held: boolean }[]>`
                SELECT EXISTS (
                    SELECT 1 FROM media_file WHERE storage_key = ${datei.storage_key} AND id <> ALL(${ids}::bigint[])
                ) AS held
            `;
            if (gehalten?.held !== true) {
                await store.remove(datei.storage_key);
                await store.removeQuarantined(datei.sha256);
            }
            await db`DELETE FROM media_file WHERE id = ${datei.id}::bigint`;
        } catch {
            // Der Auftrag `media_settle` (in der Transaktion eingereiht) nimmt die Datei eines abgelehnten Assets weg.
        }
    }
}

/**
 * Die Lizenzwahl ändern: vor der Freigabe beliebig, danach nur noch zu `cc-by-4.0` (`photoboxAktionErlaubt` mit dem Ziel). Eine Avesmaps-Aufnahme
 * unter CC BY ist 422. Die Rechte des aktuellen Assets folgen der Wahl; der Prüfstand bleibt, wie er ist.
 */
export async function nutzungSetzen(db: Database, umgebung: AuthEnvironment, body: PhotoboxNutzung): Promise<void> {
    await alsEinreicher(
        db,
        umgebung,
        {
            operationId: body.operationId,
            operation: "photobox.set_grant",
            schluessel: body.schluessel,
            inhalt: { nutzung: body.nutzung },
            aktion: "nutzung",
            nutzungZiel: body.nutzung,
        },
        async (tx, einreichung) => {
            if (!photoboxGrantAllowed(einreichung.creationKind, body.nutzung)) {
                throw ungueltig(
                    "Eine Aufnahme aus Avesmaps gibt es nur für Avesmaps, nicht unter CC BY.",
                    "cc_by_avesmaps",
                );
            }
            const [row] = await tx<{ revision: number }[]>`
                UPDATE media_submission SET usage_grant = ${body.nutzung} WHERE id = ${einreichung.id}::bigint
                RETURNING revision::int AS revision
            `;
            const asset = await aktuellesAsset(tx, einreichung.id);
            const abgleich: DerivedWork[] = [];
            if (asset !== undefined) {
                const rechte = PHOTOBOX_RIGHTS[body.nutzung];
                const familie = await lizenzfamilie(tx, rechte.licenseKey);
                await tx`
                    UPDATE media_rights
                       SET rights_basis = ${rechte.basis}, license_key = ${rechte.licenseKey}, license_family = ${familie}
                     WHERE media_asset_id = ${asset.id}::bigint
                `;
                // Nach der Freigabe kann die Wahl ändern, was die Policy zulässt: der Abgleich rechnet es nach.
                if (einreichung.state === "approved") {
                    abgleich.push(
                        await enqueueSettle(tx, {
                            assetPublicId: asset.publicId,
                            role: "photobox",
                            actorPersonId: PHOTOBOX_AUSLOESER,
                        }),
                    );
                }
            }
            return {
                revision: row!.revision,
                derivedWork: abgleich,
                entries: [
                    {
                        action: "photobox.grant_set",
                        assetId: asset?.publicId ?? null,
                        targetRevision: row!.revision,
                        details: { grant: body.nutzung, previous: einreichung.usageGrant },
                    },
                ],
            };
        },
    );
}
