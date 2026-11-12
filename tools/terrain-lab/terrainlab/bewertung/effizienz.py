"""Dimension 3: technische Effizienz (WI-0250 Phase A4): Laufzeit, Arbeitsspeicher und Zellzahl aus der `meta.json` des Adapters.

Gemessen wird der kalte Lauf (frischer Prozess, Module geladen, ungewärmt); er ist nach der Basismessung der maßgebliche (`docs/lauf.md`
Abschnitt 8). Die Zeit eines einzelnen Laufs auf diesem Rechner schwankt mit der Fremdlast (`fremdlast_kerne`); sie steht dabei.
"""

from __future__ import annotations

from typing import Any


def effizienz(meta: dict[str, Any]) -> dict[str, Any]:
    """Kennzahlen der Effizienz eines Adapterlaufs (kalter Lauf)."""
    lauf = meta["laeufe"][0]
    zellen = int(meta["raster"]["zellen"])
    wall = float(lauf["wall_ms"])
    return {
        "wall_ms": wall,
        "cpu_ms": float(lauf["cpu_ms"]),
        "rss_spitze_mib": float(lauf["rss_spitze_mib"]),
        "fremdlast_kerne": float(lauf.get("fremdlast_kerne") or 0.0),
        "zellen": zellen,
        "eigene_zellen": int(meta["raster"].get("eigene_zellen") or 0),
        "zellgroesse_m": float(meta["raster"]["zellgroesse_m"]),
        "ms_je_1000_zellen": wall / zellen * 1000.0 if zellen else None,
        "talboden": meta.get("zusatz", {}).get("talboden"),
    }
