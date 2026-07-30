<?php

declare(strict_types=1);

// V11: the store behind the Landschaften editor's terrain buttons.
// Spec: docs/superpowers/specs/2026-07-29-landschaften-v11-gelaende-reisezeiten-design.md
//
// PURITY CONTRACT (mirrors path-ecosystem.php): side-effect-free on include -- only const and
// function definitions, no DB connect, no headers. The offline-decidable half (the write guards,
// the fingerprint composition) is pure and unit-tested; the DB half takes a PDO explicitly.
//
// 💣 NO avesmapsEcosystemEnsureTables ANYWHERE IN THIS FILE. Its information_schema probes are the
// load of the pool incident of 2026-07-17, and DDL inside a transaction commits it silently. The
// tables come into being on the area read/write paths, long before anyone presses a button.

// ⚠️ avesmapsUuidV4 (features.php) and avesmapsPathEcosystemTokenMatches (path-ecosystem.php) are
// NOT required here on purpose: the dispatcher api/edit/map/ecosystem.php loads both before this
// file, and requiring them would drag ecosystem.php's DDL into this include tree. The routing path
// includes heightmap.php, never this file.

// The ONE resolution the whole feature integrates height at, in map units. It is NOT a per-request
// knob, and that is a deliberate departure from owner decision 8 (spec §5.3): the ascent over
// fractal ground is a TOTAL VARIATION and grows with sampling density -- x sqrt(2) per halving at a
// Hurst exponent near 0.5. A per-request resolution would mean a different ascent_schritt for the
// same ground, so either the knob does nothing or every request bypasses the cache.
const AVESMAPS_TERRAIN_CELL_SIZE = 0.25;

// 1 map unit = 3.000 Schritt. Written down because the unit trap is documented and expensive:
// reading a graph distance as miles overstates a gradient by 3x and the signal by 23x.
const AVESMAPS_TERRAIN_SCHRITT_PER_MAPUNIT = 3000.0;

// Pixels one area's raster may hold. The largest measured area (Finsterkamm) is ~143.000; the whole
// map at 0,25 would be 16,7 million. This is a guard against a runaway client, not a design limit:
// 4 million pixels are 8 MB raw, far inside LONGBLOB and far above anything real.
const AVESMAPS_TERRAIN_MAX_PIXELS = 4000000;

// SMALLINT UNSIGNED. 💣 Without this check MySQL SILENTLY truncates without sql_mode=STRICT, and a
// half-stored raster looks exactly like a whole one.
const AVESMAPS_TERRAIN_MAX_SIDE = 65535;

// 🔴 OWNER DECISION 2026-07-30: SLOPE IS A LAND RULE. A boat does not climb.
//
// Spec §1 decision 2 only says that `Gebirgspass` gets no exemption; it says nothing about water, and
// until this date there was no path-type gate anywhere. That was wrong twice over:
//
//  - A river is already priced by its CURRENT (`flow_time_factor`, clamped [1,0 … 3,0]). Adding a
//    slope on top bills the same gradient a second time.
//  - The gradient came from the procedural height field, which knows nothing about where a river
//    runs. Measured over the whole stock on 2026-07-30: 293 of 1.729 Flussweg pieces carried a factor
//    other than 1, and the STEEPEST piece of the entire map was a river -- the Vildrom, factor 3,6019
//    travelled upstream, steeper than every mountain pass on Aventurien.
//
// 💣 A DENY LIST, NOT AN ALLOW LIST. An allow list would silently exempt any future LAND subtype from
// terrain, and „a new way type is quietly flat" is the class of bug that hides for months. Water is
// the exception, so water is what gets named.
//
// 🔴 IT LIVES HERE, in the store, although the ROUTER is what obeys it: terrain-read.php reaches this
// file through heightmap.php anyway, so one list serves both the profile run (which stops writing
// water rows) and the routing read (which stops loading and applying them). A second copy in the
// routing layer is exactly how two sources of truth start. The predicate on top of it is
// `avesmapsRouteTerrainAppliesTo()` in api/_internal/routing/terrain-read.php.
const AVESMAPS_TERRAIN_WATER_ROUTE_TYPES = ['Flussweg', 'Seeweg'];

/**
 * PURE: the three guards of spec §5.1, all three refusing rather than repairing.
 *
 * 💣 A raster that is wrong here is INVISIBLE later: a truncated blob reads as a mountain that
 * stops halfway, and nothing downstream re-checks. Refusing is the only honest answer.
 */
