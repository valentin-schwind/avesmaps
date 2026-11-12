import { AVENTURIA, type DerivedWork, type MamKarteZusammenlegenBody, type OperationReceipt } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { DERIVE_LOCK_CLASS } from "../derive/derive-lock.ts";
import { mapImportRunning } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { notFound } from "./asset-operations.ts";
import { mediaEditConflict } from "./audit.ts";
import { aktiveVersionen, versionsBezeichnung, zaehleVersionenDurch } from "./kartensammlung-bilder.ts";
import { mediaOperation, type MediaActor } from "./operation-store.ts";
import { enqueueSettle } from "./settle.ts";

/**
 * Zwei Einträge der Kartensammlung zusammenlegen (WI-0287 Stufe 2, Operation `citymap.merge`; im Dialog „Eintrag entfernen“ die Wahl „Bilder an anderen Eintrag geben“). Anlass:
 * Spieler- und SL-Fassungen standen als getrennte Einträge da („Re'Cha“ und „Re'Cha Spielerversion“), dazu Dubletten. In EINER Transaktion gibt der Eintrag seine Bilder an das Ziel
 * und wird stillgelegt (wie `citymap.retire`, `kartensammlung-stilllegen.ts`):
 *
 * - **Karten:** Jede aktive Version wird eine weitere Version des Ziels, ans Ende, in ihrer Folge. Die erste bekommt `versionLabel` (ohne Angabe ihre eigene Bezeichnung), die übrigen
 *   behalten ihre. Hängt dasselbe Werk am Ziel schon, wird es nicht doppelt geführt; hat es dort keine Bezeichnung und ist es die erste Version der Quelle, bekommt es die übergebene.
 *   Die Einzelentscheidung der Verwendung (`publication_override` samt Begründung) zieht mit: Ein „gesperrt“ geht beim Zusammenlegen nicht verloren.
 * - **Vorschau:** Sie zieht mit, wenn das Ziel keine hat; sonst bleibt sie nur unter „Kartenvorschauen“ (die Bindung an der Quelle wird gelöst, das Werk bleibt).
 * - **Fundstellen, Publikationen, Orte**, die am Ziel fehlen, kommen dazu (Kopien; am stillgelegten Eintrag bleibt alles stehen). Eine Publikation, die das Ziel in irgendeinem Zustand
 *   kennt, bleibt dort, wie sie ist: Eine gelöste hat jemand bewusst gelöst. Ein Link, den das Ziel früher hatte, lebt wieder auf. Hat das Ziel keinen Karten-Link, wird der erste
 *   übernommene es.
 * - Am stillgelegten Eintrag hängt danach kein Bild mehr; „Zurückholen“ (`citymap.restore`) lässt die übergebenen am Ziel.
 *
 * 🔴 Gleicher Weg wie die anderen Operationen am Eintrag: die Sperre der Kartendomäne geteilt (503 `map_import_running`), der gesehene Stand BEIDER Einträge (`baseRevision`,
 * `targetBaseRevision`, 409 `edit_conflict`), beide Zeilen gesperrt in fester Folge (nach `id`, damit zwei Zusammenlegungen über Kreuz nicht verklemmen). 409: die Quelle ist schon
 * stillgelegt (`citymap_already_retired`), das Ziel ist stillgelegt (`citymap_target_retired`), das Ziel ist die Quelle (`citymap_merge_self`); ein unbekanntes Ziel 404. Zwei Zeilen
 * im Fachprotokoll, beide halten ihren Eintrag gegen den Legacy-Zug (`karte-gehalten.ts`): `citymap.retired` an der Quelle mit `handedTo` (das Ziel; der Inspector nennt es) und
 * `citymap.updated` am Ziel mit `fields` und `handedFrom`. Beide Revisionen zählen eins hoch. Der Abgleich wird je berührtem Werk und Rolle eingereiht.
 */

type Rolle = "map_full" | "map_preview";

interface Eintrag {
    id: string;
    public_id: string;
    revision: number;
    updated_at: Date;
    state: string;
}

export const zielStillgelegt = (): ApiError =>
    new ApiError(409, "citymap_target_retired", "Der gewählte Eintrag ist stillgelegt. Bitte einen anderen wählen.");

