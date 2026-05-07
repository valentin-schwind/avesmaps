#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import logging
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from math import hypot, inf
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

ViewBox = Tuple[float, float, float, float]
Coordinate = Tuple[float, float]

INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape"
ATTR_INKSCAPE_LABEL = f"{{{INKSCAPE_NAMESPACE}}}label"
ATTR_INKSCAPE_GROUPMODE = f"{{{INKSCAPE_NAMESPACE}}}groupmode"
PATH_TOKEN_RE = re.compile(r"[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?")
PATH_PARAM_COUNT = {
    "M": 2,
    "L": 2,
    "H": 1,
    "V": 1,
    "C": 6,
    "S": 4,
    "Q": 4,
    "T": 2,
    "A": 7,
    "Z": 0,
}

SETTLEMENT_LAYERS = {
    "Metropolen": {"class": "metropole", "label": "Metropole", "icon": "🏛️"},
    "Großstädte": {"class": "grossstadt", "label": "Großstadt", "icon": "🏰"},
    "Städte": {"class": "stadt", "label": "Stadt", "icon": "⛪"},
    "Kleinstädte": {"class": "kleinstadt", "label": "Kleinstadt", "icon": "🏘️"},
    "Dörfer": {"class": "dorf", "label": "Dorf", "icon": "🏡"},
    "Gebaeude": {"class": "gebaeude", "label": "Besondere Bauwerke/Staetten", "icon": "bauwerk"},
    "Gebäude": {"class": "gebaeude", "label": "Besondere Bauwerke/Stätten", "icon": "bauwerk"},
    "Besondere Bauwerke/Staetten": {"class": "gebaeude", "label": "Besondere Bauwerke/Staetten", "icon": "bauwerk"},
    "Besondere Bauwerke/Stätten": {"class": "gebaeude", "label": "Besondere Bauwerke/Stätten", "icon": "bauwerk"},
}
PLACE_TYPE_TO_SETTLEMENT_CLASS = {
    "m": "metropole",
    "gs": "grossstadt",
    "s": "stadt",
    "ks": "kleinstadt",
    "sz": "dorf",
    "d": "dorf",
    "g": "gebaeude",
}
SETTLEMENT_CLASS_METADATA = {
    metadata["class"]: metadata for metadata in SETTLEMENT_LAYERS.values()
}
POINT_LAYERS = {"Orte", "Kreuzungen", *SETTLEMENT_LAYERS}
REGION_LAYER = "Regionen"
ROUTE_LAYER_PREFIXES = {
    "Pfade": "Pfad",
    "Strassen": "Strasse",
    "Meerwege": "Meer",
    "Flusswege": "Flussweg",
    "Wüstenpfade": "Wueste",
    "Reichsstrasse": "Reichsstrasse",
    "Gebirgspässe": "Gebirgspass",
}
SOURCE_PRIORITY = {
    "manual": 3,
    "hybrid": 2,
    "avespfade": 1,
}
CONFIDENCE_PRIORITY = {
    "confirmed_by_avespfade": 3,
    "manual_high": 2,
    "avespfade_only_low": 1,
}


@dataclass
class ParsedSubpath:
    points: List[Coordinate]
    closed: bool


def local_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[1]
    return tag


def path_tokens(path_d: str) -> List[str]:
    return PATH_TOKEN_RE.findall(path_d or "")


def is_path_command(token: str) -> bool:
    return len(token) == 1 and token.isalpha()


