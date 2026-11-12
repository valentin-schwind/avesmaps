import { AVENTURIA, type MamKarteOrteBody, type MamKarteOrtZiel, type OperationReceipt } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { hebeRevision, sperreKarte } from "./kartensammlung-bilder.ts";
import { mediaOperation, type MediaActor } from "./operation-store.ts";

/**
 * Die Orte und Regionen eines Eintrags der Kartensammlung (WI-0287 Stufe 3; Operation `citymap.places`): einen Ort oder eine Region anhängen, eine Zeile lösen und einer nicht
 * aufgelösten Zeile ein Ziel geben. Je Handlung eine Operation (sofort speichern). Dahinter steht dieselbe Tafel wie bei den Besuchern (`citymap_place`, `place_id` bzw. `region_id`); die
 * Sektion Kartensammlung eines Orts und einer Region liest sie (`subjects/sections/citymaps.ts`), der Reiter „Karten“ im Derographie-Editor ebenso.
 *
 * 🔴 Gleicher Weg wie `kartensammlung-links.ts`: die Sperre der Kartendomäne geteilt (503 `map_import_running`), der gesehene Stand (`baseRevision`, 409), ein stillgelegter Eintrag nimmt
 * nichts an (409 `citymap_retired`), Revision plus eins und eine Zeile `citymap.updated` mit `details.fields = ["places"]` und der Handlung (`details.op`), die die Karte gegen den Legacy-Zug
 * hält (`karte-gehalten.ts`).
 *
 * - **`index`** ist die Stelle in der Liste der AKTIVEN Zeilen, wie die Detailantwort sie liefert (`ORDER BY sort_order, id`); der gesehene Stand macht sie eindeutig.
 * - **`add`:** das Ziel muss es geben, aktiv und in der Kartendomäne sein (sonst 400 `validation_failed`); hängt es schon aktiv am Eintrag, 409 `citymap_target_present`. Die neue Zeile steht
 *   am Ende (`sort_order` und `export_ordinal` = höchste Folge aller Zeilen des Eintrags, auch der stillgelegten, plus eins), mit dem Namen des Ziels als Rohname.
 * - **`remove`:** die Zeile wird stillgelegt (`retired_origin = 'editor'`), nie gelöscht.
 * - **`resolve`:** nur eine nicht aufgelöste Zeile (`unresolved`, `unmatched`; sonst 409 `citymap_place_resolved`); dieselbe Zeile bekommt das Ziel, der Rohname bleibt.
 */

interface Zeile {
    id: string;
    target_state: string;
}

type Spalte = "place_id" | "region_id";

const ungueltig = (pfad: string, regel: string, satz: string): ApiError =>
    new ApiError(400, "validation_failed", satz, { issues: [{ path: pfad, rule: regel }] });

/** Das Ziel lesen: aktiv und in der Kartendomäne, sonst 400. Gibt die interne Kennung samt Spalte und Namen zurück. */
async function zielVon(
    tx: Queryable,
    ziel: MamKarteOrtZiel | undefined,
): Promise<{ id: string; name: string; spalte: Spalte }> {
    if (ziel === undefined) throw ungueltig("/target", "required", "Bitte einen Ort oder eine Region wählen.");
    const [zeile] =
        ziel.kind === "place"
            ? await tx<{ id: string; name: string }[]>`
                  SELECT id::text AS id, name FROM place
                   WHERE public_id = ${ziel.id}::uuid AND map_domain_id = ${AVENTURIA.mapDomain} AND is_active
              `
            : await tx<{ id: string; name: string }[]>`
                  SELECT id::text AS id, name FROM region
                   WHERE public_id = ${ziel.id}::uuid AND map_domain_id = ${AVENTURIA.mapDomain} AND is_active
              `;
    if (zeile === undefined) {
        throw ungueltig(
            "/target",
            "not_allowed",
            ziel.kind === "place" ? "Diesen Ort gibt es nicht." : "Diese Region gibt es nicht.",
        );
    }
    return { ...zeile, spalte: ziel.kind === "place" ? "place_id" : "region_id" };
}

