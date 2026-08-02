<?php

declare(strict_types=1);

// „Wegprofile kalibrieren" -- the global scale factor `c` that ties the travel model to the DSA
// rule, plus the per-way-type means that would later dissolve the double counting.
// Auftrag: docs/wege-editor-instruction.md §4.
//
// PURITY CONTRACT: everything that COMPUTES here is side-effect-free and takes plain arrays. Only
// the three functions at the bottom touch a PDO, and they are the only ones that cannot be unit
// tested locally. Tests: api/_internal/routing/__tests__/terrain-calibration-test.php
//
// ══ THE RULE ═════════════════════════════════════════════════════════════════════════════════
//
//     c = 30 · Σ(lᵢ · Fᵢ) / Σlᵢ        over G = every way of type „Strasse"
//
// `F` is the TIME FACTOR (≥ 1), never a speed. `Strasse` is the reference because it is the ×1,0
// category DSA's multiplier table is built around.
//
// ⭐ WHY THE LENGTH-WEIGHTED ARITHMETIC MEAN IS THE RIGHT ONE, and not a taste question: travel
// time is l·F/v₀ and therefore ADDITIVE. The mean speed over the whole reference set is
// Σl / Σ(l·F/v₀) = v₀ / (Σ(lF)/Σl). So making the real average day come out at 30 miles means
// v₀ = 30 · Σ(lF)/Σl -- exactly the formula above.
//
// 💣 WHOEVER AVERAGES SPEEDS INSTEAD OF FACTORS misses it, because that is the harmonic mean of the
// quantity that actually adds up. On the two-piece example in the tests it is off by more than 30 %.
//
// ══ AND FIVE TRAPS, ALL OF THEM PAID FOR ═════════════════════════════════════════════════════
//
// 1. 💣 ONLY WRITE ON `$done`. The profile run is resumable and can be left lying around; until it
//    finishes the OLD `c` stands. Half a calibration would move the speed of the entire map.
// 2. 💣 WAYS THAT TOUCH NO RASTER GET NO ROW (bounding-box pre-filter), so the measurement runs over
//    MEASURED ways. That is correct -- there `F = 1` means „unknown", not „level" -- but it has to
//    appear in the report, which is why `skipped_ways` is not optional.
// 3. 💣 ACCUMULATE UNCAPPED. Without the cap the model is additive, so the length-weighted mean over
//    edges is bit-identical with the value of the whole way. `min(4,0, …)` breaks that -- and the
//    profile run does not even know where the edges are.
// 4. 💣 BOTH DIRECTIONS COUNT EQUALLY. Forwards `ascent` + `steep_descent`, backwards `descent` +
//    `steep_ascent`, both out of the same four stored sums.
// 5. 💣 `c` IS A SILENT SYSTEM CONSTANT. If it changes, the speed of the whole map changes without
//    anyone clicking anything -- so the result names the old value beside the new one and carries
//    the `map_revision` it was born under.
//
// ⚠️ INERT. This computes, stores and reports. It changes NO travel time, and nothing in the router
// reads `calibration_json`. That stays true until the owner has decided on the curve and the mⱼ.

require_once __DIR__ . '/terrain-factor.php';

// The DSA reference: miles per travelling day on a road. `c` scales the model so that the real
// average over measured terrain lands back on this number.
const AVESMAPS_TERRAIN_CALIBRATION_TARGET_MILES = 30.0;

// The reference set G. One subtype, deliberately: it is the ×1,0 category.
const AVESMAPS_TERRAIN_CALIBRATION_REFERENCE_SUBTYPE = 'Strasse';

/**
 * PURE: chord lengths of a LineString's pieces, in map units.
 *
 * 💣 THE LENGTH IS WHY THIS LIVES IN THE PROFILE RUN AT ALL. `path_terrain` stores four numbers per
 * piece but no length, so no SQL query over that table can reconstruct a factor. The run has the
 * geometry in hand anyway.
 */
function avesmapsTerrainCalibrationPieceLengths(array $coordinates): array
{
    $lengths = [];
    $count = count($coordinates);
    for ($i = 1; $i < $count; $i++) {
        $a = $coordinates[$i - 1];
        $b = $coordinates[$i];
        if (!is_array($a) || !is_array($b) || count($a) < 2 || count($b) < 2) {
            return [];
        }
        $lengths[] = sqrt(
            ((float) $b[0] - (float) $a[0]) ** 2 + ((float) $b[1] - (float) $a[1]) ** 2
        );
    }

    return $lengths;
}

/**
 * PURE: the UNCAPPED time factor of one traversal.
 *
 * Same arithmetic as avesmapsTerrainLeistungsFactor minus the `min()` -- see trap 3. Kept as its own
 * function rather than a flag on the router's one, because the router must never accidentally get
 * an uncapped factor.
 */
