import { AVENTURIA, AVENTURIA_TRAVEL_MODEL, WEB_MERCATOR_HALF_WORLD, pointInGeometry } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { loadContinentalBase } from "./continental.ts";
import { decodeTileImage } from "./tile-image.ts";
import { DEM_MAX_ZOOM, DEM_TILE_SIZE, demRevision, RENDER_METERS_PER_SCHRITT, type DemTile } from "./dem-tiles.ts";
import { loadFreePeaks, loadMountainJobs } from "./inputs.ts";
import { DEFAULT_CONE, freePeakHeight, PEAK_DEFAULT_HEIGHT } from "./peak-cone.ts";
import { targetFingerprints, type BurnRaster } from "./burn-groups.ts";
import { leseMassstab, pathHeightFingerprint, rasterContentKey } from "./path-profiles.ts";
import { risingRivers } from "./river-burn.ts";
import { loadRiverInputs } from "./river-inputs.ts";
import { verifyCurrentDomain } from "./domain/verify-current.ts";

/**
 * `verify:terrain-dem` (WI-0049 S3): Stimmt das abgeleitete Gelände mit seinen Eingaben überein?
 * Jede Prüfung darf den Lauf widerlegen; rot heißt stoppen und berichten.
 */

export interface DemCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

const SAMPLE = 5;

function check(name: string, passed: boolean, detail: string, offenders: string[] = []): DemCheck {
    return offenders.length > 0
        ? { name, passed, detail, offenders: offenders.slice(0, SAMPLE) }
        : { name, passed, detail };
}

/** Die Höhe in Schritt an einem Pixel, zurückgerechnet aus der Kodierung (`rgb`: drei Bytes je Pixel). */
function heightInTile(rgb: Uint8Array, px: number, py: number, latitude: number): number {
    const o = (py * DEM_TILE_SIZE + px) * 3;
    const value = ((rgb[o] ?? 0) << 16) + ((rgb[o + 1] ?? 0) << 8) + (rgb[o + 2] ?? 0);
    return (value * 0.1 - 10000) / (RENDER_METERS_PER_SCHRITT * Math.cos(latitude));
}

export async function verifyTerrainDem(
    database: Database,
    mapDomainId: string = AVENTURIA.mapDomain,
): Promise<{ passed: boolean; checks: DemCheck[] }> {
    return database.begin("read only", (tx) => verifyCurrentDomain(tx, mapDomainId));
}