/** Ein Werk als Bindung an einen Eintrag hängen: neu oder eine früher gelöste Zeile, die wieder auflebt. Die Einzelentscheidung kommt aus `entscheidung` (eine Bindung) oder fehlt. */
async function binde(
    tx: Queryable,
    karteId: string,
    assetDb: string,
    rolle: Rolle,
    version: { label: string | null; stelle: number | null },
    entscheidung?: string,
): Promise<void> {
    await tx`
        INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin, version_label, version_position, publication_override,
                                   override_decided_on, override_operator_quote, override_decided_by, override_reason)
        SELECT ${karteId}::bigint, ${assetDb}::bigint, ${rolle}, 'editor', ${version.label}, ${version.stelle},
               coalesce(m.publication_override, 'none'), m.override_decided_on, m.override_operator_quote, m.override_decided_by, m.override_reason
          FROM (SELECT 1) eins LEFT JOIN citymap_media m ON m.id = ${entscheidung ?? null}::bigint
        ON CONFLICT (citymap_id, media_asset_id, role) DO UPDATE
           SET retired_at = NULL, origin = 'editor', publication_override = EXCLUDED.publication_override,
               override_decided_on = EXCLUDED.override_decided_on, override_operator_quote = EXCLUDED.override_operator_quote,
               override_decided_by = EXCLUDED.override_decided_by, override_reason = EXCLUDED.override_reason,
               version_label = EXCLUDED.version_label, version_position = EXCLUDED.version_position, updated_at = now()
    `;
}

/**
 * Ein Werk als weitere Version an die Karte eines Eintrags hängen, ans Ende (die bisherigen werden ohne Lücken durchgezählt). Auch für die Annahme eines Kartenvorschlags als Version
 * (`kartenvorschlag/annehmen.ts`). `false`, wenn das Werk dort schon als Version hängt (dann ändert sich nichts).
 */
export async function haengeVersionAn(
    tx: Queryable,
    karteId: string,
    assetDb: string,
    label: string | null,
): Promise<boolean> {
    const versionen = await aktiveVersionen(tx, karteId);
    if (versionen.some((version) => version.assetDb === assetDb)) return false;
    await zaehleVersionenDurch(
        tx,
        versionen.map((version) => version.id),
    );
    await binde(tx, karteId, assetDb, "map_full", { label, stelle: versionen.length });
    return true;
}

/** Ein Link, der zu den Fundstellen eines Eintrags kommt; `legacyOrigin` sagt, woher er stammt (wie `citymap_link.legacy_origin`). */
export interface NeuerLink {
    url: string;
    label: string;
    isPaid: boolean | null;
    legacyOrigin: string;
}

/**
 * Links an die Fundstellen eines Eintrags anfügen, die dort nicht aktiv sind: ans Ende, eine früher gelöste Adresse lebt in ihrer Zeile wieder auf (`citymap_link_url_unique`). Hat der
 * Eintrag keinen Karten-Link, wird der erste angefügte es. Gibt zurück, wie viele dazukamen.
 */
export async function ergaenzeLinks(tx: Queryable, karteId: string, links: readonly NeuerLink[]): Promise<number> {
    const [stand] = await tx<{ adressen: string[]; primaer: boolean; ende: number }[]>`
        SELECT coalesce(array_agg(url) FILTER (WHERE is_active), '{}') AS adressen,
               coalesce(bool_or(is_active AND link_role = 'primary'), FALSE) AS primaer,
               coalesce(max(position) + 1, 0)::int AS ende
          FROM citymap_link WHERE citymap_id = ${karteId}::bigint
    `;
    const da = new Set(stand?.adressen ?? []);
    let primaer = stand?.primaer ?? false;
    let stelle = stand?.ende ?? 0;
    let dazu = 0;
    for (const link of links) {
        if (da.has(link.url)) continue;
        da.add(link.url);
        const rolle = primaer ? "further" : "primary";
        primaer = true;
        await tx`
            INSERT INTO citymap_link (citymap_id, link_role, url, label, is_paid, position, legacy_origin, source_system)
            VALUES (${karteId}::bigint, ${rolle}, ${link.url}, ${link.label}, ${link.isPaid}, ${stelle}, ${link.legacyOrigin}, 'avesmaps3d')
            ON CONFLICT (citymap_id, url) DO UPDATE
               SET link_role = EXCLUDED.link_role, label = EXCLUDED.label, is_paid = EXCLUDED.is_paid, position = EXCLUDED.position,
                   state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
        `;
        stelle += 1;
        dazu += 1;
    }
    return dazu;
}