function avesmapsTerrainGuardRasterShape(int $width, int $height, float $cellSize, int $byteLength): void
{
    if ($width <= 0 || $height <= 0) {
        throw new InvalidArgumentException('A raster needs a positive width and height.');
    }
    if ($width > AVESMAPS_TERRAIN_MAX_SIDE || $height > AVESMAPS_TERRAIN_MAX_SIDE) {
        throw new InvalidArgumentException('A raster side may not exceed ' . AVESMAPS_TERRAIN_MAX_SIDE . ' pixels.');
    }
    if ($width * $height > AVESMAPS_TERRAIN_MAX_PIXELS) {
        throw new InvalidArgumentException('A raster may not exceed ' . AVESMAPS_TERRAIN_MAX_PIXELS . ' pixels.');
    }
    // Coarser than the stock resolution is a loss of detail; FINER is a different measurement of the
    // same ground and would make ascent_schritt incomparable between rows (§5.3).
    if ($cellSize < AVESMAPS_TERRAIN_CELL_SIZE) {
        throw new InvalidArgumentException('cell_size must not be finer than the stock resolution ' . AVESMAPS_TERRAIN_CELL_SIZE . '.');
    }
    if ($byteLength !== $width * $height * 2) {
        throw new InvalidArgumentException('samples must hold exactly width * height * 2 bytes (uint16).');
    }
}

/**
 * PURE: what THIS area was rasterised against, apart from its geometry revision.
 *
 * geometry_revision stays its own column: it is compared on its own and reads better in a query.
 */
function avesmapsTerrainAreaFingerprint(array $areaRow): string
{
    $number = static function (mixed $value): string {
        return $value === null ? 'null' : rtrim(rtrim(sprintf('%.4F', (float) $value), '0'), '.');
    };

    return sha1(implode('|', [
        'grain=' . $number($areaRow['terrain_grain'] ?? null),
        'levels=' . ($areaRow['terrain_levels'] === null ? 'null' : (string) (int) $areaRow['terrain_levels']),
        'avg=' . $number($areaRow['terrain_avg_height'] ?? null),
        'mean=' . $number($areaRow['terrain_mean_height'] ?? null),
        // The drawing method follows the KIND (ECOSYSTEM_TERRAIN_METHOD_BY_TYPE), so a changed kind
        // is a changed field even when every knob stands still.
        'type=' . (string) ($areaRow['region_type'] ?? ''),
    ]));
}

/**
 * PURE: the GLOBAL peak state -- every peak, plus every HEIGHT-BEARING area's geometry revision.
 *
 * 💣 GLOBAL IS NOT AN OVERSIGHT, IT IS THE POINT. Two couplings reach across the whole map:
 *  1. `separationAt` has no distance limit (map-features-ecosystem-height-field.js:198-211). Delete
 *     a peak and its neighbour's separation jumps to the next one, wherever that lies -- which moves
 *     that neighbour's bump radius and, through `field.hmax` and `noiseScale`, the scaling of the
 *     whole area.
 *  2. `assignEcosystemPeaksToAreas` gives each peak to the SMALLEST CONTAINING area. A new, smaller
 *     overlapping area STEALS the old one's peaks while the old one's revision and knobs stand still.
 *
 * ⚠️ Spec §5.1 asks for the assigned area_id here. That assignment is point-in-polygon and lives only
 * in JS; carrying the height-bearing areas' geometry revisions instead covers the same set of causes
 * without a second implementation of a rule that would have to agree exactly. A lake being redrawn
 * does not appear at all -- it carries no field and cannot steal a peak.
 *
 * @param list<array{public_id:string,x:float,y:float,height_schritt:?float}> $peaks
 * @param list<array{public_id:string,geometry_revision:int}> $heightAreas
 */
function avesmapsTerrainPeaksFingerprint(array $peaks, array $heightAreas): string
{
    $peakParts = [];
    foreach ($peaks as $peak) {
        $height = $peak['height_schritt'] ?? null;
        $peakParts[] = (string) ($peak['public_id'] ?? '')
            . ':' . sprintf('%.4F', (float) ($peak['x'] ?? 0.0))
            . ':' . sprintf('%.4F', (float) ($peak['y'] ?? 0.0))
            . ':' . ($height === null ? 'null' : sprintf('%.2F', (float) $height));
    }
    $areaParts = [];
    foreach ($heightAreas as $area) {
        $areaParts[] = (string) ($area['public_id'] ?? '') . ':' . (int) ($area['geometry_revision'] ?? 0);
    }
    // Sorted, so the order rows arrive in cannot change the answer -- the same reason
    // assignEcosystemPeaksToAreas breaks ties by public_id rather than by load order.
    sort($peakParts);
    sort($areaParts);

    return sha1(implode('|', $peakParts) . '#' . implode('|', $areaParts));
}

