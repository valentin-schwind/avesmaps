import { randomUUID } from "node:crypto";
import { AVENTURIA } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { withZugSperre } from "../derive/derive-lock.ts";
import type { Finding } from "../findings.ts";
import { MigrationAborted } from "./places.ts";
import { retireFinding } from "./retire-findings.ts";
import type { LegacyAreaPayload, LegacyMapPayload } from "./regions.ts";

/**
 * Gelände-Eingaben aus Legacy (WI-0049 S2, Contract `terrain.yaml`).
 *
 * Übernommen wird, woraus Legacys Gebirgsrechnung V12 ihr Höhenfeld macht (MCS-025): die Regler je
 * Gebirgsfläche, ihre Kammlinie samt Legacys Rückfall (die Beschriftungskurve) und die Gipfel und
 * Vulkane mit ihrer Höhe. Das Höhenmodell selbst ist abgeleitet und entsteht erst in S3.
 *
 * 🔴 Jeder Wert kommt unverändert aus Legacy (Cutoff-Regel). Leer heißt, wie in Legacy, „ableiten“.
 * Die neue Durchschnittshöhe gehört Avesmaps3D und wird vom Import nie geschrieben.
 */

export const TERRAIN_CONTRACT_VERSION = "1";
export const TERRAIN_PEAK_SUBTYPES = ["berggipfel", "vulkan"] as const;
export type TerrainPeakSubtype = (typeof TERRAIN_PEAK_SUBTYPES)[number];

type Line = [number, number][];

/** Die Regler einer Gebirgsfläche unter den Namen der Zieltabelle; `null` heißt „ableiten“. */
export interface TerrainControlInput {
    areaPublicId: string;
    koernung: number | null;
    stufen: number | null;
    erosion: number | null;
    plateau: number | null;
    hypsometrie: number | null;
    maximalhoehe: number | null;
    bergform: number | null;
    rauschen: number | null;
    sattel: number | null;
    talbreite: number | null;
    einschnitt: number | null;
    kammlinie: Line | null;
    beschriftungskurve: Line | null;
    vorlageMorph: string | null;
    vorlageHoehe: string | null;
}

export interface TerrainPeakInput {
    publicId: string;
    name: string;
    subtype: TerrainPeakSubtype;
    x: number;
    y: number;
    heightSchritt: number | null;
    legacyRevision: number | null;
    /** Legacy `show_name`, Vorgabe an: Aus ist hier ein Hilfspunkt des Geländes, also zusätzlich das Merkmal „nur Gelände“ (0310): Name und Dreieck fehlen, das Gelände zählt weiter. */
    showName: boolean;
}

export interface TerrainSources {
    sourceRef: string;
    controls: TerrainControlInput[];
    peaks: TerrainPeakInput[];
    rejected: { publicId: string; reason: string }[];
}

/** Legacy-Spalte → Zielspalte. Die Reihenfolge ist die der Zieltabelle. */
export const TERRAIN_NUMBER_FIELDS = [
    ["terrain_grain", "koernung"],
    ["terrain_levels", "stufen"],
    ["terrain_erosion", "erosion"],
    ["terrain_plateau", "plateau"],
    ["terrain_hypsometrie", "hypsometrie"],
    // 🪤 Heißt in Legacy „avg“, ist aber die Maximalhöhe: der Sockel des Kamms (MCS-025).
    ["terrain_avg_height", "maximalhoehe"],
    ["terrain_bergform", "bergform"],
    ["terrain_rauschen", "rauschen"],
    ["terrain_sattel", "sattel"],
    ["terrain_talbreite", "talbreite"],
    ["terrain_einschnitt", "einschnitt"],
] as const;
type TerrainNumberField = (typeof TERRAIN_NUMBER_FIELDS)[number][1];
const INTEGER_FIELDS: ReadonlySet<TerrainNumberField> = new Set(["stufen", "erosion"]);

