import type { MediaRole } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import {
    decidePublication,
    type ClearanceState,
    type CreationMethod,
    type DenyReason,
    type ModerationState,
    type PublicationDecision,
    type PublicationOverride,
    type PublicationRuleFacts,
    type RightsBasis,
    type TechnicalState,
} from "../media/policy.ts";

/**
 * Die Veröffentlichungsentscheidung (`media/policy.ts`) für importierte Medien, gelesen aus der Datenbank. Der Binärimport fragt sie,
 * bevor er ein öffentliches Derivat schreibt (`media-files.ts`), der Prüfer fragt sie für jede veröffentlichte Datei
 * (`verify-media.ts`). Beide gehen durch dieselbe Funktion; hier steht keine eigene Liste erlaubter Rechte.
 */

/** Eine Nutzung: ein Galerieeintrag oder eine direkte Bindung, mit allem, was die Entscheidung über sie wissen muss. */
export interface UsageRow {
    assetId: string;
    role: MediaRole;
    retired: boolean;
    override: PublicationOverride;
    suppressed: boolean;
}

/**
 * Alle Nutzungen als EINE Liste: Galerieeinträge (Ort, Rolle `header`), die Bindungen der vier Fachobjekte, die Typbilder (★) und die
 * Reisebilder (Rolle `photobox`, WI-0272 S3) und die Bilder der Kategorie „Social Media Posts“ (Rolle `social_post`, WI-0278). Mit `assetId` nur die
 * eines Assets (der Abgleich eines einzelnen Assets, `media-editor/settle.ts`, WI-0068 P4a); dieselbe Abfrage, kein zweiter Text.
 */
export async function readUsages(db: Queryable, assetId?: string): Promise<UsageRow[]> {
    const only = assetId ?? null;
    return db<UsageRow[]>`
        SELECT i.media_asset_id::text AS "assetId", g.role AS role,
               (i.retired_at IS NOT NULL OR g.retired_at IS NOT NULL) AS retired, i.publication_override AS override,
               EXISTS (SELECT 1 FROM place_media_suppression s WHERE s.place_id = g.place_id AND s.role = g.role) AS suppressed
        FROM media_gallery_item i JOIN place_media_gallery g ON g.media_gallery_id = i.gallery_id
        WHERE ${only}::bigint IS NULL OR i.media_asset_id = ${only}::bigint
        UNION ALL
        SELECT m.media_asset_id::text, m.role, m.retired_at IS NOT NULL, m.publication_override,
               EXISTS (SELECT 1 FROM place_media_suppression s WHERE s.place_id = m.place_id AND s.role = m.role)
        FROM place_media m
        WHERE ${only}::bigint IS NULL OR m.media_asset_id = ${only}::bigint
        UNION ALL
        SELECT m.media_asset_id::text, m.role, m.retired_at IS NOT NULL, m.publication_override,
               EXISTS (SELECT 1 FROM territory_media_suppression s WHERE s.territory_id = m.territory_id AND s.role = m.role)
        FROM territory_media m
        WHERE ${only}::bigint IS NULL OR m.media_asset_id = ${only}::bigint
        UNION ALL
        SELECT m.media_asset_id::text, m.role, m.retired_at IS NOT NULL, m.publication_override, FALSE FROM adventure_media m
        WHERE ${only}::bigint IS NULL OR m.media_asset_id = ${only}::bigint
        UNION ALL
        -- Ein stillgelegter Eintrag (WI-0287: Entfernen im Editor, oder Legacys Stilllegung) zählt wie eine zurückgezogene Bindung: Sein Bild bleibt nicht öffentlich, wenn nur er es hält.
        SELECT m.media_asset_id::text, m.role, (m.retired_at IS NOT NULL OR NOT c.is_active), m.publication_override, FALSE
        FROM citymap_media m JOIN citymap c ON c.id = m.citymap_id
        WHERE ${only}::bigint IS NULL OR m.media_asset_id = ${only}::bigint
        UNION ALL
        -- Ein Typbild (★ einer Kategorie, Migration 0113) ist eine Verwendung der Rolle header wie ein Kopfbild.
        SELECT t.media_asset_id::text, 'header', t.retired_at IS NOT NULL, t.publication_override, FALSE FROM media_type_image t
        WHERE ${only}::bigint IS NULL OR t.media_asset_id = ${only}::bigint
        UNION ALL
        -- Ein freigegebenes Reisebild (Migration 0293): eine Verwendung der Rolle photobox, ohne Fachobjekt und ohne Unterdrückung.
        SELECT p.media_asset_id::text, p.role, p.retired_at IS NOT NULL, p.publication_override, FALSE FROM photobox_media p
        WHERE ${only}::bigint IS NULL OR p.media_asset_id = ${only}::bigint
        UNION ALL
        -- Ein Bild der Kategorie „Social Media Posts“ (WI-0278): Es ist mit seinem Typ verwendet, eine Tafel gibt es nicht. Die bestätigten Rechte sind seine Einzelfreigabe, auch bei einer Grundlage,
        -- die sonst eine Regel bräuchte (Lizenz mit Namensnennung, Erlaubnis, Fan-Richtlinie); so geht, was im Beitrag bestätigt wurde, auch wirklich hinaus. Unbekannte Rechte hält die Policy trotzdem.
        SELECT a.id::text, 'social_post', FALSE, CASE WHEN r.clearance_state = 'cleared' THEN 'approved' ELSE 'none' END, FALSE
        FROM media_asset a LEFT JOIN media_rights r ON r.media_asset_id = a.id
        WHERE a.asset_type = 'social_post' AND (${only}::bigint IS NULL OR a.id = ${only}::bigint)
    `;
}

