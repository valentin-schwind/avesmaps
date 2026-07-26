"""Unit tests for the Landschaften V5 tile derivation (plan V5).

Standalone runner, no pytest: this repository has no Python test dependency and its house
style is a script you can just run (tools/wikidump/test-*.php, tools/paths/test-*.mjs).

    python test_ecosystem_v5.py

Every scene is SYNTHETIC -- no tile, no network, no payload, no randomness. The checks that
need real data live in verify_orientation.py and in the derivation report.
"""
from __future__ import annotations

import sys
import traceback

import cv2
import numpy as np

from ecosystem_raster import (
    assemble_tiles,  # noqa: F401  (imported so a broken module fails loudly here)
    map_to_pixel,
    pixel_to_map,
    pixels_per_unit,
    split_water,
    water_mask,
)
from ecosystem_shapes import build_geometry, component_rings, count_positions, simplify_ring

DEEP_WATER = (40, 90, 170)      # deep ocean blue: B-G=80, B-R=130, hue ~108
SHALLOW = (91, 171, 158)        # measured shallow shelf: B-G=-13 -> the whole point
LAND = (150, 140, 95)           # dry parchment land: B < R, must never be water


def make_scene():
    """64x64: ocean everywhere, two land squares separated ONLY by a shallow strip,
    plus one enclosed lake inside the left square."""
    rgb = np.zeros((64, 64, 3), dtype=np.uint8)
    rgb[:, :] = DEEP_WATER
    rgb[20:44, 8:28] = LAND          # left island
    rgb[20:44, 36:56] = LAND         # right island
    rgb[20:44, 28:36] = SHALLOW      # the strip between them
    rgb[28:36, 14:22] = DEEP_WATER   # a lake inside the left island
    return rgb


def test_shallow_shelf_counts_as_water():
    water = water_mask(make_scene())
    assert water[30, 31], "the shallow strip must be water, else the islands weld together"


def test_two_islands_stay_separate():
    _, _, land = split_water(water_mask(make_scene()))
    count, _, _, _ = cv2.connectedComponentsWithStats(land.astype(np.uint8), connectivity=8)
    assert count - 1 == 2, f"expected 2 land components, got {count - 1}"


def test_lake_is_not_ocean():
    ocean, lake, _ = split_water(water_mask(make_scene()))
    assert lake[31, 17] and not ocean[31, 17], "an enclosed lake must not be ocean"
    assert ocean[2, 2] and not lake[2, 2], "the border-connected sea must be ocean"


def test_production_offset_would_weld_them():
    """Guards the correction itself: with the production +10 the test scene fails."""
    _, _, land = split_water(water_mask(make_scene(), blue_over_green=10))
    count, _, _, _ = cv2.connectedComponentsWithStats(land.astype(np.uint8), connectivity=8)
    assert count - 1 == 1, "with B>=G+10 the shelf is land and the islands become one"


def test_land_is_never_water():
    water = water_mask(make_scene())
    assert not water[22, 10], "dry land must not be water"


def test_top_row_is_y_1024():
    """The single most dangerous line in V5. Wrong way round, everything looks plausible
    and lies mirrored. js/config.js MAP_BOUNDS = [[0,0],[1024,1024]] with lat = y, and the
    decoration anchors (compass [18,1006] bottom-right, logo [1006,18] top-left) fix which
    end is up: y = 1024 is the TOP."""
    x, y = pixel_to_map(0, 0, 8192)
    assert (round(x, 4), round(y, 4)) == (0.0625, 1023.9375)
    assert map_to_pixel(0.0, 1024.0, 8192) == (0, 0)


def test_bottom_right_is_x_1024_y_0():
    x, y = pixel_to_map(8191, 8191, 8192)
    assert round(x, 3) == 1023.938 and round(y, 3) == 0.062


def test_roundtrip_is_stable():
    for x, y in [(522.0, 496.25), (1010.0, 749.0), (0.5, 1023.5)]:
        row, col = map_to_pixel(x, y, 8192)
        rx, ry = pixel_to_map(row, col, 8192)
        assert abs(rx - x) <= 0.125 and abs(ry - y) <= 0.125


def test_pixels_per_unit():
    assert pixels_per_unit(8192) == 8.0
    assert pixels_per_unit(4096) == 4.0


def square_with_hole():
    mask = np.zeros((64, 64), dtype=bool)
    mask[10:50, 10:50] = True
    mask[24:34, 24:34] = False        # a hole -> a lake inside an island
    return mask


