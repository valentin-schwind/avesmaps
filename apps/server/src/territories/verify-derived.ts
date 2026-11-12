import {
    AVENTURIA,
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    LEGACY_POLITICAL_MAX_BAND,
    MAX_BAND,
    borderNameAllowed,
} from "@avesmaps3d/shared";
import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import {
    borderNameOwners,
    computeDerivation,
    hullAncestors,
    hullMembers,
    readDeriveInputs,
    territoryRevision,
    type DeriveInputs,
} from "./derive.ts";
import { effectiveChain, isGenericGroupName, type Assignment } from "./resolve.ts";
import { verifyBandRuns } from "./verify-band-runs.ts";
import { verifyClaimShapes } from "./verify-claims.ts";
import { verifyInnerBorders } from "./verify-inner-borders.ts";

/**
 * Prüfer der abgeleiteten Herrschaftsgebiete (WI-0062, ADR-0014): Stimmt die Ableitung mit ihren Quellen überein, und
 * ist das Gezeichnete ganz? Er rechnet die Zuordnung unabhängig ein zweites Mal (`resolve.ts` aus den Zeilen der
 * Datenbank) und vergleicht sie mit `territory_display_area`.
 *
 * Harte Prüfungen (das Urteil): Revision und Jahr gelten, die Zuordnung stimmt Zeile für Zeile, jede Fläche eines Bandes
 * liegt in ihrem Gebiet, jede Form ist gültig und trägt ihren Namensanker, Grenzen sind gültig und ebenen richtig, die
 * Renderprojektion folgt der Geometrie, die Hauptstadtzeiger stimmen.
 *
 * Befunde (ohne Einfluss aufs Urteil, F2: „Lücken und Überlappungen als Befund, nicht korrigieren“): Flächen, die ein Band
 * nicht zeigt, Überlappungen zwischen gezeigten, nicht verwandten Gebieten, und Zuordnungen in Band 0 bis 6, die mit Legacys
 * Werten anders wären (WI-0188, `legacyBandDifferences`).
 *
 * 🔴 Dieselbe Bandgrenze wie die Ableitung: `maxBand` der Tafel (seit WI-0209 D2 ohne die Übergangsregel `deriveMaxBand`).
 */

export interface DerivedCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

export interface TerritoryShapeReport {
    passed: boolean;
    checks: DerivedCheck[];
    findings: string[];
}

const SAMPLE = 5;
/** So viel Abweichung in Karteneinheiten² gilt noch als gleich (Gleitkomma, Vereinigung). */
const AREA_EPSILON = 1e-6;

/** Eine Fläche, die ein Band mit Legacys Werten anders zeigt als mit den gespeicherten (`undefined`: gar nicht). */
export interface LegacyBandDifference {
    band: number;
    areaId: number;
    legacy: number | undefined;
    now: number | undefined;
}

/**
 * Zeigt jede Fläche in Band 0 bis 6 dasselbe Gebiet wie mit Legacys Werten (WI-0188 A5)? Der Gebietsimport schreibt Legacys
 * oberstes Band 6 als 8. Die engste Spanne gewinnt (ADR-0014 §4), und eine Spanne bis 8 ist zwei Bänder breiter als dieselbe
 * bis 6: Lag sie mit der kürzeren Spanne eines Vorfahren gleichauf, gewinnt jetzt der Vorfahr. Im Bestand vom 2026-10-16 gibt
 * es keinen solchen Fall. Die Gegenrechnung liest dazu jede 8 einer Legacy-Zeile als Legacys 6 - nur hier, zum Vergleich.
 */
