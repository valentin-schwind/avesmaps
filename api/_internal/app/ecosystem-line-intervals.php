<?php

declare(strict_types=1);

// Where does a LINE run through an area, measured as arc length from the line's start.
//
// 💣 THIS IS A PORT, NOT A DESIGN. The rule is owned by the V9 original,
// js/map-features/map-features-ecosystem-path-assign.js. This file exists only because the routing
// endpoint cannot call JavaScript (V13, api/_internal/routing/client-graph.php). Every branch below
// mirrors the original line for line; the half-open comparisons and the probe placement are each
// there because a measured case failed without them (see the original's comments at :143 and
// :154-166). Changing one here without changing it there splits one rule into two.
//
// The two are kept honest by a shared corpus:
// js/map-features/__tests__/ecosystem-line-intervals-fixture.json, read by
// api/_internal/app/__tests__/ecosystem-line-intervals-test.php AND by
// js/map-features/__tests__/ecosystem-path-assign.test.js.
//
// 🔴 BINDING RULE (inherited): everything here takes a COORDINATE LIST, never a path object. A
// cross-country edge is a list of two points, and "does it cross water" is this same function asked
// whether any interval came back at all.
//
// ⚠️ Arc lengths are in MAP UNITS -- the unit of map_features.min_x and of the routing graph
// (1 map unit = 3.000 Schritt).

const AVESMAPS_ECOSYSTEM_INTERVAL_EPSILON = 1e-9;

// Every edge of every ring, outer rings and holes alike. A hole needs no special case: its edges
// flip the inside/outside state exactly like an outer ring's do, and the ray cast counts them by
// parity. A ring's closing point repeats its first, so it yields no extra edge.
function avesmapsEcosystemAreaEdges(array $geometry): array {
    $type = (string) ($geometry['type'] ?? '');
    if ($type === 'Polygon') {
        $rings = is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [];
    } elseif ($type === 'MultiPolygon') {
        $rings = [];
        foreach (is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [] as $part) {
            if (!is_array($part)) continue;
            foreach ($part as $ring) {
                $rings[] = $ring;
            }
        }
    } else {
        $rings = [];
    }

    $edges = [];
    foreach ($rings as $ring) {
        if (!is_array($ring)) continue;
        $count = count($ring);
        for ($index = 0; $index < $count - 1; $index++) {
            $edges[] = [
                (float) $ring[$index][0], (float) $ring[$index][1],
                (float) $ring[$index + 1][0], (float) $ring[$index + 1][1],
            ];
        }
    }

    return $edges;
}

// Ray cast towards +x, counting crossings by parity. `($y1 > $y) === ($y2 > $y)` is the half-open
// rule for the ray too: a vertex sitting exactly at y belongs to one of its two edges, never both.
function avesmapsEcosystemPointInEdges(float $x, float $y, array $edges): bool {
    $inside = false;
    foreach ($edges as $edge) {
        $y1 = $edge[1];
        $y2 = $edge[3];
        if (($y1 > $y) === ($y2 > $y)) { continue; }
        if ($edge[0] + (($y - $y1) / ($y2 - $y1)) * ($edge[2] - $edge[0]) > $x) { $inside = !$inside; }
    }

    return $inside;
}

function avesmapsEcosystemCumulativeLengths(array $coordinates): array {
    $cumulative = [0.0];
    $count = count($coordinates);
    for ($index = 0; $index < $count - 1; $index++) {
        $cumulative[] = $cumulative[$index] + hypot(
            (float) $coordinates[$index + 1][0] - (float) $coordinates[$index][0],
            (float) $coordinates[$index + 1][1] - (float) $coordinates[$index][1]
        );
    }

    return $cumulative;
}

// The point at a given arc length along a line -- walk the vertices, interpolate inside the segment
// the distance falls into.
function avesmapsEcosystemPointAtCumulative(array $coordinates, array $cumulative, float $distance): array {
    $count = count($cumulative);
    $last = $cumulative[$count - 1];
    $clamped = $distance < 0 ? 0.0 : ($distance > $last ? $last : $distance);
    for ($index = 0; $index < $count - 1; $index++) {
        if ($clamped <= $cumulative[$index + 1]) {
            $span = $cumulative[$index + 1] - $cumulative[$index];
            $t = $span === 0.0 ? 0.0 : ($clamped - $cumulative[$index]) / $span;

            return [
                (float) $coordinates[$index][0] + $t * ((float) $coordinates[$index + 1][0] - (float) $coordinates[$index][0]),
                (float) $coordinates[$index][1] + $t * ((float) $coordinates[$index + 1][1] - (float) $coordinates[$index][1]),
            ];
        }
    }

    $lastIndex = count($coordinates) - 1;

    return [(float) $coordinates[$lastIndex][0], (float) $coordinates[$lastIndex][1]];
}

