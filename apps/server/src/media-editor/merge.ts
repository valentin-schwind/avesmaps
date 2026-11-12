import type { DerivedWork, MediaMergeBody, MediaMergeLiftBody, OperationReceipt } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { lockAsset, notFound } from "./asset-operations.ts";
import { mediaEditConflict } from "./audit.ts";
import { PHOTOBOX_QUELLSYSTEM } from "../photobox/db.ts";
import { mediaOperation, type MediaActor, type MediaAuditEntry } from "./operation-store.ts";
import { enqueueSettleForTouchedRoles } from "./settle.ts";

/**
 * Zwei Werke mit DENSELBEN BYTES werden eines (WI-0068 D1, Migration 0121).
 *
 * Legacy legte je Verwendung ein eigenes Werk an: im Bestand teilen 1.025 Assets ihre Quelldatei, in 218 Gruppen, die größte mit
 * 15. Betreiber 2026-10-13: „bytegleiche bilder die doppelt sind sollen zu einem werden - verlier die referenzen nicht.“
 *
 * 🔴 **Nur bytegleich** (Betreiber 2026-10-11: „genau, nur bei byte-identischen bildern“). Verglichen wird die SHA-256 des
 * ORIGINALS (`private_source`), nie die veröffentlichte Datei: Die ist gerechnet und kann sich ändern, ohne dass sich das Werk
 * ändert. Wer zwei verschiedene Werke zusammenführen will, bekommt 409.
 *
 * 🔴 **Reisebilder nehmen nie teil** (WI-0272 S3, Fixrunde D; §13 „Reisebilder bleiben in ihren Rollen“): Ein Reisebild (`source_system = 'photobox'`) gehört zu seiner
 * Einreichung und zu keiner anderen Verwendung. Zusammenführen und Sammellauf lassen es aus, hier ist es 409 `media_photobox_not_mergeable`. Sonst
 * ginge die Einreichung aus Korb und Zahl verloren (das aktuelle Bild wäre aufgegangen), eine freigegebene zöge auf ein fremdes, womöglich abgelehntes
 * Werk um, und die Aufbewahrung hielte jede beteiligte Einreichung für immer fest.
 *
 * 🔴 **Nie automatisch, nie als Lauf über den Bestand** (§21): Diese Operation führt EINE Gruppe zusammen, ausgelöst von einem
 * Menschen. Auf Stage drückt der Betreiber selbst.
 *
 * 🔴 **Das aufgegangene Werk wird nicht gelöscht.** Es behält Original, Rechte, Herkunft und `source_ref` — nur seine
 * Verwendungen ziehen um. Es fällt damit aus Liste und Körben und steht am bleibenden Werk als Verlauf.
 *
 * 🪤 **Was NICHT mitwandert:**
 * - `media_file`, `media_rights`, `media_rights_evidence`, `media_creation` gehören zum Werk selbst und bleiben bei ihm.
 * - `media_ingest` und `media_legacy_source` sind die HERKUNFT. Sie müssen bleiben: Ohne sie fände der Legacy-Zug seinen
 *   Schlüssel nicht wieder und legte das Werk beim nächsten Lauf neu an — die Zusammenführung wäre aufgehoben.
 * - Der Einzelbild-Notaus steht auf den BYTES (`source_sha256`), nicht am Asset. Beide Werke tragen dieselben Bytes, er wirkt
 *   also ohnehin für beide; ihn umzuhängen änderte nichts.
 *
 * Die Liste, gegen die das geprüft wird, steht in `apps/server/test/media-asset-referenzen.test.ts`: Sie liest die Fremdschlüssel
 * aus der Datenbank, damit eine neue Tafel hier auffällt und nicht erst beim Zusammenführen.
 */

