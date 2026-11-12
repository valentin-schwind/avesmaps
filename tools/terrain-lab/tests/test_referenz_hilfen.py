"""Gemeinsame Bausteine der Referenzkorpus-Tests: synthetische GeoTIFFs, Rezepte und ein Manifest in einem Temp-Ordner.

Enthält selbst keine Tests (die Datei heißt nur so, damit sie zum Bereich `test_referenz*.py` gehört). Alle Tests arbeiten ohne Netz: Als
„URL“ eines Rezepts dient ein lokaler Pfad, den `terrainlab.referenz.quellen` genauso öffnet wie ein `/vsicurl/`-Ziel.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from terrainlab.referenz import manifest as mf
from terrainlab.referenz.gdal_umgebung import gdal_osr
from terrainlab.referenz.jsonschreiber import zu_text

NODATA_TEST = -9999.0


def schreibe_geotiff(
    pfad: Path,
    werte: np.ndarray,
    x_links: float,
    y_oben: float,
    pixel_x: float,
    pixel_y: float,
    epsg: int,
    nodata: float | None = None,
) -> Path:
    gdal, osr = gdal_osr()
    hoehe, breite = werte.shape
    ds = gdal.GetDriverByName("GTiff").Create(str(pfad), breite, hoehe, 1, gdal.GDT_Float32, options=["TILED=YES", "COMPRESS=DEFLATE"])
    ds.SetGeoTransform((x_links, pixel_x, 0.0, y_oben, 0.0, -pixel_y))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(epsg)
    ds.SetProjection(srs.ExportToWkt())
    band = ds.GetRasterBand(1)
    if nodata is not None:
        band.SetNoDataValue(nodata)
    band.WriteArray(werte.astype(np.float32))
    ds.FlushCache()
    ds = None
    return pfad


def ebene(breite: int, hoehe: int, pixel: float, a: float = 100.0, b: float = 0.05, c: float = 0.02) -> np.ndarray:
    """Geneigte Ebene z = a + b·x + c·y_nach_Süden in Metern; Flächenmittel einer Ebene ist ihr Wert in der Zellmitte."""
    xs = (np.arange(breite) + 0.5) * pixel
    ys = (np.arange(hoehe) + 0.5) * pixel
    return (a + b * xs[None, :] + c * ys[:, None]).astype(np.float32)


def rezept_dict(
    kennung: str,
    quellen: list[str],
    crs: str,
    fenster: list[float],
    nodata: float | None = None,
    rand_zellen: int = 4,
) -> dict[str, Any]:
    return {
        "format": "avesmaps-referenzrezept",
        "version": 1,
        "id": kennung,
        "quelle": {"art": "cog-fenster", "urls": quellen, "rand_zellen": rand_zellen},
        "ziel": {"crs": crs, "fenster": fenster},
        "nodata": {"quelle": nodata, "mindestanteil_gueltig": 0.5},
        "stufen": [
            {"name": "30m", "zellgroesse_m": 30, "verfahren": "warp-mittel"},
            {"name": "187_5m", "zellgroesse_m": 187.5, "verfahren": "warp-mittel"},
            {"name": "375m", "zellgroesse_m": 375, "verfahren": "block-mittel", "aus": "187_5m", "faktor": 2},
            {"name": "750m", "zellgroesse_m": 750, "verfahren": "block-mittel", "aus": "187_5m", "faktor": 4},
        ],
    }


def eintrag_dict(kennung: str, typ: str = "kettengebirge", rolle: str = "optimierung", **zusatz: Any) -> dict[str, Any]:
    eintrag: dict[str, Any] = {
        "id": kennung,
        "bezeichnung": f"Testausschnitt {kennung}",
        "typ": typ,
        "geomorphologie": "synthetische geneigte Ebene",
        "rolle": rolle,
        "herkunft": {"region": "Testland", "land": "XX"},
        "quelle": {
            "name": "Synthetisches Testraster",
            "anbieter": "Test",
            "produkt_url": "https://example.invalid/produkt",
            "lizenz": {"name": "frei", "url": "https://example.invalid/lizenz", "quellenangabe": "Test"},
            "modell": "DTM",
            "modell_begruendung": "synthetisch, ohne Bewuchs",
            "aufloesung_m": 10,
            "horizontal": {"crs": "EPSG:32632", "einheit": "m"},
            "vertikal": {"einheit": "m", "bezugssystem": "keines (synthetisch)"},
        },
        "aufbereitung": {"rezept": f"rezepte/{kennung}.json"},
    }
    for schluessel, wert in zusatz.items():
        eintrag[schluessel] = wert
    return eintrag


def manifest_dict(eintraege: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "format": mf.FORMAT,
        "version": mf.VERSION,
        "max_nodata_anteil": 0.01,
        "stufen": [dict(s) for s in mf.STUFEN_STANDARD],
        "ausschnitte": eintraege,
    }


class Werkstatt:
    """Ein Temp-Ordner mit Manifest, Rezepten und Datenwurzel, dazu die Aufrufe der Befehle."""

    def __init__(self, wurzel: Path) -> None:
        self.wurzel = wurzel
        self.manifest = wurzel / "referenz" / "manifest.json"
        self.rezepte = wurzel / "referenz" / "rezepte"
        self.daten = wurzel / "daten"
        self.quellen = wurzel / "quellen"
        for ordner in (self.rezepte, self.daten, self.quellen):
            ordner.mkdir(parents=True, exist_ok=True)

    def pfade(self) -> mf.Pfade:
        return mf.Pfade.standard(self.manifest, self.daten)

    def lege_an(self, eintraege: list[dict[str, Any]], rezepte: dict[str, dict[str, Any]]) -> None:
        self.manifest.write_text(zu_text(manifest_dict(eintraege)), encoding="utf-8")
        for kennung, rezept in rezepte.items():
            (self.rezepte / f"{kennung}.json").write_text(zu_text(rezept), encoding="utf-8")

    def befehl(self, *argumente: str) -> int:
        from terrainlab.__main__ import main

        return main(["referenz", argumente[0], *argumente[1:], "--manifest", str(self.manifest), "--daten", str(self.daten)])

    def lade_manifest(self) -> dict[str, Any]:
        return json.loads(self.manifest.read_text(encoding="utf-8"))
