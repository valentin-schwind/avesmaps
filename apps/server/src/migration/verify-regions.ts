import { AVENTURIA } from "@avesmaps3d/shared";
import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import {
    MIGRATED_LAYERS,
    transformSources,
    type LegacyAreaPayload,
    type LegacyMapPayload,
    type LegacyRegionPayload,
} from "./regions.ts";

/**
 * Paritaet der Regionsdomaene (Kapitel 9.65 bis 9.69).
 *
 * Geprueft wird das AGGREGAT, nicht die drei Tabellen einzeln: dass jede Flaeche und jedes
 * gebundene Label genau eine existierende Region hat, dass die Faecherung je Region stimmt, und
 * dass die Geometrie Punkt fuer Punkt dieselbe ist. Eine Pruefung, die nur Zeilen zaehlt, findet
 * eine vertauschte Zuordnung nie.
 *
 * Jede Pruefung nennt ihr eigenes Urteil und die ersten Abweichler, weil eine Zahl allein nichts
 * ist, woran man arbeiten kann.
 */

export interface ParityCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

export interface RegionParityReport {
    passed: boolean;
    sourceRef: string;
    checks: ParityCheck[];
}

const SAMPLE = 5;

function check(name: string, passed: boolean, detail: string, offenders: string[] = []): ParityCheck {
    return offenders.length > 0
        ? { name, passed, detail, offenders: offenders.slice(0, SAMPLE) }
        : { name, passed, detail };
}