/**
 * Die Verwendungen, die umziehen. Je Tafel die Spalte des Fachobjekts, die Rolle und ob die Zeile eine eigene Herkunft trägt.
 *
 * 🔴 Exportiert, weil `media-asset-referenzen.test.ts` sie gegen die Fremdschlüssel der DATENBANK hält: Eine Tafel, die dort
 * als `umhaengen` steht, muss hier auch wirklich umgehängt werden. Sonst bliebe eine Verwendung beim aufgegangenen Werk —
 * ohne Fehler, ohne Spur, und erst Monate später fiele ein Bild irgendwo weg.
 */
export const UMZUG = [
    { tafel: "place_media", objekt: "place_id", rolle: true, herkunft: true },
    { tafel: "territory_media", objekt: "territory_id", rolle: true, herkunft: true },
    { tafel: "adventure_media", objekt: "adventure_id", rolle: true, herkunft: true },
    { tafel: "citymap_media", objekt: "citymap_id", rolle: true, herkunft: true },
    // 🪤 Ein Galerieeintrag hat KEINE eigene Herkunft - sie steht an der Galerie (`media_gallery.origin`). Wer hier `origin`
    // setzen wollte, bekäme einen Laufzeitfehler, und zwar nur in dem Fall, in dem das bleibende Werk NICHT schon in derselben
    // Galerie steht: ein Fall, den ein Test leicht nicht trifft.
    { tafel: "media_gallery_item", objekt: "gallery_id", rolle: false, herkunft: false },
    // 🔴 `photobox_media` zieht NICHT um: Reisebilder nehmen an keiner Zusammenführung teil (siehe Kopf, `lockBeteiligt`).
] as const;

interface Beteiligt {
    id: string;
    publicId: string;
    revision: number;
    updatedAt: Date;
    sha256: string;
}

const reisebild = (): ApiError =>
    new ApiError(
        409,
        "media_photobox_not_mergeable",
        "Reisebilder werden nicht zusammengeführt: Jedes gehört zu seiner Einreichung.",
    );

const nichtBytegleich = (): ApiError =>
    new ApiError(
        409,
        "media_not_same_file",
        "Diese Bilder sind nicht bytegleich. Zusammengeführt wird nur, was dieselbe Originaldatei trägt.",
    );

/** Das Asset samt der SHA-256 seines Originals, gesperrt. Ohne Original gibt es nichts zu vergleichen. */
async function lockBeteiligt(tx: Queryable, publicId: string): Promise<Beteiligt> {
    const asset = await lockAsset(tx, publicId);
    // 🔴 Ein Reisebild nimmt nie teil, weder als bleibendes noch als aufgehendes Werk.
    if (asset.sourceSystem === PHOTOBOX_QUELLSYSTEM) throw reisebild();
    const [datei] = await tx<{ sha256: string }[]>`
        SELECT sha256 FROM media_file WHERE media_asset_id = ${asset.id} AND storage_class = 'private_source' LIMIT 1
    `;
    if (datei === undefined) {
        throw new ApiError(
            409,
            "media_not_same_file",
            "Dieses Bild hat noch keine Originaldatei; ohne sie lässt sich nichts vergleichen.",
        );
    }
    return {
        id: asset.id,
        publicId: asset.publicId,
        revision: asset.revision,
        updatedAt: asset.updatedAt,
        sha256: datei.sha256,
    };
}

/**
 * 🔴 Alle Beteiligten ZUERST und in fester Folge sperren (nach `id`). Zwei Zusammenführungen über Kreuz (A in B und zugleich B in A)
 * sperrten sonst in entgegengesetzter Folge und warteten aufeinander, bis Postgres eine als Verklemmung abbricht (500; Befund WI-0068 R8
 * 2026-10-18, `media-wettlauf.test.ts`). Mit fester Folge wartet die zweite, sieht danach das aufgegangene Werk und bekommt 409.
 * `lockBeteiligt` sperrt dieselben Zeilen danach noch einmal, ohne zu warten.
 */
async function sperreInFesterFolge(tx: Queryable, publicIds: readonly string[]): Promise<void> {
    await tx`
        SELECT id FROM media_asset WHERE public_id = ANY(${publicIds as string[]}::uuid[]) ORDER BY id FOR UPDATE
    `;
}

