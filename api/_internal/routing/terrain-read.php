<?php

declare(strict_types=1);

// V11: what the ROUTING path knows about terrain. Spec §5.5, §7.1.
//
// PURITY CONTRACT: side-effect-free on include. The matching rule is pure and unit-tested; the two
// DB reads take a PDO explicitly.
//
// 💣 NO DDL, NO information_schema PROBE, NO RASTER. This runs on every route a visitor plans. The
// rasters are read ONLY by the owner-triggered profile run (api/_internal/app/terrain-store.php);
// loading them here is exactly what path_terrain exists to prevent.
//
// 💣 AND IT NEVER FILLS THE CACHE. A missing row answers „no data" and the leg keeps today's time.
// Recomputing on demand would mean 5.655 misses on the first request after a raster run, with every
// concurrent visitor starting the same fill and holding a PHP worker -- the shape of the pool
// incident of 2026-07-17.

require_once __DIR__ . '/../app/heightmap.php';
require_once __DIR__ . '/../app/app-setting.php';

const AVESMAPS_TERRAIN_SETTING = 'terrain_travel_enabled';

/**
 * PURE: does the slope factor apply to this route type at all?
 *
 * 🔴 Owner decision 2026-07-30: slope is a LAND rule -- a boat does not climb. The list and the full
 * reasoning live with the other terrain constants in api/_internal/app/terrain-store.php
 * (`AVESMAPS_TERRAIN_WATER_ROUTE_TYPES`), which this file already pulls in through heightmap.php. One
 * list, obeyed by both the profile run and the router.
 */
function avesmapsRouteTerrainAppliesTo(string $routeType): bool
{
    return !in_array($routeType, AVESMAPS_TERRAIN_WATER_ROUTE_TYPES, true);
}

/**
 * The switch, read WITHOUT the self-healing DDL.
 *
 * 💣 `avesmapsAppSettingGet` would be the obvious call and it is the wrong one HERE: it runs
 * `CREATE TABLE IF NOT EXISTS app_setting` on every single call, and a DDL statement in front of a
 * public read is precisely the hotspot AGENTS.md §10 lists for territories-endpoint.php. The shape
 * was copied from avesmapsPathLandscapesEcosystemEnabled (V10), and both were folded into ONE
 * implementation (avesmapsAppSettingGetWithoutDdl). V10's reader is gone since 2026-08-01; this one
 * is a DIFFERENT switch ('terrain_travel_enabled') and stays.
 *
 * A missing table means OFF, not „create it and look again": if it does not exist, nobody ever
 * switched anything on.
 */
function avesmapsRouteTerrainEnabled(PDO $pdo): bool
{
    // 🔴 DEFAULT OFF. The ecosystem convention, not the citymaps one: an unfinished layer must not
    // change published travel times because somebody deployed it.
    return avesmapsAppSettingGetWithoutDdl($pdo, AVESMAPS_TERRAIN_SETTING, '0') !== '0';
}

/**
 * Every stored way profile, keyed by public_id.
 *
 * 💣 PRE-JOINED. path_terrain.path_id is map_features.id, the INTERNAL key -- and the routing
 * payload does not carry it: avesmapsFetchRouteMapFeatures selects public_id and never the id, and
 * avesmapsBuildRoutePathData sets 'id' => public_id. Keying by that field would translate, run and
 * miss every single row, landing on factor 1,0 -- the value that also means „switch off" and „it is
 * flat here". THE SAME ERROR CLASS COST V10 A LIVE OUTAGE ON 2026-07-29.
 *
 * 💣 A MISSING TABLE IS NOT AN ERROR. On a database where the profile run has never happened the
 * table does not exist, and PDO is in ERRMODE_EXCEPTION -- the plain read would throw and the route
 * endpoint would answer 500 for a state that is perfectly normal.
 */
