import { AVENTURIA } from "@avesmaps3d/shared";
import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import { TERRAIN_NUMBER_FIELDS, type TerrainControlInput, type TerrainSources } from "./terrain.ts";

/**
 * Die Gates aus dem Contract `terrain.yaml` (WI-0049 S2). Sie vergleichen den Zielbestand Wert für
 * Wert mit dem Satz; wird eine rot, ist zu stoppen und zu berichten, nicht passend zu machen.
 */

export interface TerrainCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

export interface TerrainReport {
    passed: boolean;
    checks: TerrainCheck[];
}

const SAMPLE = 5;

function check(name: string, passed: boolean, detail: string, offenders: string[] = []): TerrainCheck {
    return offenders.length > 0
        ? { name, passed, detail, offenders: offenders.slice(0, SAMPLE) }
        : { name, passed, detail };
}

type Line = [number, number][] | null;

function sameLine(a: Line, b: Line): boolean {
    if (!a || !b) {
        return a === b;
    }
    return a.length === b.length && a.every(([x, y], i) => x === b[i]?.[0] && y === b[i]?.[1]);
}

function lineOf(geoJson: string | null): Line {
    return geoJson ? ((JSON.parse(geoJson) as { coordinates: [number, number][] }).coordinates ?? null) : null;
}

interface ControlRow {
    area_public_id: string;
    kammlinie: string | null;
    beschriftungskurve: string | null;
    vorlage_morph: string | null;
    vorlage_hoehe: string | null;
    durchschnittshoehe: number | null;
    [field: string]: unknown;
}