/** 409, wenn der gesehene Stand eines Beteiligten nicht mehr gilt. */
async function requireBase(tx: Queryable, asset: Beteiligt, baseRevision: number): Promise<void> {
    if (asset.revision === baseRevision) return;
    throw await mediaEditConflict(
        tx,
        { record: "asset", assetId: asset.publicId },
        { revision: asset.revision, changedAt: asset.updatedAt },
    );
}

/** Geht dieses Werk schon in einem anderen auf? Dann ist es kein Gegenstand mehr. */
async function requireNichtAufgegangen(tx: Queryable, asset: Beteiligt, was: string): Promise<void> {
    const [row] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM media_merge WHERE merged_asset_id = ${asset.id} AND lifted_at IS NULL
    `;
    if ((row?.n ?? 0) > 0) {
        throw new ApiError(409, "media_already_merged", `${was} ist bereits in einem anderen Bild aufgegangen.`);
    }
}

/**
 * Hängt die Verwendungen eines Werks auf das bleibende um und schreibt die Spur.
 *
 * 🪤 **Am selben Platz geht nur eine Zeile.** Jede Bindungstafel ist eindeutig über (Fachobjekt, Asset, Rolle) und lässt je
 * (Fachobjekt, Rolle) höchstens EINE aktive Zeile zu; eine Galerie führt ein Asset einmal. Hängen beide Werke am selben Platz,
 * wird die Zeile des aufgehenden deshalb ZURÜCKGEZOGEN statt umgehängt — und war sie die aktive, während die des bleibenden
 * zurückgezogen war, wird dessen Zeile wieder aktiv. Sonst verlöre der Platz sein Bild.
 */
async function ziehUm(
    tx: Queryable,
    mergeId: string,
    von: Beteiligt,
    nach: Beteiligt,
): Promise<{ umgehaengt: number; zurueckgezogen: number }> {
    let umgehaengt = 0;
    let zurueckgezogen = 0;
    for (const spec of UMZUG) {
        const rolle = spec.rolle ? tx.unsafe("role") : tx.unsafe("'-'::text");
        const zeilen = await tx<{ id: string; schluessel: string; aktiv: boolean }[]>`
            SELECT id::text AS id, (${tx.unsafe(spec.objekt)}::text || '|' || ${rolle}) AS schluessel,
                   retired_at IS NULL AS aktiv
              FROM ${tx.unsafe(spec.tafel)}
             WHERE media_asset_id = ${von.id} FOR UPDATE
        `;
        if (zeilen.length === 0) continue;
        const beimZiel = await tx<{ id: string; schluessel: string; aktiv: boolean }[]>`
            SELECT id::text AS id, (${tx.unsafe(spec.objekt)}::text || '|' || ${rolle}) AS schluessel,
                   retired_at IS NULL AS aktiv
              FROM ${tx.unsafe(spec.tafel)}
             WHERE media_asset_id = ${nach.id} FOR UPDATE
        `;
        const zielNach = new Map(beimZiel.map((zeile) => [zeile.schluessel, zeile]));
        for (const zeile of zeilen) {
            const belegt = zielNach.get(zeile.schluessel);
            if (belegt === undefined) {
                // 🔴 Die umgehängte Bindung gehört ab jetzt dem EDITOR (Schutzregel wie bei jeder Operation der
                // Medienverwaltung). Bliebe sie `legacy`, setzte ein Import sie auf das ursprüngliche Werk zurück, sobald die
                // Umleitung einmal nicht greift — die Zusammenführung wäre still aufgehoben, und niemand sähe es.
                await tx`
                    UPDATE ${tx.unsafe(spec.tafel)}
                       SET media_asset_id = ${nach.id}, updated_at = now()${
                           spec.herkunft ? tx.unsafe(", origin = 'editor'") : tx.unsafe("")
                       }
                     WHERE id = ${zeile.id}::bigint
                `;
                await tx`
                    INSERT INTO media_merge_move (merge_id, target_table, target_id, kind)
                    VALUES (${mergeId}::bigint, ${spec.tafel}, ${zeile.id}::bigint, 'umgehaengt')
                `;
                umgehaengt += 1;
                continue;
            }
            // Der Platz ist beim bleibenden Werk schon belegt: die Zeile des aufgehenden wird zurückgezogen.
            if (zeile.aktiv) {
                await tx`
                    UPDATE ${tx.unsafe(spec.tafel)} SET retired_at = now(), updated_at = now()
                     WHERE id = ${zeile.id}::bigint
                `;
            }
            await tx`
                INSERT INTO media_merge_move (merge_id, target_table, target_id, kind)
                VALUES (${mergeId}::bigint, ${spec.tafel}, ${zeile.id}::bigint, 'zurueckgezogen')
            `;
            zurueckgezogen += 1;
            if (zeile.aktiv && !belegt.aktiv) {
                await tx`
                    UPDATE ${tx.unsafe(spec.tafel)} SET retired_at = NULL, updated_at = now()
                     WHERE id = ${belegt.id}::bigint
                `;
                await tx`
                    INSERT INTO media_merge_move (merge_id, target_table, target_id, kind)
                    VALUES (${mergeId}::bigint, ${spec.tafel}, ${belegt.id}::bigint, 'aktiviert')
                `;
            }
        }
    }
    // Eine Galerie, deren Eintrag umzog, gehört danach dem Editor: Der Import gleicht sie nicht mehr ab (Schutzregel wie an
    // der Bindung; die Herkunft sitzt an der GALERIE, nicht am Eintrag).
    await tx`
        UPDATE media_gallery g SET origin = 'editor'
         WHERE g.origin <> 'editor'
           AND EXISTS (SELECT 1 FROM media_gallery_item i WHERE i.gallery_id = g.id AND i.media_asset_id = ${nach.id})
           AND EXISTS (
               SELECT 1 FROM media_merge_move mv
                WHERE mv.merge_id = ${mergeId}::bigint AND mv.target_table = 'media_gallery_item'
                  AND mv.target_id IN (SELECT i2.id FROM media_gallery_item i2 WHERE i2.gallery_id = g.id)
           )
    `;
    // Der ★ einer Typbildkategorie ist eine Verwendung wie jede andere; höchstens einer je Kategorie und Variante ist aktiv (Migration 0314).
    // 🔴 Belegt heißt: dieselbe Kategorie UND dieselbe Variante. Sonst würde unten eine Zeile der anderen Variante wieder aktiv, deren Platz
    // ein anderes Asset hält, und der Index `media_type_image_one_active_variant` hielte die Zusammenführung an.
    const sterne = await tx<{ id: string; category: string; variant: string; aktiv: boolean }[]>`
        SELECT id::text AS id, category, variant, retired_at IS NULL AS aktiv
          FROM media_type_image WHERE media_asset_id = ${von.id} FOR UPDATE
    `;
    for (const stern of sterne) {
        const [belegt] = await tx<{ id: string; aktiv: boolean }[]>`
            SELECT id::text AS id, retired_at IS NULL AS aktiv FROM media_type_image
             WHERE media_asset_id = ${nach.id} AND category = ${stern.category} AND variant = ${stern.variant} FOR UPDATE
        `;
        if (belegt === undefined) {
            await tx`
                UPDATE media_type_image SET media_asset_id = ${nach.id}, origin = 'editor', updated_at = now()
                 WHERE id = ${stern.id}::bigint
            `;
            await tx`
                INSERT INTO media_merge_move (merge_id, target_table, target_id, kind)
                VALUES (${mergeId}::bigint, 'media_type_image', ${stern.id}::bigint, 'umgehaengt')
            `;
            umgehaengt += 1;
            continue;
        }
        if (stern.aktiv) {
            await tx`UPDATE media_type_image SET retired_at = now(), updated_at = now() WHERE id = ${stern.id}::bigint`;
        }
        await tx`
            INSERT INTO media_merge_move (merge_id, target_table, target_id, kind)
            VALUES (${mergeId}::bigint, 'media_type_image', ${stern.id}::bigint, 'zurueckgezogen')
        `;
        zurueckgezogen += 1;
        if (stern.aktiv && !belegt.aktiv) {
            await tx`
                UPDATE media_type_image SET retired_at = NULL, updated_at = now() WHERE id = ${belegt.id}::bigint
            `;
            await tx`
                INSERT INTO media_merge_move (merge_id, target_table, target_id, kind)
                VALUES (${mergeId}::bigint, 'media_type_image', ${belegt.id}::bigint, 'aktiviert')
            `;
        }
    }
    return { umgehaengt, zurueckgezogen };
}

/**
 * Zwei oder mehr bytegleiche Werke zu einem machen.
 *
 * Der Mensch wählt das bleibende; die Vorgabe der Oberfläche ist die größte Auflösung (Betreiber 2026-10-11, Frage 2 Antwort A).
 * Jedes aufgehende Werk wird einzeln geprüft: gleiche Bytes, gesehener Stand, nicht schon aufgegangen.
 */
export function mergeAssets(database: Database, actor: MediaActor, body: MediaMergeBody): Promise<OperationReceipt> {
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "media.merge",
            body: { keep: body.keep.assetId, merge: body.merge.map((eintrag) => eintrag.assetId) },
        },
        async (tx) => fuehreZusammen(tx, actor, body, { abgleich: true }),
    );
}

/** Was eine Zusammenführung in ihrer Transaktion tat: Quittung, Protokoll und, ohne eigene Abgleiche, die berührten Werke. */
export interface Zusammengefuehrt {
    receipt: {
        affected: OperationReceipt["affected"];
        derivedWork: DerivedWork[];
        warnings: OperationReceipt["warnings"];
    };
    entries: MediaAuditEntry[];
    /** Die Werke, deren Abgleich der Aufrufer selbst einreiht (`abgleich: false`, Sammellauf); sonst leer. */
    beruehrt: { assetId: string; assetPublicId: string }[];
    umgehaengt: number;
    zurueckgezogen: number;
}

/**
 * Der Kern von `media.merge`, in der Transaktion des Aufrufers: die EINE Logik für die einzelne Zusammenführung und den Lauf über
 * alle Gruppen (`merge-all.ts`).
 *
 * `abgleich: false` reiht keine Abgleiche ein und nennt stattdessen die berührten Werke. Der Sammellauf reiht sie am Ende EINMAL je
 * Werk und Rolle ein, mit niedriger Priorität (Claudio 2026-10-17: sonst stünden hunderte Abgleiche vor fremden ★-Wechseln).
 */
export async function fuehreZusammen(
    tx: Queryable,
    actor: MediaActor,
    body: Pick<MediaMergeBody, "keep" | "merge" | "reason">,
    optionen: { abgleich: boolean },
): Promise<Zusammengefuehrt> {
    await sperreInFesterFolge(tx, [body.keep.assetId, ...body.merge.map((eintrag) => eintrag.assetId)]);
    const bleibt = await lockBeteiligt(tx, body.keep.assetId);
    await requireBase(tx, bleibt, body.keep.baseRevision);
    await requireNichtAufgegangen(tx, bleibt, "Dieses Bild");

    const entries: MediaAuditEntry[] = [];
    const derivedWork: DerivedWork[] = [];
    const beruehrt: Zusammengefuehrt["beruehrt"] = [];
    let zurueckgezogen = 0;
    let umgehaengt = 0;
    for (const eintrag of body.merge) {
        if (eintrag.assetId === bleibt.publicId) {
            throw new ApiError(400, "validation_failed", "Ein Bild kann nicht in sich selbst aufgehen.", {
                issues: [{ path: "merge", rule: "not_self" }],
            });
        }
        const geht = await lockBeteiligt(tx, eintrag.assetId);
        await requireBase(tx, geht, eintrag.baseRevision);
        await requireNichtAufgegangen(tx, geht, "Dieses Bild");
        // 🔴 Die Bedingung der ganzen Operation: dieselben Bytes.
        if (geht.sha256 !== bleibt.sha256) throw nichtBytegleich();

        const [merge] = await tx<{ id: string }[]>`
                    INSERT INTO media_merge (merged_asset_id, kept_asset_id, source_sha256, reason, merged_by_person)
                    VALUES (${geht.id}, ${bleibt.id}, ${bleibt.sha256}, ${body.reason ?? null}, ${actor.personId}::uuid)
                    RETURNING id::text AS id
                `;
        const bewegt = await ziehUm(tx, merge!.id, geht, bleibt);
        zurueckgezogen += bewegt.zurueckgezogen;
        umgehaengt += bewegt.umgehaengt;
        await tx`UPDATE media_asset SET updated_at = now() WHERE id = ANY(ARRAY[${geht.id}, ${bleibt.id}]::bigint[])`;
        // S8-02: je Rolle, die das aufgegangene Werk noch berührt (seine Dateien), nicht fest `header`.
        if (optionen.abgleich) {
            derivedWork.push(
                ...(await enqueueSettleForTouchedRoles(tx, {
                    assetId: geht.id,
                    assetPublicId: geht.publicId,
                    actorPersonId: actor.personId,
                })),
            );
        } else {
            beruehrt.push({ assetId: geht.id, assetPublicId: geht.publicId });
        }
        entries.push({
            action: "asset.merged",
            assetId: geht.publicId,
            details: { keptAsset: bleibt.publicId, moved: bewegt.umgehaengt, retired: bewegt.zurueckgezogen },
        });
    }
    if (optionen.abgleich) {
        derivedWork.push(
            ...(await enqueueSettleForTouchedRoles(tx, {
                assetId: bleibt.id,
                assetPublicId: bleibt.publicId,
                actorPersonId: actor.personId,
            })),
        );
    } else {
        beruehrt.push({ assetId: bleibt.id, assetPublicId: bleibt.publicId });
    }
    const [frisch] = await tx<{ revision: number }[]>`
                SELECT revision::int AS revision FROM media_asset WHERE id = ${bleibt.id}
            `;
    return {
        beruehrt,
        umgehaengt,
        zurueckgezogen,
        receipt: {
            affected: [{ kind: "media_asset", id: bleibt.publicId, revision: frisch!.revision }],
            derivedWork,
            warnings:
                zurueckgezogen > 0
                    ? [
                          {
                              code: "merge_rows_retired",
                              message: `An ${String(zurueckgezogen)} Stellen hing das bleibende Bild schon; dort wurde die doppelte Verwendung zurückgezogen.`,
                          },
                      ]
                    : [],
        },
        entries: entries.map((eintrag) => ({
            ...eintrag,
            targetRevision: eintrag.targetRevision ?? frisch!.revision,
        })),
    };
}

/**
 * Eine Zusammenführung aufheben: genau die Zeilen zurück, die sie bewegt hat.
 *
 * 🔴 Die Spur (`media_merge_move`) ist der Grund, warum das exakt geht: Ohne sie wüsste niemand, welche der Verwendungen des
 * bleibenden Werks vorher dem anderen gehörten.
 *
 * 🪤 Eine Zeile, die seit der Zusammenführung jemand anders angefasst hat, wandert trotzdem zurück — ihr Platz gehörte vorher
 * dem aufgehenden Werk. Was die Operation NICHT tut: eine inzwischen neu angelegte Verwendung anfassen. Sie steht nicht in der
 * Spur und bleibt, wo sie ist.
 */
export function liftMerge(
    database: Database,
    actor: MediaActor,
    assetId: string,
    body: MediaMergeLiftBody,
): Promise<OperationReceipt> {
    return mediaOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "media.merge_lifted", body: { assetId } },
        async (tx) => {
            const geht = await lockAsset(tx, assetId);
            const [merge] = await tx<{ id: string; kept: string; keptPublic: string }[]>`
                SELECT m.id::text AS id, m.kept_asset_id::text AS kept, a.public_id::text AS "keptPublic"
                  FROM media_merge m JOIN media_asset a ON a.id = m.kept_asset_id
                 WHERE m.merged_asset_id = ${geht.id} AND m.lifted_at IS NULL FOR UPDATE OF m
            `;
            if (merge === undefined) throw notFound("Eine aktive Zusammenführung dieses Bildes");

            const bewegt = await tx<{ target_table: string; target_id: string; kind: string }[]>`
                SELECT target_table, target_id::text AS target_id, kind FROM media_merge_move
                 WHERE merge_id = ${merge.id}::bigint
            `;
            const erlaubt = new Set<string>([...UMZUG.map((spec) => spec.tafel), "media_type_image"]);
            // Zuerst das Aktivieren zurücknehmen, dann die Zeilen zurückgeben: sonst stünden zwei aktive am selben Platz.
            for (const zeile of bewegt.filter((eintrag) => eintrag.kind === "aktiviert")) {
                if (!erlaubt.has(zeile.target_table)) continue;
                await tx`
                    UPDATE ${tx.unsafe(zeile.target_table)} SET retired_at = now(), updated_at = now()
                     WHERE id = ${zeile.target_id}::bigint
                `;
            }
            for (const zeile of bewegt.filter((eintrag) => eintrag.kind === "zurueckgezogen")) {
                if (!erlaubt.has(zeile.target_table)) continue;
                await tx`
                    UPDATE ${tx.unsafe(zeile.target_table)} SET retired_at = NULL, updated_at = now()
                     WHERE id = ${zeile.target_id}::bigint
                `;
            }
            for (const zeile of bewegt.filter((eintrag) => eintrag.kind === "umgehaengt")) {
                if (!erlaubt.has(zeile.target_table)) continue;
                await tx`
                    UPDATE ${tx.unsafe(zeile.target_table)} SET media_asset_id = ${geht.id}, updated_at = now()
                     WHERE id = ${zeile.target_id}::bigint
                `;
            }
            await tx`
                UPDATE media_merge
                   SET lifted_at = now(), lifted_by_person = ${actor.personId}::uuid, lift_reason = ${body.reason ?? null}
                 WHERE id = ${merge.id}::bigint
            `;
            await tx`UPDATE media_asset SET updated_at = now() WHERE id = ANY(ARRAY[${geht.id}, ${merge.kept}]::bigint[])`;
            const [frisch] = await tx<{ revision: number }[]>`
                SELECT revision::int AS revision FROM media_asset WHERE id = ${geht.id}
            `;
            return {
                receipt: {
                    affected: [{ kind: "media_asset", id: geht.publicId, revision: frisch!.revision }],
                    // S8-02: je Rolle, die die beiden Werke danach berühren (Verwendungen und Dateien), nicht fest `header`.
                    derivedWork: [
                        ...(await enqueueSettleForTouchedRoles(tx, {
                            assetId: geht.id,
                            assetPublicId: geht.publicId,
                            actorPersonId: actor.personId,
                        })),
                        ...(await enqueueSettleForTouchedRoles(tx, {
                            assetId: merge.kept,
                            assetPublicId: merge.keptPublic,
                            actorPersonId: actor.personId,
                        })),
                    ],
                    warnings: [],
                },
                entries: [
                    {
                        action: "asset.merge_lifted",
                        assetId: geht.publicId,
                        targetRevision: frisch!.revision,
                        details: { keptAsset: merge.keptPublic, moved: bewegt.length },
                    },
                ],
            };
        },
    );
}
