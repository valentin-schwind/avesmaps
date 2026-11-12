import { AVENTURIA, type MamKarteAendernBody, type MamKarteFeld, type OperationReceipt } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { DERIVE_LOCK_CLASS } from "../derive/derive-lock.ts";
import { mapImportRunning } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { notFound } from "./asset-operations.ts";
import { mediaEditConflict } from "./audit.ts";
import { mediaOperation, type MediaActor } from "./operation-store.ts";

/**
 * Eine Karte der Kartensammlung ändern (WI-0068 R5, Operation `citymap.update`; Betreiber 2026-10-18 „B jetzt“, dazu „wir werden nix
 * redaktionelles machen, müssen aber schauen, dass es geht“). Eigenschaften aus 0069 und die Menge der Typen, gegen den gesehenen Stand
 * (`citymap.revision`, Migration 0197), mit einer Zeile `citymap.updated` im Fachprotokoll der Medien.
 *
 * 🔴 Kein zweites Modell und keine zweite Schutzmechanik: Die Zeile im Fachprotokoll ist es, die den Legacy-Zug die Karte stehen lassen
 * lässt (`karte-gehalten.ts`, wie bei den Bildern). Gegen den Zug selbst nimmt das Speichern die Sperre der Kartendomäne geteilt, wie
 * jedes Speichern im Editor (`editor/map-operation.ts`): Schreibt der Zug gerade (I21 hält sie exklusiv), antwortet es 503
 * `map_import_running`, statt dass eine der beiden Änderungen still verloren geht.
 */

/** Feld des Vertrags → Spalte in `citymap` (0069). */
export const SPALTE: Record<MamKarteFeld, string> = {
    title: "title",
    art: "art",
    colorMode: "color_mode",
    isMultilevel: "is_multilevel",
    isLabeled: "is_labeled",
    isOfficial: "is_official",
    isSpoiler: "is_spoiler",
    hasScale: "has_scale",
    widthPx: "width_px",
    heightPx: "height_px",
    format: "format",
    validFromBf: "valid_from_bf",
    validToBf: "valid_to_bf",
    author: "author",
    publisher: "publisher",
    note: "note",
};
const TEXT_FELDER: ReadonlySet<MamKarteFeld> = new Set(["title", "format", "author", "publisher", "note"]);

/** Text ohne Ränder; leer heißt „nicht erfasst“ (0069 lässt keinen leeren Text zu). */
export function bereinigt(feld: MamKarteFeld, wert: unknown): unknown {
    if (!TEXT_FELDER.has(feld) || typeof wert !== "string") return wert;
    const text = wert.trim();
    return text === "" ? null : text;
}

export function aendereKarte(
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: MamKarteAendernBody,
    /** Die Kartendomäne der Sperre; nur Tests nennen eine eigene, damit sie fremde Läufe nicht aufhalten. */
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> {
    const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
    const werte = Object.entries(body.fields ?? {})
        .filter(([, wert]) => wert !== undefined)
        .map(([feld, wert]) => [feld as MamKarteFeld, bereinigt(feld as MamKarteFeld, wert)] as const);
    if (werte.length === 0 && body.types === undefined) {
        throw new ApiError(400, "validation_failed", "Es ist nichts zu ändern.", {
            issues: [{ path: "fields", rule: "required" }],
        });
    }
    if (werte.some(([feld, wert]) => feld === "title" && wert === null)) {
        throw new ApiError(400, "validation_failed", "Eine Karte braucht einen Titel.", {
            issues: [{ path: "fields.title", rule: "required" }],
        });
    }
    const typen = body.types === undefined ? undefined : [...new Set(body.types)].sort();
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "citymap.update",
            body: {
                citymapId: publicId,
                baseRevision: body.baseRevision,
                fields: Object.fromEntries(werte),
                types: typen,
            },
        },
        async (tx) => {
            const [frei] = await tx<{ ok: boolean }[]>`
                SELECT pg_try_advisory_xact_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${domaene})) AS ok
            `;
            if (frei?.ok !== true) throw mapImportRunning();
            const [karte] = await tx<{ id: string; revision: number; updated_at: Date; typen: string[] }[]>`
                SELECT c.id::text AS id, c.revision::int AS revision, c.updated_at,
                       coalesce((SELECT array_agg(k.type_key ORDER BY k.type_key) FROM citymap_type k
                                  WHERE k.citymap_id = c.id AND k.is_active), '{}') AS typen
                  FROM citymap c WHERE c.public_id = ${publicId}::uuid FOR UPDATE OF c
            `;
            if (karte === undefined) throw notFound("Diese Karte");
            if (karte.revision !== body.baseRevision) {
                throw await mediaEditConflict(
                    tx,
                    { record: "citymap", citymapId: publicId },
                    { revision: karte.revision, changedAt: karte.updated_at },
                );
            }

            const geaendert: string[] = werte.map(([feld]) => feld);
            const typenGeaendert = typen !== undefined && typen.join(",") !== karte.typen.join(",");
            if (typen !== undefined && typenGeaendert) {
                await tx`
                    UPDATE citymap_type
                       SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor', updated_at = now()
                     WHERE citymap_id = ${karte.id}::bigint AND is_active AND NOT (type_key = ANY(${typen}::text[]))
                `;
                await tx`
                    INSERT INTO citymap_type (citymap_id, type_key, source_system)
                    SELECT ${karte.id}::bigint, k, 'avesmaps3d' FROM unnest(${typen}::text[]) AS k
                    ON CONFLICT (citymap_id, type_key) DO UPDATE
                       SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
                     WHERE NOT citymap_type.is_active
                `;
                geaendert.push("types");
            }

            // Eine Änderung nur der Typen zählt die Revision der Karte ausdrücklich höher (0197: der Trigger zählt vorwärts).
            const zuweisungen = werte.map(([feld], index) => `${SPALTE[feld]} = $${String(index + 3)}`);
            const [neu] = await tx.unsafe<{ revision: number }[]>(
                `UPDATE citymap SET ${[...zuweisungen, "updated_at = now()", "revision = $2"].join(", ")}
                  WHERE id = $1::bigint RETURNING revision::int AS revision`,
                [karte.id, karte.revision + 1, ...werte.map(([, wert]) => wert as string | number | boolean | null)],
            );
            const revision = neu!.revision;
            return {
                receipt: { affected: [{ kind: "citymap", id: publicId, revision }], derivedWork: [], warnings: [] },
                entries: [
                    {
                        action: "citymap.updated",
                        citymapId: publicId,
                        targetRevision: revision,
                        details: { fields: geaendert },
                    },
                ],
            };
        },
    );
}
