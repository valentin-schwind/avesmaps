import { AVENTURIA } from "@avesmaps3d/shared";
import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import { transformLocations, type ImportScope, type LegacyPayload } from "./places.ts";

/**
 * Parity between the legacy source and the migrated places (chapter 9.65 to 9.69).
 *
 * Semantics, not row counts: identity, class, coordinate and completeness are each checked
 * separately, so a failure names what differs instead of only that something does. Every check
 * reports its own verdict and the first few offenders, because a number alone cannot be acted on.
 */

export interface ParityCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

export interface ParityReport {
    passed: boolean;
    sourceRef: string;
    checks: ParityCheck[];
}

interface TargetRow {
    public_id: string;
    name: string;
    subtype: string;
    x: number;
    y: number;
    is_hidden: boolean;
    is_ruined: boolean;
    is_nodix: boolean;
    is_seaport: boolean;
    place_kind: string | null;
}

const SAMPLE = 5;

export async function verifyPlaces(
    database: Database,
    payload: LegacyPayload,
    scope: ImportScope,
    options: { mapDomainId?: string } = {},
): Promise<ParityReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const expected = transformLocations(payload, scope).places;

    const rows = await database<TargetRow[]>`
        SELECT public_id::text, name, subtype, ST_X(geom) AS x, ST_Y(geom) AS y,
               is_hidden, is_ruined, is_nodix, is_seaport, place_kind
        FROM place
        WHERE map_domain_id = ${mapDomainId}
          AND source_system = 'legacy'
          AND is_active
          AND subtype = ANY(${scope.subtypes as unknown as string[]})
          AND ST_Within(
                geom,
                ST_MakeEnvelope(
                    ${scope.bounds.minX}, ${scope.bounds.minY},
                    ${scope.bounds.maxX}, ${scope.bounds.maxY}, 0
                )
              )
    `;

    const checks: ParityCheck[] = [];
    const byId = new Map(rows.map((row) => [row.public_id, row]));

    checks.push({
        name: "count",
        passed: rows.length === expected.length,
        detail: `Quelle ${expected.length}, Ziel ${rows.length}`,
    });

    checks.push({
        name: "identity-unique",
        passed: byId.size === rows.length,
        detail: `${rows.length} Zeilen, ${byId.size} verschiedene public_id`,
    });

    const missing = expected.filter((place) => !byId.has(place.publicId));
    checks.push({
        name: "identity-complete",
        passed: missing.length === 0,
        detail: `${missing.length} Orte der Quelle fehlen im Ziel`,
        offenders: missing.slice(0, SAMPLE).map((place) => `${place.name} (${place.publicId})`),
    });

    const expectedIds = new Set(expected.map((place) => place.publicId));
    const extra = rows.filter((row) => !expectedIds.has(row.public_id));
    checks.push({
        name: "no-strays",
        passed: extra.length === 0,
        detail: `${extra.length} aktive Zielzeilen ohne Entsprechung in der Quelle`,
        offenders: extra.slice(0, SAMPLE).map((row) => `${row.name} (${row.public_id})`),
    });

    // Exact, not "close": a coordinate that moved during the migration is a defect, not a rounding.
    const moved: string[] = [];
    const renamed: string[] = [];
    const reclassified: string[] = [];
    for (const place of expected) {
        const row = byId.get(place.publicId);
        if (!row) {
            continue;
        }
        if (Number(row.x) !== place.x || Number(row.y) !== place.y) {
            moved.push(`${place.name}: ${place.x}/${place.y} -> ${row.x}/${row.y}`);
        }
        if (row.name !== place.name) {
            renamed.push(`${place.publicId}: "${place.name}" -> "${row.name}"`);
        }
        if (row.subtype !== place.subtype) {
            reclassified.push(`${place.name}: ${place.subtype} -> ${row.subtype}`);
        }
    }
    checks.push({
        name: "coordinates-exact",
        passed: moved.length === 0,
        detail: `${moved.length} Orte mit abweichender Koordinate`,
        offenders: moved.slice(0, SAMPLE),
    });
    checks.push({
        name: "names",
        passed: renamed.length === 0,
        detail: `${renamed.length} Orte mit abweichendem Namen`,
        offenders: renamed.slice(0, SAMPLE),
    });
    checks.push({
        name: "subtypes",
        passed: reclassified.length === 0,
        detail: `${reclassified.length} Orte mit abweichender Ortsklasse`,
        offenders: reclassified.slice(0, SAMPLE),
    });

    const countBy = (values: string[]): Map<string, number> => {
        const counts = new Map<string, number>();
        for (const value of values) {
            counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return counts;
    };
    const sourceDistribution = countBy(expected.map((place) => place.subtype));
    const targetDistribution = countBy(rows.map((row) => row.subtype));
    const distributionDifferences: string[] = [];
    for (const subtype of new Set([...sourceDistribution.keys(), ...targetDistribution.keys()])) {
        const source = sourceDistribution.get(subtype) ?? 0;
        const target = targetDistribution.get(subtype) ?? 0;
        if (source !== target) {
            distributionDifferences.push(`${subtype}: Quelle ${source}, Ziel ${target}`);
        }
    }
    checks.push({
        name: "distribution",
        passed: distributionDifferences.length === 0,
        detail:
            distributionDifferences.length === 0
                ? [...sourceDistribution.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([subtype, count]) => `${subtype} ${count}`)
                      .join(", ")
                : `${distributionDifferences.length} Klassen weichen ab`,
        offenders: distributionDifferences.slice(0, SAMPLE),
    });

    // The flags are compared the way legacy means them: a missing key is false, not "unknown",
    // so a place without the key must be false in the target, never left as it was.
    const flagDifferences: string[] = [];
    const kindDifferences: string[] = [];
    for (const place of expected) {
        const row = byId.get(place.publicId);
        if (!row) {
            continue;
        }
        if (
            row.is_hidden !== place.isHidden ||
            row.is_ruined !== place.isRuined ||
            row.is_nodix !== place.isNodix ||
            row.is_seaport !== place.isSeaport
        ) {
            flagDifferences.push(
                `${place.name}: Quelle h=${place.isHidden} r=${place.isRuined} n=${place.isNodix} s=${place.isSeaport}, ` +
                    `Ziel h=${row.is_hidden} r=${row.is_ruined} n=${row.is_nodix} s=${row.is_seaport}`,
            );
        }
        if ((row.place_kind ?? null) !== place.placeKind) {
            kindDifferences.push(`${place.name}: "${place.placeKind ?? ""}" -> "${row.place_kind ?? ""}"`);
        }
    }
    checks.push({
        name: "flags",
        passed: flagDifferences.length === 0,
        detail: `${flagDifferences.length} Orte mit abweichenden Merkmalen`,
        offenders: flagDifferences.slice(0, SAMPLE),
    });
    checks.push({
        name: "place-kind",
        passed: kindDifferences.length === 0,
        detail: `${kindDifferences.length} Orte mit abweichender Ortsart`,
        offenders: kindDifferences.slice(0, SAMPLE),
    });

    // A number that stands out when the source changes: 30 hidden places on 2026-09-20.
    const hiddenSource = expected.filter((place) => place.isHidden).length;
    const hiddenTarget = rows.filter((row) => row.is_hidden).length;
    checks.push({
        name: "hidden-count",
        passed: hiddenSource === hiddenTarget,
        detail: `Quelle ${hiddenSource} verborgen, Ziel ${hiddenTarget}`,
    });

    const [outside] = await database<{ total: number }[]>`
        SELECT count(*)::int AS total FROM place
        WHERE map_domain_id = ${mapDomainId}
          AND NOT map_domain_contains(${mapDomainId}, geom)
    `;
    checks.push({
        name: "inside-domain",
        passed: (outside?.total ?? 0) === 0,
        detail: `${outside?.total ?? 0} Zeilen ausserhalb der Domain`,
    });

    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    const settled = settleChecks("verify:places", checks);
    return {
        passed: settled.passed,
        sourceRef: `map_revision=${String(payload.map_revision ?? "unknown")}`,
        checks: settled.checks,
    };
}
