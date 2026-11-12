import type { MediaRole } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { GEHALTENE_QUELLBYTES_SQL } from "../media/notaus.ts";
import type { ClearanceState, CreationMethod, ModerationState, RightsBasis } from "../media/policy.ts";
import { PUBLISHED_VARIANT } from "../media/roles.ts";
import { readPublicationRules } from "../media/rules.ts";
import { assetPublishes, readUsages, type UsageRow } from "../migration/media-publication.ts";

/**
 * Der Korb „Fehlende Derivate“ (WI-0068 P4b, Schritt 6c): Bilder, die öffentlich sein dürften, deren öffentliche Datei aber fehlt.
 *
 * 🔴 Keine geratene SQL-Bedingung: Was öffentlich sein darf, sagt die EINE Entscheidung, so wie der Dateilauf sie fragt (`settle.ts`,
 * `media-files.ts`: `assetPublishes(…, hypothetisch)`, technisch gut und als WebP gedacht). Fehlt dann unter `published/` die Variante der
 * Rolle, fehlt ein Derivat: Der Lauf hat das Bild noch nicht gerechnet (Job ausstehend oder gescheitert, eine Regel kam seit dem letzten
 * Binärimport dazu). Ein Wappen aus dem Editor mit undurchsichtigen Ecken fehlt NICHT: Der Worker hält es absichtlich privat, es steht im
 * Korb „Wappen mit Mängeln“ (T2b). Ein privates Bild, das die Entscheidung nicht trägt, fehlt NICHT; es ist privat. Ein Notaus hält die Datei absichtlich zurück (eigener
 * Korb), ein technischer Befund ebenso (`technical_state` nicht `ok`).
 *
 * Gerechnet im Prozess über den ganzen Bestand: dieselben drei Lesungen wie der Binärimport (Assets, Verwendungen, Regeln), gemessen
 * auf dev 2026-10-11 (2.501 Assets).
 */

interface AssetRow {
    id: string;
    moderation_state: ModerationState;
    creation_method: CreationMethod;
    basis: RightsBasis | null;
    clearance: ClearanceState | null;
    license_key: string | null;
    requires_attribution: boolean | null;
    published: string[];
}

/** Die internen Kennungen (`media_asset.id`) der Bilder mit fehlendem Derivat. */
export async function missingDerivativeAssets(db: Queryable): Promise<string[]> {
    const [assets, usages, rules] = await Promise.all([
        db<AssetRow[]>`
            SELECT a.id::text AS id, a.moderation_state, a.creation_method, r.rights_basis AS basis, r.clearance_state AS clearance,
                   r.license_key, l.requires_attribution,
                   coalesce(array_agg(p.variant) FILTER (WHERE p.id IS NOT NULL), '{}') AS published
              FROM media_asset a
              LEFT JOIN media_rights r ON r.media_asset_id = a.id
              LEFT JOIN license_catalog l ON l.key = r.license_key
              LEFT JOIN media_file p ON p.media_asset_id = a.id AND p.storage_class = 'published'
             WHERE a.media_kind = 'image' AND a.technical_state = 'ok'
               AND NOT EXISTS (
                   SELECT 1 FROM media_file s JOIN (${db.unsafe(GEHALTENE_QUELLBYTES_SQL)}) n ON n.sha256 = s.sha256
                    WHERE s.media_asset_id = a.id AND s.storage_class = 'private_source'
               )
               -- Ein Wappen aus dem Editor mit undurchsichtigen Ecken hält der Worker absichtlich privat (T2a); es steht in „Wappen mit Mängeln“.
               AND NOT EXISTS (
                   SELECT 1 FROM media_file c
                    WHERE c.media_asset_id = a.id AND c.storage_class = 'private_source' AND c.corners_transparent = false
                      AND a.asset_type = 'coat' AND a.origin = 'editor_upload'
               )
             GROUP BY a.id, r.rights_basis, r.clearance_state, r.license_key, l.requires_attribution
        `,
        readUsages(db),
        readPublicationRules(db),
    ]);
    const usagesByAsset = new Map<string, UsageRow[]>();
    for (const usage of usages) {
        const own = usagesByAsset.get(usage.assetId);
        if (own === undefined) usagesByAsset.set(usage.assetId, [usage]);
        else own.push(usage);
    }
    const missing: string[] = [];
    for (const asset of assets) {
        const own = usagesByAsset.get(asset.id);
        if (own === undefined) continue;
        const facts = {
            technicalState: "ok" as const,
            moderationState: asset.moderation_state,
            creationMethod: asset.creation_method,
            basis: asset.basis,
            clearance: asset.clearance,
            licenseKey: asset.license_key,
            requiresAttribution: asset.requires_attribution,
        };
        const roles = new Set<MediaRole>(own.map((usage) => usage.role));
        for (const role of roles) {
            if (asset.published.includes(PUBLISHED_VARIANT[role])) continue;
            if (assetPublishes(facts, role, own, { mimeType: "image/webp" }, rules, true).allowed) {
                missing.push(asset.id);
                break;
            }
        }
    }
    return missing;
}