/** Legacys `show_name`: `false`, 0 oder "0" heißt aus; fehlt es, gilt die Vorgabe an (`map-features-labels.js:1309`). */
function anzeigen(value: unknown): boolean {
    return !(value === false || value === 0 || value === "0");
}

function numberOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Eine Punktliste in Kartenkoordinaten, wie Legacy sie für Kammlinie und Beschriftungskurve speichert. */
function lineOrNull(value: unknown): Line | null | "ungueltig" {
    if (value === null || value === undefined) {
        return null;
    }
    if (!Array.isArray(value) || value.length < 2) {
        return "ungueltig";
    }
    const line: Line = [];
    for (const point of value as unknown[]) {
        if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every((c) => Number.isFinite(c))) {
            return "ungueltig";
        }
        line.push([point[0] as number, point[1] as number]);
    }
    return line;
}

/** Well-known Text einer Punktliste; volle Stellen, damit der Vergleich mit Legacy exakt bleibt. */
export function lineWkt(line: Line | null): string | null {
    return line ? `LINESTRING(${line.map(([x, y]) => `${String(x)} ${String(y)}`).join(",")})` : null;
}

/**
 * Liest die Eingaben aus dem Satz: die Gebirgsflächen aus `ecosystem-areas.json`, Beschriftungskurven,
 * Gipfel und Vulkane aus `map-features.json`.
 *
 * 🔴 Eine unvollständige Quelle bleibt ein Abbruch (Betreiber 2026-10-03, „A auch für die Prüfungen“, BLOCKING_SOURCE_CHECKS A16).
 */
export function readTerrainSources(areas: LegacyAreaPayload, features: LegacyMapPayload): TerrainSources {
    if (areas.ok === false || areas.truncated === true || !Array.isArray(areas.areas)) {
        throw new MigrationAborted("ecosystem-areas ist unvollständig", { truncated: String(areas.truncated) });
    }
    if (features.ok === false || !Array.isArray(features.features)) {
        throw new MigrationAborted("map-features ist unvollständig", {});
    }
    const rejected: TerrainSources["rejected"] = [];
    const labelCurves = new Map<string, unknown>();
    const peaks: TerrainPeakInput[] = [];

    for (const feature of features.features) {
        const props = feature.properties ?? {};
        if (props["feature_type"] !== "label") {
            continue;
        }
        const publicId = String(props["public_id"] ?? "");
        labelCurves.set(publicId, props["curve_label_line"]);
        const subtype = props["feature_subtype"];
        if (!TERRAIN_PEAK_SUBTYPES.includes(subtype as TerrainPeakSubtype)) {
            continue;
        }
        const coordinates = feature.geometry?.coordinates as unknown[] | undefined;
        const height = numberOrNull(props["height_schritt"]);
        if (feature.geometry?.type !== "Point" || !coordinates || !coordinates.slice(0, 2).every(Number.isFinite)) {
            rejected.push({ publicId, reason: "Gipfel ohne gültigen Punkt" });
            continue;
        }
        if (height !== null && !Number.isInteger(height)) {
            rejected.push({ publicId, reason: `Gipfelhöhe ${String(height)} ist keine ganze Zahl` });
            continue;
        }
        peaks.push({
            publicId,
            name: String(props["name"] ?? ""),
            subtype: subtype as TerrainPeakSubtype,
            x: coordinates[0] as number,
            y: coordinates[1] as number,
            heightSchritt: height,
            legacyRevision: numberOrNull(props["revision"]),
            showName: anzeigen(props["show_name"]),
        });
    }

    const controls: TerrainControlInput[] = [];
    for (const raw of areas.areas) {
        const area = raw as Record<string, unknown>;
        if (area["kind"] !== "topographie" || area["region_type"] !== "gebirge") {
            continue;
        }
        const areaPublicId = String(area["public_id"] ?? "");
        const control = { areaPublicId } as TerrainControlInput;
        for (const [legacy, target] of TERRAIN_NUMBER_FIELDS) {
            const value = numberOrNull(area[legacy]);
            if (value !== null && INTEGER_FIELDS.has(target) && !Number.isInteger(value)) {
                rejected.push({ publicId: areaPublicId, reason: `${legacy} = ${String(value)} ist keine ganze Zahl` });
                control[target] = null;
                continue;
            }
            control[target] = value;
        }
        const kammlinie = lineOrNull(area["terrain_ridge_line"]);
        const kurve = lineOrNull(labelCurves.get(String(area["label_public_id"] ?? "")));
        for (const [name, value] of [
            ["terrain_ridge_line", kammlinie],
            ["curve_label_line", kurve],
        ] as const) {
            if (value === "ungueltig") {
                rejected.push({ publicId: areaPublicId, reason: `${name} ist keine Punktliste` });
            }
        }
        control.kammlinie = kammlinie === "ungueltig" ? null : kammlinie;
        control.beschriftungskurve = kurve === "ungueltig" ? null : kurve;
        control.vorlageMorph = textOrNull(area["terrain_preset_morph"]);
        control.vorlageHoehe = textOrNull(area["terrain_preset_hoehe"]);
        controls.push(control);
    }

    return {
        sourceRef: `ecosystem_revision=${String(areas.revision)};map_revision=${String(features.revision)}`,
        controls,
        peaks,
        rejected,
    };
}