export async function verifyLegacyTerrainDem(
    database: Database,
    mapDomainId: string = AVENTURIA.mapDomain,
): Promise<{ passed: boolean; checks: DemCheck[] }> {
    const checks: DemCheck[] = [];
    const jobs = await loadMountainJobs(database, mapDomainId);
    const rasters = await database<
        {
            area_id: string;
            fingerprint: string;
            v12_fingerprint: string | null;
            cell: number;
            origin_x: number;
            origin_y: number;
            width: number;
            height: number;
            samples: Buffer;
            v12_samples: Buffer | null;
        }[]
    >`
        SELECT area_id::text, fingerprint, v12_fingerprint, cell, origin_x, origin_y, width, height, samples, v12_samples
        FROM terrain_raster WHERE map_domain_id = ${mapDomainId}
    `;
    const byArea = new Map(rasters.map((row) => [Number(row.area_id), row]));

    // Aktuell heißt: dieselbe Rechnung (V12) und dieselben eingebrannten Flüsse (S6), mit der Vorgabe der Kegel. Der
    // Fingerabdruck eines Rasters hängt an seiner Gruppe von Flüssen, Seen und Nachbargebirgen (WI-0059,
    // `burn-groups.ts`), gerechnet aus dem gespeicherten ungeschnittenen Stand.
    const freePeaksNow = await loadFreePeaks(database, mapDomainId, jobs);
    const rivers = await loadRiverInputs(database, mapDomainId);
    const unburnt: BurnRaster[] = [];
    for (const job of jobs) {
        const row = byArea.get(job.areaId);
        if (!row?.v12_samples || row.v12_fingerprint !== job.fingerprint) continue;
        unburnt.push({
            areaId: job.areaId,
            v12Fingerprint: job.fingerprint,
            raster: {
                cell: row.cell,
                originX: row.origin_x,
                originY: row.origin_y,
                width: row.width,
                height: row.height,
                samples: new Uint16Array(
                    row.v12_samples.buffer.slice(
                        row.v12_samples.byteOffset,
                        row.v12_samples.byteOffset + row.v12_samples.byteLength,
                    ),
                ),
            },
        });
    }
    const { targets } = targetFingerprints({
        rasters: unburnt,
        stored: new Map(),
        rivers: rivers.rivers,
        lakes: rivers.lakes,
        peaks: freePeaksNow,
        rule: DEFAULT_CONE,
        anchors: jobs.flatMap((job) => job.input.peaks),
    });
    const wanted = new Map(unburnt.map((entry, index) => [entry.areaId, targets[index]]));
    // Kein Raster, oder ein ungeschnittener Stand von anderen Eingaben (dann fehlt der Sollwert): veraltet.
    const stale = jobs
        .filter((job) => {
            const row = byArea.get(job.areaId);
            const target = wanted.get(job.areaId);
            return !row || target === undefined || row.fingerprint !== target;
        })
        .map((job) => job.name);
    checks.push(
        check(
            "raster_je_gebirge",
            stale.length === 0,
            `${String(jobs.length - stale.length)} von ${String(jobs.length)} Gebirgen mit aktuellem Raster`,
            stale,
        ),
    );

    const jobIds = new Set(jobs.map((job) => job.areaId));
    const orphans = rasters.filter((row) => !jobIds.has(Number(row.area_id))).map((row) => row.area_id);
    checks.push(
        check(
            "keine_verwaisten_raster",
            orphans.length === 0,
            `${String(orphans.length)} Raster ohne aktives Gebirge`,
            orphans,
        ),
    );

    // Jeder Gipfel mit Höhe liest im Gebirge genau seine Zahl (Legacy V12: „Abweichung 0,0000 Schritt“).
    const peaks = await database<{ name: string; x: number; y: number; height_schritt: number | null }[]>`
        SELECT name, ST_X(geom) AS x, ST_Y(geom) AS y, height_schritt
        FROM terrain_peak_gelaende WHERE map_domain_id = ${mapDomainId} AND is_active
    `;
    const wrongPeaks: string[] = [];
    const freePeaks: (typeof peaks)[number][] = [];
    for (const peak of peaks) {
        const owners = jobs.filter((job) => pointInGeometry([peak.x, peak.y], job.input.geometry));
        if (owners.length === 0) {
            freePeaks.push(peak);
            continue;
        }
        const want =
            peak.height_schritt !== null && peak.height_schritt > 0 ? peak.height_schritt : PEAK_DEFAULT_HEIGHT;
        let best = 0;
        for (const owner of owners) {
            const r = byArea.get(owner.areaId);
            if (!r) {
                continue;
            }
            const samples = new Uint16Array(
                r.samples.buffer.slice(r.samples.byteOffset, r.samples.byteOffset + r.samples.byteLength),
            );
            const i = Math.floor((peak.x - r.origin_x) / r.cell);
            const j = Math.floor((peak.y - r.origin_y) / r.cell);
            for (const [di, dj] of [
                [0, 0],
                [1, 0],
                [0, 1],
                [1, 1],
            ] as const) {
                if (i + di >= 0 && j + dj >= 0 && i + di < r.width && j + dj < r.height) {
                    best = Math.max(best, samples[(j + dj) * r.width + i + di] ?? 0);
                }
            }
        }
        if (Math.abs(best - want) > 1) {
            wrongPeaks.push(`${peak.name}: ${String(best)} statt ${String(want)}`);
        }
    }
    checks.push(
        check(
            "gipfel_lesen_ihre_hoehe",
            wrongPeaks.length === 0,
            `${String(peaks.length - freePeaks.length - wrongPeaks.length)} von ${String(peaks.length - freePeaks.length)} Gipfeln im Gebirge exakt`,
            wrongPeaks,
        ),
    );

    // Die Flüsse fallen (S6): kein Lauf steigt, gelesen wie Routing und Kacheln; ausgenommen die Stellen an
    // einem Gipfel im Gebirge, dessen Zellen stehen bleiben (als Befund gezählt).
    const continental = await loadContinentalBase(database, mapDomainId);
    const { rising: allRising, atPeaks } = risingRivers(
        [
            ...(continental ? [continental.raster] : []),
            ...rasters.map((row) => ({
                cell: row.cell,
                originX: row.origin_x,
                originY: row.origin_y,
                width: row.width,
                height: row.height,
                samples: new Uint16Array(
                    row.samples.buffer.slice(row.samples.byteOffset, row.samples.byteOffset + row.samples.byteLength),
                ),
            })),
        ],
        rivers,
        { peaks: freePeaksNow, rule: DEFAULT_CONE, anchors: jobs.flatMap((job) => job.input.peaks) },
    );
    const rising = allRising.filter((entry) => entry.value > 1 + 1e-9);
    checks.push(
        check(
            "fluesse_fallen",
            rising.length === 0,
            `${String(rivers.rivers.length - rising.length)} von ${String(rivers.rivers.length)} Flussläufen fallen in Fließrichtung (${String(atPeaks.length)} steigen nur an einem Gipfel, Befund)`,
            rising.map((entry) => `${entry.name} (${entry.id}): +${entry.value.toFixed(0)} Schritt`),
        ),
    );

    const [current] = await database<{ revision: string; tiles: number }[]>`
        SELECT revision, tiles FROM terrain_dem WHERE map_domain_id = ${mapDomainId} AND is_current
    `;
    const [currents] = await database<{ count: number }[]>`
        SELECT count(*)::int AS count FROM terrain_dem WHERE map_domain_id = ${mapDomainId} AND is_current
    `;
    checks.push(
        check("eine_aktuelle_revision", currents?.count === 1, `${String(currents?.count ?? 0)} aktuelle Revisionen`),
    );

    const tiles = current
        ? await database<DemTile[]>`
              SELECT z, x, y, png AS image FROM terrain_dem_tile WHERE revision = ${current.revision} ORDER BY z DESC, y, x
          `
        : [];
    // Dieselbe Reihenfolge wie beim Bau (z absteigend, dann Zeile, dann Spalte), sonst ist der Hash ein anderer.
    let expectedTiles = 0;
    for (let z = 0; z <= DEM_MAX_ZOOM; z += 1) expectedTiles += 4 ** z;
    const sameContent =
        current !== undefined && tiles.length === expectedTiles && demRevision(tiles) === current.revision;
    checks.push(
        check(
            "kacheln_vollstaendig",
            sameContent,
            `${String(tiles.length)} von ${String(expectedTiles)} Kacheln, Inhalt ${sameContent ? "passt" : "passt NICHT"} zur Revision`,
        ),
    );

    // Jeder freie Gipfel steht in den Kacheln als Berg (Betreiber 2026-09-27); gemessen an der feinsten Stufe.
    const flat: string[] = [];
    const tileAt = new Map(
        tiles.filter((tile) => tile.z === DEM_MAX_ZOOM).map((tile) => [`${String(tile.x)}/${String(tile.y)}`, tile]),
    );
    const decoded = new Map<DemTile, Uint8Array>();
    const raw = (tile: DemTile): Uint8Array => {
        const known = decoded.get(tile) ?? decodeTileImage(tile.image).rgb;
        decoded.set(tile, known);
        return known;
    };
    const size = DEM_TILE_SIZE << DEM_MAX_ZOOM;
    for (const peak of freePeaks) {
        const gx = Math.min(size - 1, Math.floor((peak.x / 1024) * size));
        const gy = Math.min(size - 1, Math.floor(((1024 - peak.y) / 1024) * size));
        const tile = tileAt.get(`${String(Math.floor(gx / DEM_TILE_SIZE))}/${String(Math.floor(gy / DEM_TILE_SIZE))}`);
        const mercatorY = WEB_MERCATOR_HALF_WORLD - ((gy + 0.5) / size) * 2 * WEB_MERCATOR_HALF_WORLD;
        const latitude = 2 * Math.atan(Math.exp((mercatorY / WEB_MERCATOR_HALF_WORLD) * Math.PI)) - Math.PI / 2;
        // Das Pixel liegt bis zu einer halben Zelle neben dem Gipfel; ein schmaler Kegel ist dort
        // schon deutlich niedriger. Gemessen wird deshalb das Höchste der 3×3 Pixel ringsum.
        let got = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
                const px = (gx % DEM_TILE_SIZE) + dx;
                const py = (gy % DEM_TILE_SIZE) + dy;
                if (tile && px >= 0 && py >= 0 && px < DEM_TILE_SIZE && py < DEM_TILE_SIZE) {
                    got = Math.max(got, heightInTile(raw(tile), px, py, latitude));
                }
            }
        }
        const want = freePeakHeight({ x: peak.x, y: peak.y, h: peak.height_schritt });
        if (got < 0.5 * want) {
            flat.push(`${peak.name}: ${got.toFixed(0)} statt ${String(want)}`);
        }
    }
    checks.push(
        check(
            "freie_gipfel_stehen",
            flat.length === 0,
            `${String(freePeaks.length - flat.length)} von ${String(freePeaks.length)} freien Gipfeln stehen als Berg in den Kacheln`,
            flat,
        ),
    );

    // Die Wegprofile (S5a): jeder aktive Landweg mit einem Profil zu seiner heutigen Geometrie und zum heutigen Höhenstand
    // seiner Raster und freien Gipfel (`pathHeightFingerprint`, WI-0059: je Weg, nicht mehr über alle Raster), mit
    // Abtastwerten (S5c). Sonst rechnet der Router für einen Teil der Wege mit altem Gelände, oder Reittier und Wagen
    // gehen dort wie zu Fuß.
    const heightRasters = jobs.flatMap((job) => {
        const row = byArea.get(job.areaId);
        if (!row) return [];
        const raster = {
            cell: row.cell,
            originX: row.origin_x,
            originY: row.origin_y,
            width: row.width,
            height: row.height,
            samples: new Uint16Array(
                row.samples.buffer.slice(row.samples.byteOffset, row.samples.byteOffset + row.samples.byteLength),
            ),
        };
        const bounds = job.input.bounds;
        return [
            {
                raster,
                geometry: job.input.geometry,
                bounds: { minX: bounds.min_x, minY: bounds.min_y, maxX: bounds.max_x, maxY: bounds.max_y },
                fingerprint: rasterContentKey(raster),
            },
        ];
    });
    const heightSource = { rasters: heightRasters, peaks: freePeaksNow, rule: DEFAULT_CONE, continental };
    // Derselbe Maßstab wie die Ableitung (WI-0153 Schnitt 7d).
    const schritt = await leseMassstab(database);
    const profiles = await database<
        {
            name: string;
            state: string;
            min_x: number;
            min_y: number;
            max_x: number;
            max_y: number;
        }[]
    >`
        SELECT p.name,
               CASE WHEN t.path_id IS NULL THEN 'fehlt'
                    WHEN t.geometry_md5 <> md5(ST_AsBinary(p.geom)) THEN 'veraltet'
                    WHEN t.samples IS NULL THEN 'ohne Abtastwerte'
                    ELSE t.height_fingerprint END AS state,
               ST_XMin(p.geom) AS min_x, ST_YMin(p.geom) AS min_y, ST_XMax(p.geom) AS max_x, ST_YMax(p.geom) AS max_y
        FROM path p LEFT JOIN terrain_path_profile t ON t.path_id = p.id
        WHERE p.map_domain_id = ${mapDomainId} AND p.is_active
          AND p.subtype IN ('Reichsstrasse', 'Strasse', 'Weg', 'Pfad', 'Gebirgspass', 'Wuestenpfad')
    `;
    const flawed = (row: (typeof profiles)[number]): string | null => {
        if (["fehlt", "veraltet", "ohne Abtastwerte"].includes(row.state)) return row.state;
        const wantedState = pathHeightFingerprint(
            { minX: row.min_x, minY: row.min_y, maxX: row.max_x, maxY: row.max_y },
            heightSource,
            AVENTURIA_TRAVEL_MODEL,
            schritt,
        );
        return row.state === wantedState ? null : "anderer Höhenstand";
    };
    const bad = profiles.flatMap((row) => {
        const why = flawed(row);
        return why === null ? [] : [`${row.name}: ${why}`];
    });
    checks.push(
        check(
            "wegprofile_aktuell",
            bad.length === 0,
            `${String(profiles.length - bad.length)} von ${String(profiles.length)} Landwegen mit aktuellem Profil zum Höhenstand ihrer Raster`,
            bad,
        ),
    );

    return { passed: checks.every((entry) => entry.passed), checks };
}
