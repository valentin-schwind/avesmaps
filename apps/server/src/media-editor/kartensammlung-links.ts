import { AVENTURIA, KARTE_LINK_LABEL_VORGABE, type MamKarteLinksBody, type OperationReceipt } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { hebeRevision, sperreKarte } from "./kartensammlung-bilder.ts";
import { mediaOperation, type MediaActor } from "./operation-store.ts";

/**
 * Die Fundstellen (Links) eines Eintrags der Kartensammlung ersetzen (WI-0287 Stufe 1, Punkt 3; Operation `citymap.links`). Die Menge gilt in der gegebenen Folge: die erste
 * Zeile ist der Karten-Link (`primary`, höchstens einer aktiv, `citymap_link_one_active_primary`), alle weiteren sind `further`; `position` ist die Folge. Was wegfällt, wird
 * stillgelegt (`state = 'retired'`, `retired_origin = 'editor'`), eine früher gelöste Adresse lebt wieder auf (die Zeile bleibt, `citymap_link_url_unique`), eine neue wird von Hand
 * angelegt (`source_system = 'avesmaps3d'`, `legacy_origin = 'manual'`). `is_paid` ist dreiwertig, `NULL` heißt unbekannt.
 *
 * 🔴 Gleicher Weg wie `kartensammlung-bilder.ts`: die Sperre der Kartendomäne geteilt (503 `map_import_running`), der gesehene Stand (`baseRevision`, 409), Revision plus eins, eine
 * Zeile `citymap.updated` mit `details.fields = ["links"]`, die die Karte gegen den Legacy-Zug hält (`karte-gehalten.ts`); ein stillgelegter Eintrag nimmt nichts an (409 `citymap_retired`).
 *
 * Reihenfolge der Schritte wegen des Index auf den Karten-Link: erst alles stilllegen, was nicht mehr dazugehört, dann alle übrigen aktiven auf `further` setzen, dann in Folge schreiben.
 */

const HTTP = /^https?:\/\/\S+$/i;

function pruefe(body: MamKarteLinksBody): { url: string; label: string; isPaid: boolean | null }[] {
    const gesehen = new Set<string>();
    return body.links.map((link, i) => {
        const url = link.url.trim();
        let gueltig = HTTP.test(url);
        if (gueltig) {
            try {
                new URL(url);
            } catch {
                gueltig = false;
            }
        }
        if (!gueltig) {
            throw new ApiError(400, "validation_failed", "Bitte eine Adresse mit http oder https.", {
                issues: [{ path: `/links/${i}/url`, rule: "http_url" }],
            });
        }
        if (gesehen.has(url)) {
            throw new ApiError(400, "validation_failed", "Diese Adresse steht schon in der Liste.", {
                issues: [{ path: `/links/${i}/url`, rule: "unique" }],
            });
        }
        gesehen.add(url);
        const label = link.label.trim();
        return { url, label: label === "" ? KARTE_LINK_LABEL_VORGABE : label, isPaid: link.isPaid };
    });
}

export function ersetzeKartenlinks(
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: MamKarteLinksBody,
    /** Die Kartendomäne der Sperre; nur Tests nennen eine eigene. */
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> {
    const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "citymap.links",
            body: { citymapId: publicId, baseRevision: body.baseRevision, links: body.links },
        },
        async (tx) => {
            const karte = await sperreKarte(tx, publicId, body.baseRevision, domaene);
            const links = pruefe(body);
            const adressen = links.map((link) => link.url);
            await tx`
                UPDATE citymap_link
                   SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor', updated_at = now()
                 WHERE citymap_id = ${karte.id}::bigint AND is_active AND NOT (url = ANY(${adressen}::text[]))
            `;
            await tx`
                UPDATE citymap_link SET link_role = 'further', updated_at = now()
                 WHERE citymap_id = ${karte.id}::bigint AND is_active AND link_role <> 'further'
            `;
            for (const [i, link] of links.entries()) {
                await tx`
                    INSERT INTO citymap_link (citymap_id, link_role, url, label, is_paid, position, legacy_origin, source_system)
                    VALUES (${karte.id}::bigint, ${i === 0 ? "primary" : "further"}, ${link.url}, ${link.label}, ${link.isPaid}, ${i}, 'manual', 'avesmaps3d')
                    ON CONFLICT (citymap_id, url) DO UPDATE
                       SET link_role = EXCLUDED.link_role, label = EXCLUDED.label, is_paid = EXCLUDED.is_paid, position = EXCLUDED.position,
                           state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
                `;
            }
            const revision = await hebeRevision(tx, karte);
            return {
                receipt: { affected: [{ kind: "citymap", id: publicId, revision }], derivedWork: [], warnings: [] },
                entries: [
                    {
                        action: "citymap.updated",
                        citymapId: publicId,
                        targetRevision: revision,
                        details: { fields: ["links"] },
                    },
                ],
            };
        },
    );
}
