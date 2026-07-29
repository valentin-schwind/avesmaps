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
