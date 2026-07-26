"""Derive Landschaften areas from the deployed map tiles (plan V5).

Writes a manifest and a report. It NEVER touches the database and needs no credentials --
import_areas.py does that, separately and on the owner's trigger.

Run:
    python derive_areas.py --payload map-features.json --out manifest.json --report report.md
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from ecosystem_labels import REGION_KIND_BY_SUBTYPE, LandscapeLabel, contested, read_labels, resolve
from ecosystem_raster import WATER_BLUE_OVER_GREEN, assemble_tiles, split_water, water_mask
from ecosystem_raster import pixels_per_unit
from ecosystem_shapes import (
    MIN_HOLE_AREA_UNITS,
    SIMPLIFY_RATIO,
    build_geometry,
    component_rings,
    count_positions,
)

# 🔴 Land and water are derived in SEPARATE passes over SEPARATE component sets, never in one
# shared loop (plan, global constraint 4a). An island and the lake beside it share a pixel edge;
# one loop would let them land in the same kind and produce two areas with the same outline.
WATER_SUBTYPES = {"see"}
LAND_SUBTYPES = {"insel"}

DEFAULT_TILES = r"C:\GIT\avesmaps\tiles\stylized"


def build_manifest(
    labels: list[LandscapeLabel],
    components: np.ndarray,
    stats: np.ndarray,
    size: int,
    simplify_ratio: float,
    zoom: int,
    revision: int,
    blue_over_green: int,
    exclude: int | None = None,
    min_hole_area_units: float = MIN_HOLE_AREA_UNITS,
    keep_holes: bool = True,
) -> dict:
    ppu = pixels_per_unit(size)
    # keep_holes=False punches no holes at all: min area above any conceivable ring.
    min_hole_area_px = (min_hole_area_units * ppu * ppu) if keep_holes else float("inf")
    assignment, unresolved = resolve(labels, components, size, exclude=exclude)
    conflicts = contested(assignment)

    entries = []
    for label_index, component_id in sorted(assignment.items()):
        if component_id in conflicts:
            continue
        label = labels[label_index]
        left = int(stats[component_id, cv2.CC_STAT_LEFT])
        top = int(stats[component_id, cv2.CC_STAT_TOP])
        width = int(stats[component_id, cv2.CC_STAT_WIDTH])
        height = int(stats[component_id, cv2.CC_STAT_HEIGHT])
        window = components[top:top + height, left:left + width] == component_id

        padded = np.zeros((height + 2, width + 2), dtype=bool)
        padded[1:-1, 1:-1] = window          # 1px frame so a border-touching shape keeps its ring
        parts = component_rings(padded, min_hole_area_px=min_hole_area_px)
        if not parts:
            continue
        shifted = [[ring + np.array([left - 1, top - 1]) for ring in rings] for rings in parts]

        try:
            geometry = build_geometry(shifted, size, simplify_ratio)
        except ValueError:
            continue

        entries.append({
            "name": label.name,
            "subtype": label.subtype,
            "kind": REGION_KIND_BY_SUBTYPE[label.subtype],
            "region_type": label.subtype,
            "wiki_url": label.wiki_url,
            "label_public_id": label.public_id,
            "geometry": geometry,
            "position_count": count_positions(geometry),
            "component_area_px": int(stats[component_id, cv2.CC_STAT_AREA]),
        })

    return {
        "generated_for_revision": revision,
        "zoom": zoom,
        "simplify_ratio": simplify_ratio,
        "min_hole_area_units": min_hole_area_units if keep_holes else None,
        "blue_over_green": blue_over_green,
        "entries": entries,
        "contested": [
            {"component": int(component),
             "names": [labels[i].name for i in indices],
             "label_public_ids": [labels[i].public_id for i in indices]}
            for component, indices in sorted(conflicts.items())
        ],
        "unresolved": [{"name": label.name, "subtype": label.subtype} for label in unresolved],
    }


def write_report(path: Path, manifest: dict) -> None:
    entries = manifest["entries"]
    counts = [entry["position_count"] for entry in entries] or [0]
    by_subtype: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    for entry in entries:
        by_subtype[entry["subtype"]] = by_subtype.get(entry["subtype"], 0) + 1
        by_kind[entry["kind"]] = by_kind.get(entry["kind"], 0) + 1

    lines = [
        "# Landschaften V5 -- Ableitungsbericht",
        "",
        f"- Zoom: {manifest['zoom']}  (Kartenaufloesung {4 * 2 ** manifest['zoom'] * 256} px)",
        f"- Vereinfachung: epsilon = Umfang x {manifest['simplify_ratio']}",
        f"- Wasserschwelle: B >= G {manifest['blue_over_green']:+d}",
        (f"- Kleinstes Loch: {manifest['min_hole_area_units']} Karteneinheiten^2"
         if manifest['min_hole_area_units'] else "- Loecher: keine (nur Wasserflaechen bekommen welche)"),
        f"- Nutzlast-Revision: {manifest['generated_for_revision']}",
        "",
        f"**{len(entries)} Flaechen abgeleitet**  "
        + ", ".join(f"{key}: {value}" for key, value in sorted(by_subtype.items())),
        "",
        "Je Ebene (Land und Wasser muessen getrennt bleiben, global constraint 4a):",
        "",
    ]
    for kind, value in sorted(by_kind.items()):
        lines.append(f"- {kind}: {value}")
    lines += [
        "",
        f"- Ecken je Flaeche: Median {int(np.median(counts))}, "
        f"p90 {int(np.percentile(counts, 90))}, max {max(counts)}, Summe {sum(counts)}",
        "- Vergleichsmass Baronie-Dichte (live gemessen): Median 49, p90 85, max 147",
        "",
        f"## Umstritten -- NICHT importiert ({len(manifest['contested'])})",
        "",
    ]
    for conflict in manifest["contested"]:
        lines.append(f"- eine Form, {len(conflict['names'])} Namen: {', '.join(conflict['names'])}")
    lines += ["", f"## Ohne Komponente ({len(manifest['unresolved'])})", ""]
    for item in manifest["unresolved"]:
        lines.append(f"- {item['name']} ({item['subtype']})")
    lines += ["", "## Die groessten Flaechen", ""]
    for entry in sorted(entries, key=lambda e: -e["position_count"])[:15]:
        lines.append(f"- {entry['name']} ({entry['subtype']}): {entry['position_count']} Ecken")
    lines += ["", "## Ohne Wiki-Link", ""]
    for entry in sorted(entries, key=lambda e: e["name"]):
        if not entry["wiki_url"]:
            lines.append(f"- {entry['name']} ({entry['subtype']})")

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Derive Landschaften areas from the map tiles.")
    parser.add_argument("--tiles", default=DEFAULT_TILES)
    parser.add_argument("--payload", required=True)
    parser.add_argument("--zoom", type=int, default=3)
    parser.add_argument("--simplify-ratio", type=float, default=SIMPLIFY_RATIO,
                        help="Douglas-Peucker epsilon as a fraction of each ring's own perimeter.")
    parser.add_argument("--blue-over-green", type=int, default=WATER_BLUE_OVER_GREEN)
    parser.add_argument("--min-hole-area", type=float, default=MIN_HOLE_AREA_UNITS,
                        help="Smallest hole kept, in map units squared.")
    parser.add_argument("--holes", choices=("water", "all", "none"), default="water",
                        help="Which areas get holes punched out. Default: water only -- a lake "
                             "genuinely excludes the islands in it, but a NAMED island still "
                             "covers its own lakes.")
    parser.add_argument("--only", nargs="+", default=None, help="Restrict to these label names.")
    parser.add_argument("--out", default="manifest.json")
    parser.add_argument("--report", default="report.md")
    args = parser.parse_args()

    payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    revision = int(payload.get("revision") or 0)

    rgb = assemble_tiles(Path(args.tiles), args.zoom)
    size = rgb.shape[0]
    _, lake, land = split_water(water_mask(rgb, blue_over_green=args.blue_over_green))

    _, lake_components, lake_stats, _ = cv2.connectedComponentsWithStats(
        lake.astype(np.uint8), connectivity=8)
    land_count, land_components, land_stats, _ = cv2.connectedComponentsWithStats(
        land.astype(np.uint8), connectivity=8)
    mainland = 1 + int(np.argmax([land_stats[i, cv2.CC_STAT_AREA] for i in range(1, land_count)]))

    def pick(labels: list[LandscapeLabel]) -> list[LandscapeLabel]:
        if not args.only:
            return labels
        wanted = set(args.only)
        return [label for label in labels if label.name in wanted]

    water_manifest = build_manifest(
        pick(read_labels(payload, WATER_SUBTYPES)), lake_components, lake_stats,
        size, args.simplify_ratio, args.zoom, revision, args.blue_over_green,
        min_hole_area_units=args.min_hole_area, keep_holes=args.holes in ("water", "all"))
    land_manifest = build_manifest(
        pick(read_labels(payload, LAND_SUBTYPES)), land_components, land_stats,
        size, args.simplify_ratio, args.zoom, revision, args.blue_over_green, exclude=mainland,
        min_hole_area_units=args.min_hole_area, keep_holes=args.holes == "all")

    manifest = water_manifest
    manifest["entries"] += land_manifest["entries"]
    manifest["contested"] += land_manifest["contested"]
    manifest["unresolved"] += land_manifest["unresolved"]

    Path(args.out).write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    write_report(Path(args.report), manifest)
    print(f"{len(manifest['entries'])} areas -> {args.out}")
    print(f"{len(manifest['contested'])} contested, {len(manifest['unresolved'])} unresolved")


if __name__ == "__main__":
    main()
