import type { EditConflictDetails } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Das Fachprotokoll der Medien (`media_audit_event` an `media_operation`, Migration 0086; ADR-0019) und was P2 daraus liest:
 * den Bearbeitungskonflikt mit „wer, wann“ (ADR-0020). Geschrieben wird es erst mit dem ersten Schreibpfad (P4); die Regeln,
 * nach denen er schreibt, stehen hier, damit Lesen und Schreiben dieselben sind:
 *
 * 1. `action` beginnt mit dem DATENSATZ, dessen Revision `target_revision` nennt (`MEDIA_AUDIT_RECORDS`): `asset.*` die Revision
 *    von `media_asset`, `rights.*` die von `media_rights`, `creation.*`, `binding.*` (je Bindungszeile), `gallery.*` (auch jede
 *    Änderung an einem Eintrag, die Galerie zählt mit), `rule.*`, `suspension.*`, `citymap.*` die von `citymap` (WI-0068 R5, 0197),
 *    `photobox.*` die der Einreichung (`media_submission`, WI-0272 S2).
 * 2. Ziel: Asset, Rechte, Entstehung, Bindung und Notaus über `media_asset_public_id`; die Galerie über
 *    `media_gallery_public_id`; die Freigaberegel über `publication_rule_id`; die Karte der Kartensammlung über `citymap_public_id`.
 * 3. Eine Bindung nennt sich in `details.binding` als `<tabelle>:<id>` (`mediaBindingKey`), weil ein Asset mehrere trägt.
 * 4. Freitext steht in `details` nur unter `MEDIA_AUDIT_FREE_TEXT_KEYS`. Beim Auflösen eines Kontos schwärzt
 *    `public.redact_person_media()` (Migration 0088) genau diese Schlüssel in den Operationen der Person; jeder andere
 *    Schlüssel ist ein Code, eine Kennung oder eine Zahl.
 */
export const MEDIA_AUDIT_RECORDS = [
    "asset",
    "rights",
    "creation",
    "binding",
    "gallery",
    "rule",
    "suspension",
    "citymap",
    // Reisebilder (WI-0272 S2): `photobox.*` nennt die Revision der Einreichung (`media_submission`), das Ziel ist ihr aktuelles Asset.
    "photobox",
] as const;
export type MediaAuditRecord = (typeof MEDIA_AUDIT_RECORDS)[number];

/** 🔴 Dieselbe Liste steht in Migration 0088 (`media-editor-redact.test.ts` hält beide gleich). */
export const MEDIA_AUDIT_FREE_TEXT_KEYS = ["reason", "note"] as const;

export const MEDIA_BINDING_TABLES = [
    "place_media",
    "territory_media",
    "adventure_media",
    "citymap_media",
    "media_gallery_item",
    // Typbilder (WI-0068, Migration 0113): der ★ einer Kategorie ist eine Bindung im Sinn des Fachprotokolls.
    "media_type_image",
] as const;
export type MediaBindingTable = (typeof MEDIA_BINDING_TABLES)[number];

export function mediaBindingKey(table: MediaBindingTable, id: string | number): string {
    return `${table}:${String(id)}`;
}

export type MediaConflictTarget =
    // `photobox`: die Revision der Einreichung (WI-0272 S3); das Ziel der Zeile ist das aktuelle Asset der Einreichung.
    | { record: "asset" | "rights" | "creation" | "suspension" | "photobox"; assetId: string }
    | { record: "binding"; assetId: string; binding: string }
    | { record: "gallery"; galleryId: string }
    | { record: "rule"; ruleId: string }
    | { record: "citymap"; citymapId: string };

/**
 * 409 `edit_conflict` für einen Mediendatensatz (ADR-0020 Nr. 2): die Revision, die jetzt gilt, und wer sie wann schrieb.
 *
 * 🔴 „Wer“ kommt nur aus einem Protokolleintrag, dessen `target_revision` GENAU die geltende Revision ist. Hat ein Import den
 * Datensatz danach geändert (er zählt die Revision, schreibt aber kein Fachprotokoll), nennt die Antwort keinen Namen statt
 * des falschen: Der letzte Editor war dann nicht der, der schneller war. `changedAt` ist dann die Zeit des Datensatzes.
 */
export async function mediaEditConflict(
    database: Queryable,
    target: MediaConflictTarget,
    current: { revision: number; changedAt: Date },
): Promise<ApiError> {
    const [column, value] =
        target.record === "gallery"
            ? ["e.media_gallery_public_id = $1::uuid", target.galleryId]
            : target.record === "rule"
              ? ["e.publication_rule_id = $1::bigint", target.ruleId]
              : target.record === "citymap"
                ? ["e.citymap_public_id = $1::uuid", target.citymapId]
                : ["e.media_asset_public_id = $1::uuid", target.assetId];
    const binding = target.record === "binding" ? target.binding : null;
    const [last] = await database.unsafe<{ at: Date; id: string | null; display_name: string | null }[]>(
        `SELECT o.at, o.actor_person_id::text AS id, p.display_name
           FROM media_audit_event e
           JOIN media_operation o ON o.operation_id = e.operation_id
           LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
          WHERE ${column} AND starts_with(e.action, $2) AND e.target_revision = $3
            AND ($4::text IS NULL OR e.details ->> 'binding' = $4::text)
          ORDER BY e.id DESC
          LIMIT 1`,
        [value, `${target.record}.`, current.revision, binding],
    );
    const details: EditConflictDetails = {
        currentRevision: current.revision,
        changedAt: (last?.at ?? current.changedAt).toISOString(),
    };
    if (last?.id != null && last.display_name != null)
        details.changedBy = { id: last.id, displayName: last.display_name };
    return new ApiError(
        409,
        "edit_conflict",
        "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
        details,
    );
}