export function legacyBandDifferences(
    inputs: DeriveInputs,
    yearBf: number,
    assignments: readonly Assignment[],
): LegacyBandDifference[] {
    const legacyMax = (legacy: boolean, max: number | null): number | null =>
        legacy && max === MAX_BAND ? LEGACY_POLITICAL_MAX_BAND : max;
    const legacyInputs: DeriveInputs = {
        ...inputs,
        territories: inputs.territories.map((row) => ({ ...row, maxZoom: legacyMax(row.legacy, row.maxZoom) })),
        areas: inputs.areas.map((row) => ({ ...row, maxZoom: legacyMax(row.legacy, row.maxZoom) })),
    };
    const was = computeDerivation(legacyInputs, yearBf, LEGACY_POLITICAL_MAX_BAND).result.assignments;
    const byKey = (list: readonly Assignment[]): Map<string, number> =>
        new Map(
            list
                .filter((entry) => entry.band <= LEGACY_POLITICAL_MAX_BAND)
                .map((entry) => [`${String(entry.band)}/${String(entry.areaId)}`, entry.territoryId]),
        );
    const legacy = byKey(was);
    const now = byKey(assignments);
    const differences: LegacyBandDifference[] = [];
    for (const key of new Set([...legacy.keys(), ...now.keys()])) {
        if (legacy.get(key) === now.get(key)) continue;
        const [band, areaId] = key.split("/").map(Number) as [number, number];
        differences.push({ band, areaId, legacy: legacy.get(key), now: now.get(key) });
    }
    return differences.sort((a, b) => a.band - b.band || a.areaId - b.areaId);
}

function check(name: string, passed: boolean, detail: string, offenders: string[] = []): DerivedCheck {
    return offenders.length > 0
        ? { name, passed, detail, offenders: offenders.slice(0, SAMPLE) }
        : { name, passed, detail };
}

