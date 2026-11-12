import {
    AVENTURIA,
    type DerivedWork,
    type MamKarteBildBody,
    type MamKarteBildLoesenBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { DERIVE_LOCK_CLASS } from "../derive/derive-lock.ts";
import { mapImportRunning } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { notFound } from "./asset-operations.ts";
import { mediaEditConflict } from "./audit.ts";
import { bindableAsset, notBound } from "./binding-operations.ts";
import { mediaOperation, type MediaActor } from "./operation-store.ts";
import { enqueueSettle } from "./settle.ts";

/**
 * Die Bilder eines Eintrags der Kartensammlung zuweisen, ändern und lösen (WI-0287 Stufe 1, Punkt 2; Operationen `citymap.image` und `citymap.image_remove`). Karte (`map_full`) und
 * Vorschau (`map_preview`) sind getrennte Werke mit eigenen Rechten: Die Art des Werks muss zur Rolle passen (409 `media_type_mismatch`).
 *
 * - **Vorschau:** ein aktives Bild je Eintrag (`citymap_media_one_active_per_role`). Zuweisen ersetzt, was dort hängt (die alte Bindung bekommt `retired_at`, das Werk bleibt in der
 *   Liste), Lösen setzt nur `retired_at`.
 * - **Karte (WI-0287 Stufe 2, Migration 0321):** mehrere Versionen je Eintrag. Zuweisen hängt eine weitere ans Ende, mit optionaler Bezeichnung (`version_label`); Lösen nimmt genau
 *   die genannte (`assetId`), die übrigen rücken auf. Die Reihenfolge ist `version_position`, bei jedem Schreiben ohne Lücken ab 0 durchgezählt (eine Karte aus der Zeit davor trägt
 *   NULL und steht vorn). Bezeichnung und Reihenfolge ändert `citymap.version` (`kartensammlung-versionen.ts`).
 *
 * 🔴 Gleicher Weg wie `aendereKarte`: die Sperre der Kartendomäne geteilt (503 `map_import_running`), der gesehene Stand (`baseRevision`, 409 mit wer und wann), eine Zeile
 * `citymap.updated` mit `details.fields = ["images"]`, die die Karte gegen den Legacy-Zug hält (`karte-gehalten.ts`). Ein stillgelegter Eintrag nimmt nichts mehr an (409 `citymap_retired`).
 * Der Abgleich der Dateien wird je betroffene Bindung eingereiht: Das neue Werk bekommt seine Fassung nach der Policy, das gelöste verliert die öffentliche, wenn es nirgends sonst hängt.
 */

type Rolle = "map_full" | "map_preview";

export interface Karte {
    id: string;
    revision: number;
    updated_at: Date;
    state: string;
}

/** Die Karte sperren, die Domäne teilen, den gesehenen Stand prüfen und einen stillgelegten Eintrag abweisen. */
export async function sperreKarte(
    tx: Queryable,
    publicId: string,
    baseRevision: number,
    domaene: string,
): Promise<Karte> {
    const [frei] = await tx<{ ok: boolean }[]>`
        SELECT pg_try_advisory_xact_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${domaene})) AS ok
    `;
    if (frei?.ok !== true) throw mapImportRunning();
    const [karte] = await tx<Karte[]>`
        SELECT c.id::text AS id, c.revision::int AS revision, c.updated_at, c.state
          FROM citymap c WHERE c.public_id = ${publicId}::uuid FOR UPDATE OF c
    `;
    if (karte === undefined) throw notFound("Diese Karte");
    if (karte.revision !== baseRevision) {
        throw await mediaEditConflict(
            tx,
            { record: "citymap", citymapId: publicId },
            { revision: karte.revision, changedAt: karte.updated_at },
        );
    }
    if (karte.state !== "active") {
        throw new ApiError(409, "citymap_retired", "Dieser Eintrag ist stillgelegt. Erst zurückholen, dann ändern.");
    }
    return karte;
}

/** Die aktive Bindung einer Rolle (gesperrt), mit dem Werk; hat die Karte mehrere Versionen (Migration 0321), die erste in ihrer Reihenfolge. */
async function aktiveBindung(
    tx: Queryable,
    karteId: string,
    rolle: Rolle,
): Promise<{ id: string; assetDb: string; assetPublicId: string } | undefined> {
    const [zeile] = await tx<{ id: string; asset_db: string; asset_public_id: string }[]>`
        SELECT m.id::text AS id, a.id::text AS asset_db, a.public_id::text AS asset_public_id
          FROM citymap_media m JOIN media_asset a ON a.id = m.media_asset_id
         WHERE m.citymap_id = ${karteId}::bigint AND m.role = ${rolle} AND m.retired_at IS NULL
         ORDER BY m.version_position NULLS FIRST, m.id
         FOR UPDATE OF m
    `;
    return zeile === undefined
        ? undefined
        : { id: zeile.id, assetDb: zeile.asset_db, assetPublicId: zeile.asset_public_id };
}

/** Eine aktive Version der Karte (gesperrt), in ihrer Folge. */
export interface Version {
    id: string;
    assetDb: string;
    assetPublicId: string;
    label: string | null;
}

/** Die aktiven Versionen der Karte eines Eintrags (`map_full`), gesperrt, in ihrer Folge (`version_position NULLS FIRST`, dann die Bindung). */
export async function aktiveVersionen(tx: Queryable, karteId: string): Promise<Version[]> {
    const zeilen = await tx<{ id: string; asset_db: string; asset_public_id: string; label: string | null }[]>`
        SELECT m.id::text AS id, a.id::text AS asset_db, a.public_id::text AS asset_public_id, m.version_label AS label
          FROM citymap_media m JOIN media_asset a ON a.id = m.media_asset_id
         WHERE m.citymap_id = ${karteId}::bigint AND m.role = 'map_full' AND m.retired_at IS NULL
         ORDER BY m.version_position NULLS FIRST, m.id
         FOR UPDATE OF m
    `;
    return zeilen.map((zeile) => ({
        id: zeile.id,
        assetDb: zeile.asset_db,
        assetPublicId: zeile.asset_public_id,
        label: zeile.label,
    }));
}

/** Die Versionen in der gegebenen Folge ab 0 durchzählen (Bindungen, `citymap_media.id`); nur, was sich ändert, wird geschrieben. */
export async function zaehleVersionenDurch(tx: Queryable, folge: readonly string[]): Promise<void> {
    if (folge.length === 0) return;
    await tx`
        UPDATE citymap_media m SET version_position = f.stelle, updated_at = now()
          FROM (SELECT id::bigint AS id, (ordinality - 1)::int AS stelle FROM unnest(${folge as string[]}::text[]) WITH ORDINALITY AS t(id, ordinality)) f
         WHERE m.id = f.id AND m.version_position IS DISTINCT FROM f.stelle
    `;
}

/** Die Bezeichnung einer Version, wie sie gespeichert wird: getrimmt, leer heißt ohne (`null`). */
export const versionsBezeichnung = (wert: string | null | undefined): string | null => {
    const text = (wert ?? "").trim();
    return text === "" ? null : text;
};

export async function hebeRevision(tx: Queryable, karte: Karte): Promise<number> {
    const [neu] = await tx<{ revision: number }[]>`
        UPDATE citymap SET updated_at = now(), revision = ${karte.revision + 1}
         WHERE id = ${karte.id}::bigint RETURNING revision::int AS revision
    `;
    return neu!.revision;
}

export function weiseKartenbildZu(
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: MamKarteBildBody,
    /** Die Kartendomäne der Sperre; nur Tests nennen eine eigene. */
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> {
    const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
    const bezeichnung = versionsBezeichnung(body.versionLabel);
    if (body.role === "map_preview" && bezeichnung !== null) {
        throw new ApiError(400, "validation_failed", "Eine Vorschau hat keine Version.", {
            issues: [{ path: "/versionLabel", rule: "role" }],
        });
    }
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "citymap.image",
            body: {
                citymapId: publicId,
                baseRevision: body.baseRevision,
                role: body.role,
                assetId: body.assetId,
                ...(bezeichnung === null ? {} : { versionLabel: bezeichnung }),
            },
        },
        async (tx) => {
            const karte = await sperreKarte(tx, publicId, body.baseRevision, domaene);
            const bild = await bindableAsset(tx, body.assetId, body.role);
            const derivedWork: DerivedWork[] = [];
            /** Nur an der Karte: die Stelle der neuen Version (ans Ende). */
            let stelle: number | null = null;
            if (body.role === "map_full") {
                // Eine weitere Version (WI-0287 Stufe 2): Die bisherigen bleiben, die neue kommt ans Ende.
                const versionen = await aktiveVersionen(tx, karte.id);
                if (versionen.some((version) => version.assetDb === bild.id)) {
                    throw new ApiError(409, "media_already_bound", "Dieses Bild hängt hier schon.");
                }
                await zaehleVersionenDurch(
                    tx,
                    versionen.map((version) => version.id),
                );
                stelle = versionen.length;
            } else {
                const alt = await aktiveBindung(tx, karte.id, body.role);
                if (alt?.assetDb === bild.id) {
                    throw new ApiError(409, "media_already_bound", "Dieses Bild hängt hier schon.");
                }
                if (alt !== undefined) {
                    await tx`UPDATE citymap_media SET retired_at = now(), updated_at = now() WHERE id = ${alt.id}::bigint`;
                    derivedWork.push(
                        await enqueueSettle(tx, {
                            assetPublicId: alt.assetPublicId,
                            role: body.role,
                            actorPersonId: actor.personId,
                        }),
                    );
                }
            }
            // Hing das Werk früher schon in dieser Rolle (zurückgezogen), lebt dieselbe Zeile wieder auf, ohne eine frühere Entscheidung mitzunehmen; eine Karte mit der
            // Bezeichnung und Stelle von jetzt.
            await tx`
                INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin, version_label, version_position)
                VALUES (${karte.id}::bigint, ${bild.id}::bigint, ${body.role}, 'editor', ${bezeichnung}, ${stelle})
                ON CONFLICT (citymap_id, media_asset_id, role) DO UPDATE
                   SET retired_at = NULL, origin = 'editor', publication_override = 'none', override_decided_on = NULL,
                       override_operator_quote = NULL, override_decided_by = NULL, override_reason = NULL,
                       version_label = EXCLUDED.version_label, version_position = EXCLUDED.version_position, updated_at = now()
            `;
            derivedWork.push(
                await enqueueSettle(tx, {
                    assetPublicId: body.assetId,
                    role: body.role,
                    actorPersonId: actor.personId,
                }),
            );
            const revision = await hebeRevision(tx, karte);
            return {
                receipt: { affected: [{ kind: "citymap", id: publicId, revision }], derivedWork, warnings: [] },
                entries: [
                    {
                        action: "citymap.updated",
                        citymapId: publicId,
                        assetId: body.assetId,
                        targetRevision: revision,
                        details: { fields: ["images"] },
                    },
                ],
            };
        },
    );
}

