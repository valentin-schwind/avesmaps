import { prepareBorderTerritory, type BorderTerritory } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Gebiete, in denen Zoll erhoben wird (WI-0065 U3): die souveränen Herrschaftsgebiete, gegen die die Route ihre
 * Landesgrenzen zählt (`countBorderCrossings`, `packages/shared/src/travel-borders.ts`).
 *
 * 🔴 **Legacys Regel, unverändert (L1):** Es zählen die Gebiete OHNE Elternteil, geladen aus der gerenderten Ebene
 * `zoom=0` (Legacy `route-costs.js`, `!parent_public_id`). Das Band 0 IST diese Ebene: `territory_shape` mit
 * `band = 0` und `parent_id IS NULL` (der wirksame Elter im Anzeigejahr; ein abgelaufener Elter fällt aus der Kette).
 * Das Feld `status_text` taugt nicht dafür (verschmutzt). Ein Gebiet ohne Elternteil, das in Band 0 nicht gezeigt wird,
 * zählt nicht (heute Wehrheim, siehe WI-0065 „Befund am Bestand“); das ist Legacys Verhalten, keine neue Tabelle
 * „Zollzonen“ und keine eigene Definition.
 *
 * 🔴 **Ohne Ableitung keine Gebiete, statt alter** (wie der Zeiger `/api/territories/current`, ADR-0014): Ein Import,
 * der etwas geändert hat, entwertet die Ableitung (`derived_revision` leer); bis `derive:territories` gelaufen ist,
 * ist der Zoll nicht ermittelbar (`null`), nie 0.
 *
 * Die Reihenfolge ist Legacys (`sort_order`, `name`), dazu `public_id` für Deterministik: Bei Überlappung gewinnt das
 * erste Gebiet der Liste. Das Gelände der Karte liegt im selben Raum wie die Route (SRID 0, `aventuria-v1`), es
 * braucht keine Umrechnung.
 */
export interface TollTerritories {
    /** Die Wurzeln des Bandes 0 in Legacys Reihenfolge, mit Hüllbox je Teilpolygon; leer, wenn nichts abgeleitet ist. */
    readonly territories: readonly BorderTerritory[];
    /** Das Anzeigejahr (BF), für das die Ableitung gilt; `null`, wenn nichts abgeleitet ist. */
    readonly yearBf: number | null;
}

/** Nichts abgeleitet: kein Gebiet, kein Jahr. */
export const NO_TOLL_TERRITORIES: TollTerritories = { territories: [], yearBf: null };

/**
 * Liest die Zollgebiete der Kartendomäne. Nur lesend; die Tabellen `territory`, `territory_shape` und `territory_state`
 * stehen in `readRoutingRevision` (Teil `territories`), `routing-fingerprint-coverage.test.ts` prüft es aus dem Text.
 */
export async function loadTollTerritories(database: Queryable, mapDomainId: string): Promise<TollTerritories> {
    const [state] = await database<{ derived_revision: string | null; derived_year_bf: number | null }[]>`
        SELECT derived_revision, derived_year_bf FROM territory_state WHERE map_domain_id = ${mapDomainId}
    `;
    if (!state?.derived_revision || state.derived_year_bf === null) return NO_TOLL_TERRITORIES;
    const rows = await database<{ public_id: string; name: string; short_name: string | null; geometry: string }[]>`
        SELECT t.public_id::text AS public_id, t.name, t.short_name, ST_AsGeoJSON(s.geom, 6) AS geometry
        FROM territory_shape s
        JOIN territory t ON t.id = s.territory_id
        WHERE s.band = 0 AND s.parent_id IS NULL AND t.map_domain_id = ${mapDomainId} AND t.is_active
        ORDER BY t.sort_order, t.name, t.public_id
    `;
    const territories: BorderTerritory[] = [];
    for (const row of rows) {
        const territory = prepareBorderTerritory({
            id: row.public_id,
            name: row.name,
            // Der Kurzname (Legacy `short_name`) ist nur Anzeige für die Liste der Übertritte; leer heißt: der Name gilt.
            shortName: row.short_name,
            geometry: JSON.parse(row.geometry) as { type: string; coordinates: unknown },
        });
        // Eine Form ohne brauchbaren Ring gibt es nicht zu zählen; die Ableitung schreibt nur gültige.
        if (territory !== null) territories.push(territory);
    }
    return { territories, yearBf: state.derived_year_bf };
}
