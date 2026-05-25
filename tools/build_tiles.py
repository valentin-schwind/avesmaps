#!/usr/bin/env python3
"""Build Leaflet CRS.Simple tiles for the Avesmaps raster map."""

from __future__ import annotations

import argparse
import math
import shutil
from pathlib import Path

from PIL import Image


DEFAULT_WORLD_SIZE = 1024
DEFAULT_TILE_SIZE = 256
DEFAULT_QUALITY = 82


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build Avesmaps raster tiles matching the current Leaflet coordinate system."
    )
    parser.add_argument("--input", required=True, type=Path, help="Source PNG, e.g. merged_water_and_land_edited.png.")
    parser.add_argument("--output", required=True, type=Path, help="Output tile directory.")
    parser.add_argument("--tile-size", type=int, default=DEFAULT_TILE_SIZE, help="Tile edge length in pixels.")
    parser.add_argument("--world-size", type=int, default=DEFAULT_WORLD_SIZE, help="Leaflet world size at zoom 0.")
    parser.add_argument("--max-zoom", type=int, default=None, help="Highest zoom level. Defaults to input/world-size.")
    parser.add_argument("--format", choices=("webp", "jpg", "png"), default="webp", help="Output image format.")
    parser.add_argument("--quality", type=int, default=DEFAULT_QUALITY, help="WebP/JPEG quality, 1-100.")
    parser.add_argument("--prefix", default="map", help="Output filename prefix.")
    parser.add_argument("--clean", action="store_true", help="Delete the output directory before writing tiles.")
    return parser.parse_args()


def calculate_max_zoom(image_size: int, world_size: int) -> int:
    zoom_factor = image_size / world_size
    max_zoom = math.log2(zoom_factor)
    if not max_zoom.is_integer():
        raise ValueError(f"Input size {image_size}px is not world-size * 2^z for world size {world_size}px.")

    return int(max_zoom)


def ensure_supported_input(image: Image.Image, world_size: int, max_zoom: int) -> None:
    width, height = image.size
    if width != height:
        raise ValueError(f"Input must be square, got {width}x{height}px.")

    expected_size = world_size * (2**max_zoom)
    if width != expected_size:
        raise ValueError(f"Input is {width}px wide, but max zoom {max_zoom} expects {expected_size}px.")


def leaflet_tile_name(prefix: str, x_index: int, y_index: int, tiles_per_side: int, extension: str) -> str:
    leaflet_y = y_index - tiles_per_side
    return f"{prefix}_{x_index}_{leaflet_y}.{extension}"


def save_tile(tile: Image.Image, output_path: Path, image_format: str, quality: int) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if image_format == "webp":
        tile.save(output_path, "WEBP", quality=quality, method=6)
        return

    if image_format == "jpg":
        tile.convert("RGB").save(output_path, "JPEG", quality=quality, optimize=True)
        return

    tile.save(output_path, "PNG", optimize=True)


def build_tiles(args: argparse.Namespace) -> int:
    if args.clean and args.output.exists():
        shutil.rmtree(args.output)

    Image.MAX_IMAGE_PIXELS = None
    source = Image.open(args.input)

    max_zoom = args.max_zoom if args.max_zoom is not None else calculate_max_zoom(source.size[0], args.world_size)
    ensure_supported_input(source, args.world_size, max_zoom)

    extension = "jpg" if args.format == "jpg" else args.format
    tile_count = 0

    for zoom in range(max_zoom + 1):
        zoom_pixel_size = args.world_size * (2**zoom)
        tiles_per_side = zoom_pixel_size // args.tile_size
        source_pixels_per_tile = source.size[0] / tiles_per_side

        for y_index in range(tiles_per_side):
            for x_index in range(tiles_per_side):
                left = round(x_index * source_pixels_per_tile)
                upper = round(y_index * source_pixels_per_tile)
                right = round((x_index + 1) * source_pixels_per_tile)
                lower = round((y_index + 1) * source_pixels_per_tile)
                tile = source.crop((left, upper, right, lower))
                if tile.size != (args.tile_size, args.tile_size):
                    tile = tile.resize((args.tile_size, args.tile_size), Image.Resampling.LANCZOS)

                output_path = args.output / str(zoom) / leaflet_tile_name(args.prefix, x_index, y_index, tiles_per_side, extension)
                save_tile(tile, output_path, args.format, args.quality)
                tile_count += 1

        print(f"z{zoom}: {tiles_per_side}x{tiles_per_side} tiles")

    return tile_count


def main() -> int:
    args = parse_args()
    try:
        tile_count = build_tiles(args)
    except Exception as error:
        print(f"Tile build failed: {error}")
        return 1

    print(f"Done: wrote {tile_count} tiles to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
