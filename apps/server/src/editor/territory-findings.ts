import {
    AVENTURIA,
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    legacyDisplayByBand,
    legacyYear,
    type EditorTerritoryFinding,
    type EditorTerritoryFindings,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { oracleInputFromDatabase, verifyOwnBands } from "../territories/verify-legacy-bands.ts";

/**
 * „Prüfen“ im Gebietseditor (WI-0209 D6; EDIT-0005 §9 D6; Vertrag `EditorTerritoryFindings`): die Befunde aller Gebiete einer Karte,
 * **nie eine Sperre** (`AGENTS.md` „Blockierende Prüfungen im Betrieb“). Gerechnet wird mit dem, was es schon gibt:
 *
 * - **N2** mit dem Nachweis selbst (`verifyOwnBands`): jede Abweichung zwischen Regel und Ableitung, an der Fläche und ihrem Gebiet.
 * - **Lücken** mit derselben Regel (`territory-display-rule.ts`), Band für Band bis 8, ohne Klemme: was eine eigene Fläche nach den
 *   gespeicherten Spannen zeigt, nicht was die heutige Ableitung zeigt.
 * - **Überlappungen** wie der Prüfer der Formen (`verify-derived.ts`): Formen nicht verwandter Gebiete im obersten abgeleiteten Band,
 *   über 0,001 E². Verwandt heißt: das eine ist ein Vorfahr des anderen (gespeicherter Elter).
 * - **Platzhalter**, **ungültige Flächen**, **hängende Verweise** und **Hauptstadt außerhalb** aus den Tafeln, die Hauptstadt wie im
 *   Ortseditor (E20, `place-edit.ts` `capitalOutside`).
 *
 * Ähnliche Geschwisterfarben sind gewollt und kein Befund (H2).
 */

/** Legacys Name eines neu angelegten Gebiets („Neues Herrschaftsgebiet (n)“, ADR-0014 „Gemessen“: 631 im Bestand). */
export const PLATZHALTER = /^Neues Herrschaftsgebiet(?:\s*\(\d+\))?$/u;
/** Ab dieser Fläche zählt eine Überlappung (E²), wie im Prüfer der Formen. */
export const MIN_UEBERLAPPUNG = 0.001;

export interface FindingOptions {
    mapDomainId?: string;
    displayYearBf?: number;
}

export async function readTerritoryFindings(
    database: Database,
    options: FindingOptions = {},
): Promise<EditorTerritoryFindings> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const yearBf = options.displayYearBf ?? AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf;
    const findings: EditorTerritoryFinding[] = [];

    const gebiete = await database<{ public_id: string; name: string; parent: string | null }[]>`
        SELECT t.public_id::text AS public_id, t.name, p.public_id::text AS parent
          FROM territory t LEFT JOIN territory p ON p.id = t.parent_id AND p.id <> t.id
         WHERE t.map_domain_id = ${mapDomainId} AND t.is_active
         ORDER BY t.public_id
    `;
    const name = new Map(gebiete.map((g) => [g.public_id, g.name]));
    const eltern = new Map(gebiete.map((g) => [g.public_id, g.parent]));
    const ref = (id: string): { id: string; name: string } => ({ id, name: name.get(id) ?? "" });
    /** Ist `oben` ein Vorfahr von `unten`? Ein Zyklus endet. */
    const vorfahr = (oben: string, unten: string): boolean => {
        const gesehen = new Set<string>();
        for (let p = eltern.get(unten); p != null && !gesehen.has(p); p = eltern.get(p)) {
            if (p === oben) return true;
            gesehen.add(p);
        }
        return false;
    };

    // N2: der Nachweis selbst, je Fläche die Bänder mit Abweichung.
    const input = await oracleInputFromDatabase(database, mapDomainId);
    const gebietDerFlaeche = new Map(input.geometries.map((g) => [g.publicId, g.territoryPublicId]));
    const nachweis = await verifyOwnBands(database, { mapDomainId, displayYearBf: yearBf });
    const n2 = new Map<string, Set<number>>();
    for (const band of nachweis.bands)
        for (const abweichung of band.differences) {
            const menge = n2.get(abweichung.area) ?? new Set<number>();
            menge.add(band.band);
            n2.set(abweichung.area, menge);
        }
    for (const [area, baender] of [...n2].sort((a, b) => a[0].localeCompare(b[0]))) {
        const territory = gebietDerFlaeche.get(area);
        if (territory !== undefined)
            findings.push({ territory, kind: "n2", area, bands: [...baender].sort((a, b) => a - b) });
    }

    // Lücken: nach den gespeicherten Spannen, Band für Band bis 8 (ohne Legacys Klemme auf 6).
    const maxBand = AVENTURIA_POLITICAL_CARTOGRAPHY.maxBand;
    const regel = legacyDisplayByBand(input, yearBf, maxBand, (band) => band);
    const luecken = new Map<string, Set<number>>();
    for (const g of legacyYear(input, yearBf).geometries)
        regel.forEach((band, b) => {
            if (band.has(g.publicId)) return;
            const menge = luecken.get(g.territoryPublicId) ?? new Set<number>();
            menge.add(b);
            luecken.set(g.territoryPublicId, menge);
        });
    for (const [territory, baender] of [...luecken].sort((a, b) => a[0].localeCompare(b[0])))
        findings.push({ territory, kind: "luecke", bands: [...baender].sort((a, b) => a - b) });

    // Überlappungen nicht verwandter Gebiete im obersten abgeleiteten Band.
    const paare = await database<{ a: string; b: string; size: number }[]>`
        WITH oben AS (
            SELECT max(s.band) AS band FROM territory_shape s JOIN territory t ON t.id = s.territory_id
             WHERE t.map_domain_id = ${mapDomainId}
        ), paar AS (
            SELECT ta.public_id::text AS a, tb.public_id::text AS b, ST_Area(ST_Intersection(sa.geom, sb.geom)) AS size
              FROM territory_shape sa
              JOIN oben ON sa.band = oben.band
              JOIN territory_shape sb ON sb.band = sa.band AND sb.territory_id > sa.territory_id
                   AND sa.geom && sb.geom AND ST_Intersects(sa.geom, sb.geom)
              JOIN territory ta ON ta.id = sa.territory_id
              JOIN territory tb ON tb.id = sb.territory_id
             WHERE ta.map_domain_id = ${mapDomainId}
        )
        SELECT a, b, size FROM paar WHERE size > ${MIN_UEBERLAPPUNG} ORDER BY a, b
    `;
    for (const paar of paare) {
        if (vorfahr(paar.a, paar.b) || vorfahr(paar.b, paar.a)) continue;
        const size = Math.round(paar.size * 1000) / 1000;
        findings.push({ territory: paar.a, kind: "ueberlappung", other: ref(paar.b), size });
        findings.push({ territory: paar.b, kind: "ueberlappung", other: ref(paar.a), size });
    }

    // Platzhalter.
    for (const g of gebiete)
        if (PLATZHALTER.test(g.name.trim())) findings.push({ territory: g.public_id, kind: "platzhalter" });

    // Ungültige Flächen (die Spalte rechnet die Datenbank, Migration 0055).
    const ungueltig = await database<{ area: string; territory: string }[]>`
        SELECT a.public_id::text AS area, t.public_id::text AS territory
          FROM territory_area a JOIN territory t ON t.id = a.territory_id
         WHERE t.map_domain_id = ${mapDomainId} AND a.is_active AND t.is_active AND NOT a.is_valid
         ORDER BY t.public_id, a.public_id
    `;
    for (const zeile of ungueltig) findings.push({ territory: zeile.territory, kind: "ungueltig", area: zeile.area });

    // Hauptstadt und Sitz: hängend, wenn es den Ort weder auf der Karte noch ohne Lage gibt; außerhalb, wenn keine Form ihn enthält.
    const verweise = await database<
        { territory: string; field: "capital" | "seat"; place: string; da: boolean; ausserhalb: boolean }[]
    >`
        WITH v AS (
            SELECT t.id, t.public_id, 'capital' AS field, t.capital_place_public_id AS place
              FROM territory t WHERE t.map_domain_id = ${mapDomainId} AND t.is_active AND t.capital_place_public_id IS NOT NULL
            UNION ALL
            SELECT t.id, t.public_id, 'seat', t.seat_place_public_id
              FROM territory t WHERE t.map_domain_id = ${mapDomainId} AND t.is_active AND t.seat_place_public_id IS NOT NULL
        )
        SELECT v.public_id::text AS territory, v.field, v.place::text AS place,
               (EXISTS (SELECT 1 FROM place p WHERE p.public_id = v.place AND p.is_active)
                OR EXISTS (SELECT 1 FROM place_unplaced u WHERE u.public_id = v.place AND u.is_active)) AS da,
               (v.field = 'capital'
                AND EXISTS (SELECT 1 FROM territory_shape s WHERE s.territory_id = v.id)
                AND EXISTS (SELECT 1 FROM place p WHERE p.public_id = v.place AND p.is_active)
                AND NOT EXISTS (SELECT 1 FROM territory_shape s JOIN place p ON p.public_id = v.place
                                 WHERE s.territory_id = v.id AND ST_Covers(s.geom, p.geom))) AS ausserhalb
          FROM v
         ORDER BY 1, 2
    `;
    for (const v of verweise) {
        if (!v.da) findings.push({ territory: v.territory, kind: "verweis", field: v.field, place: v.place });
        else if (v.ausserhalb) findings.push({ territory: v.territory, kind: "hauptstadt", place: v.place });
    }

    const [stand] = await database<{ derived_revision: string | null }[]>`
        SELECT derived_revision FROM territory_state WHERE map_domain_id = ${mapDomainId}
    `;
    return {
        yearBf,
        ...(stand?.derived_revision ? { derivedRevision: stand.derived_revision } : {}),
        findings,
    };
}
