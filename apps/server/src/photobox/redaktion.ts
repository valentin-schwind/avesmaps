import type {
    DerivedWork,
    OperationReceipt,
    PhotoboxRedaktionAblehnen,
    PhotoboxRedaktionErneutPruefen,
    PhotoboxRedaktionFreigeben,
    PhotoboxRedaktionKorrigieren,
    PhotoboxRedaktionOffline,
    PhotoboxRedaktionRueckfrage,
    PhotoboxSubmissionState,
} from "@avesmaps3d/shared";
import { randomUUID } from "node:crypto";
import type { Sql } from "../auth/session-store.ts";
import type { AuthEnvironment } from "../auth/config.ts";
import type { Database, Queryable } from "../database.ts";
import { notFound } from "../media-editor/asset-operations.ts";
import { mediaEditConflict } from "../media-editor/audit.ts";
import { mediaOperation, type MediaActor, type MediaAuditEntry } from "../media-editor/operation-store.ts";
import { enqueueSettle } from "../media-editor/settle.ts";
import type { MediaStore } from "../media/storage.ts";
import {
    PHOTOBOX_AUSLOESER,
    aktuellesAsset,
    bereinigt,
    photoboxAkteur,
    technikNachziehen,
    uebergangFehlt,
    ungueltig,
} from "./db.ts";
import { vergissReisebilder } from "./karte.ts";
import { entferneVeroeffentlichte, nimmEinreichungOffline, type VeroeffentlichteDatei } from "./status.ts";

/**
 * Die Redaktion prüft und gibt Reisebilder frei (WI-0272 S3, §12): freigeben, Rückfrage, ablehnen, korrigieren und eine freigegebene Einreichung
 * zurücknehmen oder erneut zur Prüfung stellen. Alles geschieht in der Medienverwaltung als benannte Operation (`photobox.approve`, `.ask`, `.reject`, `.correct`, `.offline`, `.reopen`) mit
 * Quittung und Fachprotokoll; Kartendaten schreibt keine (`place` wird nur gelesen, für den Ort bei „korrigieren“).
 *
 * - **Revision der Einreichung (ADR-0020):** Jede Operation trägt die Revision, die die Oberfläche sah (`baseRevision`, `media_submission.revision`); eine
 *   andere ist 409 `edit_conflict` (mit „wer, wann“ aus dem Fachprotokoll, Ziel `photobox`).
 * - **Übergang nach der technischen Prüfung nachgezogen:** Vor jeder Operation zieht `technikNachziehen` die Einreichung von `incoming` auf `pending` oder
 *   `technical_failed`, wenn das Bild geprüft ist (der Abgleich schreibt die Tafel nicht). Die Revision, die eine Operation prüft, ist die danach.
 * - **Ein Zustand, ein Übergang:** freigeben aus `pending` und `changes_requested` (und, wenn eine Beschreibung wartet, auch aus `approved`);
 *   Rückfrage und Ablehnen aus `pending` und `changes_requested`; korrigieren davor und, nur für die Beschreibung, danach; offline nur aus `approved`.
 *   Alles andere ist 409 `photobox_transition`. `state_changed_at` setzt jeder Wechsel des Zustands (die Fristen der Aufbewahrung zählen ab ihm), eine Operation
 *   ohne Wechsel (zweite Rückfrage, korrigieren) lässt ihn stehen.
 * - 🔴 **Freigeben legt die Verwendung an** (`photobox_media`, Rolle `photobox`) und reiht den Abgleich ein; öffentlich wird das Bild erst, wenn die Policy
 *   es erlaubt (Freigaberegel der Rolle). Die Freigabe selbst rührt keine Datei an und ruft kein sharp (MEDIA-M7: nur im Worker). Die Quelle trägt schon seit dem
 *   Eingang keine Metadaten (`photobox/metadaten.ts`, beim Einreichen und Ersetzen).
 * - **Freitexte nur unter `note` und `reason`** im Protokoll (Schwärzung beim Auflösen eines Kontos); sonst stehen dort Codes, Zahlen und Feldnamen.
 */

