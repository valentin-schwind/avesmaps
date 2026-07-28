<?php

declare(strict_types=1);

// Which map label belongs to which landscape region -- resolved from BOTH directions, in ONE place.
//
// 🔴 WHY THIS IS ITS OWN FILE. Two read paths need the same answer and must never disagree about it:
//   * api/app/ecosystem-areas.php  -- "how many labels does this region carry" (the area tooltip)
//   * api/app/map-features.php     -- "which region does this label belong to" (payload field)
// A second copy of the rule is the second truth, and this relation is exactly the kind that drifts:
// it is stored twice on purpose, once per direction.
//
// 🔴 THE RELATION IS 1:N AND STORED IN TWO PLACES (see docs/superpowers/specs/
// 2026-07-28-landschaften-flaeche-label-kopplung-design.md §2.5):
//   * map_features.properties.ecosystem_region_public_id -- the label names its region (10 of 590 today)
//   * ecosystem_region.label_public_id                   -- the region names its PRIMARY label (137 of 139)
// Neither side alone is complete. Reading only the region side reports the second and third label of an
// area as homeless -- and those are the entire point of the 1:N.
//
// 💣 A POINTER IS NOT A LABEL. ecosystem_region.label_public_id may point at a label somebody deleted by
// hand; the region keeps the stale pointer (the "Regionname anzeigen" checkbox learned this the hard way,
// map-features-ecosystem-properties.js:587). So every pointer is checked against the set of ACTIVE labels
// before it counts. Without that check a region with a deleted label would report "1 label" and the delete
// cascade would never fire for it.
//
// No DDL, no writes, no globals -- pure functions plus one reader, so the core is unit-testable
// (api/_internal/app/__tests__/ecosystem-label-link-test.php).

// The resolved relation, both directions at once.
//
// @param list<array{public_id:string,label_public_id:?string}> $regionRows  active regions
// @param list<array{public_id:string,region_public_id:string}> $pointerRows labels carrying their own pointer
// @param list<string> $activeLabelIds public_ids of ALL active labels
// @return array{by_label:array<string,string>, count_by_region:array<string,int>}
function avesmapsEcosystemLabelRegionMap(array $regionRows, array $pointerRows, array $activeLabelIds): array
{
    $active = [];
    foreach ($activeLabelIds as $labelId) {
        $labelId = trim((string) $labelId);
        if ($labelId !== '') {
            $active[$labelId] = true;
        }
    }

    // 1. The label's OWN pointer wins. It is the direction the feature is moving towards, and it is the
    //    only one that can express a second or third label on the same area.
    $byLabel = [];
    foreach ($pointerRows as $row) {
        $labelId = trim((string) ($row['public_id'] ?? ''));
        $regionId = trim((string) ($row['region_public_id'] ?? ''));
        if ($labelId === '' || $regionId === '' || !isset($active[$labelId])) {
            continue;
        }
        $byLabel[$labelId] = $regionId;
    }

    // 2. The region's primary pointer fills in the rest -- the ~124 stock labels from the V5 import that
    //    do not carry their own. It never OVERRIDES an own pointer: a label that says where it belongs is
    //    right, even if some region still claims it.
    foreach ($regionRows as $row) {
        $regionId = trim((string) ($row['public_id'] ?? ''));
        $labelId = trim((string) ($row['label_public_id'] ?? ''));
        if ($regionId === '' || $labelId === '' || !isset($active[$labelId])) {
            continue;
        }
        if (!isset($byLabel[$labelId])) {
            $byLabel[$labelId] = $regionId;
        }
    }

    // Counted from the RESOLVED map, so a label claimed by both directions counts once.
    $countByRegion = [];
    foreach ($byLabel as $regionId) {
        $countByRegion[$regionId] = ($countByRegion[$regionId] ?? 0) + 1;
    }

    return ['by_label' => $byLabel, 'count_by_region' => $countByRegion];
}

// The same relation, read from the database. Three cheap queries, no N+1 and no cross join.
//
// 🪤 NO CROSS JOIN between map_features and ecosystem_region, however tempting: the two tables can carry
// different collations, and a mismatched one turns the comparison into a silent zero rather than an error
// (the feature_sources collation trap, seen live). Merging in PHP compares plain strings and cannot fail
// that way.
//
// 🪤 The pointer query uses a LIKE pre-filter before touching properties_json, the same gate
// avesmapsMapFeaturesMergeLegacyOtherSources uses (api/app/map-features.php:879): ~10 rows are decoded
// instead of 590, and the JSON is decoded in PHP rather than by JSON_EXTRACT -- one malformed row would
// otherwise take the whole query down.
//
// Returns the empty relation when the ecosystem tables are absent, so an installation without the feature
// behaves exactly as before instead of erroring.
function avesmapsEcosystemReadLabelRegionMap(PDO $pdo): array
{
    try {
        $regionStatement = $pdo->query(
            'SELECT public_id, label_public_id FROM ecosystem_region WHERE is_active = 1'
        );
        $regionRows = $regionStatement === false ? [] : $regionStatement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return ['by_label' => [], 'count_by_region' => []];
    }

    $activeStatement = $pdo->query(
        "SELECT public_id FROM map_features WHERE feature_type = 'label' AND is_active = 1"
    );
    $activeLabelIds = $activeStatement === false ? [] : $activeStatement->fetchAll(PDO::FETCH_COLUMN);

    $pointerStatement = $pdo->query(
        "SELECT public_id, properties_json FROM map_features
          WHERE feature_type = 'label' AND is_active = 1
            AND properties_json LIKE '%\"ecosystem_region_public_id\"%'"
    );
    $pointerRows = [];
    foreach ($pointerStatement === false ? [] : $pointerStatement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
        $regionId = is_array($properties) ? trim((string) ($properties['ecosystem_region_public_id'] ?? '')) : '';
        if ($regionId === '') {
            continue;
        }
        $pointerRows[] = ['public_id' => (string) $row['public_id'], 'region_public_id' => $regionId];
    }

    return avesmapsEcosystemLabelRegionMap($regionRows, $pointerRows, $activeLabelIds);
}
