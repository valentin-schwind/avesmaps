import { AVENTURIA, type DerivedWork, type MamKarteStilllegenBody, type OperationReceipt } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { DERIVE_LOCK_CLASS } from "../derive/derive-lock.ts";
import { mapImportRunning } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { notFound } from "./asset-operations.ts";
import { mediaEditConflict } from "./audit.ts";
import { mediaOperation, type MediaActor } from "./operation-store.ts";
import { enqueueSettle } from "./settle.ts";

/**
 * Einen Eintrag der Kartensammlung entfernen und zurückholen (WI-0287 Stufe 1, Punkt 1; Operationen `citymap.retire` und `citymap.restore`).
 * „Stillgelegt wird, nie gelöscht“ (0069): `state = 'retired'`, `is_active = FALSE`, `retired_at`, `retired_origin = 'editor'`; Zurückholen setzt
 * alles zurück. Die Kinder (Typen, Orte, Fundstellen, Bindungen) bleiben unberührt, damit das Zurückholen den Eintrag so zurückgibt, wie er war.
 *
 * 🔴 Gleicher Weg wie `aendereKarte` (`kartensammlung-schreiben.ts`): die Sperre der Kartendomäne geteilt (503 `map_import_running` gegen den
 * Legacy-Zug), der gesehene Stand (`baseRevision`, 409 mit wer und wann), eine Zeile im Fachprotokoll, die die Karte gegen den Zug hält
 * (`karte-gehalten.ts`). Ein doppeltes Entfernen oder Zurückholen ist 409 mit eigenem Code, keine stille Wiederholung.
 *
 * 🔴 Ein Bild, das nur noch an stillgelegten Einträgen hängt, darf nicht öffentlich bleiben: `readUsages` zählt den stillgelegten Eintrag wie eine
 * zurückgezogene Bindung. Die Datei geht aber erst im Abgleich (Worker) weg, darum reiht die Operation je aktiver Bindung den Abgleich ein
 * (`derivedWork`), beim Zurückholen ebenso (das Bild wird wieder öffentlich, wenn die Policy es erlaubt).
 */

type Weg = "retire" | "restore";

function stilllegen(
    weg: Weg,
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: MamKarteStilllegenBody,
    optionen: { mapDomainId?: string },
): Promise<OperationReceipt> {
    const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: weg === "retire" ? "citymap.retire" : "citymap.restore",
            body: { citymapId: publicId, baseRevision: body.baseRevision },
        },
        async (tx) => {
            const [frei] = await tx<{ ok: boolean }[]>`
                SELECT pg_try_advisory_xact_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${domaene})) AS ok
            `;
            if (frei?.ok !== true) throw mapImportRunning();
            const [karte] = await tx<{ id: string; revision: number; updated_at: Date; state: string }[]>`
                SELECT c.id::text AS id, c.revision::int AS revision, c.updated_at, c.state
                  FROM citymap c WHERE c.public_id = ${publicId}::uuid FOR UPDATE OF c
            `;
            if (karte === undefined) throw notFound("Diese Karte");
            if (karte.revision !== body.baseRevision) {
                throw await mediaEditConflict(
                    tx,
                    { record: "citymap", citymapId: publicId },
                    { revision: karte.revision, changedAt: karte.updated_at },
                );
            }
            if (weg === "retire" && karte.state !== "active") {
                throw new ApiError(409, "citymap_already_retired", "Dieser Eintrag ist schon stillgelegt.");
            }
            if (weg === "restore" && karte.state !== "retired") {
                throw new ApiError(409, "citymap_not_retired", "Dieser Eintrag ist nicht stillgelegt.");
            }

            const [neu] =
                weg === "retire"
                    ? await tx<{ revision: number }[]>`
                          UPDATE citymap
                             SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor',
                                 updated_at = now(), revision = ${karte.revision + 1}
                           WHERE id = ${karte.id}::bigint RETURNING revision::int AS revision
                      `
                    : await tx<{ revision: number }[]>`
                          UPDATE citymap
                             SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL,
                                 updated_at = now(), revision = ${karte.revision + 1}
                           WHERE id = ${karte.id}::bigint RETURNING revision::int AS revision
                      `;
            const revision = neu!.revision;

            // Der Abgleich je aktiver Bindung (Bild und Rolle): die öffentliche Fassung fällt weg oder kommt zurück, wie die Policy es jetzt sagt.
            const bindungen = await tx<{ asset: string; role: "map_full" | "map_preview" }[]>`
                SELECT a.public_id::text AS asset, m.role
                  FROM citymap_media m JOIN media_asset a ON a.id = m.media_asset_id
                 WHERE m.citymap_id = ${karte.id}::bigint AND m.retired_at IS NULL
                 ORDER BY m.role, a.id
            `;
            const derivedWork: DerivedWork[] = [];
            for (const bindung of bindungen) {
                derivedWork.push(
                    await enqueueSettle(tx, {
                        assetPublicId: bindung.asset,
                        role: bindung.role,
                        actorPersonId: actor.personId,
                    }),
                );
            }
            return {
                receipt: { affected: [{ kind: "citymap", id: publicId, revision }], derivedWork, warnings: [] },
                entries: [
                    {
                        action: weg === "retire" ? "citymap.retired" : "citymap.restored",
                        citymapId: publicId,
                        targetRevision: revision,
                        details: { bindings: bindungen.length },
                    },
                ],
            };
        },
    );
}

export const entferneKarte = (
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: MamKarteStilllegenBody,
    /** Die Kartendomäne der Sperre; nur Tests nennen eine eigene. */
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> => stilllegen("retire", database, actor, publicId, body, optionen);

export const holeKarteZurueck = (
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: MamKarteStilllegenBody,
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> => stilllegen("restore", database, actor, publicId, body, optionen);