export async function verifyRegions(
    database: Database,
    regionPayload: LegacyRegionPayload,
    areaPayload: LegacyAreaPayload,
    labelPayload: LegacyMapPayload,
    options: { mapDomainId?: string } = {},
): Promise<RegionParityReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const expected = transformSources(regionPayload, areaPayload, labelPayload);
    const layers = MIGRATED_LAYERS as unknown as string[];
    const checks: ParityCheck[] = [];

    // Namentlich stillgelegte Regionen (Betreiberentscheidung). Sie stehen in der Quelle und im
    // Ziel, nur inaktiv - die Paritaet rechnet sie deshalb aus dem Aktivbestand heraus, statt sie
    // als fehlend zu melden.
    const retirementRows = await database<{ public_id: string }[]>`SELECT public_id::text FROM region_retirement`;
    const retired = new Set(retirementRows.map((row) => row.public_id));
    // Im Editor abgenommene Flächen (WI-0178 D2, Migration 0163; Claudio 2026-10-18, Bedingung A): Region, Teilflächen und Beschriftungen
    // sind still, und der Zug lässt sie so. Wie die namentlich stillgelegten gehören sie aus dem Erwartungswert, mit Zahl in der Meldung.
    const abgenommenRows = await database<{ public_id: string }[]>`
        SELECT public_id::text FROM region WHERE map_domain_id = ${mapDomainId} AND off_map
    `;
    const abgenommen = new Set(abgenommenRows.map((row) => row.public_id));
    const expectedActiveRegions = expected.regions.filter(
        (region) => !retired.has(region.publicId) && !abgenommen.has(region.publicId),
    ).length;
    const expectedAreas = expected.areas.filter((area) => !abgenommen.has(area.regionPublicId));
    const expectedLabelRows = expected.labels.filter((label) => !abgenommen.has(label.regionPublicId));

    // ---- Bestand ---------------------------------------------------------------------------
    const [counts] = await database<{ regions: number; areas: number; labels: number }[]>`
        SELECT
            (SELECT count(*)::int FROM region
              WHERE map_domain_id = ${mapDomainId} AND is_active AND region_layer = ANY(${layers})) AS regions,
            (SELECT count(*)::int FROM region_area a JOIN region r ON r.id = a.region_id
              WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND r.is_active AND r.region_layer = ANY(${layers})) AS areas,
            (SELECT count(*)::int FROM map_label
              WHERE map_domain_id = ${mapDomainId} AND is_active AND region_id IS NOT NULL) AS labels
    `;
    checks.push(
        check(
            "count_parity",
            counts?.regions === expectedActiveRegions &&
                counts?.areas === expectedAreas.length &&
                counts?.labels === expectedLabelRows.length,
            `Quelle ${expectedActiveRegions}/${expectedAreas.length}/${expectedLabelRows.length} ` +
                `(${String(retired.size)} namentlich stillgelegt, ${String(abgenommen.size)} vom Editor abgenommen), ` +
                `Ziel ${String(counts?.regions)}/${String(counts?.areas)}/${String(counts?.labels)} (Regionen/Flaechen/Labels)`,
        ),
    );

    // ---- Aggregat: jede Flaeche und jedes Label haengt an einer aktiven Region --------------
    const [orphans] = await database<{ areas: number; labels: number }[]>`
        SELECT
            (SELECT count(*)::int FROM region_area a
               LEFT JOIN region r ON r.id = a.region_id AND r.is_active
              WHERE a.is_active AND r.id IS NULL) AS areas,
            (SELECT count(*)::int FROM map_label l
               LEFT JOIN region r ON r.id = l.region_id AND r.is_active
              WHERE l.is_active AND l.region_id IS NOT NULL AND r.id IS NULL) AS labels
    `;
    checks.push(
        check(
            "region_integrity",
            orphans?.areas === 0 && orphans?.labels === 0,
            `verwaiste Flaechen ${String(orphans?.areas)}, verwaiste Labels ${String(orphans?.labels)}`,
        ),
    );

    // ---- Aggregat: Faecherung je Region ----------------------------------------------------
    const fanOut = await database<{ public_id: string; areas: number; labels: number }[]>`
        SELECT r.public_id::text,
               count(DISTINCT a.id)::int AS areas,
               count(DISTINCT l.id)::int AS labels
        FROM region r
        LEFT JOIN region_area a ON a.region_id = r.id AND a.is_active
        LEFT JOIN map_label l ON l.region_id = r.id AND l.is_active
        WHERE r.map_domain_id = ${mapDomainId} AND r.is_active AND r.region_layer = ANY(${layers})
        GROUP BY r.public_id
    `;
    const expectedAreaCounts = new Map<string, number>();
    for (const area of expectedAreas) {
        expectedAreaCounts.set(area.regionPublicId, (expectedAreaCounts.get(area.regionPublicId) ?? 0) + 1);
    }
    const expectedLabels = new Map<string, number>();
    for (const label of expectedLabelRows) {
        expectedLabels.set(label.regionPublicId, (expectedLabels.get(label.regionPublicId) ?? 0) + 1);
    }
    const fanOffenders: string[] = [];
    for (const row of fanOut) {
        const wantAreas = expectedAreaCounts.get(row.public_id) ?? 0;
        const wantLabels = expectedLabels.get(row.public_id) ?? 0;
        if (row.areas !== wantAreas || row.labels !== wantLabels) {
            fanOffenders.push(`${row.public_id}: Ziel ${row.areas}/${row.labels}, Quelle ${wantAreas}/${wantLabels}`);
        }
    }
    checks.push(
        check(
            "fan_out_parity",
            fanOffenders.length === 0,
            `${String(fanOut.length)} Regionen geprueft, ${String(fanOffenders.length)} mit abweichender Faecherung`,
            fanOffenders,
        ),
    );

    // ---- Geometrie: ST_Equals je Flaeche, dazu Typ und Vertexzahl --------------------------
    const geometryOffenders: string[] = [];
    let geometryChecked = 0;
    for (const area of expectedAreas) {
        const [row] = await database<{ equal: boolean; same_type: boolean; same_points: boolean }[]>`
            SELECT ST_Equals(a.geom, s.geom) AS equal,
                   GeometryType(a.geom) = GeometryType(s.geom) AS same_type,
                   ST_NPoints(a.geom) = ST_NPoints(s.geom) AS same_points
            FROM region_area a,
                 LATERAL (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(area.geometry)}), 0) AS geom) s
            WHERE a.public_id = ${area.publicId} AND a.is_active
        `;
        geometryChecked += 1;
        if (!row) {
            geometryOffenders.push(`${area.publicId}: fehlt im Ziel`);
        } else if (!row.equal || !row.same_type || !row.same_points) {
            geometryOffenders.push(
                `${area.publicId}: equals=${String(row.equal)} typ=${String(row.same_type)} punkte=${String(row.same_points)}`,
            );
        }
    }
    checks.push(
        check(
            "geometry_parity",
            geometryOffenders.length === 0,
            `${String(geometryChecked)} Flaechen mit ST_Equals geprueft, ${String(geometryOffenders.length)} abweichend`,
            geometryOffenders,
        ),
    );

    // ---- Gueltigkeit: Legacy DARF ungueltige Geometrien enthalten. Befund, keine Reparatur. -
    const invalid = await database<{ public_id: string; reason: string }[]>`
        SELECT public_id::text, ST_IsValidReason(geom) AS reason
        FROM region_area
        WHERE is_active AND NOT ST_IsValid(geom)
    `;
    checks.push(
        check(
            "geometry_validity",
            true,
            invalid.length === 0
                ? "alle Flaechen sind gueltig"
                : `${String(invalid.length)} ungueltige Geometrien - BERICHTET, nicht repariert`,
            invalid.map((row) => `${row.public_id}: ${row.reason}`),
        ),
    );

    // ---- Bounds als zweiter, unabhaengiger Weg auf dieselbe Geometrie ----------------------
    //
    // 🪤 Gerechnet wird ueber ST_Boundary, nicht ueber die Huellbox der Flaeche. PostGIS bildet die
    // Huellbox eines Polygons aus dem AUSSENRING allein - bei einer gueltigen Flaeche ist das
    // richtig, denn ein Loch liegt per Definition innen. Legacy rechnet naiv ueber alle
    // Koordinaten. Solange die Geometrie gueltig ist, kommt dasselbe heraus.
    //
    // Live gibt es genau eine Flaeche, bei der es das nicht tut: ihr Loch ragt aus der Flaeche
    // heraus ("Hole lies outside shell"), und Legacys Box sieht das Loch, PostGIS' Box nicht. Die
    // Geometrie selbst ist trotzdem exakt uebernommen - ST_Equals, Typ und Vertexzahl stimmen. Wer
    // hier die Huellbox vergleicht, meldet einen Migrationsfehler, wo ein Legacy-Datenfehler steht.
    const boundsOffenders: string[] = [];
    for (const raw of areaPayload.areas ?? []) {
        const bounds = (raw as { bounds?: Record<string, number> }).bounds;
        const publicId = String(raw.public_id ?? "");
        if (!bounds || !expected.areas.some((area) => area.publicId === publicId)) {
            continue;
        }
        const [row] = await database<{ ok: boolean }[]>`
            SELECT abs(ST_XMin(ST_Boundary(geom)) - ${bounds["min_x"] ?? 0}) < 0.0005
               AND abs(ST_YMin(ST_Boundary(geom)) - ${bounds["min_y"] ?? 0}) < 0.0005
               AND abs(ST_XMax(ST_Boundary(geom)) - ${bounds["max_x"] ?? 0}) < 0.0005
               AND abs(ST_YMax(ST_Boundary(geom)) - ${bounds["max_y"] ?? 0}) < 0.0005 AS ok
            FROM region_area WHERE public_id = ${publicId} AND is_active
        `;
        if (row && !row.ok) {
            boundsOffenders.push(publicId);
        }
    }
    checks.push(
        check(
            "bounds_cross_check",
            boundsOffenders.length === 0,
            `${String(boundsOffenders.length)} Flaechen weichen von der mitgelieferten Bounding Box ab`,
            boundsOffenders,
        ),
    );

    // ---- Ebene, Art, Stapelreihenfolge -----------------------------------------------------
    const attributeOffenders: string[] = [];
    const targetRegions = await database<
        {
            public_id: string;
            name: string;
            region_layer: string;
            region_type: string | null;
            stack_order: number;
            is_locked: boolean;
            wiki_url: string | null;
            label_curve_enabled: boolean | null;
            label_curve_max: number | null;
        }[]
    >`
        SELECT public_id::text, name, region_layer, region_type, stack_order, is_locked,
               wiki_url, label_curve_enabled, label_curve_max
        FROM region
        WHERE map_domain_id = ${mapDomainId} AND region_layer = ANY(${layers})
    `;
    const targetById = new Map(targetRegions.map((row) => [row.public_id, row]));
    for (const region of expected.regions) {
        const row = targetById.get(region.publicId);
        if (!row) {
            attributeOffenders.push(`${region.publicId}: fehlt im Ziel`);
            continue;
        }
        if (
            row.name !== region.name ||
            row.region_layer !== region.regionLayer ||
            (row.region_type ?? null) !== region.regionType ||
            Number(row.stack_order) !== region.stackOrder ||
            row.is_locked !== region.isLocked ||
            (row.wiki_url ?? null) !== region.wikiUrl ||
            row.label_curve_enabled !== region.curveEnabled ||
            (row.label_curve_max === null ? null : Number(row.label_curve_max)) !== region.curveMax
        ) {
            attributeOffenders.push(`${region.publicId} (${region.name})`);
        }
    }
    checks.push(
        check(
            "region_attribute_parity",
            attributeOffenders.length === 0,
            `${String(expected.regions.length)} Regionen feldweise geprueft, ${String(attributeOffenders.length)} abweichend`,
            attributeOffenders,
        ),
    );

    // ---- Primaerlabel: gesetzt wo aufloesbar, und immer derselben Region ---------------------
    const resolvablePointers = expected.regions.filter(
        (region) =>
            region.primaryLabelPublicId !== null &&
            !expected.danglingPrimaryLabels.some((dangling) => dangling.publicId === region.publicId) &&
            expected.labels.some(
                (label) => label.publicId === region.primaryLabelPublicId && label.regionPublicId === region.publicId,
            ),
    );
    const [primary] = await database<{ set: number; foreign: number; shared: number }[]>`
        SELECT
            (SELECT count(*)::int FROM region
              WHERE map_domain_id = ${mapDomainId} AND is_active AND region_layer = ANY(${layers})
                AND primary_label_id IS NOT NULL) AS set,
            (SELECT count(*)::int FROM region r JOIN map_label l ON l.id = r.primary_label_id
              WHERE r.is_active AND l.region_id IS DISTINCT FROM r.id) AS foreign,
            (SELECT count(*)::int FROM (
                SELECT primary_label_id FROM region
                 WHERE primary_label_id IS NOT NULL AND is_active
                 GROUP BY primary_label_id HAVING count(*) > 1) d) AS shared
    `;
    checks.push(
        check(
            "primary_label_parity",
            primary?.set === resolvablePointers.length,
            `aufloesbare Zeiger ${String(resolvablePointers.length)}, gesetzt ${String(primary?.set)} ` +
                `(${String(expected.danglingPrimaryLabels.length)} Zeiger gehen ins Leere - Bestand, nicht repariert)`,
        ),
    );
    checks.push(
        check(
            "primary_label_consistency",
            primary?.foreign === 0 && primary?.shared === 0,
            `fremde Region ${String(primary?.foreign)}, mehrfach vergeben ${String(primary?.shared)}`,
        ),
    );

    // ---- Was draussen bleiben muss ----------------------------------------------------------
    const [excluded] = await database<{ climate: number; free: number }[]>`
        SELECT
            (SELECT count(*)::int FROM region WHERE region_layer = 'klima') AS climate,
            (SELECT count(*)::int FROM map_label WHERE region_id IS NULL) AS free
    `;
    checks.push(
        check(
            "exclusions_respected",
            excluded?.climate === 0 && excluded?.free === 0,
            `Klimaregionen im Ziel ${String(excluded?.climate)} (erwartet 0, ${String(expected.skippedClimateRegions)} uebersprungen), ` +
                `freie Labels im Ziel ${String(excluded?.free)} (erwartet 0, ${String(expected.freeLabels)} uebersprungen)`,
        ),
    );

    // ---- Die namentliche Stilllegung ---------------------------------------------------------
    // Drei Aussagen, und die dritte ist die wichtigste: die Liste darf nicht zu einer Regel werden.
    const [retirement] = await database<{ present: number; still_active: number; with_parts: number }[]>`
        SELECT
            (SELECT count(*)::int FROM region r JOIN region_retirement t ON t.public_id = r.public_id) AS present,
            (SELECT count(*)::int FROM region r JOIN region_retirement t ON t.public_id = r.public_id
              WHERE r.is_active) AS still_active,
            (SELECT count(*)::int FROM region_retirement t JOIN region r ON r.public_id = t.public_id
              WHERE EXISTS (SELECT 1 FROM region_area a WHERE a.region_id = r.id AND a.is_active)
                 OR EXISTS (SELECT 1 FROM map_label l WHERE l.region_id = r.id AND l.is_active)) AS with_parts
    `;
    checks.push(
        check(
            "retirement_applied",
            retirement?.present === retired.size && retirement?.still_active === 0,
            `${String(retirement?.present)} von ${String(retired.size)} namentlich stillgelegten Regionen im Ziel, ` +
                `davon noch aktiv ${String(retirement?.still_active)}`,
        ),
    );
    checks.push(
        check(
            "retirement_has_no_active_parts",
            retirement?.with_parts === 0,
            retirement?.with_parts === 0
                ? "keine stillgelegte Region traegt aktive Flaechen oder Labels"
                : `${String(retirement?.with_parts)} stillgelegte Regionen tragen aktive Teile - Legacy hat ihnen etwas gegeben, das gehoert angesehen`,
        ),
    );
    // 💣 Keine Regel "Region ohne Flaeche ist inaktiv". Waere daraus eine geworden, staende hier
    // eine Zahl groesser null, und jede halbfertige Redaktionsarbeit waere stillgelegt.
    const [emptyButActive] = await database<{ count: number }[]>`
        SELECT count(*)::int FROM region r
        WHERE r.map_domain_id = ${mapDomainId} AND r.is_active AND r.region_layer = ANY(${layers})
          AND NOT EXISTS (SELECT 1 FROM region_area a WHERE a.region_id = r.id AND a.is_active)
    `;
    checks.push(
        check(
            "empty_regions_still_allowed",
            true,
            `${String(emptyButActive?.count)} aktive Regionen ohne Flaeche - erlaubt und beabsichtigt, ` +
                "die Stilllegung ist eine Liste und keine Regel",
        ),
    );

    // ---- Band je Label, gegen die transformierte Quelle (WI-0129) ----------------------------
    // Legacys Obergrenze 7 steht im Ziel als 8 (`upperBandFromLegacy`, dieselbe Umwandlung wie der Import), alles andere wie
    // geliefert. Geprueft wird jede Kennung, nicht eine Summe: eine gleiche Zahl ist kein Beweis. Meldet nur (Befund).
    const targetLabels = await database<{ public_id: string; min: number | null; max: number | null }[]>`
        SELECT public_id::text, label_min_zoom AS min, label_max_zoom AS max
        FROM map_label
        WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active AND region_id IS NOT NULL
    `;
    const targetBands = new Map(targetLabels.map((row) => [row.public_id, row]));
    const bandOffenders: string[] = [];
    const band = (min: number | null, max: number | null): string => `${String(min)}..${String(max)}`;
    for (const label of expected.labels) {
        const row = targetBands.get(label.publicId);
        if (!row) continue; // Fehlt das Label, sagt es schon count_parity.
        if (row.min !== label.minZoom || row.max !== label.maxZoom) {
            bandOffenders.push(
                `${label.publicId} (${label.name}): Band ${band(row.min, row.max)} statt ${band(label.minZoom, label.maxZoom)}`,
            );
        }
    }
    checks.push(
        check(
            "label_band_parity",
            bandOffenders.length === 0,
            `${String(expected.labels.length)} Labels je Kennung geprueft, ${String(bandOffenders.length)} mit anderem Band ` +
                `(Legacys 7 als Ziel 8: ${String(expected.labelUpperBandsFromLegacy)})`,
            bandOffenders,
        ),
    );

    // ---- Innerhalb der Domain ---------------------------------------------------------------
    const [outside] = await database<{ areas: number; labels: number }[]>`
        SELECT
            (SELECT count(*)::int FROM region_area
              WHERE is_active AND NOT map_domain_contains(map_domain_id, geom)) AS areas,
            (SELECT count(*)::int FROM map_label
              WHERE is_active AND NOT map_domain_contains(map_domain_id, geom)) AS labels
    `;
    checks.push(
        check(
            "inside_domain",
            outside?.areas === 0 && outside?.labels === 0,
            `ausserhalb der Domain: Flaechen ${String(outside?.areas)}, Labels ${String(outside?.labels)}`,
        ),
    );

    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    const settled = settleChecks("verify:regions", checks);
    return {
        passed: settled.passed,
        sourceRef: `ecosystem_revision=${String(areaPayload.revision)};map_revision=${String(labelPayload.revision)}`,
        checks: settled.checks,
    };
}