function avesmapsTerrainCalibrationFactor(float $ascentSchritt, float $steepDescentSchritt, float $distanceMapunits): float
{
    if ($distanceMapunits <= 0.0) {
        return 1.0;
    }
    $miles = $distanceMapunits * AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT;
    if ($miles <= 0.0) {
        return 1.0;
    }
    $extra = max(0.0, $ascentSchritt) / AVESMAPS_TERRAIN_LKM_ASCENT_SCHRITT
        + max(0.0, $steepDescentSchritt) / AVESMAPS_TERRAIN_LKM_DESCENT_SCHRITT;

    return 1.0 + $extra / $miles;
}

/** PURE: an empty accumulator. */
function avesmapsTerrainCalibrationEmpty(): array
{
    return ['by_subtype' => [], 'measured_ways' => 0, 'skipped_ways' => 0];
}

/**
 * PURE: fold ONE way into the accumulator.
 *
 * `$profile` is the four-number-per-piece array the run just computed, or null when the way touched
 * no raster. `$pieceLengths` are its chord lengths in map units.
 *
 * 💣 BOTH DIRECTIONS, EQUALLY WEIGHTED (trap 4). A way contributes its length twice -- once forwards,
 * once backwards -- because a road is travelled both ways and a pass that is brutal uphill is gentle
 * downhill. Weighting only the stored direction would price half the map by accident.
 */
function avesmapsTerrainCalibrationAdd(array $accumulator, ?array $profile, array $pieceLengths, string $subtype): array
{
    if ($profile === null || $profile === []) {
        // Trap 2: no raster contact -> no row, and the report must say how many.
        $accumulator['skipped_ways']++;
        return $accumulator;
    }

    $ascent = 0.0;
    $descent = 0.0;
    $steepAscent = 0.0;
    $steepDescent = 0.0;
    foreach ($profile as $piece) {
        // The format guard: rows written before 2026-07-30 hold pairs of two, and a pre-model row
        // must read as „no data", never as a Leistungsmeilen sum.
        if (!is_array($piece) || count($piece) < 4) {
            $accumulator['skipped_ways']++;
            return $accumulator;
        }
        $ascent += (float) $piece[0];
        $descent += (float) $piece[1];
        $steepAscent += (float) $piece[2];
        $steepDescent += (float) $piece[3];
    }

    $length = array_sum($pieceLengths);
    if ($length <= 0.0) {
        $accumulator['skipped_ways']++;
        return $accumulator;
    }

    $forward = avesmapsTerrainCalibrationFactor($ascent, $steepDescent, $length);
    $backward = avesmapsTerrainCalibrationFactor($descent, $steepAscent, $length);

    if (!isset($accumulator['by_subtype'][$subtype])) {
        $accumulator['by_subtype'][$subtype] = ['length' => 0.0, 'length_factor' => 0.0, 'ways' => 0];
    }
    // Each direction contributes the full length, so the weights stay comparable across subtypes.
    $accumulator['by_subtype'][$subtype]['length'] += 2 * $length;
    $accumulator['by_subtype'][$subtype]['length_factor'] += $length * ($forward + $backward);
    $accumulator['by_subtype'][$subtype]['ways']++;
    $accumulator['measured_ways']++;

    return $accumulator;
}

/**
 * PURE: turn the accumulator into the report.
 *
 * Returns null when the reference set is empty -- „no roads measured" is not a `c` of zero, and a
 * zero here would flatten the whole map on the day someone wires it up.
 */
function avesmapsTerrainCalibrationFinish(array $accumulator, ?float $previousC, int $mapRevision): ?array
{
    $reference = $accumulator['by_subtype'][AVESMAPS_TERRAIN_CALIBRATION_REFERENCE_SUBTYPE] ?? null;
    if ($reference === null || ($reference['length'] ?? 0.0) <= 0.0) {
        return null;
    }

    $meanG = $reference['length_factor'] / $reference['length'];
    if ($meanG <= 0.0) {
        return null;
    }

    $means = [];
    foreach ($accumulator['by_subtype'] as $subtype => $sums) {
        if (($sums['length'] ?? 0.0) <= 0.0) {
            continue;
        }
        $means[$subtype] = [
            'mean_factor' => $sums['length_factor'] / $sums['length'],
            'ways' => (int) $sums['ways'],
            // The share of the reference mean -- the multiplier by which mⱼ = μⱼ · this would
            // dissolve the double counting. Reported, never applied.
            'relative_to_reference' => ($sums['length_factor'] / $sums['length']) / $meanG,
        ];
    }
    ksort($means);

    return [
        'c' => AVESMAPS_TERRAIN_CALIBRATION_TARGET_MILES * $meanG,
        // The target `c` was calibrated AGAINST, carried so the editor can name it without keeping
        // its own copy of the 30. It travels with the RUN, not with the current constant: an old
        // `c` was computed against the target of its own day, and showing today's next to it would
        // silently misdescribe it.
        'target_miles' => AVESMAPS_TERRAIN_CALIBRATION_TARGET_MILES,
        'previous_c' => $previousC,
        'mean_reference_factor' => $meanG,
        'reference_subtype' => AVESMAPS_TERRAIN_CALIBRATION_REFERENCE_SUBTYPE,
        'by_subtype' => $means,
        'measured_ways' => (int) $accumulator['measured_ways'],
        // Trap 2: this number belongs in the report, not in a comment.
        'skipped_ways' => (int) $accumulator['skipped_ways'],
        // Trap 5: the way network changes between two runs, so the revision travels with the value.
        'map_revision' => $mapRevision,
    ];
}

