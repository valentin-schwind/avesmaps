import { randomUUID } from "node:crypto";
import { AVENTURIA } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { createFinding, type Finding } from "../findings.ts";
import { retireFinding } from "./retire-findings.ts";
import {
    assertSourcesComplete,
    CONTRACT_VERSION,
    MIGRATED_LAYERS,
    transformSources,
    type LegacyAreaPayload,
    type LegacyMapPayload,
    type LegacyRegionPayload,
    type TransformedLabel,
    type TransformedRegion,
    type TransformResult,
} from "./regions.ts";
import { withZugSperre } from "../derive/derive-lock.ts";

/**
 * Schreibt das Regionsaggregat idempotent in die Zieldatenbank.
 *
 * Vier Phasen, eine Transaktion. Die Phasen sind eine Vorsichtsmassnahme beim Schreiben, keine
 * Domaengrenze: ein Abbruch in P3 laesst auch P1 nicht stehen, und der Lauf gilt erst als
 * erfolgreich, wenn die Paritaetspruefung ueber das ganze Aggregat gruen ist.
 */

export interface ImportRegionsOptions {
    mapDomainId?: string;
    /**
     * Probelauf (WI-0129): rechnet und schreibt in EINER Transaktion, nennt jede Änderung und rollt dann alles zurück, auch
     * das Journal (`migration_run`). Der Bericht ist derselbe wie beim Schreiblauf.
     */
    dryRun?: boolean;
}

/** Eine geänderte Spalte eines Labels: so, dass ein Mensch sie vor dem Schreiben prüfen kann. */
export interface LabelChange {
    publicId: string;
    name: string;
    field: string;
    before: unknown;
    after: unknown;
}

export interface PhaseReport {
    created: number;
    updated: number;
    unchanged: number;
    retired: number;
}

export interface ImportRegionsReport {
    runId: string;
    sourceRef: string;
    regions: PhaseReport;
    areas: PhaseReport;
    labels: PhaseReport;
    /** Zeiger, die nicht mehr stimmen und geleert wurden. */
    primaryLabelsCleared: number;
    /** Zeiger, die neu oder anders gesetzt wurden. Beim zweiten Lauf null. */
    primaryLabelsChanged: number;
    /** Wieviele Regionen danach ein primaeres Label fuehren. */
    primaryLabelsActive: number;
    /** Namentlich stillgelegte Regionen (Betreiberentscheidung), inaktiv importiert. */
    retiredByDecision: number;
    skippedClimateRegions: number;
    skippedClimateAreas: number;
    freeLabels: number;
    danglingPrimaryLabels: { publicId: string; name: string; pointer: string }[];
    /** Primaerlabel ueber den Rueckwaertszeiger eines einzelnen Labels aufgeloest, siehe regions.ts. */
    primaryLabelFromReverse: { publicId: string; name: string; labelPublicId: string }[];
    rejected: { publicId: string; reason: string }[];
    /** Was der Lauf meldet, ohne anzuhalten (Betreiber 2026-10-03): etwa die Stilllegequote. */
    findings: Finding[];
    /** Gezählte Legacy-Maxima 7, die als Ziel 8 geschrieben werden (WI-0129); je Lauf über dieselbe Quelle gleich. */
    labelUpperBandsFromLegacy: number;
    /** Jede geänderte Spalte eines Legacy-Labels, vorher gegen nachher (WI-0129: der Halt im Probelauf liest diese Liste). */
    labelChanges: LabelChange[];
    /** Wahr, wenn nichts geschrieben wurde. */
    dryRun: boolean;
}

/** Die Spalten eines Labels, die der Import schreibt; die Liste der Änderungen vergleicht genau diese. */
const LABEL_FIELDS = [
    "region_id",
    "name",
    "subtype",
    "geom",
    "label_min_zoom",
    "label_max_zoom",
    "label_size",
    "label_priority",
    "rotation",
    "show_name",
    "is_nodix",
    "legacy_revision",
    "is_active",
    "placement",
    "curve_count",
    "sort_order",
    "text_follows_name",
] as const;

type LabelState = Record<(typeof LABEL_FIELDS)[number] | "public_id", unknown>;