/** Die Publikationen der Quelle, die das Ziel in keinem Zustand kennt, ans Ende; eine im Katalog stillgelegte Quelle nicht. Wie viele kamen dazu. */
async function ergaenzeQuellen(tx: Queryable, quelle: string, ziel: string): Promise<number> {
    const neu = await tx`
        INSERT INTO citymap_source (citymap_id, source_id, reference_kind, pages, note, legacy_origin, position, source_system)
        SELECT ${ziel}::bigint, q.source_id, q.reference_kind, q.pages, q.note, q.legacy_origin,
               (SELECT coalesce(max(position) + 1, 0) FROM citymap_source WHERE citymap_id = ${ziel}::bigint)
                   + (row_number() OVER (ORDER BY q.position, q.id) - 1)::int,
               'avesmaps3d'
          FROM citymap_source q JOIN feature_source s ON s.id = q.source_id AND s.is_active
         WHERE q.citymap_id = ${quelle}::bigint AND q.is_active
           AND NOT EXISTS (SELECT 1 FROM citymap_source z WHERE z.citymap_id = ${ziel}::bigint AND z.source_id = q.source_id)
        RETURNING id
    `;
    return neu.length;
}

/**
 * Die Orte der Quelle, die am Ziel fehlen, ans Ende: ein aufgelöster, wenn das Ziel nicht schon auf dasselbe zeigt; ein offener (ohne Ziel), wenn dort kein offener gleichen Namens
 * steht. Wie viele kamen dazu.
 */
async function ergaenzeOrte(tx: Queryable, quelle: string, ziel: string): Promise<number> {
    const neu = await tx`
        WITH basis AS (
            SELECT coalesce(max(sort_order) + 1, 0) AS sortierung, coalesce(max(export_ordinal) + 1, 0) AS folge
              FROM citymap_place WHERE citymap_id = ${ziel}::bigint
        ),
        fehlend AS (
            SELECT q.*, (row_number() OVER (ORDER BY q.sort_order, q.id) - 1)::int AS n
              FROM citymap_place q
             WHERE q.citymap_id = ${quelle}::bigint AND q.is_active
               AND NOT EXISTS (
                   SELECT 1 FROM citymap_place z
                    WHERE z.citymap_id = ${ziel}::bigint AND z.is_active
                      AND z.place_id IS NOT DISTINCT FROM q.place_id AND z.territory_id IS NOT DISTINCT FROM q.territory_id
                      AND z.region_id IS NOT DISTINCT FROM q.region_id AND z.terrain_peak_id IS NOT DISTINCT FROM q.terrain_peak_id
                      AND z.path_id IS NOT DISTINCT FROM q.path_id
                      AND (q.target_state = 'resolved' OR z.name_key = q.name_key)
               )
        )
        INSERT INTO citymap_place (citymap_id, sort_order, export_ordinal, name_key, dup_ordinal, raw_name, target_state, resolved_by,
                                   place_id, territory_id, region_id, terrain_peak_id, path_id, legacy_target_kind,
                                   legacy_target_public_id, legacy_target_wiki_key, target_origin, legacy_origin, source_system)
        SELECT ${ziel}::bigint, basis.sortierung + f.n, basis.folge + f.n, f.name_key, f.dup_ordinal, f.raw_name, f.target_state, f.resolved_by,
               f.place_id, f.territory_id, f.region_id, f.terrain_peak_id, f.path_id, f.legacy_target_kind,
               f.legacy_target_public_id, f.legacy_target_wiki_key, f.target_origin, f.legacy_origin, 'avesmaps3d'
          FROM fehlend f CROSS JOIN basis
        RETURNING id
    `;
    return neu.length;
}