/** Die gesperrte Einreichung, so wie die Operationen sie brauchen. */
interface Gesperrt {
    id: string;
    publicId: string;
    revision: number;
    updatedAt: Date;
    state: PhotoboxSubmissionState;
    pendingDescription: string | null;
    approvedAssetId: string | null;
    mapDomainId: string;
}

interface GesperrtRow {
    id: string;
    public_id: string;
    revision: number;
    updated_at: Date;
    state: PhotoboxSubmissionState;
    pending_description: string | null;
    approved_asset: string | null;
    map_domain_id: string;
}

/**
 * Die Einreichung zur öffentlichen Kennung, gesperrt bis zum Ende der Transaktion (zwei Operationen an derselben Einreichung laufen nacheinander); 404, wenn
 * es sie nicht gibt. Eine eingegangene Einreichung, deren Bild geprüft ist, wechselt vorher in `pending` oder `technical_failed`.
 */
async function sperre(tx: Queryable, publicId: string): Promise<Gesperrt> {
    const lies = async (): Promise<GesperrtRow | undefined> => {
        const [row] = await tx<GesperrtRow[]>`
            SELECT s.id::text AS id, s.public_id::text AS public_id, s.revision::int AS revision, s.updated_at, s.state, s.pending_description,
                   s.approved_media_asset_id::text AS approved_asset, s.map_domain_id
              FROM media_submission s
             WHERE s.public_id = ${publicId}::uuid
               FOR UPDATE OF s
        `;
        return row;
    };
    let row = await lies();
    if (row === undefined) throw notFound("Dieses Reisebild");
    if (row.state === "incoming" && (await technikNachziehen(tx, row.id)) > 0) row = (await lies()) ?? row;
    return {
        id: row.id,
        publicId: row.public_id,
        revision: row.revision,
        updatedAt: row.updated_at,
        state: row.state,
        pendingDescription: row.pending_description,
        approvedAssetId: row.approved_asset,
        mapDomainId: row.map_domain_id,
    };
}

/** 409 `edit_conflict`, wenn die Einreichung nicht mehr die Revision hat, die die Oberfläche sah. */
async function pruefeStand(tx: Queryable, einreichung: Gesperrt, baseRevision: number): Promise<void> {
    if (einreichung.revision === baseRevision) return;
    const asset = await aktuellesAsset(tx, einreichung.id);
    throw await mediaEditConflict(
        tx,
        { record: "photobox", assetId: asset?.publicId ?? einreichung.publicId },
        { revision: einreichung.revision, changedAt: einreichung.updatedAt },
    );
}

interface Spur {
    revision: number;
    derivedWork?: DerivedWork[];
    entries: MediaAuditEntry[];
}

interface RedaktionsEingabe {
    operationId: string;
    operation: string;
    id: string;
    baseRevision: number;
    /** Der Inhalt der Anfrage ohne Kennung und Revision: daran erkennt `mediaOperation` eine Wiederholung. */
    inhalt: Record<string, unknown>;
}

/**
 * Eine Operation der Redaktion: die Einreichung gesperrt lesen (404), den Stand prüfen (409), dann `work`. Operation und Fachprotokoll stehen in derselben
 * Transaktion wie die Änderung; die Quittung nennt die Einreichung mit ihrer neuen Revision.
 */