def dedupe_consecutive_points(points: Sequence[Coordinate]) -> List[Coordinate]:
    cleaned_points: List[Coordinate] = []
    for point in points:
        if not cleaned_points or cleaned_points[-1] != point:
            cleaned_points.append(point)
    return cleaned_points


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Konvertiert strukturierte SVG-Karten in ein avesmaps-kompatibles GeoJSON."
    )
    parser.add_argument("svg_file", help="Eingabe-SVG, z. B. Aventurien_routes.svg")
    parser.add_argument(
        "--output",
        "-o",
        default=None,
        help="Ausgabe-GeoJSON. Standard ist <svg-datei>.geojson",
    )
    parser.add_argument(
        "--keep-duplicate-place-names",
        action="store_true",
        help="Behaelt doppelte Ortsnamen bei, statt sie fuer avesmaps auf einen kanonischen Punkt zu reduzieren.",
    )
    parser.add_argument(
        "--keep-svg-y",
        action="store_true",
        help="Behaelt die SVG-Y-Koordinate unveraendert statt sie anhand der ViewBox zu spiegeln.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
        help="Log-Level.",
    )
    return parser.parse_args()


def setup_logging(level: str) -> None:
    logging.basicConfig(level=getattr(logging, level), format="%(asctime)s | %(levelname)s | %(message)s")


def parse_numeric_length(value: Optional[str]) -> Optional[float]:
    if not value:
        return None

    match = re.search(r"[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?", value)
    if match is None:
        return None
    return float(match.group(0))


def parse_optional_float(value: Optional[str]) -> Optional[float]:
    parsed_value = parse_numeric_length(value)
    return parsed_value if parsed_value is not None else None


def parse_viewbox(root: ET.Element) -> Optional[ViewBox]:
    raw_value = root.get("viewBox")
    if not raw_value:
        return None

    parts = raw_value.replace(",", " ").split()
    if len(parts) != 4:
        return None

    try:
        min_x, min_y, width, height = (float(part) for part in parts)
    except ValueError:
        return None

    return (min_x, min_y, min_x + width, min_y + height)


def build_parent_map(root: ET.Element) -> Dict[ET.Element, ET.Element]:
    return {child: parent for parent in root.iter() for child in parent}


def find_layer_label(element: ET.Element, parent_map: Dict[ET.Element, ET.Element]) -> Optional[str]:
    current: Optional[ET.Element] = element
    while current is not None:
        if local_name(current.tag) == "g" and current.get(ATTR_INKSCAPE_GROUPMODE) == "layer":
            return current.get(ATTR_INKSCAPE_LABEL) or current.get("data-layer-label")
        current = parent_map.get(current)
    return None


def normalize_point(
    x: float,
    y: float,
    viewbox: Optional[ViewBox],
    svg_height: Optional[float],
    keep_svg_y: bool,
) -> List[float]:
    if viewbox is None:
        if keep_svg_y or svg_height is None:
            return [x, y]
        return [x, svg_height - y]

    min_x, min_y, _, max_y = viewbox
    normalized_x = x - min_x
    normalized_y = (y - min_y) if keep_svg_y else (max_y - y)
    return [normalized_x, normalized_y]


def parse_style_map(style_value: Optional[str]) -> Dict[str, str]:
    if not style_value:
        return {}

    style_map: Dict[str, str] = {}
    for item in style_value.split(";"):
        if ":" not in item:
            continue
        key, value = item.split(":", 1)
        style_map[key.strip()] = value.strip()
    return style_map


