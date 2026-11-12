import type { Database } from "../database.ts";
import { CLAIM_REMAINDER_EPSILON } from "./derive-claims.ts";
import type { DeriveInputs } from "./derive.ts";
import type { AssignmentResult } from "./resolve.ts";

/**
 * Prüfer der Schraffur umstrittener Gebiete (WI-0062 Nachtrag 2026-09-30): Gibt es genau die Schraffurflächen, die die
 * Anspruchsliste und die Zuordnung verlangen, liegt jede in der Form, unter der sie erscheint, und ist die Füllung
 * genau die Form ohne sie? Wird von `verifyTerritoryShapes` mitgerufen.
 */

export interface ClaimCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders: string[];
}

const SAMPLE = 5;
/** So viel Abweichung in Karteneinheiten² gilt noch als gleich (Gleitkomma, Vereinigung). */
const AREA_EPSILON = 1e-6;

export async function verifyClaimShapes(
    database: Database,
    mapDomainId: string,
    inputs: DeriveInputs,
    result: AssignmentResult,
): Promise<ClaimCheck[]> {
    const checks: ClaimCheck[] = [];

    // ---- Welche Flächen: die Gebiete mit einem Anspruch, in jedem Band, das eine ihrer Flächen zeigt -------------------
    const idOf = new Map(inputs.territories.map((t) => [t.publicId, t.id]));
    const claimed = new Set<number>();
    for (const claim of inputs.claims) {
        const id = idOf.get(claim.territoryPublicId);
        if (id !== undefined) claimed.add(id);
    }
    const sourceOf = new Map(inputs.areas.map((a) => [a.id, a.territoryId]));
    const wanted = new Map<string, number>();
    for (const assignment of result.assignments) {
        const source = sourceOf.get(assignment.areaId);
        if (source !== undefined && claimed.has(source)) {
            wanted.set(`${String(assignment.band)}/${String(source)}`, assignment.territoryId);
        }
    }
    const stored = await database<{ band: number; territory_id: number; display_territory_id: number }[]>`
        SELECT cs.band::int AS band, cs.territory_id::int AS territory_id,
               cs.display_territory_id::int AS display_territory_id
        FROM territory_claim_shape cs
        JOIN territory t ON t.id = cs.territory_id
        WHERE t.map_domain_id = ${mapDomainId}
    `;
    const problems: string[] = [];
    const have = new Map(
        stored.map((row) => [`${String(row.band)}/${String(row.territory_id)}`, row.display_territory_id]),
    );
    for (const [key, display] of wanted) {
        if (!have.has(key)) problems.push(`${key}: Schraffurfläche fehlt`);
        else if (have.get(key) !== display) problems.push(`${key}: erscheint unter dem falschen Gebiet`);
    }
    for (const key of have.keys())
        if (!wanted.has(key)) problems.push(`${key}: Schraffurfläche ohne Anspruch oder Zuordnung`);
    checks.push({
        name: "claim_shapes_parity",
        passed: problems.length === 0,
        detail:
            problems.length === 0
                ? `${String(stored.length)} Schraffurflächen: genau die Gebiete mit Anspruch, in jedem Band, das sie zeigt, unter dem richtigen Gebiet`
                : `${String(problems.length)} Abweichungen`,
        offenders: problems.slice(0, SAMPLE),
    });

    // ---- Jede Schraffurfläche ist gültig, liegt in der Form, unter der sie erscheint, und folgt der Renderprojektion -----
    const shape = await database<{ band: number; public_id: string; why: string }[]>`
        SELECT cs.band::int AS band, t.public_id::text,
               CASE
                 WHEN NOT ST_IsValid(cs.geom) OR ST_IsEmpty(cs.geom) THEN 'Fläche ungültig oder leer'
                 WHEN NOT EXISTS (SELECT 1 FROM territory_shape s WHERE s.band = cs.band AND s.territory_id = cs.display_territory_id)
                   THEN 'die Form, unter der sie erscheint, fehlt'
                 WHEN ST_Area(ST_Difference(cs.geom, (SELECT s.geom FROM territory_shape s
                        WHERE s.band = cs.band AND s.territory_id = cs.display_territory_id))) > ${AREA_EPSILON}
                   THEN 'liegt nicht in der Form, unter der sie erscheint'
                 WHEN NOT ST_OrderingEquals(cs.render_geom, map_domain_to_render(t.map_domain_id, cs.geom)::geometry(MultiPolygon, 3857))
                   THEN 'Renderprojektion weicht ab'
               END AS why
        FROM territory_claim_shape cs
        JOIN territory t ON t.id = cs.territory_id
        WHERE t.map_domain_id = ${mapDomainId}
    `;
    const bad = shape.filter((row) => row.why !== null);
    checks.push({
        name: "claim_shapes_valid",
        passed: bad.length === 0,
        detail:
            bad.length === 0
                ? `${String(shape.length)} Schraffurflächen: gültig, in ihrer Form, Renderprojektion folgt der Geometrie`
                : `${String(bad.length)} Schraffurflächen mit Fehler`,
        offenders: bad.map((row) => `Band ${String(row.band)} ${row.public_id}: ${row.why}`).slice(0, SAMPLE),
    });

    // ---- Die Füllung ist die Form ohne die Schraffur; ganz Umstrittenes bleibt ohne Füllung stehen -------------------
    const fills = await database<{ band: number; public_id: string; why: string }[]>`
        WITH pieces AS (
            SELECT cs.band, cs.display_territory_id AS territory_id, ST_UnaryUnion(ST_Collect(cs.geom)) AS geom
            FROM territory_claim_shape cs JOIN territory t ON t.id = cs.territory_id
            WHERE t.map_domain_id = ${mapDomainId}
            GROUP BY cs.band, cs.display_territory_id
        )
        SELECT s.band::int AS band, t.public_id::text,
               CASE
                 WHEN p.geom IS NULL AND (s.hatched OR s.fill_render_geom IS NOT NULL)
                   THEN 'ohne Schraffur, aber mit Ausschnitt oder Marke'
                 WHEN p.geom IS NOT NULL AND s.hatched AND s.fill_render_geom IS NOT NULL
                   THEN 'ganz schraffiert und trotzdem mit Füllung'
                 WHEN p.geom IS NOT NULL AND s.hatched
                      AND ST_Area(ST_Difference(s.geom, p.geom)) >= ${CLAIM_REMAINDER_EPSILON}
                   THEN 'als ganz schraffiert markiert, aber ein Rest bleibt'
                 WHEN p.geom IS NOT NULL AND NOT s.hatched AND s.fill_render_geom IS NULL
                   THEN 'teilweise schraffiert, aber die Füllung hat keinen Ausschnitt'
                 WHEN p.geom IS NOT NULL AND NOT s.hatched
                      AND ST_Area(ST_SymDifference(
                              map_domain_to_render(t.map_domain_id, ST_Difference(s.geom, p.geom))::geometry(MultiPolygon, 3857),
                              s.fill_render_geom)) > 1e-6 * ST_Area(s.render_geom)
                   THEN 'die Füllung ist nicht die Form ohne die Schraffur'
               END AS why
        FROM territory_shape s
        JOIN territory t ON t.id = s.territory_id
        LEFT JOIN pieces p ON p.band = s.band AND p.territory_id = s.territory_id
        WHERE t.map_domain_id = ${mapDomainId}
    `;
    const badFills = fills.filter((row) => row.why !== null);
    checks.push({
        name: "fill_without_hatch",
        passed: badFills.length === 0,
        detail:
            badFills.length === 0
                ? "die Füllung jeder Form ist die Form ohne ihre schraffierten Flächen, ganz Umstrittenes bleibt ohne Füllung"
                : `${String(badFills.length)} Formen mit falscher Füllung`,
        offenders: badFills.map((row) => `Band ${String(row.band)} ${row.public_id}: ${row.why}`).slice(0, SAMPLE),
    });
    return checks;
}
