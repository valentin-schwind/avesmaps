"""Proves the y flip against real tiles and a real map-features payload.

The unit test pins the arithmetic; this pins REALITY. Run it before every derivation run.
Expected at the module defaults (blue_over_green = -20), zoom 2, payload revision 40455:
    wald     4 / 68 on water     (unflipped:  8)  <- forests are not in the sea
    gebirge  1 / 60 on water     (unflipped: 25)
    meer    35 / 35 on water     (unflipped: 24)  <- seas are

The verdict is the COMPARISON, not the absolute count: a class that should be dry must score
lower flipped than unflipped, a wet one higher. The four wet `wald` points are rivers and
forest lakes under the label anchor -- at the production threshold (+10) they read 0 vs 7. That
difference is the cost of the shallow-shelf correction and is irrelevant here: V5 derives only
lakes and islands.

The payload is fetched ONCE, never in a loop (AGENTS.md, STRATO caution):
    curl -s -o map-features.json https://avesmaps.de/api/app/map-features.php
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ecosystem_raster import MAP_SPAN, assemble_tiles, map_to_pixel, water_mask

DEFAULT_TILES = r"C:\GIT\avesmaps\tiles\stylized"


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify the pixel<->map orientation against live labels.")
    parser.add_argument("--tiles", default=DEFAULT_TILES)
    parser.add_argument("--payload", required=True, help="A saved GET /api/app/map-features.php body.")
    parser.add_argument("--zoom", type=int, default=2)
    args = parser.parse_args()

    rgb = assemble_tiles(Path(args.tiles), args.zoom)
    size = rgb.shape[0]
    water = water_mask(rgb)

    payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    points: dict[str, list[tuple[float, float]]] = {}
    for feature in payload["features"]:
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        if properties.get("feature_type") != "label" or geometry.get("type") != "Point":
            continue
        points.setdefault(properties.get("feature_subtype") or "?", []).append(
            (float(geometry["coordinates"][0]), float(geometry["coordinates"][1])))

    print(f"zoom {args.zoom}, {size}x{size} px, payload revision {payload.get('revision')}")
    print(f"{'subtype':12s} {'n':>4} {'flipped':>9} {'unflipped':>11}   verdict")
    failures = 0
    for subtype, expect_water in (("wald", False), ("gebirge", False), ("meer", True)):
        pts = points.get(subtype, [])
        flipped = sum(1 for x, y in pts if water[map_to_pixel(x, y, size)])
        unflipped = sum(1 for x, y in pts if water[map_to_pixel(x, MAP_SPAN - y, size)])
        ok = (flipped > unflipped) if expect_water else (flipped < unflipped)
        failures += 0 if ok else 1
        print(f"{subtype:12s} {len(pts):4d} {flipped:9d} {unflipped:11d}   {'OK' if ok else 'FAILED'}")

    if failures:
        raise SystemExit("orientation check FAILED -- do not run the derivation")
    print("orientation OK")


if __name__ == "__main__":
    main()