def clean_label_value(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None

    cleaned_value = value.strip()
    return cleaned_value or None


def feature_label(element: ET.Element) -> str:
    label_candidates = (
        element.get(ATTR_INKSCAPE_LABEL),
        element.get("data-place-name"),
        element.get("data-item-label"),
        element.get("id"),
    )

    for label_candidate in label_candidates:
        cleaned_label = clean_label_value(label_candidate)
        if cleaned_label:
            return cleaned_label

    return "Unknown"


def extract_common_properties(element: ET.Element, layer_name: Optional[str], svg_tag: str, label: str) -> Dict[str, object]:
    properties: Dict[str, object] = {
        "name": label,
        "layer": layer_name,
        "svg_id": element.get("id"),
        "svg_tag": svg_tag,
    }

    for raw_key, value in element.attrib.items():
        key_name = local_name(raw_key)
        if raw_key == ATTR_INKSCAPE_LABEL or key_name in {"cx", "cy", "r", "rx", "ry", "d"}:
            continue
        if raw_key.startswith("data-") or key_name in {"id", "class", "style"}:
            properties[raw_key] = value

    return properties


def build_location_properties(element: ET.Element, layer_name: Optional[str], label: str) -> Dict[str, object]:
    properties = extract_common_properties(element, layer_name, local_name(element.tag), label)
    properties["type"] = "location"
    if is_settlement_layer(layer_name):
        settlement_metadata = settlement_metadata_for_point(layer_name, properties)
        properties["settlement_class"] = settlement_metadata["class"]
        properties["settlement_class_label"] = settlement_metadata["label"]
        properties["settlement_icon"] = settlement_metadata["icon"]
    return properties


def is_settlement_layer(layer_name: Optional[str]) -> bool:
    return layer_name == "Orte" or layer_name in SETTLEMENT_LAYERS


def settlement_metadata_for_point(layer_name: Optional[str], properties: Dict[str, object]) -> Dict[str, str]:
    if layer_name in SETTLEMENT_LAYERS:
        return SETTLEMENT_LAYERS[layer_name]

    place_type = str(properties.get("data-place-type") or "").strip().lower()
    settlement_class = PLACE_TYPE_TO_SETTLEMENT_CLASS.get(place_type, "dorf")
    return SETTLEMENT_CLASS_METADATA[settlement_class]


def extract_round_shape_geometry(element: ET.Element) -> Optional[Coordinate]:
    try:
        cx = float(element.get("cx", "0"))
        cy = float(element.get("cy", "0"))
    except ValueError:
        return None

    return (cx, cy)


def point_feature(
    element: ET.Element,
    layer_name: Optional[str],
    viewbox: Optional[ViewBox],
    svg_height: Optional[float],
    keep_svg_y: bool,
) -> Optional[Dict[str, object]]:
    geometry = extract_round_shape_geometry(element)
    if geometry is None:
        return None

    cx, cy = geometry
    label = feature_label(element)
    properties = build_location_properties(element, layer_name, label)

    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": normalize_point(cx, cy, viewbox, svg_height, keep_svg_y),
        },
        "properties": properties,
    }


def finalize_subpath(subpaths: List[ParsedSubpath], current_points: Sequence[Coordinate], closed: bool) -> None:
    cleaned_points = dedupe_consecutive_points(current_points)
    if len(cleaned_points) >= 2:
        subpaths.append(ParsedSubpath(points=cleaned_points, closed=closed))


