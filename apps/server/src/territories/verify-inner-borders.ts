import { AVENTURIA_POLITICAL_CARTOGRAPHY } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import type { DisplayedTerritory } from "./resolve.ts";

/**
 * Prüfer der Innengrenzen (`derive-inner-borders.ts`, WI-0062 Feinschliff 2026-09-30, Betreiber: „nur 1 innengrenze zwischen
 * 2 angrenzenden flächen“).
 *
 * `inner_border_unique`: An keiner Stelle stehen zwei gestrichelte Linien übereinander.
 *  - Keine Linie steht doppelt: Summe der Längen aller Stücke eines Bandes = Länge ihrer Vereinigung.
 *  - Keine Strecke von `minLengthUnits` liegt näher als `coincidenceUnits` an einem anderen Stück (mit 10 % Luft, denn der
 *    Rand der Pufferfläche ist gerundet). Das rechnet der Prüfer aus den gespeicherten Zeilen, nicht aus den Zwischenständen
 *    der Ableitung.
 *
 * `inner_border_owners`: Jede Innengrenze gehört einem Vorfahren gezeigter Gebiete des Bandes (oder einem gezeigten Gebiet
 * mit gezeigten Nachfahren), und ihre Ebene ist dessen Tiefe. Die Ketten rechnet der Prüfer aus der Zuordnung nach.
 */

export interface InnerBorderCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders: string[];
}

const SAMPLE = 5;
/** So viel Längenabweichung (Karteneinheiten) gilt noch als gleich (Gleitkomma der Vereinigung). */
const LENGTH_EPSILON = 1e-4;

export async function verifyInnerBorders(
    database: Queryable,
    mapDomainId: string,
    displayed: readonly DisplayedTerritory[],
): Promise<InnerBorderCheck[]> {
    const unique = AVENTURIA_POLITICAL_CARTOGRAPHY.innerUnique;
    const checks: InnerBorderCheck[] = [];

    // ---- Keine Linie doppelt ----------------------------------------------------------------------------------------
    const duplicated = await database<{ band: number; excess: number }[]>`
        SELECT b.band::int AS band, sum(ST_Length(b.geom)) - ST_Length(ST_UnaryUnion(ST_Collect(b.geom))) AS excess
        FROM territory_border b
        JOIN territory t ON t.id = b.territory_id
        WHERE t.map_domain_id = ${mapDomainId} AND b.kind = 'inner'
        GROUP BY b.band
        HAVING sum(ST_Length(b.geom)) - ST_Length(ST_UnaryUnion(ST_Collect(b.geom))) > ${LENGTH_EPSILON}::float8
        ORDER BY b.band
    `;
    // ---- Keine Strecke liegt auf einer anderen ----------------------------------------------------------------------
    const coincident = await database<{ band: number; a: string; b: string; length: number; x: number; y: number }[]>`
        WITH parts AS (
            SELECT b.band, t.name, d.geom AS g
            FROM territory_border b
            JOIN territory t ON t.id = b.territory_id
            CROSS JOIN LATERAL ST_Dump(b.geom) d
            WHERE t.map_domain_id = ${mapDomainId} AND b.kind = 'inner'
        ), numbered AS (
            SELECT row_number() OVER () AS id, * FROM parts
        )
        SELECT a.band::int AS band, a.name AS a, b.name AS b, ST_Length(s.geom) AS length,
               ST_X(ST_PointN(s.geom, 1)) AS x, ST_Y(ST_PointN(s.geom, 1)) AS y
        FROM numbered a
        JOIN numbered b ON b.band = a.band AND b.id > a.id
                       AND ST_DWithin(a.g, b.g, ${unique.coincidenceUnits * 0.9}::float8)
        CROSS JOIN LATERAL (
            SELECT d.geom
            FROM ST_Dump(ST_Intersection(a.g, ST_Buffer(b.g, ${unique.coincidenceUnits * 0.9}::float8))) d
            WHERE ST_Length(d.geom) >= ${unique.minLengthUnits}::float8
        ) s
        ORDER BY ST_Length(s.geom) DESC
    `;
    const problems = [
        ...duplicated.map((row) => `Band ${String(row.band)}: ${row.excess.toFixed(4)} E Linie stehen doppelt`),
        ...coincident.map(
            (row) =>
                `Band ${String(row.band)}: ${row.a} / ${row.b}: ${row.length.toFixed(2)} E liegen aufeinander bei (${row.x.toFixed(1)}, ${row.y.toFixed(1)})`,
        ),
    ];
    checks.push({
        name: "inner_border_unique",
        passed: problems.length === 0,
        detail:
            problems.length === 0
                ? `keine Innengrenze steht doppelt: keine Linie zweimal, keine Strecke ab ${String(unique.minLengthUnits)} E näher als ${String(unique.coincidenceUnits)} E an einer anderen`
                : `${String(problems.length)} Stellen mit doppelter Innengrenze`,
        offenders: problems.slice(0, SAMPLE),
    });

    // ---- Eigner und Ebene -------------------------------------------------------------------------------------------
    const depthOf = new Map<string, number>();
    for (const shown of displayed) {
        shown.chainIds.forEach((owner, depth) => depthOf.set(`${String(shown.band)}/${String(owner)}`, depth));
    }
    const stored = await database<{ band: number; territory_id: number; level: number; name: string }[]>`
        SELECT b.band::int AS band, b.territory_id::int AS territory_id, b.level::int AS level, t.name
        FROM territory_border b
        JOIN territory t ON t.id = b.territory_id
        WHERE t.map_domain_id = ${mapDomainId} AND b.kind = 'inner'
    `;
    const ownerProblems: string[] = [];
    for (const row of stored) {
        const depth = depthOf.get(`${String(row.band)}/${String(row.territory_id)}`);
        if (depth === undefined)
            ownerProblems.push(`Band ${String(row.band)}: ${row.name} ist in diesem Band kein Vorfahr`);
        else if (depth !== row.level) {
            ownerProblems.push(
                `Band ${String(row.band)}: ${row.name} Ebene ${String(row.level)} statt Tiefe ${String(depth)}`,
            );
        }
    }
    checks.push({
        name: "inner_border_owners",
        passed: ownerProblems.length === 0,
        detail:
            ownerProblems.length === 0
                ? `${String(stored.length)} Innengrenzen: jede gehört einem Vorfahr gezeigter Gebiete, Ebene = Tiefe`
                : `${String(ownerProblems.length)} Innengrenzen mit falschem Eigner oder falscher Ebene`,
        offenders: ownerProblems.slice(0, SAMPLE),
    });
    return checks;
}
