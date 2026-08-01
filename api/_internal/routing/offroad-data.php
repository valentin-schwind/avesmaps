<?php

declare(strict_types=1);

// V14: the two things the cross-country A* needs from the database, both limited to the search box.
// Spec §5.2, instruction §3.2.
//
// PURITY CONTRACT: side-effect-free on include. Every function takes a PDO explicitly, and every one
// of them fails INERT -- an empty result means „the A* knows less", never „the route request 500s".
//
// 💣 NO DDL, NO information_schema PROBE. The ecosystem module owns these tables. `offroad_factor` is
// read here for the first time in PHP (until now only the seed wrote it), so a database that predates
// the column must simply yield no factors instead of an exception.

require_once __DIR__ . '/offroad-grid.php';
require_once __DIR__ . '/../app/heightmap.php';

// The three kinds that lie ON TOP of each other; one byte plane each (V11 §10.3).
const AVESMAPS_ROUTE_OFFROAD_KINDS = ['derographisch', 'vegetation', 'topographie'];

/**
 * Height rasters overlapping the box, decoded, blob left as a binary string.
 *
 * 🔴 THIS IS THE FUNCTION heightmap.php SENDS YOU HERE FOR. Its own header is explicit -- „The
 * ROUTING PATH never [reads rasters] -- it reads path_terrain and nothing else. Loading all rasters
 * per route request is exactly what the derived cache exists to prevent." That rule is about
 * avesmapsHeightmapLoadAll, which pulls EVERY raster on EVERY request for a way's profile. The A*
 * has no derived cache to fall back on: it prices ground nobody has drawn a way across, so it must
 * read the raster -- but only the handful that touch its own box, selected in SQL by bbox.
 *
 * A raster's extent is origin + (px - 1) x cell, exactly as avesmapsHeightmapLoadAll computes it.
 * ⚠️ A broken row is skipped, not fatal: avesmapsHeightmapDecode refuses truncated blobs by design,
 * and one bad area may not take the whole route down.
 */
function avesmapsOffroadLoadHeightRasters(PDO $pdo, array $box): array
{
    try {
        $statement = $pdo->prepare(
            'SELECT area_id, origin_x, origin_y, cell_size_mapunits, width_px, height_px, sample_bytes, samples
               FROM ecosystem_area_heightmap
              WHERE origin_x <= :max_x
                AND origin_y <= :max_y
                AND origin_x + (width_px - 1) * cell_size_mapunits >= :min_x
                AND origin_y + (height_px - 1) * cell_size_mapunits >= :min_y'
        );
        $statement->execute([
            'min_x' => $box['min_x'], 'min_y' => $box['min_y'],
            'max_x' => $box['max_x'], 'max_y' => $box['max_y'],
        ]);

        $rasters = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            try { $rasters[] = avesmapsHeightmapDecode($row); } catch (Throwable) { continue; }
        }

        return $rasters;
    } catch (Throwable) {
        return [];
    }
}

/**
 * How many height rasters exist at all -- one indexed count, no blob.
 *
 * ⭐ It exists because nobody could say. The first draft of the instruction cited „3.331 Profilzeilen"
 * as evidence, but those are `path_terrain` rows -- the ways' cache -- and say nothing about stored
 * rasters. This number rides in the route response's debug context so the answer is measured rather
 * than asserted, and so „the A* ignores the mountains" can be told apart from „there are no mountains
 * stored yet".
 */
function avesmapsOffroadCountHeightRasters(PDO $pdo): int
{
    try {
        $statement = $pdo->query('SELECT COUNT(*) FROM ecosystem_area_heightmap');

        return $statement === false ? 0 : (int) $statement->fetchColumn();
    } catch (Throwable) {
        return 0;
    }
}

/**
 * The combined terrain-factor plane for the box: three planes rasterised, then merged by MAXIMUM.
 *
 * Returns '' when nothing is known, which every reader treats as factor 1,0 throughout.
 *
 * ⚠️ `is_trial = 0`, exactly as V13 filters water. Routing must not change because somebody is trying
 * something out, and the way to promote an experiment is the `promote_trial` button. As of 2026-07-30
 * ALL 17 gebirge areas were trial areas, so on that stock this plane is empty for mountains and the
 * A* avoids water only. That is the data situation, not a build error -- it grows in with the drawing
 * work. Count the rows yourself rather than believing that sentence.
 *
 * ⚠️ Areas WITHOUT a landscape type, and types without a factor, come back as 1,00 from the column
 * default and are simply not written into the plane.
 */
function avesmapsOffroadLoadFactorPlane(PDO $pdo, array $box): string
{
    try {
        $statement = $pdo->prepare(
            'SELECT r.kind, a.geometry_geojson, a.min_x, a.min_y, a.max_x, a.max_y, t.offroad_factor
               FROM ecosystem_area a
               INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
               INNER JOIN ecosystem_region_type t ON t.kind = r.kind AND t.type_key = r.region_type
              WHERE a.is_active = 1
                AND a.is_trial = 0
                AND t.offroad_factor > 1.00
                AND a.min_x <= :max_x AND a.max_x >= :min_x
                AND a.min_y <= :max_y AND a.max_y >= :min_y'
        );
        $statement->execute([
            'min_x' => $box['min_x'], 'min_y' => $box['min_y'],
            'max_x' => $box['max_x'], 'max_y' => $box['max_y'],
        ]);

        $byKind = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $kind = (string) ($row['kind'] ?? '');
            if (!in_array($kind, AVESMAPS_ROUTE_OFFROAD_KINDS, true)) { continue; }
            $geometry = json_decode((string) ($row['geometry_geojson'] ?? ''), true);
            if (!is_array($geometry)) { continue; }
            $byKind[$kind][] = [
                'prepared' => avesmapsPrepareRouteAreas([[
                    'geometry' => $geometry,
                    'min_x' => (float) $row['min_x'], 'min_y' => (float) $row['min_y'],
                    'max_x' => (float) $row['max_x'], 'max_y' => (float) $row['max_y'],
                ]]),
                'factor' => (float) $row['offroad_factor'],
            ];
        }
        if ($byKind === []) { return ''; }

        $planes = [];
        foreach (AVESMAPS_ROUTE_OFFROAD_KINDS as $kind) {
            if (isset($byKind[$kind])) { $planes[] = avesmapsOffroadRasteriseFactors($box, $byKind[$kind]); }
        }

        return avesmapsOffroadCombineFactorPlanes($planes);
    } catch (Throwable) {
        return '';
    }
}