async function alsRedaktion(
    db: Database,
    actor: MediaActor,
    eingabe: RedaktionsEingabe,
    work: (tx: Sql, einreichung: Gesperrt) => Promise<Spur>,
): Promise<OperationReceipt> {
    return mediaOperation(
        db,
        actor,
        {
            operationId: eingabe.operationId,
            operation: eingabe.operation,
            body: { id: eingabe.id, baseRevision: eingabe.baseRevision, ...eingabe.inhalt },
        },
        async (tx) => {
            const einreichung = await sperre(tx, eingabe.id);
            await pruefeStand(tx, einreichung, eingabe.baseRevision);
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

/** Vor der Entscheidung: Die Redaktion prüft diese beiden Zustände (`incoming` ist noch nicht geprüft, `technical_failed` nicht lesbar). */
const ZUR_PRUEFUNG: readonly PhotoboxSubmissionState[] = ["pending", "changes_requested"];

// --- Freigeben ------------------------------------------------------------------------------------------------------------------

/**
 * Freigeben (`moderate_submissions`): aus `pending` oder `changes_requested` nach `approved`, mit `decided_at`, dem aktuellen Asset als freigegebenem Medium
 * und einer wartenden Beschreibung als Beschreibung. Das Medium wird `approved`, die Verwendung der Rolle photobox entsteht, der Abgleich wird eingereiht
 * (er rechnet die Fassungen, im Worker). Ist die Einreichung schon freigegeben und wartet eine Beschreibung des Einreichers,
 * übernimmt dieselbe Operation sie (ohne neue Verwendung und ohne neuen Abgleich); sonst ist es 409.
 */
export async function freigeben(
    db: Database,
    actor: MediaActor,
    id: string,
    body: PhotoboxRedaktionFreigeben,
): Promise<OperationReceipt> {
    const quittung = await alsRedaktion(
        db,
        actor,
        {
            operationId: body.operationId,
            operation: "photobox.approve",
            id,
            baseRevision: body.baseRevision,
            inhalt: {},
        },
        async (tx, einreichung) => {
            if (einreichung.state === "approved") {
                if (einreichung.pendingDescription === null) throw uebergangFehlt(einreichung.state, "nichts_wartet");
                const asset = await aktuellesAsset(tx, einreichung.id);
                const [row] = await tx<{ revision: number }[]>`
                    UPDATE media_submission SET description = pending_description, pending_description = NULL
                     WHERE id = ${einreichung.id}::bigint
                    RETURNING revision::int AS revision
                `;
                return {
                    revision: row!.revision,
                    entries: [
                        {
                            action: "photobox.approved",
                            assetId: asset?.publicId ?? null,
                            targetRevision: row!.revision,
                            details: { previous: "approved", descriptionAccepted: true },
                        },
                    ],
                };
            }
            return gibFrei(tx, einreichung, actor.personId);
        },
    );
    // Vali: „was cool wär wenn gleich nach freigabe das bild erscheinen würde“. Der Speicher des Lesepfads hält sonst bis zu 15 s die Antwort ohne das Bild.
    vergissReisebilder();
    return quittung;
}

/**
 * Der Kern der Freigabe einer Einreichung (WI-0272 S4, herausgezogen aus `freigeben`): Medium und Einreichung `approved`, die Verwendung der Rolle photobox, der Abgleich
 * eingereiht. Aus `pending` oder `changes_requested` und nur bei technisch geprüftem Bild (409 `photobox_transition` sonst). `ausloeser` ist die Person, die den Abgleich
 * auslöst, oder die Bezeichnung `photobox` (`PHOTOBOX_AUSLOESER`) für die Beispielbilder, bei denen niemand handelt. Die Einreichung ist gesperrt (`sperre`); die Revision prüft, wer sie von einer Oberfläche bekam.
 */
async function gibFrei(tx: Sql, einreichung: Gesperrt, ausloeser: string): Promise<Spur> {
    const asset = await aktuellesAsset(tx, einreichung.id);
    if (!ZUR_PRUEFUNG.includes(einreichung.state) || asset === undefined) throw uebergangFehlt(einreichung.state);
    const [fakten] = await tx<{ technical_state: string }[]>`
        SELECT technical_state FROM media_asset WHERE id = ${asset.id}::bigint
    `;
    if (fakten?.technical_state !== "ok") throw uebergangFehlt(einreichung.state, "technik_nicht_fertig");

    await tx`UPDATE media_asset SET moderation_state = 'approved' WHERE id = ${asset.id}::bigint`;
    const [row] = await tx<{ revision: number }[]>`
        UPDATE media_submission
           SET state = 'approved', state_changed_at = now(), decided_at = now(), approved_media_asset_id = ${asset.id}::bigint,
               description = COALESCE(pending_description, description), pending_description = NULL, editor_message = NULL
         WHERE id = ${einreichung.id}::bigint
        RETURNING revision::int AS revision
    `;
    await tx`
        INSERT INTO photobox_media (media_submission_id, media_asset_id) VALUES (${einreichung.id}::bigint, ${asset.id}::bigint)
    `;
    const abgleich = await enqueueSettle(tx, {
        assetPublicId: asset.publicId,
        role: "photobox",
        actorPersonId: ausloeser,
    });
    return {
        revision: row!.revision,
        derivedWork: [abgleich],
        entries: [
            {
                action: "photobox.approved",
                assetId: asset.publicId,
                targetRevision: row!.revision,
                details: {
                    previous: einreichung.state,
                    descriptionAccepted: einreichung.pendingDescription !== null,
                },
            },
        ],
    };
}

/**
 * Gibt eine Einreichung frei, ohne dass ein Konto handelt (die persistenten Beispielbilder, `photobox/beispiele.ts`): dieselbe Freigabe wie die der Redaktion
 * (`gibFrei`), als Operation `photobox.approve` des anonymen Handelnden `photobox` mit eigener Kennung (die Operationen überleben einen Zug von Production, eine feste
 * Kennung fände danach eine Quittung, die zu nichts mehr gehört). Die Revision der Oberfläche entfällt: Niemand hat die Einreichung gesehen.
 */
export async function gibFreiOhneKonto(db: Database, umgebung: AuthEnvironment, einreichungId: string): Promise<void> {
    await mediaOperation(
        db,
        photoboxAkteur(umgebung),
        { operationId: randomUUID(), operation: "photobox.approve", body: { id: einreichungId } },
        async (tx) => {
            const einreichung = await sperre(tx, einreichungId);
            const spur = await gibFrei(tx, einreichung, PHOTOBOX_AUSLOESER);
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
    vergissReisebilder();
}

// --- Rückfrage und Ablehnung ----------------------------------------------------------------------------------------------------

/**
 * Rückfrage (`moderate_submissions`): aus `pending` oder `changes_requested` nach `changes_requested`; die Nachricht steht auf der Statusseite des
 * Einreichers (`editor_message`). Eine zweite Rückfrage ersetzt die Nachricht, ohne den Zustandswechsel neu zu zählen. Das Medium bleibt wartend.
 */
export async function rueckfragen(
    db: Database,
    actor: MediaActor,
    id: string,
    body: PhotoboxRedaktionRueckfrage,
): Promise<OperationReceipt> {
    const nachricht = bereinigt(body.nachricht, "Die Nachricht", "nachricht");
    return alsRedaktion(
        db,
        actor,
        {
            operationId: body.operationId,
            operation: "photobox.ask",
            id,
            baseRevision: body.baseRevision,
            inhalt: { nachricht },
        },
        async (tx, einreichung) => {
            if (!ZUR_PRUEFUNG.includes(einreichung.state)) throw uebergangFehlt(einreichung.state);
            const asset = await aktuellesAsset(tx, einreichung.id);
            const [row] = await tx<{ revision: number }[]>`
                UPDATE media_submission
                   SET state = 'changes_requested',
                       state_changed_at = CASE WHEN state IS DISTINCT FROM 'changes_requested' THEN now() ELSE state_changed_at END,
                       decided_at = now(), editor_message = ${nachricht}
                 WHERE id = ${einreichung.id}::bigint
                RETURNING revision::int AS revision
            `;
            return {
                revision: row!.revision,
                entries: [
                    {
                        action: "photobox.asked",
                        assetId: asset?.publicId ?? null,
                        targetRevision: row!.revision,
                        details: { previous: einreichung.state, note: nachricht },
                    },
                ],
            };
        },
    );
}

/**
 * Ablehnen (`moderate_submissions`): aus `pending` oder `changes_requested` nach `rejected`; der Grund steht auf der Statusseite, das Medium wird `rejected`
 * (nie mehr bindbar), die Aufbewahrung löscht es 30 Tage danach. Ein Abgleich ist nicht nötig: Das Bild war nie öffentlich, und die Quelle trägt schon seit dem Eingang keine Metadaten.
 */
export async function ablehnen(
    db: Database,
    actor: MediaActor,
    id: string,
    body: PhotoboxRedaktionAblehnen,
): Promise<OperationReceipt> {
    const grund = bereinigt(body.grund, "Der Grund", "grund");
    return alsRedaktion(
        db,
        actor,
        {
            operationId: body.operationId,
            operation: "photobox.reject",
            id,
            baseRevision: body.baseRevision,
            inhalt: { grund },
        },
        async (tx, einreichung) => {
            if (!ZUR_PRUEFUNG.includes(einreichung.state)) throw uebergangFehlt(einreichung.state);
            const asset = await aktuellesAsset(tx, einreichung.id);
            if (asset !== undefined) {
                await tx`
                    UPDATE media_asset SET moderation_state = 'rejected' WHERE id = ${asset.id}::bigint AND moderation_state <> 'rejected'
                `;
            }
            const [row] = await tx<{ revision: number }[]>`
                UPDATE media_submission
                   SET state = 'rejected', state_changed_at = now(), decided_at = now(), editor_message = ${grund}
                 WHERE id = ${einreichung.id}::bigint
                RETURNING revision::int AS revision
            `;
            return {
                revision: row!.revision,
                entries: [
                    {
                        action: "photobox.rejected",
                        assetId: asset?.publicId ?? null,
                        targetRevision: row!.revision,
                        details: { previous: einreichung.state, reason: grund },
                    },
                ],
            };
        },
    );
}

// --- Korrigieren ----------------------------------------------------------------------------------------------------------------

/**
 * Korrigieren (`moderate_submissions`): Stelle, Ort, Bezug und Beschreibung berichtigen; `adjusted_by_editors` wird gesetzt (die Statusseite zeigt „von
 * der Redaktion angepasst“). Stelle, Ort und Bezug nur vor der Freigabe (`pending`, `changes_requested`), die Beschreibung auch danach (sie leert eine
 * wartende Beschreibung); sonst 409. `null` entfernt Ort oder Bezug. Die Stelle wird wie beim Einreichen in der Kartendomäne geprüft, der Ort ist ein aktiver Ort der
 * Karte (nur gelesen). Der Zustand bleibt, also auch sein Zeitpunkt.
 */
export async function korrigieren(
    db: Database,
    actor: MediaActor,
    id: string,
    body: PhotoboxRedaktionKorrigieren,
): Promise<OperationReceipt> {
    const { lage, placeId, bezug } = body;
    if (lage === undefined && placeId === undefined && bezug === undefined && body.beschreibung === undefined) {
        throw ungueltig("Es gibt nichts zu korrigieren.", "nichts_zu_korrigieren");
    }
    const beschreibung =
        body.beschreibung === undefined
            ? undefined
            : bereinigt(body.beschreibung, "Die Bildbeschreibung", "beschreibung");
    const felder = [
        ...(lage === undefined ? [] : ["lage"]),
        ...(placeId === undefined ? [] : ["placeId"]),
        ...(bezug === undefined ? [] : ["bezug"]),
        ...(beschreibung === undefined ? [] : ["beschreibung"]),
    ];
    return alsRedaktion(
        db,
        actor,
        {
            operationId: body.operationId,
            operation: "photobox.correct",
            id,
            baseRevision: body.baseRevision,
            inhalt: { lage, placeId, bezug, beschreibung },
        },
        async (tx, einreichung) => {
            const vorFreigabe = ZUR_PRUEFUNG.includes(einreichung.state);
            const nurText = lage === undefined && placeId === undefined && bezug === undefined;
            if (!vorFreigabe && !(einreichung.state === "approved" && nurText)) throw uebergangFehlt(einreichung.state);

            if (lage !== undefined) {
                const [innen] = await tx<{ innen: boolean | null }[]>`
                    SELECT map_domain_contains(${einreichung.mapDomainId}, ST_SetSRID(ST_MakePoint(${lage.x}::float8, ${lage.y}::float8), 0)) AS innen
                `;
                if (innen?.innen !== true)
                    throw ungueltig("Diese Stelle liegt nicht auf der Karte.", "stelle_ausserhalb");
            }
            let ortId: string | null = null;
            if (typeof placeId === "string") {
                const [ort] = await tx<{ id: string }[]>`
                    SELECT id::text AS id FROM place
                     WHERE public_id = ${placeId}::uuid AND map_domain_id = ${einreichung.mapDomainId} AND is_active
                `;
                if (ort === undefined) throw ungueltig("Diesen Ort gibt es nicht.", "ort_unbekannt");
                ortId = ort.id;
            }
            const asset = await aktuellesAsset(tx, einreichung.id);
            const [row] = await tx<{ revision: number }[]>`
                UPDATE media_submission
                   SET adjusted_by_editors = true,
                       geom = CASE WHEN ${lage !== undefined} THEN ST_SetSRID(ST_MakePoint(${lage?.x ?? null}::float8, ${lage?.y ?? null}::float8), 0) ELSE geom END,
                       place_id = CASE WHEN ${placeId !== undefined} THEN ${ortId}::bigint ELSE place_id END,
                       reference_kind = CASE WHEN ${bezug !== undefined} THEN ${bezug?.art ?? null}::text ELSE reference_kind END,
                       reference_key = CASE WHEN ${bezug !== undefined} THEN ${bezug?.id ?? null}::text ELSE reference_key END,
                       description = CASE WHEN ${beschreibung !== undefined} THEN ${beschreibung ?? null}::text ELSE description END,
                       pending_description = CASE WHEN ${beschreibung !== undefined} THEN NULL ELSE pending_description END
                 WHERE id = ${einreichung.id}::bigint
                RETURNING revision::int AS revision
            `;
            return {
                revision: row!.revision,
                entries: [
                    {
                        action: "photobox.corrected",
                        assetId: asset?.publicId ?? null,
                        targetRevision: row!.revision,
                        details: { previous: einreichung.state, fields: felder },
                    },
                ],
            };
        },
    );
}

// --- Offline nehmen -------------------------------------------------------------------------------------------------------------

/**
 * Offline nehmen (`publish_media`, ab Editor): eine freigegebene Einreichung zurücknehmen. Wirkung wie die Offline-Aktion des Einreichers
 * (`nimmEinreichungOffline`): alle Medien der Einreichung `rejected`, die Verwendung der Rolle photobox zurückgezogen, die öffentliche Datei sofort weg
 * (nach dem Commit; der Abgleich derselben Transaktion räumt nach, falls dazwischen etwas abbricht). Alle übrigen Dateien löscht der nächste tägliche Lauf der
 * Aufbewahrung, die Angaben nach 30 Tagen.
 */
export async function nehmeOffline(
    db: Database,
    store: MediaStore,
    actor: MediaActor,
    id: string,
    body: PhotoboxRedaktionOffline,
): Promise<OperationReceipt> {
    let dateien: VeroeffentlichteDatei[] = [];
    const quittung = await alsRedaktion(
        db,
        actor,
        {
            operationId: body.operationId,
            operation: "photobox.offline",
            id,
            baseRevision: body.baseRevision,
            inhalt: {},
        },
        async (tx, einreichung) => {
            if (einreichung.state !== "approved") throw uebergangFehlt(einreichung.state);
            const ergebnis = await nimmEinreichungOffline(tx, einreichung, actor.personId);
            dateien = ergebnis.dateien;
            return {
                revision: ergebnis.revision,
                derivedWork: ergebnis.abgleich,
                entries: [
                    {
                        action: "photobox.taken_offline",
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
    return quittung;
}

// --- Erneut zur Prüfung ---------------------------------------------------------------------------------------------------------

/**
 * Erneut zur Prüfung (`moderate_submissions`, Vali 2026-11-09: „Nach der Freigabe sollte Medien ‚Erneut zur Prüfung‘ gestellt werden können“): eine
 * freigegebene Einreichung zurück nach `pending`, als wäre sie nie entschieden. Anders als „Offline nehmen“ endet nichts: Das Medium wird wieder `pending`,
 * die Verwendung der Rolle photobox fällt weg (Kopf, Karte, Leiste und Bildansicht lesen über sie), `decided_at` und das freigegebene Medium werden leer,
 * und die Einreichung steht wieder unter „PhotoBox-Uploads › Offen“. Die nächste Freigabe legt die Verwendung neu an (`gibFrei`; `photobox_media` erlaubt
 * eine Zeile je Einreichung, darum wird sie gelöscht, nicht zurückgezogen). Der Abgleich nimmt die öffentliche Fassung weg, sobald die Policy NEIN sagt.
 * Nur aus `approved`; sonst 409 `photobox_transition`.
 */
export async function erneutPruefen(
    db: Database,
    actor: MediaActor,
    id: string,
    body: PhotoboxRedaktionErneutPruefen,
): Promise<OperationReceipt> {
    const quittung = await alsRedaktion(
        db,
        actor,
        {
            operationId: body.operationId,
            operation: "photobox.reopen",
            id,
            baseRevision: body.baseRevision,
            inhalt: {},
        },
        async (tx, einreichung) => {
            if (einreichung.state !== "approved") throw uebergangFehlt(einreichung.state);
            const asset = await aktuellesAsset(tx, einreichung.id);
            const freigegeben = einreichung.approvedAssetId ?? asset?.id ?? null;
            if (freigegeben !== null) {
                await tx`UPDATE media_asset SET moderation_state = 'pending' WHERE id = ${freigegeben}::bigint AND moderation_state = 'approved'`;
            }
            await tx`DELETE FROM photobox_media WHERE media_submission_id = ${einreichung.id}::bigint`;
            const [row] = await tx<{ revision: number; public_id: string | null }[]>`
                UPDATE media_submission s
                   SET state = 'pending', state_changed_at = now(), decided_at = NULL, approved_media_asset_id = NULL, editor_message = NULL
                 WHERE s.id = ${einreichung.id}::bigint
                RETURNING s.revision::int AS revision,
                          (SELECT a.public_id::text FROM media_asset a WHERE a.id = ${freigegeben}::bigint) AS public_id
            `;
            const assetPublicId = row!.public_id ?? asset?.publicId ?? null;
            const abgleich =
                assetPublicId === null
                    ? []
                    : [await enqueueSettle(tx, { assetPublicId, role: "photobox", actorPersonId: actor.personId })];
            return {
                revision: row!.revision,
                derivedWork: abgleich,
                entries: [
                    {
                        action: "photobox.reopened",
                        assetId: assetPublicId,
                        targetRevision: row!.revision,
                        details: { previous: einreichung.state },
                    },
                ],
            };
        },
    );
    // Wie bei der Freigabe: Der Speicher des Lesepfads hielte das Bild sonst bis zu 15 s noch auf Karte, Leiste und im Kopf.
    vergissReisebilder();
    return quittung;
}