/** Quelle und Ziel sperren und prüfen; die Reihenfolge der Prüfungen nennt zuerst, was an der Quelle nicht stimmt. */
async function sperreBeide(
    tx: Queryable,
    publicId: string,
    body: MamKarteZusammenlegenBody,
    domaene: string,
): Promise<{ quelle: Eintrag; ziel: Eintrag }> {
    const [frei] = await tx<{ ok: boolean }[]>`
        SELECT pg_try_advisory_xact_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${domaene})) AS ok
    `;
    if (frei?.ok !== true) throw mapImportRunning();
    const zeilen = await tx<Eintrag[]>`
        SELECT c.id::text AS id, c.public_id::text AS public_id, c.revision::int AS revision, c.updated_at, c.state
          FROM citymap c WHERE c.public_id = ANY(${[publicId, body.targetId]}::uuid[])
         ORDER BY c.id FOR UPDATE OF c
    `;
    const gleich = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
    const quelle = zeilen.find((zeile) => gleich(zeile.public_id, publicId));
    const ziel = zeilen.find((zeile) => gleich(zeile.public_id, body.targetId));
    if (quelle === undefined) throw notFound("Diese Karte");
    if (quelle.revision !== body.baseRevision) {
        throw await mediaEditConflict(
            tx,
            { record: "citymap", citymapId: quelle.public_id },
            { revision: quelle.revision, changedAt: quelle.updated_at },
        );
    }
    if (quelle.state !== "active") {
        throw new ApiError(409, "citymap_already_retired", "Dieser Eintrag ist schon stillgelegt.");
    }
    if (ziel === undefined) throw notFound("Dieser Eintrag");
    if (ziel.state !== "active") throw zielStillgelegt();
    if (ziel.revision !== body.targetBaseRevision) {
        throw await mediaEditConflict(
            tx,
            { record: "citymap", citymapId: ziel.public_id },
            { revision: ziel.revision, changedAt: ziel.updated_at },
        );
    }
    return { quelle, ziel };
}