def parse_svg_path_subpaths(path_d: str) -> List[ParsedSubpath]:
    tokens = path_tokens(path_d)
    if not tokens:
        return []

    index = 0
    command: Optional[str] = None
    current = (0.0, 0.0)
    subpath_start = (0.0, 0.0)
    current_points: List[Coordinate] = []
    subpaths: List[ParsedSubpath] = []

    def read_number() -> float:
        nonlocal index
        value = float(tokens[index])
        index += 1
        return value

    while index < len(tokens):
        token = tokens[index]
        if is_path_command(token):
            command = token
            index += 1
        elif command is None:
            raise RuntimeError(f"Ungultiger Pfad: {path_d[:120]}")

        if command is None:
            break

        upper = command.upper()

        if upper == "Z":
            if current_points:
                if current_points[-1] != subpath_start:
                    current_points.append(subpath_start)
                finalize_subpath(subpaths, current_points, closed=True)
                current_points = []
            current = subpath_start
            command = None
            continue

        if upper == "M":
            if current_points:
                finalize_subpath(subpaths, current_points, closed=False)
                current_points = []

            first = True
            while index < len(tokens) and not is_path_command(tokens[index]):
                x = read_number()
                y = read_number()
                if command.islower():
                    x += current[0]
                    y += current[1]
                current = (x, y)
                if first:
                    subpath_start = current
                    first = False
                current_points.append(current)

            command = "l" if command.islower() else "L"
            continue

        param_count = PATH_PARAM_COUNT[upper]
        while index < len(tokens):
            if is_path_command(tokens[index]):
                break
            if index + param_count > len(tokens):
                break

            if upper == "L":
                x = read_number()
                y = read_number()
                if command.islower():
                    x += current[0]
                    y += current[1]
                current = (x, y)
            elif upper == "H":
                x = read_number()
                if command.islower():
                    x += current[0]
                current = (x, current[1])
            elif upper == "V":
                y = read_number()
                if command.islower():
                    y += current[1]
                current = (current[0], y)
            elif upper == "C":
                _ = read_number()
                _ = read_number()
                _ = read_number()
                _ = read_number()
                x = read_number()
                y = read_number()
                if command.islower():
                    x += current[0]
                    y += current[1]
                current = (x, y)
            elif upper == "S":
                _ = read_number()
                _ = read_number()
                x = read_number()
                y = read_number()
                if command.islower():
                    x += current[0]
                    y += current[1]
                current = (x, y)
            elif upper == "Q":
                _ = read_number()
                _ = read_number()
                x = read_number()
                y = read_number()
                if command.islower():
                    x += current[0]
                    y += current[1]
                current = (x, y)
            elif upper == "T":
                x = read_number()
                y = read_number()
                if command.islower():
                    x += current[0]
                    y += current[1]
                current = (x, y)
            elif upper == "A":
                _ = read_number()
                _ = read_number()
                _ = read_number()
                _ = read_number()
                _ = read_number()
                x = read_number()
                y = read_number()
                if command.islower():
                    x += current[0]
                    y += current[1]
                current = (x, y)
            else:
                break

            current_points.append(current)

    if current_points:
        finalize_subpath(subpaths, current_points, closed=False)

    return subpaths


def canonical_route_name(layer_name: str, counters: Dict[str, int]) -> str:
    prefix = ROUTE_LAYER_PREFIXES[layer_name]
    counters[prefix] += 1
    return f"{prefix}-{counters[prefix]}"


def route_features(
    element: ET.Element,
    layer_name: str,
    viewbox: Optional[ViewBox],
    svg_height: Optional[float],
    keep_svg_y: bool,
    counters: Dict[str, int],
) -> List[Dict[str, object]]:
    path_d = element.get("d", "").strip()
    if not path_d:
        return []

    label = feature_label(element)
    base_properties = extract_common_properties(element, layer_name, "path", label)
    base_properties["type"] = "path"

    features: List[Dict[str, object]] = []
    subpaths = parse_svg_path_subpaths(path_d)
    for subpath_index, subpath in enumerate(subpaths, start=1):
        if len(subpath.points) < 2:
            continue

        properties = dict(base_properties)
        properties["name"] = canonical_route_name(layer_name, counters)

        svg_id = properties.get("svg_id")
        if svg_id and len(subpaths) > 1:
            properties["id"] = f"{svg_id}-part-{subpath_index}"
        else:
            properties["id"] = svg_id or properties["name"]

        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        normalize_point(x, y, viewbox, svg_height, keep_svg_y)
                        for x, y in subpath.points
                    ],
                },
                "properties": properties,
            }
        )

    return features


def region_properties(element: ET.Element, layer_name: str, label: str) -> Dict[str, object]:
    style_map = parse_style_map(element.get("style"))

    properties = extract_common_properties(element, layer_name, "path", label)
    properties["type"] = "region"
    properties["fill"] = element.get("fill") or style_map.get("fill")
    properties["stroke"] = element.get("stroke") or style_map.get("stroke")
    properties["strokeWidth"] = parse_optional_float(
        element.get("stroke-width") or style_map.get("stroke-width")
    )
    properties["fillOpacity"] = parse_optional_float(
        element.get("fill-opacity") or style_map.get("fill-opacity")
    )
    return properties


