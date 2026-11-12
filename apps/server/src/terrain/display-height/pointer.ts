import type { Queryable } from "../../database.ts";
import { DISPLAY_HEIGHT_GENERATOR } from "./generate.ts";

export type DisplayHeightState =
    | { kind: "current"; revision: string; demRevision: string }
    | { kind: "stale"; revision: string; demRevision: string }
    | { kind: "none" };

/**
 * Historical synthetic contours are stale after the domain cutover.
 *
 * 🔴 Gebunden wird an das **Gelände**, nicht an die Kodierung seiner Kacheln (Kapitel 5.32a, Regel 2): Die
 * Anzeigehöhen rechnen aus dem Domain-Master (`terrain_domain_raster`, `terrain_dem.domain_fingerprint`), nie aus
 * den Kacheln. Eine neue Kachelpyramide desselben Masters ist deshalb kein neues Gelände, und die Linien gelten
 * weiter; ein anderer Master ist eines, und sie sind veraltet.
 *
 * 💣 Vorher stand hier allein die DEM-Revision - der Hash der Kachelbytes. WI-0142 rundete die Höhen der Kacheln
 * auf einen Schritt, die Revision wechselte, die Höhen nicht: Die Karte zeigte in 2D wie in 3D weder Höhenlinien
 * noch Höhenstufen noch Legende, obwohl 33.502 Linien gültig in der Datenbank lagen (Betreiber 2026-10-14). Jede
 * künftige Änderung an der Kodierung hätte dasselbe ausgelöst, auch auf Stage und Production.
 *
 * 🪤 Gemeldet wird dann die Revision, die GILT, nicht die gespeicherte: Die Karte vergleicht sie mit dem Gelände,
 * das sie selbst geladen hat (`displayHeightFor`), und blendet die Linien sonst aus.
 */
export async function displayHeightState(database: Queryable, mapDomainId: string): Promise<DisplayHeightState> {
    const [row] = await database<
        {
            revision: string;
            dem_revision: string;
            generator_version: string;
            dem_current: string | null;
            master_current: string | null;
            master_bound: string | null;
        }[]
    >`
        SELECT h.revision, h.dem_revision, h.generator_version, c.revision AS dem_current,
            c.domain_fingerprint AS master_current,
            (SELECT d.domain_fingerprint FROM terrain_dem d WHERE d.revision = h.dem_revision) AS master_bound
        FROM terrain_display_height h
        LEFT JOIN terrain_dem c ON c.map_domain_id = h.map_domain_id AND c.is_current
        WHERE h.map_domain_id = ${mapDomainId} AND h.is_current
    `;
    if (!row) return { kind: "none" };
    const sameTerrain =
        row.dem_current === row.dem_revision || (row.master_bound !== null && row.master_bound === row.master_current);
    const bound = row.generator_version === DISPLAY_HEIGHT_GENERATOR && sameTerrain;
    return {
        kind: bound ? "current" : "stale",
        revision: row.revision,
        demRevision: bound ? (row.dem_current ?? row.dem_revision) : row.dem_revision,
    };
}

/**
 * Bindet eine schon vorhandene Revision an die Eingaben, aus denen sie eben gerechnet wurde. Gleiche Höhen auf
 * einem neu veröffentlichten Gelände ergeben dieselbe Revision (Stage 2026-10-04: dasselbe Master als WebP, neue
 * DEM-Revision); ohne die neue DEM-Revision hält der Zeiger sie für veraltet, und die Karte zeigt nichts.
 */
export async function rebindDisplayHeight(
    database: Queryable,
    revision: string,
    inputs: { fingerprint: string; demRevision: string; reliefRevision: string },
): Promise<void> {
    await database`
        UPDATE terrain_display_height
        SET fingerprint = ${inputs.fingerprint}, dem_revision = ${inputs.demRevision},
            relief_revision = ${inputs.reliefRevision}
        WHERE revision = ${revision}
    `;
}