/** Hängt das Ziel schon aktiv an diesem Eintrag? */
async function haengtSchon(tx: Queryable, karteId: string, spalte: Spalte, zielId: string): Promise<boolean> {
    const [zeile] = await tx.unsafe<{ id: string }[]>(
        `SELECT id::text AS id FROM citymap_place WHERE citymap_id = $1::bigint AND is_active AND ${spalte} = $2::bigint LIMIT 1`,
        [karteId, zielId],
    );
    return zeile !== undefined;
}

const schonDa = (): ApiError =>
    new ApiError(409, "citymap_target_present", "Dieser Ort oder diese Region hängt hier schon.");

export function aendereKartenorte(
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: MamKarteOrteBody,
    /** Die Kartendomäne der Sperre; nur Tests nennen eine eigene. */
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> {
    const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "citymap.places",
            body: {
                citymapId: publicId,
                baseRevision: body.baseRevision,
                action: body.action,
                index: body.index ?? null,
                target: body.target ?? null,
            },
        },
        async (tx) => {
            const karte = await sperreKarte(tx, publicId, body.baseRevision, domaene);
            if (body.action === "add") {
                const ziel = await zielVon(tx, body.target);
                if (await haengtSchon(tx, karte.id, ziel.spalte, ziel.id)) throw schonDa();
                const [folge] = await tx<{ n: number }[]>`
                    SELECT coalesce(max(greatest(sort_order, export_ordinal)) + 1, 0)::int AS n
                      FROM citymap_place WHERE citymap_id = ${karte.id}::bigint
                `;
                const n = folge?.n ?? 0;
                await tx.unsafe(
                    `INSERT INTO citymap_place (citymap_id, sort_order, export_ordinal, name_key, dup_ordinal, raw_name, target_state, resolved_by,
                                               ${ziel.spalte}, target_origin, legacy_origin, source_system)
                     VALUES ($1::bigint, $2::int, $2::int, $3, 0, $4, 'resolved', 'public_id', $5::bigint, 'editor', 'manual', 'avesmaps3d')`,
                    [karte.id, n, ziel.name.trim().toLowerCase(), ziel.name, ziel.id],
                );
            } else {
                if (body.index === undefined) throw ungueltig("/index", "required", "Welche Zeile gemeint ist, fehlt.");
                // Die aktiven Zeilen in der Folge der Detailantwort, gesperrt.
                const zeilen = await tx<Zeile[]>`
                    SELECT id::text AS id, target_state FROM citymap_place
                     WHERE citymap_id = ${karte.id}::bigint AND is_active ORDER BY sort_order, id FOR UPDATE
                `;
                const zeile = zeilen[body.index];
                if (zeile === undefined) throw ungueltig("/index", "out_of_range", "Diese Zeile gibt es nicht mehr.");
                if (body.action === "remove") {
                    await tx`
                        UPDATE citymap_place
                           SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor', updated_at = now()
                         WHERE id = ${zeile.id}::bigint
                    `;
                } else {
                    if (zeile.target_state === "resolved") {
                        throw new ApiError(409, "citymap_place_resolved", "Diese Zeile ist schon zugeordnet.");
                    }
                    const ziel = await zielVon(tx, body.target);
                    if (await haengtSchon(tx, karte.id, ziel.spalte, ziel.id)) throw schonDa();
                    await tx.unsafe(
                        `UPDATE citymap_place
                            SET target_state = 'resolved', resolved_by = 'public_id', ${ziel.spalte} = $2::bigint, target_origin = 'editor', updated_at = now()
                          WHERE id = $1::bigint`,
                        [zeile.id, ziel.id],
                    );
                }
            }
            const revision = await hebeRevision(tx, karte);
            return {
                receipt: { affected: [{ kind: "citymap", id: publicId, revision }], derivedWork: [], warnings: [] },
                entries: [
                    {
                        action: "citymap.updated",
                        citymapId: publicId,
                        targetRevision: revision,
                        details: { fields: ["places"], op: body.action },
                    },
                ],
            };
        },
    );
}
