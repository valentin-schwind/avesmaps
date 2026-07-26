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
from ecosystem_labels import (
    REGION_KIND_BY_SUBTYPE,
    LandscapeLabel,
    contested,
    read_labels,
    resolve,
)
from derive_areas import build_manifest
from import_areas import build_requests, pending_entries
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


def test_small_holes_are_dropped():
    """💣 Without a hole threshold every pond and stream punches a hole. Measured on the real
    run: Maraskan came out with an 85-corner coastline and 172 holes worth 1753 corners, and
    45 % of the whole run's vertices sat in holes. A route crossing the island would fall out
    of it at every brook."""
    mask = np.zeros((64, 64), dtype=bool)
    mask[10:50, 10:50] = True
    mask[20:30, 20:30] = False        # 100 px -- a real lake
    mask[40:42, 40:42] = False        # 4 px -- a pond, must be ignored
    kept = component_rings(mask, min_hole_area_px=16.0)
    assert len(kept[0]) == 2, f"only the large hole survives, got {len(kept[0]) - 1} holes"
    both = component_rings(mask, min_hole_area_px=1.0)
    assert len(both[0]) == 3, "with a low threshold both holes are kept"


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


def test_positions_are_rounded_the_way_the_server_stores_them():
    """🪤 The server rounds to 3 decimals (api/_internal/bootstrap.php:301). Writing 4 means the
    manifest and the stored row never compare equal -- verified on the live import: all 52 areas
    had identical vertex counts, but 761.4375 came back as 761.438, so a re-check reported 0 of
    52 matching."""
    geometry = build_geometry(component_rings(square_with_hole()), size=512, ratio=0.002)
    for x, y in geometry["coordinates"][0]:
        assert x == round(x, 3) and y == round(y, 3)


def test_count_positions_covers_holes_and_parts():
    polygon = build_geometry(component_rings(square_with_hole()), size=512, ratio=0.002)
    assert count_positions(polygon) == sum(len(ring) for ring in polygon["coordinates"])
    mask = np.zeros((64, 64), dtype=bool)
    mask[5:15, 5:15] = True
    mask[40:50, 40:50] = True
    multi = build_geometry(component_rings(mask), size=512, ratio=0.002)
    assert count_positions(multi) == 10, "two closed squares -> 2 x 5 positions"


def three_blob_scene():
    """A 512px image with three separate blobs; component ids come from OpenCV."""
    mask = np.zeros((512, 512), dtype=np.uint8)
    mask[100:140, 100:140] = 1        # blob A
    mask[100:140, 300:340] = 1        # blob B
    mask[400:440, 400:440] = 1        # blob C
    _, labels, _, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    return labels


def test_label_on_the_blob_resolves_at_radius_zero():
    labels = three_blob_scene()
    # pixel (120,120) at size 512 -> 0.5 px per unit -> x = 120.5/0.5 = 241, y = 1024 - 241
    point = LandscapeLabel("A", "insel", 241.0, 1024.0 - 241.0, "", "id-a")
    assignment, unresolved = resolve([point], labels, size=512)
    assert not unresolved and assignment[0] == labels[120, 120]


def test_label_beside_a_small_island_still_finds_it():
    """Only 14 of 95 island labels sit ON their island; the rest stand beside it, because the
    island is too small to hold the text. x = 285 lands at column 142 -- blob A ends at column
    139, so this point is genuinely OUTSIDE the blob, 3 px = 6 map units away."""
    labels = three_blob_scene()
    point = LandscapeLabel("A", "insel", 285.0, 1024.0 - 241.0, "", "id-a")
    assert labels[120, 142] == 0, "the fixture must place this point off the blob"
    assignment, unresolved = resolve([point], labels, size=512, cap_units=8.0)
    assert not unresolved and assignment[0] == labels[120, 120]


def test_label_beyond_the_cap_stays_unresolved():
    labels = three_blob_scene()
    point = LandscapeLabel("nowhere", "insel", 900.0, 900.0, "", "id-x")
    assignment, unresolved = resolve([point], labels, size=512, cap_units=8.0)
    assert not assignment and [u.name for u in unresolved] == ["nowhere"]


