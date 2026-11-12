import { AVENTURIA, type MamKarteQuellenBody, type OperationReceipt } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { notFound } from "./asset-operations.ts";
import { hebeRevision, sperreKarte, type Karte } from "./kartensammlung-bilder.ts";
import { mediaOperation, type MediaActor } from "./operation-store.ts";

/**
 * Die Publikationen eines Eintrags der Kartensammlung (WI-0287 Stufe 1, Punkt 4; Operation `citymap.sources`): eine Quelle des Katalogs anhängen, ihre Fundstelle setzen, lösen,
 * wiederherstellen und an den Anfang stellen. Je Handlung eine Operation (sofort speichern, Betreiber 2026-10-28); die Oberfläche ist die Quellen-Klappbox der Karteneditoren.
 *
 * 🔴 **Warum eine Operation der Medienverwaltung und nicht `traeger.sources`:** Der Eintrag ist ein Datensatz der Medienverwaltung mit eigener Revision (ADR-0020, 0197). Der Schutz
 * gegen den Legacy-Zug liest das Fachprotokoll der MEDIEN (`karte-gehalten.ts`, `citymap.updated`); `traeger.sources` schriebe ins Fachprotokoll der Karte und hielte die Karte nicht.
 * Das Recht ist das der Sammlung (`upload_media` oder `edit_map_collection`), nicht `manage_sources`; die Karte hat keinen Kanon, den `traeger.sources` neu rechnet, und keinen
 * Platz in `CARRIER_TABLES`. Gleicher Weg wie `kartensammlung-links.ts` und `kartensammlung-bilder.ts`: die Sperre der Kartendomäne geteilt (503 `map_import_running`), der gesehene
 * Stand (`baseRevision`, 409), ein stillgelegter Eintrag nimmt nichts an (409 `citymap_retired`), Revision plus eins und eine Zeile `citymap.updated` mit `details.fields = ["sources"]`.
 * Eine Handlung, die nichts ändert (dieselbe Fundstelle, schon die erste), schreibt weder Revision noch Protokoll. Die Rücknahme der „Änderungen“ kennt `citymap.updated` nicht (WI-0287 §5).
 *
 * - **Reihenfolge:** `position` ordnet alle Verknüpfungen, auch die gelösten; die erste aktive ist der Band (`subjects/sections/citymaps.ts`). Lösen und Wiederherstellen lassen den Platz
 *   stehen (eine gelöste kommt an ihren Platz zurück), eine neue kommt ans Ende, `first` stellt eine aktive an den Anfang und zählt alle neu durch.
 * - **Lösen** setzt `retired` mit `retired_origin = 'editor'`, auch an einer Verknüpfung aus Legacy: Der Zug lässt die gehaltene Karte samt Quellen ohnehin stehen (wie die Fundstellen).
 * - Was der Editor anlegt, trägt `source_system = 'avesmaps3d'` und `legacy_origin = 'manual'` (wie die Fundstellen).
 * - 400 `validation_failed`: eine im Katalog stillgelegte Quelle anhängen oder holen, schon angehängt, nicht angehängt, nicht gelöst, `pages` fehlt. 404: Quelle unbekannt.
 */

interface Verknuepfung {
    id: string;
    state: string;
    pages: string | null;
}

const ungueltig = (regel: string, satz: string): ApiError =>
    new ApiError(400, "validation_failed", satz, { issues: [{ path: "/sourceId", rule: regel }] });

/** Leer ist keine Fundstelle (die Tafel verbietet leere Texte). */
const fundstelle = (wert: string | null | undefined): string | null => {
    const text = (wert ?? "").trim();
    return text === "" ? null : text;
};

async function quelleVon(tx: Queryable, sourceId: string): Promise<{ id: string; is_active: boolean }> {
    const [quelle] = await tx<{ id: string; is_active: boolean }[]>`
        SELECT id::text AS id, is_active FROM feature_source WHERE public_id = ${sourceId}::uuid
    `;
    if (quelle === undefined) throw notFound("Diese Quelle");
    return quelle;
}

/** Alle Verknüpfungen in der Reihenfolge neu durchzählen, `vorn` zuerst. */
async function zaehleDurch(tx: Queryable, karte: Karte, vorn: string): Promise<void> {
    await tx`
        WITH folge AS (
            SELECT id, (row_number() OVER (ORDER BY (id = ${vorn}::bigint) DESC, position, id) - 1)::int AS neu
              FROM citymap_source WHERE citymap_id = ${karte.id}::bigint
        )
        UPDATE citymap_source s SET position = folge.neu, updated_at = now()
          FROM folge WHERE s.id = folge.id AND s.position <> folge.neu
    `;
}

