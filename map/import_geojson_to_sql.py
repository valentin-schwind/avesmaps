#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import re
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Iterable


MAP_NAMESPACE = uuid.UUID("7c22ff08-9d82-46a0-a5d1-f6f47e2b12a5")
DEFAULT_SOURCE_PATH = Path(__file__).resolve().parent / "Aventurien_routes.geojson"
DEFAULT_OUTPUT_PATH = Path(__file__).resolve().parent / "Aventurien_routes.import.mysql.sql"

SETTLEMENT_SUBTYPES = {
    "metropole",
    "grossstadt",
    "stadt",
    "kleinstadt",
    "dorf",
}

NORMALIZED_ROUTE_LAYER_SUBTYPES = {
    "pfade": "Pfad",
    "strassen": "Strasse",
    "reichsstrasse": "Reichsstrasse",
    "gebirgspaesse": "Gebirgspass",
    "gebirgspasse": "Gebirgspass",
    "wustenpfade": "Wuestenpfad",
    "wuestenpfade": "Wuestenpfad",
    "flusswege": "Flussweg",
    "meerwege": "Seeweg",
}

STYLE_KEYS = {
    "fill",
    "stroke",
    "strokeWidth",
    "fillOpacity",
    "style",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Writes a MySQL import file for the SQL-backed Avesmaps vector map."
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_SOURCE_PATH),
        help="Source GeoJSON file.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Output SQL file.",
    )
    parser.add_argument(
        "--replace-existing",
        action="store_true",
        help="Delete existing SQL map data before inserting imported features.",
    )
    return parser.parse_args()