export interface AssetFacts {
    technicalState: TechnicalState;
    moderationState: ModerationState;
    /** Die Entstehung (`media_asset.creation_method`): eine Freigaberegel mit Entstehung gilt nur dafür (Migration 0092). */
    creationMethod: CreationMethod;
    basis: RightsBasis | null;
    clearance: ClearanceState | null;
    licenseKey: string | null;
    requiresAttribution: boolean | null;
    /** Die Lizenzfamilie, nur für den Schalter `media.license.<familie>` (WI-0127 SYS-10). */
    licenseFamily?: string | null;
    /** Ein Einzelbild-Notaus hält die Bytes des Originals (nur auf Lesewegen, `media/notaus.ts`; der Dateiabgleich fragt selbst). */
    suspended?: boolean;
}

/**
 * Die Entscheidung der Policy für EINE Nutzung. `published`: die Datei, die es gibt (oder geben würde); `null`: keine. `switches`:
 * die Inhaltsschalter, nur auf Lesewegen (das MAM); Import und Dateiabgleich fragen ohne.
 */
export function decideUsage(
    asset: AssetFacts,
    role: MediaRole,
    usage: Pick<UsageRow, "role" | "retired" | "override" | "suppressed">,
    published: { mimeType: string } | null,
    rules: readonly PublicationRuleFacts[],
    switches?: { isOff(key: string): boolean },
): PublicationDecision {
    return decidePublication({
        role,
        asset: {
            mediaKind: "image",
            technicalState: asset.technicalState,
            moderationState: asset.moderationState,
            creationMethod: asset.creationMethod,
        },
        rights:
            asset.basis === null || asset.clearance === null
                ? null
                : {
                      basis: asset.basis,
                      clearance: asset.clearance,
                      licenseKey: asset.licenseKey,
                      licenseRequiresAttribution: asset.requiresAttribution,
                      licenseFamily: asset.licenseFamily ?? null,
                  },
        usage: { role: usage.role, suppressed: usage.suppressed, retired: usage.retired, override: usage.override },
        published,
        rules,
        ...(asset.suspended === true ? { suspended: true } : {}),
        ...(switches === undefined ? {} : { switches }),
    });
}

/**
 * Darf das Asset in seiner Rolle öffentlich erscheinen, für irgendeine seiner Nutzungen? `hypothetical`: so, als wäre die Datei
 * schon technisch in Ordnung und als WebP da (der Binärimport fragt, BEVOR er schreibt). Sonst gilt der wirkliche Zustand.
 * `switches`: die Inhaltsschalter, nur für den Vergleich mit dem öffentlichen Lesepfad (`verify-media`, WI-0127 SYS-10).
 */
export function assetPublishes(
    asset: AssetFacts,
    role: MediaRole,
    usages: readonly UsageRow[],
    published: { mimeType: string } | null,
    rules: readonly PublicationRuleFacts[],
    hypothetical = false,
    switches?: { isOff(key: string): boolean },
): { allowed: boolean; reasons: DenyReason[] } {
    const facts: AssetFacts = hypothetical ? { ...asset, technicalState: "ok" } : asset;
    const shown = hypothetical ? { mimeType: "image/webp" } : published;
    if (usages.length === 0) return { allowed: false, reasons: ["retired"] };
    const reasons: DenyReason[] = [];
    for (const usage of usages) {
        const decision = decideUsage(facts, role, usage, shown, rules, switches);
        if (decision.allowed) return { allowed: true, reasons: [] };
        reasons.push(decision.reason);
    }
    return { allowed: false, reasons };
}
