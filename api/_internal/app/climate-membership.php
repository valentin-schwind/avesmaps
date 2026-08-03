<?php

declare(strict_types=1);

// "Which climate zone is this in?" -- the answer that ends up as one infobox row.
//
// THREE SHAPES, THREE SOURCES, and that is not an accident -- it is what the things are:
//   * a PLACE is a point   -> it lies in EXACTLY ONE band                    (here)
//   * a REGION is an area  -> it lies partly in several                      (here, from the stored intersect)
//   * a WAY is a line      -> stretch by stretch, out of path_ecosystem      (api/app/path-landscapes.php)
// Only the first two travel in the map payload. A way's intervals are 5.765 rows deep and already have
// their own lazily-fetched endpoint; pulling them into the payload would undo that on purpose.
//
// 🔴 THE ANSWER IS TAKEN FROM THE BANDS, NOT FROM THE DIVIDERS -- deliberately, and it costs a little.
// The dividers are the truth of the feature and a point test against them would be six comparisons
// instead of a polygon test. But their RULES belong to the climate module and they move: until
// 2026-08-03 every divider had strictly increasing x, which made it a function y(x) and the point test
// a one-liner; since 234328d0 a divider may run backwards ("Blasen", for the Khôm desert), and that
// one-liner silently returns the wrong zone inside a bubble. The bands are the derived, downstream
// artefact -- a polygon is a polygon whatever the line that produced it does -- so this file survives
// the next change to the divider rules. See docs/superpowers/specs/2026-08-03-klimazonen-design.md §4.
//
// PURITY CONTRACT (mirrors ecosystem-label-link.php): nothing runs on include, no DDL, no globals. The
// geometry half is pure and unit-tested; the DB half takes a PDO explicitly and returns the EMPTY answer
// when the ecosystem tables are absent -- this runs on the busiest read path in the house, and "the
// feature was never set up" must not become a 500 there.

// Below this share a zone is not named on a region. Same threshold and same reasoning as
// AVESMAPS_LANDSCAPE_MIN_SHARE in map-features-path-landscapes.js: a sliver of a neighbouring band is
// noise, and a row that lists four zones for a forest answers nothing.
const AVESMAPS_CLIMATE_REGION_MIN_SHARE = 0.05;

/**
 * PURE: does this ring contain the point? Even-odd ray cast.
 *
 * Points exactly ON an edge are undefined here and that is fine: the seven bands tile the map, so a
 * point on a shared edge lands in one of the two neighbours and never in neither -- the same tie-break
 * every point-in-polygon in this house lives with.
 *
 * @param list<array{0: float, 1: float}> $ring
 */
function avesmapsClimateRingContains(array $ring, float $x, float $y): bool
{
    $count = count($ring);
    if ($count < 3) {
        return false;
    }

    $inside = false;
    $previous = $count - 1;
    for ($index = 0; $index < $count; $index++) {
        $xi = (float) ($ring[$index][0] ?? 0.0);
        $yi = (float) ($ring[$index][1] ?? 0.0);
        $xj = (float) ($ring[$previous][0] ?? 0.0);
        $yj = (float) ($ring[$previous][1] ?? 0.0);
        if (($yi > $y) !== ($yj > $y)) {
            $span = $yj - $yi;
            if ($span === 0.0) {
                $span = 1e-12;
            }
            if ($x < ($xj - $xi) * ($y - $yi) / $span + $xi) {
                $inside = !$inside;
            }
        }
        $previous = $index;
    }

    return $inside;
}

/**
 * PURE: does this GeoJSON Polygon / MultiPolygon contain the point?
 *
 * Holes are honoured even though a band has none -- a band is built from two edges and is always a
 * simple ring. The four extra lines are what keeps this function usable if it is ever pointed at an
 * ordinary drawn area, and they cost nothing on a geometry without holes.
 */