def test_rings_find_the_hole():
    parts = component_rings(square_with_hole())
    assert len(parts) == 1, "one connected component"
    assert len(parts[0]) == 2, "an outer ring and one hole"


def test_simplify_reduces_a_square_to_its_corners():
    parts = component_rings(square_with_hole())
    simplified = simplify_ring(parts[0][0], ratio=0.002)
    assert len(simplified) == 4, f"a square simplifies to 4 corners, got {len(simplified)}"


def _disc(radius: int) -> np.ndarray:
    size = radius * 4
    mask = np.zeros((size, size), dtype=np.uint8)
    cv2.circle(mask, (size // 2, size // 2), radius, 1, -1)
    return mask.astype(bool)


def test_relative_simplification_narrows_the_spread_between_sizes():
    """The reason simplification is relative and not absolute.

    An absolute epsilon is a fixed DISTANCE, so it eats a large fraction of a small shape and a
    tiny fraction of a large one -- the corner counts fan out. A relative epsilon scales with the
    shape, so large and small land closer together. That is the whole property, and it is what
    keeps a small island from being flattened into a triangle while a big one keeps its bays.

    Measured on the real shapes: at absolute eps 1.0 map units Maraskan keeps 126 corners and the
    island Sigorast 4 -- a spread of 31x. At ratio 0.002 it is 84 against 38, a spread of 2.2x.

    (The 0.75 px floor takes over below a perimeter of ~375 px, so a very small shape is capped
    at its maximum available detail. That narrows the spread further, it does not widen it.)"""
    rings = {radius: component_rings(_disc(radius))[0][0] for radius in (12, 120)}

    relative = {r: len(simplify_ring(ring, ratio=0.002)) for r, ring in rings.items()}
    absolute = {r: len(cv2.approxPolyDP(ring.astype(np.int32), 1.5, True)) for r, ring in rings.items()}

    relative_spread = max(relative.values()) / min(relative.values())
    absolute_spread = max(absolute.values()) / min(absolute.values())
    assert relative_spread < absolute_spread, (
        f"relative must fan out LESS than absolute: {relative_spread:.2f}x vs {absolute_spread:.2f}x")

    assert relative[12] > absolute[12], (
        f"the small shape must keep more corners under relative: {relative[12]} vs {absolute[12]}")
    assert relative[12] >= 8, f"a small disc must keep a usable outline, got {relative[12]}"


def test_geometry_is_closed_and_in_geojson_order():
    geometry = build_geometry(component_rings(square_with_hole()), size=512, ratio=0.002)
    assert geometry["type"] == "Polygon"
    outer = geometry["coordinates"][0]
    assert outer[0] == outer[-1], "GeoJSON rings must be closed"
    assert len(geometry["coordinates"]) == 2, "outer ring plus hole"
    xs = [p[0] for p in outer]
    ys = [p[1] for p in outer]
    assert all(0.0 <= v <= 1024.0 for v in xs + ys), "every position must sit inside the map"
    assert max(ys) > min(ys), "y must vary -- a flat ring means the flip collapsed"


def test_multipart_becomes_multipolygon():
    mask = np.zeros((64, 64), dtype=bool)
    mask[5:15, 5:15] = True
    mask[40:50, 40:50] = True
    parts = component_rings(mask)
    geometry = build_geometry(parts, size=512, ratio=0.002)
    assert geometry["type"] == "MultiPolygon"
    assert len(geometry["coordinates"]) == 2


def test_positions_are_rounded_to_four_decimals():
    geometry = build_geometry(component_rings(square_with_hole()), size=512, ratio=0.002)
    for x, y in geometry["coordinates"][0]:
        assert x == round(x, 4) and y == round(y, 4)


def test_count_positions_covers_holes_and_parts():
    polygon = build_geometry(component_rings(square_with_hole()), size=512, ratio=0.002)
    assert count_positions(polygon) == sum(len(ring) for ring in polygon["coordinates"])
    mask = np.zeros((64, 64), dtype=bool)
    mask[5:15, 5:15] = True
    mask[40:50, 40:50] = True
    multi = build_geometry(component_rings(mask), size=512, ratio=0.002)
    assert count_positions(multi) == 10, "two closed squares -> 2 x 5 positions"


def _run() -> int:
    tests = [(name, value) for name, value in sorted(globals().items())
             if name.startswith("test_") and callable(value)]
    failed = []
    for name, test in tests:
        try:
            test()
            print(f"  ok    {name}")
        except Exception:
            failed.append(name)
            print(f"  FAIL  {name}")
            traceback.print_exc()
    print(f"\n{len(tests) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_run())
