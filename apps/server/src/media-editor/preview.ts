import type { MediaPublicationPreview, MediaPublicationPreviewQuery } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { decidePublication } from "../media/policy.ts";
import { readPublicationRules } from "../media/rules.ts";
import { inhaltsstandFuer, schalterVon } from "../system/inhaltsstand.ts";

/**
 * „Der Satz unter dem Formular sagt vorher, ob das Bild danach öffentlich ist“ (WI-0126 §11j, WI-0068 P4a): dieselbe Entscheidung
 * (`decidePublication`) für ein technisch fertiges Bild (WebP, `ok`) in einer aktiven Verwendung ohne Einzelentscheid, mit den
 * Rechten und der Entstehung des Formulars und den Freigaberegeln von heute. Ohne Prüfstand gilt `unreviewed`, wie nach dem
 * Hochladen; ohne Entstehung `unknown`. Hält ein Inhaltsschalter das Bild zurück, sagt der Satz das (`switched_off`, WI-0127 SYS-10).
 */
export async function publicationPreview(
    database: Queryable,
    query: MediaPublicationPreviewQuery,
): Promise<MediaPublicationPreview> {
    const licenseKey = query.basis === "license" ? (query.licenseKey ?? null) : null;
    const [license] =
        licenseKey === null
            ? []
            : await database<{ requires_attribution: boolean; family: string | null }[]>`
                SELECT requires_attribution, family FROM license_catalog WHERE key = ${licenseKey}
            `;
    const decision = decidePublication({
        role: query.role,
        asset: {
            mediaKind: "image",
            technicalState: "ok",
            moderationState: "not_applicable",
            creationMethod: query.creation ?? "unknown",
        },
        rights: {
            basis: query.basis,
            clearance: query.clearance ?? "unreviewed",
            licenseKey: license === undefined ? null : licenseKey,
            licenseRequiresAttribution: license?.requires_attribution ?? null,
            licenseFamily: license?.family ?? null,
        },
        usage: { role: query.role, suppressed: false, retired: false, override: "none" },
        published: { mimeType: "image/webp" },
        rules: await readPublicationRules(database),
        switches: schalterVon(await inhaltsstandFuer(database)),
    });
    return { public: decision.allowed, reason: decision.reason };
}