function avesmapsEcosystemLineIntervals(array $coordinates, array $edges): array {
    if (count($coordinates) < 2 || $edges === []) {
        return [];
    }

    // Cumulative arc length, so a crossing found inside segment i becomes an absolute distance.
    $cumulative = avesmapsEcosystemCumulativeLengths($coordinates);
    $pointCount = count($coordinates);
    $total = $cumulative[$pointCount - 1];
    if (!($total > 0)) { return []; }

    $cuts = [];
    for ($index = 0; $index < $pointCount - 1; $index++) {
        $ax = (float) $coordinates[$index][0];
        $ay = (float) $coordinates[$index][1];
        $rx = (float) $coordinates[$index + 1][0] - $ax;
        $ry = (float) $coordinates[$index + 1][1] - $ay;
        $segmentLength = hypot($rx, $ry);
        if ($segmentLength === 0.0) { continue; }
        // The segment's own bounding box, so the inner loop rejects most edges with four comparisons
        // instead of the full parametric solve. This is what keeps a 3.050-corner sea affordable.
        $segmentMinX = $rx >= 0 ? $ax : $ax + $rx;
        $segmentMaxX = $rx >= 0 ? $ax + $rx : $ax;
        $segmentMinY = $ry >= 0 ? $ay : $ay + $ry;
        $segmentMaxY = $ry >= 0 ? $ay + $ry : $ay;

        foreach ($edges as $edge) {
            $ex1 = $edge[0];
            $ey1 = $edge[1];
            $ex2 = $edge[2];
            $ey2 = $edge[3];
            if (($ex1 < $ex2 ? $ex1 : $ex2) > $segmentMaxX || ($ex1 > $ex2 ? $ex1 : $ex2) < $segmentMinX) { continue; }
            if (($ey1 < $ey2 ? $ey1 : $ey2) > $segmentMaxY || ($ey1 > $ey2 ? $ey1 : $ey2) < $segmentMinY) { continue; }

            $sx = $ex2 - $ex1;
            $sy = $ey2 - $ey1;
            $denominator = $rx * $sy - $ry * $sx;
            if ($denominator === 0.0) { continue; }          // parallel or collinear -> no single crossing
            $qx = $ex1 - $ax;
            $qy = $ey1 - $ay;
            $t = ($qx * $sy - $qy * $sx) / $denominator;
            if ($t < 0 || $t >= 1) { continue; }
            $u = ($qx * $ry - $qy * $rx) / $denominator;
            // 💣 HALF-OPEN ON BOTH SIDES. A line through a polygon corner otherwise meets both edges
            // that share it, toggles twice, and the passage disappears.
            if ($u < 0 || $u >= 1) { continue; }
            $cuts[] = $cumulative[$index] + $t * $segmentLength;
        }
    }

    // SORT_NUMERIC and not the default: these are distances, and a numeric sort is what the
    // original's `(left, right) => left - right` does. Nothing here may be compared as a string.
    sort($cuts, SORT_NUMERIC);

    $marks = array_merge([0.0], $cuts, [$total]);
    $markCount = count($marks);

    // 💣 The inside/outside state is sampled in the middle of the first span THAT HAS LENGTH --
    // never at the line's start point, and never in a zero-length span. Two measured failures in the
    // original, both on a square 0..100: a line starting exactly ON an edge is the one place a ray
    // cast cannot answer (and ways are drawn to begin at borders), and the cut it produces AT
    // distance 0 makes a zero-length span that flips the state a second time. Either one returns the
    // whole answer inverted.
    //
    // Hence: find the first span with real length, decide there, derive every other span by parity.
    $probeIndex = 0;
    while ($probeIndex < $markCount - 1
        && $marks[$probeIndex + 1] - $marks[$probeIndex] <= AVESMAPS_ECOSYSTEM_INTERVAL_EPSILON) {
        $probeIndex++;
    }
    if ($probeIndex >= $markCount - 1) { return []; }
    $probe = avesmapsEcosystemPointAtCumulative(
        $coordinates,
        $cumulative,
        ($marks[$probeIndex] + $marks[$probeIndex + 1]) / 2
    );
    $insideAtProbe = avesmapsEcosystemPointInEdges($probe[0], $probe[1], $edges);

    $intervals = [];
    for ($index = 0; $index < $markCount - 1; $index++) {
        // ⚠️ `$index - $probeIndex` can be negative, and PHP's % keeps the sign exactly as
        // JavaScript's does (-1 % 2 === -1 in both). So `=== 0` means "an even number of spans
        // away", in both languages, and the parity carries in both directions from the probe.
        $inside = ($index - $probeIndex) % 2 === 0 ? $insideAtProbe : !$insideAtProbe;
        if ($inside && $marks[$index + 1] - $marks[$index] > AVESMAPS_ECOSYSTEM_INTERVAL_EPSILON) {
            $intervals[] = ['enter' => $marks[$index], 'exit' => $marks[$index + 1]];
        }
    }

    return $intervals;
}
