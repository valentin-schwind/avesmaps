"""Höhenraster-Austausch v1 (WI-0250): eine Datei `<name>.f32` und daneben `<name>.json`.

Die `.f32` enthält Float32, little-endian, zeilenweise von Nord nach Süd, jede Zeile von West nach Ost. Die `.json` beschreibt sie:

    {
      "format": "avesmaps-hoehenraster",
      "version": 1,
      "breite": 512,            # Spalten
      "hoehe": 512,             # Zeilen
      "zellgroesse_m": 30.0,    # horizontale Kantenlänge einer Zelle in Metern
      "hoehe_einheit": "m",     # Höhen in Metern
      "nodata": null,           # oder ein Zahlenwert; NaN ist immer NoData
      "herkunft": {...},        # frei: Quelle, Generator, Commit, Parameter, Seed, Phase
      "sha256": "..."           # Prüfsumme der .f32
    }

Dasselbe Format schreibt der TypeScript-Adapter (`scripts/dev/terrain-lab/`), damit Python und Generator ohne GDAL Daten tauschen.
Echte Referenzdaten werden mit GDAL in dieses Format gebracht; reale Koordinaten bleiben in `herkunft`, nie im Kartenraum.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

FORMAT = "avesmaps-hoehenraster"
VERSION = 1


@dataclass
class Hoehenraster:
    """Ein Höhenfeld in Metern mit horizontaler Zellgröße in Metern. NoData ist immer NaN im Array."""

    hoehen: np.ndarray
    zellgroesse_m: float
    herkunft: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.hoehen.ndim != 2:
            raise ValueError("Höhenraster muss zweidimensional sein")
        if not self.zellgroesse_m > 0:
            raise ValueError("zellgroesse_m muss positiv sein")
        self.hoehen = np.ascontiguousarray(self.hoehen, dtype=np.float32)

    @property
    def form(self) -> tuple[int, int]:
        return (int(self.hoehen.shape[0]), int(self.hoehen.shape[1]))


def _pruefsumme(daten: bytes) -> str:
    return hashlib.sha256(daten).hexdigest()


def schreibe(raster: Hoehenraster, ziel: Path | str) -> Path:
    """Schreibt `<ziel>.f32` und `<ziel>.json`; `ziel` ohne Endung. Gibt den Pfad der JSON zurück."""
    ziel = Path(ziel)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    daten = raster.hoehen.astype("<f4", copy=False).tobytes(order="C")
    ziel.with_suffix(".f32").write_bytes(daten)
    kopf = {
        "format": FORMAT,
        "version": VERSION,
        "breite": raster.form[1],
        "hoehe": raster.form[0],
        "zellgroesse_m": float(raster.zellgroesse_m),
        "hoehe_einheit": "m",
        "nodata": None,
        "herkunft": raster.herkunft,
        "sha256": _pruefsumme(daten),
    }
    pfad = ziel.with_suffix(".json")
    pfad.write_text(json.dumps(kopf, ensure_ascii=False, indent=2), encoding="utf-8")
    return pfad


def lies(quelle: Path | str, *, pruefen: bool = True) -> Hoehenraster:
    """Liest ein Raster; `quelle` ist die `.json`, die `.f32` oder der Name ohne Endung."""
    basis = Path(quelle)
    if basis.suffix in (".json", ".f32"):
        basis = basis.with_suffix("")
    kopf = json.loads(basis.with_suffix(".json").read_text(encoding="utf-8"))
    if kopf.get("format") != FORMAT or kopf.get("version") != VERSION:
        raise ValueError(f"unbekanntes Rasterformat: {kopf.get('format')} v{kopf.get('version')}")
    daten = basis.with_suffix(".f32").read_bytes()
    if pruefen and _pruefsumme(daten) != kopf["sha256"]:
        raise ValueError(f"Prüfsumme stimmt nicht: {basis}")
    hoehen = np.frombuffer(daten, dtype="<f4").reshape(int(kopf["hoehe"]), int(kopf["breite"])).astype(np.float32)
    if kopf.get("nodata") is not None:
        hoehen = np.where(hoehen == np.float32(kopf["nodata"]), np.float32(np.nan), hoehen)
    if kopf.get("hoehe_einheit", "m") != "m":
        raise ValueError("Höhen müssen in Metern vorliegen")
    return Hoehenraster(hoehen=hoehen, zellgroesse_m=float(kopf["zellgroesse_m"]), herkunft=kopf.get("herkunft", {}))