def test_two_labels_on_one_component_are_reported_not_resolved():
    labels = three_blob_scene()
    first = LandscapeLabel("A1", "insel", 241.0, 1024.0 - 241.0, "", "l1")
    second = LandscapeLabel("A2", "insel", 243.0, 1024.0 - 243.0, "", "l2")
    assignment, _ = resolve([first, second], labels, size=512)
    conflicts = contested(assignment)
    assert len(conflicts) == 1 and sorted(next(iter(conflicts.values()))) == [0, 1]


def test_excluded_component_is_never_claimed():
    """The mainland must not be handed to an island label standing on the coast."""
    labels = three_blob_scene()
    mainland = labels[120, 120]
    point = LandscapeLabel("A", "insel", 241.0, 1024.0 - 241.0, "", "id-a")
    assignment, unresolved = resolve([point], labels, size=512, exclude=mainland)
    assert not assignment and unresolved


def test_subtype_maps_to_the_seeded_kind():
    assert REGION_KIND_BY_SUBTYPE == {
        "see": "topographie",
        "insel": "derographisch",
        "kontinent": "derographisch",
        "kueste": "topographie",
        "wueste": "vegetation",
    }


def test_land_and_water_never_share_a_kind():
    """🔴 An island and the water around it share the same pixel edge. If both ended up in the
    same kind, two areas with the same outline would sit in the same Leaflet pane and nobody
    could tell them apart. Land is derographisch, water is topographie -- always."""
    land_kinds = {REGION_KIND_BY_SUBTYPE[s] for s in ("insel", "kontinent")}
    water_kinds = {REGION_KIND_BY_SUBTYPE[s] for s in ("see", "kueste")}
    assert land_kinds == {"derographisch"}
    assert water_kinds == {"topographie"}
    assert not (land_kinds & water_kinds)


def test_read_labels_keeps_only_points_of_the_wanted_subtypes():
    payload = {"features": [
        {"properties": {"feature_type": "label", "feature_subtype": "see", "name": "L",
                        "wiki_url": "https://example.invalid/wiki/L", "public_id": "p1"},
         "geometry": {"type": "Point", "coordinates": [10.0, 20.0]}},
        {"properties": {"feature_type": "label", "feature_subtype": "wald", "name": "W",
                        "public_id": "p2"},
         "geometry": {"type": "Point", "coordinates": [1.0, 2.0]}},
        {"properties": {"feature_type": "location", "feature_subtype": "see", "name": "X",
                        "public_id": "p3"},
         "geometry": {"type": "Point", "coordinates": [3.0, 4.0]}},
    ]}
    found = read_labels(payload, {"see"})
    assert [label.name for label in found] == ["L"]
    assert found[0].x == 10.0 and found[0].y == 20.0 and found[0].public_id == "p1"


def _single_blob():
    mask = np.zeros((512, 512), dtype=np.uint8)
    mask[100:140, 100:140] = 1
    _, components, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    return components, stats


def test_manifest_entry_carries_label_identity_and_no_wiki_key():
    """🔴 wiki_region_key is derived server-side (api/_internal/app/ecosystem.php:688).
    A manifest that ships one would be a second, divergent key derivation."""
    components, stats = _single_blob()
    label = LandscapeLabel("Testinsel", "insel", 241.0, 1024.0 - 241.0,
                           "https://de.wiki-aventurica.de/wiki/Testinsel", "label-1")

    manifest = build_manifest([label], components, stats, size=512, simplify_ratio=0.002,
                              zoom=1, revision=40455, blue_over_green=-20)

    assert len(manifest["entries"]) == 1
    entry = manifest["entries"][0]
    assert entry["name"] == "Testinsel"
    assert entry["kind"] == "derographisch" and entry["region_type"] == "insel"
    assert entry["wiki_url"].endswith("/Testinsel")
    assert entry["label_public_id"] == "label-1"
    assert "wiki_region_key" not in entry, "the key belongs to the server, never to the manifest"
    assert entry["geometry"]["type"] == "Polygon"
    assert entry["position_count"] >= 4