export interface PhaseReport {
    created: number;
    updated: number;
    unchanged: number;
    retired: number;
}

export interface ImportTerrainReport {
    runId: string;
    sourceRef: string;
    controls: PhaseReport;
    peaks: PhaseReport;
    /** Gipfel und Vulkane außerhalb jeder Gebirgsfläche: Für sie gilt in S3 die Bergregel des Betreibers. */
    peaksOutsideMountains: number;
    /** Gebirge ohne Kammlinie und ohne Beschriftungskurve: Die Kammlinie entsteht in S3. */
    controlsWithoutLine: number;
    /** Gebirge ohne eigene Maximalhöhe: Für sie gilt in S3 die Grundhöhe. */
    controlsWithoutMaximalhoehe: number;
    rejected: { publicId: string; reason: string }[];
    /** Was der Lauf meldet, ohne anzuhalten (Betreiber 2026-10-03): etwa die Stilllegequote. */
    findings: Finding[];
}

export interface ImportTerrainOptions {
    mapDomainId?: string;
}

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

/**
 * Schreibt die Eingaben idempotent, in EINER Transaktion; ein zweiter Lauf schreibt nichts.
 *
 * 🔴 Die Regionen müssen vorher importiert sein: Die Regler hängen an der Fläche. Fehlt eine
 * Gebirgsfläche, bricht der Lauf ab, statt Regler ohne Gelände abzulegen.
 */
export function importTerrain(
    database: Database,
    sources: TerrainSources,
    options: ImportTerrainOptions = {},
): Promise<ImportTerrainReport> {
    // 🔴 Unter der exklusiven Sperre des Zugs (EDIT-0003 T17): `terrain_control` und `terrain_peak` schreibt auch der Landschafts-Editor.
    return withZugSperre(database, options.mapDomainId ?? AVENTURIA.mapDomain, "I10 Gelände-Eingaben", () =>
        importTerrainLocked(database, sources, options),
    );
}

