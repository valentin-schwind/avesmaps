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
