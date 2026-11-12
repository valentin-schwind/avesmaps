import { createHash } from "node:crypto";
import {
    AVENTURIA,
    MEDIA_MERGE_ALL_KIND,
    type MediaMergeAllBody,
    type MediaMergeAllGroup,
    type MediaMergeAllResult,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { AUTH_ENVIRONMENTS, type AuthEnvironment } from "../auth/config.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { PHOTOBOX_QUELLSYSTEM } from "../photobox/db.ts";
import { fuehreZusammen } from "./merge.ts";
import { mergePreview } from "./merge-preview.ts";
import { mediaOperation, type MediaActor } from "./operation-store.ts";
import { enqueueSettleForTouchedRoles } from "./settle.ts";

/**
 * „Alle bytegleichen Duplikate zusammenführen“ (WI-0068, Betreiber 2026-10-17; Vertrag in `packages/shared/src/media-merge.ts`).
 *
 * Zwei Hälften:
 * - **`requestMergeAll`** (App-Rolle, Operation `media.merge_all`, nur Betreiber): prüft, dass die Vorschau des Menschen noch die
 *   heutige ist, und reiht EINEN Auftrag `media_merge_all` ein. Der Auftrag trägt die Gruppen als Bestands-Scope.
 * - **`runMergeAll`** (Jobs-Rolle, im Auftrag): je Gruppe eine eigene Transaktion mit der Logik von `media.merge`
 *   (`fuehreZusammen`), mit einer aus Auftrag und Gruppe abgeleiteten `operationId`. Ein zweiter Lauf desselben Auftrags (Neustart,
 *   neuer Versuch) bekommt für eine fertige Gruppe ihre Quittung zurück, statt sie noch einmal anzufassen.
 *
 * 🔴 Eine Gruppe, deren Rechte inzwischen abweichen, fasst der Lauf nicht an (`rights_differ`), auch wenn sie in der Vorschau sauber
 * war; ebenso eine, die nichts mehr zusammenzuführen hat und eine, in der ein Reisebild steht (`photobox`, WI-0272 S3: Reisebilder nehmen an keiner
 * Zusammenführung teil, auch wenn eines erst nach der Vorschau dazukam). Ein Fehler in einer Gruppe hält die anderen nicht an, er steht im Bericht.
 * 🔴 Die Abgleiche kommen am Ende, je Werk und Rolle einmal, mit Priorität 90 (Claudio 2026-10-17).
 */

/** Die Priorität der Abgleiche eines Sammellaufs: nach allem, was Menschen gerade tun (0 zuerst, Vorgabe 50). */
export const MERGE_ALL_SETTLE_PRIORITY = 90;

export interface MergeAllInput {
    groups: MediaMergeAllGroup[];
    actor: MediaActor;
    reason: string | null;
}

/** Nimmt den Auftrag an: Vorschau gegen den heutigen Stand, dann EIN Auftrag der Warteschlange. */
export function requestMergeAll(
    database: Database,
    actor: MediaActor,
    body: MediaMergeAllBody,
): Promise<OperationReceipt> {
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "media.merge_all",
            body: { groups: body.groups, expected: body.expected },
        },
        async (tx) => {
            const vorschau = await mergePreview(tx);
            const sauber = vorschau.groups.filter((gruppe) => !gruppe.rightsDiffer);
            const heute = new Map(sauber.map((gruppe) => [gruppe.fileGroup, gruppe.keepAssetId]));
            const gleich =
                body.groups.length === sauber.length &&
                body.groups.every((gruppe) => heute.get(gruppe.fileGroup) === gruppe.keepAssetId) &&
                body.expected.groups === vorschau.totals.groups &&
                body.expected.members === vorschau.totals.members &&
                body.expected.moves === vorschau.totals.moves &&
                body.expected.retires === vorschau.totals.retires;
            if (!gleich) {
                throw new ApiError(
                    409,
                    "merge_preview_stale",
                    "Die Vorschau ist nicht mehr aktuell: Seitdem hat sich an den Duplikaten etwas geändert. Bitte neu laden.",
                    { expected: vorschau.totals },
                );
            }
            const eingabe: MergeAllInput = { groups: body.groups, actor, reason: body.reason?.trim() || null };
            const [job] = await tx<{ public_id: string }[]>`
                SELECT public_id::text AS public_id
                  FROM job_enqueue(${MEDIA_MERGE_ALL_KIND}, 1::smallint, ${AVENTURIA.mapDomain}, ${actor.personId},
                                   ${tx.json(eingabe as never)})
            `;
            return {
                receipt: {
                    affected: [],
                    derivedWork: [{ kind: MEDIA_MERGE_ALL_KIND, jobId: job!.public_id, state: "queued" }],
                    warnings: [],
                },
                entries: [],
            };
        },
    );
}

