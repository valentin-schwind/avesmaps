<?php

declare(strict_types=1);

// V11: reading the stored height rasters. Spec §3, §5.0, §5.4.
//
// PURITY CONTRACT: side-effect-free on include. The sampling half is pure and takes decoded raster
// arrays; the DB half takes a PDO explicitly.
//
// 💣 NO DDL, NO information_schema PROBE. This file only reads.
//
// 🔴 WHO READS THIS, AND WHO DOES NOT. The PROFILE RUN reads rasters (task 8). The ROUTING PATH
// never does -- it reads path_terrain and nothing else. Loading all rasters per route request is
// exactly what the derived cache exists to prevent.

require_once __DIR__ . '/terrain-store.php';

/**
 * PURE: one DB row -> a usable raster, with the blob left as a BINARY STRING.
 *
 * 💣 THE BLOB IS NEVER MATERIALISED AS A PHP ARRAY. Measured: unpack('v*') returns a 1-based,
 * unpacked array at 43 bytes per element -- 5,25 MB of blob become 42 to 95 MB of PHP at 78 areas.
 * A single point is read punctually instead, at a measured 0,08 microseconds and no extra memory.
 *
 * Refuses rather than repairs (§5.1): a truncated raster looks exactly like a whole one.
 */
function avesmapsHeightmapDecode(array $row): array
{
    $width = (int) ($row['width_px'] ?? 0);
    $height = (int) ($row['height_px'] ?? 0);
    $cell = (float) ($row['cell_size_mapunits'] ?? 0.0);

    $stored = (string) ($row['samples'] ?? '');
    // @ because gzinflate warns on garbage; the false return is the signal we act on.
    $samples = $stored === '' ? false : @gzinflate($stored);
    if ($samples === false) {
        throw new InvalidArgumentException('The raster blob could not be decompressed.');
    }
    avesmapsTerrainGuardRasterShape($width, $height, $cell, strlen($samples));

    return [
        'origin_x' => (float) ($row['origin_x'] ?? 0.0),
        'origin_y' => (float) ($row['origin_y'] ?? 0.0),
        'cell' => $cell,
        'width' => $width,
        'height' => $height,
        'samples' => $samples,
    ];
}

/**
 * PURE: read ONE sample, punctually, out of the binary string.
 *
 * ⚠️ Bilinear, not nearest. Nearest would quantise the height to the cell grid, and the ascent is a
 * TOTAL VARIATION -- a staircase would add or remove climb depending purely on where the way's
 * vertices fall inside a cell. At a grid point bilinear returns the stored value exactly, which is
 * what lets the test compare against a browser-produced blob.
 */
function avesmapsHeightmapSampleRaw(array $raster, int $col, int $row): float
{
    // 💣 unpack with an OFFSET, one element -- never unpack('v*') over the whole string.
    $offset = 2 * ($row * $raster['width'] + $col);

    return (float) unpack('v', $raster['samples'], $offset)[1];
}

function avesmapsHeightmapSampleOne(array $raster, float $x, float $y): ?float
{
    $cell = $raster['cell'];
    if ($cell <= 0.0) {
        return null;
    }
    $fx = ($x - $raster['origin_x']) / $cell;
    $fy = ($y - $raster['origin_y']) / $cell;
    // Outside is „no data", NOT 0 -- a point beyond every bbox is unknown ground, and calling it
    // level would make a missing raster indistinguishable from a plain.
    if ($fx < 0.0 || $fy < 0.0 || $fx > (float) ($raster['width'] - 1) || $fy > (float) ($raster['height'] - 1)) {
        return null;
    }

    $i = (int) floor($fx);
    $j = (int) floor($fy);
    if ($i > $raster['width'] - 2) { $i = max(0, $raster['width'] - 2); }
    if ($j > $raster['height'] - 2) { $j = max(0, $raster['height'] - 2); }
    $tx = $fx - $i;
    $ty = $fy - $j;

    $a = avesmapsHeightmapSampleRaw($raster, $i, $j);
    $b = avesmapsHeightmapSampleRaw($raster, min($i + 1, $raster['width'] - 1), $j);
    $c = avesmapsHeightmapSampleRaw($raster, $i, min($j + 1, $raster['height'] - 1));
    $d = avesmapsHeightmapSampleRaw($raster, min($i + 1, $raster['width'] - 1), min($j + 1, $raster['height'] - 1));

    $top = $a + ($b - $a) * $tx;
    $bottom = $c + ($d - $c) * $tx;

    return $top + ($bottom - $top) * $ty;
}

/**
 * PURE: the height at a point is the SUM over every raster that covers it (§5.0).
 *
 * 💣 THE READER MUST SUM. Each raster holds only its area's OWN field; V8's rule is
 * `h(x,y) = Sigma over all areas F: Feld_F(x, y, W(x,y))`
 * (map-features-ecosystem-height-combine.js:5-6). Reading „the raster of the area that contains the
 * point" gives a height that is too low in every overlap strip -- and shows nothing unusual doing it.
 *
 * `null` when no raster covers the point at all: that is „no height data", not „level".
 */
function avesmapsHeightmapSampleSum(array $rasters, float $x, float $y): ?float
{
    $sum = null;
    foreach ($rasters as $raster) {
        $value = avesmapsHeightmapSampleOne($raster, $x, $y);
        if ($value === null) {
            continue;
        }
        $sum = ($sum ?? 0.0) + $value;
    }

    return $sum;
}

/** Every stored raster, decoded. Used ONLY by the profile run -- never on the routing path. */
function avesmapsHeightmapLoadAll(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT area_id, origin_x, origin_y, cell_size_mapunits, width_px, height_px, sample_bytes, samples
           FROM ecosystem_area_heightmap ORDER BY area_id'
    );
    $rasters = [];
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $raster = avesmapsHeightmapDecode($row);
        $raster['area_id'] = (int) $row['area_id'];
        $raster['min_x'] = $raster['origin_x'];
        $raster['min_y'] = $raster['origin_y'];
        $raster['max_x'] = $raster['origin_x'] + ($raster['width'] - 1) * $raster['cell'];
        $raster['max_y'] = $raster['origin_y'] + ($raster['height'] - 1) * $raster['cell'];
        $rasters[] = $raster;
    }

    return $rasters;
}

/**
 * The GLOBAL raster stamp: „which rasters, in which state, does the stored stock describe".
 *
 * One indexed read, NO blob -- that is what the separate stamp columns are for. Global rather than
 * per way on purpose: a raster run is a rare, owner-triggered act, unlike ecosystem_revision, which
 * jumped 901 times in one working day. After a raster run every profile is recomputed anyway.
 */
function avesmapsHeightmapGlobalStamp(PDO $pdo): string
{
    $statement = $pdo->query(
        'SELECT area_id, geometry_revision, terrain_fingerprint, peaks_fingerprint
           FROM ecosystem_area_heightmap ORDER BY area_id'
    );
    $parts = [];
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $parts[] = $row['area_id'] . ':' . $row['geometry_revision'] . ':'
            . $row['terrain_fingerprint'] . ':' . $row['peaks_fingerprint'];
    }

    return sha1(implode('|', $parts));
}