def load_geojson(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
        raise SystemExit("Input must be a GeoJSON FeatureCollection.")

    return data


def normalize_name(value: Any, max_length: int) -> str | None:
    if value is None:
        return None

    normalized_value = re.sub(r"\s+", " ", str(value)).strip()
    if not normalized_value:
        return None

    return normalized_value[:max_length]


def normalize_subtype(value: Any, fallback: str) -> str:
    for candidate in normalized_text_candidates(str(value or "")):
        normalized_value = candidate.lower()
        normalized_value = normalized_value.replace("\u00df", "ss")
        normalized_value = normalized_value.replace("\u00e4", "ae")
        normalized_value = normalized_value.replace("\u00f6", "oe")
        normalized_value = normalized_value.replace("\u00fc", "ue")
        normalized_value = unicodedata.normalize("NFKD", normalized_value)
        normalized_value = normalized_value.encode("ascii", "ignore").decode("ascii")
        normalized_value = re.sub(r"[^a-z0-9]+", "_", normalized_value).strip("_")
        if normalized_value:
            return normalized_value

    return fallback


def normalized_text_candidates(value: str) -> list[str]:
    stripped_value = value.strip()
    if not stripped_value:
        return []

    candidates = [stripped_value]
    try:
        repaired_value = stripped_value.encode("latin1").decode("utf-8")
        if repaired_value and repaired_value not in candidates:
            candidates.append(repaired_value)
    except UnicodeError:
        pass

    return candidates


def iter_positions(coordinates: Any) -> Iterable[tuple[float, float]]:
    if not isinstance(coordinates, list):
        return

    if len(coordinates) >= 2 and all(isinstance(value, (int, float)) for value in coordinates[:2]):
        yield float(coordinates[0]), float(coordinates[1])
        return

    for child in coordinates:
        yield from iter_positions(child)


def geometry_bbox(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    positions = list(iter_positions(geometry.get("coordinates")))
    if not positions:
        raise ValueError("Geometry has no coordinates.")

    xs = [position[0] for position in positions]
    ys = [position[1] for position in positions]
    return min(xs), min(ys), max(xs), max(ys)


def deterministic_public_id(feature: dict[str, Any], index: int) -> str:
    properties = feature.get("properties") or {}
    candidates = [
        properties.get("id"),
        properties.get("svg_id"),
        properties.get("data-place-id"),
        properties.get("name"),
        index,
    ]
    source = "|".join(str(candidate or "") for candidate in candidates)
    return str(uuid.uuid5(MAP_NAMESPACE, source))


def infer_route_subtype_from_name(value: Any) -> str | None:
    name = str(value or "").strip()
    if not name:
        return None

    normalized_name = normalize_subtype(name.split("-", 1)[0], "")
    route_subtypes = {
        "reichsstrasse": "Reichsstrasse",
        "reichsstrasze": "Reichsstrasse",
        "strasse": "Strasse",
        "strasze": "Strasse",
        "weg": "Weg",
        "pfad": "Pfad",
        "wueste": "Wuestenpfad",
        "wustenpfad": "Wuestenpfad",
        "wuestenpfad": "Wuestenpfad",
        "gebirgspfad": "Gebirgspass",
        "gebirgspass": "Gebirgspass",
        "flussweg": "Flussweg",
        "meer": "Seeweg",
        "meerweg": "Seeweg",
        "seeweg": "Seeweg",
    }
    return route_subtypes.get(normalized_name)


def classify_feature(feature: dict[str, Any]) -> tuple[str, str]:
    geometry = feature.get("geometry") or {}
    properties = feature.get("properties") or {}
    geometry_type = str(geometry.get("type") or "")
    legacy_type = str(properties.get("type") or "")
    layer = str(properties.get("layer") or properties.get("data-layer-label") or "")
    normalized_layer = normalize_subtype(layer, "")

    if geometry_type == "Point":
        name = str(properties.get("name") or "")
        if name.startswith("Kreuzung") or normalized_layer == "kreuzungen":
            return "crossing", "crossing"

        settlement_class = normalize_subtype(properties.get("settlement_class"), "dorf")
        if settlement_class in SETTLEMENT_SUBTYPES:
            return "location", settlement_class

        return "location", "dorf"

    if legacy_type == "region" or geometry_type in {"Polygon", "MultiPolygon"}:
        return "region", normalized_layer or "region"

    if geometry_type in {"LineString", "MultiLineString"}:
        name_subtype = infer_route_subtype_from_name(properties.get("name"))
        if name_subtype:
            return "path", name_subtype

        return "path", NORMALIZED_ROUTE_LAYER_SUBTYPES.get(normalized_layer, "Weg")

    return normalize_subtype(legacy_type, "feature"), normalized_layer or "default"


def split_properties(properties: dict[str, Any], feature_type: str, feature_subtype: str) -> tuple[dict[str, Any], dict[str, Any]]:
    stored_properties = dict(properties)
    style = {}

    for key in STYLE_KEYS:
        if key in stored_properties:
            style[key] = stored_properties.pop(key)

    if feature_type == "river":
        stored_properties["befahrbar"] = True
        stored_properties["legacy_route_type"] = "Flussweg"

    stored_properties["feature_type"] = feature_type
    stored_properties["feature_subtype"] = feature_subtype

    return stored_properties, style


def json_sql(value: Any) -> str:
    return quote_sql(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def quote_sql(value: str | None) -> str:
    if value is None:
        return "NULL"

    escaped_value = value.replace("\\", "\\\\").replace("'", "''")
    return f"'{escaped_value}'"


def decimal_sql(value: float) -> str:
    return f"{value:.4f}"


def build_insert_statement(feature: dict[str, Any], index: int) -> str:
    geometry = feature.get("geometry") or {}
    properties = feature.get("properties") or {}
    feature_type, feature_subtype = classify_feature(feature)
    stored_properties, style = split_properties(properties, feature_type, feature_subtype)
    min_x, min_y, max_x, max_y = geometry_bbox(geometry)

    values = [
        quote_sql(deterministic_public_id(feature, index)),
        quote_sql(feature_type),
        quote_sql(feature_subtype),
        quote_sql(normalize_name(properties.get("name"), 160)),
        quote_sql(str(geometry.get("type") or "")),
        json_sql(geometry),
        json_sql(stored_properties),
        json_sql(style) if style else "NULL",
        decimal_sql(min_x),
        decimal_sql(min_y),
        decimal_sql(max_x),
        decimal_sql(max_y),
        str(index),
    ]

    return (
        "INSERT INTO map_features ("
        "public_id, feature_type, feature_subtype, name, geometry_type, "
        "geometry_json, properties_json, style_json, min_x, min_y, max_x, max_y, sort_order"
        ") VALUES ("
        + ", ".join(values)
        + ");"
    )


def write_sql(data: dict[str, Any], output_path: Path, replace_existing: bool) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    features = data["features"]

    lines = [
        "-- Generated by map/import_geojson_to_sql.py",
        "-- Run api/schema.future.mysql.sql before this import.",
        "SET NAMES utf8mb4;",
        "START TRANSACTION;",
    ]

    if replace_existing:
        lines.extend(
            [
                "DELETE FROM map_feature_relations;",
                "DELETE FROM map_audit_log;",
                "DELETE FROM map_features;",
                "UPDATE map_revision SET revision = revision + 1 WHERE id = 1;",
            ]
        )

    for index, feature in enumerate(features, start=1):
        lines.append(build_insert_statement(feature, index))

    lines.extend(
        [
            "UPDATE map_revision SET revision = revision + 1 WHERE id = 1;",
            "COMMIT;",
            "",
        ]
    )

    output_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)

    data = load_geojson(input_path)
    write_sql(data, output_path, args.replace_existing)

    print(f"Features: {len(data['features'])}")
    print(f"SQL written to: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
