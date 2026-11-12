import {
    AVENTURIA,
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    legacyDisplayByBand,
    legacyYear,
    type OracleBand,
    type OracleInput,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import type { LegacyTerritoryPayload } from "../migration/territories.ts";
import { oracleInputFromExport } from "./legacy-oracle.ts";

/**
 * Nachweis je Band 0 bis 8 (WI-0209, Abnahmekriterium der Orchestrierung: „Hierarchie und die je Zoomband abgeleiteten
 * Flächen müssen nachweislich stimmen“): Legacys Anzeigeregel, unabhängig nachgebaut (`territory-display-rule.ts` in `packages/shared`), gegen das, was
 * unsere Ableitung gespeichert hat (`territory_display_area`, `territory_shape`).
 *
 * - **N1, aus dem Export** (`verifyLegacyBands`): Eingabe ist derselbe Gebietsexport, aus dem importiert wurde, mit Legacys
 *   Klemme auf 6. Zeigt, dass Import und Ableitung Legacys Karte treffen.
 * - **N2, aus der Datenbank** (`verifyOwnBands`): Eingabe sind unsere eigenen Tafeln (`territory`, `territory_area`), die Regel
 *   rechnet mit dem Band, das unsere Karte zeigt. Nach dem ersten Schreiben im Editor ist Legacy kein Maßstab mehr; dann zeigt
 *   N2, dass die Ableitung den gespeicherten Baum und die gespeicherten Spannen trifft.
 *
 * Nur lesend. Jede Abweichung steht mit Fläche, Gebiet und Grund im Bericht; der Prüfer hält nichts an (`AGENTS.md`
 * „Blockierende Prüfungen im Betrieb“). Bänder über dem obersten abgeleiteten Band zeigt die Karte wie dieses (Klemme im
 * Client, WI-0188); dort vergleicht er mit unserem obersten.
 */

export interface BandDifference {
    area: string;
    legacy: string | null;
    ours: string | null;
    why: string;
}

export interface BandParity {
    band: number;
    /** Welches unserer Bänder die Karte hier zeigt (über dem obersten abgeleiteten: das oberste). */
    oursFromBand: number;
    legacy: number;
    ours: number;
    same: number;
    differences: BandDifference[];
}

export interface HierarchyParity {
    territories: number;
    /** Gespeicherter Elter je Gebiet: unserer gegen den des Exports (nur N1; in N2 ist der gespeicherte die Quelle). */
    parentMismatches: string[];
    /** Wirksamer Elter und Tiefe je gezeigtem Gebiet und Band: unsere Formen gegen die Kette der Regel. */
    effectiveMismatches: string[];
    shapesChecked: number;
}

export interface LegacyBandsReport {
    /** Woher die Regel ihre Eingabe hat: der Export (N1) oder unsere Tafeln (N2). */
    quelle: "export" | "datenbank";
    yearBf: number;
    stamp: { export: string | null; imported: string | null };
    derivedMaxBand: number;
    bands: BandParity[];
    hierarchy: HierarchyParity;
    /** Flächen des Exports, die unser Import übersprungen hat (leere oder entartete Geometrie, ADR-0014 §6); nur N1. */
    skippedByImport: string[];
    /** Was bei uns liegt, aber nicht im Export steht (etwa im Editor angelegt): außerhalb des Vergleichs, nur gezählt; nur N1. */
    notInExport: { areas: number; territories: number };
    /** N2: Gebiete, deren Spanne über das oberste abgeleitete Band reicht; die Karte zeigt sie dort erst nach einer Ableitung bis dahin. */
    aboveDerived: number;
    passed: boolean;
}

interface Options {
    mapDomainId?: string;
    displayYearBf?: number;
    maxBand?: number;
}

/** N1: Legacys Regel aus dem Export gegen unsere Ableitung. */
export async function verifyLegacyBands(
    database: Database,
    payload: LegacyTerritoryPayload,
    options: Options = {},
): Promise<LegacyBandsReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const input = oracleInputFromExport(payload);
    const exportAreas = new Set(input.geometries.map((g) => g.publicId));
    const exportTerritories = new Set(input.territories.map((t) => t.publicId));
    const ourAreas = await ownAreaIds(database, mapDomainId);
    const report = await compare(database, input, mapDomainId, options, "export", {
        inScope: (area) => exportAreas.has(area),
        inScopeTerritory: (id) => exportTerritories.has(id),
        missing: (area) => !ourAreas.has(area),
    });

    const parents = await database<{ public_id: string; parent: string | null }[]>`
        SELECT t.public_id::text, p.public_id::text AS parent
        FROM territory t LEFT JOIN territory p ON p.id = t.parent_id
        WHERE t.map_domain_id = ${mapDomainId}
    `;
    const name = new Map(input.territories.map((t) => [t.publicId, t.name]));
    const label = (id: string | null): string => (id === null ? "–" : `${name.get(id) ?? "?"} (${id})`);
    const exportParent = new Map(input.territories.map((t) => [t.publicId, t.parentPublicId]));
    const parentMismatches = parents
        .filter((row) => exportTerritories.has(row.public_id))
        .filter((row) => (exportParent.get(row.public_id) ?? null) !== row.parent)
        .map(
            (row) =>
                `${label(row.public_id)}: bei uns ${label(row.parent)}, im Export ${label(exportParent.get(row.public_id) ?? null)}`,
        );
    const [state] = await database<{ source_stamp: string | null }[]>`
        SELECT source_stamp FROM territory_state WHERE map_domain_id = ${mapDomainId}
    `;
    report.stamp = { export: payload.territories_revision ?? null, imported: state?.source_stamp ?? null };
    report.hierarchy.parentMismatches = parentMismatches;
    report.hierarchy.territories = parents.filter((row) => exportTerritories.has(row.public_id)).length;
    report.skippedByImport = input.geometries
        .map((g) => g.publicId)
        .filter((id) => !ourAreas.has(id))
        .sort();
    report.notInExport = {
        areas: [...ourAreas].filter((id) => !exportAreas.has(id)).length,
        territories: parents.filter((row) => !exportTerritories.has(row.public_id)).length,
    };
    report.passed = report.passed && parentMismatches.length === 0;
    return report;
}