// ---- the raster store ------------------------------------------------------------------------
// 💣 STILL NO EnsureTables. See the note at the top of this file.

/** Peaks and height-bearing areas, in the shape the two fingerprints want. */
function avesmapsTerrainReadStampInputs(PDO $pdo): array
{
    $peaks = [];
    // 💣 THE SUBTYPE LIST IS THE MODULE'S, NOT A THIRD ONE. `berggipfel` and `vulkan` are what
    // ECOSYSTEM_PEAK_SUBTYPES in map-features-ecosystem-height-field.js reads, and what
    // AVESMAPS_PEAK_LABEL_SUBTYPES in api/edit/map/peaks-geometry.php already repeats for the same
    // reason -- PHP cannot read the JS constant. Repeated here WITH this note, so the next change
    // touches all three.
    $statement = $pdo->query(
        "SELECT public_id, geometry_json, properties_json FROM map_features
          WHERE feature_type = 'label' AND is_active = 1
            AND feature_subtype IN ('berggipfel', 'vulkan')"
    );
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $geometry = json_decode((string) $row['geometry_json'], true);
        $coordinates = is_array($geometry) ? ($geometry['coordinates'] ?? null) : null;
        if (!is_array($coordinates) || count($coordinates) < 2) {
            continue;
        }
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
        $rawHeight = is_array($properties) ? ($properties['height_schritt'] ?? null) : null;
        $peaks[] = [
            'public_id' => (string) $row['public_id'],
            'x' => (float) $coordinates[0],
            'y' => (float) $coordinates[1],
            'height_schritt' => is_numeric($rawHeight) && (float) $rawHeight > 0.0 ? (float) $rawHeight : null,
        ];
    }

    // Which areas carry a height field at all: the gate is region_type = 'gebirge'
    // (map-features-ecosystem-loader.js:330 and -height-render.js). `huegelland: "warp"` already
    // stands written in -height-combine.js:57 and waits for the gate to open -- when it does, this
    // list grows HERE and nowhere else.
    $heightAreas = [];
    $statement = $pdo->query(
        "SELECT a.public_id, a.geometry_revision FROM ecosystem_area a
           INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
          WHERE a.is_active = 1 AND r.kind = 'topographie' AND r.region_type = 'gebirge'"
    );
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $heightAreas[] = [
            'public_id' => (string) $row['public_id'],
            'geometry_revision' => (int) $row['geometry_revision'],
        ];
    }

    return ['peaks' => $peaks, 'height_areas' => $heightAreas];
}

/**
 * Store ONE area's raster. 🔴 ONE REQUEST PER AREA (§3.3).
 *
 * 78 areas would be 5,25 MB raw and 7,0 MB base64 in one request -- over the usual post_max_size of
 * 8 MB. Per area it is at most 286 KB raw. And an abort no longer voids the whole stock: the areas
 * already written stand.
 *
 * 💣 THE SERVER STAMPS, NOT THE CLIENT. Both fingerprints are derived here, from this database --
 * a client-supplied stamp could claim currency the raster does not have, and nothing downstream
 * re-checks.
 */