export async function verifyTerrain(
    database: Database,
    sources: TerrainSources,
    mapDomainId: string = AVENTURIA.mapDomain,
): Promise<TerrainReport> {
    const checks: TerrainCheck[] = [];
    const controls = await database<ControlRow[]>`
        SELECT a.public_id::text AS area_public_id, c.koernung, c.stufen, c.erosion, c.plateau,
               c.hypsometrie, c.maximalhoehe, c.bergform, c.rauschen, c.sattel, c.talbreite,
               -- 🪤 15 Stellen: Die Vorgabe (9) rundet Legacys Koordinaten, und der Vergleich fiele falsch rot.
               c.einschnitt, ST_AsGeoJSON(c.kammlinie, 15) AS kammlinie,
               ST_AsGeoJSON(c.beschriftungskurve, 15) AS beschriftungskurve,
               c.vorlage_morph, c.vorlage_hoehe, c.durchschnittshoehe
        FROM terrain_control c JOIN region_area a ON a.id = c.area_id
        WHERE c.map_domain_id = ${mapDomainId} AND c.is_active
    `;
    const byArea = new Map(controls.map((row) => [row.area_public_id, row]));
    // Die Regler im Editor abgenommener Gebirge (WI-0178 D2, Migration 0163) sind still; sie gehören nicht zum Erwartungswert.
    const abgenommenRows = await database<{ public_id: string }[]>`
        SELECT a.public_id::text FROM region_area a JOIN region r ON r.id = a.region_id
         WHERE a.map_domain_id = ${mapDomainId} AND r.off_map
    `;
    const abgenommen = new Set(abgenommenRows.map((row) => row.public_id));
    const expected = new Map<string, TerrainControlInput>(
        sources.controls.filter((c) => !abgenommen.has(c.areaPublicId)).map((c) => [c.areaPublicId, c]),
    );

    const missing = [...expected.keys()].filter((id) => !byArea.has(id));
    checks.push(
        check(
            "gebirge_vollzaehlig",
            missing.length === 0 && controls.length === expected.size,
            `${String(controls.length)} Gebirgsflächen mit Reglern, erwartet ${String(expected.size)}` +
                (abgenommen.size > 0 ? ` (${String(abgenommen.size)} Flächen vom Editor abgenommen)` : ""),
            missing,
        ),
    );

    const foreign = await database<{ area_public_id: string }[]>`
        SELECT a.public_id::text AS area_public_id
        FROM terrain_control c JOIN region_area a ON a.id = c.area_id JOIN region r ON r.id = a.region_id
        WHERE c.map_domain_id = ${mapDomainId} AND c.is_active
          AND NOT (a.is_active AND r.region_layer = 'topographie' AND r.region_type = 'gebirge')
    `;
    checks.push(
        check(
            "keine_fremden_flaechen",
            foreign.length === 0,
            `${String(foreign.length)} aktive Regler an einer Fläche, die kein aktives Gebirge ist`,
            foreign.map((row) => row.area_public_id),
        ),
    );

    const numberOffenders: string[] = [];
    for (const [id, source] of expected) {
        const row = byArea.get(id);
        if (!row) {
            continue;
        }
        for (const [, field] of TERRAIN_NUMBER_FIELDS) {
            const actual = row[field] === null ? null : Number(row[field]);
            if (actual !== source[field]) {
                numberOffenders.push(`${id} ${field}: ${String(actual)} statt ${String(source[field])}`);
            }
        }
        if (row.vorlage_morph !== source.vorlageMorph || row.vorlage_hoehe !== source.vorlageHoehe) {
            numberOffenders.push(`${id} Vorlagen: ${String(row.vorlage_morph)}/${String(row.vorlage_hoehe)}`);
        }
    }
    checks.push(
        check(
            "regler_gleich_wie_legacy",
            numberOffenders.length === 0,
            `${String(numberOffenders.length)} Abweichungen in elf Reglern und zwei Vorlagen`,
            numberOffenders,
        ),
    );

    /** Punkt für Punkt, exakt: Eine Linie, die auch nur einen Stützpunkt anders setzt, ist eine andere. */
    const compareLines = (field: "kammlinie" | "beschriftungskurve"): { present: number; offenders: string[] } => {
        const offenders: string[] = [];
        let present = 0;
        for (const [id, source] of expected) {
            const row = byArea.get(id);
            if (!row) {
                continue;
            }
            if (source[field]) {
                present += 1;
            }
            if (!sameLine(lineOf(row[field]), source[field])) {
                offenders.push(id);
            }
        }
        return { present, offenders };
    };
    const ridges = compareLines("kammlinie");
    checks.push(
        check(
            "kammlinien_gleich_wie_legacy",
            ridges.offenders.length === 0,
            `${String(ridges.present)} Kammlinien, ${String(ridges.offenders.length)} abweichend`,
            ridges.offenders,
        ),
    );
    const curves = compareLines("beschriftungskurve");
    checks.push(
        check(
            "beschriftungskurven_gleich_wie_legacy",
            curves.offenders.length === 0,
            `${String(curves.present)} Beschriftungskurven, ${String(curves.offenders.length)} abweichend`,
            curves.offenders,
        ),
    );

    const filled = controls.filter((row) => row.durchschnittshoehe !== null).map((row) => row.area_public_id);
    checks.push(
        check(
            "durchschnittshoehe_leer",
            filled.length === 0,
            `${String(filled.length)} Gebirge mit Durchschnittshöhe (bis zum Terrain-Editor leer, Cutoff-Regel)`,
            filled,
        ),
    );

    const peaks = await database<
        {
            public_id: string;
            name: string;
            subtype: string;
            x: number;
            y: number;
            height_schritt: number | null;
            show_name: boolean;
        }[]
    >`
        SELECT public_id::text, name, subtype, ST_X(geom) AS x, ST_Y(geom) AS y, height_schritt, show_name
        FROM terrain_peak_gelaende WHERE map_domain_id = ${mapDomainId} AND is_active
    `;
    const peakById = new Map(peaks.map((row) => [row.public_id, row]));
    const missingPeaks = sources.peaks.filter((peak) => !peakById.has(peak.publicId)).map((peak) => peak.publicId);
    checks.push(
        check(
            "gipfel_vollzaehlig",
            missingPeaks.length === 0 && peaks.length === sources.peaks.length,
            `${String(peaks.length)} Gipfel und Vulkane, erwartet ${String(sources.peaks.length)}`,
            missingPeaks,
        ),
    );

    const peakOffenders: string[] = [];
    for (const peak of sources.peaks) {
        const row = peakById.get(peak.publicId);
        if (
            row &&
            (row.name !== peak.name ||
                row.subtype !== peak.subtype ||
                row.x !== peak.x ||
                row.y !== peak.y ||
                row.height_schritt !== peak.heightSchritt ||
                row.show_name !== peak.showName)
        ) {
            peakOffenders.push(`${peak.name} (${peak.publicId})`);
        }
    }
    checks.push(
        check(
            "gipfel_gleich_wie_legacy",
            peakOffenders.length === 0,
            `${String(peakOffenders.length)} Gipfel weichen in Name, Art, Lage oder Höhe ab`,
            peakOffenders,
        ),
    );

    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    return settleChecks("verify:terrain", checks);
}
