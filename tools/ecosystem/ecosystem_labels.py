"""Existing map labels drive the derivation (plan V5, question 2c).

🔴 Names and wiki links are NEVER invented. They come from the map_features label row, and a
component that no label claims never becomes an area. That rule does two jobs at once: it answers
"what is this shape called" and it filters out the rivers -- measured at zoom 2, 867 of 874 water
components do not touch the border, and most of them are rivers, not lakes.

Direction matters: every LABEL searches outward for its component, not the other way round.
Measured on the live payload: forward search resolves 92 of 95 island labels; the inverse
(each component takes its nearest label by centroid distance) resolves only 61 -- the centroid of
a large island is further from an edge-placed label than any sane cap.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ecosystem_raster import map_to_pixel, pixels_per_unit

# The seeded vocabulary of ecosystem_region_type (api/_internal/app/ecosystem.php:68).
# Nothing here is invented: every key is an existing map_features label subtype AND a seeded
# region_type of exactly this kind.
#
# 🔴 Land and water must never share a kind (plan, global constraint 4a). An island and the water
# around it share the same pixel edge; if both landed in the same kind, two areas with the same
# outline would sit in the same Leaflet pane and nobody could tell them apart.
REGION_KIND_BY_SUBTYPE: dict[str, str] = {
    "see": "topographie",
    "insel": "derographisch",
    "kontinent": "derographisch",
    "kueste": "topographie",
    "wueste": "vegetation",
}

DEFAULT_CAP_UNITS = 8.0


@dataclass(frozen=True)
class LandscapeLabel:
    name: str
    subtype: str
    x: float
    y: float
    wiki_url: str
    public_id: str


def read_labels(payload: dict, subtypes: set[str]) -> list[LandscapeLabel]:
    found: list[LandscapeLabel] = []
    for feature in payload.get("features", []):
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        if properties.get("feature_type") != "label":
            continue
        if properties.get("feature_subtype") not in subtypes:
            continue
        if geometry.get("type") != "Point":
            continue
        x, y = geometry["coordinates"][0], geometry["coordinates"][1]
        found.append(LandscapeLabel(
            name=(properties.get("name") or "").strip(),
            subtype=properties["feature_subtype"],
            x=float(x),
            y=float(y),
            wiki_url=(properties.get("wiki_url") or "").strip(),
            public_id=(properties.get("public_id") or "").strip(),
        ))
    return found


def resolve(
    labels: list[LandscapeLabel],
    component_labels: np.ndarray,
    size: int,
    cap_units: float = DEFAULT_CAP_UNITS,
    exclude: int | None = None,
) -> tuple[dict[int, int], list[LandscapeLabel]]:
    """label index -> component id, plus the labels that found nothing within cap_units.

    Only 14 of 95 island labels sit ON their island -- the rest stand beside it, because the
    island is too small to hold the text. The outward search is therefore mandatory, not comfort.
    """
    cap = int(round(cap_units * pixels_per_unit(size)))
    height, width = component_labels.shape
    assignment: dict[int, int] = {}
    unresolved: list[LandscapeLabel] = []

    for index, label in enumerate(labels):
        row, col = map_to_pixel(label.x, label.y, size)
        top, bottom = max(0, row - cap), min(height, row + cap + 1)
        left, right = max(0, col - cap), min(width, col + cap + 1)
        window = component_labels[top:bottom, left:right].copy()
        if exclude is not None:
            window[window == exclude] = 0

        rows, cols = np.nonzero(window)
        if rows.size == 0:
            unresolved.append(label)
            continue
        distance = (rows + top - row) ** 2 + (cols + left - col) ** 2
        nearest = int(np.argmin(distance))
        assignment[index] = int(window[rows[nearest], cols[nearest]])

    return assignment, unresolved


def contested(assignment: dict[int, int]) -> dict[int, list[int]]:
    """component id -> the label indices fighting over it. Reported, never auto-resolved:
    which of several archipelago names owns the one shape is an editorial question."""
    by_component: dict[int, list[int]] = {}
    for label_index, component in assignment.items():
        by_component.setdefault(component, []).append(label_index)
    return {component: indices for component, indices in by_component.items() if len(indices) > 1}