function avesmapsTerrainHeightmapPut(PDO $pdo, array $payload, int $userId): array
{
    $areaPublicId = avesmapsNormalizeSingleLine((string) ($payload['area'] ?? ''), 36);
    if ($areaPublicId === '') {
        throw new InvalidArgumentException('area must be a public id.');
    }
    $width = filter_var($payload['width'] ?? null, FILTER_VALIDATE_INT);
    $height = filter_var($payload['height'] ?? null, FILTER_VALIDATE_INT);
    $cell = filter_var($payload['cell_size'] ?? null, FILTER_VALIDATE_FLOAT);
    $originX = filter_var($payload['origin_x'] ?? null, FILTER_VALIDATE_FLOAT);
    $originY = filter_var($payload['origin_y'] ?? null, FILTER_VALIDATE_FLOAT);
    if ($width === false || $height === false || $cell === false || $originX === false || $originY === false) {
        throw new InvalidArgumentException('width, height, cell_size, origin_x and origin_y are required.');
    }
    $samples = base64_decode((string) ($payload['samples'] ?? ''), true);
    if ($samples === false) {
        throw new InvalidArgumentException('samples must be base64.');
    }
    avesmapsTerrainGuardRasterShape((int) $width, (int) $height, (float) $cell, strlen($samples));

    $statement = $pdo->prepare(
        "SELECT a.id, a.geometry_revision, r.region_type
           FROM ecosystem_area a
           INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
          WHERE a.public_id = :p AND a.is_active = 1 LIMIT 1"
    );
    $statement->execute(['p' => $areaPublicId]);
    $areaRow = $statement->fetch(PDO::FETCH_ASSOC);
    if ($areaRow === false) {
        // Dropped, not thrown: between computing and saving, an editor in another window may have
        // deleted the area. Losing the run over it would be the wrong trade -- the count travels back.
        return ['written' => 0, 'skipped' => 1];
    }
    $knobs = $pdo->prepare(
        'SELECT terrain_grain, terrain_levels, terrain_avg_height, terrain_mean_height
           FROM ecosystem_area WHERE id = :id'
    );
    $knobs->execute(['id' => (int) $areaRow['id']]);
    $areaRow += (array) $knobs->fetch(PDO::FETCH_ASSOC);

    $inputs = avesmapsTerrainReadStampInputs($pdo);
    $insert = $pdo->prepare(
        'INSERT INTO ecosystem_area_heightmap
             (area_id, cell_size_mapunits, origin_x, origin_y, width_px, height_px, samples,
              sample_bytes, geometry_revision, terrain_fingerprint, peaks_fingerprint, computed_by)
         VALUES (:area, :cell, :ox, :oy, :w, :h, :blob, :bytes, :rev, :terrain, :peaks, :user)
         ON DUPLICATE KEY UPDATE cell_size_mapunits = VALUES(cell_size_mapunits),
             origin_x = VALUES(origin_x), origin_y = VALUES(origin_y),
             width_px = VALUES(width_px), height_px = VALUES(height_px),
             samples = VALUES(samples), sample_bytes = VALUES(sample_bytes),
             geometry_revision = VALUES(geometry_revision),
             terrain_fingerprint = VALUES(terrain_fingerprint),
             peaks_fingerprint = VALUES(peaks_fingerprint),
             computed_by = VALUES(computed_by), computed_at = CURRENT_TIMESTAMP(3)'
    );
    // Deflate HERE, not in the browser: smooth 16-bit terrain and the empty bbox corners (60 to 70 %
    // of the area on a diagonal range) give a typical 3 to 6x, and it spares a compression-format
    // agreement between CompressionStream and PHP's zlib.
    $compressed = gzdeflate($samples, 6);
    $insert->execute([
        'area' => (int) $areaRow['id'], 'cell' => $cell, 'ox' => $originX, 'oy' => $originY,
        'w' => (int) $width, 'h' => (int) $height,
        'blob' => $compressed, 'bytes' => strlen($samples),
        'rev' => (int) $areaRow['geometry_revision'],
        'terrain' => avesmapsTerrainAreaFingerprint($areaRow),
        'peaks' => avesmapsTerrainPeaksFingerprint($inputs['peaks'], $inputs['height_areas']),
        'user' => $userId > 0 ? $userId : null,
    ]);

    return ['written' => 1, 'skipped' => 0, 'stored_bytes' => strlen($compressed)];
}

/**
 * §5.7: rasters of areas that are gone or no longer carry a field.
 *
 * Without it every „load all rasters" drags blobs of deleted areas along -- and the row goes on
 * claiming validity.
 */
function avesmapsTerrainHeightmapCleanup(PDO $pdo): array
{
    $removed = $pdo->exec(
        "DELETE h FROM ecosystem_area_heightmap h
           LEFT JOIN ecosystem_area a ON a.id = h.area_id AND a.is_active = 1
           LEFT JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
                 AND r.kind = 'topographie' AND r.region_type = 'gebirge'
          WHERE a.id IS NULL OR r.id IS NULL"
    );

    return ['removed' => (int) $removed];
}

/**
 * Per area: is there a raster, and does its stamp still match? For the tile, and for the acceptance.
 *
 * „Stale" is a COMPARISON, never a guess.
 */