function avesmapsClimateGeometryContains(mixed $geometry, float $x, float $y): bool
{
    if (!is_array($geometry)) {
        return false;
    }
    $type = (string) ($geometry['type'] ?? '');
    $coordinates = $geometry['coordinates'] ?? null;
    if (!is_array($coordinates)) {
        return false;
    }

    $polygons = $type === 'MultiPolygon' ? $coordinates : ($type === 'Polygon' ? [$coordinates] : []);
    foreach ($polygons as $polygon) {
        if (!is_array($polygon) || !is_array($polygon[0] ?? null)) {
            continue;
        }
        if (!avesmapsClimateRingContains($polygon[0], $x, $y)) {
            continue;
        }
        $inHole = false;
        for ($index = 1; $index < count($polygon); $index++) {
            if (is_array($polygon[$index]) && avesmapsClimateRingContains($polygon[$index], $x, $y)) {
                $inHole = true;
                break;
            }
        }
        if (!$inHole) {
            return true;
        }
    }

    return false;
}

/**
 * PURE: which zone key does this point sit in? '' when no band claims it.
 *
 * ⚠️ The bounding box is checked FIRST and it is not micro-optimisation. The bands are horizontal
 * stripes, so a point's y rules out five or six of the seven before a single edge is touched -- which
 * turns ~4.650 places x 7 rings into roughly one ring test each. Without it this would be the most
 * expensive thing in the map payload rather than the cheapest.
 *
 * @param list<array{key: string, label: string, min_y: float, max_y: float, geometry: mixed}> $bands
 */
function avesmapsClimateZoneKeyAt(array $bands, float $x, float $y): string
{
    foreach ($bands as $band) {
        if ($y < ((float) $band['min_y']) - 1e-9 || $y > ((float) $band['max_y']) + 1e-9) {
            continue;
        }
        if (avesmapsClimateGeometryContains($band['geometry'] ?? null, $x, $y)) {
            return (string) $band['key'];
        }
    }

    return '';
}

/**
 * PURE: the zone vocabulary the client renders labels from -- north to south, once per payload.
 *
 * Shipping the label with every place instead would repeat "Winterfeuchte Subtropen" 4.650 times for
 * seven distinct values. The key on the place, the label here.
 *
 * @param list<array<string,mixed>> $bands
 * @return list<array{key: string, label: string}>
 */
function avesmapsClimateVocabulary(array $bands): array
{
    $vocabulary = [];
    foreach ($bands as $band) {
        $key = (string) ($band['key'] ?? '');
        if ($key === '') {
            continue;
        }
        $vocabulary[] = ['key' => $key, 'label' => (string) ($band['label'] ?? $key)];
    }

    return $vocabulary;
}

/**
 * The seven bands, north to south, with their bounding box and their geometry.
 *
 * Returns [] when the ecosystem tables do not exist, when the layer was never seeded, or when anything
 * else goes wrong -- see the purity note at the top. The caller then emits no climate field at all,
 * which the client reads as "nothing to say" and not as an error.
 *
 * @return list<array{key: string, label: string, min_y: float, max_y: float, geometry: mixed}>
 */
