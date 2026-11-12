import { gleichDemWiki, type InhalteTraegerQuellenArt, type InhalteTraegerQuellenVorher } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { MapAuditEntry } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { fehlerbild, type LinkZeile } from "./verknuepfung-schreiben.ts";

/**
 * Was `traeger.sources` an jedem Objekt gleich tut, ob es ein Ort, ein Gebiet, eine Landschaft, ein Gipfel oder die Straße eines Wegs ist (WI-0254 §12): wie das Objekt im Fachprotokoll heißt, die Probe
 * `vorher` gegen den Stand, der 409 mit wer und wann, der Eintrag einer Quelle im Protokoll und das Nachschlagen der Katalogquelle. Geschrieben wird in `traeger-quellen-schreiben.ts` (Ort,
 * Gebiet, Landschaft) und `traeger-quellen-weg.ts` (Straße); gelesen in `traeger-quellen-lesen.ts`.
 */

/** Wie das Objekt im Fachprotokoll heißt (Art der Aktion, Spalte des Ziels, Feld des Eintrags). Die Landschaft ist dort `region`, der Gipfel `peak`. */
export const PROTOKOLL: Readonly<
    Record<
        InhalteTraegerQuellenArt,
        {
            art: "place" | "territory" | "region" | "peak" | "path";
            spalte: string;
            ziel: (
                kennung: string,
            ) => Pick<MapAuditEntry, "placeId" | "territoryId" | "regionId" | "peakId" | "pathId">;
        }
    >
> = {
    place: { art: "place", spalte: "e.place_public_id", ziel: (placeId) => ({ placeId }) },
    territory: { art: "territory", spalte: "e.territory_public_id", ziel: (territoryId) => ({ territoryId }) },
    area: { art: "region", spalte: "e.region_public_id", ziel: (regionId) => ({ regionId }) },
    peak: { art: "peak", spalte: "e.peak_public_id", ziel: (peakId) => ({ peakId }) },
    path: { art: "path", spalte: "e.path_public_id", ziel: (pathId) => ({ pathId }) },
};

/** Eine Katalogquelle, wie der Schreibweg sie braucht. */
export interface QuelleZeile {
    id: string;
    title: string;
    is_active: boolean;
}

/**
 * Die Katalogquelle zu einer Änderung (404, wo es sie nicht gibt). Anhängen und holen geht nicht an einer stillgelegten Quelle (400); ändern und lösen schon (die Oberfläche zeigt sie dann nicht,
 * aber ein Rest in der Datenbank bliebe sonst nicht lösbar).
 */
export async function sucheQuelle(
    tx: Sql,
    sourceId: string,
    op: "add" | "update" | "remove" | "restore",
): Promise<QuelleZeile> {
    const [quelle] = await tx<QuelleZeile[]>`
        SELECT id::text AS id, title, is_active FROM feature_source WHERE public_id = ${sourceId}::uuid
    `;
    if (quelle === undefined) throw new ApiError(404, "not_found", "Diese Quelle gibt es nicht.");
    if ((op === "add" || op === "restore") && !quelle.is_active) {
        throw fehlerbild("aenderungen.sourceId", "state", "Eine stillgelegte Quelle lässt sich nicht anhängen.");
    }
    return quelle;
}

/**
 * Was die Oberfläche sah, gegen was die Datenbank jetzt hält: Zustand und die drei Angaben. Verglichen wird wie beim Wiki (`gleichDemWiki`: gekürzt, leer ist nichts), denn die
 * Oberfläche zeigt die Angaben gekürzt und der Server speichert sie gekürzt. Beim Weg ist `bisher` die Sicht über die Abschnitte der Straße (`fasseWegQuelleZusammen`).
 */
export function stimmtMitStand(
    vorher: InhalteTraegerQuellenVorher | null,
    bisher: Pick<LinkZeile, "state" | "reference_kind" | "pages" | "note"> | undefined,
): boolean {
    if (vorher === null) return bisher === undefined;
    if (bisher === undefined) return false;
    return (
        vorher.state === bisher.state &&
        gleichDemWiki(
            { art: vorher.referenceKind, seiten: vorher.pages, notiz: vorher.note },
            { art: bisher.reference_kind, seiten: bisher.pages, notiz: bisher.note },
        )
    );
}

/**
 * 409 `edit_conflict` mit der jetzigen Revision des Objekts (nur zur Auskunft) und, wo das Fachprotokoll es weiß, wann und von wem die Quelle an diesem Objekt zuletzt geändert wurde:
 * am Objekt (`<art>.sources_changed`) oder von der Quelle her (`source.updated` mit einer Änderung genau dieses Objekts). `kennungen` sind die öffentlichen Kennungen des Objekts, beim
 * Weg die aller Abschnitte der Straße (die Operation hängt am Anker, eine ältere an einem anderen Abschnitt).
 */
export async function veralteterStand(
    tx: Sql,
    kind: InhalteTraegerQuellenArt,
    kennungen: readonly string[],
    quelle: string,
    revision: number,
    zuletztGeaendert: Date | undefined,
): Promise<ApiError> {
    const protokoll = PROTOKOLL[kind];
    const [zuletzt] = await tx.unsafe<{ at: Date; id: string | null; display_name: string | null }[]>(
        `SELECT o.at, o.actor_person_id::text AS id, p.display_name
           FROM map_audit_event e
           JOIN map_operation o ON o.operation_id = e.operation_id
           LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
          WHERE (${protokoll.spalte} = ANY($1::uuid[]) AND e.action = $2)
             OR (e.source_public_id = $3::uuid AND e.action = 'source.updated'
                 AND EXISTS (SELECT 1 FROM unnest($1::uuid[]) AS k(id)
                              WHERE e.changes->'links'->'after' @> jsonb_build_array(jsonb_build_object('carrierId', k.id::text))))
          ORDER BY e.id DESC
          LIMIT 1`,
        [[...kennungen], `${protokoll.art}.sources_changed`, quelle] as never[],
    );
    const details: { currentRevision: number; changedAt: string; changedBy?: { id: string; displayName: string } } = {
        currentRevision: revision,
        changedAt: (zuletzt?.at ?? zuletztGeaendert ?? new Date()).toISOString(),
    };
    if (zuletzt?.id != null && zuletzt.display_name != null)
        details.changedBy = { id: zuletzt.id, displayName: zuletzt.display_name };
    return new ApiError(
        409,
        "edit_conflict",
        "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
        details,
    );
}

/** Der Eintrag einer Quelle im Protokoll: welche, in welchem Zustand, mit welchen Angaben. */
export const eintrag = (
    quelle: QuelleZeile,
    kennung: string,
    zeile: Record<string, unknown>,
): Record<string, unknown> => ({
    sourceId: kennung,
    title: quelle.title,
    state: zeile["state"],
    referenceKind: zeile["referenceKind"],
    pages: zeile["pages"],
    note: zeile["note"],
});