/** Liest die Eingabe des Auftrags; was nicht passt, ist ein Fehler im Einreihen, kein Grund zu raten. */
export function mergeAllInput(input: Record<string, unknown>): MergeAllInput {
    const groups = input["groups"];
    const actor = input["actor"] as { personId?: unknown; environment?: unknown } | undefined;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (
        !Array.isArray(groups) ||
        !groups.every(
            (gruppe: { fileGroup?: unknown; keepAssetId?: unknown }) =>
                typeof gruppe.fileGroup === "string" &&
                uuid.test(gruppe.fileGroup) &&
                typeof gruppe.keepAssetId === "string" &&
                uuid.test(gruppe.keepAssetId),
        ) ||
        typeof actor?.personId !== "string" ||
        !uuid.test(actor.personId) ||
        !(AUTH_ENVIRONMENTS as readonly unknown[]).includes(actor.environment)
    ) {
        throw new Error("media_merge_all: Eingabe unvollständig (groups, actor)");
    }
    const reason = input["reason"];
    return {
        groups: groups as MediaMergeAllGroup[],
        actor: { personId: actor.personId, environment: actor.environment as AuthEnvironment },
        reason: typeof reason === "string" && reason !== "" ? reason : null,
    };
}

/** Die `operationId` einer Gruppe in einem Auftrag: aus beiden abgeleitet, damit ein zweiter Lauf dieselbe Quittung findet. */
export function gruppenOperation(auftrag: string, keepAssetId: string): string {
    const hex = createHash("sha256").update(`media_merge_all:${auftrag}:${keepAssetId}`).digest("hex");
    const variante = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variante}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Warum der Lauf eine Gruppe nicht anfasst; eine Ausnahme, damit die Transaktion der Gruppe nichts schreibt. */
class Uebersprungen extends Error {
    readonly grund: string;
    constructor(grund: string) {
        super(grund);
        this.grund = grund;
    }
}

interface Mitglied {
    publicId: string;
    revision: number;
}

/** Die lebenden Mitglieder einer Gruppe außer dem bleibenden Werk, und ob ihre Rechte voneinander abweichen. */
async function gruppeHeute(
    tx: Queryable,
    keepAssetId: string,
): Promise<{ keep: Mitglied; merge: Mitglied[]; rechteWeichenAb: boolean }> {
    const zeilen = await tx<
        {
            public_id: string;
            revision: number;
            keep: boolean;
            basis: string;
            clearance: string;
            creator: string;
            reisebild: boolean;
        }[]
    >`
        WITH bleibt AS (
            SELECT a.id, f.sha256 FROM media_asset a
              JOIN media_file f ON f.media_asset_id = a.id AND f.storage_class = 'private_source'
             WHERE a.public_id = ${keepAssetId}::uuid
        )
        SELECT a.public_id::text AS public_id, a.revision::int AS revision, a.id = b.id AS keep,
               coalesce(r.rights_basis, '-') AS basis, coalesce(r.clearance_state, '-') AS clearance,
               coalesce(r.creator, '-') AS creator, a.source_system IS NOT DISTINCT FROM ${PHOTOBOX_QUELLSYSTEM} AS reisebild
          FROM bleibt b
          JOIN media_file f ON f.sha256 = b.sha256 AND f.storage_class = 'private_source'
          JOIN media_asset a ON a.id = f.media_asset_id
          LEFT JOIN media_rights r ON r.media_asset_id = a.id
         WHERE NOT EXISTS (SELECT 1 FROM media_merge m WHERE m.merged_asset_id = a.id AND m.lifted_at IS NULL)
         ORDER BY a.id
    `;
    const keep = zeilen.find((zeile) => zeile.keep);
    if (keep === undefined) throw new Uebersprungen("keep_unavailable");
    if (zeilen.some((zeile) => zeile.reisebild)) throw new Uebersprungen("photobox");
    const schluessel = new Set(zeilen.map((zeile) => `${zeile.basis}|${zeile.clearance}|${zeile.creator}`));
    return {
        keep: { publicId: keep.public_id, revision: keep.revision },
        merge: zeilen
            .filter((zeile) => !zeile.keep)
            .map((zeile) => ({ publicId: zeile.public_id, revision: zeile.revision })),
        rechteWeichenAb: schluessel.size > 1,
    };
}