def test_manifest_skips_contested_components():
    components, stats = _single_blob()
    first = LandscapeLabel("A1", "insel", 241.0, 1024.0 - 241.0, "", "l1")
    second = LandscapeLabel("A2", "insel", 243.0, 1024.0 - 243.0, "", "l2")

    manifest = build_manifest([first, second], components, stats, size=512, simplify_ratio=0.002,
                              zoom=1, revision=1, blue_over_green=-20)

    assert manifest["entries"] == []
    assert len(manifest["contested"]) == 1
    assert sorted(manifest["contested"][0]["names"]) == ["A1", "A2"]


def test_manifest_records_the_settings_it_was_built_with():
    components, stats = _single_blob()
    manifest = build_manifest([], components, stats, size=512, simplify_ratio=0.008,
                              zoom=3, revision=40455, blue_over_green=-20)
    assert manifest["simplify_ratio"] == 0.008
    assert manifest["zoom"] == 3
    assert manifest["blue_over_green"] == -20
    assert manifest["generated_for_revision"] == 40455


def test_manifest_geometry_stays_inside_the_map():
    """Every position must survive avesmapsParseMapCoordinate's 0..1024 bound
    (api/_internal/app/ecosystem.php). A shape touching the raster edge is the risky case."""
    mask = np.zeros((512, 512), dtype=np.uint8)
    mask[0:40, 0:40] = 1                       # flush against the top-left corner
    _, components, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    label = LandscapeLabel("Ecke", "insel", 40.0, 1024.0 - 40.0, "", "l-edge")
    manifest = build_manifest([label], components, stats, size=512, simplify_ratio=0.002,
                              zoom=1, revision=1, blue_over_green=-20)
    assert len(manifest["entries"]) == 1
    for ring in manifest["entries"][0]["geometry"]["coordinates"]:
        for x, y in ring:
            assert 0.0 <= x <= 1024.0 and 0.0 <= y <= 1024.0, f"out of bounds: {x}, {y}"


def sample_entry():
    return {
        "name": "Angbarer See", "subtype": "see", "kind": "topographie", "region_type": "see",
        "wiki_url": "https://de.wiki-aventurica.de/wiki/Angbarer_See",
        "label_public_id": "label-42",
        "geometry": {"type": "Polygon",
                     "coordinates": [[[1.0, 2.0], [3.0, 2.0], [3.0, 4.0], [1.0, 2.0]]]},
        "position_count": 4, "component_area_px": 900,
    }


def test_region_request_sends_wiki_url_and_never_a_key():
    region, area = build_requests(sample_entry())
    assert region["action"] == "create_region"
    assert region["kind"] == "topographie" and region["region_type"] == "see"
    assert region["wiki_url"].endswith("/Angbarer_See")
    assert region["label_public_id"] == "label-42"
    assert "wiki_region_key" not in region, "the server derives it (ecosystem.php:636)"
    assert area["action"] == "create_area"


def test_area_request_states_is_trial_false_explicitly():
    """Otherwise create_area falls back to app_setting['ecosystem_trial'] (ecosystem.php:960)
    and the import would depend on whether the owner already ran promote_trial."""
    _, area = build_requests(sample_entry())
    assert area["is_trial"] is False


def test_empty_wiki_url_is_omitted_not_sent_empty():
    entry = dict(sample_entry(), wiki_url="")
    region, _ = build_requests(entry)
    assert "wiki_url" not in region, "19 of 149 labels have none -- an empty string is not a URL"


def test_already_imported_entries_are_skipped():
    state = {"label-42": {"region_public_id": "r1", "area_public_id": "a1"}}
    assert pending_entries([sample_entry()], state) == []
    assert len(pending_entries([sample_entry()], {})) == 1


def test_half_finished_entry_resumes_at_the_area():
    """A region written but no area yet must be FINISHED, not skipped -- otherwise a broken run
    leaves a nameless region behind and the area never arrives."""
    state = {"label-42": {"region_public_id": "r1"}}
    pending = pending_entries([sample_entry()], state)
    assert len(pending) == 1


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