/** Der Körper von `importTerrain`, unter der Sperre des Zugs. */
async function importTerrainLocked(
    database: Database,
    sources: TerrainSources,
    options: ImportTerrainOptions,
): Promise<ImportTerrainReport> {
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const runId = randomUUID();
    const report: ImportTerrainReport = {
        runId,
        sourceRef: sources.sourceRef,
        controls: emptyPhase(),
        peaks: emptyPhase(),
        peaksOutsideMountains: 0,
        controlsWithoutLine: sources.controls.filter((c) => !c.kammlinie && !c.beschriftungskurve).length,
        controlsWithoutMaximalhoehe: sources.controls.filter((c) => c.maximalhoehe === null).length,
        rejected: sources.rejected,
        findings: [],
    };

    await database.begin(async (transaction) => {
        const areaIds = sources.controls.map((control) => control.areaPublicId);
        // Eine im Editor abgenommene Gebirgsfläche (WI-0178 D2, Migration 0163; Claudio 2026-10-18, Bedingung B) ist still, aber da: Ihr
        // Regler wird still geschrieben (is_active = NOT region.off_map), wie ihre Teilflächen im Landschaften-Zug.
        const areaRows = await transaction<{ public_id: string; id: string; off_map: boolean }[]>`
            SELECT a.public_id::text, a.id::text, r.off_map
            FROM region_area a JOIN region r ON r.id = a.region_id
            WHERE a.public_id = ANY(${areaIds}::uuid[]) AND a.map_domain_id = ${mapDomainId}
              AND (a.is_active OR r.off_map) AND r.region_layer = 'topographie' AND r.region_type = 'gebirge'
        `;
        const areaById = new Map(areaRows.map((row) => [row.public_id, Number(row.id)]));
        const abgenommen = new Set(areaRows.filter((row) => row.off_map).map((row) => row.public_id));
        const missing = areaIds.filter((id) => !areaById.has(id));
        if (missing.length > 0) {
            throw new MigrationAborted(
                "Gebirgsflächen fehlen in region_area; zuerst migrate:regions mit demselben Satz",
                {
                    missing: missing.length,
                    first: missing[0] ?? "",
                },
            );
        }
        const targetAreaIds = [...areaById.values()];
        const peakIds = sources.peaks.map((peak) => peak.publicId);

        const [controlPressure] = await transaction<{ active: number; retiring: number }[]>`
            SELECT count(*)::int AS active,
                   count(*) FILTER (WHERE area_id <> ALL(${targetAreaIds}::bigint[]))::int AS retiring
            FROM terrain_control WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
        `;
        // Über MAX_RETIRE_FRACTION ist das ein Befund mit Namen, kein Abbruch (Betreiber 2026-10-03). Ein Regler hat
        // keine eigene öffentliche ID: genannt wird die Gebirgsfläche (region_area.public_id) und der Name ihrer Region.
        const controlQuota = await retireFinding("terrain_control", controlPressure, async () => {
            const rows = await transaction<{ public_id: string; name: string }[]>`
                SELECT a.public_id::text, r.name
                FROM terrain_control c
                JOIN region_area a ON a.id = c.area_id
                JOIN region r ON r.id = a.region_id
                WHERE c.map_domain_id = ${mapDomainId} AND c.source_system = 'legacy' AND c.is_active
                  AND c.area_id <> ALL(${targetAreaIds}::bigint[])
                ORDER BY r.name, a.public_id
            `;
            return rows.map((row) => ({ table: "terrain_control", publicId: row.public_id, name: row.name }));
        });
        if (controlQuota) report.findings.push(controlQuota);
        const [peakPressure] = await transaction<{ active: number; retiring: number }[]>`
            SELECT count(*)::int AS active,
                   count(*) FILTER (WHERE public_id <> ALL(${peakIds}::uuid[]))::int AS retiring
            FROM terrain_peak WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
        `;
        const peakQuota = await retireFinding("terrain_peak", peakPressure, async () => {
            const rows = await transaction<{ public_id: string; name: string }[]>`
                SELECT public_id::text, name
                FROM terrain_peak
                WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
                  AND public_id <> ALL(${peakIds}::uuid[])
                ORDER BY name, public_id
            `;
            return rows.map((row) => ({ table: "terrain_peak", publicId: row.public_id, name: row.name }));
        });
        if (peakQuota) report.findings.push(peakQuota);

        await transaction`
            INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
            VALUES (${runId}, 'terrain', 'avesmaps-legacy', ${sources.sourceRef}, ${TERRAIN_CONTRACT_VERSION})
        `;

        // ---- P1: Regler je Gebirgsfläche -------------------------------------------------------
        // 🔴 `durchschnittshoehe` steht in keiner Zeile dieses Upserts: Sie gehört Avesmaps3D.
        for (const c of sources.controls) {
            const rows = await transaction<{ inserted: boolean }[]>`
                INSERT INTO terrain_control (
                    area_id, map_domain_id, koernung, stufen, erosion, plateau, hypsometrie, maximalhoehe,
                    bergform, rauschen, sattel, talbreite, einschnitt, kammlinie, beschriftungskurve,
                    vorlage_morph, vorlage_hoehe, source_system, migration_run_id, imported_at, is_active
                ) VALUES (
                    ${areaById.get(c.areaPublicId) as number}, ${mapDomainId}, ${c.koernung}, ${c.stufen},
                    ${c.erosion}, ${c.plateau}, ${c.hypsometrie}, ${c.maximalhoehe}, ${c.bergform},
                    ${c.rauschen}, ${c.sattel}, ${c.talbreite}, ${c.einschnitt},
                    ST_SetSRID(ST_GeomFromText(${lineWkt(c.kammlinie)}), 0),
                    ST_SetSRID(ST_GeomFromText(${lineWkt(c.beschriftungskurve)}), 0),
                    ${c.vorlageMorph}, ${c.vorlageHoehe}, 'legacy', ${runId}, now(), ${!abgenommen.has(c.areaPublicId)}
                )
                ON CONFLICT (area_id) DO UPDATE SET
                    koernung = EXCLUDED.koernung, stufen = EXCLUDED.stufen, erosion = EXCLUDED.erosion,
                    plateau = EXCLUDED.plateau, hypsometrie = EXCLUDED.hypsometrie,
                    maximalhoehe = EXCLUDED.maximalhoehe, bergform = EXCLUDED.bergform,
                    rauschen = EXCLUDED.rauschen, sattel = EXCLUDED.sattel, talbreite = EXCLUDED.talbreite,
                    einschnitt = EXCLUDED.einschnitt, kammlinie = EXCLUDED.kammlinie,
                    beschriftungskurve = EXCLUDED.beschriftungskurve, vorlage_morph = EXCLUDED.vorlage_morph,
                    vorlage_hoehe = EXCLUDED.vorlage_hoehe, migration_run_id = EXCLUDED.migration_run_id,
                    imported_at = EXCLUDED.imported_at, is_active = EXCLUDED.is_active, updated_at = now()
                WHERE terrain_control.koernung IS DISTINCT FROM EXCLUDED.koernung
                   OR terrain_control.stufen IS DISTINCT FROM EXCLUDED.stufen
                   OR terrain_control.erosion IS DISTINCT FROM EXCLUDED.erosion
                   OR terrain_control.plateau IS DISTINCT FROM EXCLUDED.plateau
                   OR terrain_control.hypsometrie IS DISTINCT FROM EXCLUDED.hypsometrie
                   OR terrain_control.maximalhoehe IS DISTINCT FROM EXCLUDED.maximalhoehe
                   OR terrain_control.bergform IS DISTINCT FROM EXCLUDED.bergform
                   OR terrain_control.rauschen IS DISTINCT FROM EXCLUDED.rauschen
                   OR terrain_control.sattel IS DISTINCT FROM EXCLUDED.sattel
                   OR terrain_control.talbreite IS DISTINCT FROM EXCLUDED.talbreite
                   OR terrain_control.einschnitt IS DISTINCT FROM EXCLUDED.einschnitt
                   OR terrain_control.kammlinie IS DISTINCT FROM EXCLUDED.kammlinie
                   OR terrain_control.beschriftungskurve IS DISTINCT FROM EXCLUDED.beschriftungskurve
                   OR terrain_control.vorlage_morph IS DISTINCT FROM EXCLUDED.vorlage_morph
                   OR terrain_control.vorlage_hoehe IS DISTINCT FROM EXCLUDED.vorlage_hoehe
                   OR terrain_control.is_active IS DISTINCT FROM EXCLUDED.is_active
                RETURNING (xmax = 0) AS inserted
            `;
            countRow(report.controls, rows);
        }

        // ---- P2: Gipfel und Vulkane ------------------------------------------------------------
        for (const p of sources.peaks) {
            const rows = await transaction<{ inserted: boolean }[]>`
                INSERT INTO terrain_peak (
                    public_id, map_domain_id, name, subtype, geom, height_schritt, show_name, merkmale,
                    source_system, legacy_public_id, legacy_revision, migration_run_id, imported_at, is_active
                ) VALUES (
                    ${p.publicId}, ${mapDomainId}, ${p.name}, ${p.subtype},
                    ST_SetSRID(ST_MakePoint(${p.x}, ${p.y}), 0), ${p.heightSchritt}, ${p.showName},
                    CASE WHEN ${p.showName}::boolean THEN '{}'::text[] ELSE '{nur_gelaende}'::text[] END,
                    'legacy', ${p.publicId}, ${p.legacyRevision}, ${runId}, now(), TRUE
                )
                ON CONFLICT (public_id) DO UPDATE SET
                    name = EXCLUDED.name, subtype = EXCLUDED.subtype, geom = EXCLUDED.geom,
                    height_schritt = EXCLUDED.height_schritt, show_name = EXCLUDED.show_name,
                    merkmale = array_remove(terrain_peak.merkmale, 'nur_gelaende') || EXCLUDED.merkmale,
                    legacy_revision = EXCLUDED.legacy_revision,
                    migration_run_id = EXCLUDED.migration_run_id, imported_at = EXCLUDED.imported_at,
                    is_active = TRUE, updated_at = now()
                WHERE terrain_peak.name IS DISTINCT FROM EXCLUDED.name
                   OR terrain_peak.subtype IS DISTINCT FROM EXCLUDED.subtype
                   OR terrain_peak.geom IS DISTINCT FROM EXCLUDED.geom
                   OR terrain_peak.height_schritt IS DISTINCT FROM EXCLUDED.height_schritt
                   OR terrain_peak.show_name IS DISTINCT FROM EXCLUDED.show_name
                   OR terrain_peak.legacy_revision IS DISTINCT FROM EXCLUDED.legacy_revision
                   OR terrain_peak.is_active IS DISTINCT FROM TRUE
                RETURNING (xmax = 0) AS inserted
            `;
            countRow(report.peaks, rows);
        }

        // ---- Stilllegen, was der Satz nicht mehr kennt -------------------------------------------
        // Regler werden nicht gelöscht: Eine Zeile trägt vielleicht schon eine Durchschnittshöhe.
        const retiredControls = await transaction`
            UPDATE terrain_control SET is_active = FALSE, updated_at = now()
            WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
              AND area_id <> ALL(${targetAreaIds}::bigint[])
            RETURNING id
        `;
        report.controls.retired = retiredControls.length;
        const retiredPeaks = await transaction`
            UPDATE terrain_peak SET is_active = FALSE, updated_at = now()
            WHERE map_domain_id = ${mapDomainId} AND source_system = 'legacy' AND is_active
              AND public_id <> ALL(${peakIds}::uuid[])
            RETURNING id
        `;
        report.peaks.retired = retiredPeaks.length;

        const [outside] = await transaction<{ total: number }[]>`
            SELECT count(*)::int AS total FROM terrain_peak_gelaende p
            WHERE p.map_domain_id = ${mapDomainId} AND p.is_active AND NOT EXISTS (
                SELECT 1 FROM terrain_control c JOIN region_area a ON a.id = c.area_id
                WHERE c.is_active AND a.is_active AND ST_Intersects(a.geom, p.geom)
            )
        `;
        report.peaksOutsideMountains = outside?.total ?? 0;

        await transaction`
            UPDATE migration_run
            SET completed_at = now(), status = 'completed', journal = ${
                {
                    controls: report.controls,
                    peaks: report.peaks,
                    peaks_outside_mountains: report.peaksOutsideMountains,
                    controls_without_line: report.controlsWithoutLine,
                    controls_without_maximalhoehe: report.controlsWithoutMaximalhoehe,
                    rejected: report.rejected.length,
                } as unknown as string
            }
            WHERE id = ${runId}
        `;
    });

    return report;
}