def ring_coordinates(
    points: Sequence[Coordinate],
    viewbox: Optional[ViewBox],
    svg_height: Optional[float],
    keep_svg_y: bool,
) -> List[List[float]]:
    return [normalize_point(x, y, viewbox, svg_height, keep_svg_y) for x, y in points]


def region_feature(
    element: ET.Element,
    layer_name: str,
    viewbox: Optional[ViewBox],
    svg_height: Optional[float],
    keep_svg_y: bool,
) -> Optional[Dict[str, object]]:
    path_d = element.get("d", "").strip()
    if not path_d:
        return None

    rings: List[List[List[float]]] = []
    for subpath in parse_svg_path_subpaths(path_d):
        if not subpath.closed:
            continue
        ring_points = list(subpath.points)
        if len(ring_points) < 4:
            continue
        if ring_points[0] != ring_points[-1]:
            ring_points.append(ring_points[0])
        rings.append(ring_coordinates(ring_points, viewbox, svg_height, keep_svg_y))

    if not rings:
        return None

    label = feature_label(element)
    return {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": rings,
        },
        "properties": region_properties(element, layer_name, label),
    }


def duplicate_place_names(features: Iterable[Dict[str, object]]) -> Dict[str, List[Dict[str, object]]]:
    grouped: Dict[str, List[Dict[str, object]]] = defaultdict(list)
    for feature in features:
        geometry = feature.get("geometry", {})
        properties = feature.get("properties", {})
        if geometry.get("type") != "Point":
            continue
        if not is_settlement_layer(str(properties.get("layer") or "")):
            continue

        name = str(properties.get("name") or "").strip()
        if not name:
            continue
        grouped[name].append(feature)

    return {name: items for name, items in grouped.items() if len(items) > 1}


def collect_route_endpoints(route_features_list: Sequence[Dict[str, object]]) -> List[Coordinate]:
    endpoints: List[Coordinate] = []
    for feature in route_features_list:
        coordinates = feature.get("geometry", {}).get("coordinates", [])
        if len(coordinates) < 2:
            continue
        start = coordinates[0]
        end = coordinates[-1]
        endpoints.append((float(start[0]), float(start[1])))
        endpoints.append((float(end[0]), float(end[1])))
    return endpoints


def point_matches_endpoint(feature: Dict[str, object], endpoint: Coordinate, tolerance: float) -> bool:
    coordinates = feature.get("geometry", {}).get("coordinates", [])
    if len(coordinates) < 2:
        return False

    point_x = float(coordinates[0])
    point_y = float(coordinates[1])
    end_x, end_y = endpoint
    return abs(point_x - end_x) < tolerance and abs(point_y - end_y) < tolerance


def point_match_score(
    feature: Dict[str, object],
    route_endpoints: Sequence[Coordinate],
    tolerance: float,
) -> Tuple[int, float, int, int, int]:
    coordinates = feature.get("geometry", {}).get("coordinates", [])
    if len(coordinates) < 2 or not route_endpoints:
        endpoint_hits = 0
        closest_distance = inf
    else:
        point_x = float(coordinates[0])
        point_y = float(coordinates[1])
        distances = [hypot(point_x - end_x, point_y - end_y) for end_x, end_y in route_endpoints]
        endpoint_hits = sum(distance <= tolerance for distance in distances)
        closest_distance = min(distances) if distances else inf

    properties = feature.get("properties", {})
    source_rank = SOURCE_PRIORITY.get(str(properties.get("data-source") or ""), 0)
    confidence_rank = CONFIDENCE_PRIORITY.get(str(properties.get("data-confidence") or ""), 0)
    has_place_id = 1 if properties.get("data-place-id") else 0

    return (endpoint_hits, -closest_distance, source_rank, confidence_rank, has_place_id)


