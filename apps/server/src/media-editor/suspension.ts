import type { DerivedWork, MediaSuspendBody, MediaSuspendLiftBody, OperationReceipt } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { vergissReisebilder } from "../photobox/karte.ts";
import { reiheQuarantaeneEin } from "../system/inhaltsschalter.ts";
import { lockAsset } from "./asset-operations.ts";
import { mediaEditConflict } from "./audit.ts";
import { mediaOperation, type MediaActor, type MediaAuditEntry } from "./operation-store.ts";
import { enqueueSettleForActiveRoles } from "./settle.ts";

/**
 * Der Einzelbild-Notaus (WI-0068; Betreiber 2026-10-10 zu SYS-0001 Frage 2, wörtlich: „im mam kann man dann immernoch bilder etc
 * gezielt offline nehmen“). Tafel `media_publication_suspension` aus Migration 0086, Quarantäne der Dateien aus 0104.
 *
 * | Operation          | Recht                        | Bestätigung    | Schreibklasse |
 * |--------------------|------------------------------|----------------|---------------|
 * | `suspension.set`   | `suspend_media_publication`  | frischer Passkey | `security`  |
 * | `suspension.lift`  | `suspend_media_publication`  | frischer Passkey | `map`       |
 *
 * 🔴 **Der Notaus gilt den BYTES, nicht der Stelle.** Gegenstand ist die SHA-256 des Originals (`media_file`, Klasse
 * `private_source`). Damit verschwindet JEDE Verwendung JEDES Assets mit denselben Bytes — im Bestand teilen sich 1.025 Assets in
 * 218 Gruppen ihre Datei. Die Oberfläche nennt die betroffenen Stellen vorher; sie hat sie bereits aus `usage` und `sameFile`.
 *
 * 🔴 **Ausblenden ist ein Sicherheitshandgriff und läuft auch unter Kartensperre** (`security`, SYS-4: „Sicherheitshandgriffe und
 * Lösen immer möglich“). **Das Aufheben nicht:** Es macht Inhalt wieder öffentlich und wartet darum wie jede andere
 * Inhaltsänderung auf die Kartensperre (`map`). Wer sperrt, will nicht, dass währenddessen etwas öffentlich wird.
 *
 * 🔴 **Ein Notaus ist kein Löschen.** Asset, Bindungen, Galerieeinträge, Rechte und Provenienz bleiben unberührt; nur die
 * veröffentlichte Datei wandert unter `private/quarantine/`. Und **kein Import und kein Medienlauf hebt ihn auf**: `migrate:media`
 * schreibt die Tafel nicht, `migrate:media-files` lässt ein gehaltenes Asset ganz liegen (Befund `suspended_held`), `media_settle`
 * legt für gehaltene Bytes keine öffentliche Datei an, und `legacy:uploads-sync` schreibt ohnehin nur in das Download-Fach.
 *
 * 🪤 **Erst die Zeile, dann die Datei.** Die Tafel ist die Wahrheit; der Ort der Datei wird danach abgeglichen, im Job
 * `media_quarantine` mit der Jobs-Rolle (`media/notaus.ts`; eingereiht in der Transaktion der Operation, ohne Person, damit er auch
 * unter Kartensperre läuft). Inline als App-Rolle endete das mit 500 (WI-0189 B2). Bis der Job läuft, liegt die Datei noch unter
 * `published/`, aber niemand bekommt ihre Adresse: Der Lesepfad fragt den Notaus selbst (`publication_suspended`, S8-04).
 * 🔴 **Aufheben reiht den Abgleich je aktiver Rolle ein**, für ALLE Assets mit denselben Bytes (S8-04): Was während des Notaus an
 * Rechten oder Bindungen geändert wurde, kommt erst jetzt in den Dateien an.
 */

/** Die Bytes des Originals eines Assets; ohne sie gibt es nichts auszublenden. */
async function quellbytes(tx: Queryable, assetId: string): Promise<string> {
    const [row] = await tx<{ sha256: string }[]>`
        SELECT sha256 FROM media_file
         WHERE media_asset_id = ${assetId}::bigint AND storage_class = 'private_source'
         ORDER BY id LIMIT 1
    `;
    if (row === undefined) {
        throw new ApiError(
            409,
            "media_without_source",
            "Dieses Medium hat keine Originaldatei; der Notaus gilt den Bytes und hätte hier nichts zu fassen.",
        );
    }
    return row.sha256;
}

interface AktiverNotaus {
    id: string;
    revision: number;
    updated_at: Date;
    /** Das auslösende Werk; `null`, wenn es endgültig gelöscht ist (Migration 0328): Der Notaus gilt den Bytes und bleibt. */
    asset_public_id: string | null;
}