// ── The three that touch a PDO ────────────────────────────────────────────────────────────────

/**
 * Make sure path_terrain_stamp can hold the accumulator and the result.
 *
 * 💣 PER COLUMN, not „does the table exist". A retrofit that checks one column and then adds three
 * leaves the other two missing forever on any database that already got the first one.
 * Called from the WRITE path only -- never from a read (AGENTS.md §10).
 */
function avesmapsTerrainCalibrationEnsureColumns(PDO $pdo): void
{
    $existing = [];
    try {
        foreach ($pdo->query('SHOW COLUMNS FROM path_terrain_stamp')->fetchAll(PDO::FETCH_ASSOC) as $column) {
            $existing[(string) $column['Field']] = true;
        }
    } catch (PDOException) {
        return;   // no table yet -- the profile run's own `begin` creates it first
    }

    if (!isset($existing['calibration_run_json'])) {
        $pdo->exec('ALTER TABLE path_terrain_stamp ADD COLUMN calibration_run_json JSON NULL');
    }
    if (!isset($existing['calibration_json'])) {
        $pdo->exec('ALTER TABLE path_terrain_stamp ADD COLUMN calibration_json JSON NULL');
    }
}

/**
 * The stored calibration, or null.
 *
 * ⚠️ READ PATH: no DDL, and a missing table or column is a normal state (nothing calibrated yet).
 */
function avesmapsTerrainCalibrationRead(PDO $pdo): ?array
{
    try {
        $value = $pdo->query('SELECT calibration_json FROM path_terrain_stamp WHERE id = 1')->fetchColumn();
    } catch (PDOException) {
        return null;
    }
    if ($value === false || $value === null || (string) $value === '') {
        return null;
    }
    $decoded = json_decode((string) $value, true);
    if (!is_array($decoded)) {
        return null;
    }
    // Runs written before `target_miles` existed carry the value it was computed with anyway --
    // the constant has never changed. Filled in here rather than in the editor, so the 30 stays in
    // exactly one place and the reader never has to know whether the row is old.
    $decoded['target_miles'] ??= AVESMAPS_TERRAIN_CALIBRATION_TARGET_MILES;

    return $decoded;
}

/** The running accumulator of the current run, or a fresh one. */
function avesmapsTerrainCalibrationReadRun(PDO $pdo): array
{
    try {
        $value = $pdo->query('SELECT calibration_run_json FROM path_terrain_stamp WHERE id = 1')->fetchColumn();
    } catch (PDOException) {
        return avesmapsTerrainCalibrationEmpty();
    }
    if ($value === false || $value === null || (string) $value === '') {
        return avesmapsTerrainCalibrationEmpty();
    }
    $decoded = json_decode((string) $value, true);
    if (!is_array($decoded) || !isset($decoded['by_subtype'])) {
        return avesmapsTerrainCalibrationEmpty();
    }

    return $decoded;
}

/**
 * Persist the running accumulator, and -- ONLY when the run is finished -- the result.
 *
 * 💣 TRAP 1 LIVES HERE. `calibration_json` is written on `$done` and never before, so an interrupted
 * run leaves the previous calibration standing rather than a half-measured one.
 */
function avesmapsTerrainCalibrationWrite(PDO $pdo, array $accumulator, bool $done, int $mapRevision): ?array
{
    avesmapsTerrainCalibrationEnsureColumns($pdo);

    $result = null;
    if ($done) {
        $previous = avesmapsTerrainCalibrationRead($pdo);
        $previousC = is_array($previous) && isset($previous['c']) ? (float) $previous['c'] : null;
        $result = avesmapsTerrainCalibrationFinish($accumulator, $previousC, $mapRevision);
    }

    $statement = $pdo->prepare(
        'UPDATE path_terrain_stamp
            SET calibration_run_json = :run'
        . ($result === null ? '' : ', calibration_json = :result')
        . ' WHERE id = 1'
    );
    $parameters = ['run' => json_encode($accumulator)];
    if ($result !== null) {
        $parameters['result'] = json_encode($result);
    }
    $statement->execute($parameters);

    return $result;
}