def canonicalize_place_features(
    point_features: Sequence[Dict[str, object]],
    route_features_list: Sequence[Dict[str, object]],
    tolerance: float,
    keep_duplicates: bool,
    logger: logging.Logger,
) -> Tuple[List[Dict[str, object]], Dict[str, List[Dict[str, object]]]]:
    duplicates = duplicate_place_names(point_features)
    if not duplicates or keep_duplicates:
        return list(point_features), duplicates

    route_endpoints = collect_route_endpoints(route_features_list)
    duplicate_names = set(duplicates)
    kept_features: List[Dict[str, object]] = []
    resolved_duplicates: Dict[str, List[Dict[str, object]]] = {}

    for feature in point_features:
        name = str(feature.get("properties", {}).get("name") or "").strip()
        if name in duplicate_names:
            continue
        kept_features.append(feature)

    for name, candidates in duplicates.items():
        ranked_candidates = sorted(
            candidates,
            key=lambda feature: point_match_score(feature, route_endpoints, tolerance),
            reverse=True,
        )
        winner = ranked_candidates[0]
        winner["properties"]["duplicate_resolution"] = "kept"
        winner["properties"]["duplicate_count"] = len(candidates)
        kept_features.append(winner)
        resolved_duplicates[name] = ranked_candidates

        logger.warning(
            "Doppelter Ortsname '%s' wurde fuer den avesmaps-Export auf %s reduziert.",
            name,
            winner["properties"].get("svg_id"),
        )

    return kept_features, resolved_duplicates


def ensure_endpoint_crossings(
    point_features: Sequence[Dict[str, object]],
    route_features_list: Sequence[Dict[str, object]],
    tolerance: float,
) -> Tuple[List[Dict[str, object]], int]:
    normalized_points = list(point_features)
    synthetic_count = 0

    for route_feature in route_features_list:
        coordinates = route_feature.get("geometry", {}).get("coordinates", [])
        if len(coordinates) < 2:
            continue

        endpoints = [
            (float(coordinates[0][0]), float(coordinates[0][1])),
            (float(coordinates[-1][0]), float(coordinates[-1][1])),
        ]

        for endpoint in endpoints:
            if any(point_matches_endpoint(point_feature, endpoint, tolerance) for point_feature in normalized_points):
                continue

            synthetic_count += 1
            normalized_points.append(
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [endpoint[0], endpoint[1]],
                    },
                    "properties": {
                        "name": f"Kreuzung-auto-{synthetic_count}",
                        "type": "location",
                        "layer": "Kreuzungen",
                        "data-source": "synthesized",
                        "synthetic": True,
                    },
                }
            )

    return normalized_points, synthetic_count


