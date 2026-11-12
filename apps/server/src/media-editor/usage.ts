import {
    HEADER_GRAPHIC_LABELS,
    type HeaderGraphic,
    type MediaKind,
    type MediaPersonRef,
    type MediaRole,
    type MediaUsage,
    type MediaUsageResult,
    type MediaUsageSubjectKind,
    type MediaUsageTypeImage,
    type MediaUsageVia,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import {
    decidePublication,
    type ClearanceState,
    type CreationMethod,
    type ModerationState,
    type PublicationOverride,
    type PublicationRuleFacts,
    type RightsBasis,
    type TechnicalState,
} from "../media/policy.ts";
import { placesOfSourceFileSql, relationState } from "../media/image-relation.ts";
import { gehalteneAssets } from "../media/notaus.ts";
import { readPublicationRules } from "../media/rules.ts";
import { inhaltsstandFuer, schalterVon } from "../system/inhaltsstand.ts";
import { activeUsagesSql, personJson, publishedVariantCase, retiredUsagesSql } from "./usage-sql.ts";

/**
 * Reverse Usage (WI-0068 §8, P2): alle aktiven Verwendungen eines Assets mit der Entscheidung der Policy je Verwendung, dazu
 * „gleiche Datei“ als Hinweis (andere Assets mit demselben Original, nie eine Zusammenführung; Betreiber 2026-10-10: der
 * Notaus gilt allen Stellen mit denselben Bytes).
 *
 * 🔴 Dieselbe Entscheidung wie der öffentliche Lesepfad (`media/policy.ts`, `decidePublication`) mit denselben Fakten: Rolle,
 * Unterdrückung, Einzelentscheidung, Asset, Rechte, veröffentlichte Variante der Rolle, Freigaberegeln, Inhaltsschalter (WI-0127 SYS-10)
 * und Einzelbild-Notaus (`publication_suspended`, Code-Review 2026-10-16 S8-04; das Asset zeigt ihn dazu in `MediaAssetDetail.suspensions`).
 */

interface UsageRow {
    asset_id: string;
    via: MediaUsageVia;
    subject_kind: MediaUsageSubjectKind | null;
    subject_id: string | null;
    subject_name: string | null;
    subject_active: boolean | null;
    role: MediaRole | null;
    origin: MediaUsage["origin"];
    revision: number;
    /** Anlage der Bindung, des Galerieeintrags oder des ★ als Tag (`bound_at` aus `activeUsagesSql`). */
    since: string | null;
    override: PublicationOverride;
    override_decided_on: string | null;
    override_reason: string | null;
    override_operator_quote: string | null;
    decided_by: MediaPersonRef | null;
    suppressed: boolean;
    gallery_id: string | null;
    gallery_title: string | null;
    gallery_kind: "object_gallery" | "editorial" | null;
    position: number | null;
    media_kind: MediaKind;
    technical_state: TechnicalState;
    moderation_state: ModerationState;
    creation_method: CreationMethod;
    rights_basis: RightsBasis | null;
    clearance_state: ClearanceState | null;
    license_key: string | null;
    license_family: string | null;
    requires_attribution: boolean | null;
    published_mime: string | null;
    /** Nur bei einem Titelbild an einem Ort (Bildbezug, Betreiber 2026-10-11); sonst NULL. */
    relation_override: string | null;
    relation_places: number | null;
    /** Nur bei `via: "type_image"`: die Kategorie und die Variante (WI-0281). */
    type_category: string | null;
    type_variant: string | null;
}

/**
 * Die Kategorie eines Typbilds mit ihrem Namen (`HEADER_GRAPHIC_LABELS`); eine unbekannte heißt nach ihrem Schlüssel. Die Variante (WI-0281) nur, wo
 * der Aufrufer sie kennt; eine unbekannte fällt weg.
 */
export function typeImageOf(category: string | null, variant?: string | null): MediaUsageTypeImage | undefined {
    if (category === null) return undefined;
    return {
        category,
        label: HEADER_GRAPHIC_LABELS[category as HeaderGraphic] ?? category,
        ...(variant === "ki" || variant === "ohne_ki" ? { variant } : {}),
    };
}

/**
 * Der Bildbezug je Verwendung eines Titelbildes an einem Ort (Betreiber 2026-10-11, `media/image-relation.ts`): die Übersteuerung der
 * Zeile, aus der die Verwendung stammt (Bindung oder Galerieeintrag), und an wie vielen aktiven Orten die Quelldatei hängt.
 */
const RELATION_COLUMNS = `
    CASE WHEN u.role = 'header' AND u.subject_kind = 'place' THEN
        CASE u.via
            WHEN 'binding' THEN (
                SELECT m.image_relation_override FROM place_media m JOIN place s ON s.id = m.place_id
                 WHERE s.public_id = u.subject_id::uuid AND m.media_asset_id = u.asset_id AND m.role = 'header'
                   AND m.retired_at IS NULL
                 LIMIT 1)
            ELSE (
                SELECT i.image_relation_override FROM media_gallery_item i JOIN media_gallery g ON g.id = i.gallery_id
                 WHERE g.public_id = u.gallery_id::uuid AND i.media_asset_id = u.asset_id AND i.retired_at IS NULL
                 LIMIT 1)
        END
    END AS relation_override,
    CASE WHEN u.role = 'header' AND u.subject_kind = 'place' THEN ${placesOfSourceFileSql("a.id")} END AS relation_places`;

const USAGE_QUERY = `
    SELECT u.*, to_char(u.bound_at, 'YYYY-MM-DD') AS since, a.media_kind, a.technical_state, a.moderation_state, a.creation_method, r.rights_basis, r.clearance_state,
           r.license_key, r.license_family,
           l.requires_attribution, f.mime_type AS published_mime, ${personJson("dp")} AS decided_by,
           ${RELATION_COLUMNS}
      FROM (${activeUsagesSql("= ANY($1::bigint[])")}) u
      JOIN media_asset a ON a.id = u.asset_id
      LEFT JOIN media_rights r ON r.media_asset_id = a.id
      LEFT JOIN license_catalog l ON l.key = r.license_key
      LEFT JOIN LATERAL (
          SELECT f.mime_type FROM media_file f
           WHERE f.media_asset_id = a.id AND f.storage_class = 'published' AND f.variant = ${publishedVariantCase("u.role")}
           ORDER BY f.created_at DESC, f.id DESC
           LIMIT 1
      ) f ON TRUE
      LEFT JOIN avesmaps_auth.person dp ON dp.id = u.override_decided_by
     ORDER BY u.asset_id, CASE u.via WHEN 'binding' THEN 0 ELSE 1 END, u.subject_name NULLS LAST, u.role NULLS LAST,
              u.gallery_id NULLS LAST, u.position
`;

function toUsage(
    row: UsageRow,
    rules: readonly PublicationRuleFacts[],
    switches: { isOff(key: string): boolean } | undefined,
    gehalten: ReadonlySet<string>,
): MediaUsage {
    const role = row.role;
    const publication =
        role === null
            ? null
            : decidePublication({
                  role,
                  asset: {
                      mediaKind: row.media_kind,
                      technicalState: row.technical_state,
                      moderationState: row.moderation_state,
                      creationMethod: row.creation_method,
                  },
                  rights:
                      row.rights_basis !== null && row.clearance_state !== null
                          ? {
                                basis: row.rights_basis,
                                clearance: row.clearance_state,
                                licenseKey: row.license_key,
                                licenseRequiresAttribution: row.requires_attribution,
                                licenseFamily: row.license_family,
                            }
                          : null,
                  // Ein stillgelegter Eintrag der Kartensammlung (WI-0287) lässt sein Bild nicht öffentlich: dieselbe Entscheidung wie im Abgleich (`readUsages`).
                  usage: {
                      role,
                      suppressed: row.suppressed,
                      retired: row.subject_kind === "citymap" && row.subject_active === false,
                      override: row.override,
                  },
                  published: row.published_mime === null ? null : { mimeType: row.published_mime },
                  rules,
                  suspended: gehalten.has(row.asset_id),
                  ...(switches === undefined ? {} : { switches }),
              });
    return {
        via: row.via,
        subject:
            row.subject_kind === null || row.subject_id === null
                ? null
                : {
                      kind: row.subject_kind,
                      id: row.subject_id,
                      name: row.subject_name ?? "",
                      active: row.subject_active ?? false,
                  },
        role,
        gallery:
            row.gallery_id === null || row.gallery_kind === null
                ? null
                : { id: row.gallery_id, title: row.gallery_title, kind: row.gallery_kind, position: row.position ?? 0 },
        origin: row.origin,
        revision: row.revision,
        ...(row.since === null ? {} : { since: row.since }),
        override: {
            state: row.override,
            decidedOn: row.override_decided_on,
            decidedBy: row.decided_by,
            reason: row.override_reason,
            operatorQuote: row.override_operator_quote,
        },
        publication: publication === null ? null : { public: publication.allowed, reason: publication.reason },
        ...(row.relation_places === null
            ? {}
            : { relation: relationState(row.relation_override, row.relation_places) }),
        ...(row.type_category === null ? {} : { typeImage: typeImageOf(row.type_category, row.type_variant)! }),
    };
}

/**
 * Die aktiven Verwendungen der genannten Assets (interne Kennungen), je Asset in fester Reihenfolge: erst direkte Bindungen,
 * dann Galerien; dieselbe Fachverwendung nur einmal. `schalter: false` fragt ohne Inhaltsschalter und ohne Notaus (Import,
 * Dateiabgleich und Regelwechsel: Sie führen Dateien und fragen den Notaus selbst).
 */
export async function loadUsages(
    database: Queryable,
    assetIds: readonly string[],
    { schalter = true }: { schalter?: boolean } = {},
): Promise<Map<string, MediaUsage[]>> {
    const found = new Map<string, MediaUsage[]>(assetIds.map((id) => [id, []]));
    if (assetIds.length === 0) return found;
    const [rows, rules] = await Promise.all([
        database.unsafe<UsageRow[]>(USAGE_QUERY, [assetIds as string[]]),
        readPublicationRules(database),
    ]);
    const switches = schalter ? schalterVon(await inhaltsstandFuer(database)) : undefined;
    const gehalten = schalter ? (await gehalteneAssets(database)).ids : new Set<string>();
    const seen = new Set<string>();
    for (const row of rows) {
        const key = [row.asset_id, row.via, row.subject_kind, row.subject_id, row.role, row.gallery_id].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        found.get(row.asset_id)?.push(toUsage(row, rules, switches, gehalten));
    }
    return found;
}

/** Wie viele zurückgezogene Bindungen und Galerieeinträge noch auf die Assets zeigen. */
export async function countRetired(database: Queryable, assetIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>(assetIds.map((id) => [id, 0]));
    if (assetIds.length === 0) return counts;
    const rows = await database.unsafe<{ asset_id: string; n: number }[]>(
        `SELECT asset_id, count(*)::int AS n FROM (${retiredUsagesSql("= ANY($1::bigint[])")}) r GROUP BY asset_id`,
        [assetIds as string[]],
    );
    for (const row of rows) counts.set(row.asset_id, row.n);
    return counts;
}

/**
 * Andere Assets mit demselben Original (Klasse `private_source`, gleiche SHA-256), über den Index `media_file_sha256`.
 *
 * 🔴 **Ohne aufgegangene Werke** (OPS-000096, 2026-11-07): Ein Werk, das in einem anderen aufgegangen ist, ist kein Gegenstand mehr
 * (`merge.ts`); es steht am bleibenden unter „Darin aufgegangen“. Stand es zusätzlich hier, bot „⊕ Zusammenführen …“ es noch einmal an,
 * und der Server antwortete 409 `media_already_merged`. Dieselbe Regel gilt beim Hochladen, in der Vorschau und im Sammellauf.
 */
export async function sameFileAssets(
    database: Queryable,
    assetId: string,
): Promise<{ id: string; publicId: string; revision: number; title: string | null; kind: MediaKind }[]> {
    return database.unsafe(
        `SELECT DISTINCT o.id::text AS id, o.public_id::text AS "publicId", o.revision::int AS revision,
                -- Ein Reisebild trägt meist keinen Titel: dann heißt es wie in der Liste nach der Beschreibung des Einreichers (WI-0272; sonst stünde im Blatt
                -- „Endgültig löschen“ „Bild ohne Titel“ hat dieselbe Datei).
                coalesce(o.title, (SELECT s.description FROM media_ingest i JOIN media_submission s ON s.id = i.submission_id
                                    WHERE i.media_asset_id = o.id ORDER BY i.id DESC LIMIT 1)) AS title,
                o.media_kind AS kind
           FROM media_file own
           JOIN media_file other
             ON other.sha256 = own.sha256 AND other.storage_class = 'private_source' AND other.media_asset_id <> own.media_asset_id
           JOIN media_asset o ON o.id = other.media_asset_id
          WHERE own.media_asset_id = $1::bigint AND own.storage_class = 'private_source'
            AND NOT EXISTS (SELECT 1 FROM media_merge m WHERE m.merged_asset_id = o.id AND m.lifted_at IS NULL)
          ORDER BY o.public_id::text`,
        [assetId],
    );
}

/**
 * „Vorschau erzeugen“ im Inspector (WI-0287 Punkt 5): An jeder Verwendung als Karte (`map_full`) eines Eintrags der Kartensammlung stehen die Revision des Eintrags (die
 * Operation baut auf sie) und seine aktive Vorschau. Eine Abfrage für alle Einträge des Werks.
 */
async function mitKartenvorschau(database: Queryable, usages: MediaUsage[]): Promise<MediaUsage[]> {
    const karten = usages
        .filter((usage) => usage.subject?.kind === "citymap" && usage.role === "map_full")
        .map((usage) => usage.subject!.id);
    if (karten.length === 0) return usages;
    const zeilen = await database<{ karte: string; revision: number; vorschau: string | null; titel: string | null }[]>`
        SELECT c.public_id::text AS karte, c.revision::int AS revision, a.public_id::text AS vorschau, a.title AS titel
          FROM citymap c
          LEFT JOIN citymap_media m ON m.citymap_id = c.id AND m.role = 'map_preview' AND m.retired_at IS NULL
          LEFT JOIN media_asset a ON a.id = m.media_asset_id
         WHERE c.public_id = ANY(${karten}::uuid[])
    `;
    const je = new Map(zeilen.map((zeile) => [zeile.karte, zeile]));
    return usages.map((usage) => {
        const zeile =
            usage.subject?.kind === "citymap" && usage.role === "map_full" ? je.get(usage.subject.id) : undefined;
        return zeile === undefined
            ? usage
            : {
                  ...usage,
                  citymap: {
                      revision: zeile.revision,
                      preview: zeile.vorschau === null ? null : { assetId: zeile.vorschau, title: zeile.titel },
                  },
              };
    });
}

/** Die Reverse Usage eines Assets über seine öffentliche Kennung; `undefined`, wenn es das Asset nicht gibt. */
export async function usageOf(database: Queryable, publicId: string): Promise<MediaUsageResult | undefined> {
    const [asset] = await database.unsafe<{ id: string; revision: number; aufgegangen: boolean }[]>(
        `SELECT a.id::text AS id, a.revision::int AS revision,
                EXISTS (SELECT 1 FROM media_merge m WHERE m.merged_asset_id = a.id AND m.lifted_at IS NULL) AS aufgegangen
           FROM media_asset a WHERE a.public_id = $1::uuid`,
        [publicId],
    );
    if (asset === undefined) return undefined;
    const others = await sameFileAssets(database, asset.id);
    const ids = [asset.id, ...others.map((other) => other.id)];
    const [usages, retired] = await Promise.all([loadUsages(database, ids), countRetired(database, [asset.id])]);
    return {
        asset: { id: publicId, revision: asset.revision },
        usages: await mitKartenvorschau(database, usages.get(asset.id) ?? []),
        retired: retired.get(asset.id) ?? 0,
        aufgegangen: asset.aufgegangen,
        sameFile: others.map((other) => ({
            asset: { id: other.publicId, revision: other.revision, title: other.title, kind: other.kind },
            usages: usages.get(other.id) ?? [],
        })),
    };
}