export interface MergeAllHooks {
    /** Die öffentliche Kennung des Auftrags (Grundlage der `operationId` je Gruppe). */
    auftrag: string;
    /** Nach jeder Gruppe: wie weit der Lauf ist; darf werfen, um abzubrechen (verlangter Abbruch, Lease). */
    fortschritt(erledigt: number, gesamt: number): Promise<void>;
}

/** Der Lauf über alle Gruppen des Auftrags (Jobs-Rolle). */
export async function runMergeAll(
    database: Database,
    input: MergeAllInput,
    hooks: MergeAllHooks,
): Promise<MediaMergeAllResult> {
    const ergebnis: MediaMergeAllResult = {
        groups: input.groups.length,
        merged: 0,
        assets: 0,
        moved: 0,
        retired: 0,
        skipped: [],
        failed: [],
        settles: 0,
    };
    const beruehrt = new Map<string, { assetId: string; assetPublicId: string }>();
    for (const [index, gruppe] of input.groups.entries()) {
        try {
            const quittung = await mediaOperation(
                database,
                input.actor,
                {
                    operationId: gruppenOperation(hooks.auftrag, gruppe.keepAssetId),
                    operation: "media.merge",
                    body: { keep: gruppe.keepAssetId, sammellauf: hooks.auftrag },
                },
                async (tx) => {
                    const heute = await gruppeHeute(tx, gruppe.keepAssetId);
                    if (heute.merge.length === 0) throw new Uebersprungen("nothing_to_merge");
                    if (heute.rechteWeichenAb) throw new Uebersprungen("rights_differ");
                    const getan = await fuehreZusammen(
                        tx,
                        input.actor,
                        {
                            keep: { assetId: heute.keep.publicId, baseRevision: heute.keep.revision },
                            merge: heute.merge.map((mitglied) => ({
                                assetId: mitglied.publicId,
                                baseRevision: mitglied.revision,
                            })),
                            ...(input.reason === null ? {} : { reason: input.reason }),
                        },
                        { abgleich: false },
                    );
                    for (const werk of getan.beruehrt) beruehrt.set(werk.assetId, werk);
                    ergebnis.assets += heute.merge.length;
                    ergebnis.moved += getan.umgehaengt;
                    ergebnis.retired += getan.zurueckgezogen;
                    return { receipt: getan.receipt, entries: getan.entries };
                },
            );
            ergebnis.merged += quittung.status === "applied" || quittung.status === "replayed" ? 1 : 0;
        } catch (error) {
            if (error instanceof Uebersprungen)
                ergebnis.skipped.push({ fileGroup: gruppe.fileGroup, reason: error.grund });
            else if (error instanceof ApiError) ergebnis.failed.push({ fileGroup: gruppe.fileGroup, code: error.code });
            else throw error;
        }
        await hooks.fortschritt(index + 1, input.groups.length);
    }
    // Die Abgleiche am Ende: je Werk die Rollen, die es berührt, einmal, mit niedriger Priorität.
    await database.begin(async (tx) => {
        for (const werk of beruehrt.values()) {
            const arbeit = await enqueueSettleForTouchedRoles(tx, {
                ...werk,
                actorPersonId: input.actor.personId,
                priority: MERGE_ALL_SETTLE_PRIORITY,
            });
            ergebnis.settles += arbeit.length;
        }
    });
    return ergebnis;
}
