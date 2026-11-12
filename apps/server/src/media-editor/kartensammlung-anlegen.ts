import {
    AVENTURIA,
    KARTE_ORTE_MAX,
    type MamKarteAnlegenBody,
    type MamKarteFeld,
    type MamKarteOrtZiel,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { DERIVE_LOCK_CLASS } from "../derive/derive-lock.ts";
import { mapImportRunning } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { SPALTE, bereinigt } from "./kartensammlung-schreiben.ts";
import { mediaOperation, type MediaActor } from "./operation-store.ts";

/**
 * Einen neuen Eintrag der Kartensammlung anlegen (WI-0287 Stufe 1, Punkt 2; Operation `citymap.create`). Nur Name, Orte und Angaben; Karte, Vorschau, Publikation und Links
 * kommen danach (`kartensammlung-bilder.ts`). Herkunft `manual`: von Hand angelegt, nicht aus der Community, nicht aus Legacy.
 *
 * 🔴 Gleicher Weg wie `aendereKarte`: die Sperre der Kartendomäne geteilt (503 `map_import_running` gegen den Legacy-Zug) und eine Zeile `citymap.created` im Fachprotokoll, die die
 * Karte gegen den Zug hält (`karte-gehalten.ts`). Ein Ort, den es nicht gibt oder der stillgelegt ist, ist 400, und dann entsteht nichts.
 *
 * WI-0287 Stufe 3: `targets` sind Orte und Regionen in der gegebenen Folge, nach `places`; zusammen höchstens `KARTE_ORTE_MAX` und jedes Ziel nur einmal. Eine Region, die es nicht gibt, die
 * stillgelegt ist oder in einer anderen Kartendomäne liegt, ist wie ein unbekannter Ort 400.
 */
export function legeKarteAn(
    database: Database,
    actor: MediaActor,
    body: MamKarteAnlegenBody,
    /** Die Kartendomäne der Sperre; nur Tests nennen eine eigene, damit sie fremde Läufe nicht aufhalten. */
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> {
    const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
    if (typeof bereinigt("title", body.fields.title) !== "string") {
        throw new ApiError(400, "validation_failed", "Ein Eintrag braucht einen Namen.", {
            issues: [{ path: "fields.title", rule: "required" }],
        });
    }
    const typen = [...new Set(body.types)].sort();
    // Alle Ziele in der gegebenen Folge: erst `places`, dann `targets`.
    const ziele: MamKarteOrtZiel[] = [
        ...body.places.map((id) => ({ kind: "place" as const, id })),
        ...(body.targets ?? []),
    ];
    if (
        ziele.length > KARTE_ORTE_MAX ||
        new Set(ziele.map((ziel) => `${ziel.kind}:${ziel.id}`)).size !== ziele.length
    ) {
        throw new ApiError(400, "validation_failed", "Zu viele oder doppelte Orte und Regionen.", {
            issues: [{ path: "targets", rule: "not_allowed" }],
        });
    }
    return mediaOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "citymap.create", body: { ...body, types: typen } },
        async (tx) => {
            const [frei] = await tx<{ ok: boolean }[]>`
                SELECT pg_try_advisory_xact_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${domaene})) AS ok
            `;
            if (frei?.ok !== true) throw mapImportRunning();
            const orteIds = ziele.filter((ziel) => ziel.kind === "place").map((ziel) => ziel.id);
            const regionIds = ziele.filter((ziel) => ziel.kind === "region").map((ziel) => ziel.id);
            const orte = await tx<{ id: string; public_id: string; name: string }[]>`
                SELECT id::text AS id, public_id::text AS public_id, name FROM place
                 WHERE public_id = ANY(${orteIds}::uuid[]) AND map_domain_id = ${AVENTURIA.mapDomain} AND is_active
            `;
            if (orte.length !== orteIds.length) {
                throw new ApiError(400, "validation_failed", "Diesen Ort gibt es nicht.", {
                    issues: [{ path: "places", rule: "not_allowed" }],
                });
            }
            const regionen = await tx<{ id: string; public_id: string; name: string }[]>`
                SELECT id::text AS id, public_id::text AS public_id, name FROM region
                 WHERE public_id = ANY(${regionIds}::uuid[]) AND map_domain_id = ${AVENTURIA.mapDomain} AND is_active
            `;
            if (regionen.length !== regionIds.length) {
                throw new ApiError(400, "validation_failed", "Diese Region gibt es nicht.", {
                    issues: [{ path: "targets", rule: "not_allowed" }],
                });
            }

            const spalten = (Object.keys(SPALTE) as MamKarteFeld[]).filter((feld) => body.fields[feld] !== undefined);
            const werte = spalten.map((feld) => bereinigt(feld, body.fields[feld]) as string | number | boolean | null);
            const [karte] = await tx.unsafe<{ id: string; public_id: string; revision: number }[]>(
                `INSERT INTO citymap (public_id, ${spalten.map((feld) => SPALTE[feld]).join(", ")}, legacy_origin, source_system)
                 VALUES (gen_random_uuid(), ${spalten.map((_, index) => `$${String(index + 1)}`).join(", ")}, 'manual', 'avesmaps3d')
                 RETURNING id::text AS id, public_id::text AS public_id, revision::int AS revision`,
                werte,
            );
            if (karte === undefined) throw new Error("citymap: INSERT ohne Zeile");

            if (typen.length > 0) {
                await tx`
                    INSERT INTO citymap_type (citymap_id, type_key, source_system)
                    SELECT ${karte.id}::bigint, k, 'avesmaps3d' FROM unnest(${typen}::text[]) AS k
                `;
            }
            // In der gewählten Folge. Der Name steht als Rohname an der Karte (wie Legacy), das Ziel ist aufgelöst.
            let folge = 0;
            for (const ziel of ziele) {
                const treffer = (ziel.kind === "place" ? orte : regionen).find((zeile) => zeile.public_id === ziel.id)!;
                const spalte = ziel.kind === "place" ? "place_id" : "region_id";
                await tx.unsafe(
                    `INSERT INTO citymap_place (citymap_id, sort_order, export_ordinal, name_key, dup_ordinal, raw_name, target_state, resolved_by,
                                               ${spalte}, target_origin, legacy_origin, source_system)
                     VALUES ($1::bigint, $2::int, $2::int, $3, 0, $4, 'resolved', 'public_id', $5::bigint, 'editor', 'manual', 'avesmaps3d')`,
                    [karte.id, folge, treffer.name.trim().toLowerCase(), treffer.name, treffer.id],
                );
                folge += 1;
            }
            return {
                receipt: {
                    affected: [{ kind: "citymap", id: karte.public_id, revision: karte.revision }],
                    derivedWork: [],
                    warnings: [],
                },
                entries: [
                    {
                        action: "citymap.created",
                        citymapId: karte.public_id,
                        targetRevision: karte.revision,
                        details: { way: "none", types: typen.length, place: ziele.length > 0 },
                    },
                ],
            };
        },
    );
}
