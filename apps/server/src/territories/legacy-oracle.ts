import type { OracleInput } from "@avesmaps3d/shared";
import type { LegacyGeometryRow, LegacyTerritoryPayload, LegacyTerritoryRow } from "../migration/territories.ts";

/**
 * Legacys Gebietsexport als Eingabe der Anzeigeregel (WI-0209 N1). Die Regel selbst steht seit A3 in
 * `packages/shared/src/territory-display-rule.ts`, weil der Reiter „Hierarchie“ des Gebietseditors sie ebenso rechnet.
 *
 * Nicht nachgebaut, weil der Export es nicht trägt: der Rückfall auf alte `region`-Merkmale gleichen Namens für Gebiete ohne Fläche
 * (`avesmapsPoliticalAppendLegacyFallbackLayerRows`; der Merkmal-Export des Zuges enthält keine Art `region`), `wiki_name` und `slug`
 * als weitere Namen eines Sammelknotens, Legacys „0 heißt offen, wenn das Wiki ‚besteht‘ sagt“ (der Export kodiert offen als `null` oder
 * 9999). Was der Vergleich davon trifft, nennt er.
 *
 * Nach dem ersten Schreiben im Editor ist Legacy kein Maßstab mehr: N2 rechnet dieselbe Regel auf unseren eigenen Tafeln
 * (`verifyOwnBands` in `verify-legacy-bands.ts`).
 */

const zahl = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
};
const text = (value: unknown): string =>
    typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);

/** Liest den Export so roh wie möglich: keine Regel unserer Übersetzung, nur Typen. */
export function oracleInputFromExport(payload: LegacyTerritoryPayload): OracleInput {
    const territories = (payload.territories ?? []).map((row: LegacyTerritoryRow) => ({
        publicId: text(row.public_id),
        name: text(row.name),
        shortName: text(row.short_name),
        parentPublicId: text(row.parent_public_id) || null,
        minZoom: zahl(row.min_zoom),
        maxZoom: zahl(row.max_zoom),
        validFromBf: zahl(row.valid_from_bf),
        validToBf: zahl(row.valid_to_bf),
    }));
    const geometries = (payload.geometries ?? []).map((row: LegacyGeometryRow) => ({
        publicId: text(row.public_id),
        territoryPublicId: text(row.territory_public_id),
        minZoom: zahl(row.min_zoom),
        maxZoom: zahl(row.max_zoom),
        validFromBf: zahl(row.valid_from_bf),
        validToBf: zahl(row.valid_to_bf),
    }));
    return { territories, geometries };
}