function avesmapsTerrainHeightmapStatus(PDO $pdo): array
{
    $inputs = avesmapsTerrainReadStampInputs($pdo);
    $currentPeaks = avesmapsTerrainPeaksFingerprint($inputs['peaks'], $inputs['height_areas']);

    $statement = $pdo->query(
        "SELECT a.public_id, a.geometry_revision, r.name AS region_name, r.region_type,
                a.terrain_grain, a.terrain_levels, a.terrain_avg_height, a.terrain_mean_height,
                h.geometry_revision AS stamped_revision, h.terrain_fingerprint, h.peaks_fingerprint,
                h.width_px, h.height_px, h.sample_bytes, h.computed_at
           FROM ecosystem_area a
           INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
           LEFT JOIN ecosystem_area_heightmap h ON h.area_id = a.id
          WHERE a.is_active = 1 AND r.kind = 'topographie' AND r.region_type = 'gebirge'
          ORDER BY r.name, a.public_id"
    );

    $areas = [];
    $missing = 0;
    $stale = 0;
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $hasRaster = $row['terrain_fingerprint'] !== null;
        $isStale = $hasRaster && (
            (int) $row['stamped_revision'] !== (int) $row['geometry_revision']
            || (string) $row['terrain_fingerprint'] !== avesmapsTerrainAreaFingerprint($row)
            || (string) $row['peaks_fingerprint'] !== $currentPeaks
        );
        if (!$hasRaster) { $missing++; } elseif ($isStale) { $stale++; }
        $areas[] = [
            'public_id' => (string) $row['public_id'],
            'region_name' => (string) $row['region_name'],
            'has_raster' => $hasRaster,
            'stale' => $isStale,
            'width_px' => $hasRaster ? (int) $row['width_px'] : 0,
            'height_px' => $hasRaster ? (int) $row['height_px'] : 0,
            'sample_bytes' => $hasRaster ? (int) $row['sample_bytes'] : 0,
            'computed_at' => $hasRaster ? (string) $row['computed_at'] : '',
        ];
    }

    return [
        'areas' => $areas,
        'area_count' => count($areas),
        'missing' => $missing,
        'stale' => $stale,
        'peaks_with_height' => count(array_filter($inputs['peaks'], static fn(array $p): bool => $p['height_schritt'] !== null)),
        'peaks_total' => count($inputs['peaks']),
    ];
}

// ---- the profile derivation --------------------------------------------------------------------

// Ways per step. With a 4 s wall-clock budget on top, whichever comes first. The whole run is a
// handful of requests, and each stays far inside a FastCGI limit.
const AVESMAPS_TERRAIN_PROFILE_BATCH = 400;
const AVESMAPS_TERRAIN_PROFILE_BUDGET_MS = 4000;

/**
 * PURE: walk a line over the summed rasters and add up climb and fall.
 *
 * 🔴 THE LINE IS THE CHORD, not the drawn Catmull-Rom curve. Everything that turns these numbers
 * into a time measures on the raw support points -- avesmapsCalculateClientRouteCoordinateDistance
 * sums plain hypot over the STORED vertices, and that is what the graph distance, the travel time
 * and the legs are made of. A curve length would be a different measure system for the same name.
 *
 * 🔴 SAMPLED EVERY AVESMAPS_TERRAIN_CELL_SIZE ALONG THE SEGMENT, never just at its ends. The ascent
 * is a total variation and grows with sampling density (§5.3); a fixed integration step is what
 * makes one row comparable with the next, and with A* later.
 *
 * ⚠️ This is more work than spec §5.4 estimated (it counted 72.278 points = two per segment; a
 * 0,25-step walk over 36.139 segments of mean length 1,436 is closer to 207.000). At a measured
 * 0,08 microseconds per punctual read that is ~17 ms of sampling for the whole stock -- and almost
 * every way skips it entirely, because its bbox touches no raster at all.
 *
 * Returns null when the line touches no raster anywhere: „no height data", NOT level ground.
 *
 * @return array{ascent:float,descent:float,profile:list<array{0:float,1:float}>,samples:int}|null
 */