/** Wie eine Beschriftung an ihrer Landschaft steht (WI-0178 B1, Migration 0137; EDIT-0004 §4 Nr. 2). */
export interface LabelLayout {
    placement: "punkt" | "entlang";
    /** 1 bis 3, nur bei `entlang`. */
    curveCount: number | null;
    sortOrder: number;
    textFollowsName: boolean;
}

/**
 * Legacys Regionswerte je Beschriftung (EDIT-0004 §4 Nr. 2): Legacy führt Kurve und Anzahl an der Region, Avesmaps3D je Beschriftung.
 * Ist die Region eine Kurvenregion (`curve_label`), steht ihre Hauptbeschriftung (der Zeiger der Region) `entlang` mit Legacys Anzahl,
 * jede andere `punkt`; sie bleiben unsichtbar, weil der Schriftlauf je Region gilt, genau wie in Legacy. Sonst steht jede `punkt`.
 * Die Reihenfolge: die Hauptbeschriftung zuerst, dann nach Kennung (gleich bei jedem Lauf über dieselbe Quelle). Der Text folgt dem
 * Namen, solange er ihm gleicht; ein abweichender Text aus Legacy (`ecosystem.php:4200-4203`) bleibt.
 *
 * Geht der Zeiger einer Kurvenregion ins Leere, steht keine Beschriftung `entlang`; das Umstellen (M2, D5) prüft genau diese Fälle.
 */
export function labelLayouts(
    regions: readonly TransformedRegion[],
    labels: readonly TransformedLabel[],
): Map<string, LabelLayout> {
    const regionen = new Map(regions.map((region) => [region.publicId, region]));
    const jeRegion = new Map<string, TransformedLabel[]>();
    for (const label of labels) {
        const liste = jeRegion.get(label.regionPublicId) ?? [];
        liste.push(label);
        jeRegion.set(label.regionPublicId, liste);
    }
    const layouts = new Map<string, LabelLayout>();
    for (const [regionPublicId, eigene] of jeRegion) {
        const region = regionen.get(regionPublicId);
        const haupt = region?.primaryLabelPublicId ?? null;
        const rang = (label: TransformedLabel): string => `${label.publicId === haupt ? "0" : "1"}${label.publicId}`;
        const geordnet = [...eigene].sort((a, b) => (rang(a) < rang(b) ? -1 : rang(a) > rang(b) ? 1 : 0));
        geordnet.forEach((label, index) => {
            const entlang = region?.curveEnabled === true && label.publicId === haupt;
            layouts.set(label.publicId, {
                placement: entlang ? "entlang" : "punkt",
                curveCount: entlang ? (region?.curveMax ?? 1) : null,
                sortOrder: index,
                textFollowsName: region === undefined || label.name === region.name,
            });
        });
    }
    return layouts;
}

class DryRunRollback extends Error {}

function emptyPhase(): PhaseReport {
    return { created: 0, updated: 0, unchanged: 0, retired: 0 };
}

function countRow(phase: PhaseReport, rows: { inserted: boolean }[]): void {
    if (rows.length === 0) {
        phase.unchanged += 1;
    } else if (rows[0]?.inserted) {
        phase.created += 1;
    } else {
        phase.updated += 1;
    }
}

export function importRegions(
    database: Database,
    regionPayload: LegacyRegionPayload,
    areaPayload: LegacyAreaPayload,
    labelPayload: LegacyMapPayload,
    options: ImportRegionsOptions = {},
): Promise<ImportRegionsReport> {
    return withZugSperre(database, options.mapDomainId ?? AVENTURIA.mapDomain, "I2 Regionen", () =>
        importRegionsLocked(database, regionPayload, areaPayload, labelPayload, options),
    );
}