export async function verifyTerritoryShapes(
    database: Database,
    options: { mapDomainId?: string; displayYearBf?: number } = {},
): Promise<TerritoryShapeReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const yearBf = options.displayYearBf ?? AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf;
    const checks: DerivedCheck[] = [];
    const findings: string[] = [];

    const inputs = await readDeriveInputs(database, mapDomainId);
    const maxBand = AVENTURIA_POLITICAL_CARTOGRAPHY.maxBand;
    const expectedRevision = territoryRevision(inputs, yearBf, maxBand);
    const [state] = await database<{ derived_revision: string | null; derived_year_bf: number | null }[]>`
        SELECT derived_revision, derived_year_bf FROM territory_state WHERE map_domain_id = ${mapDomainId}
    `;
    checks.push(
        check(
            "revision_current",
            state?.derived_revision === expectedRevision && state?.derived_year_bf === yearBf,
            `Revision der Eingaben ${expectedRevision} (Jahr ${String(yearBf)}), abgeleitet ${String(state?.derived_revision)} (Jahr ${String(state?.derived_year_bf)})`,
        ),
    );

    // ---- Zuordnung: unabhängig nachgerechnet ------------------------------------------------------------------
    const { result, displayed, nodes } = computeDerivation(inputs, yearBf, maxBand);
    const stored = await database<{ band: number; area_id: number; territory_id: number }[]>`
        SELECT da.band::int AS band, da.area_id::int AS area_id, da.territory_id::int AS territory_id
        FROM territory_display_area da
        JOIN territory t ON t.id = da.territory_id
        WHERE t.map_domain_id = ${mapDomainId}
    `;
    const key = (band: number, area: number, territory: number): string =>
        `${String(band)}/${String(area)}/${String(territory)}`;
    const storedKeys = new Set(stored.map((row) => key(row.band, row.area_id, row.territory_id)));
    const expectedKeys = new Set(result.assignments.map((a) => key(a.band, a.areaId, a.territoryId)));
    const missing = [...expectedKeys].filter((entry) => !storedKeys.has(entry));
    const extra = [...storedKeys].filter((entry) => !expectedKeys.has(entry));
    checks.push(
        check(
            "assignment_parity",
            missing.length === 0 && extra.length === 0,
            missing.length === 0 && extra.length === 0
                ? `${String(expectedKeys.size)} Zuordnungen (Band/Fläche/Gebiet) stimmen mit der Nachrechnung überein`
                : `${String(missing.length)} fehlen, ${String(extra.length)} zu viel`,
            [...missing.map((entry) => `fehlt ${entry}`), ...extra.map((entry) => `zu viel ${entry}`)],
        ),
    );

    // ---- Formen ---------------------------------------------------------------------------------------------
    const shapes = await database<
        { band: number; territory_id: number; parent_id: number | null; depth: number; area: number; ok: boolean }[]
    >`
        SELECT s.band::int AS band, s.territory_id::int AS territory_id, s.parent_id::int AS parent_id,
               s.depth::int AS depth, s.area,
               (ST_IsValid(s.geom) AND NOT ST_IsEmpty(s.geom) AND s.area > 0
                AND abs(ST_Area(s.geom) - s.area) < ${AREA_EPSILON}) AS ok
        FROM territory_shape s
        JOIN territory t ON t.id = s.territory_id
        WHERE t.map_domain_id = ${mapDomainId}
    `;
    const wantedShapes = new Map(displayed.map((d) => [`${String(d.band)}/${String(d.territoryId)}`, d]));
    const shapeProblems: string[] = [];
    const haveShapes = new Set<string>();
    for (const shape of shapes) {
        const id = `${String(shape.band)}/${String(shape.territory_id)}`;
        haveShapes.add(id);
        const want = wantedShapes.get(id);
        if (!want) shapeProblems.push(`${id}: Form ohne Zuordnung`);
        else if (want.parentId !== shape.parent_id || want.depth !== shape.depth) {
            shapeProblems.push(`${id}: Elter/Tiefe weichen ab`);
        }
        if (!shape.ok) shapeProblems.push(`${id}: Form ungültig, leer oder Größe falsch`);
    }
    for (const id of wantedShapes.keys()) if (!haveShapes.has(id)) shapeProblems.push(`${id}: Form fehlt`);
    checks.push(
        check(
            "shape_parity",
            shapeProblems.length === 0,
            shapeProblems.length === 0
                ? `${String(shapes.length)} Formen: Gebiet, Elter, Tiefe stimmen, alle gültig`
                : `${String(shapeProblems.length)} Abweichungen`,
            shapeProblems,
        ),
    );

    // Die Form deckt jede ihrer Flächen und ist nicht größer als deren Summe (= Vereinigung, ohne sie zu wiederholen).
    const coverage = await database<{ band: number; public_id: string; missing: number; over: number }[]>`
        SELECT s.band::int AS band, t.public_id::text,
               COALESCE(max(ST_Area(ST_Difference(territory_area_valid(a.geom), s.geom))), 0) AS missing,
               s.area - COALESCE(sum(ST_Area(territory_area_valid(a.geom))), 0) AS over
        FROM territory_shape s
        JOIN territory t ON t.id = s.territory_id
        JOIN territory_display_area da ON da.band = s.band AND da.territory_id = s.territory_id
        JOIN territory_area a ON a.id = da.area_id
        WHERE t.map_domain_id = ${mapDomainId}
        GROUP BY s.band, t.public_id, s.geom, s.area
        HAVING COALESCE(max(ST_Area(ST_Difference(territory_area_valid(a.geom), s.geom))), 0) > ${AREA_EPSILON}
            OR s.area - COALESCE(sum(ST_Area(territory_area_valid(a.geom))), 0) > ${AREA_EPSILON}
    `;
    checks.push(
        check(
            "shape_is_union",
            coverage.length === 0,
            coverage.length === 0
                ? "jede Form deckt alle ihre Flächen und ist nicht größer als deren Summe"
                : `${String(coverage.length)} Formen decken ihre Flächen nicht`,
            coverage.map((row) => `Band ${String(row.band)} ${row.public_id}`),
        ),
    );

    const anchors = await database<{ band: number; public_id: string }[]>`
        SELECT s.band::int AS band, t.public_id::text
        FROM territory_shape s JOIN territory t ON t.id = s.territory_id
        WHERE t.map_domain_id = ${mapDomainId} AND NOT ST_Covers(s.geom, s.label_geom)
    `;
    checks.push(
        check(
            "label_inside_shape",
            anchors.length === 0,
            anchors.length === 0
                ? "jeder Namensanker liegt in seiner Form"
                : `${String(anchors.length)} Namensanker außerhalb ihrer Form`,
            anchors.map((row) => `Band ${String(row.band)} ${row.public_id}`),
        ),
    );

    // ---- Grenzen ------------------------------------------------------------------------------------------------
    const borderProblems = await database<{ band: number; kind: string; public_id: string; why: string }[]>`
        SELECT b.band::int AS band, b.kind, t.public_id::text,
               CASE
                 WHEN NOT ST_IsValid(b.geom) OR ST_IsEmpty(b.geom) THEN 'Linie ungültig oder leer'
                 WHEN b.level <> (SELECT s.depth FROM territory_shape s WHERE s.band = b.band AND s.territory_id = b.territory_id) AND b.kind = 'outer'
                      AND EXISTS (SELECT 1 FROM territory_shape s WHERE s.band = b.band AND s.territory_id = b.territory_id)
                   THEN 'Ebene weicht von der Tiefe ab'
                 WHEN NOT ST_OrderingEquals(b.render_geom, map_domain_to_render(t.map_domain_id, b.geom)::geometry(MultiLineString, 3857))
                   THEN 'Renderprojektion weicht ab'
               END AS why
        FROM territory_border b
        JOIN territory t ON t.id = b.territory_id
        WHERE t.map_domain_id = ${mapDomainId}
    `;
    const badBorders = borderProblems.filter((row) => row.why !== null);
    checks.push(
        check(
            "borders_valid",
            badBorders.length === 0,
            badBorders.length === 0
                ? `${String(borderProblems.length)} Grenzlinien: gültig, Ebene stimmt, Renderprojektion folgt der Geometrie`
                : `${String(badBorders.length)} Grenzlinien mit Fehler`,
            badBorders.map((row) => `Band ${String(row.band)} ${row.kind} ${row.public_id}: ${row.why}`),
        ),
    );
    // Jeder Vorfahr mit gezeigten Nachfahren und jedes gezeigte Reich hat seine Außengrenze - nicht mehr, nicht weniger.
    const wantedOuter = new Set<string>();
    for (const shown of displayed) {
        shown.chainIds.forEach((owner, depth) => {
            if (depth < shown.chainIds.length - 1 || depth === 0)
                wantedOuter.add(`${String(shown.band)}/${String(owner)}`);
        });
    }
    const storedOuter = await database<{ band: number; territory_id: number }[]>`
        SELECT b.band::int AS band, b.territory_id::int AS territory_id
        FROM territory_border b JOIN territory t ON t.id = b.territory_id
        WHERE t.map_domain_id = ${mapDomainId} AND b.kind = 'outer'
    `;
    const storedOuterKeys = new Set(storedOuter.map((row) => `${String(row.band)}/${String(row.territory_id)}`));
    const outerMissing = [...wantedOuter].filter((entry) => !storedOuterKeys.has(entry));
    const outerExtra = [...storedOuterKeys].filter((entry) => !wantedOuter.has(entry));
    checks.push(
        check(
            "outer_borders_present",
            outerMissing.length === 0 && outerExtra.length === 0,
            outerMissing.length === 0 && outerExtra.length === 0
                ? `${String(wantedOuter.size)} Außengrenzen: jede Hülle hat ihre, keine zu viel`
                : `${String(outerMissing.length)} fehlen, ${String(outerExtra.length)} zu viel`,
            [...outerMissing.map((entry) => `fehlt ${entry}`), ...outerExtra.map((entry) => `zu viel ${entry}`)],
        ),
    );

    // ---- Innengrenzen: genau eine Linie zwischen zwei angrenzenden Flächen (WI-0062 Feinschliff 2026-09-30) ----------------
    for (const entry of await verifyInnerBorders(database, mapDomainId, displayed)) {
        checks.push(check(entry.name, entry.passed, entry.detail, entry.offenders));
    }

    // ---- Schraffur umstrittener Gebiete und die Füllung ohne sie (WI-0062 Nachtrag 2026-09-30) ---------------------------
    for (const entry of await verifyClaimShapes(database, mapDomainId, inputs, result)) {
        checks.push(check(entry.name, entry.passed, entry.detail, entry.offenders));
    }

    // ---- Durchläufe gleicher Zeilen über benachbarte Bänder (die Kachel liefert sie einmal) ---------------------------
    for (const entry of await verifyBandRuns(database, mapDomainId)) {
        checks.push(check(entry.name, entry.passed, entry.detail, entry.offenders));
    }

    // ---- Namen entlang der Außengrenze und die Ausrichtung der Hüllen --------------------------------------------
    // Die Eigner der Namen rechnet der Prüfer aus den Eingaben noch einmal: ab dem Band der Tafel, mit gezeigten
    // Nachfahren, ohne die ausgenommenen Namen. Eine Hülle kann trotzdem ohne Namenslinie bleiben: ihr Umriss hat zu
    // wenige Stützpunkte (Legacy ring.length < 8), oder er fällt ganz mit dem eines Vorfahren zusammen, der den Namen
    // dort schon trägt. Jede andere Lücke und jede Linie ohne Anspruch ist ein Fehler.
    const nameConfig = AVENTURIA_POLITICAL_CARTOGRAPHY.borderName;
    const namesById = new Map(inputs.territories.map((t) => [t.id, t.name]));
    const members = hullMembers(displayed);
    const wantedNames = new Set(
        borderNameOwners(members, namesById).map((o) => `${String(o.band)}/${String(o.owner)}`),
    );
    // Die Linie beginnt an der Grenze (die Enden der Stücke bleiben beim Glätten stehen) und läuft so, dass das Innere der
    // Hülle rechts liegt: ein Punkt einen Tausendstel rechts von der Mitte des ersten Segments muss in der Hülle liegen.
    const storedNames = await database<
        { band: number; territory_id: number; label_name: string; name: string; points: number; inside: boolean }[]
    >`
        WITH lines AS (
            SELECT b.band, b.territory_id, b.label_name, t.name, ST_NPoints(b.geom)::int AS points,
                   ST_StartPoint(ST_GeometryN(b.geom, 1)) AS p0, ST_PointN(ST_GeometryN(b.geom, 1), 2) AS p1
            FROM territory_border b JOIN territory t ON t.id = b.territory_id
            WHERE t.map_domain_id = ${mapDomainId} AND b.kind = 'name'
        ), probes AS (
            SELECT l.*, NULLIF(ST_Distance(l.p0, l.p1), 0) AS d FROM lines l
        )
        SELECT p.band::int AS band, p.territory_id::int AS territory_id, p.label_name, p.name, p.points,
               COALESCE(ST_Covers(
                   ST_BuildArea(o.geom),
                   ST_SetSRID(ST_MakePoint(
                       (ST_X(p.p0) + ST_X(p.p1)) / 2 + (ST_Y(p.p1) - ST_Y(p.p0)) / p.d * 0.001,
                       (ST_Y(p.p0) + ST_Y(p.p1)) / 2 - (ST_X(p.p1) - ST_X(p.p0)) / p.d * 0.001), 0)
               ), FALSE) AS inside
        FROM probes p
        JOIN territory_border o ON o.band = p.band AND o.territory_id = p.territory_id AND o.kind = 'outer'
    `;
    const nameProblems: string[] = [];
    for (const row of storedNames) {
        const owner = `${String(row.band)}/${String(row.territory_id)}`;
        if (!wantedNames.has(owner)) nameProblems.push(`${owner}: Name an einer Hülle, die keinen tragen darf`);
        else if (row.label_name !== row.name) nameProblems.push(`${owner}: Name weicht vom Gebiet ab`);
        else if (!borderNameAllowed(row.label_name, nameConfig.excludeNamePattern))
            nameProblems.push(`${owner}: ausgenommener Name`);
        else if (row.points < nameConfig.minPoints) nameProblems.push(`${owner}: zu wenige Stützpunkte`);
        else if (!row.inside) nameProblems.push(`${owner}: das Innere der Hülle liegt nicht rechts der Namenslinie`);
    }
    const storedNameKeys = new Set(storedNames.map((row) => `${String(row.band)}/${String(row.territory_id)}`));
    const namesMissing = [...wantedNames].filter((entry) => !storedNameKeys.has(entry));
    const namesUnexplained: string[] = [];
    if (namesMissing.length > 0) {
        const ancestors = hullAncestors(members);
        const explainable = await database<{ band: number; owner: number }[]>`
            WITH miss AS (
                SELECT * FROM unnest(
                    ${namesMissing.map((entry) => Number(entry.split("/")[0]))}::int[],
                    ${namesMissing.map((entry) => Number(entry.split("/")[1]))}::bigint[]
                ) AS m(band, owner)
            ), ring AS (
                SELECT m.band, m.owner,
                       (SELECT ST_ExteriorRing(d.geom) FROM ST_Dump(ST_BuildArea(ob.geom)) d
                        ORDER BY ST_Area(d.geom) DESC LIMIT 1) AS line
                FROM miss m
                JOIN territory_border ob ON ob.band = m.band AND ob.territory_id = m.owner AND ob.kind = 'outer'
            ), anc AS (
                SELECT a.band, a.owner, ST_Union(ob.geom) AS lines
                FROM unnest(
                    ${ancestors.map((a) => a.band)}::int[],
                    ${ancestors.map((a) => a.owner)}::bigint[],
                    ${ancestors.map((a) => a.ancestor)}::bigint[]
                ) AS a(band, owner, ancestor)
                JOIN territory_border ob ON ob.band = a.band AND ob.territory_id = a.ancestor AND ob.kind = 'outer'
                GROUP BY a.band, a.owner
            )
            SELECT r.band::int AS band, r.owner::int AS owner
            FROM ring r
            LEFT JOIN anc ON anc.band = r.band AND anc.owner = r.owner
            WHERE ST_NPoints(r.line) < ${nameConfig.minPoints}
               OR (anc.lines IS NOT NULL
                   AND ST_IsEmpty(ST_Difference(r.line, ST_Buffer(anc.lines, ${nameConfig.coincidenceUnits}::float8))))
        `;
        const explained = new Set(explainable.map((row) => `${String(row.band)}/${String(row.owner)}`));
        for (const entry of namesMissing) if (!explained.has(entry)) namesUnexplained.push(`fehlt ${entry}`);
    }
    checks.push(
        check(
            "border_names",
            nameProblems.length === 0 && namesUnexplained.length === 0,
            nameProblems.length === 0 && namesUnexplained.length === 0
                ? `${String(storedNames.length)} Namen entlang der Außengrenze (ab Band ${String(nameConfig.fromBand)}): richtige Hüllen, richtiger Name, Inneres rechts; ${String(namesMissing.length)} Hüllen ohne Linie (zu klein oder ganz vom Vorfahren getragen)`
                : `${String(nameProblems.length + namesUnexplained.length)} Abweichungen bei den Namen entlang der Grenze`,
            [...nameProblems, ...namesUnexplained],
        ),
    );
    // Die Außengrenzen sind rechtsläufig ausgerichtet: das Innere der Hülle liegt in Laufrichtung rechts (Stil: `line-offset`).
    const orientation = await database<{ band: number; public_id: string }[]>`
        WITH rings AS (
            SELECT b.band, b.territory_id, l.path AS path,
                   CASE WHEN ST_IsClosed(l.geom) AND ST_NPoints(l.geom) >= 4 THEN ST_MakePolygon(l.geom) END AS poly
            FROM territory_border b
            JOIN territory t ON t.id = b.territory_id
            CROSS JOIN LATERAL ST_Dump(b.render_geom) l
            WHERE t.map_domain_id = ${mapDomainId} AND b.kind = 'outer'
        ), sized AS (
            SELECT r.*, ST_Area(r.poly) AS area FROM rings r WHERE r.poly IS NOT NULL
        )
        SELECT DISTINCT r.band::int AS band, t.public_id::text
        FROM sized r
        JOIN territory t ON t.id = r.territory_id
        WHERE r.area > 0
          AND ST_IsPolygonCW(r.poly) IS NOT TRUE
          -- ein Loch liegt gegenläufig: es ist im Außenring der Hülle enthalten
          AND NOT EXISTS (
              SELECT 1 FROM sized o
              WHERE o.band = r.band AND o.territory_id = r.territory_id AND o.path <> r.path
                AND o.area > r.area AND ST_Covers(o.poly, ST_PointOnSurface(r.poly))
          )
    `;
    checks.push(
        check(
            "outer_borders_clockwise",
            orientation.length === 0,
            orientation.length === 0
                ? "jeder Außenring liegt rechtsläufig (das Innere rechts der Laufrichtung)"
                : `${String(orientation.length)} Außengrenzen mit linksläufigem Außenring`,
            orientation.map((row) => `Band ${String(row.band)} ${row.public_id}`),
        ),
    );

    const shapeRender = await database<{ band: number; public_id: string }[]>`
        SELECT s.band::int AS band, t.public_id::text
        FROM territory_shape s JOIN territory t ON t.id = s.territory_id
        WHERE t.map_domain_id = ${mapDomainId}
          AND NOT ST_OrderingEquals(s.render_geom, map_domain_to_render(t.map_domain_id, s.geom)::geometry(MultiPolygon, 3857))
    `;
    checks.push(
        check(
            "render_follows_geometry",
            shapeRender.length === 0,
            shapeRender.length === 0
                ? "die Renderprojektion aller Formen folgt ihrer Geometrie"
                : `${String(shapeRender.length)} Formen mit abweichender Renderprojektion`,
            shapeRender.map((row) => `Band ${String(row.band)} ${row.public_id}`),
        ),
    );

    // ---- Hauptstädte ------------------------------------------------------------------------------------------
    const wantedCapitals = new Map<string, Set<number>>();
    const capitalOf = new Map(inputs.territories.map((t) => [t.id, t.capital]));
    for (const shown of displayed) {
        const capital = capitalOf.get(shown.territoryId);
        if (!capital) continue;
        const bands = wantedCapitals.get(capital) ?? new Set<number>();
        bands.add(shown.band);
        wantedCapitals.set(capital, bands);
    }
    const storedCapitals = await database<{ place_public_id: string; bands: string }[]>`
        SELECT place_public_id::text, bands FROM territory_capital_band
    `;
    const capitalProblems: string[] = [];
    const storedCapitalMap = new Map(storedCapitals.map((row) => [row.place_public_id, row.bands]));
    for (const [placeId, bands] of wantedCapitals) {
        const want = [...bands].sort((a, b) => a - b).join("");
        if (storedCapitalMap.get(placeId) !== want) {
            capitalProblems.push(`${placeId}: Bänder ${String(storedCapitalMap.get(placeId))} statt ${want}`);
        }
    }
    for (const placeId of storedCapitalMap.keys()) {
        if (!wantedCapitals.has(placeId)) capitalProblems.push(`${placeId}: Hauptstadtzeiger ohne gezeigtes Gebiet`);
    }
    checks.push(
        check(
            "capital_bands",
            capitalProblems.length === 0,
            capitalProblems.length === 0
                ? `${String(storedCapitals.length)} Hauptstädte gezeigter Gebiete stimmen`
                : `${String(capitalProblems.length)} Abweichungen`,
            capitalProblems,
        ),
    );

    // ---- Befunde ----------------------------------------------------------------------------------------------
    const notShownByBand = new Map<number, { noBand: number; ownBand: number }>();
    for (const entry of result.notShown) {
        const row = notShownByBand.get(entry.band) ?? { noBand: 0, ownBand: 0 };
        if (entry.reason === "no_band") row.noBand += 1;
        else row.ownBand += 1;
        notShownByBand.set(entry.band, row);
    }
    findings.push(
        `Flächen, die ein Band nicht zeigt (Lücken im Zoombereich): ` +
            [...notShownByBand.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(
                    ([band, n]) =>
                        `Band ${String(band)}: ${String(n.noBand)} ohne Band, ${String(n.ownBand)} durch eigenes Band`,
                )
                .join("; "),
    );
    findings.push(
        `${String(result.notCurrent)} Flächen gelten im Jahr ${String(yearBf)} nicht (abgelaufen oder noch nicht begonnen)`,
    );
    const generic = nodes.filter((node) => isGenericGroupName(node.name)).length;
    findings.push(`${String(generic)} Sammelknoten („unabhängig“, „umstritten“, „ungeklärt“) im Baum`);
    const byId = new Map(nodes.map((node) => [node.id, node]));

    // Band 0 bis 6 gegen Legacys Werte (WI-0188 A5): Legacys 6 wird beim Import 8, die engste Spanne kann dabei kippen.
    const differences = legacyBandDifferences(inputs, yearBf, result.assignments);
    const areaById = new Map(inputs.areas.map((area) => [area.id, area.publicId]));
    const nameOf = (id: number | undefined): string =>
        id === undefined ? "nichts" : (byId.get(id)?.name ?? String(id));
    findings.push(
        differences.length === 0
            ? "Band 0 bis 6 zeigen jede Fläche wie mit Legacys Werten (WI-0188)"
            : `${String(differences.length)} Zuordnungen in Band 0 bis 6 weichen von Legacys Werten ab (WI-0188, Legacys 6 wird 8): ` +
                  differences
                      .slice(0, SAMPLE)
                      .map(
                          (entry) =>
                              `Fläche ${areaById.get(entry.areaId) ?? String(entry.areaId)} in Band ${String(entry.band)}: ` +
                              `${nameOf(entry.now)} statt ${nameOf(entry.legacy)}`,
                      )
                      .join("; "),
    );

    // Überlappungen zwischen gezeigten, nicht verwandten Gebieten (Legacy meldete 28 Paare, zwei über 1 E²).
    const overlaps = await database<{ band: number; a: number; b: number; overlap: number }[]>`
        SELECT a.band::int AS band, a.territory_id::int AS a, b.territory_id::int AS b,
               ST_Area(ST_Intersection(a.geom, b.geom)) AS overlap
        FROM territory_shape a
        JOIN territory_shape b ON b.band = a.band AND b.territory_id > a.territory_id AND ST_Intersects(a.geom, b.geom)
        JOIN territory t ON t.id = a.territory_id
        WHERE t.map_domain_id = ${mapDomainId} AND a.band = ${maxBand}
          AND ST_Area(ST_Intersection(a.geom, b.geom)) > 0.001
    `;
    const related = (left: number, right: number): boolean =>
        effectiveChain(left, byId, yearBf).some((node) => node.id === right) ||
        effectiveChain(right, byId, yearBf).some((node) => node.id === left);
    const unrelated = overlaps.filter((row) => !related(row.a, row.b));
    const over1 = unrelated.filter((row) => row.overlap > 1);
    findings.push(
        `Überlappungen im Band ${String(maxBand)}: ${String(unrelated.length)} Paare nicht verwandter Gebiete, ${String(over1.length)} über 1 E²`,
    );

    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    const settled = settleChecks("verify:territory-shapes", checks);
    return { passed: settled.passed, checks: settled.checks, findings };
}