/** N2: dieselbe Regel auf unseren eigenen Tafeln gegen unsere Ableitung. */
export async function verifyOwnBands(database: Database, options: Options = {}): Promise<LegacyBandsReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const input = await oracleInputFromDatabase(database, mapDomainId);
    const report = await compare(database, input, mapDomainId, options, "datenbank", {
        inScope: () => true,
        inScopeTerritory: () => true,
        missing: () => false,
    });
    const [state] = await database<{ source_stamp: string | null }[]>`
        SELECT source_stamp FROM territory_state WHERE map_domain_id = ${mapDomainId}
    `;
    report.stamp = { export: null, imported: state?.source_stamp ?? null };
    report.hierarchy.territories = input.territories.length;
    report.aboveDerived = input.territories.filter((t) => (t.maxZoom ?? 0) > report.derivedMaxBand).length;
    return report;
}

/** Die Eingabe der Regel aus unseren Tafeln: aktive Gebiete und Flächen wie in `readDeriveInputs`, ohne Geometrie. */
export async function oracleInputFromDatabase(database: Database, mapDomainId: string): Promise<OracleInput> {
    const territories = await database<
        {
            publicId: string;
            name: string;
            shortName: string;
            parentPublicId: string | null;
            minZoom: number | null;
            maxZoom: number | null;
            validFromBf: number | null;
            validToBf: number | null;
        }[]
    >`
        SELECT t.public_id::text AS "publicId", t.name, coalesce(t.short_name, '') AS "shortName",
               p.public_id::text AS "parentPublicId", t.min_zoom AS "minZoom", t.max_zoom AS "maxZoom",
               t.valid_from_bf AS "validFromBf", t.valid_to_bf AS "validToBf"
        FROM territory t
        LEFT JOIN territory p ON p.id = t.parent_id
        WHERE t.map_domain_id = ${mapDomainId} AND t.is_active
        ORDER BY t.public_id
    `;
    const geometries = await database<
        {
            publicId: string;
            territoryPublicId: string;
            minZoom: number | null;
            maxZoom: number | null;
            validFromBf: number | null;
            validToBf: number | null;
        }[]
    >`
        SELECT a.public_id::text AS "publicId", t.public_id::text AS "territoryPublicId", a.min_zoom AS "minZoom",
               a.max_zoom AS "maxZoom", a.valid_from_bf AS "validFromBf", a.valid_to_bf AS "validToBf"
        FROM territory_area a
        JOIN territory t ON t.id = a.territory_id
        WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND t.is_active
        ORDER BY a.public_id
    `;
    return { territories: [...territories], geometries: [...geometries] };
}

async function ownAreaIds(database: Database, mapDomainId: string): Promise<Set<string>> {
    const areas = await database<{ public_id: string }[]>`
        SELECT a.public_id::text FROM territory_area a JOIN territory t ON t.id = a.territory_id WHERE t.map_domain_id = ${mapDomainId}
    `;
    return new Set(areas.map((row) => row.public_id));
}