function avesmapsClimateReadBands(PDO $pdo): array
{
    try {
        $statement = $pdo->query(
            "SELECT r.region_type,
                    COALESCE(t.label, r.region_type) AS label,
                    COALESCE(t.sort_order, 0) AS sort_order,
                    a.min_y, a.max_y, a.geometry_geojson
               FROM ecosystem_area a
               JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1 AND r.kind = 'klima'
               LEFT JOIN ecosystem_region_type t ON t.kind = 'klima' AND t.type_key = r.region_type
              WHERE a.is_active = 1
              ORDER BY sort_order"
        );
        $rows = $statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $bands = [];
    foreach ($rows as $row) {
        $key = trim((string) ($row['region_type'] ?? ''));
        $geometry = json_decode((string) ($row['geometry_geojson'] ?? ''), true);
        if ($key === '' || !is_array($geometry)) {
            continue;
        }
        $bands[] = [
            'key' => $key,
            'label' => (string) ($row['label'] ?? $key),
            'min_y' => (float) ($row['min_y'] ?? 0),
            'max_y' => (float) ($row['max_y'] ?? 0),
            'geometry' => $geometry,
        ];
    }

    return $bands;
}

/**
 * Which climate zones each landscape region lies in, from the stored intersect.
 *
 * 🔴 THIS IS "Zugehörigkeit rechnen"'s RESULT, NOT A SECOND CALCULATION. The browser intersects every
 * region against every other when the editor presses the button, and ecosystem_region_overlap is where
 * that lands. Re-deriving it here would be a second answer to the same question, and the two would
 * disagree the first time the rule changed -- the exact failure ecosystem-label-link.php exists to avoid.
 *
 * ⚠️ `share` is the fraction of the SMALLER of the two regions (V9, threshold 10 %). A band covers a
 * seventh of the map, so for any ordinary region the smaller one IS the region and the share reads as
 * "this much of the forest lies in that zone" -- which is what the row says. For something bigger than a
 * band (a sea, a continent) the roles swap and the number would mean the reverse; those rows fall below
 * the threshold and drop out on their own. Worth knowing before trusting the number on a huge area.
 *
 * ⚠️ The redundant-looking IN (...) is what keeps this off the whole table. ecosystem_region_overlap
 * holds every pair of regions that touch, both directions -- thousands of rows -- and only a handful
 * involve a climate band. The join alone would filter correctly but scan everything; the IN lets
 * idx_ecosystem_overlap_other do the work. This runs once per map-features request, which is already
 * the heaviest query in the house.
 *
 * @return array<string, list<array{0: string, 1: float}>> region public_id => [[zone key, share], ...]
 */
function avesmapsClimateReadRegionZones(PDO $pdo): array
{
    try {
        $statement = $pdo->query(
            "SELECT r.public_id AS region_public_id,
                    k.region_type AS zone_key,
                    COALESCE(t.sort_order, 0) AS sort_order,
                    o.share
               FROM ecosystem_region_overlap o
               JOIN ecosystem_region r ON r.id = o.region_id AND r.is_active = 1 AND r.kind <> 'klima'
               JOIN ecosystem_region k ON k.id = o.other_region_id AND k.is_active = 1 AND k.kind = 'klima'
               LEFT JOIN ecosystem_region_type t ON t.kind = 'klima' AND t.type_key = k.region_type
              WHERE o.other_region_id IN (SELECT id FROM ecosystem_region WHERE kind = 'klima' AND is_active = 1)"
        );
        $rows = $statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $byRegion = [];
    $orderByRegion = [];
    foreach ($rows as $row) {
        $regionId = trim((string) ($row['region_public_id'] ?? ''));
        $zoneKey = trim((string) ($row['zone_key'] ?? ''));
        $share = (float) ($row['share'] ?? 0);
        if ($regionId === '' || $zoneKey === '' || $share < AVESMAPS_CLIMATE_REGION_MIN_SHARE) {
            continue;
        }
        $byRegion[$regionId][] = [$zoneKey, round(min(1.0, $share), 4)];
        $orderByRegion[$regionId][$zoneKey] = (int) ($row['sort_order'] ?? 0);
    }

    // Biggest share first -- the zone a region mostly lies in is the one the reader wants first. Ties
    // break north to south, so two halves of a region always come out in the same order and the row
    // does not reshuffle itself between two requests.
    foreach ($byRegion as $regionId => $zones) {
        usort($zones, static function (array $left, array $right) use ($orderByRegion, $regionId): int {
            return $right[1] <=> $left[1]
                ?: ($orderByRegion[$regionId][$left[0]] ?? 0) <=> ($orderByRegion[$regionId][$right[0]] ?? 0);
        });
        $byRegion[$regionId] = $zones;
    }

    return $byRegion;
}

/**
 * What has to change for a cached payload to be wrong about climate -- folded into the ETag.
 *
 * 💣 map_revision DOES NOT COVER THIS, and that is the whole reason this function exists. Dragging a
 * divider rewrites all seven bands and moves every place's zone, but it never touches map_revision --
 * so a warm client would keep its 304 and go on showing the previous zone, with nothing anywhere saying
 * why. Exactly the trap the klima layer already paid for once (spec §6.1, the seed that had to move out
 * of EnsureTables because DDL does not raise the revision either).
 *
 * Two single-row reads: the ecosystem counter (rises on any landscape write, divider saves included) and
 * the assignment stamp (rises when "Zugehörigkeit rechnen" recomputes the region shares, which can
 * happen without any geometry moving).
 */
function avesmapsClimateReadStamp(PDO $pdo): string
{
    $revision = 0;
    $computedAt = '';
    try {
        $statement = $pdo->query('SELECT revision FROM ecosystem_revision WHERE id = 1');
        $value = $statement === false ? false : $statement->fetchColumn();
        $revision = $value === false ? 0 : (int) $value;
    } catch (Throwable) {
        // No ecosystem tables: the payload carries no climate either, so any seed is as good as another.
    }
    try {
        $statement = $pdo->query('SELECT computed_at FROM ecosystem_assignment_stamp WHERE id = 1');
        $value = $statement === false ? false : $statement->fetchColumn();
        $computedAt = $value === false || $value === null ? '' : (string) $value;
    } catch (Throwable) {
        // Never computed: no region rows exist to go stale.
    }

    return $revision . ':' . $computedAt;
}

/**
 * Hang the climate zone on every feature that can carry one. Mutates in place.
 *
 * A PLACE gets `properties.climate_zone` -- one key, because a point is in one band.
 * A LABEL of a landscape region gets `properties.climate_zones` -- [[key, share], ...], because an area
 * is in several. Two field names for two genuinely different statements; folding them into one shape
 * would make the client guess which of the two it is holding.
 *
 * Nothing is emitted when there is nothing to say. An absent field is the signal for "no row" -- an
 * empty list would be indistinguishable from "not computed yet" on the client.
 *
 * @param list<array<string,mixed>> $features built GeoJSON features (mutated in place)
 * @param list<array<string,mixed>> $bands from avesmapsClimateReadBands
 * @param array<string, list<array{0: string, 1: float}>> $regionZones from avesmapsClimateReadRegionZones
 */
function avesmapsClimateApplyToFeatures(array &$features, array $bands, array $regionZones): void
{
    if ($bands === [] && $regionZones === []) {
        return;
    }

    foreach ($features as $index => $feature) {
        $properties = $feature['properties'] ?? null;
        if (!is_array($properties)) {
            continue;
        }
        $featureType = (string) ($properties['feature_type'] ?? '');

        if ($featureType === 'location' && $bands !== []) {
            $geometry = $feature['geometry'] ?? null;
            $position = is_array($geometry) && (string) ($geometry['type'] ?? '') === 'Point'
                ? ($geometry['coordinates'] ?? null)
                : null;
            if (!is_array($position) || count($position) < 2) {
                continue;
            }
            // GeoJSON is [x, y]; Leaflet flips to [y, x] in the client and never here (AGENTS.md §5).
            $zoneKey = avesmapsClimateZoneKeyAt($bands, (float) $position[0], (float) $position[1]);
            if ($zoneKey !== '') {
                $features[$index]['properties']['climate_zone'] = $zoneKey;
            }
            continue;
        }

        if ($featureType === 'label' && $regionZones !== []) {
            // Runs AFTER avesmapsEcosystemApplyLabelRegionsToFeatures, which is what puts this pointer
            // on the ~137 labels that do not store one themselves. Order matters in map-features.php.
            $regionPublicId = trim((string) ($properties['ecosystem_region_public_id'] ?? ''));
            if ($regionPublicId === '' || !isset($regionZones[$regionPublicId])) {
                continue;
            }
            $features[$index]['properties']['climate_zones'] = $regionZones[$regionPublicId];
        }
    }
}