/** Der Körper von `importRegions`, unter der Sperre des Zugs. */
async function importRegionsLocked(
    database: Database,
    regionPayload: LegacyRegionPayload,
    areaPayload: LegacyAreaPayload,
    labelPayload: LegacyMapPayload,
    options: ImportRegionsOptions = {},
): Promise<ImportRegionsReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    assertSourcesComplete(regionPayload, areaPayload, labelPayload);

    const transformed: TransformResult = transformSources(regionPayload, areaPayload, labelPayload);
    const sourceRef = `ecosystem_revision=${String(areaPayload.revision)};map_revision=${String(labelPayload.revision)}`;
    const runId = randomUUID();

    const report: ImportRegionsReport = {
        runId,
        sourceRef,
        regions: emptyPhase(),
        areas: emptyPhase(),
        labels: emptyPhase(),
        primaryLabelsCleared: 0,
        primaryLabelsChanged: 0,
        primaryLabelsActive: 0,
        retiredByDecision: 0,
        skippedClimateRegions: transformed.skippedClimateRegions,
        skippedClimateAreas: transformed.skippedClimateAreas,
        freeLabels: transformed.freeLabels,
        danglingPrimaryLabels: transformed.danglingPrimaryLabels,
        primaryLabelFromReverse: transformed.primaryLabelFromReverse,
        rejected: transformed.rejected,
        findings: [],
        labelUpperBandsFromLegacy: transformed.labelUpperBandsFromLegacy,
        labelChanges: [],
        dryRun: options.dryRun === true,
    };

    if (transformed.labelBandsAboveLegacyMax.length > 0) {
        const above = transformed.labelBandsAboveLegacyMax;
        report.findings.push(
            createFinding(
                "legacy_band_max_changed",
                `${String(above.length)} Legacy-Labels tragen ein Maximum über 7. Legacy hat seine Obergrenze angehoben; ` +
                    "seine 7 ist dann nicht mehr terminal und die Regel 7 → 8 gehört neu entschieden (WI-0129 S11).",
                { labels: above.length, legacy_max_band: 7 },
                above.map((label) => ({ table: "map_label", publicId: label.publicId, name: label.name })),
                above.length,
                above
                    .slice(0, 20)
                    .map((label) => `${label.name} (${label.publicId}): max_zoom ${String(label.maxZoom)}`),
            ),
        );
    }

    try {
        await database.begin(async (transaction) => {
            const labelState = async (): Promise<Map<string, LabelState>> => {
                const rows = await transaction<LabelState[]>`
                SELECT public_id::text, region_id::text, name, subtype, ST_AsEWKT(geom) AS geom,
                       label_min_zoom, label_max_zoom, label_size::text, label_priority, rotation::text,
                       show_name, is_nodix, legacy_revision::text, is_active,
                       placement, curve_count, sort_order, text_follows_name
                FROM map_label
                WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND region_id IS NOT NULL
            `;
                return new Map(rows.map((row) => [String(row.public_id), row]));
            };
            const labelsBefore = await labelState();

            // Namentlich stillgelegte Regionen (Betreiberentscheidung 2026-09-20). Sie werden importiert
            // wie jede andere - Identitaet und Herkunft bleiben -, aber inaktiv. Der Wert geht in den
            // Upsert statt in einen Nachlauf, sonst schaltete ihn jeder Lauf erst ein und gleich wieder
            // aus, und "der zweite Lauf tut nichts" waere nicht mehr wahr.
            //
            // 💣 Eine Liste, keine Regel: Regionen ohne Flaeche bleiben ausdruecklich erlaubt.
            const retirementRows = await transaction<{ public_id: string }[]>`
            SELECT public_id::text FROM region_retirement
        `;
            const retired = new Set(retirementRows.map((row) => row.public_id));
            report.retiredByDecision = transformed.regions.filter((region) => retired.has(region.publicId)).length;

            const regionIds = transformed.regions.map((region) => region.publicId);
            const areaIds = transformed.areas.map((area) => area.publicId);
            const labelIds = transformed.labels.map((label) => label.publicId);

            const [regionPressure] = await transaction<{ active: number; retiring: number }[]>`
            SELECT count(*)::int AS active,
                   count(*) FILTER (WHERE public_id <> ALL(${regionIds}::uuid[]))::int AS retiring
            FROM region
            WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
              AND region_layer = ANY(${MIGRATED_LAYERS as unknown as string[]})
        `;
            // Über MAX_RETIRE_FRACTION ist das ein Befund mit Namen, kein Abbruch (Betreiber 2026-10-03).
            const regionQuota = await retireFinding("region", regionPressure, async () => {
                const rows = await transaction<{ public_id: string; name: string }[]>`
                SELECT public_id::text, name
                FROM region
                WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
                  AND region_layer = ANY(${MIGRATED_LAYERS as unknown as string[]})
                  AND public_id <> ALL(${regionIds}::uuid[])
                ORDER BY name, public_id
            `;
                return rows.map((row) => ({ table: "region", publicId: row.public_id, name: row.name }));
            });
            if (regionQuota) report.findings.push(regionQuota);

            await transaction`
            INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
            VALUES (${runId}, 'regions', 'avesmaps-legacy', ${sourceRef}, ${CONTRACT_VERSION})
        `;

            // ---- P1: Regionen ------------------------------------------------------------------
            // 🔴 Eine Zuweisung des Wiki-Artikels von Hand bleibt (WI-0253 §25): Hat ein Editor oder der WikiSync einer Region ihren Artikel zugewiesen (Wiki-Box, Fenster
            // „Regelvorschläge“), steht in der Tafel X2 (Art `landschaft`) eine AKTIVE Zeile, die nicht aus Legacy stammt. Dann lässt der Zug `wiki_url` und `wiki_region_key` dieser Region
            // stehen, statt sie mit Legacys Werten (meist leer) zu überschreiben. Der X2-Import (I24) legt solche Zeilen nie still (`protectedWhere`).
            const handGesetzt = transaction`EXISTS (
                SELECT 1 FROM wiki_key_assignment x
                 WHERE x.legacy_art = 'landschaft' AND x.object_public_id = region.public_id AND x.is_active AND x.source_system <> 'legacy'
            )`;
            for (const region of transformed.regions) {
                const rows = await transaction<{ inserted: boolean }[]>`
                INSERT INTO region (
                    public_id, map_domain_id, name, region_layer, region_type, stack_order, is_locked,
                    wiki_url, wiki_region_key, label_curve_enabled, label_curve_max,
                    source_system, legacy_public_id, migration_run_id, imported_at, is_active
                ) VALUES (
                    ${region.publicId}, ${mapDomainId}, ${region.name}, ${region.regionLayer},
                    ${region.regionType}, ${region.stackOrder}, ${region.isLocked},
                    ${region.wikiUrl}, ${region.wikiRegionKey}, ${region.curveEnabled}, ${region.curveMax},
                    'legacy', ${region.publicId}, ${runId}, now(), ${!retired.has(region.publicId)}
                )
                ON CONFLICT (public_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    region_layer = EXCLUDED.region_layer,
                    region_type = EXCLUDED.region_type,
                    stack_order = EXCLUDED.stack_order,
                    is_locked = EXCLUDED.is_locked,
                    wiki_url = CASE WHEN ${handGesetzt} THEN region.wiki_url ELSE EXCLUDED.wiki_url END,
                    wiki_region_key = CASE WHEN ${handGesetzt} THEN region.wiki_region_key ELSE EXCLUDED.wiki_region_key END,
                    label_curve_enabled = EXCLUDED.label_curve_enabled,
                    label_curve_max = EXCLUDED.label_curve_max,
                    migration_run_id = EXCLUDED.migration_run_id,
                    imported_at = EXCLUDED.imported_at,
                    -- Eine im Editor abgenommene Fläche bleibt still (WI-0178 D2, Migration 0163; wie Wege und Kraftlinien). off_map
                    -- schreibt der Zug nie; eine ganz gelöschte (off_map FALSE) holt er bis zum Cutoff zurück.
                    is_active = EXCLUDED.is_active AND NOT region.off_map,
                    updated_at = now()
                WHERE region.name IS DISTINCT FROM EXCLUDED.name
                   OR region.region_layer IS DISTINCT FROM EXCLUDED.region_layer
                   OR region.region_type IS DISTINCT FROM EXCLUDED.region_type
                   OR region.stack_order IS DISTINCT FROM EXCLUDED.stack_order
                   OR region.is_locked IS DISTINCT FROM EXCLUDED.is_locked
                   OR (NOT ${handGesetzt} AND region.wiki_url IS DISTINCT FROM EXCLUDED.wiki_url)
                   OR (NOT ${handGesetzt} AND region.wiki_region_key IS DISTINCT FROM EXCLUDED.wiki_region_key)
                   OR region.label_curve_enabled IS DISTINCT FROM EXCLUDED.label_curve_enabled
                   OR region.label_curve_max IS DISTINCT FROM EXCLUDED.label_curve_max
                   OR region.is_active IS DISTINCT FROM (EXCLUDED.is_active AND NOT region.off_map)
                RETURNING (xmax = 0) AS inserted
            `;
                countRow(report.regions, rows);
            }

            // ---- P2: Flaechen ------------------------------------------------------------------
            for (const area of transformed.areas) {
                const rows = await transaction<{ inserted: boolean }[]>`
                INSERT INTO region_area (
                    public_id, region_id, map_domain_id, geom, geometry_revision,
                    affects_paths,
                    source_system, legacy_public_id, migration_run_id, imported_at, is_active
                )
                SELECT
                    ${area.publicId}, r.id, ${mapDomainId},
                    ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(area.geometry)}), 0),
                    ${area.geometryRevision}, ${area.affectsPaths},
                    -- Die Teile einer abgenommenen Fläche bleiben still (D2; Claudio 2026-10-18, auch in der Abweichungsbedingung).
                    'legacy', ${area.publicId}, ${runId}, now(), NOT r.off_map
                FROM region r
                WHERE r.public_id = ${area.regionPublicId}
                ON CONFLICT (public_id) DO UPDATE SET
                    region_id = EXCLUDED.region_id,
                    geom = EXCLUDED.geom,
                    geometry_revision = EXCLUDED.geometry_revision,
                    affects_paths = EXCLUDED.affects_paths,
                    migration_run_id = EXCLUDED.migration_run_id,
                    imported_at = EXCLUDED.imported_at,
                    is_active = EXCLUDED.is_active,
                    updated_at = now()
                WHERE region_area.region_id IS DISTINCT FROM EXCLUDED.region_id
                   OR region_area.geom IS DISTINCT FROM EXCLUDED.geom
                   OR region_area.geometry_revision IS DISTINCT FROM EXCLUDED.geometry_revision
                   OR region_area.affects_paths IS DISTINCT FROM EXCLUDED.affects_paths
                   OR region_area.is_active IS DISTINCT FROM EXCLUDED.is_active
                RETURNING (xmax = 0) AS inserted
            `;
                countRow(report.areas, rows);
            }

            // ---- P3: gebundene Labels ----------------------------------------------------------
            // Lage, Anzahl, Reihenfolge und Text je Beschriftung (WI-0178 B1, Migration 0137) aus Legacys Regionswerten.
            const layouts = labelLayouts(transformed.regions, transformed.labels);
            for (const label of transformed.labels) {
                const layout = layouts.get(label.publicId)!;
                const rows = await transaction<{ inserted: boolean }[]>`
                INSERT INTO map_label (
                    public_id, map_domain_id, region_id, name, subtype, geom,
                    label_min_zoom, label_max_zoom, label_size, label_priority, rotation,
                    show_name, is_nodix, placement, curve_count, sort_order, text_follows_name,
                    source_system, legacy_public_id, legacy_revision, migration_run_id, imported_at, is_active
                )
                SELECT
                    ${label.publicId}, ${mapDomainId}, r.id, ${label.name}, ${label.subtype},
                    ST_SetSRID(ST_MakePoint(${label.x}, ${label.y}), 0),
                    ${label.minZoom}, ${label.maxZoom}, ${label.size}, ${label.priority}, ${label.rotation},
                    ${label.showName}, ${label.isNodix}, ${layout.placement}, ${layout.curveCount}, ${layout.sortOrder},
                    ${layout.textFollowsName},
                    'legacy', ${label.publicId}, ${label.legacyRevision}, ${runId}, now(), NOT r.off_map
                FROM region r
                WHERE r.public_id = ${label.regionPublicId}
                ON CONFLICT (public_id) DO UPDATE SET
                    region_id = EXCLUDED.region_id,
                    name = EXCLUDED.name,
                    subtype = EXCLUDED.subtype,
                    geom = EXCLUDED.geom,
                    label_min_zoom = EXCLUDED.label_min_zoom,
                    label_max_zoom = EXCLUDED.label_max_zoom,
                    label_size = EXCLUDED.label_size,
                    label_priority = EXCLUDED.label_priority,
                    rotation = EXCLUDED.rotation,
                    show_name = EXCLUDED.show_name,
                    is_nodix = EXCLUDED.is_nodix,
                    placement = EXCLUDED.placement,
                    curve_count = EXCLUDED.curve_count,
                    sort_order = EXCLUDED.sort_order,
                    text_follows_name = EXCLUDED.text_follows_name,
                    legacy_revision = EXCLUDED.legacy_revision,
                    migration_run_id = EXCLUDED.migration_run_id,
                    imported_at = EXCLUDED.imported_at,
                    is_active = EXCLUDED.is_active,
                    updated_at = now()
                WHERE map_label.region_id IS DISTINCT FROM EXCLUDED.region_id
                   OR map_label.name IS DISTINCT FROM EXCLUDED.name
                   OR map_label.subtype IS DISTINCT FROM EXCLUDED.subtype
                   OR map_label.geom IS DISTINCT FROM EXCLUDED.geom
                   OR map_label.label_min_zoom IS DISTINCT FROM EXCLUDED.label_min_zoom
                   OR map_label.label_max_zoom IS DISTINCT FROM EXCLUDED.label_max_zoom
                   OR map_label.label_size IS DISTINCT FROM EXCLUDED.label_size
                   OR map_label.label_priority IS DISTINCT FROM EXCLUDED.label_priority
                   OR map_label.rotation IS DISTINCT FROM EXCLUDED.rotation
                   OR map_label.show_name IS DISTINCT FROM EXCLUDED.show_name
                   OR map_label.is_nodix IS DISTINCT FROM EXCLUDED.is_nodix
                   OR map_label.placement IS DISTINCT FROM EXCLUDED.placement
                   OR map_label.curve_count IS DISTINCT FROM EXCLUDED.curve_count
                   OR map_label.sort_order IS DISTINCT FROM EXCLUDED.sort_order
                   OR map_label.text_follows_name IS DISTINCT FROM EXCLUDED.text_follows_name
                   OR map_label.legacy_revision IS DISTINCT FROM EXCLUDED.legacy_revision
                   OR map_label.is_active IS DISTINCT FROM EXCLUDED.is_active
                RETURNING (xmax = 0) AS inserted
            `;
                countRow(report.labels, rows);
            }

            // ---- P4: Primaerkennzeichnung ------------------------------------------------------
            // Erst jetzt moeglich, weil sie beide Seiten braucht.
            //
            // 💣 Idempotent, und das ist kein Detail: ein Lauf, der erst alles auf NULL setzt und dann
            // neu schreibt, faehrt bei jedem Wiederholungslauf ueber tausend Zeilen. "Zweimal derselbe
            // Quellstand erzeugt denselben Zielzustand" hiesse dann "endet gleich" statt "tut nichts".
            // Deshalb zuerst nur loeschen, was nicht mehr stimmt, dann nur setzen, was abweicht.
            //
            // 🔴 Nur an Legacys Regionen (WI-0178 B1, EDIT-0004 §4 Nr. 4): Eine bei uns angelegte Landschaft (`avesmaps3d`) steht in
            // keiner Quelle; ohne den Filter verlöre sie bei jedem Zug ihre Hauptbeschriftung.
            const pointerRegions = transformed.regions
                .filter((region) => region.primaryLabelPublicId !== null)
                .map((region) => region.publicId);
            const pointerLabels = transformed.regions
                .filter((region) => region.primaryLabelPublicId !== null)
                .map((region) => region.primaryLabelPublicId as string);

            const cleared = await transaction<{ public_id: string }[]>`
            UPDATE region SET primary_label_id = NULL, updated_at = now()
            WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy'
              AND region_layer = ANY(${MIGRATED_LAYERS as unknown as string[]})
              AND primary_label_id IS NOT NULL
              AND NOT EXISTS (
                    SELECT 1
                    FROM unnest(${pointerRegions}::uuid[], ${pointerLabels}::uuid[]) AS p(region_public_id, label_public_id)
                    JOIN map_label l ON l.public_id = p.label_public_id
                    WHERE p.region_public_id = region.public_id
                      AND l.id = region.primary_label_id
                      AND l.region_id = region.id
                  )
            RETURNING public_id::text
        `;
            report.primaryLabelsCleared = cleared.length;

            const assigned = await transaction<{ public_id: string }[]>`
            UPDATE region SET primary_label_id = want.label_id, updated_at = now()
            FROM (
                SELECT r.id AS region_id, l.id AS label_id
                FROM unnest(${pointerRegions}::uuid[], ${pointerLabels}::uuid[]) AS p(region_public_id, label_public_id)
                JOIN region r ON r.public_id = p.region_public_id
                -- Die Zusicherung, die Legacy nicht hat: das benannte Label gehoert dieser Region.
                JOIN map_label l ON l.public_id = p.label_public_id AND l.region_id = r.id
            ) want
            WHERE region.id = want.region_id
              AND region.primary_label_id IS DISTINCT FROM want.label_id
            RETURNING region.public_id::text
        `;
            report.primaryLabelsChanged = assigned.length;

            const [primaryTotal] = await transaction<{ total: number }[]>`
            SELECT count(*)::int AS total FROM region
            WHERE map_domain_id = ${mapDomainId}
              AND region_layer = ANY(${MIGRATED_LAYERS as unknown as string[]})
              AND is_active AND primary_label_id IS NOT NULL
        `;
            report.primaryLabelsActive = primaryTotal?.total ?? 0;

            // ---- Stilllegen, was die Quelle nicht mehr kennt ------------------------------------
            const retiredLabels = await transaction<{ public_id: string }[]>`
            UPDATE map_label SET is_active = FALSE, updated_at = now()
            WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
              AND region_id IS NOT NULL
              AND public_id <> ALL(${labelIds}::uuid[])
            RETURNING public_id
        `;
            report.labels.retired = retiredLabels.length;

            const retiredAreas = await transaction<{ public_id: string }[]>`
            UPDATE region_area SET is_active = FALSE, updated_at = now()
            WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
              AND public_id <> ALL(${areaIds}::uuid[])
            RETURNING public_id
        `;
            report.areas.retired = retiredAreas.length;

            // Zuletzt die Wurzel: eine stillgelegte Region laesst keine aktiven Teile zurueck, weil
            // ihre Teile oben schon an derselben Quelle gemessen wurden.
            const retiredRegions = await transaction<{ public_id: string; name: string; is_hidden: boolean }[]>`
            UPDATE region SET is_active = FALSE, updated_at = now()
            WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
              AND region_layer = ANY(${MIGRATED_LAYERS as unknown as string[]})
              AND public_id <> ALL(${regionIds}::uuid[])
            RETURNING public_id, name, is_hidden
        `;
            report.regions.retired = retiredRegions.length;
            // Eine im Editor verborgene Landschaft, die Legacy nicht mehr kennt (WI-0178 T41; Claudio 2026-10-18): Kommt sie in Legacy neu
            // an, dann mit neuer Kennung und unverborgen. Ein Befund, kein Rot.
            const verborgen = retiredRegions.filter((zeile) => zeile.is_hidden);
            if (verborgen.length > 0)
                report.findings.push(
                    createFinding(
                        "hidden_landscape_retired",
                        `${String(verborgen.length)} im Editor verborgene Landschaften kennt Legacy nicht mehr; sie sind stillgelegt. ` +
                            "Legt Legacy sie neu an, kommen sie mit neuer Kennung und für Besucher sichtbar.",
                        { landscapes: verborgen.length },
                        verborgen.map((zeile) => ({ table: "region", publicId: zeile.public_id, name: zeile.name })),
                    ),
                );

            await transaction`
            UPDATE migration_run
            SET completed_at = now(), status = 'completed', journal = ${
                {
                    regions: report.regions,
                    areas: report.areas,
                    labels: report.labels,
                    primary_labels_cleared: report.primaryLabelsCleared,
                    primary_labels_changed: report.primaryLabelsChanged,
                    primary_labels_active: report.primaryLabelsActive,
                    retired_by_decision: report.retiredByDecision,
                    skipped_climate_regions: report.skippedClimateRegions,
                    skipped_climate_areas: report.skippedClimateAreas,
                    free_labels: report.freeLabels,
                    dangling_primary_labels: report.danglingPrimaryLabels.length,
                    primary_label_from_reverse: report.primaryLabelFromReverse.length,
                    rejected: report.rejected.length,
                } as unknown as string
            }
            WHERE id = ${runId}
        `;

            const labelsAfter = await labelState();
            for (const [publicId, after] of labelsAfter) {
                const before = labelsBefore.get(publicId);
                if (before === undefined) {
                    report.labelChanges.push({
                        publicId,
                        name: String(after.name),
                        field: "angelegt",
                        before: null,
                        after: true,
                    });
                    continue;
                }
                for (const field of LABEL_FIELDS) {
                    if (before[field] === after[field]) continue;
                    report.labelChanges.push({
                        publicId,
                        name: String(after.name),
                        field,
                        before: before[field],
                        after: after[field],
                    });
                }
            }
            if (report.dryRun) throw new DryRunRollback();
        });
    } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
    }

    return report;
}
