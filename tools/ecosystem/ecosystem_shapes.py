"""Raster component -> simplified GeoJSON ring (plan V5, questions 2 and 3).

Technique borrowed from 27_polygonize_town_tiles.py in the neighbouring repo (findContours +
approxPolyDP). Two deliberate differences: that script writes PIXELS back into a tile and may
therefore jitter its polygons for looks; this one writes MAP COORDINATES into the database and
must not invent a single corner. And it uses RETR_CCOMP, not RETR_EXTERNAL, because a lake
inside an island is a hole, not a separate area.
"""
from __future__ import annotations

import cv2
import numpy as np

from ecosystem_raster import pixel_to_map

MIN_RING_POSITIONS = 3          # api/_internal/app/ecosystem.php:414 refuses anything smaller
MIN_HOLE_AREA_PX = 16           # below this a "hole" is mask noise, not a lake
SIMPLIFY_FLOOR_PX = 0.75        # 27_polygonize_town_tiles.py:139 uses the same floor
SIMPLIFY_RATIO = 0.002          # owner-approved 2026-07-27, see the plan's question 3


def component_rings(component: np.ndarray) -> list[list[np.ndarray]]:
    """[[outer, hole, hole, ...], [outer, ...]] in pixel coordinates, one entry per part."""
    contours, hierarchy = cv2.findContours(
        component.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE
    )
    if hierarchy is None:
        return []

    hierarchy = hierarchy[0]
    parts: list[list[np.ndarray]] = []
    index_of_outer: dict[int, int] = {}

    for index, (contour, node) in enumerate(zip(contours, hierarchy)):
        if node[3] != -1:                       # has a parent -> it is a hole
            continue
        if len(contour) < MIN_RING_POSITIONS:
            continue
        index_of_outer[index] = len(parts)
        parts.append([contour.reshape(-1, 2)])

    for index, (contour, node) in enumerate(zip(contours, hierarchy)):
        parent = int(node[3])
        if parent == -1 or parent not in index_of_outer:
            continue
        if len(contour) < MIN_RING_POSITIONS or cv2.contourArea(contour) < MIN_HOLE_AREA_PX:
            continue
        parts[index_of_outer[parent]].append(contour.reshape(-1, 2))

    parts.sort(key=lambda rings: -cv2.contourArea(rings[0].astype(np.int32)))
    return parts


def simplify_ring(ring: np.ndarray, ratio: float = SIMPLIFY_RATIO,
                  floor_px: float = SIMPLIFY_FLOOR_PX) -> np.ndarray:
    """Douglas-Peucker with epsilon as a FRACTION OF THE RING'S OWN PERIMETER.

    🔴 Not an absolute epsilon. The shapes differ by a factor of 28 in perimeter (Maraskan 5602
    raw corners, the island Sigorast 200), so one absolute value cannot serve both: at eps = 1.0
    map units Maraskan keeps 126 corners while Sigorast collapses to 4 and the Angbarer See to a
    10-gon cutting across its own shore. Relative keeps every shape at a comparable corner count.

    At the approved ratio 0.002 the reference shapes land at Maraskan 84, Ochsenwasser 56,
    Angbarer See 69, Sigorast 38 -- all under the live baronie density (median 49, p90 85,
    max 147), which is the reference this layer is allowed to be coarser than.

    Same arithmetic as 27_polygonize_town_tiles.py:139 in the neighbouring repo.
    """
    contour = ring.astype(np.int32)
    epsilon = max(cv2.arcLength(contour, True) * ratio, floor_px)
    simplified = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
    return simplified if len(simplified) >= MIN_RING_POSITIONS else ring


def build_geometry(parts: list[list[np.ndarray]], size: int,
                   ratio: float = SIMPLIFY_RATIO, decimals: int = 4) -> dict:
    """GeoJSON Polygon / MultiPolygon in [x, y] order, every ring closed.

    🔴 [x, y], NOT swapped. Leaflet's L.CRS.Simple wants [lat, lng] = [y, x]; the swap happens in
    the CLIENT (js/map-features/map-features-ecosystem-rendering.js), never here and never in the
    database. api/_internal/app/ecosystem.php:396 says the same thing from the other side.
    """
    polygons: list[list[list[list[float]]]] = []
    for rings in parts:
        built: list[list[list[float]]] = []
        for ring in rings:
            simplified = simplify_ring(ring, ratio)
            positions = []
            for col, row in simplified:
                x, y = pixel_to_map(int(row), int(col), size)
                positions.append([round(x, decimals), round(y, decimals)])
            if len(positions) < MIN_RING_POSITIONS:
                continue
            if positions[0] != positions[-1]:
                positions.append(list(positions[0]))
            built.append(positions)
        if built:
            polygons.append(built)

    if not polygons:
        raise ValueError("component produced no usable ring")
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": polygons}


def count_positions(geometry: dict) -> int:
    if geometry["type"] == "Polygon":
        return sum(len(ring) for ring in geometry["coordinates"])
    return sum(len(ring) for polygon in geometry["coordinates"] for ring in polygon)