/**
 * Der aktive Notaus dieser Bytes. 🔴 Mit LEFT JOIN: Ist das auslösende Werk gelöscht (0328), steht die Zeile ohne Verweis da und gilt weiter. Ein JOIN fände sie nicht,
 * ein zweiter Notaus scheiterte am Teilindex `media_publication_suspension_one_active`, und an einem bytegleichen Werk ließe er sich nicht mehr aufheben.
 */
async function aktiverNotaus(tx: Queryable, sha256: string): Promise<AktiverNotaus | undefined> {
    const [row] = await tx<AktiverNotaus[]>`
        SELECT n.id::text AS id, n.revision::int AS revision, n.updated_at, a.public_id::text AS asset_public_id
          FROM media_publication_suspension n
          LEFT JOIN media_asset a ON a.id = n.media_asset_id
         WHERE n.source_sha256 = ${sha256} AND n.lifted_at IS NULL
           FOR UPDATE OF n
    `;
    return row;
}

/** Alle Assets mit diesen Bytes als Original (die Reichweite des Notaus). */
async function assetsMitBytes(tx: Queryable, sha256: string): Promise<{ assetId: string; assetPublicId: string }[]> {
    return tx<{ assetId: string; assetPublicId: string }[]>`
        SELECT DISTINCT a.id::text AS "assetId", a.public_id::text AS "assetPublicId"
          FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
         WHERE f.sha256 = ${sha256} AND f.storage_class = 'private_source'
         ORDER BY 2
    `;
}

