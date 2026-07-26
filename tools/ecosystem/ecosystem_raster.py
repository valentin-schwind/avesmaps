"""Land/water raster derivation for the Landschaften layer (plan V5).

The colour rule is NOT invented here. It is the production water mask of the tool chain that
produced these tiles -- 13_make_landmass_rgba.py:316 (build_water_mask) in the neighbouring
repo avesmaps-map-processing -- with exactly ONE measured correction, see WATER_BLUE_OVER_GREEN.

The ocean/lake split is border connectivity, copied from
24_make_water_rgba_from_original_sea_mask.py:196 (border_connected_components). It separates
sea from lake without a single shape heuristic: a lake does not touch the map edge.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# Production defaults from 13_make_landmass_rgba.py
WATER_HUE = (75, 125)          # OpenCV hue, 0..179 -> roughly 150deg..250deg, cyan through blue
WATER_SAT_MIN = 35
WATER_BLUE_OVER_RED = 20
WATER_MIN_AREA = 4

# 🔴 The one deviation, and it is load-bearing. Production demands B >= G + 10. The shallow-water
# shelf of the DEPLOYED tiles is GREEN-dominant turquoise -- measured samples: RGB(91,171,158)
# B-G=-13, (132,178,160) -18, (122,154,143) -11. At +10 that shelf counts as LAND and welds
# neighbouring islands into one component: Archipel A (Sigorast/Gandar/Serreka/Aso) collapses from
# 4 islands to 1, even at zoom 5. At -20 both test archipelagos separate fully. Beyond -20 nothing
# changes any more (measured to -45).
WATER_BLUE_OVER_GREEN = -20

TILE_SIZE = 256
MAP_SPAN = 1024.0              # js/config.js: IMG_WIDTH/IMG_HEIGHT, MAP_BOUNDS [[0,0],[1024,1024]]


def water_mask(
    rgb: np.ndarray,
    hue: tuple[int, int] = WATER_HUE,
    sat_min: int = WATER_SAT_MIN,
    blue_over_green: int = WATER_BLUE_OVER_GREEN,
    blue_over_red: int = WATER_BLUE_OVER_RED,
    min_area: int = WATER_MIN_AREA,
) -> np.ndarray:
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    red = rgb[:, :, 0].astype(np.int16)
    green = rgb[:, :, 1].astype(np.int16)
    blue = rgb[:, :, 2].astype(np.int16)

    candidate = (
        (hsv[:, :, 0] >= hue[0]) & (hsv[:, :, 0] <= hue[1])
        & (hsv[:, :, 1] >= sat_min)
        & (blue >= green + blue_over_green)
        & (blue >= red + blue_over_red)
    )

    binary = candidate.astype(np.uint8) * 255
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), dtype=np.uint8))

    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    cleaned = np.zeros_like(binary)
    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] >= min_area:
            cleaned[labels == index] = 255
    return cleaned > 0


def split_water(water: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(ocean, lake, land). Ocean = water touching the image border, lake = the rest of the water."""
    count, labels, _, _ = cv2.connectedComponentsWithStats(water.astype(np.uint8), connectivity=8)
    if count <= 1:
        empty = np.zeros_like(water)
        return empty, water.copy(), ~water

    border: set[int] = set()
    for edge in (labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]):
        border.update(np.unique(edge).tolist())
    border.discard(0)

    ocean = np.isin(labels, list(border)) if border else np.zeros_like(water)
    return ocean, (water & ~ocean), ~water


def assemble_tiles(tiles_root: Path, zoom: int) -> np.ndarray:
    """Stitch tiles/stylized/<zoom>/map_<x>_<-y>.webp into one RGB image.

    💣 Tile files carry NEGATIVE y (AGENTS.md section 10): the TOP row of pixels is the MOST
    negative tile index. At zoom 0 the top row is map_0_-4 .. map_3_-4, the bottom row map_0_-1.
    """
    per_axis = 4 * (2 ** zoom)
    size = per_axis * TILE_SIZE
    canvas = np.zeros((size, size, 3), dtype=np.uint8)
    zoom_dir = tiles_root / str(zoom)

    for row in range(per_axis):                 # row 0 = top
        tile_y = -(per_axis - row)
        for col in range(per_axis):
            path = zoom_dir / f"map_{col}_{tile_y}.webp"
            if not path.is_file():
                raise SystemExit(f"missing tile: {path}")
            with Image.open(path) as image:
                canvas[row * TILE_SIZE:(row + 1) * TILE_SIZE,
                       col * TILE_SIZE:(col + 1) * TILE_SIZE] = np.array(image.convert("RGB"))
    return canvas


def pixels_per_unit(size: int) -> float:
    return size / MAP_SPAN


def pixel_to_map(row: int, col: int, size: int) -> tuple[float, float]:
    """Pixel centre -> map coordinate (x, y) in GeoJSON order.

    💣 y is FLIPPED: image row 0 is the TOP of the map, and the top is y = 1024.
    Verified empirically against live labels, not derived -- see verify_orientation.py.
    """
    ppu = pixels_per_unit(size)
    return (col + 0.5) / ppu, MAP_SPAN - (row + 0.5) / ppu


def map_to_pixel(x: float, y: float, size: int) -> tuple[int, int]:
    ppu = pixels_per_unit(size)
    row = int(round((MAP_SPAN - y) * ppu - 0.5))
    col = int(round(x * ppu - 0.5))
    return max(0, min(row, size - 1)), max(0, min(col, size - 1))