/** Der gemeinsame Vergleich je Band und der wirksamen Eltern; die Eigenheiten der Quelle stecken in `scope`. */
async function compare(
    database: Database,
    input: OracleInput,
    mapDomainId: string,
    options: Options,
    quelle: "export" | "datenbank",
    scope: {
        inScope: (area: string) => boolean;
        inScopeTerritory: (territory: string) => boolean;
        missing: (area: string) => boolean;
    },
): Promise<LegacyBandsReport> {
    const yearBf = options.displayYearBf ?? AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf;
    const maxBand = options.maxBand ?? AVENTURIA_POLITICAL_CARTOGRAPHY.maxBand;
    const year = legacyYear(input, yearBf);
    const name = new Map(input.territories.map((t) => [t.publicId, t.name]));
    const label = (id: string | null): string => (id === null ? "–" : `${name.get(id) ?? "?"} (${id})`);

    const rows = await database<{ band: number; area: string; territory: string }[]>`
        SELECT da.band::int AS band, a.public_id::text AS area, t.public_id::text AS territory
        FROM territory_display_area da
        JOIN territory_area a ON a.id = da.area_id
        JOIN territory t ON t.id = da.territory_id
        WHERE t.map_domain_id = ${mapDomainId}
    `;
    const ours = new Map<number, OracleBand>();
    for (const row of rows) {
        if (!scope.inScope(row.area)) continue;
        const band = ours.get(row.band) ?? new Map<string, string>();
        band.set(row.area, row.territory);
        ours.set(row.band, band);
    }
    const derivedMaxBand = ours.size ? Math.max(...ours.keys()) : -1;
    // N1 rechnet mit Legacys Klemme auf 6; N2 mit dem Band, das unsere Karte zeigt (über dem obersten abgeleiteten: dieses).
    const legacy =
        quelle === "export"
            ? legacyDisplayByBand(input, yearBf, maxBand)
            : legacyDisplayByBand(input, yearBf, maxBand, (band) => Math.max(0, Math.min(band, derivedMaxBand)));

    const bands: BandParity[] = legacy.map((legacyBand, band) => {
        const oursFromBand = Math.min(band, derivedMaxBand);
        const ourBand = ours.get(oursFromBand) ?? new Map<string, string>();
        const differences: BandDifference[] = [];
        let same = 0;
        for (const area of new Set([...legacyBand.keys(), ...ourBand.keys()])) {
            const l = legacyBand.get(area) ?? null,
                o = ourBand.get(area) ?? null;
            if (l === o) {
                same += 1;
                continue;
            }
            const why = scope.missing(area)
                ? "vom Import übersprungen (ADR-0014 §6)"
                : l === null
                  ? "nur bei uns gezeigt"
                  : o === null
                    ? quelle === "export"
                        ? "nur in Legacy gezeigt"
                        : "nur in der Regel gezeigt"
                    : "anderes Anzeigegebiet";
            differences.push({ area, legacy: l === null ? null : label(l), ours: o === null ? null : label(o), why });
        }
        differences.sort((a, b) => a.area.localeCompare(b.area));
        return { band, oursFromBand, legacy: legacyBand.size, ours: ourBand.size, same, differences };
    });

    // Hierarchie: der wirksame Elter und die Tiefe je gezeigtem Gebiet.
    const shapes = await database<{ band: number; territory: string; parent: string | null; depth: number }[]>`
        SELECT s.band::int AS band, t.public_id::text AS territory, p.public_id::text AS parent, s.depth::int AS depth
        FROM territory_shape s
        JOIN territory t ON t.id = s.territory_id
        LEFT JOIN territory p ON p.id = s.parent_id
        WHERE t.map_domain_id = ${mapDomainId}
    `;
    const depthInChain = (id: string): number => {
        let depth = 0;
        const seen = new Set<string>([id]);
        for (let p = year.parents.get(id); p && !seen.has(p); p = year.parents.get(p)) {
            seen.add(p);
            depth += 1;
        }
        return depth;
    };
    const effectiveMismatches = shapes
        .filter((s) => scope.inScopeTerritory(s.territory))
        .filter((s) => (year.parents.get(s.territory) ?? null) !== s.parent || depthInChain(s.territory) !== s.depth)
        .map(
            (s) =>
                `Band ${String(s.band)} ${label(s.territory)}: Elter ${label(s.parent)} Tiefe ${String(s.depth)}, Regel ${label(year.parents.get(s.territory) ?? null)} Tiefe ${String(depthInChain(s.territory))}`,
        );

    const real = (b: BandParity): BandDifference[] => b.differences.filter((d) => !d.why.startsWith("vom Import"));
    return {
        quelle,
        yearBf,
        stamp: { export: null, imported: null },
        derivedMaxBand,
        bands,
        hierarchy: { territories: 0, parentMismatches: [], effectiveMismatches, shapesChecked: shapes.length },
        skippedByImport: [],
        notInExport: { areas: 0, territories: 0 },
        aboveDerived: 0,
        passed: bands.every((b) => real(b).length === 0) && effectiveMismatches.length === 0,
    };
}