/** Die eine Handlung; `false`, wenn sie nichts ändert. */
async function wendeAn(tx: Queryable, karte: Karte, body: MamKarteQuellenBody): Promise<boolean> {
    const quelle = await quelleVon(tx, body.sourceId);
    const [bisher] = await tx<Verknuepfung[]>`
        SELECT id::text AS id, state, pages FROM citymap_source
         WHERE citymap_id = ${karte.id}::bigint AND source_id = ${quelle.id}::bigint
         FOR UPDATE
    `;
    const aktiv = bisher?.state === "active";
    switch (body.op) {
        case "add": {
            if (!quelle.is_active) throw ungueltig("state", "Eine stillgelegte Quelle lässt sich nicht anhängen.");
            if (aktiv) throw ungueltig("unique", "Diese Publikation hängt hier schon.");
            const seiten = body.pages === undefined ? (bisher?.pages ?? null) : fundstelle(body.pages);
            if (bisher === undefined) {
                await tx`
                    INSERT INTO citymap_source (citymap_id, source_id, pages, position, legacy_origin, source_system)
                    VALUES (${karte.id}::bigint, ${quelle.id}::bigint, ${seiten},
                            (SELECT coalesce(max(position) + 1, 0) FROM citymap_source WHERE citymap_id = ${karte.id}::bigint),
                            'manual', 'avesmaps3d')
                `;
            } else {
                // Früher gelöst: dieselbe Zeile lebt an ihrem Platz wieder auf (`citymap_source_pair_unique`).
                await tx`
                    UPDATE citymap_source
                       SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, pages = ${seiten}, updated_at = now()
                     WHERE id = ${bisher.id}::bigint
                `;
            }
            return true;
        }
        case "pages": {
            if (!aktiv) throw ungueltig("state", "Diese Publikation hängt hier nicht (mehr).");
            if (body.pages === undefined) {
                throw new ApiError(400, "validation_failed", "Die Fundstelle fehlt.", {
                    issues: [{ path: "/pages", rule: "required" }],
                });
            }
            const seiten = fundstelle(body.pages);
            if (seiten === bisher.pages) return false;
            await tx`UPDATE citymap_source SET pages = ${seiten}, updated_at = now() WHERE id = ${bisher.id}::bigint`;
            return true;
        }
        case "remove": {
            if (!aktiv) throw ungueltig("state", "Diese Publikation hängt hier nicht (mehr).");
            await tx`
                UPDATE citymap_source
                   SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor', updated_at = now()
                 WHERE id = ${bisher.id}::bigint
            `;
            return true;
        }
        case "restore": {
            if (bisher === undefined || aktiv) throw ungueltig("state", "Diese Publikation ist nicht gelöst.");
            if (!quelle.is_active) throw ungueltig("state", "Eine stillgelegte Quelle lässt sich nicht anhängen.");
            await tx`
                UPDATE citymap_source
                   SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
                 WHERE id = ${bisher.id}::bigint
            `;
            return true;
        }
        case "first": {
            if (!aktiv) throw ungueltig("state", "Diese Publikation hängt hier nicht (mehr).");
            const [erste] = await tx<{ id: string }[]>`
                SELECT id::text AS id FROM citymap_source
                 WHERE citymap_id = ${karte.id}::bigint AND state = 'active'
                 ORDER BY position, id LIMIT 1
            `;
            if (erste?.id === bisher.id) return false;
            await zaehleDurch(tx, karte, bisher.id);
            return true;
        }
    }
}

export function aendereKartenquellen(
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: MamKarteQuellenBody,
    /** Die Kartendomäne der Sperre; nur Tests nennen eine eigene. */
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> {
    const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "citymap.sources",
            body: {
                citymapId: publicId,
                baseRevision: body.baseRevision,
                op: body.op,
                sourceId: body.sourceId,
                ...(body.pages === undefined ? {} : { pages: body.pages }),
            },
        },
        async (tx) => {
            const karte = await sperreKarte(tx, publicId, body.baseRevision, domaene);
            if (!(await wendeAn(tx, karte, body))) {
                return {
                    receipt: {
                        affected: [{ kind: "citymap", id: publicId, revision: karte.revision }],
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: [],
                };
            }
            const revision = await hebeRevision(tx, karte);
            return {
                receipt: { affected: [{ kind: "citymap", id: publicId, revision }], derivedWork: [], warnings: [] },
                entries: [
                    {
                        action: "citymap.updated",
                        citymapId: publicId,
                        targetRevision: revision,
                        details: { fields: ["sources"] },
                    },
                ],
            };
        },
    );
}