function avesmapsTerrainProfileForLine(array $rasters, array $coordinates): ?array
{
    $count = count($coordinates);
    if ($count < 2 || $rasters === []) {
        return null;
    }

    $profile = [];
    $totalUp = 0.0;
    $totalDown = 0.0;
    $sampleCount = 0;
    $touched = false;

    for ($index = 0; $index < $count - 1; $index++) {
        $from = $coordinates[$index];
        $to = $coordinates[$index + 1];
        if (!is_array($from) || !is_array($to) || count($from) < 2 || count($to) < 2) {
            $profile[] = [0.0, 0.0];
            continue;
        }
        $fromX = (float) $from[0]; $fromY = (float) $from[1];
        $toX = (float) $to[0]; $toY = (float) $to[1];
        $length = hypot($toX - $fromX, $toY - $fromY);
        // At least the two ends; otherwise one sample per cell along the segment.
        $steps = max(1, (int) ceil($length / AVESMAPS_TERRAIN_CELL_SIZE));

        $up = 0.0;
        $down = 0.0;
        $previous = null;
        for ($step = 0; $step <= $steps; $step++) {
            $t = $steps > 0 ? $step / $steps : 0.0;
            // 💣 THE READER SUMS over every raster covering the point (§5.0). Each raster holds only
            // its area's OWN field; reading „the one that contains the point" gives a height that is
            // too low in every overlap strip, and shows nothing unusual doing it.
            $height = avesmapsHeightmapSampleSum($rasters, $fromX + ($toX - $fromX) * $t, $fromY + ($toY - $fromY) * $t);
            $sampleCount++;
            if ($height === null) {
                // A gap in coverage breaks the chain rather than inventing a step down to nothing.
                $previous = null;
                continue;
            }
            $touched = true;
            if ($previous !== null) {
                $delta = $height - $previous;
                if ($delta > 0.0) { $up += $delta; } else { $down -= $delta; }
            }
            $previous = $height;
        }
        $profile[] = [round($up, 2), round($down, 2)];
        $totalUp += $up;
        $totalDown += $down;
    }

    if (!$touched) {
        return null;
    }

    return [
        'ascent' => round($totalUp, 2),
        'descent' => round($totalDown, 2),
        'profile' => $profile,
        'samples' => $sampleCount,
    ];
}