function avesmapsRouteLoadTerrain(PDO $pdo): array
{
    try {
        // ⭐ Water is filtered HERE as well, not only in avesmapsRouteAttachTerrain -- and that is the
        // cheaper half of the owner's decision. Measured on 2026-07-30: 150 of the 583 rows with a
        // profile are Flussweg/Seeweg (26%), and they carry 1.807 of the 4.300 `profile_json` pairs
        // (42%). Rows the router must never apply have no business being fetched and json_decode'd on
        // every single visitor request.
        $placeholders = implode(', ', array_fill(0, count(AVESMAPS_TERRAIN_WATER_ROUTE_TYPES), '?'));
        $statement = $pdo->prepare(
            'SELECT f.public_id, t.ascent_schritt, t.descent_schritt, t.profile_json,
                    t.path_revision, t.heightmap_stamp
               FROM path_terrain t
               JOIN map_features f ON f.id = t.path_id
              WHERE f.is_active = 1
                AND f.feature_subtype NOT IN (' . $placeholders . ')'
        );
        $statement->execute(array_values(AVESMAPS_TERRAIN_WATER_ROUTE_TYPES));
    } catch (PDOException) {
        return [];
    }
    if ($statement === false) {
        return [];
    }

    $terrain = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $ascent = $row['ascent_schritt'];
        $profile = $row['profile_json'] === null ? null : json_decode((string) $row['profile_json'], true);
        $terrain[(string) $row['public_id']] = [
            // 💣 null stays null. „No height data" and „measured and level" are two different
            // statements -- today 51 of 67 peaks carry no height at all, and folding them into 0
            // would make every one of those ways read as measured flat ground.
            'ascent' => $ascent === null ? null : (float) $ascent,
            'descent' => $row['descent_schritt'] === null ? null : (float) $row['descent_schritt'],
            'profile' => is_array($profile) ? $profile : null,
            'revision' => (int) $row['path_revision'],
            'stamp' => (string) $row['heightmap_stamp'],
        ];
    }

    return $terrain;
}

/**
 * PURE: the terrain entry for ONE path of the routing payload, or null.
 *
 * Two different kinds of staleness, answered differently and on purpose:
 *
 *  - `path_revision` mismatch -> DROPPED. The stored profile describes a different geometry of THIS
 *    way. That is local, specific and self-healing: the way falls back to factor 1,0 and the next
 *    profile run repairs it.
 *  - `heightmap_stamp` mismatch -> STILL USED, and reported in `debug` (spec §9.1: „als veraltet
 *    gemeldet, Antwort trotzdem geliefert"). It is GLOBAL: refusing it would turn one raster edit
 *    into a map-wide flattening, and the stamp exists to be readable, not to be a trigger.
 */
function avesmapsRouteAttachTerrain(array $path, array $terrain): ?array
{
    // 🔴 Water first, before anything else is read: the slope factor is a land rule (see
    // AVESMAPS_TERRAIN_WATER_ROUTE_TYPES). This is THE gate -- avesmapsRouteCountTerrainMatches calls
    // this function too, so the hard counter agrees with what the route actually applies.
    if (!avesmapsRouteTerrainAppliesTo((string) ($path['subtype'] ?? ''))) {
        return null;
    }

    // 🔴 public_id, explicitly -- NOT $path['id'].
    $publicId = (string) ($path['public_id'] ?? '');
    if ($publicId === '' || !isset($terrain[$publicId])) {
        return null;
    }
    $entry = $terrain[$publicId];
    if ($entry['ascent'] === null || $entry['descent'] === null) {
        return null;
    }
    if ((int) $entry['revision'] !== (int) ($path['revision'] ?? -1)) {
        return null;
    }

    return $entry;
}

/** How many of the payload's ways actually matched -- the hard counter of spec §9.2 step 2. */
function avesmapsRouteCountTerrainMatches(array $paths, array $terrain): int
{
    $matched = 0;
    foreach ($paths as $path) {
        if (is_array($path) && avesmapsRouteAttachTerrain($path, $terrain) !== null) {
            $matched++;
        }
    }

    return $matched;
}

/**
 * Do the stored profiles still describe the rasters as they stand NOW?
 *
 * 🔴 THIS IS THE OTHER HALF OF THE STALENESS RULE, and without it the rule is a claim rather than a
 * behaviour: `heightmap_stamp` mismatch means the profile is still USED (refusing would turn one
 * raster edit into a map-wide flattening) -- but then it MUST be visible, or „warum ist der Pass
 * noch schnell?" has no answer. `avesmapsEcosystemEnsureTables` already promises this out loud:
 * „A stale stamp is REPORTED, not obeyed (see the reader in response.php)."
 *
 * Two small reads, and only when terrain is on: the stamp the profile run was computed against, and
 * the stamp the rasters carry today. Both are indexed columns; NEITHER touches a blob.
 *
 * „Nothing computed yet" is NOT stale -- it is absent, and `matched_ways = 0` already says so.
 */
function avesmapsRouteTerrainStale(PDO $pdo): bool
{
    try {
        $stamped = $pdo->query('SELECT heightmap_stamp FROM path_terrain_stamp WHERE id = 1')->fetchColumn();
        if ($stamped === false || $stamped === null || (string) $stamped === '') {
            return false;
        }

        return (string) $stamped !== avesmapsHeightmapGlobalStamp($pdo);
    } catch (PDOException) {
        // A missing table is the normal state before the first run, not an error (see the note on
        // avesmapsRouteLoadTerrain).
        return false;
    }
}
