"""Terrain Calibration & Benchmark Lab (WI-0250): lokale Messung, Bewertung, Parametersuche und Performance-Analyse der Gebirge.

Läuft ohne KI und ohne Netz (außer beim einmaligen Bezug der Referenzdaten). Daten liegen außerhalb des Repositoriums unter
`daten_wurzel()`; ins Repository gehören nur Code, Manifeste, Prüfsummen, Rezepte und kleine Fixtures.
"""

from __future__ import annotations

import os
from pathlib import Path

__version__ = "0.1.0"


def daten_wurzel() -> Path:
    """`AVESMAPS_TERRAIN_LAB`, sonst `C:\\avesmaps3d-data\\terrain-lab`."""
    return Path(os.environ.get("AVESMAPS_TERRAIN_LAB", r"C:\avesmaps3d-data\terrain-lab"))