export function loeseKartenbild(
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: MamKarteBildLoesenBody,
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> {
    const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "citymap.image_remove",
            body: {
                citymapId: publicId,
                baseRevision: body.baseRevision,
                role: body.role,
                ...(body.assetId === undefined ? {} : { assetId: body.assetId }),
            },
        },
        async (tx) => {
            const karte = await sperreKarte(tx, publicId, body.baseRevision, domaene);
            let alt: { id: string; assetPublicId: string } | undefined;
            if (body.role === "map_full") {
                // Eine Version der Karte (WI-0287 Stufe 2): genau die genannte; ohne Nennung nur, wenn es eine einzige gibt.
                const versionen = await aktiveVersionen(tx, karte.id);
                if (body.assetId === undefined && versionen.length > 1) {
                    throw new ApiError(400, "validation_failed", "Welche Version? Der Eintrag hat mehrere Karten.", {
                        issues: [{ path: "/assetId", rule: "required" }],
                    });
                }
                const geloest =
                    body.assetId === undefined
                        ? versionen[0]
                        : versionen.find((version) => version.assetPublicId === body.assetId);
                if (geloest === undefined) throw notBound();
                await tx`UPDATE citymap_media SET retired_at = now(), updated_at = now() WHERE id = ${geloest.id}::bigint`;
                // Die übrigen rücken auf.
                await zaehleVersionenDurch(
                    tx,
                    versionen.filter((version) => version.id !== geloest.id).map((version) => version.id),
                );
                alt = geloest;
            } else {
                alt = await aktiveBindung(tx, karte.id, body.role);
                if (alt === undefined || (body.assetId !== undefined && alt.assetPublicId !== body.assetId)) {
                    throw notBound();
                }
                await tx`UPDATE citymap_media SET retired_at = now(), updated_at = now() WHERE id = ${alt.id}::bigint`;
            }
            const abgleich = await enqueueSettle(tx, {
                assetPublicId: alt.assetPublicId,
                role: body.role,
                actorPersonId: actor.personId,
            });
            const revision = await hebeRevision(tx, karte);
            return {
                receipt: {
                    affected: [{ kind: "citymap", id: publicId, revision }],
                    derivedWork: [abgleich],
                    warnings: [],
                },
                entries: [
                    {
                        action: "citymap.updated",
                        citymapId: publicId,
                        assetId: alt.assetPublicId,
                        targetRevision: revision,
                        details: { fields: ["images"] },
                    },
                ],
            };
        },
    );
}