/** Je Bild nacheinander: zwei gleichzeitige Handgriffe an denselben Bytes warten aufeinander (der Teilindex in 0086 erzwingt es ohnehin). */
async function sperreBytes(tx: Queryable, sha256: string): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`media_suspension:${sha256}`}))`;
}

/** Wie viele Assets und wie viele aktive Verwendungen an diesen Bytes hängen (nur Zahlen, für Quittung und Protokoll). */
async function umfang(tx: Queryable, sha256: string): Promise<{ assets: number; usages: number }> {
    const [row] = await tx<{ assets: number; usages: number }[]>`
        WITH betroffen AS (
            SELECT DISTINCT f.media_asset_id AS id FROM media_file f WHERE f.sha256 = ${sha256}
        )
        SELECT (SELECT count(*)::int FROM betroffen) AS assets,
               (SELECT count(*)::int FROM (
                    SELECT 1 FROM place_media m JOIN betroffen b ON b.id = m.media_asset_id WHERE m.retired_at IS NULL
                    UNION ALL
                    SELECT 1 FROM territory_media m JOIN betroffen b ON b.id = m.media_asset_id WHERE m.retired_at IS NULL
                    UNION ALL
                    SELECT 1 FROM adventure_media m JOIN betroffen b ON b.id = m.media_asset_id WHERE m.retired_at IS NULL
                    UNION ALL
                    SELECT 1 FROM citymap_media m JOIN betroffen b ON b.id = m.media_asset_id WHERE m.retired_at IS NULL
                    UNION ALL
                    SELECT 1 FROM media_gallery_item i JOIN betroffen b ON b.id = i.media_asset_id WHERE i.retired_at IS NULL
                    UNION ALL
                    SELECT 1 FROM media_type_image t JOIN betroffen b ON b.id = t.media_asset_id WHERE t.retired_at IS NULL
                    UNION ALL
                    SELECT 1 FROM photobox_media p JOIN betroffen b ON b.id = p.media_asset_id WHERE p.retired_at IS NULL
                    UNION ALL
                    SELECT 1 FROM media_asset a JOIN betroffen b ON b.id = a.id WHERE a.asset_type = 'social_post'
               ) x) AS usages
    `;
    return { assets: row?.assets ?? 0, usages: row?.usages ?? 0 };
}

/** Das Bild offline nehmen: eine Zeile, ein Pflichtgrund, danach die Datei in die Quarantäne. */
export async function suspendAsset(
    database: Database,
    actor: MediaActor,
    assetPublicId: string,
    body: MediaSuspendBody,
): Promise<OperationReceipt> {
    const reason = body.reason.trim();
    if (reason === "") {
        throw new ApiError(400, "validation_failed", "Ein Notaus braucht einen Grund.", {
            issues: [{ path: "reason", rule: "required" }],
        });
    }
    const quittung = await mediaOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "suspension.set", body: { assetId: assetPublicId } },
        async (tx) => {
            const asset = await lockAsset(tx, assetPublicId);
            const sha256 = await quellbytes(tx, asset.id);
            await sperreBytes(tx, sha256);
            const aktiv = await aktiverNotaus(tx, sha256);
            if (aktiv !== undefined) {
                throw new ApiError(
                    409,
                    "media_already_suspended",
                    "Für diese Bytes gilt schon ein Notaus.",
                    // Damit die Oberfläche gleich den Stand zeigt, an dem sie weiterarbeiten kann.
                    { currentRevision: aktiv.revision },
                );
            }
            const betroffen = await umfang(tx, sha256);
            const [zeile] = await tx<{ revision: number }[]>`
                INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
                VALUES (${sha256}, ${asset.id}, ${reason}, ${actor.personId}::uuid)
                RETURNING revision::int AS revision
            `;
            const entries: MediaAuditEntry[] = [
                {
                    action: "suspension.set",
                    assetId: asset.publicId,
                    targetRevision: zeile!.revision,
                    details: { sha256, assets: betroffen.assets, usages: betroffen.usages, reason },
                },
            ];
            return {
                receipt: {
                    affected: [{ kind: "suspension", id: sha256, revision: zeile!.revision }],
                    derivedWork: [await reiheQuarantaeneEin(tx, "asset_suspension")],
                    warnings: [],
                },
                entries,
            };
        },
    );
    // Ein Reisebild unter Notaus soll sofort von der Karte: Der Zwischenspeicher des Lesepfads (S4) fängt von vorn an.
    vergissReisebilder();
    return quittung;
}

/** Den Notaus aufheben: die Zeile wird endgültig (Migration 0088), die Datei wandert zurück, ein neuer Notaus legt eine neue an. */
export async function liftSuspension(
    database: Database,
    actor: MediaActor,
    assetPublicId: string,
    body: MediaSuspendLiftBody,
): Promise<OperationReceipt> {
    const reason = body.reason.trim();
    if (reason === "") {
        throw new ApiError(400, "validation_failed", "Das Aufheben braucht einen Grund.", {
            issues: [{ path: "reason", rule: "required" }],
        });
    }
    const quittung = await mediaOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "suspension.lift", body: { assetId: assetPublicId } },
        async (tx) => {
            const asset = await lockAsset(tx, assetPublicId);
            const sha256 = await quellbytes(tx, asset.id);
            await sperreBytes(tx, sha256);
            const aktiv = await aktiverNotaus(tx, sha256);
            if (aktiv === undefined) {
                throw new ApiError(409, "media_not_suspended", "Für diese Bytes gilt gerade kein Notaus.");
            }
            if (aktiv.revision !== body.baseRevision) {
                throw await mediaEditConflict(
                    tx,
                    { record: "suspension", assetId: aktiv.asset_public_id ?? asset.publicId },
                    { revision: aktiv.revision, changedAt: aktiv.updated_at },
                );
            }
            const betroffen = await umfang(tx, sha256);
            // 🔴 `file_state` MUSS mitgesetzt werden: `media_publication_suspension_file_state_fits` verbietet eine
            // aufgehobene Zeile, deren Datei noch als `quarantined` gilt. `pending` ist die ehrliche Zwischenstufe — die
            // Datei liegt in diesem Moment noch in der Quarantäne und wandert erst nach der Operation zurück.
            const [zeile] = await tx<{ revision: number }[]>`
                UPDATE media_publication_suspension
                   SET lifted_at = now(), lifted_by_person = ${actor.personId}::uuid, lift_reason = ${reason},
                       file_state = 'pending'
                 WHERE id = ${aktiv.id}::bigint
                RETURNING revision::int AS revision
            `;
            const entries: MediaAuditEntry[] = [
                {
                    action: "suspension.lifted",
                    // Das Protokoll hängt am AUSLÖSENDEN Asset, damit der Verlauf dort vollständig bleibt; ist es gelöscht (0328), an dem, an dem aufgehoben wird.
                    assetId: aktiv.asset_public_id ?? asset.publicId,
                    targetRevision: zeile!.revision,
                    details: { sha256, assets: betroffen.assets, usages: betroffen.usages, reason },
                },
            ];
            // Erst die Datei zurück (Job ohne Person), dann der Abgleich je aktiver Rolle jedes Assets mit diesen Bytes.
            const derivedWork: DerivedWork[] = [await reiheQuarantaeneEin(tx, "asset_suspension")];
            for (const betroffenesAsset of await assetsMitBytes(tx, sha256)) {
                derivedWork.push(
                    ...(await enqueueSettleForActiveRoles(tx, { ...betroffenesAsset, actorPersonId: actor.personId })),
                );
            }
            return {
                receipt: {
                    affected: [{ kind: "suspension", id: sha256, revision: zeile!.revision }],
                    derivedWork,
                    warnings: [],
                },
                entries,
            };
        },
    );
    // Nach dem Aufheben darf das Bild zurück auf die Karte: Der Zwischenspeicher des Lesepfads (S4) fängt von vorn an.
    vergissReisebilder();
    return quittung;
}