export function legeKartenZusammen(
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: MamKarteZusammenlegenBody,
    /** Die Kartendomäne der Sperre; nur Tests nennen eine eigene. */
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> {
    const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
    if (publicId.toLowerCase() === body.targetId.toLowerCase()) {
        throw new ApiError(409, "citymap_merge_self", "Ein Eintrag lässt sich nicht an sich selbst geben.");
    }
    const bezeichnung = body.versionLabel === undefined ? undefined : versionsBezeichnung(body.versionLabel);
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "citymap.merge",
            body: {
                citymapId: publicId,
                baseRevision: body.baseRevision,
                targetId: body.targetId,
                targetBaseRevision: body.targetBaseRevision,
                ...(bezeichnung === undefined ? {} : { versionLabel: bezeichnung }),
            },
        },
        async (tx) => {
            const { quelle, ziel } = await sperreBeide(tx, publicId, body, domaene);
            const felder = new Set<string>();
            /** Je Werk und Rolle EIN Abgleich: was an der Quelle gelöst und am Ziel gebunden wird, entscheidet die Policy neu. */
            const abgleich = new Map<string, { asset: string; rolle: Rolle }>();
            const gleiche = (asset: string, rolle: Rolle): void => {
                abgleich.set(`${asset}:${rolle}`, { asset, rolle });
            };

            // Die Karten: in der Folge der Quelle ans Ende des Ziels.
            const quellVersionen = await aktiveVersionen(tx, quelle.id);
            const zielVersionen = await aktiveVersionen(tx, ziel.id);
            await zaehleVersionenDurch(
                tx,
                zielVersionen.map((version) => version.id),
            );
            let stelle = zielVersionen.length;
            for (const [i, version] of quellVersionen.entries()) {
                const label = i === 0 && bezeichnung !== undefined ? bezeichnung : version.label;
                const dort = zielVersionen.find((eintrag) => eintrag.assetDb === version.assetDb);
                if (dort === undefined) {
                    await binde(tx, ziel.id, version.assetDb, "map_full", { label, stelle }, version.id);
                    stelle += 1;
                    felder.add("images");
                } else if (i === 0 && dort.label === null && label !== null) {
                    await tx`UPDATE citymap_media SET version_label = ${label}, updated_at = now() WHERE id = ${dort.id}::bigint`;
                    felder.add("images");
                }
                await tx`UPDATE citymap_media SET retired_at = now(), updated_at = now() WHERE id = ${version.id}::bigint`;
                gleiche(version.assetPublicId, "map_full");
            }

            // Die Vorschau: Sie zieht mit, wenn das Ziel keine hat; sonst bleibt sie nur in der Liste.
            const vorschauen = await tx<
                { id: string; asset_db: string; asset_public_id: string; ziel: string | null }[]
            >`
                SELECT m.id::text AS id, a.id::text AS asset_db, a.public_id::text AS asset_public_id,
                       (SELECT z.id::text FROM citymap_media z
                         WHERE z.citymap_id = ${ziel.id}::bigint AND z.role = 'map_preview' AND z.retired_at IS NULL) AS ziel
                  FROM citymap_media m JOIN media_asset a ON a.id = m.media_asset_id
                 WHERE m.citymap_id = ${quelle.id}::bigint AND m.role = 'map_preview' AND m.retired_at IS NULL
                 FOR UPDATE OF m
            `;
            for (const vorschau of vorschauen) {
                await tx`UPDATE citymap_media SET retired_at = now(), updated_at = now() WHERE id = ${vorschau.id}::bigint`;
                if (vorschau.ziel === null) {
                    await binde(
                        tx,
                        ziel.id,
                        vorschau.asset_db,
                        "map_preview",
                        { label: null, stelle: null },
                        vorschau.id,
                    );
                    felder.add("images");
                }
                gleiche(vorschau.asset_public_id, "map_preview");
            }

            // Fundstellen, Publikationen und Orte, die dort fehlen.
            const links = await tx<NeuerLink[]>`
                SELECT url, label, is_paid AS "isPaid", legacy_origin AS "legacyOrigin" FROM citymap_link
                 WHERE citymap_id = ${quelle.id}::bigint AND is_active
                 ORDER BY CASE link_role WHEN 'primary' THEN 0 ELSE 1 END, position, id
            `;
            if ((await ergaenzeLinks(tx, ziel.id, links)) > 0) felder.add("links");
            if ((await ergaenzeQuellen(tx, quelle.id, ziel.id)) > 0) felder.add("sources");
            if ((await ergaenzeOrte(tx, quelle.id, ziel.id)) > 0) felder.add("places");

            const [still] = await tx<{ revision: number }[]>`
                UPDATE citymap
                   SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor',
                       updated_at = now(), revision = ${quelle.revision + 1}
                 WHERE id = ${quelle.id}::bigint RETURNING revision::int AS revision
            `;
            const [ergaenzt] = await tx<{ revision: number }[]>`
                UPDATE citymap SET updated_at = now(), revision = ${ziel.revision + 1}
                 WHERE id = ${ziel.id}::bigint RETURNING revision::int AS revision
            `;
            const derivedWork: DerivedWork[] = [];
            for (const { asset, rolle } of abgleich.values()) {
                derivedWork.push(
                    await enqueueSettle(tx, { assetPublicId: asset, role: rolle, actorPersonId: actor.personId }),
                );
            }
            return {
                receipt: {
                    affected: [
                        { kind: "citymap", id: quelle.public_id, revision: still!.revision },
                        { kind: "citymap", id: ziel.public_id, revision: ergaenzt!.revision },
                    ],
                    derivedWork,
                    warnings: [],
                },
                entries: [
                    {
                        action: "citymap.retired",
                        citymapId: quelle.public_id,
                        targetRevision: still!.revision,
                        details: { bindings: quellVersionen.length + vorschauen.length, handedTo: ziel.public_id },
                    },
                    {
                        action: "citymap.updated",
                        citymapId: ziel.public_id,
                        targetRevision: ergaenzt!.revision,
                        details: { fields: [...felder], handedFrom: quelle.public_id },
                    },
                ],
            };
        },
    );
}