def svg_to_geojson(
    svg_file: Path,
    geojson_file: Path,
    keep_duplicate_place_names: bool = False,
    keep_svg_y: bool = False,
) -> Dict[str, object]:
    logger = logging.getLogger("svg-to-geojson")
    tree = ET.parse(svg_file)
    root = tree.getroot()
    parent_map = build_parent_map(root)
    viewbox = parse_viewbox(root)
    svg_height = parse_numeric_length(root.get("height"))

    if viewbox is None:
        logger.warning("Keine gueltige ViewBox gefunden; es wird mit der SVG-Hoehe normalisiert.")
        if svg_height is None and not keep_svg_y:
            logger.warning("Es wurde keine SVG-Hoehe gefunden; Y-Koordinaten bleiben unveraendert.")

    point_features: List[Dict[str, object]] = []
    route_features_list: List[Dict[str, object]] = []
    region_features_list: List[Dict[str, object]] = []
    route_counters: Dict[str, int] = defaultdict(int)

    for element in root.iter():
        tag_name = local_name(element.tag)
        layer_name = find_layer_label(element, parent_map)
        if layer_name is None:
            continue

        if tag_name in {"circle", "ellipse"} and layer_name in POINT_LAYERS:
            feature = point_feature(element, layer_name, viewbox, svg_height, keep_svg_y)
            if feature is not None:
                point_features.append(feature)
            continue

        if tag_name == "path" and layer_name in ROUTE_LAYER_PREFIXES:
            route_features_list.extend(
                route_features(element, layer_name, viewbox, svg_height, keep_svg_y, route_counters)
            )
            continue

        if tag_name == "path" and layer_name == REGION_LAYER:
            feature = region_feature(element, layer_name, viewbox, svg_height, keep_svg_y)
            if feature is not None:
                region_features_list.append(feature)

    original_duplicates = duplicate_place_names(point_features)
    point_features, resolved_duplicates = canonicalize_place_features(
        point_features=point_features,
        route_features_list=route_features_list,
        tolerance=0.5,
        keep_duplicates=keep_duplicate_place_names,
        logger=logger,
    )
    point_features, synthetic_crossing_count = ensure_endpoint_crossings(
        point_features=point_features,
        route_features_list=route_features_list,
        tolerance=0.5,
    )

    duplicate_source = resolved_duplicates if resolved_duplicates else original_duplicates
    duplicate_summary = {
        name: [
            {
                "svg_id": item.get("properties", {}).get("svg_id"),
                "data-place-id": item.get("properties", {}).get("data-place-id"),
                "data-source": item.get("properties", {}).get("data-source"),
                "data-match-status": item.get("properties", {}).get("data-match-status"),
                "coordinates": item.get("geometry", {}).get("coordinates"),
            }
            for item in items
        ]
        for name, items in duplicate_source.items()
    }

    features = point_features + route_features_list + region_features_list
    geojson = {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "source_svg": str(svg_file.resolve()),
            "feature_count": len(features),
            "point_feature_count": len(point_features),
            "route_feature_count": len(route_features_list),
            "region_feature_count": len(region_features_list),
            "duplicate_place_name_count": len(duplicate_summary),
            "synthetic_crossing_count": synthetic_crossing_count,
            "duplicate_place_resolution": (
                "kept_all" if keep_duplicate_place_names else "canonicalized_for_avesmaps"
            ),
            "duplicate_places": duplicate_summary,
        },
    }

    geojson_file.parent.mkdir(parents=True, exist_ok=True)
    geojson_file.write_text(json.dumps(geojson, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info(
        "GeoJSON geschrieben: %s | Features: %d | Punkte: %d | Routen: %d | Regionen: %d",
        geojson_file,
        len(features),
        len(point_features),
        len(route_features_list),
        len(region_features_list),
    )
    return geojson


def default_output_path(svg_file: Path) -> Path:
    return svg_file.with_suffix(".geojson")


def resolve_svg_path(raw_svg_path: str) -> Path:
    svg_path = Path(raw_svg_path)
    cwd_path = svg_path.resolve()
    if cwd_path.exists():
        return cwd_path

    if svg_path.parent == Path("."):
        script_path = Path(__file__).resolve().parent / svg_path
        if script_path.exists():
            return script_path

    return cwd_path


def resolve_output_path(raw_output_path: Optional[str], svg_file: Path) -> Path:
    if raw_output_path is None:
        return default_output_path(svg_file)

    output_path = Path(raw_output_path)
    if output_path.parent == Path("."):
        return svg_file.parent / output_path.name

    return output_path.resolve()


def main() -> int:
    args = parse_args()
    setup_logging(args.log_level)

    svg_file = resolve_svg_path(args.svg_file)
    if not svg_file.exists():
        raise FileNotFoundError(f"SVG-Datei nicht gefunden: {svg_file}")

    output_path = resolve_output_path(args.output, svg_file)
    svg_to_geojson(
        svg_file=svg_file,
        geojson_file=output_path,
        keep_duplicate_place_names=args.keep_duplicate_place_names,
        keep_svg_y=args.keep_svg_y,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        logging.basicConfig(level=logging.ERROR, format="%(levelname)s | %(message)s")
        logging.error("%s", exc)
        raise SystemExit(1)