/** Start a profile run: a token, a cursor at zero, the raster stamp this run describes. */
function avesmapsTerrainProfileBegin(PDO $pdo, int $userId): array
{
    $runToken = avesmapsUuidV4();
    $stamp = avesmapsHeightmapGlobalStamp($pdo);

    // Orphans first: a path_terrain row whose way is gone would otherwise be dragged along forever.
    $pdo->exec(
        'DELETE t FROM path_terrain t
           LEFT JOIN map_features f ON f.id = t.path_id AND f.is_active = 1 AND f.feature_type = \'path\'
          WHERE f.id IS NULL'
    );

    // And water, for the same reason: since the owner decision of 2026-07-30 the router never applies
    // these rows (AVESMAPS_TERRAIN_WATER_ROUTE_TYPES), and the step below stops writing them. Left
    // standing they would be worse than useless -- never refreshed, so drifting out of revision, and
    // still costing a fetch until the read filter catches them. 150 of 583 rows on 2026-07-30.
    $waterPlaceholders = implode(', ', array_fill(0, count(AVESMAPS_TERRAIN_WATER_ROUTE_TYPES), '?'));
    $deleteWater = $pdo->prepare(
        'DELETE t FROM path_terrain t
           JOIN map_features f ON f.id = t.path_id
          WHERE f.feature_subtype IN (' . $waterPlaceholders . ')'
    );
    $deleteWater->execute(array_values(AVESMAPS_TERRAIN_WATER_ROUTE_TYPES));

    // 🔴 The rows are NOT cleared. Unlike V9's run, every row here carries its OWN validity
    // (path_revision + heightmap_stamp), so a half-finished run leaves a usable mixture rather than
    // a hole -- and an interrupted run can simply be continued.
    $statement = $pdo->prepare(
        'INSERT INTO path_terrain_stamp
             (id, run_token, heightmap_stamp, cursor_path_id, ways_seen, ways_with_profile, duration_ms, completed, computed_by)
         VALUES (1, :token, :stamp, 0, 0, 0, 0, 0, :user)
         ON DUPLICATE KEY UPDATE run_token = VALUES(run_token), heightmap_stamp = VALUES(heightmap_stamp),
             cursor_path_id = 0, ways_seen = 0, ways_with_profile = 0, duration_ms = 0, completed = 0,
             computed_by = VALUES(computed_by), computed_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute(['token' => $runToken, 'stamp' => $stamp, 'user' => $userId > 0 ? $userId : null]);

    // The same water exclusion as the step below, or the tile's „x of y" would count ways the run
    // deliberately skips and never reach 100 %.
    $countWays = $pdo->prepare(
        "SELECT COUNT(*) FROM map_features
          WHERE feature_type = 'path' AND is_active = 1
            AND feature_subtype NOT IN (" . $waterPlaceholders . ')'
    );
    $countWays->execute(array_values(AVESMAPS_TERRAIN_WATER_ROUTE_TYPES));
    $total = (int) $countWays->fetchColumn();

    return ['run_token' => $runToken, 'heightmap_stamp' => $stamp, 'ways_total' => $total];
}

/**
 * One step of the run: up to AVESMAPS_TERRAIN_PROFILE_BATCH ways past the cursor, or 4 s, whichever
 * comes first.
 *
 * 💣 A CURSOR, NOT AN OFFSET. `LIMIT ... OFFSET` re-reads everything before it on every step; over a
 * whole run that is quadratic. The cursor is the last id written.
 *
 * 💣 The token is what a GET_LOCK cannot do here: a connection-scoped lock dies with its request and
 * a run spans many. Two editors running at once would otherwise interleave their steps. The second
 * `begin` wins the token and the first one's next step gets a clean 409.
 */
function avesmapsTerrainProfileStep(PDO $pdo, array $payload): array
{
    $offered = trim((string) ($payload['run_token'] ?? ''));
    $row = $pdo->query('SELECT run_token, heightmap_stamp, cursor_path_id, ways_seen, ways_with_profile, duration_ms FROM path_terrain_stamp WHERE id = 1')
        ->fetch(PDO::FETCH_ASSOC);
    if ($row === false || !avesmapsPathEcosystemTokenMatches($row['run_token'] ?? null, $offered)) {
        avesmapsErrorResponse(409, 'run_token_stale', 'Another terrain profile run has started. Start over.');
    }

    // Loaded ONCE per step, not per way. At 15 areas that is ~1 MB of blob and stays a string.
    $rasters = avesmapsHeightmapLoadAll($pdo);
    $stamp = (string) $row['heightmap_stamp'];
    $cursor = (int) $row['cursor_path_id'];
    $startedMs = (int) (microtime(true) * 1000);

    // 🔴 Water is skipped, not merely ignored later: since the owner decision of 2026-07-30 the router
    // never applies these rows, so computing them would be a raster walk over 1.807 of 4.300 pieces
    // for nothing. `begin` has already deleted the ones that were written before that.
    $waterPlaceholders = implode(', ', array_fill(0, count(AVESMAPS_TERRAIN_WATER_ROUTE_TYPES), '?'));
    $statement = $pdo->prepare(
        "SELECT id, revision, geometry_json, min_x, min_y, max_x, max_y
           FROM map_features
          WHERE feature_type = 'path' AND is_active = 1 AND id > ?
            AND feature_subtype NOT IN (" . $waterPlaceholders . ')
          ORDER BY id LIMIT ' . AVESMAPS_TERRAIN_PROFILE_BATCH
    );
    $statement->execute(array_merge([$cursor], array_values(AVESMAPS_TERRAIN_WATER_ROUTE_TYPES)));
    $ways = $statement->fetchAll(PDO::FETCH_ASSOC);

    $insert = $pdo->prepare(
        'INSERT INTO path_terrain (path_id, ascent_schritt, descent_schritt, profile_json, path_revision, heightmap_stamp)
         VALUES (:path, :ascent, :descent, :profile, :rev, :stamp)
         ON DUPLICATE KEY UPDATE ascent_schritt = VALUES(ascent_schritt), descent_schritt = VALUES(descent_schritt),
             profile_json = VALUES(profile_json), path_revision = VALUES(path_revision),
             heightmap_stamp = VALUES(heightmap_stamp), computed_at = CURRENT_TIMESTAMP(3)'
    );

    $seen = 0;
    $withProfile = 0;
    foreach ($ways as $way) {
        $cursor = (int) $way['id'];
        $seen++;
        // The cheap pre-filter: does this way's bbox touch ANY raster? Most ways touch none, and
        // then there is nothing to walk.
        $touchesRaster = false;
        foreach ($rasters as $raster) {
            if (!((float) $way['max_x'] < $raster['min_x'] || $raster['max_x'] < (float) $way['min_x']
                || (float) $way['max_y'] < $raster['min_y'] || $raster['max_y'] < (float) $way['min_y'])) {
                $touchesRaster = true;
                break;
            }
        }
        $profile = null;
        if ($touchesRaster) {
            $geometry = json_decode((string) $way['geometry_json'], true);
            $coordinates = is_array($geometry) && ($geometry['type'] ?? '') === 'LineString'
                && is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [];
            $profile = avesmapsTerrainProfileForLine($rasters, $coordinates);
        }
        // 💣 NULL, NEVER 0. „No height data" and „measured and level" are two different statements,
        // and with 51 of 67 peaks carrying no height the first one is the common case.
        $insert->execute([
            'path' => (int) $way['id'],
            'ascent' => $profile === null ? null : (int) round($profile['ascent']),
            'descent' => $profile === null ? null : (int) round($profile['descent']),
            'profile' => $profile === null ? null : json_encode($profile['profile']),
            // 🔴 The way's OWN revision, NOT map_revision. map_revision is a global counter bumped by
            // settlement, label, source and sync writes -- and peaks are `berggipfel` LABELS in
            // map_features, so entering one peak height would invalidate all 5.655 rows in one go.
            'rev' => (int) $way['revision'],
            'stamp' => $stamp,
        ]);
        if ($profile !== null) {
            $withProfile++;
        }
        if ((int) (microtime(true) * 1000) - $startedMs > AVESMAPS_TERRAIN_PROFILE_BUDGET_MS) {
            break;
        }
    }

    $done = count($ways) < AVESMAPS_TERRAIN_PROFILE_BATCH && $seen === count($ways);
    $update = $pdo->prepare(
        'UPDATE path_terrain_stamp
            SET cursor_path_id = :cursor, ways_seen = ways_seen + :seen,
                ways_with_profile = ways_with_profile + :hit,
                duration_ms = duration_ms + :ms, completed = :done,
                computed_at = CURRENT_TIMESTAMP(3)
          WHERE id = 1'
    );
    $elapsed = (int) (microtime(true) * 1000) - $startedMs;
    $update->execute([
        'cursor' => $cursor, 'seen' => $seen, 'hit' => $withProfile,
        'ms' => max(0, $elapsed), 'done' => $done ? 1 : 0,
    ]);

    return [
        'done' => $done,
        'cursor' => $cursor,
        'seen' => $seen,
        'with_profile' => $withProfile,
        'elapsed_ms' => max(0, $elapsed),
    ];
}

/** The stamp plus the CURRENT raster stamp, so the tile can say „veraltet" without a second request. */
function avesmapsTerrainProfileStatus(PDO $pdo): array
{
    $row = $pdo->query('SELECT * FROM path_terrain_stamp WHERE id = 1')->fetch(PDO::FETCH_ASSOC);
    $rows = (int) $pdo->query('SELECT COUNT(*) FROM path_terrain')->fetchColumn();
    // The HARD COUNTER of §9.2 step 2: how many ways actually carry a profile. Without it a green
    // „switch off is bit-identical" says nothing -- it is also green when every lookup missed.
    $withProfile = (int) $pdo->query('SELECT COUNT(*) FROM path_terrain WHERE ascent_schritt IS NOT NULL')->fetchColumn();

    return [
        'stamp' => $row === false ? null : [
            'heightmap_stamp' => (string) $row['heightmap_stamp'],
            'cursor_path_id' => (int) $row['cursor_path_id'],
            'ways_seen' => (int) $row['ways_seen'],
            'ways_with_profile' => (int) $row['ways_with_profile'],
            'duration_ms' => (int) $row['duration_ms'],
            'completed' => (int) $row['completed'] === 1,
            'computed_at' => (string) $row['computed_at'],
        ],
        'rows' => $rows,
        'rows_with_profile' => $withProfile,
        'current_heightmap_stamp' => avesmapsHeightmapGlobalStamp($pdo),
    ];
}

/**
 * The owner switch „Geländeabhängiges Reisen".
 *
 * 🔴 AN heisst FÜR ALLE (owner decision 1: „ist es AN wird es für alle berechnet") -- no test
 * parameter, no quiet rollout. AUS heisst line for line today's numbers.
 *
 * 💣 IT IS AN EMERGENCY STOP, AND THE API SWITCH IS NOT ITS EQUAL. `terrain: false` in a request
 * may only switch OFF; global OFF always wins. Otherwise a stranger could switch on what the owner
 * switched off, and the emergency stop would not be one.
 *
 * The DDL runs HERE, on the owner's deliberate action -- never on a read path.
 */
function avesmapsTerrainTravelSet(PDO $pdo, bool $enabled): array
{
    avesmapsAppSettingEnsureTable($pdo);
    avesmapsAppSettingSet($pdo, 'terrain_travel_enabled', $enabled ? '1' : '0');

    return ['terrain_travel_enabled' => $enabled];
}

function avesmapsTerrainTravelStatus(PDO $pdo): array
{
    return ['terrain_travel_enabled' => avesmapsAppSettingGetWithoutDdl($pdo, 'terrain_travel_enabled', '0') !== '0'];
}
