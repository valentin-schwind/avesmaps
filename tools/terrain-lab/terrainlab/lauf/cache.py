"""Zwischenspeicher der Läufe (WI-0250 Phase B): identische Berechnungen nie doppelt.

Zwei Stufen unter ``<Labor>/cache/``:

- ``raster/<commit12>/<auftrag_fingerprint24>/``: die Ausgabe des Adapters (``meta.json`` plus Raster). Schlüssel: (Commit, Auftrag). Das Raster
  eines Auftrags an einem Commit ist deterministisch (der Adapter prüft es mit ``--warm``), also gilt ein Treffer als das Ergebnis.
- ``metrik/<commit12>/<auftrag_fingerprint24>/<schluessel24>.json``: der Metrikvektor eines Rasters. Schlüssel zusätzlich: Prüfsumme des Rasters,
  Parameter und Gruppen der Deskriptoren und ein Hash über deren Quelltext, damit eine geänderte Metrik den alten Eintrag nicht trifft.

Veröffentlicht wird atomar: Der Adapter schreibt in ``<ordner>.tmp``, erst ein vollständiger Lauf wird umbenannt.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from functools import lru_cache
from pathlib import Path
from typing import Any

import terrainlab

from .umgebung import cache_wurzel


@lru_cache(maxsize=1)
def deskriptoren_quellhash() -> str:
    """SHA-256 über die Quelltexte der Deskriptoren und des Rasterformats: ändert sich eine Metrik, ändert sich der Schlüssel."""
    h = hashlib.sha256()
    wurzel = Path(terrainlab.__file__).resolve().parent
    dateien = sorted((wurzel / "deskriptoren").glob("*.py")) + [wurzel / "raster.py"]
    for d in dateien:
        h.update(d.name.encode("utf-8") + b"\0")
        h.update(d.read_bytes())
    return h.hexdigest()


def kanonisch(wert: Any) -> str:
    return json.dumps(wert, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=list)


class Zwischenspeicher:
    def __init__(self, wurzel: Path | None = None) -> None:
        self.wurzel = Path(wurzel) if wurzel else cache_wurzel()

    # --- Raster -------------------------------------------------------------------------------------------------------------
    def raster_ordner(self, commit: str, auftrag_fingerprint: str) -> Path:
        return self.wurzel / "raster" / commit[:12] / auftrag_fingerprint[:24]

    def hole_raster(self, commit: str, auftrag_fingerprint: str, zwischenstaende: bool = False) -> dict[str, Any] | None:
        """Die ``meta.json`` eines vollständigen Eintrags; ``None``, wenn er fehlt oder (bei Bedarf) keine Zwischenstände trägt."""
        meta = self.raster_ordner(commit, auftrag_fingerprint) / "meta.json"
        if not meta.exists():
            return None
        daten = json.loads(meta.read_text(encoding="utf-8"))
        if zwischenstaende and not daten.get("zwischenstaende"):
            return None
        return daten

    def neuer_ordner(self, commit: str, auftrag_fingerprint: str) -> Path:
        """Leerer Arbeitsordner neben dem Ziel (``….tmp``)."""
        tmp = self.raster_ordner(commit, auftrag_fingerprint).with_name(auftrag_fingerprint[:24] + ".tmp")
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        return tmp

    def veroeffentliche(self, tmp: Path, commit: str, auftrag_fingerprint: str) -> Path:
        ziel = self.raster_ordner(commit, auftrag_fingerprint)
        shutil.rmtree(ziel, ignore_errors=True)
        tmp.rename(ziel)
        return ziel

    # --- Metriken -----------------------------------------------------------------------------------------------------------
    @staticmethod
    def metrik_schluessel(raster_sha256: str, parameter: dict[str, Any], gruppen: list[str] | None, teuer: bool) -> str:
        text = kanonisch({"raster": raster_sha256, "parameter": parameter, "gruppen": gruppen, "teuer": teuer, "quellen": deskriptoren_quellhash()})
        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]

    def metrik_pfad(self, commit: str, auftrag_fingerprint: str, schluessel: str) -> Path:
        return self.wurzel / "metrik" / commit[:12] / auftrag_fingerprint[:24] / f"{schluessel}.json"
